/**
 * WHAT GOOGLE SHOWS OF amatencio.com — the title and description of the door
 * (v3.html), read from the Studio and baked into the page at build time.
 *
 * THE SOURCE is the singleton `hubPage` of amatencio-photo's Studio:
 * Studio → Pages → « amatencio.com — page d’accueil » → « Référencement
 * (Google) ». Empty fields fall back to DEFAULTS below, which are the same
 * texts as `SEO_DEFAULTS.hub` in amatencio-photo (lib/seo/defaults.ts): the
 * Studio shows them under each field, so the editor knows what an empty field
 * stands for. Change one, change the other.
 *
 * Same contract as the curation bake (tools/curation.mjs): the answer is
 * written to tools/hub-seo.json, which is COMMITTED, and a failure (offline,
 * Sanity down) keeps the file already on disk. A static page must not depend
 * on anything alive. vite.config.js runs it at dev start and before a build,
 * then writes the values into the page's <head>.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const HUB_SEO = join(ROOT, "tools", "hub-seo.json");

const PROJECT = "yh5i5diw";
const DATASET = "production";
const API_VERSION = "v2026-01-01";
const QUERY = `*[_id=="hubPage"][0].seo{title,description}`;
const TIMEOUT = 4000;

export const DEFAULTS = {
	title: "Alexandre Xavier Matencio — Designer & Photographer",
	description:
		"Alexandre Xavier Matencio, art director, designer and photographer near Paris. His photography portfolio, his journal and his digital agency.",
};

/** Pulls the Studio's values and rewrites the file only when they changed. */
export async function bakeHubSeo({ log = console.log } = {}) {
	const url = `https://${PROJECT}.api.sanity.io/${API_VERSION}/data/query/${DATASET}?query=${encodeURIComponent(QUERY)}`;
	const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
	if (!res.ok) throw new Error(`Sanity answered ${res.status}`);
	const seo = (await res.json()).result ?? {};
	const next = {
		title: seo.title?.trim() || DEFAULTS.title,
		description: seo.description?.trim() || DEFAULTS.description,
	};
	const raw = await readFile(HUB_SEO, "utf8").catch(() => null);
	const before = raw ? JSON.parse(raw) : {};
	const changed = before.title !== next.title || before.description !== next.description;
	if (changed) {
		await writeFile(HUB_SEO, `${JSON.stringify(next, null, "\t")}\n`);
		log(`title « ${next.title} »`);
	}
	return { changed, ...next };
}

/** What the page is built with: the baked file, or the defaults. */
export async function readHubSeo() {
	const raw = await readFile(HUB_SEO, "utf8").catch(() => null);
	return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
}

// By hand: `npm run hub-seo`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const r = await bakeHubSeo();
	console.log(r.changed ? "tools/hub-seo.json updated" : "tools/hub-seo.json already current");
}
