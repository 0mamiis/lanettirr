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
const pxCache = new Map(); let pxBytes = 0;   // on-indirilen parcalar (3 dk, en fazla 300 MB)
const pxKey = (q) => JSON.stringify([q.get('u'), q.get('r') || '', q.get('o') || '']);
function pxHeaders(q) { const h = { 'user-agent': PX_UA, accept: '*/*' }; if (q.get('r')) h.referer = q.get('r'); if (q.get('o')) h.origin = q.get('o'); return h; }
function pxFull(q) {
  const k = pxKey(q); const e0 = pxCache.get(k);
  if (e0 && Date.now() - e0.t < 180000) return e0.p;
  const e = { t: Date.now(), n: 0 };
  e.p = (async () => { const r = await fetch(q.get('u'), { headers: pxHeaders(q), redirect: 'follow', signal: AbortSignal.timeout(60000) }); const buf = Buffer.from(await r.arrayBuffer()); return { status: r.status, ct: r.headers.get('content-type'), buf }; })();
  pxCache.set(k, e);
  e.p.then((x) => { if (x.status >= 400) { pxCache.delete(k); return; } e.n = x.buf.length; pxBytes += e.n; for (const [kk, v] of pxCache) { if (pxBytes <= 300e6 && Date.now() - v.t < 180000) break; pxCache.delete(kk); pxBytes -= v.n; } }).catch(() => pxCache.delete(k));
  return e.p;
}
async function localPx(req, res) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    const u = q.get('u');
    if (!u || !/^https?:\/\//.test(u)) { res.writeHead(400, cors); return res.end(); }
    if (q.get('nx')) { try { for (const qs of JSON.parse(q.get('nx')).slice(0, 3)) pxFull(new URLSearchParams(qs)).catch(() => {}); } catch {} }
    const rg = req.headers.range;
    if (!rg || /^bytes=0-$/.test(rg)) {   // tam parca: on-indirme onbellegini kullan
      const x = await pxFull(q);
      const out = { ...cors, 'content-type': x.ct || 'video/mp2t', 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
      if (x.status >= 400) { res.writeHead(x.status, out); return res.end(x.buf); }
      if (rg) { res.writeHead(206, { ...out, 'content-range': 'bytes 0-' + (x.buf.length - 1) + '/' + x.buf.length, 'content-length': x.buf.length }); return res.end(x.buf); }
      res.writeHead(200, { ...out, 'content-length': x.buf.length }); return res.end(x.buf);
    }
    const h = pxHeaders(q);
    if (req.headers.range) h.range = req.headers.range;
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const r = await fetch(u, { headers: h, redirect: 'follow', signal: ac.signal });
    const out = { ...cors, 'content-type': r.headers.get('content-type') || 'video/mp2t', 'cache-control': 'no-store' };
    for (const k of ['content-length', 'content-range', 'accept-ranges']) { const v = r.headers.get(k); if (v) out[k] = v; }
    if (r.headers.get('content-encoding')) delete out['content-length'];
    res.writeHead(r.status, out);
    if (!r.body || req.method === 'HEAD') return res.end();
    const rd = r.body.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; if (!res.write(value)) await new Promise((ok) => res.once('drain', ok)); }
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
  out.on('error', (e) => { bad(up); if (!res.headersSent) res.writeHead(502); res.end('egress error ' + e.message); });
  res.on('close', () => out.destroy());
  req.pipe(out);
});

server.on('connect', async (req, cs, head) => {
  const up = await pick();
  const i = req.url.lastIndexOf(':');
  const h = req.url.slice(0, i); const p = Number(req.url.slice(i + 1)) || 443;
  const t = up ? net.connect(up.port, up.host) : net.connect(p, h);
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
