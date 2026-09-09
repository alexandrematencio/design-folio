import Three from "./core/Three";
import { attachPageLinks } from "./utils/pageLinks";

// style.css is linked from index.html's head, not imported here: the DOM
// page is on screen from the first paint and has to be styled by then.

document.addEventListener("DOMContentLoaded", () => {
	const container = document.querySelector("#app");
	const three = new Three(container);
	three.run();

	// The page's links, clickable on the projection. index.html has none
	// today; the layer costs nothing and is there the day it gets one.
	const links = attachPageLinks(three);
	const tick = () => {
		links.tick();
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
});
