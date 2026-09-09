import * as THREE from "three";

/**
 * The studio the glyph needs, built as an equirectangular environment map.
 *
 * Why not brand/3d/studio-white-env.hdr
 * -------------------------------------
 * Because it does not contain a studio. Decoded, that file is a UNIFORM 0.100
 * in every direction — ceiling, horizon and floor all read 0.0983 .. 0.1018.
 * It is the Blender world's lighting-ray value ("blanc à 0,10", exactly as its
 * own README says), and the world is not what lit the render: the ceiling was
 * a light OBJECT, and light objects do not survive an export to an .hdr.
 *
 * A perfectly uniform environment can only ever reflect flat grey, so with it
 * the treads never whiten and the paper goes gunmetal the moment the scene is
 * lit. The file is not broken, it is simply not the thing it is being asked to
 * be. So the rig is rebuilt here, from the description that is right:
 *
 *   "Tout ce qui est brillant doit venir d'en haut, et rien d'autre."
 *   — a big, very powerful ceiling, and (on the two-tone page) no floor
 *   at all. The one-material page DOES pass a bright floor: the pale wedge
 *   under the bottom step is its reflection. That is safe only because the
 *   glyph's shader gates who may show it (see GlyphMaterial.js) — unhung,
 *   the rule below still holds:
 *
 * What that buys, and it is the whole identity of the mark:
 *
 *   a TREAD faces up. Under this camera it mirrors at about 35 degrees of
 *   elevation, straight into the ceiling. CEILING is set far above 1 on
 *   purpose, so that reflection clips white through the clearcoat and the
 *   tread reads as paper — the same white the 2D logo has, arrived at as a
 *   reflection instead of as a fill.
 *
 *   a RISER faces sideways. Its mirror direction points BELOW the horizon,
 *   into FLOOR, which is nearly nothing. It keeps its diffuse cobalt and gains
 *   no highlight. Put any light down there UNGATED and the risers wash to
 *   lavender and the logo stops reading — measured: at the rest angle the
 *   step fronts and the bottom riser mirror the floor over 100 % of their
 *   area, exactly like the wedge does.
 *
 * Cheap: 512 x 256 floats, built once, PMREM-filtered by the renderer.
 */
export function createStudioEnvironment({
	width = 512,
	height = 256,
	ceiling = 42,
	horizon = 0.32,
	floor = 0.015,
} = {}) {
	const data = new Float32Array(width * height * 4);

	for (let y = 0; y < height; y++) {
		// three samples an equirect map as v = 0.5 + asin(dir.y) / PI, and a
		// DataTexture is NOT flipped, so v = 0 — the first row — is the NADIR.
		// Build it upside down and the rig inverts silently: the risers blow
		// to white and the treads go cobalt, which is the logo inside out.
		const polar = ((y + 0.5) / height) * Math.PI;
		const up = -Math.cos(polar); // -1 nadir, 0 horizon, +1 zenith

		let value;
		if (up >= 0) {
			// Smooth all the way to the horizon: a hard edge would print the
			// seam of the ceiling into every polished tread.
			const t = up * up * (3 - 2 * up);
			value = horizon + (ceiling - horizon) * t;
		} else {
			const t = -up;
			value = horizon + (floor - horizon) * (t * t * (3 - 2 * t));
		}

		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			data[i] = value;
			data[i + 1] = value;
			data[i + 2] = value;
			data[i + 3] = 1;
		}
	}

	const texture = new THREE.DataTexture(
		data,
		width,
		height,
		THREE.RGBAFormat,
		THREE.FloatType,
	);
	texture.mapping = THREE.EquirectangularReflectionMapping;
	texture.colorSpace = THREE.LinearSRGBColorSpace;
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;

	return texture;
}
