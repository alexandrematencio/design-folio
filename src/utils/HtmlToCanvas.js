import * as THREE from "three";

/**
 * Rasterizes a live HTMLElement into a <canvas>, and exposes it as a
 * THREE.CanvasTexture.
 *
 * The route is the classic one: clone the element into an
 * <svg><foreignObject>, serialize that to a data URL, decode it as an <img>,
 * drawImage it. A hand-rolled stand-in for the WICG html-in-canvas proposal
 * (https://github.com/WICG/html-in-canvas), which will make all of this a
 * two-line call one day.
 *
 * Known limits, shared by every foreignObject rasterizer:
 *   - the SVG runs sandboxed: no network, so CSS and fonts must be inlined
 *     (see collectDocumentCss.js)
 *   - <img> sources must already be data URIs
 *   - it is a still. Nothing under the element may rely on :hover or motion.
 */
export default class HtmlToCanvas {
	constructor(element, { width, height, pixelRatio = 2 } = {}) {
		this.element = element;
		this.pixelRatio = pixelRatio;
		this.extraCss = "";

		this.canvas = document.createElement("canvas");
		this.ctx = this.canvas.getContext("2d");

		this.texture = new THREE.CanvasTexture(this.canvas);
		this.texture.colorSpace = THREE.SRGBColorSpace;
		this.texture.minFilter = THREE.LinearFilter;
		this.texture.magFilter = THREE.LinearFilter;
		this.texture.generateMipmaps = false;
		this.texture.anisotropy = 1;

		this._rendering = false;
		this._pending = false;
		this._current = null;

		this.resize(width ?? window.innerWidth, height ?? window.innerHeight);
	}

	resize(width, height) {
		this.width = width;
		this.height = height;
	}

	/**
	 * Coalescing: a burst of update() calls collapses into one extra pass at
	 * the end. Two decodes of a full-page SVG racing each other is the one way
	 * to make this visibly stutter.
	 */
	async update() {
		if (this._rendering) {
			this._pending = true;
			return this._current;
		}

		this._rendering = true;
		this._current = (async () => {
			try {
				do {
					this._pending = false;
					await this.#rasterizeOnce();
				} while (this._pending);
			} finally {
				this._rendering = false;
				this._current = null;
			}
		})();

		return this._current;
	}

	async #rasterizeOnce() {
		const nextW = Math.floor(this.width * this.pixelRatio);
		const nextH = Math.floor(this.height * this.pixelRatio);

		if (nextW !== this.canvas.width || nextH !== this.canvas.height) {
			this.canvas.width = nextW;
			this.canvas.height = nextH;
			// The GPU texture was allocated for the OLD canvas size. Without
			// this dispose, three keeps that allocation and tries a sub-image
			// upload into it: GL_INVALID_VALUE, "Offset overflows texture
			// dimensions", the texture stays empty, and the page projects as
			// transparent black — the scene renders correctly and shows
			// nothing. Costs one reallocation per resize, which is the price.
			this.texture.dispose();
		}

		const img = new Image();
		img.src = this.#buildSvgDataUrl();
		await img.decode();

		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
		this.texture.needsUpdate = true;
	}

	#buildSvgDataUrl() {
		const serialized = new XMLSerializer().serializeToString(this.element);
		const styleBlock = this.extraCss
			? `<style xmlns="http://www.w3.org/1999/xhtml">/*<![CDATA[*/${this.extraCss}/*]]>*/</style>`
			: "";

		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}">
			<foreignObject width="100%" height="100%">
				<div xmlns="http://www.w3.org/1999/xhtml" style="width:${this.width}px;height:${this.height}px;">
					${styleBlock}
					${serialized}
				</div>
			</foreignObject>
		</svg>`;

		return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
	}

	dispose() {
		this.texture.dispose();
	}
}
