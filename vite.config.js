import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { bakeCuration, MANIFEST } from "./tools/curation.mjs";
import { bakeHubSeo, readHubSeo } from "./tools/hub-seo.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * THE CURATION, KEPT CURRENT WITHOUT A COMMAND.
 *
 * The photographs of the tunnel are baked (tools/curation.mjs says why), and a
 * bake that has to be remembered is a bake that is forgotten: the funnel
 * curation was edited in the Studio and the corridor went on showing the old
 * one. So the bake runs itself —
 *   - dev: at server start, then before serving every PAGE (not every asset),
 *     at most once every two seconds. Reload the page, see the Studio's list.
 *   - build: once, before bundling.
 * A failure (offline, Sanity down, an incomplete photo) is a warning, never a
 * broken page: the files already on disk are served as they are.
 *
 * `virtual:curation` hands the manifest to scenes/Gallery.js AT IMPORT TIME:
 * the corridor's length — rows, GALLERY.VH, the spacer — follows the number
 * of photographs and must be known before the first frame, not when a fetch
 * lands. The static page (src/static.js) still fetches /curation.json, the
 * same file.
 */
function curation() {
	const ID = "virtual:curation";
	const RESOLVED = `\0${ID}`;
	let server = null;
	let running = null;
	let nextAt = 0;

	function bake() {
		if (running) return running;
		if (Date.now() < nextAt) return Promise.resolve();
		running = (async () => {
			let ok = true;
			try {
				const r = await bakeCuration({ log: (m) => console.log(`[curation] ${m}`) });
				if (r.changed) {
					console.log(`[curation] ${r.count} photos — public/curation.json updated`);
					const mod = server?.moduleGraph.getModuleById(RESOLVED);
					if (mod) server.moduleGraph.invalidateModule(mod);
				}
			} catch (error) {
				ok = false;
				console.warn(`[curation] not refreshed, serving public/curation.json as it is — ${error.message}`);
			} finally {
				// After a failure, leave the network alone for a while: an
				// offline laptop must not pay the timeout on every reload.
				nextAt = Date.now() + (ok ? 2000 : 30000);
				running = null;
			}
		})();
		return running;
	}

	return {
		name: "curation",
		resolveId(id) {
			return id === ID ? RESOLVED : null;
		},
		async load(id) {
			if (id !== RESOLVED) return null;
			const raw = await readFile(MANIFEST, "utf8").catch(() => null);
			const photos = raw ? (JSON.parse(raw).photos ?? []) : [];
			return `export default ${JSON.stringify(photos)};`;
		},
		async buildStart() {
			await bake();
		},
		configureServer(s) {
			server = s;
			s.middlewares.use(async (req, _res, next) => {
				const page = req.method === "GET" && (req.headers.accept ?? "").includes("text/html");
				if (page) await bake();
				next();
			});
		},
	};
}

/**
 * WHAT GOOGLE SHOWS OF THE DOOR, from the Studio (tools/hub-seo.mjs says
 * where). The title and description of v3.html are placeholders —
 * __HUB_TITLE__, __HUB_DESCRIPTION__ — filled here from tools/hub-seo.json,
 * which is refreshed at dev start and before a build. Offline, the file on
 * disk is used as it is. The other pages are left alone.
 */
function hubSeo() {
	const escape = (s) =>
		s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const refresh = () =>
		bakeHubSeo({ log: (m) => console.log(`[hub-seo] ${m}`) }).catch((error) =>
			console.warn(`[hub-seo] not refreshed, using tools/hub-seo.json as it is — ${error.message}`),
		);
	return {
		name: "hub-seo",
		async buildStart() {
			await refresh();
		},
		configureServer() {
			refresh();
		},
		transformIndexHtml: {
			order: "pre",
			async handler(html) {
				if (!html.includes("__HUB_TITLE__")) return html;
				const seo = await readHubSeo();
				return html
					.replaceAll("__HUB_TITLE__", escape(seo.title))
					.replaceAll("__HUB_DESCRIPTION__", escape(seo.description));
			},
		},
	};
}

export default defineConfig({
	// Root deploy. For GitHub Pages under a repo path, set this to
	// "/<repo-name>/" — every asset URL in the app goes through
	// import.meta.env.BASE_URL, so this is the only line to change.
	base: "/",
	plugins: [curation(), hubSeo()],
	build: {
		// The .hdr is binary and must stay a file; Vite would otherwise
		// inline small assets as base64 and RGBELoader cannot read that.
		assetsInlineLimit: 0,
		rollupOptions: {
			// Two pages, two inking rules for the same solid. index.html is
			// the version that shipped; v2.html is the one where the white is
			// a highlight rather than a colour. Same copy, same geometry, same
			// orbit — the only difference is how the light is read.
			input: {
				main: resolve(__dirname, "index.html"),
				v2: resolve(__dirname, "v2.html"),
				// v2 with the copy taken out: the title, "(scroll)", and the
				// glyph in the middle of the frame (Scene.js, LAYOUT_CENTRED).
				// THE DOOR of amatencio.com: Caddy serves it at /.
				v3: resolve(__dirname, "v3.html"),
			},
		},
	},
});
