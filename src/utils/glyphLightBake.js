import * as THREE from "three";

/**
 * Attaches the baked room-visibility to the glyph's geometry.
 *
 * Three numbers, all from tools/bake-glyph-light.py. Per vertex, how much of the
 * white room's upper half this point can see (`aSkyVis`) and how much of its
 * floor (`aGroundVis`) — interpolated across each face, which is what gives
 * every surface the soft vertical falloff a cyclorama actually puts on things.
 * Per face and flat, the wedge selector (`aWell`).
 *
 * They are what lets the shader tell the wedge under the bottom step — sky
 * 0.06 — from the three exposed risers, which all measure 0.51. Nothing else
 * in the geometry distinguishes them: same normal, same material, same
 * everything except what is standing in front of them.
 *
 * The vertex count is asserted, not assumed. A bake silently paired with a
 * rebuilt .glb would misplace the pale wedge onto some other face, which is
 * exactly the kind of wrong that looks deliberate.
 */
export async function attachLightBake(geometry, url) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`light bake not found: ${url} (${response.status})`);
	}
	const bake = await response.json();

	const count = geometry.getAttribute("position").count;
	if (bake.vertexCount !== count) {
		throw new Error(
			`light bake is stale: ${bake.vertexCount} vertices, geometry has ` +
				`${count}. Re-run: python3 tools/bake-glyph-light.py`,
		);
	}

	// Uint8 normalized: 7 KB of JSON rather than 24 KB of floats, and the
	// shader reads 0..1 either way.
	geometry.setAttribute(
		"aSkyVis",
		new THREE.BufferAttribute(Uint8Array.from(bake.sky), 1, true),
	);
	geometry.setAttribute(
		"aGroundVis",
		new THREE.BufferAttribute(Uint8Array.from(bake.ground), 1, true),
	);
	geometry.setAttribute(
		"aWell",
		new THREE.BufferAttribute(Uint8Array.from(bake.well), 1, true),
	);

	return bake;
}

/**
 * The studio's light, baked in Cycles by tools/bake-glyph-studio.py: the two
 * maps that turn the real-time rig's flat faces into a stair under a softbox.
 *
 *   studio — on the stair, through the lightmap UVs (TEXCOORD_1): how much
 *            light each point gets against the best-lit point facing the same
 *            way. Dark into the inside corners, falling off across a face.
 *   floor  — on the cyclorama's floor, in the stair's own (x, z): the sky and
 *            the fill shut out by the stair standing there. 1 far away,
 *            densest at the contact.
 *
 * Both are DATA, not colour: no sRGB decode, and flipY off, because the
 * UVs are glTF's (v = 0 at the top) and the bake writes its rows that way.
 * No mipmaps on the stair's atlas: a smaller level would average across the
 * gutter into the next island's light.
 */
export async function loadStudioBake(geometry, base) {
	const uv1 = geometry.getAttribute("uv1");
	if (!uv1) {
		throw new Error(
			`${base}.glb has no TEXCOORD_1: re-run python3 tools/sharpen-glyph.py`,
		);
	}
	// Under a name of its own: three declares `uv1` only when one of ITS maps
	// asks for channel 1, and none does.
	geometry.setAttribute("aStudioUv", uv1);

	const [meta, studio, floor] = await Promise.all([
		fetch(`${base}.studio.json`).then((r) => {
			if (!r.ok) throw new Error(`studio bake not found: ${base}.studio.json`);
			return r.json();
		}),
		loadData(`${base}.studio.png`),
		// The floor is seen at grazing angles — at the menu's eye, 12 degrees
		// — and without mipmaps it aliases there into a comb along the foot.
		// It is one image, no islands to bleed across: it can have them.
		loadData(`${base}.floor.png`, { mipmaps: true }),
	]);
	return { ...meta, studioMap: studio, floorMap: floor };
}

async function loadData(url, { mipmaps = false } = {}) {
	const texture = await new THREE.TextureLoader().loadAsync(url);
	texture.flipY = false;
	texture.colorSpace = THREE.NoColorSpace;
	texture.generateMipmaps = mipmaps;
	texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
	texture.anisotropy = mipmaps ? 8 : 1;
	texture.magFilter = THREE.LinearFilter;
	texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.needsUpdate = true;
	return texture;
}

/**
 * The floor's half: patches the cyclorama's material, ON TOP of whatever
 * patch it already wears (the projector's), so call it after that one.
 * `toGlyph` is the inverse of the stair's world matrix, kept current by the
 * caller: the map lives in the stair's coordinates, the room does not.
 */
export function patchFloorContact(
	material,
	{ bake, toGlyph, studio, contrast = 1, bounce = 0 },
) {
	const uniforms = {
		uContactMap: { value: bake.floorMap },
		uContactMin: { value: new THREE.Vector2(...bake.floor.min) },
		uContactMax: { value: new THREE.Vector2(...bake.floor.max) },
		uContactY: { value: bake.floor.y },
		uToGlyph: toGlyph,
		uStudio: studio,
		uContactContrast: { value: contrast },
		uContactBounce: { value: bounce },
	};
	const previous = material.onBeforeCompile;
	material.onBeforeCompile = (shader, renderer) => {
		previous?.(shader, renderer);
		Object.assign(shader.uniforms, uniforms);
		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				`#include <common>
				uniform mat4 uToGlyph;
				varying vec3 vContactGlyph;`,
			)
			.replace(
				"#include <begin_vertex>",
				`#include <begin_vertex>
				vContactGlyph = ( uToGlyph * modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				`#include <common>
				uniform sampler2D uContactMap;
				uniform vec2 uContactMin;
				uniform vec2 uContactMax;
				uniform float uContactY;
				uniform float uStudio;
				uniform float uContactContrast;
				uniform float uContactBounce;
				varying vec3 vContactGlyph;`,
			)
			.replace(
				"#include <aomap_fragment>",
				`#include <aomap_fragment>
				{
					vec2 _cuv = ( vContactGlyph.xz - uContactMin ) / ( uContactMax - uContactMin );
					float _in = step( 0.0, _cuv.x ) * step( _cuv.x, 1.0 ) * step( 0.0, _cuv.y ) * step( _cuv.y, 1.0 );
					// The floor only, not the cove climbing out of the rect.
					_in *= 1.0 - smoothstep( 0.02, 0.2, vContactGlyph.y - uContactY );
					vec3 _ct = texture2D( uContactMap, _cuv ).rgb;
					float _c = mix( 1.0, pow( _ct.r, uContactContrast ), _in * uStudio );
					// The stair's own colour on the matte floor around it: what
					// the cobalt risers send down, blurred by the bake into a
					// faint blue haze rather than a reflection.
					vec3 _tint = mix( vec3( 1.0 ), vec3( _ct.g, _ct.g, _ct.b * 2.0 ), uContactBounce * _in * uStudio );
					reflectedLight.directDiffuse *= _c * _tint;
					reflectedLight.indirectDiffuse *= _c * _tint;
				}`,
			);
	};
	const key = material.customProgramCacheKey?.bind(material);
	material.customProgramCacheKey = () => `${key?.() ?? ""}-contact`;
	material.needsUpdate = true;
	return uniforms;
}
