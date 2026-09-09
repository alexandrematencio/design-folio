/**
 * lucide, serialised. The brand's icon library is lucide (amatencio-photo
 * draws its scroll cue and its lightbox chrome from lucide-react); this page
 * has no React, and one of its icons is not even DOM — it is a texture on the
 * corridor's floor. So the icon NODE is taken from the vanilla package and
 * written out as an SVG string here, once, for both uses.
 *
 * The attributes are lucide's own defaults (24 box, 2 stroke, round caps and
 * joins, currentColor), overridable per call the way the React props are.
 */
const DEFAULTS = {
	xmlns: "http://www.w3.org/2000/svg",
	width: 24,
	height: 24,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	"stroke-width": 2,
	"stroke-linecap": "round",
	"stroke-linejoin": "round",
};

const attrs = (o) =>
	Object.entries(o)
		.map(([k, v]) => ` ${k}="${String(v).replace(/"/g, "&quot;")}"`)
		.join("");

/**
 * @param {import("lucide").IconNode} node  e.g. `Mouse` from "lucide"
 * @param {Record<string, string | number>} [overrides]
 * @returns {string} an <svg> element
 */
export function iconSvg(node, overrides = {}) {
	const inner = node.map(([tag, a]) => `<${tag}${attrs(a)}/>`).join("");
	return `<svg${attrs({ ...DEFAULTS, ...overrides })}>${inner}</svg>`;
}

/** The same, as a URL an <img> or a TextureLoader can open. */
export const iconDataUrl = (node, overrides) =>
	`data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(node, overrides))}`;
