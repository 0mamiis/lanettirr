const BRIDGE_ORIGIN = process.env.BRIDGE_ORIGIN || "http://127.0.0.1:7000";
// Runs whitelisted Nuvio JS scrapers (working.json) for a Stremio id and returns validated streams.
import fs from "node:fs";
import { loadScrapers, cachedText, validateStream, resOf, curlText } from "./plugins.mjs";
import { runScraper } from "./nuvio-host.mjs";
import { preserveSpecialSeason, matchesEpisode, matchesSpecialDuration } from './episode-match.mjs';

const TMDB = process.env.TMDB_API_KEY || "8265bd1679663a7ea12ac168da84d2e8";
let all = null;
function init() {
	if (all) return;
	const wl = JSON.parse(fs.readFileSync(new URL("./working.json", import.meta.url), "utf8"));
	const byKey = new Map(loadScrapers().map((s) => [s.repo + "|" + s.name, s]));
	all = wl.map((w) => ({ ...w, s: byKey.get(w.repo + "|" + w.name) })).filter((w) => w.s);
}
const tmdbCache = new Map();
async function toTmdb(imdb, type) {
	if (tmdbCache.has(imdb)) return tmdbCache.get(imdb);
	const d = await fetch("https://api.themoviedb.org/3/find/" + imdb + "?external_source=imdb_id&api_key=" + TMDB, { signal: AbortSignal.timeout(10000) }).then((r) => r.json());
	const id = (type === "movie" ? d.movie_results : d.tv_results)?.[0]?.id;
	tmdbCache.set(imdb, id || null);
	while (tmdbCache.size > 300) tmdbCache.delete(tmdbCache.keys().next().value);
	return id || null;
}
const lang = (r) => { const t = [r.title, r.name, r.quality, r.language].join(' ').toLowerCase(); return /dublaj|türkçe|turkce|turkish dub/.test(t) ? 'Dublaj' : /altyaz|sub/.test(t) ? 'Altyazı' : /orijinal|original/.test(t) ? 'Orijinal' : ''; };
function probeLang(r, guess) {
	try {
		if (!/\.m3u8/i.test(r.url) && !/mpegurl/i.test(r.type || "")) return guess === "Dublaj" ? "?" : guess;
		const t = curlText(r.url, { headers: r.headers || {}, maxTime: 12 });
		if (!/^#EXTM3U/.test(t)) return guess === "Dublaj" ? "?" : guess;
		const media = t.split("\n").filter((l) => /^#EXT-X-MEDIA:/.test(l));
		const aud = media.filter((l) => /TYPE=AUDIO/.test(l)), sub = media.filter((l) => /TYPE=SUBTITLES/.test(l));
		const isTr = (l) => /LANGUAGE="(tr|tur)[^"]*"|NAME="[^"]*(t[uü]rk|turkish)/i.test(l);
		if (aud.some(isTr)) return "Dublaj";
		if (aud.length && !aud.some(isTr)) return sub.some(isTr) || guess === "Altyazı" || guess === "Dublaj" ? "Altyazı" : "Orijinal";
		return guess === "Dublaj" ? "?" : guess;
	} catch { return guess === "Dublaj" ? "?" : guess; }
}
function sepAudio(r) {
	try {
		if (/\.(mp4|mkv|webm|avi)(\?|$)/i.test(r.url)) return false;
		const t = curlText(r.url, { headers: r.headers || {}, maxTime: 8 });
		return /^\s*#EXTM3U/.test(t) && /#EXT-X-MEDIA:TYPE=AUDIO[^\n]*URI=/.test(t);
	} catch { return false; }
}
const label = (r) => { const n = resOf(r.quality || r.title || r.name); return n >= 2160 ? "4K" : n >= 1440 ? "2K" : n ? n + "p" : ""; };
const px = (u, h) => BRIDGE_ORIGIN + "/px?u=" + encodeURIComponent(u) + (h?.Referer || h?.referer ? "&r=" + encodeURIComponent(h.Referer || h.referer) : "") + (h?.Origin || h?.origin ? "&o=" + encodeURIComponent(h.Origin || h.origin) : "");

export async function pluginStreams(type, id, sink, log = () => {}) {
	init();
	const [imdb, se, ep] = id.split(":");
	const tmdbId = await toTmdb(imdb, type === "series" ? "tv" : "movie");
	if (!tmdbId) return sink;
	const args = type === "series" ? { tmdbId: String(tmdbId), mediaType: "tv", season: +se, episode: +ep } : { tmdbId: String(tmdbId), mediaType: "movie" };
	const special = type === 'series' && args.season === 0;
	let specialMinutes = 0;
	if (special) {
		try { const response = await fetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/season/0/episode/' + args.episode + '?api_key=' + TMDB, {signal:AbortSignal.timeout(7000)}); if(response.ok) specialMinutes = Number((await response.json()).runtime) || 0; } catch {}
	}
	let foreign = 0;
	const ok = (w) => !w.s.types.length || w.s.types.some((t) => (type === "series" ? /tv|series|anime/i : /movie/i).test(t));
	const jobs = all.filter(ok).map(async (w) => {
		try {
			let code = cachedText(w.s.codeUrl);
			if (special) code = preserveSpecialSeason(code, w.repo, w.name);
			const { results } = await runScraper({ code, filename: w.s.filename, scraperId: w.s.id, args, timeoutMs: 35000 });
			const cand = (results || []).filter((r) => r && r.url && !r.infoHash).slice(0, 6);
			let n = 0;
			for (const r of cand) {
				if (n >= 1) break;
				if (type === 'series' && !matchesEpisode(r, args.season, args.episode)) { log('episode mismatch rejected',w.name,id); continue; }
				const g0 = lang(r); if (w.group !== 'foreign' && g0 === 'Orijinal') continue;
				const v = validateStream(r, { minSeconds: special ? 30 : type === "series" ? 600 : 1800 });
				if (!v.ok) continue;
				if (special && !matchesSpecialDuration(v.seconds, specialMinutes)) { log('special duration mismatch rejected',w.name,id,v.seconds,'expected minutes',specialMinutes); continue; }
				if (w.group === "foreign") { if (foreign >= 4) break; foreign++; }
				n++;
				const L = w.group === 'foreign' ? '' : probeLang(r, g0); if (w.group !== 'foreign' && L === 'Orijinal') continue;
				const isHls = /\.m3u8/i.test(r.url) || /mpegurl/i.test(r.type || "");
				let url = r.headers && Object.keys(r.headers).length ? px(r.url, r.headers) : r.url;
				if (w.tx) url = BRIDGE_ORIGIN + "/tx/start?u=" + encodeURIComponent(px(r.url, r.headers || {}));
				else if (sepAudio(r)) url = BRIDGE_ORIGIN + "/tx/start?c=1&u=" + encodeURIComponent(px(r.url, r.headers || {}));
				sink.push({ name: (w.group === "foreign" ? "Yabanci" : "TR") + (L && L !== "?" ? " " + L : " (dil belirsiz)") + " · " + w.name + (label(r) ? " " + label(r) : ""), _l: L, title: String(r.title || r.name || w.name), url: isHls && !/\.m3u8/i.test(url.split("#")[0]) ? url + "#.m3u8" : url, _res: resOf(r.quality || r.title || ""), _g: w.group });
			}
		} catch (e) { log("plugin", w.name, e.message); }
	});
	await Promise.allSettled(jobs);
	return sink;
}

