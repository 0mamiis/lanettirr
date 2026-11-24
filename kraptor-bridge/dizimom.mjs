// DiziMom (now dizidad.com) + PeaceMakerst/HDStreamAble/HDPlayerSystem extractors, ported from
// nikyokki/nik-cloudstream (Kekik lineage). Series provider.
import { execFile } from "node:child_process";

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36";

function req(url, { form, referer, headers = {} } = {}) {
	const args = ["-s", "-L", "-m", "30", "--compressed", "-A", UA, "-w", "\n__STATUS__%{http_code}__URL__%{url_effective}"];
	if (referer) args.push("-e", referer);
	for (const [k, v] of Object.entries(headers)) args.push("-H", k + ": " + v);
	if (form) for (const [k, v] of Object.entries(form)) args.push("--data-urlencode", k + "=" + v);
	args.push(url);
	return new Promise((resolve, reject) => {
		execFile("curl.exe", args, { maxBuffer: 20 * 1024 * 1024, encoding: "buffer" }, (err, stdout) => {
			if (err && !stdout?.length) return reject(err);
			const s = stdout.toString("utf8");
			const m = s.match(/\n__STATUS__(\d+)__URL__([\s\S]*)$/);
			resolve({ status: m ? Number(m[1]) : 0, text: m ? s.slice(0, m.index) : s, url: m ? m[2] : url });
		});
	});
}

let BASE = null;
async function base() {
	if (BASE) return BASE;
	try { const r = await req("https://www.dizimom.bid/"); BASE = new URL(r.url).origin; } catch {}
	return (BASE = BASE || "https://www.dizidad.com");
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#8217;/g, "'").replace(/&#8211;/g, "-").trim();

export async function search(query) {
	const b = await base();
	const r = await req(b + "/?s=" + encodeURIComponent(query));
	const out = [], seen = new Set();
	for (const m of r.text.matchAll(/categorytitle[\s\S]{0,300}?href="([^"]+)"[^>]*>([^<]+)/g)) {
		const url = m[1]; if (seen.has(url)) continue; seen.add(url);
		let title = decode(m[2]).replace(/\s+izle\s*$/i, "");
		const dub = /t[üu]rk[çc]e dublaj/i.test(title);
		title = title.replace(/\s*T[üu]rk[çc]e Dublaj\s*/i, " ").trim();
		out.push({ name: title, url, dub });
	}
	return out;
}

export async function episodes(seriesUrl) {
	const r = await req(seriesUrl);
	const out = [];
	for (const m of r.text.matchAll(/bolumust[\s\S]{0,500}?href="([^"]+)"[\s\S]{0,400}?baslik">([^<]+)/g)) {
		const name = decode(m[2]);
		const ep = parseInt(name.match(/(\d+)\.\s*B[öo]l[üu]m/i)?.[1], 10);
		const se = parseInt(name.match(/(\d+)\.\s*Sezon/i)?.[1], 10) || 1;
		if (ep) out.push({ season: se, episode: ep, url: m[1] });
	}
	return out;
}

async function peaceMakerst(iframe, referer) {
	const hash = iframe.split("video/")[1] || "";
	const r = await req(iframe.split("?")[0] + "?do=getVideo", {
		form: { hash, r: referer, s: "" }, referer,
		headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
	});
	let j; try { j = JSON.parse(r.text); } catch { return null; }
	const srcs = j.videoSources || [];
	const file = srcs.length ? srcs[srcs.length - 1].file : null;
	return file ? { url: file.replace(/\\\//g, "/"), referer } : null;
}

async function hdPlayerSystem(iframe, referer) {
	const o = new URL(iframe).origin;
	const id = iframe.includes("video/") ? iframe.split("video/")[1] : (iframe.split("?data=")[1] || "");
	const r = await req(o + "/player/index.php?data=" + id + "&do=getVideo", {
		form: { hash: id, r: referer }, referer,
		headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
	});
	let j; try { j = JSON.parse(r.text); } catch { return null; }
	return j.securedLink ? { url: j.securedLink, referer } : null;
}

async function extract(iframe, referer) {
	const host = new URL(iframe).hostname;
	if (/hdstreamable|peacemakerst/i.test(host)) return peaceMakerst(iframe, referer);
	if (/hdplayersystem/i.test(host)) return hdPlayerSystem(iframe, referer);
	return null;
}

export async function streams(episodeUrl) {
	const b = await base();
	const page = await req(episodeUrl);
	const iframes = [];
	const main = page.text.match(/<div class="video">[\s\S]{0,600}?<iframe[^>]*src="([^"]+)"/)?.[1] || page.text.match(/<iframe[^>]*src="([^"]+)"/)?.[1];
	if (main) iframes.push(main);
	for (const m of page.text.matchAll(/<div class="sources">([\s\S]*?)<\/div>/g)) {
		for (const a of m[1].matchAll(/href="([^"]+)"/g)) {
			try { const p = await req(a[1]); const f = p.text.match(/<iframe[^>]*src="([^"]+)"/)?.[1]; if (f && !iframes.includes(f)) iframes.push(f); } catch {}
		}
	}
	const out = [];
	for (const f of iframes) {
		const iframe = f.startsWith("//") ? "https:" + f : f;
		try {
			const r = await extract(iframe, b + "/");
			if (r) out.push({ host: new URL(iframe).hostname, ...r });
			else out.push({ host: new URL(iframe).hostname, unsupported: true });
		} catch (e) { out.push({ host: iframe, error: String(e.message || e) }); }
	}
	return out;
}

// Total playable seconds of an HLS URL (master -> best variant -> sum EXTINF). Used to reject teaser clips.
export async function playlistSeconds(url) {
	const clean = url.split("#")[0];
	let r = await req(clean);
	let text = r.text, base = clean;
	if (/#EXT-X-STREAM-INF/.test(text)) {
		const lines = text.split("\n").map((l) => l.trim());
		const variants = lines.filter((l, i) => l && !l.startsWith("#") && /#EXT-X-STREAM-INF/.test(lines[i - 1] || ""));
		const v = variants[variants.length - 1];
		if (!v) return 0;
		base = new URL(v, clean).toString();
		text = (await req(base)).text;
	}
	let total = 0;
	for (const m of text.matchAll(/#EXTINF:([\d.]+)/g)) total += parseFloat(m[1]);
	return total;
}

if (process.argv[1] && process.argv[1].endsWith("dizimom.mjs")) {
	const res = await search(process.argv[2] || "The Walking Dead");
	console.log(res.slice(0, 4));
	const hit = res.find((r) => !r.dub && r.name.toLowerCase() === (process.argv[2] || "the walking dead").toLowerCase()) || res[0];
	const eps = await episodes(hit.url);
	console.log("episodes:", eps.length, eps.find((e) => e.season === 1 && e.episode === 1));
	const e = eps.find((x) => x.season === 1 && x.episode === 1);
	console.log(JSON.stringify(await streams(e.url), null, 1).slice(0, 1500));
}

