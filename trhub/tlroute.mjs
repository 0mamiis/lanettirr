import * as TL from './tl.mjs';
import crypto from 'node:crypto';
export function makeServeTl(getAgg, log) {
  return async function serveTl(req, res, st, m, url) {
    const [, hash, idxS, type, encId, name] = m;
    const id = decodeURIComponent(encId);
    const fail = (code, msg) => { res.writeHead(code, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end(String(msg)); };
    try {
      const idx = idxS === 'a' ? null : Number(idxS);
      const extra = (url.searchParams.get('tr') || '').split(',').filter(Boolean);
      const dubsProvider = async () => {
        const a = await getAgg();
        const d = await a.dubsFor(type, id).catch(() => []);
        const rank = { dub: 0, dual: 1, sub: 2, unknown: 3 };
        const sorted = [...d].sort((x, y) => (rank[x.lang] ?? 9) - (rank[y.lang] ?? 9));
        const per = new Map();   // ayni saglayicidan en fazla 2 ses
        return sorted.filter((x) => { const p = String(x.title).split(' · ')[0]; const c = per.get(p) || 0; per.set(p, c + 1); return c < 2; });
      };
      let s;
      if (hash.startsWith('mx')) {
        const src = Buffer.from(hash.slice(2), 'base64url').toString();
        const prov = url.searchParams.get('p') || '';
        const own = async () => (await dubsProvider()).filter((d) => String(d.title).split(' · ')[0] !== prov);
        s = await TL.sessionUrl({ key: 'mx-' + crypto.createHash('sha1').update(src).digest('hex'), url: src, maxDubs: st.torrentlio.maxDubs ?? 8, dubsProvider: own });
      } else s = await TL.session({ hash, idx, extraTrackers: extra, maxDubs: st.torrentlio.maxDubs ?? 8, dubsProvider });
      const sendR = (buf, ct, extra = {}) => { const h = { 'content-type': ct, 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', ...extra }; const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || ''); const total = buf.length; if (m && total) { let st = m[1] === '' ? Math.max(0, total - Number(m[2] || 0)) : Number(m[1]); let en = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), total - 1) : total - 1; if (st >= total) { res.writeHead(416, { ...h, 'content-range': 'bytes */' + total }); return res.end(); } const part = buf.subarray(st, en + 1); res.writeHead(206, { ...h, 'content-range': 'bytes ' + st + '-' + en + '/' + total, 'content-length': part.length }); return res.end(part); } res.writeHead(200, { ...h, 'content-length': total }); res.end(buf); };
      const pl = (body) => sendR(Buffer.from(body), 'application/vnd.apple.mpegurl', { 'cache-control': 'no-cache' });
      const ts = (buf) => sendR(buf, 'video/mp2t');
      let mm;
      if (name === 'master.m3u8') { const body = await TL.masterPl(s); if (!s._warm) { s._warm = true; TL.videoSegment(s, 0).catch(() => {}); TL.origAudioSegment(s, 0, 0).catch(() => {}); } return pl(body); }
      if (name === 'v.m3u8') return pl(TL.videoPl(s));
      if ((mm = name.match(/^([od])(\d+)\.m3u8$/))) return pl(TL.audioPl(s, mm[1], Number(mm[2])));
      if ((mm = name.match(/^v(\d+)\.ts$/))) return ts(await TL.videoSegment(s, Number(mm[1])));
      if ((mm = name.match(/^o(\d+)_(\d+)\.ts$/))) return ts(await TL.origAudioSegment(s, Number(mm[1]), Number(mm[2])));
      if ((mm = name.match(/^d(\d+)_(\d+)\.ts$/))) return ts(await TL.dubSegment(s, Number(mm[1]), Number(mm[2])));
      return fail(404, 'not found');
    } catch (e) { log('tl', name, e.message); return fail(502, e.message); }
  };
}
