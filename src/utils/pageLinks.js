/**
 * The page's links, made clickable ON the projection.
 *
 * The copy under #page is rasterized into a texture, so the <a> the visitor
 * sees is ink on a wall: no pointer ever reaches it. This keeps a transparent
 * proxy <a> over each of its line boxes, exactly where the scene says that
 * box is on screen this frame (Scene.pageLinkAnchors — the same mapping that
 * prints it), and arms it only while the text is readable: page opaque, box
 * in frame on a surface facing the eye, nothing of the solid in front, no
 * dive running.
 *
 * A proxy is a real <a> with the same href, target and rel, so middle-click,
 * "open in new tab" and the status-bar URL all behave. It is aria-hidden and
 * out of the tab order: the semantic link is the one under #page, which stays
 * in the accessibility tree, is reachable with the keyboard, and is the one
 * crawlers read.
 *
 *   const links = attachPageLinks(three)
 *   const tick = () => { links.tick(); requestAnimationFrame(tick) }
 */

/** Below this page opacity the text is not readable, so it is not a link. */
const READABLE_FROM = 0.5;

export function attachPageLinks(three) {
	const layer = document.getElementById("page-links");
	if (!layer) return { tick() {} };

	/** One proxy per line box, in the scene's order. */
	let proxies = [];

	// Rebuilt only when the scene's list changes — a resize re-lays the page
	// out and a wrapped link may gain or lose a line. Compared by source
	// element and count; per frame that is a loop over three or four items.
	const sync = (links) => {
		const same =
			links.length === proxies.length &&
			links.every((l, i) => l.el === proxies[i].source);
		if (same) return;
		for (const proxy of proxies) proxy.remove();
		proxies = links.map(({ el }) => {
			const proxy = document.createElement("a");
			proxy.className = "page-link";
			proxy.href = el.href;
			if (el.target) proxy.target = el.target;
			if (el.rel) proxy.rel = el.rel;
			proxy.setAttribute("aria-hidden", "true");
			proxy.tabIndex = -1;
			proxy.source = el;
			layer.appendChild(proxy);
			return proxy;
		});
	};

	const tick = () => {
		const scene = three.scene;
		if (!scene?.pageLinkAnchors) return;
		const { opacity, links } = scene.pageLinkAnchors();
		sync(links);

		const armed = opacity >= READABLE_FROM && !scene.dive;
		for (const [i, link] of links.entries()) {
			const proxy = proxies[i];
			proxy.style.transform = `translate(${link.x}px, ${link.y}px)`;
			proxy.style.width = `${link.width}px`;
			proxy.style.height = `${link.height}px`;
			proxy.style.pointerEvents = armed && link.onScreen ? "auto" : "none";
		}
	};

	return { tick };
}
