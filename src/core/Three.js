import * as THREE from "three";
import Lenis from "lenis";
import WebGLContext from "./WebGLContext";
import Scene from "../scenes/Scene";

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

	#getLoopProgress() {
		if (this.progressOverride !== null) return this.progressOverride;
		const limit = this.lenis?.limit;
		if (!limit) return 0;
		const raw = (this.lenis.scroll % limit) / limit;
		return raw < 0 ? raw + 1 : raw;
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
