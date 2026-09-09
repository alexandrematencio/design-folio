import * as THREE from "three";
import { clamp, lerp, smoothstep } from "../utils/utils";
import { JOURNEY, journeyH, progressPastExit, rideRate } from "./Scene";

/**
 * THE GALLERY — the Selected Works, hung in the corridor BEYOND the hole.
 *
 * A SECOND scene, drawn by the same renderer. Nothing is added to the logo's
 * scene, and nothing in the logo's scene knows this exists.
 *
 * THE SEAM IS A DOOR, NOT A DISSOLVE. The bore of the glyph is a square prism
 * one unit across (TUNNEL in Scene.js) and it stops at a plane. This corridor
 * starts EXACTLY at that plane and carries straight on: same origin, same
 * axis, same square section, same ride line, built in the glyph's own world
 * frame. The two never share a cubic inch, so there is nothing to fade. The
 * visitor rolls through cobalt, crosses a door, and rolls on through paper —
 * the matter changes where the geometry changes, and the camera never stops.
 *
 * WHICH IS WHY THE APPROACH IS DRAWN IN THE LOGO'S OWN Z-BUFFER, with the
 * logo's own render camera and no depth clear (Three.#render). From inside a
 * convex tube the corridor can only project INSIDE the exit rectangle, so it
 * replaces precisely what that rectangle used to show — the cyclorama — and
 * nothing else. The first cut of this file did the opposite: two tunnels in
 * the same volume, cross-faded, depth thrown away between the passes. That
 * cannot read as a passage, because it is a double exposure; the only thing
 * two coincident tunnels can agree on is their four edges, and everything
 * else (the exit's own hard border, the lattice printed over cobalt walls) is
 * a ghost. That whole apparatus — FADE, the wall crossfade, the clearDepth —
 * is gone.
 *
 * THE EXIT IS WHITE ON WHITE. Over the last OPEN of the trip the lattice goes
 * out and the corridor is nothing but paper. Then over the last VEIL of the
 * plateau the logo's scene is drawn UNDER it — its camera parked at the door,
 * facing the white cyclorama — while the paper's opacity falls to zero. Two
 * flat whites crossing: nothing on screen is moving, so the fact that the
 * camera holds still for that beat cannot be seen. Then the plateau ends and
 * the progress picks up again into the half-turn. Backwards it is the same
 * film: the paper rises, the lattice relights, the visitor reverses up the
 * corridor and back through the door into the cobalt.
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
	 * 0.003 moved the corridor's four edges 1.6 px off the cobalt bore's at
	 * the exit plane and more near the eye — measured — and this wall IS the
	 * cobalt one carried on, so any inset is a step in it at the door.
	 */
	INSET: 0.006,
};

/**
 * How far past the bore's exit plane the ride must stand, in bore widths, for
 * the door to count as crossed and the plateau to open. Small on purpose: at
 * 0.1 the conduit is behind the eye and the frame is all corridor, while the
 * traverse — which eases OUT on its end — still has 43 % of its cruise left to
 * hand over. Pushed to 0.2 the handover speed drops to 30 %, measured.
 */
const DOOR_OVER = 0.1;

/**
 * THE PLATEAU — the stretch of scroll where the orbit stands still and the
 * corridor runs. v2.html's spacer carries LOOP_VH + VH and core/Three.js maps
 * one onto the other (span() there); these are the numbers behind that map.
 *
 * PLATEAU is not a taste value, and no longer a hand-tuned one either: it is
 * the progress at which the journey's camera has CROSSED THE DOOR. Solved,
 * not guessed — progressPastExit inverts the traverse's own easing (Scene.js).
 * At DOOR_OVER = 0.1 that lands on progress 0.62748, h = 0.63328, where the
 * exit plane itself was crossed at h = 0.62691.
 *
 * VH follows from the corridor's length, not the other way round: it is 18
 * bore widths long, and 750vh of wheel spends ~41vh on each of them — against
 * ~57vh per bore width at the door and ~24vh mid-bore, so the corridor is a
 * road the conduit accelerates onto and then settles from. All 750 go to the
 * ride now; there is no entry fade left to pay for.
 */
export const GALLERY = {
	LOOP_VH: 1200, // what v2.html's spacer was before the plateau
	VH: 750, // what the plateau adds to it
	PLATEAU: progressPastExit(DOOR_OVER),
};

/** Fraction of the traverse the eye takes to leave the ride line, and to rejoin it. */
const RECENTRE = 0.1;
/** Fraction of the trip the corridor takes to reach its own cruise speed. */
const RAMP = 0.1;
/** Fraction of the trip over which the corridor opens out: the lattice goes. */
const OPEN = 0.1;
/** Fraction of the plateau the exit veil owns: paper dissolving into room. */
const VEIL = 0.06;
/** Brand rule: a hover zoom never passes 1.04, and never comes with a caption. */
const HOVER_SCALE = 1.03;
/** Seconds a photograph takes to arrive once its texture is decoded. */
const ARRIVAL = 0.4;

const CELL = 1 / GRID.CELLS;
/** How far the camera travels between the two seams. A whole number of CELLs. */
const LENGTH = (GRID.LEAD + (GRID.ROWS - 1) * GRID.PITCH + GRID.TAIL) * CELL;

/**
 * THE SPEED AT THE DOOR, in fractions of LENGTH per unit of t — the corridor's
 * own units. This is not an ease anybody chose: it is C1 continuity across the
 * seam, converted.
 *
 * The conduit's ride runs at rideRate(PLATEAU) bore widths per unit of
 * PROGRESS. Below the plateau progress advances k per unit of raw scroll and t
 * advances 1/g, and k × g is exactly VH / LOOP_VH — so the conversion is that
 * ratio and a division by LENGTH, with the glyph's scale cancelling on both
 * sides. Measured here: 0.735, because TRAVERSE is easing out at the door.
 *
 * The corridor therefore STARTS slower than its own cruise and catches up over
 * RAMP. CRUISE is solved rather than set to 1, so that the ramp still delivers
 * exactly LENGTH over the plateau: get that wrong and the far seam moves,
 * which is the one place the periodicity of the lattice is load-bearing.
 */
const SEAM_SPEED =
	(rideRate(GALLERY.PLATEAU) * (GALLERY.VH / GALLERY.LOOP_VH)) / LENGTH;
/** ∫ of the ramp's smoothstep over the trip is 1 − RAMP/2; solve for area 1. */
const CRUISE = (1 - (RAMP / 2) * SEAM_SPEED) / (1 - RAMP / 2);

/**
 * Distance travelled, as a fraction of LENGTH, at position `t` on the plateau.
 * The integral of speed(t) = lerp(SEAM_SPEED, CRUISE, smoothstep(t / RAMP)),
 * in closed form: ∫₀ᵘ smoothstep = u³ − u⁴/2, scaled by RAMP, then a straight
 * run. travelOf(0) = 0 and travelOf(1) = 1 exactly, by the choice of CRUISE.
 */
const travelOf = (t) => {
	const u = Math.min(t / RAMP, 1);
	const area = RAMP * (u ** 3 - u ** 4 / 2) + Math.max(0, t - RAMP);
	return SEAM_SPEED * t + (CRUISE - SEAM_SPEED) * area;
};

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

		/**
		 * How this scene gets on screen THIS frame. Read by Three.#render.
		 *   "through" — the approach: the logo's camera, the logo's depth
		 *               buffer, no clear. Seen only through the exit hole.
		 *   "solo"    — the plateau: this camera, paper clear, no logo pass.
		 *   "veil"    — the exit: the logo's frame underneath, this over it.
		 *   "none"    — not drawn.
		 */
		this.pass = "none";
		/** True while a photograph in here is a link. See main-v2.js. */
		this.live = false;
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

		// The corridor is built from boreFrame() alone — no camera in it any
		// more — but the glyph is not placed yet at construction time, so the
		// world frame it hangs on does not exist. Build lazily, on the first
		// frame the corridor is actually asked for, which is now the approach
		// and no longer the plateau.
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
	update({ t, active }, delta, elapsed) {
		this.pass = "none";
		this.live = false;
		if (!this.source.glyph) {
			this.hovered = null;
			return;
		}

		/* ---- off the plateau: the approach, seen through the exit ---- */
		if (!active) {
			this.hovered = null;
			// t = 1 is the far side of the plateau: the veil has already put
			// the paper at zero and handed the frame back to the room. Drawing
			// the corridor there would flash it back for one step.
			if (t >= 1) return;
			const progress = this.source.progress;
			// The window. Below MORPH_IN the render camera is the ortho one
			// and the bore is not even lined up yet; above the plateau the
			// half-turn has begun. Outside it there is no pass at all, and
			// that is not tidiness: the corridor is 18 bore widths long, it
			// runs clean through the cyclorama, and from the orbit it would
			// be a white spear lying across the room.
			if (journeyH(progress) < JOURNEY.MORPH_IN[0]) return;
			if (progress > GALLERY.PLATEAU) return;
			if (this.dirty) this.#rebuild();
			if (!this.frame) return;
			// No camera work: this pass is drawn with the LOGO's render
			// camera, in the logo's depth buffer. See Three.#render.
			this.pass = "through";
			this.#paint(0, 0, delta, elapsed);
			return;
		}

		/* ---- on the plateau: the corridor is the picture ---- */
		const seam = this.source.perspCamera;
		if (!seam) return;
		if (this.dirty) this.#rebuild();
		const frame = this.frame;
		if (!frame) return;

		const travel = travelOf(t);
		// The exit veil: paper going transparent over the logo's own frame.
		const veil = smoothstep(clamp((t - (1 - VEIL)) / VEIL));
		this.pass = veil > 0 ? "veil" : "solo";
		// A photograph is a link only while the corridor IS the picture —
		// never through the door on the approach, where the cobalt occludes
		// it and a raycast against this scene alone would not know.
		this.live = veil <= 0;

		// The eye leaves the ride line for the centre of the corridor (the
		// Delphi framing) and comes back to it at the far end.
		const rise =
			frame.rideDrop *
			smoothstep(clamp(travel / RECENTRE)) *
			smoothstep(clamp((1 - travel) / RECENTRE));

		// DERIVED FROM THE SEAM, never rebuilt from scratch: at travel = 0 and
		// rise = 0 this reduces to the journey's own camera at the door, pose
		// for pose — and travelOf gives it the journey's SPEED there too, so
		// the handover shows up in neither position nor velocity.
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

		this.#paint(veil, travel, delta, elapsed);
	}

	#paint(veil, travel, delta, elapsed) {
		// The corridor opens out before it ends: the lines go, and what is
		// left is paper on every side — which is what makes the veil below a
		// fade between two flat whites instead of a cut.
		const open = smoothstep(clamp((travel - (1 - OPEN)) / OPEN));
		this.lattice.material.opacity = 0.5 * (1 - open) * (1 - veil);
		this.paperMaterial.opacity = 1 - veil;

		for (const frame of this.frames) {
			const state = frame.mesh.userData;
			// -1 means "the texture landed, stamp me on the next frame you
			// draw": the loader has no access to the scene's clock.
			if (state.born === -1) state.born = elapsed;
			const arrived =
				state.born == null ? 0 : clamp((elapsed - state.born) / ARRIVAL);
			frame.mesh.material.opacity = arrived * (1 - veil);
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
		// THE DOOR: the bore's exit plane, measured from its mouth. The
		// corridor starts here and not one cell earlier — that is the whole
		// change. There is a rung of the lattice exactly on it (2.5 is ten
		// CELLs), so the door reads as the section line it is.
		const zDoor = 2 * bore.halfLength;
		// Where the plateau opens: DOOR_OVER past the door, which is where
		// PLATEAU was solved for. Taken from the geometry rather than off the
		// live camera, so the corridor can be built on ANY frame — the
		// approach needs it long before the camera reaches the plateau.
		const zSeam = zDoor + DOOR_OVER;
		const zFrom = zDoor;
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

		// ONE material for all five, so the exit veil is one number. The
		// polygon offset stays, and its reason is unchanged: it lets the
		// lattice sit EXACTLY on the plane of the wall rather than a hair
		// inside it — the paper is pushed back in depth, the lines win. That
		// matters MORE now than it did under the crossfade, because the wall
		// this one continues is the cobalt bore's, and a lattice inset by a
		// hair would put a visible step in it at the door. Pushing the paper
		// back is also the right side of the tie AT the door: on the shared
		// edge the cobalt wins, so the seam is one line and not two.
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
		// whatever is behind — the clear colour on the plateau, the cyclorama
		// through the door on the approach. It sits past the fog, so it is
		// pure paper and never read as a wall.
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
		// the corridor its rate of travel. The phase is not free any more —
		// the run starts at the door, 2.5 bore widths from the mouth, which is
		// ten CELLs, so a rung lands exactly ON the door and the passage from
		// cobalt to paper is marked by a section line rather than by nothing.
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
		if (!this.live || this.frames.length === 0) return null;
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
