import Three from "./core/Three";
import { ORBIT } from "./utils/utils";
import { Mouse } from "lucide";
import { iconSvg } from "./utils/icon";
import { attachPageLinks } from "./utils/pageLinks";

// style.css is linked from v2.html's head, not imported here: the DOM page
// is on screen from the first paint and has to be styled by then.

/**
 * v2 — the same page, drawn with the rule Alexandre actually uses.
 *
 * The solid is cobalt everywhere. There is no white on it. What reads as white
 * is negative space: the faces that take the most light, blown past clipping;
 * and the pale wedge under the bottom step mirrors the white floor — the one
 * face allowed to, because it is the one the bake says is sealed off from the
 * room. See SHADING in scenes/Scene.js and tools/bake-glyph-light.py.
 *
 * This entry also owns the STEP MENU and the DIVES, because both are pure
 * page-level concerns: Scene.js exposes where the step fronts are on screen
 * (stepAnchors) and how far a dive has run (scene.dive.t); everything about
 * labels, destinations and the colour of the hand-off lives here.
 *
 * THE HAND-OFF RULE: each dive ends on a veil painted the colour of the FIRST
 * FRAME of the destination's own opening, so landing there is a match cut.
 *   agency      -> the AAXLO splash opens on its fake VS Code writing the
 *                  page; first frame is the editor, --vsc-bg #1e1e1e.
 *   photography -> the portfolio opens on a white screen (ALX / MTNC, then
 *                  the splash plays); the veil stays white, nothing to change.
 *   design      -> no destination yet: the label is there, the click is not
 *                  wired. This page IS the design work, until told otherwise.
 *
 * AND IT RUNS BOTH WAYS. Diving records where it went; coming back — the
 * browser's back button, from anywhere on the destination — the veil is up
 * before the first frame is painted, and the dive plays in reverse until the
 * camera is back at the menu, square on to the steps, with the scroll handed
 * over exactly where the orbit says the step view lives.
 *
 * THE GALLERY IS THE SECOND DOOR TO THE SAME PLACE. Inside the tunnel every
 * photograph is a link to the portfolio, and it uses the dive's whole
 * machinery with one leg removed: there is no somersault to rewind, so the
 * record carries the position on the plateau instead of a step, and the return
 * puts the visitor back in the corridor in front of the picture they clicked.
 * The veil is white here too — and for the same reason, not by coincidence:
 * the portfolio opens on a white screen.
 */
const DESTINATIONS = {
	agency: { url: "https://www.aaxlo.com", veil: "#1e1e1e" },
	photography: {
		url: "https://alexandrematencio.github.io/photo-portfolio",
		veil: "#ffffff",
	},
	design: null,
};

/** The menu only takes the pointer once it is actually readable. */
const CLICKABLE_FROM = 0.5;
/** The veil fades over the tail of the dive, once the tread fills the frame. */
const VEIL_FROM = 0.62;
/**
 * Seconds the white-out takes when a photograph is clicked. There is no dive
 * to hide behind here — the tunnel simply whitens into the portfolio's own
 * first frame — so the veil owns the whole cut, and half a second is the
 * length at which it reads as a cut rather than as a wait.
 */
const GALLERY_VEIL = 0.5;
/**
 * How long the return from a photograph will hold its veil waiting for the 31
 * textures. Past that it lifts anyway: the photographs fade in on their own as
 * they land, and a visitor who came back with a cold cache should not be shown
 * a white rectangle for four seconds to spare them an empty corridor for one.
 */
const RETURN_PATIENCE = 1500;
/**
 * Survives the trip to the destination and back, which is the whole point:
 * sessionStorage is per-tab and outlives a cross-origin round trip, so the
 * return works whether the browser hands the page back from its back/forward
 * cache (state intact) or reloads it from scratch (state gone). Both paths
 * read this one record; whoever gets there first consumes it.
 */
const RETURN_KEY = "alx:returning-from-dive";

const readReturn = () => {
	try {
		const raw = sessionStorage.getItem(RETURN_KEY);
		if (!raw) return null;
		sessionStorage.removeItem(RETURN_KEY);
		return JSON.parse(raw);
	} catch {
		return null;
	}
};

document.addEventListener("DOMContentLoaded", () => {
	const container = document.querySelector("#app");
	const three = new Three(container, { shading: "one-material", journey: true });
	three.run();

	// The return parks the scroll itself, at a position it computes. Letting
	// the browser restore its own offset a beat later would fight that and
	// spin the camera off the step view for no visible reason.
	if ("scrollRestoration" in history) history.scrollRestoration = "manual";

	const veil = document.querySelector("#dive-veil");
	const items = [...document.querySelectorAll(".step-menu__item")];
	let navigatedTo = null;

	/**
	 * THE SCROLL CUE — the hero cue of amatencio-photo, as a mouse. Shown to a
	 * visitor who lands cold on the rest frame, and only to them: a return
	 * from a dive or a photograph arrives elsewhere and is driven by an
	 * override, and a tool (shoot, flow) drives the page with no visitor at
	 * all. The first scroll retires it for the session — the loop passes
	 * through rest every lap, and a cue that came back each time would be a
	 * nag, not a hint.
	 */
	const cue = document.querySelector("#scroll-cue");
	cue.innerHTML = iconSvg(Mouse, {
		width: 26,
		height: 26,
		"stroke-width": 1.5,
		class: "scroll-cue",
	});
	let cueSpent = false;

	/** Runs `fn` once the browser has actually painted the state set just now. */
	const afterFrame = (fn) =>
		requestAnimationFrame(() => requestAnimationFrame(fn));

	/**
	 * Come back into the page at the far end of a dive and play it backwards.
	 * The veil is raised SYNCHRONOUSLY, before anything else: on a cold load
	 * the scene needs a moment to rasterize the page and the first frames
	 * would otherwise flash the rest pose — the flat page — which is the one
	 * thing the return must not show.
	 *
	 * A record carrying `gallery` came from a photograph, not from a step, so
	 * there is nothing to rewind: the veil comes down onto the corridor the
	 * visitor left, at the position on the plateau they left it at.
	 */
	const playReturn = (record) => {
		if (!record || !DESTINATIONS[record.dest]) return;
		// The click set a transition on this element to fade the white in. It
		// must be off for the return, or the veil would fade UP from nothing
		// and show the very frames it exists to hide.
		veil.style.transition = "none";
		veil.style.background = DESTINATIONS[record.dest].veil;
		veil.style.opacity = "1";
		navigatedTo = null;
		if (typeof record.gallery === "number") {
			returnToGallery(record.gallery);
			return;
		}
		three.progressOverride = ORBIT.STEPS;
		three.lenis?.stop();
		three.scene.rewindDive(record.step);
	};

	/**
	 * Put the scroll back inside the tunnel. The override holds the picture on
	 * the plateau while the scene assembles — the scroll cannot be placed until
	 * Lenis knows how long the page is, and on a cold load that is several
	 * frames away.
	 */
	function returnToGallery(t) {
		three.galleryOverride = t;
		three.lenis?.stop();
		const since = performance.now();

		const land = () => {
			const ready = document.documentElement.dataset.sceneReady === "true";
			const patient = performance.now() - since < RETURN_PATIENCE;
			if (!ready || !three.lenis?.limit) return requestAnimationFrame(land);
			// Waiting on the textures is worth a beat and not more: see
			// RETURN_PATIENCE.
			if (patient && !three.galleryView?.ready) return requestAnimationFrame(land);

			three.lenis.start();
			three.lenis.scrollTo(three.scrollForGallery(t), {
				immediate: true,
				force: true,
			});
			// One frame between placing the scroll and dropping the override:
			// Lenis publishes its new position on the next raf, and clearing
			// the pin in the same tick would draw one frame of the wrong place.
			afterFrame(() => {
				three.galleryOverride = null;
				afterFrame(() => {
					veil.style.transition = `opacity ${GALLERY_VEIL}s ease`;
					veil.style.opacity = "0";
				});
			});
		};
		requestAnimationFrame(land);
	}

	// The page's links (the LENIA one, today), clickable on the projection.
	const pageLinks = attachPageLinks(three);

	for (const item of items) {
		if (import.meta.env.DEV && item.href && item.href !== DESTINATIONS[item.dataset.dest]?.url) {
			console.warn(`step-menu: href of "${item.dataset.dest}" differs from DESTINATIONS`);
		}
		item.addEventListener("click", (event) => {
			const dest = DESTINATIONS[item.dataset.dest];
			if (!dest || three.scene.dive) return;

			// A modified click (middle, ctrl/cmd, shift) is a request for a
			// new tab or window: the href is real, let the browser have it.
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) {
				return;
			}
			// Otherwise the dive plays first and navigates at its end.
			event.preventDefault();

			// Someone who asked for less motion gets the destination, not
			// the somersault.
			if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
				window.location.assign(dest.url);
				return;
			}

			// The scroll gives way: freeze Lenis where it stands, so the
			// orbit pose under the dive cannot move while the camera leaves.
			three.lenis?.stop();
			veil.style.background = dest.veil;
			// The veil carries the destination: the one element the dive is
			// guaranteed to end on is the one that knows where it leads.
			veil.dataset.url = dest.url;
			try {
				sessionStorage.setItem(
					RETURN_KEY,
					JSON.stringify({ step: Number(item.dataset.step), dest: item.dataset.dest }),
				);
			} catch {
				// Private mode, quota, whatever: the dive still plays, only
				// the return is ordinary. Never a reason not to go.
			}
			three.scene.startDive(Number(item.dataset.step));
		});
	}

	/* ------------------------------------------------- the gallery's photos */

	// The canvas and #app are pointer-events: none by design, so the window is
	// where the pointer actually is. Nothing here touches that.
	let pointer = null;
	let hovered = null;
	let cursor = "";

	const toNdc = (event) => ({
		// scene.width / height, not innerWidth: the scene measures itself in
		// lvw/lvh, and on mobile Safari innerHeight is the collapsing one.
		x: (event.clientX / three.scene.width) * 2 - 1,
		y: -(event.clientY / three.scene.height) * 2 + 1,
	});

	// `live` is the corridor's own answer to "am I the picture right now?" —
	// true on the plateau, false through the door on the approach (where the
	// cobalt occludes the photographs and a raycast would not know) and false
	// under the exit veil. A photograph that is not the picture is a ghost,
	// and a ghost must not be clickable.
	const galleryLive = () =>
		Boolean(three.galleryView) &&
		three.galleryView.live &&
		!three.scene.dive &&
		!navigatedTo;

	window.addEventListener("pointermove", (event) => {
		pointer = toNdc(event);
	});
	window.addEventListener("pointerleave", () => {
		pointer = null;
	});

	window.addEventListener("click", (event) => {
		if (!galleryLive()) return;
		const at = toNdc(event);
		if (!three.galleryView.pick(at.x, at.y)) return;

		const dest = DESTINATIONS.photography;
		// Someone who asked for less motion gets the portfolio, not the fade.
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
			window.location.assign(dest.url);
			return;
		}

		navigatedTo = dest.url;
		three.lenis?.stop();
		veil.style.background = dest.veil;
		try {
			// No step, so no dive to rewind on the way back — the position on
			// the plateau is the whole record. scrollForGallery turns it back
			// into a scroll offset when the visitor returns.
			sessionStorage.setItem(
				RETURN_KEY,
				JSON.stringify({ dest: "photography", gallery: three.gallery.t }),
			);
		} catch {
			// Private mode, quota, whatever: the visit still happens, only the
			// return is ordinary. Never a reason not to go.
		}
		veil.style.transition = `opacity ${GALLERY_VEIL}s ease`;
		afterFrame(() => {
			veil.style.opacity = "1";
			// Armed only once the fade has actually started, or the navigation
			// would land while the white is still a third of the way up.
			setTimeout(() => window.location.assign(dest.url), GALLERY_VEIL * 1000);
		});
	});

	// Restored from the back/forward cache: no DOMContentLoaded fires, the
	// scene is alive and still parked at the end of its dive, so this only
	// has to turn it around. persisted is false on the very first load, where
	// the cold path below has already run.
	window.addEventListener("pageshow", (event) => {
		if (!event.persisted) return;
		navigatedTo = null;
		playReturn(readReturn());
	});

	// Cold load. If there is a record, this IS a return.
	playReturn(readReturn());

	/**
	 * Glue layer, once per frame: labels onto their risers, veil onto the
	 * dive clock, and — at either end of that clock — the hand-off.
	 */
	const tick = () => {
		const { facing, steps } = three.scene.stepAnchors();
		const dive = three.scene.dive;
		pageLinks.tick();

		// Rest is progress 0 exactly (the snap lands there); the loop's other
		// end counts too, one frame before the wrap.
		const driven =
			three.progressOverride !== null || three.galleryOverride !== null;
		const p = three.scene.progress;
		const atRest = p < 0.002 || p > 0.998;
		if (driven || !atRest) cueSpent = true;
		cue.classList.toggle("is-visible", !cueSpent && atRest);
		const menuOpacity = facing * (dive ? Math.max(0, 1 - dive.t * 3) : 1);

		for (const [i, step] of steps.entries()) {
			const el = items[i];
			if (!el) continue;
			el.style.transform = `translate(-50%, -50%) translate(${step.x}px, ${step.y}px)`;
			el.style.opacity = menuOpacity.toFixed(3);
			el.style.pointerEvents =
				!dive && step.onScreen && facing > CLICKABLE_FROM ? "auto" : "none";
		}

		// The hover is resolved HERE rather than on pointermove: the corridor
		// travels under a pointer that is standing still, so the photograph it
		// is over is a fact about this frame, not about the last mouse event.
		const over = galleryLive() && pointer
			? three.galleryView.pick(pointer.x, pointer.y)
			: null;
		if (over !== hovered) {
			hovered = over;
			three.galleryView?.setHover(over);
			const want = over ? "pointer" : "";
			if (want !== cursor) {
				cursor = want;
				document.body.style.cursor = want;
			}
		}

		if (dive) {
			const raw = (dive.t - VEIL_FROM) / (1 - VEIL_FROM);
			const eased = Math.min(1, Math.max(0, raw));
			veil.style.opacity = (eased * eased * (3 - 2 * eased)).toFixed(3);

			if (dive.done && dive.direction > 0 && !navigatedTo && veil.dataset.url) {
				navigatedTo = veil.dataset.url;
				window.location.assign(navigatedTo);
			}

			if (dive.done && dive.direction < 0) {
				// Back at the step view. t is 0 here, where the dive is the
				// identity, so handing the camera back is a no-op on screen —
				// and the scroll is placed at the position the orbit itself
				// calls the step view, not at wherever the browser left it.
				three.scene.endDive();
				three.lenis?.start();
				// scrollFor, not limit × progress: the spacer carries the
				// gallery plateau, so the two stopped being the same number.
				three.lenis?.scrollTo(three.scrollFor(ORBIT.STEPS), {
					immediate: true,
					force: true,
				});
				three.progressOverride = null;
				veil.style.opacity = "0";
				veil.removeAttribute("data-url");
			}
		}

		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
});
