// TorrentLIO motoru: torrenti sunucuda acar, videoyu ve diger Turk kaynaklarin seslerini tek bir HLS akisinda birlestirir.
// Orijinal Nuvio'nun kendi ses menusu parcalari gosterir; gecikme duzeltmesi sunucuda yapilir.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpegPath } from '../unified/audiosync.mjs';
import { mSlot, measureDub } from './tl-measure.mjs';
import { makePieceStore } from './tl-store.mjs';

const TL_PORT = Number(process.env.TL_PORT || 18100);
const SEG = 6.4;   // 300 AAC cercevesi: ses parcalari birbirine tam oturur
const DIR = path.join(os.tmpdir(), 'trhub-tl');
let tlRuntimeReady = false;
function ensureTlRuntime() {
  if (!tlRuntimeReady) {
    tlRuntimeReady = true;
    try { fs.mkdirSync(DIR, { recursive: true }); } catch {}
    setInterval(housekeeping, 2 * 60 * 1000).unref();
  }
}
const TRACKERS = ['udp://tracker.opentrackr.org:1337/announce', 'udp://open.stealth.si:80/announce', 'udp://tracker.torrent.eu.org:451/announce', 'udp://exodus.desync.com:6969/announce', 'udp://open.demonii.com:1337/announce', 'udp://tracker.tiny-vps.com:6969/announce', 'udp://explodie.org:6969/announce', 'udp://tracker.moeking.me:6969/announce', 'udp://open.tracker.cl:1337/announce', 'wss://tracker.webtorrent.dev', 'wss://tracker.openwebtorrent.com'];
const FFMPEG = ffmpegPath();
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
const log = (...a) => { try { fs.appendFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), 'hub.log'), new Date().toISOString() + ' tl ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n'); } catch {} };


// ---------- Nuvio'nun torrent ayarlari (PC'de kurulu Nuvio'dan okunur) ----------
export function nuvioTorrentInfo() {
  const d = { upload: true, profile: 'BALANCED', cache: 'GB_2', source: 'varsayilan' };
  try {
    const f = path.join(process.env.APPDATA || '', 'Nuvio', 'torrent_settings.properties');
    const m = {};
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) m[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
    const g = (k) => m[k + '_1'] ?? m[k];
    if (g('enable_upload') !== undefined) d.upload = g('enable_upload') !== 'false';
    if (g('torrent_profile')) d.profile = g('torrent_profile').toUpperCase();
    if (g('cache_size')) d.cache = g('cache_size').toUpperCase();
    d.source = 'Nuvio';
  } catch {}
  d.maxConns = { SOFT: 30, BALANCED: 55, FAST: 100 }[d.profile] || 55;
  d.capBytes = { NONE: 0, GB_2: 2, GB_5: 5, GB_10: 10 }[d.cache] * 1024 ** 3;
  if (Number.isNaN(d.capBytes)) d.capBytes = 2 * 1024 ** 3;
  return d;
}
const lastUse = new Map();
const touch = (hash) => lastUse.set(hash.toLowerCase(), Date.now());
function dirSize(p) { let n = 0; try { const st = fs.statSync(p); if (st.isFile()) return st.size; for (const f of fs.readdirSync(p)) n += dirSize(path.join(p, f)); } catch {} return n; }
async function housekeeping() {
  try {
    const cfg = nuvioTorrentInfo();
    // acil durum: bos disk 8 GB altina inerse tum torrentleri kapat ve indirilenleri sil
    try { const sf = fs.statfsSync(DIR); if (sf.bavail * sf.bsize < Number(process.env.TL_MIN_FREE_GB || 8) * 1024 ** 3) { log('DISK AZ: tum torrentler kapatildi'); for (const [h, p] of [...torrents]) { try { (await p).destroy({ destroyStore: true }); } catch {} torrents.delete(h); } sessions.clear(); fs.rmSync(path.join(DIR, 'dl'), { recursive: true, force: true }); return; } } catch {}
    for (const [hash, p] of [...torrents]) {
      if (Date.now() - (lastUse.get(hash) || 0) < 5 * 60 * 1000) continue;
      try { const tor = await p; tor.destroy({ destroyStore: true }); } catch {}
      torrents.delete(hash); lastUse.delete(hash);
      for (const k of [...sessions.keys()]) if (k.startsWith(hash)) sessions.delete(k);
    }
    const dl = path.join(DIR, 'dl'); if (!fs.existsSync(dl)) return;
    const active = new Set(); for (const p of torrents.values()) { try { active.add((await p).infoHash); } catch {} }
    const entries = fs.readdirSync(dl).filter((n) => !active.has(n)).map((n) => ({ n, p: path.join(dl, n), t: fs.statSync(path.join(dl, n)).mtimeMs, s: dirSize(path.join(dl, n)) })).sort((a, b) => a.t - b.t);
    let total = entries.reduce((a, e) => a + e.s, 0);
    for (const e of entries) { if (total <= cfg.capBytes) break; fs.rmSync(e.p, { recursive: true, force: true }); total -= e.s; log('onbellek temizlendi', e.n); }
  } catch (e) { log('housekeeping', e.message); }
}


// ---------- torrent ----------
let client = null;
async function engine() {
  if (client) return client;
  ensureTlRuntime();
  const { default: WebTorrent } = await import('webtorrent');
  const nt = nuvioTorrentInfo();
  client = new WebTorrent({ maxConns: nt.maxConns, uploadLimit: nt.upload ? -1 : 1 });
  log('torrent ayarlari (Nuvio)', nt);
  client.on('error', (e) => { log('client error', String(e && e.stack || e)); client = null; torrents.clear(); sessions.clear(); });
  const sv = client.createServer();
  await new Promise((r) => sv.listen(TL_PORT, '127.0.0.1', r));
  return client;
}
const PieceStore = makePieceStore(path.join(DIR, 'dl'));
const torrents = new Map();
const isTorrentFile = (b) => b.length > 100 && b[0] === 100 && b[b.length - 1] === 101 && b.includes('4:info');
async function fetchTorrentFile(hash) {
  const dir = path.join(DIR, 'meta'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, hash.toLowerCase() + '.torrent');
  try { const b = fs.readFileSync(f); if (isTorrentFile(b)) return b; } catch {}
  const urls = ['https://itorrents.org/torrent/' + hash.toUpperCase() + '.torrent'];
  for (const u of urls) {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0' } }); if (!r.ok) continue; const b = Buffer.from(await r.arrayBuffer()); if (isTorrentFile(b)) { fs.writeFileSync(f, b); return b; } } catch {}
  }
  return null;
}
export async function openTorrent(hash, idx, extra = []) {
  const key = hash.toLowerCase();
  touch(key);
  let p = torrents.get(key);
  if (!p) {
    p = (async () => {
      const c = await engine();
      const trs = [...new Set([...extra, ...TRACKERS])];
      const magnet = 'magnet:?xt=urn:btih:' + key + trs.map((t) => '&tr=' + encodeURIComponent(t)).join('');
      const meta = await fetchTorrentFile(key);   // metadata'yi esler yerine HTTP onbellegi uzerinden hizlica al
      const tor = c.add(meta || magnet, meta ? { store: PieceStore, announce: trs, deselect: true } : { store: PieceStore, deselect: true });
      if (meta) log('torrent dosyasi onbellekten alindi', key.slice(0, 8), meta.length);
      tor.on('error', (e) => log('torrent error', String(e)));
      await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('torrent metadata timeout')), 90000); tor.on('ready', () => { clearTimeout(t); res(); }); tor.on('error', (e) => { clearTimeout(t); rej(e); }); });
      return tor;
    })();
    torrents.set(key, p);
    p.catch(() => torrents.delete(key));
  }
  const tor = await p;
  let f = Number.isInteger(idx) ? tor.files[idx] : null;
  if (!f) f = [...tor.files].filter((x) => /\.(mkv|mp4|avi|webm|m4v)$/i.test(x.name)).sort((a, b) => b.length - a.length)[0];
  if (!f) throw new Error('no video file in torrent');
  // select() yok: sadece oynaticinin istedigi araliklar inerken disk dolmaz
  return { url: 'http://127.0.0.1:' + TL_PORT + f.streamURL, name: f.name, length: f.length, torrent: tor };
}

// ---------- ffmpeg ----------
const pools = { v: { running: 0, max: 3, wait: [] }, a: { running: 0, max: 3, wait: [] } };
const slot = (kind = 'a') => new Promise((res) => { const p = pools[kind]; const go = () => { p.running++; res(() => { p.running--; const n = p.wait.shift(); if (n) n(); }); }; if (p.running < p.max) go(); else p.wait.push(go); });
function run(cmd, args, { timeout = 120000, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    const out = []; let err = '';
    const t = setTimeout(() => { p.kill(); reject(new Error('timeout')); }, timeout);
    p.stdout.on('data', (d) => out.push(d)); p.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-2000); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); const b = Buffer.concat(out); code === 0 || b.length > 1000 ? resolve(binary ? b : b.toString('utf8')) : reject(new Error('ffmpeg ' + code + ' ' + err.slice(-300))); });
  });
}
async function probe(url) {
  const j = JSON.parse(await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration:stream=index,codec_type,codec_name,width,height,color_transfer,color_primaries:stream_tags=language,title', '-of', 'json', url], { timeout: 90000 }));
  const audios = (j.streams || []).filter((s) => s.codec_type === 'audio').map((s, i) => ({ i, lang: (s.tags?.language || '').toLowerCase(), title: s.tags?.title || '' }));
  const v = (j.streams || []).find((s) => s.codec_type === 'video') || {};
  return { duration: Number(j.format?.duration) || 0, audios, width: v.width || 1920, height: v.height || 1080, hevc: /hevc|h265/i.test(String(v.codec_name || '')), hdr: /smpte2084|arib-std-b67/.test(String(v.color_transfer || '')) };
}
const cachePath = (key, name) => { const d = path.join(DIR, 'seg', key); fs.mkdirSync(d, { recursive: true }); return path.join(d, name); };
const pending = new Map();
async function cached(file, make, kind = 'a') {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file);
  if (pending.has(file)) return pending.get(file);
  const p = (async () => {
    const done = await slot(kind);
    try { if (fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file); const b = await make(); fs.writeFileSync(file, b); return b; } finally { done(); }
  })();
  pending.set(file, p);
  p.finally(() => pending.delete(file)).catch(() => {});
  return p;
}
const ts = (n) => n.toFixed(3);
export const videoSegment = (s, n) => { if (n >= 2) startMeasure(s); for (let k = 1; k <= 3; k++) if (n + k < count(s)) videoSegmentRaw(s, n + k).catch(() => {}); return videoSegmentRaw(s, n); };
const videoSegmentRaw = (s, n) => cached(cachePath(s.key, 'v' + n + '.ts'), () => {
  const T = n * SEG;
  const LITE = process.env.TL_LITE === '1';
  const h = Math.min(LITE ? 720 : 1080, s.info.height);
  return run(FFMPEG, ['-v', 'error', ...(process.platform === 'win32' && (s.info.height > 1080 || s.info.hevc) ? ['-hwaccel', 'd3d11va'] : []), '-ss', ts(T), '-i', s.file.url, '-t', String(SEG), '-map', '0:v:0', '-an', '-vf', 'scale=-2:' + h + ',format=yuv420p', '-c:v', 'libx264', '-preset', LITE ? 'ultrafast' : 'veryfast', '-crf', LITE ? '26' : '21', '-maxrate', LITE ? '4M' : '9M', '-bufsize', LITE ? '8M' : '18M', '-g', '48', '-force_key_frames', 'expr:gte(t,0)', '-output_ts_offset', ts(T), '-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', 'pipe:1'], { timeout: 150000, binary: true });
}, 'v');
function audioArgs(src, T, shift, aidx) {
  const start = T - shift;           // kaynak zamani
  const lead = start < 0 ? Math.min(SEG, -start) : 0;
  const pre = ['-ss', ts(Math.max(0, start))];
  const pad = lead > 0 ? ['-af', 'adelay=' + Math.round(lead * 1000) + ':all=1'] : [];
  return [...pre, '-i', src, '-t', String(SEG - lead), '-map', '0:a:' + aidx, '-vn', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000', ...pad, '-output_ts_offset', ts(T + lead), '-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', 'pipe:1'];
}
async function dubAudioIndex(d) {
  if (d.aidx === undefined) d.aidx = run(FFPROBE, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream_tags=language', '-of', 'csv=p=0', d.probe], { timeout: 60000 }).then((o) => { const l = o.split(/\r?\n/).map((x) => x.trim().toLowerCase()).filter(Boolean); const i = l.findIndex((x) => /^(tur|tr)/.test(x)); return i >= 0 ? i : 0; }).catch(() => 0);
  return d.aidx;
}
const silence = (T) => run(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(SEG), '-c:a', 'aac', '-b:a', '64k', '-output_ts_offset', ts(T), '-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', 'pipe:1'], { binary: true });
export const origAudioSegment = (s, k, n) => cached(cachePath(s.key, 'o' + k + '_' + n + '.ts'), async () => {
  const T = n * SEG;
  try { return await run(FFMPEG, ['-v', 'error', '-ss', ts(T), '-i', s.file.url, '-t', String(SEG), '-map', '0:a:' + k + '?', '-vn', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000', '-output_ts_offset', ts(T), '-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', 'pipe:1'], { timeout: 120000, binary: true }); }
  catch { return silence(T); }
});
export async function dubDelay(s, k) {
  const d = s.dubs[k];
  if (d.delay === undefined) {
    d.delay = (async () => {
      const done = await mSlot();
      try { const r = await measureDub(s, d); d.result = r; d.done = true; log('delay', d.title, r.ok ? r.delayMs : 'yok', r.confidence || r.reason || ''); return r.ok ? r.delayMs : null; }
      catch (e) { log('delay hata', d.title, e.message); return null; }
      finally { done(); }
    })();
  }
  return d.delay;
}
const silentSegs = new Map();
const silentSeg = (n) => { if (!silentSegs.has(n)) silentSegs.set(n, silence(n * SEG)); return silentSegs.get(n); };
export function startMeasure(s) { if (s.measuring) return; s.measuring = true; s.dubs.forEach((_, k) => { dubDelay(s, k); }); }
export async function dubSegment(s, k, n) {
  if (n >= 3) startMeasure(s);
  if (n <= 2) {   // oynatici acilista TUM ses listelerinin ilk parcasini ister: bekletme, sessiz don; gercek parca arkada hazirlanir
    const f0 = cachePath(s.key, 'd' + k + '_' + n + '.ts');
    if (fs.existsSync(f0) && fs.statSync(f0).size > 0) return fs.readFileSync(f0);
    if (s.dubs[k].delay !== undefined && s.dubs[k].done && !s['_bg' + k + '_' + n]) { s['_bg' + k + '_' + n] = true; setImmediate(() => { dubSegmentReal(s, k, n).catch(() => {}); }); }
    return silentSeg(n);
  }
  return dubSegmentReal(s, k, n);
}
async function dubSegmentReal(s, k, n) {
  const T = n * SEG, d = s.dubs[k];
  const file = cachePath(s.key, 'd' + k + '_' + n + '.ts');
  const known0 = d.delay !== undefined ? await Promise.race([d.delay, new Promise((r) => setTimeout(() => r(undefined), 50))]) : undefined;
  const delay = n === 0 ? known0 : await Promise.race([dubDelay(s, k), new Promise((r) => setTimeout(() => r(undefined), 20000))]);   // ilk parca (oynatici taramasi) beklemez
  const make = async () => run(FFMPEG, ['-v', 'error', ...audioArgs(d.probe, T, (delay || 0) / 1000, await dubAudioIndex(d))], { timeout: 90000, binary: true });
  const known = delay !== undefined;   // olcum bitmediyse onbellege yazma
  if (known && fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file);
  const done = await slot();
  try { const bf = await make(); if (known) fs.writeFileSync(file, bf); return bf; }
  catch (e) { log('dub segment hata', d.title, n, e.message); return silence(T); }
  finally { done(); }
}

// ---------- oturum ----------
const sessions = new Map();
export async function session({ hash, idx, extraTrackers, dubsProvider, maxDubs = 8 }) {
  ensureTlRuntime();
  touch(hash);
  const key = hash.toLowerCase() + '-' + (idx ?? 'a');
  let p = sessions.get(key);
  if (!p) {
    p = (async () => {
      const file = await openTorrent(hash, idx, extraTrackers);
      const info = await probe(file.url);
      const dubs = (await dubsProvider()).slice(0, maxDubs).map((d) => ({ title: d.title, probe: d.probe, lang: d.lang }));
      const s = { key, file, info, dubs, t: Date.now() };
      // arka planda olcumleri baslat
      return s;
    })();
    sessions.set(key, p);
    p.catch(() => sessions.delete(key));
  }
  return p;
}

export async function sessionUrl({ key, url, maxDubs = 8, dubsProvider }) {
  ensureTlRuntime();
  let p = sessions.get(key);
  if (!p) {
    p = (async () => {
      const info = await probe(url);
      const dubs = (await dubsProvider()).slice(0, maxDubs).map((d) => ({ title: d.title, probe: d.probe, lang: d.lang }));
      return { key, file: { url }, info, dubs, t: Date.now() };
    })();
    sessions.set(key, p);
    p.catch(() => sessions.delete(key));
  }
  return p;
}

const count = (s) => Math.max(1, Math.ceil(s.info.duration / SEG));
const mediaPl = (s, prefix) => {
  const n = count(s), last = s.info.duration - (n - 1) * SEG;
  const l = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:' + Math.ceil(SEG), '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD'];
  for (let i = 0; i < n; i++) { l.push('#EXTINF:' + (i === n - 1 ? Math.max(0.1, last) : SEG).toFixed(3) + ','); l.push(prefix + i + '.ts'); }
  l.push('#EXT-X-ENDLIST');
  return l.join('\n') + '\n';
};
// ffmpeg HLS adini 'comment' etiketine yazar, oynatici sadece dil kodunu gosterir: kaynak adini dil etiketine koyuyoruz
const langTag = (t) => (String(t).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).slice(0, 40);
const clean = (t) => String(t).replace(/["\r\n,]/g, ' ');
export async function masterPl(s) {
  // olcumu kesin basarisiz olanlari (eslesmeyen kaynak) listeye alma; bitmeyenleri yine de ekle
  const rows = ['#EXTM3U', '#EXT-X-VERSION:4'];
  s.info.audios.slice(0, 3).forEach((a, k) => rows.push('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="' + clean('Orijinal' + (a.lang ? ' (' + a.lang + ')' : '')) + '",LANGUAGE="' + (a.lang || 'und').slice(0, 3) + '",DEFAULT=' + (k === 0 ? 'YES' : 'NO') + ',AUTOSELECT=YES,URI="o' + k + '.m3u8"'));
  const okRank = (d) => (d.result && d.result.ok ? 0 : d.result ? 2 : 1);   // olculenler once, bekleyenler sonra
  s.dubs.map((d, k) => [d, k]).sort((a, b) => okRank(a[0]) - okRank(b[0]) || a[1] - b[1]).forEach(([d, k]) => {
    rows.push('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="' + clean(d.title) + '",LANGUAGE="' + langTag(d.title) + '",DEFAULT=NO,AUTOSELECT=NO,URI="d' + k + '.m3u8"');
  });
  rows.push('#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=' + Math.round(s.info.width * Math.min(1, 1080 / s.info.height) / 2) * 2 + 'x' + Math.min(1080, s.info.height) + ',AUDIO="aud"', 'v.m3u8');
  return rows.join('\n') + '\n';
}
export const videoPl = (s) => mediaPl(s, 'v');
export const audioPl = (s, kind, k) => mediaPl(s, kind + k + '_');

export function shutdown() { try { client?.destroy(); } catch {} }

export async function status() { const out = []; for (const [h, p] of torrents) { try { const tor = await Promise.race([p, new Promise((r) => setTimeout(() => r(null), 500))]); out.push(tor ? { hash: h, name: tor.name, peers: tor.numPeers, mbps: +(tor.downloadSpeed * 8 / 1e6).toFixed(2), progress: +(tor.progress * 100).toFixed(2), size: tor.length } : { hash: h, state: 'metadata bekleniyor' }); } catch (e) { out.push({ hash: h, err: String(e.message) }); } } return out; }
