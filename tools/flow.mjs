/**
 * THE MISS DAISY GAUGE — optical flow across the whole scroll loop.
 *
 * World-space metrics (position, quaternions, zoom) can all be C1-perfect
 * while the PICTURE lurches: a target passing near the eye, a zoom firing at
 * high magnification, a slerp swinging an ortho frame sideways. This tool
 * judges the only thing the visitor sees — how much the image itself changes
 * per unit of scroll. It drives progressOverride at constant step, downsamples
 * each frame to a small canvas, and reports the mean absolute pixel difference
 * between consecutive steps.
 *
 * Read it like a speedometer: `median` is cruise speed, `max/median` is how
 * hard the worst moment differs from cruise. The budget printed at the end is
 * the pass bar the journey is held to.
 *
 *   npm run dev            # in another shell
 *   node tools/flow.mjs                       # v2, 400 steps
 *   node tools/flow.mjs --url http://localhost:5180/ --steps 200
 */
import puppeteer from "puppeteer-core";

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
const URL = args.url ?? "http://localhost:5180/v2.html";
const STEPS = Number(args.steps ?? 400);
/**
 * Worst step over cruise. The accepted baseline: the shipped reveal runs at
 * ~4x and the stair's transit in the tunnel journey peaks at ~5.6x over 1.5 %
 * of the loop (every structural alternative measured worse — see the JOURNEY
 * notes in Scene.js). 6 catches real slams without crying wolf; tighten with
 * --budget 3 when hunting.
 */
const BUDGET = Number(args.budget ?? 6);

const browser = await puppeteer.launch({
	executablePath: CHROME,
	headless: "new",
	args: ["--use-gl=angle", "--use-angle=metal", "--hide-scrollbars"],
});
let failed = false;
try {
	const page = await browser.newPage();
	await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
	await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
	await page.waitForFunction(
		() => document.documentElement.dataset.sceneReady === "true",
		{ timeout: 30000 },
	);

	const rows = await page.evaluate(async (STEPS) => {
		const three = window.__three;
		three.paused = false;
		const src = three.context.renderer.domElement;
		const cv = document.createElement("canvas");
		cv.width = 160;
		cv.height = 100;
		const cx = cv.getContext("2d", { willReadFrequently: true });
		let prev = null;
		const out = [];
		for (let i = 0; i <= STEPS; i++) {
			three.progressOverride = i / STEPS;
			for (let k = 0; k < 3; k++)
				await new Promise((r) => requestAnimationFrame(r));
			cx.drawImage(src, 0, 0, cv.width, cv.height);
			const d = cx.getImageData(0, 0, cv.width, cv.height).data;
			if (prev) {
				let sum = 0;
				for (let j = 0; j < d.length; j += 4) {
					sum +=
						Math.abs(d[j] - prev[j]) +
						Math.abs(d[j + 1] - prev[j + 1]) +
						Math.abs(d[j + 2] - prev[j + 2]);
				}
				out.push({ p: i / STEPS, flow: sum / (cv.width * cv.height * 3) });
			}
			prev = d.slice();
		}
		three.progressOverride = 0;
		return out;
	}, STEPS);

	const sorted = rows.map((r) => r.flow).sort((a, b) => a - b);
	const median = sorted[sorted.length >> 1];
	const max = rows.reduce((m, r) => (r.flow > m.flow ? r : m), rows[0]);

	console.log(`steps ${STEPS}  cruise (median) ${median.toFixed(3)}`);
	console.log(
		`worst ${max.flow.toFixed(3)} at p=${max.p.toFixed(3)}  (${(max.flow / median).toFixed(2)}x cruise)`,
	);

	// The profile, coarse: mean flow per 2.5 % of the loop, as a bar chart.
	const BANDS = 40;
	console.log("\nflow profile (each row = 1/40 of the loop):");
	for (let b = 0; b < BANDS; b++) {
		const band = rows.filter(
			(r) => r.p > b / BANDS && r.p <= (b + 1) / BANDS,
		);
		const mean = band.reduce((t, r) => t + r.flow, 0) / (band.length || 1);
		const bar = "#".repeat(Math.round((mean / median) * 8));
		console.log(
			`  ${(b / BANDS).toFixed(3)}  ${mean.toFixed(3)}  ${bar}`,
		);
	}

	// The PASS bar covers the journey and its approaches. The two bands
	// hugging rest — the reveal (the page peeling off flatness, fast on
	// purpose) and its mirror on the way home — are the shipped v1 orbit's
	// own ramps, shared law in utils.js: reported above, not judged here.
	const SCOPE = [0.12, 0.9];
	const spikes = rows.filter(
		(r) => r.p >= SCOPE[0] && r.p <= SCOPE[1] && r.flow > BUDGET * median,
	);
	if (spikes.length) {
		failed = true;
		console.log(`\nFAIL — ${spikes.length} step(s) above ${BUDGET}x cruise in [${SCOPE}]:`);
		for (const sp of spikes.slice(0, 12))
			console.log(`  p=${sp.p.toFixed(3)}  ${(sp.flow / median).toFixed(2)}x`);
	} else {
		console.log(`\nPASS — no step above ${BUDGET}x cruise in [${SCOPE}].`);
	}
} finally {
	await browser.close();
}
process.exit(failed ? 1 : 0);
