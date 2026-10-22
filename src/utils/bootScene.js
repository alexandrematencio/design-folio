/**
 * Starts the scene, or says it cannot.
 *
 * Two gates, because they fail at different moments:
 *   1. the inline probe in the page's <head> already decided, before the
 *      first paint, whether a WebGL context can be made — `is-3d` on <html>.
 *      Without it there is nothing to try: the layout is already static.
 *   2. the renderer itself can still throw (a context that probed fine and
 *      is refused a moment later: too many contexts, a GPU reset, a
 *      blocklist that answers late). Then the canvas three appended is
 *      removed and the layout is handed back to the static page.
 *
 * Returns the running Three, or null: the caller mounts the static page.
 */
export function bootScene(create) {
	const root = document.documentElement;
	if (!root.classList.contains("is-3d")) return null;

	const three = create();
	try {
		three.run();
		return three;
	} catch (error) {
		console.warn("scene: WebGL refused, falling back to the static page", error);
		three.container?.replaceChildren();
		root.classList.remove("is-3d");
		return null;
	}
}
