// Repo loading + stream validation helpers for Nuvio JS plugin repositories.
import { execFileSync, execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(dir, "cache");
fs.mkdirSync(CACHE, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const REPOS = [
	{ id: "hansmega", group: "tr", url: "https://raw.githubusercontent.com/pnthancyb/hans-mega/main/manifest.json" },
	{ id: "rareanime", group: "foreign", url: "https://raw.githubusercontent.com/rareanimeaddon-blip/Nuvio-plugins/main/manifest.json" },
	{ id: "anthology", group: "tr", url: "https://raw.githubusercontent.com/falsisdev/anthology/main/manifest.json" },
	{ id: "patr0n", group: "tr", url: "https://raw.githubusercontent.com/patr0nq/nuvioaddons/refs/heads/main/manifest.json" },
	{ id: "csnuvio", group: "tr", url: "https://raw.githubusercontent.com/csprofesor/csnuvio/main/manifest.json" },
	{ id: "wiosinema", group: "tr", url: "https://raw.githubusercontent.com/Wiojelt/Nuvio-Addons/main/manifest.json" },
	{ id: "manitux", group: "tr", url: "https://raw.githubusercontent.com/manitux-app/nuvio-plugins/refs/heads/main/manifest.json" },
	{ id: "izlelan", group: "tr", url: "https://izlelan.com/manifest.json" },
	{ id: "manitux-test", group: "tr", url: "https://raw.githubusercontent.com/manitux-app/nuvio-test-plugins/refs/heads/main/manifest.json" },
	{ id: "dexter", group: "tr", url: "https://raw.githubusercontent.com/justemir84/nuvio-dexter-plugin/main/manifest.json" },
	{ id: "jasoelys", group: "tr", url: "https://nuvio.jasoelys.workers.dev/manifest.json" },
	{ id: "k-dizibox", group: "tr", url: "https://raw.githubusercontent.com/kratoskrator/dizibox-nuvio/HEAD/manifest.json" },
	{ id: "k-hdfc", group: "tr", url: "https://raw.githubusercontent.com/kratoskrator/hdfilmcehennemi-nuvio/HEAD/manifest.json" },
	{ id: "k-diziyou", group: "tr", url: "https://raw.githubusercontent.com/kratoskrator/diziyou-nuvio/HEAD/manifest.json" },
	{ id: "wiocinema", group: "foreign", url: "https://raw.githubusercontent.com/Wiojelt/Nuvio-Addons/main/wiocinema/manifest.json" },
	{ id: "yoruix", group: "foreign", url: "https://raw.githubusercontent.com/yoruix/nuvio-providers/refs/heads/main/manifest.json" },
	{ id: "allinone", group: "foreign", url: "https://raw.githubusercontent.com/ktsevents/nuvio/HEAD/manifest.json" },
];

export function curlText(url, { headers = {}, referer, maxTime = 30 } = {}) {
	const args = ["-s", "-L", "-m", String(maxTime), "--compressed", "-A", UA];
	if (referer) args.push("-e", referer);
	for (const [k, v] of Object.entries(headers)) args.push("-H", k + ": " + v);
	args.push(url);
	return execFileSync("curl.exe", args, { maxBuffer: 30 * 1024 * 1024 }).toString("utf8");
}
const key = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
export function cachedText(url, ttlMs = 6 * 3600 * 1000) {
	const f = path.join(CACHE, key(url) + ".txt");
	try { if (Date.now() - fs.statSync(f).mtimeMs < ttlMs) return fs.readFileSync(f, "utf8"); } catch {}
	const t = curlText(url);
	if (t && t.length > 20) fs.writeFileSync(f, t);
	return t;
}

export function loadScrapers(repos = REPOS) {
	const out = [];
	for (const repo of repos) {
		let man; try { man = JSON.parse(cachedText(repo.url)); } catch { continue; }
		for (const s of man.scrapers || []) {
			if (s.enabled === false || !s.filename) continue;
			out.push({ repo: repo.id, group: repo.group, id: s.id, name: s.name, filename: s.filename, codeUrl: new URL(s.filename, repo.url).toString(), types: s.supportedTypes || [], langs: s.contentLanguage || [] });
		}
	}
	return out;
}

const RES = (q) => { const m = String(q || "").match(/(\d{3,4})p|(4k|2160|1440|2k)/i); if (!m) return 0; if (m[1]) return +m[1]; const t = m[2].toLowerCase(); return t === "4k" || t === "2160" ? 2160 : 1440; };
export const resOf = RES;

function curlHead(url, headers, referer, range) {
	const args = ["-s", "-L", "-m", "25", "-A", UA, "-D", "-", "-o", "NUL"];
	if (range) args.push("-r", range);
	if (referer) args.push("-e", referer);
	for (const [k, v] of Object.entries(headers || {})) args.push("-H", k + ": " + v);
	args.push(url);
	const out = execFileSync("curl.exe", args, { maxBuffer: 5 * 1024 * 1024 }).toString("utf8");
	const blocks = out.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b.trim()));
	const last = blocks[blocks.length - 1] || "";
	const status = Number(last.match(/^HTTP\/[\d.]+ (\d+)/)?.[1] || 0);
	const h = {}; for (const l of last.split(/\r?\n/).slice(1)) { const i = l.indexOf(":"); if (i > 0) h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }
	return { status, h };
}

// Validate that a stream result is a direct, playable video: HLS with a real duration, or a large mp4.
export function validateStream(r, { minSeconds = 600 } = {}) {
	const url = String(r.url || ""); if (!/^https?:\/\//i.test(url)) return { ok: false, why: "no http url" };
	const headers = { ...(r.headers || {}) }; const referer = headers.Referer || headers.referer; delete headers.Referer; delete headers.referer;
	try {
		const isM3u = /\.m3u8|\/m3u8|master\.txt|playlist/i.test(url) || /m3u8/i.test(JSON.stringify(r.type || ""));
		let text = ""; let hls = isM3u;
		if (isM3u) text = curlText(url, { headers: { ...headers, ...(referer ? { Referer: referer } : {}) } , maxTime: 25 });
		else { const hd = curlHead(url, headers, referer, "0-1023"); const ct = hd.h["content-type"] || ""; if (/mpegurl/i.test(ct)) { hls = true; text = curlText(url, { headers: { ...headers, ...(referer ? { Referer: referer } : {}) }, maxTime: 25 }); }
			else { if (hd.status !== 200 && hd.status !== 206) return { ok: false, why: "http " + hd.status }; const total = Number((hd.h["content-range"] || "").split("/")[1] || hd.h["content-length"] || 0); const video = /video|octet-stream|matroska|mp4/i.test(ct) || /\.(mp4|mkv|webm)(\?|$)/i.test(url); if (!video) return { ok: false, why: "not video: " + ct.slice(0, 30) }; if (total && total < 30 * 1024 * 1024) return { ok: false, why: "too small " + total }; return { ok: true, kind: "file", mb: total ? Math.round(total / 1048576) : null }; } }
		if (!/^#EXTM3U/.test(text.trim())) return { ok: false, why: "not a playlist" };
		let pl = text, base = url, res = "";
		if (/#EXT-X-STREAM-INF/.test(text)) {
			const lines = text.split(/\r?\n/).map((l) => l.trim()); let best = null, bw = -1;
			for (let i = 0; i < lines.length; i++) if (lines[i].startsWith("#EXT-X-STREAM-INF")) { const b = Number(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] || 0); const rs = lines[i].match(/RESOLUTION=(\d+x\d+)/)?.[1] || ""; const u = lines.slice(i + 1).find((x) => x && !x.startsWith("#")); if (u && b >= bw) { bw = b; best = u; res = rs; } }
			if (!best) return { ok: false, why: "no variants" };
			base = new URL(best, url).toString(); pl = curlText(base, { headers: { ...headers, ...(referer ? { Referer: referer } : {}) }, maxTime: 25 });
		}
		let sec = 0, segs = 0, first = null; const lines2 = pl.split(/\r?\n/);
		for (let i = 0; i < lines2.length; i++) { const m = lines2[i].match(/^#EXTINF:([\d.]+)/); if (m) { sec += parseFloat(m[1]); segs++; if (!first) first = lines2.slice(i + 1).find((x) => x && !x.startsWith("#")); } }
		if (sec < minSeconds) return { ok: false, why: "short " + Math.round(sec) + "s" };
		if (first) { const su = new URL(first.trim(), base).toString(); const hd = curlHead(su, headers, referer, "0-1023"); if (hd.status !== 200 && hd.status !== 206) return { ok: false, why: "segment http " + hd.status }; }
		return { ok: true, kind: "hls", seconds: sec, minutes: Math.round(sec / 60), res };
	} catch (e) { return { ok: false, why: String(e.message).slice(0, 60) }; }
}

