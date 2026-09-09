export const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));

export const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * The same S, with one more zero at each end: 6t⁵ − 15t⁴ + 10t³. Its second
 * derivative dies at 0 and 1 as well, so two curves that meet at an edge agree
 * on their ACCELERATION and not merely on their speed. smoothstep leaves the
 * acceleration stepping from 0 to ±6 at every seam, and that step is what reads
 * as a jolt in a ride that is otherwise perfectly continuous.
 *
 * ADDED next to smoothstep, never in place of it: index.html is shipped and
 * frozen, and it shares this file. The orbit and v1's reveal keep the cubic.
 */
export const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export const lerp = (a, b, t) => a + (b - a) * t;

export const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * The camera model: ONE free orbit, not a list of poses.
 *
 * Scroll maps straight onto azimuth — a full turn of the loop is a full turn
 * around the glyph — so the visitor travels where they like rather than being
 * walked through a choreography. Everything else (elevation, zoom, recentring,
 * and the flat-to-lit ramp) is a function of one number: how far they are from
 * rest. Leave rest in either direction and the same thing happens; come back
 * and the page reassembles.
 *
 * Two poses on that circle are load-bearing, and both fall out of the geometry
 * rather than being chosen:
 *
 *   REST, at progress 0 — the canonical isometric view. Azimuth 45°, elevation
 *   35.264° = asin(1/√3), the axis the SVG is drawn on. This is the only pose
 *   where the projection lines up and the scene reads as a flat page, so it is
 *   the one the maths must return to EXACTLY.
 *
 *   STEPS, at progress 0.125 — 45° of orbit later, square on to +X. The three
 *   step fronts of the solid all face +X (measured: x = 0, +1, +2 at y = +1,
 *   0, −1, each exactly one unit tall and 2.5 deep). From there they stack as
 *   three cobalt bands with the treads showing as thin white rules between
 *   them, which is what makes a three-item menu possible. The travel elevation
 *   is deliberately low but not zero: dead flat, the treads vanish and the
 *   three bands merge into one slab.
 */
export const ORBIT = {
	/** Elevation of the rest pose. Not a taste value: the isometric axis. */
	EL_REST: Math.asin(1 / Math.sqrt(3)),
	/** Elevation once travelling. Low enough to read the steps square on. */
	EL_TRAVEL: 12 * DEG,
	/**
	 * Orthographic zoom while travelling. ABOVE 1 on purpose. The page exists
	 * only inside the projector's cone, so a frame wider than that cone shows
	 * paper the page never reached — pulling back to 0.6 left half the screen
	 * blank. Travelling closer is always safe; travelling back never is.
	 */
	ZOOM_TRAVEL: 1.75,
	/*
	 * TWO RAMPS, and they are deliberately out of step.
	 *
	 * The flat-to-lit one runs first and fast, while the camera has barely
	 * turned: that is the reveal, the page peeling off flatness onto a solid
	 * that was there all along, and it wants to happen where the page is still
	 * mostly in frame. Run it on the same curve as the travel and it is over
	 * in the first two per cent of the scroll, before anyone has seen it.
	 *
	 * The travel one — elevation, zoom, recentring — starts later and takes
	 * longer, and must be finished by 0.125, where the steps come square on.
	 * Both are expressed as [dead zone, ramp] on distanceFromRest, which is
	 * twice the progress near rest.
	 */
	LIT: { dead: 0.01, ramp: 0.06 },
	TRAVEL: { dead: 0.04, ramp: 0.18 },
	/**
	 * The page fades off the room as the visitor leaves, over this window of
	 * distanceFromRest. It has to end: the projector never moves, so a quarter
	 * turn later the slide is litter strewn across the floor, and it would sit
	 * right behind the menu.
	 *
	 * WHERE IT STARTS IS NOT A TASTE VALUE — it is where the type actually
	 * leaves. Rendered at full opacity across the approach, the dark ink on
	 * screen goes 2.78 % (progress 0.03), 2.65 (0.05), 2.03 (0.07), 1.21
	 * (0.09), 0.77 (0.11): the recentring and the 1.75x zoom carry the copy
	 * out of frame on their own, and by 0.09 only stretched fragments of the
	 * title are left. So the fade now begins at 0.17 — progress 0.085, the
	 * last pose where the page still reads — and is done by 0.24, progress
	 * 0.12, just before the steps come square on at 0.125.
	 *
	 * It used to start at 0.12, which is progress 0.06: opacity was already
	 * down to 0.15 at 0.07, where the title is still large and perfectly
	 * readable. The page was being taken away rather than left behind.
	 */
	PAGE_FADE_FROM: 0.17,
	PAGE_FADE_TO: 0.24,
	/** Progress at which the step fronts are square on. 45° / 360°. */
	STEPS: 0.125,
	/** Progress at which the solid is seen from behind. */
	BACK: 0.625,
};

export function wrap01(v) {
	const w = v % 1;
	return w < 0 ? w + 1 : w;
}

/** 0 at the rest pose, 1 at the far side of the loop. */
export function distanceFromRest(progress) {
	const s = wrap01(progress);
	return Math.min(s, 1 - s) * 2;
}

/**
 * The whole camera state for a scroll position. Every field is zero-valued at
 * progress 0, which is what keeps the rest frame byte-identical to the page:
 * the transform reduces to the identity rather than to something that rounds
 * to it.
 */
const ramp = (d, { dead, ramp: len }) => smoothstep(clamp((d - dead) / len));

export function orbitPose(progress) {
	const s = wrap01(progress);
	const d = distanceFromRest(s);
	const travel = ramp(d, ORBIT.TRAVEL);
	const lit = ramp(d, ORBIT.LIT);

	return {
		azimuth: s * TAU,
		// POSITIVE TILTS THE CAMERA DOWN. Rotating the camera's offset about
		// its own right axis by +θ swings it toward -up, so the sign that
		// reads as "lower the eye" is the one written here, not the signed
		// change in elevation. Getting it backwards raises the eye to 58° and
		// the steps are read from above: the treads become wider than the
		// risers and the menu inverts.
		tiltDown: (ORBIT.EL_REST - ORBIT.EL_TRAVEL) * travel,
		zoom: lerp(1, ORBIT.ZOOM_TRAVEL, travel),
		recentre: travel,
		litness: lit,
		pageOpacity:
			1 -
			smoothstep(
				clamp(
					(d - ORBIT.PAGE_FADE_FROM) /
						(ORBIT.PAGE_FADE_TO - ORBIT.PAGE_FADE_FROM),
				),
			),
		travel,
	};
}

/**
 * How square-on to the step fronts the camera is, 0 .. 1. Meant for the menu:
 * fade the items in with this and they arrive exactly when the steps become
 * readable, without the DOM layer hard-coding a scroll number.
 */
export function facingSteps(progress, window = 0.06) {
	const s = wrap01(progress);
	const raw = Math.abs(s - ORBIT.STEPS);
	const d = Math.min(raw, 1 - raw);
	return smoothstep(clamp(1 - d / window));
}
