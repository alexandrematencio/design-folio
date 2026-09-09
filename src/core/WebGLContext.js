import * as THREE from "three";

/**
 * Owns the renderer and the canvas. Singleton: the scene asks it for the
 * viewport size, and nobody else may create a second WebGL context.
 */
class WebGLContext {
	constructor(container) {
		if (WebGLContext.instance) return WebGLContext.instance;

		this.container = container;
		this.renderer = null;
		this.canvas = null;
		this.fullScreenDimensions = { width: 0, height: 0 };
		this.pixelRatio = Math.min(window.devicePixelRatio, 2);

		WebGLContext.instance = this;
	}

	init() {
		this.#createCanvas();
		this.#setUpRenderer();
	}

	#createCanvas() {
		this.canvas = document.createElement("canvas");
		this.canvas.style.position = "fixed";
		this.canvas.style.inset = "0";
		this.canvas.style.display = "block";
		this.canvas.style.pointerEvents = "none";
		this.canvas.setAttribute("aria-hidden", "true");
		(this.container ?? document.body).appendChild(this.canvas);
	}

	#setUpRenderer() {
		this.renderer = new THREE.WebGLRenderer({
			canvas: this.canvas,
			antialias: true,
		});

		this.fullScreenDimensions = this.getFullScreenDimensions();
		this.renderer.setSize(
			this.fullScreenDimensions.width,
			this.fullScreenDimensions.height,
		);
		this.renderer.setPixelRatio(this.pixelRatio);

		this.renderer.shadowMap.enabled = true;
		// VSM rather than PCF: the hero glyph is small and its shadow lands
		// on surfaces tens of units away, so a percentage-closer filter
		// resolves it as a jagged blob. VSM blurs in shadow-map space, which
		// is what gives paper its soft contact shadow.
		this.renderer.shadowMap.type = THREE.VSMShadowMap;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;

		// NoToneMapping on purpose. At rest the projected page must come out of
		// the pipeline byte-identical to the CSS it was rasterized from — any
		// tone curve would shift #FAFAF8 and break the illusion of flatness.
		this.renderer.toneMapping = THREE.NoToneMapping;
	}

	/**
	 * lvh/lvw rather than innerHeight: on mobile Safari innerHeight follows the
	 * collapsing address bar, which would resize the canvas mid-scroll and
	 * force a re-rasterization of the page on every frame.
	 */
	getFullScreenDimensions() {
		const probe = document.createElement("div");
		probe.style.cssText =
			"position:absolute;visibility:hidden;width:100lvw;height:100lvh;";
		document.body.appendChild(probe);
		const width = probe.offsetWidth;
		const height = probe.offsetHeight;
		document.body.removeChild(probe);
		return { width, height };
	}

	onResize(width, height) {
		this.pixelRatio = Math.min(window.devicePixelRatio, 2);
		this.renderer.setSize(width, height);
		this.renderer.setPixelRatio(this.pixelRatio);
	}
}

export default WebGLContext;
