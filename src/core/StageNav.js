import { STAGE } from "../scenes/Scene";

/**
 * ONE GESTURE, ONE ANCHOR (v2) — the scroll as a remote control.
 *
 * The loop has three stretches now (Three.zones):
 *
 *   staged   rest → the three names → AAXLO → the mouth of the bore. Six
 *            anchors (scenes/Scene.js, STAGE). A flick of the wheel, a swipe,
 *            an arrow key: the camera travels to the next anchor on its own and
 *            stops there. The wheel moves nothing by itself.
 *   free     from the mouth through the corridor, as before: the scroll is the
 *            camera, Lenis smooths it.
 *   close    from the end of the corridor back round to the rest pose: one
 *            move, played on its own, the moment the free road runs out.
 *            Backwards from the rest pose it plays in reverse, into the far
 *            end of the corridor.
 *
 * Everything still goes through the scroll — a move is an animated scrollTo,
 * and the frame stays a pure function of where the scroll stands. So nothing
 * here touches the camera, the browser's own scroll position always means
 * something, and backwards is free.
 *
 * WHAT A GESTURE IS. A trackpad flick sends wheel events for a second or more
 * after the fingers have left (the inertia), a mouse wheel sends one per notch.
 * Both are read as ONE gesture until the wheel has been quiet for GAP ms; a
 * touch is one gesture from touchstart. A gesture moves the camera once, and
 * its inertia is swallowed — otherwise a single flick would run through three
 * anchors. A hand that keeps going (a wheel turned on and on, a slow drag) is
 * not inertia, and steps again every HOLD ms (see #read).
 *
 * BUT A NEW GESTURE IS ALWAYS HEARD, even mid-move (Alexandre, 2026-10-26: on
 * the stair, swallowing everything until the camera had landed read as a page
 * that does not answer). The same way, it extends the move to the anchor
 * after; the other way, it turns round onto the anchor just behind. The
 * close, one long take, does not stop on the way, but the other way it plays
 * back from where it is.
 *
 * EDGES OF THE FREE ROAD. Wheel, touch inertia, the keyboard or the scrollbar
 * can carry the scroll out of the free stretch; the tick watches for it, and
 * hands over: back into the staged half lands on the mouth anchor, forward
 * past the exit plays the close.
 */
const NAV = {
	/** ms of wheel silence that ends a gesture. */
	GAP: 200,
	/** Accumulated delta a gesture must reach to mean "go": px of wheel. */
	WHEEL: 8,
	/** The same for a finger, px of travel: a tap must never step. */
	TOUCH: 30,
	/** A wheel delta this big, and this many times the last, starts a new gesture. */
	KICK: 24,
	KICK_RATIO: 2.5,
	/** ms after a step before a gesture that goes on can step again. */
	HOLD: 450,
	/** ...if the wheel still runs at this share of the gesture's peak, */
	HOLD_RATIO: 0.6,
	/** ...or the finger has travelled this many px since. */
	TOUCH_HOLD: 120,
	/**
	 * Seconds per leg, leg i joining anchor i to i + 1. The first is the
	 * orbit's whole reveal; the walk down the names is short; the swing onto
	 * the word is a quarter turn; the last is ALIGN plus the first of the
	 * perspective.
	 */
	LEGS: [1.8, 0.75, 0.75, 1.4, 2.2],
	/**
	 * Backwards, every leg runs this much quicker. Going back is undoing, and
	 * the eye already knows the way — at the same pace it felt sluggish.
	 */
	BACK: 0.75,
	/** Seconds for the whole close, exit to rest. */
	CLOSE: 6,
	/** Seconds for a settle onto the nearest anchor. */
	SETTLE: 0.7,
	/** ms the scroll must be still before a settle. */
	IDLE: 180,
	/** Raw scroll fraction within which the scroll is ON an anchor or an edge. */
	EDGE: 2e-4,
};

/**
 * The legs' clock: a SNAP, not a symmetric S. The speed climbs to its peak
 * over the first ATTACK of the time, then falls off as a square onto the
 * anchor — a third of the way is covered in a fifth of the time. An in-out
 * cubic spent its first fifth on 3 % of the move, and that dead start is what
 * read as no answer, worst on the way back. Still no corner at either end: it
 * leaves from rest, and lands flat.
 */
const snap = (t, attack = 0.12) => {
	const k = 1 / (attack / 2 + (1 - attack) / 3);
	if (t < attack) return (k * t * t) / (2 * attack);
	const r = (1 - t) / (1 - attack);
	return k * (attack / 2 + ((1 - attack) / 3) * (1 - r * r * r));
};

/**
 * The close's clock: the film it plays was paced for a steady wheel, its own
 * curves (the brake, the sweep, the climb) already in it, so the clock runs
 * flat out in the middle and only eases away from rest and onto it — an
 * eighth of the time at each end, constant speed between.
 */
/**
 * An easing that leaves at slope v0 instead of zero: the `v0·t·(1 − t)⁶` term
 * adds exactly v0 to the start slope and nothing to the end, value or slope,
 * and it is spent within the snap's attack. The power is not taste: at (1 − t)²
 * the snap, already 85 % of the way at mid-time, passed the target by up to
 * 11 % and came back. At 6, checked over [0, 2]: monotone, never past 1; down
 * to −1 (a turn-round) it goes back on itself by 1.4 % of the way at most, as
 * a body with momentum would.
 */
const launch = (easing, v0) => (v0 ? (t) => easing(t) + v0 * t * (1 - t) ** 6 : easing);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const cruise = (t, a = 0.12) => {
	const v = 1 / (1 - a);
	if (t < a) return (v * t * t) / (2 * a);
	if (t > 1 - a) return 1 - (v * (1 - t) ** 2) / (2 * a);
	return v * (a / 2 + (t - a));
};

export default class StageNav {
	/** @param {import("./Three").default} three */
	constructor(three) {
		this.three = three;
		// A move this controller started is playing.
		this.moving = false;
		// Where it is going: { stage, dir } for a leg or a settle, { close }
		// for the close (its direction).
		this.heading = null;
		this.gesture = { at: -Infinity, sum: 0, spent: false, last: 0, peak: 0, firedAt: 0, travel: 0 };
		this.lastZone = null;
		this.stillSince = null;
		this.lastScroll = null;
		// px/s, measured each tick.
		this.speed = 0;
		this.prev = null;
		window.addEventListener("keydown", (event) => this.#onKey(event));
	}

	/** Not ours to drive: before Lenis measures, under a dive, an override. */
	#idle() {
		const { three } = this;
		const lenis = three.lenis;
		return (
			!lenis?.limit ||
			lenis.isStopped ||
			Boolean(three.scene?.dive) ||
			three.progressOverride !== null ||
			three.galleryOverride !== null ||
			three.stageOverride !== null
		);
	}

	/**
	 * Where the scroll stands. `zone` is one of rest, staged, mouth, free,
	 * close; `stage` is set on the staged half.
	 */
	#where() {
		const lenis = this.three.lenis;
		const u = lenis.scroll / lenis.limit; // Lenis wraps it into [0, limit)
		const { mouth, exit } = this.three.zones();
		const e = NAV.EDGE;
		if (u < e || u > 1 - e) return { zone: "rest", stage: 0, u };
		if (u < mouth - e) return { zone: "staged", stage: (STAGE.COUNT * u) / mouth, u };
		if (u <= mouth + e) return { zone: "mouth", stage: STAGE.COUNT, u };
		if (u <= exit) return { zone: "free", u };
		return { zone: "close", u };
	}

	/**
	 * Lenis's virtualScroll hook: true lets Lenis have the event, false keeps
	 * it — and then the default has to be prevented here, since Lenis no
	 * longer will. Never on touchstart: that would kill the tap.
	 */
	onInput({ deltaX, deltaY: rawY, event }) {
		// A trackpad pinch arrives as a wheel with ctrlKey: it is the
		// browser's zoom, never a step (Lenis lets it through as well).
		if (this.#idle() || event.ctrlKey) return true;
		// A sideways swipe is not a step either, whatever vertical drift it
		// carries.
		const deltaY = Math.abs(rawY) >= Math.abs(deltaX) ? rawY : 0;
		const type = event.type;
		const touch = type.startsWith("touch");
		const keep = () => {
			if (type !== "touchstart" && event.cancelable) event.preventDefault();
			return false;
		};

		const now = performance.now();
		this.#read(type, deltaY, now);

		const where = this.#where();
		const dir = Math.sign(deltaY);

		const onRoad =
			!this.moving && (where.zone === "free" || (where.zone === "mouth" && dir > 0));
		if (onRoad) {
			// A gesture that drove the free road does not also step at once:
			// run up the corridor in one flick and it stops at the mouth, it
			// does not carry on to AAXLO. Keep scrolling, and it does (#read).
			if (dir) this.#spend(now);
			return true;
		}
		// Nothing moves from a touchstart. While a move plays, Lenis must not
		// see one either: it resets its scroll on it, which stops the move.
		if (type === "touchstart") return keep();

		// The touchend's inertia is not a gesture of its own: only the finger
		// on the glass counts toward a step.
		if (type !== "touchend") this.gesture.sum += deltaY;
		const reach = touch ? NAV.TOUCH : NAV.WHEEL;
		if (!this.gesture.spent && dir && Math.abs(this.gesture.sum) >= reach) {
			const go = Math.sign(this.gesture.sum);
			this.#spend(now);
			// A move is playing: Lenis hears nothing, but the gesture still
			// counts — it retargets the move.
			if (this.moving) this.#retarget(go, where);
			else this.#step(go, where);
		}
		return keep();
	}

	/**
	 * The gesture bookkeeping: when one ends and the next begins.
	 *
	 *   - a touch begins at touchstart;
	 *   - a wheel gesture ends after GAP ms of silence;
	 *   - a trackpad's inertia can run on for a second and more with no gap
	 *     to end it: a new flick on top of it shows as a jump in the delta
	 *     (KICK), where inertia only ever decays;
	 *   - and a gesture that simply GOES ON — a mouse wheel turned without a
	 *     pause, two fingers dragging slowly, a thumb still travelling — is
	 *     armed again HOLD ms after it last stepped. That is the difference
	 *     with inertia, which also goes on: inertia fades, so after HOLD ms
	 *     it is well under the gesture's peak; a hand still at work is not.
	 *     Without this, a wheel turned without a pause stepped once and was
	 *     then swallowed for as long as it turned — the page "froze".
	 */
	#read(type, deltaY, now) {
		const touch = type.startsWith("touch");
		const size = Math.abs(deltaY);
		const g = this.gesture;
		const fresh = () => {
			this.gesture = { at: now, sum: 0, spent: false, last: size, peak: size, firedAt: 0, travel: 0 };
		};
		if (type === "touchstart") return fresh();
		if (!touch) {
			if (now - g.at > NAV.GAP) return fresh();
			if (g.spent && size > Math.max(NAV.KICK, NAV.KICK_RATIO * g.last)) return fresh();
		}
		g.at = now;
		if (type === "touchend") return;
		g.last = size;
		g.peak = Math.max(g.peak, size);
		g.travel += deltaY;
		if (!g.spent || now - g.firedAt < NAV.HOLD) return;
		const goesOn = touch
			? Math.abs(g.travel) >= NAV.TOUCH_HOLD
			: size >= NAV.WHEEL && size >= NAV.HOLD_RATIO * g.peak;
		if (goesOn) {
			g.spent = false;
			g.sum = 0;
			g.peak = size;
		}
	}

	/** The gesture has stepped (or driven the road): swallow it from here. */
	#spend(now) {
		this.gesture.spent = true;
		this.gesture.firedAt = now;
		this.gesture.travel = 0;
	}

	#onKey(event) {
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
		const { key, shiftKey } = event;
		let dir = 0;
		if (key === "ArrowDown" || key === "PageDown" || (key === " " && !shiftKey)) dir = 1;
		if (key === "ArrowUp" || key === "PageUp" || (key === " " && shiftKey)) dir = -1;
		if (!dir || this.#idle()) return;
		// Keys typed into a field are the field's; space on a focused
		// control is that control's.
		const target = event.target;
		if (target.isContentEditable || target.closest?.("input, textarea, select")) return;
		if (key === " " && target.closest?.("a, button")) return;

		const where = this.#where();
		if (this.moving) {
			event.preventDefault();
			if (!event.repeat) this.#retarget(dir, where);
			return;
		}
		if (where.zone === "free" || (where.zone === "mouth" && dir > 0)) return;
		event.preventDefault();
		if (!event.repeat) this.#step(dir, where);
	}

	/** One anchor along, in direction dir, from where the scroll stands. */
	#step(dir, where) {
		if (where.zone === "close") return this.#close(dir);
		if (where.zone === "rest" && dir < 0) return this.#close(-1);
		const s = where.stage;
		const target = dir > 0 ? Math.floor(s + 1e-3) + 1 : Math.ceil(s - 1e-3) - 1;
		if (target < 0) return this.#close(-1);
		if (target > STAGE.COUNT) return;
		this.#leg(target, dir);
	}

	/** A move to anchor `target`, timed by the leg it ends on. */
	#leg(target, dir) {
		const leg = dir > 0 ? target - 1 : target;
		const seconds = NAV.LEGS[leg] * (dir > 0 ? 1 : NAV.BACK);
		this.heading = { stage: target, dir };
		this.#go(this.three.scrollForStage(target), seconds, snap, true);
	}

	/**
	 * A short move onto an anchor the scroll is already next to. It has a
	 * heading like any leg, so a gesture during it is heard: back from the
	 * corridor, the settle onto the mouth turns into the leg to AAXLO.
	 */
	#settle(target, dir) {
		this.heading = { stage: target, dir: dir || 1 };
		this.#go(this.three.scrollForStage(target), NAV.SETTLE, snap, true);
	}

	/**
	 * A new gesture during a move. On a leg, the same way: one anchor further
	 * than the one it was heading for; the other way: the anchor just behind,
	 * from wherever the camera is now. During the close, only the other way:
	 * it plays back from where it is.
	 */
	#retarget(dir, where) {
		if (this.heading?.close) {
			// The close is one take: it does not stop on the way, but it can
			// be sent back the way it came.
			if (dir !== this.heading.close) this.#close(dir);
			return;
		}
		if (!this.heading || where.stage === undefined) return;
		let target;
		if (dir === this.heading.dir) target = this.heading.stage + dir;
		else {
			const s = where.stage;
			target = dir > 0 ? Math.floor(s + 1e-3) + 1 : Math.ceil(s - 1e-3) - 1;
		}
		if (target < 0 || target > STAGE.COUNT) return;
		this.#leg(target, dir);
	}

	/**
	 * The close, forward (exit → rest) or backward (rest → exit). The time is
	 * the share of the stretch still to play.
	 */
	#close(dir) {
		const lenis = this.three.lenis;
		const { exit } = this.three.zones();
		const u = lenis.scroll / lenis.limit;
		const atRest = u < NAV.EDGE || u > 1 - NAV.EDGE;
		// What is left of the stretch: from rest, all of it backwards and none
		// of it forwards.
		let left;
		if (dir > 0) left = atRest ? 0 : 1 - u;
		else left = atRest ? 1 - exit : u - exit;
		const share = Math.max(0, left) / (1 - exit);
		// Lenis, infinite, takes the short way round: the limit IS the rest
		// pose, and from the rest pose the exit is reached backwards.
		const target = dir > 0 ? lenis.limit : exit * lenis.limit;
		this.heading = { close: dir };
		this.closeDir = dir;
		this.#go(target, Math.max(0.3, NAV.CLOSE * share), cruise);
	}

	/**
	 * The move itself: an animated scrollTo. With `carry`, it leaves at the
	 * speed the scroll already has — a retarget mid-leg, or a settle caught
	 * from the corridor's own momentum, does not brake to a stop first to set
	 * off again (that hitch is a jerk the eye reads as a stumble).
	 */
	#go(target, seconds, easing, carry = false) {
		const lenis = this.three.lenis;
		let ease = easing;
		if (carry) {
			// The way Lenis will go (infinite: the short way round), and the
			// current speed as a share of the move's mean speed.
			let distance = target - lenis.scroll;
			if (distance > lenis.limit / 2) distance -= lenis.limit;
			else if (distance < -lenis.limit / 2) distance += lenis.limit;
			const v0 = Math.abs(distance) < 1 ? 0 : (this.speed * seconds) / distance;
			ease = launch(easing, clamp(v0, -1, 2));
		}
		this.moving = true;
		lenis.scrollTo(target, {
			duration: seconds,
			easing: ease,
			force: true,
			onComplete: () => {
				this.moving = false;
				this.heading = null;
			},
		});
	}

	/** Once a frame, before the scroll is read: the edges, and the settle. */
	tick() {
		const lenis = this.three.lenis;
		// The scroll's speed, px/s, the loop's wrap taken out: what a move
		// leaves at (see #go).
		const now = performance.now();
		if (lenis?.limit) {
			const at = lenis.scroll;
			if (this.prev) {
				let d = at - this.prev.at;
				if (d > lenis.limit / 2) d -= lenis.limit;
				else if (d < -lenis.limit / 2) d += lenis.limit;
				// Smoothed over ~50 ms: frames do not arrive evenly, and one
				// read off a 2 ms frame is ten times the truth.
				const dt = (now - this.prev.time) / 1000;
				if (dt >= 0.1) this.speed = 0;
				else if (dt > 0) this.speed += (d / dt - this.speed) * (1 - Math.exp(-dt / 0.05));
			}
			this.prev = { at, time: now };
		}
		// A move can be killed without its onComplete ever firing: Lenis
		// stop() or an immediate scrollTo reset the animation — a click on a
		// name mid-move starts a dive, and that is what it does. `moving`
		// stuck at true swallowed every gesture after, for good: the page
		// was dead. So the flag answers to the animation, every frame.
		if (this.moving && !lenis?.animate.isRunning) {
			this.moving = false;
			this.heading = null;
		}
		if (this.#idle()) {
			this.lastZone = null;
			return;
		}
		const where = this.#where();
		const was = this.lastZone;
		this.lastZone = where.zone;
		if (this.moving) return;

		// The free road ran out under a scroll this controller did not start
		// (Lenis's smoothing still easing onto a wheel target, touch inertia,
		// the keyboard, the scrollbar): back onto the mouth. From the mouth
		// itself too, but only while Lenis's smoothing runs — it can carry the
		// scroll across after the last event. A jump (an immediate scrollTo,
		// the scrollbar from the mouth) is not that: it settles where it
		// landed, like any other, instead of being sent back to the mouth.
		const carried = was === "free" || (was === "mouth" && lenis.animate.isRunning);
		if (carried && where.zone === "staged") {
			this.#spend(performance.now());
			this.#settle(STAGE.COUNT, -1);
			return;
		}
		if ((was === "free" || was === "mouth") && where.zone === "close") {
			this.#spend(performance.now());
			this.#close(1);
			return;
		}

		// Left between two anchors (a scrollbar drag, a resize): once still,
		// settle on the nearest one — or finish the close the way it was going.
		// Still is measured, not asked: Lenis can sit in isScrolling
		// "native" for good (a native scroll event right after a reset, at
		// zero velocity, never arms the timer that clears it), and asking it
		// meant no settle ever again — the camera parked between two names.
		const at = lenis.scroll;
		const still = !lenis.animate.isRunning && Math.abs(at - (this.lastScroll ?? at)) < 0.5;
		this.lastScroll = at;
		if (!still) {
			this.stillSince = null;
			return;
		}
		this.stillSince ??= now;
		if (now - this.stillSince < NAV.IDLE) return;
		if (where.zone === "staged" && Math.abs(where.stage - Math.round(where.stage)) > 1e-3) {
			const target = Math.round(where.stage);
			this.#settle(target, Math.sign(target - where.stage));
		} else if (where.zone === "close") {
			this.#close(this.closeDir ?? (lenis.direction < 0 ? -1 : 1));
		}
	}
}
