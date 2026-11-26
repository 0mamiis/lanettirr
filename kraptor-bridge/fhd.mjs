// FullHDFilmizlesene + RapidVid port (from etumen/cs-kraptor recovery v73 sources).
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export const MAIN = "https://www.fullhdfilmizlesene.now";

import { execFile } from "node:child_process";
// Cloudflare rejects Node's TLS fingerprint but accepts curl's, so requests go through curl.exe.
export function get(url, referer, extra = {}) {
	const args = ["-s", "-L", "-m", "30", "--compressed", "-A", UA, "-H", "Accept-Language: tr-TR,tr;q=0.9", "-w", "\n__STATUS__%{http_code}__URL__%{url_effective}"];
	if (referer) args.push("-e", referer);
	for (const [k, v] of Object.entries(extra)) args.push("-H", k + ": " + v);
	args.push(url);
	return new Promise((resolve, reject) => {
		execFile(process.platform === "win32" ? "curl.exe" : "curl", args, { maxBuffer: 20 * 1024 * 1024, encoding: "buffer", windowsHide: true }, (err, stdout) => {
			if (err && !stdout?.length) return reject(err);
			const s = stdout.toString("utf8");
			const m = s.match(/\n__STATUS__(\d+)__URL__([\s\S]*)$/);
			resolve({ status: m ? Number(m[1]) : 0, text: m ? s.slice(0, m.index) : s, url: m ? m[2] : url });
		});
	});
}

export async function search(query) {
	const clean = query.replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
	if (!clean) return [];
	const r = await get(MAIN + "/autocomplete/q.php?q=" + encodeURIComponent(clean).replace(/\+/g, "%20"), MAIN + "/", { "x-requested-with": "XMLHttpRequest" });
	let rows; try { rows = JSON.parse(r.text.trim()); } catch { return []; }
	if (!Array.isArray(rows)) return [];
	const seen = new Set(), out = [];
	for (const row of rows) {
		const prefix = row.prefix || "film"; if (prefix !== "film") continue;
		const slug = String(row.dizilink || "").trim(), title = String(row.baslik || "").trim();
		if (!slug || !title) continue;
		const url = MAIN + "/" + prefix + "/" + slug + "/";
		if (!seen.has(url)) { seen.add(url); out.push({ name: title, url, alt: String(row.altbaslik || "").trim(), year: parseInt(row.yil, 10) || null }); }
	}
	return out;
}

const rot13 = (s) => s.replace(/[a-zA-Z]/g, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode((c.charCodeAt(0) - b + 13) % 26 + b); });
const atobSafe = (s) => Buffer.from(s, "base64").toString("latin1");

function assignedObject(script, variable) {
	const re = new RegExp("(?:^|[;\\s])(?:var\\s+|let\\s+|const\\s+)?(?:window\\.)?" + variable + "\\s*=\\s*\\{", "g");
	let m;
	while ((m = re.exec(script))) {
		const start = m.index + m[0].length - 1;
		let depth = 0, quoted = false, escaped = false;
		for (let i = start; i < script.length; i++) {
			const c = script[i];
			if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
			else if (c === '"') quoted = true;
			else if (c === "{") depth++;
			else if (c === "}") { depth--; if (depth === 0) return script.slice(start, i + 1); }
		}
	}
	return null;
}

function fixUrl(u) { if (u.startsWith("//")) return "https:" + u; return u; }
function decodeSource(value) {
	const raw = String(value).trim();
	if (/^(https?:)?\/\//.test(raw)) return fixUrl(raw);
	try { const d = atobSafe(rot13(raw)); return /^(https?:)?\/\//.test(d) ? fixUrl(d) : null; } catch { return null; }
}

export function parseSources(html) {
	const result = [];
	const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
	for (const script of scripts) {
		const json = assignedObject(script, "scx"); if (!json) continue;
		let root; try { root = JSON.parse(json); } catch { continue; }
		for (const [key, source] of Object.entries(root)) {
			if (key === "advid" || key === "advidprox") continue;
			const t = source?.sx?.t;
			const add = (label, raw) => { const u = decodeSource(raw); if (u) result.push({ label, url: u }); };
			if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && add(key, x));
			else if (t && typeof t === "object") for (const [lang, node] of Object.entries(t)) { if (Array.isArray(node)) node.forEach((x) => typeof x === "string" && add(lang, x)); else if (typeof node === "string") add(lang, node); }
			else if (typeof t === "string") add(key, t);
		}
	}
	const seen = new Set();
	return result.filter((r) => { const k = r.label + "|" + r.url; if (seen.has(k)) return false; seen.add(k); return true; });
}

// RapidVid secret: reverse -> base64 -> shift each char down by (key[i%3]%5+1) -> base64
export function decodeSecret(enc) {
	const t = atobSafe([...enc].reverse().join(""));
	const key = "K9L"; let o = "";
	for (let i = 0; i < t.length; i++) { const off = key.charCodeAt(i % key.length) % 5 + 1; o += String.fromCharCode(t.charCodeAt(i) - off); }
	return Buffer.from(o, "base64").toString("utf8");
}

export async function rapidVid(url, referer) {
	const r = await get(url, referer || MAIN + "/");
	const html = r.text;
	const origin = new URL(url).origin + "/";
	const p8 = html.match(/window\._p8\s*=\s*['"]([^'"]+)['"]/)?.[1];
	if (p8) {
		try {
			const cfg = JSON.parse(decodeSecret(p8));
			const media = [cfg.cm, cfg.tm].find((x) => typeof x === "string" && x.startsWith("http"));
			const subs = (Array.isArray(cfg.ct) ? cfg.ct : []).filter((x) => String(x.file).startsWith("http")).map((x) => ({ url: x.file, lang: x.label || "tr" }));
			if (media) return { url: media, referer: origin, subs };
		} catch {}
	}
	const sec = html.match(/jwSetup\.sources\s*=([\s\S]*?);/)?.[1] || "";
	const enc = sec.match(/av\(\s*['"]([^'"]+)['"]\s*\)/)?.[1];
	const direct = sec.match(/file\s*:\s*['"](https?:\/\/[^'"]+)['"]/)?.[1];
	let media = null; try { media = enc ? decodeSecret(enc) : null; } catch {}
	media = (media || direct || "").replace(/\\\//g, "/");
	if (!media) return null;
	const tracks = html.match(/jwSetup\.tracks\s*=([\s\S]*?);/)?.[1];
	let subs = []; try { subs = JSON.parse(tracks).map((x) => ({ url: String(x.file).replace(/\\\\/g, ""), lang: x.label || "tr" })); } catch {}
	return { url: media, referer: origin, subs };
}

export async function streams(pageUrl) {
	const page = await get(pageUrl, MAIN + "/");
	const srcs = parseSources(page.text);
	const out = [];
	for (const s of srcs) {
		if (/rapidvid|rapid\./i.test(s.url)) {
			try { const r = await rapidVid(s.url, MAIN + "/"); if (r) out.push({ label: s.label, ...r }); } catch (e) { out.push({ label: s.label, error: String(e.message || e) }); }
		} else out.push({ label: s.label, unsupported: s.url });
	}
	return { sourcesFound: srcs.length, out };
}

if (process.argv[1] && process.argv[1].endsWith("fhd.mjs")) {
	const q = process.argv[2] || "Başlangıç";
	const res = await search(q);
	console.log("search:", res.slice(0, 5));
	const hit = res.find((r) => r.name.toLowerCase().includes(q.toLowerCase())) || res[0];
	if (hit) { const s = await streams(hit.url); console.log(JSON.stringify(s, null, 1).slice(0, 2500)); }
}
