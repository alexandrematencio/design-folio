/**
 * Deterministic frames of the scroll loop, plus the one check that matters.
 *
 * The scene is driven by Lenis, so there is no way to ask it from outside for
 * "the frame at 33 % of the loop". This pins Three.progressOverride, lets the
 * app's own rAF run a few frames, and captures. Same numbers every run, so a
 * regression shows up as a diff instead of as a feeling.
 *
 *   npm run dev                     # in another shell
 *   node tools/shoot.mjs
 *   node tools/shoot.mjs --width 430 --height 930 --out tools/shots/narrow
 *   npm run shoot:v2                # the one-material page, wedge asserted
 *   node tools/shoot.mjs --url http://localhost:5180/v2.html --gallery \
 *     --out tools/shots/gallery     # the plateau: both seams and the ride
 *
 * THE REST-FRAME CHECK
 * At progress 0 the render camera and the projector camera coincide and
 * uLitness is 0, so the WebGL frame must be byte-identical to the CSS it was
 * rasterized from: #FAFAF8 paper, #0A0A0A ink, #0013FF cobalt — and, on the
 * one-material page, #BDBED9 for the wedge under the bottom step. Nothing
 * else in quantity. That equality IS the illusion — if it drifts, the page
 * stops looking flat and starts looking like a render of a page. It is easy
 * to break by accident and almost impossible to see by eye, so it is asserted
 * here rather than trusted. It already caught one: decoding the sRGB canvas
 * texture by hand when the sampler already does it in hardware — paper came
 * out #F4F4EF and ink #010101, which reads as "a bit flat", not as a bug.
 *
 * Uses the Chrome already on the machine — puppeteer-core, no 300 MB download.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const CHROME =
	process.env.CHROME_PATH ??
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const args = Object.fromEntries(
	process.argv
		.slice(2)
		.join(" ")
		.matchAll(/--([\w-]+)(?:[= ]([^-\s][^\s]*))?/g)
		.map((m) => [m[1], m[2] ?? true]),
);

const URL = args.url ?? "http://localhost:5180/";
const WIDTH = Number(args.width ?? 1600);
const HEIGHT = Number(args.height ?? 1000);
const OUT = path.join(ROOT, args.out ?? "tools/shots");

// Rest, the first flinch out of flatness, the two poses that matter (steps
// square on at 0.125, the back at 0.625) and two points in between.
//
// The last three are the JOURNEY'S TURNS. 0.376 is the middle of ALIGN,
// h = 0.260, which used to lean 19.8 degrees and now must be dead LEVEL:
// ALIGN is the orbit's own turn winding down and carries no bank any more.
// 0.731 / 0.774 straddle SWEEP's peak (28 degrees at h = 0.68 on the render
// camera, fading to zero by LAND): on v2 the horizon in those two must be
// visibly off level, the same way in both, and the scene whole, not sheared.
// On v1 they are ordinary orbit poses and prove nothing; they cost a
// screenshot.
const FRAMES = [0, 0.02, 0.04, 0.07, 0.125, 0.3, 0.5, 0.625, 0.376, 0.731, 0.774];

// --gallery: the plateau, sampled where the answers are. g002 is the first
// step past the door — the conduit must be behind and the frame all corridor.
// g050 is the middle of the ride, where the four walls must all be carrying
// photographs. g094..g098 is the exit veil: the lattice out, then paper
// thinning onto the cyclorama, and nothing moving through either.
const GALLERY_FRAMES = [0.02, 0.06, 0.1, 0.5, 0.9, 0.94, 0.98];

// The APPROACH, in progress rather than plateau position: the door seen from
// inside the conduit. h = 0.58 and 0.61 of the journey's leg (JOURNEY.FROM +
// h × 0.675), where the camera is 0.11 bore widths BEFORE the bore's centre and
// 0.59 past it — cobalt walls all round, the corridor carrying on through the
// exit rectangle. This is the frame the whole rewrite exists for: one picture,
// one depth, no ghost. (The two depths moved when the traverse stopped being
// one S-curve: at a flat cruise the same progress is a different place.)
const DOOR_FRAMES = [0.5915, 0.61175];

const BRAND = {
	paper: [250, 250, 248],
	ink: [10, 10, 10],
	cobalt: [0, 19, 255],
	// #2E3191 at 30 % over the paper: the pale wedge, and the third value of
	// the vector file. Only v2.html draws it, so --pale asserts it is there.
	// It has to be asserted rather than tolerated: it is the whole point of
	// that page, it is 0.25 % of the frame, and it would vanish in silence.
	bounce: [189, 190, 217],
};

// Measured, not chosen. The wedge is 1.44 % of the SVG, the logo's ink covers
// 18.1 % of a 1600 x 1000 frame, and 0.0144 x 0.181 = 0.26 %. Landing on it is
// how you know the veil found the right face and not some other one.
const BOUNCE_SHARE = { min: 0.0018, max: 0.0035 };

// Face centroids in glTF object space, one per family, each nudged well
// inside the part of its face that the rest view can actually see. The wedge
// is only visible near its bottom-front corner (z - y >= 1.5, from tracing
// the (1,1,1) rays against the overhang), hence the odd point.
const LIT_PROBES = {
	wedge: [-1, -1.25, 0.85],
	front: [-0.5, 0, 1],
	riser: [1, 0, 0],
	tread: [-0.5, 1.5, 0],
	lowTread: [1.5, -0.5, 0],
};
// What the lit render must produce at the rest angle: the SVG's own values.
const LIT_TARGETS = {
	wedge: { target: [189, 190, 217], tol: 30 },
	front: { target: [0, 19, 255], tol: 45 },
	riser: { target: [0, 19, 255], tol: 45 },
	tread: { target: [250, 250, 248], tol: 20 },
	lowTread: { target: [250, 250, 248], tol: 20 },
};

const browser = await puppeteer.launch({
	executablePath: CHROME,
	headless: "new",
	args: ["--use-gl=angle", "--use-angle=metal", "--hide-scrollbars"],
});

let failed = false;

try {
	await mkdir(OUT, { recursive: true });
	const page = await browser.newPage();
	await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

	const problems = [];
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") {
			problems.push(`${m.type()}: ${m.text()}`);
		}
	});
	page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

	await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
	await page.waitForFunction(
		() => document.documentElement.dataset.sceneReady === "true",
		{ timeout: 30000 },
	);

	/* ------------------------------------------------ the rest-frame check */

	const rest = await page.evaluate(async () => {
		const three = window.__three;
		three.paused = false;
		three.progressOverride = 0;
		for (let i = 0; i < 3; i++) {
			await new Promise((r) => requestAnimationFrame(r));
		}

		const renderer = three.context.renderer;
		const gl = renderer.getContext();
		// Read in the same task as the render: the drawing buffer is not
		// preserved, so anything later comes back empty.
		renderer.render(three.scene.scene, three.scene.camera);
		const w = gl.drawingBufferWidth;
		const h = gl.drawingBufferHeight;
		const buf = new Uint8Array(w * h * 4);
		gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);

		const tally = new Map();
		for (let i = 0; i < w * h; i++) {
			const key = `${buf[i * 4]},${buf[i * 4 + 1]},${buf[i * 4 + 2]}`;
			tally.set(key, (tally.get(key) ?? 0) + 1);
		}
		const total = w * h;
		return {
			litness: three.scene.litness.value,
			top: [...tally.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 12)
				.map(([colour, n]) => ({ colour, share: +(n / total).toFixed(5) })),
		};
	});

	const keys = Object.fromEntries(
		Object.entries(BRAND).map(([name, rgb]) => [name, rgb.join(",")]),
	);
	const exact = Object.fromEntries(
		Object.entries(keys).map(([name, key]) => [
			name,
			rest.top.find((t) => t.colour === key)?.share ?? 0,
		]),
	);
	// Everything that is neither paper, ink nor cobalt is an edge: the
	// antialiasing of the type and the 0.012 chamfer of the glyph. Edges are
	// a rim, so no single in-between value may hold a real share of the frame.
	// The test is on the LARGEST intruder rather than on their sum, because
	// their sum is a function of viewport size — a phone renders the same page
	// with proportionally more edge — while a colour-space or tone-mapping
	// slip moves the whole paper to ONE wrong value and shows up instantly.
	const strays = rest.top.filter((t) => !Object.values(keys).includes(t.colour));
	const worstStray = strays[0] ?? { colour: "-", share: 0 };

	console.log("rest frame");
	console.log(`  uLitness        ${rest.litness}`);
	for (const [name, share] of Object.entries(exact)) {
		console.log(`  ${name.padEnd(15)} ${(share * 100).toFixed(2)} %`);
	}
	console.log(
		`  largest stray   ${(worstStray.share * 100).toFixed(2)} %  (${worstStray.colour})`,
	);

	const wantsBounce = Boolean(args.pale);
	const bounceWrong =
		wantsBounce &&
		(exact.bounce < BOUNCE_SHARE.min || exact.bounce > BOUNCE_SHARE.max);
	if (wantsBounce) {
		console.log(
			`  wedge           ${(exact.bounce * 100).toFixed(2)} % ` +
				`(expected ${(BOUNCE_SHARE.min * 100).toFixed(2)}` +
				` .. ${(BOUNCE_SHARE.max * 100).toFixed(2)} %)`,
		);
	}

	const wrong =
		rest.litness !== 0 ||
		exact.paper < 0.4 ||
		exact.cobalt < 0.01 ||
		exact.ink < 0.004 ||
		bounceWrong ||
		worstStray.share > 0.02;

	if (wrong) {
		failed = true;
		console.log(
			bounceWrong
				? "\n  FAIL — the wedge is the wrong size, so it is on the wrong face."
				: "\n  FAIL — the rest frame is no longer the flat page.",
		);
		console.log("  top colours:", JSON.stringify(rest.top.slice(0, 6)));
	} else {
		console.log("  PASS — byte-identical to the CSS.");
	}

	/* -------------------------------------------------- the lit-frame check */
	// Only on the one-material page. Force the LIT skin at the rest angle and
	// read one face of each family. This is the page's second contract: the
	// physical render, at the angle the logo was drawn at, must land on the
	// logo's own values BY ITSELF — because from here on every tint is a live
	// reflection, and the crossfade from the flat skin has to be invisible.
	// Probe points are face centroids in glTF object space, nudged into the
	// visible part of each face under the (1,1,1) view.
	if (wantsBounce) {
		const lit = await page.evaluate(async (points) => {
			const three = window.__three;
			three.scene.litnessOverride = 1;
			three.progressOverride = 0;
			for (let i = 0; i < 3; i++) {
				await new Promise((r) => requestAnimationFrame(r));
			}
			const renderer = three.context.renderer;
			const gl = renderer.getContext();
			renderer.render(three.scene.scene, three.scene.camera);
			const w = gl.drawingBufferWidth;
			const h = gl.drawingBufferHeight;
			const buf = new Uint8Array(w * h * 4);
			gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);

			const scene = three.scene;
			const out = {};
			for (const [name, [x, y, z]] of Object.entries(points)) {
				const p = scene.glyph.position.clone().set(x, y, z);
				scene.glyph.localToWorld(p);
				p.project(scene.restCamera);
				// readPixels row 0 is the BOTTOM of the frame, same as NDC.
				const px = Math.round(((p.x + 1) / 2) * w);
				const py = Math.round(((p.y + 1) / 2) * h);
				const rgb = [0, 0, 0];
				let n = 0;
				for (let dy = -2; dy <= 2; dy++) {
					for (let dx = -2; dx <= 2; dx++) {
						const i = ((py + dy) * w + (px + dx)) * 4;
						rgb[0] += buf[i];
						rgb[1] += buf[i + 1];
						rgb[2] += buf[i + 2];
						n++;
					}
				}
				out[name] = rgb.map((v) => Math.round(v / n));
			}
			three.scene.litnessOverride = null;
			return out;
		}, LIT_PROBES);

		console.log("\nlit frame (uLitness forced to 1, rest angle)");
		let litWrong = false;
		for (const [name, { target, tol }] of Object.entries(LIT_TARGETS)) {
			const got = lit[name];
			const off = Math.max(...got.map((v, i) => Math.abs(v - target[i])));
			const ok = off <= tol;
			litWrong ||= !ok;
			console.log(
				`  ${name.padEnd(9)} rgb(${got.join(",")})  target rgb(${target.join(",")}) ±${tol}  ${ok ? "ok" : `OFF by ${off}`}`,
			);
		}
		if (litWrong) {
			failed = true;
			console.log("  FAIL — the physical render no longer lands on the logo.");
		} else {
			console.log("  PASS — the room paints the logo on its own.");
		}
	}

	/* ------------------------------------------------------------- frames */

	for (const progress of FRAMES) {
		await page.evaluate(async (p) => {
			window.__three.progressOverride = p;
			for (let i = 0; i < 3; i++) {
				await new Promise((r) => requestAnimationFrame(r));
			}
		}, progress);

		const name = `p${String(Math.round(progress * 100)).padStart(3, "0")}.png`;
		await page.screenshot({ path: path.join(OUT, name) });
	}
	console.log(`\nwrote ${FRAMES.length} frames to ${path.relative(ROOT, OUT)}`);

	/* ------------------------------------------------------------- gallery */

	if (args.gallery) {
		// The corridor is built lazily, on the first frame it is asked for —
		// so pin the override, let a frame build it, and only then ask for the
		// textures. Asking first would arm an empty corridor.
		await page.evaluate(async () => {
			window.__three.galleryOverride = 0.5;
			for (let i = 0; i < 3; i++) {
				await new Promise((r) => requestAnimationFrame(r));
			}
			window.__three.galleryView.arm();
		});
		// 31 baked JPEGs off the dev server. Waiting is not politeness: an
		// unloaded photograph is an invisible plane, and the frame would be a
		// picture of an empty corridor that looks exactly like a bug.
		await page
			.waitForFunction(() => window.__three.galleryView.ready, { timeout: 30000 })
			.catch(() => console.log("  (textures did not all arrive)"));

		for (const t of GALLERY_FRAMES) {
			await page.evaluate(async (v) => {
				window.__three.galleryOverride = v;
				for (let i = 0; i < 6; i++) {
					await new Promise((r) => requestAnimationFrame(r));
				}
			}, t);
			const name = `g${String(Math.round(t * 100)).padStart(3, "0")}.png`;
			await page.screenshot({ path: path.join(OUT, name) });
		}
		// The approach: the plateau override off, the progress one on, so the
		// journey's own camera draws and the corridor rides its depth buffer.
		await page.evaluate(() => {
			window.__three.galleryOverride = null;
		});
		for (const p of DOOR_FRAMES) {
			await page.evaluate(async (v) => {
				window.__three.progressOverride = v;
				for (let i = 0; i < 6; i++) {
					await new Promise((r) => requestAnimationFrame(r));
				}
			}, p);
			const h = (p - 0.2) / 0.675;
			const name = `door${String(Math.round(h * 100)).padStart(3, "0")}.png`;
			await page.screenshot({ path: path.join(OUT, name) });
		}
		await page.evaluate(() => {
			window.__three.progressOverride = null;
		});
		console.log(
			`wrote ${GALLERY_FRAMES.length + DOOR_FRAMES.length} gallery frames to ${path.relative(ROOT, OUT)}`,
		);
	}

	/* ---------------------------------------------------------- placement */

	const placement = await page.evaluate((ink) => {
		const scene = window.__three.scene;
		const glyph = scene.glyph;
		if (!glyph) return null;

		const s = glyph.scale.x;
		const centre = glyph.position
			.clone()
			.addScaledVector(scene.right, ink.centerX * s)
			.addScaledVector(scene.up, ink.centerY * s)
			.project(scene.restCamera);

		return {
			ndc: { x: +centre.x.toFixed(4), y: +centre.y.toFixed(4) },
			inkHeightOfViewport: +((ink.height * s) / 10).toFixed(4),
			inkWidthOfViewport: +((ink.width * s) / (10 * scene.aspectRatio)).toFixed(4),
		};
	}, { width: 4.58105, height: 4.26764, centerX: -0.0026, centerY: -0.40425 });

	console.log("glyph placement", JSON.stringify(placement));
	console.log(problems.length ? `console:\n  ${problems.join("\n  ")}` : "console: clean");
	if (problems.length) failed = true;
} finally {
	await browser.close();
}

process.exit(failed ? 1 : 0);
