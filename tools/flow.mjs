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
 * THE PLATEAU IS ON THE SAME RULER. progress and scroll stopped being the same
 * axis the day the gallery got a plateau — 750vh where progress stands still
 * and galleryOverride runs instead (GALLERY in scenes/Gallery.js) — and since
 * the corridor is now drawn during the APPROACH too, sampling progress alone
 * would put two frames 750vh apart next to each other and call the difference
 * one step. Measured, that lie was worth 9x cruise at p = PLATEAU, for a cut
 * that does not exist.
 *
 * So the sweep runs progress up to PLATEAU, hands over to the plateau's own
 * axis, and picks progress back up on the far side. The plateau gets
 * VH / LOOP_VH x STEPS steps, which is exactly the count that makes ONE STEP
 * THE SAME AMOUNT OF WHEEL on both axes — that is the only way the two sets of
 * numbers may be compared, and comparing them is the whole point.
 *
 * `median` stays the JOURNEY's median, not the pooled one: it is the cruise
 * the 6x budget was calibrated against, and folding 250 corridor steps into it
 * would move the bar under every number ever recorded here.
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

	// The corridor's photographs have to be on the walls before it is judged:
	// an empty corridor is a much calmer picture than the real one, and the
	// gauge would sign off on a ride nobody takes. No-op on v1.
	await page.evaluate(async () => {
		if (!window.__three.galleryView) return;
		window.__three.galleryOverride = 0.5;
		for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
		window.__three.galleryView.arm();
	});
	await page
		.waitForFunction(() => !window.__three.galleryView || window.__three.galleryView.ready, {
			timeout: 30000,
		})
		.catch(() => console.log("(the corridor's textures did not all arrive)"));

	const rows = await page.evaluate(async (STEPS) => {
		const three = window.__three;
		three.paused = false;
		three.galleryOverride = null;
		const src = three.context.renderer.domElement;
		const cv = document.createElement("canvas");
		cv.width = 160;
		cv.height = 100;
		const cx = cv.getContext("2d", { willReadFrequently: true });

		// The itinerary, in scroll order: progress up to the plateau, the
		// plateau on its own axis, then progress again. `plateau` carries the
		// same amount of wheel per step as the progress legs (see the header).
		const plan = [];
		const gv = three.galleryView;
		const P = gv
			? (await import("/src/scenes/Gallery.js")).GALLERY
			: null;
		const upTo = P ? P.PLATEAU : 2;
		for (let i = 0; i <= STEPS; i++) {
			const p = i / STEPS;
			if (p > upTo) break;
			plan.push({ leg: "journey", p });
		}
		if (P) {
			const N = Math.round((P.VH / P.LOOP_VH) * STEPS);
			for (let i = 0; i <= N; i++) plan.push({ leg: "plateau", t: i / N });
			for (let i = 0; i <= STEPS; i++) {
				const p = i / STEPS;
				if (p > upTo) plan.push({ leg: "journey", p });
			}
		}

		let prev = null;
		const out = [];
		for (const step of plan) {
			if (step.leg === "plateau") {
				three.progressOverride = null;
				three.galleryOverride = step.t;
			} else {
				three.galleryOverride = null;
				three.progressOverride = step.p;
			}
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
				out.push({ ...step, flow: sum / (cv.width * cv.height * 3) });
			}
			prev = d.slice();
		}
		three.galleryOverride = null;
		three.progressOverride = 0;
		return out;
	}, STEPS);

	const journey = rows.filter((r) => r.leg === "journey");
	const plateau = rows.filter((r) => r.leg === "plateau");
	const sorted = journey.map((r) => r.flow).sort((a, b) => a - b);
	const median = sorted[sorted.length >> 1];
	const worst = (set) => set.reduce((m, r) => (r.flow > m.flow ? r : m), set[0]);
	const max = worst(journey);

	console.log(`steps ${STEPS}  cruise (median of the journey) ${median.toFixed(3)}`);
	console.log(
		`worst ${max.flow.toFixed(3)} at p=${max.p.toFixed(3)}  (${(max.flow / median).toFixed(2)}x cruise)`,
	);
	if (plateau.length) {
		const pm = plateau.map((r) => r.flow).sort((a, b) => a - b);
		const pw = worst(plateau);
		console.log(
			`plateau ${plateau.length} steps  median ${pm[pm.length >> 1].toFixed(3)}  ` +
				`worst ${pw.flow.toFixed(3)} at t=${pw.t.toFixed(3)}  ` +
				`(${(pw.flow / median).toFixed(2)}x cruise)`,
		);
	}

	// The profile, coarse: mean flow per 2.5 % of the loop, as a bar chart.
	const BANDS = 40;
	console.log("\nflow profile (each row = 1/40 of the loop):");
	for (let b = 0; b < BANDS; b++) {
		const band = journey.filter(
			(r) => r.p > b / BANDS && r.p <= (b + 1) / BANDS,
		);
		const mean = band.reduce((t, r) => t + r.flow, 0) / (band.length || 1);
		const bar = "#".repeat(Math.round((mean / median) * 8));
		console.log(
			`  ${(b / BANDS).toFixed(3)}  ${mean.toFixed(3)}  ${bar}`,
		);
	}
	if (plateau.length) {
		console.log("\nplateau profile (each row = 1/10 of the corridor):");
		for (let b = 0; b < 10; b++) {
			const band = plateau.filter((r) => r.t > b / 10 && r.t <= (b + 1) / 10);
			const mean = band.reduce((t, r) => t + r.flow, 0) / (band.length || 1);
			console.log(
				`  ${(b / 10).toFixed(2)}  ${mean.toFixed(3)}  ${"#".repeat(Math.round((mean / median) * 8))}`,
			);
		}
	}

	// The PASS bar covers the journey and its approaches. The two bands
	// hugging rest — the reveal (the page peeling off flatness, fast on
	// purpose) and its mirror on the way home — are the shipped v1 orbit's
	// own ramps, shared law in utils.js: reported above, not judged here.
	// The plateau is judged whole: it sits inside the scope by construction.
	const SCOPE = [0.12, 0.9];
	const spikes = rows.filter(
		(r) =>
			r.flow > BUDGET * median &&
			(r.leg === "plateau" || (r.p >= SCOPE[0] && r.p <= SCOPE[1])),
	);
	if (spikes.length) {
		failed = true;
		console.log(`\nFAIL — ${spikes.length} step(s) above ${BUDGET}x cruise in [${SCOPE}] + plateau:`);
		for (const sp of spikes.slice(0, 12))
			console.log(
				`  ${sp.leg === "plateau" ? `t=${sp.t.toFixed(3)}` : `p=${sp.p.toFixed(3)}`}  ${(sp.flow / median).toFixed(2)}x`,
			);
	} else {
		console.log(`\nPASS — no step above ${BUDGET}x cruise in [${SCOPE}] or on the plateau.`);
	}
} finally {
	await browser.close();
}
process.exit(failed ? 1 : 0);
