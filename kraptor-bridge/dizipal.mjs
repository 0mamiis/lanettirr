// DiziPal port (from Feroxx/Kekik-cloudstream): search API, AES episode iframe, DPlayer m3u8 extractor.
import { execFile } from "node:child_process";
import { pbkdf2Sync, createDecipheriv } from "node:crypto";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
export let MAIN = "https://dizipal1590.com";
const PASSPHRASE = "3hPn4uCjTVtfYWcjIcoJQ4cL1WWk1qxXI39egLYOmNv6IblA7eKJz68uU3eLzux1biZLCms0quEjTYniGv5z1JcKbNIsDQFSeIZOBZJz4is6pD7UyWDggWWzTLBQbHcQFpBQdClnuQaMNUHtLHTpzCvZy33p6I7wFBvL4fnXBYH84aUIyWGTRvM2G5cfoNf4705tO2kv";

function req(url, { form, referer, headers = {} } = {}) {
	const args = ["-s", "-L", "-m", "30", "--compressed", "-A", UA, "-H", "Accept-Language: tr-TR,tr;q=0.9,en;q=0.8", "-w", "\n__STATUS__%{http_code}__URL__%{url_effective}"];
	if (referer) args.push("-e", referer);
	for (const [k, v] of Object.entries(headers)) args.push("-H", k + ": " + v);
	if (form) for (const [k, v] of Object.entries(form)) args.push("--data-urlencode", k + "=" + v);
	args.push(url);
	return new Promise((resolve, reject) => {
		execFile("curl.exe", args, { maxBuffer: 20 * 1024 * 1024, encoding: "buffer" }, (err, stdout) => {
			if (err && !stdout?.length) return reject(err);
			const s = stdout.toString("utf8"); const m = s.match(/\n__STATUS__(\d+)__URL__([\s\S]*)$/);
			resolve({ status: m ? Number(m[1]) : 0, text: m ? s.slice(0, m.index) : s, url: m ? m[2] : url });
		});
	});
}
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#0?39;/g, "'");

let resolved = 0;
async function resolveBase() {
	if (resolved && Date.now() - resolved < 30 * 60 * 1000) return MAIN;
	try { const r = await req(MAIN + "/"); const o = new URL(r.url).origin; if (/^https?:/.test(o)) MAIN = o; } catch {}
	resolved = Date.now();
	return MAIN;
}

export async function search(query) {
	await resolveBase();
	const r = await req(MAIN + "/bg/searchcontent", {
		form: { cKey: "c61f91c5141d178450934fe81c0a2029", cValue: "MTc4NDQwNzIwMDhkMzJhNTc1YzUwOGU1ZjQwMjdjMjIyOWVjOGVhMTcwNGQyM2FjODM2YTI4YTU0NjUyMjI2ZmVjMzFkYzBkMWQyMWY4YzdiNA==", type: "hepsi", searchterm: query },
		referer: MAIN + "/", headers: { Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" },
	});
	let j; try { j = JSON.parse(r.text); } catch { return []; }
	const arr = j?.data?.result;
	if (!Array.isArray(arr)) return [];
	return arr.map((x) => ({ name: x.object_name, alt: x.object_alternative_name, year: x.object_release_year, type: x.used_type, url: MAIN + "/" + String(x.used_slug).replace(/^\//, "") }));
}

export async function episodes(seriesUrl) {
	const r = await req(seriesUrl, { referer: MAIN + "/" });
	const out = [], seen = new Set();
	for (const m of r.text.matchAll(/<a\b[^>]*data-dizipal-pageloader[^>]*>([\s\S]*?)<\/a>/g)) {
		const tag = m[0].slice(0, m[0].indexOf(">") + 1);
		const href = tag.match(/href="([^"]+)"/)?.[1]; if (!href) continue;
		const text = m[1].replace(/<[^>]+>/g, " ");
		const se = parseInt(text.match(/(\d+)\.\s*Sezon/)?.[1], 10), ep = parseInt(text.match(/(\d+)\.\s*B[öo]l[üu]m/i)?.[1], 10);
		if (!se || !ep) continue;
		const url = href.startsWith("http") ? href : MAIN + (href.startsWith("/") ? "" : "/") + href;
		if (seen.has(url)) continue; seen.add(url);
		out.push({ season: se, episode: ep, url });
	}
	return out;
}

function decryptIframe(rawJson) {
	const ct = rawJson.match(/"ciphertext"\s*:\s*"([^"]+)"/)?.[1], iv = rawJson.match(/"iv"\s*:\s*"([^"]+)"/)?.[1], salt = rawJson.match(/"salt"\s*:\s*"([^"]+)"/)?.[1];
	if (!ct || !iv || !salt) return null;
	const key = pbkdf2Sync(PASSPHRASE, Buffer.from(salt, "hex"), 999, 32, "sha512");
	const dec = createDecipheriv("aes-256-cbc", key, Buffer.from(iv, "hex"));
	let u = Buffer.concat([dec.update(Buffer.from(ct, "base64")), dec.final()]).toString("utf8").replace(/\\\//g, "/");
	if (u.startsWith("://")) u = "https" + u; else if (u.startsWith("//")) u = "https:" + u; else if (!u.startsWith("http")) u = "https://" + u;
	return u;
}

async function dplayer(iframe, referer) {
	const r = await req(iframe, { referer });
	const html = r.text, subs = [], seenSub = new Set();
	for (const m of html.matchAll(/"file":"((?:\\"|[^"])+)","label":"((?:\\"|[^"])+)"/g)) {
		const u = m[1].replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/\\/g, "");
		const lang = m[2].replace(/\\u0131/g, "ı").replace(/\\u0130/g, "İ").replace(/\\u00fc/g, "ü").replace(/\\u00e7/g, "ç").replace(/\\u011f/g, "ğ").replace(/\\u015f/g, "ş");
		if (seenSub.has(u)) continue; seenSub.add(u); subs.push({ url: u.startsWith("//") ? "https:" + u : u, lang });
	}
	const id = html.match(/window\.openPlayer\s*\(\s*['"]([^'"]+)['"]/)?.[1];
	if (!id) return [];
	const domain = iframe.match(/https?:\/\/[^/]+/)?.[0];
	const api = await req(domain + "/source2.php?v=" + id, { referer: iframe });
	const out = [];
	for (const m of api.text.matchAll(/"file"\s*:\s*"([^"]+)"/g)) {
		let f = m[1].replace(/\\\//g, "/");
		if (f.startsWith("//")) f = "https:" + f; else if (!f.startsWith("http")) f = "https://" + f;
		if (f.includes("m.php")) f = f.replace("m.php", "master.m3u8");
		out.push({ url: f, referer: iframe, origin: domain, subs });
	}
	return out;
}

export async function streams(episodeUrl) {
	const page = await req(episodeUrl, { referer: MAIN + "/" });
	const enc = page.text.match(/<div[^>]*data-rm-k="true"[^>]*>([\s\S]*?)<\/div>/)?.[1];
	let iframe = enc ? decryptIframe(unesc(enc.replace(/<[^>]+>/g, "").trim())) : (page.text.match(/<iframe[^>]*src="([^"]+)"/)?.[1] || null);
	if (!iframe) return [];
	if (iframe.startsWith("//")) iframe = "https:" + iframe;
	const res = await dplayer(iframe, episodeUrl);
	return res.map((x) => ({ host: new URL(iframe).hostname, label: "DPlayer", ...x }));
}

if (process.argv[1] && process.argv[1].endsWith("dizipal.mjs")) {
	const q = process.argv[2] || "The Walking Dead";
	const res = await search(q); console.log(res.slice(0, 6));
	const hit = res.find((r) => /series/i.test(r.type) && r.name.toLowerCase() === q.toLowerCase()) || res.find((r) => /series/i.test(r.type));
	if (!hit) { console.log("no series hit"); process.exit(0); }
	const eps = await episodes(hit.url); console.log("episodes:", eps.length, eps[0]);
	const e = eps.find((x) => x.season === 1 && x.episode === 1) || eps[0];
	console.log(JSON.stringify(await streams(e.url), null, 1).slice(0, 1500));
}

