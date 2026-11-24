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
 * Local default endpoint (add to Stremio or AIOStreams):
 *   http://127.0.0.1:3001/manifest.json
 */

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');
const vm    = require('vm');
const cheerio = require('cheerio');

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';
const HUB_URL = (process.env.HUB_URL || 'http://127.0.0.1:7100').replace(/\/+$/, '');
const HUB_HOST = (() => { try { return new URL(HUB_URL).hostname; } catch { return '127.0.0.1'; } })();

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

async function getRequestedTitle(tmdbId, mediaType) {
  const cacheKey = `${mediaType}:${tmdbId}`;
  const cached = titleCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.title;
  const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
  for (const key of TMDB_KEYS) {
    try {
      const res = await fetch(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${key}`);
      if (!res.ok) continue;
      const json = await res.json();
      const title = json.name || json.title || json.original_name || json.original_title || null;
      if (title) {
        titleCache.set(cacheKey, { title, at: Date.now() });
        return title;
      }
    } catch (_) {}
  }
  return null;
}

async function getTmdbInfo(tmdbId, mediaType) {
  const cacheKey = `info:${mediaType}:${tmdbId}`;
  const cached = infoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.info;
  const primary = await getRequestedTitle(tmdbId, mediaType);
  let info = { title: primary, mediaType };
  if (!primary) {
    const otherType = mediaType === 'tv' ? 'movie' : 'tv';
    const other = await getRequestedTitle(tmdbId, otherType);
    info = { title: other || null, mediaType: other ? otherType : mediaType };
  }
  infoCache.set(cacheKey, { info, at: Date.now() });
  return info;
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
function httpGet(url, headers = {}, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const lib  = url.startsWith('https') ? https : http;
    const req  = lib.get(url, { headers, timeout: timeoutMs }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        return httpGet(res.headers.location, headers, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
      }
      const buf = [];
      res.on('data',  c => buf.push(c));
      res.on('end',   () => resolve(Buffer.concat(buf).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout — ${url}`)); });
    req.on('error', reject);
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
    const words = [];
    for (let i = 0; i < buf.length; i += 4) words.push(buf.readUInt32BE(i));
    return { words, sigBytes: buf.length, toString: (e) => (e||enc.Hex).stringify({ words, sigBytes: buf.length }) };
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
  const request = async (config) => {
    const url    = typeof config === 'string' ? config : (config.url || '');
    const method = (config?.method || 'GET').toUpperCase();
    const hdrs   = config?.headers || {};
    const tout   = config?.timeout || 25000;

    if (method === 'GET') {
      const text = await httpGet(url, hdrs, tout);
      return { data: safeJson(text) ?? text, status: 200, headers: {}, statusText: 'OK' };
    }

    // POST/PUT/etc
    const text = await new Promise((resolve, reject) => {
      const u   = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const body = config?.data
        ? (typeof config.data === 'string' ? config.data : JSON.stringify(config.data))
        : '';
      const opts = {
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method,
        headers: { 'Content-Type':'application/json','Content-Length':Buffer.byteLength(body), ...hdrs },
        timeout: tout,
      };
      const req = lib.request(opts, (res) => {
        const buf = [];
        res.on('data', c => buf.push(c));
        res.on('end', () => resolve(Buffer.concat(buf).toString('utf-8')));
        res.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });

    return { data: safeJson(text) ?? text, status: 200, headers: {}, statusText: 'OK' };
  };

  const ax = (cfg) => request(cfg);
  ax.get     = (url, cfg) => request({ url, method:'GET',    ...(cfg||{}) });
  ax.post    = (url, data, cfg) => request({ url, method:'POST',   data, ...(cfg||{}) });
  ax.put     = (url, data, cfg) => request({ url, method:'PUT',    data, ...(cfg||{}) });
  ax.delete  = (url, cfg) => request({ url, method:'DELETE', ...(cfg||{}) });
  ax.patch   = (url, data, cfg) => request({ url, method:'PATCH',  data, ...(cfg||{}) });
  ax.head    = (url, cfg) => request({ url, method:'HEAD',   ...(cfg||{}) });
  ax.create  = (defaults) => {
    const inst = (cfg) => request({ ...defaults, ...cfg, url: (defaults?.baseURL||'') + (cfg?.url||'') });
    Object.assign(inst, ax);
    inst.defaults = { ...ax.defaults, ...defaults };
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
function loadProvider(code, id) {
  const fakeRequire = (mod) => {
    const map = {
      'cheerio-without-node-native': cheerio,
      'react-native-cheerio':        cheerio,
      'cheerio':                     cheerio,
      'crypto-js':                   CRYPTOJS_SHIM,
      'axios':                       AXIOS_SHIM,
    };
    if (map[mod]) return map[mod];
    try { return require(mod); } catch (_) {}
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
    Buffer, process,
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
      httpGet(repo.manifestUrl)
        .then(text => ({ repo, parsed: safeJson(text) }))
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

  // Fetch & vm-load in batches of 6
  const loaded = [];

  for (let i = 0; i < loadQueue.length; i += 6) {
    const batch = loadQueue.slice(i, i + 6);
    await Promise.all(batch.map(async ({ meta, repo, normId }) => {
      const fileUrl = (String(meta.filename).startsWith('http://') || String(meta.filename).startsWith('https://')) ? meta.filename : `${repo.base}/${meta.filename}`;
      try {
        const code = await httpGet(fileUrl, {}, 20000);
        const mod  = loadProvider(code, normId);
        if (typeof mod.getStreams !== 'function') {
          console.warn(`  ⚠️  ${meta.name} [${repo.name}]: no getStreams()`);
          return;
        }
        loaded.push({ meta, repo, getStreams: mod.getStreams });
        console.log(`  ✅  ${meta.name.padEnd(24)} [${repo.name}]`);
      } catch (e) {
        console.error(`  ❌  ${meta.name} [${repo.name}]: ${e.message}`);
      }
    }));
  }

  const enLoadedCount = loaded.length;

  // Add TR Hub as a direct local upstream provider (CS3 + all TR Nuvio repos)
  const trHubImdbCache = new Map();
  loaded.push({
    meta: { id: 'trhub', name: 'TR Hub', supportedTypes: ['movie', 'tv'] },
    repo: { name: 'TR Hub' },
    getStreams: async (tmdbId, mediaType, season, episode) => {
      try {
        const kind = mediaType === 'tv' || mediaType === 'series' ? 'tv' : 'movie';
        let imdb = /^tt\d+$/i.test(String(tmdbId || '')) ? String(tmdbId) : trHubImdbCache.get(kind + ':' + tmdbId);
        if (!imdb) {
          for (const key of TMDB_KEYS.filter(Boolean)) {
            try {
              const txt = await httpGet(`https://api.themoviedb.org/3/${kind}/${encodeURIComponent(tmdbId)}/external_ids?api_key=${key}`, {}, 8000);
              const j = safeJson(txt);
              if (j && j.imdb_id) { imdb = String(j.imdb_id); trHubImdbCache.set(kind + ":" + tmdbId, imdb); break; }
            } catch {}
          }
        }
        if (!imdb) return [];
        const stType = kind === 'tv' ? 'series' : 'movie';
        const stId = stType === 'series' ? `${imdb}:${season || 1}:${episode || 1}` : imdb;
        const txt = await httpGet(`${HUB_URL}/g/tr/stream/${stType}/${encodeURIComponent(stId)}.json`, {}, 23000);
        const j = safeJson(txt);
        return ((j && j.streams) || []).map((s) => {
          if (!s || !s.url) return null;
          let u = String(s.url);
          const headers = {};
          try {
            const pu = new URL(u);
            if ((pu.hostname === '127.0.0.1' || pu.hostname === 'localhost' || pu.hostname === HUB_HOST) && pu.pathname === '/px' && pu.searchParams.get('u')) {
              u = pu.searchParams.get('u');
              if (pu.searchParams.get('r')) headers.Referer = pu.searchParams.get('r');
              if (pu.searchParams.get('o')) headers.Origin = pu.searchParams.get('o');
            }
          } catch {}
          const title = String(s.title || '').replace(/\r?\n/g, ' · ');
          return { name: s.name || 'TR Hub', title, url: u, headers, _fromTrHub: true };
        }).filter(Boolean);
      } catch { return []; }
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

  return { loaded, meta, enLoadedCount };
}

// ─── Cache management ─────────────────────────────────────────────────────────
const RETRY_DELAYS_MS = [5000, 10000, 15000, 30000];
let retryAttempt = 0;
let retryTimer = null;

function scheduleProviderRetry(reason) {
  if (retryTimer || retryAttempt >= RETRY_DELAYS_MS.length) return;
  const delay = RETRY_DELAYS_MS[retryAttempt++];
  console.warn(`  ⏳  ${reason}; retrying EN provider load in ${delay / 1000}s (attempt ${retryAttempt}/${RETRY_DELAYS_MS.length})...`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    ensureProviders().catch(() => {});
  }, delay);
  if (typeof retryTimer.unref === 'function') retryTimer.unref();
}

async function ensureProviders() {
  if (providers && lastLoad > 0 && (Date.now() - lastLoad) < CACHE_TTL_MS) return;
  if (loadPromise) return loadPromise;

  loadPromise = loadAll()
    .then(({ loaded, meta, enLoadedCount }) => {
      providers   = loaded;
      stremioMeta = meta;
      if (enLoadedCount > 0) {
        lastLoad = Date.now();
        retryAttempt = 0;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      } else {
        lastLoad = 0;
        scheduleProviderRetry(`0 EN providers loaded from ${HUB_URL}`);
      }
      loadPromise = null;
    })
    .catch((e) => {
      console.error('Fatal load error:', e.message);
      if (!providers) providers = [];
      lastLoad = 0;
      loadPromise = null;
      scheduleProviderRetry(`provider load failed (${e.message})`);
    });

  return loadPromise;
}

// ─── Parse Stremio ID ─────────────────────────────────────────────────────────
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
function detectResolution(text) {
  const t = String(text || '');
  if (/\b(2160p|4k|uhd)\b/i.test(t)) return '2160p';
  if (/\b(1440p|2k)\b/i.test(t)) return '1440p';
  if (/\b(1080p|fhd)\b/i.test(t)) return '1080p';
  if (/\b(720p|hd)\b/i.test(t)) return '720p';
  if (/\b576p\b/i.test(t)) return '576p';
  if (/\b480p\b/i.test(t)) return '480p';
  if (/\b360p\b/i.test(t)) return '360p';
  if (/\b240p\b/i.test(t)) return '240p';
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

async function getStreams(type, id) {
  const { tmdbId, mediaType, season, episode } = parseId(type, id);
  const info = await getTmdbInfo(tmdbId, mediaType);
  const effectiveType = info.mediaType;
  const requestedTitle = info.title;
  console.log(`🔍  ${mediaType} | ${tmdbId} | S${season??'-'}E${episode??'-'} | ${providers.length} providers`);

  const results = await Promise.allSettled(
    providers.map(p =>
      Promise.race([
        p.getStreams(tmdbId, effectiveType, effectiveType === 'tv' ? season : null, effectiveType === 'tv' ? episode : null),
        new Promise((_,rej) => setTimeout(() => rej(new Error('timeout')), 25000)),
      ])
    )
  );

  const streams = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') continue;
    for (const s of (r.value || [])) {
      if (!s?.url) continue;
      const providerName = providers[i].meta.name;
      if (effectiveType === 'tv' && providerName === 'SinemaCX') continue;
      const rawName = s.name || providers[i].meta.name;
      const rawTitle = [s.title, s.quality, s.size].filter(Boolean).join(' · ') || '';
      const rawText = `${rawName} ${rawTitle} ${s.quality || ''}`;
      const haystack = `${rawText} ${s.url || ''}`;
      const titleMatch = matchesTitle(haystack, requestedTitle);
      const trustedProvider = !!s._fromTrHub || (effectiveType === 'tv' && TRUSTED_TR_PROVIDERS.has(providerName));
      if (!trustedProvider && !titleMatch) continue;
      const resolution = detectResolution(rawText);
      const isSub = /(altyaz|subtitle|\bsubs?\b|\bsub\s*tr|\bsubbed\b)/i.test(rawText);
      const isDub = /(dublaj|dubbed|\bdub\b)/i.test(rawText);
      const mentionsTr = /(\btr\b|turkish|t\u00fcrk\u00e7e|turkce|\u{1F1F9}\u{1F1F7})/iu.test(rawText);
      let langTag = '';
      if (isSub && !isDub) langTag = (trustedProvider || mentionsTr) ? 'Turkish Sub \u00b7 ' : '';
      else if (isDub) langTag = 'Turkish Dub \u00b7 ';
      else if (trustedProvider || (titleMatch && mentionsTr)) langTag = 'Turkish \u00b7 ';
      if (!langTag) {
        const dl = detectLang(rawText);
        if (dl) langTag = dl[0] + (isDub ? ' Dub' : '') + ' \u00b7 ';
      }
      const displayTitle = rawTitle || rawName;
      const stream = {
        name  : resolution ? `${resolution} · ${langTag}${normalizeLabel(rawName)}` : `${langTag}${normalizeLabel(rawName)}`,
        title : `${langTag}${normalizeLabel(displayTitle)}`,
        description: `${langTag}${resolution ? resolution + ' · ' : ''}${normalizeLabel(displayTitle)}`,
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

  console.log(`  → ${streams.length} stream(s)\n`);
  const rankResolution = (name) => {
    const r = detectResolution(name);
    return ({ '1080p': 0, '720p': 1, '480p': 2, '360p': 3, '576p': 4, '1440p': 5 })[r] ?? 9;
  };
  const langRank = (n) => /Turkish Sub/i.test(n) ? 1 : /\bTurkish\b/i.test(n) ? 0 : 2;
  streams.sort((a, b) => {
    const d = langRank(a.name) - langRank(b.name);
    if (d !== 0) return d;
    return rankResolution(a.name) - rankResolution(b.name);
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
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

// ---- Mega HLS master: single card, quality + audio selectable in player ----
const streamCache = new Map();
async function getStreamsCached(type, id) {
  const k = type + '|' + id;
  const hit = streamCache.get(k);
  if (hit && Date.now() - hit.t < 600000) return hit.v;
  const v = await getStreams(type, id);
  streamCache.set(k, { t: Date.now(), v });
  return v;
}
const RES = {
  '1080p': ['1920x1080', 5000000], '720p': ['1280x720', 2800000], '480p': ['854x480', 1400000],
  '576p': ['1024x576', 1800000], '360p': ['640x360', 800000], '240p': ['426x240', 400000],
};
const LANGS = [
  ['English', '\u0130ngilizce', 'en', /\b(english|eng|en-us|en-gb)\b/i],
  ['German', 'Almanca', 'de', /\b(german|deutsch|ger)\b/i],
  ['French', 'Frans\u0131zca', 'fr', /\b(french|fran[c\u00e7]ais|fra|vf|vostfr)\b/i],
  ['Spanish', '\u0130spanyolca', 'es', /\b(spanish|espa[n\u00f1]ol|latino|castellano)\b/i],
  ['Italian', '\u0130talyanca', 'it', /\b(italian|italiano|ita)\b/i],
  ['Russian', 'Rus\u00e7a', 'ru', /\b(russian|rus|\u0440\u0443\u0441\u0441\u043a\u0438\u0439)\b/i],
  ['Arabic', 'Arap\u00e7a', 'ar', /\b(arabic|ara)\b/i],
  ['Hindi', 'Hint\u00e7e', 'hi', /\b(hindi|hin)\b/i],
  ['Japanese', 'Japonca', 'ja', /\b(japanese|jpn|jap)\b/i],
  ['Korean', 'Korece', 'ko', /\b(korean|kor)\b/i],
  ['Portuguese', 'Portekizce', 'pt', /\b(portuguese|portugu[e\u00ea]s|por)\b/i],
  ['Polish', 'Leh\u00e7e', 'pl', /\b(polish|polski)\b/i],
  ['Ukrainian', 'Ukraynaca', 'uk', /\b(ukrainian)\b/i],
  ['Persian', 'Fars\u00e7a', 'fa', /\b(persian|farsi)\b/i],
];
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
const enc = (u, h) => Buffer.from(JSON.stringify({ u, h: h || {} })).toString('base64url');
const proxyUrl = (base, u, h) => base + '/p/' + enc(u, h) + '/x.m3u8';
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
async function buildMaster(type, id, base, want) {
  const plist = await probeAll(type, id);
  const p = plist.find(x => !want || x.res[0] === want) || plist[0];
  if (!p) return null;
  const names = { tr: 'T\u00fcrk\u00e7e', en: '\u0130ngilizce', de: 'Almanca', fr: 'Frans\u0131zca', es: '\u0130spanyolca', it: '\u0130talyanca', ru: 'Rus\u00e7a', ar: 'Arap\u00e7a', ja: 'Japonca', ko: 'Korece', hi: 'Hint\u00e7e', pt: 'Portekizce' };
  const text = p.text.split(/\r?\n/).map(l => {
    if (!l.startsWith('#EXT-X-MEDIA:') || !/TYPE=AUDIO/.test(l)) return l;
    const lc = ((l.match(/LANGUAGE="([^"]+)"/) || [])[1] || '').toLowerCase().slice(0, 2);
    const nm = (l.match(/NAME="([^"]+)"/) || [])[1] || '';
    if (names[lc] && /^(audio|track|und|default|stereo)?[ _-]?\d*$/i.test(nm)) return l.replace(/NAME="[^"]*"/, 'NAME="' + names[lc] + '"');
    return l;
  }).join('\n');
  return rewritePlaylist(text, p.url, p.h, base);
}

function rewritePlaylist(text, srcUrl, h, base) {
  const wrap = (u) => proxyUrl(base, new URL(u, srcUrl).href, h);
  return text.split(/\r?\n/).map(l => {
    if (!l) return l;
    if (l.startsWith('#')) return l.replace(/URI="([^"]+)"/g, (_, u) => 'URI="' + wrap(u) + '"');
    return wrap(l);
  }).join('\n');
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
  return new Promise(resolve => {
    require('child_process').execFile(FFPROBE, ['-v', 'error', '-allowed_extensions', 'ALL', '-extension_picky', '0', '-select_streams', 'v:0',
      '-show_entries', 'stream=width', '-of', 'csv=p=0', u], { timeout: 15000 }, (err, out) => {
      const w = parseInt(String(out || '').trim());
      resolve(Number.isFinite(w) ? w : null);
    });
  });
}
// Probe every HLS candidate once: real resolution (measured), audio tracks, playlist text.
const probeCache = new Map();
async function probeAll(type, id) {
  const k = type + '|' + id;
  const hit = probeCache.get(k);
  if (hit && Date.now() - hit.t < 600000) return hit.v;
  const all = (await getStreamsCached(type, id)).all || [];
  const hlsAll = all.filter(s => /\.m3u8(\?|$)/i.test(s.url));
  const byBucket = new Map();
  for (const s of hlsAll) { const r = detectResolution(s.name) || '720p'; if (!byBucket.has(r)) byBucket.set(r, []); byBucket.get(r).push(s); }
  const cand = [];
  for (const r of ['2160p', '1440p', '1080p', '720p', '480p']) { cand.push(...(byBucket.get(r) || []).slice(0, 4)); }
  for (const s of hlsAll) { if (cand.length >= 18) break; if (!cand.includes(s)) cand.push(s); }
  const v = (await Promise.all(cand.map(async (s, i) => {
    const p = await pickPrimary(type, id, null, s);
    if (!p) return null;
    if (!p.measured) {
      const probeHost = (HOST === '0.0.0.0' || HOST === '::') ? '127.0.0.1' : HOST;
      const w = await probeWidth(proxyUrl('http://' + probeHost + ':' + PORT, s.url, p.h));
      if (!w) return null;
      p.res = [widthToRes(w)];
    } else {
      p.res = [p.res[0]];
    }
    p.order = i;
    return p;
  }))).filter(Boolean).sort((a, b) => langRankG(a.s.name) - langRankG(b.s.name) || a.order - b.order);
  probeCache.set(k, { t: Date.now(), v });
  return v;
}
const langRankG = (n) => /Turkish Sub/i.test(n) ? 1 : /\bTurkish\b/i.test(n) ? 0 : 2;
async function pickPrimary(type, id, want, only) {
  const k = type + '|' + id + '|' + (want || '') + '|' + (only ? only.url : '');
  const hit = primaryCache.get(k);
  if (hit && Date.now() - hit.t < 600000) return hit.v;
  const all = (await getStreamsCached(type, id)).all || [];
  const cand = (only ? [only] : all).filter(s => /\.m3u8(\?|$)/i.test(s.url) && (!want || (detectResolution(s.name) || '720p') === want)).sort((a, b) =>
    langRankG(a.name) - langRankG(b.name) || (parseInt(detectResolution(b.name)) || 0) - (parseInt(detectResolution(a.name)) || 0));
  let v = null;
  for (const s of cand) {
    const h = s.behaviorHints?.proxyHeaders?.request || {};
    try {
      const r = await fetch(s.url, { headers: h, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const text = await r.text();
      if (!text.startsWith('#EXTM3U')) continue;
      const lines = text.split(/\r?\n/);
      let res = [], audio = [];
      if (text.includes('#EXT-X-STREAM-INF')) {
        const firstVar = lines.find((l, i) => i > 0 && l && !l.startsWith('#') && lines[i - 1].startsWith('#EXT-X-STREAM-INF'));
        if (!firstVar) continue;
        const vr = await fetch(new URL(firstVar, s.url).href, { headers: h, signal: AbortSignal.timeout(8000) });
        if (!vr.ok || !(await vr.text()).startsWith('#EXTM3U')) continue;
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
      v = { s, url: s.url, h, text, res, audio, label, measured };
      break;
    } catch { continue; }
  }
  primaryCache.set(k, { t: Date.now(), v });
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
async function fetchBody(u, h) {
  const hit = bodyCache.get(u);
  if (hit && Date.now() - hit.t < 120000) return hit;
  const r = await fetch(u, { headers: h || {}, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Object.assign(new Error('upstream ' + r.status), { status: r.status });
  const v = { t: Date.now(), buf: Buffer.from(await r.arrayBuffer()), ct: r.headers.get('content-type') };
  bodyCache.set(u, v);
  if (bodyCache.size > 40) bodyCache.delete(bodyCache.keys().next().value);
  return v;
}

async function handleProxy(req, res, token) {
  let spec;
  try { spec = JSON.parse(Buffer.from(token, 'base64url').toString()); } catch { res.writeHead(400, { 'Content-Length': 0 }); res.end(); return; }
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const base = proto + '://' + req.headers.host;
  try {
    const r = await fetchBody(spec.u, spec.h);
    const buf = r.buf;
    if (buf.subarray(0, 7).toString() === '#EXTM3U') {
      sendBuf(req, res, Buffer.from(rewritePlaylist(buf.toString('utf8'), spec.u, spec.h, base), 'utf8'), 'application/vnd.apple.mpegurl');
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
    const msg = Buffer.from(String(e.message));
    res.writeHead(e.status || 502, { 'Content-Length': msg.length });
    res.end(msg);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,OPTIONS' });
    res.end();
    return;
  }

  const url = req.url.split('?')[0];
  if (url.startsWith('/m/') || url.startsWith('/p/')) {
    console.log('REQ ' + new Date().toISOString().slice(11, 19) + ' ' + url.slice(0, 70) + ' range=' + (req.headers.range || '-') + ' ua=' + String(req.headers['user-agent'] || '-').slice(0, 40));
  }

  if (url === '/') {
    res.writeHead(200, { 'Content-Type':'text/plain' });
    res.end('Nuvio Mega Bridge — add /manifest.json to Stremio');
    return;
  }

  if (url === '/manifest.json') {
    await ensureProviders();
    if (!stremioMeta) { json(res, 503, { error:'Loading providers, retry in 30s' }); return; }
    json(res, 200, stremioMeta);
    return;
  }

  const m = url.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
  if (m) {
    await ensureProviders();
    if (!providers?.length) { json(res, 200, { streams:[] }); return; }
    try {
      const sid = decodeURIComponent(m[2]);
      await getStreamsCached(m[1], sid);
      const probed = await probeAll(m[1], sid);
      const hlsRes = [...new Set(probed.map(p => p.res[0]).filter(r => ALLOWED_MEGA_RES.has(r)))].sort((a, b) => parseInt(b) - parseInt(a));
      const picks = hlsRes.map(r => [r, probed.find(p => p.res[0] === r)]);
      const megaCards = [];
      const usedRes = new Set();
      for (const [want, primary] of picks) {
        if (!primary) continue;
        const real = primary.measured ? primary.res[0] : want;
        if (!ALLOWED_MEGA_RES.has(real) || usedRes.has(real)) continue;
        usedRes.add(real);
        const resSet = [real];
        const resName = resDisplay(real);
        const cleanAudio = cleanAudioLabels(primary.audio, primary.s.name);
        const provider = primary.s.name.split('\u00b7').pop().trim();
        const proto = req.headers['x-forwarded-proto'] || 'http';
        megaCards.push({
          name: 'Mega - ' + resName,
          title: 'Mega - ' + resName,
          description: 'Ses: ' + cleanAudio.join(' / ') + '\nKalite: ' + resName + '\nKaynak: ' + provider,
          url: proto + '://' + req.headers.host + '/m/' + m[1] + '/' + encodeURIComponent(sid) + '~' + want + '.m3u8',
          behaviorHints: { filename: ['Mega', real, ...megaTags([primary.s]), ...cleanAudio, provider].join(' \u00b7 ') },
        });
      }
      json(res, 200, { streams: megaCards });
    } catch (e) {
      console.error('Stream error:', e.message);
      json(res, 200, { streams:[] });
    }
    return;
  }

  const pm = url.match(/^\/p\/([^/]+)\//);
  if (pm) { await handleProxy(req, res, pm[1]); return; }

  const mm = url.match(/^\/m\/(movie|series)\/(.+?)(?:~(\d+p))?\.m3u8$/);
  if (mm) {
    await ensureProviders();
    try {
      const pl = await buildMaster(mm[1], decodeURIComponent(mm[2]), (req.headers['x-forwarded-proto'] || 'http') + '://' + req.headers.host, mm[3]);
      if (!pl) { json(res, 404, { error: 'no hls' }); return; }
      sendBuf(req, res, Buffer.from(pl, 'utf8'), 'application/vnd.apple.mpegurl');
    } catch (e) { json(res, 500, { error: e.message }); }
    return;
  }

  json(res, 404, { error:'Not found' });
});

server.listen(PORT, HOST, async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🎬  Nuvio Mega Bridge — Stremio Addon');
  console.log(`  📡  Listening on http://${HOST}:${PORT} (HUB_URL=${HUB_URL})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await ensureProviders();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅  Add to Stremio:');
  console.log(`  http://${HOST}:${PORT}/manifest.json`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`❌  Port ${PORT} in use`);
  else console.error('Server error:', e);
  process.exit(1);
});
