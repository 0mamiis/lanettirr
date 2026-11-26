// Host side of the Nuvio plugin runtime: spawns a sandboxed worker per execution and serves its fetch bridge.
import { Worker } from "node:worker_threads";
import { execFile } from "node:child_process";
import { promises as dns } from "node:dns";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 6 * 1024 * 1024;

function privateIp(ip) {
	if (net.isIPv4(ip)) {
		const [a, b] = ip.split(".").map(Number);
		return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
	}
	const s = ip.toLowerCase();
	return s === "::1" || s === "::" || s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("::ffff:127.") || s.startsWith("::ffff:10.") || s.startsWith("::ffff:192.168.");
}
async function assertPublic(host) {
	if (net.isIP(host)) { if (privateIp(host)) throw new Error("blocked private address"); return; }
	const answers = await dns.lookup(host, { all: true });
	if (!answers.length || answers.some((a) => privateIp(a.address))) throw new Error("blocked private address");
}

async function nodeFetch(p, ua) {
	let url = new URL(String(p.url));
	const method = (p.method || "GET").toUpperCase();
	const headers = {};
	for (const [k, v] of Object.entries(p.headers || {})) { if (!/^(host|content-length|connection)$/i.test(k)) headers[k] = String(v); }
	if (!Object.keys(headers).some((k) => /^user-agent$/i.test(k))) headers["User-Agent"] = ua;
	let body;
	if (p.bodyKind === "text" && p.body) body = String(p.body);
	else if (p.bodyKind === "base64" && p.bodyBase64) body = Buffer.from(String(p.bodyBase64), "base64");
	let curMethod = method, curBody = body;
	for (let hop = 0; hop < 8; hop++) {
		await assertPublic(url.hostname);
		const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
		let res;
		try { res = await fetch(url, { method: curMethod, headers, body: curBody, redirect: "manual", signal: ctrl.signal }); }
		finally { clearTimeout(t); }
		if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
			url = new URL(res.headers.get("location"), url);
			if (!/^https?:$/.test(url.protocol)) throw new Error("bad redirect");
			if (res.status === 303 || ((res.status === 301 || res.status === 302) && curMethod === "POST")) { curMethod = "GET"; curBody = undefined; }
			continue;
		}
		let buf = Buffer.from(await res.arrayBuffer());
		if (buf.length > MAX_BODY) buf = buf.subarray(0, MAX_BODY);
		const h = {}; res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
		return { returnValue: true, ok: res.status >= 200 && res.status < 300, status: res.status, statusText: res.statusText || "", url: url.toString(), headers: h, body: buf.toString("utf8"), bodyBase64: buf.toString("base64") };
	}
	throw new Error("too many redirects");
}

let counter = 0;
export async function hostFetch(p, ua) {
	try {
		const r = await nodeFetch(p, ua);
		const blocked = (r.status === 403 || r.status === 429 || r.status === 503 || r.status === 521 || r.status === 522) && (/cloudflare/i.test(r.headers.server || "") || /just a moment|cf-chl|attention required/i.test(r.body.slice(0, 2000)));
		if (!blocked) return r;
	} catch (e) { if (/blocked private/.test(String(e.message))) throw e; }
	return curlFetch(p, ua);
}
async function curlFetch(p, ua) {
	const url = new URL(String(p.url));
	if (!/^https?:$/.test(url.protocol)) throw new Error("unsupported scheme");
	await assertPublic(url.hostname);
	const id = process.pid + "-" + Date.now() + "-" + ++counter;
	const hdr = path.join(os.tmpdir(), "nvh-" + id + ".hdr"), out = path.join(os.tmpdir(), "nvh-" + id + ".bin");
	const args = ["-s", "-L", "--max-redirs", "8", "-m", "30", "--compressed", "-X", (p.method || "GET").toUpperCase(), "-D", hdr, "-o", out, "--max-filesize", String(MAX_BODY), "-w", "%{http_code}|%{url_effective}"];
	let hasUA = false;
	for (const [k, v] of Object.entries(p.headers || {})) { if (/^user-agent$/i.test(k)) hasUA = true; if (/^(host|content-length)$/i.test(k)) continue; args.push("-H", k + ": " + v); }
	if (!hasUA) args.push("-A", ua);
	let input = null;
	if (p.bodyKind === "text" && p.body) { args.push("--data-binary", "@-"); input = Buffer.from(String(p.body), "utf8"); }
	else if (p.bodyKind === "base64" && p.bodyBase64) { args.push("--data-binary", "@-"); input = Buffer.from(String(p.bodyBase64), "base64"); }
	args.push(url.toString());
	const wout = await new Promise((resolve, reject) => {
		const cp = execFile(process.platform === "win32" ? "curl.exe" : "curl", args, { maxBuffer: 1024 * 1024, encoding: "utf8", windowsHide: true }, (err, stdout) => (stdout ? resolve(stdout) : reject(err || new Error("curl failed"))));
		if (input) { cp.stdin.write(input); } cp.stdin.end();
	});
	const m = String(wout).match(/^(\d+)\|([\s\S]*)$/);
	const status = m ? Number(m[1]) : 0;
	let body = Buffer.alloc(0), headersText = "";
	try { body = fs.readFileSync(out); } catch {}
	try { headersText = fs.readFileSync(hdr, "utf8"); } catch {}
	try { fs.unlinkSync(out); } catch {}
	try { fs.unlinkSync(hdr); } catch {}
	const blocks = headersText.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b.trim()));
	const last = blocks[blocks.length - 1] || "";
	const headers = {};
	for (const line of last.split(/\r?\n/).slice(1)) { const i = line.indexOf(":"); if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
	return { returnValue: true, ok: status >= 200 && status < 300, status, statusText: "", url: m ? m[2] : url.toString(), headers, body: body.toString("utf8"), bodyBase64: body.toString("base64") };
}

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const TIMER_SHIM = "(function(){ var g = globalThis; if (typeof g.setTimeout === 'undefined') { g.setTimeout = function(fn, ms){ if (typeof fn === 'function' && (ms || 0) <= 60) { Promise.resolve().then(function(){ try { fn(); } catch (e) {} }); } return 0; }; g.clearTimeout = function(){}; g.setInterval = function(){ return 0; }; g.clearInterval = function(){}; } if (typeof g.queueMicrotask === 'undefined') g.queueMicrotask = function(fn){ Promise.resolve().then(fn); }; })();\n";

export function runScraper({ code, filename = "plugin.js", scraperId = "plugin", args, settings = {}, tmdbApiKey = "", timeoutMs = 25000 }) {
	return new Promise((resolve, reject) => {
		code = TIMER_SHIM + code;
		const w = new Worker(path.join(dir, "nvwrk.mjs"), { resourceLimits: { maxOldGenerationSizeMb: 256 } });
		const logs = [];
		let done = false;
		const finish = (err, val) => { if (done) return; done = true; clearTimeout(t); w.terminate().catch(() => {}); err ? reject(Object.assign(err, { logs })) : resolve({ results: val, logs }); };
		const t = setTimeout(() => finish(new Error("timeout")), timeoutMs);
		w.on("error", (e) => finish(e));
		w.on("message", async (m) => {
			if (m.type === "ready") {
				w.postMessage({ type: "execute", executionId: "x" + Date.now(), code, filename, scraperId, settings, profileId: "", repositoryId: "", tmdbApiKey,
					args: { tmdbId: String(args.tmdbId), mediaType: args.mediaType, season: args.season ?? null, episode: args.episode ?? null },
					quota: { maxCodeBytes: 5 * 1024 * 1024, maxFetchBytes: MAX_BODY, maxResultsPerScraper: 150, maxResults: 150, providerTimeoutMs: timeoutMs, maxDocuments: 8, maxDomElements: 10000, memoryLimitBytes: 64 * 1024 * 1024, maxConcurrent: 10, globalTimeoutMs: timeoutMs },
					timeoutMs, deadline: Date.now() + timeoutMs });
			} else if (m.type === "fetch") {
				const rid = m.requestId;
				try { const payload = await hostFetch(m.payload || {}, DEFAULT_UA); if (!done) w.postMessage({ type: "fetchResult", requestId: rid, payload }); }
				catch (e) { if (!done) w.postMessage({ type: "fetchResult", requestId: rid, error: String(e.message || e) }); }
			} else if (m.type === "pluginLog") { logs.push(String(m.message || "").slice(0, 1800)); }
			else if (m.type === "result") finish(null, Array.isArray(m.results) ? m.results : []);
			else if (m.type === "error") finish(new Error(String(m.error || "plugin error")));
		});
	});
}

