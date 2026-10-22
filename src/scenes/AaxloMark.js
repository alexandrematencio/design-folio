import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import wordmark from "../assets/aaxlo-wordmark.svg?raw";

/**
 * THE FOURTH ITEM OF THE MENU — AAXLO, as a solid standing on the floor.
 *
 * Alexandre, 2026-10-22: the floor engraving read oddly; the agency gets its
 * own wordmark instead, in 3D, the AAXLO glyph as its O, standing on the
 * floor at an angle, a fifth of the letter height deep. Hidden on arrival,
 * revealed as the scroll reaches the menu, and never in the way of the
 * camera on its road to the hollow under the stair.
 *
 * HIDDEN BY THE STAIR, NOT BY A SWITCH. The mark stands behind the solid and
 * off its −Z flank. From the rest pose — the isometric eye, along (1, 1, 1) —
 * every ray to it passes through the stair, so the rest frame stays the CSS
 * page byte for byte (tools/shoot.mjs asserts it). As the orbit swings the eye
 * round to +X for the menu, the stair's shadow swings off it and the mark
 * comes out from behind on its own: the reveal is the camera move, nothing
 * is faded. Moving it means re-checking both ends: occluded at rest (the
 * shoot), and clear of the bore's axis (x = −0.5) on the way in.
 *
 * WHICH SIDE. −Z is where the camera goes next, but only the −Z flank is both
 * behind the stair from the rest eye and beside it from the menu eye. Facing
 * the mouth, the word stands to its right, clear of the opening; the drive
 * into the bore passes it on the flank.
 *
 * WHERE EXACTLY — searched, not eyeballed (2026-10-22). The first place
 * (x −3.2) let 256 px of the O over the top of the stair at rest on a
 * 1995 × 1198 window, and the shoot's rest check did not see it: it tests the
 * largest stray colour, and 256 px is a rounding error of a frame. The mark
 * was painted flat magenta and counted on a grid of placements: x −2.6,
 * z −2.3, yaw 135° gives 0 px at rest on 1995 × 1198, 1600 × 1000,
 * 1440 × 900 and 1280 × 720, whole and in frame at the menu. Further back
 * along −X clears the stair's top less well; further along −Z runs off the
 * right edge.
 */

/** The letter height (cap height of the SVG's 37 units), in glyph units. */
const HEIGHT = 0.45;
/** "1/5 de la hauteur, en profondeur." */
const DEPTH = HEIGHT / 5;
/** Floor of the room, the bottom of the glyph's box (StepEngravings.js). */
const FLOOR_Y = -1.5;

/**
 * Centre of the footprint, glyph space. Against the stair's back corner and
 * beside its −Z face (z = −1.25). Measured, not chosen: see the header.
 */
export const MARK_CENTRE = [-2.6, FLOOR_Y, -2.3];

/**
 * Yaw about +Y. At 90° the face looks along +X, straight at the menu eye,
 * reading toward −Z (screen right). The extra 45° is the angle Alexandre
 * asked for: the word recedes, A in front, the glyph further back.
 */
const YAW = THREE.MathUtils.degToRad(135);

/** At hover the glyph warms, as the carved names deepen. ~150 ms. */
const HOVER_GLOW = 0.35;
const HOVER_SECONDS = 0.15;

const SVG_UNITS = 37;

const lerpN = (a, b, t) => a + (b - a) * t; // the viewBox height, letters top to bottom

function buildGeometry() {
	const { paths } = new SVGLoader().parse(wordmark);
	const groups = new Map(); // fill colour -> shapes
	for (const path of paths) {
		const fill = path.userData.style.fill;
		if (!groups.has(fill)) groups.set(fill, []);
		groups.get(fill).push(...SVGLoader.createShapes(path));
	}
	return [...groups].map(([fill, shapes]) => {
		const geometry = new THREE.ExtrudeGeometry(shapes, {
			depth: (DEPTH / HEIGHT) * SVG_UNITS,
			bevelEnabled: false,
			curveSegments: 10,
		});
		return { fill, geometry };
	});
}

export class AaxloMark {
	/** @param {THREE.Object3D} glyph  the solid; the mark rides on it */
	constructor(glyph) {
		this.group = new THREE.Group();
		this.group.name = "aaxlo-mark";
		this.hovered = false;
		this.glow = 0;

		// Inner holder in SVG units: y flipped (SVG runs down), the word's
		// baseline on y = 0, centred along x and through its depth. Three
		// sees the negative determinant and flips the winding for us.
		const inner = new THREE.Group();
		const s = HEIGHT / SVG_UNITS;
		inner.scale.set(s, -s, s);

		this.parts = buildGeometry().map(({ fill, geometry }) => {
			const material = new THREE.MeshStandardMaterial({
				color: new THREE.Color(fill),
				roughness: 0.55,
				metalness: 0,
				emissive: new THREE.Color(fill),
				emissiveIntensity: 0,
			});
			const mesh = new THREE.Mesh(geometry, material);
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			inner.add(mesh);
			return { mesh, material, glyphO: fill.toUpperCase() === "#FF8270" };
		});

		const box = new THREE.Box3();
		for (const { mesh } of this.parts) {
			mesh.geometry.computeBoundingBox();
			box.union(mesh.geometry.boundingBox);
		}
		const centre = box.getCenter(new THREE.Vector3());
		for (const { mesh } of this.parts) {
			mesh.geometry.translate(-centre.x, -box.max.y, -centre.z);
		}

		this.group.add(inner);
		this.group.position.fromArray(MARK_CENTRE);
		this.group.rotation.y = YAW;
		glyph.add(this.group);

		// The hit box, in the group's frame: what the DOM target is fitted to.
		const halfW = ((box.max.x - box.min.x) / 2) * s;
		this.corners = [];
		for (const x of [-halfW, halfW])
			for (const y of [0, HEIGHT])
				for (const z of [-DEPTH / 2, DEPTH / 2])
					this.corners.push(new THREE.Vector3(x, y, z));
		this.samples = [];
		for (let i = 0; i < 5; i++)
			for (let j = 0; j < 3; j++)
				this.samples.push(
					new THREE.Vector3(
						lerpN(-halfW, halfW, (i + 0.5) / 5),
						lerpN(0, HEIGHT, (j + 0.5) / 3),
						DEPTH / 2,
					),
				);
		this.raycaster = new THREE.Raycaster();
	}

	setHover(on) {
		this.hovered = on;
	}

	/** Centre of the word, glyph space — where its dive lands. */
	static get CENTRE() {
		return [MARK_CENTRE[0], MARK_CENTRE[1] + HEIGHT / 2, MARK_CENTRE[2]];
	}

	update(delta) {
		// Same exponential approach as the carved names: eases out by
		// construction, frame-rate independent.
		const k = 1 - Math.exp((-3 * delta) / HOVER_SECONDS);
		this.glow += ((this.hovered ? HOVER_GLOW : 0) - this.glow) * k;
		for (const part of this.parts) {
			if (part.glyphO) part.material.emissiveIntensity = this.glow;
		}
	}

	/**
	 * Centre and extent on screen, CSS pixels — as StepEngravings.anchors —
	 * plus `seen`: whether any of the word is in frame AND not behind the
	 * stair. Alexandre: the mark stays clickable as long as it can be seen,
	 * wherever the camera is, not only at the menu. Sampled on a 5 × 3 grid
	 * of the front face, each point raycast against the solid.
	 *
	 * @param {THREE.Camera} camera   the camera that DRAWS the frame
	 * @param {THREE.Mesh} occluder   the glyph
	 */
	anchors(camera, width, height, occluder) {
		this.group.updateMatrixWorld(true);
		const v = new THREE.Vector3();
		const box = new THREE.Box2();
		let behind = false;
		for (const corner of this.corners) {
			v.copy(corner).applyMatrix4(this.group.matrixWorld).project(camera);
			if (v.z > 1 || v.z < -1) behind = true;
			box.expandByPoint(
				new THREE.Vector2((v.x * 0.5 + 0.5) * width, (-v.y * 0.5 + 0.5) * height),
			);
		}
		const c = box.getCenter(new THREE.Vector2());
		const size = box.getSize(new THREE.Vector2());
		return {
			x: c.x,
			y: c.y,
			width: size.x,
			height: size.y,
			onScreen: !behind && c.x >= 0 && c.x <= width && c.y >= 0 && c.y <= height,
			seen: !behind && this.#seen(camera, occluder),
		};
	}

	#seen(camera, occluder) {
		const world = new THREE.Vector3();
		const ndc = new THREE.Vector3();
		const eye = new THREE.Vector3();
		for (const local of this.samples) {
			world.copy(local).applyMatrix4(this.group.matrixWorld);
			ndc.copy(world).project(camera);
			if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || Math.abs(ndc.z) > 1) continue;
			if (!occluder) return true;
			this.raycaster.setFromCamera(ndc, camera);
			const hit = this.raycaster.intersectObject(occluder, false)[0];
			// The ray's own distance to the sample, measured from where the
			// ray starts: an orthographic ray starts on the near plane.
			const reach = eye.copy(world).sub(this.raycaster.ray.origin).length();
			if (!hit || hit.distance > reach - 1e-3) return true;
		}
		return false;
	}

	dispose() {
		this.group.parent?.remove(this.group);
		for (const { mesh, material } of this.parts) {
			mesh.geometry.dispose();
			material.dispose();
		}
	}
}
