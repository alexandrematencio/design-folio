import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Thin promise wrapper around GLTFLoader. No Draco: glyph-alxmtnc-3d-v2.glb is
 * 28 kB uncompressed (756 vertices), so a decoder would cost more than it saves
 * and would add a third-party fetch the brand rules do not want.
 */
export function loadGltf(url) {
	return new Promise((resolve, reject) => {
		new GLTFLoader().load(url, (gltf) => resolve(gltf), undefined, reject);
	});
}

/** First mesh found in a loaded scene graph. */
export function firstMesh(root) {
	let found = null;
	root.traverse((child) => {
		if (!found && child.isMesh) found = child;
	});
	return found;
}
