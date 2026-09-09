import * as THREE from "three";

import WebGLContext from "../core/WebGLContext";
import HtmlToCanvas from "../utils/HtmlToCanvas";
import { collectDocumentCss } from "../utils/collectDocumentCss";
import { createProjector } from "../utils/ProjectedMaterial";
import { patchGlyphMaterial } from "../utils/GlyphMaterial";
import { attachLightBake } from "../utils/glyphLightBake";
import { loadGltf, firstMesh } from "../utils/ImportGltf";
import { createStudioEnvironment } from "../utils/studioEnvironment";
import { ORBIT, orbitPose, facingSteps, clamp, lerp, smoothstep } from "../utils/utils";

/* --------------------------------------------------------------- constants */

const PAPER = "#FAFAF8"; // brand --color-bg
const COBALT = "#0013FF"; // brand --color-accent

/**
 * The third value of the logo, and the only one that is not already a brand
 * token: `#2E3191` at 30 % over the paper. Read straight off the first path of
 * public/glyph-alxmtnc.svg, which fills the wedge under the bottom step with
 * it. On pure white it composites to rgb(192, 193, 222); on our #FAFAF8, to
 * this. It wants a name in the brand book — proposed, not taken.
 */
const BOUNCE = "#BDBED9";

const MODEL = "glyph-alxmtnc-3d-v2";

/**
 * TWO PAGES, TWO INKING RULES.
 *
 * "two-tone" is index.html: vertical faces cobalt, horizontal faces paper,
 * white treated as a colour of the object. It is 99.1 % right and it is the
 * version that shipped.
 *
 * "one-material" is v2.html, and it is the rule the mark was actually drawn
 * with. The solid is cobalt everywhere. White is not paint, it is the faces
 * that take the most light, blown past clipping; the pale wedge is the one
 * face sealed off from the room, carrying only what bounces off the floor.
 *
 * Both pages use the SAME lights, at the same intensities, and they have to:
 * the room IS the paper, the paper is #FAFAF8 by definition, so the exposure
 * of the room is not a free parameter. What changes is what reaches the glyph.
 *
 * Cobalt's blue channel is 1.0 — #0013FF is an ink value on paper, and as an
 * albedo it is already at the ceiling. So any irradiance over unity pins every
 * face of the solid to the same blue and the object comes out as a sticker
 * with no modelling anywhere, which is exactly what the first version did. The
 * flood was the environment: the studio ceiling has to sit far above 1 for a
 * tread to clip white, and three pours that same map into the diffuse. Cut the
 * environment's diffuse and the ordinary lights are back in charge; the
 * brightest riser lands on the ink value on its own, everything else falls
 * below it, and the modelling lives in that gap.
 */
const SHADING = {
	"two-tone": {
		hemisphere: 1.9,
		key: 2.3,
		fill: 0.4,
		env: {},
		glyph: { bounce: null },
	},
	"one-material": {
		hemisphere: 1.9,
		key: 2.3,
		fill: 0.4,
		// The room now has a FLOOR, and a bright one: it is what the pale
		// wedge under the bottom step is a reflection of. It can sit far
		// above the horizon value only because the shader gates who may show
		// it — ungated, every step front mirrors that same floor at the rest
		// angle (measured: 100 % of their area) and the logo washes to
		// lavender. The horizon stays dim for the same reason it always was:
		// any sheen there lies flat across a whole riser and reads as grey
		// veil, not as polish.
		env: { horizon: 0.12, floor: 10 },
		glyph: {
			bounce: BOUNCE,
			// The ceiling as a lamp, gated per vertex by the baked sky
			// visibility: the risers keep it, the pocket never sees it.
			envDiffuse: 0.05,
			// The diffuse half of the white floor, per vertex via aGroundVis.
			// The specular half is the floor's mirror image in the shader.
			groundBounce: 0.3,
		},
	},
};

/**
 * The camera is ORTHOGRAPHIC, and that is the load-bearing decision of this
 * file. brand/3d/README.md establishes that glyph-alxmtnc.svg is not a drawing
 * in an isometric style but the exact orthographic projection of this solid
 * along (1, 1, 1). A perspective camera, at any focal length, converges the
 * parallel edges and the logo stops being the logo. Ortho is the only camera
 * that reproduces the vector file rather than resembling it.
 *
 * It buys a second thing, which matters once the camera starts travelling: the
 * page lands on the cyclorama at 1:1 whatever the distance, and a curved wall
 * costs nothing, because parallel rays do not care how far away a surface is
 * or which way it leans. The page is undistorted at rest on a curved wall.
 *
 * VIEW_HEIGHT is the world height of the frustum at zoom 1: the unit in which
 * every layout number below is expressed.
 */
const VIEW_HEIGHT = 10;
const CAM_DISTANCE = 60;
const ISO_AXIS = new THREE.Vector3(1, 1, 1).normalize();
const TARGET = new THREE.Vector3(0, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * The glyph's INKED box under the rest camera, at scale 1, in camera space.
 * Measured, not guessed: `python3 tools/measure-glyph-ink.py`.
 *
 * It is not the bounding box of the solid, and the difference is not small.
 * On a white page the treads are white too and vanish into the paper — what
 * reads as the logo is the cobalt risers alone, which is exactly the inking
 * rule of the 2D file, where no horizontal face is ever inked. Silhouette:
 * 4.586 x 4.678, ratio 0.980. Ink: 4.581 x 4.268, ratio 1.073. Size on the
 * silhouette and the logo lands 9 % short and visibly off-centre.
 *
 * That 1.073 is also the proof the camera is the right one: the SVG is
 * 559 x 521 = 1.07294. The same tool renders the mesh with hidden-surface
 * removal and overlays it on the vector file — 99.107 % pixel IoU, ratio
 * within 0.031 %. The logo on screen is the logo, not something like it.
 */
const GLYPH_INK = {
	width: 4.58105,
	height: 4.26764,
	centerX: -0.0026,
	centerY: -0.40425,
};

/**
 * ONE glyph. It is the logo, and it is the anamorphic form, and it is the
 * thing the camera turns around — the same object doing all three jobs. A
 * second, smaller copy of the mark in the frame read as a duplicate, which is
 * what it was.
 *
 * x / y are NDC (-1 .. 1, y up); heightFraction is a share of the viewport
 * height measured on the INK; depth is world units toward the camera. It is
 * never rotated: there is one angle in this scene and it belongs to the SVG.
 */
const LAYOUT = {
	wide: { x: 0.44, y: 0.06, heightFraction: 0.52, depth: 0 },
	// On a phone the copy runs the full measure, so the glyph has nowhere
	// sideways to go and has to clear the text vertically instead.
	narrow: { x: 0.18, y: 0.4, heightFraction: 0.3, depth: 0 },
};

const NARROW_BREAKPOINT = 900;

/**
 * The room, in units of the glyph's own bounding box so it scales with it.
 *
 * A cyclorama rather than a backdrop, because the camera now goes all the way
 * around: a flat wall would turn edge-on at a quarter turn and leave the
 * visitor in a void. Radius is generous — the page prints on it at 1:1
 * whatever the distance, so the only thing radius changes is how much room
 * there is to move.
 */
const ROOM = {
	radius: 5.2, // × the glyph's bbox width
	cove: 0.42, // × the radius — the curve that kills the floor/wall seam
	// Tall out of all proportion, on purpose: the cylinder is open at the top
	// (a cap would be a ceiling, and the whole lighting rule is that the
	// ceiling is a reflection rather than a surface), so its rim must never
	// reach the frame. At 9× it cut a grey band across the top of a phone.
	height: 30, // × the glyph's bbox height
};

/**
 * The three step fronts, in the mesh's own coordinates, measured off the .glb.
 * All three face +X, one unit tall and 2.5 deep, stepping down as x grows.
 * Kept here so a future menu can anchor DOM to them — see stepAnchors().
 */
const STEP_FRONTS = [
	{ id: "step-1", point: [0, 1, 0] },
	{ id: "step-2", point: [1, 0, 0] },
	{ id: "step-3", point: [2, -1, 0] },
];

/**
 * Centre of each step's TREAD, the white top the dive enters through. Same
 * order as STEP_FRONTS. Measured on the .glb like everything else: tread k
 * spans one unit of x behind its front, two units of z.
 */
const STEP_TREADS = [
	[-0.5, 1.5, 0],
	[0.5, 0.5, 0],
	[1.5, -0.5, 0],
];

/**
 * The dive, in seconds and in shape. Every curve below is read off ONE
 * clock, and nothing is integrated: the dive is a pure function of that
 * clock, which is what lets the browser's back button run it backwards
 * (see rewindDive). Three curves off that clock:
 * the camera converges on "hovering over the chosen tread, facing straight
 * down" early (CONVERGE), the plunge of the zoom runs late (PLUNGE), and the
 * caller fades its veil over the very end. The zoom target is what makes the
 * entry read: the tread is 1 x 2 units of glyph space and the frustum is 10
 * units tall, so past zoom ~8 the white top is ALL there is on screen — the
 * stair has swallowed the frame before the veil finishes the hand-off.
 */
const DIVE = {
	SECONDS: 2.1,
	CONVERGE: 0.62,   // fraction of the clock the arc to overhead takes
	PLUNGE_FROM: 0.34,
	LEAN_IN: 1.35,    // gentle forward zoom during the arc, before the plunge
	ZOOM_END: 15,
};

/**
 * THE TUNNEL — the missing rectangular prism at the foot of the stair,
 * measured off the .glb: x in [-1, 0], y in [-1.5, -0.5], running the full
 * depth z in [-1.25, 1.25], open at both ends. Its +X wall is the pale wedge
 * itself. This is the hole the end of the scroll loop passes through.
 */
const TUNNEL = {
	centre: [-0.5, -1, 0],
	halfLength: 1.25, // along z, the axis of the bore
	bore: 1, // the square cross-section, both width and height
};

/**
 * THE JOURNEY THROUGH THE HOLE, progress JOURNEY.FROM .. JOURNEY.TO — right
 * after the menu: line up with the bore's axis, drive in SEEING THE EXIT
 * DEAD AHEAD, thread the bore, and once out let the gaze settle on the mark
 * and stay there while the path spirals out and back onto the orbit.
 *
 * TO is not a taste value. The spiral ends looking at the mark from +Z — and
 * the orbit itself looks at the mark from +Z at azimuth 315 degrees, which
 * is progress 0.875. The tunnel is a SHORTCUT across the loop: it swallows
 * the far half of the orbit and hands the camera to the orbit's own pose.
 *
 * THE PERSPECTIVE INTERLUDE. The page's camera is orthographic by law (the
 * logo at rest IS the SVG), but ortho cannot say "I am advancing": moving
 * along the gaze changes nothing on screen, and an exit never grows. So for
 * the tunnel the render camera becomes a real eye — and the swap is
 * invisible because of one invariant: a perspective camera at distance
 * D = H / (2 tan(fov/2)) frames the SAME image as the ortho camera whose
 * frustum height is H, up to a parallax that dies with the fov. Every pose
 * in the interlude is derived from that formula (pos = focus − dir·D), so
 * squeezing tan(fov/2) to FOV_FLAT makes the perspective camera CONVERGE to
 * the ortho frame, and the handovers land on a seam of nothing. Entering,
 * fov grows while D rides in: depth pours into the picture as the mouth
 * approaches — the morph IS the drive. Leaving, it is the reverse played on
 * a pinned subject: fov drains while D recedes, the mark holds its size
 * while its perspective empties back into the isometric solid — a dolly
 * zoom that parks exactly on the orbit.
 *
 * THE PASSENGER TURN. After the exit the gaze sweeps (azimuth + elevation,
 * never a lerp of points — a target passing near the eye flips the view
 * however slowly it travels; paid for twice) from the road ahead onto the
 * mark, and then never leaves it. The position is DERIVED from the gaze:
 * pos = focus − dir·D, so as the direction sweeps, the camera arcs around
 * the subject by construction — the U-turn is not choreographed, it is the
 * geometry of looking.
 *
 * DRIVING MISS DAISY. Phases are sequential and every seam is a smooth flow
 * minimum — a breath at the gate, a breath at each mouth — never a cut: all
 * tracks ease with zero slope at their edges. The judge is not any curve in
 * world space but the OPTICAL FLOW: how much the image itself changes per
 * unit of scroll, measured by frame differencing over the whole loop
 * (tools/flow.mjs). World-space metrics passed while the picture lurched;
 * only the picture knows.
 *
 * Everything remains a PURE FUNCTION of the scroll: no state, no
 * integration; scroll backward and the film plays in reverse for free.
 */
export const JOURNEY = {
	FROM: 0.2, // the leg begins here — just past the menu's fade window
	TO: 0.875, // and ends ON the orbit: azimuth 315, the +Z side. Geometry.
	// Phases, fractions of the leg. Sequential on purpose (see above).
	// ALIGN is the longest phase and has to be: it walks SIXTY world units
	// down from the orbit to the parking spot on the axis. At 0.2 of the leg
	// the bezier's midpoint ran 2.6x the orbit's speed and the room streamed
	// (6x cruise on the gauge); at 0.3, with the park pulled closer, it sits
	// inside the budget.
	ALIGN: [0, 0.3], // ortho: leave the orbit, swing onto the bore's axis
	MORPH_IN: [0.3, 0.44], // depth pours in while the mouth rolls closer
	// TRAVERSE is wide because the walls are at 0.4 units: the gauge put
	// the in-bore speed budget at ~0.1 world unit per step, and the ride is
	// six units long. Every narrower cut flashed the walls at 5-8x cruise.
	TRAVERSE: [0.44, 0.66], // through the bore, the exit growing dead ahead
	// UNIFORM pacing on the exit, and that is a measured lesson: the stair
	// transits the frame EARLY in this sweep (at close range it is huge — it
	// arrives a quarter turn in, not at the end), so a fast-early ease
	// slammed it through at 21x cruise. Uniform, over a window this wide,
	// the transit rides just under cruise x3 and the white beat after the
	// exit stays a breath (~4 % of the loop).
	SWEEP: [0.66, 0.96], // passenger: gaze road -> live orbit gaze — starts
	// exactly where TRAVERSE ends: an overlap popped the position (the two
	// formulas disagree mid-phase; they only meet at the boundary).
	//
	// MORPH_OUT is DELIBERATELY EARLY AND SHORT: the perspective drains
	// right after the exit — the Hitchcock beat plays before the head
	// turns — so that by the time the sweep passes the stair, D is
	// enormous and "turning the gaze" IS orbiting the mark at cruise speed
	// (pos = focus − dir·D: at near-flat fov the sweep is the orbit's own
	// kind of move). Sweeping while still close was tried on both flanks:
	// the stair crossed the frame at 23x and 33x cruise — at two units and
	// 55 degrees there IS no gentle transit. And the recede cannot follow
	// the road backwards (that line goes back through the bore: 28x): the
	// PITCH scoop below lifts the camera over the solid instead.
	// As wide as the entry morph, and it has to be: both cross the same
	// 4.8 nats of perspective, but on the way out the solid sits huge and
	// OFF the focus plane, so every nat moves it. At 0.10 of the leg the
	// drain ran 6-15x cruise; at 0.20 it breathes.
	MORPH_OUT: [0.66, 0.88], // fov drain + frame growth + crane, together —
	// delaying the frame growth to keep the shot tight through the transit
	// was measured WORSE (8x): D = H/(2k), so a small H holds the camera
	// close exactly when distance is what softens the transit.
	// The crane is POSITIONAL: a pure vertical bump on the derived path,
	// zero at both edges. Steering the camera up through the gaze (a
	// down-pitch scoop) was tried at two strengths: altitude scales with D,
	// which is still small when clearance is needed most — the camera
	// grazed the treads at 10x, then swept them at 21x. The lift buys the
	// clearance directly and the gaze never deviates from its own smooth
	// schedule.
	LIFT: 4, // x s: crane height over the derived path during the drain
	PUSH: 2, // x s: the crane also drifts FORWARD (+Z is guaranteed clear
	// air) while it climbs — climbing straight up crossed the bottom
	// step's back edge at 1.3 units, one 5.8x step on the gauge
	LAND: 0.96, // nothing left to do: the picture IS the live orbit's
	// The gaze blend must be DONE when the morph starts: its target rides
	// the camera, and the morph teleports the camera down the axis (free in
	// ortho) — an unfinished blend would re-aim through the teleport. Paid:
	// an 8x flow spike at the seam before the window was pinned to ALIGN's.
	GAZE_IN: [0.04, 0.3], // direction: mark -> road ahead, ends WITH the align
	STITCH: 0.05, // of the leg: float-level slerp onto the live orbit gaze
	FOV: 55, // deg — the eye, once the interlude is fully perspective
	FOV_FLAT: 0.5, // deg — where perspective ≈ ortho and the swap is free
	// THE EYE RIDES ON THE AXIS. It used to sit 0.15 below it, so that the
	// vanishing point rode above the road the way it does in a car. That was
	// right for a road and wrong for THIS one: the corridor beyond the door is
	// the same square section carried on, so an eye off the axis is an eye off
	// centre in a frame whose whole subject is a square — and it has to come
	// back to the middle at some point, which is a height adjustment the
	// visitor sees. At zero the park, the mouth, the traverse, the door and the
	// corridor are all CONCENTRIC, and there is nothing left to recentre.
	// Kept named rather than folded away: it is a decision, not an accident.
	RIDE_DROP: 0,
	FRAME_MOUTH: 2.2, // frame height (x s) at the mouth, fully perspective
	LOOK: 1.8, // gaze lead along the axis (x s); also the spiral's start radius
	EXIT_OVER: 0.3, // how far past the exit plane the traverse rolls (x s)
	PARK: 6, // where ALIGN parks on the axis (local z units before the mouth)
};

const LEG = JOURNEY.TO - JOURNEY.FROM;

/** The leg's own clock, both ways. h runs 0..1 from JOURNEY.FROM to TO. */
export const journeyH = (progress) => (progress - JOURNEY.FROM) / LEG;
export const journeyProgress = (h) => JOURNEY.FROM + h * LEG;

/**
 * THE RIDE, WRITTEN ONCE — where the camera stands along the bore's axis
 * during TRAVERSE, in GLYPH-LOCAL units measured from the bore's CENTRE (so
 * the exit plane is +TUNNEL.halfLength and the mouth is -halfLength).
 *
 * #applyJourney lerps a world point between exactly these two ends, and
 * ride(z) is an affine map of z, so lerping the depth and lerping the point
 * are the same thing. It is spelled out here because the gallery needs to ask
 * two questions that used to have no owner — WHERE is the door crossed, and
 * HOW FAST is the camera going there — and a second copy of this arithmetic
 * would drift the day the easing is touched, which is exactly the seam where
 * the drift would show.
 */
export const traverseDepth = (h) => {
	const kMax = Math.tan((JOURNEY.FOV * Math.PI) / 360);
	const from = -TUNNEL.halfLength - JOURNEY.FRAME_MOUTH / (2 * kMax);
	const to = TUNNEL.halfLength + JOURNEY.EXIT_OVER;
	const [a, b] = JOURNEY.TRAVERSE;
	return lerp(from, to, smoothstep(clamp((h - a) / (b - a))));
};

/**
 * The progress at which the ride stands `over` bore widths PAST the exit
 * plane. Bisection rather than an inverted smoothstep: the depth is monotone
 * across TRAVERSE, forty halvings land on the float, and the day the easing
 * changes shape this keeps answering instead of quietly lying.
 */
export const progressPastExit = (over) => {
	const target = TUNNEL.halfLength + over;
	let [lo, hi] = JOURNEY.TRAVERSE;
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (traverseDepth(mid) < target) lo = mid;
		else hi = mid;
	}
	return journeyProgress((lo + hi) / 2);
};

/**
 * How fast the ride runs there, in bore widths per unit of PROGRESS. Central
 * difference, because TRAVERSE eases out on its end and the number that
 * matters at the door is the one the easing has left, not the cruise.
 */
export const rideRate = (progress) => {
	const e = 1e-4;
	const h = journeyH(progress);
	return (traverseDepth(h + e) - traverseDepth(h - e)) / (2 * e) / LEG;
};

/* The journey's small change, shared by the ride and by the banking. */

/** A phase window, eased with zero slope at both edges. Not clamped in v. */
const win = (v, [a, b]) => smoothstep(clamp((v - a) / (b - a)));
/** Compass angle of a direction. Increasing it turns the camera RIGHT. */
const azimuth = (v) => Math.atan2(-v.x, v.z);
const elevation = (v) => Math.asin(clamp(v.y / v.length(), -1, 1));
/** The inverse: a unit direction from azimuth and elevation. */
const heading = (az, el) =>
	new THREE.Vector3(
		-Math.sin(az) * Math.cos(el),
		Math.sin(el),
		Math.cos(az) * Math.cos(el),
	);
const bezier = (p0, p1, p2, p3, u) => {
	const v = 1 - u;
	return new THREE.Vector3()
		.addScaledVector(p0, v * v * v)
		.addScaledVector(p1, 3 * v * v * u)
		.addScaledVector(p2, 3 * v * u * u)
		.addScaledVector(p3, u * u * u);
};

/**
 * THE BANKING — the camera leans into its turns, the way a rail car leans on
 * its curve. It is not decoration: an eye that yaws hard while its up stays
 * bolted to the world reads as a machine panning. Lean it and the same move
 * reads as a body being carried through the turn.
 *
 * Two turns on this leg, and only two. ALIGN, where the bezier leaves the
 * orbit and swings onto the bore's axis; and SWEEP, the 166-degree passenger
 * turn after the exit. The bore itself is straight — heading is constant
 * through MORPH_IN and TRAVERSE — so the lean is exactly zero everywhere
 * inside the conduit, which is also why the corridor inherits a level horizon
 * at the door for free. The orbit has none either: it is the page at rest and
 * the rest pose must stay exact.
 *
 * THE LATERAL RATE IS THE HEADING RATE, and getting there cost a measurement.
 * A passenger feels v²κ, so the obvious form is speed × yaw rate — and it was
 * tried first, in world units. It cannot work HERE, and the reason is this
 * page's own trick: the interlude derives every position from pos = focus −
 * dir·D, so the camera's world speed is mostly the dolly zoom's D moving, and
 * D moving along the gaze is optically inert. Measured on the leg: 151 246
 * world units per unit of h at h = 0.30 (the ortho-to-perspective teleport,
 * invisible on screen) and 8 293 at h = 0.88 (the drain receding). Multiply
 * either by the yaw and the numbers stop describing the picture — the SWEEP
 * peaks at 385 000 against ALIGN's 1 403, so any A_REF that gives ALIGN a
 * visible lean pins the WHOLE sweep at MAX, a hard clamp under a tanh's
 * clothes, and a full −30° roll fires at h = 0.30, in the middle of a dead
 * straight approach. Using only the transverse component kills the h = 0.30
 * artefact but not the drain: still 73:1.
 *
 * So the ride is parameterised by SCROLL, and scroll is the arc length this
 * page measures everything in. With arc length as the parameter the speed is
 * 1 by definition and v²κ collapses to κ — the heading turned per notch of
 * wheel, which is exactly the curvature of the road the visitor is on.
 *
 * RATE IS THEN CALIBRATED, NOT CHOSEN. |d(heading)/dh| measured over the leg:
 * 0.000 everywhere inside the conduit (MORPH_IN and TRAVERSE hold a constant
 * heading — which is why the corridor inherits a level horizon at the door),
 * peak 8.655 rad in ALIGN at h = 0.26, peak 18.11 rad in SWEEP at h = 0.786.
 * RATE = 11 puts the sweep at 27.8 degrees and the align at 19.7 — the brief's
 * window on both counts. The signs come out opposite (ALIGN turns left, SWEEP
 * turns right), so the two leans mirror each other, which is the geometry
 * talking and not a choice.
 *
 * tanh rather than a clamp, deliberately: a clamp puts a corner in the roll at
 * the moment the turn saturates, and a corner in the roll is precisely the
 * thing this exists to remove.
 */
const BANK = {
	MAX: (30 * Math.PI) / 180,
	RATE: 11, // rad of heading per unit of h worth tanh(1) = 76 % of MAX
	EPS: 0.002, // of the leg: the central difference the rate is read on
	EDGE: 0.03, // of the leg: zero lean at both of the leg's own seams
};

/* ------------------------------------------------------------------- scene */

export default class Scene {
	constructor({ shading = "two-tone", journey = false } = {}) {
		this.shadingName = shading;
		this.shading = SHADING[shading];
		if (!this.shading) throw new Error(`unknown shading: ${shading}`);

		// v2 only: the tunnel leg of the loop, and the page fading by MEASURED
		// visibility instead of by a hand-tuned scroll window. index.html is
		// shipped and frozen; it never sets this and never changes.
		this.journey = journey;
		// World samples of the text block's footprint on the room, built once
		// the projection exists. Null until then, and on v1 forever.
		this.pageFootprint = null;
		// Scratch pose for the journey's orbit anchors. Never rendered.
		this.scratch = new THREE.Object3D();

		this.context = new WebGLContext();
		this.scene = null;
		this.camera = null;
		this.restCamera = null;
		// The tunnel's eye (v2). The render camera is which of the two draws
		// this frame: the ortho camera by default, the perspective one only
		// while the journey is in its interlude (see #applyJourney).
		this.perspCamera = null;
		this.renderCamera = null;

		this.width = 0;
		this.height = 0;
		this.aspectRatio = 1;

		// One shared uniform. The projected page and the glyph both read it,
		// so room and logo leave flatland on the exact same curve.
		this.litness = { value: 0 };
		// Tools only: shoot.mjs pins this to photograph the LIT skin at the
		// rest angle, where litness is normally 0 by definition.
		this.litnessOverride = null;
		// Fades the projected page off the room as the visitor travels away.
		this.pageOpacity = { value: 1 };

		this.projector = null;
		this.htmlToCanvas = null;
		this.projectedMeshes = [];
		this.glyph = null;
		this.cyclorama = null;
		this.progress = 0;

		// World point the camera turns about: the centre of the logo's ink.
		this.pivot = new THREE.Vector3();

		// The dive, when one is running: { t: 0..1, step, direction, done }.
		// Read by main-v2.js to drive the veil and the hand-off; direction is
		// -1 when the visitor is coming back. Null otherwise.
		this.dive = null;

		this.#init();
	}

	#init() {
		this.#measureViewport();
		this.#setupScene();
		this.#setupCameras();
		this.#addLights();
		this.#build();
	}

	#measureViewport() {
		const { width, height } = this.context.getFullScreenDimensions();
		this.width = width;
		this.height = height;
		this.aspectRatio = width / height;
	}

	#setupScene() {
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(PAPER);
	}

	#frustum(aspect) {
		const halfH = VIEW_HEIGHT / 2;
		return { halfW: halfH * aspect, halfH };
	}

	#setupCameras() {
		const { halfW, halfH } = this.#frustum(this.aspectRatio);
		const make = () =>
			new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 400);

		this.camera = make();
		this.restCamera = make();

		// The canonical view of brand/3d/README.md: on the (1,1,1) axis,
		// looking at the origin, default up. Nothing else gives the SVG back.
		for (const cam of [this.camera, this.restCamera]) {
			cam.position.copy(ISO_AXIS).multiplyScalar(CAM_DISTANCE).add(TARGET);
			cam.up.copy(WORLD_UP);
			cam.lookAt(TARGET);
			cam.updateMatrixWorld(true);
		}

		// fov, near and far are per-frame business during the interlude.
		this.perspCamera = new THREE.PerspectiveCamera(
			50,
			this.aspectRatio,
			0.05,
			1200,
		);
		this.perspCamera.up.copy(WORLD_UP);
		this.renderCamera = this.camera;

		// Rest basis, in world space. Every placement below is written in it.
		this.right = new THREE.Vector3().setFromMatrixColumn(
			this.restCamera.matrixWorld,
			0,
		);
		this.up = new THREE.Vector3().setFromMatrixColumn(
			this.restCamera.matrixWorld,
			1,
		);
		this.back = new THREE.Vector3().setFromMatrixColumn(
			this.restCamera.matrixWorld,
			2,
		);
	}

	/**
	 * Everything bright comes from above and nothing from below.
	 *
	 * That is not a taste call, it is what the glyph is made of. A tread
	 * mirrors the ceiling, a riser mirrors the floor; the white of the 2D logo
	 * is the studio ceiling seen in the treads, and the cobalt of the risers is
	 * the absence of anything to reflect downward. Put light under the horizon
	 * and the risers wash out to lavender and the mark stops reading as itself.
	 * (brand/3d/README.md, "Ce que ça impose au rig d'éclairage")
	 *
	 * WHERE THAT RULE IS TOO STRONG, and the vector file says so. The SVG has a
	 * third value in it: the wedge under the bottom step, `#2E3191` at 30 %,
	 * lighter than the cobalt around it. So there IS light from below in the
	 * drawing. The rule is right GLOBALLY and wrong LOCALLY — a rig with a
	 * bright floor washes every riser to lavender, which is how the rule was
	 * arrived at in the first place, but the one face sealed under the overhang
	 * is lit by the floor and by nothing else. A direction-only environment map
	 * cannot tell those two apart; it has no idea where a face IS, only which
	 * way it looks. That is what tools/bake-glyph-light.py supplies and what
	 * the "one-material" rule spends. The floor stays dark in the rig; the
	 * bounce is handed out per face.
	 *
	 * The white floor below is geometry, not light: three does no bounce, so it
	 * grounds the object without ever reaching the risers.
	 */
	#addLights() {
		// The correct form of "ambient" here: white above, black below. Plain
		// AmbientLight lights every direction equally, which IS the bright
		// floor the rule forbids — it was worth 0.55 and turned the treads
		// periwinkle. A near-black ground rather than pure black, so a face
		// pointing straight down is dark rather than a hole.
		this.scene.add(
			new THREE.HemisphereLight(0xffffff, 0x141414, this.shading.hemisphere),
		);

		this.key = new THREE.DirectionalLight(0xffffff, this.shading.key);
		this.key.position.set(18, 40, 20);
		this.key.castShadow = true;
		this.key.shadow.mapSize.set(2048, 2048);
		this.key.shadow.camera.near = 1;
		this.key.shadow.camera.far = 160;
		this.key.shadow.radius = 5;
		this.key.shadow.blurSamples = 16;
		this.key.shadow.bias = -0.0002;
		this.key.shadow.normalBias = 0.04;
		this.scene.add(this.key);
		this.scene.add(this.key.target);

		// Frontal and above the horizon: lifts the risers to full cobalt in
		// diffuse without handing them anything specular, since their mirror
		// direction points at a floor that does not exist.
		const fill = new THREE.DirectionalLight(0xffffff, this.shading.fill);
		fill.position.set(-16, 14, 30);
		this.scene.add(fill);
	}

	async #build() {
		// The environment is what a polished surface has to reflect. It is hung
		// on the GLYPH's material, not on scene.environment: the studio ceiling
		// has to sit far above 1 for a tread to clip white, and one scene-wide
		// environment that bright cooks the paper flat. Two surfaces that want
		// opposite exposures do not share one map. See studioEnvironment.js for
		// why it is built rather than loaded from the brand .hdr.
		this.studioEnv = createStudioEnvironment(this.shading.env);

		const base = import.meta.env.BASE_URL;
		const gltf = await loadGltf(`${base}models/${MODEL}.glb`);
		const source = firstMesh(gltf.scene);
		if (!source) throw new Error(`${MODEL}.glb has no mesh`);

		// How much of the room each face can see. Only the "one-material" rule
		// needs it, and only it pays for the fetch.
		if (this.shading.glyph.bounce) {
			await attachLightBake(source.geometry, `${base}models/${MODEL}.light.json`);
		}

		this.#addGlyph(source);
		this.#addRoom();
		this.#setupProjection();
	}

	/* ------------------------------------------------------------- objects */

	/** The logo, the anamorphic form and the axis of the orbit, all at once. */
	#addGlyph(source) {
		const material = source.material.clone();
		material.side = THREE.FrontSide;
		material.flatShading = true;
		// The studio, on this material only. Intensity stays at 1: the ceiling
		// carries the exposure, not the material. The dials that matter are
		// roughness 0.09 and clearcoat 0.55, and they arrive correct from the
		// .glb — brand/3d/README.md calls them "les deux molettes".
		material.envMap = this.studioEnv;
		material.envMapIntensity = 1;
		patchGlyphMaterial(material, {
			litness: this.litness,
			paper: PAPER,
			cobalt: COBALT,
			...this.shading.glyph,
		});

		const mesh = new THREE.Mesh(source.geometry, material);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		this.#place(mesh, this.#layout(), GLYPH_INK);

		this.scene.add(mesh);
		this.glyph = mesh;
		this.#updateRig();
	}

	#paperMaterial(side = THREE.FrontSide, colour = PAPER) {
		return new THREE.MeshStandardMaterial({
			color: new THREE.Color(colour),
			roughness: 1,
			metalness: 0,
			side,
		});
	}

	/**
	 * A photographic cyclorama: floor, cove and wall as ONE lathed surface, the
	 * infinity backdrop the mark was rendered in to begin with.
	 *
	 * It is what the page is printed on. At rest it is strictly invisible — the
	 * projection paints it with the very pixels the flat page would have shown
	 * there, and because the camera is orthographic the curve costs nothing:
	 * parallel rays land where they land, so the type is not bowed on a round
	 * wall. Turn, and it reveals itself as a room with the page printed on one
	 * arc of it.
	 *
	 * The cove is the reason it is lathed rather than a disc plus a cylinder. A
	 * floor faces up and takes the whole key light; a wall faces sideways and
	 * takes half of it. Butt them together and the seam reads as a hard grey
	 * bar across the frame — which is exactly what a real cyclorama's curve
	 * exists to prevent. Here it becomes a soft vertical gradient instead, and
	 * the room has a horizon without having an edge.
	 */
	#addRoom() {
		this.#disposeRoom();

		const box = new THREE.Box3().setFromObject(this.glyph);
		const size = box.getSize(new THREE.Vector3());
		const centre = box.getCenter(new THREE.Vector3());
		const radius = size.x * ROOM.radius;
		const height = size.y * ROOM.height;
		const cove = radius * ROOM.cove;

		// Profile in (radius, height), swept around Y: flat floor out to the
		// cove, a quarter turn up, then straight wall.
		const profile = [new THREE.Vector2(0, 0), new THREE.Vector2(radius - cove, 0)];
		const arcSteps = 24;
		for (let i = 1; i <= arcSteps; i++) {
			const t = (i / arcSteps) * (Math.PI / 2);
			profile.push(
				new THREE.Vector2(
					radius - cove + cove * Math.sin(t),
					cove - cove * Math.cos(t),
				),
			);
		}
		profile.push(new THREE.Vector2(radius, height));

		/*
		 * REVERSED, and this is the whole trick. LatheGeometry takes its
		 * normal from the profile's direction of travel, so run bottom-up and
		 * the floor faces DOWN and the wall faces OUT — an ordinary solid.
		 * Reversed, the normals point inward and upward: a room.
		 *
		 * Which matters because the camera is orthographic and therefore always
		 * OUTSIDE the cyclorama — the eye has to sit further off than the room
		 * is wide or the far half of it falls behind the near plane. So the
		 * near wall must be a back face and get culled, letting the eye through
		 * to the far wall's front face. DoubleSide would seal the room shut and
		 * render the outside of it: paper everywhere, and no logo at all.
		 */
		profile.reverse();

		// Open at the top, because a cap would be a ceiling and the whole
		// lighting rule is that the ceiling is a reflection, not a surface.
		const room = new THREE.Mesh(
			new THREE.LatheGeometry(profile, 96),
			this.#paperMaterial(),
		);
		room.position.set(centre.x, box.min.y, centre.z);
		room.receiveShadow = true;

		this.scene.add(room);
		this.cyclorama = room;
		this.projectedMeshes = [room];

		/*
		 * The shadow camera has to cover everything that RECEIVES, not only
		 * what casts. Fitted tightly to the glyph it looked right around the
		 * object and smeared across the rest of the room: outside the shadow
		 * map three clamps to the border texel, and VSM spreads that border.
		 * So: the room's own radius.
		 */
		this.key.target.position.copy(this.pivot);
		const shadow = this.key.shadow.camera;
		shadow.left = -radius;
		shadow.right = radius;
		shadow.top = radius;
		shadow.bottom = -radius;
		shadow.near = 1;
		shadow.far = radius * 6;
		shadow.updateProjectionMatrix();
	}

	#disposeRoom() {
		if (!this.cyclorama) return;
		this.scene.remove(this.cyclorama);
		this.cyclorama.geometry.dispose();
		this.cyclorama.material.dispose();
		this.cyclorama = null;
	}

	/* ------------------------------------------------------------ placement */

	#layout() {
		// <= so it flips on the same pixel as the stylesheet's max-width.
		return this.width <= NARROW_BREAKPOINT ? LAYOUT.narrow : LAYOUT.wide;
	}

	/**
	 * Scales an object to a share of the viewport height and drops it at an NDC
	 * point. `extent` is the box the fraction is measured against, in camera
	 * space at scale 1 — GLYPH_INK, so that "0.52 of the height" means 0.52 of
	 * the visible logo and not of a bounding box whose corners overshoot it.
	 */
	#place(mesh, { x, y, heightFraction, depth }, extent) {
		const { halfW, halfH } = this.#frustum(this.aspectRatio);
		const scale = (heightFraction * VIEW_HEIGHT) / extent.height;
		mesh.scale.setScalar(scale);

		mesh.position
			.copy(TARGET)
			.addScaledVector(this.right, x * halfW - extent.centerX * scale)
			.addScaledVector(this.up, y * halfH - extent.centerY * scale)
			.addScaledVector(this.back, depth);
		mesh.updateMatrixWorld(true);
	}

	/** The centre of the logo's ink, in world space. The camera turns on it. */
	#updateRig() {
		if (!this.glyph) return;
		const s = this.glyph.scale.x;
		this.pivot
			.copy(this.glyph.position)
			.addScaledVector(this.right, GLYPH_INK.centerX * s)
			.addScaledVector(this.up, GLYPH_INK.centerY * s);
		this.key?.target.position.copy(this.pivot);
	}

	/* ----------------------------------------------------------- projection */

	#setupProjection() {
		const page = document.getElementById("page");
		this.htmlToCanvas = new HtmlToCanvas(page, {
			width: this.width,
			height: this.height,
			pixelRatio: Math.min(window.devicePixelRatio, 2),
		});

		this.projector = createProjector({
			camera: this.restCamera,
			texture: this.htmlToCanvas.texture,
			litness: this.litness,
			pageOpacity: this.pageOpacity,
		});

		for (const mesh of this.projectedMeshes) this.projector.applyTo(mesh);
		this.projector.update();

		this.#rasterizePage();
	}

	async #rasterizePage() {
		// Wait for Inter, or the first frame is rasterized in Helvetica and
		// then silently reflows under the projection a moment later.
		if (document.fonts?.ready) await document.fonts.ready;

		if (!this.htmlToCanvas.extraCss) {
			this.htmlToCanvas.extraCss = await collectDocumentCss();
		}
		await this.htmlToCanvas.update();

		// The text's physical footprint follows the same layout the raster
		// just captured — rebuild it here so a resize moves both together.
		this.#buildPageFootprint();

		// Signals "the page is on the geometry". Used by tools/shoot.mjs, and
		// the honest hook for a loading state if one is ever wanted.
		document.documentElement.dataset.sceneReady = "true";
	}

	/* -------------------------------------------------------------- runtime */

	/**
	 * The orbit pose at any progress, written onto `out` — the render camera
	 * every frame, a scratch Object3D when the journey needs an anchor.
	 *
	 * A RIGID ROTATION OF THE CAMERA ABOUT THE GLYPH, not an orbit around
	 * the world origin. At progress 0 every term is zero, so this reduces to
	 * the identity and the render camera lands back on the projector's
	 * camera exactly — pose for pose, not approximately. That is what keeps
	 * the rest frame byte-identical to the page. Pivoting on the mark also
	 * pins the mark: the room turns around it, which is the right way round
	 * for a page whose subject is a logo.
	 *
	 * The final slide walks the glyph from its place in the page layout to
	 * the middle of the frame as the travel takes over: under an ortho
	 * camera a slide in its own plane is a pure translation of the image, so
	 * it composes with the rotation without disturbing it.
	 *
	 * Extracted from animate() so the journey can evaluate the SAME
	 * transform at arbitrary progress values: its stitches are anchored on
	 * the orbit's real poses and velocities, not approximations of them.
	 */
	#orbitCamera(progress, out) {
		const pose = orbitPose(progress);
		const { halfW, halfH } = this.#frustum(this.aspectRatio);
		const layout = this.#layout();

		const spin = new THREE.Quaternion().setFromAxisAngle(
			WORLD_UP,
			pose.azimuth,
		);
		const tiltAxis = this.right.clone().applyQuaternion(spin).normalize();
		const rotation = new THREE.Quaternion()
			.setFromAxisAngle(tiltAxis, pose.tiltDown)
			.multiply(spin);

		out.position
			.copy(this.restCamera.position)
			.sub(this.pivot)
			.applyQuaternion(rotation)
			.add(this.pivot);
		out.quaternion.copy(rotation).multiply(this.restCamera.quaternion);
		out.translateX(layout.x * halfW * pose.recentre);
		out.translateY(layout.y * halfH * pose.recentre);
		return pose;
	}

	animate(delta, elapsed, progress = 0) {
		this.progress = progress;
		const pose = this.#orbitCamera(progress, this.camera);
		if (this.camera.zoom !== pose.zoom) {
			this.camera.zoom = pose.zoom;
			this.camera.updateProjectionMatrix();
		}
		this.camera.updateMatrixWorld(true);

		this.litness.value = this.litnessOverride ?? pose.litness;

		this.renderCamera = this.camera;
		if (this.journey) this.#applyJourney(progress);
		this.#applyDive(delta);

		/*
		 * The page's opacity is decided LAST, off the camera every move above
		 * has finished with — the orbit, the tunnel, a dive, whatever is added
		 * next. On v2 the rule is physical: the text is on the room, so it is
		 * shown exactly as long as its footprint is in frame, and no scroll
		 * number anywhere decides otherwise. v1 keeps its calibrated window.
		 */
		this.pageOpacity.value = this.journey
			? this.#pageVisibility()
			: pose.pageOpacity;
	}

	/* ------------------------------------------------------------- the dive */

	/**
	 * Hand the camera over to an automatic entry into one of the steps.
	 *
	 * Called from the menu (main-v2.js), at the square-on pose, with the
	 * scroll already stopped: the orbit pose underneath is therefore frozen,
	 * and the blend below has a stable base to leave from. The camera rises a
	 * little, pitches over to face straight down at the chosen step's white
	 * tread, and then the zoom plunges — with an orthographic camera the
	 * "descent" IS the zoom, so the entry never clips the geometry, it
	 * swallows it. The caller watches this.dive.t to fade its veil and
	 * navigate; nothing here knows about destinations.
	 */
	startDive(step) {
		if (this.dive) return;
		this.dive = { t: 0, step, direction: 1, done: false };
	}

	/**
	 * The same move, played backwards — the browser's back button.
	 *
	 * This only works because #applyDive is a PURE FUNCTION of t: animate()
	 * rebuilds the whole orbit pose from the rest camera every frame before
	 * the dive is applied, so the dive never accumulates. Run t down instead
	 * of up and the camera retraces its own path exactly, back to the step
	 * view. Had the dive integrated its own state — a converging lerp toward
	 * the target, say — the return would have needed a second animation
	 * written by hand, and the two would have drifted apart on the first
	 * change to either.
	 *
	 * Called with no live dive (a fresh page load, the scroll parked at
	 * ORBIT.STEPS) it starts from the far end; called on a page restored from
	 * the back/forward cache it simply turns the running one around.
	 */
	rewindDive(step) {
		if (this.dive) {
			this.dive.direction = -1;
			this.dive.done = false;
			return;
		}
		this.dive = { t: 1, step, direction: -1, done: false };
	}

	/**
	 * Give the camera back to the scroll. Only ever called at t = 0, where the
	 * dive is the identity, so the hand-back is seamless by construction.
	 */
	endDive() {
		this.dive = null;
	}

	#applyDive(delta) {
		if (!this.dive || !this.glyph) return;
		const dive = this.dive;
		dive.t = clamp(dive.t + (delta / DIVE.SECONDS) * dive.direction);
		dive.done = dive.direction > 0 ? dive.t >= 1 : dive.t <= 0;

		const tread = new THREE.Vector3()
			.fromArray(STEP_TREADS[dive.step])
			.applyMatrix4(this.glyph.matrixWorld);

		// A RIGID ROTATION OF THE CAMERA ABOUT THE TREAD — the same move the
		// orbit itself is built from, so it inherits the same guarantee: at
		// zero it IS the frozen orbit pose, and the pivot point never moves
		// on screen while the camera swings overhead. The axis is the one
		// horizontal that takes the current gaze to the nadir in a single
		// forward somersault, no roll. (Both a pose lerp and a lookAt blend
		// were tried first; each let the stair drift out of frame mid-way.)
		const converge = smoothstep(clamp(dive.t / DIVE.CONVERGE));
		const plunge = smoothstep(
			clamp((dive.t - DIVE.PLUNGE_FROM) / (1 - DIVE.PLUNGE_FROM)),
		);

		const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
			this.camera.quaternion,
		);
		const down = new THREE.Vector3(0, -1, 0);
		const axis = new THREE.Vector3().crossVectors(forward, down).normalize();
		const somersault = new THREE.Quaternion().setFromAxisAngle(
			axis,
			forward.angleTo(down) * converge,
		);

		this.camera.position
			.sub(tread)
			.applyQuaternion(somersault)
			.add(tread);
		this.camera.quaternion.premultiply(somersault);
		this.camera.updateMatrixWorld(true);

		// The zoom is the entering — an orthographic camera has no "closer".
		// It magnifies about the screen centre, so the tread is walked there
		// DURING the somersault, while the zoom is still tame: recentre on
		// the plunge instead and it loses the race — the offset the
		// translation has not yet removed is multiplied by the very zoom
		// that follows it, and the tread rides the top edge of the frame
		// until the last tenth (measured: NDC y 1.13 mid-dive). By the end
		// of the arc it is dead centre, and the plunge magnifies in place.
		const inCamera = tread
			.clone()
			.applyMatrix4(this.camera.matrixWorldInverse);
		this.camera.translateX(inCamera.x * converge);
		this.camera.translateY(inCamera.y * converge);

		this.camera.zoom = lerp(
			lerp(this.camera.zoom, this.camera.zoom * DIVE.LEAN_IN, converge),
			DIVE.ZOOM_END,
			plunge * plunge,
		);
		this.camera.updateProjectionMatrix();
		this.camera.updateMatrixWorld(true);
	}

	/* ----------------------------------------------------------- the tunnel */

	/**
	 * THE BORE, IN WORLD SPACE — the one place that maths is written.
	 *
	 * #applyJourney built these lambdas inline; the gallery (scenes/Gallery.js)
	 * needs the very same frame, because its white corridor is the bore
	 * CONTINUED: same origin, same axis, same square section, same ride line,
	 * starting at the bore's exit plane and running on. Two copies of this
	 * arithmetic would drift the day either one is touched, and the door is
	 * exactly where that drift would show as a step in the wall.
	 *
	 * Lengths come back in GLYPH-LOCAL units (bore, halfLength) with `s`
	 * alongside; points come back in world.
	 */
	boreFrame() {
		if (!this.glyph) return null;
		const s = this.glyph.scale.x;
		const m = this.glyph.matrixWorld;
		const local = (x, y, z) =>
			new THREE.Vector3(
				TUNNEL.centre[0] + x,
				TUNNEL.centre[1] + y,
				TUNNEL.centre[2] + z,
			).applyMatrix4(m);
		// The ride line IS the bore's axis (RIDE_DROP is zero — see there for
		// why), so `mouth` and `origin` below are now the same point. They are
		// both kept because they answer different questions: where the eye
		// enters, and where the corridor hangs. That they coincide is the
		// whole of this pass — one axis, from the parking spot to the far end.
		const ride = (z) => local(0, -JOURNEY.RIDE_DROP, z);
		return {
			s,
			local,
			ride,
			axisDir: ride(1).sub(ride(0)).normalize(),
			mouth: ride(-TUNNEL.halfLength),
			origin: local(0, 0, -TUNNEL.halfLength),
			// Read off the matrix rather than assumed. The glyph carries no
			// rotation today; the day it does, the gallery follows for free.
			quaternion: new THREE.Quaternion().setFromRotationMatrix(
				new THREE.Matrix4().extractRotation(m),
			),
			bore: TUNNEL.bore,
			halfLength: TUNNEL.halfLength,
		};
	}

	/**
	 * The leg through the hole. See the JOURNEY comment for the shape.
	 * Overrides the orbit pose already applied this frame; at either edge it
	 * IS the orbit pose — position, gaze, zoom, and their velocities — so
	 * there is no seam to see, in either scroll direction.
	 */
	#applyJourney(progress) {
		if (!this.glyph || this.dive) return;
		const h = journeyH(progress);
		if (h <= 0 || h >= 1) return;

		// The two things #ridePose must not recompute per sample: the bore's
		// world frame, and the orbit anchors the ALIGN bezier leaves from
		// (they are read at fixed progress values, so they do not depend on h
		// at all). Three evaluations a frame, one of each.
		const bore = this.boreFrame();
		const align = this.#alignAnchors(bore);

		const { pos, dir, ortho, k } = this.#ridePose(h, bore, align);

		// The lean, and the up it produces. Zero everywhere the road is
		// straight — which includes the whole traverse, and therefore the
		// door: the gallery copies this pose and inherits a level horizon.
		const bank = this.#bank(h, bore, align);
		const up = WORLD_UP.clone().applyAxisAngle(
			dir.clone().normalize(),
			bank,
		);

		/* ---- the ortho bookend ---- */
		if (ortho) {
			const quat = new THREE.Quaternion().setFromRotationMatrix(
				new THREE.Matrix4().lookAt(pos, pos.clone().add(dir), up),
			);
			if (h < JOURNEY.STITCH) {
				// Float-level seam onto the live orbit gaze at the leg's edge.
				// The bank is already gated to zero under BANK.EDGE, so this
				// slerp still has a level frame on both of its ends.
				quat.slerpQuaternions(
					this.camera.quaternion,
					quat.clone(),
					smoothstep(clamp(h / JOURNEY.STITCH)),
				);
			}
			this.camera.position.copy(pos);
			this.camera.quaternion.copy(quat);
			this.camera.updateMatrixWorld(true);
			return;
		}

		if (h >= JOURNEY.LAND) {
			// Nothing to land. The sweep chases the LIVE orbit gaze (not the
			// frozen pose at TO), so when the dolly zoom finishes draining,
			// the perspective frame IS the ortho orbit frame of the current
			// progress — same heading, mark on axis on both sides. animate()
			// already wrote that pose; just let it through. The first cut
			// aimed at TO's fixed heading instead and the switch panned the
			// frame 13 degrees in one step (8.7x cruise on the gauge).
			return;
		}

		const cam = this.perspCamera;
		cam.fov = (Math.atan(k) * 360) / Math.PI;
		cam.aspect = this.aspectRatio;
		// Depth precision rides the working distance: a fixed 0.05 near with
		// the camera six hundred units out starves the z-buffer and the
		// solid's edges shatter into white shards (seen at p 0.82). Nothing
		// ever sits closer than a fiftieth of the derived distance.
		const reach = pos.distanceTo(this.pivot);
		cam.near = clamp(reach * 0.02, 0.05, 5);
		cam.far = reach + 150;
		cam.updateProjectionMatrix();
		cam.position.copy(pos);
		cam.up.copy(up);
		cam.lookAt(pos.clone().add(dir));
		cam.updateMatrixWorld(true);
		this.renderCamera = cam;
	}

	/**
	 * Where ALIGN's bezier leaves from, and how fast. Read at FIXED progress
	 * values — the leg's own edge and a central difference around it — so it
	 * is a constant of the frame, not a function of h. Hoisted out of the
	 * ride so that sampling three h's does not cost nine orbit poses.
	 */
	#alignAnchors(bore) {
		const d = 0.002;
		this.#orbitCamera(JOURNEY.FROM, this.scratch);
		const at = this.scratch.position.clone();
		this.#orbitCamera(JOURNEY.FROM + d, this.scratch);
		const aheadAt = this.scratch.position.clone();
		this.#orbitCamera(JOURNEY.FROM - d, this.scratch);
		const vel = aheadAt.sub(this.scratch.position).divideScalar(2 * d);

		const park = bore.ride(-JOURNEY.PARK);
		const du = JOURNEY.ALIGN[1] * (JOURNEY.TO - JOURNEY.FROM);
		// THE MARK STAYS PINNED, exactly as the orbit pins it: the gaze is
		// "toward the mark" plus a small eased offset that lands on the axis
		// at the park. Aiming anywhere else while the bezier travels lets
		// 18 % of the frame's ink slide — both earlier versions (a target
		// lerp, then a free direction blend) measured ~4x cruise from that
		// alone, with every camera CHANNEL at cruise speed. The offset is
		// only the few degrees between "mark seen from the park" and the
		// axis, so its own rate is noise; the swing the visitor sees is the
		// bezier's, which the pinning turns into an orbit-like sweep AROUND
		// the mark.
		const fromPark = this.pivot.clone().sub(park).normalize();
		let offAz = azimuth(bore.axisDir) - azimuth(fromPark);
		if (offAz > Math.PI) offAz -= Math.PI * 2;
		if (offAz < -Math.PI) offAz += Math.PI * 2;
		return {
			at,
			handle: at.clone().addScaledVector(vel, du / 3),
			park,
			offAz,
			offEl: 0 - elevation(fromPark),
		};
	}

	/**
	 * THE RIDE, AS A PURE FUNCTION OF h — where the eye stands and which way
	 * it looks, with nothing written to any camera. Split out of #applyJourney
	 * because the banking needs this same pose at h ± ε to know how hard the
	 * road is turning there, and a second copy of these four branches would
	 * drift the day one of them was touched.
	 *
	 * The ortho bookend hands back its PRE-STITCH direction: the slerp onto
	 * the live orbit gaze is a quaternion-level seam, it belongs to the frame
	 * being drawn and not to the road, and feeding it into a difference would
	 * read the seam as a turn.
	 *
	 * Defined outside [0, 1] on purpose — the difference at the very edges
	 * asks for it, and every branch extrapolates smoothly.
	 */
	#ridePose(h, bore, align) {
		const { s, ride, axisDir, mouth } = bore;

		if (h < JOURNEY.MORPH_IN[0]) {
			// ALIGN: leave the orbit at its own speed (bezier matched by
			// central difference), land parked ON the ride line with zero
			// velocity — the first breath. The gaze walks from the mark to a
			// point riding the camera down the axis (GAZE_IN), so the swing
			// dies exactly as its smoothstep flattens.
			const pos = bezier(
				align.at,
				align.handle,
				align.park,
				align.park,
				h / JOURNEY.ALIGN[1],
			);
			const toMark = this.pivot.clone().sub(pos).normalize();
			const wG = win(h, JOURNEY.GAZE_IN);
			const ya = azimuth(toMark) + align.offAz * wG;
			const el = elevation(toMark) + align.offEl * wG;
			return { pos, dir: heading(ya, el), ortho: true };
		}

		/* ---- the perspective interlude ---- */
		const kMin = Math.tan((JOURNEY.FOV_FLAT * Math.PI) / 360);
		const kMax = Math.tan((JOURNEY.FOV * Math.PI) / 360);
		const H_TRAVEL = VIEW_HEIGHT / ORBIT.ZOOM_TRAVEL;
		const wIn = win(h, JOURNEY.MORPH_IN);
		const wOut = win(h, JOURNEY.MORPH_OUT);
		// tan(fov/2): the one number perspective-ness lives in. Animating it
		// (rather than the fov) keeps the parallax rate steady.
		const k = wOut > 0 ? lerp(kMax, kMin, wOut) : lerp(kMin, kMax, wIn);

		if (h < JOURNEY.TRAVERSE[0]) {
			// MORPH_IN: focus pinned on the mouth, D = H/(2k) rides the
			// camera in as the frame tightens and the fov opens. The switch
			// from ALIGN is free: at FOV_FLAT this pose draws the ortho
			// frame ALIGN ended on (position along the gaze shows nothing in
			// ortho, so the world-space teleport is not on screen).
			const Hn = lerp(H_TRAVEL, JOURNEY.FRAME_MOUTH * s, wIn);
			return {
				pos: mouth.clone().addScaledVector(axisDir, -Hn / (2 * k)),
				dir: axisDir.clone(), // GAZE_IN ended with ALIGN: heading held
				k,
			};
		}

		if (h < JOURNEY.MORPH_OUT[0]) {
			// The derived branch below MUST own the whole life of wOut: it
			// reduces to the traverse's end exactly at wOut = wS = 0, and
			// letting the traverse linger while wOut ran popped the position
			// three units at the seam (5.5x, one step).
			// TRAVERSE: constant heading down the axis, the exit growing
			// dead ahead — perspective does the talking. Eased at both ends:
			// a breath at the mouth going in, one past the exit coming out.
			// The depth is traverseDepth(h) and nothing else: the gallery
			// solves that same function for the door, so the two agree by
			// construction rather than by two numbers kept in step by hand.
			return { pos: ride(traverseDepth(h)), dir: axisDir.clone(), k };
		}

		// SWEEP + MORPH_OUT: the passenger turn. The gaze direction sweeps
		// (the long way, so the room hands over to the stair continuously)
		// from the road ahead onto the orbit's own gaze at TO; the focus
		// walks from the look-ahead point onto the mark; and the position is
		// DERIVED — focus − dir·D — so the camera arcs around the subject
		// because that is what looking does. As MORPH_OUT drains k, D grows
		// and the arc becomes the receding spiral of the dolly zoom.
		const wS = win(h, JOURNEY.SWEEP); // uniform: see the SWEEP note
		// The end heading is the orbit gaze AT THIS h — animate() writes it
		// on the ortho camera for the frame being drawn, and #orbitCamera
		// gives the same answer for the neighbours the difference asks for —
		// so the sweep delivers the very frame the orbit will keep, and LAND
		// has nothing to absorb.
		this.#orbitCamera(journeyProgress(h), this.scratch);
		const fwdEnd = new THREE.Vector3(0, 0, -1).applyQuaternion(
			this.scratch.quaternion,
		);
		// The long way round, through -X: the stair re-enters from the
		// right, the side the ortho cut had already validated by eye.
		let dAz = azimuth(fwdEnd) - azimuth(axisDir);
		if (dAz < 0) dAz += Math.PI * 2;
		const dir = heading(
			azimuth(axisDir) + dAz * wS,
			lerp(0, elevation(fwdEnd), wS),
		);
		const axisEnd = ride(TUNNEL.halfLength + JOURNEY.EXIT_OVER);
		const focus = axisEnd
			.clone()
			.addScaledVector(axisDir, JOURNEY.LOOK * s)
			.lerp(this.pivot, wS);
		const Hn = lerp(2 * kMax * JOURNEY.LOOK * s, H_TRAVEL, wOut);
		const pos = focus.addScaledVector(dir, -Hn / (2 * k));
		// The crane (see LIFT / PUSH): up and forward into clear air, gone by
		// the time the drain ends — the path recedes high over the solid
		// instead of backing down the bore's own line.
		const crane = Math.sin(Math.PI * wOut) * s;
		pos.addScaledVector(WORLD_UP, JOURNEY.LIFT * crane);
		pos.addScaledVector(axisDir, JOURNEY.PUSH * crane);
		return { pos, dir, k };
	}

	/**
	 * THE LEAN, in radians about the camera's own gaze — a pure function of h
	 * like everything else on this leg, read off the road rather than tracked.
	 *
	 * SIGN, and it was checked on a frame rather than in anyone's head:
	 * azimuth(v) = atan2(−x, z), and d(dir)/d(azimuth) is exactly the camera's
	 * RIGHT vector (Matrix4.lookAt builds x = up × (eye − target) = forward ×
	 * up), so a POSITIVE yaw rate is a right-hand turn. Rotating WORLD_UP by
	 * +bank about the gaze carries the up toward that right — a motorcycle
	 * leaning into a right-hander — and the world's vertical therefore falls
	 * to the left of frame.
	 *
	 * THE TWO WINDOWS ARE NOT BELT AND BRACES. At h = 0 the ride leaves the
	 * orbit at the orbit's own speed AND its own heading rate, so lateral is
	 * emphatically not zero there: without the gate the roll would step on at
	 * the leg's first frame, against an orbit that has none. At the far end wS
	 * flattens on its own and the lean dies with it, but the window costs
	 * nothing and makes LAND unconditional.
	 */
	#bank(h, bore, align) {
		const e = BANK.EPS;
		const back = this.#ridePose(h - e, bore, align);
		const fwd = this.#ridePose(h + e, bore, align);
		let dYaw = azimuth(fwd.dir) - azimuth(back.dir);
		if (dYaw > Math.PI) dYaw -= Math.PI * 2;
		if (dYaw < -Math.PI) dYaw += Math.PI * 2;
		// The road's curvature, per notch of wheel. See the BANK note for why
		// the world speed that belongs in v²κ is not in here.
		const rate = dYaw / (2 * e);
		return (
			BANK.MAX *
			Math.tanh(rate / BANK.RATE) *
			win(h, [0, BANK.EDGE]) *
			win(1 - h, [0, BANK.EDGE])
		);
	}
	/* ------------------------------------------------------- page visibility */

	/**
	 * Where the text of the page physically sits in the room. Sampled once
	 * per layout: a grid over the union of the title's and the copy's boxes,
	 * each point cast from the frozen projector onto the cyclorama — the very
	 * mapping the projection itself uses, so a sample IS a spot of printed
	 * text, with the normal of the surface it landed on.
	 */
	#buildPageFootprint() {
		if (!this.journey || !this.cyclorama) return;
		// Relative to #page's own origin: the live DOM copy is parked OFF
		// SCREEN while its raster is what the projector actually prints, so
		// viewport coordinates here would be off by the whole parking offset.
		const origin = document
			.getElementById("page")
			?.getBoundingClientRect();
		const boxes = ["#page .display", "#page .copy"]
			.map((sel) => document.querySelector(sel)?.getBoundingClientRect())
			.filter(Boolean);
		if (!origin || !boxes.length) return;

		const left = Math.min(...boxes.map((b) => b.left)) - origin.left;
		const right = Math.max(...boxes.map((b) => b.right)) - origin.left;
		const top = Math.min(...boxes.map((b) => b.top)) - origin.top;
		const bottom = Math.max(...boxes.map((b) => b.bottom)) - origin.top;

		const ray = new THREE.Raycaster();
		const ndc = new THREE.Vector2();
		const samples = [];
		// 117 samples, and it matters: the opacity is quantized at one grid
		// point, so a 7x5 grid faded the text in visible stairs of ~0.2 (its
		// smoothstep window is a fifth of the samples wide — five steps from
		// ink to gone). The rays are cast ONCE per layout; per frame this is
		// 117 matrix projections, which costs nothing.
		const NX = 13;
		const NY = 9;
		for (let iy = 0; iy < NY; iy++) {
			for (let ix = 0; ix < NX; ix++) {
				const px = left + ((ix + 0.5) / NX) * (right - left);
				const py = top + ((iy + 0.5) / NY) * (bottom - top);
				ndc.set((px / this.width) * 2 - 1, -((py / this.height) * 2 - 1));
				ray.setFromCamera(ndc, this.restCamera);
				const hit = ray.intersectObject(this.cyclorama)[0];
				if (hit) {
					samples.push({
						point: hit.point.clone(),
						normal: hit.face.normal.clone(), // room is unrotated: world
					});
				}
			}
		}
		this.pageFootprint = samples.length ? samples : null;
	}

	/**
	 * How much of that footprint the CURRENT camera can see: inside the
	 * frame, on a surface still facing the eye. The page holds full opacity
	 * while at least a fifth of the text zone is in view — cropping is the
	 * frame's job, not a fade's — and dies with the last of it, whatever
	 * animation moved the camera. This replaces the calibrated fade window:
	 * the answer is measured on the geometry each frame instead of read off
	 * a curve that only knew about one choreography.
	 */
	#pageVisibility() {
		const samples = this.pageFootprint;
		if (!samples?.length) return 1;

		// FLOOR is the anti-flicker: during the exit turn one or two stray
		// samples kept grazing the frustum edge, and the ghost of the title
		// blinked at 5-20 % opacity four times over eight per cent of the
		// loop (measured on the sweep). Below six per cent of the zone the
		// text is not "in view", it is debris on the frame's edge — dark.
		// FULL is where cropping takes over from fading: a quarter of the
		// zone in frame reads as the page at the edge of the shot, and it
		// holds full opacity from there (exactly 1 at rest, where all of it
		// is in view).
		const FLOOR = 0.06;
		const FULL = 0.26;

		const eye = this.renderCamera ?? this.camera;
		const forward = eye.getWorldDirection(new THREE.Vector3());
		const v = new THREE.Vector3();
		let seen = 0;
		for (const { point, normal } of samples) {
			if (normal.dot(forward) >= -0.05) continue;
			v.copy(point).project(eye);
			if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && Math.abs(v.z) <= 1) {
				seen += 1;
			}
		}
		const frac = seen / samples.length;
		return smoothstep(clamp((frac - FLOOR) / (FULL - FLOOR)));
	}

	/* ------------------------------------------------------------- the menu */

	/**
	 * Where the three step fronts are on screen, in CSS pixels, right now.
	 *
	 * This is the hook for the menu: one item per step, positioned absolutely
	 * over the canvas and following the geometry instead of guessing at it.
	 * `facing` is 0 away from the step view and 1 square on to it, so the items
	 * can fade in exactly when the steps become readable — no scroll number
	 * hard-coded in the DOM layer.
	 *
	 *   const { facing, steps } = three.scene.stepAnchors()
	 *   for (const s of steps) el[s.id].style.transform =
	 *     `translate(${s.x}px, ${s.y}px)`
	 */
	stepAnchors() {
		const facing = facingSteps(this.progress);
		if (!this.glyph) return { facing, steps: [] };

		const v = new THREE.Vector3();
		const steps = STEP_FRONTS.map(({ id, point }) => {
			v.fromArray(point).applyMatrix4(this.glyph.matrixWorld).project(
				this.camera,
			);
			return {
				id,
				x: (v.x * 0.5 + 0.5) * this.width,
				y: (-v.y * 0.5 + 0.5) * this.height,
				// Inside the frame and in front of the camera. It does not test
				// occlusion — at the step view nothing is in the way.
				onScreen: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z <= 1,
			};
		});

		return { facing, steps };
	}

	/** Where the two poses that matter sit on the scroll, for anyone wiring UI. */
	static get MARKS() {
		return { rest: 0, steps: ORBIT.STEPS, back: ORBIT.BACK };
	}

	/* -------------------------------------------------------------- resize */

	onResize(width, height) {
		this.width = width;
		this.height = height;
		this.aspectRatio = width / height;

		const { halfW, halfH } = this.#frustum(this.aspectRatio);
		for (const cam of [this.camera, this.restCamera]) {
			cam.left = -halfW;
			cam.right = halfW;
			cam.top = halfH;
			cam.bottom = -halfH;
			cam.updateProjectionMatrix();
			cam.updateMatrixWorld(true);
		}
		if (this.perspCamera) {
			this.perspCamera.aspect = this.aspectRatio;
			this.perspCamera.updateProjectionMatrix();
		}

		if (this.glyph) {
			this.#place(this.glyph, this.#layout(), GLYPH_INK);
			this.#updateRig();
			this.#addRoom();
			if (this.projector) {
				for (const mesh of this.projectedMeshes) this.projector.applyTo(mesh);
			}
		}

		if (this.projector) this.projector.update();

		if (this.htmlToCanvas) {
			this.htmlToCanvas.pixelRatio = Math.min(window.devicePixelRatio, 2);
			this.htmlToCanvas.resize(width, height);
			this.#rasterizePage();
		}
	}
}
