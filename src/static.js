/**
 * THE STATIC PAGE — what a browser that cannot draw the scene gets.
 *
 * LibreWolf ships with WebGL off; Tor Browser, a hardened Firefox, a locked
 * corporate Chrome, an old GPU on a blocklist all do the same. For them the
 * stylesheet's DEFAULT layout is the page: the hero in the document flow, the
 * glyph as its own SVG at the rest pose's exact spot (#static-glyph), and
 * below the fold the Selected Works as a plain grid (#static-gallery). The
 * inline probe in each page's <head> is what decides, before the first paint:
 * it adds `is-3d` to <html> only when a WebGL context can be made, and every
 * rule that belongs to the scene is scoped under that class.
 *
 * This module is the little that still needs JavaScript on the static side:
 *   - the scroll cue (the same mouse the scene shows at rest), so the fold
 *     below the horizon is announced the same way on both paths;
 *   - the gallery grid, read from curation.json — the same file the corridor
 *     hangs its photographs from, so the two never drift apart.
 *
 * Nothing here moves except the cue's own CSS float, and nothing here needs a
 * canvas: it has to run everywhere the scene does not.
 */
import { Mouse } from "lucide";
import { iconSvg } from "./utils/icon";

/** Same file the corridor reads (scenes/Gallery.js). */
const CURATION_URL = "/curation.json";

export function mountStatic({ curation = CURATION_URL } = {}) {
	const root = document.documentElement;
	root.classList.remove("is-3d");
	root.classList.add("is-static");

	mountCue();
	mountGallery(curation).catch((error) => {
		// The grid is the only thing at stake; the page above it is already
		// on screen and the link to the portfolio is in the markup.
		console.warn("static gallery: curation not loaded", error);
	});
}

/**
 * The cue: shown at once — there is no scene to wait for — and retired at
 * the first scroll, like the scene's own. Created when the page has none
 * (index.html), so both entries announce the fold the same way.
 */
function mountCue() {
	let cue = document.getElementById("scroll-cue");
	if (!cue) {
		cue = document.createElement("div");
		cue.id = "scroll-cue";
		cue.setAttribute("aria-hidden", "true");
		document.body.appendChild(cue);
	}
	cue.innerHTML = iconSvg(Mouse, {
		width: 26,
		height: 26,
		"stroke-width": 1.5,
		class: "scroll-cue",
	});

	// A visitor restored mid-page (reload, back) is past the fold already.
	if (window.scrollY > 0) return;
	cue.classList.add("is-visible");
	window.addEventListener(
		"scroll",
		() => cue.classList.remove("is-visible"),
		{ once: true, passive: true },
	);
}

/**
 * The grid: one link per photograph, all to the portfolio — the corridor's
 * own rule (every picture is a door to the same place). The destination is
 * read off the section's "whole portfolio" link, so the URL lives once, in
 * the markup, where a crawler finds it without running anything.
 */
async function mountGallery(url) {
	const grid = document.querySelector("#static-gallery .gallery__grid");
	if (!grid) return;
	const all = document.querySelector("#static-gallery .gallery__all");
	const href = all?.href ?? "#";

	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	const { photos } = await response.json();

	const fragment = document.createDocumentFragment();
	for (const photo of photos) {
		const link = document.createElement("a");
		link.className = "gallery__item";
		link.href = href;

		const img = document.createElement("img");
		img.src = photo.src;
		img.alt = photo.title;
		// Intrinsic size up front: the grid lays out before a byte of image
		// has arrived, and nothing jumps when they land.
		img.width = photo.width;
		img.height = photo.height;
		img.loading = "lazy";
		img.decoding = "async";

		const caption = document.createElement("span");
		caption.className = "gallery__caption";
		caption.textContent = photo.title;

		link.append(img, caption);
		fragment.appendChild(link);
	}
	grid.replaceChildren(fragment);
}
