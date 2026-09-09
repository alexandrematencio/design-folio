import * as THREE from "three";
import { clamp, lerp, smoothstep } from "../utils/utils";
import { JOURNEY, journeyH, progressPastExit, rideRate } from "./Scene";
import { ArrowUp } from "lucide";
import { iconDataUrl } from "../utils/icon";

/**
 * THE GALLERY — the Selected Works, hung in the corridor BEYOND the hole.
 *
 * A SECOND scene, drawn by the same renderer. Nothing is added to the logo's
 * scene, and nothing in the logo's scene knows this exists.
 *
 * THE SEAM IS A DOOR, NOT A DISSOLVE. The bore of the glyph is a square prism
 * one unit across (TUNNEL in Scene.js) and it stops at a plane. This corridor
 * starts EXACTLY at that plane and carries straight on: same origin, same
 * axis, same square section, and the same ride line — which is the axis itself,
 * so the eye is concentric with both tubes from the parking spot to the far
 * end. Built in the glyph's own world frame. The two volumes never share a
 * cubic inch, so there is nothing to fade. The visitor rolls through cobalt,
 * crosses a door, and rolls on through paper — the matter changes where the
 * geometry changes, the camera never stops, and it never changes pace either:
 * the conduit holds its cruise through the doorway and the corridor is scaled
 * to that same speed (GALLERY.VH below).
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
 * THE EXIT IS WHITE ON WHITE. Over the last OPEN bore widths of the trip the
 * lattice goes out and the corridor is nothing but paper. Then over the last
 * VEIL the logo's scene is drawn UNDER it — its camera parked at the door,
 * facing the white cyclorama — while the paper's opacity falls to zero. Two
 * flat whites crossing: nothing on screen is moving, so the fact that the
 * camera holds still for that beat cannot be seen. Then the plateau ends and
 * the progress picks up again into the half-turn. Backwards it is the same
 * film: the paper rises, the lattice relights, the visitor reverses up the
 * corridor and back through the door into the cobalt.
 *
 * AND IT COMES RIGHT BEHIND THE LAST PHOTOGRAPH. The tail used to be six
 * cells — 1.5 bore widths of bare lattice after the last row, on top of the
 * half-width the last photographs need to slide out of the frame — and with
 * the veil that was 81vh of wheel between the last picture and the door, then
 * another screen of sky before the stair came back (see JOURNEY.SWEEP_EMPTY in
 * Scene.js for that half). A visitor who has just seen thirty-one pictures
 * does not want a corridor after them; they want out. TAIL is two cells now:
 * the last pair passes, the lattice opens out around it, and the paper is
 * already dissolving when the wall behind them is bare.
 *
 * Reference: the Delphi home (delphi-three.vercel.app) — a lattice of
 * LineSegments rather than a texture, photographs laid flat on four walls.
 * Adapted: paper #FAFAF8 rather than white, placement deterministic rather
 * than Math.random (the shoots have to be reproducible), aspect ratios kept.
 */

const PAPER = "#FAFAF8"; // brand --color-bg, the same one Scene.js uses
const LATTICE = "#B0B0B0"; // the reference's own grey, at half opacity
const INK = "#0A0A0A"; // brand --color-fg: the exit arrow is printed, not lit

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
	 * 625vh plateau, must not depend on when a fetch happens to land.
	 */
	ROWS: 16,
	/** Cells between two rows. 4 = one bore width: a square rhythm. */
	PITCH: 4,
	/** Cells from the seam pose to the first row, and past the last one. */
	LEAD: 6,
	/**
	 * Short on purpose — see THE EXIT above. A photograph is two cells wide,
	 * so two cells past the last row's CENTRE is one bore width of wall past
	 * its far edge, of which the veil below owns most.
	 */
	TAIL: 2,
	/** A photograph gets 2 x 2 cells less this mat, in bore units. */
	MARGIN: 0.1,
	/**
	 * THE EXIT ARROW, printed on the floor after the last row: cells past the
	 * last row's centre to the arrow's centre. The floor is free there (the
	 * last row hangs on the ceiling and the +x wall), so it reads on its own,
	 * pointing down the axis at the door out. Two cells is the end of the
	 * trip itself: the arrow lies under the eye when the ride stops, and is
	 * seen from a bore width and a half back — where the last pictures are
	 * still passing, which is exactly when "there is an out" is worth saying.
	 */
	ARROW_AT: 2,
	/** Pixels the arrow is rasterised at; it is seen at a grazing angle. */
	ARROW_PX: 256,
	/** Bore widths of tunnel kept beyond the far seam, so the fog closes it. */
	AHEAD: 8,
	/**
	 * Bore widths: where the lattice starts washing out, and where it is gone.
	 * Measured from the EYE on the plateau, and from the DOOR on the approach —
	 * see #fogFrom for why those are the same band.
	 */
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

const CELL = 1 / GRID.CELLS;
/** How far the camera travels between the two seams. A whole number of CELLs. */
const LENGTH = (GRID.LEAD + (GRID.ROWS - 1) * GRID.PITCH + GRID.TAIL) * CELL;

/**
 * THE PLATEAU — the stretch of scroll where the orbit stands still and the
 * corridor runs. v2.html's spacer carries LOOP_VH + VH and core/Three.js maps
 * one onto the other (span() there); these are the numbers behind that map.
 *
 * PLATEAU is not a taste value, and no longer a hand-tuned one either: it is
 * the progress at which the journey's camera has CROSSED THE DOOR. Solved, not
 * guessed — progressPastExit inverts the traverse's own pacing (Scene.js). At
 * JOURNEY.DOOR_OVER = 0.1 that lands on progress 0.63388, h = 0.64279, which
 * is exactly the knee where the traverse stops cruising and starts braking.
 *
 * VH IS SOLVED TOO, and it is the whole of the second pass. The corridor is 17
 * bore widths long; the conduit crosses the door at RIDE_RATE, its own cruise;
 * so the plateau must be worth LOOP_VH × LENGTH / rideRate(PLATEAU) = 592.5vh
 * of wheel for the corridor to run at that same speed. 592 is that number
 * rounded to something a human can put in an HTML attribute, and it leaves the
 * corridor 0.1 % faster than the conduit at the door — far under one step of
 * the flow gauge. It used to be 750, and the corridor then started 26 % slow
 * and spent a tenth of the trip catching up; then 625 for the 18-width run
 * before the tail was cut.
 */
export const GALLERY = {
	LOOP_VH: 1200, // what v2.html's spacer was before the plateau
	VH: 592, // what the plateau adds to it — solved, see above
	PLATEAU: progressPastExit(JOURNEY.DOOR_OVER),
};

/**
 * The last stretch of the corridor, in BORE WIDTHS and not in fractions of the
 * trip: the trip got shorter when the tail was cut, and these two beats are
 * paced by what the eye is passing, not by how long the whole run is.
 *   OPEN  — the corridor opens out: the lattice goes over the last bore width,
 *           which is the one the last row hangs in. The exhibition ends and the
 *           room widens around it.
 *   VEIL  — the paper dissolves into the room's own frame. Three quarters of a
 *           width: 26vh of wheel, and it starts where the last side-wall
 *           picture has just left the frame edge (a picture on a wall at 0.5
 *           lateral leaves a 55°/16:9 frame 0.54 widths ahead of the eye).
 * Both are converted to fractions of `travel` here, once.
 */
const OPEN = 1 / LENGTH;
const VEIL = 0.75 / LENGTH;
/** Brand rule: a hover zoom never passes 1.04, and never comes with a caption. */
const HOVER_SCALE = 1.03;
/** Seconds a photograph takes to arrive once its texture is decoded. */
const ARRIVAL = 0.4;

/**
 * THE SPEED AT THE DOOR, in fractions of LENGTH per unit of t — the corridor's
 * own units. Nobody chose it and nothing eases it any more: the conduit holds
 * its cruise through the doorway, VH is solved so the corridor holds the same
 * one, and the trip is therefore travel = t, a straight run.
 *
 * The conduit's ride runs at rideRate(PLATEAU) bore widths per unit of
 * PROGRESS. Below the plateau progress advances k per unit of raw scroll and t
 * advances 1/g, and k × g is exactly VH / LOOP_VH — so the conversion is that
 * ratio and a division by LENGTH, with the glyph's scale cancelling on both
 * sides. It is kept, and checked out loud, because it is the one number that
 * says the two roads are one road: three constants in two files have to agree
 * for it to be 1, and none of them knows about the other two.
 */
const SEAM_SPEED =
	(rideRate(GALLERY.PLATEAU) * (GALLERY.VH / GALLERY.LOOP_VH)) / LENGTH;
if (import.meta.env.DEV && Math.abs(SEAM_SPEED - 1) > 0.02) {
	// A warning rather than a note in a README: tools/shoot.mjs fails the run
	// on any console noise, so this is an assertion with a shorter fuse.
	console.warn(
		`gallery: the corridor runs at ${SEAM_SPEED.toFixed(3)}x the conduit's ` +
			"speed at the door — GALLERY.VH and the ride's cruise have drifted apart",
	);
}

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
		this.arrow = null;
		/** The arrow's texture, kept across rebuilds like the photographs'. */
		this.arrowTexture = null;
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
			// camera, in the logo's depth buffer. See Three.#render. The fog,
			// though, is hung on the door and not on that camera — #fogFrom.
			this.#fogFrom(this.#shortOfDoor(this.source.renderCamera));
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
		this.#fogFrom(0); // the eye is through: the band rides the eye again

		// travel = t: the corridor is the conduit's road at the conduit's speed,
		// so there is nothing between the wheel and the distance (SEAM_SPEED).
		const travel = t;
		// The exit veil: paper going transparent over the logo's own frame.
		const veil = smoothstep(clamp((t - (1 - VEIL)) / VEIL));
		this.pass = veil > 0 ? "veil" : "solo";
		// A photograph is a link only while the corridor IS the picture —
		// never through the door on the approach, where the cobalt occludes
		// it and a raycast against this scene alone would not know.
		this.live = veil <= 0;

		// DERIVED FROM THE SEAM, never rebuilt from scratch: at travel = 0 this
		// IS the journey's own camera at the door, pose for pose — and it runs
		// at the journey's SPEED there too, so the handover shows up in neither
		// position nor velocity, at either end. Nothing lifts the eye any more:
		// the ride line is the axis on both sides of the door (RIDE_DROP there),
		// so the camera is already in the middle of the square when it arrives
		// and there is no height to adjust once inside. There used to be a
		// recentring here over the first tenth of the trip, and it was the one
		// move you could catch the corridor making.
		this.camera.position
			.copy(seam.position)
			.addScaledVector(frame.axisDir, travel * LENGTH * frame.s);
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
		// The arrow outlives the lattice (it is the one thing the opened-out
		// corridor still says) and goes with the paper under the veil.
		if (this.arrow) {
			this.arrow.visible = Boolean(this.arrowTexture);
			this.arrow.material.opacity = 1 - veil;
		}

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

	/**
	 * THE FOG IS HUNG ON THE DOOR WHILE THE EYE IS STILL OUTSIDE. Three's fog
	 * is a distance from the camera, and on the approach the camera stands
	 * between four and eight bore widths short of the door: measured from
	 * there the whole corridor sat past FOG[1], and the exit rectangle was a
	 * sheet of paper from the park until the ride was halfway down the bore
	 * (progress 0.55). The visitor drove at a hole that promised nothing.
	 *
	 * So the band slides out by the eye's distance to the door: the corridor
	 * fogs as if seen FROM the door, and the lattice and the first rows show at
	 * the far end of the cobalt tube from the moment the perspective opens.
	 * The slide runs out exactly at the door, where the band is the plateau's
	 * own again — the same numbers, so there is no seam, in either direction.
	 *
	 * @param {number} short  bore widths the eye stands short of the door; 0 inside
	 */
	#fogFrom(short) {
		const s = this.frame.s;
		this.scene.fog.near = (short + GRID.FOG[0]) * s;
		this.scene.fog.far = (short + GRID.FOG[1]) * s;
	}

	/** How far short of the door an eye stands, in bore widths. Zero once past. */
	#shortOfDoor(camera) {
		if (!camera) return 0;
		const { s, axisDir, zDoor } = this.frame;
		const door = this.root.position.clone().addScaledVector(axisDir, zDoor * s);
		return Math.max(0, door.sub(camera.position).dot(axisDir) / s);
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
		const zSeam = zDoor + JOURNEY.DOOR_OVER;
		const zFrom = zDoor;
		const zTo = zSeam + LENGTH + GRID.AHEAD;

		this.frame = { s, axisDir: bore.axisDir, zSeam, zDoor };

		this.root.position.copy(bore.origin);
		this.root.quaternion.copy(bore.quaternion);
		this.root.scale.setScalar(s);
		this.#fogFrom(0);
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

		/* ---- the way out, printed on the floor after the last row ---- */

		this.arrow = this.#floorArrow(
			half,
			zSeam + (GRID.LEAD + (GRID.ROWS - 1) * GRID.PITCH + GRID.ARROW_AT) * CELL,
		);
	}

	/**
	 * lucide's ArrowUp, ink on nothing, laid flat on the floor with the same
	 * basis as a floor photograph — its up is +z, so "up" on the icon is down
	 * the corridor, toward the door out. Sized like a photograph (two cells
	 * less the mat). The texture is a data URL of the SVG rasterised at
	 * ARROW_PX, decoded once and kept across rebuilds; until it lands the
	 * plane is simply not drawn.
	 */
	#floorArrow(half, z) {
		const floor = WALLS[0];
		const size = 2 * CELL - GRID.MARGIN;
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(size, size),
			new THREE.MeshBasicMaterial({
				color: 0xffffff,
				side: THREE.FrontSide,
				transparent: true,
				opacity: 0,
				toneMapped: false,
				depthWrite: false, // ink on the paper, never a lid over it
			}),
		);
		mesh.quaternion.copy(basis(floor.normal, floor.up));
		mesh.position.set(0, -half + GRID.INSET, z);
		mesh.renderOrder = 2;
		mesh.visible = false;
		this.root.add(mesh);

		if (this.arrowTexture) {
			mesh.material.map = this.arrowTexture;
			mesh.material.needsUpdate = true;
		} else {
			const px = GRID.ARROW_PX;
			new THREE.TextureLoader().load(
				iconDataUrl(ArrowUp, { width: px, height: px, stroke: INK }),
				(texture) => {
					texture.colorSpace = THREE.SRGBColorSpace;
					texture.anisotropy =
						this.context?.renderer?.capabilities.getMaxAnisotropy() ?? 1;
					this.arrowTexture = texture;
					// A resize may have rebuilt the mesh since: bind to the
					// current one, whichever it is.
					if (this.arrow) {
						this.arrow.material.map = texture;
						this.arrow.material.needsUpdate = true;
					}
				},
			);
		}
		return mesh;
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
		this.arrow?.material.dispose();
		this.arrow = null;
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
