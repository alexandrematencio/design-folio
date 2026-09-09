import * as THREE from "three";
import Lenis from "lenis";
import WebGLContext from "./WebGLContext";
import Scene from "../scenes/Scene";

/**
 * THE GALLERY PLATEAU (v2 only).
 *
 * The gallery is not a state, it is a stretch of road where the orbit stands
 * still. The spacer of v2.html is lengthened by VH, and the scroll-to-progress
 * map becomes monotone-by-parts: below the plateau the orbit runs slightly
 * faster than before (the same 1200vh of film now sits inside a longer
 * spacer), on the plateau it is pinned at PLATEAU, above it resumes exactly
 * where it stopped. Nothing is integrated — scroll back and the whole thing
 * replays in reverse, gallery included.
 *
 * PLATEAU is not a taste value. It is the progress at which the journey's
 * perspective camera sits INSIDE the bore, past its mouth and still a way from
 * its exit: JOURNEY.TRAVERSE is [0.44, 0.66] of the leg, and the eased
 * position crosses the mouth at h ≈ 0.542 and the exit at h ≈ 0.627. h = 0.56
 * puts it 0.68 units past the mouth (progress 0.2 + 0.56 × 0.675), where the
 * four cobalt edges of the bore frame the whole picture and the exit is a
 * bright rectangle ahead — which is what the gallery's own tunnel has to line
 * up with, edge for edge, for the crossfade to read as matter dissolving.
 *
 * VH follows from the tunnel's length, not the other way round: the gallery is
 * 18 bore-widths long, the journey cruises through the bore at ~35vh per
 * bore-width, and the traverse owns 0.84 of the plateau — 18 × 35 / 0.84 ≈ 750.
 * That lands at ~39vh of wheel per row of photographs.
 */
export const GALLERY = {
	LOOP_VH: 1200, // what v2.html's spacer was before the plateau
	VH: 750, // what the plateau adds to it
	PLATEAU: 0.578, // progress the orbit is pinned at while the gallery runs
};

/** [a, g, k]: plateau start in raw scroll, its width, and the loop's stretch. */
const span = () => {
	const total = GALLERY.LOOP_VH + GALLERY.VH;
	const k = total / GALLERY.LOOP_VH;
	const g = GALLERY.VH / total;
	return { a: GALLERY.PLATEAU / k, g, k };
};

class Three {
	constructor(container, options = {}) {
		this.container = container;
		// Which inking rule the glyph is drawn with. index.html takes the
		// default; v2.html asks for "one-material". See SHADING in Scene.js.
		this.options = options;
		this.context = null;
		this.scene = null;
		this.clock = new THREE.Clock();
		this.lenis = null;
		this.resizeTimer = null;

		// When set to a number, the loop uses it instead of the scroll
		// position. tools/shoot.mjs drives the animation through this — and so
		// does main-v2.js, to pin the orbit at the step view while a visitor
		// arriving back from a dive watches it play in reverse, before the
		// scroll is handed the camera again.
		this.progressOverride = null;

		// Where the gallery stands, read by Gallery.js and by main-v2.js.
		// `t` runs 0..1 across the plateau; `active` is strictly between, so
		// the two seam poses (t exactly 0 and 1) count as "not in the gallery"
		// — they are the frames where the logo's own picture is the truth.
		this.gallery = { t: 0, active: false };
		// Same role as progressOverride, for tools/shoot.mjs and for the
		// return from a photograph: pins t and parks the orbit on the plateau.
		this.galleryOverride = null;

		// The gentle pull onto the rest pose (v2 only, options.journey). One
		// scrollTo per approach: armed while far from a rest multiple, spent
		// the moment it fires, re-armed by leaving. Without the latch the
		// easing would be restarted every frame and never land.
		this.snapSpent = false;

		// Stops the camera and the flat-to-lit ramp from being recomputed,
		// without stopping rendering — so a tool can set a uniform by hand and
		// still get a frame. Without it every hand-set value is overwritten by
		// the next tick before the screenshot lands.
		this.paused = false;
	}

	run() {
		this.context = new WebGLContext(this.container);
		this.context.init();
		this.scene = new Scene(this.options);
		this.#setupLenis();

		// Dev-only handle. tools/shoot.mjs drives the loop from here to take
		// deterministic screenshots at chosen points of the scroll.
		if (import.meta.env.DEV) window.__three = this;

		requestAnimationFrame((t) => this.#animate(t));
		window.addEventListener("resize", () => this.#onResize());
	}

	/**
	 * infinite:true is what makes the loop work — the camera keyframes are
	 * written so that progress 0 and progress 1 are the same rest pose, so the
	 * page always falls back into perfect 2D no matter how far you scroll.
	 */
	#setupLenis() {
		this.lenis = new Lenis({
			infinite: true,
			smoothWheel: true,
			syncTouch: true,
			lerp: 0.075,
		});
	}

	#animate(time) {
		const delta = this.clock.getDelta();
		const elapsed = this.clock.elapsedTime;

		this.lenis?.raf(time);
		this.#maybeSnap();
		if (!this.paused) {
			this.scene.animate(delta, elapsed, this.#getLoopProgress());
		}
		this.#render();

		requestAnimationFrame((t) => this.#animate(t));
	}

	/**
	 * THE LIGHT SNAP ONTO REST. The rest pose is the only scroll position
	 * where the projection reassembles into the flat page EXACTLY, and asking
	 * a visitor to park a free scroll on one number is asking them to thread
	 * a needle. So once the scroll is close to a rest multiple — from either
	 * direction: closing the orbit backwards, or coming up out of the tunnel
	 * forwards — and the hand has left it, Lenis glides the last of the way.
	 * Light on purpose: the radius is two per cent of the loop, nothing is
	 * ever yanked mid-scroll (the velocity gate), and a dive or an override
	 * always outranks it.
	 */
	#maybeSnap() {
		const SNAP = { radius: 0.02, still: 0.05, duration: 0.6 };
		if (!this.options.journey || this.progressOverride !== null) return;
		if (this.scene?.dive) return;
		const lenis = this.lenis;
		if (!lenis?.limit) return;

		const nearest = Math.round(lenis.scroll / lenis.limit) * lenis.limit;
		const d = Math.abs(lenis.scroll - nearest) / lenis.limit;

		if (d > SNAP.radius) {
			this.snapSpent = false;
			return;
		}
		// A hand on the wheel re-arms it too: a nudge that never leaves the
		// radius would otherwise strand the scroll just off rest, spent.
		if (Math.abs(lenis.velocity) > SNAP.still) {
			this.snapSpent = false;
			return;
		}
		if (this.snapSpent || d < 1e-4) return;

		this.snapSpent = true;
		lenis.scrollTo(nearest, {
			duration: SNAP.duration,
			easing: (t) => 1 - (1 - t) ** 3,
		});
	}

	#setGallery(t) {
		this.gallery.t = t;
		this.gallery.active = t > 0 && t < 1;
	}

	#getLoopProgress() {
		// The gallery override outranks the progress one: the only progress a
		// pinned gallery can be seen at is the plateau's.
		if (this.galleryOverride !== null) {
			this.#setGallery(this.galleryOverride);
			return GALLERY.PLATEAU;
		}
		if (this.progressOverride !== null) {
			this.#setGallery(0);
			return this.progressOverride;
		}
		const limit = this.lenis?.limit;
		if (!limit) return 0;
		const raw = (this.lenis.scroll % limit) / limit;
		const u = raw < 0 ? raw + 1 : raw;

		// v1 has no plateau and never will: index.html is frozen.
		if (!this.options.journey) {
			this.#setGallery(0);
			return u;
		}

		const { a, g, k } = span();
		if (u < a) {
			this.#setGallery(0);
			return u * k;
		}
		if (u <= a + g) {
			this.#setGallery((u - a) / g);
			return GALLERY.PLATEAU;
		}
		this.#setGallery(1);
		return (u - g) * k;
	}

	/**
	 * The inverses, for anyone who has to PUT the scroll somewhere: the return
	 * from a dive parks on the step view, the return from a photograph parks
	 * back inside the tunnel. Both used to be `limit × progress`, which stopped
	 * being true the moment the spacer grew a plateau — the dive would have
	 * landed a few degrees off the steps for no visible reason.
	 */
	scrollFor(progress) {
		const limit = this.lenis?.limit ?? 0;
		const p = ((progress % 1) + 1) % 1;
		if (!this.options.journey) return limit * p;
		const { g, k } = span();
		return limit * (p <= GALLERY.PLATEAU ? p / k : p / k + g);
	}

	scrollForGallery(t) {
		const limit = this.lenis?.limit ?? 0;
		if (!this.options.journey) return 0;
		const { a, g } = span();
		return limit * (a + Math.min(1, Math.max(0, t)) * g);
	}

	#render() {
		if (!this.context.renderer) return;
		// renderCamera is which eye draws THIS frame: the ortho camera, or —
		// only inside the journey's perspective interlude — the tunnel's eye.
		this.context.renderer.render(
			this.scene.scene,
			this.scene.renderCamera ?? this.scene.camera,
		);
	}

	/**
	 * Debounced: a resize re-rasterizes the whole DOM page into the texture,
	 * which is far too expensive to run on every event of a window drag.
	 */
	#onResize() {
		clearTimeout(this.resizeTimer);
		this.resizeTimer = setTimeout(() => {
			const { width, height } = this.context.getFullScreenDimensions();
			this.context.onResize(width, height);
			this.scene.onResize(width, height);
			this.lenis?.resize();
		}, 120);
	}
}

export default Three;
