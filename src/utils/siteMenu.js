/**
 * THE SITE MENU — "Menu", top left; the row it opens.
 *
 * Asked by Alexandre on 2026-11-04: "Menu" leaves from UNDER ABOUT, on the
 * right, and runs left to its place, fast, and squishy — a straight
 * translation on the horizontal, but a body that stretches while it travels,
 * not a plate sliding on a rail. That is the word's ENTRANCE, on load. (A
 * first version ran the opened row instead; he saw "Menu" already in place
 * at load, not blinking — the run was on the wrong thing.)
 *
 * Two tracks on the same element, on the two individual properties
 * (translate and scale never overwrite each other):
 *   - translate: from About's right edge to its own, an ease that sets off
 *     at once and brakes hard;
 *   - scale: stretched along the motion while it is fast, squashed on the
 *     landing, a small rebound, at rest. Volume is kept: what the word gains
 *     in width it gives back in height (scaleY = 1 / scaleX). The pivot is
 *     the leading edge, the left: the word lands on it.
 * It comes out from under About by fading in over the first few frames.
 *
 * Opened, the items are plain TEXT (Alexandre, same day: "que du texte"),
 * no panel. They DROP: one after the other, top to bottom, each word falls
 * into its own line from just above it (the line clips it, so no word ever
 * crosses another in flight), accelerating like a weight, stretched tall while it
 * falls, squashed flat on landing, a small rebound — the same squish as the
 * word's run, turned vertical. Journal's two doors are always shown, a step
 * in. It opens on HOVER; a click only takes a final choice. Leaving the
 * trigger or the list closes after CLOSE_DELAY, which passing from one to
 * the other cancels. By finger a tap on "Menu" toggles it; by keyboard
 * Enter/Space/↓ open it and focus the first item, ↑/↓ move, Escape and Tab
 * out close it.
 * Timings in the CSS.
 * Reduced motion: no run, no unveil; the head script never hides the word.
 */

/** Delay before the run: the page's first frame is seen still, then it moves. */
const ENTER_DELAY = 350;
const RUN_MS = 820;
/** The travel ends here; the rest is the landing. */
const LAND_AT = 0.56;
/** Peak stretch mid-flight. Loud on purpose: the brief is the squish. */
const STRETCH = 1.3;
const SQUASH = 0.86;

const sx = (x) => `${x} ${(1 / x).toFixed(4)}`;

const reducedMotion = () =>
	!matchMedia("(prefers-reduced-motion: no-preference)").matches;

/** "Menu" runs out from under About, once, at load. */
function runIn(toggle) {
	const root = document.documentElement;
	const about = document.querySelector("#about-link");
	if (!root.classList.contains("menu-enter") || reducedMotion() || !about) {
		root.classList.remove("menu-enter");
		return;
	}
	setTimeout(() => {
		const dx = about.getBoundingClientRect().right - toggle.getBoundingClientRect().right;
		toggle.style.transformOrigin = "left center";
		const opts = { duration: RUN_MS, fill: "backwards" };
		const anims = [
			toggle.animate(
				[
					{ offset: 0, translate: `${dx}px 0`, easing: "cubic-bezier(0.5, 0, 0.2, 1)" },
					{ offset: LAND_AT, translate: "0 0" },
					{ offset: 1, translate: "0 0" },
				],
				opts,
			),
			toggle.animate(
				[
					{ offset: 0, scale: sx(1) },
					{ offset: LAND_AT * 0.45, scale: sx(STRETCH) },
					// Still long as it reaches its place…
					{ offset: LAND_AT, scale: sx(1.06) },
					// …flattened against it, and a small rebound.
					{ offset: LAND_AT + 0.12, scale: sx(SQUASH) },
					{ offset: LAND_AT + 0.27, scale: sx(1.05) },
					{ offset: LAND_AT + 0.38, scale: sx(0.985) },
					{ offset: 1, scale: sx(1) },
				],
				{ ...opts, easing: "linear" },
			),
			toggle.animate(
				[
					{ offset: 0, opacity: 0 },
					{ offset: 0.08, opacity: 1 },
					{ offset: 1, opacity: 1 },
				],
				opts,
			),
		];
		// The animations hold the start pose (fill: backwards) from this
		// frame on, so the CSS that hid the word can go now.
		root.classList.remove("menu-enter");
		Promise.all(anims.map((a) => a.finished)).then(
			() => anims.forEach((a) => a.cancel()),
			() => {},
		);
	}, ENTER_DELAY);
}

/** Grace before closing when the pointer leaves: the time to cross a gap. */
const CLOSE_DELAY = 150;
/** The drop: each word's fall and landing; the next one leaves STAGGER later. */
const DROP_MS = 480;
const STAGGER = 45;
/** Where the fall ends; after it, the landing. */
const HIT = 0.5;

/** Every word falls into its own line, from just above it. */
function drop(menu) {
	return [...menu.querySelectorAll(".site-menu__row > span:first-child")].flatMap((word, i) => {
		const dy = "-140%";
		const opts = { duration: DROP_MS, delay: i * STAGGER, fill: "backwards" };
		return [
			word.animate(
				[
					// Gravity: it sets off slowly and hits at full speed.
					{ offset: 0, translate: `0 ${dy}`, easing: "cubic-bezier(0.55, 0, 1, 0.45)" },
					{ offset: HIT, translate: "0 0" },
					{ offset: 1, translate: "0 0" },
				],
				opts,
			),
			word.animate(
				[
					{ offset: 0, scale: "1 1" },
					// Tall and thin as it falls…
					{ offset: HIT * 0.8, scale: "0.9 1.14" },
					// …flat and wide on the floor, then a small rebound.
					{ offset: HIT + 0.1, scale: "1.16 0.8" },
					{ offset: HIT + 0.26, scale: "0.96 1.05" },
					{ offset: HIT + 0.4, scale: "1.01 0.99" },
					{ offset: 1, scale: "1 1" },
				],
				{ ...opts, easing: "linear" },
			),
			word.animate(
				[
					{ offset: 0, opacity: 0 },
					{ offset: 0.12, opacity: 1 },
					{ offset: 1, opacity: 1 },
				],
				opts,
			),
		];
	});
}

export function mountSiteMenu() {
	const toggle = document.querySelector("#menu-toggle");
	const menu = document.querySelector("#site-menu");
	if (!toggle || !menu) return;
	runIn(toggle);

	let open = false;
	let hideTimer = 0;
	let menuTimer = 0;
	let anims = [];
	// Did the last press come from a finger or a pen? Then there is no hover.
	let touch = false;

	const isMouse = (e) => e.pointerType === "mouse";
	const stop = () => {
		anims.forEach((a) => a.cancel());
		anims = [];
	};

	function openMenu() {
		clearTimeout(menuTimer);
		if (open) return;
		open = true;
		clearTimeout(hideTimer);
		stop();
		toggle.setAttribute("aria-expanded", "true");
		menu.classList.remove("is-closing");
		menu.hidden = false;
		if (!reducedMotion()) anims = drop(menu);
	}

	function closeMenu({ focus = false } = {}) {
		clearTimeout(menuTimer);
		if (!open) return;
		open = false;
		toggle.setAttribute("aria-expanded", "false");
		menu.classList.add("is-closing");
		if (focus) toggle.focus();
		clearTimeout(hideTimer);
		hideTimer = setTimeout(
			() => {
				stop();
				menu.hidden = true;
				menu.classList.remove("is-closing");
			},
			reducedMotion() ? 0 : 170,
		);
	}

	const closeMenuSoon = () => {
		clearTimeout(menuTimer);
		menuTimer = setTimeout(closeMenu, CLOSE_DELAY);
	};

	const rows = () => [...menu.querySelectorAll("a.site-menu__row")];

	/* ------------------------------------------------------------- wiring */

	// Hover: the trigger and the list hold it open together.
	for (const el of [toggle, menu]) {
		el.addEventListener("pointerenter", (e) => isMouse(e) && openMenu());
		el.addEventListener("pointerleave", (e) => isMouse(e) && closeMenuSoon());
	}
	toggle.addEventListener("pointerdown", (e) => (touch = !isMouse(e)));
	// By finger or key it toggles; by mouse the hover already opened it, and
	// a click on "Menu" is no choice — it never closes it under the pointer.
	toggle.addEventListener("click", (e) => {
		const byKey = e.detail === 0;
		if (open && (touch || byKey)) return closeMenu();
		openMenu();
		if (byKey) rows()[0]?.focus();
	});

	menu.addEventListener("keydown", (e) => {
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		const all = rows();
		const at = all.indexOf(document.activeElement);
		e.preventDefault();
		if (e.key === "ArrowUp" && at <= 0) return toggle.focus();
		all[Math.min(all.length - 1, at + (e.key === "ArrowDown" ? 1 : -1))]?.focus();
	});
	toggle.addEventListener("keydown", (e) => {
		if (e.key !== "ArrowDown") return;
		e.preventDefault();
		openMenu();
		rows()[0]?.focus();
	});

	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && open) closeMenu({ focus: true });
	});
	// A press anywhere else closes it — the corridor's own click included.
	document.addEventListener("pointerdown", (e) => {
		if (!open) return;
		if (e.target.closest?.("#site-menu, #menu-toggle")) return;
		closeMenu();
	});
	// Focus leaving the menu by Tab closes it too.
	menu.addEventListener("focusout", (e) => {
		if (!open || !e.relatedTarget) return;
		if (e.relatedTarget.closest?.("#site-menu, #menu-toggle")) return;
		closeMenu();
	});
}
