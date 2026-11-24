// ÇizgiMax provider ported from Feroxx/Kekik-cloudstream CizgiMax.kt and its
// CizgiDuo, CizgiPass, SibNet, and Drive extractors.
import { createHash, createDecipheriv } from "node:crypto";

const MAIN = "https://cizgimax.online";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

import { execFile } from "node:child_process";
async function req(url, { referer, headers = {}, method = "GET", form } = {}) {
  const args = ["-s", "-L", "-m", "25", "--compressed", "-A", UA, "-H", "Accept-Language: tr-TR,tr;q=0.9,en;q=0.8", "-D", "-", "-w", "\n__STATUS__%{http_code}__URL__%{url_effective}"];
  if (referer) args.push("-e", referer);
  for (const [k, v] of Object.entries(headers)) args.push("-H", k + ": " + v);
  if (form) for (const [k, v] of Object.entries(form)) args.push("--data-urlencode", k + "=" + v);
  args.push(url);
  return new Promise((resolve, reject) => {
    execFile(process.platform === "win32" ? "curl.exe" : "curl", args, { maxBuffer: 30 * 1024 * 1024, encoding: "buffer" }, (err, stdout) => {
      if (err && !stdout?.length) return reject(err);
      const s = stdout.toString("utf8"); const m = s.match(/\n__STATUS__(\d+)__URL__([\s\S]*)$/);
      const body = m ? s.slice(0, m.index) : s;
      const parts = body.split(/\r?\n\r?\n/); let i = 0; while (i < parts.length - 1 && /^HTTP\/[\d.]+ \d+/.test(parts[i])) i++;
      const headText = parts.slice(0, i).join("\n"); const text = parts.slice(i).join("\n\n");
      const hdrs = new Map(); for (const l of headText.split(/\r?\n/)) { const k = l.indexOf(":"); if (k > 0) hdrs.set(l.slice(0, k).trim().toLowerCase(), l.slice(k + 1).trim()); }
      resolve({ status: m ? Number(m[1]) : 0, url: m ? m[2] : url, text, headers: { get: (n) => hdrs.get(String(n).toLowerCase()) ?? null } });
    });
  });
}

function decodeHtml(s = "") {
  return String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function textOnly(s = "") { return decodeHtml(s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()); }
function attr(tag, name) {
  const m = tag.match(new RegExp("\\b" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i"));
  return m ? decodeHtml(m[2]) : "";
}
function absolute(url, base = MAIN + "/") {
  try { return new URL(url, base).href; } catch { return ""; }
}
function norm(s = "") {
  return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("tr")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
function scoreTitle(candidate, query) {
  const a = norm(candidate), b = norm(query);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 70;
  const aa = new Set(a.split(" ")), bb = b.split(" ");
  return Math.round(50 * bb.filter(x => aa.has(x)).length / Math.max(1, bb.length));
}
function pickTitle(items, titles) {
  let best = null, bestScore = 0;
  for (const item of items) for (const title of titles) {
    const n = scoreTitle(item.name + " " + item.alt, title);
    if (n > bestScore) { best = item; bestScore = n; }
  }
  return bestScore >= 40 ? best : null;
}

async function search(query) {
  const r = await req(MAIN + "/ara/?q=" + encodeURIComponent(query), { referer: MAIN + "/" });
  const out = [], seen = new Set();
  const re = /<a\b([^>]*\bclass=["'][^"']*\bfilm-name\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const m of r.text.matchAll(re)) {
    const tag = "<a" + m[1] + ">";
    const href = attr(tag, "href");
    const name = textOnly(m[2]);
    const alt = attr(tag, "data-alt-title");
    if (!href || !name) continue;
    const url = absolute(href);
    if (!seen.has(url)) { seen.add(url); out.push({ name, alt, url }); }
  }
  return out;
}

function episodesFrom(html) {
  const out = [];
  const re = /<a\b[^>]*class=["'][^"']*\bep-num-btn\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const tag = m[0].slice(0, m[0].indexOf(">") + 1);
    const href = attr(tag, "href");
    if (!href) continue;
    const url = absolute(href);
    const slug = url.match(/-(\d+)-sezon-(\d+)-bolum-izle/i);
    const se = Number(slug?.[1] || attr(tag, "data-season") || 1);
    const ep = Number(slug?.[2] || m[0].match(/class=["'][^"']*ep-num-label[^"']*["'][^>]*>\s*(\d+)/i)?.[1] || 0);
    if (ep) out.push({ season: se, episode: ep, url, title: attr(tag, "title") });
  }
  return out;
}

function parseEncodedArray(html, varName) {
  const re = new RegExp("\\b" + varName + "\\s*=\\s*JSON\\.parse\\(atob\\(\\s*([\"'])([\\s\\S]*?)\\1\\s*\\)\\s*\\)", "i");
  const m = html.match(re);
  if (!m) return [];
  try {
    const encoded = m[2].replace(/\\/g, "");
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch { return []; }
}

function decryptAesHelper(raw, password) {
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data?.ct || !data?.s || !data?.iv) return null;
  const salt = Buffer.from(data.s, "hex");
  const ivLength = data.iv.length / 2;
  let derived = Buffer.alloc(0), previous = Buffer.alloc(0);
  while (derived.length < 32 + ivLength) {
    previous = createHash("md5").update(previous).update(Buffer.from(password)).update(salt).digest();
    derived = Buffer.concat([derived, previous]);
  }
  try {
    const decipher = createDecipheriv("aes-256-cbc", derived.subarray(0, 32), derived.subarray(32, 32 + ivLength));
    return Buffer.concat([decipher.update(Buffer.from(data.ct, "base64")), decipher.final()]).toString("utf8");
  } catch { return null; }
}

async function extractSibnet(url, referer) {
  const r = await req(url, { referer: referer || "https://video.sibnet.ru/" });
  const m = r.text.match(/player\.src\(\s*\[\s*\{\s*src:\s*["']([^"']+)/i);
  if (!m) return [];
  const stream = absolute(m[1], "https://video.sibnet.ru/");
  return [{ url: stream, referer: r.url || url, origin: "https://video.sibnet.ru/", label: "SibNet" }];
}

async function extractDzen(url) {
  const m = url.match(/dzen\.ru\/(?:embed\/)?([^/?#]+)/i);
  if (!m) return [];
  const r = await req("https://dzen.ru/embed/" + m[1], { referer: "https://dzen.ru/" });
  const links = [...r.text.matchAll(/https:\/\/vd\d+\.okcdn\.ru\/\?[^"'\\\s<>]+/g)].map(x => x[0].replace(/&amp;/g, "&"));
  return [...new Set(links)].map(url => ({ url, referer: "https://dzen.ru/", origin: "https://dzen.ru/", label: "Dzen" }));
}

async function extractVidmoly(url, referer) {
  let embed = url;
  if (/\/w\//.test(embed)) embed = embed.replace("/w/", "/embed-") + ".html";
  const r = await req(embed, { referer, headers: { "Sec-Fetch-Dest": "iframe" } });
  const raw = r.text.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const links = [...raw.matchAll(/(?:file|src)\s*:\s*["']([^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/gi)].map(x => x[1]);
  const fallback = [...raw.matchAll(/https?:\/\/[^"'\\\s<>]+(?:\.m3u8|master\.txt)(?:\?[^"'\\\s<>]*)?/gi)].map(x => x[0]);
  const urls = [...new Set([...links, ...fallback])];
  const subs = [...raw.matchAll(/file\s*:\s*["']([^"']+\.vtt(?:\?[^"']*)?)["'][\s\S]{0,180}?label\s*:\s*["']([^"']+)["']/gi)]
    .map(x => ({ url: absolute(x[1], r.url), lang: x[2] }));
  return urls.map(url => ({ url: absolute(url, r.url), referer: r.url, origin: new URL(r.url).origin + "/", label: "Vidmoly", subs }));
}

async function extractDrive(url, referer) {
  const id = url.match(/\/file\/d\/([^/]+)\/preview/i)?.[1];
  if (!id) return [];
  const u = "https://drive.google.com/get_video_info?docid=" + encodeURIComponent(id) + "&drive_originator_app=303";
  const r = await req(u, { referer });
  const encoded = r.text.match(/&fmt_stream_map=([^&]+)/)?.[1];
  if (!encoded) return [];
  const decoded = decodeURIComponent(encoded);
  const stream = decoded.split("|").pop();
  return /^https?:/.test(stream) ? [{ url: stream, referer: url, origin: "https://drive.google.com/", label: "Drive" }] : [];
}

async function extractDuo(url, referer) {
  const r = await req(url, { referer });
  const player = r.text.match(/bePlayer\(\s*['"]([^'"]+)['"]\s*,\s*'(\{[^}]+\})'\s*\)/);
  if (!player) return [];
  const decoded = decryptAesHelper(player[2], player[1]) || "";
  const m = decoded.match(/video_location["']?\s*:\s*["']([^"']+)/i);
  return m ? [{ url: absolute(m[1]), referer: url, origin: new URL(url).origin + "/", label: "CizgiDuo" }] : [];
}

async function extractAny(url, referer, depth = 0, seen = new Set()) {
  if (!url || depth > 4 || seen.has(url)) return [];
  seen.add(url);
  if (/video\.sibnet\.ru\/shell\.php/i.test(url)) return extractSibnet(url, referer);
  if (/dzen\.ru\/(?:embed|video)\//i.test(url)) return extractDzen(url);
  if (/vidmoly\.(?:net|me|to|biz)\//i.test(url)) return extractVidmoly(url, referer);
  if (/drive\.google\.com\/file\/d\//i.test(url)) return extractDrive(url, referer);
  if (/cizgiduo\.online|cizgipass\d*\.online/i.test(url)) {
    const duo = await extractDuo(url, referer);
    if (duo.length) return duo;
  }

  const r = await req(url, { referer });
  const html = r.text.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const direct = [...html.matchAll(/(?:file|src)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/gi)]
    .map(m => m[1]);
  const bare = [...html.matchAll(/https?:\/\/[^"'\\\s<>]+(?:\.m3u8|master\.txt)(?:\?[^"'\\\s<>]*)?/gi)].map(m => m[0]);
  const found = [...new Set([...direct, ...bare])].map(u => absolute(u, r.url));
  if (found.length) return found.map(u => ({ url: u, referer: r.url || url, origin: new URL(r.url || url).origin + "/", label: "ÇizgiMax" }));
  if (/video\.sibnet\.ru\/shell\.php/i.test(r.url)) return extractSibnet(r.url, referer);
  const iframe = html.match(/<iframe\b[^>]*src=["']([^"']+)["']/i)?.[1];
  if (iframe) return extractAny(absolute(iframe, r.url), r.url || url, depth + 1, seen);
  return [];
}

async function streams(episodeUrl) {
  const page = await req(episodeUrl, { referer: MAIN + "/" });
  const servers = [...parseEncodedArray(page.text, "servers"), ...Object.values(
    parseEncodedArray(page.text, "serversByLang") || {}
  ).flatMap(x => Array.isArray(x) ? x : [])];
  const unique = [], seen = new Set();
  for (const server of servers) {
    const key = server.streamUrl || server.resolveUrl || server.src || "";
    if (key && !seen.has(key)) { seen.add(key); unique.push(server); }
  }
  const out = [];
  for (const server of unique) {
    const sourceRef = page.url || episodeUrl;
    const label = String(server.label || "ÇizgiMax");
    if (server.resolveUrl) {
      const resolveUrl = absolute(server.resolveUrl);
      const rr = await req(resolveUrl, { referer: sourceRef });
      let payload; try { payload = JSON.parse(rr.text); } catch { payload = {}; }
      if (payload.id) {
        const tau = await req("https://tau-video.xyz/api/video/" + encodeURIComponent(payload.id), { referer: sourceRef });
        let data; try { data = JSON.parse(tau.text); } catch { data = {}; }
        for (const u of data.urls || []) if (u.url) out.push({ url: u.url, referer: MAIN + "/", origin: MAIN + "/", label: label + (u.label ? " " + u.label : "") });
      }
    } else if (server.streamUrl) {
      out.push(...await extractAny(absolute(server.streamUrl), sourceRef));
    } else if (server.src) {
      out.push(...await extractAny(absolute(server.src), sourceRef));
    }
  }
  const seenUrls = new Set();
  return out.filter(item => /^https?:\/\//i.test(item.url) && !seenUrls.has(item.url) && seenUrls.add(item.url));
}

export async function get({ type, titles = [], season = 1, episode = 1, strict = false } = {}) {
  const list = [...new Set(titles.filter(Boolean))];
  if (!list.length || !["series", "movie"].includes(type)) return [];
  let hit = null;
  for (const title of list) {
    const found = await search(title);
    let candidate = pickTitle(found, list);
    if (candidate && strict) { const ln = list.map(norm); if (!ln.includes(norm(candidate.alt)) && !ln.includes(norm(candidate.name))) candidate = null; }
    if (candidate) { hit = candidate; break; }
  }
  if (!hit) return [];
  const detail = await req(hit.url, { referer: MAIN + "/" });
  const eps = episodesFrom(detail.text);
  if (!eps.length) {
    if (type !== "movie" && /\/diziler\//i.test(hit.url)) return [];
    if (type === "movie" || /\/film(?:ler)?\//i.test(hit.url)) return streams(hit.url);
    return [];
  }
  if (type === "movie") return [];
  const selected = eps.find(e => e.season === Number(season) && e.episode === Number(episode));
  return selected ? streams(selected.url) : [];
}
