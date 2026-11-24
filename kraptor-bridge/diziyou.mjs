// DiziYou port (from Feroxx/Kekik-cloudstream). Series provider with direct storage m3u8 (no extractor).
import { execFile } from "node:child_process";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export const MAIN = "https://www.diziyou.one";

function req(url, referer) {
	const args = ["-s", "-L", "-m", "30", "--compressed", "-A", UA, "-w", "\n__STATUS__%{http_code}"];
	if (referer) args.push("-e", referer);
	args.push(url);
	return new Promise((resolve, reject) => {
		execFile("curl.exe", args, { maxBuffer: 20 * 1024 * 1024, encoding: "buffer" }, (err, stdout) => {
			if (err && !stdout?.length) return reject(err);
			const s = stdout.toString("utf8"); const m = s.match(/\n__STATUS__(\d+)$/);
			resolve({ status: m ? Number(m[1]) : 0, text: m ? s.slice(0, m.index) : s });
		});
	});
}
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();

export async function search(query) {
	const r = await req(MAIN + "/?s=" + encodeURIComponent(query));
	const out = [];
	for (const blk of r.text.split('id="list-series"').slice(1)) {
		const m = blk.match(/id="categorytitle"><a href="([^"]+)">([^<]+)/);
		if (!m) continue;
		const year = parseInt(blk.match(/Yap[ıi]m\s*:\s*<\/span>\s*(\d{4})/)?.[1], 10) || null;
		out.push({ name: decode(m[2]), url: m[1], year });
	}
	return out;
}

export async function episodes(seriesUrl) {
	const r = await req(seriesUrl);
	const out = [];
	for (const m of r.text.matchAll(/<a href="([^"]+)"><div class="bolumust">[\s\S]*?<div class="baslik">([\s\S]*?)<div/g)) {
		const t = m[2];
		const ep = parseInt(t.match(/(\d+)\.\s*B[öo]l[üu]m/i)?.[1], 10);
		const se = parseInt(t.match(/(\d+)\.\s*Sezon/i)?.[1], 10) || 1;
		if (ep) out.push({ season: se, episode: ep, url: m[1] });
	}
	return out;
}

export async function streams(episodeUrl) {
	const r = await req(episodeUrl, MAIN + "/");
	const html = r.text;
	const src = html.match(/<iframe[^>]*id="diziyouPlayer"[^>]*src="([^"]+)"/)?.[1] || html.match(/id="diziyouPlayer"[^>]*src="([^"]+)"/)?.[1];
	const itemId = src ? src.split("/").pop().split(".html")[0] : null;
	if (!itemId) return [];
	const storage = MAIN.replace("www", "storage");
	const opts = [...html.matchAll(/class="diziyouOption"[^>]*id="([^"]+)"|id="([^"]+)"[^>]*class="diziyouOption"/g)].map((m) => m[1] || m[2]);
	const subs = [], out = [];
	if (opts.includes("turkceAltyazili")) { subs.push({ lang: "Turkish", url: storage + "/subtitles/" + itemId + "/tr.vtt" }); out.push({ label: "Altyazılı (Orijinal dil)", url: storage + "/episodes/" + itemId + "/play.m3u8" }); }
	if (opts.includes("ingilizceAltyazili")) { subs.push({ lang: "English", url: storage + "/subtitles/" + itemId + "/en.vtt" }); if (!out.length) out.push({ label: "Altyazılı (Orijinal dil)", url: storage + "/episodes/" + itemId + "/play.m3u8" }); }
	if (opts.includes("turkceDublaj")) out.push({ label: "Türkçe Dublaj", url: storage + "/episodes/" + itemId + "_tr/play.m3u8" });
	return out.map((o) => ({ ...o, host: "diziyou", subs: o.label.startsWith("Altyazılı") ? subs : [] }));
}

if (process.argv[1] && process.argv[1].endsWith("diziyou.mjs")) {
	const q = process.argv[2] || "3 Body Problem";
	const res = await search(q); console.log(res.slice(0, 3));
	const hit = res.find((r) => r.name.toLowerCase() === q.toLowerCase()) || res[0];
	const eps = await episodes(hit.url); console.log("episodes:", eps.length);
	const e = eps.find((x) => x.season === 1 && x.episode === 1);
	console.log(JSON.stringify(await streams(e.url), null, 1).slice(0, 1200));
}

