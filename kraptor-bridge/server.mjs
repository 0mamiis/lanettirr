// Stremio addon built from Kraptor (cs-kraptor fork) provider logic ported to JavaScript.
// No CloudStream runtime needed: providers live in this folder (currently fhd.mjs).
import http from "node:http";
import fs from "node:fs";
import pathMod from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canPlayDirect, fixTargetDuration, createMediaCache } from './playback-compat.mjs';
import { rankStreams } from './smart-rank.mjs';
import { nativeRepoResponse } from './native-repo-gateway.mjs';
const TXDIR = process.env.BRIDGE_TXDIR || pathMod.join(pathMod.dirname(fileURLToPath(import.meta.url)), "tx");
fs.mkdirSync(TXDIR, { recursive: true });
function resolveFfmpeg() {
	if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
	const la = process.env.LOCALAPPDATA;
	if (la) {
		const link = pathMod.join(la, "Microsoft", "WinGet", "Links", "ffmpeg.exe");
		if (fs.existsSync(link)) return link;
		const pkgs = pathMod.join(la, "Microsoft", "WinGet", "Packages");
		try {
			for (const pkg of fs.readdirSync(pkgs)) {
				if (!pkg.startsWith("Gyan.FFmpeg")) continue;
				const pkgDir = pathMod.join(pkgs, pkg);
				for (const sub of fs.readdirSync(pkgDir)) {
					const bin = pathMod.join(pkgDir, sub, "bin", "ffmpeg.exe");
					if (fs.existsSync(bin)) return bin;
				}
			}
		} catch {}
	}
	return "ffmpeg";
}
const FFMPEG = resolveFfmpeg();
process.on("uncaughtException", (e) => console.log("uncaught", e && e.message));
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const mediaCache = createMediaCache();
const txJobs = new Map();
const txBySource = new Map();
const TX_MAX_ACTIVE = 2;
const TX_ACTIVE_IDLE_MS = 15 * 60 * 1000;
const TX_FINISHED_IDLE_MS = 10 * 60 * 1000;
const SEG = 6;
function txSpawn(job) {
	if (job.p) return;
	job.exited = false;
	job.code = null;
	const args = ["-hide_banner", "-loglevel", "error", "-rw_timeout", "20000000", "-allowed_extensions", "ALL", "-extension_picky", "0", "-i", job.u, "-map", "0:v:0", "-map", "0:a:0?", ...(job.copy ? ["-c:v", "copy", "-c:a", "copy"] : ["-vf", "scale=-2:'min(1080,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-force_key_frames", "expr:gte(t,n_forced*" + SEG + ")", "-c:a", "aac", "-b:a", "160k"]), "-f", "hls", "-hls_time", String(SEG), "-hls_list_size", "0", "-start_number", "0", "-hls_flags", "independent_segments", "-hls_segment_filename", pathMod.join(job.dir, "s%05d.ts"), pathMod.join(job.dir, "idx_0.m3u8")];
	const p = spawn(FFMPEG, args, { windowsHide: true });
	p.on("error", (e) => { log("ffmpeg spawn error", e.message); if (job.p === p) { job.exited = true; job.code = -1; job.error = e.message; job.finishedAt = Date.now(); } });
	p.stderr.on("data", (x) => log("ffmpeg", String(x).slice(0, 160)));
	p.on("exit", (c) => { if (job.p === p) { job.exited = true; job.code = c; job.finishedAt = Date.now(); } log("ffmpeg exit", c, "for", job.id); });
	job.p = p;
}
async function txStart(u, copy = false) {
	const sourceKey = crypto.createHash("sha1").update((copy ? "c:" : "t:") + u).digest("hex");
	let job = txJobs.get(txBySource.get(sourceKey));
	if (job && job.exited && job.code !== 0) { dropTxJob(job); job = null; }
	if (job) { job.lastAccess = Date.now(); return job; }
	const active = [...txJobs.values()].filter((x) => !x.exited).length;
	if (active >= TX_MAX_ACTIVE) { const e = new Error("transmux busy"); e.code = "busy"; throw e; }
	const id = crypto.randomBytes(6).toString("hex");
	const dir = pathMod.join(TXDIR, id);
	fs.mkdirSync(dir, { recursive: true });
	job = { id, dir, u, copy, p: null, exited: false, code: null, lastAccess: Date.now(), sourceKey };
	txJobs.set(id, job); txBySource.set(sourceKey, id); txSpawn(job);
	return job;
}
function dropTxJob(job) {
	if (!job) return;
	try { if (job.p && !job.exited) job.p.kill(); } catch {}
	if (txJobs.get(job.id) === job) txJobs.delete(job.id);
	if (txBySource.get(job.sourceKey) === job.id) txBySource.delete(job.sourceKey);
	try { fs.rmSync(job.dir, { recursive: true, force: true }); } catch (e) { log("tx cleanup failed", job.id, e.message); }
}
function cleanupTxJobs() {
	const now = Date.now();
	for (const job of txJobs.values()) {
		const ttl = job.exited ? TX_FINISHED_IDLE_MS : TX_ACTIVE_IDLE_MS;
		if (now - job.lastAccess > ttl) { log("tx idle cleanup", job.id, job.exited ? "finished" : "active"); dropTxJob(job); }
	}
}
const txCleanupTimer = setInterval(cleanupTxJobs, 60_000);
txCleanupTimer.unref();
function shutdownTxJobs() { for (const job of [...txJobs.values()]) dropTxJob(job); }
process.once("SIGTERM", () => { shutdownTxJobs(); process.exit(0); });
process.once("SIGINT", () => { shutdownTxJobs(); process.exit(0); });
const segName = (job, i) => pathMod.join(job.dir, "s" + String(i).padStart(5, "0") + ".ts");
function readTxPlaylist(job) {
	try {
		const raw = fs.readFileSync(pathMod.join(job.dir, "idx_0.m3u8"), "utf8");
		if (!raw.startsWith("#EXTM3U")) return null;
		const lines = raw.split(/\r?\n/);
		let lastSegment = -1;
		for (let i = 0; i < lines.length; i++) if (/^s\d{5}\.ts$/.test(lines[i])) lastSegment = i;
		if (lastSegment < 0) return null;
		const complete = job.exited && job.code === 0;
		const out = lines.slice(0, lastSegment + 1).filter((line) => !/^#EXT-X-PLAYLIST-TYPE:/.test(line) && !/^#EXT-X-START:/.test(line));
		const firstEntry = out.findIndex((line) => /^#EXTINF:/.test(line));
		out.splice(firstEntry < 0 ? out.length : firstEntry, 0,
			complete ? "#EXT-X-PLAYLIST-TYPE:VOD" : "#EXT-X-PLAYLIST-TYPE:EVENT",
			"#EXT-X-START:TIME-OFFSET=0.000,PRECISE=YES");
		if (complete) out.push("#EXT-X-ENDLIST");
		return out.join("\n") + "\n";
	} catch { return null; }
}
async function txSegment(job, k) {
	const name = "s" + String(k).padStart(5, "0") + ".ts";
	const listed = () => !!readTxPlaylist(job)?.split(/\r?\n/).includes(name);
	if (!listed()) return null;
	for (let i = 0; i < 20; i++) {
		if (fs.existsSync(segName(job, k))) return fs.readFileSync(segName(job, k));
		if (job.exited) return null;
		await sleepMs(100);
	}
	return null;
}

import { execFile } from "node:child_process";
import * as fhd from "./fhd.mjs";
import * as dm from "./dizimom.mjs";
import * as dy from "./diziyou.mjs";
import * as dp from "./dizipal.mjs";
import { fork } from "node:child_process";
let child = null, rseq = 0; const waiters = new Map();
function getChild() { if (child && child.connected) return child; child = fork(new URL("./pluginchild.mjs", import.meta.url)); child.on("message", (m) => { const w = waiters.get(m.rid); if (!w) return; w.sink.length = 0; w.sink.push(...m.snap); if (m.done) { waiters.delete(m.rid); w.res(); } }); child.on("exit", () => { for (const w of waiters.values()) w.res(); waiters.clear(); child = null; }); return child; }
function pluginStreams(type, id, sink) { return new Promise((res) => { const rid = ++rseq; waiters.set(rid, { sink, res }); getChild().send({ rid, type, id }); setTimeout(() => { if (waiters.delete(rid)) res(); }, 60000); }); }

const PORT = Number(process.env.BRIDGE_PORT || 7000);
const ORIGIN = process.env.BRIDGE_ORIGIN || ("http://127.0.0.1:" + PORT);
const CACHE_MS = 10 * 60 * 1000;
const MANIFEST = {
	id: "local.kraptor.js",
	version: "4.0.0",
	name: "Feroxx Kekik (Kraptor devami)",
	description: "Feroxx/Kekik-cloudstream (güncel) sağlayıcılarının JS portu. Filmler: FullHDFilmizlesene. Diziler: DiziPal, DiziYou, DiziDAD (giriş isteyen kaynaklar elenir).",
	resources: [
		{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt", "tv:"] },
		{ name: "meta", types: ["movie"], idPrefixes: ["tv:"] },
	],
	types: ["movie", "series"],
	idPrefixes: ["tt", "tv:"],
	catalogs: [],
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
	.replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout " + label)), ms))]);
function capMap(m, max) { while (m.size > max) m.delete(m.keys().next().value); }
const cache = new Map();

async function j(url, opts) {
	const r = await fetch(url, opts && opts.signal ? opts : { ...(opts || {}), signal: AbortSignal.timeout(15000) });
	if (!r.ok) throw new Error(url + " -> " + r.status);
	return r.json();
}

async function wikidataTr(imdb) {
	const q = 'SELECT ?l WHERE { ?i wdt:P345 "' + imdb + '" . ?i rdfs:label ?l . FILTER(lang(?l)="tr") } LIMIT 1';
	const d = await j("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), {
		headers: { accept: "application/sparql-results+json", "user-agent": "kraptor-js/1.0 (local)" },
	});
	return d.results?.bindings?.[0]?.l?.value || null;
}

async function meta(type, imdb) {
	const d = await j("https://v3-cinemeta.strem.io/meta/" + type + "/" + imdb + ".json");
	const m = d.meta || {};
	const year = parseInt(String(m.year || m.releaseInfo || "").slice(0, 4), 10) || null;
	const tr = await withTimeout(wikidataTr(imdb), 8000, "wikidata").catch(() => null);
	return { name: m.name, year, tr };
}

function pick(results, titles, year) {
	const ts = titles.filter(Boolean).map(norm).filter(Boolean);
	let best = null, bestScore = 0;
	for (const r of results) {
		const names = [r.name, r.alt].filter(Boolean).map(norm);
		let s = 0;
		for (const t of ts) for (const n of names) {
			let c = 0;
			if (n === t) c = 100; else if (n.startsWith(t + " ") || t.startsWith(n + " ")) c = 60;
			if (c > s) s = c;
		}
		if (!s) continue;
		if (year && r.year) s += Math.abs(r.year - year) <= 1 ? 30 : -80;
		if (s > bestScore) { best = r; bestScore = s; }
	}
	return bestScore >= 90 ? best : null;
}

const PROXY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CURL_MAX_BYTES = Math.max(8, Math.min(128, Number(process.env.CURL_MAX_MB || 48) || 48)) * 1024 * 1024;
function isSafeProxyTarget(raw) {
	let u; try { u = new URL(String(raw || "")); } catch { return false; }
	if (u.protocol !== "http:" && u.protocol !== "https:") return false;
	const host = String(u.hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
	if (!host || host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal" || host === "metadata") return false;
	const isPriv4 = (ip) => { const p = ip.split(".").map(Number); return p.length !== 4 || p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168); };
	const ver = netCP.isIP(host);
	if (ver === 4) return !isPriv4(host);
	if (ver === 6) {
		if (host === "::" || host === "::1" || /^(fe[89ab]|fc|fd)/i.test(host)) return false;
		const m4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host);
		if (m4) return !isPriv4(m4[1]);
		const m4h = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
		if (m4h) { const hi = parseInt(m4h[1], 16), lo = parseInt(m4h[2], 16); return !isPriv4([(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join(".")); }
	}
	return true;
}
function curlBuf(url, referer, origin) {
	const args = ["-s", "-L", "-m", "40", "--compressed", "-A", PROXY_UA, "-w", "\n__STATUS__%{http_code}__CT__%{content_type}"];
	if (referer) args.push("-e", referer);
	if (origin) args.push("-H", "Origin: " + origin);
	args.push(url);
	return new Promise((resolve, reject) => {
		execFile(process.platform === "win32" ? "curl.exe" : "curl", args, { maxBuffer: CURL_MAX_BYTES, encoding: "buffer", windowsHide: true }, (e, out) => {
			if (e) return reject(new Error("curl transport failed: " + (e.code || e.message)));
			if (!out || !out.length) return reject(new Error("curl returned an empty response"));
			const idx = out.lastIndexOf("\n__STATUS__");
			const m = out.subarray(idx).toString("utf8").match(/__STATUS__(\d+)__CT__(.*)/);
			if (idx < 0 || !m || Number(m[1]) < 100) return reject(new Error("curl response ended without a valid HTTP status"));
			resolve({ status: m ? Number(m[1]) : 0, ct: m ? m[2].trim() : "", body: idx >= 0 ? out.subarray(0, idx) : out });
		});
	});
}
const pxUrl = (u, r, o, ext = "") => ORIGIN + "/px" + ext + "?u=" + encodeURIComponent(u) + "&r=" + encodeURIComponent(r || "") + "&o=" + encodeURIComponent(o || "");
// FFmpeg/mpv re-reads playlists with Range requests. Without 206 + Content-Length it hits a false EOF,
// which shows up as a black player with a 1 second duration.
function sendBody(req, res, body, contentType, status, baseHeaders) {
	const headers = { ...baseHeaders, "content-type": contentType, "accept-ranges": "bytes" };
	const range = req.headers.range;
	const total = body.length;
	if (range) {
		const match = /bytes=(\d*)-(\d*)/.exec(range);
		if (match) {
			let start;
			let end;
			if (match[1] === "") { start = Math.max(0, total - Number(match[2] || 0)); end = total - 1; }
			else { start = Number(match[1]); end = match[2] === "" ? total - 1 : Math.min(Number(match[2]), total - 1); }
			if (start >= total) {
				res.writeHead(416, { ...headers, "content-range": "bytes */" + total });
				return res.end();
			}
			const slice = body.subarray(start, end + 1);
			res.writeHead(206, { ...headers, "content-range": "bytes " + start + "-" + end + "/" + total, "content-length": String(slice.length) });
			return res.end(slice);
		}
	}
	res.writeHead(status, { ...headers, "content-length": String(total) });
	return res.end(body);
}
function muxFix(text) {
	if (!/#EXT-X-STREAM-INF/.test(text) || !/#EXT-X-MEDIA:TYPE=AUDIO/.test(text)) return text;
	const vs = text.split("\n").filter((l) => l && !l.startsWith("#"));
	if (!vs.length || !vs.every((l) => /-v\d+-a\d+\.m3u8/i.test(decodeURIComponent(l)))) return text;
	return text.split("\n").filter((l) => !/^#EXT-X-MEDIA:TYPE=AUDIO/.test(l) && !/^#EXT-X-I-FRAME-STREAM-INF/.test(l)).map((l) => l.replace(/,AUDIO="[^"]*"/, "")).join("\n");
}
function rewritePlaylist(text, base, r, o) {
	let nextIsPlaylist = false;
	return text.split("\n").map((line) => {
		const t = line.trim();
		if (!t) return line;
		if (t.startsWith("#")) {
			nextIsPlaylist = /^#EXT-X-STREAM-INF/.test(t);
			const ext = /^#EXT-X-KEY|^#EXT-X-SESSION-KEY/.test(t) ? "/k.key" : /^#EXT-X-MAP/.test(t) ? "/i.mp4" : "/p.m3u8";
			return line.replace(/URI="([^"]+)"/g, (mm, u) => 'URI="' + pxUrl(new URL(u, base).toString(), r, o, ext) + '"');
		}
		const abs = new URL(t, base).toString();
		const ext = nextIsPlaylist || /\.m3u8(\?|$)/i.test(abs) ? "/p.m3u8" : "/s.ts";
		nextIsPlaylist = false;
		return pxUrl(abs, r, o, ext);
	}).join("\n");
}

async function seriesStreams(m, id, titles, sink = []) {
	const parts = id.split(":"); const season = parseInt(parts[1], 10), episode = parseInt(parts[2], 10);
	if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1) return [];
	const ts = titles.map(norm);
	const out = sink;

	const DIZIPAL_ON = false; // site API removed (2026-10-20)
	// DiziPal: search API (English names + year), AES iframe, DPlayer m3u8 behind a referer-checking CDN (proxied).
	try {
		if (!DIZIPAL_ON) throw new Error('disabled');
		let rs = [];
		for (const t of titles) rs = rs.concat(await dp.search(t));
		const clean = (n) => norm(String(n).replace(/\s*T[üu]rk[çc]e Dublaj\s*/i, " "));
		const cands = [...new Map(rs.filter((r) => /series/i.test(r.type) && ts.includes(clean(r.name)) && (!m.year || !r.year || Math.abs(r.year - m.year) <= 2)).map((r) => [r.url, r])).values()];
		log("dizipal candidates:", cands.map((x) => x.name).join(", ") || "none");
		for (const cnd of cands.slice(0, 2)) {
			const ep = (await dp.episodes(cnd.url)).find((x) => x.season === season && x.episode === episode);
			if (!ep) continue;
			for (const x of await dp.streams(ep.url)) out.push({
				name: "Feroxx · DiziPal",
				title: m.name + " S" + season + "E" + episode + "\n" + (/dublaj/i.test(cnd.name) ? "Türkçe Dublaj" : "Altyazılı / çok dilli") + " (DPlayer)",
				url: pxUrl(x.url, x.referer, x.origin) + "#.m3u8",
				subtitles: (x.subs || []).map((s, i) => ({ id: "dp" + i, url: pxUrl(s.url, x.referer, x.origin), lang: s.lang })),
			});
		}
	} catch (e) { if (e.message !== "disabled") log("dizipal error", e.message); }

	// DiziYou: direct storage m3u8, matched by title (+ year).
	try {
		let rs = [];
		for (const t of titles) rs = rs.concat(await dy.search(t));
		const hit = rs.find((r) => ts.includes(norm(r.name)) && (!m.year || !r.year || Math.abs(r.year - m.year) <= 1));
		log("diziyou match:", hit ? hit.name + " " + hit.url : "none");
		if (hit) {
			const ep = (await dy.episodes(hit.url)).find((x) => x.season === season && x.episode === episode);
			if (ep) for (const x of await dy.streams(ep.url)) out.push({
				name: "Feroxx · DiziYou",
				title: m.name + " S" + season + "E" + episode + "\n" + x.label,
				url: x.url + "#.m3u8",
				subtitles: (x.subs || []).map((s, i) => ({ id: "dy" + i, url: s.url, lang: s.lang })),
			});
		}
	} catch (e) { log("diziyou error", e.message); }
	const rank = (n) => (/DiziYou/.test(n) ? 0 : /DiziPal/.test(n) ? 1 : 2);
	out.sort((x, y) => rank(x.name) - rank(y.name));
	return out;
}

async function baseStreams(type, id) {
	const hit = cache.get("b"+id);
	if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
	const m = await meta(type, id.split(":")[0]);
	if (!m.name) return [];
	log("stream", id, "->", m.name, m.year || "", "tr:", m.tr || "-");
	const titles = [...new Set([m.tr, m.name].filter(Boolean))];
	if (type === "series") {
		const sink = [];
		const job = withTimeout(seriesStreams(m, id, titles, sink), 90000, "series").catch((e) => { log("series error", e.message); return sink; }).then((r) => { if (r.length) cache.set("b"+id, { t: Date.now(), v: r }); log("streams (final):", r.length); return r; });
		const ss = await Promise.race([job, new Promise((res) => setTimeout(() => res(null), 12000))]);
		if (ss) return ss;
		const rank = (n) => (/DiziYou/.test(n) ? 0 : /DiziPal/.test(n) ? 1 : 2);
		log("returning partial:", sink.length);
		return [...sink].sort((x, y) => rank(x.name) - rank(y.name));
	}
	let found = null;
	for (const t of titles) {
		const res = await fhd.search(t);
		found = pick(res, titles, m.year);
		if (found) break;
	}
	if (!found) { log("no match on FullHDFilmizlesene"); return []; }
	log("match:", found.name, found.url);
	const { out } = await withTimeout(fhd.streams(found.url), 60000, "streams");
	const streams = out.filter((s) => s.url).map((s) => ({
		name: "Kraptor · FHD",
		title: found.name + "\n" + s.label + " (RapidVid)",
		url: ORIGIN + "/tx/start?c=1&u=" + encodeURIComponent(ORIGIN + "/px?u=" + encodeURIComponent(s.url) + (s.referer ? "&r=" + encodeURIComponent(s.referer) + "&o=" + encodeURIComponent(s.referer.replace(/\/+$/, "")) : "")),
		subtitles: (s.subs || []).map((x, i) => ({ id: "fhd" + i, url: x.url, lang: x.lang })),
	}));
	log("streams:", streams.length);
	if (streams.length) { cache.set("b"+id, { t: Date.now(), v: streams }); capMap(cache, 120); }
	return streams;
}


const mcache = new Map();
function merge(base, plug) {
	const seen = new Set();
	return [...base, ...plug].filter((x) => x && x.url && (seen.has(x.url) ? false : seen.add(x.url)));
}
import * as jet from "./prov_jetfilmizle.mjs";
import * as cm from "./prov_cizgimax.mjs";
import * as bb from "./bigbull.mjs";
import netCP from "node:net";
const NEXT_SEG = new Map();   // parca sorgusu -> sonraki 3 parca (on-indirme icin)
function rememberSegs(pl) { const q = []; for (const l of pl.split(/\r?\n/)) { const i = l.indexOf("/px/s.ts?"); if (i >= 0 && !l.startsWith("#")) q.push(l.slice(i + 9).trim()); } for (let k = 0; k < q.length; k++) NEXT_SEG.set(q[k], q.slice(k + 1, k + 4)); while (NEXT_SEG.size > 2000) NEXT_SEG.delete(NEXT_SEG.keys().next().value); }
const EGRESS_PORT = Number(process.env.EGRESS_PORT || 7301);
const CLIENT_PX = Object.fromEntries(["127.0.0.1", ...String(process.env.CLIENT_PX_IPS || "").split(",").map((s) => s.trim()).filter(Boolean)].map((ip) => [ip, 1]));
const cpState = new Map();
function clientUp(ip) { const x = cpState.get(ip); if (x && Date.now() - x.t < 20000) return Promise.resolve(x.ok); return new Promise((ok) => { const so = netCP.connect(EGRESS_PORT, ip); const done = (v) => { so.destroy(); cpState.set(ip, { ok: v, t: Date.now() }); capMap(cpState, 64); ok(v); }; so.setTimeout(800, () => done(false)); so.once("connect", () => done(true)); so.once("error", () => done(false)); }); }

const inflight = new Map();
async function streamsFor(type, id) {
	const hit = mcache.get(id);
	if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
	let st = inflight.get(id);
	if (!st) {
		st = { psink: [], base: [], extra: [], bsink: [] };
		inflight.set(id, st);
		const bbj = (async () => { const m = await meta(type, id.split(':')[0]); const titles = [...new Set([m.tr, m.name].filter(Boolean))]; const [, se, ep] = id.split(':'); await bb.get({ type, titles, year: m.year, season: +se || 1, episode: +ep || 1, out: st.bsink, pxUrl, log }); })().catch((e) => log('bigbull error', e.message));
		const bj = baseStreams(type, id).then((r) => { st.base = r; }).catch(() => {});
		const pj = pluginStreams(type, id, st.psink, log).catch((e) => log("plugins", e.message));
		const ej = (async () => { const m = await meta(type, id.split(':')[0]); const titles = [...new Set([m.tr, m.name].filter(Boolean))]; if (type === 'movie') { const rs = await withTimeout(jet.get({ type: 'movie', titles, year: m.year, season: 0, episode: 0 }), 40000, 'jet'); for (const x of rs) st.extra.push({ name: 'Feroxx · JetFilmizle', title: m.name + '\n' + (x.label || 'JetFilmizle'), url: (x.referer ? pxUrl(x.url, x.referer, x.origin) : x.url) + (/\.m3u8/i.test(x.url) ? '' : '#.m3u8'), subtitles: (x.subs || []).map((s, i) => ({ id: 'jt' + i, url: s.url, lang: s.lang })) }); } else { const [, se, ep] = id.split(':'); const rs = await withTimeout(cm.get({ type: 'series', titles, season: +se, episode: +ep, strict: true }), 40000, 'cm'); for (const x of rs) st.extra.push({ name: 'Feroxx · ÇizgiMax Dublaj', title: m.name + ' S' + se + 'E' + ep + '\nTürkçe dublaj (' + (x.label || 'ÇizgiMax') + ')', url: pxUrl(x.url, x.referer, x.origin) + (/\.m3u8/i.test(x.url) ? '' : '#.m3u8') }); } })().catch((e) => log('jet/cm error', e.message));
		st.all = Promise.all([bj, pj, ej, bbj]).then(async () => { const v = await rankStreams(merge([...st.base, ...st.extra, ...st.bsink], st.psink)); if (v.length) { mcache.set(id, { t: Date.now(), v }); capMap(mcache, 100); } log("merged final:", v.length); }).finally(() => inflight.delete(id));
	}
	const t0 = Date.now();
	await Promise.race([st.all, new Promise((r) => { const iv = setInterval(() => { const n = merge([...st.base, ...st.extra, ...st.bsink], st.psink).length; const el = Date.now() - t0; if ((n >= 4 && el >= 4000) || el >= 9000) { clearInterval(iv); r(); } }, 300); st.all.finally(() => { clearInterval(iv); r(); }); })]);
	const v = await rankStreams(merge([...st.base, ...st.extra, ...st.bsink], st.psink), { probe: false }); log("merged returned:", v.length, "base", st.base.length, "plug", st.psink.length);
	return v;
}

const server = http.createServer(async (req, res) => {
	const h = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "content-type": "application/json; charset=utf-8" };
	if (req.method === "OPTIONS") { res.writeHead(204, h); return res.end(); }
	try {
		let path;
		try { path = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400, h); return res.end(JSON.stringify({ error: "bad url" })); }
		log("REQ", req.method, path.startsWith("/px") ? "/px " + (new URL(req.url, "http://x").searchParams.get("u") || "").slice(0, 70) : path, (req.headers["user-agent"] || "").slice(0, 50), req.headers.range || "");
		if (await nativeRepoResponse(path, req, res)) return;
		if (path === "/tx/start") {
			const u = new URL(req.url, "http://x").searchParams.get("u");
			if (!u) { res.writeHead(400, h); return res.end("{}"); }
			{ let host = "?"; try { host = new URL(u).hostname; } catch {}
				log("txstart", new URL(req.url, "http://x").searchParams.get("c") === "1" ? "copy" : "transcode", host, req.headers.range || ""); }
			if (new URL(req.url, "http://x").searchParams.get("c") === "1") {
				let direct;
				try { direct = new URL(u); } catch {}
				// Accept both /px and token-prefixed /<token>/px paths (mobile bridge uses a token).
				const proxyPath = direct ? direct.pathname.replace(/^\//, "").replace(/^[0-9a-f]{16,}\//, "") : "";
				if (!direct || (direct.origin !== ORIGIN && direct.origin !== "http://127.0.0.1:" + PORT) || !(proxyPath === "px" || proxyPath.startsWith("px/"))) { res.writeHead(400, h); return res.end(JSON.stringify({ error: "copy mode requires a local proxied HLS URL" })); }
				res.writeHead(302, { location: u, "access-control-allow-origin": "*", "cache-control": "no-store" }); return res.end();
			}
			let parsedInput;
			try { parsedInput = new URL(u); } catch { res.writeHead(400, h); return res.end(JSON.stringify({ error: "invalid url" })); }
			const txProxyPath = parsedInput.pathname.replace(/^\//, "").replace(/^[0-9a-f]{16,}\//, "");
			const localProxy = (parsedInput.origin === ORIGIN || parsedInput.origin === 'http://127.0.0.1:' + PORT) && (txProxyPath === 'px' || txProxyPath.startsWith('px/'));
			if (!localProxy && !isSafeProxyTarget(u)) { res.writeHead(403, h); return res.end(JSON.stringify({ error: "forbidden target" })); }
			if (localProxy && await canPlayDirect(u, FFMPEG.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'))) {
				log('direct compatible VOD; transcoding bypassed');
				res.writeHead(302, {location:u, 'access-control-allow-origin':'*', 'cache-control':'no-store'}); return res.end();
			}
			const job = await txStart(u, false);
			job.lastAccess = Date.now();
			for (let i = 0; i < 80; i++) {
				const pl = readTxPlaylist(job) || "";
				if (pl.includes("s00000.ts") && pl.includes("s00001.ts")) break;
				if (job.exited) { res.writeHead(502, h); return res.end(JSON.stringify({ error: "transmux failed", code: job.code })); }
				await sleepMs(250);
			}
			if (!readTxPlaylist(job)?.includes("s00000.ts")) { res.writeHead(504, h); return res.end(JSON.stringify({ error: "transmux startup timeout" })); }
			res.writeHead(302, { location: "/tx/" + job.id + "/index.m3u8", "access-control-allow-origin": "*" }); return res.end();
		}
		const txm = path.match(/^\/tx\/([0-9a-f]{12})\/([\w.]+)$/);
		if (txm) {
			const job = txJobs.get(txm[1]);
			const ch = { "access-control-allow-origin": "*", "cache-control": "no-store" };
			if (!job) { res.writeHead(404, h); return res.end("{}"); }
			job.lastAccess = Date.now();
			if (txm[2] === "index.m3u8") {
				const pl = readTxPlaylist(job);
				if (!pl) { res.writeHead(job.exited ? 502 : 503, { ...ch, "retry-after": "1" }); return res.end("#EXTM3U\n"); }
				res.writeHead(200, { ...ch, "content-type": "application/vnd.apple.mpegurl" }); return res.end(pl);
			}
			const sm = txm[2].match(/^s(\d{5})\.ts$/);
			if (sm) { const b = await txSegment(job, +sm[1]); if (!b) { res.writeHead(job.exited ? 404 : 504, h); return res.end("{}"); } res.writeHead(200, { ...ch, "content-type": "video/mp2t" }); return res.end(b); }
			res.writeHead(404, h); return res.end("{}");
		}

		if (path === "/px/s.ts" && !process.env.NO_CLIENT_PX) {   // video parcasi: izleyen cihazin kendi internetinden cekilsin
			const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim().replace(/^::ffff:/, "").replace(/^::1$/, "127.0.0.1");
			if (CLIENT_PX[ip] && await clientUp(ip)) { const qs = req.url.slice(req.url.indexOf("?") + 1); const nx = NEXT_SEG.get(qs); res.writeHead(302, { location: "http://" + ip + ":" + EGRESS_PORT + "/px/s.ts?" + qs + (nx && nx.length ? "&nx=" + encodeURIComponent(JSON.stringify(nx)) : ""), "access-control-allow-origin": "*", "cache-control": "no-store" }); return res.end(); }
		}
		if (path === "/px" || path.startsWith("/px/")) {
			{ const t0 = Date.now(); const uq = (new URL(req.url, "http://x").searchParams.get("u") || "").slice(-45); res.on("close", () => log("PXRES", res.statusCode, res.writableFinished ? "ok" : "ABORTED", (Date.now() - t0) + "ms", res.getHeader("content-length") || (res.getHeader("transfer-encoding") || ""), uq)); }
			const q = new URL(req.url, "http://x").searchParams;
			const target = q.get("u");
			if (!target || !/^https?:\/\//.test(target)) { res.writeHead(400, h); return res.end("{}"); }
			if (!isSafeProxyTarget(target)) { res.writeHead(403, h); return res.end(JSON.stringify({ error: "forbidden target" })); }
			const load = async () => {
				try { return await curlBuf(target, q.get('r') || '', q.get('o') || ''); }
				catch (first) {
					if (!path.endsWith('/s.ts')) throw first;
					await sleepMs(250);
					return await curlBuf(target, q.get('r') || '', q.get('o') || '');
				}
			};
			const isMedia = /\/px\/(s\.ts|i\.mp4|k\.key)$/.test(path);
			const r = isMedia ? await mediaCache(JSON.stringify([target,q.get('r'),q.get('o')]),load) : await load();
			const isPl = r.body.subarray(0, 7).toString("utf8") === "#EXTM3U";
			const ph = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "cache-control": "no-store" };
			if (isPl) {
				let pl = fixTargetDuration(muxFix(rewritePlaylist(r.body.toString("utf8"), target, q.get("r") || "", q.get("o") || "")));
				if (/#EXT-X-STREAM-INF/.test(pl)) { // drop absurdly heavy (remux-size) variants so playback does not stall
					const ls = pl.split(/\r?\n/), keep = []; let cnt = 0;
					for (let i = 0; i < ls.length; i++) if (ls[i].startsWith("#EXT-X-STREAM-INF")) cnt++;
					for (let i = 0; i < ls.length; i++) {
						const bw = +((ls[i].match(/[:,]BANDWIDTH=(\d+)/) || [])[1] || 0);
						if (ls[i].startsWith("#EXT-X-STREAM-INF") && bw > 12000000 && cnt > 1) { cnt--; i++; continue; }
						if (ls[i].startsWith("#EXT-X-I-FRAME-STREAM-INF")) continue;
						keep.push(ls[i]);
					}
					pl = keep.join("\n");
				}
				try { rememberSegs(pl); } catch {}
				return sendBody(req, res, Buffer.from(pl, "utf8"), "application/vnd.apple.mpegurl", r.status || 200, ph);
			}
			return sendBody(req, res, r.body, r.ct || "application/octet-stream", r.status || 200, ph);
		}
		const tvm = path.match(/^\/(meta|stream)\/(?:movie|tv|channel)\/(tv:.+)\.json$/);
		if (tvm) {
			// Live TV channels from the Anthology Canlı TV addon use type "tv"; Nuvio Web asks for "movie", so bridge them.
			const u = "https://falsisdev.github.io/anthology/stremio/" + tvm[1] + "/tv/" + encodeURIComponent(tvm[2]) + ".json";
			const j = await fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
			if (tvm[1] === "meta" && j?.meta) j.meta.type = "movie";
			res.writeHead(200, h); return res.end(JSON.stringify(j || (tvm[1] === "meta" ? {} : { streams: [] })));
		}
		if (path === "/bigbull/manifest.json") {
			res.writeHead(200, h);
			return res.end(JSON.stringify({ id: "local.bigbullapp.cs", version: "1.0.0", name: "BigBullApp", description: "F0Rextasy/bigbullapp-cs deposundaki tum saglayicilar, filtresiz, A-Z.", resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }], types: ["movie", "series"], idPrefixes: ["tt"], catalogs: [] }));
		}
		const bbm = path.match(/^\/bigbull\/stream\/(movie|series)\/(.+)\.json$/);
		if (bbm) {
			const [bt, bid] = [bbm[1], bbm[2]];
			const bbRaw = (globalThis.__bbRaw ??= new Map());
			let e = bbRaw.get(bid);
			if (!e || Date.now() - e.t > 600000) {
				e = { t: Date.now(), out: [], done: null };
				bbRaw.set(bid, e);
				capMap(bbRaw, 40);
				e.done = (async () => { const m = await meta(bt, bid.split(":")[0]); const titles = [...new Set([m.tr, m.name].filter(Boolean))]; const [, se, ep] = bid.split(":"); await bb.get({ type: bt, titles, year: m.year, season: +se || 1, episode: +ep || 1, out: e.out, pxUrl, log }); })().catch((er) => log("bigbull raw error", er.message));
			}
			await Promise.race([e.done, new Promise((r) => setTimeout(r, 50000))]);
			const list = e.out.map((s) => ({ name: s.name, title: s.title, url: s.url, subtitles: s.subtitles })).sort((a, b) => a.name.localeCompare(b.name, "tr"));
			res.writeHead(200, h); return res.end(JSON.stringify({ streams: list }));
		}
		if (path === "/manifest.json") { res.writeHead(200, h); return res.end(JSON.stringify(MANIFEST)); }
		const m = path.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
		if (m) { const wantBB = new URL(req.url, "http://x").searchParams.get("bb") === "1"; const s = (await streamsFor(m[1], m[2])).filter((x) => wantBB || !x._bb).map(({ _bb, ...r }) => r); res.writeHead(200, h); return res.end(JSON.stringify({ streams: s })); }
		res.writeHead(m ? 200 : 404, h); res.end(JSON.stringify(m ? { streams: [] } : { error: "not found" }));
	} catch (err) {
		log("error", err.message);
		if (path === "/tx/start") { res.writeHead(err.code === "busy" ? 429 : 502, h); return res.end(JSON.stringify({ error: err.message })); }
		if (path === "/px" || path.startsWith("/px/")) { res.writeHead(502, h); return res.end(JSON.stringify({ error: "upstream proxy request failed", detail: err.message })); }
		res.writeHead(200, h); res.end(JSON.stringify({ streams: [] }));
	}
});
server.listen(PORT, process.env.BRIDGE_HOST || "127.0.0.1", () => log("Kraptor addon on http://127.0.0.1:" + PORT + "/manifest.json"));
