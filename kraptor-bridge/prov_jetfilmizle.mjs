// JetFilmizle port based on Feroxx/Kekik-cloudstream's JetFilmizle provider.
// Uses the site's current GET search route and reproduces its jetplayer source requests.
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = "https://jetfilmizle.now";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function req(url, { referer = MAIN + "/", method, form, headers = {} } = {}) {
	const args = ["-sS", "-L", "-m", "25", "--compressed", "-A", UA, "-H", "Accept-Language: tr-TR,tr;q=0.9,en;q=0.8", "-w", "\n__META__%{http_code}__%{url_effective}"];
	if (referer) args.push("-e", referer);
	for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
	if (form) {
		args.push("-H", "Content-Type: application/x-www-form-urlencoded", "--data-raw", new URLSearchParams(form).toString());
		if (method) args.push("-X", method);
	}
	args.push(url);
	return new Promise((resolve, reject) => execFile(process.platform === "win32" ? "curl.exe" : "curl", args, { cwd: HERE, maxBuffer: 24 * 1024 * 1024, encoding: "utf8", windowsHide: true }, (err, stdout) => {
		if (err && !stdout?.length) return reject(err);
		const s = stdout || "";
		const m = s.match(/\n__META__(\d+)__([^\r\n]*)$/);
		resolve({ status: m ? Number(m[1]) : 0, url: m?.[2] || url, text: m ? s.slice(0, m.index) : s });
	}));
}

const htmlDecode = (s = "") => String(s)
	.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
	.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ")
	.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
	.replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const textOnly = (s = "") => htmlDecode(String(s).replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
const absolute = (u, base = MAIN) => { try { return new URL(htmlDecode(u).replace(/\\\//g, "/"), base).href; } catch { return ""; } };
const normalize = (s = "") => String(s).toLocaleLowerCase("tr-TR").replace(/[ıİ]/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const titleMatch = (a, b) => {
	const x = normalize(a), y = normalize(b);
	return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x))));
};
function yearsIn(s) { return [...String(s).matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => Number(m[0])); }
function yearsFit(source, requested) {
	if (!requested) return true;
	const years = Array.isArray(source) ? source : yearsIn(source);
	return !years.length || years.some((y) => Math.abs(y - requested) <= 1);
}
function getAttr(tag, attr) { return tag.match(new RegExp(`\\b${attr}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2] || ""; }
function blocked(r) { return r.status === 403 || /Just a moment\.\.\.|cf-chl-|challenges\.cloudflare\.com|Enable JavaScript and cookies to continue/i.test(r.text); }
function parseCards(html) {
	const marks = [];
	for (const m of html.matchAll(/<div\b[^>]*class=["'][^"']+["'][^>]*>/gi)) {
		const cls = m[0].match(/class=["']([^"']+)["']/i)?.[1]?.split(/\s+/) || [];
		if (cls.includes("film-card")) marks.push(m.index);
	}
	const out = [];
	for (let i = 0; i < marks.length; i++) {
		const chunk = html.slice(marks[i], marks[i + 1] ?? Math.min(html.length, marks[i] + 5000));
		const href = chunk.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
		const titleRaw = chunk.match(/class=["'][^"']*card-title[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1]
			|| chunk.match(/<a\b[^>]*title=["']([^"']+)["']/i)?.[1];
		const poster = chunk.match(/<img\b[^>]*>/i)?.[0] || "";
		const alt = getAttr(poster, "alt");
		const title = textOnly(titleRaw || alt).replace(/\s+(?:Full\s+)?(?:Türkçe\s+)?(?:Dublaj|Altyazılı)?\s*İzle\s*$/i, "").trim();
		if (!href || !title) continue;
		const year = Number(chunk.match(/\b((?:19|20)\d{2})\b/)?.[1] || yearsIn(alt)[0]) || null;
		out.push({ title, aliases: [alt, titleRaw].filter(Boolean).map(textOnly), url: absolute(href), year });
	}
	return out;
}
async function search(query) {
	const r = await req(`${MAIN}/arama?q=${encodeURIComponent(query)}`);
	if (r.status < 200 || r.status >= 300 || blocked(r)) return [];
	return parseCards(r.text);
}
async function videoSources(iframe, sourceName, filmPage) {
	const result = [];
	const host = new URL(iframe).hostname;
	const pixel = iframe.match(/pixeldrain\.com\/(?:u|api\/file)\/([\w-]+)/i);
	if (pixel) return [{ label: `${sourceName} · PixelDrain`, url: `https://pixeldrain.com/api/file/${pixel[1]}?download`, referer: iframe, origin: "https://pixeldrain.com" }];
	let embed;
	try { embed = await req(iframe, { referer: filmPage }); } catch { return result; }
	if (embed.status < 200 || embed.status >= 300 || blocked(embed)) return result;
	const worker = embed.text.match(/(?:const|let)\s+WORKER_URL\s*=\s*["']([^"']+)["']/)?.[1];
	const videoId = embed.text.match(/(?:const|let)\s+VIDEO_ID\s*=\s*["']([^"']*)["']/)?.[1];
	const pubId = embed.text.match(/(?:const|let)\s+PUB_ID\s*=\s*["']([^"']*)["']/)?.[1];
	const videoTitle = embed.text.match(/(?:const|let)\s+VIDEO_TITLE\s*=\s*["']([^"']*)["']/)?.[1] || videoId;
	const publisherId = embed.text.match(/(?:const|let)\s+PUBLISHER_ID\s*=\s*["']([^"']*)["']/)?.[1];
	if (worker && (pubId || videoId)) {
		try {
			const api = new URL(pubId ? "/api/stream" : "/api/video", worker);
			if (pubId) { api.searchParams.set("pubId", pubId); api.searchParams.set("title", videoTitle || videoId); if (publisherId) api.searchParams.set("publisherId", publisherId); }
			else api.searchParams.set("id", videoId);
			const apiRes = await req(api.href, { referer: iframe, headers: { Origin: `https://${host}`, Accept: "application/json" } });
			const data = JSON.parse(apiRes.text);
			for (const item of [data.hlsSource, ...(data.mp4Sources || [])]) {
				if (!item?.file) continue;
				result.push({ label: `${sourceName} · ${item.label || (item.type === "hls" ? "HLS" : "Auto")}`, url: absolute(item.file, worker), referer: iframe, origin: new URL(worker).origin });
			}
		} catch {}
	}
	// Port of common loadExtractor behavior for pages exposing a direct media URL.
	for (const m of embed.text.matchAll(/<source\b[^>]*>/gi)) {
		const src = getAttr(m[0], "src");
		if (/\.(?:m3u8|mp4|mpd)(?:[?#]|$)/i.test(src)) result.push({ label: `${sourceName} · ${getAttr(m[0], "label") || "Video"}`, url: absolute(src, iframe), referer: iframe, origin: `https://${host}` });
	}
	for (const m of embed.text.matchAll(/(?:file|src|url)\s*[:=]\s*["']((?:https?:)?\/\/[^"'\s<>]+\.(?:m3u8|mp4|mpd)(?:\?[^"'\s<>]*)?)["']/gi)) {
		const url = absolute(m[1], iframe);
		if (!result.some((x) => x.url === url)) result.push({ label: `${sourceName} · Video`, url, referer: iframe, origin: `https://${host}` });
	}
	return result;
}

async function filmStreams(filmUrl, requestedTitle, seasonlessYear) {
	const page = await req(filmUrl, { referer: MAIN + "/" });
	if (page.status < 200 || page.status >= 300 || blocked(page)) return [];
	const filmId = page.text.match(/<input\b[^>]*name=["']film_id["'][^>]*value=["']([^"']+)["']/i)?.[1]
		|| page.text.match(/<input\b[^>]*value=["']([^"']+)["'][^>]*name=["']film_id["']/i)?.[1];
	if (!filmId) return [];
	const sourceButtons = [...page.text.matchAll(/<button\b[^>]*class=["'][^"']*player-source-btn[^"']*["'][^>]*>/gi)].map((m) => Number(getAttr(m[0], "data-source-index"))).filter(Number.isFinite);
	const maxIndex = sourceButtons.length ? Math.min(12, Math.max(...sourceButtons)) : 4;
	const out = [];
	for (const playerType of ["dublaj", "altyazili"]) {
		const typeName = playerType === "dublaj" ? "TR Dublaj" : "TR Altyazı";
		for (let sourceIndex = 0; sourceIndex <= maxIndex; sourceIndex++) {
			let source;
			try {
				source = await req(`${MAIN}/jetplayer`, {
					method: "POST", referer: filmUrl,
					headers: { "X-Requested-With": "XMLHttpRequest" },
					form: { film_id: filmId, source_index: String(sourceIndex), player_type: playerType },
				});
			} catch { continue; }
			if (source.status < 200 || source.status >= 300 || blocked(source)) continue;
			const iframeTag = source.text.match(/<iframe\b[^>]*>/i)?.[0];
			let iframeRaw = iframeTag && (getAttr(iframeTag, "src") || getAttr(iframeTag, "data-src"));
			if (!iframeRaw) continue;
			if (iframeRaw.startsWith("//")) iframeRaw = `https:${iframeRaw}`;
			const iframe = absolute(iframeRaw, source.url || MAIN);
			if (!iframe) continue;
			out.push(...await videoSources(iframe, `JetFilmizle · ${typeName} · Kaynak ${sourceIndex + 1}`, filmUrl));
			// A returned HLS master already contains the provider's available quality
			// variants. Return immediately so Nuvio's addon timeout isn't spent probing
			// unrelated player buttons after a playable source has been found.
			if (out.length) return out;
		}
	}
	return out;
}

export async function get({ type, titles = [], year } = {}) {
	if (type !== "movie" || !Array.isArray(titles) || !titles.length) return [];
	const results = [];
	for (const query of [...new Set(titles.map((x) => String(x || "").trim()).filter(Boolean))]) {
		try { results.push(...await search(query)); } catch {}
		if (results.length >= 50) break;
	}
	const seen = new Set();
	const hits = results.filter((x) => {
		if (!x.url || seen.has(x.url)) return false;
		seen.add(x.url);
		const aliases = [x.title, ...(x.aliases || [])];
		return titles.some((t) => aliases.some((a) => titleMatch(a, t))) && yearsFit(x.year ? [x.year] : [], Number(year) || null);
	}).slice(0, 4);
	const out = [];
	for (const hit of hits) {
		out.push(...await filmStreams(hit.url, hit.title, year));
		if (out.length) break;
	}
	const unique = new Map();
	for (const stream of out) if (stream.url && !unique.has(stream.url)) unique.set(stream.url, stream);
	return [...unique.values()];
}

