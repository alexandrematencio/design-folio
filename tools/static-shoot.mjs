/**
 * THE STATIC CONTROL — the page as a browser WITHOUT WebGL sees it.
 *
 * Drives LibreWolf (WebGL off by default, fingerprinting resistance on:
 * the hardest ordinary browser this page has to work in) through puppeteer's
 * Firefox driver, on a throwaway profile, and checks that the static page
 * (src/static.js) is whole:
 *
 *   - no canvas was left behind, the layout is the static one
 *   - the glyph <img> is where the scene's rest pose puts the ink:
 *     centre at 72 % / 47 % of the frame, 52 % of its height (LAYOUT in
 *     scenes/Scene.js), measured in pixels here
 *   - the copy is text: selectable, its link under the pointer
 *   - the cue is up at rest and gone after a scroll
 *   - the gallery grid holds the curation, one link per photograph
 *
 * Needs `npm run dev` in another terminal and LibreWolf installed.
 *
 *   node tools/static-shoot.mjs                    # v2.html, 1440 × 900
 *   node tools/static-shoot.mjs --url http://localhost:5180/ --out tools/shots/static-v1
 *   node tools/static-shoot.mjs --width 430 --height 930 --out tools/shots/static-narrow
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
	process.argv
		.slice(2)
		.join(" ")
		.matchAll(/--([\w-]+)(?:[= ]([^-\s][^\s]*))?/g)
		.map((m) => [m[1], m[2] ?? true]),
);
const URL_ = args.url ?? "http://localhost:5180/v2.html";
const WIDTH = Number(args.width ?? 1440);
const HEIGHT = Number(args.height ?? 900);
const OUT = path.resolve(ROOT, args.out ?? "tools/shots/static");
const LIBREWOLF =
	args.browser ?? "/Applications/LibreWolf.app/Contents/MacOS/librewolf";

/** LAYOUT in scenes/Scene.js, as fractions of the frame. */
const REST = WIDTH <= 900
	? { cx: 0.59, cy: 0.3, h: 0.3 }
	: { cx: 0.72, cy: 0.47, h: 0.52 };
const TOLERANCE_PX = 2;

await mkdir(OUT, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "alx-librewolf-"));

const browser = await puppeteer.launch({
	browser: "firefox",
	executablePath: LIBREWOLF,
	headless: true,
	userDataDir: profile,
	args: ["--no-remote"],
});

const failures = [];
const check = (ok, label, detail = "") => {
	console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
	if (!ok) failures.push(label);
};

try {
	const page = await browser.newPage();
	await page.setViewport({ width: WIDTH, height: HEIGHT });
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error") errors.push(m.text());
	});

	await page.goto(URL_, { waitUntil: "networkidle0", timeout: 30000 });
	// The grid is filled after a fetch; give it a beat.
	await page.waitForFunction(
		() => document.querySelectorAll("#static-gallery .gallery__item").length > 0,
		{ timeout: 5000 },
	).catch(() => {});

	const rest = await page.evaluate(() => {
		const root = document.documentElement;
		const glyph = document.getElementById("static-glyph");
		const g = glyph?.getBoundingClientRect();
		const link = document.querySelector("#page a[href]");
		const cs = link ? getComputedStyle(link) : null;
		const host = document.getElementById("page-host");
		const hit = link
			? (() => {
					const r = link.getBoundingClientRect();
					return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
				})()
			: null;
		const selection = (() => {
			const p = document.querySelector("#page .copy p");
			const range = document.createRange();
			range.selectNodeContents(p);
			const sel = getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
			const got = sel.toString().trim().length > 0;
			sel.removeAllRanges();
			return got;
		})();
		return {
			// The layout viewport, not the window: headless Firefox draws a
			// classic scrollbar, and the page is laid out inside it.
			frame: { w: root.clientWidth, h: root.clientHeight },
			classes: root.className,
			webgl: (() => {
				try {
					const c = document.createElement("canvas");
					return !!(c.getContext("webgl2") || c.getContext("webgl"));
				} catch {
					return false;
				}
			})(),
			canvases: document.querySelectorAll("canvas").length,
			hostPosition: host && getComputedStyle(host).position,
			glyph: g && glyph.complete && glyph.naturalWidth > 0
				? { cx: g.left + g.width / 2, cy: g.top + g.height / 2, h: g.height, w: g.width }
				: null,
			link: link && {
				pointerEvents: cs.pointerEvents,
				color: cs.color,
				underPointer: hit === link,
				href: link.getAttribute("href"),
			},
			selectable: selection,
			cueVisible: document.getElementById("scroll-cue")?.classList.contains("is-visible") ?? false,
			scrollHeight: root.scrollHeight,
			items: document.querySelectorAll("#static-gallery .gallery__item").length,
			itemsWithImage: [...document.querySelectorAll("#static-gallery .gallery__item img")]
				.filter((i) => i.getAttribute("width") && i.alt).length,
			stepMenu: (() => {
				const menu = document.getElementById("step-menu");
				return menu ? getComputedStyle(menu).display : null;
			})(),
		};
	});

	console.log(`static control — ${URL_} at ${WIDTH}×${HEIGHT}`);
	console.log(`  webgl ${rest.webgl}, <html class="${rest.classes}">`);
	check(!rest.webgl, "browser has no WebGL (else this control proves nothing)");
	check(!rest.classes.includes("is-3d") && rest.classes.includes("is-static"), "static layout chosen");
	check(rest.canvases === 0, "no canvas left behind", `${rest.canvases}`);
	check(rest.hostPosition === "relative", "hero in the document flow", rest.hostPosition);

	if (rest.glyph) {
		const want = {
			cx: rest.frame.w * REST.cx,
			cy: rest.frame.h * REST.cy,
			h: rest.frame.h * REST.h,
		};
		const d = {
			cx: Math.abs(rest.glyph.cx - want.cx),
			cy: Math.abs(rest.glyph.cy - want.cy),
			h: Math.abs(rest.glyph.h - want.h),
		};
		check(
			d.cx <= TOLERANCE_PX && d.cy <= TOLERANCE_PX && d.h <= TOLERANCE_PX,
			"glyph at the rest pose's spot",
			`centre ${rest.glyph.cx.toFixed(1)}, ${rest.glyph.cy.toFixed(1)}  height ${rest.glyph.h.toFixed(1)}  — want ${want.cx.toFixed(1)}, ${want.cy.toFixed(1)}, ${want.h.toFixed(1)}`,
		);
	} else {
		check(false, "glyph <img> loaded");
	}

	if (rest.link) {
		check(rest.link.pointerEvents !== "none", "page link takes the pointer", rest.link.pointerEvents);
		check(rest.link.underPointer, "page link is the element under its own centre");
		console.log(`       link → ${rest.link.href}, ${rest.link.color}`);
	} else {
		console.log("  —    no link in the copy on this page");
	}
	check(rest.selectable, "copy is selectable text");
	check(rest.cueVisible, "scroll cue up at rest");
	check(rest.scrollHeight > HEIGHT * 1.5, "there is a page below the horizon", `${rest.scrollHeight}px`);
	check(rest.items === 31 && rest.itemsWithImage === 31, "gallery holds the curation", `${rest.items} items`);
	if (rest.stepMenu !== null) check(rest.stepMenu === "none", "step menu hidden", rest.stepMenu);

	// The cue fades in over 0.6 s; let it land before the picture.
	await new Promise((r) => setTimeout(r, 800));
	await page.screenshot({ path: path.join(OUT, "rest.png") });

	await page.evaluate(() => window.scrollTo(0, window.innerHeight));
	await new Promise((r) => setTimeout(r, 900));
	const scrolled = await page.evaluate(() => ({
		cueVisible: document.getElementById("scroll-cue")?.classList.contains("is-visible") ?? false,
		y: window.scrollY,
	}));
	check(!scrolled.cueVisible, "scroll cue retired after the first scroll", `y ${scrolled.y}`);
	await page.screenshot({ path: path.join(OUT, "fold.png") });

	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	await new Promise((r) => setTimeout(r, 900));
	await page.screenshot({ path: path.join(OUT, "end.png") });

	const real = errors.filter((e) => !/vite|WebGL is currently disabled|WebGLRenderer/.test(e));
	check(real.length === 0, "console clean", real.join(" | "));

	console.log(failures.length ? `\n  ${failures.length} FAILED` : "\n  PASS — the static page is whole.");
	console.log(`  shots in ${path.relative(ROOT, OUT)}/`);
} finally {
	await browser.close();
	await rm(profile, { recursive: true, force: true });
}
process.exit(failures.length ? 1 : 0);
