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
