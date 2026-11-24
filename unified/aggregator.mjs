// Tek kaynak döndüren Stremio uyumlu toplayıcı. Nuvio tek bir adresi eklenti olarak kurar.
// Ayarlar Nuvio'daki "Ayarla" düğmesiyle açılan /configure sayfasından kaydedilir.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UPSTREAM = process.env.UNIFIED_UPSTREAM || 'http://127.0.0.1:7000';
const PORT = Number(process.env.UNIFIED_PORT || 7100);
const HOST = process.env.UNIFIED_HOST || '127.0.0.1';
const LOG = path.join(HERE, 'unified.log');
const SETTINGS = path.join(HERE, 'settings.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const UPSTREAM_TTL = 10 * 60 * 1000;
const PROBE_TTL = 5 * 60 * 1000;
const MAX_PROBES = 8;
const JSON_H = { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8' };

export const DUB_LABEL = { tr: 'Türkçe dublaj', sub: 'Türkçe altyazı', any: 'Dil fark etmez' };
export const RES_CHOICES = ['best', 2160, 1440, 1080, 720, 480, 360];
// Dublaj tercihine göre dil sınıflarının öncelik sırası.
const TIERS = {
  tr: ['dub', 'dual', 'sub', 'unknown', 'foreign'],
  sub: ['sub', 'dub', 'dual', 'unknown', 'foreign'],
  any: ['dub', 'dual', 'sub', 'unknown', 'foreign'],
};
const LANG_CLASS = { 'TR Dublaj': 'dub', 'Çift Ses': 'dual', 'TR Altyazı': 'sub', 'Yabancı': 'foreign', 'Dil belirsiz': 'unknown' };
const RES_CLASS = { '4K': 2160, '2K': 1440, '1080p': 1080, '720p': 720, '480p': 480, '360p': 360 };

function log(...a) {
  const line = new Date().toISOString() + ' ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
  try { fs.appendFileSync(LOG, line + '\n'); } catch {}
}

export function normalize(c = {}) {
  const strictRaw = c.strict;
  return {
    dub: TIERS[c.dub] ? c.dub : 'tr',
    res: c.res === 'best' ? 'best' : (RES_CHOICES.includes(Number(c.res)) ? Number(c.res) : 1080),
    strict: strictRaw === true || strictRaw === 'true' || strictRaw === 'on' || strictRaw === '1' || strictRaw === 1,
    all: !(c.all === false || c.all === 'false' || c.all === 0 || c.all === '0'),
    raw: !(c.raw === false || c.raw === 'false' || c.raw === 0 || c.raw === '0'),
  };
}

export function decodeConfig(token) {
  if (!token) return normalize({});
  try { return normalize(JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))); } catch { return normalize({}); }
}
export function encodeConfig(c) { return Buffer.from(JSON.stringify(normalize(c)), 'utf8').toString('base64url'); }

export function loadSettings() {
  try { return normalize(JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))); } catch { return normalize({}); }
}
function saveSettings(s) { fs.writeFileSync(SETTINGS, JSON.stringify(normalize(s), null, 2)); }

// Bridge'in kaynak adından gelen etiketi çözer: "🥇 TR Dublaj · 1080p · Kraptor FHD".
export function parseUpstream(stream) {
  const raw = String(stream.name || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const parts = raw.split(' · ').map(s => s.trim());
  const langLabel = parts[0] || '';
  const resLabel = parts[1] || '';
  const provider = parts.slice(2).join(' · ');
  const res = RES_CLASS[resLabel] || (/^(\d{3,4})p$/.test(resLabel) ? Number(resLabel.slice(0, -1)) : 0);
  return { lang: LANG_CLASS[langLabel] || 'unknown', langLabel, res, resLabel, provider };
}

function resDistance(res, target) {
  if (target === 'best') return res ? -res : 1e6;
  if (!res) return 1e6;
  if (res <= target) return target - res;
  return (res - target) * 1.5 + 1;
}

export function choose(streams, cfg) {
  const cands = (streams || []).filter(s => s && s.url).map((s, order) => ({
    ...parseUpstream(s), s, order, tx: /\/tx\//.test(s.url),
  }));
  const byRes = (a, b) => (resDistance(a.res, cfg.res) + (a.tx ? 0.5 : 0)) - (resDistance(b.res, cfg.res) + (b.tx ? 0.5 : 0)) || a.order - b.order;
  if (cfg.dub === 'any') return [...cands].sort(byRes);
  const tiers = TIERS[cfg.dub];
  const allowed = cfg.strict ? tiers.slice(0, cfg.dub === 'sub' ? 1 : 2) : tiers;
  const ordered = [];
  for (const tier of allowed) ordered.push(...cands.filter(c => c.lang === tier).sort(byRes));
  return ordered;
}

// Transcode (tx) bağlantısını açmak ffmpeg işi başlatır. Canlılık için içindeki asıl kaynağa bakılır.
export function probeTarget(url) {
  try {
    const u = new URL(url);
    if (/\/tx\//.test(u.pathname)) { const inner = u.searchParams.get('u'); if (inner) return inner; }
  } catch {}
  return url;
}

const upstreamCache = new Map();
async function upstreamList(type, id) {
  try { id = decodeURIComponent(id); } catch {}
  const key = type + '|' + id;
  const hit = upstreamCache.get(key);
  if (hit && Date.now() - hit.t < UPSTREAM_TTL) return hit.v;
  const getOnce = async () => {
    const r = await fetch(UPSTREAM + '/stream/' + type + '/' + id + '.json?bb=1', { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': UA } });
    return (await r.json()).streams || [];
  };
  // Bridge ilk yanıtta kısmi liste döner; tam liste arka planda birkaç saniye sonra önbelleğe düşer.
  let v = await getOnce().catch(e => { log('upstream error', e.message); return []; });
  const waitMs = Number(process.env.UNIFIED_UPSTREAM_WAIT ?? 40000);
  if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
  const full = await getOnce().catch(() => v);
  v = full.length >= v.length ? full : v;
  upstreamCache.set(key, { t: Date.now(), v });
  log('upstream', key, 'streams', v.length);
  return v;
}

const dubsCache = new Map();
export async function dubsFor(type, id) {
  const key = type + '|' + id;
  const hit = dubsCache.get(key);
  if (hit && Date.now() - hit.t < UPSTREAM_TTL) return hit.v;
  const list = await upstreamList(type, id);
  const cands = list.filter(s => s && s.url).map((s, order) => ({ ...parseUpstream(s), s, order }))
    .filter(c => c.lang !== 'foreign')
    .sort((a, b) => ({ dub: 0, dual: 1, sub: 2, unknown: 3 }[a.lang] - { dub: 0, dual: 1, sub: 2, unknown: 3 }[b.lang]) || (b.res - a.res) || (a.order - b.order));
  const checked = await Promise.all(cands.map(async c => ((await alive(probeTarget(c.s.url))) ? c : null)));
  const seenProbe = new Set();
  const v0 = checked.filter(Boolean).filter(c => { const p = probeTarget(c.s.url); if (seenProbe.has(p)) return false; seenProbe.add(p); return true; }).map(c => ({
    title: (c.provider || 'Kaynak') + ' · ' + (c.resLabel || '?') + ' · ' + (c.langLabel || 'Dil belirsiz'),
    lang: c.lang,
    provider: c.provider, res: c.res, url: c.s.url, probe: probeTarget(c.s.url),
  }));
  const titleCount = {};
  v0.forEach(d => { titleCount[d.title] = (titleCount[d.title] || 0) + 1; });
  const titleSeen = {};
  const v = v0.map(d => { if (titleCount[d.title] < 2) return d; titleSeen[d.title] = (titleSeen[d.title] || 0) + 1; return { ...d, title: d.title + ' (' + titleSeen[d.title] + ')' }; });
  dubsCache.set(key, { t: Date.now(), v });
  log('dubs', key, 'count', v.length);
  return v;
}

export async function measureDelay(type, id, index, src) {
  const dubs = await dubsFor(type, id);
  const dub = dubs[index];
  if (!dub) return { ok: false, error: 'no such dub' };
  if (!src) return { ok: false, error: 'no source url' };
  try {
    const { measureOffset, probeLanguages } = await import('./audiosync.mjs');
    const { spawnSync } = await import('node:child_process');
    const { ffmpegPath } = await import('./audiosync.mjs');
    const side = u => { const p = spawnSync(ffmpegPath().replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'csv=p=0', '-timeout', '15000000', u], { encoding: 'utf8', timeout: 25000 }); return ((p.stdout || '') + (p.stderr || '')).replace(/\s+/g, ' ').slice(0, 160); };
    log('sync src', String(src).slice(0, 140), '=>', side(src), '| dub =>', side(dub.probe));
    const [r, langs] = await Promise.all([measureOffset(src, dub.probe), probeLanguages(dub.probe)]);
    // a source whose audio is explicitly tagged as some other language (and not Turkish) is not a dub
    const foreign = langs.length > 0 && !langs.some(l => /^(tur|tr|und|zxx)$/.test(l));
    log('sync', type, id, 'dub', dub.title, 'langs', langs.join(','), JSON.stringify(r));
    return { ...r, langs, foreign };
  } catch (e) {
    log('sync error', e.message);
    return { ok: false, error: e.message };
  }
}

function decodeId(s) { try { return decodeURIComponent(s); } catch { return s; } }

const probeCache = new Map();
async function alive(url) {
  const hit = probeCache.get(url);
  if (hit && Date.now() - hit.t < PROBE_TTL) return hit.ok;
  let ok = false;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-2047' }, signal: AbortSignal.timeout(8000), redirect: 'follow' });
    ok = r.status === 200 || r.status === 206;
    try { await r.body?.cancel(); } catch {}
  } catch {}
  probeCache.set(url, { t: Date.now(), ok });
  return ok;
}

function shape(c, cfg) {
  const resText = c.resLabel || (c.res ? c.res + 'p' : 'Kalite ?');
  const label = c.langLabel || 'Dil belirsiz';
  return {
    ...c.s,
    name: label + ' · ' + resText + ' · ' + (c.provider || 'Kaynak'),
    title: c.s.title || '',
  };
}

export async function streamsFor(cfg, type, id) {
  const list = await upstreamList(type, id);
  if (cfg.raw) {
    // Filtresiz: depodan (bridge) ne geliyorsa hepsi, site adına göre A-Z.
    const items = list.filter(s => s && s.url).map((s, order) => ({ s, order, p: parseUpstream(s).provider || String(s.name || '') }));
    items.sort((a, b) => a.p.localeCompare(b.p, 'tr') || a.order - b.order);
    log('raw', type, id, 'shown', items.length);
    return items.map(x => x.s);
  }
  const ordered = choose(list, cfg);
  if (cfg.all) {
    const checked = await Promise.all(ordered.map(async c => ((await alive(probeTarget(c.s.url))) ? c : null)));
    let live = checked.filter(Boolean);
    if (!live.length) live = ordered;
    log('all', type, id, cfg, 'shown', live.length, 'of', ordered.length);
    return live.map(c => shape(c, cfg));
  }
  let probed = 0;
  for (const c of ordered) {
    if (probed >= MAX_PROBES) break;
    probed++;
    if (await alive(probeTarget(c.s.url))) { log('pick', type, id, cfg, c.langLabel, c.resLabel, c.provider, c.tx ? 'tx' : 'direct'); return [shape(c, cfg)]; }
    log('dead', type, id, c.langLabel, c.resLabel, c.provider);
  }
  log('none', type, id, cfg, 'candidates', ordered.length);
  return [];
}

export function manifestFor(cfg, id) {
  const resName = cfg.res === 'best' ? 'En yüksek kalite' : cfg.res + 'p';
  return {
    id,
    version: '1.1.0',
    name: 'Türkçe Toplayıcı · ' + DUB_LABEL[cfg.dub] + ' · ' + resName,
    description: 'Tüm Türkçe kaynakları tarar ve seçtiğin dublaj ve çözünürlüğe göre tek kaynak gösterir. Ayarla düğmesinden değiştirebilirsin.' + (cfg.strict ? ' (Sadece seçtiğin dil.)' : ''),
    resources: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: false },
  };
}

// Nuvio "Fusion badge" kuralları: kaynak adındaki kalite ve dil rozet olarak görünür.
// Her kural, kaynak adındaki bölümü (" · " ile ayrılmış) eşleştirir; başlık metni eşleştirmeye katılmaz.
const BADGE_RULES = [
  ['q2160', 'quality', '4K', '(^| · )(2160p|4K)( · |$)', 'q2160.png'],
  ['q1440', 'quality', '2K', '(^| · )(1440p|2K)( · |$)', 'q1440.png'],
  ['q1080', 'quality', '1080p', '(^| · )1080p( · |$)', 'q1080.png'],
  ['q720', 'quality', '720p', '(^| · )720p( · |$)', 'q720.png'],
  ['q480', 'quality', '480p', '(^| · )480p( · |$)', 'q480.png'],
  ['q360', 'quality', '360p', '(^| · )360p( · |$)', 'q360.png'],
  ['dub', 'lang', 'TR Dublaj', '^TR Dublaj · ', 'd-tr.png'],
  ['sub', 'lang', 'TR Altyazı', '^TR Altyaz. · ', 's-tr.png'],
  ['dual', 'lang', 'Çift Ses', '^Çift Ses · ', 'd-dual.png'],
  ['foreign', 'lang', 'Yabancı', '^Yabanc. · ', 'd-yab.png'],
];
export function badgePack() {
  const base = (process.env.UNIFIED_PUBLIC || ('http://127.0.0.1:' + PORT)) + '/badges/';
  return {
    groups: [
      { id: 'quality', name: 'Kalite', color: '#37474F', isExpanded: true },
      { id: 'lang', name: 'Dil', color: '#2E7D32', isExpanded: true },
    ],
    filters: BADGE_RULES.map(([id, groupId, name, pattern, img]) => ({
      id, groupId, name, pattern, imageURL: base + img, isEnabled: true,
      tagStyle: 'filled', tagColor: groupId === 'lang' ? '#2E7D32' : '#37474F', textColor: '#FFFFFF', borderColor: '',
    })),
  };
}

function opts(list, current) {
  return list.map(([v, label]) => '<option value="' + v + '"' + (String(v) === String(current) ? ' selected' : '') + '>' + label + '</option>').join('');
}
export function renderConfigure(s, saved) {
  const dubOpts = opts([['tr', 'Türkçe dublaj (yoksa altyazı)'], ['sub', 'Türkçe altyazı önce'], ['any', 'Dil fark etmez']], s.dub);
  const resOpts = opts([[1080, '1080p'], [720, '720p'], [1440, '1440p (2K)'], [2160, '2160p (4K)'], [480, '480p'], [360, '360p'], ['best', 'En yüksek kalite']], s.res);
  return '<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Türkçe Toplayıcı</title>'
    + '<body style="font-family:sans-serif;background:#111;color:#eee;padding:20px;max-width:560px;margin:auto">'
    + '<h2>Türkçe Toplayıcı ayarları</h2>'
    + (saved ? '<p style="color:#7f7">Kaydedildi. Nuvio\'da bir sonraki aramada yeni kaynak görünür.</p>' : '')
    + '<form method="post" action="/configure">'
    + '<p><label>Dublaj tercihi<br><select name="dub" style="width:100%;padding:8px">' + dubOpts + '</select></label></p>'
    + '<p><label>Çözünürlük<br><select name="res" style="width:100%;padding:8px">' + resOpts + '</select></label></p>'
    + '<p><label><input type="checkbox" name="all"' + (s.all ? ' checked' : '') + '> Her sitenin kaynağını ayrı göster (tercih sadece sıralar)</label></p>'
    + '<p><label><input type="checkbox" name="strict"' + (s.strict ? ' checked' : '') + '> Sadece seçtiğim dil (diğer dilleri hiç gösterme)</label></p>'
    + '<p><button type="submit" style="padding:10px 18px">Kaydet</button></p></form>'
    + '<p style="color:#888">Bu sayfa toplayıcının çalıştığı makinede açılmalı.</p></body></html>';
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 10000) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const send = (code, body, h = JSON_H) => { res.writeHead(code, h); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    const html = (code, body) => send(code, body, { 'content-type': 'text/html; charset=utf-8' });
    try {
      if (p === '/' || (p === '/configure' && req.method === 'GET')) return html(200, renderConfigure(loadSettings(), url.searchParams.get('saved') === '1'));
      if (p === '/configure' && req.method === 'POST') {
        const form = new URLSearchParams(await readBody(req));
        const s = normalize({ dub: form.get('dub'), res: form.get('res'), strict: form.has('strict'), all: form.has('all') });
        saveSettings(s);
        log('settings saved', s);
        res.writeHead(303, { location: '/configure?saved=1' });
        return res.end();
      }
      if (p === '/manifest.json') return send(200, manifestFor(loadSettings(), 'local.unified.turkce'));
      if (p === '/badges.json') return send(200, badgePack());
      const bm = p.match(/^\/badges\/([\w.-]+\.png)$/);
      if (bm) {
        const file = path.join(HERE, 'badges', bm[1]);
        if (!fs.existsSync(file)) return send(404, { error: 'not found' });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
        return res.end(fs.readFileSync(file));
      }
      let m = p.match(/^\/dubs\/(movie|series)\/(.+)\.json$/);
      if (m) { try { return send(200, { dubs: await dubsFor(m[1], decodeId(m[2])) }); } catch (e) { return send(200, { dubs: [], error: e.message }); } }
      m = p.match(/^\/sync\/(movie|series)\/(.+)\.json$/);
      if (m) return send(200, await measureDelay(m[1], decodeId(m[2]), Number(url.searchParams.get('i')), url.searchParams.get('src')));
      m = p.match(/^\/c\/([^/]+)\/manifest\.json$/);
      if (m) return send(200, manifestFor(decodeConfig(m[1]), 'local.unified.' + m[1].slice(0, 16)));
      m = p.match(/^\/(?:c\/([^/]+)\/)?stream\/(movie|series)\/(.+)\.json$/);
      if (m) {
        const cfg = m[1] ? decodeConfig(m[1]) : loadSettings();
        try { return send(200, { streams: await streamsFor(cfg, m[2], m[3]) }); }
        catch (e) { log('stream error', e.message); return send(200, { streams: [] }); }
      }
      send(404, { error: 'not found' });
    } catch (e) {
      log('error', e.message);
      send(500, { error: e.message });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, HOST, () => log('unified on http://' + HOST + ':' + PORT + ' upstream ' + UPSTREAM));
}

