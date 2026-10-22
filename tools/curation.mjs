/**
 * THE CURATION BAKE — the funnel curation of amatencio-photo, frozen into public/.
 *
 * Sanity's image CDN answers `403 CORS Origin not allowed` to any domain it
 * does not know, and a WebGL texture cannot be uploaded from an opaque
 * response. So the photos cannot be fetched at runtime, and the brand rule
 * ("no third-party request while the page runs") would forbid it anyway.
 * The fix is to bake: this script pulls the curation and leaves behind plain
 * files that the site serves like any other asset.
 *
 * THE SOURCE is `funnelCuration.photos`: a singleton made for this tunnel and
 * for nothing else, invisible on amatencio-photo (Studio → Photos → Funnel
 * curation). It used to be `siteSettings.curation`, the home's Selected Works.
 *
 * IT RUNS WITHOUT ANYONE THINKING OF IT (vite.config.js):
 *   - `npm run dev`: at server start, then on every page load — a change made
 *     in the Studio shows on the next reload, no command, no commit;
 *   - `npm run build`: once, before bundling. Offline, the build keeps the
 *     files already on disk and says so.
 * By hand, still:
 *   npm run curation            # skips images already on disk
 *   npm run curation -- --force # re-downloads everything
 *
 * Both outputs are COMMITTED. A static site must not depend on anything alive:
 * if the Sanity dataset changes tomorrow, the shoot of today still renders.
 */
import { mkdir, writeFile, rename, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "curation");
export const MANIFEST = join(ROOT, "public", "curation.json");

const PROJECT = "yh5i5diw";
const DATASET = "production";
const API_VERSION = "v2026-01-01";
const SOURCE = `sanity:${PROJECT}/${DATASET} funnelCuration.photos`;

/**
 * The funnel curation is an ordered array of references on the singleton
 * `funnelCuration`. The order of that array IS the order of the gallery, so
 * the query must not sort: it dereferences in place. Dimensions come from the
 * ORIGINAL asset metadata — the tunnel only reads the ratio, and the ratio of
 * the original is the ratio of the resized copy. `api.sanity.io`, not the
 * `apicdn`: the answer has to be the one the Studio just wrote.
 */
const QUERY = `*[_id=="funnelCuration"][0].photos[]->{title,"slug":slug.current,"url":image.asset->url,"width":image.asset->metadata.dimensions.width,"height":image.asset->metadata.dimensions.height}`;

/**
 * 768 px ON THE LONG SIDE — `w` and `h` together with `fit=max`, so a
 * portrait is bounded like a landscape (`w=1024` alone used to hand back
 * 1024 x 1536 portraits) and nothing smaller is ever scaled up.
 *
 * MEASURED, not guessed (2026-09-14, every frame projected along the whole
 * plateau, in device pixels — the renderer caps the ratio at 2): the long side
 * of a photograph on screen is ~150 px half the time and covers 768 px for
 * 99 % of its screen time on a Retina laptop, a 2560 monitor and a phone
 * alike. Only the last instant of a picture leaving the frame goes past it,
 * up to 1124 px, moving too fast to be read. Texture memory falls in
 * proportion — it is what a hundred photographs cost a phone's GPU.
 *
 * `fm=jpg` because a few originals are PNG or HEIC and we want one
 * predictable extension on disk; q=82 is where the artefacts stop being
 * visible on a plane seen edge-on.
 */
const TRANSFORM = "?w=768&h=768&fit=max&fm=jpg&q=82";

const CONCURRENCY = 4;
const ATTEMPTS = 2; // one try, one retry — a flaky CDN hop, not a broken URL
/** The dev server waits on the query before serving a page: keep it short. */
const QUERY_TIMEOUT = 4000;
const IMAGE_TIMEOUT = 20000;

/**
 * Pulls the curation, downloads what is missing, rewrites the manifest ONLY
 * when the list of photographs actually changed (the dev server watches it,
 * and a timestamp alone must not reload a page). Throws on any failure and
 * leaves the files on disk as they were — the caller decides how loud to be.
 */
export async function bakeCuration({ force: forced = false, log = console.log } = {}) {
	/**
	 * The files on disk were cut with the TRANSFORM the manifest records: a
	 * new size makes every one of them stale, so it re-downloads them all —
	 * the cache is only a cache for the same cut.
	 */
	const previous = await readFile(MANIFEST, "utf8")
		.then((raw) => JSON.parse(raw))
		.catch(() => null);
	const force = forced || previous?.transform !== TRANSFORM;

	const url = `https://${PROJECT}.api.sanity.io/${API_VERSION}/data/query/${DATASET}?query=${encodeURIComponent(QUERY)}`;
	const res = await fetch(url, { signal: AbortSignal.timeout(QUERY_TIMEOUT) });
	if (!res.ok) throw new Error(`Sanity answered ${res.status} ${res.statusText}`);
	const { result } = await res.json();
	if (!Array.isArray(result) || result.length === 0) {
		throw new Error("the query returned no entry — is the funnel curation empty?");
	}

	/**
	 * A photo without a slug has no filename and a photo without a url has no
	 * bytes: both are authoring mistakes upstream, and both would silently
	 * shorten the gallery. Fail loudly instead, naming the entry.
	 */
	const broken = result.filter((p) => !p?.slug || !p.url || !p.width || !p.height);
	if (broken.length) {
		const names = broken.map((p) => JSON.stringify(p?.title ?? p?.slug ?? p)).join(", ");
		throw new Error(`incomplete entr${broken.length > 1 ? "ies" : "y"}: ${names}`);
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
				const r = await fetch(photo.remote, { signal: AbortSignal.timeout(IMAGE_TIMEOUT) });
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
	 * Four in flight. Sanity's CDN serves this in a few hundred ms per image:
	 * more parallelism buys nothing and starts to look like abuse.
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
						log(`  + ${photo.slug}.jpg  ${Math.round(outcome / 1024)} Ko`);
					}
				} catch (err) {
					failures.push(err.message);
				}
			}
		}),
	);

	if (failures.length) {
		throw new Error(`${failures.length} image(s) missing — ${failures.join("; ")}`);
	}

	/* ---------------------------------------------------------- the manifest */

	const entries = photos.map(({ slug, title, src, width, height }) => ({ slug, title, src, width, height }));
	const changed =
		previous?.source !== SOURCE ||
		previous?.transform !== TRANSFORM ||
		JSON.stringify(previous?.photos) !== JSON.stringify(entries);

	if (changed) {
		const manifest = {
			generatedAt: new Date().toISOString(),
			source: SOURCE,
			transform: TRANSFORM,
			photos: entries,
		};
		await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

		/**
		 * A slug dropped from the curation leaves an orphan .jpg that nothing
		 * reads and that git keeps forever. Name it — deleting is the author's
		 * call, not the script's.
		 */
		const kept = new Set(photos.map((p) => `${p.slug}.jpg`));
		const orphans = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".jpg") && !kept.has(f));
		if (orphans.length) {
			log(`${orphans.length} orphan(s) no longer in the curation (delete by hand): ${orphans.join(", ")}`);
		}
	}

	return { count: photos.length, downloaded, skipped, bytes, changed };
}

/* --------------------------------------------------------------- the CLI */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const force = process.argv.slice(2).includes("--force");
	try {
		const r = await bakeCuration({ force, log: (m) => console.log(`curation: ${m}`) });
		console.log(
			`curation: ${r.count} photos, ${r.downloaded} downloaded (${Math.round(r.bytes / 1024)} Ko), ` +
				`${r.skipped} already on disk → public/curation.json ${r.changed ? "updated" : "unchanged"}`,
		);
	} catch (error) {
		console.error(`curation: ${error.message}`);
		process.exit(1);
	}
}
