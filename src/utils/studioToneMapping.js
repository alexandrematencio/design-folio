import * as THREE from "three";

/**
 * A tone curve that exists only while the camera moves.
 *
 * The renderer is NoToneMapping on purpose (WebGLContext.js): at rest the
 * page has to come out byte-identical to the CSS. This keeps that, by MIXING
 * three's AgX (or Khronos PBR Neutral) with the untouched colour, by the same
 * studio amount that brings in the shadows, the edge and the grain:
 *
 *     out = mix( colour, curve( colour * exposure ), studio * strength )
 *
 * At rest studio is 0 and the mix returns the colour itself, exactly.
 *
 * Chosen by Alexandre on 2026-11-03: AgX at strength 0.3. In the studio the
 * treads stop clipping to a flat white and read as lit paper, a little
 * duller, with softer gradients in the gorge and on the floor. The price,
 * measured: the cobalt drifts a little towards azure (G 16 -> 48 on the
 * façade). Neutral keeps the cobalt intact but was not the look he chose.
 *
 * Every material carries `toneMappingExposure`, and nothing else is global,
 * so that one float carries both dials: 2 * round( exposure * 256 ) + mix,
 * with mix in [0, 1]. The shader splits it back.
 *
 * DEV only, to try other settings without touching this file:
 *   ?tm=agx | neutral | off    the curve
 *   ?tmx=0.3                   strength (0..1), multiplies the studio amount
 *   ?tme=1                     exposure fed to the curve
 *   T  cycles the curve · [ / ] strength -/+ 0.1 · - / = exposure -/+ 0.05
 *
 * Materials drawn with toneMapped: false (the carved menu, the grain, the
 * gallery) are left out.
 */

const DEFAULT = { mode: "agx", strength: 0.3, exposure: 1 };

const MODES = ["off", "neutral", "agx"];
const MAPPING = {
	off: THREE.NoToneMapping,
	neutral: THREE.NeutralToneMapping,
	agx: THREE.AgXToneMapping,
};

function patchChunk() {
	let chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
	chunk = chunk
		.replace(
			"uniform float toneMappingExposure;",
			`uniform float toneMappingExposure;
float studioExposure() { return floor( toneMappingExposure * 0.5 ) / 256.0; }
float studioMix() { return toneMappingExposure - 2.0 * floor( toneMappingExposure * 0.5 ); }`,
		)
		.replaceAll("color *= toneMappingExposure;", "color *= studioExposure();")
		.replace("vec3 AgXToneMapping( vec3 color ) {", "vec3 AgXToneMappingBase( vec3 color ) {")
		.replace("vec3 NeutralToneMapping( vec3 color ) {", "vec3 NeutralToneMappingBase( vec3 color ) {");
	chunk += `
vec3 AgXToneMapping( vec3 color ) { return mix( color, AgXToneMappingBase( color ), studioMix() ); }
vec3 NeutralToneMapping( vec3 color ) { return mix( color, NeutralToneMappingBase( color ), studioMix() ); }
`;
	THREE.ShaderChunk.tonemapping_pars_fragment = chunk;
}

// At import, before any material can compile.
patchChunk();

export function createStudioToneMapping() {
	const state = { ...DEFAULT };
	let draw = () => {};

	if (import.meta.env.DEV) {
		const params = new URLSearchParams(location.search);
		if (MODES.includes(params.get("tm"))) state.mode = params.get("tm");
		if (params.has("tmx")) state.strength = clamp(parseFloat(params.get("tmx")), 0, 1);
		if (params.has("tme")) state.exposure = clamp(parseFloat(params.get("tme")), 0.05, 4);
		if (params.has("tm")) draw = devControls(state);
	}

	return {
		/** Before each render: the studio amount of this frame, 0 at rest. */
		apply(renderer, amount) {
			renderer.toneMapping = MAPPING[state.mode];
			const mix = clamp(amount * state.strength, 0, 1);
			renderer.toneMappingExposure = 2 * Math.round(state.exposure * 256) + mix;
			draw(amount);
		},
	};
}

function devControls(state) {
	const label = document.createElement("div");
	label.style.cssText =
		"position:fixed;left:12px;bottom:12px;z-index:99999;pointer-events:none;" +
		"font:11px/1.4 ui-monospace,Menlo,monospace;color:#1a1aff;" +
		"background:rgba(250,250,248,.85);padding:6px 8px;border-radius:4px;";
	document.body.appendChild(label);

	window.addEventListener("keydown", (event) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const k = event.key;
		if (k === "t" || k === "T") {
			state.mode = MODES[(MODES.indexOf(state.mode) + 1) % MODES.length];
		} else if (k === "[") state.strength = clamp(state.strength - 0.1, 0, 1);
		else if (k === "]") state.strength = clamp(state.strength + 0.1, 0, 1);
		else if (k === "-") state.exposure = clamp(state.exposure - 0.05, 0.05, 4);
		else if (k === "=" || k === "+") state.exposure = clamp(state.exposure + 0.05, 0.05, 4);
		else return;
		const url = new URL(location.href);
		url.searchParams.set("tm", state.mode);
		url.searchParams.set("tmx", state.strength.toFixed(1));
		url.searchParams.set("tme", state.exposure.toFixed(2));
		history.replaceState(null, "", url);
	});

	return (studio) => {
		label.textContent =
			`tone ${state.mode.toUpperCase()}  ·  force ${state.strength.toFixed(1)}  ·  ` +
			`expo ${state.exposure.toFixed(2)}  ·  studio ${studio.toFixed(2)}   ` +
			`[T] courbe  [ [ ] ] force  [ - = ] expo`;
	};
}

function clamp(x, lo, hi) {
	return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo;
}
