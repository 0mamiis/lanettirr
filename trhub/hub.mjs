// TR Hub: Turk CS3 + Nuvio saglayicilarini birlestirir, TorrentLIO kaynagini ekler, Torrentio tarzi ayar sayfasi sunar.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScraper } from '../kraptor-bridge/nuvio-host.mjs';
import { loadScrapers, cachedText } from '../kraptor-bridge/plugins.mjs';
import * as bb from '../kraptor-bridge/bigbull.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HUB_PORT || 7100);
const HOST = process.env.HUB_HOST || '127.0.0.1';
const NU_CONC = Number(process.env.NU_CONC || 0); let nuActive = 0; const nuQ = [];
const limitRun = (fn) => NU_CONC <= 0 ? fn() : new Promise((res, rej) => { const go = () => { nuActive++; fn().then(res, rej).finally(() => { nuActive--; const n = nuQ.shift(); if (n) n(); }); }; if (nuActive < NU_CONC) go(); else nuQ.push(go); });
const BRIDGE_ORIGIN = process.env.BRIDGE_ORIGIN || 'http://127.0.0.1:7000';
const SETTINGS = path.join(HERE, 'settings.json');
const LOG = path.join(HERE, 'hub.log');
const CS_HOST = process.env.BB_HOST || 'http://127.0.0.1:7200';
const CS_REPOS_FILE = path.join(HERE, '..', 'cs-host', 'repos.txt');
const TMDB = process.env.TMDB_API_KEY || '8265bd1679663a7ea12ac168da84d2e8';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const JSON_H = { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8' };
const TTL = 30 * 60 * 1000;
process.on('uncaughtException', (e) => { try { fs.appendFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'hub.log'), new Date().toISOString() + ' uncaught ' + (e && e.stack || e) + '\n'); } catch {} });
process.on('unhandledRejection', (e) => { try { fs.appendFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'hub.log'), new Date().toISOString() + ' unhandled ' + (e && e.stack || e) + '\n'); } catch {} });

export const TORRENTIO_PROVIDERS = ['yts', 'eztv', 'rarbg', '1337x', 'thepiratebay', 'kickasstorrents', 'torrentgalaxy', 'magnetdl', 'horriblesubs', 'nyaasi', 'tokyotosho', 'anidex', 'rutor', 'rutracker', 'comando', 'bludv', 'micoleaodublado', 'torrent9', 'ilcorsaronero', 'mejortorrent', 'wolfmax4k', 'cinecalidad', 'besttorrents'];
export const QUALITY_FILTERS = ['4k', '1080p', '720p', '480p', 'brremux', 'hdrall', 'dolbyvision', 'dolbyvisionwithhdr', '3d', 'scr', 'cam', 'unknown'];
export const TORRENTIO_SORT = { qualitysize: 'Kalite, sonra boyut', quality: 'Kalite', seeders: 'Seeder sayisi', size: 'Boyut' };
const DEFAULTS = {
  dedupe: true,
  sort: 'az',            // az | quality
  minRes: 0,             // 0 = hepsi
  hidden: [],            // kapatilan saglayici adlari
  csRepos: [],           // repos.txt'ten gelir
  nuvioRepos: [],        // { url, enabled }
  torrentlio: { enabled: false, mode: 'mux', maxDubs: 8, base: 'https://torrentio.strem.fun', providers: ['yts', 'eztv', '1337x', 'thepiratebay', 'torrentgalaxy', 'nyaasi'], sort: 'qualitysize', qualityfilter: ['scr', 'cam', '480p'], limit: 3, language: '', maxStreams: 24 },
};
const log = (...a) => { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n'); } catch {} };

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch {}
  const out = { ...DEFAULTS, ...s, torrentlio: { ...DEFAULTS.torrentlio, ...(s.torrentlio || {}) } };
  try { out.csRepos = fs.readFileSync(CS_REPOS_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => ({ url: l.replace(/^#\s*/, ''), enabled: !l.startsWith('#') })); } catch {}
  return out;
}
function saveSettings(s) {
  const { csRepos, ...rest } = s;
  fs.writeFileSync(SETTINGS, JSON.stringify(rest, null, 2));
  if (csRepos) fs.writeFileSync(CS_REPOS_FILE, csRepos.map((r) => (r.enabled ? '' : '# ') + r.url).join('\n') + '\n');
}

// ---------- meta ----------
const TRHUB_PREFETCH = process.env.TRHUB_PREFETCH === '1';
const TRHUB_SPEED_PROBE = process.env.TRHUB_SPEED_PROBE === '1';
function capMap(m, max) { while (m.size > max) m.delete(m.keys().next().value); }
const metaCache = new Map();
async function metaFor(type, imdb) {
  if (metaCache.has(imdb)) return metaCache.get(imdb);
  const f = (u) => fetch(u, { signal: AbortSignal.timeout(12000) }).then((r) => r.json());
  const [cin, tm] = await Promise.all([
    f('https://v3-cinemeta.strem.io/meta/' + (type === 'series' ? 'series' : 'movie') + '/' + imdb + '.json').catch(() => ({})),
    f('https://api.themoviedb.org/3/find/' + imdb + '?external_source=imdb_id&language=tr-TR&api_key=' + TMDB).catch(() => ({})),
  ]);
  const t = (type === 'series' ? tm.tv_results : tm.movie_results)?.[0] || {};
  const m = {
    name: cin.meta?.name || t.original_name || t.original_title || '',
    tr: t.name || t.title || '',
    year: parseInt(String(cin.meta?.releaseInfo || t.first_air_date || t.release_date || '').slice(0, 4)) || 0,
    tmdbId: t.id || null,
  };
  metaCache.set(imdb, m);
  capMap(metaCache, 300);
  return m;
}

// ---------- provider helpers ----------
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();
const resOf = (t) => { const m = String(t || '').match(/(\d{3,4})p|\b(4k|2160|1440|2k)\b/i); if (!m) return 0; if (m[1]) return +m[1]; const k = m[2].toLowerCase(); return k === '4k' || k === '2160' ? 2160 : 1440; };
const resLabel = (r) => (r >= 2160 ? '4K' : r >= 1440 ? '2K' : r ? r + 'p' : '');
const langOf = (t) => { const x = norm(t); if (/dual|cift ses/.test(x)) return 'Çift Ses'; if (/dublaj|dubbed|turkce ses|tr dub/.test(x)) return 'TR Dublaj'; if (/altyaz|subtitle|\bsub\b/.test(x)) return 'TR Altyazı'; return ''; };
const px = (u, h = {}) => BRIDGE_ORIGIN + '/px?u=' + encodeURIComponent(u) + '&r=' + encodeURIComponent(h.Referer || h.referer || '') + '&o=' + encodeURIComponent(h.Origin || h.origin || '');
const pxExtra = (u, r, o) => BRIDGE_ORIGIN + '/px?u=' + encodeURIComponent(u) + '&r=' + encodeURIComponent(r || '') + '&o=' + encodeURIComponent(o || '');

export function innerUrl(url) { try { const u = new URL(url); if (u.pathname === '/px' || u.pathname.startsWith('/tx/')) return u.searchParams.get('u') || url; } catch {} return url; }

let nuvioCache = { t: 0, repos: '', v: [] };
function nuvioScrapers(st) {
  const repos = (st.nuvioRepos || []).filter((r) => r.enabled).map((r, i) => ({ id: 'nr' + i, group: 'tr', url: r.url }));
  const key = JSON.stringify(repos);
  if (Date.now() - nuvioCache.t < 5 * 60 * 1000 && nuvioCache.repos === key) return nuvioCache.v;
  let v = [];
  try { v = loadScrapers(repos); } catch (e) { log('loadScrapers', e.message); }
  nuvioCache = { t: Date.now(), repos: key, v };
  return v;
}

export async function listProviders(st) {
  const out = [];
  try { const j = await (await fetch(CS_HOST + '/providers', { signal: AbortSignal.timeout(8000) })).json(); for (const p of j) if (p.status !== 0) out.push({ name: p.name, kind: 'cs3', lang: p.lang || '', ok: p.ok, fail: p.fail }); } catch {}
  for (const s of nuvioScrapers(st)) out.push({ name: s.name, kind: 'nuvio', lang: '', repo: s.repo });
  return out;
}

async function csStreams(type, m, season, episode, st, sink) {
  const hidden = new Set(st.hidden);
  const all = await bb.providers().catch(() => []);
  const only = all.filter((p) => !hidden.has(p.name)).map((p) => p.name);
  if (!only.length) return;
  const tmp = [];
  tmp.push = (...a) => { for (const s of a) sink.push({ provider: providerOf(s), kind: 'cs3', s }); return a.length; };   // gelenler hemen listeye girer
  await bb.get({ type, titles: [...new Set([m.tr, m.name].filter(Boolean))], year: m.year, season, episode, out: tmp, pxUrl: pxExtra, log, only });
}
const providerOf = (s) => { const parts = String(s.name || '').split(' · '); return parts[parts.length - 1]; };

const PROV_FILE = 'provstat.json';
const provStat = new Map((() => { try { return Object.entries(JSON.parse(fs.readFileSync(PROV_FILE, 'utf8'))); } catch { return []; } })());
const provSave = () => { try { fs.writeFileSync(PROV_FILE, JSON.stringify(Object.fromEntries(provStat))); } catch {} };
const provSkip = (n) => { const x = provStat.get(n); if (!x) return false; if (x.until > Date.now()) return true; return (x.runs || 0) >= 6 && !(x.hits) && Date.now() - (x.last0 || 0) < 24 * 3600e3; };   // 6 farkli bolumde hic kaynak getirmeyen: 1 gun atla
const provScore = (n) => { const x = provStat.get(n) || {}; return (x.hits || 0) / Math.max(1, x.runs || 0) * 100 - Math.min(30, (x.ms || 0) / 1000); };
const provHit = (n, cnt, ms) => { const x = provStat.get(n) || { fail: 0, until: 0 }; x.runs = Math.min(50, (x.runs || 0) + 1); if (cnt > 0) x.hits = Math.min(50, (x.hits || 0) + 1); else x.last0 = Date.now(); x.ms = Math.round(((x.ms || ms) * 3 + ms) / 4); provStat.set(n, x); provSave(); };
const provMark = (n, ok) => { const x = provStat.get(n) || { fail: 0, until: 0 }; if (ok) { x.fail = 0; x.until = 0; } else if (++x.fail >= 3 && !x.hits) { x.until = Date.now() + 2 * 3600e3; log('saglayici 2 saat atlaniyor', n); } provStat.set(n, x); provSave(); };
async function nuvioStreams(type, imdb, m, season, episode, st, sink, onDone) {
  const hidden = new Set(st.hidden);
  const list = nuvioScrapers(st).filter((s) => !hidden.has(s.name) && !provSkip(s.name) && (!s.types.length || s.types.some((t) => (type === 'series' ? /tv|series|anime/i : /movie/i).test(t))));
  if (!list.length || !m.tmdbId) return;
  const args = type === 'series' ? { tmdbId: String(m.tmdbId), mediaType: 'tv', season, episode } : { tmdbId: String(m.tmdbId), mediaType: 'movie' };
  list.sort((a, b) => provScore(b.name) - provScore(a.name));   // kaynak getirenler once calisir
  await Promise.all(list.map(async (sc) => {
    const t0 = Date.now(); let cnt = 0;
    try {
      const code = cachedText(sc.codeUrl);
      const { results } = await limitRun(() => runScraper({ code, filename: sc.filename, scraperId: sc.id, args, timeoutMs: Number(process.env.SCRAPER_TIMEOUT || 20000) }));
      for (const r of results || []) {
        if (!r || !r.url || r.infoHash || !/^https?:/.test(r.url)) continue;
        if (/m3u\b|canl[ıi]|live ?tv|iptv/i.test([sc.name, r.name, r.title].join(' '))) continue;
        const h = r.headers || {};
        const isHls = /\.m3u8/i.test(r.url);
        sink.push({ provider: sc.name, kind: 'nuvio', s: { name: sc.name, title: [r.title, r.name, r.quality].filter(Boolean).join(' · '), url: px(r.url, h) + (isHls ? '#.m3u8' : ''), subtitles: [], _res: resOf(r.quality || r.title || r.name) } });
      }
      provMark(sc.name, true); cnt = (results || []).length; provHit(sc.name, cnt, Date.now() - t0);
    } catch (e) { provMark(sc.name, false); log('nuvio', sc.name, e.message); }
    finally { if (onDone) onDone(sc.name); }
  }));
}

// ---------- aggregation ----------
const cache = new Map(), inflight = new Map();
function describe(item) {
  const text = [item.s.name, item.s.title].join(' ');
  const res = item.s._res || resOf(text);
  const lang = langOf(text) || (item.s._l === 'Dublaj' ? 'TR Dublaj' : item.s._l === 'Altyazı' ? 'TR Altyazı' : '');
  return { ...item, res, lang };
}
function dedupe(items) {
  const seenUrl = new Set(), seenKey = new Set(), out = [];
  for (const it of items) {
    const u = innerUrl(it.s.url).split('#')[0];
    const k = it.provider + '|' + it.res + '|' + it.lang + '|' + norm(String(it.s.title).split('\n').pop());
    if (seenUrl.has(u) || seenKey.has(k)) continue;
    seenUrl.add(u); seenKey.add(k); out.push(it);
  }
  return out;
}
// ---------- hiz olcumu: her saglayicinin ilk ~600 KB videosu kac ms'de geliyor ----------
const SPEED_FILE = 'speed.json';
const speed = new Map((() => { try { return Object.entries(JSON.parse(fs.readFileSync(SPEED_FILE, 'utf8'))); } catch { return []; } })());
const speedSave = () => { try { fs.writeFileSync(SPEED_FILE, JSON.stringify(Object.fromEntries(speed))); } catch {} };
async function probeOne(url) {
  const t0 = Date.now(); const sig = AbortSignal.timeout(15000);
  let u = url.split('#')[0];
  if (/\.m3u8/i.test(url)) {
    let txt = await (await fetch(u, { signal: sig })).text();
    for (let i = 0; i < 3; i++) {
      const lines = txt.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      if (!lines.length) return null;
      const next = new URL(lines[0], u).href;
      if (/#EXT-X-STREAM-INF/.test(txt)) { u = next; txt = await (await fetch(u, { signal: sig })).text(); continue; }
      u = next; break;
    }
  }
  const r = await fetch(u, { signal: sig, headers: { range: 'bytes=0-1048575' } });
  if (!r.ok || !r.body) return null;
  const rd = r.body.getReader(); let n = 0;
  while (n < 600000) { const { done, value } = await rd.read(); if (done) break; n += value.length; }
  rd.cancel().catch(() => {});
  return n >= 50000 ? Date.now() - t0 : null;
}
let probing = false;
async function probeSpeeds(items) {
  if (probing) return; probing = true;
  try {
    const todo = []; const seen = new Set();
    for (const it of items) { const p = it.provider; if (seen.has(p)) continue; seen.add(p); const x = speed.get(p); if (!x || Date.now() - x.t > 6 * 3600e3) todo.push(it); }
    let i = 0;
    await Promise.all([0, 1, 2].map(async () => { while (i < Math.min(todo.length, 30)) { const it = todo[i++]; let ms = null; try { ms = await probeOne(it.s.url); } catch {} const x = speed.get(it.provider) || {}; const v = ms == null ? 30000 : ms; x.ms = x.ms ? Math.round(x.ms * 0.5 + v * 0.5) : v; x.t = Date.now(); x.ok = ms != null; speed.set(it.provider, x); } }));
    speedSave(); log('hiz olcumu', todo.length, 'saglayici');
  } finally { probing = false; }
}
const speedOf = (p) => { const x = speed.get(p); return x ? x.ms : 12000; };

function order(items, st) {
  const a = [...items];
  if (st.sort === 'speed') { a.sort((x, y) => (speedOf(x.provider) - speedOf(y.provider)) || (y.res - x.res)); return a; }
  if (st.sort === 'quality') a.sort((x, y) => (y.res - x.res) || x.provider.localeCompare(y.provider, 'tr'));
  else a.sort((x, y) => x.provider.localeCompare(y.provider, 'tr') || (y.res - x.res));
  return a;
}

const LIST_WAIT = Number(process.env.LIST_WAIT || 22000);
async function collect(type, id, st, kinds = 'all', maxWait = LIST_WAIT) {
  if (kinds === 'all') return (await Promise.all([collect(type, id, st, 'cs', maxWait), collect(type, id, st, 'nu', maxWait)])).flat();   // ortak onbellek: liste ve ses taramasi ayni sonucu kullanir
  const [imdb, se, ep] = id.split(':');
  const season = +se || 1, episode = +ep || 1;
  const key = type + '|' + id + '|' + kinds + '|' + JSON.stringify([st.hidden, st.nuvioRepos, st.csRepos]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.items;
  let run = inflight.get(key);
  if (run) maxWait = Math.min(maxWait, 3000);   // ikinci istek (yenile): beklemeden eldekini ver
  if (!run) {
    const sink = [];
    run = { sink, done: null };
    run.done = (async () => {
      const m = await metaFor(type, imdb);
      await Promise.allSettled([kinds !== 'nu' ? csStreams(type, m, season, episode, st, sink) : null, kinds !== 'cs' ? nuvioStreams(type, imdb, m, season, episode, st, sink) : null]);
      const items = sink.map(describe);
      cache.set(key, { t: Date.now(), items });
      capMap(cache, 80);
      if (TRHUB_SPEED_PROBE) setTimeout(() => probeSpeeds(items).catch(() => {}), 1000);
    })().catch((e) => log('collect', e.message)).finally(() => inflight.delete(key));
    inflight.set(key, run);
  }
  // Kaynaklar geldikce verilir: ilk sonuc geldikten ~18 sn sonra eldekini don, gerisi arka planda toplanir (yenileyince eklenir)
  const t0 = Date.now(); let fin = false; run.done.then(() => { fin = true; });
  // en az MIN_SRC kaynak gelene kadar bekle (en fazla HARD_WAIT); yeterli kaynak varsa maxWait sonunda don
  const MIN_SRC = Number(process.env.MIN_SRC || 10), HARD = Math.max(maxWait, Number(process.env.HARD_WAIT || 55000));
  while (!fin) { const el = Date.now() - t0; if (el >= HARD) break; if (el >= maxWait && (run.sink.length >= MIN_SRC || maxWait <= 3000)) break; await new Promise((r) => setTimeout(r, 400)); }
  const done = cache.get(key);
  return done ? done.items : run.sink.map(describe);
}

export async function providerItems(type, id, st, kinds = 'all', maxWait = LIST_WAIT) {
  let items = await collect(type, id, st, kinds, maxWait);
  if (st.minRes) items = items.filter((i) => !i.res || i.res >= st.minRes);
  if (st.dedupe) items = dedupe(items);
  return order(items, st);
}

function publicStream(it) {
  const detail = [resLabel(it.res), it.lang].filter(Boolean).join(' · ');
  const { _res, _l, _bb, ...rest } = it.s;
  return { ...rest, name: it.provider, title: (detail ? detail + '\n' : '') + String(it.s.title || '') };
}

// ---------- TorrentLIO ----------
function torrentioPath(t) {
  const o = [];
  if (t.providers?.length) o.push('providers=' + t.providers.join(','));
  if (t.language) o.push('language=' + t.language);
  if (t.sort) o.push('sort=' + t.sort);
  if (t.qualityfilter?.length) o.push('qualityfilter=' + t.qualityfilter.join(','));
  if (t.limit) o.push('limit=' + t.limit);
  return o.join('|');
}
export async function torrentlio(type, id, st) {
  const t = st.torrentlio;
  if (!t.enabled) return [];
  const url = t.base.replace(/\/$/, '') + '/' + torrentioPath(t) + '/stream/' + type + '/' + id + '.json';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    let warmed = 0;
    return (j.streams || []).slice(0, t.maxStreams || 24).map((s) => {
      const q = String(s.name || '').split('\n')[1] || '';
      if (t.mode === 'mux' && s.infoHash) {
        const trs = (s.sources || []).filter((x) => x.startsWith('tracker:')).map((x) => x.slice(8)).slice(0, 12);
        const u = 'http://' + HOST + ':' + PORT + '/tl/' + s.infoHash + '/' + (Number.isInteger(s.fileIdx) ? s.fileIdx : 'a') + '/' + type + '/' + encodeURIComponent(id) + '/master.m3u8' + (trs.length ? '?tr=' + encodeURIComponent(trs.join(',')) : '');
        if (warmed < (Number(process.env.TL_WARM) || 6) && process.env.TL_LITE !== '1') { warmed++; fetch(u).catch(() => {}); }   // ilk iki torrenti onceden ac: metadata/ses listesi kullanici secmeden hazirlansin
        return { name: 'TorrentLIO' + (q ? '\n' + q : ''), title: s.title, url: u, behaviorHints: { bingeGroup: 'torrentlio|' + s.infoHash, filename: s.behaviorHints?.filename } };
      }
      return { ...s, name: 'TorrentLIO' + (q ? '\n' + q : ''), behaviorHints: { ...(s.behaviorHints || {}), bingeGroup: 'torrentlio|' + (s.infoHash || '') } };
    });
  } catch (e) { log('torrentio', e.message); return []; }
}

export async function mxStreams(type, id) {
  const base = process.env.TR_UPSTREAM_PUBLIC || ('http://127.0.0.1:' + PORT + '/g/tr');
  const r = await fetch(base + '/stream/' + type + '/' + id + '.json', { signal: AbortSignal.timeout(90000), headers: { 'User-Agent': UA } });
  const j = await r.json();
  return (j.streams || []).filter((s) => /^https?:/.test(s.url || '') && !/^TorrentLIO/.test(s.name || '')).map((s) => {
    const b64 = Buffer.from(s.url).toString('base64url');
    const u = 'http://' + HOST + ':' + PORT + '/mx/' + b64 + '/' + type + '/' + encodeURIComponent(id) + '/master.m3u8?p=' + encodeURIComponent(String(s.name || ''));
    return { ...s, url: u, name: s.name, title: String(s.title || '') + '\nSes parçaları: diğer kaynaklar', subtitles: s.subtitles || [] };
  });
}

function prefetchNext(type, id, st) { if (!TRHUB_PREFETCH || type !== 'series') return; const [imdb, se, ep] = id.split(':'); if (!ep) return; const next = imdb + ':' + se + ':' + (Number(ep) + 1); const go = () => collect(type, next, st, 'all', 1).catch(() => {}); setTimeout(go, 5000); }
export async function streamsFor(type, id, st, group = 'all') {
  if (group === 'all' || group === 'cs' || group === 'nu') prefetchNext(type, id, st);
  if (group === 'tr') { prefetchNext(type, id, st); return (await providerItems(type, id, st)).map(publicStream); }
  if (group === 'mx') return mxStreams(type, id).catch((e) => { log('mx', e.message); return []; });
  if (group === 'tl') return torrentlio(type, id, st);
  if (group === 'cs' || group === 'nu') return (await providerItems(type, id, st, group)).map(publicStream);
  const [items, tl] = await Promise.all([providerItems(type, id, st), torrentlio(type, id, st)]);
  return [...order(items, st).map(publicStream), ...tl];
}

// ---------- Nuvio Plugin Repository (saglayici bazli canli akis) ----------
const tmdbImdbCache = new Map();
async function tmdbToImdb(tmdbId, mediaType) {
  const raw = String(tmdbId || '').trim();
  if (!raw) return '';
  if (/^tt\d+$/i.test(raw)) return raw;
  const kind = mediaType === 'tv' || mediaType === 'series' ? 'tv' : 'movie';
  const ck = kind + ':' + raw;
  if (tmdbImdbCache.has(ck)) return tmdbImdbCache.get(ck);
  try {
    const r = await fetch('https://api.themoviedb.org/3/' + kind + '/' + encodeURIComponent(raw) + '/external_ids?api_key=' + TMDB, { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    const imdb = j && j.imdb_id ? String(j.imdb_id) : '';
    if (imdb) tmdbImdbCache.set(ck, imdb);
    return imdb;
  } catch { return ''; }
}
function pluginStream(it) {
  const q = [resLabel(it.res) || 'Auto', it.lang].filter(Boolean).join(' • ');
  return {
    name: it.provider,
    title: String(it.s.title || it.provider),
    url: it.s.url,
    quality: q,
    subtitles: Array.isArray(it.s.subtitles) ? it.s.subtitles : [],
  };
}
const slugOf = (name) => norm(name).replace(/\s+/g, '_') || 'prov';
let repoCatalogCache = { t: 0, list: [], bySlug: new Map() };
async function getRepoCatalog(st) {
  if (Date.now() - repoCatalogCache.t < 60000 && repoCatalogCache.list.length) return repoCatalogCache;
  const hidden = new Set(st.hidden || []);
  const all = await listProviders(st);
  const bySlug = new Map();
  const list = [];
  for (const p of all) {
    if (!p || !p.name || hidden.has(p.name)) continue;
    if (/m3u\b|canl[ıi]|live ?tv|iptv|ulusal kanal|haber|spor|müzik|çocuk|sinema kanal|naughty|\+18/i.test(p.name)) continue;
    const slug = slugOf(p.name);
    let entry = bySlug.get(slug);
    if (!entry) {
      entry = { slug, name: p.name, hasCs: false, hasNu: false };
      bySlug.set(slug, entry);
      list.push(entry);
    }
    if (p.kind === 'cs3') entry.hasCs = true;
    if (p.kind === 'nuvio') entry.hasNu = true;
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  repoCatalogCache = { t: Date.now(), list, bySlug };
  return repoCatalogCache;
}
const provSessions = new Map();
function getProvSession(type, id, st) {
  const sk = type + '|' + id + '|' + JSON.stringify([st.hidden, st.nuvioRepos, st.csRepos, st.minRes, st.dedupe]);
  let sess = provSessions.get(sk);
  if (sess && sess.done && Date.now() - sess.lastClaim > 8000) {
    sess.emittedUrl.clear(); sess.t0 = Date.now(); sess.lastClaim = Date.now();
    return sess;
  }
  if (sess && Date.now() - sess.created < TTL) return sess;
  const [imdb, se, ep] = id.split(':');
  const season = +se || 1, episode = +ep || 1;
  const now = Date.now();
  const bySlug = new Map();
  const addItem = (raw) => {
    const d = describe(raw);
    const sl = slugOf(d.provider);
    let arr = bySlug.get(sl);
    if (!arr) { arr = []; bySlug.set(sl, arr); }
    arr.push(d);
  };
  sess = { created: now, t0: now, lastClaim: now, bySlug, csDone: false, nuDone: false, done: false, doneNuSlugs: new Set(), emittedUrl: new Set(), prefetched: false };
  const cKeyCs = type + '|' + id + '|cs|' + JSON.stringify([st.hidden, st.nuvioRepos, st.csRepos]);
  const cKeyNu = type + '|' + id + '|nu|' + JSON.stringify([st.hidden, st.nuvioRepos, st.csRepos]);
  const hitCs = cache.get(cKeyCs), hitNu = cache.get(cKeyNu);
  if (hitCs && Date.now() - hitCs.t < TTL && hitNu && Date.now() - hitNu.t < TTL) {
    for (const it of [...hitCs.items, ...hitNu.items]) { const sl = slugOf(it.provider); let arr = bySlug.get(sl); if (!arr) { arr = []; bySlug.set(sl, arr); } arr.push(it); }
    sess.csDone = true; sess.nuDone = true; sess.done = true;
  } else {
    (async () => {
      const m = await metaFor(type, imdb);
      const csSink = [], nuSink = [];
      const csProxy = []; csProxy.push = (...a) => { for (const x of a) { csSink.push(x); addItem(x); } return a.length; };
      const nuProxy = []; nuProxy.push = (...a) => { for (const x of a) { nuSink.push(x); addItem(x); } return a.length; };
      await Promise.allSettled([
        csStreams(type, m, season, episode, st, csProxy).finally(() => { sess.csDone = true; }),
        nuvioStreams(type, imdb, m, season, episode, st, nuProxy, (name) => sess.doneNuSlugs.add(slugOf(name))).finally(() => { sess.nuDone = true; }),
      ]);
      const csItems = csSink.map(describe), nuItems = nuSink.map(describe);
      cache.set(cKeyCs, { t: Date.now(), items: csItems });
      cache.set(cKeyNu, { t: Date.now(), items: nuItems });
      capMap(cache, 80);
      if (TRHUB_SPEED_PROBE) setTimeout(() => probeSpeeds([...csItems, ...nuItems]).catch(() => {}), 1000);
    })().catch((e) => log('provCollect', e.message)).finally(() => { sess.csDone = true; sess.nuDone = true; sess.done = true; });
  }
  provSessions.set(sk, sess);
  if (provSessions.size > 40) {
    for (const [k, v] of provSessions) { if (Date.now() - v.created > TTL) provSessions.delete(k); }
  }
  return sess;
}
async function nuvioRepoProvider(slug, tmdbId, mediaType, season, episode, st) {
  const imdb = await tmdbToImdb(tmdbId, mediaType);
  if (!imdb) return [];
  const type = (mediaType === 'tv' || mediaType === 'series') ? 'series' : 'movie';
  const id = type === 'series' ? (imdb + ':' + (+season || 1) + ':' + (+episode || 1)) : imdb;
  const cat = await getRepoCatalog(st);
  const meta = cat.bySlug.get(slug) || { hasCs: true, hasNu: true };
  const sess = getProvSession(type, id, st);
  if (!sess.prefetched) { sess.prefetched = true; prefetchNext(type, id, st); }
  let firstHit = 0;
  while (true) {
    const arr = sess.bySlug.get(slug);
    const validCount = arr ? arr.filter((i) => !st.minRes || !i.res || i.res >= st.minRes).length : 0;
    if (sess.done) break;
    const csReady = !meta.hasCs || sess.csDone;
    const nuReady = !meta.hasNu || sess.nuDone || sess.doneNuSlugs.has(slug);
    if (csReady && nuReady) break;
    if (validCount > 0) {
      if (!firstHit) firstHit = Date.now();
      if (Date.now() - firstHit >= 350) break;
    }
    if (Date.now() - sess.t0 >= 45000) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  sess.lastClaim = Date.now();
  let items = (sess.bySlug.get(slug) || []).slice();
  if (st.minRes) items = items.filter((i) => !i.res || i.res >= st.minRes);
  const out = [];
  const seenKey = new Set();
  for (const it of order(items, st)) {
    const u = innerUrl(it.s.url).split('#')[0];
    const k = it.provider + '|' + it.res + '|' + it.lang + '|' + norm(String(it.s.title).split(String.fromCharCode(10)).pop());
    if (sess.emittedUrl.has(u) || (st.dedupe && seenKey.has(k))) continue;
    sess.emittedUrl.add(u); seenKey.add(k); out.push(it);
  }
  return out.map(pluginStream);
}
async function nuvioRepoManifest(st) {
  const cat = await getRepoCatalog(st);
  const scrapers = cat.list.map((p) => ({
    id: 'trhub_' + p.slug,
    name: p.name,
    description: 'TR Hub · ' + p.name,
    version: '2.3.0',
    author: 'TR Hub',
    supportedTypes: ['movie', 'tv'],
    filename: 'p/' + p.slug + '.js',
    enabled: true,
    contentLanguage: ['tr'],
  }));
  return {
    name: 'TR Hub',
    version: '2.3.0',
    description: 'Türk sağlayıcılar (CloudStream + Nuvio), sağlayıcı bazlı canlı akış.',
    author: 'TR Hub',
    scrapers,
  };
}
function nuvioRepoScraperJs(slug) {
  const s = String(slug || '').replace(/[^a-z0-9_]/g, '');
  return [
    'async function getStreams(tmdbId, mediaType, season, episode) {',
    '  try {',
    '    var u = "http://127.0.0.1:' + PORT + '/nuvio-repo/provider/' + s + '?tmdbId=" + encodeURIComponent(tmdbId || "") + "&mediaType=" + encodeURIComponent(mediaType || "movie") + "&season=" + encodeURIComponent(season || "") + "&episode=" + encodeURIComponent(episode || "");',
    '    var r = await fetch(u);',
    '    if (!r || !r.ok) return [];',
    '    var j = await r.json();',
    '    return Array.isArray(j) ? j : [];',
    '  } catch (e) { return []; }',
    '}',
    'module.exports = { getStreams };',
  ].join(String.fromCharCode(10));
}
const EN_REPOS = [
  'https://raw.githubusercontent.com/D3adlyRocket/All-in-One-Nuvio/refs/heads/main/manifest.json',
  'https://raw.githubusercontent.com/yoruix/nuvio-providers/refs/heads/main/manifest.json',
  'https://raw.githubusercontent.com/michat88/nuvio-providers/refs/heads/main/manifest.json',
  'https://raw.githubusercontent.com/itsmeadarsh2008/Streamline/main/manifest.json',
  'https://raw.githubusercontent.com/PirateZoro9/asura-providers/main/manifest.json',
  'https://raw.githubusercontent.com/hihihihihiiray/nuvio-plugins/main/manifest.json',
  'https://raw.githubusercontent.com/A2R14N/nuvio-providers/main/manifest.json',
  'https://raw.githubusercontent.com/rareanimeaddon-blip/Nuvio-plugins/main/manifest.json',
  'https://raw.githubusercontent.com/KhooLy/nuvio-providers/master/manifest.json',
  'https://raw.githubusercontent.com/flix-dlp/All-in-One-Nuvio/main/manifest.json',
];
function enRepoManifest() {
  const seen = new Set();
  const scrapers = [];
  for (const repoUrl of EN_REPOS) {
    let man; try { man = JSON.parse(cachedText(repoUrl)); } catch { continue; }
    for (const s of (man.scrapers || [])) {
      if (!s || s.enabled === false || !s.filename) continue;
      if (/(?:(?:torrentio|yts|torrastream|filmestorrent|cpasbien|1337x|piratebay|eztv|nyaa|usenet|kickass|rarbg)|(?<!no)torrent)/i.test((s.id || "") + " " + (s.name || ""))) continue;
      const kId = norm(s.id || s.name);
      const kName = norm(s.name || s.id);
      if (seen.has(kId) || seen.has(kName)) continue;
      seen.add(kId); seen.add(kName);
      const absUrl = new URL(s.filename, repoUrl).toString();
      scrapers.push({ ...s, filename: absUrl });
    }
  }
  scrapers.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'en'));
  return {
    name: 'EN Hub',
    version: '1.0.0',
    description: 'Yabancı sağlayıcılar (10 EN depo: All-in-One, Yoru, Michat88, Streamline, Asura, Ray, A2R14N, rareanime, KhooLy, flix-dlp), tekilleştirilmiş.',
    author: 'EN Hub',
    scrapers,
  };
}

// Ses/gecikme olcumu icin ic liste: "Dil · Cozunurluk · Saglayici" adlari (aggregator.mjs bu bicimi okur).
export async function internalList(type, id, st) {
  const parts = await Promise.all([providerItems(type, id, { ...st, dedupe: true }, 'cs', 12000), providerItems(type, id, { ...st, dedupe: true }, 'nu', 12000)]);   // grup onbellekleri ortak
  const items = parts.flat();
  return items.map((it) => ({ ...it.s, name: (it.lang || 'Dil belirsiz') + ' · ' + (resLabel(it.res) || 'Kalite ?') + ' · ' + it.provider }));
}

// ---------- manifest + config page ----------
const GROUPS = { tr: ['local.trhub.tr', 'TR Hub', 'Türk sağlayıcılar (CloudStream + Nuvio), hıza göre sıralı.'], mx: ['local.trhub.mux', 'TR Hub · Ses birleşik', 'TR Hub kaynakları; diğer kaynakların ses parçalarıyla birlikte.'], all: ['local.trhub', 'TR Hub', 'Türk sağlayıcılar + TorrentLIO tek yerde.'], tl: ['local.trhub.torrentlio', 'TorrentLIO', 'Torrentio kaynakları; video ve Türk seslerle birleşik.'], cs: ['local.trhub.cs3', 'TR Hub · CloudStream', 'CloudStream (CS3) Türk sağlayıcıları.'], nu: ['local.trhub.nuvio', 'TR Hub · Nuvio', 'Nuvio JS Türk sağlayıcıları.'] };
function manifest(st, group = 'all') {
  const g = GROUPS[group] || GROUPS.all;
  return {
    id: g[0], version: '2.1.0', name: g[1], description: g[2],
    resources: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }], types: ['movie', 'series'], idPrefixes: ['tt'], catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: false },
  };
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export async function renderConfigure(st, saved) {
  const provs = await listProviders(st);
  const hidden = new Set(st.hidden);
  const t = st.torrentlio;
  const nt = nuvioTorrentInfo();
  const chk = (n, v, on) => '<label class="c"><input type="checkbox" name="' + n + '" value="' + esc(v) + '"' + (on ? ' checked' : '') + '> ' + esc(v) + '</label>';
  const group = (title, items) => '<h3>' + title + ' (' + items.length + ')</h3><div class="g">' + items.map((p) => chk('prov', p.name, !hidden.has(p.name))).join('') + '</div>';
  const opts = (o, cur) => Object.entries(o).map(([k, v]) => '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + v + '</option>').join('');
  return '<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TR Hub</title>'
    + '<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:20px;max-width:900px;margin:auto}h2,h3{margin:18px 0 8px}.g{display:flex;flex-wrap:wrap;gap:6px}.c{background:#1c1c1c;border-radius:8px;padding:6px 10px;font-size:14px}select,input[type=text],input[type=number],textarea{background:#1c1c1c;color:#eee;border:1px solid #333;border-radius:8px;padding:8px;width:100%;box-sizing:border-box}button{background:#fff;color:#000;border:0;border-radius:10px;padding:12px 22px;font-weight:600;margin-top:16px;cursor:pointer}.ok{color:#7f7}code{background:#1c1c1c;padding:3px 6px;border-radius:6px}small{color:#999}</style>'
    + '<body><h2>TR Hub ayarları</h2>' + (saved ? '<p class="ok">Kaydedildi. Nuvio\'da diziyi baştan aç.</p>' : '')
    + '<p>Nuvio eklenti adresi: <code>http://' + esc(HOST) + ':' + PORT + '/manifest.json</code></p>'
    + '<form method="post" action="/configure">'
    + '<h2>Genel</h2><div class="g"><label class="c"><input type="checkbox" name="dedupe"' + (st.dedupe ? ' checked' : '') + '> Tekrarlayan kaynakları gizle</label></div>'
    + '<p><label>Sıralama<br><select name="sort">' + opts({ speed: 'Hıza göre (ölçülen)', az: 'Sağlayıcı adı A-Z', quality: 'Kaliteye göre' }, st.sort) + '</select></label></p>'
    + '<p><label>En düşük çözünürlük<br><select name="minRes">' + opts({ 0: 'Hepsi', 480: '480p', 720: '720p', 1080: '1080p' }, String(st.minRes)) + '</select></label></p>'
    + '<h2>TorrentLIO</h2><div class="g"><label class="c"><input type="checkbox" name="tl_enabled"' + (t.enabled ? ' checked' : '') + '> TorrentLIO kaynağını göster</label></div>'
    + '<p><small>Torrent ayarları PC\'deki Nuvio\'dan okunur: profil ' + esc(nt.profile) + ', yükleme ' + (nt.upload ? 'açık' : 'kapalı') + ', önbellek ' + esc(nt.cache) + ' (' + esc(nt.source) + ').</small></p>'
    + '<p><label>Kaynak biçimi<br><select name="tl_mode">' + opts({ mux: 'Birleşik: video + diğer Türk kaynakların sesleri, kayma düzeltmeli (sunucuda)', direct: 'Doğrudan torrent (Nuvio kendi motoruyla açar)' }, t.mode) + '</select></label></p>'
    + '<p><label>Eklenecek en fazla ses kaynağı<br><input type="number" name="tl_maxdubs" min="0" max="20" value="' + (t.maxDubs ?? 8) + '"></label></p>'
    + '<p><label>Torrentio adresi<br><input type="text" name="tl_base" value="' + esc(t.base) + '"></label></p>'
    + '<h3>Torrentio sağlayıcıları</h3><div class="g">' + TORRENTIO_PROVIDERS.map((p) => chk('tl_providers', p, t.providers.includes(p))).join('') + '</div>'
    + '<p><label>Sıralama<br><select name="tl_sort">' + opts(TORRENTIO_SORT, t.sort) + '</select></label></p>'
    + '<h3>Gizlenecek kaliteler</h3><div class="g">' + QUALITY_FILTERS.map((q) => chk('tl_qf', q, t.qualityfilter.includes(q))).join('') + '</div>'
    + '<p><label>Kalite başına en fazla<br><input type="number" name="tl_limit" min="0" max="20" value="' + (t.limit || 0) + '"></label></p>'
    + '<p><label>Toplam üst sınır<br><input type="number" name="tl_max" min="1" max="100" value="' + (t.maxStreams || 24) + '"></label></p>'
    + '<p><label>Torrentio dil önceliği (örn. turkish, boş bırakılabilir)<br><input type="text" name="tl_lang" value="' + esc(t.language || '') + '"></label></p>'
    + '<h2>Türk sağlayıcılar</h2><small>İşaretli olanlar kaynak olarak görünür.</small>'
    + group('CloudStream (CS3)', provs.filter((p) => p.kind === 'cs3')) + group('Nuvio', provs.filter((p) => p.kind === 'nuvio'))
    + '<h2>Depolar</h2><p><label>CloudStream depoları (repo.json, her satırda bir tane, # ile kapatılır)<br><textarea name="cs_repos" rows="7">' + esc(st.csRepos.map((r) => (r.enabled ? '' : '# ') + r.url).join('\n')) + '</textarea></label></p>'
    + '<p><label>Nuvio depoları (manifest.json, her satırda bir tane, # ile kapatılır)<br><textarea name="nuvio_repos" rows="7">' + esc((st.nuvioRepos || []).map((r) => (r.enabled ? '' : '# ') + r.url).join('\n')) + '</textarea></label></p>'
    + '<button type="submit">Kaydet</button></form></body></html>';
}

const readBody = (req) => new Promise((resolve) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 400000) req.destroy(); }); req.on('end', () => resolve(d)); req.on('error', () => resolve('')); });
const parseRepos = (txt) => String(txt || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => ({ url: l.replace(/^#\s*/, ''), enabled: !l.startsWith('#') })).filter((r) => /^https?:\/\//.test(r.url));

async function applyForm(form) {
  const prev = loadSettings();
  const all = (await listProviders(prev)).map((p) => p.name);
  const shown = new Set(form.getAll('prov'));
  const csRepos = parseRepos(form.get('cs_repos'));
  const csChanged = JSON.stringify(csRepos) !== JSON.stringify(prev.csRepos);
  const next = {
    ...prev, dedupe: form.has('dedupe'), sort: ['quality', 'speed'].includes(form.get('sort')) ? form.get('sort') : 'az', minRes: Number(form.get('minRes')) || 0,
    hidden: all.filter((n) => !shown.has(n)),
    csRepos, nuvioRepos: parseRepos(form.get('nuvio_repos')),
    torrentlio: {
      enabled: form.has('tl_enabled'), mode: form.get('tl_mode') === 'direct' ? 'direct' : 'mux', maxDubs: Math.max(0, Math.min(20, Number(form.get('tl_maxdubs') || 8))), base: String(form.get('tl_base') || DEFAULTS.torrentlio.base).trim(), providers: form.getAll('tl_providers').filter((p) => TORRENTIO_PROVIDERS.includes(p)),
      sort: TORRENTIO_SORT[form.get('tl_sort')] ? form.get('tl_sort') : 'qualitysize', qualityfilter: form.getAll('tl_qf').filter((q) => QUALITY_FILTERS.includes(q)),
      limit: Math.max(0, Math.min(20, Number(form.get('tl_limit')) || 0)), maxStreams: Math.max(1, Math.min(100, Number(form.get('tl_max')) || 24)), language: String(form.get('tl_lang') || '').trim(),
    },
  };
  saveSettings(next);
  cache.clear(); nuvioCache.t = 0;
  if (csChanged) fetch(CS_HOST + '/sync', { signal: AbortSignal.timeout(5000) }).catch(() => {});
  log('settings saved');
}

import { makeServeTl } from './tlroute.mjs';
import { nuvioTorrentInfo } from './tl.mjs';
const serveTl = makeServeTl(() => getAgg(), log);
let aggP = null;
function getAgg() {
  if (!aggP) { process.env.UNIFIED_UPSTREAM = process.env.TL_REMOTE_INTERNAL || ('http://127.0.0.1:' + PORT + '/internal'); process.env.UNIFIED_UPSTREAM_WAIT = '0'; if (!process.env.UNIFIED_PORT) process.env.UNIFIED_PORT = String(PORT); aggP = import('../unified/aggregator.mjs'); }
  return aggP;
}

export function createServer() {
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (/^\/(tl|mx)\//.test(p)) { try { fs.appendFileSync(path.join(HERE, 'req.log'), new Date().toISOString() + ' ' + req.method + ' ' + p.slice(-60) + ' range=' + (req.headers.range || '-') + ' ua=' + String(req.headers['user-agent'] || '').slice(0, 40) + '\n'); } catch {} }
    const send = (code, body, h = JSON_H) => { res.writeHead(code, h); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    const html = (code, body) => send(code, body, { 'content-type': 'text/html; charset=utf-8' });
    try {
      const st = loadSettings();
      if (p === '/' || (p === '/configure' && req.method === 'GET')) return html(200, await renderConfigure(st, url.searchParams.get('saved') === '1'));
      if (p === '/configure' && req.method === 'POST') { await applyForm(new URLSearchParams(await readBody(req))); res.writeHead(303, { location: '/configure?saved=1' }); return res.end(); }
      const mxm = p.match(/^\/mx\/([A-Za-z0-9_-]+)\/(movie|series)\/([^/]+)\/([\w.]+)$/);
      if (mxm) return await serveTl(req, res, st, [null, 'mx' + mxm[1], 'a', mxm[2], mxm[3], mxm[4]], url);
      const gm = p.match(/^\/g\/(tl|cs|nu|mx|tr)(\/.*)$/);
      if (gm && gm[2] === '/manifest.json') return send(200, manifest(st, gm[1]));
      const gs = gm && gm[2].match(/^\/stream\/(movie|series)\/(.+)\.json$/);
      if (gs) return send(200, { streams: await streamsFor(gs[1], decodeURIComponent(gs[2]), st, gm[1]) });
      if (p === '/manifest.json') return send(200, manifest(st));
      if (p === '/nuvio-repo/manifest.json') return send(200, await nuvioRepoManifest(st));
      if (p === '/en-repo/manifest.json') return send(200, enRepoManifest());
      const np = p.match(/^\/nuvio-repo\/p\/([a-z0-9_]+)\.js$/);
      if (np) return send(200, nuvioRepoScraperJs(np[1]), { 'access-control-allow-origin': '*', 'content-type': 'application/javascript; charset=utf-8' });
      const nw = p.match(/^\/nuvio-repo\/provider\/([a-z0-9_]+)$/);
      if (nw) return send(200, await nuvioRepoProvider(nw[1], url.searchParams.get('tmdbId'), url.searchParams.get('mediaType'), url.searchParams.get('season'), url.searchParams.get('episode'), st));
      if (p === '/tl-status') return send(200, await (await import('./tl.mjs')).status());
      if (p === '/providers.json') return send(200, await listProviders(st));
      let m = p.match(/^\/tl\/([0-9a-fA-F]{40})\/(a|\d+)\/(movie|series)\/([^/]+)\/([\w.]+)$/);
      if (m) return await serveTl(req, res, st, m, url);
      m = p.match(/^\/internal\/stream\/(movie|series)\/(.+)\.json$/);
      if (m) return send(200, { streams: await internalList(m[1], decodeURIComponent(m[2]), st) });
      m = p.match(/^\/dubs\/(movie|series)\/(.+)\.json$/);
      if (m) { const a = await getAgg(); try { return send(200, { dubs: await a.dubsFor(m[1], decodeURIComponent(m[2])) }); } catch (e) { return send(200, { dubs: [], error: e.message }); } }
      m = p.match(/^\/sync\/(movie|series)\/(.+)\.json$/);
      if (m) { const a = await getAgg(); return send(200, await a.measureDelay(m[1], decodeURIComponent(m[2]), Number(url.searchParams.get('i')), url.searchParams.get('src'))); }
      m = p.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
      if (m) return send(200, { streams: await streamsFor(m[1], decodeURIComponent(m[2]), st) });
      send(404, { error: 'not found' });
    } catch (e) { log('error', e.message); send(500, { error: e.message }); }
  });
  srv.keepAliveTimeout = 300000; srv.headersTimeout = 305000; srv.requestTimeout = 0;   // oynatici bagliyi uzun sure bos tutup yeniden kullanir
  return srv;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, HOST, () => log('trhub on http://' + HOST + ':' + PORT));
}
