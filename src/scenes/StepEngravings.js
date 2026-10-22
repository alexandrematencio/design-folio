import * as THREE from "three";

/**
 * THE MENU, CARVED INTO THE STAIR.
 *
 * Alexandre, 2026-10-22: the names are engraved, hollowed into the risers
 * (Journal, Photography, Design, top to bottom), the hollow lined with a blue
 * a shade darker than the cobalt so they read. They are not there on arrival:
 * they come up as the camera comes square on to the steps, and go as it
 * leaves. The fourth item, AAXLO, is not carved: it stands on the floor as a
 * solid of its own (AaxloMark.js).
 *
 * A NOTE BESIDE A NAME. DESIGN has no site yet: "soon" is carved small to
 * its right, its top on the cap line of the name (Alexandre, 2026-10-22).
 * The name stays centred like the other two, the note hangs off it, and it
 * plays no part in the shared size. It comes from data-note on the <nav>.
 *
 * ONE TYPE SIZE FOR ALL THREE, set by the longest name. Fitting each name to
 * its riser made JOURNAL and DESIGN bigger than PHOTOGRAPHY; Alexandre wants
 * the three exactly the same size, PHOTOGRAPHY being the reference.
 *
 * THE CARVE IS PAINTED, NOT MODELLED. A groove is three surfaces under a
 * light from above: the upper wall faces down and sits in shadow, the lower
 * wall faces up and catches the light, the bottom of the cut lies between
 * the two. Each label is one canvas drawing those three bands, laid on a
 * plane a hair off the face it belongs to — no CSG on the glyph, whose
 * geometry carries the bake, the wedge and the tunnel and is not to be
 * touched for a menu. The light the bands assume is the key's, from above:
 * the trick holds as long as the label is only seen near the step view,
 * which is exactly when it is shown.
 *
 * NEVER AT REST. Below an opacity of 1/1000 the meshes are switched off,
 * not merely transparent: the rest frame must stay byte-identical to the CSS
 * page (tools/shoot.mjs asserts it), and a transparent mesh still writes to
 * the frame through blending.
 */

/** Where each slot sits, in the mesh's own coordinates (Scene.js, STEP_FRONTS). */
const RISERS = [
	[0, 1, 0],
	[1, 0, 0],
	[2, -1, 0],
];

/** A label's footprint, in glyph units. The riser is 1 tall, 2.5 deep. */
const LABEL = { width: 2.3, height: 0.62 };
/** Off the face, along its normal, in glyph units — and polygonOffset on top. */
const LIFT = 0.004;

/** Texture density: ~2x what a 1600-wide step view puts on screen. */
const PX_PER_UNIT = 440;

/**
 * The three bands of the cut. MID is the bottom of the groove — "un bleu
 * légèrement plus foncé" than the cobalt #0013ff; WALL_DARK the upper wall in
 * shadow; WALL_LIT the lower wall catching the key.
 */
const INK = {
	mid: "#000db0",
	wallDark: "#00067a",
	wallLit: "#5a68ff",
};

/** The carve, at hover: a little deeper (darker), as if pressed in. */
const HOVER_DEPTH = 0.78;
/** Seconds to settle into or out of the hover — a micro-interaction (~150 ms). */
const HOVER_SECONDS = 0.15;

const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/** The note's size, against the name's. */
const NOTE_SCALE = 0.4;
/** Gap between the name and its note, against the name's size. */
const NOTE_GAP = 0.12;

const LABEL_PX = {
	w: Math.round(LABEL.width * PX_PER_UNIT),
	h: Math.round(LABEL.height * PX_PER_UNIT),
};

/**
 * The largest bold size at which EVERY name fits 86 % of the width and 58 %
 * of the height — so the longest name sets it, and the others follow.
 */
function sharedSize(texts) {
	const ctx = document.createElement("canvas").getContext("2d");
	let size = LABEL_PX.h * 0.58;
	ctx.font = `700 ${size}px ${FONT_FAMILY}`;
	const widest = Math.max(...texts.map((t) => ctx.measureText(t).width));
	if (widest > LABEL_PX.w * 0.86) size *= (LABEL_PX.w * 0.86) / widest;
	return size;
}

/**
 * Each run of text to cut: the name, centred on the label, and its note if
 * any, top on the name's cap line. Measured, so it holds for any font the
 * stack falls back to.
 */
function layout(ctx, { text, note }, size) {
	const { w, h } = LABEL_PX;
	const font = `700 ${size}px ${FONT_FAMILY}`;
	const runs = [{ text, font, size, x: w / 2, y: h / 2, align: "center", baseline: "middle" }];
	if (!note) return runs;

	ctx.font = font;
	ctx.textBaseline = "middle";
	const name = ctx.measureText(text);
	const capTop = h / 2 - name.actualBoundingBoxAscent;
	const noteSize = size * NOTE_SCALE;
	const noteFont = `700 ${noteSize}px ${FONT_FAMILY}`;
	ctx.font = noteFont;
	ctx.textBaseline = "alphabetic";
	const ascent = ctx.measureText(note).actualBoundingBoxAscent;
	runs.push({
		text: note,
		font: noteFont,
		size: noteSize,
		x: w / 2 + name.width / 2 + size * NOTE_GAP,
		y: capTop + ascent,
		align: "left",
		baseline: "alphabetic",
	});
	return runs;
}

/** Paints every run, offset by `dy` times its own size. */
function fillRuns(ctx, runs, dy) {
	for (const run of runs) {
		ctx.font = run.font;
		ctx.textAlign = run.align;
		ctx.textBaseline = run.baseline;
		ctx.fillText(run.text, run.x, run.y + dy * run.size);
	}
}

function drawCarve(item, size) {
	const { w, h } = LABEL_PX;
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	const runs = layout(ctx, item, size);

	// Wall thicknesses, against each run's size: the shadowed one reads
	// deeper than the lit one.
	const LIT = 0.05;
	const DARK = 0.08;

	// 1. The whole letter, lit: what survives at the bottom edges is the
	//    lower wall catching the light.
	ctx.fillStyle = INK.wallLit;
	fillRuns(ctx, runs, 0);

	// 2. The same letter raised by `lit`, in shadow, only inside the first:
	//    everything but that bottom band turns to wall-in-shadow.
	ctx.globalCompositeOperation = "source-atop";
	ctx.fillStyle = INK.wallDark;
	fillRuns(ctx, runs, -LIT);

	// 3. The bottom of the cut: the letter raised by `lit` AND lowered by
	//    `dark` — what is left between the two walls.
	const floor = document.createElement("canvas");
	floor.width = w;
	floor.height = h;
	const f = floor.getContext("2d");
	f.fillStyle = INK.mid;
	fillRuns(f, runs, -LIT);
	f.globalCompositeOperation = "destination-in";
	fillRuns(f, runs, DARK);
	ctx.drawImage(floor, 0, 0);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

/**
 * Plane basis, as (right, up, normal) in glyph space. The step view looks
 * along −X, so screen-right is −Z: on a riser the text runs along −Z and
 * stands up along +Y.
 */
const RISER_BASIS = new THREE.Matrix4().makeBasis(
	new THREE.Vector3(0, 0, -1),
	new THREE.Vector3(0, 1, 0),
	new THREE.Vector3(1, 0, 0),
);
export class StepEngravings {
	/**
	 * @param {THREE.Object3D} glyph  the solid; the labels ride on it
	 * @param {{text: string, note?: string}[]} texts  the risers, top to bottom
	 */
	constructor(glyph, texts) {
		this.group = new THREE.Group();
		this.group.name = "step-engravings";
		const names = texts.slice(0, RISERS.length);
		const size = sharedSize(names.map((n) => n.text));
		this.items = names.map((name, slot) => this.#make(name, slot, size));
		this.hovered = null;
		this.opacity = 0;
		glyph.add(this.group);
		this.#setVisible(false);
	}

	#make(name, slot, size) {
		const geometry = new THREE.PlaneGeometry(LABEL.width, LABEL.height);
		const material = new THREE.MeshBasicMaterial({
			map: drawCarve(name, size),
			transparent: true,
			opacity: 0,
			depthWrite: false,
			toneMapped: false,
			polygonOffset: true,
			polygonOffsetFactor: -2,
			polygonOffsetUnits: -4,
		});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.applyMatrix4(RISER_BASIS);
		const [x, y, z] = RISERS[slot];
		mesh.position.set(x + LIFT, y, z);
		mesh.renderOrder = 2;
		this.group.add(mesh);
		return { mesh, material, depth: 1, slot };
	}

	#setVisible(on) {
		if (this.group.visible !== on) this.group.visible = on;
	}

	/** Which label the pointer (or the keyboard focus) is on; null for none. */
	setHover(index) {
		this.hovered = index;
	}

	/**
	 * @param {number} delta   seconds since the last frame
	 * @param {number} facing  0 away from the step view, 1 square on to it
	 */
	update(delta, facing) {
		this.opacity = facing;
		const on = facing > 1e-3;
		this.#setVisible(on);
		if (!on) return;
		// Exponential approach: eases out by construction, and frame-rate
		// independent. ~95 % of the way in HOVER_SECONDS.
		const k = 1 - Math.exp((-3 * delta) / HOVER_SECONDS);
		for (const [i, item] of this.items.entries()) {
			const target = i === this.hovered ? HOVER_DEPTH : 1;
			item.depth += (target - item.depth) * k;
			item.material.color.setScalar(item.depth);
			item.material.opacity = facing;
		}
	}

	/**
	 * Each label's centre and half-extents on screen, CSS pixels — what the
	 * DOM hit targets (main-v2.js) are fitted to.
	 */
	anchors(camera, width, height) {
		const v = new THREE.Vector3();
		const box = new THREE.Box2();
		return this.items.map(({ mesh }) => {
			mesh.updateMatrixWorld(true);
			const pos = mesh.geometry.attributes.position;
			box.makeEmpty();
			let behind = false;
			for (let i = 0; i < pos.count; i++) {
				v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(camera);
				if (v.z > 1) behind = true;
				box.expandByPoint(
					new THREE.Vector2((v.x * 0.5 + 0.5) * width, (-v.y * 0.5 + 0.5) * height),
				);
			}
			const c = box.getCenter(new THREE.Vector2());
			const s = box.getSize(new THREE.Vector2());
			return {
				x: c.x,
				y: c.y,
				width: s.x,
				height: s.y,
				onScreen:
					!behind && c.x >= 0 && c.x <= width && c.y >= 0 && c.y <= height,
			};
		});
	}

	dispose() {
		this.group.parent?.remove(this.group);
		for (const { mesh, material } of this.items) {
			mesh.geometry.dispose();
			material.map.dispose();
			material.dispose();
		}
	}
}
