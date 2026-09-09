import "./style.css";
import Three from "./core/Three";
import { ORBIT } from "./utils/utils";

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
	 * Come back into the page at the far end of a dive and play it backwards.
	 * The veil is raised SYNCHRONOUSLY, before anything else: on a cold load
	 * the scene needs a moment to rasterize the page and the first frames
	 * would otherwise flash the rest pose — the flat page — which is the one
	 * thing the return must not show.
	 */
	const playReturn = (record) => {
		if (!record || !DESTINATIONS[record.dest]) return;
		veil.style.background = DESTINATIONS[record.dest].veil;
		veil.style.opacity = "1";
		three.progressOverride = ORBIT.STEPS;
		three.lenis?.stop();
		three.scene.rewindDive(record.step);
	};

	for (const item of items) {
		item.addEventListener("click", () => {
			const dest = DESTINATIONS[item.dataset.dest];
			if (!dest || three.scene.dive) return;

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
		const menuOpacity = facing * (dive ? Math.max(0, 1 - dive.t * 3) : 1);

		for (const [i, step] of steps.entries()) {
			const el = items[i];
			if (!el) continue;
			el.style.transform = `translate(-50%, -50%) translate(${step.x}px, ${step.y}px)`;
			el.style.opacity = menuOpacity.toFixed(3);
			el.style.pointerEvents =
				!dive && step.onScreen && facing > CLICKABLE_FROM ? "auto" : "none";
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
