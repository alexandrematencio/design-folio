/**
 * The AAXLO mark, as the page builds it, out to an OBJ for the studio bake.
 *
 * The word is extruded from its SVG at load (scenes/AaxloMark.js) and placed
 * on the floor in the STAIR's coordinates. tools/bake-glyph-studio.py has to
 * stand the very same solid on its floor, or the shade it bakes around the
 * word lands beside it. So rather than rebuild it in Blender from the SVG,
 * this asks the running page for it: every triangle, in the stair's own
 * (glTF) space, which is the space the bake works in.
 *
 *   npm run dev                         # in another shell
 *   node tools/export-aaxlo-mark.mjs    # -> tools/aaxlo-mark.obj
 *
 * Re-run it, and the bake, whenever the mark moves or changes shape.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL = process.argv[2] ?? "http://localhost:5180/v3.html";
const CHROME =
	process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
	executablePath: CHROME,
	headless: "new",
	args: ["--use-gl=angle", "--use-angle=metal"],
});
try {
	const page = await browser.newPage();
	await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
	await page.waitForFunction(() => document.documentElement.dataset.sceneReady === "true", {
		timeout: 30000,
	});
	const tris = await page.evaluate(() => {
		const scene = window.__three.scene;
		const glyph = scene.glyph;
		glyph.updateMatrixWorld(true);
		const toGlyph = glyph.matrixWorld.clone().invert();
		const out = [];
		for (const { mesh } of scene.mark.parts) {
			const m = toGlyph.clone().multiply(mesh.matrixWorld);
			const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
			const p = g.getAttribute("position");
			for (let i = 0; i < p.count; i++) {
				const e = new glyph.position.constructor(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
				out.push(e.x, e.y, e.z);
			}
		}
		return out;
	});
	const lines = ["# AAXLO mark, stair (glTF) space — tools/export-aaxlo-mark.mjs"];
	for (let i = 0; i < tris.length; i += 3) {
		lines.push(`v ${tris[i].toFixed(5)} ${tris[i + 1].toFixed(5)} ${tris[i + 2].toFixed(5)}`);
	}
	// The extrusion's winding is flipped by the mark's negative scale; the
	// bake does not care which way a face points, only that it blocks light.
	for (let f = 1; f <= tris.length / 3; f += 3) lines.push(`f ${f} ${f + 1} ${f + 2}`);
	const out = path.join(ROOT, "tools", "aaxlo-mark.obj");
	await writeFile(out, lines.join("\n") + "\n");
	console.log(`wrote ${path.relative(ROOT, out)}: ${tris.length / 9} triangles`);
} finally {
	await browser.close();
}
