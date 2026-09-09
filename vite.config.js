import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	// Root deploy. For GitHub Pages under a repo path, set this to
	// "/<repo-name>/" — every asset URL in the app goes through
	// import.meta.env.BASE_URL, so this is the only line to change.
	base: "/",
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
			},
		},
	},
});
