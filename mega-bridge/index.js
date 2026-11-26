'use strict';

/**
 * Nuvio Mega Bridge — Stremio Addon
 *
 * Merges providers from 6 Nuvio repos into one Stremio addon.
 * Deduplicates by provider ID, using repo priority order.
 *
 * Repos (in priority order — first one wins for duplicate IDs):
 *   1. All-in-One-Nuvio   (D3adlyRocket)
 *   2. Asura Synthesis     (PirateZoro9)
 *   3. Yoru's Repo         (yoruix)
 *   4. Phisher's Repo      (phisher98)
 *   5. Michat88 Repo       (michat88)
 *   6. Ray's Plugins       (hihihihihiiray)
 *
 * Deploy to Railway / Render, then add to Stremio:
 *   https://your-app.railway.app/manifest.json
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const vm    = require('vm');
const zlib  = require('zlib');
const crypto = require('crypto');
const net   = require('net');
const { Readable, pipeline } = require('stream');
const cheerio = require('cheerio');
const CHEERIO_WRAP = Object.assign({}, cheerio, { default: cheerio });
const HOST = (process.env.HOST || '').trim();
const HUB_URL = (process.env.HUB_URL || 'http://127.0.0.1:7100').replace(/\/+$/, '');
const HUB_PARSED = (() => { try { const u = new URL(HUB_URL); return { host: u.hostname.toLowerCase(), port: u.port || (u.protocol === 'https:' ? '443' : '80') }; } catch { return { host: '127.0.0.1', port: '7100' }; } })();
function capMap(m, max) { while (m.size > max) m.delete(m.keys().next().value); }
function singleflight(inflightMap, key, fn) {
  if (inflightMap.has(key)) return inflightMap.get(key);
  const prom = Promise.resolve().then(fn).finally(() => {
    if (inflightMap.get(key) === prom) inflightMap.delete(key);
  });
  inflightMap.set(key, prom);
  return prom;
}
async function runPool(items, concurrency, fn) {
  const list = Array.from(items || []);
  if (!list.length) return [];
  const results = new Array(list.length);
  let nextIdx = 0;
  const workerCount = Math.min(Math.max(1, concurrency || 1), list.length);
  const workers = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push((async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= list.length) break;
        results[idx] = await fn(list[idx], idx);
      }
    })());
  }
  await Promise.all(workers);
  return results;
}
function isLikelyHlsUrl(u) {
  const s = String(u || '').trim();
  if (!s) return false;
  if (/\.(mp4|mkv|webm|avi|mov|m4v)(\?|$)/i.test(s)) return false;
  return /\.m3u8(\?|$)|\/hls\/|\/(master|playlist|index)\.m3u8(\?|$)|format=m3u8|type=m3u8/i.test(s);
}
const DEFAULT_BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
function ensureBrowserHeaders(rawH) {
  const h = (rawH && typeof rawH === "object") ? { ...rawH } : {};
  if (!Object.keys(h).some(k => k.toLowerCase() === "user-agent")) {
    h["User-Agent"] = DEFAULT_BROWSER_UA;
  }
  return h;
}
function looksLikeHtmlBuf(buf) {
  if (!buf || !buf.length) return false;
  const head = buf.subarray(0, 128).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head") || head.startsWith("<body") || head.startsWith("<title");
}
function isPrivateOrLoopbackIpv4(ip) {
  const parts = ip.split('.').map(n => parseInt(n, 10));
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
function isAllowedProxyUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '').trim()); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = String(u.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return false;
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if ((host === '127.0.0.1' && port === '7100') || (host === HUB_PARSED.host && port === HUB_PARSED.port)) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal' || host === 'metadata') return false;
  const ipVer = net.isIP(host);
  if (ipVer === 4) return !isPrivateOrLoopbackIpv4(host);
  if (ipVer === 6) {
    if (host === '::' || host === '::1' || /^0*:0*:0*:0*:0*:0*:0*:[01]$/.test(host)) return false;
    if (/^(fe[89ab]|fc|fd)/i.test(host)) return false;
    const v4m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host);
    if (v4m) return !isPrivateOrLoopbackIpv4(v4m[1]);
    const v4hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
    if (v4hex) {
      const hi = parseInt(v4hex[1], 16), lo = parseInt(v4hex[2], 16);
      const ip4 = [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.');
      return !isPrivateOrLoopbackIpv4(ip4);
    }
  }
  return true;
}
function canonicalizeStreamUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    u.hash = '';
    return u.href;
  } catch {
    return s.replace(/#.*$/, '');
  }
}
function combineSignals(timeoutMs, extSignal) {
  const ac = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => ac.abort(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), timeoutMs) : null;
  const onExt = () => {
    if (timer) clearTimeout(timer);
    ac.abort(extSignal.reason || Object.assign(new Error('aborted'), { name: 'AbortError' }));
  };
  if (extSignal) {
    if (extSignal.aborted) onExt();
    else extSignal.addEventListener('abort', onExt, { once: true });
  }
  return {
    signal: ac.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      if (extSignal) extSignal.removeEventListener('abort', onExt);
    }
  };
}
const MAX_FFPROBE_CONCURRENCY = 3;
let ffprobeActive = 0;
const ffprobeQueue = [];
function withFfprobeSlot(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      ffprobeActive++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        ffprobeActive--;
        if (ffprobeQueue.length) ffprobeQueue.shift()();
      });
    };
    if (ffprobeActive < MAX_FFPROBE_CONCURRENCY) run();
    else ffprobeQueue.push(run);
  });
}
process.on('unhandledRejection', (err) => { console.error('[UnhandledRejection]', err && err.message ? err.message : err); });
process.on('uncaughtException', (err) => { console.error('[UncaughtException]', err && err.message ? err.message : err); });
const LANG_CATALOG = require('./lang-repos.json');
const { renderConfigureHtml } = require('./configure-ui');
const DATA_DIR = process.env.NUVIO_DATA_DIR || __dirname;
const SAVED_CFG_PATH = path.join(DATA_DIR, "saved-config.json");
function writeJsonAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, "utf8");
    let renamed = false;
    let lastErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.renameSync(tmpPath, filePath);
        renamed = true;
        break;
      } catch (err) {
        lastErr = err;
        if (err && (err.code === "EPERM" || err.code === "EBUSY")) {
          if (attempt === 4) {
            fs.copyFileSync(tmpPath, filePath);
            try { fs.unlinkSync(tmpPath); } catch {}
            renamed = true;
            break;
          }
          const waitUntil = Date.now() + 25 * (attempt + 1);
          while (Date.now() < waitUntil) {}
        } else {
          throw err;
        }
      }
    }
    if (!renamed && lastErr) throw lastErr;
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}
let savedCfgMem = null;
function loadSavedConfigStr() {
  if (savedCfgMem !== null) return savedCfgMem;
  try {
    if (!fs.existsSync(SAVED_CFG_PATH)) { savedCfgMem = ""; return ""; }
    const j = JSON.parse(fs.readFileSync(SAVED_CFG_PATH, "utf8"));
    savedCfgMem = typeof j?.cfg === "string" ? j.cfg : "";
    return savedCfgMem;
  } catch { savedCfgMem = ""; return ""; }
}
function saveConfigStr(cfgStr) {
  const clean = String(cfgStr || "").trim().slice(0, 65536);
  writeJsonAtomic(SAVED_CFG_PATH, JSON.stringify({ cfg: clean, updatedAt: Date.now() }, null, 2));
  savedCfgMem = clean;
  return clean;
}
function slugRepo(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
function enRepoSlugFromFilename(fn) {
  const parts = String(fn || "").split("/");
  const key = parts[2] === "raw.githubusercontent.com" && parts[3] && parts[4] ? (parts[3] + "/" + parts[4]) : (parts[2] || "other");
  return { key, id: "en_" + slugRepo(key) };
}
const EN_REPO_LABELS = {
  "D3adlyRocket/All-in-One-Nuvio": "All-in-One Nuvio",
  "A2R14N/nuvio-providers": "A2R14N Providers",
  "rareanimeaddon-blip/Nuvio-plugins": "RareAnime / Nuvio Plugins",
  "KhooLy/nuvio-providers": "KhooLy Providers",
  "itsmeadarsh2008/Streamline": "Streamline",
  "yoruix/nuvio-providers": "Yoru's Repo",
  "michat88/nuvio-providers": "Michat88",
  "hihihihihiiray/nuvio-plugins": "Ray's Plugins",
  "PirateZoro9/asura-providers": "Asura Synthesis",
  "flix-dlp/All-in-One-Nuvio": "Flix-DLP (Net77)",
};
let trHubGroupsCache = null;
const trHubGroupsInflight = new Map();
async function fetchTrHubGroups() {
  if (trHubGroupsCache && Date.now() - trHubGroupsCache.t < (trHubGroupsCache.ttl || 300000)) return trHubGroupsCache.v;
  return singleflight(trHubGroupsInflight, "trhub_groups", async () => {
    if (trHubGroupsCache && Date.now() - trHubGroupsCache.t < (trHubGroupsCache.ttl || 300000)) return trHubGroupsCache.v;
    try {
      const html = await httpGet(HUB_URL + "/", {}, 5000, 0);
      const q = String.fromCharCode(34);
      const parts = html.split("<h3>").slice(1);
      const cs3Map = new Map(), nuvioMap = new Map();
      const unesc = s => String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, q).trim();
      for (const part of parts) {
        const title = (part.split("</h3>")[0] || "").trim();
        const body = part.split("</div>")[0] || "";
        const vals = body.split("name=" + q + "prov" + q + " value=" + q).slice(1).map(x => unesc(x.split(q)[0])).filter(Boolean);
        if (!vals.length) continue;
        const isCs3 = /cloudstream|cs3/i.test(title);
        const target = isCs3 ? cs3Map : nuvioMap;
        const pref = isCs3 ? "tr_cs3:" : "tr_nuvio:";
        for (const name of vals) {
          const sl = slugRepo(name);
          if (sl && !target.has(sl)) target.set(sl, { id: pref + sl, slug: sl, name });
        }
      }
      const cs3 = [...cs3Map.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
      const nuvio = [...nuvioMap.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
      const v = { cs3, nuvio, cs3Set: new Set(cs3Map.keys()), nuvioSet: new Set(nuvioMap.keys()) };
      trHubGroupsCache = { t: Date.now(), ttl: 300000, v };
      return v;
    } catch {
      const empty = { cs3: [], nuvio: [], cs3Set: new Set(), nuvioSet: new Set() };
      trHubGroupsCache = { t: Date.now(), ttl: 20000, v: empty };
      return empty;
    }
  });
}
async function buildRepoCatalog() {
  const trG = await fetchTrHubGroups();
  const out = {};
  for (const [code, def] of Object.entries(LANG_CATALOG)) {
    if (code === "tr") {
      out.tr = [
        { id: "tr_cs3", name: "CloudStream (CS3)", sub: (trG.cs3.length || 211) + " kaynak · 21 CS3 repo", count: trG.cs3.length },
        { id: "tr_nuvio", name: "Nuvio TR Depoları", sub: (trG.nuvio.length || 428) + " kaynak · 20 Nuvio repo", count: trG.nuvio.length },
      ];
    } else if (code === "en") {
      const counts = new Map();
      for (const p of (providers || [])) {
        if (p.meta?.id === "trhub" || !p._repoId || !p._repoId.startsWith("en_")) continue;
        const cur = counts.get(p._repoId) || { id: p._repoId, key: p._repoKey || p._repoId, count: 0 };
        cur.count++;
        counts.set(p._repoId, cur);
      }
      if (counts.size > 0) {
        out.en = [...counts.values()].sort((a, b) => b.count - a.count).map(x => ({
          id: x.id,
          name: EN_REPO_LABELS[x.key] || x.key,
          sub: x.key + " · " + x.count + " kaynak",
          count: x.count,
        }));
      } else {
        out.en = Object.entries(EN_REPO_LABELS).map(([k, lbl]) => ({ id: "en_" + slugRepo(k), name: lbl, sub: k }));
      }
    } else if (code === "fa") {
      out.fa = [{ id: "fa_persian", name: "PersianStremio", sub: "Dahili sağlayıcı", count: 1 }];
    } else if (code === "th") {
      out.th = [{ id: "th_kisskh", name: "Kisskh", sub: "Dahili sağlayıcı", count: 1 }];
    } else if (Array.isArray(def.repos) && def.repos.length) {
      out[code] = def.repos.map(r => ({
        id: code + "_" + slugRepo(r.name),
        name: r.name,
        sub: (r.url || "").replace(/^https?:\/\/raw\.githubusercontent\.com\//i, "").split("/").slice(0, 2).join("/") || "Nuvio Repo",
      }));
    } else if (def.kind === "enhub_subset") {
      const matched = (providers || []).filter(p => p.meta?.id !== "trhub" && scraperMatchesLangStrict(p.meta, code));
      out[code] = [{
        id: code + "_enhub",
        name: "EN Hub · " + def.name,
        sub: matched.length ? (matched.length + " çoklu-dil sağlayıcı") : (def.note || "Çoklu-dil / Çapraz ses"),
        count: matched.length,
      }];
    }
  }
  return out;
}
const repoSourcesCache = new Map();
const repoSourcesInflight = new Map();
const manifestUrlCache = new Map();
const manifestUrlInflight = new Map();
const MANIFEST_CACHE_TTL_MS = 15 * 60 * 1000;
async function fetchManifestJson(url, timeoutMs = 15000) {
  const u = String(url || "").trim();
  if (!u) return null;
  const hit = manifestUrlCache.get(u);
  if (hit && Date.now() - hit.t < MANIFEST_CACHE_TTL_MS) return hit.parsed;
  return singleflight(manifestUrlInflight, u, async () => {
    const hit2 = manifestUrlCache.get(u);
    if (hit2 && Date.now() - hit2.t < MANIFEST_CACHE_TTL_MS) return hit2.parsed;
    const txt = await httpGet(u, {}, timeoutMs, 0);
    const parsed = safeJson(txt);
    if (parsed) {
      manifestUrlCache.set(u, { t: Date.now(), parsed });
      capMap(manifestUrlCache, 100);
    }
    return parsed;
  });
}
async function getSourcesForRepo(code, repoId) {
  const c = String(code || "").toLowerCase();
  const rid = String(repoId || "").toLowerCase();
  if (c === "tr") {
    const trG = await fetchTrHubGroups();
    if (rid === "tr_cs3") return trG.cs3.map(x => ({ id: x.id, name: x.name }));
    if (rid === "tr_nuvio") return trG.nuvio.map(x => ({ id: x.id, name: x.name }));
    return [];
  }
  if (c === "en") {
    await ensureProviders();
    return (providers || []).filter(p => p._repoId === rid).map(p => ({ id: "p:" + slugRepo(p.meta?.id || p.meta?.name), name: String(p.meta?.name || p.meta?.id || "") })).sort((a, b) => a.name.localeCompare(b.name));
  }
  if (c === "fa") return [{ id: "p:persianstremio", name: "PersianStremio" }];
  if (c === "th") return [{ id: "p:kisskh", name: "Kisskh" }];
  const ck = c + "|" + rid;
  const hit = repoSourcesCache.get(ck);
  if (hit && Date.now() - hit.t < 600000) return hit.v;
  return singleflight(repoSourcesInflight, ck, async () => {
    const hit2 = repoSourcesCache.get(ck);
    if (hit2 && Date.now() - hit2.t < 600000) return hit2.v;
    const def = LANG_CATALOG[c];
    const repoObj = def && Array.isArray(def.repos) ? def.repos.find(r => (c + "_" + slugRepo(r.name)) === rid) : null;
    if (!repoObj || !repoObj.url) return [];
    try {
      const parsed = await fetchManifestJson(repoObj.url, 12000);
      const list = Array.isArray(parsed) ? parsed : (parsed?.scrapers || []);
      const out = [];
      const seen = new Set();
      for (const entry of list) {
        if (!entry || entry.enabled === false || !entry.filename) continue;
        if (isTorrentScraper(entry) || isNonVodScraper(entry) || !scraperMatchesLang(entry, c)) continue;
        const sid = "p:" + slugRepo(entry.id || entry.name);
        if (!sid || seen.has(sid)) continue;
        seen.add(sid);
        out.push({ id: sid, name: String(entry.name || entry.id || "") });
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      repoSourcesCache.set(ck, { t: Date.now(), v: out });
      capMap(repoSourcesCache, 100);
      return out;
    } catch { return []; }
  });
}
const TORRENT_SCRAPER_RE = /(?:\b(?:torrentio|yts|torrastream|filmestorrent|baixar.?filmes.?via.?torrent|ultra.?torrent|cpasbien|1337x|piratebay|eztv|nyaa|usenet|kickass|rarbg)\b|(?<!no)torrent)/i;
function isTorrentScraper(meta) { return TORRENT_SCRAPER_RE.test(String(meta?.id || "") + " " + String(meta?.name || "")); }
function isTorrentStream(s) { const u = String(s?.url || ""); return !/^https?:\/\//i.test(u) || /^magnet:/i.test(u) || /\.torrent(\?|$)/i.test(u) || (s?.infoHash && !u); }
const NON_VOD_SCRAPER_RE = /\b(iptv|iptvde|live[- ]?tv|pluto\s*tv|plutotv|welt\s*tv|mediaccc|live\s*channels?|tv\s*channels?|radio)\b|^welt$/i;
function isNonVodScraper(meta) {
  const id = String(meta?.id || "").trim();
  const name = String(meta?.name || "").trim();
  const desc = String(meta?.description || "").trim();
  return NON_VOD_SCRAPER_RE.test(id) || NON_VOD_SCRAPER_RE.test(name) || /\b(live[- ]?tv|iptv)\b/i.test(desc);
}
function isLiveStream(s, rawName, rawTitle) {
  const txt = `${rawName || ""} ${rawTitle || ""}`;
  const u = String(s?.url || "");
  if (/[\u2022\u00b7|]\s*live\b|\blive\s*tv\b|\biptv\b|\b(welt\s*tv|ard\s*das\s*erste|zdf\s*live|tagesschau24)\b/i.test(txt)) return true;
  if (/\/hls\/live\//i.test(u)) return true;
  return false;
}
const LANG_ALIAS = {
  tr:"tr", tur:"tr", turkish:"tr",
  en:"en", eng:"en", english:"en", multi:"en", "en-us":"en", "en-gb":"en", "en-uk":"en", en_us:"en", en_uk:"en",
  es:"es", spa:"es", spanish:"es", lat:"es", latino:"es", latam:"es", mx:"es", "es-es":"es", "es-la":"es", "es-419":"es", es_es:"es", es_la:"es",
  pt:"pt", por:"pt", "pt-br":"pt", "pt-pt":"pt", pt_br:"pt", portuguese:"pt",
  fr:"fr", fra:"fr", fre:"fr", french:"fr", "fr-ca":"fr", fr_ca:"fr",
  de:"de", deu:"de", ger:"de", german:"de",
  it:"it", ita:"it", italian:"it",
  hi:"hi", hin:"hi", hindi:"hi",
  ta:"ta", tam:"ta", tamil:"ta",
  te:"te", tel:"te", telugu:"te",
  ml:"ml", mal:"ml", malayalam:"ml",
  kn:"kn", kan:"kn", kannada:"kn",
  bn:"bn", ben:"bn", ba:"bn", bengali:"bn", bangla:"bn",
  mr:"mr", mar:"mr", marathi:"mr",
  gu:"gu", guj:"gu", gujarati:"gu",
  pa:"pa", pan:"pa", punjabi:"pa",
  ur:"ur", urd:"ur", urdu:"ur",
  ru:"ru", rus:"ru", russian:"ru",
  uk:"uk", ukr:"uk", ukrainian:"uk",
  hu:"hu", hun:"hu", hungarian:"hu",
  vi:"vi", vie:"vi", vietnamese:"vi",
  zh:"zh", zho:"zh", chi:"zh", ch:"zh", chs:"zh", cht:"zh", "zh-cn":"zh", "zh-tw":"zh", "zh-hk":"zh", zh_cn:"zh", zh_tw:"zh", chinese:"zh", mandarin:"zh",
  yue:"yue", cantonese:"yue",
  pl:"pl", pol:"pl", polish:"pl",
  fa:"fa", fas:"fa", per:"fa", pe:"fa", persian:"fa", farsi:"fa",
  th:"th", tha:"th", thai:"th",
  ar:"ar", ara:"ar", arabic:"ar",
  ja:"ja", jpn:"ja", jap:"ja", japanese:"ja",
  ko:"ko", kor:"ko", korean:"ko",
  ro:"ro", ron:"ro", rum:"ro", romanian:"ro",
  cs:"cs", cze:"cs", ces:"cs", czech:"cs",
  nl:"nl", dut:"nl", nld:"nl", dutch:"nl",
  sv:"sv", swe:"sv", swedish:"sv",
  no:"no", nor:"no", nob:"no", nno:"no", norwegian:"no",
  da:"da", dan:"da", danish:"da",
  fi:"fi", fin:"fi", finnish:"fi",
  el:"el", gre:"el", ell:"el", greek:"el",
  id:"id", ind:"id", indonesian:"id",
  ms:"ms", may:"ms", msa:"ms", my:"ms", malay:"ms",
  tl:"tl", tgl:"tl", fil:"tl", ph:"tl", filipino:"tl", tagalog:"tl",
};
function baseLangOf(code) {
  const c = String(code || "").trim().toLowerCase();
  return (LANG_CATALOG[c] && LANG_CATALOG[c].baseLang) || c;
}
function scraperLangs(meta) {
  const raw = Array.isArray(meta?.contentLanguage) ? meta.contentLanguage : (meta?.contentLanguage ? [meta.contentLanguage] : []);
  return raw.map(x => LANG_ALIAS[String(x || "").trim().toLowerCase()] || String(x || "").trim().toLowerCase()).filter(Boolean);
}
function scraperMatchesLang(meta, code) {
  const ls = scraperLangs(meta);
  if (!ls.length) return true;
  const base = baseLangOf(code);
  return ls.includes(code) || ls.includes(base);
}
function scraperMatchesLangStrict(meta, code) {
  const ls = scraperLangs(meta);
  if (!ls.length) return false;
  const base = baseLangOf(code);
  return ls.includes(code) || ls.includes(base);
}

const PORT = process.env.PORT || 3001;

// ─── Source repos (priority order — first wins on duplicate IDs) ──────────────
const REPOS = [
  {
    name : "EN Hub",
    base : `${HUB_URL}/en-repo`,
    manifestUrl: `${HUB_URL}/en-repo/manifest.json`,
  },
];

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const TMDB_KEYS = [
  process.env.TMDB_API_KEY,
  '439c478a771f35c05022f9feabcca01c',
  '1c29a5198ee1854bd5eb45dbe8d17d92',
].filter(Boolean);
const titleCache = new Map();
const infoCache = new Map();

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ANIME_ONLY_RE = /(?:anizium|anizm|anime|anikoto|anineko|openani|aniwatch|anilibria|anidub|aniworld|hianime|zoro|kaido|crunchy|turkanime|tranime|animecix|vidnestanime|patronasyaanimeleri|animewho|jkanime|voiranime|monoschinos|\ballwish\b|\banidb\b|\banizone\b|\bkurage\b|\btokyoinsider\b)/i;
function isAnimeOnlyProvider(name) { return ANIME_ONLY_RE.test(String(name || "")); }

const tmdbInflight = new Map();
const imdbResolveCache = new Map();

async function resolveImdbToTmdb(imdbId, mediaType) {
  const normImdb = String(imdbId || "").trim().toLowerCase();
  const prefType = mediaType === 'tv' ? 'tv' : 'movie';
  const cacheKey = `${prefType}:${normImdb}`;
  const cached = imdbResolveCache.get(cacheKey);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.val;
  return singleflight(tmdbInflight, `imdb:${cacheKey}`, async () => {
    const cached2 = imdbResolveCache.get(cacheKey);
    if (cached2 && Date.now() - cached2.at < cached2.ttl) return cached2.val;
    for (const key of TMDB_KEYS) {
      try {
        const res = await fetch(`https://api.themoviedb.org/3/find/${encodeURIComponent(normImdb)}?external_source=imdb_id&api_key=${key}`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) continue;
        const j = await res.json();
        const tvHit = Array.isArray(j.tv_results) && j.tv_results.length ? j.tv_results[0] : null;
        const mvHit = Array.isArray(j.movie_results) && j.movie_results.length ? j.movie_results[0] : null;
        const hit = prefType === 'tv' ? (tvHit || mvHit) : (mvHit || tvHit);
        if (hit && hit.id) {
          const resolvedType = (hit === tvHit) ? 'tv' : 'movie';
          const title = hit.name || hit.title || hit.original_name || hit.original_title || null;
          const isAnimation = Array.isArray(hit.genre_ids) ? hit.genre_ids.includes(16) : null;
          const originalLang = hit.original_language ? String(hit.original_language).toLowerCase() : null;
          const val = { tmdbId: String(hit.id), title, mediaType: resolvedType, isAnimation, originalLang };
          imdbResolveCache.set(cacheKey, { val, at: Date.now(), ttl: 60 * 60 * 1000 });
          capMap(imdbResolveCache, 500);
          if (title) {
            titleCache.set(`${resolvedType}:${val.tmdbId}`, { title, isAnimation, originalLang, at: Date.now(), ttl: 60 * 60 * 1000 });
            titleCache.set(`${resolvedType}:${normImdb}`, { title, isAnimation, originalLang, at: Date.now(), ttl: 60 * 60 * 1000 });
            capMap(titleCache, 500);
          }
          return val;
        }
      } catch (_) {}
    }
    imdbResolveCache.set(cacheKey, { val: null, at: Date.now(), ttl: 30000 });
    capMap(imdbResolveCache, 500);
    return null;
  });
}

async function getRequestedTitle(tmdbId, mediaType) {
  if (/^tt\d+$/i.test(String(tmdbId || ''))) {
    const resolved = await resolveImdbToTmdb(tmdbId, mediaType);
    return resolved ? resolved.title : null;
  }
  const cacheKey = `${mediaType}:${tmdbId}`;
  const cached = titleCache.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.ttl || 60 * 60 * 1000)) return cached.title;
  return singleflight(tmdbInflight, `title:${cacheKey}`, async () => {
    const cached2 = titleCache.get(cacheKey);
    if (cached2 && Date.now() - cached2.at < (cached2.ttl || 60 * 60 * 1000)) return cached2.title;
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    for (const key of TMDB_KEYS) {
      try {
        const res = await fetch(`https://api.themoviedb.org/3/${endpoint}/${encodeURIComponent(tmdbId)}?api_key=${key}&append_to_response=external_ids`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) continue;
        const json = await res.json();
        const title = json.name || json.title || json.original_name || json.original_title || null;
        const isAnimation = Array.isArray(json.genres) ? json.genres.some(g => g && (g.id === 16 || /anim/i.test(String(g.name || '')))) : null;
        const originalLang = json.original_language ? String(json.original_language).toLowerCase() : null;
        const imdbId = (json.imdb_id || json.external_ids?.imdb_id || '').trim() || null;
        if (title) {
          titleCache.set(cacheKey, { title, isAnimation, originalLang, imdbId, at: Date.now(), ttl: 60 * 60 * 1000 });
          capMap(titleCache, 500);
          return title;
        }
      } catch (_) {}
    }
    titleCache.set(cacheKey, { title: null, isAnimation: null, at: Date.now(), ttl: 20000 });
    capMap(titleCache, 500);
    return null;
  });
}

async function getTmdbInfo(tmdbId, mediaType) {
  const cacheKey = `info:${mediaType}:${tmdbId}`;
  const cached = infoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.ttl || 60 * 60 * 1000)) return cached.info;
  return singleflight(tmdbInflight, cacheKey, async () => {
    const cached2 = infoCache.get(cacheKey);
    if (cached2 && Date.now() - cached2.at < (cached2.ttl || 60 * 60 * 1000)) return cached2.info;
    if (/^tt\d+$/i.test(String(tmdbId || ''))) {
      const resolved = await resolveImdbToTmdb(tmdbId, mediaType);
      const info = resolved
        ? { tmdbId: resolved.tmdbId, imdbId: String(tmdbId), title: resolved.title, mediaType: resolved.mediaType, isAnimation: resolved.isAnimation, originalLang: resolved.originalLang ?? null }
        : { tmdbId: String(tmdbId), imdbId: String(tmdbId), title: null, mediaType, isAnimation: null, originalLang: null };
      infoCache.set(cacheKey, { info, at: Date.now(), ttl: resolved ? (60 * 60 * 1000) : 30000 });
      capMap(infoCache, 500);
      return info;
    }
    const primary = await getRequestedTitle(tmdbId, mediaType);
    const primEntry = titleCache.get(`${mediaType}:${tmdbId}`);
    let info = { tmdbId: String(tmdbId), imdbId: primEntry?.imdbId ?? null, title: primary, mediaType, isAnimation: primEntry?.isAnimation ?? null, originalLang: primEntry?.originalLang ?? null };
    if (!primary) {
      const otherType = mediaType === 'tv' ? 'movie' : 'tv';
      const other = await getRequestedTitle(tmdbId, otherType);
      const othEntry = titleCache.get(`${otherType}:${tmdbId}`);
      info = { tmdbId: String(tmdbId), imdbId: othEntry?.imdbId ?? null, title: other || null, mediaType: other ? otherType : mediaType, isAnimation: othEntry?.isAnimation ?? null, originalLang: othEntry?.originalLang ?? null };
    }
    infoCache.set(cacheKey, { info, at: Date.now(), ttl: info.title ? (60 * 60 * 1000) : 20000 });
    capMap(infoCache, 500);
    return info;
  });
}

function matchesTitle(text, requestedTitle) {
  if (!requestedTitle) return false;
  const haystack = normalizeText(text);
  const full = normalizeText(requestedTitle);
  if (full && haystack.includes(full)) return true;
  const stop = new Set(['the', 'and', 'of', 'a', 'an', 'to', 'in', 'on', 'for', 'with']);
  const tokens = normalizeText(requestedTitle)
    .split(' ')
    .filter((token) => token.length >= 3 && !stop.has(token));
  if (!tokens.length) return false;
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return tokens.length >= 2 ? hits >= Math.min(2, tokens.length) : hits === 1;
}

const TRUSTED_TR_PROVIDERS = new Set([
  'DiziYou', 'DiziBox', 'HDFilmCehennemi', 'Dizilla', 'DiziPal', 'DiziMom',
  'Sezonlukdizi', 'WebteIzle', 'FilmMakinesi', 'FilmModu', 'FullHDFilmizlesene',
  'JetFilmizle', 'SelcukFlix', 'SetFilmIzle', 'Sinemetrik', 'Ddizi', 'DiziBal',
  'DiziPod', 'RecTV', 'PuhuTV', 'TLC Türkiye', 'YesilCamTv', 'WebdramaTurkey2',
  'BelgeselX', 'DMAX', 'Dizikorea3',
  'DiziBak', 'DiziBoxİzle', 'DDiziBox', 'DiziWatch', 'HDFilmDelisi', 'HDFilmIzle',
  'YabancıDizi', 'LiderFilm', 'KultFilmler', 'Vidmody', 'TvDiziler', 'TR Dizi İzle',
]);

// ─── State ────────────────────────────────────────────────────────────────────
let providers    = null;
let stremioMeta  = null;
let lastLoad     = 0;
let loadPromise  = null;

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function httpGet(url, headers = {}, timeoutMs = 25000, retries = 1, opts = {}) {
  const maxRedirects = Number.isInteger(opts?.maxRedirects) ? opts.maxRedirects : 5;
  const redirects = Number.isInteger(opts?._redirects) ? opts._redirects : 0;
  const signal = opts?.signal || null;
  const fullResponse = !!opts?.fullResponse;
  const method = opts?.method ? String(opts.method).toUpperCase() : 'GET';
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      return reject(signal.reason || new Error(`Aborted — ${url}`));
    }
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      fn(val);
    };
    const lib  = url.startsWith('https') ? https : http;
    let onAbort = null;
    const req  = lib.request(url, { method, headers, timeout: timeoutMs }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects >= maxRedirects) {
          return finish(reject, new Error(`Too many redirects — ${url}`));
        }
        let nextUrl;
        try {
          nextUrl = new URL(res.headers.location, url).href;
        } catch (e) {
          return finish(reject, new Error(`Invalid redirect URL — ${res.headers.location}`));
        }
        return httpGet(nextUrl, headers, timeoutMs, retries, { ...opts, _redirects: redirects + 1 }).then(
          v => finish(resolve, v),
          e => finish(reject, e)
        );
      }
      const buf = [];
      res.on('data',  c => buf.push(c));
      res.on('end',   () => {
        const body = Buffer.concat(buf).toString('utf-8');
        if (fullResponse) {
          return finish(resolve, { body, status: res.statusCode, statusText: res.statusMessage || '', headers: res.headers || {}, finalUrl: url });
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`HTTP ${res.statusCode} — ${url}`);
          err.status = res.statusCode;
          return finish(reject, err);
        }
        finish(resolve, body);
      });
      res.on('error', (err) => finish(reject, err));
    });
    onAbort = () => {
      req.destroy(signal.reason || new Error(`Aborted — ${url}`));
      finish(reject, signal.reason || new Error(`Aborted — ${url}`));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    req.on('timeout', () => { req.destroy(); finish(reject, new Error(`Timeout — ${url}`)); });
    req.on('error', (err) => {
      if (settled) return;
      if (retries > 0 && !(signal && signal.aborted) && /ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT/i.test(String(err?.code || err?.message || ""))) {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        settled = true;
        setTimeout(() => httpGet(url, headers, timeoutMs, retries - 1, opts).then(resolve, reject), 600);
      } else finish(reject, err);
    });
    req.end();
  });
}

function safeJson(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

// ─── Module shims ─────────────────────────────────────────────────────────────
const CHEERIO_SHIM = (() => {
  const empty = () => {
    const node = () => node;
    Object.assign(node, {
      text: () => '', html: () => '', attr: () => null, val: () => null,
      find: () => node, first: () => node, last: () => node, eq: () => node,
      filter: () => node, children: () => node, parent: () => node, parents: () => node,
      closest: () => node, next: () => node, prev: () => node, siblings: () => node,
      each: (_fn) => node, map: (_fn) => ({ get: () => [] }), toArray: () => [],
      is: () => false, hasClass: () => false, length: 0,
      toString: () => '',
    });
    return node;
  };
  const load = (_html) => {
    const $ = (sel) => empty();
    $.load = load;
    return $;
  };
  return { load };
})();

const CRYPTOJS_SHIM = (() => {
  const nodeCrypto = require('crypto');

  function wordsToBuffer(wordArray) {
    const words  = wordArray.words || [];
    const bytes  = wordArray.sigBytes != null ? wordArray.sigBytes : words.length * 4;
    const buf    = Buffer.alloc(bytes);
    for (let i = 0; i < bytes; i++) {
      buf[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    }
    return buf;
  }

  function toBuffer(val, encoding = 'utf8') {
    if (!val) return Buffer.alloc(16);
    if (Buffer.isBuffer(val)) return val;
    if (typeof val === 'string') return Buffer.from(val, encoding);
    if (val.words) return wordsToBuffer(val);
    return Buffer.from(String(val));
  }

  const enc = {
    Utf8  : { stringify: (w) => wordsToBuffer(w).toString('utf8'),   parse: (s) => { const b = Buffer.from(s,'utf8');   return { words: [...b].reduce((a,v,i) => { if(i%4===0)a.push(0); a[a.length-1]|=(v<<(24-i%4*8)); return a; },[]), sigBytes:b.length }; } },
    Base64: { stringify: (w) => wordsToBuffer(w).toString('base64'), parse: (s) => { const b = Buffer.from(s,'base64'); return { words: [...b].reduce((a,v,i) => { if(i%4===0)a.push(0); a[a.length-1]|=(v<<(24-i%4*8)); return a; },[]), sigBytes:b.length }; } },
    Hex   : { stringify: (w) => wordsToBuffer(w).toString('hex'),    parse: (s) => { const b = Buffer.from(s,'hex');    return { words: [...b].reduce((a,v,i) => { if(i%4===0)a.push(0); a[a.length-1]|=(v<<(24-i%4*8)); return a; },[]), sigBytes:b.length }; } },
    Latin1: { stringify: (w) => wordsToBuffer(w).toString('latin1'), parse: (s) => { const b = Buffer.from(s,'latin1'); return { words: [...b].reduce((a,v,i) => { if(i%4===0)a.push(0); a[a.length-1]|=(v<<(24-i%4*8)); return a; },[]), sigBytes:b.length }; } },
  };

  const wordResult = (buf) => {
    const sigBytes = buf.length;
    const padLen = (4 - (sigBytes % 4)) % 4;
    const padded = padLen ? Buffer.concat([buf, Buffer.alloc(padLen)]) : buf;
    const words = [];
    for (let i = 0; i < padded.length; i += 4) words.push(padded.readUInt32BE(i));
    return { words, sigBytes, toString: (e) => (e||enc.Hex).stringify({ words, sigBytes }) };
  };

  const tryAes = (algo, keyBuf, ivBuf, dataBuf, decrypt = true) => {
    try {
      const fn = decrypt
        ? nodeCrypto.createDecipheriv(algo, keyBuf, ivBuf)
        : nodeCrypto.createCipheriv(algo, keyBuf, ivBuf);
      fn.setAutoPadding(true);
      return wordResult(Buffer.concat([fn.update(dataBuf), fn.final()]));
    } catch (_) {
      return wordResult(Buffer.alloc(0));
    }
  };

  return {
    enc,
    lib: { WordArray: { create: (arr, sigBytes) => ({ words: arr||[], sigBytes: sigBytes||0, toString: (e) => (e||enc.Hex).stringify({words:arr||[],sigBytes:sigBytes||0}) }) } },
    AES: {
      decrypt: (ciphertext, key, opts = {}) => {
        try {
          const algo    = 'aes-256-cbc';
          const keyBuf  = toBuffer(key).slice(0,32).length < 32
                          ? Buffer.concat([toBuffer(key), Buffer.alloc(32)]).slice(0,32)
                          : toBuffer(key).slice(0,32);
          const ivBuf   = opts.iv ? toBuffer(opts.iv).slice(0,16) : Buffer.alloc(16);
          const rawData = typeof ciphertext === 'string'
                          ? Buffer.from(ciphertext,'base64')
                          : (ciphertext.ciphertext ? toBuffer(ciphertext.ciphertext) : toBuffer(ciphertext));
          const result  = tryAes(algo, keyBuf, ivBuf, rawData, true);
          return result;
        } catch (_) { return wordResult(Buffer.alloc(0)); }
      },
      encrypt: (msg, key, opts = {}) => {
        try {
          const keyBuf  = Buffer.concat([toBuffer(key), Buffer.alloc(32)]).slice(0,32);
          const ivBuf   = opts.iv ? toBuffer(opts.iv).slice(0,16) : nodeCrypto.randomBytes(16);
          const result  = tryAes('aes-256-cbc', keyBuf, ivBuf, toBuffer(msg), false);
          return { ciphertext: result, toString: () => result.toString(enc.Base64) };
        } catch (_) { return { toString: () => '' }; }
      },
    },
    MD5    : (s) => wordResult(Buffer.from(nodeCrypto.createHash('md5').update(toBuffer(s)).digest())),
    SHA256 : (s) => wordResult(Buffer.from(nodeCrypto.createHash('sha256').update(toBuffer(s)).digest())),
    SHA1   : (s) => wordResult(Buffer.from(nodeCrypto.createHash('sha1').update(toBuffer(s)).digest())),
    SHA512 : (s) => wordResult(Buffer.from(nodeCrypto.createHash('sha512').update(toBuffer(s)).digest())),
    HmacMD5   : (msg, key) => wordResult(Buffer.from(nodeCrypto.createHmac('md5',   toBuffer(key)).update(toBuffer(msg)).digest())),
    HmacSHA256: (msg, key) => wordResult(Buffer.from(nodeCrypto.createHmac('sha256',toBuffer(key)).update(toBuffer(msg)).digest())),
    HmacSHA512: (msg, key) => wordResult(Buffer.from(nodeCrypto.createHmac('sha512',toBuffer(key)).update(toBuffer(msg)).digest())),
    RC4: { encrypt: () => ({ toString: () => '' }), decrypt: () => wordResult(Buffer.alloc(0)) },
    pad: { Pkcs7: {}, NoPadding: {} },
    mode: { CBC: {}, ECB: {}, CTR: {} },
  };
})();

const AXIOS_SHIM = (() => {
  const mergeHeaders = (defHdrs, callHdrs, method) => {
    const out = {};
    const mKey = String(method || 'get').toLowerCase();
    const applyObj = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj)) {
        if (v == null || typeof v === 'object') continue;
        out[k] = v;
      }
    };
    if (defHdrs && typeof defHdrs === 'object') {
      applyObj(defHdrs.common);
      applyObj(defHdrs[mKey]);
      applyObj(defHdrs);
    }
    applyObj(callHdrs);
    return out;
  };
  const buildUrl = (baseURL, rawUrl, params) => {
    let full = String(rawUrl || '');
    if (baseURL && !/^https?:\/\//i.test(full)) {
      const b = String(baseURL).replace(/\/+$/, '');
      const p = full.replace(/^\/+/, '');
      full = p ? (b + '/' + p) : b;
    }
    if (params && typeof params === 'object') {
      try {
        const u = new URL(full);
        if (params instanceof URLSearchParams) {
          for (const [k, v] of params.entries()) u.searchParams.append(k, v);
        } else {
          for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null) continue;
            if (Array.isArray(v)) { for (const item of v) if (item !== undefined && item !== null) u.searchParams.append(k, String(item)); }
            else u.searchParams.set(k, String(v));
          }
        }
        full = u.toString();
      } catch {}
    }
    return full;
  };
  const request = async (config) => {
    const cfgObj = typeof config === 'string' ? { url: config } : (config || {});
    const method = (cfgObj.method || 'GET').toUpperCase();
    const url    = buildUrl(cfgObj.baseURL || '', cfgObj.url || '', cfgObj.params);
    const hdrs   = cfgObj.headers || {};
    const tout   = cfgObj.timeout || 25000;
    const validateStatus = typeof cfgObj.validateStatus === 'function'
      ? cfgObj.validateStatus
      : (s) => s >= 200 && s < 300;

    if (method === 'GET' || method === 'HEAD') {
      const resp = await httpGet(url, hdrs, tout, 1, { fullResponse: true, method });
      const data = method === 'HEAD' ? '' : (safeJson(resp.body) ?? resp.body);
      const out = { data, status: resp.status, headers: resp.headers, statusText: resp.statusText };
      if (!validateStatus(resp.status)) {
        const err = new Error(`HTTP ${resp.status} — ${url}`);
        err.response = out;
        err.status = resp.status;
        throw err;
      }
      return out;
    }

    // POST/PUT/DELETE/PATCH
    const resp = await new Promise((resolve, reject) => {
      const u   = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const body = cfgObj.data !== undefined && cfgObj.data !== null
        ? (typeof cfgObj.data === 'string' || Buffer.isBuffer(cfgObj.data) ? cfgObj.data : JSON.stringify(cfgObj.data))
        : '';
      const hasCT = Object.keys(hdrs).some(k => k.toLowerCase() === 'content-type');
      const reqHdrs = { ...hdrs };
      if (body && !hasCT) reqHdrs['Content-Type'] = 'application/json';
      if (body && !Object.keys(reqHdrs).some(k => k.toLowerCase() === 'content-length')) {
        reqHdrs['Content-Length'] = Buffer.byteLength(body);
      }
      const opts = {
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method,
        headers: reqHdrs,
        timeout: tout,
      };
      const req = lib.request(opts, (res) => {
        const buf = [];
        res.on('data', c => buf.push(c));
        res.on('end', () => resolve({ body: Buffer.concat(buf).toString('utf-8'), status: res.statusCode, headers: res.headers || {}, statusText: res.statusMessage || '' }));
        res.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });

    const out = { data: safeJson(resp.body) ?? resp.body, status: resp.status, headers: resp.headers, statusText: resp.statusText };
    if (!validateStatus(resp.status)) {
      const err = new Error(`HTTP ${resp.status} — ${url}`);
      err.response = out;
      err.status = resp.status;
      throw err;
    }
    return out;
  };

  const ax = (cfg) => request(cfg);
  ax.get     = (url, cfg) => request({ url, method:'GET',    ...(cfg||{}) });
  ax.post    = (url, data, cfg) => request({ url, method:'POST',   data, ...(cfg||{}) });
  ax.put     = (url, data, cfg) => request({ url, method:'PUT',    data, ...(cfg||{}) });
  ax.delete  = (url, cfg) => request({ url, method:'DELETE', ...(cfg||{}) });
  ax.patch   = (url, data, cfg) => request({ url, method:'PATCH',  data, ...(cfg||{}) });
  ax.head    = (url, cfg) => request({ url, method:'HEAD',   ...(cfg||{}) });
  ax.create  = (defaults) => {
    const def = defaults || {};
    const inst = (cfg) => {
      const c = typeof cfg === 'string' ? { url: cfg } : (cfg || {});
      const method = (c.method || def.method || 'GET').toUpperCase();
      const headers = mergeHeaders(inst.defaults.headers, c.headers, method);
      const mergedParams = (inst.defaults.params || c.params)
        ? { ...(inst.defaults.params || {}), ...(c.params || {}) }
        : undefined;
      return request({
        ...inst.defaults,
        ...c,
        method,
        baseURL: c.baseURL !== undefined ? c.baseURL : (inst.defaults.baseURL || ''),
        headers,
        params: mergedParams,
      });
    };
    inst.request = (cfg) => inst(cfg);
    inst.get     = (url, cfg) => inst({ ...(cfg||{}), url, method:'GET' });
    inst.post    = (url, data, cfg) => inst({ ...(cfg||{}), url, method:'POST', data });
    inst.put     = (url, data, cfg) => inst({ ...(cfg||{}), url, method:'PUT', data });
    inst.delete  = (url, cfg) => inst({ ...(cfg||{}), url, method:'DELETE' });
    inst.patch   = (url, data, cfg) => inst({ ...(cfg||{}), url, method:'PATCH', data });
    inst.head    = (url, cfg) => inst({ ...(cfg||{}), url, method:'HEAD' });
    inst.create  = (sub) => ax.create({ ...inst.defaults, ...(sub||{}), headers: mergeHeaders(inst.defaults.headers, sub?.headers, 'get') });
    inst.defaults = { ...ax.defaults, ...def, headers: { ...(ax.defaults.headers || {}), ...(def.headers || {}) } };
    inst.interceptors = { request:{ use:()=>{} }, response:{ use:()=>{} } };
    inst.isAxiosError = ax.isAxiosError;
    inst.CanceledError = ax.CanceledError;
    inst.all = ax.all;
    inst.spread = ax.spread;
    return inst;
  };
  ax.defaults     = { baseURL:'', headers:{ common:{} } };
  ax.interceptors = { request:{ use:()=>{} }, response:{ use:()=>{} } };
  ax.isAxiosError = () => false;
  ax.CanceledError = class CanceledError extends Error {};
  ax.all     = Promise.all.bind(Promise);
  ax.spread  = (fn) => (arr) => fn(...arr);
  return ax;
})();

// ─── Load a provider in a sandboxed vm ───────────────────────────────────────
const SAFE_BUILTIN_MODULES = new Set([
  'assert', 'util', 'util/types', 'stream', 'buffer', 'events', 'zlib',
  'crypto', 'url', 'timers', 'http', 'https', 'http2', 'net', 'tls',
  'querystring', 'string_decoder', 'path', 'diagnostics_channel', 'async_hooks',
]);
const BLOCKED_MODULES = new Set([
  'fs', 'child_process', 'worker_threads', 'vm', 'module', 'os',
  'cluster', 'dgram', 'inspector', 'v8', 'repl', 'dns',
]);
const SANDBOX_PROCESS = Object.freeze({
  env: Object.freeze({}),
  version: process.version,
  versions: Object.freeze({ node: process.versions.node }),
  argv: Object.freeze([]),
  platform: process.platform,
  nextTick: (...a) => process.nextTick(...a),
  exit: () => {},
});

const FETCH_SHIM = Object.assign((...a) => fetch(...a), { default: (...a) => fetch(...a) });

function loadProvider(code, id) {
  const fakeRequire = (mod) => {
    const map = {
      'cheerio-without-node-native': CHEERIO_WRAP,
      'react-native-cheerio':        CHEERIO_WRAP,
      'cheerio':                     CHEERIO_WRAP,
      'crypto-js':                   CRYPTOJS_SHIM,
      'axios':                       AXIOS_SHIM,
      'node-fetch':                  FETCH_SHIM,
      'cross-fetch':                 FETCH_SHIM,
    };
    if (map[mod]) return map[mod];
    const raw = String(mod || '').trim();
    if (!raw) return {};
    if (raw.startsWith('.') || raw.startsWith('/') || raw.startsWith('\\') || /^[a-zA-Z]:/.test(raw)) {
      throw new Error(`Blocked module: ${raw}`);
    }
    const norm = raw.startsWith('node:') ? raw.slice(5) : raw;
    if (BLOCKED_MODULES.has(norm) || BLOCKED_MODULES.has(norm.split('/')[0])) {
      throw new Error(`Blocked module: ${raw}`);
    }
    if (SAFE_BUILTIN_MODULES.has(norm)) {
      return require(norm);
    }
    return {};
  };

  const exports = {};
  const module_ = { exports };

  vm.runInContext(code, vm.createContext({
    require: fakeRequire,
    module:  module_,
    exports,
    console,
    fetch,
    Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Buffer, process: SANDBOX_PROCESS,
    URL, URLSearchParams,
    AbortController, AbortSignal,
    Headers, Request, Response, FormData, Blob,
    TextEncoder, TextDecoder,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    global: {},
  }), { filename: `${id}.js`, timeout: 8000 });

  return module_.exports;
}

// ─── Fetch & deduplicate providers from all repos ─────────────────────────────
async function loadAll() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Loading providers from all repos...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Fetch all manifests in parallel
  const manifests = await Promise.allSettled(
    REPOS.map(repo =>
      fetchManifestJson(repo.manifestUrl, 25000)
        .then(parsed => ({ repo, parsed }))
    )
  );

  // Deduplicate: first repo to claim an ID wins
  const seen      = new Map();  // normalised id → { meta, repo }
  const loadQueue = [];         // { meta, repo, normId }

  for (const result of manifests) {
    if (result.status === 'rejected') {
      console.warn(`  ⚠️  Failed to fetch manifest:`, result.reason?.message);
      continue;
    }
    const { repo, parsed } = result.value;
    if (!parsed) { console.warn(`  ⚠️  Bad JSON from ${repo.name}`); continue; }

    const scrapers = Array.isArray(parsed) ? parsed : (parsed.scrapers || []);
    let added = 0, skipped = 0;

    for (const entry of scrapers) {
      if (!entry.enabled) continue;
      if (isTorrentScraper(entry)) continue;
      if (isNonVodScraper(entry)) continue;
      const normId = (entry.id || '').toLowerCase().trim();
      if (!normId) continue;

      if (seen.has(normId)) {
        skipped++;
      } else {
        seen.set(normId, { meta: entry, repo });
        loadQueue.push({ meta: entry, repo, normId });
        added++;
      }
    }
    console.log(`  📋  ${repo.name}: ${added} unique, ${skipped} duplicate(s) skipped`);
  }

  console.log(`\n  🔄  Loading ${loadQueue.length} unique providers...\n`);

  // Fetch & vm-load via sliding worker pool (concurrency 8)
  const loaded = [];

  await runPool(loadQueue, 8, async ({ meta, repo, normId }) => {
    const fileUrl = (String(meta.filename).startsWith('http://') || String(meta.filename).startsWith('https://')) ? meta.filename : `${repo.base}/${meta.filename}`;
    try {
      const code = await httpGet(fileUrl, {}, 20000);
      const mod  = loadProvider(code, normId);
      if (typeof mod.getStreams !== 'function') {
        console.warn(`  ⚠️  ${meta.name} [${repo.name}]: no getStreams()`);
        return;
      }
      const enInfo = enRepoSlugFromFilename(meta.filename);
      loaded.push({ meta, repo, getStreams: mod.getStreams, _repoId: enInfo.id, _repoIds: new Set([enInfo.id]), _repoKey: enInfo.key });
      console.log(`  ✅  ${meta.name.padEnd(24)} [${repo.name}]`);
    } catch (e) {
      console.error(`  ❌  ${meta.name} [${repo.name}]: ${e.message}`);
    }
  });

  // Add TR Hub as a direct local upstream provider (CS3 + all TR Nuvio repos)
  const trHubImdbCache = new Map();
  loaded.push({
    meta: { id: 'trhub', name: 'TR Hub', supportedTypes: ['movie', 'tv'] },
    repo: { name: 'TR Hub' },
    _repoId: 'tr_trhub',
    _repoIds: new Set(['tr_trhub']),
    getStreams: async (tmdbId, mediaType, season, episode, reqOpts = {}) => {
      try {
        const startAt = Date.now();
        const signal = reqOpts?.signal || null;
        const trTimeout = Number.isFinite(reqOpts?.timeoutMs) && reqOpts.timeoutMs > 0 ? Math.max(10000, reqOpts.timeoutMs) : 34000;
        const rawMs = Number.isFinite(reqOpts?.rawTimeoutMs) && reqOpts.rawTimeoutMs > 0 ? reqOpts.rawTimeoutMs : trTimeout;
        const isOnlyTr = !!reqOpts?.isOnlyTrHub;
        const kind = mediaType === 'tv' || mediaType === 'series' ? 'tv' : 'movie';
        let imdb = /^tt\d+$/i.test(String(tmdbId || ''))
          ? String(tmdbId)
          : (/^tt\d+$/i.test(String(reqOpts?.imdbId || '')) ? String(reqOpts.imdbId) : trHubImdbCache.get(kind + ':' + tmdbId));
        if (!imdb) {
          for (const key of TMDB_KEYS.filter(Boolean)) {
            if (signal && signal.aborted) return [];
            try {
              const txt = await httpGet(`https://api.themoviedb.org/3/${kind}/${encodeURIComponent(tmdbId)}/external_ids?api_key=${key}`, {}, 8000, 1, { signal });
              const j = safeJson(txt);
              if (j && j.imdb_id) { imdb = String(j.imdb_id); trHubImdbCache.set(kind + ":" + tmdbId, imdb); capMap(trHubImdbCache, 500); break; }
            } catch {}
          }
        }
        if (!imdb || (signal && signal.aborted)) return [];
        const stType = kind === 'tv' ? 'series' : 'movie';
        const stId = stType === 'series' ? `${imdb}:${season || 1}:${episode || 1}` : imdb;
        const remMs = Math.max(4000, trTimeout - (Date.now() - startAt));
        const softWait = isOnlyTr
          ? Math.min(Math.max(rawMs, 13000), Math.max(6000, remMs - 6000))
          : Math.max(4000, Math.min(remMs - 2500, 12000));
        const hardWait = Math.max(softWait, Math.min(remMs - 3000, softWait + 7000));
        const reqTimeout = Math.max(4000, remMs - 500);
        const txt = await httpGet(`${HUB_URL}/g/tr/stream/${stType}/${encodeURIComponent(stId)}.json?wait=${Math.round(softWait)}&hard=${Math.round(hardWait)}`, {}, reqTimeout, 0, { signal });
        const j = safeJson(txt);
        return ((j && j.streams) || []).map((s) => {
          if (!s || !s.url) return null;
          let u = String(s.url);
          const headers = {};
          try {
            const pu = new URL(u);
            if ((pu.hostname === '127.0.0.1' || pu.hostname === 'localhost' || pu.hostname === HUB_PARSED.host) && pu.pathname === '/px' && pu.searchParams.get('u')) {
              u = pu.searchParams.get('u');
              if (pu.searchParams.get('r')) headers.Referer = pu.searchParams.get('r');
              if (pu.searchParams.get('o')) headers.Origin = pu.searchParams.get('o');
            }
          } catch {}
          const title = String(s.title || '').replace(/\r?\n/g, ' · ');
          return { name: s.name || 'TR Hub', title, url: u, headers, _fromTrHub: true };
        }).filter(Boolean);
      } catch (e) {
        console.error('[TR Hub] getStreams failed:', e && e.message ? e.message : e);
        return [];
      }
    },
  });

  console.log(`\n  🎬  ${loaded.length} providers ready\n`);

  // Build Stremio manifest
  const types = [...new Set(
    loaded.flatMap(p => (p.meta.supportedTypes || ['movie','tv'])
      .map(t => t === 'tv' || t === 'anime' ? 'series' : t)
      .filter(t => ['movie','series'].includes(t))
    )
  )];

  const meta = {
    id          : 'community.nuvio.mega.bridge',
    version     : '1.0.0',
    name        : 'Nuvio Mega Bridge',
    description : `${loaded.length} providers from TR Hub + EN Hub`,
    logo        : 'https://raw.githubusercontent.com/yoruix/nuvio-providers/main/Assets/Logo-2.png',
    resources   : ['stream'],
    types       : types.length ? types : ['movie','series'],
    idPrefixes  : ['tt','tmdb:'],
    catalogs    : [],
    behaviorHints: { configurable:false, configurationRequired:false },
  };

  return { loaded, meta };
}

// ─── Cache management ─────────────────────────────────────────────────────────
async function ensureProviders() {
  if (providers && (Date.now() - lastLoad) < CACHE_TTL_MS) return;
  if (loadPromise) return loadPromise;

  loadPromise = loadAll()
    .then(({ loaded, meta }) => {
      providers   = loaded;
      stremioMeta = meta;
      lastLoad    = loaded.length > 5 ? Date.now() : (Date.now() - CACHE_TTL_MS + 30000);
      loadPromise = null;
    })
    .catch((e) => {
      console.error('Fatal load error:', e.message);
      if (!providers) providers = [];
      loadPromise = null;
    });

  return loadPromise;
}

// ─── Parse Stremio ID ─────────────────────────────────────────────────────────
// ─── Multi-language lazy loader & config parser ─────────────────────────────
const langProviderCache = new Map();
const langLoadPromises = new Map();
const ALL_QUALS = ["2160p", "1440p", "1080p", "720p", "480p"];
const ALL_QUALS_SET = new Set(ALL_QUALS);
const DEFAULT_QUALS = ["2160p", "1440p", "1080p", "720p"];
function normalizeQualToken(q) {
  const s = String(q || "").trim().toLowerCase();
  if (s === "4k" || s === "2160p" || s === "uhd") return "2160p";
  if (s === "2k" || s === "1440p" || s === "qhd") return "1440p";
  if (s === "1080p" || s === "fhd") return "1080p";
  if (s === "720p" || s === "hd") return "720p";
  if (s === "480p" || s === "sd") return "480p";
  return null;
}
function isQualAllowed(res, cfg) {
  const allowed = (cfg && cfg.qualSet && cfg.qualSet.size) ? cfg.qualSet : ((cfg && cfg.quals && cfg.quals.length) ? new Set(cfg.quals) : ALL_QUALS_SET);
  if (!res) return false;
  if (!ALLOWED_RES.has(res)) return false;
  if (res === "576p") return allowed.has("480p") || allowed.has("720p");
  return allowed.has(res);
}
function parseConfig(raw) {
  const defMap = { "2160p": 1, "1440p": 1, "1080p": 1, "720p": 1, "480p": 1 };
  const def = {
    langs: ["tr", "en"],
    quals: DEFAULT_QUALS.slice(),
    qualSet: new Set(DEFAULT_QUALS),
    mode: "direct",
    mega: false,
    no4k: false,
    qlimMode: "all",
    qlimAll: 1,
    qlimMap: { ...defMap },
    hubLim: 0,
    streamSort: "qual:desc,bitrate:desc,speed:asc,dub:desc",
    sortRules: [{ k: "qual", d: "desc" }, { k: "bitrate", d: "desc" }, { k: "speed", d: "asc" }, { k: "dub", d: "desc" }],
    hubSort: "custom",
    megaPos: "top",
    hubSeq: false,
    failover: false,
    failoverSec: 15,
    timeoutSec: 45,
    disabledRepos: [],
    disabledProvs: [],
    raw: "",
  };
  if (!raw) return def;
  let dec = raw; try { dec = decodeURIComponent(raw); } catch {}
  const p = new URLSearchParams(dec);
  const langsRaw = (p.get("langs") || "").split(",").map(s => s.trim().toLowerCase()).filter(c => c && LANG_CATALOG[c]);
  const langs = langsRaw.length ? [...new Set(langsRaw)] : ["tr", "en"];
  const mode = "direct";
  const mega = false;
  const no4kParam = p.get("no4k") === "1" || p.get("no4k") === "true";
  let quals = DEFAULT_QUALS.slice();
  if (p.has("quals")) {
    const qRaw = (p.get("quals") || "").split(",").map(normalizeQualToken).filter(Boolean);
    const qSet = new Set(qRaw);
    const ordered = ALL_QUALS.filter(q => qSet.has(q));
    if (ordered.length) quals = ordered;
  } else if (no4kParam) {
    quals = DEFAULT_QUALS.filter(q => q !== "2160p");
  }
  const no4k = !quals.includes("2160p");
  const clampInt = (v, min, max, fb) => {
    if (v === null || v === undefined || String(v).trim() === "") return fb;
    const n = parseInt(String(v), 10);
    if (!Number.isFinite(n)) return fb;
    return Math.max(min, Math.min(max, n));
  };
  const qlimMode = p.get("qlm") === "per" ? "per" : "all";
  const qlimAll = clampInt(p.get("qlim"), 0, 50, 1);
  const qlimMap = { ...defMap };
  if (p.has("qmap")) {
    for (const part of String(p.get("qmap") || "").split(",")) {
      const [kRaw, vRaw] = part.split(":");
      const k = normalizeQualToken(kRaw);
      if (k) qlimMap[k] = clampInt(vRaw, 0, 50, qlimMap[k]);
    }
  }
  const hubLim = clampInt(p.get("hublim"), 0, 200, 0);
  const ssortRaw = String(p.get("ssort") || "").trim().toLowerCase();
  const sortRules = parseSortRules(ssortRaw);
  const streamSort = sortRules.map(r => r.k + ":" + r.d).join(",");
  const VALID_HSORT = new Set(["custom", "catalog", "code_asc", "code_desc", "name_asc", "name_desc"]);
  const hsortRaw = String(p.get("hsort") || "").trim().toLowerCase();
  const hubSort = VALID_HSORT.has(hsortRaw) ? hsortRaw : "custom";
  const megaPos = p.get("mpos") === "bottom" ? "bottom" : "top";
  const hubSeq = p.get("hseq") === "1" || p.get("hseq") === "true";
  const failover = p.get("fb") === "1" || p.get("fb") === "true";
  const failoverSec = clampInt(p.get("fbto"), 5, 45, 15);
  const timeoutSec = clampInt(p.get("to"), 10, 90, 45);
  const disabledRepos = [...new Set((p.get("off") || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean))];
  const disabledProvs = [...new Set((p.get("offp") || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean))];
  const qualSet = new Set(quals);
  return { langs, quals, qualSet, mode, mega, no4k, qlimMode, qlimAll, qlimMap, hubLim, streamSort, sortRules, hubSort, megaPos, hubSeq, failover, failoverSec, timeoutSec, disabledRepos, disabledProvs, raw: dec };
}
function langKey(langs) { return [...new Set((langs && langs.length ? langs : ["tr", "en"]).map(s => s.toLowerCase()))].sort().join(","); }
async function loadLangProviders(code) {
  const def = LANG_CATALOG[code];
  if (!def || def.kind !== "nuvio" || !Array.isArray(def.repos)) return [];
  const hit = langProviderCache.get(code);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.list;
  if (langLoadPromises.has(code)) return langLoadPromises.get(code);
  const prom = (async () => {
    const manifests = await Promise.allSettled(def.repos.map(r => fetchManifestJson(r.url, 15000).then(parsed => ({ repo: r, parsed }))));
    const seen = new Set();
    const queue = [];
    for (const res of manifests) {
      if (res.status !== "fulfilled" || !res.value.parsed) continue;
      const { repo, parsed } = res.value;
      const list = Array.isArray(parsed) ? parsed : (parsed.scrapers || []);
      for (const entry of list) {
        if (!entry || entry.enabled === false || !entry.filename) continue;
        if (isTorrentScraper(entry)) continue;
        if (isNonVodScraper(entry)) continue;
        if (!scraperMatchesLang(entry, code)) continue;
        const normId = String(entry.id || entry.name || "").toLowerCase().trim();
        if (!normId || seen.has(normId)) continue;
        seen.add(normId);
        queue.push({ meta: entry, repo, normId });
      }
    }
    const loaded = [];
    await runPool(queue, 8, async ({ meta, repo, normId }) => {
      try {
        const fileUrl = /^https?:\/\//i.test(String(meta.filename)) ? String(meta.filename) : new URL(meta.filename, repo.url).toString();
        const codeStr = await httpGet(fileUrl, {}, 15000);
        const mod = loadProvider(codeStr, code + "_" + normId);
        const rid = code + "_" + slugRepo(repo.name);
        if (typeof mod.getStreams === "function") loaded.push({ meta, repo, getStreams: mod.getStreams, _langCode: code, _repoId: rid, _repoIds: new Set([rid]) });
      } catch {}
    });
    langProviderCache.set(code, { t: Date.now(), list: loaded });
    console.log("  [" + code.toUpperCase() + "] loaded " + loaded.length + " providers (no torrents)");
    return loaded;
  })().finally(() => langLoadPromises.delete(code));
  langLoadPromises.set(code, prom);
  return prom;
}
async function getProvidersForLangs(langs) {
  await ensureProviders();
  const want = new Set((langs && langs.length ? langs : ["tr", "en"]).map(s => s.toLowerCase()));
  const out = [];
  const seenById = new Map();
  const addP = (p) => {
    const k = String(p?.meta?.id || p?.meta?.name || "").toLowerCase();
    const rids = new Set();
    if (p._repoId) rids.add(p._repoId);
    if (p._repoIds) for (const r of p._repoIds) rids.add(r);
    if (k && seenById.has(k)) {
      const existing = seenById.get(k);
      if (!existing._repoIds) existing._repoIds = new Set(existing._repoId ? [existing._repoId] : []);
      for (const r of rids) existing._repoIds.add(r);
      return;
    }
    const wrapped = { ...p, _repoIds: rids };
    if (k) seenById.set(k, wrapped);
    out.push(wrapped);
  };
  for (const p of (providers || [])) {
    if (p.meta?.id === "trhub") { if (want.has("tr")) addP(p); }
    else if ((want.has("en") || want.has("en_us") || want.has("en_uk")) && scraperMatchesLang(p.meta, "en")) addP(p);
    else if (want.has("fa") && /persian/i.test(String(p.meta?.name || ""))) addP(p);
    else if (want.has("th") && /kisskh/i.test(String(p.meta?.name || ""))) addP(p);
    else {
      for (const c of want) {
        if (c === "tr" || c === "en" || c === "en_us" || c === "en_uk") continue;
        if (scraperMatchesLangStrict(p.meta, c)) { addP(p); break; }
      }
    }
  }
  const extraCodes = [...want].filter(c => LANG_CATALOG[c] && LANG_CATALOG[c].kind === "nuvio");
  if (extraCodes.length) {
    const extraLists = await Promise.all(extraCodes.map(loadLangProviders));
    for (const list of extraLists) for (const p of list) addP(p);
  }
  return out;
}
function manifestForConfig(cfg) {
  const ls = (cfg.langs || ["tr", "en"]).map(s => s.toUpperCase());
  const slug = cfg.langs.slice().sort().join("_");
  const modeLabel = cfg.mode === "direct" ? "Direct" : "Mega";
  const shortName = ls.length === 1 ? (modeLabel + " \u00b7 " + ls[0]) : ls.length <= 3 ? ("Nuvio " + modeLabel + " \u00b7 " + ls.join("+")) : ("Nuvio " + modeLabel + " \u00b7 " + ls.length + " Dil");
  return {
    ...(stremioMeta || { version: "2.0.0", resources: ["stream"], types: ["movie", "series"], idPrefixes: ["tt", "tmdb:"], catalogs: [] }),
    id: "community.nuvio.mega." + slug + (cfg.mode === "direct" ? ".direct" : ""),
    name: shortName,
    description: "Secili diller: " + ls.join(", ") + " · Dogrudan akis (torrent yok)",
    behaviorHints: { configurable: true, configurationRequired: false },
  };
}
function orderHubLangs(cfg) {
  const langs = (cfg.langs || ["tr", "en"]).slice();
  const catalogOrder = Object.keys(LANG_CATALOG);
  const sortMode = cfg.hubSort || "custom";
  if (sortMode === "catalog") {
    langs.sort((a, b) => catalogOrder.indexOf(a) - catalogOrder.indexOf(b));
  } else if (sortMode === "code_asc") {
    langs.sort((a, b) => a.localeCompare(b));
  } else if (sortMode === "code_desc") {
    langs.sort((a, b) => b.localeCompare(a));
  } else if (sortMode === "name_asc") {
    langs.sort((a, b) => (LANG_CATALOG[a]?.name || a).localeCompare(LANG_CATALOG[b]?.name || b, "tr"));
  } else if (sortMode === "name_desc") {
    langs.sort((a, b) => (LANG_CATALOG[b]?.name || b).localeCompare(LANG_CATALOG[a]?.name || a, "tr"));
  }
  return langs;
}
function qualBucket(res) {
  if (res === "2160p" || res === "1440p" || res === "1080p" || res === "720p" || res === "480p") return res;
  if (res === "576p") return "480p";
  return "other";
}
function limitForBucket(bucket, cfg) {
  if (cfg && cfg.qlimMode === "per") {
    const map = cfg.qlimMap || {};
    if (bucket === "other") return Number.isInteger(map["480p"]) ? map["480p"] : (cfg.qlimAll ?? 1);
    return Number.isInteger(map[bucket]) ? map[bucket] : (cfg.qlimAll ?? 1);
  }
  return Number.isInteger(cfg?.qlimAll) ? cfg.qlimAll : 1;
}
function extractProviderName(s) {
  const n = String(s?.name || "").replace(/[\u200B\u200C]/g, "");
  const parts = n.split("·").map(x => x.trim()).filter(Boolean);
  return (parts[parts.length - 1] || n).toLowerCase();
}
function streamAudioRank(name, preferSub) {
  const n = String(name || "");
  const isSub = /\bSub\b|Altyaz/i.test(n);
  const isDub = /\bDub\b|Dublaj/i.test(n);
  if (preferSub) return isSub ? 0 : (isDub ? 2 : 1);
  return isDub ? 0 : (isSub ? 2 : 1);
}
const SORT_PRESETS = {
  dub_qual: [{ k: "dub", d: "desc" }, { k: "qual", d: "desc" }, { k: "bitrate", d: "desc" }, { k: "speed", d: "asc" }],
  qual_desc: [{ k: "qual", d: "desc" }, { k: "bitrate", d: "desc" }, { k: "speed", d: "asc" }, { k: "dub", d: "desc" }],
  qual_asc: [{ k: "qual", d: "asc" }, { k: "speed", d: "asc" }, { k: "bitrate", d: "desc" }, { k: "dub", d: "desc" }],
  sub_qual: [{ k: "dub", d: "asc" }, { k: "qual", d: "desc" }, { k: "bitrate", d: "desc" }, { k: "speed", d: "asc" }],
  speed_asc: [{ k: "speed", d: "asc" }, { k: "qual", d: "desc" }, { k: "bitrate", d: "desc" }, { k: "dub", d: "desc" }],
  bitrate_desc: [{ k: "qual", d: "desc" }, { k: "bitrate", d: "desc" }, { k: "speed", d: "asc" }, { k: "dub", d: "desc" }],
  provider_asc: [{ k: "prov", d: "asc" }, { k: "qual", d: "desc" }, { k: "speed", d: "asc" }],
  provider_desc: [{ k: "prov", d: "desc" }, { k: "qual", d: "desc" }, { k: "speed", d: "asc" }],
};
const VALID_SORT_KEYS = new Set(["dub", "qual", "bitrate", "speed", "prov"]);
function parseSortRules(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return SORT_PRESETS.qual_desc.map(x => ({ ...x }));
  if (SORT_PRESETS[s]) return SORT_PRESETS[s].map(x => ({ ...x }));
  const out = [];
  const seen = new Set();
  for (const part of s.split(",")) {
    const [kRaw, dRaw] = part.trim().split(":");
    const k = (kRaw || "").trim();
    if (!VALID_SORT_KEYS.has(k) || seen.has(k)) continue;
    seen.add(k);
    const d = dRaw === "asc" ? "asc" : "desc";
    out.push({ k, d });
  }
  return out.length ? out : SORT_PRESETS.qual_desc.map(x => ({ ...x }));
}
function compareByMetric(vA, vB, desc) {
  const aOk = Number.isFinite(vA) && vA > 0;
  const bOk = Number.isFinite(vB) && vB > 0;
  if (aOk && bOk) return desc ? (vB - vA) : (vA - vB);
  if (aOk !== bOk) return aOk ? -1 : 1;
  return 0;
}
function compareStreamsForCfg(a, b, cfg) {
  const rules = (cfg && Array.isArray(cfg.sortRules) && cfg.sortRules.length) ? cfg.sortRules : parseSortRules(cfg?.streamSort);
  const rA = a._realRes || detectResolution(a.name) || detectResolution(a.title);
  const rB = b._realRes || detectResolution(b.name) || detectResolution(b.title);
  const rankA = RES_RANK[rA] ?? 9;
  const rankB = RES_RANK[rB] ?? 9;
  const pA = extractProviderName(a);
  const pB = extractProviderName(b);
  for (const rule of rules) {
    let diff = 0;
    if (rule.k === "dub") diff = streamAudioRank(a.name, rule.d === "asc") - streamAudioRank(b.name, rule.d === "asc");
    else if (rule.k === "qual") {
      if (rule.d === "asc") {
        const qA = RES_RANK[rA] !== undefined ? (5 - RES_RANK[rA]) : 9;
        const qB = RES_RANK[rB] !== undefined ? (5 - RES_RANK[rB]) : 9;
        diff = qA - qB;
      } else diff = rankA - rankB;
    } else if (rule.k === "bitrate") diff = compareByMetric(a._kbps, b._kbps, rule.d === "desc");
    else if (rule.k === "speed") diff = compareByMetric(a._latencyMs, b._latencyMs, rule.d === "desc");
    else if (rule.k === "prov") diff = rule.d === "desc" ? pB.localeCompare(pA) : pA.localeCompare(pB);
    if (diff !== 0) return diff;
  }
  return (rankA - rankB) || compareByMetric(a._kbps, b._kbps, true) || compareByMetric(a._latencyMs, b._latencyMs, false) || pA.localeCompare(pB);
}
function sortStreamsForCfg(list, cfg) {
  if (!Array.isArray(list) || list.length <= 1) return list;
  const rules = (cfg && Array.isArray(cfg.sortRules) && cfg.sortRules.length) ? cfg.sortRules : parseSortRules(cfg?.streamSort);
  const decorated = list.map(s => {
    const r = s._realRes || detectResolution(s.name) || detectResolution(s.title);
    const rank = RES_RANK[r] ?? 9;
    return {
      s,
      rank,
      rankAsc: RES_RANK[r] !== undefined ? (5 - RES_RANK[r]) : 9,
      dubDesc: streamAudioRank(s.name, false),
      dubAsc: streamAudioRank(s.name, true),
      prov: extractProviderName(s),
      kbps: s._kbps,
      latencyMs: s._latencyMs,
    };
  });
  decorated.sort((a, b) => {
    for (const rule of rules) {
      let diff = 0;
      if (rule.k === "dub") diff = rule.d === "asc" ? (a.dubAsc - b.dubAsc) : (a.dubDesc - b.dubDesc);
      else if (rule.k === "qual") diff = rule.d === "asc" ? (a.rankAsc - b.rankAsc) : (a.rank - b.rank);
      else if (rule.k === "bitrate") diff = compareByMetric(a.kbps, b.kbps, rule.d === "desc");
      else if (rule.k === "speed") diff = compareByMetric(a.latencyMs, b.latencyMs, rule.d === "desc");
      else if (rule.k === "prov") diff = rule.d === "desc" ? b.prov.localeCompare(a.prov) : a.prov.localeCompare(b.prov);
      if (diff !== 0) return diff;
    }
    return (a.rank - b.rank) || compareByMetric(a.kbps, b.kbps, true) || compareByMetric(a.latencyMs, b.latencyMs, false) || a.prov.localeCompare(b.prov);
  });
  for (let i = 0; i < decorated.length; i++) list[i] = decorated[i].s;
  return list;
}
const streamMetricsInflight = new Map();
const videoInfoInflight = new Map();
const streamMetricsCache = new Map();
const videoInfoCache = new Map();
const crossHubAudioCache = new Map();
const BLACKLIST_FILE = path.join(DATA_DIR, "blacklist.json");
const playPlans = new Map();
let blacklistMem = null;
const VOLATILE_URL_PARAMS = new Set(["token", "exp", "expires", "sig", "signature", "hash", "t", "auth"]);
function normalizeMediaKey(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "*") return "*";
  const m = /^(movie|series|tv)([|:])(.+)$/i.exec(s);
  if (!m) return s;
  const kind = m[1].toLowerCase() === "tv" ? "series" : m[1].toLowerCase();
  const rest = m[3].trim();
  if (!rest) return "*";
  if (/^(?:tmdb:|tt\d+)/i.test(rest)) return kind + "|" + rest;
  if (/^\d+(?::\d+)*$/.test(rest)) return kind + "|tmdb:" + rest;
  return kind + "|" + rest;
}
function normalizeBlacklistUrl(u) {
  const raw = String(u || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    for (const k of [...parsed.searchParams.keys()]) {
      if (VOLATILE_URL_PARAMS.has(k.toLowerCase())) parsed.searchParams.delete(k);
    }
    parsed.searchParams.sort();
    return parsed.href;
  } catch {
    return raw;
  }
}
function loadBlacklist() {
  if (blacklistMem !== null) return blacklistMem;
  try {
    if (!fs.existsSync(BLACKLIST_FILE)) { blacklistMem = []; return blacklistMem; }
    const d = safeJson(fs.readFileSync(BLACKLIST_FILE, "utf8"));
    blacklistMem = Array.isArray(d?.items) ? d.items : [];
    return blacklistMem;
  } catch { blacklistMem = []; return blacklistMem; }
}
function saveBlacklist(items) {
  const arr = Array.isArray(items) ? items.slice(0, 500) : [];
  writeJsonAtomic(BLACKLIST_FILE, JSON.stringify({ items: arr, updatedAt: Date.now() }, null, 2));
  blacklistMem = arr;
  return arr;
}
function streamProviderName(s) {
  const parts = String(s?.name || "").split(/\s*[\u00b7\u2022]\s*/).map(x => x.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}
function isBlacklisted(mediaKey, s) {
  if (!s) return false;
  const items = loadBlacklist();
  if (!items.length) return false;
  const mk = normalizeMediaKey(mediaKey);
  const u = String(s.url || "").trim();
  const uNorm = normalizeBlacklistUrl(u);
  const prov = streamProviderName(s).toLowerCase();
  for (const it of items) {
    const itMk = normalizeMediaKey(it.mediaKey);
    if (itMk !== "*" && itMk !== mk) continue;
    if (it.url) {
      if (u && (it.url === u || (uNorm && normalizeBlacklistUrl(it.url) === uNorm))) return true;
    } else if (it.provider && prov && it.provider.toLowerCase() === prov) {
      return true;
    }
  }
  return false;
}
function addBlacklistEntry({ mediaKey, mediaLabel, provider, url, reason }) {
  const mk = normalizeMediaKey(mediaKey || "*");
  const pv = String(provider || "").trim();
  const u = String(url || "").trim();
  if (!pv && !u) return loadBlacklist();
  const uNorm = normalizeBlacklistUrl(u);
  const items = loadBlacklist().slice();
  const exists = items.some(it => normalizeMediaKey(it.mediaKey) === mk && (
    u
      ? (it.url && (it.url === u || (uNorm && normalizeBlacklistUrl(it.url) === uNorm)))
      : (!it.url && pv && it.provider && it.provider.toLowerCase() === pv.toLowerCase())
  ));
  if (exists) return items;
  const entry = { id: "bl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6), mediaKey: mk, mediaLabel: String(mediaLabel || mk), provider: pv, url: u, reason: reason || "manual", createdAt: Date.now() };
  items.unshift(entry);
  return saveBlacklist(items);
}
function removeBlacklistEntry(id) {
  return saveBlacklist(loadBlacklist().filter(it => it.id !== id));
}
function clearBlacklist() { return saveBlacklist([]); }
async function verifyStreamReady(cand, timeoutMs) {
  const deadline = Date.now() + Math.max(3000, timeoutMs || 15000);
  const rem = () => {
    const left = deadline - Date.now();
    if (left <= 100) { const e = new Error("failover timeout"); e.name = "TimeoutError"; throw e; }
    return left;
  };
  const headers = ensureBrowserHeaders(cand.headers);
  const isHls = !!cand.isHls || isLikelyHlsUrl(cand.url);
  const verifyHlsText = async (t1, baseUrl) => {
    let mediaTxt = t1, mediaBase = baseUrl;
    if (!/#EXTINF:/i.test(t1)) {
      const lines = t1.split(/\r?\n/).map(x => x.trim());
      let bestUri = "", bestBw = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^#EXT-X-STREAM-INF:/i.test(lines[i])) {
          const bm = lines[i].match(/BANDWIDTH=(\d+)/i);
          const bw = bm ? parseInt(bm[1], 10) : 0;
          const nxt = lines.slice(i + 1).find(x => x && !x.startsWith("#"));
          if (nxt && bw >= bestBw) { bestBw = bw; bestUri = nxt; }
        }
      }
      const subLine = bestUri || lines.find(x => x && !x.startsWith("#"));
      if (!subLine) return { ok: false, reason: "empty_master" };
      mediaBase = new URL(subLine, mediaBase).href;
      const r2 = await fetch(mediaBase, { headers, signal: AbortSignal.timeout(rem()) });
      if (!r2.ok) return { ok: false, reason: "sub_http_" + r2.status };
      mediaBase = r2.url || mediaBase;
      mediaTxt = (await r2.text()).replace(/^\uFEFF/, "");
      if (!/^#EXTM3U/i.test(mediaTxt.trim())) return { ok: false, reason: "sub_not_m3u8" };
    }
    const segLine = mediaTxt.split(/\r?\n/).map(x => x.trim()).find(x => x && !x.startsWith("#"));
    if (!segLine) return { ok: false, reason: "no_segments" };
    const segUrl = new URL(segLine, mediaBase).href;
    const r3 = await fetch(segUrl, { headers, signal: AbortSignal.timeout(rem()) });
    if (!r3.ok) { try { await r3.body?.cancel(); } catch {} return { ok: false, reason: "seg_http_" + r3.status }; }
    const ct3 = String(r3.headers.get("content-type") || "").toLowerCase();
    const reader = r3.body?.getReader();
    let got = 0;
    let firstChunk = null;
    if (reader) {
      while (true) {
        rem();
        const ch = await reader.read();
        if (ch.done) break;
        if (ch.value && ch.value.length) {
          if (!firstChunk) firstChunk = Buffer.from(ch.value.subarray(0, 256));
          got += ch.value.length;
        }
        if (got >= 131072) { try { await reader.cancel(); } catch {} break; }
      }
    }
    if (ct3.includes("text/html") || looksLikeHtmlBuf(firstChunk)) return { ok: false, reason: "seg_html" };
    if (got < 8192) return { ok: false, reason: "empty_seg" };
    return { ok: true, isHls: true };
  };
  try {
    if (isHls) {
      const r1 = await fetch(cand.url, { headers, signal: AbortSignal.timeout(rem()) });
      if (!r1.ok) return { ok: false, reason: "http_" + r1.status };
      const t1 = (await r1.text()).replace(/^\uFEFF/, "");
      if (!/^#EXTM3U/i.test(t1.trim())) return { ok: false, reason: "not_m3u8" };
      return await verifyHlsText(t1, r1.url || cand.url);
    } else {
      let r = await fetch(cand.url, { headers: { ...headers, Range: "bytes=0-131071" }, signal: AbortSignal.timeout(rem()) });
      if (!r.ok && r.status !== 206 && (r.status === 400 || r.status === 403 || r.status === 405 || r.status === 416 || r.status === 501)) {
        try { await r.body?.cancel(); } catch {}
        r = await fetch(cand.url, { headers, signal: AbortSignal.timeout(rem()) });
      }
      if (!r.ok && r.status !== 206) { try { await r.body?.cancel(); } catch {} return { ok: false, reason: "http_" + r.status }; }
      const ct = String(r.headers.get("content-type") || "").toLowerCase();
      const reader = r.body?.getReader();
      let got = 0;
      const sampleChunks = [];
      let sampleLen = 0;
      if (reader) {
        while (true) {
          rem();
          const ch = await reader.read();
          if (ch.done) break;
          if (ch.value && ch.value.length) {
            got += ch.value.length;
            if (sampleLen < 65536) {
              const take = Buffer.from(ch.value.subarray(0, 65536 - sampleLen));
              sampleChunks.push(take);
              sampleLen += take.length;
            }
          }
          if (got >= 131072) { try { await reader.cancel(); } catch {} break; }
        }
      }
      const sampleBuf = sampleChunks.length ? Buffer.concat(sampleChunks) : Buffer.alloc(0);
      const sampleHead = sampleBuf.subarray(0, 64).toString("utf8").replace(/^\uFEFF/, "").trimStart();
      if (sampleHead.startsWith("#EXTM3U")) {
        return await verifyHlsText(sampleBuf.toString("utf8").replace(/^\uFEFF/, ""), r.url || cand.url);
      }
      if (ct.includes("text/html") || looksLikeHtmlBuf(sampleBuf)) return { ok: false, reason: "html_response" };
      if (got < 16384) return { ok: false, reason: "empty_body" };
      return { ok: true, isHls: false };
    }
  } catch (e) {
    const isTo = e?.name === "TimeoutError" || e?.name === "AbortError" || /timeout|aborted/i.test(String(e?.message || ""));
    return { ok: false, reason: isTo ? "auto_timeout" : "auto_error", timedOut: isTo };
  }
}
const AUDIO_LANG_MAP = {
  tr: "tr", tur: "tr", turkish: "tr", turkce: "tr", "türkçe": "tr",
  en: "en", eng: "en", english: "en", ingilizce: "en", en_us: "en", en_uk: "en",
  de: "de", ger: "de", deu: "de", german: "de", deutsch: "de", almanca: "de",
  fr: "fr", fre: "fr", fra: "fr", french: "fr", francais: "fr", "français": "fr", fransizca: "fr", fr_ca: "fr",
  es: "es", spa: "es", spanish: "es", espanol: "es", "español": "es", latino: "es", latam: "es", castellano: "es", es_es: "es", es_la: "es",
  it: "it", ita: "it", italian: "it", italiano: "it",
  ru: "ru", rus: "ru", russian: "ru",
  ar: "ar", ara: "ar", arabic: "ar",
  hi: "hi", hin: "hi", hindi: "hi",
  ja: "ja", jpn: "ja", jap: "ja", japanese: "ja",
  ko: "ko", kor: "ko", korean: "ko",
  pt: "pt", por: "pt", portuguese: "pt", portugues: "pt", "português": "pt", dublado: "pt", pt_br: "pt",
  pl: "pl", pol: "pl", polish: "pl", polski: "pl", lektor: "pl",
  uk: "uk", ukr: "uk", ukrainian: "uk",
  fa: "fa", per: "fa", fas: "fa", persian: "fa", farsi: "fa",
  hu: "hu", hun: "hu", hungarian: "hu", magyar: "hu",
  vi: "vi", vie: "vi", vietnamese: "vi",
  zh: "zh", chi: "zh", zho: "zh", chs: "zh", cht: "zh", chinese: "zh", mandarin: "zh", zh_cn: "zh", zh_tw: "zh",
  yue: "yue", cantonese: "yue",
  ta: "ta", tam: "ta", tamil: "ta",
  te: "te", tel: "te", telugu: "te",
  ml: "ml", mal: "ml", malayalam: "ml",
  kn: "kn", kan: "kn", kannada: "kn",
  bn: "bn", ben: "bn", bengali: "bn", bangla: "bn",
  mr: "mr", mar: "mr", marathi: "mr",
  gu: "gu", guj: "gu", gujarati: "gu",
  pa: "pa", pan: "pa", punjabi: "pa",
  ur: "ur", urd: "ur", urdu: "ur",
  th: "th", tha: "th", thai: "th",
  cs: "cs", cze: "cs", ces: "cs", czech: "cs",
  ro: "ro", ron: "ro", rum: "ro", romanian: "ro", romana: "ro",
  nl: "nl", dut: "nl", nld: "nl", dutch: "nl", nederlands: "nl",
  sv: "sv", swe: "sv", swedish: "sv", svenska: "sv",
  no: "no", nor: "no", nob: "no", nno: "no", norwegian: "no", norsk: "no",
  da: "da", dan: "da", danish: "da", dansk: "da",
  fi: "fi", fin: "fi", finnish: "fi", suomi: "fi",
  el: "el", gre: "el", ell: "el", greek: "el",
  id: "id", ind: "id", indonesian: "id",
  ms: "ms", may: "ms", msa: "ms", malay: "ms",
  tl: "tl", tgl: "tl", fil: "tl", filipino: "tl", tagalog: "tl",
};
function normalizeAudioLangCode(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s || s === "und" || s === "unk" || s === "zxx" || s === "mul") return null;
  const base = s.split(/[-_\s/(),]+/)[0];
  if (AUDIO_LANG_MAP[base]) return AUDIO_LANG_MAP[base];
  for (const tok of s.split(/[^a-zÀ-ɏ]+/)) {
    if (tok && AUDIO_LANG_MAP[tok]) return AUDIO_LANG_MAP[tok];
  }
  return null;
}
function masterPlaylistAudioLangs(txt) {
  const out = new Set();
  for (const line of String(txt || "").split(/\r?\n/)) {
    if (!line.startsWith("#EXT-X-MEDIA:") || !/TYPE=AUDIO/i.test(line)) continue;
    const lm = /LANGUAGE="([^"]+)"/i.exec(line);
    const nm = /NAME="([^"]+)"/i.exec(line);
    const c = normalizeAudioLangCode(lm && lm[1]) || normalizeAudioLangCode(nm && nm[1]);
    if (c) out.add(c);
  }
  return [...out];
}
function masterPlaylistSubLangs(txt) {
  const out = new Set();
  for (const line of String(txt || "").split(/\r?\n/)) {
    if (!line.startsWith("#EXT-X-MEDIA:") || !/TYPE=SUBTITLES/i.test(line)) continue;
    const lm = /LANGUAGE="([^"]+)"/i.exec(line);
    const nm = /NAME="([^"]+)"/i.exec(line);
    const c = normalizeAudioLangCode(lm && lm[1]) || normalizeAudioLangCode(nm && nm[1]);
    if (c) out.add(c);
  }
  return [...out];
}
function recordCrossHubAudio(mediaKey, stream, audioLangs) {
  if (!mediaKey || !stream?.url || !Array.isArray(audioLangs) || !audioLangs.length) return;
  const now = Date.now();
  let entry = crossHubAudioCache.get(mediaKey);
  if (!entry || now - entry.t > 600000) { entry = { t: now, byLang: new Map() }; crossHubAudioCache.set(mediaKey, entry); capMap(crossHubAudioCache, 100); }
  entry.t = now;
  for (const lc of audioLangs) {
    if (!entry.byLang.has(lc)) entry.byLang.set(lc, new Map());
    entry.byLang.get(lc).set(String(stream.url).trim(), { ...stream, _audioLangs: audioLangs.slice() });
  }
}
let _codeToEnMap = null;
function getCodeToEnMap() {
  if (!_codeToEnMap) {
    _codeToEnMap = Object.assign({ tr: "Turkish" }, Object.fromEntries(LANGS.map(l => [l[2], l[0]])));
  }
  return _codeToEnMap;
}
function getCrossHubAudioStreams(mediaKey, targetLang) {
  if (!mediaKey || !targetLang) return [];
  const entry = crossHubAudioCache.get(mediaKey);
  if (!entry || Date.now() - entry.t > 600000) return [];
  const bucket = entry.byLang.get(targetLang) || entry.byLang.get(baseLangOf(targetLang));
  if (!bucket || !bucket.size) return [];
  const langLabel = getCodeToEnMap()[targetLang] || targetLang.toUpperCase();
  const out = [];
  for (const s of bucket.values()) {
    const res = s._realRes || detectResolution(s.name) || detectResolution(s.title) || "";
    const prov = String(s.name || "").split(/\s*[\u00b7\u2022]\s*/).pop().trim() || "Multi";
    const newName = (res ? (res + " · ") : "") + langLabel + " Dub · " + prov;
    out.push({ ...s, name: newName, title: langLabel + " Dub · " + prov, description: newName, _fromCrossHub: true });
  }
  return out;
}
function dimsToRes(w, h) {
  const W = Number(w) || 0, H = Number(h) || 0;
  if (W >= 7000 || H >= 4000) return "4320p";
  if (W >= 3200 || H >= 1800) return "2160p";
  if (W >= 2200 || H >= 1300) return "1440p";
  if (W >= 1700 || H >= 960) return "1080p";
  if (W >= 1150 || H >= 640) return "720p";
  if (W >= 700 || H >= 420) return "480p";
  if (W >= 460 || H >= 300) return "360p";
  if (W > 0 || H > 0) return "240p";
  return null;
}
function masterPlaylistRes(txt) {
  let bestW = 0, bestH = 0;
  for (const m of String(txt || "").matchAll(/RESOLUTION=(\d+)x(\d+)/gi)) {
    const w = parseInt(m[1], 10), h = parseInt(m[2], 10);
    if (w * h > bestW * bestH) { bestW = w; bestH = h; }
  }
  return bestW > 0 ? dimsToRes(bestW, bestH) : null;
}
function containerFromUrlOrType(u, contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("matroska")) return "MKV";
  if (ct.includes("video/mp4") || ct.includes("video/quicktime")) return "MP4";
  if (ct.includes("mp2t")) return "TS";
  if (ct.includes("x-msvideo") || ct.includes("video/avi")) return "AVI";
  const clean = String(u || "").split("?")[0].toLowerCase();
  if (/\.mkv$/.test(clean)) return "MKV";
  if (/\.(mp4|m4v|mov)$/.test(clean)) return "MP4";
  if (/\.(m2ts|ts)$/.test(clean)) return "TS";
  if (/\.avi$/.test(clean)) return "AVI";
  return null;
}
function parseHlsMediaMeta(txt, baseUrl) {
  const s = String(txt || "");
  if (!/^#EXTM3U/i.test(s.trim())) return null;
  const meta = { hdr: null, bitDepth: null, vcodec: null, fps: null, interlaced: false, is3d: false, acodec: null, channels: null, container: null, audioCount: 0, subCount: 0, cc: false, commentary: false, ad: false };
  let bestPixels = -1, bestInf = "";
  const lines = s.split(/\r?\n/);
  let audioTracks = 0, subTracks = 0;
  let maxCh = 0;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const rm = /RESOLUTION=(\d+)x(\d+)/i.exec(line);
      const px = rm ? (parseInt(rm[1], 10) * parseInt(rm[2], 10)) : 0;
      if (px >= bestPixels) { bestPixels = px; bestInf = line; }
    } else if (line.startsWith("#EXT-X-MEDIA:")) {
      if (/TYPE=AUDIO/i.test(line)) {
        audioTracks++;
        const cm = /CHANNELS="([^"]+)"/i.exec(line);
        if (cm) {
          const chStr = cm[1];
          if (/JOC/i.test(chStr)) meta.acodec = "Atmos";
          const n = parseInt(chStr, 10);
          if (Number.isFinite(n) && n > maxCh) maxCh = n;
        }
        if (/CHARACTERISTICS="[^"]*describes-video/i.test(line)) meta.ad = true;
        if (/NAME="[^"]*commentary/i.test(line)) meta.commentary = true;
      } else if (/TYPE=SUBTITLES/i.test(line)) {
        subTracks++;
        if (/CHARACTERISTICS="[^"]*transcribes-spoken-dialog/i.test(line)) meta.cc = true;
      } else if (/TYPE=CLOSED-CAPTIONS/i.test(line) && !/CLOSED-CAPTIONS=NONE/i.test(line)) {
        meta.cc = true;
      }
    } else if (line.startsWith("#EXT-X-MAP:")) {
      if (!meta.container) meta.container = "MP4";
    }
  }
  if (bestInf) {
    const codecsM = /CODECS="([^"]+)"/i.exec(bestInf);
    const suppM = /SUPPLEMENTAL-CODECS="([^"]+)"/i.exec(bestInf);
    const allCodecs = ((codecsM ? codecsM[1] : "") + "," + (suppM ? suppM[1] : "")).toLowerCase();
    const vrM = /VIDEO-RANGE=([A-Z0-9-]+)/i.exec(bestInf);
    const vr = vrM ? vrM[1].toUpperCase() : "";
    const hasDv = /\b(dvh1|dvhe|dav1)\b/.test(allCodecs);
    if (hasDv && vr === "PQ") meta.hdr = "DV+HDR";
    else if (hasDv) meta.hdr = "DV";
    else if (vr === "PQ") meta.hdr = "HDR10";
    else if (vr === "HLG") meta.hdr = "HLG";
    if (/\b(vvc1|vvi1)\b/.test(allCodecs)) meta.vcodec = "VVC";
    else if (/\bav01\b/.test(allCodecs)) meta.vcodec = "AV1";
    else if (/\b(hvc1|hev1|dvh1|dvhe)\b/.test(allCodecs)) meta.vcodec = "HEVC";
    else if (/\b(avc1|avc3)\b/.test(allCodecs)) meta.vcodec = "H.264";
    else if (/\bvp09\b/.test(allCodecs)) meta.vcodec = "VP9";
    else if (/\bvp08\b/.test(allCodecs)) meta.vcodec = "VP8";
    if (/\bav01\.\d+\.\d+[mh]\.12\b/i.test(allCodecs)) meta.bitDepth = "12-bit";
    else if (/\b(hvc1|hev1)\.2\./i.test(allCodecs) || /\bav01\.\d+\.\d+[mh]\.10\b/i.test(allCodecs) || /\bvp09\.02\./i.test(allCodecs)) meta.bitDepth = "10-bit";
    if (!meta.acodec) {
      if (/\bec-3\b/.test(allCodecs) && /joc/i.test(allCodecs)) meta.acodec = "Atmos";
      else if (/\bec-3\b/.test(allCodecs)) meta.acodec = "DDP";
      else if (/\bac-3\b/.test(allCodecs)) meta.acodec = "DD";
      else if (/\bac-4\b/.test(allCodecs)) meta.acodec = "AC-4";
      else if (/\bdts[hl]\b/.test(allCodecs)) meta.acodec = "DTS-HD MA";
      else if (/\bdtse\b/.test(allCodecs)) meta.acodec = "DTS-ES";
      else if (/\bdtsc\b/.test(allCodecs)) meta.acodec = "DTS";
      else if (/\bflac\b/.test(allCodecs)) meta.acodec = "FLAC";
      else if (/\balac\b/.test(allCodecs)) meta.acodec = "ALAC";
      else if (/\bopus\b/.test(allCodecs)) meta.acodec = "Opus";
      else if (/\bmp4a\.40\./.test(allCodecs)) meta.acodec = "AAC";
    }
    const fpsM = /FRAME-RATE=([\d.]+)/i.exec(bestInf);
    if (fpsM) {
      const f = parseFloat(fpsM[1]);
      if (f >= 57) meta.fps = "60fps";
      else if (f >= 47 && f < 54) meta.fps = "50fps";
    }
  }
  if (maxCh >= 8) meta.channels = "7.1";
  else if (maxCh === 7) meta.channels = "6.1";
  else if (maxCh === 6) meta.channels = "5.1";
  else if (maxCh === 3) meta.channels = "2.1";
  meta.audioCount = audioTracks;
  meta.subCount = subTracks;
  if (!meta.container) {
    if (/\.m4s(\?|$)/i.test(s)) meta.container = "MP4";
    else if (/\.ts(\?|$)/im.test(s)) meta.container = "TS";
  }
  return meta;
}
function extractFfprobeMediaMeta(data, url) {
  const streamsArr = Array.isArray(data?.streams) ? data.streams : [];
  const vst = streamsArr.find(x => x.codec_type === "video") || null;
  const audioStreams = streamsArr.filter(x => x.codec_type === "audio");
  const subStreams = streamsArr.filter(x => x.codec_type === "subtitle");
  const meta = { hdr: null, bitDepth: null, vcodec: null, fps: null, interlaced: false, is3d: false, acodec: null, channels: null, container: null, audioCount: audioStreams.length, subCount: subStreams.length, cc: false, commentary: false, ad: false };
  if (vst) {
    const cn = String(vst.codec_name || "").toLowerCase();
    const prof = String(vst.profile || "").toLowerCase();
    if (cn === "vvc") meta.vcodec = "VVC";
    else if (cn === "av1") meta.vcodec = "AV1";
    else if (cn === "hevc" || cn === "h265") meta.vcodec = "HEVC";
    else if (cn === "h264" || cn === "avc") meta.vcodec = "H.264";
    else if (cn === "vp9") meta.vcodec = "VP9";
    else if (cn === "vp8") meta.vcodec = "VP8";
    else if (cn === "prores") meta.vcodec = "ProRes";
    else if (cn === "vc1") meta.vcodec = "VC-1";
    else if (cn === "mpeg4") {
      const tag = String(vst.codec_tag_string || "").toUpperCase();
      if (tag.includes("XVID")) meta.vcodec = "XVID";
      else if (tag.includes("DIVX") || tag.includes("DX50")) meta.vcodec = "DIVX";
    }
    const pf = String(vst.pix_fmt || "").toLowerCase();
    if (/(?:12(?:le|be)?|p012|p212|p412)/.test(pf)) meta.bitDepth = "12-bit";
    else if (/(?:10(?:le|be)?|p010|p210|p410)/.test(pf) || /main 10|high 10/.test(prof)) meta.bitDepth = "10-bit";
    const sdList = Array.isArray(vst.side_data_list) ? vst.side_data_list : [];
    let dovi = null, hasHdr10Plus = false;
    for (const sd of sdList) {
      const st = String(sd?.side_data_type || "").toLowerCase();
      if (st.includes("dovi")) dovi = sd;
      if (st.includes("hdr dynamic metadata") || st.includes("2094-40")) hasHdr10Plus = true;
      if (st.includes("stereo 3d")) meta.is3d = true;
    }
    const ct = String(vst.color_transfer || "").toLowerCase();
    if (dovi) {
      const dvp = Number(dovi.dv_profile);
      const compat = Number(dovi.dv_bl_signal_compatibility_id);
      if (hasHdr10Plus) meta.hdr = "DV+HDR10+";
      else if (compat === 1 || ct === "smpte2084") meta.hdr = "DV+HDR";
      else if (dvp === 7 && Number(dovi.el_present_flag) === 1) meta.hdr = "DV P7";
      else if (dvp === 8) meta.hdr = "DV P8";
      else meta.hdr = "DV";
    } else if (hasHdr10Plus) {
      meta.hdr = "HDR10+";
    } else if (ct === "smpte2084") {
      meta.hdr = "HDR10";
    } else if (ct === "arib-std-b67") {
      meta.hdr = "HLG";
    }
    const fo = String(vst.field_order || "").toLowerCase();
    if (fo === "tt" || fo === "bb" || fo === "tb" || fo === "bt") meta.interlaced = true;
    const frStr = String(vst.avg_frame_rate || vst.r_frame_rate || "");
    const fm = /^(\d+)\/(\d+)$/.exec(frStr);
    if (fm && Number(fm[2]) > 0) {
      const fps = Number(fm[1]) / Number(fm[2]);
      if (fps >= 57 && fps <= 125) meta.fps = "60fps";
      else if (fps >= 47 && fps < 54) meta.fps = "50fps";
    }
  }
  const audioRank = (a) => {
    const cn = String(a.codec_name || "").toLowerCase();
    const pr = String(a.profile || "").toLowerCase();
    let sc = Number(a.channels || 0) * 10;
    if (pr.includes("atmos") || pr.includes("joc")) sc += 200;
    else if (cn === "truehd" || pr.includes("dts-hd ma")) sc += 150;
    else if (cn === "eac3" || cn === "dts") sc += 100;
    else if (cn === "ac3" || cn === "flac" || cn === "alac") sc += 70;
    if (a.disposition?.default) sc += 5;
    return sc;
  };
  if (audioStreams.length) {
    const bestA = audioStreams.slice().sort((a, b) => audioRank(b) - audioRank(a))[0];
    const cn = String(bestA.codec_name || "").toLowerCase();
    const pr = String(bestA.profile || "").toLowerCase();
    const ti = String(bestA.tags?.title || "").toLowerCase();
    if (cn === "truehd") meta.acodec = (pr.includes("atmos") || ti.includes("atmos")) ? "Atmos" : "TrueHD";
    else if (cn === "eac3") meta.acodec = (pr.includes("atmos") || pr.includes("joc") || ti.includes("atmos")) ? "Atmos" : "DDP";
    else if (cn === "ac3") meta.acodec = "DD";
    else if (cn === "ac4") meta.acodec = "AC-4";
    else if (cn === "dts") {
      if (pr.includes("dts-hd ma")) meta.acodec = "DTS-HD MA";
      else if (pr.includes("dts-hd hra")) meta.acodec = "DTS-HD HRA";
      else if (pr.includes("dts-es")) meta.acodec = "DTS-ES";
      else meta.acodec = "DTS";
    }
    else if (cn === "flac") meta.acodec = "FLAC";
    else if (cn === "alac") meta.acodec = "ALAC";
    else if (cn === "aac") meta.acodec = "AAC";
    else if (cn === "opus") meta.acodec = "Opus";
    else if (cn === "vorbis") meta.acodec = "Vorbis";
    else if (cn === "mp3") meta.acodec = "MP3";
    else if (cn.startsWith("wma")) meta.acodec = "WMA";
    const ch = Number(bestA.channels || 0);
    const cl = String(bestA.channel_layout || "").toLowerCase();
    if (ch >= 8 || cl.includes("7.1")) meta.channels = "7.1";
    else if (ch === 7 || cl.includes("6.1")) meta.channels = "6.1";
    else if (ch === 6 || cl.includes("5.1")) meta.channels = "5.1";
    else if (ch === 3 || cl.includes("2.1")) meta.channels = "2.1";
    for (const a of audioStreams) {
      if (a.disposition?.comment) meta.commentary = true;
      if (a.disposition?.visual_impaired) meta.ad = true;
    }
  }
  for (const sb of subStreams) {
    if (sb.disposition?.hearing_impaired) meta.cc = true;
  }
  const fn = String(data?.format?.format_name || "").toLowerCase();
  if (fn.includes("matroska")) meta.container = "MKV";
  else if (fn.includes("mp4") || fn.includes("mov")) meta.container = "MP4";
  else if (fn.includes("mpegts")) meta.container = "TS";
  else if (fn.includes("avi")) meta.container = "AVI";
  else meta.container = containerFromUrlOrType(url, "");
  return meta;
}
function mergeMediaMeta(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const hdrRank = { "DV+HDR10+": 7, "DV P7": 6, "DV P8": 5, "DV+HDR": 4, "DV": 3, "HDR10+": 3, "HDR10": 2, "HLG": 1 };
  const acRank = { "Atmos": 9, "TrueHD": 8, "DTS-HD MA": 7, "DTS-HD HRA": 6, "DDP": 5, "DTS-ES": 5, "DTS": 4, "AC-4": 4, "DD": 3, "FLAC": 3, "ALAC": 3, "Opus": 2, "AAC": 1, "Vorbis": 1, "MP3": 1, "WMA": 1 };
  const chRank = { "7.1": 4, "6.1": 3, "5.1": 2, "2.1": 1 };
  return {
    hdr: (hdrRank[b.hdr] || 0) >= (hdrRank[a.hdr] || 0) ? (b.hdr || a.hdr) : a.hdr,
    bitDepth: b.bitDepth || a.bitDepth,
    vcodec: b.vcodec || a.vcodec,
    fps: b.fps || a.fps,
    interlaced: !!(a.interlaced || b.interlaced),
    is3d: !!(a.is3d || b.is3d),
    acodec: (acRank[b.acodec] || 0) >= (acRank[a.acodec] || 0) ? (b.acodec || a.acodec) : a.acodec,
    channels: (chRank[b.channels] || 0) >= (chRank[a.channels] || 0) ? (b.channels || a.channels) : a.channels,
    container: b.container || a.container,
    audioCount: Math.max(a.audioCount || 0, b.audioCount || 0),
    subCount: Math.max(a.subCount || 0, b.subCount || 0),
    cc: !!(a.cc || b.cc),
    commentary: !!(a.commentary || b.commentary),
    ad: !!(a.ad || b.ad),
  };
}
function formatMediaTagsParts(meta, audioLangs, subLangs) {
  const container = [];
  const hdr = [];
  const tech = [];
  const flags = [];
  const m = meta || {};
  if (m.container) container.push(m.container);
  if (m.hdr) hdr.push(m.hdr);
  if (m.bitDepth) hdr.push(m.bitDepth);
  if (m.vcodec) tech.push(m.vcodec);
  if (m.is3d) tech.push("3D");
  if (m.fps) tech.push(m.fps);
  if (m.interlaced) tech.push("1080i");
  if (m.acodec) tech.push(m.acodec);
  if (m.channels) tech.push(m.channels);
  const aCnt = Math.max(m.audioCount || 0, Array.isArray(audioLangs) ? audioLangs.length : 0);
  const sCnt = Math.max(m.subCount || 0, Array.isArray(subLangs) ? subLangs.length : 0);
  if (aCnt >= 3) flags.push("Multi Audio");
  else if (aCnt === 2) flags.push("Dual Audio");
  if (sCnt >= 2) flags.push("Multi Sub");
  if (m.cc) flags.push("CC");
  if (m.commentary) flags.push("Commentary");
  if (m.ad) flags.push("AD");
  return { container, hdr, tech, flags };
}
const UNVERIFIED_TECH_TAG_RE = /\b(?:4320p|2160p|1440p|1080p|1080i|720p|576p|480p|360p|240p|8k|4k|2k|uhd|qhd|fhd|full\s*hd|ultra\s*hd|hd|sd|remux|uhd\s*blu-?ray|blu-?ray|bdrip|brrip|web-?dl|webrip|hdtv|dvdrip|tvrip|satrip|hdrip|screener|telecine|telesync|camrip|cam|imax(?:\s+enhanced)?|open\s+matte|criterion|director'?s\s+cut|extended(?:\s+cut)?|theatrical(?:\s+cut)?|final\s+cut|special\s+edition|unrated|remastered|proper|repack|seadex|dolby\s*vision|dv(?:\s*p[78])?|hdr10\+|hdr10|hdr|hlg|sdr|12-?bit|10-?bit|8-?bit|vvc|h\.?266|av1|hevc|h\.?265|x265|avc|h\.?264|x264|prores|vp9|vp8|vc-?1|xvid|divx|dolby\s*atmos|atmos|truehd|ddp?\+?\s*(?:7\.1|5\.1|2\.0)?|e-?ac-?3|ac-?3|ac-?4|dts-?hd(?:\s*(?:ma|hra))?|dts-?es|dts|flac|alac|aac|opus|vorbis|mp3|wma|7\.1\.4|7\.1\.2|5\.1\.4|5\.1\.2|7\.1|6\.1|5\.1|2\.1|2\.0|1\.0|mkv|mp4|m2ts|avi|60\s*fps|50\s*fps|hfr|3d|dual\s*audio|multi\s*audio|multi\s*sub|subpack|real-?debrid|alldebrid|premiumize|torbox|debrid-?link)\b/gi;
function stripUnverifiedTechTags(txt) {
  return String(txt || "")
    .replace(UNVERIFIED_TECH_TAG_RE, "")
    .replace(/\[\s*\]|\(\s*\)/g, "")
    .replace(/\s*[\u00b7\u2022]\s*(?=[\u00b7\u2022]|$)/g, "")
    .replace(/^\s*[\u00b7\u2022|\-]+\s*|\s*[\u00b7\u2022|\-]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
function buildVerifiedStreamDisplay(s, fallbackLabel) {
  const rawName = String(s?.name || "").replace(/[\u200B\u200C]/g, "").trim();
  const segs = rawName.split(/\s*[\u00b7\u2022]\s*/).map(x => x.trim()).filter(Boolean);
  const res = s?._realRes || detectResolution(s?.name) || detectResolution(s?.title) || "";
  const resRe = /^(?:4320p|2160p|1440p|1080p|720p|576p|480p|360p|240p|8k|4k|2k|uhd|qhd|fhd|hd|sd)$/i;
  const metRe = /^(\d+(?:\.\d+)?\s*mbps|\d+\s*ms)$/i;
  const bodySegs = segs.filter(x => !resRe.test(x) && !metRe.test(x));
  let langDub = "";
  let prov = "";
  if (bodySegs.length >= 2) {
    langDub = bodySegs[0];
    prov = stripUnverifiedTechTags(bodySegs.slice(1).join(" · "));
  } else if (bodySegs.length === 1) {
    prov = stripUnverifiedTechTags(bodySegs[0]);
  }
  if (!prov) prov = stripUnverifiedTechTags(streamProviderName(s)) || fallbackLabel || "Stream";
  const { container, hdr, tech, flags } = formatMediaTagsParts(s?._mediaMeta, s?._audioLangs, s?._subLangs);
  const met = formatMetricsSuffix(s);
  const cleanHead = prov || fallbackLabel || "Stream";
  const qualityParts = [res, langDub, ...container, ...hdr, ...tech, ...flags, met].filter(Boolean);
  const topQualityLine = [res, met].filter(Boolean).join(" · ");
  const tagQualityLine = [langDub, ...container, ...hdr, ...tech, ...flags].filter(Boolean).join(" · ");
  const qualityText = [topQualityLine, tagQualityLine].filter(Boolean).join("\n");
  const fullParts = [...qualityParts, prov].filter(Boolean);
  return {
    res,
    met,
    name: cleanHead,
    title: fullParts.join(" · "),
    line: fullParts.join(" · "),
    quality: qualityText,
  };
}
function probeStreamVideoInfo(s) {
  const u = String(s?.url || "");
  if (!u) return Promise.resolve({ res: null, kbps: null, audioLangs: [], subLangs: [], mediaMeta: null });
  const hit = videoInfoCache.get(u);
  if (hit && Date.now() - hit.t < (hit.v?.res ? 600000 : 60000)) return Promise.resolve(hit.v);
  return singleflight(videoInfoInflight, u, () => withFfprobeSlot(() => {
    const hit2 = videoInfoCache.get(u);
    if (hit2 && Date.now() - hit2.t < (hit2.v?.res ? 600000 : 60000)) return Promise.resolve(hit2.v);
    const rawHeaders = s?.behaviorHints?.proxyHeaders?.request || {};
    const hasUa = Object.keys(rawHeaders).some(k => k.toLowerCase() === "user-agent");
    const headers = hasUa ? { ...rawHeaders } : { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", ...rawHeaders };
    const isHls = isLikelyHlsUrl(u);
    const target = isHls ? proxyUrl("http://127.0.0.1:" + PORT, u, headers) : u;
    const args = ["-v", "error", "-rw_timeout", "4500000", "-allowed_extensions", "ALL", "-extension_picky", "0", "-analyzeduration", "2500000", "-probesize", "2500000"];
    if (!isHls) {
      const hdrLines = Object.entries(headers).map(([k, v]) => k + ": " + String(v).replace(/[\r\n]+/g, " ")).join("\r\n");
      if (hdrLines) args.push("-headers", hdrLines + "\r\n");
    }
    args.push("-show_entries", "stream=codec_type,codec_name,codec_tag_string,profile,width,height,bit_rate,pix_fmt,color_transfer,field_order,avg_frame_rate,r_frame_rate,channels,channel_layout:stream_disposition=default,comment,visual_impaired,hearing_impaired:stream_tags=language,title:stream_side_data=side_data_type,dv_profile,el_present_flag,dv_bl_signal_compatibility_id:format=bit_rate,format_name", "-of", "json", target);
    return new Promise(resolve => {
      require("child_process").execFile(FFPROBE, args, { timeout: 5500, windowsHide: true }, (err, out) => {
        let res = null, kbps = null, mediaMeta = null;
        const audioSet = new Set();
        const subSet = new Set();
        try {
          const data = JSON.parse(String(out || "{}"));
          const streamsArr = Array.isArray(data.streams) ? data.streams : [];
          const vst = streamsArr.find(x => x.codec_type === "video") || null;
          if (vst) res = dimsToRes(vst.width, vst.height);
          for (const ast of streamsArr) {
            if (ast.codec_type === "audio") {
              const lc = normalizeAudioLangCode(ast.tags?.language) || normalizeAudioLangCode(ast.tags?.title);
              if (lc) audioSet.add(lc);
            } else if (ast.codec_type === "subtitle") {
              const lc = normalizeAudioLangCode(ast.tags?.language) || normalizeAudioLangCode(ast.tags?.title);
              if (lc) subSet.add(lc);
            }
          }
          const br = parseInt(data?.format?.bit_rate || vst?.bit_rate || "0", 10);
          if (Number.isFinite(br) && br >= 100000 && br <= 150000000) kbps = Math.round(br / 1000);
          mediaMeta = extractFfprobeMediaMeta(data, u);
        } catch {}
        const v = { res, kbps, audioLangs: [...audioSet], subLangs: [...subSet], mediaMeta };
        videoInfoCache.set(u, { t: Date.now(), v });
        capMap(videoInfoCache, 400);
        resolve(v);
      });
    });
  }));
}
function applyVerifiedResolution(s, realRes) {
  if (!realRes || !s) return;
  s._realRes = realRes;
  const stripRes = (txt) => String(txt || "").replace(/\b(?:4320p|8k|2160p|1440p|1080p|720p|576p|480p|360p|240p|4k|2k|qhd|uhd|fhd|hd)\b/gi, "").replace(/\s*[\u00b7\u2022]\s*(?=[\u00b7\u2022]|$)/g, "").replace(/^\s*[\u00b7\u2022|\-]+\s*/g, "").replace(/\s{2,}/g, " ").trim();
  const cleanN = stripRes(s.name);
  s.name = realRes + (cleanN ? (" · " + cleanN) : "");
  if (s.description) { const cleanD = stripRes(s.description); s.description = realRes + (cleanD ? (" · " + cleanD) : ""); }
}
function parseHintBitrate(text, isTv) {
  const t = String(text || "");
  const mb = /(\d+(?:\.\d+)?)\s*mbps/i.exec(t);
  if (mb) return Math.round(parseFloat(mb[1]) * 1000);
  const kb = /(\d+(?:\.\d+)?)\s*kbps/i.exec(t);
  if (kb) return Math.round(parseFloat(kb[1]));
  const sz = /(\d+(?:\.\d+)?)\s*(gb|mb)\b/i.exec(t);
  if (sz) {
    const bytes = parseFloat(sz[1]) * (sz[2].toLowerCase() === "gb" ? 1073741824 : 1048576);
    const durSec = isTv ? 2700 : 6600;
    const k = Math.round((bytes * 8 / 1000) / durSec);
    if (k >= 150 && k <= 120000) return k;
  }
  return null;
}
async function probeOneStreamMetric(s, isTv) {
  const u = String(s?.url || "");
  if (!u) return { kbps: null, latencyMs: null };
  const hit = streamMetricsCache.get(u);
  if (hit && Date.now() - hit.t < (hit.v?.latencyMs ? 600000 : 25000)) return hit.v;
  return singleflight(streamMetricsInflight, u, async () => {
    const hit2 = streamMetricsCache.get(u);
    if (hit2 && Date.now() - hit2.t < (hit2.v?.latencyMs ? 600000 : 25000)) return hit2.v;
    const rawHeaders = s?.behaviorHints?.proxyHeaders?.request || {};
    const hasUa = Object.keys(rawHeaders).some(k => k.toLowerCase() === "user-agent");
    const headers = hasUa ? { ...rawHeaders } : { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", ...rawHeaders };
    let kbps = parseHintBitrate((s.name || "") + " " + (s.title || ""), isTv);
    let latencyMs = null;
    let res = null;
    let audioLangs = [];
    let subLangs = [];
    let needsProxy = false;
    let mediaMeta = null;
    const isHls = isLikelyHlsUrl(u);
    const t0 = Date.now();
    try {
      if (isHls) {
        const r = await fetch(u, { headers, signal: AbortSignal.timeout(3200) });
        if (r.ok) {
          latencyMs = Math.max(1, Date.now() - t0);
          const baseUrl = r.url || u;
          const txt = (await r.text()).replace(/^\uFEFF/, "");
          res = masterPlaylistRes(txt);
          audioLangs = masterPlaylistAudioLangs(txt);
          subLangs = masterPlaylistSubLangs(txt);
          mediaMeta = parseHlsMediaMeta(txt, baseUrl);
          if (/^#EXTM3U/i.test(txt.trim())) needsProxy = true;
          const bw = declaredBitrate(txt);
          if (bw) kbps = Math.round(bw / 1000);
          else if (!kbps) {
            const segs = segmentsOf(txt, 1);
            if (segs.length) {
              const segUrl = new URL(segs[0].url, baseUrl).href;
              try {
                const n = await headSize(segUrl, headers, 1500);
                if (n && segs[0].dur > 0) kbps = Math.round((n * 8 / 1000) / segs[0].dur);
              } catch {}
            }
          }
        }
      } else {
        let r = await fetch(u, { headers: { ...headers, Range: "bytes=0-0" }, signal: AbortSignal.timeout(3200) });
        let ok = r.ok || r.status === 206;
        if (!ok && (r.status === 400 || r.status === 403 || r.status === 405 || r.status === 416 || r.status === 501)) {
          try { await r.body?.cancel(); } catch {}
          const t1 = Date.now();
          r = await fetch(u, { headers, signal: AbortSignal.timeout(3200) });
          ok = r.ok || r.status === 206;
          if (ok) latencyMs = Math.max(1, Date.now() - t1);
        }
        if (ok && latencyMs === null) latencyMs = Math.max(1, Date.now() - t0);
        let n = ok ? sizeFromHeaders(r) : null;
        const ctCont = ok ? containerFromUrlOrType(r.url || u, r.headers.get("content-type")) : null;
        if (ctCont) mediaMeta = { container: ctCont };
        try { await r.body?.cancel(); } catch {}
        if (ok && !n) {
          try { n = await headSize(r.url || u, headers, 1500); } catch {}
        }
        if (ok && !kbps && n && n > 5000000) {
          const k = Math.round((n * 8 / 1000) / (isTv ? 2700 : 6600));
          if (k >= 150 && k <= 120000) kbps = k;
        }
      }
    } catch {}
    if (!Number.isFinite(kbps) || kbps <= 0) kbps = null;
    if (latencyMs === null) kbps = null;
    const v = { kbps, latencyMs, res, audioLangs, subLangs, needsProxy, mediaMeta };
    streamMetricsCache.set(u, { t: Date.now(), v });
    capMap(streamMetricsCache, 600);
    return v;
  });
}
async function enrichAndApplyStreamControls(list, cfg, isTv, hubCtx = null) {
  const basePool = (list && Array.isArray(list.all) && list.all.length) ? list.all : (Array.isArray(list) ? list : []);
  const sharedPool = hubCtx ? getCrossHubAudioStreams(hubCtx.mediaKey, hubCtx.slug) : [];
  const pool = sharedPool.length ? [...basePool, ...sharedPool] : basePool;
  const seenUrls = new Set();
  const filtered = [];
  for (const s of pool) {
    if (!s || !s.url || isTorrentStream(s)) continue;
    if (hubCtx?.mediaKey && isBlacklisted(hubCtx.mediaKey, s)) continue;
    const uKey = canonicalizeStreamUrl(s.url);
    if (seenUrls.has(uKey)) continue;
    const res = detectResolution(s.name) || detectResolution(s.title);
    if (!isQualAllowed(res, cfg)) continue;
    seenUrls.add(uKey);
    filtered.push({ ...s });
  }
  sortStreamsForCfg(filtered, cfg);
  const byRes = new Map();
  for (const s of filtered) {
    const b = qualBucket(detectResolution(s.name) || detectResolution(s.title));
    if (!byRes.has(b)) byRes.set(b, []);
    byRes.get(b).push(s);
  }
  const toProbe = [];
  for (const b of ["2160p", "1440p", "1080p", "720p", "480p", "other"]) {
    const bucketList = byRes.get(b) || [];
    const byProv = new Map();
    for (const s of bucketList) {
      const pk = extractProviderName(s) || "_";
      if (!byProv.has(pk)) byProv.set(pk, []);
      byProv.get(pk).push(s);
    }
    const queues = [...byProv.values()];
    let picked = 0;
    for (let round = 0; picked < 8 && queues.some(q => q.length > round); round++) {
      for (const q of queues) {
        if (q.length > round && picked < 8) { toProbe.push(q[round]); picked++; }
      }
    }
  }
  {
    let metricTimer;
    try {
      await Promise.race([
        Promise.allSettled(toProbe.slice(0, 28).map(async (s) => {
          const m = await probeOneStreamMetric(s, isTv);
          s._kbps = m.kbps;
          s._latencyMs = m.latencyMs;
          if (m.needsProxy) s._needsProxy = true;
          if (m.res) applyVerifiedResolution(s, m.res);
          if (m.mediaMeta) s._mediaMeta = mergeMediaMeta(s._mediaMeta, m.mediaMeta);
          if (Array.isArray(m.audioLangs) && m.audioLangs.length) {
            s._audioLangs = m.audioLangs;
            if (hubCtx?.mediaKey) recordCrossHubAudio(hubCtx.mediaKey, s, m.audioLangs);
          }
          if (Array.isArray(m.subLangs) && m.subLangs.length) s._subLangs = m.subLangs;
        })),
        new Promise(r => { metricTimer = setTimeout(r, 5500); }),
      ]);
    } finally { clearTimeout(metricTimer); }
  }
  sortStreamsForCfg(filtered, cfg);
  const ffCand = [];
  const ffBuckets = Object.create(null);
  for (const s of filtered) {
    if ((s._realRes && s._audioLangs?.length && s._mediaMeta?.vcodec) || !s._latencyMs) continue;
    const b = qualBucket(detectResolution(s.name) || detectResolution(s.title));
    ffBuckets[b] = (ffBuckets[b] || 0) + 1;
    if (ffBuckets[b] <= 3) ffCand.push(s);
    if (ffCand.length >= 12) break;
  }
  if (ffCand.length) {
    let ffTimer;
    try {
      await Promise.race([
        Promise.allSettled(ffCand.map(async (s) => {
          const info = await probeStreamVideoInfo(s);
          if (info.res) applyVerifiedResolution(s, info.res);
          if (info.kbps && info.kbps > 0) s._kbps = info.kbps;
          if (info.mediaMeta) s._mediaMeta = mergeMediaMeta(s._mediaMeta, info.mediaMeta);
          if (Array.isArray(info.audioLangs) && info.audioLangs.length) {
            s._audioLangs = info.audioLangs;
            if (hubCtx?.mediaKey) recordCrossHubAudio(hubCtx.mediaKey, s, info.audioLangs);
          }
          if (Array.isArray(info.subLangs) && info.subLangs.length) s._subLangs = info.subLangs;
        })),
        new Promise(r => { ffTimer = setTimeout(r, 6500); }),
      ]);
    } finally { clearTimeout(ffTimer); }
  }
  const verified = filtered.filter(s => {
    const r = s._realRes || detectResolution(s.name) || detectResolution(s.title);
    if (s._realRes && !ALLOWED_RES.has(s._realRes)) return false;
    if (hubCtx?.slug && Array.isArray(s._audioLangs) && s._audioLangs.length > 0) {
      if (s._audioLangs.includes(hubCtx.slug)) {
        if (/\bSub\b/i.test(String(s.name || ""))) {
          s.name = String(s.name).replace(/\bSub\b/i, "Dub");
          if (s.title) s.title = String(s.title).replace(/\bSub\b/i, "Dub");
        } else if (!/\bDub\b/i.test(String(s.name || ""))) {
          const ln = getCodeToEnMap()[hubCtx.slug];
          if (ln) {
            const re = new RegExp("\\b" + ln + "\\b(?!\\s+(?:Dub|Sub))", "i");
            s.name = String(s.name).replace(re, ln + " Dub");
            if (s.title) s.title = String(s.title).replace(re, ln + " Dub");
          }
        }
      } else {
        const hasVerifiedHubSub = Array.isArray(s._subLangs) && s._subLangs.includes(hubCtx.slug);
        const isSub = /\bSub\b|Altyaz/i.test(String(s.name || ""));
        if (hasVerifiedHubSub) {
          if (/\bDub\b/i.test(String(s.name || ""))) {
            s.name = String(s.name).replace(/\bDub\b/i, "Sub");
            if (s.title) s.title = String(s.title).replace(/\bDub\b/i, "Sub");
          }
        } else {
          if (!isSub) return false;
          if (Array.isArray(s._subLangs) && s._subLangs.length > 0 && !s._subLangs.includes(hubCtx.slug)) return false;
        }
      }
    }
    return isQualAllowed(r, cfg);
  });
  sortStreamsForCfg(verified, cfg);
  const counts = Object.create(null);
  const capped = [];
  for (const s of verified) {
    const res = s._realRes || detectResolution(s.name) || detectResolution(s.title);
    const bucket = qualBucket(res);
    const lim = limitForBucket(bucket, cfg);
    const cur = counts[bucket] || 0;
    if (lim > 0 && cur >= lim) continue;
    counts[bucket] = cur + 1;
    capped.push(s);
    if (cfg && cfg.hubLim > 0 && capped.length >= cfg.hubLim) break;
  }
  const unprobed = capped.filter(s => !Number.isFinite(s._latencyMs) || s._latencyMs <= 0);
  if (unprobed.length) {
    let updated = false;
    await Promise.allSettled(unprobed.map(async (s) => {
      const m = await probeOneStreamMetric(s, isTv);
      if (m.kbps && (!s._kbps || s._kbps <= 0)) { s._kbps = m.kbps; updated = true; }
      if (m.latencyMs) { s._latencyMs = m.latencyMs; updated = true; }
      if (m.res && !s._realRes) { applyVerifiedResolution(s, m.res); updated = true; }
      if (m.mediaMeta) s._mediaMeta = mergeMediaMeta(s._mediaMeta, m.mediaMeta);
    }));
    if (updated) sortStreamsForCfg(capped, cfg);
  }
  capped._allVerified = verified;
  return capped;
}
function formatMetricsSuffix(s) {
  const parts = [];
  const mbps = kbpsLabel(s?._kbps);
  if (mbps) parts.push(mbps);
  if (Number.isFinite(s?._latencyMs) && s._latencyMs > 0) parts.push(s._latencyMs + " ms");
  return parts.join(" · ");
}
function applyStreamControls(list, cfg) {
  const pool = (list && Array.isArray(list.all) && list.all.length) ? list.all : (Array.isArray(list) ? list : []);
  const seenUrls = new Set();
  const filtered = [];
  for (const s of pool) {
    if (!s || !s.url || isTorrentStream(s)) continue;
    const uKey = canonicalizeStreamUrl(s.url);
    if (seenUrls.has(uKey)) continue;
    const res = detectResolution(s.name) || detectResolution(s.title);
    if (!isQualAllowed(res, cfg)) continue;
    seenUrls.add(uKey);
    filtered.push(s);
  }
  sortStreamsForCfg(filtered, cfg);
  const counts = Object.create(null);
  const capped = [];
  for (const s of filtered) {
    const res = detectResolution(s.name) || detectResolution(s.title);
    const bucket = qualBucket(res);
    const lim = limitForBucket(bucket, cfg);
    const cur = counts[bucket] || 0;
    if (lim > 0 && cur >= lim) continue;
    counts[bucket] = cur + 1;
    capped.push(s);
    if (cfg && cfg.hubLim > 0 && capped.length >= cfg.hubLim) break;
  }
  return capped;
}
function sortAndLimitMegaPicks(picks, cfg) {
  const rules = (cfg && Array.isArray(cfg.sortRules) && cfg.sortRules.length) ? cfg.sortRules : parseSortRules(cfg?.streamSort);
  const arr = picks.slice();
  const rRank = (p) => RES_RANK[p.res[0]] ?? 9;
  const prov = (p) => String(p.s?.name || "").split("·").pop().trim().toLowerCase();
  arr.sort((a, b) => {
    for (const rule of rules) {
      let diff = 0;
      if (rule.k === "dub") diff = streamAudioRank(a.s?.name, rule.d === "asc") - streamAudioRank(b.s?.name, rule.d === "asc");
      else if (rule.k === "qual") {
        if (rule.d === "asc") {
          const qA = RES_RANK[a.res[0]] !== undefined ? (5 - RES_RANK[a.res[0]]) : 9;
          const qB = RES_RANK[b.res[0]] !== undefined ? (5 - RES_RANK[b.res[0]]) : 9;
          diff = qA - qB;
        } else diff = rRank(a) - rRank(b);
      } else if (rule.k === "bitrate") diff = compareByMetric(a.kbps, b.kbps, rule.d === "desc");
      else if (rule.k === "speed") diff = compareByMetric(a.latencyMs, b.latencyMs, rule.d === "desc");
      else if (rule.k === "prov") diff = rule.d === "desc" ? prov(b).localeCompare(prov(a)) : prov(a).localeCompare(prov(b));
      if (diff !== 0) return diff;
    }
    return betterStream(a, b);
  });
  const counts = Object.create(null);
  const out = [];
  for (const p of arr) {
    const bucket = qualBucket(p.res[0]);
    const lim = limitForBucket(bucket, cfg);
    const cur = counts[bucket] || 0;
    if (lim > 0 && cur >= lim) continue;
    counts[bucket] = cur + 1;
    out.push(p);
    if (cfg && cfg.hubLim > 0 && out.length >= cfg.hubLim) break;
  }
  return out;
}
function buildNuvioRepoManifest(cfg) {
  const orderedLangs = orderHubLangs(cfg);
  const langScrapers = [];
  for (const code of orderedLangs) {
    const meta = LANG_CATALOG[code];
    if (!meta) continue;
    const up = code.toUpperCase();
    langScrapers.push({
      id: "hub_" + code,
      name: up + " Hub",
      description: meta.name + " dogrudan akis kaynaklari (torrent yok)",
      version: "2.0.0",
      author: "Nuvio Mega Hub",
      supportedTypes: ["movie", "tv"],
      filename: "p/" + code + ".js",
      enabled: true,
      hasSettings: true,
      contentLanguage: [code],
    });
  }
  const scrapers = langScrapers;
  scrapers.forEach((sc, idx) => { sc.name = zwSortPrefix(idx) + sc.name; });
  return {
    name: "Lanettirr",
    version: "2.0.0",
    description: "Secili dil hublari (torrent yok)",
    author: "Lanettirr",
    scrapers,
  };
}
function buildNuvioScraperJs(origin, prefix, slug) {
  const clean = String(slug || "").replace(/[^a-z0-9_]/gi, "").toLowerCase();
  const endpoint = origin + prefix + "/nuvio-repo/hub/" + clean;
  return [
    "function onSettings() {",
    "  return [",
    "    { key: 'q2160', type: 'toggle', label: '4K (2160p)', defaultValue: true },",
    "    { key: 'q1440', type: 'toggle', label: '2K (1440p)', defaultValue: true },",
    "    { key: 'q1080', type: 'toggle', label: '1080p Full HD', defaultValue: true },",
    "    { key: 'q720', type: 'toggle', label: '720p HD', defaultValue: true },",
    "    { key: 'q480', type: 'toggle', label: '480p SD', defaultValue: false },",
    "    { key: 'qlim', type: 'select', label: 'Kalite basina sonuc miktari', defaultValue: 'default', options: [",
    "      { label: 'Varsayilan (Web Ayari)', value: 'default' },",
    "      { label: '1', value: '1' }, { label: '2', value: '2' }, { label: '3', value: '3' }, { label: '5', value: '5' }, { label: 'Sinirsiz', value: '0' }",
    "    ] },",
    "    { key: 'hublim', type: 'select', label: 'Hub basina toplam sonuc', defaultValue: 'default', options: [",
    "      { label: 'Varsayilan (Web Ayari)', value: 'default' },",
    "      { label: 'Sinirsiz', value: '0' }, { label: '5', value: '5' }, { label: '10', value: '10' }, { label: '15', value: '15' }, { label: '20', value: '20' }",
    "    ] },",
    "    { key: 'ssort', type: 'select', label: 'Kaynak siralamasi', defaultValue: 'default', options: [",
    "      { label: 'Varsayilan (Web Ayari)', value: 'default' },",
    "      { label: 'Dublaj -> Kalite -> Bitrate -> Hiz', value: 'dub_qual' },",
    "      { label: 'Kalite -> Bitrate -> Hiz', value: 'qual_desc' },",
    "      { label: 'Hiz (En Hizli) -> Kalite -> Bitrate', value: 'speed_asc' },",
    "      { label: 'Kalite -> Bitrate (En Yuksek) -> Hiz', value: 'bitrate_desc' },",
    "      { label: 'Kalite: Dusukten Yuksege -> Hiz', value: 'qual_asc' },",
    "      { label: 'Altyazi -> Kalite -> Bitrate', value: 'sub_qual' },",
    "      { label: 'Saglayici Adi (A -> Z)', value: 'provider_asc' },",
    "      { label: 'Saglayici Adi (Z -> A)', value: 'provider_desc' }",
    "    ] },",
    "    { key: 'to', type: 'select', label: 'Saglayici zaman asimi (Timeout)', defaultValue: 'default', options: [",
    "      { label: 'Varsayilan (Web Ayari)', value: 'default' },",
    "      { label: '15 sn', value: '15' }, { label: '30 sn', value: '30' }, { label: '45 sn', value: '45' }, { label: '60 sn', value: '60' }, { label: '90 sn', value: '90' }",
    "    ] }",
    "  ];",
    "}",
    "async function getStreams(tmdbId, mediaType, season, episode) {",
    "  try {",
    '    var u = ' + JSON.stringify(endpoint) + ' + "?tmdbId=" + encodeURIComponent(tmdbId || "") + "&mediaType=" + encodeURIComponent(mediaType || "movie") + "&season=" + encodeURIComponent(season || "") + "&episode=" + encodeURIComponent(episode || "");',
    "    var st = (typeof globalThis !== 'undefined' && globalThis.SCRAPER_SETTINGS) ? globalThis.SCRAPER_SETTINGS : null;",
    "    if (st && typeof st === 'object' && Object.keys(st).length > 0) {",
    "      var qKeys = [['q2160','2160p'],['q1440','1440p'],['q1080','1080p'],['q720','720p'],['q480','480p']];",
    "      var hasQ = qKeys.some(function(x){ return Object.prototype.hasOwnProperty.call(st, x[0]); });",
    "      if (hasQ) {",
    "        var qs = qKeys.filter(function(x){ return st[x[0]] === true || st[x[0]] === 'true'; }).map(function(x){ return x[1]; });",
    "        if (qs.length) u += '&quals=' + encodeURIComponent(qs.join(','));",
    "      }",
    "      if (st.qlim && st.qlim !== 'default') u += '&qlm=all&qlim=' + encodeURIComponent(String(st.qlim));",
    "      if (st.hublim && st.hublim !== 'default') u += '&hublim=' + encodeURIComponent(String(st.hublim));",
    "      if (st.ssort && st.ssort !== 'default') u += '&ssort=' + encodeURIComponent(String(st.ssort));",
    "      if (st.to && st.to !== 'default') u += '&to=' + encodeURIComponent(String(st.to));",
    "    }",
    "    var r = await fetch(u);",
    "    if (!r || !r.ok) return [];",
    "    var j = await r.json();",
    "    return Array.isArray(j) ? j : [];",
    "  } catch (e) { return []; }",
    "}",
    "module.exports = { getStreams, onSettings };",
  ].join(String.fromCharCode(10));
}
function parseId(type, id) {
  const parts = id.split(':');
  let tmdbId, season = null, episode = null;

  if (type === 'series') {
    if (parts[0] === 'tmdb') {
      tmdbId  = parts[1];
      season  = parseInt(parts[2], 10);
      episode = parseInt(parts[3], 10);
    } else {
      tmdbId  = parts[0];
      season  = parseInt(parts[1], 10);
      episode = parseInt(parts[2], 10);
    }
  } else {
    tmdbId = parts[0] === 'tmdb' ? parts[1] : parts[0];
  }

  return { tmdbId, mediaType: type === 'series' ? 'tv' : 'movie', season, episode };
}

// ─── Query providers ──────────────────────────────────────────────────────────
const ALLOWED_RES = new Set(['4320p', '2160p', '1440p', '1080p', '720p', '576p', '480p']);
const RES_RANK = { '4320p': -1, '2160p': 0, '1440p': 1, '1080p': 2, '720p': 3, '576p': 4, '480p': 5 };
function zwSortPrefix(idx) {
  const n = Math.max(0, Math.min(255, idx | 0));
  let p = '';
  for (let b = 7; b >= 0; b--) p += (n & (1 << b)) ? '\u200C' : '\u200B';
  return p;
}
function detectResolution(text) {
  const t = String(text || '');
  if (/\b(4320p|8k)\b|7680[x\u00d7]4320/i.test(t)) return '4320p';
  if (/\b(2160p|4k|uhd|ultra\s*hd)\b|3840[x\u00d7]2160/i.test(t)) return '2160p';
  if (/\b(1440p|2k|qhd)\b|2560[x\u00d7]1440/i.test(t)) return '1440p';
  if (/\b(1080p|fhd|full\s*hd)\b|1920[x\u00d7]1080/i.test(t)) return '1080p';
  if (/\b(720p|hd)\b|1280[x\u00d7]720/i.test(t)) return '720p';
  if (/\b576p\b/i.test(t)) return '576p';
  if (/\b480p\b|854[x\u00d7]480/i.test(t)) return '480p';
  if (/\b360p\b|640[x\u00d7]360/i.test(t)) return '360p';
  if (/\b240p\b|426[x\u00d7]240/i.test(t)) return '240p';
  if (/\b144p\b/i.test(t)) return '144p';
  return null;
}

function normalizeLabel(text) {
  return String(text || '')
    .replace(/\bFHD\b/gi, '1080p')
    .replace(/\bUHD\b/gi, '2160p')
    .replace(/\b4K\b/gi, '2160p')
    .replace(/\bHD\b/gi, '720p');
}

function detectResolutionFromUrl(url) {
  const t = String(url || "");
  if (/\b2160p\b|3840[x\u00d7]2160/i.test(t)) return "2160p";
  if (/\b1440p\b|2560[x\u00d7]1440/i.test(t)) return "1440p";
  if (/\b1080p\b|1920[x\u00d7]1080/i.test(t)) return "1080p";
  if (/\b720p\b|1280[x\u00d7]720/i.test(t)) return "720p";
  if (/\b576p\b/i.test(t)) return "576p";
  if (/\b480p\b|854[x\u00d7]480/i.test(t)) return "480p";
  return null;
}
async function probeHlsResolution(url, headers) {
  try {
    const r = await fetch(url, { headers: headers || {}, signal: AbortSignal.timeout(2800) });
    if (!r.ok) return null;
    const txt = await r.text();
    let bestH = 0;
    const re = /RESOLUTION=(\d+)x(\d+)/gi;
    let m;
    while ((m = re.exec(txt))) {
      const w = parseInt(m[1], 10), h = parseInt(m[2], 10);
      const effH = Math.max(h, Math.round(w * 9 / 16));
      if (effH > bestH) bestH = effH;
    }
    if (bestH >= 2000) return "2160p";
    if (bestH >= 1350) return "1440p";
    if (bestH >= 960) return "1080p";
    if (bestH >= 650) return "720p";
    if (bestH >= 430) return "480p";
    return null;
  } catch { return null; }
}
const providerHealth = new Map();
const CB_COOLDOWNS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];
function isHardProviderError(err) {
  const msg = String(err?.message || err || "");
  const code = String(err?.code || "");
  const status = Number(err?.status || err?.response?.status || 0);
  if ([403, 405, 522, 523, 530].includes(status)) return true;
  if (/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(code + " " + msg)) return true;
  if (/HTTP\s+(403|405|522|523|530)\b|missing\s+token|api[_ ]?key|syntaxerror|referenceerror|typeerror|blocked module/i.test(msg)) return true;
  if (err instanceof Error && !/timeout|aborted/i.test(msg)) return true;
  return false;
}
function isProviderCoolingDown(pid) {
  if (!pid || pid === "trhub") return false;
  const h = providerHealth.get(pid);
  return !!(h && h.cooldownUntil && Date.now() < h.cooldownUntil);
}
function recordProviderSuccess(pid) {
  if (!pid || pid === "trhub") return;
  if (providerHealth.has(pid)) providerHealth.delete(pid);
}
function recordProviderFailure(pid, err) {
  if (!pid || pid === "trhub") return;
  if (!isHardProviderError(err)) return;
  const cur = providerHealth.get(pid) || { fails: 0, trips: 0, cooldownUntil: 0 };
  cur.fails += 1;
  if (cur.fails >= 2) {
    const backoff = CB_COOLDOWNS_MS[Math.min(cur.trips, CB_COOLDOWNS_MS.length - 1)];
    cur.trips += 1;
    cur.fails = 0;
    cur.cooldownUntil = Date.now() + backoff;
  }
  providerHealth.set(pid, cur);
  capMap(providerHealth, 300);
}
async function getStreams(type, id, langs = ["tr", "en"], timeoutSec = 45, disabledRepos = [], disabledProvs = []) {
  const { tmdbId, mediaType, season, episode } = parseId(type, id);
  const info = await getTmdbInfo(tmdbId, mediaType);
  const effectiveTmdbId = info.tmdbId || tmdbId;
  const effectiveType = info.mediaType;
  const requestedTitle = info.title;
  const isNonAnimation = info.isAnimation === false;
  const isNativeTurkish = info.originalLang === 'tr';
  const offSet = new Set((disabledRepos || []).map(s => String(s || "").toLowerCase()));
  const offPSet = new Set((disabledProvs || []).map(s => String(s || "").toLowerCase()));
  const trGroups = langs.includes("tr") && (offSet.has("tr_cs3") || offSet.has("tr_nuvio") || offPSet.size) ? await fetchTrHubGroups() : null;
  const activeProviders = (await getProvidersForLangs(langs)).filter(p => {
    if (p.meta?.id === "trhub") {
      if (offSet.has("tr_trhub") || (offSet.has("tr_cs3") && offSet.has("tr_nuvio"))) return false;
      return true;
    }
    const cbId = String(p.meta?.id || p.meta?.name || "").toLowerCase();
    if (isProviderCoolingDown(cbId)) return false;
    if (isNonAnimation && (isAnimeOnlyProvider(p.meta?.id) || isAnimeOnlyProvider(p.meta?.name))) return false;
    const rid = p._repoId || (p.meta?.id === "trhub" ? "tr_trhub" : (/persian/i.test(String(p.meta?.name || "")) ? "fa_persian" : (/kisskh/i.test(String(p.meta?.name || "")) ? "th_kisskh" : "")));
    if (rid && offSet.has(rid)) return false;
    if (p._repoIds && p._repoIds.size) {
      for (const r of p._repoIds) if (offSet.has(r)) return false;
    }
    if (offPSet.size) {
      const pid = "p:" + slugRepo(p.meta?.id || p.meta?.name);
      const pnm = "p:" + slugRepo(p.meta?.name);
      if (offPSet.has(pid) || offPSet.has(pnm)) return false;
    }
    return true;
  });
  const rawTimeoutMs = Math.max(10000, Math.min(90000, (parseInt(timeoutSec, 10) || 45) * 1000));
  const isOnlyTrHub = activeProviders.length === 1 && activeProviders[0].meta?.id === "trhub";
  const baseTimeoutMs = isOnlyTrHub ? Math.max(rawTimeoutMs, 26000) : rawTimeoutMs;
  console.log(`🔍  ${mediaType} | ${tmdbId} | S${season??'-'}E${episode??'-'} | [${langs.join(",")}] | ${activeProviders.length} providers | to=${Math.round(baseTimeoutMs/1000)}s`);

  const results = await new Promise((resolveAll) => {
    const out = new Array(activeProviders.length).fill(null).map(() => ({ status: 'rejected', reason: new Error('timeout') }));
    if (!activeProviders.length) { resolveAll(out); return; }
    let pending = activeProviders.length;
    let settled = false;
    const ac = new AbortController();
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      resolveAll(out);
    };
    const hardTimer = setTimeout(() => { try { ac.abort(new Error('timeout')); } catch {} finish(); }, baseTimeoutMs);
    const checkDone = () => { if (!settled && pending === 0) finish(); };
    activeProviders.forEach((p, idx) => {
      const st = Array.isArray(p.meta?.supportedTypes) ? p.meta.supportedTypes.map(x => String(x).toLowerCase()) : null;
      if (st && st.length) {
        const okType = effectiveType === 'tv' ? (st.includes('tv') || st.includes('series') || st.includes('anime')) : st.includes('movie');
        if (!okType) { out[idx] = { status: 'fulfilled', value: [] }; pending--; checkDone(); return; }
      }
      const cbId = String(p.meta?.id || p.meta?.name || '').toLowerCase();
      const provId = (p.meta?.id === 'trhub' && /^tt\d+$/i.test(String(tmdbId || ''))) ? tmdbId : effectiveTmdbId;
      Promise.resolve().then(() => p.getStreams(provId, effectiveType, effectiveType === 'tv' ? season : null, effectiveType === 'tv' ? episode : null, { timeoutMs: baseTimeoutMs, rawTimeoutMs, isOnlyTrHub, imdbId: info.imdbId || null, signal: ac.signal }))
        .then(val => {
          recordProviderSuccess(cbId);
          if (settled) return;
          const arr = Array.isArray(val) ? val : [];
          out[idx] = { status: 'fulfilled', value: arr };
          pending--;
          checkDone();
        })
        .catch(err => {
          recordProviderFailure(cbId, err);
          if (settled) return;
          out[idx] = { status: 'rejected', reason: err };
          pending--;
          checkDone();
        });
    });
  });

  const streams = [];
  const singleHub = (Array.isArray(langs) && langs.length === 1) ? String(langs[0]).toLowerCase() : null;
  const CODE_TO_EN = Object.assign({ tr: "Turkish" }, Object.fromEntries(LANGS.map(l => [l[2], l[0]])));
  const reqTitleNorm = requestedTitle ? String(requestedTitle).trim() : "";
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') continue;
    for (const s of (r.value || [])) {
      if (!s?.url || isTorrentStream(s)) continue;
      const provObj = activeProviders[i];
      const providerName = provObj.meta.name;
      if (effectiveType === 'tv' && providerName === 'SinemaCX') continue;
      const rawName = s.name || providerName;
      if (isNonAnimation && (isAnimeOnlyProvider(provObj.meta?.id) || isAnimeOnlyProvider(providerName) || (s._fromTrHub && isAnimeOnlyProvider(rawName)))) continue;
      const rawTitle = [s.title, s.quality, s.size].filter(Boolean).join(' · ') || '';
      if (isLiveStream(s, rawName, rawTitle)) continue;
      if (s._fromTrHub && (offPSet.size || offSet.has("tr_cs3") || offSet.has("tr_nuvio"))) {
        const pSlug = slugRepo(rawName);
        if (offPSet.has("tr_cs3:" + pSlug) || offPSet.has("tr_nuvio:" + pSlug) || offPSet.has("p:" + pSlug)) continue;
        if (trGroups) {
          if (offSet.has("tr_cs3") && trGroups.cs3Set.has(pSlug) && !trGroups.nuvioSet.has(pSlug)) continue;
          if (offSet.has("tr_nuvio") && trGroups.nuvioSet.has(pSlug) && !trGroups.cs3Set.has(pSlug)) continue;
        }
      }
      const rawText = `${rawName} ${rawTitle} ${s.quality || ''}`;
      const haystack = `${rawText} ${s.url || ''}`;
      const titleMatch = matchesTitle(haystack, requestedTitle);
      const trustedProvider = !!s._fromTrHub || !!provObj._langCode || (effectiveType === 'tv' && TRUSTED_TR_PROVIDERS.has(providerName));
      if (!trustedProvider && !titleMatch) continue;
      const resolution = detectResolution(rawText) || detectResolutionFromUrl(s.url);
      if (resolution && !ALLOWED_RES.has(resolution)) continue;
      if (/\b(hdcam|camrip|cam|telesync|hdts|screener|dvdscr)\b/i.test(rawText)) continue;
      const isTrProv = !!s._fromTrHub || provObj.meta?.id === 'trhub' || TRUSTED_TR_PROVIDERS.has(providerName);
      const provLang = isTrProv ? 'tr' : (provObj._langCode || singleHub || 'en');
      // Strip requested movie/series title and subtitle phrases before detecting audio language
      let langScan = rawText;
      if (reqTitleNorm && reqTitleNorm.length >= 3) {
        const escTitle = reqTitleNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        langScan = langScan.replace(new RegExp(escTitle, "gi"), " ");
      }
      langScan = langScan.replace(/\b[a-z]{2,15}\s+(?:subtitles?|subs?|subbed|altyaz[i\u0131])\b/gi, " ").replace(/\b(?:subtitles?|subs?)\s*[:\-]?\s*[a-z]{2,15}\b/gi, " ");
      const isSub = /(altyaz|subtitle|\bsubs?\b|\bsub\s*tr|\bsubbed\b|\bvostfr\b)/i.test(rawText);
      let decUrl = ""; try { decUrl = decodeURIComponent(String(s.url || "")); } catch { decUrl = String(s.url || ""); }
      const fullScan = rawText + " " + decUrl;
      const isForeignRip = /\b(esub|eng\s*sub|english\s*sub|hindi|tamil|telugu|dual\s*audio|4khdhub|hdhub4u|mkvcinemas|vegamovies)\b/i.test(fullScan) && !/(dublaj|altyaz|turkish|t\u00fcrk\u00e7e|turkce|\btr\b)/i.test(fullScan);
      const isGenericDub = /(dublaj|dubbed|\bdub\b)/i.test(langScan);
      const isLangDub = (provLang === 'fr' && /\b(vf|vff|vfq)\b/i.test(langScan)) || (provLang === 'pt' && /\bdublado\b/i.test(langScan)) || (provLang === 'es' && /\b(latino|castellano)\b/i.test(langScan)) || (provLang === 'pl' && /\blektor\b/i.test(langScan));
      const isDub = isGenericDub || isLangDub;
      const mentionsTr = /(\btr\b|turkish|t\u00fcrk\u00e7e|turkce|\u{1F1F9}\u{1F1F7})/iu.test(langScan);
      const detected = detectLang(langScan);
      let langTag = '';
      if (provLang === 'tr') {
        if (/\b(vf|vff|vfq|vostfr|cpasmal|purstream|movix|wiflix|swiftflow|cinecalidad)\b/i.test(rawText) && !mentionsTr && !/(dublaj|altyaz)/i.test(rawText)) continue;
        if (isForeignRip) continue;
        const trTokenRe = /(\u{1F1F9}\u{1F1F7}|t[\u00fcu]rk[\u00e7c]e|turkish|\btr\b)/iu;
        const foreignAudioRe = /((?:^|[\s\u00b7\u2022|/(\[,;-])(?:[i\u0130\u0131]ngilizce|i\u0307ngilizce|english|almanca|german|frans[\u0131i]zca|french|[i\u0130\u0131]spanyolca|spanish|[i\u0130\u0131]talyanca|italian|rus[\u00e7c]a|russian|japonca|japanese|korece|korean|arap[\u00e7c]a|arabic|orijinal|original)(?=$|[\s\u00b7\u2022|/)\],;.-])|\u{1F1EC}\u{1F1E7}|\u{1F1FA}\u{1F1F8}|\u{1F1EB}\u{1F1F7}|\u{1F1E9}\u{1F1EA}|\u{1F1EA}\u{1F1F8}|\u{1F1EE}\u{1F1F9}|\u{1F1F7}\u{1F1FA}|\u{1F1EF}\u{1F1F5}|\u{1F1F0}\u{1F1F7})/iu;
        const sesMatch = /(?:^|[\s\u00b7\u2022|])Ses\s*:\s*([^\u2022|\n]+)/i.exec(rawText);
        const sesVal = sesMatch ? sesMatch[1].replace(/\s*\/\s*(?:\d{3,4}p|4k|uhd|fhd|hd)\b.*$/i, '').trim() : '';
        const subMatch = /(?:^|[\s\u00b7\u2022|])Altyaz[\u0131i]\s*:\s*([^\u2022|\n]+)/i.exec(rawText);
        const subVal = subMatch ? subMatch[1].replace(/\s*\/\s*(?:\d{3,4}p|4k|uhd|fhd|hd)\b.*$/i, '').trim() : '';
        const spkMatch = /\u{1F50A}\s*([^\s\u00b7\u2022|/()\n]+(?:\s+[^\s\u00b7\u2022|/()\n]+)?)/u.exec(rawText);
        const spkVal = spkMatch ? spkMatch[1].trim() : '';
        const hasExplicitTrAudio = isDub || (sesVal && trTokenRe.test(sesVal)) || (spkVal && trTokenRe.test(spkVal)) || /([\u00e7c]ift\s*ses|dual\s*ses)/i.test(rawText);
        const hasExplicitNonTrAudio = !hasExplicitTrAudio && (
          (sesVal && foreignAudioRe.test(sesVal)) ||
          (spkVal && foreignAudioRe.test(spkVal)) ||
          /\(\s*(?:[i\u0130\u0131]ngilizce|i\u0307ngilizce|english|almanca|frans[\u0131i]zca|[i\u0130\u0131]spanyolca|[i\u0130\u0131]talyanca|rus[\u00e7c]a|japonca|korece)(?:\s*,\s*[^)]+)?\s*\)/iu.test(rawText)
        );
        const hasExplicitNonTrSubOnly = !!(subVal && !trTokenRe.test(subVal));
        const effectiveIsSub = isSub && !hasExplicitNonTrSubOnly;
        if (hasExplicitNonTrAudio) {
          if (effectiveIsSub) langTag = 'Turkish Sub \u00b7 ';
          else continue;
        } else if (hasExplicitTrAudio) {
          langTag = 'Turkish Dub \u00b7 ';
        } else if (effectiveIsSub) {
          langTag = 'Turkish Sub \u00b7 ';
        } else if (hasExplicitNonTrSubOnly) {
          continue;
        }
        else langTag = isNativeTurkish ? 'Turkish \u00b7 ' : 'Turkish Sub \u00b7 ';
      } else if (provLang === 'en') {
        const mentionsEn = /\benglish\b|(?:\[|\(|\b)ENG(?:\]|\)|\b)/i.test(langScan) || /\bmulti\b/i.test(langScan);
        if (singleHub === 'en' && detected && detected[2] !== 'en' && !mentionsEn) continue;
        if (mentionsTr && titleMatch && !singleHub) langTag = isSub && !isDub ? 'Turkish Sub \u00b7 ' : (isDub ? 'Turkish Dub \u00b7 ' : 'Turkish \u00b7 ');
        else if (detected && detected[2] !== 'en' && !mentionsEn) langTag = detected[0] + (isDub ? ' Dub' : '') + ' \u00b7 ';
        else langTag = 'English' + (isDub ? ' Dub' : '') + ' \u00b7 ';
      } else {
        const hubLangName = CODE_TO_EN[provLang] || provLang.toUpperCase();
        const hubDef = LANGS.find(x => x[2] === provLang);
        const mentionsHub = hubDef ? hubDef[3].test(langScan) : false;
        if (singleHub === provLang && detected && detected[2] !== provLang && !mentionsHub) continue;
        if (isSub && !isDub) langTag = hubLangName + ' Sub \u00b7 ';
        else if (isDub) langTag = hubLangName + ' Dub \u00b7 ';
        else langTag = hubLangName + ' \u00b7 ';
      }
      const cleanName = cleanDisplayLabel(rawName, resolution, langTag);
      const displayTitle = cleanDisplayLabel(rawTitle || rawName, resolution, langTag);
      const stream = {
        name  : resolution ? `${resolution} · ${langTag}${cleanName}` : `${langTag}${cleanName}`,
        title : `${langTag}${displayTitle}`,
        description: `${langTag}${resolution ? resolution + ' · ' : ''}${displayTitle}`,
        url   : s.url,
      };
      if (s.headers && Object.keys(s.headers).length) {
        stream.behaviorHints = {
          notWebReady  : true,
          proxyHeaders : { request: s.headers },
        };
      }
      streams.push(stream);
    }
  }

  // Stage-2 probing (probeOneStreamMetric / probeAll) resolves HLS resolution in a single fetch.
  console.log(`  → ${streams.length} stream(s)\n`);
  const rankResolution = (name) => {
    const r = detectResolution(name);
    return RES_RANK[r] ?? 9;
  };
  const langRank = (n) => /Turkish Sub/i.test(n) ? 1 : /\bTurkish\b/i.test(n) ? 0 : 2;
  const dubTie = (n) => /\bDub\b|Dublaj/i.test(n) ? 0 : /\bSub\b|Altyaz/i.test(n) ? 2 : 1;
  streams.sort((a, b) => {
    const d = langRank(a.name) - langRank(b.name);
    if (d !== 0) return d;
    const r = rankResolution(a.name) - rankResolution(b.name);
    if (r !== 0) return r;
    return dubTie(a.name) - dubTie(b.name);
  });
  const seen = new Set();
  const unique = streams.filter(s => {
    const key = tagOf(s.name) + '|' + langRank(s.name) + '|' + detectResolution(s.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log('  -> after dedupe: ' + unique.length + '\n');
  unique.all = streams;
  return unique;
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type'                : 'application/json; charset=utf-8',
    'Cache-Control'               : 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

// ---- Mega HLS master: single card, quality + audio selectable in player ----
const streamCache = new Map();
const inflightStreams = new Map();
async function getStreamsCached(type, id, langs = ["tr", "en"], timeoutSec = 45, disabledRepos = [], disabledProvs = []) {
  const offKey = [...new Set((disabledRepos || []).map(s => String(s || "").toLowerCase()))].sort().join(",");
  const offPKey = [...new Set((disabledProvs || []).map(s => String(s || "").toLowerCase()))].sort().join(",");
  const k = langKey(langs) + "|" + type + "|" + id + (offKey ? ("|off=" + offKey) : "") + (offPKey ? ("|offp=" + offPKey) : "");
  const hit = streamCache.get(k);
  const wantTo = parseInt(timeoutSec, 10) || 45;
  if (hit && Date.now() - hit.t < 600000 && (hit.to || 45) >= wantTo) return hit.v;
  const inflightKey = k + "|to=" + wantTo;
  if (inflightStreams.has(inflightKey)) return inflightStreams.get(inflightKey);
  const prom = getStreams(type, id, langs, wantTo, disabledRepos, disabledProvs).then(v => {
    if (v && (v.length > 0 || (v.all && v.all.length > 0))) { streamCache.set(k, { t: Date.now(), to: wantTo, v }); capMap(streamCache, 120); }
    return v;
  }).finally(() => { if (inflightStreams.get(inflightKey) === prom) inflightStreams.delete(inflightKey); });
  inflightStreams.set(inflightKey, prom);
  return prom;
}
const RES = {
  '2160p': ['3840x2160', 18000000], '1440p': ['2560x1440', 9500000],
  '1080p': ['1920x1080', 5000000], '720p': ['1280x720', 2800000], '480p': ['854x480', 1400000],
  '576p': ['1024x576', 1800000], '360p': ['640x360', 800000], '240p': ['426x240', 400000],
};
const LANGS = [
  ['English', '\u0130ngilizce', 'en', /\b(english|en-us|en-gb)\b|(?:\[|\()eng(?:\]|\))|\bENG\b/i],
  ['English (US)', '\u0130ngilizce (ABD)', 'en_us', /\b(en-us|english\s*\(?us\)?)\b/i],
  ['English (UK)', '\u0130ngilizce (BK)', 'en_uk', /\b(en-gb|en-uk|english\s*\(?uk\)?)\b/i],
  ['German', 'Almanca', 'de', /\b(german|deutsch)\b|(?:\[|\()(?:ger|deu)(?:\]|\))/i],
  ['French', 'Frans\u0131zca', 'fr', /\b(french|fran[c\u00e7]ais|vostfr|vff|vfq)\b|(?:\[|\()(?:fra|fre|vf)(?:\]|\))/i],
  ['French (Canada)', 'Frans\u0131zca (Kanada)', 'fr_ca', /\b(fr-ca|vfq|quebec|french\s*\(?canada\)?)\b/i],
  ['Spanish', '\u0130spanyolca', 'es', /\b(spanish|espa[n\u00f1]ol|latino|castellano)\b|(?:\[|\()(?:spa|esp|lat)(?:\]|\))/i],
  ['Spanish (Spain)', '\u0130spanyolca (\u0130spanya)', 'es_es', /\b(castellano|es-es|spanish\s*\(?spain\)?)\b/i],
  ['Spanish (Latino)', '\u0130spanyolca (Latino)', 'es_la', /\b(latino|latam|es-419|es-mx)\b/i],
  ['Italian', '\u0130talyanca', 'it', /\b(italian|italiano)\b|(?:\[|\()ita(?:\]|\))/i],
  ['Russian', 'Rus\u00e7a', 'ru', /\b(russian|\u0440\u0443\u0441\u0441\u043a\u0438\u0439)\b|(?:\[|\()rus(?:\]|\))/i],
  ['Arabic', 'Arap\u00e7a', 'ar', /\barabic\b|(?:\[|\()ara(?:\]|\))/i],
  ['Hindi', 'Hint\u00e7e', 'hi', /\bhindi\b|(?:\[|\()hin(?:\]|\))/i],
  ['Japanese', 'Japonca', 'ja', /\bjapanese\b|(?:\[|\()(?:jpn|jap)(?:\]|\))/i],
  ['Korean', 'Korece', 'ko', /\bkorean\b|(?:\[|\()kor(?:\]|\))/i],
  ['Portuguese', 'Portekizce', 'pt', /\b(portuguese|portugu[e\u00ea]s|dublado)\b|(?:\[|\()por(?:\]|\))/i],
  ['Portuguese (Brazil)', 'Portekizce (Brezilya)', 'pt_br', /\b(pt-br|dublado|portugu[e\u00ea]s\s*br|brazil)\b/i],
  ['Polish', 'Leh\u00e7e', 'pl', /\b(polish|polski|lektor)\b|(?:\[|\()pol(?:\]|\))/i],
  ['Ukrainian', 'Ukraynaca', 'uk', /\b(ukrainian)\b/i],
  ['Persian', 'Fars\u00e7a', 'fa', /\b(persian|farsi)\b/i],
  ['Hungarian', 'Macarca', 'hu', /\b(hungarian|magyar)\b|(?:\[|\()hun(?:\]|\))/i],
  ['Vietnamese', 'Vietnamca', 'vi', /\b(vietnamese|viet|long.?tieng)\b/i],
  ['Chinese', '\u00c7ince', 'zh', /\b(chinese|mandarin)\b|(?:\[|\()(?:zho|chi)(?:\]|\))/i],
  ['Chinese Simp.', '\u00c7ince (Basitle\u015ftirilmi\u015f)', 'zh_cn', /\b(chs|zh-cn|simplified\s*chinese)\b/i],
  ['Chinese Trad.', '\u00c7ince (Geleneksel)', 'zh_tw', /\b(cht|zh-tw|traditional\s*chinese)\b/i],
  ['Cantonese', 'Kantonca', 'yue', /\b(cantonese|yue)\b|(?:\[|\()yue(?:\]|\))/i],
  ['Tamil', 'Tamilce', 'ta', /\btamil\b|(?:\[|\()tam(?:\]|\))/i],
  ['Telugu', 'Teluguca', 'te', /\btelugu\b|(?:\[|\()tel(?:\]|\))/i],
  ['Malayalam', 'Malayalamca', 'ml', /\bmalayalam\b|(?:\[|\()mal(?:\]|\))/i],
  ['Kannada', 'Kannada', 'kn', /\bkannada\b|(?:\[|\()kan(?:\]|\))/i],
  ['Bengali', 'Bengalce', 'bn', /\b(bengali|bangla)\b|(?:\[|\()ben(?:\]|\))/i],
  ['Marathi', 'Marathi', 'mr', /\bmarathi\b|(?:\[|\()mar(?:\]|\))/i],
  ['Gujarati', 'G\u00fccerat\u00e7a', 'gu', /\bgujarati\b|(?:\[|\()guj(?:\]|\))/i],
  ['Punjabi', 'Pencap\u00e7a', 'pa', /\bpunjabi\b|(?:\[|\()pan(?:\]|\))/i],
  ['Urdu', 'Urduca', 'ur', /\burdu\b|(?:\[|\()urd(?:\]|\))/i],
  ['Thai', 'Tayca', 'th', /\bthai\b|(?:\[|\()tha(?:\]|\))/i],
  ['Czech', '\u00c7ek\u00e7e', 'cs', /\b(czech|cesky)\b|(?:\[|\()cze(?:\]|\))/i],
  ['Romanian', 'Romence', 'ro', /\b(romanian|romana|rom\u00e2n\u0103)\b|(?:\[|\()(?:rum|ron)(?:\]|\))/i],
  ['Dutch', 'Felemenk\u00e7e', 'nl', /\b(dutch|nederlands)\b|(?:\[|\()(?:dut|nld)(?:\]|\))/i],
  ['Swedish', '\u0130sve\u00e7\u00e7e', 'sv', /\b(swedish|svenska)\b|(?:\[|\()swe(?:\]|\))/i],
  ['Norwegian', 'Norve\u00e7\u00e7e', 'no', /\b(norwegian|norsk)\b|(?:\[|\()nor(?:\]|\))/i],
  ['Danish', 'Danca', 'da', /\b(danish|dansk)\b|(?:\[|\()dan(?:\]|\))/i],
  ['Finnish', 'Fince', 'fi', /\b(finnish|suomi)\b|(?:\[|\()fin(?:\]|\))/i],
  ['Greek', 'Yunanca', 'el', /\b(greek|hellenic)\b|(?:\[|\()(?:gre|ell)(?:\]|\))/i],
  ['Indonesian', 'Endonezce', 'id', /\b(indonesian|indo)\b|(?:\[|\()ind(?:\]|\))/i],
  ['Malay', 'Malayca', 'ms', /\b(malay|melayu)\b|(?:\[|\()(?:may|msa)(?:\]|\))/i],
  ['Filipino', 'Filipince', 'tl', /\b(filipino|tagalog|pinoy)\b|(?:\[|\()(?:tgl|fil)(?:\]|\))/i],
];
function cleanDisplayLabel(text, resolution, langTag) {
  let s = normalizeLabel(text);
  s = s.replace(/\[(?:eng|en|de|ger|fr|fra|es|esp|it|ita|pt|ru|rus|tr|tur|ar|ara|hi|hin|pl|pol|ja|jpn|ko|kor)\]/gi, " ");
  s = s.replace(/\((?:auto|eng|en)\)/gi, " ");
  if (resolution) {
    const re = new RegExp("^\\s*" + resolution.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[\u00b7\u2022|\\-]?\\s*", "i");
    s = s.replace(re, "");
  }
  s = s.replace(/[\u2022\u00b7]{2,}/g, " · ").replace(/\s*[\u2022\u00b7|\-]\s*$/g, "").replace(/^\s*[\u2022\u00b7|\-]\s*/g, "").replace(/\s{2,}/g, " ").trim();
  return s || String(text || "").trim();
}
function detectLang(text) {
  for (const l of LANGS) if (l[3].test(text)) return l;
  return null;
}
function tagOf(name) {
  const m = new RegExp('(?:^|\u00b7\\s*)((?:Turkish Sub|Turkish Dub|Turkish|' + LANGS.map(l => l[0]).join('|') + ')(?: Dub)?)\\s*\u00b7').exec(name);
  return m ? m[1] : '';
}
const gRank = (g) => g === 'dub' ? 0 : g === 'sub' ? 1 : g === 'orig' ? 9 : /_dub$/.test(g) ? 2 : 3;
function megaTags(list) {
  const txt = list.map(s => [s.name, s.title, s.description].join(' ')).join(' ');
  const defs = [['WEB-DL', /web[-. ]?dl/i], ['WEBRip', /web[-. ]?rip/i], ['BluRay', /blu[-. ]?ray|bdrip|brrip/i],
    ['HDTV', /hdtv/i], ['DVDRip', /dvd[-. ]?rip/i], ['HDR', /\bhdr10?\b/i], ['DV', /dolby ?vision|\bdv\b/i],
    ['10bit', /10[- ]?bit/i], ['HEVC', /hevc|x265|h\.?265/i], ['AVC', /x264|h\.?264|avc/i], ['AV1', /\bav1\b/i],
    ['Atmos', /atmos/i], ['DDP', /dd\+|ddp|eac3/i], ['AAC', /\baac\b/i]];
  return defs.filter(d => d[1].test(txt)).map(d => d[0]);
}
function megaLangs(list) {
  const out = [];
  for (const s of list) {
    const t = tagOf(s.name);
    const label = t ? t : (audioClass(s.name)[0] === 'orig' ? 'Original' : '');
    if (label && !out.includes(label)) out.push(label);
  }
  return out.sort((a, b) => (/Turkish/.test(a) ? 0 : 1) - (/Turkish/.test(b) ? 0 : 1) || a.localeCompare(b));
}
function audioClass(name) {
  const first = tagOf(name);
  const hit = LANGS.find(l => first.startsWith(l[0]));
  if (hit) return [hit[2] + (/Dub/.test(first) ? '_dub' : ''), hit[1] + (/Dub/.test(first) ? ' Dublaj' : ''), hit[2]];
  if (/Turkish Sub/i.test(name)) return ['sub', 'T\u00fcrk\u00e7e Altyaz\u0131l\u0131', 'tr'];
  if (/Turkish/i.test(name)) return ['dub', 'T\u00fcrk\u00e7e Dublaj', 'tr'];
  return ['orig', 'Orijinal', 'und'];
}
const enc = (u, h, l, fb) => {
  const obj = { u, h: h || {} };
  if (l) obj.l = l;
  if (fb) obj.fb = fb;
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
};
const proxyUrl = (base, u, h, ext = 's.m3u8', lang = '', fb = null) => base + '/p/' + enc(u, h, lang, fb) + '/' + ext;
function markPlayCandidateFailed(spec, reason, timedOut) {
  const fb = spec && spec.fb;
  if (!fb || !fb.pid) return;
  const plan = playPlans.get(fb.pid);
  if (!plan) return;
  const slotIdx = Number(fb.slot) || 0;
  if (plan.resolved && plan.resolved[slotIdx] && plan.resolved[slotIdx].cand && plan.resolved[slotIdx].cand.url === spec.u) {
    delete plan.resolved[slotIdx];
  }
  if (!isBlacklisted(plan.mediaKey, { url: spec.u, name: fb.p })) {
    console.log("[FAILOVER] Proxy blacklisted " + plan.mediaKey + " | " + (fb.p || "?") + " (" + reason + ")");
    addBlacklistEntry({ mediaKey: plan.mediaKey, mediaLabel: plan.mediaLabel, provider: fb.p || "", url: spec.u, reason: timedOut ? "auto_timeout" : "auto_error" });
  }
}
async function resolveMedia(url, headers) {
  try {
    const r = await fetch(url, { headers: headers || {}, signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const t = await r.text();
    if (!t.includes('#EXTM3U')) return null;
    if (!t.includes('#EXT-X-STREAM-INF')) return { u: url, a: null };
    const lines = t.split(/\r?\n/);
    let best = null, bw = -1, grp = null;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
      const b = +((lines[i].match(/BANDWIDTH=(\d+)/) || [])[1] || 0);
      const u = lines.slice(i + 1).find(l => l && !l.startsWith('#'));
      if (u && b > bw) { bw = b; best = new URL(u, url).href; grp = (lines[i].match(/AUDIO="([^"]+)"/) || [])[1] || null; }
    }
    let aud = null;
    if (grp) {
      const m = lines.find(l => l.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/.test(l) && l.includes('GROUP-ID="' + grp + '"') && /URI="/.test(l));
      if (m) aud = new URL(m.match(/URI="([^"]+)"/)[1], url).href;
    }
    return best ? { u: best, a: aud } : null;
  } catch { return null; }
}
function streamLangInfo(p) {
  const lbls = cleanAudioLabels(p.audio, p.s?.name);
  const joined = (lbls.join(" ") + " " + String(p.s?.name || "")).trim();
  if (/Turkish Dub/i.test(joined) || (/Turkish/i.test(joined) && !/Turkish Sub/i.test(joined))) return { code: "tr", label: "T\u00fcrk\u00e7e" };
  if (/Turkish Sub/i.test(joined)) return { code: "tr_sub", label: "T\u00fcrk\u00e7e Altyaz\u0131" };
  for (const l of LANGS) {
    if (new RegExp("\\b" + l[0] + "\\b", "i").test(joined) || l[3].test(joined)) return { code: l[2], label: l[1] };
  }
  return { code: "en", label: "\u0130ngilizce" };
}
async function buildMaster(type, id, base, want, langs = ["tr", "en"], wantLang = "", timeoutSec = 45, disabledRepos = [], disabledProvs = []) {
  const plist = await probeAll(type, id, langs, timeoutSec, disabledRepos, disabledProvs);
  const byLang = wantLang ? plist.filter(x => streamLangInfo(x).code === wantLang) : plist;
  const pool = byLang.length ? byLang : plist;
  const p = pool.filter(x => !want || x.res[0] === want).sort(betterStream)[0] || pool[0];
  if (!p) return null;
  const names = { tr: 'T\u00fcrk\u00e7e', en: '\u0130ngilizce', de: 'Almanca', fr: 'Frans\u0131zca', es: '\u0130spanyolca', it: '\u0130talyanca', ru: 'Rus\u00e7a', uk: 'Ukraynaca', ar: 'Arap\u00e7a', ja: 'Japonca', ko: 'Korece', hi: 'Hint\u00e7e', ta: 'Tamilce', te: 'Teluguca', ml: 'Malayalamca', pt: 'Portekizce', hu: 'Macarca', pl: 'Leh\u00e7e', vi: 'Vietnamca', zh: '\u00c7ince', fa: 'Fars\u00e7a', th: 'Tayca', cs: '\u00c7ek\u00e7e' };
  const text = p.text.split(/\r?\n/).map(l => {
    if (!l.startsWith('#EXT-X-MEDIA:') || !/TYPE=AUDIO/.test(l)) return l;
    const lc = ((l.match(/LANGUAGE="([^"]+)"/) || [])[1] || '').toLowerCase().slice(0, 2);
    const nm = (l.match(/NAME="([^"]+)"/) || [])[1] || '';
    if (names[lc] && /^(audio|track|und|default|stereo)?[ _-]?\d*$/i.test(nm)) return l.replace(/NAME="[^"]*"/, 'NAME="' + names[lc] + '"');
    return l;
  }).join('\n');
  const prefLang = String(wantLang || '').replace(/_sub$/, '');
  return rewritePlaylist(text, p.finalUrl || p.url, p.h, base, prefLang);
}

function setHlsAttr(line, key, val) {
  const upperKey = key.toUpperCase();
  let out = '';
  let inQuotes = false;
  let segStart = 0;
  let replaced = false;
  const flush = (seg) => {
    if (replaced || !seg) return seg;
    const re = new RegExp('(^|,|\\:)(' + upperKey + ')=([^,]*)', 'i');
    if (re.test(seg)) {
      replaced = true;
      return seg.replace(re, '$1' + upperKey + '=' + val);
    }
    return seg;
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (!inQuotes) {
        out += flush(line.slice(segStart, i));
        segStart = i;
        inQuotes = true;
      } else {
        out += line.slice(segStart, i + 1);
        segStart = i + 1;
        inQuotes = false;
      }
    }
  }
  if (segStart < line.length) {
    out += inQuotes ? line.slice(segStart) : flush(line.slice(segStart));
  }
  return replaced ? out : (out + ',' + upperKey + '=' + val);
}

function rewritePlaylist(text, srcUrl, h, base, prefLang = '') {
  const cleanText = String(text || '').replace(/^\uFEFF/, '');
  const isMedia = /#EXTINF:/i.test(cleanText);
  const wrap = (u, ext) => {
    const raw = String(u || '').trim();
    if (!raw || /^(data|skd):/i.test(raw)) return raw;
    let resolved;
    try { resolved = new URL(raw, srcUrl).href; } catch { return raw; }
    return proxyUrl(base, resolved, h, ext);
  };
  let lines = cleanText.split(/\r?\n/).map(rawLine => {
    const l = rawLine.trim();
    if (!l) return l;
    if (l.startsWith('#')) {
      const ext = /#EXT-X-MAP:/i.test(l) ? 's.mp4' : (/#EXT-X-KEY:/i.test(l) ? 's.key' : 's.m3u8');
      return l.replace(/URI="([^"]+)"/g, (_, u) => 'URI="' + wrap(u, ext) + '"');
    }
    const segExt = /\.vtt(\?|$)/i.test(l) ? 's.vtt' : (/\.(m4s|mp4)(\?|$)/i.test(l) ? 's.mp4' : 's.ts');
    return wrap(l, isMedia ? segExt : 's.m3u8');
  });
  if (!isMedia) {
    const seenAudioKeys = new Set();
    const nameCountsByGroup = new Map();
    const deduped = [];
    for (const l of lines) {
      if (l.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/i.test(l)) {
        const gm = /GROUP-ID="([^"]+)"/i.exec(l);
        const um = /URI="([^"]+)"/i.exec(l);
        const grp = (gm && gm[1]) || '__default__';
        const uri = (um && um[1]) || '';
        if (uri) {
          const dk = grp + '|' + uri;
          if (seenAudioKeys.has(dk)) continue;
          seenAudioKeys.add(dk);
        }
        let outLine = l;
        const nm = /NAME="([^"]+)"/i.exec(outLine);
        if (nm) {
          const baseName = nm[1];
          let gMap = nameCountsByGroup.get(grp);
          if (!gMap) { gMap = new Map(); nameCountsByGroup.set(grp, gMap); }
          const prevCount = gMap.get(baseName) || 0;
          gMap.set(baseName, prevCount + 1);
          if (prevCount > 0) {
            const lm = /LANGUAGE="([^"]+)"/i.exec(outLine);
            const suffix = lm && lm[1] ? (' (' + lm[1] + ' #' + (prevCount + 1) + ')') : (' #' + (prevCount + 1));
            outLine = outLine.replace(/NAME="[^"]*"/i, 'NAME="' + baseName + suffix + '"');
          }
        }
        deduped.push(outLine);
      } else {
        deduped.push(l);
      }
    }
    lines = deduped;
  }
  if (!isMedia && prefLang) {
    const byGroup = new Map();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.startsWith('#EXT-X-MEDIA:') || !/TYPE=AUDIO/i.test(l)) continue;
      const gm = /GROUP-ID="([^"]+)"/i.exec(l);
      const grp = (gm && gm[1]) || '__default__';
      const lm = /LANGUAGE="([^"]+)"/i.exec(l);
      const nm = /NAME="([^"]+)"/i.exec(l);
      const lc = normalizeAudioLangCode(lm && lm[1]) || normalizeAudioLangCode(nm && nm[1]);
      const isMatch = lc === prefLang;
      if (!byGroup.has(grp)) byGroup.set(grp, { idxs: [], items: [], hasMatch: false });
      const bucket = byGroup.get(grp);
      if (isMatch) bucket.hasMatch = true;
      bucket.idxs.push(i);
      bucket.items.push({ l, isMatch });
    }
    for (const bucket of byGroup.values()) {
      if (!bucket.hasMatch || !bucket.items.length) continue;
      let firstMatch = true;
      const updated = bucket.items.map(({ l, isMatch }) => {
        const wantDef = isMatch && firstMatch;
        if (wantDef) firstMatch = false;
        let out = setHlsAttr(l, 'DEFAULT', wantDef ? 'YES' : 'NO');
        if (wantDef) out = setHlsAttr(out, 'AUTOSELECT', 'YES');
        return { out, isMatch };
      });
      updated.sort((a, b) => (b.isMatch ? 1 : 0) - (a.isMatch ? 1 : 0));
      for (let k = 0; k < bucket.idxs.length; k++) lines[bucket.idxs[k]] = updated[k].out;
    }
  }
  return lines.join('\n');
}

// Mega = the single best source (Turkish dub first, then quality), played with its
// own original playlist so video, audio and quality variants always belong together.
const primaryCache = new Map();
function resolveFfprobe() {
  const envBin = (process.env.MEGA_FFPROBE || process.env.FFPROBE_PATH || '').trim();
  if (envBin) return envBin;
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const wingetLink = path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'ffprobe.exe');
    if (fs.existsSync(wingetLink)) return wingetLink;
    const packagesDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    try {
      if (fs.existsSync(packagesDir)) {
        for (const pkg of fs.readdirSync(packagesDir)) {
          if (!pkg.startsWith('Gyan.FFmpeg')) continue;
          const pkgDir = path.join(packagesDir, pkg);
          for (const sub of fs.readdirSync(pkgDir)) {
            const candidate = path.join(pkgDir, sub, 'bin', 'ffprobe.exe');
            if (fs.existsSync(candidate)) return candidate;
          }
        }
      }
    } catch (_) {}
  }
  return 'ffprobe';
}
const FFPROBE = resolveFfprobe();
const widthToRes = (w) => w >= 3200 ? '2160p' : w >= 2200 ? '1440p' : w >= 1700 ? '1080p' : w >= 1200 ? '720p' : w >= 700 ? '480p' : '360p';
const ALLOWED_MEGA_RES = new Set(['2160p', '1440p', '1080p', '720p', '480p']);
const resDisplay = (r) => r === '2160p' ? '4K' : r === '1440p' ? '2K' : r;
function cleanAudioLabels(list, fallbackName) {
  const out = [];
  const add = (lbl) => { if (lbl && !out.includes(lbl)) out.push(lbl); };
  for (const raw of (list || [])) {
    const s = String(raw || '').replace(/\[[^\]]*\]/g, '').trim();
    if (!s) continue;
    if (/t[uü]rk[cç]e|turkish|\btr\b/i.test(s)) {
      if (/altyaz|sub/i.test(s)) add('Turkish Sub');
      else if (/dublaj|dub/i.test(s)) add('Turkish Dub');
      else add('Turkish');
    } else if (/ingilizce|english|\beng\b|orijinal|orjinal|original/i.test(s)) {
      add('English');
    } else if (/almanca|german/i.test(s)) add('German');
    else if (/frans[iı]zca|french/i.test(s)) add('French');
    else if (/ispanyolca|spanish/i.test(s)) add('Spanish');
    else if (/italyanca|italian/i.test(s)) add('Italian');
    else if (/rus[cç]a|russian/i.test(s)) add('Russian');
    else if (/arap[cç]a|arabic/i.test(s)) add('Arabic');
    else if (/japonca|japanese/i.test(s)) add('Japanese');
    else if (/korece|korean/i.test(s)) add('Korean');
    else if (/hint[cç]e|hindi/i.test(s)) add('Hindi');
    else if (/portekizce|portuguese/i.test(s)) add('Portuguese');
    else add(s);
  }
  if (!out.length && fallbackName) {
    if (/Turkish Dub/i.test(fallbackName)) add('Turkish Dub');
    else if (/Turkish Sub/i.test(fallbackName)) add('Turkish Sub');
    else if (/Turkish/i.test(fallbackName)) add('Turkish');
    else add('English');
  }
  return out;
}
function probeWidth(u) {
  return withFfprobeSlot(() => new Promise(resolve => {
    require('child_process').execFile(FFPROBE, ['-v', 'error', '-rw_timeout', '4500000', '-allowed_extensions', 'ALL', '-extension_picky', '0', '-select_streams', 'v:0',
      '-show_entries', 'stream=width', '-of', 'csv=p=0', u], { timeout: 15000, windowsHide: true }, (err, out) => {
      const w = parseInt(String(out || '').trim());
      resolve(Number.isFinite(w) ? w : null);
    });
  }));
}
// A 1080p label is not quality: many TR sites serve one 1080p rendition at
// ~1 Mbps. Measure the real bitrate and rank by that instead.
function segmentsOf(text, limit = 2) {
  const out = [];
  let dur = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^#EXTINF:([\d.]+)/.exec(line);
    if (m) { dur = parseFloat(m[1]); continue; }
    if (!line || line.startsWith('#')) continue;
    if (dur > 0) out.push({ url: line, dur });
    dur = 0;
    if (out.length >= limit) break;
  }
  return out;
}
function declaredBitrate(text) {
  const vals = [...String(text || '').matchAll(/BANDWIDTH=(\d+)/g)].map(m => +m[1]).filter(n => n >= 100000 && n <= 120000000);
  return vals.length ? Math.max(...vals) : null;
}
function sizeFromHeaders(r) {
  const cr = r.headers.get('content-range');
  if (cr) { const m = /\/(\d+)\s*$/.exec(cr); if (m) return +m[1]; }
  const cl = r.headers.get('content-length');
  if (cl && +cl > 0) return +cl;
  return null;
}
async function headSize(url, headers) {
  const base = { ...(headers || {}) };
  try {
    const r = await fetch(url, { method: 'HEAD', headers: base, signal: AbortSignal.timeout(7000) });
    const n = sizeFromHeaders(r);
    if (n) return n;
  } catch {}
  try {
    const r = await fetch(url, { headers: { ...base, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(8000) });
    const n = sizeFromHeaders(r);
    try { await r.body?.cancel(); } catch {}
    return n;
  } catch { return null; }
}
const bitrateCache = new Map();
async function measureBitrate(p) {
  const hit = bitrateCache.get(p.url);
  if (hit && Date.now() - hit.t < 600000) return hit.v;
  let kbps = null;
  const declared = declaredBitrate(p.text);
  if (declared) {
    kbps = Math.round(declared / 1000);
  } else {
    const segs = segmentsOf(p.text, 2);
    let bytes = 0, dur = 0;
    const baseUrl = p.finalUrl || p.url;
    for (const s of segs) {
      let segUrl;
      try { segUrl = new URL(s.url, baseUrl).href; } catch { continue; }
      const n = await headSize(segUrl, p.h);
      if (n) { bytes += n; dur += s.dur; }
    }
    if (bytes > 0 && dur > 0) kbps = Math.round((bytes * 8 / 1000) / dur);
  }
  kbps = Number.isFinite(kbps) && kbps > 0 ? kbps : null;
  bitrateCache.set(p.url, { t: Date.now(), v: kbps });
  capMap(bitrateCache, 400);
  return kbps;
}
const kbpsLabel = (kbps) => Number.isFinite(kbps) && kbps > 0 ? (kbps / 1000).toFixed(kbps >= 10000 ? 0 : 1) + ' Mbps' : '';
const resRank = (r) => ({ '2160p': 0, '1440p': 1, '1080p': 2, '720p': 3, '480p': 4 })[r] ?? 9;
const betterStream = (a, b) => (langRankG(a.s.name) - langRankG(b.s.name)) || (resRank(a.res[0]) - resRank(b.res[0])) || ((b.kbps || 0) - (a.kbps || 0));
// Probe every HLS candidate once: real resolution (measured), audio tracks, playlist text.
const probeCache = new Map();
async function probeAll(type, id, langs = ["tr", "en"], timeoutSec = 45, disabledRepos = [], disabledProvs = []) {
  const offKey = [...new Set((disabledRepos || []).map(s => String(s || "").toLowerCase()))].sort().join(",");
  const offPKey = [...new Set((disabledProvs || []).map(s => String(s || "").toLowerCase()))].sort().join(",");
  const k = langKey(langs) + "|" + type + "|" + id + (offKey ? ("|off=" + offKey) : "") + (offPKey ? ("|offp=" + offPKey) : "");
  const hit = probeCache.get(k);
  const wantTo = parseInt(timeoutSec, 10) || 45;
  if (hit && Date.now() - hit.t < 600000 && (hit.to || 45) >= wantTo) return hit.v;
  const all = (await getStreamsCached(type, id, langs, timeoutSec, disabledRepos, disabledProvs)).all || [];
  const hlsAll = all.filter(s => isLikelyHlsUrl(s.url));
  const byBucket = new Map();
  for (const s of hlsAll) { const r = detectResolution(s.name) || '720p'; if (!byBucket.has(r)) byBucket.set(r, []); byBucket.get(r).push(s); }
  const cand = [];
  for (const r of ['2160p', '1440p', '1080p', '720p', '480p']) { cand.push(...(byBucket.get(r) || []).slice(0, 6)); }
  for (const s of hlsAll) { if (cand.length >= 30) break; if (!cand.includes(s)) cand.push(s); }
  const v = (await Promise.all(cand.map(async (s, i) => {
    const t0 = Date.now();
    const p = await pickPrimary(type, id, null, s);
    if (!p) return null;
    if (!Number.isFinite(p.latencyMs) || p.latencyMs <= 0) p.latencyMs = Math.max(1, Date.now() - t0);
    p.order = i;
    p.kbps = await measureBitrate(p);
    p.res = [p.measured ? p.res[0] : (detectResolution(s.name) || '720p')];
    return p;
  }))).filter(Boolean).sort(betterStream);
  // ffprobe is expensive: verify only the best two of each claimed resolution.
  const verify = [];
  for (const r of ['2160p', '1440p', '1080p', '720p', '480p']) {
    verify.push(...v.filter(x => x.res[0] === r).slice(0, 2));
  }
  await Promise.all(verify.map(async p => {
    if (p.measured) return;
    const w = await probeWidth(proxyUrl('http://127.0.0.1:' + PORT, p.s.url, p.h));
    if (w) p.res = [widthToRes(w)];
  }));
  v.sort(betterStream);
  if (v.length > 0) { probeCache.set(k, { t: Date.now(), to: wantTo, v }); capMap(probeCache, 120); }
  return v;
}
const langRankG = (n) => /Turkish Sub/i.test(n) ? 1 : /\bTurkish\b/i.test(n) ? 0 : 2;
async function pickPrimary(type, id, want, only) {
  const k = type + '|' + id + '|' + (want || '') + '|' + (only ? only.url : '');
  const hit = primaryCache.get(k);
  if (hit && Date.now() - hit.t < 600000) return hit.v;
  const all = only ? [only] : ((await getStreamsCached(type, id)).all || []);
  const cand = (only ? [only] : all).filter(s => isLikelyHlsUrl(s.url) && (!want || (detectResolution(s.name) || '720p') === want)).sort((a, b) =>
    langRankG(a.name) - langRankG(b.name) || (parseInt(detectResolution(b.name)) || 0) - (parseInt(detectResolution(a.name)) || 0));
  let v = null;
  for (const s of cand) {
    const h = s.behaviorHints?.proxyHeaders?.request || {};
    try {
      const ft0 = Date.now();
      const r = await fetch(s.url, { headers: h, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const fetchMs = Math.max(1, Date.now() - ft0);
      const finalUrl = r.url || s.url;
      const text = (await r.text()).replace(/^\uFEFF/, '');
      if (!text.trimStart().startsWith('#EXTM3U')) continue;
      const lines = text.split(/\r?\n/);
      let res = [], audio = [];
      if (text.includes('#EXT-X-STREAM-INF')) {
        const firstVar = lines.find((l, i) => i > 0 && l && !l.startsWith('#') && lines[i - 1].startsWith('#EXT-X-STREAM-INF'));
        if (!firstVar) continue;
        const vr = await fetch(new URL(firstVar.trim(), finalUrl).href, { headers: h, signal: AbortSignal.timeout(8000) });
        if (!vr.ok || !(await vr.text()).replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) continue;
        for (const l of lines) {
          const m = l.match(/RESOLUTION=(\d+)x\d+/);
          if (m) { const p = widthToRes(+m[1]); if (!res.includes(p)) res.push(p); }
          let a = l.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/.test(l) && (l.match(/NAME="([^"]+)"/) || [])[1];
          if (a) {
            const lc = ((l.match(/LANGUAGE="([^"]+)"/) || [])[1] || '').toLowerCase().slice(0, 2);
            const byCode = { tr: 'T\u00fcrk\u00e7e', en: '\u0130ngilizce', de: 'Almanca', fr: 'Frans\u0131zca', es: '\u0130spanyolca', it: '\u0130talyanca', ru: 'Rus\u00e7a', ar: 'Arap\u00e7a', ja: 'Japonca', ko: 'Korece', hi: 'Hint\u00e7e', pt: 'Portekizce' }[lc];
            if (byCode && /^(audio|track|und|default|stereo)?[ _-]?\d*$/i.test(a)) a = byCode;
          }
          if (a && !audio.includes(a)) audio.push(a);
        }
      } else if (!lines.some(l => l && !l.startsWith('#'))) continue;
      const measured = res.length > 0;
      if (!res.length) res.push(detectResolution(s.name) || '720p');
      res.sort((a, b) => parseInt(b) - parseInt(a));
      const label = audioClass(s.name)[1];
      if (!audio.length || audio.every(a => /^(und|undefined|default|audio|stereo)$/i.test(a))) audio = [label];
      v = { s, url: s.url, finalUrl, h, text, res, audio, label, measured, latencyMs: fetchMs };
      break;
    } catch { continue; }
  }
  primaryCache.set(k, { t: Date.now(), v });
  capMap(primaryCache, 250);
  return v;
}

async function buildMasterOld(type, id, base) {
  const all = (await getStreamsCached(type, id)).all || [];
  const cand = all.filter(s => /\.m3u8(\?|$)/i.test(s.url));
  const resolved = await Promise.all(cand.map(async s => {
    const h = s.behaviorHints?.proxyHeaders?.request;
    const rm = await resolveMedia(s.url, h);
    return { s, u: rm ? proxyUrl(base, rm.u, h) : null, a: rm && rm.a ? proxyUrl(base, rm.a, h) : null };
  }));
  const seen = new Set();
  const groups = new Map();
  const variants = [];
  for (const { s, u, a } of resolved) {
    if (!u) continue;
    const [g, label, lang] = audioClass(s.name);
    const res = detectResolution(s.name) || '720p';
    const key = g + '|' + res;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.set(g + '|' + res, [label, lang, a, g]);
    const [wh, bw] = RES[res] || ['1280x720', 2000000];
    variants.push({ g, res, wh, bw, u });
  }
  if (!variants.length) return null;
  const out = ['#EXTM3U', '#EXT-X-VERSION:6'];
  for (const [k, [label, lang, a]] of groups)
    out.push('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a_' + k.replace('|', '_') + '",NAME="' + label + '",LANGUAGE="' + lang + '",DEFAULT=YES,AUTOSELECT=YES' + (a ? ',URI="' + a + '"' : ''));
  variants.sort((a, b) => gRank(a.g) - gRank(b.g) || b.bw - a.bw);
  for (const v of variants)
    out.push('#EXT-X-STREAM-INF:BANDWIDTH=' + v.bw + ',RESOLUTION=' + v.wh + ',CODECS="avc1.640028,mp4a.40.2",AUDIO="a_' + v.g + '_' + v.res + '"', v.u);
  return out.join('\n') + '\n';
}

// Every response carries an exact Content-Length and honours Range, because Nuvio's
// player runs ffmpeg with reconnect_streamed=1 and treats unknown-length bodies as
// broken connections (endless reconnects -> audio only, black video, growing duration).
function sendBuf(req, res, buf, type) {
  const len = buf.length;
  const base = { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start = m[1] === '' ? Math.max(0, len - +m[2]) : +m[1];
    let end = m[1] !== '' && m[2] !== '' ? Math.min(+m[2], len - 1) : len - 1;
    if (start >= len || start > end) {
      res.writeHead(416, { ...base, 'Content-Range': 'bytes */' + len, 'Content-Length': 0 });
      res.end();
      return;
    }
    res.writeHead(206, { ...base, 'Content-Range': 'bytes ' + start + '-' + end + '/' + len, 'Content-Length': end - start + 1 });
    res.end(req.method === 'HEAD' ? undefined : buf.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, { ...base, 'Content-Length': len });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

const bodyCache = new Map();
const inflightBodies = new Map();
const BODY_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const BODY_CACHE_MAX_ITEM_BYTES = 4 * 1024 * 1024;
let bodyCacheBytes = 0;
function stableHeaderKey(h) {
  if (!h || typeof h !== 'object') return '';
  return Object.keys(h).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(k => k.toLowerCase() + ':' + String(h[k] ?? '')).join('|');
}
function setBodyCache(key, entry) {
  const sz = entry && entry.buf ? entry.buf.length : 0;
  if (sz > BODY_CACHE_MAX_ITEM_BYTES) return;
  const prev = bodyCache.get(key);
  if (prev && prev.buf) bodyCacheBytes = Math.max(0, bodyCacheBytes - prev.buf.length);
  bodyCache.delete(key);
  bodyCache.set(key, entry);
  bodyCacheBytes += sz;
  while (bodyCache.size > 80 || bodyCacheBytes > BODY_CACHE_MAX_BYTES) {
    const oldestKey = bodyCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = bodyCache.get(oldestKey);
    bodyCache.delete(oldestKey);
    if (oldest && oldest.buf) bodyCacheBytes = Math.max(0, bodyCacheBytes - oldest.buf.length);
  }
}
async function fetchBody(u, h, extSignal) {
  const effH = ensureBrowserHeaders(h);
  const cacheKey = u + '|' + stableHeaderKey(effH);
  const hit = bodyCache.get(cacheKey);
  if (hit && Date.now() - hit.t < 120000) return hit;
  return singleflight(inflightBodies, cacheKey, async () => {
    const reHit = bodyCache.get(cacheKey);
    if (reHit && Date.now() - reHit.t < 120000) return reHit;
    const sig = combineSignals(30000, extSignal);
    try {
      const r = await fetch(u, { headers: effH, signal: sig.signal });
      if (!r.ok) throw Object.assign(new Error('upstream ' + r.status), { status: r.status });
      const v = { t: Date.now(), buf: Buffer.from(await r.arrayBuffer()), ct: r.headers.get('content-type'), finalUrl: r.url || u };
      if (v.buf.length <= BODY_CACHE_MAX_ITEM_BYTES) setBodyCache(cacheKey, v);
      return v;
    } finally {
      sig.cleanup();
    }
  });
}

async function handleProxy(req, res, token) {
  let spec;
  try { spec = JSON.parse(Buffer.from(token, 'base64url').toString()); } catch { res.writeHead(400, { 'Content-Length': 0 }); res.end(); return; }
  if (!spec || typeof spec !== 'object' || typeof spec.u !== 'string' || !spec.u.trim()) {
    res.writeHead(400, { 'Content-Length': 0 }); res.end(); return;
  }
  if (!isAllowedProxyUrl(spec.u)) {
    const msg = Buffer.from('Forbidden proxy target');
    res.writeHead(403, { 'Content-Length': msg.length, 'Access-Control-Allow-Origin': '*' });
    res.end(msg);
    return;
  }
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const base = proto + '://' + req.headers.host;
  try {
    const effH = ensureBrowserHeaders(spec.h);
    const cacheKey = spec.u + '|' + stableHeaderKey(effH);
    const cached = bodyCache.get(cacheKey);
    const hasFreshCache = !!(cached && Date.now() - cached.t < 120000);
    const isPlaylistHint = isLikelyHlsUrl(spec.u) || /\.m3u8(\?|$)/i.test(String(req.url || '')) || Boolean(spec.l);
    if (!hasFreshCache && !isPlaylistHint && (req.method === 'HEAD' || req.headers.range)) {
      const upHdrs = { ...effH };
      if (req.headers.range) upHdrs.Range = req.headers.range;
      const sig = combineSignals(30000, ac.signal);
      let up;
      try {
        up = await fetch(spec.u, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers: upHdrs, signal: sig.signal });
      } finally {
        sig.cleanup();
      }
      if (up.url && !isAllowedProxyUrl(up.url)) {
        try { await up.body?.cancel(); } catch {}
        res.writeHead(403, { 'Content-Length': 0, 'Access-Control-Allow-Origin': '*' });
        res.end();
        return;
      }
      if (!up.ok && up.status !== 206) {
        markPlayCandidateFailed(spec, 'proxy_http_' + up.status, false);
      }
      const outH = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': up.headers.get('accept-ranges') || 'bytes' };
      for (const hk of ['content-type', 'content-length', 'content-range']) { const hv = up.headers.get(hk); if (hv) outH[hk] = hv; }
      res.writeHead(up.status, outH);
      if (req.method === 'HEAD' || !up.body) { res.end(); return; }
      const src = Readable.fromWeb(up.body);
      const onClose = () => { if (!res.writableEnded) { try { src.destroy(); } catch {} } };
      res.once('close', onClose);
      await new Promise((resolve) => pipeline(src, res, () => { res.removeListener('close', onClose); resolve(); }));
      return;
    }
    let r;
    if (!hasFreshCache && !isPlaylistHint) {
      const sig = combineSignals(30000, ac.signal);
      let up;
      try {
        up = await fetch(spec.u, { headers: effH, signal: sig.signal });
      } finally {
        sig.cleanup();
      }
      if (up.url && !isAllowedProxyUrl(up.url)) {
        try { await up.body?.cancel(); } catch {}
        res.writeHead(403, { 'Content-Length': 0, 'Access-Control-Allow-Origin': '*' });
        res.end();
        return;
      }
      if (!up.ok) throw Object.assign(new Error('upstream ' + up.status), { status: up.status });
      const ct = String(up.headers.get('content-type') || '');
      const cl = parseInt(up.headers.get('content-length') || '0', 10);
      if (cl > BODY_CACHE_MAX_ITEM_BYTES && !/mpegurl/i.test(ct) && !isLikelyHlsUrl(up.url || spec.u)) {
        const outH = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': up.headers.get('accept-ranges') || 'bytes' };
        for (const hk of ['content-type', 'content-length', 'content-range']) { const hv = up.headers.get(hk); if (hv) outH[hk] = hv; }
        res.writeHead(up.status, outH);
        if (req.method === 'HEAD' || !up.body) { res.end(); return; }
        const src = Readable.fromWeb(up.body);
        const onClose = () => { if (!res.writableEnded) { try { src.destroy(); } catch {} } };
        res.once('close', onClose);
        await new Promise((resolve) => pipeline(src, res, () => { res.removeListener('close', onClose); resolve(); }));
        return;
      }
      const buf = Buffer.from(await up.arrayBuffer());
      r = { t: Date.now(), buf, ct: up.headers.get('content-type'), finalUrl: up.url || spec.u };
      if (buf.length <= BODY_CACHE_MAX_ITEM_BYTES) setBodyCache(cacheKey, r);
    } else {
      r = await fetchBody(spec.u, effH, ac.signal);
    }
    const buf = r.buf;
    const headText = buf.subarray(0, 64).toString('utf8').replace(/^\uFEFF/, '').trimStart();
    if (headText.startsWith('#EXTM3U')) {
      sendBuf(req, res, Buffer.from(rewritePlaylist(buf.toString('utf8'), r.finalUrl || spec.u, effH, base, spec.l || ''), 'utf8'), 'application/vnd.apple.mpegurl');
      return;
    }
    if (isPlaylistHint && looksLikeHtmlBuf(buf)) {
      markPlayCandidateFailed(spec, 'proxy_html', false);
      res.writeHead(502, { 'Content-Length': 0, 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }
    let body = buf;
    if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') {
      let off = -1;
      for (let o = 0; o < 1024 && off < 0; o++) {
        let c = 0;
        for (let k = 0; k < 6; k++) if (buf[o + k * 188] === 0x47) c++;
        if (c === 6) off = o;
      }
      if (off >= 0) body = buf.subarray(off);
    }
    sendBuf(req, res, body, body[0] === 0x47 ? 'video/mp2t' : (r.ct || 'application/octet-stream'));
  } catch (e) {
    if (ac.signal.aborted || res.writableEnded) return;
    const isTo = e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timeout|abort/i.test(String(e?.message || ''));
    markPlayCandidateFailed(spec, e?.status ? ('proxy_http_' + e.status) : (isTo ? 'proxy_timeout' : 'proxy_error'), isTo);
    const msg = Buffer.from(String(e?.message || e || 'proxy error'));
    const st = Number.isInteger(e?.status) && e.status >= 400 && e.status <= 599 ? e.status : 502;
    if (!res.headersSent) {
      res.writeHead(st, { 'Content-Length': msg.length, 'Access-Control-Allow-Origin': '*' });
      res.end(msg);
    } else {
      try { res.end(); } catch {}
    }
  }
}

const hubSeqGates = new Map();
const HUB_SEQ_GRACE_MS = 300;
function getHubSeqGate(key, slug) {
  const now = Date.now();
  for (const [k, g] of hubSeqGates) if (now - g.t > 45000) hubSeqGates.delete(k);
  let g = hubSeqGates.get(key);
  if (g && ((slug && g.done.has(slug)) || (g.seen.size > 0 && g.seen.size === g.done.size && (now - g.createdAt) >= HUB_SEQ_GRACE_MS))) {
    if (g.cleanupTimer) { clearTimeout(g.cleanupTimer); g.cleanupTimer = null; }
    hubSeqGates.delete(key);
    g = null;
  }
  if (!g) {
    g = { key, createdAt: now, t: now, seen: new Set(), done: new Set(), waiters: [], cleanupTimer: null };
    hubSeqGates.set(key, g);
    capMap(hubSeqGates, 100);
  }
  if (g.cleanupTimer) { clearTimeout(g.cleanupTimer); g.cleanupTimer = null; }
  g.t = now;
  return g;
}
function waitHubTurn(gate, slug, order) {
  const myIdx = order.indexOf(slug);
  if (myIdx <= 0) return Promise.resolve();
  const prevs = order.slice(0, myIdx);
  const graceRemaining = () => Math.max(0, HUB_SEQ_GRACE_MS - (Date.now() - gate.createdAt));
  const ready = () => prevs.every(p => gate.done.has(p) || (!gate.seen.has(p) && graceRemaining() <= 0));
  if (ready()) return Promise.resolve();
  return new Promise(res => {
    let done = false;
    let graceTm = null;
    const check = () => { if (ready()) finish(); };
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(tm);
      if (graceTm) clearTimeout(graceTm);
      const idx = gate.waiters.indexOf(check);
      if (idx !== -1) gate.waiters.splice(idx, 1);
      res();
    };
    const tm = setTimeout(finish, Math.min(18000, myIdx * 10000));
    const remGrace = graceRemaining();
    if (remGrace > 0) graceTm = setTimeout(check, remGrace + 10);
    gate.waiters.push(check);
  });
}
function markHubDone(gate, slug) {
  gate.done.add(slug);
  const ws = gate.waiters.slice();
  for (const w of ws) try { w(); } catch {}
  if (gate.seen.size > 0 && gate.seen.size === gate.done.size) {
    if (gate.cleanupTimer) clearTimeout(gate.cleanupTimer);
    const delay = Math.max(50, HUB_SEQ_GRACE_MS + 50 - (Date.now() - gate.createdAt));
    gate.cleanupTimer = setTimeout(() => {
      gate.cleanupTimer = null;
      if (hubSeqGates.get(gate.key) === gate && gate.seen.size === gate.done.size && gate.waiters.length === 0) {
        hubSeqGates.delete(gate.key);
      }
    }, delay);
  }
}

function readJsonBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        rejected = true;
        const err = new Error("Payload too large");
        err.status = 413;
        reject(err);
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (rejected) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error("Invalid JSON");
        err.status = 400;
        reject(err);
      }
    });
    req.on("error", (e) => {
      if (rejected) return;
      rejected = true;
      const err = new Error(e?.message || "Request read error");
      err.status = 400;
      reject(err);
    });
  });
}

const UPDATE_REPO = (process.env.LANETTIRR_UPDATE_REPO || "0mamiis/lanettirr").trim();
const UPDATE_BRANCH = (process.env.LANETTIRR_UPDATE_BRANCH || "main").trim();
const UPDATE_CHECK_TTL = 15 * 60 * 1000;
let updateCheckCache = null;

function getLocalVersion() {
  const candidates = [path.join(__dirname, "VERSION"), path.join(__dirname, "..", "VERSION")];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8").trim().replace(/^v/i, "");
        if (raw) return raw;
      }
    } catch {}
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
    if (pkg && pkg.version) return String(pkg.version).trim().replace(/^v/i, "");
  } catch {}
  return "1.2.0";
}

function compareSemver(a, b) {
  const parse = (v) => String(v || "").trim().replace(/^v/i, "").split("-")[0].split(".").map(n => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function resolveUpdaterScript() {
  const custom = (process.env.LANETTIRR_UPDATER || "").trim();
  if (custom && fs.existsSync(custom)) {
    const type = custom.toLowerCase().endsWith(".ps1") ? "ps1" : "sh";
    return { type, scriptPath: custom, rootDir: path.dirname(custom) };
  }
  if (process.platform === "win32") {
    const cands = [
      { scriptPath: path.join(__dirname, "..", "scripts", "update.ps1"), rootDir: path.join(__dirname, "..") },
      { scriptPath: path.join(__dirname, "scripts", "update.ps1"), rootDir: __dirname },
    ];
    for (const c of cands) {
      if (fs.existsSync(c.scriptPath)) return { type: "ps1", scriptPath: c.scriptPath, rootDir: c.rootDir };
    }
  } else {
    const cands = [
      { scriptPath: path.join(__dirname, "..", "guncelle.sh"), rootDir: path.join(__dirname, "..") },
      { scriptPath: path.join(__dirname, "guncelle.sh"), rootDir: __dirname },
    ];
    for (const c of cands) {
      if (fs.existsSync(c.scriptPath)) return { type: "sh", scriptPath: c.scriptPath, rootDir: c.rootDir };
    }
  }
  return null;
}

function getUpdateStatusFile() {
  if (process.env.NUVIO_DATA_DIR) return path.join(DATA_DIR, "update-status.json");
  const upd = resolveUpdaterScript();
  if (upd) return path.join(upd.rootDir, ".runtime", "update-status.json");
  return path.join(DATA_DIR, "update-status.json");
}

function writeUpdateStatusFile(obj) {
  const file = getUpdateStatusFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp." + process.pid + "." + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function readUpdateStatus() {
  const curVer = getLocalVersion();
  const fallback = { running: false, stage: "idle", percent: 0, message: "", done: false, error: null, currentVersion: curVer, targetVersion: null, startedAt: null, updatedAt: null };
  try {
    const file = getUpdateStatusFile();
    if (!fs.existsSync(file)) return fallback;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return fallback;
    const out = Object.assign({}, fallback, raw);
    out.currentVersion = curVer;
    if (out.running && out.updatedAt) {
      const age = Date.now() - Date.parse(out.updatedAt);
      if (Number.isFinite(age) && age > 10 * 60 * 1000) {
        out.running = false;
        out.stage = "error";
        out.error = "Update timed out";
      }
    }
    return out;
  } catch {
    return fallback;
  }
}

async function checkRemoteUpdate(force = false) {
  const currentVersion = getLocalVersion();
  const canSelfUpdate = Boolean(resolveUpdaterScript());
  const repoUrl = "https://github.com/" + UPDATE_REPO;
  if (!force && updateCheckCache && (Date.now() - updateCheckCache.at < UPDATE_CHECK_TTL)) {
    const cached = Object.assign({}, updateCheckCache.data, {
      currentVersion,
      canSelfUpdate,
      updateAvailable: updateCheckCache.data.latestVersion ? compareSemver(updateCheckCache.data.latestVersion, currentVersion) > 0 : false,
      cached: true,
    });
    return cached;
  }
  try {
    const verUrl = `https://raw.githubusercontent.com/${UPDATE_REPO}/${UPDATE_BRANCH}/VERSION?t=${Date.now()}`;
    const res = await fetch(verUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Lanettirr-Bridge/" + currentVersion, "Cache-Control": "no-cache" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const latestVersion = (await res.text()).trim().replace(/^v/i, "");
    if (!/^[0-9]+[.][0-9]+(?:[.][0-9]+)?/.test(latestVersion)) throw new Error("Invalid remote VERSION");
    const data = {
      ok: true,
      currentVersion,
      latestVersion,
      updateAvailable: compareSemver(latestVersion, currentVersion) > 0,
      canSelfUpdate,
      repoUrl,
      checkedAt: new Date().toISOString(),
      cached: false,
      error: null,
    };
    updateCheckCache = { at: Date.now(), data };
    return data;
  } catch (e) {
    return {
      ok: false,
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      canSelfUpdate,
      repoUrl,
      checkedAt: new Date().toISOString(),
      cached: false,
      error: (e && e.message) ? String(e.message) : "network_error",
    };
  }
}

function startSelfUpdate(targetVersion) {
  const cur = readUpdateStatus();
  if (cur.running) return { ok: false, status: 409, error: "already_running", update: cur };
  const upd = resolveUpdaterScript();
  if (!upd) return { ok: false, status: 400, error: "updater_not_found" };
  const statusFile = getUpdateStatusFile();
  const curVer = getLocalVersion();
  const cleanTarget = String(targetVersion || "").trim().replace(/^v/i, "");
  const now = new Date().toISOString();
  const initStatus = {
    running: true,
    stage: "starting",
    percent: 5,
    message: "Starting update...",
    done: false,
    error: null,
    currentVersion: curVer,
    targetVersion: cleanTarget || null,
    startedAt: now,
    updatedAt: now,
  };
  writeUpdateStatusFile(initStatus);
  updateCheckCache = null;
  const { spawn } = require("child_process");
  let cmd, args;
  if (upd.type === "ps1") {
    const sysPs = path.join(process.env.WINDIR || "C:/Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    cmd = fs.existsSync(sysPs) ? sysPs : "powershell.exe";
    args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", upd.scriptPath, "-FromUi", "-StatusFile", statusFile, "-Repo", UPDATE_REPO, "-Branch", UPDATE_BRANCH];
    if (cleanTarget) args.push("-TargetVersion", cleanTarget);
  } else {
    cmd = "bash";
    args = [upd.scriptPath, "--from-ui", "--status-file", statusFile, "--repo", UPDATE_REPO, "--branch", UPDATE_BRANCH];
    if (cleanTarget) args.push("--target-version", cleanTarget);
  }
  try {
    const child = spawn(cmd, args, { cwd: upd.rootDir, detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", (err) => {
      try {
        writeUpdateStatusFile(Object.assign({}, initStatus, { running: false, stage: "error", error: String(err && err.message ? err.message : err), updatedAt: new Date().toISOString() }));
      } catch {}
    });
    child.unref();
    return { ok: true, status: 200, started: true, update: initStatus };
  } catch (err) {
    const errObj = Object.assign({}, initStatus, { running: false, stage: "error", error: String(err && err.message ? err.message : err), updatedAt: new Date().toISOString() });
    try { writeUpdateStatusFile(errObj); } catch {}
    return { ok: false, status: 500, error: errObj.error, update: errObj };
  }
}

// ---- CloudStream 3 (.cs3) Self-Hosted Repository & Bridge ----
const CS3_DEX_PATH = path.join(__dirname, "cs3", "classes.dex");
let cs3DexCache = null;
const cs3PkgCache = new Map();
let cs3IconPngCache = null;

const CS3_CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function cs3Crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CS3_CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildDeterministicZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = 0x0000;
  const dosDate = 0x5421;
  for (const ent of entries) {
    const nameBuf = Buffer.from(ent.name, "utf8");
    const dataBuf = Buffer.isBuffer(ent.data) ? ent.data : Buffer.from(ent.data);
    const crc = cs3Crc32(dataBuf);
    const size = dataBuf.length;
    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    nameBuf.copy(lh, 30);
    locals.push(lh, dataBuf);
    const ch = Buffer.alloc(46 + nameBuf.length);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(size, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    nameBuf.copy(ch, 46);
    centrals.push(ch);
    offset += lh.length + dataBuf.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

function buildCs3IconPng() {
  if (cs3IconPngCache) return cs3IconPngCache;
  const w = 64, h = 64;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 4;
      const dx = Math.abs(x - 31.5), dy = Math.abs(y - 31.5);
      const corner = Math.max(0, dx - 20) ** 2 + Math.max(0, dy - 20) ** 2;
      if (corner > 144) { raw[p] = 0; raw[p+1] = 0; raw[p+2] = 0; raw[p+3] = 0; continue; }
      const inL = (x >= 20 && x <= 29 && y >= 15 && y <= 49) || (x >= 20 && x <= 45 && y >= 40 && y <= 49);
      if (inL) { raw[p] = 248; raw[p+1] = 250; raw[p+2] = 252; raw[p+3] = 255; }
      else {
        const t = (x + y) / (w + h);
        raw[p] = Math.round(18 + t * 38);
        raw[p+1] = Math.round(24 + t * 44);
        raw[p+2] = Math.round(58 + t * 145);
        raw[p+3] = 255;
      }
    }
  }
  const chunk = (type, data) => {
    const tBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(cs3Crc32(Buffer.concat([tBuf, data])), 0);
    return Buffer.concat([len, tBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  cs3IconPngCache = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return cs3IconPngCache;
}

function cs3VersionInt() {
  const v = String(getLocalVersion() || "1.0.0").replace(/^v/i, "").split(".").map(n => parseInt(n, 10) || 0);
  const num = (v[0] || 0) * 10000 + (v[1] || 0) * 100 + (v[2] || 0);
  return num > 0 ? num : 1;
}

function cs3LangCode(langs) {
  if (!Array.isArray(langs) || langs.length !== 1) return "uni";
  const raw = String(langs[0] || "").toLowerCase().trim();
  if (!raw) return "uni";
  if (raw === "yue") return "zh";
  const base = raw.split(/[_-]/)[0];
  return /^[a-z]{2,3}$/.test(base) ? base : "uni";
}

function loadCs3DexBuffer() {
  try {
    const st = fs.statSync(CS3_DEX_PATH);
    if (cs3DexCache && cs3DexCache.mtimeMs === st.mtimeMs && cs3DexCache.size === st.size) return cs3DexCache.buf;
    const buf = fs.readFileSync(CS3_DEX_PATH);
    cs3DexCache = { mtimeMs: st.mtimeMs, size: st.size, buf };
    cs3PkgCache.clear();
    return buf;
  } catch { return null; }
}

function escapeJavaPropValue(v) {
  return String(v || "").replace(/[\r\n]+/g, "").replace(/\\/g, "\\\\");
}

function buildCs3Package(baseUrl, cfg) {
  const dexBuf = loadCs3DexBuffer();
  if (!dexBuf) return null;
  const ordered = orderHubLangs(cfg);
  const lang = cs3LangCode(ordered);
  const ver = cs3VersionInt();
  const cleanBase = String(baseUrl || "").replace(/\/+$/, "");
  const key = cleanBase + "|" + lang + "|" + ver;
  const hit = cs3PkgCache.get(key);
  if (hit) return hit;
  const manifestJson = JSON.stringify({
    name: "Lanettirr",
    pluginClassName: "com.lanettirr.LanettirrPlugin",
    requiresResources: false,
    version: ver,
  }, null, 2);
  const propsText = [
    "baseUrl=" + escapeJavaPropValue(cleanBase),
    "lang=" + escapeJavaPropValue(lang),
    "name=Lanettirr",
  ].join("\n") + "\n";
  const zipBuf = buildDeterministicZip([
    { name: "classes.dex", data: dexBuf },
    { name: "manifest.json", data: Buffer.from(manifestJson, "utf8") },
    { name: "lanettirr.properties", data: Buffer.from(propsText, "utf8") },
  ]);
  cs3PkgCache.set(key, zipBuf);
  capMap(cs3PkgCache, 64);
  return zipBuf;
}

function cs3QualityInt(resLabel) {
  const m = String(resLabel || "").match(/(\d{3,4})p/i);
  if (m) return parseInt(m[1], 10) || 400;
  if (/4k|uhd/i.test(String(resLabel || ""))) return 2160;
  if (/2k/i.test(String(resLabel || ""))) return 1440;
  return 400;
}

function cs3LinkType(urlStr, isHls) {
  const u = String(urlStr || "");
  if (isHls || /\.m3u8(?:\?|$)/i.test(u)) return "M3U8";
  if (/\.mpd(?:\?|$)/i.test(u)) return "DASH";
  return "VIDEO";
}

const server = http.createServer(async (req, res) => {
 try {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type' });
    res.end();
    return;
  }

  const url = req.url.split('?')[0];
  if (url === '/health' && (req.method === 'GET' || req.method === 'HEAD')) {
    json(res, 200, { ok: true, version: getLocalVersion(), uptimeSec: Math.round(process.uptime()), providersLoaded: Array.isArray(providers) ? providers.length : 0, port: PORT });
    return;
  }
  if (url === '/badges.json' && (req.method === 'GET' || req.method === 'HEAD')) {
    try {
      const raw = fs.readFileSync(path.join(__dirname, 'badges-custom.json'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' });
      res.end(req.method === 'HEAD' ? undefined : raw);
    } catch {
      json(res, 404, { error: 'badges-custom.json not found' });
    }
    return;
  }
  if (url.startsWith('/m/') || url.startsWith('/play/') || (url.startsWith('/p/') && process.env.DEBUG_PROXY_LOG === '1')) {
    console.log('REQ ' + new Date().toISOString().slice(11, 19) + ' ' + url.slice(0, 70) + ' range=' + (req.headers.range || '-') + ' ua=' + String(req.headers['user-agent'] || '-').slice(0, 40));
  }

  const proto = req.headers["x-forwarded-proto"] || "http";
  const origin = proto + "://" + (req.headers.host || ("127.0.0.1:" + PORT));
  if (url === "/api/save-config" && req.method === "POST") {
    try {
      const parsed = await readJsonBody(req, 65536);
      if (!parsed || typeof parsed !== "object" || typeof parsed.cfg !== "string") {
        json(res, 400, { ok: false, error: "Missing string cfg" });
        return;
      }
      const saved = saveConfigStr(parsed.cfg);
      json(res, 200, { ok: true, cfg: saved, url: origin + "/saved/nuvio-repo/manifest.json", stremioUrl: origin + "/saved/manifest.json", cs3Url: origin + "/saved/cs3/repo.json" });
    } catch (e) {
      json(res, e?.status || 400, { ok: false, error: e?.message || "Bad request" });
    }
    return;
  }
  if (url === "/api/saved-config") {
    json(res, 200, { ok: true, cfg: loadSavedConfigStr() });
    return;
  }
  if (url === "/api/repo-sources") {
    const q = new URL(req.url, origin).searchParams;
    const sources = await getSourcesForRepo(q.get("lang"), q.get("repo"));
    json(res, 200, { ok: true, sources });
    return;
  }
  if (url === "/api/blacklist" && req.method === "GET") {
    json(res, 200, { ok: true, items: loadBlacklist() });
    return;
  }
  if (url === "/api/blacklist/add" && req.method === "POST") {
    try {
      const p = await readJsonBody(req, 65536);
      const items = addBlacklistEntry({ mediaKey: p.mediaKey || "*", mediaLabel: p.mediaLabel || p.mediaKey || "*", provider: p.provider || "", url: p.url || "", reason: "manual" });
      json(res, 200, { ok: true, items });
    } catch (e) {
      json(res, e?.status || 400, { ok: false, error: e?.message || "Bad request" });
    }
    return;
  }
  if (url === "/api/blacklist/remove" && req.method === "POST") {
    try {
      const p = await readJsonBody(req, 65536);
      json(res, 200, { ok: true, items: removeBlacklistEntry(p.id) });
    } catch (e) {
      json(res, e?.status || 400, { ok: false, error: e?.message || "Bad request" });
    }
    return;
  }
  if (url === "/api/blacklist/clear" && req.method === "POST") {
    json(res, 200, { ok: true, items: clearBlacklist() });
    return;
  }
  if (url === "/api/update/check" && req.method === "GET") {
    let force = false;
    try {
      const f = new URL(req.url, origin).searchParams.get("force");
      force = (f === "1" || f === "true");
    } catch {}
    const info = await checkRemoteUpdate(force);
    json(res, 200, info);
    return;
  }
  if (url === "/api/update/status" && req.method === "GET") {
    json(res, 200, Object.assign({ ok: true, canSelfUpdate: Boolean(resolveUpdaterScript()) }, readUpdateStatus()));
    return;
  }
  if (url === "/api/update/start" && req.method === "POST") {
    let targetVersion = "";
    try {
      const p = await readJsonBody(req, 8192);
      if (p && typeof p === "object" && typeof p.targetVersion === "string") targetVersion = p.targetVersion;
    } catch {}
    const r = startSelfUpdate(targetVersion);
    json(res, r.status || 200, r);
    return;
  }
  const playM = url.match(/^\/play\/([a-z0-9_]+)\/(\d+)\/s\.(m3u8|mp4)$/i);
  if (playM) {
    const plan = playPlans.get(playM[1]);
    const slotIdx = parseInt(playM[2], 10) || 0;
    const list = plan && plan.slots ? plan.slots[slotIdx] : null;
    if (!plan || !Array.isArray(list) || !list.length) { json(res, 404, { error: "play plan expired" }); return; }
    const fbtoMs = (plan.fbto || 15) * 1000;
    plan.resolved = plan.resolved || {};
    plan.inflight = plan.inflight || {};
    const resolveSlot = async () => {
      const rec = plan.resolved[slotIdx];
      const cached = (rec && Date.now() - rec.at < 180000) ? rec : null;
      if (rec && !cached) delete plan.resolved[slotIdx];
      const tryList = cached ? [cached.cand, ...list.filter(c => c !== cached.cand)] : list;
      for (let ci = 0; ci < tryList.length; ci++) {
        const cand = tryList[ci];
        const isCached = !!(cached && cand === cached.cand);
        if (isBlacklisted(plan.mediaKey, { url: cand.url, name: cand.provider })) continue;
        if (!isAllowedProxyUrl(cand.url)) {
          console.log("[FAILOVER] Blacklisted " + plan.mediaKey + " | " + cand.provider + " (blocked_url) -> next candidate");
          addBlacklistEntry({ mediaKey: plan.mediaKey, mediaLabel: plan.mediaLabel, provider: cand.provider, url: cand.url, reason: "auto_error" });
          continue;
        }
        const chk = isCached ? { ok: true, isHls: !!cached.isHls } : await verifyStreamReady(cand, fbtoMs);
        if (chk.ok) {
          plan.resolved[slotIdx] = { cand, isHls: chk.isHls, at: Date.now() };
          if (!isCached) console.log("[FAILOVER] OK " + plan.mediaKey + " | " + cand.provider + (ci > 0 ? (" (fallback #" + ci + ")") : ""));
          return { cand, isHls: chk.isHls };
        }
        console.log("[FAILOVER] Blacklisted " + plan.mediaKey + " | " + cand.provider + " (" + chk.reason + ") -> next candidate");
        addBlacklistEntry({ mediaKey: plan.mediaKey, mediaLabel: plan.mediaLabel, provider: cand.provider, url: cand.url, reason: chk.timedOut ? "auto_timeout" : "auto_error" });
      }
      return null;
    };
    if (!plan.inflight[slotIdx]) {
      plan.inflight[slotIdx] = resolveSlot().finally(() => { delete plan.inflight[slotIdx]; });
    }
    const win = await plan.inflight[slotIdx];
    if (win) {
      const { cand, isHls } = win;
      const fbMeta = { pid: playM[1], slot: slotIdx, p: cand.provider };
      const effHdrs = ensureBrowserHeaders(cand.headers);
      const needsHeaderProxy = !isHls && cand.headers && Object.keys(cand.headers).length > 0;
      const targetUrl = isHls
        ? proxyUrl(origin, cand.url, effHdrs, "s.m3u8", plan.lang || "", fbMeta)
        : (needsHeaderProxy ? proxyUrl(origin, cand.url, effHdrs, "s.mp4", "", fbMeta) : cand.url);
      res.writeHead(302, { Location: targetUrl, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
      res.end();
      return;
    }
    json(res, 503, { error: "no working candidate" });
    return;
  }
  let cfgRaw = "";
  let routeUrl = url;
  let routePrefix = "";
  const cm = url.match(/^\/c\/([^/]+)(\/.*)$/);
  if (cm) { cfgRaw = cm[1]; routeUrl = cm[2]; routePrefix = "/c/" + cm[1]; }
  else if (url.startsWith("/saved/")) { cfgRaw = loadSavedConfigStr(); routeUrl = url.slice(6); routePrefix = "/saved"; }
  const cfg = parseConfig(cfgRaw);

  if (routeUrl === "/" || routeUrl === "/configure") {
    const uiCfg = cfgRaw ? cfg : parseConfig(loadSavedConfigStr());
    let qUiLang = "";
    try { qUiLang = new URL(req.url, origin).searchParams.get("uilang") || ""; } catch {}
    const html = renderConfigureHtml(origin, uiCfg, LANG_CATALOG, await buildRepoCatalog(), {
      hasUrlCfg: Boolean(cfgRaw),
      acceptLanguage: String(req.headers["accept-language"] || ""),
      uiLang: qUiLang,
      appVersion: getLocalVersion(),
    });
    const etag = 'W/"' + crypto.createHash("sha1").update(html).digest("hex") + '"';
    const baseHdrs = {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
      "ETag": etag,
      "Vary": "Accept-Encoding, Accept-Language",
    };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, baseHdrs);
      res.end();
      return;
    }
    if (/\bgzip\b/i.test(String(req.headers["accept-encoding"] || ""))) {
      const gz = zlib.gzipSync(Buffer.from(html, "utf8"));
      res.writeHead(200, { ...baseHdrs, "Content-Encoding": "gzip", "Content-Length": gz.length });
      res.end(gz);
      return;
    }
    const rawBuf = Buffer.from(html, "utf8");
    res.writeHead(200, { ...baseHdrs, "Content-Length": rawBuf.length });
    res.end(rawBuf);
    return;
  }

  if (routeUrl === "/manifest.json") {
    await ensureProviders();
    if (!stremioMeta) { json(res, 503, { error:"Loading providers, retry in 30s" }); return; }
    if (cfgRaw) { json(res, 200, manifestForConfig(cfg)); return; }
    json(res, 200, { ...stremioMeta, behaviorHints: { configurable: true, configurationRequired: false } });
    return;
  }

  if (routeUrl === "/nuvio-repo/manifest.json") {
    json(res, 200, buildNuvioRepoManifest(cfg));
    return;
  }

  if (routeUrl === "/cs3/icon.png" && (req.method === "GET" || req.method === "HEAD")) {
    const png = buildCs3IconPng();
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length, "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400" });
    res.end(req.method === "HEAD" ? undefined : png);
    return;
  }

  if (routeUrl === "/cs3/repo.json" && (req.method === "GET" || req.method === "HEAD")) {
    const cs3Prefix = routePrefix || "/saved";
    const payload = {
      iconUrl: origin + "/cs3/icon.png",
      name: "Lanettirr",
      description: "Self-hosted Lanettirr multi-language VOD bridge for CloudStream 3",
      manifestVersion: 1,
      pluginLists: [origin + cs3Prefix + "/cs3/plugins.json"],
    };
    const body = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : body);
    return;
  }

  if (routeUrl === "/cs3/plugins.json" && (req.method === "GET" || req.method === "HEAD")) {
    const cs3Prefix = routePrefix || "/saved";
    const effCfg = routePrefix ? cfg : parseConfig(loadSavedConfigStr());
    const orderedLangs = orderHubLangs(effCfg);
    const pkg = buildCs3Package(origin + cs3Prefix, effCfg);
    const payload = [{
      url: origin + cs3Prefix + "/cs3/Lanettirr.cs3",
      status: pkg ? 1 : 0,
      version: cs3VersionInt(),
      apiVersion: 1,
      name: "Lanettirr",
      internalName: "Lanettirr",
      authors: ["Lanettirr"],
      description: "Lanettirr self-hosted multi-language VOD bridge (" + orderedLangs.map(x => x.toUpperCase()).join(", ") + ")",
      repositoryUrl: "https://github.com/0mamiis/lanettirr",
      tvTypes: ["Movie", "TvSeries", "Anime", "AnimeMovie", "AsianDrama"],
      language: cs3LangCode(orderedLangs),
      iconUrl: origin + "/cs3/icon.png",
      fileSize: pkg ? pkg.length : 0,
    }];
    const body = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : body);
    return;
  }

  if (/^\/cs3\/lanettirr\.cs3$/i.test(routeUrl) && (req.method === "GET" || req.method === "HEAD")) {
    const cs3Prefix = routePrefix || "/saved";
    const effCfg = routePrefix ? cfg : parseConfig(loadSavedConfigStr());
    const pkg = buildCs3Package(origin + cs3Prefix, effCfg);
    if (!pkg) { json(res, 503, { error: "CS3 classes.dex not found" }); return; }
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="Lanettirr.cs3"',
      "Content-Length": pkg.length,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : pkg);
    return;
  }

  if (routeUrl === "/cs3/streams" && req.method === "GET") {
    await ensureProviders();
    try {
      const q = new URL(req.url, origin).searchParams;
      const mt = (q.get("type") || "movie").toLowerCase();
      const stType = (mt === "tv" || mt === "series") ? "series" : "movie";
      const tmdb = (q.get("tmdb") || "").trim();
      const imdb = (q.get("imdb") || "").trim();
      const se = parseInt(q.get("s") || "1", 10) || 1;
      const ep = parseInt(q.get("e") || "1", 10) || 1;
      if (!tmdb && !imdb) { json(res, 200, { streams: [], subtitles: [] }); return; }
      const effCfg = routePrefix ? cfg : parseConfig(loadSavedConfigStr());
      const orderedLangs = orderHubLangs(effCfg);
      const idBase = tmdb ? ("tmdb:" + tmdb) : imdb;
      const sid = stType === "series" ? (idBase + ":" + se + ":" + ep) : idBase;
      const mediaKey = stType + "|" + sid;
      const list = await getStreamsCached(stType, sid, orderedLangs, effCfg.timeoutSec, effCfg.disabledRepos, effCfg.disabledProvs);
      const picked = await enrichAndApplyStreamControls(list, effCfg, stType === "series", { slug: orderedLangs.length === 1 ? orderedLangs[0] : "", mediaKey });
      let planId = null;
      if (effCfg.failover && picked.length) {
        planId = "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
        const allVer = Array.isArray(picked._allVerified) ? picked._allVerified : picked;
        const toCand = (x) => ({ url: x.url, headers: x.behaviorHints?.proxyHeaders?.request || {}, isHls: !!x._needsProxy || isLikelyHlsUrl(x.url), provider: streamProviderName(x), res: x._realRes || detectResolution(x.name) || "720p" });
        const slots = picked.map(prim => {
          const pRes = prim._realRes || detectResolution(prim.name) || "720p";
          const pRank = RES_RANK[pRes] ?? 3;
          const rest = allVer.filter(x => x.url !== prim.url).slice().sort((a, b) => {
            const ra = RES_RANK[a._realRes || detectResolution(a.name) || "720p"] ?? 3;
            const rb = RES_RANK[b._realRes || detectResolution(b.name) || "720p"] ?? 3;
            return Math.abs(ra - pRank) - Math.abs(rb - pRank);
          }).slice(0, 12);
          return [toCand(prim), ...rest.map(toCand)];
        });
        const cacheType = stType === "series" ? "tv" : "movie";
        const tc = titleCache.get(cacheType + ":" + (tmdb || imdb)) || titleCache.get(cacheType + ":" + sid);
        const tName = typeof tc === "string" ? tc : (tc?.title || tc?.name || q.get("title") || sid);
        const mediaLabel = tName + (stType === "series" ? (" S" + se + "E" + ep) : "");
        playPlans.set(planId, { t: Date.now(), mediaKey, mediaLabel, lang: orderedLangs[0] || "", fbto: effCfg.failoverSec || 15, slots });
        capMap(playPlans, 200);
      }
      const subSeen = new Set();
      const cs3Subs = [];
      const cs3Streams = picked.map((s, idx) => {
        if (Array.isArray(s.subtitles)) {
          for (const sb of s.subtitles) {
            const su = String(sb && sb.url || "").trim();
            if (!su || subSeen.has(su)) continue;
            subSeen.add(su);
            cs3Subs.push({ lang: String(sb.lang || sb.label || "Subtitle"), url: su });
          }
        }
        const disp = buildVerifiedStreamDisplay(s, "Lanettirr");
        const reqHdrs = s.behaviorHints?.proxyHeaders?.request || {};
        const isHlsPlay = !!s._needsProxy || isLikelyHlsUrl(s.url);
        const finalUrl = planId ? (origin + "/play/" + planId + "/" + idx + (isHlsPlay ? "/s.m3u8" : "/s.mp4")) : (s._needsProxy ? proxyUrl(origin, s.url, reqHdrs, "s.m3u8", s._hubLang || orderedLangs[0] || "") : s.url);
        const directHdrs = (planId || s._needsProxy) ? {} : reqHdrs;
        const ref = directHdrs.Referer || directHdrs.referer || "";
        const line1 = String(disp.title || "").split("\n")[0] || disp.res || "";
        const label = [disp.name, line1].filter(Boolean).join(" · ");
        return {
          source: disp.name || "Lanettirr",
          name: label || disp.name || "Lanettirr",
          url: finalUrl,
          referer: ref,
          quality: cs3QualityInt(disp.res || s._realRes || detectResolution(s.name)),
          type: cs3LinkType(finalUrl, isHlsPlay),
          headers: directHdrs,
        };
      });
      json(res, 200, { streams: cs3Streams, subtitles: cs3Subs });
      console.log("[CS3] " + mediaKey + " langs=" + orderedLangs.join(",") + " streams=" + cs3Streams.length + " fb=" + (effCfg.failover ? ("1(" + effCfg.failoverSec + "s)") : "0"));
    } catch (e) {
      console.error("CS3 streams error:", e.message);
      json(res, 200, { streams: [], subtitles: [] });
    }
    return;
  }

  const nrp = routeUrl.match(/^\/nuvio-repo\/p\/([a-z0-9_]+)\.js$/i);
  if (nrp) {
    const prefix = routePrefix;
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end(buildNuvioScraperJs(origin, prefix, nrp[1]));
    return;
  }

  const nrh = routeUrl.match(/^\/nuvio-repo\/hub\/([a-z0-9_]+)$/i);
  if (nrh) {
    await ensureProviders();
    let seqGate = null;
    let slug = nrh[1].toLowerCase();
    try {
      const q = new URL(req.url, origin).searchParams;
      const tmdbId = (q.get("tmdbId") || "").trim();
      const mt = (q.get("mediaType") || "movie").toLowerCase();
      const stType = (mt === "tv" || mt === "series") ? "series" : "movie";
      const se = parseInt(q.get("season") || "1", 10) || 1;
      const ep = parseInt(q.get("episode") || "1", 10) || 1;
      if (!tmdbId) { json(res, 200, []); return; }
      const idBase = /^tt\d+$/i.test(tmdbId) ? tmdbId : ("tmdb:" + tmdbId);
      const sid = stType === "series" ? (idBase + ":" + se + ":" + ep) : idBase;
      const prefix = routePrefix;
      const effCfg = (() => {
        const keys = ["quals", "qlm", "qlim", "qmap", "hublim", "ssort", "to"];
        let hasOv = false;
        for (const k of keys) { if (q.has(k)) { hasOv = true; break; } }
        if (!hasOv) return cfg;
        const params = new URLSearchParams(cfg.raw || "");
        if (!cfg.raw && !params.has("langs")) params.set("langs", cfg.langs.join(","));
        for (const k of keys) {
          if (q.has(k)) params.set(k, q.get(k));
        }
        return parseConfig(params.toString());
      })();
      const hubOrder = orderHubLangs(effCfg);
      seqGate = effCfg.hubSeq ? getHubSeqGate(prefix + "|" + stType + "|" + sid, slug) : null;
      if (seqGate) seqGate.seen.add(slug);
      const sendOrdered = async (payload) => {
        if (seqGate) { await waitHubTurn(seqGate, slug, hubOrder); markHubDone(seqGate, slug); }
        json(res, 200, payload);
      };
      if (!LANG_CATALOG[slug]) { json(res, 200, []); return; }
      const list = await getStreamsCached(stType, sid, [slug], effCfg.timeoutSec, effCfg.disabledRepos, effCfg.disabledProvs);
      const mediaKey = stType + "|" + sid;
      const picked = await enrichAndApplyStreamControls(list, effCfg, stType === "series", { slug, mediaKey });
      let planId = null;
      if (effCfg.failover && picked.length) {
        planId = "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
        const allVer = Array.isArray(picked._allVerified) ? picked._allVerified : picked;
        const toCand = (x) => ({ url: x.url, headers: x.behaviorHints?.proxyHeaders?.request || {}, isHls: !!x._needsProxy || isLikelyHlsUrl(x.url), provider: streamProviderName(x), res: x._realRes || detectResolution(x.name) || "720p" });
        const slots = picked.map(prim => {
          const pRes = prim._realRes || detectResolution(prim.name) || "720p";
          const pRank = RES_RANK[pRes] ?? 3;
          const rest = allVer.filter(x => x.url !== prim.url).slice().sort((a, b) => {
            const ra = RES_RANK[a._realRes || detectResolution(a.name) || "720p"] ?? 3;
            const rb = RES_RANK[b._realRes || detectResolution(b.name) || "720p"] ?? 3;
            return Math.abs(ra - pRank) - Math.abs(rb - pRank);
          }).slice(0, 12);
          return [toCand(prim), ...rest.map(toCand)];
        });
        const cacheType = stType === "series" ? "tv" : "movie";
        const tc = titleCache.get(cacheType + ":" + tmdbId) || titleCache.get(cacheType + ":" + sid);
        const tName = typeof tc === "string" ? tc : (tc?.title || tc?.name || sid);
        const mediaLabel = tName + (stType === "series" ? (" S" + se + "E" + ep) : "");
        playPlans.set(planId, { t: Date.now(), mediaKey, mediaLabel, lang: slug, fbto: effCfg.failoverSec || 15, slots });
        capMap(playPlans, 200);
      }
      const out = picked.map((s, idx) => {
          const disp = buildVerifiedStreamDisplay(s, slug.toUpperCase() + " Hub");
          const reqHdrs = s.behaviorHints?.proxyHeaders?.request || {};
          const isHlsPlay = !!s._needsProxy || isLikelyHlsUrl(s.url);
          const finalUrl = planId ? (origin + "/play/" + planId + "/" + idx + (isHlsPlay ? "/s.m3u8" : "/s.mp4")) : (s._needsProxy ? proxyUrl(origin, s.url, reqHdrs, "s.m3u8", slug) : s.url);
          return {
            name: zwSortPrefix(idx) + disp.name,
            title: disp.title,
            quality: disp.quality,
            url: finalUrl,
            headers: (planId || s._needsProxy) ? {} : reqHdrs,
          };
        });
      await sendOrdered(out);
      console.log("[HUB] " + slug + " " + mediaKey + " streams=" + out.length + " fb=" + (effCfg.failover ? ("1(" + effCfg.failoverSec + "s)") : "0"));
    } catch (e) {
      if (seqGate) markHubDone(seqGate, slug);
      console.error("Nuvio repo hub error:", e.message);
      json(res, 200, []);
    }
    return;
  }

  const m = routeUrl.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
  if (m) {
    await ensureProviders();
    if (!providers?.length) { json(res, 200, { streams:[] }); return; }
    try {
      const sid = decodeURIComponent(m[2]);
      const list = await getStreamsCached(m[1], sid, cfg.langs, cfg.timeoutSec, cfg.disabledRepos, cfg.disabledProvs);
      if (cfg.mode === "direct") {
        const direct = applyStreamControls(list, cfg);
        if (direct.length) {
          const isTv = m[1] === "series";
          const toEnrich = direct.slice(0, 8);
          let budgetTimer;
          const deadline = new Promise(resolve => { budgetTimer = setTimeout(resolve, 3500); });
          try {
            await Promise.race([
              runPool(toEnrich, 4, async (s) => {
                const met = await probeOneStreamMetric(s, isTv);
                if (met.kbps) s._kbps = met.kbps;
                if (met.latencyMs) s._latencyMs = met.latencyMs;
                if (met.mediaMeta) s._mediaMeta = mergeMediaMeta(s._mediaMeta, met.mediaMeta);
                if (Array.isArray(met.audioLangs) && met.audioLangs.length) s._audioLangs = met.audioLangs;
                if (Array.isArray(met.subLangs) && met.subLangs.length) s._subLangs = met.subLangs;
                const realRes = met.res || met.realRes;
                if (realRes && ALLOWED_RES.has(realRes)) {
                  s._realRes = realRes;
                  applyVerifiedResolution(s, realRes);
                }
              }),
              deadline,
            ]);
          } finally {
            clearTimeout(budgetTimer);
          }
          sortStreamsForCfg(direct, cfg);
          for (const s of direct) {
            const disp = buildVerifiedStreamDisplay(s, "Stream");
            s.name = [disp.res, disp.name].filter(Boolean).join(" · ");
            s.title = disp.title;
          }
        }
        json(res, 200, { streams: direct });
        return;
      }
      const probed = await probeAll(m[1], sid, cfg.langs, cfg.timeoutSec, cfg.disabledRepos, cfg.disabledProvs);
      const byRes = new Map();
      const multiLang = cfg.langs.length > 1;
      for (const p of probed) {
        const real = p.res[0];
        if (!ALLOWED_MEGA_RES.has(real) || !isQualAllowed(real, cfg)) continue;
        const linfo = streamLangInfo(p);
        const bucketKey = multiLang ? (linfo.code + "|" + real) : real;
        const prev = byRes.get(bucketKey);
        if (!prev || betterStream(p, prev) < 0) byRes.set(bucketKey, p);
      }
      const picks = sortAndLimitMegaPicks([...byRes.values()], cfg);
      const megaCards = [];
      const prefix = routePrefix;
      for (const primary of picks) {
        const real = primary.res[0];
        const linfo = streamLangInfo(primary);
        const resName = resDisplay(real);
        const mbps = kbpsLabel(primary.kbps);
        const msText = (Number.isFinite(primary.latencyMs) && primary.latencyMs > 0) ? (primary.latencyMs + " ms") : "";
        const met = [mbps, msText].filter(Boolean).join(" \u00b7 ");
        const quality = [resName, met].filter(Boolean).join(" \u00b7 ");
        const cleanAudio = cleanAudioLabels(primary.audio, primary.s.name);
        const provider = primary.s.name.split("\u00b7").pop().trim();
        const cardTitle = multiLang ? ("Mega \u00b7 " + linfo.label + " \u00b7 " + quality) : ("Mega - " + quality);
        const mSuffix = multiLang ? ("~" + linfo.code + "~" + real) : ("~" + real);
        megaCards.push({
          name: cardTitle,
          title: cardTitle,
          description: "Ses: " + cleanAudio.join(" / ") + "\nKalite: " + resName + (mbps ? "\nBitrate: " + mbps : "") + (msText ? "\nH\u0131z: " + msText : "") + "\nKaynak: " + provider,
          url: origin + prefix + "/m/" + m[1] + "/" + encodeURIComponent(sid) + mSuffix + ".m3u8",
          behaviorHints: { filename: ["Mega", quality, ...megaTags([primary.s]), ...cleanAudio, provider].join(" \u00b7 ") },
        });
      }
      json(res, 200, { streams: megaCards });
    } catch (e) {
      console.error("Stream error:", e.message);
      json(res, 200, { streams:[] });
    }
    return;
  }

  const pm = routeUrl.match(/^\/p\/([^/]+)\//);
  if (pm) { await handleProxy(req, res, pm[1]); return; }

  const mm = routeUrl.match(/^\/m\/(movie|series)\/(.+?)(?:~([a-z_]+))?(?:~(\d+p))?\.m3u8$/);
  if (mm) {
    await ensureProviders();
    try {
      const pl = await buildMaster(mm[1], decodeURIComponent(mm[2]), origin, mm[4] || "", cfg.langs, mm[3] || "", cfg.timeoutSec, cfg.disabledRepos, cfg.disabledProvs);
      if (!pl) { json(res, 404, { error: "no hls" }); return; }
      sendBuf(req, res, Buffer.from(pl, "utf8"), "application/vnd.apple.mpegurl");
    } catch (e) { json(res, 500, { error: e.message }); }
    return;
  }

  json(res, 404, { error:'Not found' });
 } catch (e) {
   console.error('Unhandled HTTP error:', e && e.stack ? e.stack : e);
   if (!res.headersSent) {
     json(res, 500, { error: 'Internal server error' });
   } else {
     try { res.end(); } catch {}
   }
 }
});

const onListen = async () => {
  const dispHost = HOST || '127.0.0.1';
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🎬  Lanettirr — Nuvio Mega Bridge');
  console.log(`  📡  http://${dispHost}:${PORT} (HUB_URL=${HUB_URL})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await ensureProviders();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✅  Configure UI : http://${dispHost}:${PORT}/configure`);
  console.log(`  ✅  Nuvio Repo   : http://${dispHost}:${PORT}/saved/nuvio-repo/manifest.json`);
  console.log(`  ✅  Badges JSON  : http://${dispHost}:${PORT}/badges.json`);
  console.log(`  ✅  Stremio      : http://${dispHost}:${PORT}/saved/manifest.json`);
  console.log(`  ✅  CloudStream  : http://${dispHost}:${PORT}/saved/cs3/repo.json`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
};
if (HOST) server.listen(PORT, HOST, onListen);
else server.listen(PORT, onListen);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`❌  Port ${PORT} in use`);
  else console.error('Server error:', e);
  process.exit(1);
});
