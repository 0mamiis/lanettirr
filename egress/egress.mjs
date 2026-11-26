// Egress forward proxy. Roles:
//  - EGRESS_UPSTREAMS empty  -> plain forward proxy (run locally, e.g. 127.0.0.1:7301)
//  - EGRESS_UPSTREAMS set    -> chooser: sends traffic through the first reachable upstream, falls back to direct
import http from 'node:http';
import net from 'node:net';

const HOST = process.env.EGRESS_HOST || '127.0.0.1';
const PORT = Number(process.env.EGRESS_PORT || 7301);
const ups = (process.env.EGRESS_UPSTREAMS || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
  const i = s.lastIndexOf(':');
  return { host: s.slice(0, i), port: Number(s.slice(i + 1)), ok: false, at: 0 };
});
const log = (...a) => console.log(new Date().toISOString(), ...a);

const probe = (u) => new Promise((res) => {
  const s = net.connect({ host: u.host, port: u.port });
  const done = (v) => { s.destroy(); res(v); };
  s.setTimeout(1500, () => done(false));
  s.once('connect', () => done(true));
  s.once('error', () => done(false));
});
async function pick() {
  for (const u of ups) {
    if (Date.now() - u.at > 8000) { u.ok = await probe(u); u.at = Date.now(); log('upstream', u.host + ':' + u.port, u.ok ? 'UP' : 'DOWN'); }
    if (u.ok) return u;
  }
  return null;
}
const bad = (u) => { if (u) { u.ok = false; u.at = Date.now(); } };

// Local segment proxy: video parcasini dogrudan bu cihazin kendi internetinden ceker
const PX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PX_MAX_BYTES = Math.max(8, Number(process.env.EGRESS_CACHE_MB || 64)) * 1024 * 1024;
const PX_MAX_ITEM_BYTES = Math.min(12 * 1024 * 1024, Math.floor(PX_MAX_BYTES / 2));
const PX_TTL_MS = Math.max(15000, Number(process.env.EGRESS_CACHE_TTL_MS || 90000));
const PX_PREFETCH = Math.max(0, Math.min(3, Number(process.env.EGRESS_PREFETCH ?? 2)));
const pxCache = new Map(); let pxBytes = 0;
function isSafeTargetUrl(raw) {
  let u; try { u = new URL(String(raw || '')); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = String(u.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal' || host === 'metadata') return false;
  const isPriv4 = (ip) => { const p = ip.split('.').map(Number); return p.length !== 4 || p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168); };
  const ver = net.isIP(host);
  if (ver === 4) return !isPriv4(host);
  if (ver === 6) {
    if (host === '::' || host === '::1' || /^(fe[89ab]|fc|fd)/i.test(host)) return false;
    const m4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host);
    if (m4) return !isPriv4(m4[1]);
    const m4h = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
    if (m4h) { const hi = parseInt(m4h[1], 16), lo = parseInt(m4h[2], 16); return !isPriv4([(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.')); }
  }
  return true;
}
const pxEvict = () => {
  const now = Date.now();
  for (const [kk, v] of pxCache) {
    if (pxBytes <= PX_MAX_BYTES && pxCache.size <= 80 && now - v.t < PX_TTL_MS) break;
    pxCache.delete(kk); pxBytes = Math.max(0, pxBytes - (v.n || 0));
  }
};
setInterval(pxEvict, 60000).unref();
const pxKey = (q) => JSON.stringify([q.get('u'), q.get('r') || '', q.get('o') || '']);
function pxHeaders(q) { const h = { 'user-agent': PX_UA, accept: '*/*' }; if (q.get('r')) h.referer = q.get('r'); if (q.get('o')) h.origin = q.get('o'); return h; }
function pxFull(q) {
  const k = pxKey(q); const e0 = pxCache.get(k);
  if (e0 && Date.now() - e0.t < PX_TTL_MS) return e0.p;
  if (e0) { pxCache.delete(k); pxBytes = Math.max(0, pxBytes - (e0.n || 0)); }
  const e = { t: Date.now(), n: 0 };
  e.p = (async () => {
    const u = q.get('u');
    if (!isSafeTargetUrl(u)) return { status: 403, ct: 'text/plain', buf: Buffer.alloc(0) };
    const r = await fetch(u, { headers: pxHeaders(q), redirect: 'follow', signal: AbortSignal.timeout(60000) });
    if (r.url && !isSafeTargetUrl(r.url)) { try { await r.body?.cancel(); } catch {} return { status: 403, ct: 'text/plain', buf: Buffer.alloc(0) }; }
    const cl = parseInt(r.headers.get('content-length') || '0', 10);
    if (cl > PX_MAX_ITEM_BYTES) { try { await r.body?.cancel(); } catch {} return { tooLarge: true }; }
    if (!r.body) return { status: r.status, ct: r.headers.get('content-type'), buf: Buffer.alloc(0) };
    const rd = r.body.getReader(); const chunks = []; let total = 0;
    while (true) {
      const { done, value } = await rd.read(); if (done) break;
      if (value && value.length) {
        total += value.length;
        if (total > PX_MAX_ITEM_BYTES) { try { await rd.cancel(); } catch {} return { tooLarge: true }; }
        chunks.push(Buffer.from(value));
      }
    }
    return { status: r.status, ct: r.headers.get('content-type'), buf: chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total) };
  })();
  pxCache.set(k, e);
  e.p.then((x) => { if (!x || x.tooLarge || x.status >= 400) { if (pxCache.get(k) === e) pxCache.delete(k); return; } if (pxCache.get(k) !== e) return; e.n = x.buf.length; pxBytes += e.n; pxEvict(); }).catch(() => { if (pxCache.get(k) === e) pxCache.delete(k); });
  return e.p;
}
async function localPx(req, res) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    const u = q.get('u');
    if (!u || !/^https?:\/\//.test(u)) { res.writeHead(400, cors); return res.end(); }
    if (!isSafeTargetUrl(u)) { res.writeHead(403, cors); return res.end(); }
    if (PX_PREFETCH > 0 && q.get('nx')) { try { for (const qs of JSON.parse(q.get('nx')).slice(0, PX_PREFETCH)) pxFull(new URLSearchParams(qs)).catch(() => {}); } catch {} }
    const rg = req.headers.range;
    const isSegHint = /^\/px\/s\.ts\b/i.test(req.url) || Boolean(q.get('nx')) || /\.(ts|m4s|aac|key)(\?|$)/i.test(u);
    if (isSegHint && (!rg || /^bytes=0-$/.test(rg))) {   // tam parca: on-indirme onbellegini kullan
      const x = await pxFull(q);
      if (x && !x.tooLarge) {
        const out = { ...cors, 'content-type': x.ct || 'video/mp2t', 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
        if (x.status >= 400) { res.writeHead(x.status, out); return res.end(x.buf); }
        if (rg && x.buf.length > 0) { res.writeHead(206, { ...out, 'content-range': 'bytes 0-' + (x.buf.length - 1) + '/' + x.buf.length, 'content-length': x.buf.length }); return res.end(x.buf); }
        res.writeHead(200, { ...out, 'content-length': x.buf.length }); return res.end(x.buf);
      }
    }
    const h = pxHeaders(q);
    if (req.headers.range) h.range = req.headers.range;
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const r = await fetch(u, { headers: h, redirect: 'follow', signal: ac.signal });
    if (r.url && !isSafeTargetUrl(r.url)) { try { await r.body?.cancel(); } catch {} res.writeHead(403, cors); return res.end(); }
    const out = { ...cors, 'content-type': r.headers.get('content-type') || 'video/mp2t', 'cache-control': 'no-store' };
    for (const k of ['content-length', 'content-range', 'accept-ranges']) { const v = r.headers.get(k); if (v) out[k] = v; }
    if (r.headers.get('content-encoding')) delete out['content-length'];
    res.writeHead(r.status, out);
    if (!r.body || req.method === 'HEAD') return res.end();
    const rd = r.body.getReader();
    for (;;) {
      if (res.destroyed || res.writableEnded) { try { await rd.cancel(); } catch {} break; }
      const { done, value } = await rd.read(); if (done) break;
      if (!res.write(value)) {
        await new Promise((ok) => {
          if (res.destroyed || res.writableEnded) return ok();
          const fin = () => { res.off('drain', fin); res.off('close', fin); res.off('error', fin); ok(); };
          res.once('drain', fin); res.once('close', fin); res.once('error', fin);
        });
      }
    }
    res.end();
  } catch (e) { if (!res.headersSent) { res.writeHead(502, cors); res.end('px ' + e.message); } else res.destroy(); }
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/px')) return localPx(req, res);
  let target;
  try { target = new URL(req.url); } catch { res.writeHead(400); return res.end('absolute URI required'); }
  const up = await pick();
  const headers = { ...req.headers };
  delete headers['proxy-connection'];
  const opts = up
    ? { host: up.host, port: up.port, method: req.method, path: req.url, headers }
    : { host: target.hostname, port: target.port || 80, method: req.method, path: target.pathname + target.search, headers };
  const out = http.request(opts, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  out.setTimeout(30000, () => out.destroy(new Error('timeout')));
  out.on('error', (e) => { bad(up); if (!res.headersSent) res.writeHead(502); res.end('egress error ' + e.message); });
  res.on('close', () => out.destroy());
  req.pipe(out);
});

server.on('connect', async (req, cs, head) => {
  const up = await pick();
  const i = req.url.lastIndexOf(':');
  const h = req.url.slice(0, i); const p = Number(req.url.slice(i + 1)) || 443;
  const t = up ? net.connect(up.port, up.host) : net.connect(p, h);
  t.setTimeout(60000, () => t.destroy());
  cs.setTimeout(60000, () => cs.destroy());
  const fail = (m) => { try { cs.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {} t.destroy(); log('connect fail', req.url, m || ''); };
  cs.on('error', () => t.destroy());
  t.on('error', (e) => { bad(up); fail(e.message); });
  const pipeUp = () => { if (head && head.length) t.write(head); t.pipe(cs); cs.pipe(t); };
  if (!up) {
    t.once('connect', () => { cs.write('HTTP/1.1 200 Connection Established\r\n\r\n'); pipeUp(); });
  } else {
    t.once('connect', () => {
      t.write('CONNECT ' + req.url + ' HTTP/1.1\r\nHost: ' + req.url + '\r\n\r\n');
      let buf = Buffer.alloc(0);
      const onData = (d) => {
        buf = Buffer.concat([buf, d]);
        if (buf.length > 16384) { t.off('data', onData); return fail('upstream header too large'); }
        const k = buf.indexOf('\r\n\r\n');
        if (k < 0) return;
        t.off('data', onData);
        if (!/^HTTP\/1\.[01] 200/.test(buf.toString('latin1', 0, 15))) return fail('upstream refused');
        cs.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const rest = buf.subarray(k + 4);
        if (rest.length) cs.write(rest);
        pipeUp();
      };
      t.on('data', onData);
    });
  }
});

server.on('clientError', (e, s) => { try { s.destroy(); } catch {} });
process.on('uncaughtException', (e) => log('uncaught', e && e.message));
server.listen(PORT, HOST, () => log('egress on', HOST + ':' + PORT, ups.length ? 'upstreams ' + ups.map((u) => u.host + ':' + u.port).join(',') : '(plain proxy)'));
