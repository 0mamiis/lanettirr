// BigBullApp (CloudStream .cs3) providers served through the local JVM host (cs-host, port 7200).
const HOST = process.env.BB_HOST || 'http://127.0.0.1:7200';
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();
const MOVIE_TYPES = new Set(['Movie', 'AnimeMovie', 'Cartoon', 'AsianDrama', 'Documentary']);
const SERIES_TYPES = new Set(['TvSeries', 'Anime', 'OVA', 'Cartoon', 'AsianDrama', 'Documentary']);

async function call(path, ms) {
  const r = await fetch(HOST + path, { signal: AbortSignal.timeout(ms) });
  const j = await r.json();
  if (j && j.error) throw new Error(String(j.error).slice(0, 160));
  return j;
}

let provCache = { t: 0, v: [] };
export async function providers() {
  if (Date.now() - provCache.t < 60000 && provCache.v.length) return provCache.v;
  const v = await call('/providers', 10000);
  provCache = { t: Date.now(), v };
  return v;
}

function pickResult(results, titles, year) {
  const ts = titles.filter(Boolean).map(norm).filter(Boolean);
  let best = null, bestScore = 0;
  for (const r of (results || []).slice(0, 25)) {
    const n = norm(r.name);
    let s = 0;
    for (const t of ts) {
      let c = 0;
      if (n === t) c = 100; else if (n.startsWith(t + ' ') || t.startsWith(n + ' ')) c = 70;
      if (c > s) s = c;
    }
    if (!s) continue;
    if (year && r.year) s += Math.abs(r.year - year) <= 1 ? 30 : -80;
    if (s > bestScore) { best = r; bestScore = s; }
  }
  return bestScore >= 90 ? best : null;
}

function pickEpisode(episodes, season, episode) {
  const eps = episodes || [];
  const seasons = new Set(eps.map((e) => e.season).filter((s) => s != null));
  let hit = eps.find((e) => e.episode === episode && (e.season === season || (e.season == null && (season === 1 || seasons.size === 0))));
  if (!hit && seasons.size === 0) hit = eps.find((e) => e.episode === episode);
  return hit || null;
}

function languageMark(text) {
  const t = norm(text);
  if (/dublaj|dubbed|turkce ses/.test(t)) return 'Dublaj';
  if (/altyaz|subtitle|\bsub\b/.test(t)) return 'Altyaz\u0131';
  return '';
}

function qualityOf(link) {
  const q = Number(link.quality);
  // CloudStream uses 400 for "quality unknown"; only real heights count
  if (q !== 400 && q >= 240 && q <= 4320) return q;
  const m = /(2160|1440|1080|720|480|360)p?/.exec(String(link.name || '') + ' ' + String(link.source || ''));
  return m ? Number(m[1]) : 0;
}

// Reads an HLS master playlist (through the local proxy) and returns its highest RESOLUTION height, or 0.
async function hlsHeight(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) return 0;
    const t = (await r.text()).slice(0, 200000);
    if (!t.startsWith('#EXTM3U')) return 0;
    const hs = [...t.matchAll(/RESOLUTION=\d+x(\d+)/g)].map((m) => Number(m[1]));
    return hs.length ? Math.max(...hs) : 0;
  } catch { return 0; }
}

export async function runProvider(p, ctx) {
  const { type, titles, year, season, episode, pxUrl, log, out } = ctx;
  let found = null;
  for (const t of titles) {
    const res = await call('/search?p=' + encodeURIComponent(p.name) + '&q=' + encodeURIComponent(t), 28000);
    found = pickResult(Array.isArray(res) ? res : ((res && (res.list || res.items)) || []), titles, year);
    if (found) break;
  }
  if (!found) return { provider: p.name, step: 'search', n: 0 };
  const lr = await call('/load?p=' + encodeURIComponent(p.name) + '&url=' + encodeURIComponent(found.url), 32000);
  let data = null;
  if (type === 'movie') data = lr.dataUrl || (lr.episodes && lr.episodes[0] && lr.episodes[0].data) || lr.url;
  else { const ep = pickEpisode(lr.episodes, season, episode); data = ep && ep.data; }
  if (!data) return { provider: p.name, step: 'episode', n: 0 };
  const kr = await call('/links?p=' + encodeURIComponent(p.name) + '&data=' + encodeURIComponent(data), 58000);
  const subs = (kr.subs || []).filter((s) => s && s.url).map((s, i) => ({ id: 'bb' + i, url: s.url, lang: s.lang || 'tr' }));
  let n = 0;
  const pending = [];
  for (const l of kr.links || []) {
    if (!l || !l.url || /TORRENT|MAGNET|DASH/i.test(String(l.type))) continue;
    const hdr = l.headers || {};
    const referer = l.referer || hdr.Referer || hdr.referer || '';
    let origin = '';
    try { origin = referer ? new URL(referer).origin : ''; } catch {}
    const isHls = /M3U8/i.test(String(l.type)) || /\.m3u8(\?|$)/i.test(l.url);
    const label = String(l.name || l.source || '').trim();
    const mark = languageMark(label + ' ' + p.name + ' ' + (found.name || ''));
    const stream = {
      name: (label && norm(label) !== norm(p.name) ? label + ' \u00b7 ' : '') + p.name,
      title: found.name + (type === 'series' ? ' S' + season + 'E' + episode : '') + '\n' + (label || p.name),
      url: pxUrl(l.url, referer, origin) + (isHls ? '#.m3u8' : ''),
      subtitles: subs,
      _res: qualityOf(l),
      _bb: true,
    };
    if (mark) stream._l = mark;
    out.push(stream);
    n++;
    if (isHls && !stream._res) pending.push(stream);
  }
  await Promise.all(pending.slice(0, 8).map(async (s) => { const h = await hlsHeight(s.url); if (h) s._res = h; }));
  return { provider: p.name, step: 'links', n };
}

// Queries every suitable provider in parallel; pushes streams into ctx.out as they arrive.
export async function get(ctx) {
  const { type, log } = ctx;
  const want = type === 'movie' ? MOVIE_TYPES : SERIES_TYPES;
  const all = await providers();
  const list = all.filter((p) => p.status !== 0 && (p.tvTypes || []).some((t) => want.has(t)) && (!ctx.only || ctx.only.includes(p.name)));
  const stats = [];
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const p = list[next++];
      const t0 = Date.now();
      try { const r = await Promise.race([runProvider(p, ctx), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 90000))]); stats.push({ ...r, ms: Date.now() - t0 }); }
      catch (e) { stats.push({ provider: p.name, error: String(e.message).slice(0, 100), ms: Date.now() - t0 }); }
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  if (log) log('bigbull:', list.length, 'providers,', ctx.out.length, 'streams');
  return stats;
}

