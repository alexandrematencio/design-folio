/**
 * THE CURATION BAKE — the 31 photos of amatencio-photo, frozen into public/.
 *
 * Sanity's image CDN answers `403 CORS Origin not allowed` to any domain it
 * does not know, and a WebGL texture cannot be uploaded from an opaque
 * response. So the photos cannot be fetched at runtime, and the brand rule
 * ("no third-party request while the page runs") would forbid it anyway.
 * The fix is to bake: this script pulls the curation once, at build time, and
 * leaves behind plain files that the site serves like any other asset.
 *
 * Both outputs are COMMITTED. A static site must not depend on anything alive:
 * if the Sanity dataset changes tomorrow, the shoot of today still renders.
 * Re-run the script when the curation actually changes.
 *
 *   npm run curation            # skips images already on disk
 *   npm run curation -- --force # re-downloads everything
 */
import { mkdir, writeFile, rename, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "curation");
const OUT_JSON = join(ROOT, "public", "curation.json");

const PROJECT = "yh5i5diw";
const DATASET = "production";
const API_VERSION = "v2026-01-01";

/**
 * The curation is an ordered array of references on the singleton
 * `siteSettings`. The order of that array IS the order of the gallery, so the
 * query must not sort: it dereferences in place. Dimensions come from the
 * ORIGINAL asset metadata — the tunnel only reads the ratio, and the ratio of
 * the original is the ratio of the resized copy.
 */
const QUERY = `*[_type=="siteSettings"][0].curation[]->{title,"slug":slug.current,"url":image.asset->url,"width":image.asset->metadata.dimensions.width,"height":image.asset->metadata.dimensions.height}`;

/**
 * 1024 px on the long side is the mobile GPU ceiling we allow ourselves:
 * 31 textures x ~4 MB of VRAM. `fm=jpg` because a few originals are PNG or
 * HEIC and we want one predictable extension on disk; q=82 is where the
 * artefacts stop being visible on a plane seen edge-on.
 */
const TRANSFORM = "?w=1024&fm=jpg&q=82";

const CONCURRENCY = 4;
const ATTEMPTS = 2; // one try, one retry — a flaky CDN hop, not a broken URL

const force = process.argv.slice(2).includes("--force");

/* ------------------------------------------------------------- the query */

const url = `https://${PROJECT}.api.sanity.io/${API_VERSION}/data/query/${DATASET}?query=${encodeURIComponent(QUERY)}`;
const res = await fetch(url);
if (!res.ok) {
	console.error(`curation: Sanity answered ${res.status} ${res.statusText}`);
	process.exit(1);
}
const { result } = await res.json();
if (!Array.isArray(result) || result.length === 0) {
	console.error("curation: the query returned no entry — is siteSettings.curation still there?");
	process.exit(1);
}

/**
 * A photo without a slug has no filename and a photo without a url has no
 * bytes: both are authoring mistakes upstream, and both would silently
 * shorten the gallery. Fail loudly instead, naming the entry.
 */
const broken = result.filter((p) => !p.slug || !p.url || !p.width || !p.height);
if (broken.length) {
	for (const p of broken) console.error(`curation: incomplete entry ${JSON.stringify(p.title ?? p)}`);
	process.exit(1);
}

const photos = result.map((p) => ({
	slug: p.slug,
	title: p.title ?? p.slug,
	src: `/curation/${p.slug}.jpg`,
	width: p.width,
	height: p.height,
	remote: `${p.url}${TRANSFORM}`,
	file: join(OUT_DIR, `${p.slug}.jpg`),
}));

console.log(`curation: ${photos.length} photos in the curation${force ? " (--force)" : ""}`);

/* --------------------------------------------------------- the downloads */

await mkdir(OUT_DIR, { recursive: true });

async function download(photo) {
	if (!force) {
		const present = await stat(photo.file).catch(() => null);
		// A zero-byte file is a crash, not a cache: only a real file counts.
		if (present?.isFile() && present.size > 0) return "skipped";
	}

	let lastError;
	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		try {
			const r = await fetch(photo.remote);
			if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
			const type = r.headers.get("content-type") ?? "";
			if (!type.startsWith("image/")) throw new Error(`content-type ${type || "missing"}`);
			const bytes = Buffer.from(await r.arrayBuffer());
			if (bytes.length === 0) throw new Error("empty body");

			/**
			 * Write to a sibling then rename: a run killed mid-download must
			 * never leave a truncated .jpg behind, because the next run would
			 * see a file, call it cached, and bake a corrupt gallery.
			 */
			const tmp = `${photo.file}.part`;
			await writeFile(tmp, bytes);
			await rename(tmp, photo.file);
			return bytes.length;
		} catch (err) {
			lastError = err;
		}
	}
	throw new Error(`${photo.slug}: ${lastError.message}`);
}

/**
 * Four in flight. Sanity's CDN serves this in a few hundred ms per image and
 * we are 31 deep: more parallelism buys nothing and starts to look like abuse.
 */
const queue = photos.slice();
const failures = [];
let downloaded = 0;
let skipped = 0;
let bytes = 0;

await Promise.all(
	Array.from({ length: CONCURRENCY }, async () => {
		for (let photo = queue.shift(); photo; photo = queue.shift()) {
			try {
				const outcome = await download(photo);
				if (outcome === "skipped") {
					skipped++;
				} else {
					downloaded++;
					bytes += outcome;
					console.log(`  + ${photo.slug}.jpg  ${Math.round(outcome / 1024)} Ko`);
				}
			} catch (err) {
				failures.push(err.message);
			}
		}
	}),
);

if (failures.length) {
	for (const f of failures) console.error(`curation: FAILED ${f}`);
	console.error(`curation: ${failures.length} image(s) missing — public/curation is incomplete`);
	process.exit(1);
}

/* ------------------------------------------------------------ the manifest */

const manifest = {
	generatedAt: new Date().toISOString(),
	source: `sanity:${PROJECT}/${DATASET} siteSettings.curation`,
	photos: photos.map(({ slug, title, src, width, height }) => ({ slug, title, src, width, height })),
};
await writeFile(OUT_JSON, `${JSON.stringify(manifest, null, 2)}\n`);

/**
 * A slug dropped from the curation leaves an orphan .jpg that nothing reads
 * and that git keeps forever. Name it — deleting is the author's call, not
 * the script's, since the same folder may hold nothing else.
 */
const kept = new Set(photos.map((p) => `${p.slug}.jpg`));
const orphans = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".jpg") && !kept.has(f));
for (const o of orphans) console.log(`curation: orphan ${o} (no longer in the curation — delete by hand)`);

console.log(
	`curation: ${downloaded} downloaded (${Math.round(bytes / 1024)} Ko), ${skipped} already on disk → public/curation.json`,
);
