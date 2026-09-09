/**
 * Flattens every stylesheet attached to the document into one CSS string that
 * can be dropped inside an SVG <foreignObject>.
 *
 * Why it has to exist: the SVG produced by HtmlToCanvas is loaded as an
 * <img>, so it runs in restricted mode. It cannot see the parent document's
 * stylesheets, and it cannot make a single network request. Anything driven
 * by a class or a @font-face silently falls back to browser defaults unless
 * the bytes travel inside the SVG itself.
 *
 * So: read the rules, then turn every url() into a data URI — including the
 * same-origin ones. That last part is the difference from most versions of
 * this snippet floating around, which only inline Google Fonts. A local
 * /fonts/inter.woff2 is just as unreachable from inside the sandbox: the SVG
 * is a data: URL, so it has no base to resolve a relative path against.
 */
export async function collectDocumentCss() {
	const chunks = await Promise.all(
		Array.from(document.styleSheets).map((sheet) => readSheet(sheet)),
	);
	return inlineUrls(chunks.filter(Boolean).join("\n"));
}

async function readSheet(sheet) {
	try {
		// Same-origin: the CSSOM hands us the parsed rules, cssText is
		// authoritative and already resolves @import.
		const rules = sheet.cssRules;
		if (rules) {
			return Array.from(rules)
				.map((r) => r.cssText)
				.join("\n");
		}
	} catch {
		// Cross-origin sheets throw on cssRules — fall through to a fetch.
	}

	if (!sheet.href) return "";

	try {
		const res = await fetch(sheet.href);
		return await res.text();
	} catch {
		return "";
	}
}

/**
 * Replaces every url(...) that is not already a data URI with a base64 data
 * URI of the fetched bytes. Silently leaves anything it cannot fetch alone —
 * a missing decoration must not take the whole stylesheet down with it.
 */
async function inlineUrls(css) {
	const urlRegex = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
	const raw = Array.from(new Set(Array.from(css.matchAll(urlRegex), (m) => m[1])));
	const targets = raw.filter((u) => !u.startsWith("data:"));
	if (targets.length === 0) return css;

	const pairs = await Promise.all(
		targets.map(async (url) => {
			try {
				const absolute = new URL(url, document.baseURI).href;
				const res = await fetch(absolute);
				if (!res.ok) return [url, null];
				return [url, await blobToDataUri(await res.blob())];
			} catch {
				return [url, null];
			}
		}),
	);

	let out = css;
	for (const [original, dataUri] of pairs) {
		if (!dataUri) continue;
		// split/join rather than a RegExp: the original URL would have to be
		// escaped for the parser, and a stray ( in a filename is enough.
		out = out.split(original).join(dataUri);
	}
	return out;
}

function blobToDataUri(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}
