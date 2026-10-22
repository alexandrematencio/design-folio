import Three from "./core/Three";
import { ORBIT } from "./utils/utils";
import { Mouse } from "lucide";
import { iconSvg } from "./utils/icon";
import { attachPageLinks } from "./utils/pageLinks";
import { mountStatic } from "./static";
import { bootScene } from "./utils/bootScene";

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
	// The journal opens on its own paper, no splash: the veil is that paper.
	journal: { url: "https://blog.amatencio.com/", veil: "#fafaf8" },
	// Trailing slash: it is what `a.href` reads back, and the dev check below
	// compares the two.
	agency: { url: "https://www.aaxlo.com/", veil: "#1e1e1e" },
	photography: {
		url: "https://photo.amatencio.com/",
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
	// No WebGL: the static page (src/static.js), and none of what follows —
	// every line below drives the scene.
	const three = bootScene(() =>
		new Three(document.querySelector("#app"), {
			shading: "one-material",
			journey: true,
			// v3.html is this same entry with the copy removed and the glyph
			// in the middle: the page says so on <html data-layout>.
			layout: document.documentElement.dataset.layout ?? "default",
		}),
	);
	if (!three) {
		mountStatic();
		return;
	}

	// The return parks the scroll itself, at a position it computes. Letting
	// the browser restore its own offset a beat later would fight that and
	// spin the camera off the step view for no visible reason.
	if ("scrollRestoration" in history) history.scrollRestoration = "manual";

	const veil = document.querySelector("#dive-veil");
	// In slot order — risers top to bottom, then the floor — whatever the
	// order of the markup.
	const items = [...document.querySelectorAll(".step-menu__item")].sort(
		(a, b) => Number(a.dataset.step) - Number(b.dataset.step),
	);

	// The names are carved into the stair (scenes/StepEngravings.js), and the
	// carving is read off this very <nav>: the links crawlers follow and the
	// letters visitors see cannot drift apart. The DOM items stay, invisible,
	// as the hit targets and the keyboard's way in.
	three.scene.setMenu(
		items.map((el) => ({
			text: el.textContent.trim().toUpperCase(),
			note: el.dataset.note,
		})),
	);
	for (const [i, item] of items.entries()) {
		const on = () => three.scene.setMenuHover(i);
		const off = () => three.scene.setMenuHover(null);
		item.addEventListener("pointerenter", on);
		item.addEventListener("pointerleave", off);
		item.addEventListener("focus", on);
		item.addEventListener("blur", off);
	}
	let navigatedTo = null;

	/**
	 * THE SCROLL CUE — the hero cue of amatencio-photo, as a mouse. Shown to a
	 * visitor who lands cold on the rest frame, and only to them: a return
	 * from a dive or a photograph arrives elsewhere and is driven by an
	 * override, and a tool (shoot, flow) drives the page with no visitor at
	 * all. Alexandre, 2026-10-22: it comes BACK whenever the visitor settles
	 * at rest again — the first cut retired it for good at the first scroll,
	 * and back at the top the page looked as if it had lost its cue. Settled
	 * means CUE_SETTLE ms at rest, so a lap of the loop passing through rest
	 * does not flash it.
	 */
	const cue = document.querySelector("#scroll-cue");
	cue.innerHTML = iconSvg(Mouse, {
		width: 26,
		height: 26,
		"stroke-width": 1.5,
		class: "scroll-cue",
	});
	let cueSpent = false;
	let restSince = null;
	const CUE_SETTLE = 1200;

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

	/** The cut without a dive: the veil fades up, then the page goes. */
	function veilOut(dest, item) {
		navigatedTo = dest.url;
		three.lenis?.stop();
		veil.style.background = dest.veil;
		try {
			sessionStorage.setItem(
				RETURN_KEY,
				JSON.stringify({ step: Number(item.dataset.step), dest: item.dataset.dest }),
			);
		} catch {
			// Never a reason not to go.
		}
		veil.style.transition = `opacity ${GALLERY_VEIL}s ease`;
		afterFrame(() => {
			veil.style.opacity = "1";
			setTimeout(() => window.location.assign(dest.url), GALLERY_VEIL * 1000);
		});
	}

	for (const item of items) {
		if (import.meta.env.DEV && item.href && item.href !== DESTINATIONS[item.dataset.dest]?.url) {
			console.warn(`step-menu: href of "${item.dataset.dest}" differs from DESTINATIONS`);
		}
		item.addEventListener("click", (event) => {
			const dest = DESTINATIONS[item.dataset.dest];
			if (!dest || three.scene.dive || navigatedTo) return;

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

			// The AAXLO mark is clickable wherever it is seen, not only at the
			// menu (see the tick). Away from the step view there is no dive to
			// play — the somersault is built on the orbit's camera, and on the
			// tunnel leg another camera draws — so it whitens out the way a
			// photograph does, into the agency's first frame. The record is
			// the same as the dive's: the return lands on the menu.
			if (three.scene.stepAnchors().facing <= CLICKABLE_FROM) {
				veilOut(dest, item);
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
		// The About link sits over the corridor: its click is its own.
		if (event.target.closest?.("#about-link")) return;
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
		const now = performance.now();
		restSince = atRest && !driven ? (restSince ?? now) : null;
		const settled = restSince !== null && now - restSince > CUE_SETTLE;
		cue.classList.toggle("is-visible", atRest && !driven && (!cueSpent || settled));
		const menuOpacity = facing * (dive ? Math.max(0, 1 - dive.t * 3) : 1);

		for (const [i, step] of steps.entries()) {
			const el = items[i];
			if (!el) continue;
			el.style.transform = `translate(-50%, -50%) translate(${step.x}px, ${step.y}px)`;
			// Carved menu: the item is the label's footprint, so the click and
			// the focus ring land on the engraving itself.
			if (step.width) {
				el.style.width = `${step.width.toFixed(1)}px`;
				el.style.height = `${step.height.toFixed(1)}px`;
			}
			el.style.opacity = menuOpacity.toFixed(3);
			// The carved names take the pointer at the menu only; the AAXLO
			// mark whenever any of it can be seen (Scene.stepAnchors) — but
			// never inside the corridor, whose walls are not the stair and
			// would hide it from the eye without the raycast knowing.
			const clickable =
				"seen" in step
					? step.seen && !(three.galleryView?.live)
					: step.onScreen && facing > CLICKABLE_FROM;
			el.style.pointerEvents = !dive && !navigatedTo && clickable ? "auto" : "none";
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
