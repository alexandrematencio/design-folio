import * as THREE from "three";
import { clamp, lerp, smoothstep } from "../utils/utils";

/**
 * THE GALLERY — the Selected Works, hung inside the hole of the logo.
 *
 * A SECOND scene, drawn by the same renderer with its own eye. Nothing is
 * added to the logo's scene, and nothing in the logo's scene knows this exists.
 *
 * THE SEAM IS GEOMETRIC, NOT CHOREOGRAPHED. The bore of the glyph is a square
 * prism one unit across (TUNNEL in Scene.js). This tunnel is built in the SAME
 * world frame — same origin, same axis, same section, the glyph's own scale —
 * and its camera at t = 0 IS the journey's perspective camera at the plateau
 * progress: position, quaternion, fov and aspect, copied rather than
 * recomputed. So at the moment of the crossfade the four cobalt edges of the
 * bore and the four grey edges of the white tunnel land on the same pixels,
 * and the dissolve reads as the matter of the logo turning into paper. There
 * is not one line of stitching maths, and that is the point: a fade between
 * two pictures that already agree cannot be mistimed.
 *
 * THE EXIT SEAM IS THE SAME TRICK, PAID FOR BY PERIODICITY. At t = 1 the
 * camera is not back where it started — it is LENGTH further down the tunnel.
 * That is invisible because LENGTH is a whole number of lattice cells, the
 * photographs have all run out behind, and the fog closes the view long before
 * the geometry ends: the picture at t = 1 is the picture at t = 0. Scroll back
 * out and the logo is exactly where the visitor left it.
 *
 * Reference: the Delphi home (delphi-three.vercel.app) — a lattice of
 * LineSegments rather than a texture, photographs laid flat on four walls.
 * Adapted: paper #FAFAF8 rather than white, placement deterministic rather
 * than Math.random (the shoots have to be reproducible), aspect ratios kept.
 */

const PAPER = "#FAFAF8"; // brand --color-bg, the same one Scene.js uses
const LATTICE = "#B0B0B0"; // the reference's own grey, at half opacity

/**
 * Everything below is in BORE UNITS: the bore is 1 wide and 1 tall, and the
 * root group carries the glyph's scale, so a "1" here is one bore width on
 * screen. Depths run from the mouth of the bore, forward along its axis.
 */
const GRID = {
	/** Cells across a wall. The cell is square: it is this deep as well. */
	CELLS: 4,
	/**
	 * Photographs, two per row. 16 rows is the curation — 31 baked images, see
	 * tools/curation.mjs. It is a constant rather than a count read off the
	 * JSON because the LENGTH of the tunnel, and with it the pacing of the
	 * 750vh plateau, must not depend on when a fetch happens to land.
	 */
	ROWS: 16,
	/** Cells between two rows. 4 = one bore width: a square rhythm. */
	PITCH: 4,
	/** Cells from the seam pose to the first row, and past the last one. */
	LEAD: 6,
	TAIL: 6,
	/** A photograph gets 2 x 2 cells less this mat, in bore units. */
	MARGIN: 0.1,
	/** Bore widths of tunnel kept beyond the far seam, so the fog closes it. */
	AHEAD: 8,
	/** Bore widths: where the lattice starts washing out, and where it is gone. */
	FOG: [2, 6],
	/**
	 * How far a photograph stands proud of its wall. The lattice does NOT get
	 * one: it sits exactly on the plane of the bore and the paper behind it is
	 * pushed back with a polygon offset instead. Insetting the lines by even
	 * 0.003 moved the tunnel's four edges 1.6 px off the cobalt bore's at the
	 * exit plane and more near the eye — measured — and those edges landing on
	 * each other is the entire trick of the seam.
	 */
	INSET: 0.006,
};

/** Fraction of the plateau each crossfade owns, at both ends. */
const FADE = 0.08;
/** Fraction of the traverse the eye takes to leave the ride line, and to rejoin it. */
const RECENTRE = 0.1;
/** Brand rule: a hover zoom never passes 1.04, and never comes with a caption. */
const HOVER_SCALE = 1.03;
/** Seconds a photograph takes to arrive once its texture is decoded. */
const ARRIVAL = 0.4;

const CELL = 1 / GRID.CELLS;
/** How far the camera travels between the two seams. A whole number of CELLs. */
const LENGTH = (GRID.LEAD + (GRID.ROWS - 1) * GRID.PITCH + GRID.TAIL) * CELL;

/**
 * The walls, in the order photographs take them. Each carries where it sits,
 * its inward normal, the across-the-wall direction, and the up of the image —
 * all in tunnel space (x across, y up, z down the axis).
 *
 * THE UP OF AN IMAGE IS NOT A CHOICE, it is what makes it readable from an eye
 * that is advancing down the middle. On the floor, the far end of the picture
 * is the one nearer the vanishing point, so its top is +z. On the CEILING it is
 * the opposite: what is overhead and behind reads at the top of the frame, so
 * its top is -z. Getting that one backwards mirrors the photograph — the shoot
 * caught it on a shopfront sign that came out reading HYDRO JET the wrong way
 * round. On the two side walls the up is simply up.
 */
const WALLS = [
	{ at: [0, -1], across: [1, 0], normal: [0, 1, 0], up: [0, 0, 1] }, // floor
	{ at: [-1, 0], across: [0, 1], normal: [1, 0, 0], up: [0, 1, 0] }, // -x side
	{ at: [0, 1], across: [1, 0], normal: [0, -1, 0], up: [0, 0, -1] }, // ceiling
	{ at: [1, 0], across: [0, 1], normal: [-1, 0, 0], up: [0, 1, 0] }, // +x side
];

/**
 * Which of the three possible 2-cell columns a photograph takes on its wall.
 * Deterministic and non-repeating: the k-th image on a wall reads this cycle,
 * so no two consecutive images on the same wall share a column, and a re-run
 * of the shoot draws the identical tunnel. Math.random would cost exactly that.
 */
const COLUMNS = [0, 2, 1];

/** A plane's orientation from its normal and its up. Columns are right/up/normal. */
const basis = (normal, up) => {
	const n = new THREE.Vector3().fromArray(normal);
	const u = new THREE.Vector3().fromArray(up);
	const r = new THREE.Vector3().crossVectors(u, n);
	return new THREE.Quaternion().setFromRotationMatrix(
		new THREE.Matrix4().makeBasis(r, u, n),
	);
};

export default class Gallery {
	/**
	 * @param {import("./Scene").default} scene    the logo's scene, for boreFrame()
	 * @param {import("../core/WebGLContext").default} context  for the anisotropy cap
	 */
	constructor(scene, context) {
		this.source = scene;
		this.context = context;

		this.scene = new THREE.Scene();
		// Deliberately NOT a background: a background is painted by the
		// renderer's clear, and a clear is not a thing that can be faded. The
		// paper of this tunnel is its own four walls plus a cap at the far end,
		// so the crossfade has something to dissolve.
		this.scene.background = null;
		this.scene.fog = new THREE.Fog(new THREE.Color(PAPER), 1, 2);

		this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 1000);
		this.root = new THREE.Group();
		this.scene.add(this.root);

		this.fade = 0;
		this.clearColour = new THREE.Color(PAPER);

		/** curation.json, in curation order. Empty until the fetch lands. */
		this.photos = [];
		/** slug -> THREE.Texture, kept across rebuilds: a resize is not a reload. */
		this.textures = new Map();
		this.frames = [];
		this.paperMaterial = null;
		this.lattice = null;
		this.geometry = null;
		this.hovered = null;
		this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

		// The tunnel can only be built while the journey's camera is ON the
		// plateau — its pose is the anchor everything is measured from, and at
		// construction time it is still at the origin. So: build lazily, on the
		// first frame the gallery is actually asked for.
		this.dirty = true;
		this.armed = false;
		this.pending = 0;

		this.raycaster = new THREE.Raycaster();
		this.pointer = new THREE.Vector2();

		this.#loadIndex();

		// The textures are never allowed to block the page. Whichever comes
		// first wins: the visitor scrolling past a third of the loop (they are
		// on their way to the tunnel), or the browser admitting it is idle.
		const idle = window.requestIdleCallback;
		if (idle) idle(() => this.arm(), { timeout: 3000 });
		else setTimeout(() => this.arm(), 3000);
	}

	/** True once every photograph that is going to arrive has arrived. */
	get ready() {
		return this.armed && this.pending === 0;
	}

	/* -------------------------------------------------------------- the film */

	/**
	 * A pure function of `t`, the position on the plateau. Nothing here
	 * integrates, so scrolling backwards plays the whole tunnel in reverse for
	 * free. `delta` and `elapsed` feed only the two things that are NOT the
	 * scroll: a texture arriving, and a pointer resting on a photograph.
	 */
	update({ t }, delta, elapsed) {
		this.fade =
			t <= 0 || t >= 1
				? 0
				: Math.min(
						smoothstep(clamp(t / FADE)),
						smoothstep(clamp((1 - t) / FADE)),
					);
		if (this.fade <= 0) {
			this.hovered = null;
			return;
		}

		const seam = this.source.perspCamera;
		if (!seam || !this.source.glyph) return;
		if (this.dirty) this.#rebuild();
		const frame = this.frame;
		if (!frame) return;

		// Uniform speed in t. The page has exactly one law — the picture is a
		// function of the scroll — and an ease in the middle of a straight
		// corridor would be a second one, invented for nothing.
		const travel = clamp((t - FADE) / (1 - 2 * FADE));
		// The eye leaves the ride line for the centre of the tunnel (the
		// Delphi framing) and comes back to it for the exit seam, where it has
		// to be the journey's camera again to the pixel.
		const rise =
			frame.rideDrop *
			smoothstep(clamp(travel / RECENTRE)) *
			smoothstep(clamp((1 - travel) / RECENTRE));

		// DERIVED FROM THE SEAM, never rebuilt from scratch: at travel = 0 and
		// rise = 0 this reduces to the journey's own camera, pose for pose,
		// which is what makes the crossfade aligned rather than nearly aligned.
		this.camera.position
			.copy(seam.position)
			.addScaledVector(frame.axisDir, travel * LENGTH * frame.s)
			.addScaledVector(frame.up, rise * frame.s);
		this.camera.quaternion.copy(seam.quaternion);
		if (this.camera.fov !== seam.fov || this.camera.aspect !== seam.aspect) {
			this.camera.fov = seam.fov;
			this.camera.aspect = seam.aspect;
			this.camera.updateProjectionMatrix();
		}
		this.camera.updateMatrixWorld(true);

		this.#paint(delta, elapsed);
	}

	#paint(delta, elapsed) {
		this.lattice.material.opacity = 0.5 * this.fade;
		this.paperMaterial.opacity = this.fade;

		for (const frame of this.frames) {
			const state = frame.mesh.userData;
			// -1 means "the texture landed, stamp me on the next frame you
			// draw": the loader has no access to the scene's clock.
			if (state.born === -1) state.born = elapsed;
			const arrived =
				state.born == null ? 0 : clamp((elapsed - state.born) / ARRIVAL);
			frame.mesh.material.opacity = this.fade * arrived;
			frame.mesh.visible = arrived > 0;

			const want = frame.mesh === this.hovered && !this.reducedMotion ? 1 : 0;
			frame.hover = lerp(frame.hover, want, Math.min(1, delta * 9));
			frame.mesh.scale.setScalar(lerp(1, HOVER_SCALE, frame.hover));
		}
	}

	/* ------------------------------------------------------------ the tunnel */

	#rebuild() {
		this.#clear();
		this.#build();
		this.dirty = false;
		if (this.armed) this.#loadTextures();
	}

	#build() {
		const bore = this.source.boreFrame();
		if (!bore) return;

		const s = bore.s;
		const half = bore.bore / 2;
		// The seam camera's depth down the axis, measured from the mouth. Every
		// photograph is placed relative to it, so moving the plateau moves the
		// whole gallery with it and the lead-in beat survives.
		const zSeam =
			bore.camera.position.clone().sub(bore.origin).dot(bore.axisDir) / s;
		const zFrom = zSeam - 2;
		const zTo = zSeam + LENGTH + GRID.AHEAD;

		this.frame = {
			s,
			axisDir: bore.axisDir,
			rideDrop: bore.rideDrop,
			up: new THREE.Vector3(0, 1, 0).applyQuaternion(bore.quaternion),
			zSeam,
		};

		this.root.position.copy(bore.origin);
		this.root.quaternion.copy(bore.quaternion);
		this.root.scale.setScalar(s);
		this.scene.fog.near = GRID.FOG[0] * s;
		this.scene.fog.far = GRID.FOG[1] * s;
		this.camera.near = 0.02 * s;
		this.camera.far = (GRID.FOG[1] + 4) * s;
		this.camera.updateProjectionMatrix();

		/* ---- the paper: four walls and a cap, the only opaque surfaces ---- */

		// ONE material for all five, so the crossfade is one number. The
		// polygon offset is what lets the lattice sit EXACTLY on the plane of
		// the bore rather than a hair inside it: the paper is pushed back in
		// depth, the lines win, and the four edges stay where the cobalt ones
		// are.
		this.paperMaterial = new THREE.MeshBasicMaterial({
			color: new THREE.Color(PAPER),
			side: THREE.FrontSide,
			transparent: true,
			opacity: 0,
			toneMapped: false,
			polygonOffset: true,
			polygonOffsetFactor: 1,
			polygonOffsetUnits: 1,
		});

		const length = zTo - zFrom;
		const mid = (zFrom + zTo) / 2;
		for (const wall of WALLS) {
			const mesh = new THREE.Mesh(
				new THREE.PlaneGeometry(bore.bore, length),
				this.paperMaterial,
			);
			mesh.quaternion.copy(basis(wall.normal, [0, 0, 1]));
			mesh.position.set(wall.at[0] * half, wall.at[1] * half, mid);
			mesh.renderOrder = 0;
			this.root.add(mesh);
		}
		// The cap. Without it the vanishing rectangle of a finite tube shows
		// the clear colour through, which is the one hole a full fade cannot
		// cover. It sits past the fog, so it is pure paper and never read as
		// a wall.
		const cap = new THREE.Mesh(
			new THREE.PlaneGeometry(bore.bore, bore.bore),
			this.paperMaterial,
		);
		cap.quaternion.copy(basis([0, 0, -1], [0, 1, 0]));
		cap.position.set(0, 0, zTo);
		cap.renderOrder = 0;
		this.root.add(cap);

		/* ---- the lattice: lines down the axis, a section at every cell ---- */

		this.geometry = this.#latticeGeometry(half, zFrom, zTo);
		this.lattice = new THREE.LineSegments(
			this.geometry,
			new THREE.LineBasicMaterial({
				color: new THREE.Color(LATTICE),
				transparent: true,
				opacity: 0,
				toneMapped: false,
			}),
		);
		this.lattice.renderOrder = 1;
		this.root.add(this.lattice);

		/* ---- the photographs ---- */

		this.frames = [];
		const taken = [0, 0, 0, 0];
		for (const [i, photo] of this.photos.entries()) {
			if (i >= GRID.ROWS * 2) break;
			const w = i % WALLS.length;
			const column = COLUMNS[taken[w]++ % COLUMNS.length];
			const z = zSeam + (GRID.LEAD + Math.floor(i / 2) * GRID.PITCH) * CELL;
			this.frames.push(this.#photoFrame(photo, WALLS[w], column, half, z));
		}
	}

	/**
	 * One geometry for the whole run. The gallery is finite — a few hundred
	 * segments — so there is nothing to recycle and no reason to think about
	 * it; the reference's rolling segments exist because its tunnel never ends
	 * and ours does.
	 */
	#latticeGeometry(r, zFrom, zTo) {
		const points = [];
		const axial = (x, y) => points.push(x, y, zFrom, x, y, zTo);

		// The four corners, drawn once rather than twice: two walls share each.
		for (const sx of [-1, 1]) for (const sy of [-1, 1]) axial(sx * r, sy * r);
		// Then the boundaries inside each wall — CELLS cells across means
		// CELLS - 1 lines that are not already a corner.
		for (let i = 1; i < GRID.CELLS; i++) {
			const a = -r + (2 * r * i) / GRID.CELLS;
			axial(a, -r); // floor
			axial(a, r); // ceiling
			axial(-r, a); // left
			axial(r, a); // right
		}

		// A rectangle of section at every cell boundary: the rungs that give
		// the corridor its rate of travel. The phase does not matter, the pitch
		// does — LENGTH is a whole number of these, which is exactly what makes
		// the picture at t = 1 the picture at t = 0.
		const corners = [
			[-r, -r],
			[r, -r],
			[r, r],
			[-r, r],
		];
		for (let z = Math.ceil(zFrom / CELL) * CELL; z <= zTo; z += CELL) {
			for (let i = 0; i < 4; i++) {
				const a = corners[i];
				const b = corners[(i + 1) % 4];
				points.push(a[0], a[1], z, b[0], b[1], z);
			}
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(points, 3),
		);
		return geometry;
	}

	#photoFrame(photo, wall, column, half, z) {
		// The slot is 2 x 2 cells less the mat, and the image is fitted INSIDE
		// it: a 3:2 landscape takes the full width, a portrait the full height.
		// Never cropped, never stretched — the curation is the work.
		const slot = 2 * CELL - GRID.MARGIN;
		const ratio = (photo.width || 3) / (photo.height || 2);
		const w = ratio >= 1 ? slot : slot * ratio;
		const h = ratio >= 1 ? slot / ratio : slot;

		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(w, h),
			new THREE.MeshBasicMaterial({
				color: 0xffffff,
				side: THREE.FrontSide, // every plane already faces the axis
				transparent: true,
				opacity: 0,
				toneMapped: false, // the renderer is NoToneMapping: keep the values
			}),
		);
		mesh.quaternion.copy(basis(wall.normal, wall.up));
		// Centre of the 2-cell column, measured from the wall's low edge.
		const a = -half + (column + 1) * CELL;
		const off = half - GRID.INSET;
		mesh.position.set(
			wall.at[0] * off + wall.across[0] * a,
			wall.at[1] * off + wall.across[1] * a,
			z,
		);
		mesh.renderOrder = 2;
		mesh.visible = false;
		mesh.userData.photo = photo;
		mesh.userData.born = null;
		this.root.add(mesh);

		const texture = this.textures.get(photo.slug);
		if (texture) {
			mesh.material.map = texture;
			mesh.material.needsUpdate = true;
			mesh.userData.born = 0; // already paid for on a previous build
		}
		return { mesh, hover: 0 };
	}

	#clear() {
		for (const child of [...this.root.children]) {
			this.root.remove(child);
			child.geometry?.dispose();
		}
		this.lattice?.material.dispose();
		this.paperMaterial?.dispose();
		for (const { mesh } of this.frames) mesh.material.dispose();
		this.frames = [];
		this.hovered = null;
	}

	/* ------------------------------------------------------------ the photos */

	/**
	 * The index is not a texture: three kilobytes of JSON, same origin, baked
	 * at build time by tools/curation.mjs. Failing to read it leaves an empty
	 * tunnel — a page that still works, which is the whole reason the images
	 * are baked rather than pulled off Sanity's CDN at runtime.
	 */
	async #loadIndex() {
		try {
			const response = await fetch("/curation.json");
			if (!response.ok) return;
			const data = await response.json();
			if (!Array.isArray(data.photos) || data.photos.length === 0) return;
			this.photos = data.photos;
			this.dirty = true;
		} catch {
			/* an empty tunnel, and no noise in the console the shoot reads */
		}
	}

	/** Start pulling the textures. Called on idle, and by the loop past 0.3. */
	arm() {
		if (this.armed) return;
		this.armed = true;
		this.#loadTextures();
	}

	#loadTextures() {
		if (this.frames.length === 0) return;
		const loader = new THREE.TextureLoader();
		const anisotropy =
			this.context?.renderer?.capabilities.getMaxAnisotropy() ?? 1;
		for (const { mesh } of this.frames) {
			const photo = mesh.userData.photo;
			if (this.textures.has(photo.slug)) continue;
			this.pending++;
			loader.load(
				photo.src,
				(texture) => {
					texture.colorSpace = THREE.SRGBColorSpace;
					texture.anisotropy = anisotropy; // the walls are seen edge-on
					this.textures.set(photo.slug, texture);
					// A resize may have rebuilt the meshes since: look the slug
					// up rather than close over the plane that asked.
					for (const f of this.frames) {
						if (f.mesh.userData.photo.slug !== photo.slug) continue;
						f.mesh.material.map = texture;
						f.mesh.material.needsUpdate = true;
						f.mesh.userData.born = -1;
					}
					this.pending--;
				},
				undefined,
				() => {
					this.pending--;
				},
			);
		}
	}

	/* ------------------------------------------------------- the interaction */

	/** The photograph under a pointer given in NDC. Null outside the gallery. */
	pick(x, y) {
		if (this.fade <= 0.5 || this.frames.length === 0) return null;
		this.pointer.set(x, y);
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const hits = this.raycaster.intersectObjects(
			this.frames.filter((f) => f.mesh.visible).map((f) => f.mesh),
			false,
		);
		return hits[0]?.object ?? null;
	}

	setHover(mesh) {
		this.hovered = mesh;
	}

	/* ---------------------------------------------------------- the resize */

	/**
	 * The glyph is re-placed on a resize, so `s`, its matrix and the bore's
	 * whole world frame move. Mark the tunnel stale; it is rebuilt on the next
	 * frame that needs it, from a camera that is by then back on the plateau.
	 * The textures survive.
	 */
	onResize() {
		this.dirty = true;
	}
}
