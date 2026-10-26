import * as THREE from "three";
import Lenis from "lenis";
import WebGLContext from "./WebGLContext";
import Scene, { STAGE, stageProgress } from "../scenes/Scene";
import Gallery, { GALLERY } from "../scenes/Gallery";
import StageNav from "./StageNav";

export { GALLERY };

/**
 * THE GALLERY PLATEAU (v2 only) — the scroll map, and only that.
 *
 * The gallery is not a state, it is a stretch of road where the orbit stands
 * still. The spacer of v2.html is lengthened by GALLERY.VH, and the
 * scroll-to-progress map becomes monotone-by-parts: below the plateau the
 * orbit runs slightly faster than before (the same 1200vh of film now sits
 * inside a longer spacer), on the plateau it is pinned at PLATEAU, above it
 * resumes exactly where it stopped. Nothing is integrated — scroll back and
 * the whole thing replays in reverse, corridor included.
 *
 * PLATEAU itself is solved, not chosen, and it is solved in scenes/Gallery.js
 * where the corridor's own numbers live: it is the progress at which the
 * journey's camera has crossed the bore's exit plane by DOOR_OVER — the door.
 * Which is also why the two constants moved out of here: VH is a function of
 * the corridor's length, and the length is the gallery's business.
 */

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

		// v2 only: the stage the scroll stands at (scenes/Scene.js, STAGE),
		// null on the free road. stageOverride pins it, as progressOverride
		// pins the progress: the return from a dive lands on an anchor.
		this.stage = null;
		this.stageOverride = null;
		// v2 only: one gesture, one anchor (core/StageNav.js).
		this.nav = null;

		// Stops the camera and the flat-to-lit ramp from being recomputed,
		// without stopping rendering — so a tool can set a uniform by hand and
		// still get a frame. Without it every hand-set value is overwritten by
		// the next tick before the screenshot lands.
		this.paused = false;

		// The second scene, on v2 only. It owns its own camera and is drawn in
		// a second pass; see #render.
		this.galleryView = null;
	}

	run() {
		this.context = new WebGLContext(this.container);
		this.context.init();
		this.scene = new Scene(this.options);
		if (this.options.journey) {
			this.galleryView = new Gallery(this.scene, this.context);
			// The road follows the curation (GALLERY.VH, scenes/Gallery.js):
			// v2.html's inline height is the 16-row value, rewritten here
			// before Lenis measures the page.
			const spacer = document.getElementById("scroll-spacer");
			if (spacer) spacer.style.height = `${GALLERY.LOOP_VH + GALLERY.VH}vh`;
		}
		this.#setupLenis();
		if (this.options.journey) this.nav = new StageNav(this);

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
			// The staged half of the loop takes its gestures before Lenis
			// does: false means StageNav has it (v2 only).
			virtualScroll: (data) => this.nav?.onInput(data) ?? true,
		});
	}

	#animate(time) {
		const delta = this.clock.getDelta();
		const elapsed = this.clock.elapsedTime;

		this.lenis?.raf(time);
		this.nav?.tick();
		if (!this.paused) {
			const progress = this.#getLoopProgress();
			this.scene.animate(delta, elapsed, progress, this.stage);
			// AFTER the scene: the gallery's camera is derived from the
			// journey's, which this very frame has just posed.
			if (progress > 0.3) this.galleryView?.arm();
			this.galleryView?.update(this.gallery, delta, elapsed);
		}
		this.#render();

		requestAnimationFrame((t) => this.#animate(t));
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
		this.stage = null;
		if (this.stageOverride !== null) {
			this.#setGallery(0);
			this.stage = this.stageOverride;
			return stageProgress(this.stage);
		}
		if (this.progressOverride !== null) {
			this.#setGallery(0);
			return this.progressOverride;
		}
		const limit = this.lenis?.limit;
		if (!limit) {
			// Before Lenis has measured the page: the rest pose, which on v2
			// is stage 0.
			if (this.options.journey) this.stage = 0;
			return 0;
		}
		const raw = (this.lenis.scroll % limit) / limit;
		const u = raw < 0 ? raw + 1 : raw;

		// v1 has no plateau and never will: index.html is frozen.
		if (!this.options.journey) {
			this.#setGallery(0);
			return u;
		}

		const { a, g, k } = span();
		const { mouth } = this.zones();
		if (u < mouth) {
			// The staged half: the scroll carries the stage, the stage the road.
			this.#setGallery(0);
			this.stage = (STAGE.COUNT * u) / mouth;
			return stageProgress(this.stage);
		}
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

	/**
	 * The staged half of the loop, in raw scroll fractions (v2 only): it runs
	 * from 0 to `mouth`, where the free road picks up at exactly the progress
	 * the last anchor stands at; the free road ends at `exit`, inside the
	 * plateau, and the rest of the loop is the close (core/StageNav.js).
	 */
	zones() {
		const { a, g, k } = span();
		return { mouth: STAGE.MOUTH / k, exit: a + g * GALLERY.EXIT };
	}

	/** The scroll offset of a stage — an anchor when s is whole. */
	scrollForStage(s) {
		const limit = this.lenis?.limit ?? 0;
		const clamped = Math.min(STAGE.COUNT, Math.max(0, s));
		return (limit * this.zones().mouth * clamped) / STAGE.COUNT;
	}

	scrollForGallery(t) {
		const limit = this.lenis?.limit ?? 0;
		if (!this.options.journey) return 0;
		const { a, g } = span();
		return limit * (a + Math.min(1, Math.max(0, t)) * g);
	}

	/**
	 * ONE renderer, up to two passes, and the corridor decides which (see
	 * Gallery's `pass`).
	 *
	 * "through" IS THE DOOR. The corridor's pass is drawn with the LOGO'S OWN
	 * render camera — same projection, same near and far — into the logo's own
	 * depth buffer, with nothing cleared between the two. That is the whole
	 * mechanism: the corridor starts at the bore's exit plane, the bore is
	 * convex, so from inside it the corridor can only land INSIDE the exit
	 * rectangle, and the z-buffer does the occluding for free. It replaces
	 * exactly what that rectangle used to show and nothing else. The version
	 * this replaced cleared the depth and cross-faded two coincident tunnels,
	 * which is a double exposure by construction.
	 *
	 * "solo" skips the logo pass outright. Not tidiness: it is a VSM shadow
	 * map, a projection and a room that nobody can see, over 592vh of plateau.
	 *
	 * "veil" is the one place a depth clear survives, and it earns it: the two
	 * passes are two unrelated cameras (the logo parked at the door, the
	 * corridor eighteen bore widths further on), so their depths mean nothing
	 * to each other. It is also the one place where nothing on screen is
	 * moving — flat paper dissolving off a flat cyclorama — which is exactly
	 * why the camera is allowed to hold still through it.
	 */
	#render() {
		const renderer = this.context.renderer;
		if (!renderer) return;
		const view = this.galleryView;
		const pass = view?.pass ?? "none";

		if (pass !== "solo") {
			// renderCamera is which eye draws THIS frame: the ortho camera, or
			// — only inside the journey's perspective interlude — the road's.
			renderer.autoClear = true;
			renderer.render(
				this.scene.scene,
				this.scene.renderCamera ?? this.scene.camera,
			);
		}
		if (pass === "none") return;

		if (pass === "solo") {
			renderer.setClearColor(view.clearColour, 1);
			renderer.autoClear = true;
			renderer.render(view.scene, view.camera);
		} else if (pass === "through") {
			renderer.autoClear = false;
			renderer.render(view.scene, this.scene.renderCamera ?? this.scene.camera);
		} else {
			renderer.autoClear = false;
			renderer.clearDepth();
			renderer.render(view.scene, view.camera);
		}
		renderer.autoClear = true;
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
			this.galleryView?.onResize();
			this.lenis?.resize();
		}, 120);
	}
}

export default Three;
