// Measures how far a dubbed source is offset from the original source.
// Two independent signals are cross-correlated over several time windows:
//   audio: 5-band log-energy envelopes (music/effects shared by original and dub)
//   video: frame-to-frame motion energy (language independent)
// A result is accepted only when several measurements agree.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function resolveBin(name) {
  const la = process.env.LOCALAPPDATA;
  if (la) {
    const link = path.join(la, 'Microsoft', 'WinGet', 'Links', name + '.exe');
    if (fs.existsSync(link)) return link;
    const pkgs = path.join(la, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const pkg of fs.readdirSync(pkgs)) {
        if (!pkg.startsWith('Gyan.FFmpeg')) continue;
        const pkgDir = path.join(pkgs, pkg);
        for (const sub of fs.readdirSync(pkgDir)) {
          const bin = path.join(pkgDir, sub, 'bin', name + '.exe');
          if (fs.existsSync(bin)) return bin;
        }
      }
    } catch {}
  }
  return name;
}
export function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  return resolveBin('ffmpeg');
}
export function ffprobePath() {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const ff = ffmpegPath();
  const sib = ff.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  if (sib !== ff && (sib === 'ffprobe' || fs.existsSync(sib))) return sib;
  return resolveBin('ffprobe');
}

export const FRAME_SEC = 0.02;          // audio feature step
export const VIDEO_FRAME_SEC = 0.04;    // 25 fps
const SAMPLE_RATE = 8000;
const HOP = 160;                        // 20 ms
const WIN = 256;
const BAND_EDGES = [1, 8, 16, 32, 64, 127];

function runFfmpeg(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
    const chunks = [];
    const timer = setTimeout(() => { p.kill(); reject(new Error('ffmpeg timeout')); }, timeoutMs);
    p.stdout.on('data', d => chunks.push(d));
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
  });
}

// Try several (seek position, stream map) combinations until one yields data.
async function decodeWithFallbacks(src, startSec, durSec, outArgs, maps, minBytes, timeoutMs) {
  let lastErr = 'no data';
  for (const seekAfter of [false, true]) {
    for (const map of maps) {
      const seek = ['-ss', String(startSec), '-t', String(durSec)];
      const input = seekAfter ? ['-i', src, ...seek] : [...seek, '-i', src];
      try {
        const buf = await runFfmpeg([...input, '-map', map, ...outArgs, '-'], timeoutMs);
        if (buf.length >= minBytes) return buf;
        lastErr = 'too little data (' + buf.length + ') map=' + map;
      } catch (e) { lastErr = e.message; }
    }
  }
  throw new Error(lastErr);
}

function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? -1 : 1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// Removes the slow trend (about 2 s) so only events remain, then zero-mean / unit-variance.
function eventSeries(a, framesPerSec) {
  const w = Math.max(3, Math.round(2 * framesPerSec));
  const out = new Float64Array(a.length);
  const prefix = new Float64Array(a.length + 1);
  for (let i = 0; i < a.length; i++) prefix[i + 1] = prefix[i] + a[i];
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - w), hi = Math.min(a.length, i + w + 1);
    out[i] = a[i] - (prefix[hi] - prefix[lo]) / (hi - lo);
  }
  let sd = 0;
  for (const v of out) sd += v * v;
  sd = Math.sqrt(sd / out.length) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= sd;
  return out;
}

export async function decodeAudioFeatures(src, startSec, durSec, language, timeoutMs = 90000) {
  const maps = language ? ['0:a:m:language:' + language + '?', '0:a:0'] : ['0:a:0'];
  const buf = await decodeWithFallbacks(src, startSec, durSec, ['-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le'], maps, SAMPLE_RATE * 4 * 20, timeoutMs);
  const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const frames = Math.floor((samples.length - WIN) / HOP) + 1;
  if (frames < 500) throw new Error('not enough audio (' + frames + ' frames)');
  const bands = BAND_EDGES.length - 1;
  const series = Array.from({ length: bands }, () => new Float64Array(frames));
  const hann = new Float64Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WIN - 1));
  const re = new Float64Array(WIN), im = new Float64Array(WIN);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < WIN; i++) { re[i] = samples[f * HOP + i] * hann[i]; im[i] = 0; }
    fft(re, im, false);
    for (let b = 0; b < bands; b++) {
      let e = 0;
      for (let k = BAND_EDGES[b]; k < BAND_EDGES[b + 1]; k++) e += re[k] * re[k] + im[k] * im[k];
      series[b][f] = Math.log(1e-9 + e);
    }
  }
  return series.map(s => eventSeries(s, 1 / FRAME_SEC));
}

export async function decodeVideoMotion(src, startSec, durSec, timeoutMs = 120000) {
  const W = 48, H = 27;
  const buf = await decodeWithFallbacks(src, startSec, durSec, ['-an', '-vf', 'fps=25,scale=' + W + ':' + H + ':flags=area,format=gray', '-f', 'rawvideo'], ['0:v:0'], W * H * 25 * 20, timeoutMs);
  const frameBytes = W * H;
  const frames = Math.floor(buf.length / frameBytes);
  if (frames < 400) throw new Error('not enough video (' + frames + ' frames)');
  const motion = new Float64Array(frames);
  for (let f = 1; f < frames; f++) {
    let sum = 0;
    const a = (f - 1) * frameBytes, b = f * frameBytes;
    for (let i = 0; i < frameBytes; i++) sum += Math.abs(buf[b + i] - buf[a + i]);
    motion[f] = sum / frameBytes;
  }
  return [eventSeries(motion, 1 / VIDEO_FRAME_SEC)];
}

// a, b: arrays of equal-count series. Returns the lag k (frames) with orig(t+k) ~ dub(t) and quality numbers.
export function correlate(a, b, maxLagSec = 60, frameSec = FRAME_SEC) {
  const A = Array.isArray(a) ? a : [a];
  const B = Array.isArray(b) ? b : [b];
  const len = Math.min(A[0].length, B[0].length);
  let n = 1;
  while (n < 2 * len) n <<= 1;
  const cr = new Float64Array(n), ci = new Float64Array(n);
  for (let s = 0; s < A.length; s++) {
    const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
    const xa = A[s].subarray(0, len), xb = B[s].subarray(0, len);
    const na = normalizeCopy(xa), nb = normalizeCopy(xb);
    ar.set(na); br.set(nb);
    fft(ar, ai, false); fft(br, bi, false);
    for (let i = 0; i < n; i++) {
      cr[i] += ar[i] * br[i] + ai[i] * bi[i];
      ci[i] += ai[i] * br[i] - ar[i] * bi[i];
    }
  }
  fft(cr, ci, true);
  const maxLag = Math.min(Math.round(maxLagSec / frameSec), len - 1);
  const vals = [];
  for (let k = -maxLag; k <= maxLag; k++) vals.push(cr[(k + n) % n] / (len * A.length));
  let bi = 0;
  for (let i = 1; i < vals.length; i++) if (vals[i] > vals[bi]) bi = i;
  const guard = Math.round(1 / frameSec);
  let second = -Infinity;
  for (let i = 0; i < vals.length; i++) if (Math.abs(i - bi) > guard && vals[i] > second) second = vals[i];
  let frac = 0;
  if (bi > 0 && bi < vals.length - 1) {
    const y0 = vals[bi - 1], y1 = vals[bi], y2 = vals[bi + 1];
    const den = y0 - 2 * y1 + y2;
    if (den !== 0) frac = 0.5 * (y0 - y2) / den;
  }
  const lag = bi - maxLag + frac;
  return { delayMs: Math.round(lag * frameSec * 1000), corr: vals[bi], second, margin: vals[bi] - second };
}

function normalizeCopy(x) {
  const a = Float64Array.from(x);
  let mean = 0;
  for (const v of a) mean += v;
  mean /= a.length;
  let sd = 0;
  for (let i = 0; i < a.length; i++) { a[i] -= mean; sd += a[i] * a[i]; }
  sd = Math.sqrt(sd / a.length) || 1;
  for (let i = 0; i < a.length; i++) a[i] /= sd;
  return a;
}

const THRESH = { audio: { corr: 0.22, margin: 0.07 }, video: { corr: 0.3, margin: 0.1 }, sub: { corr: 0.18, margin: 0.06 } };
export function isValid(r) { const t = THRESH[r.method]; return r.corr >= t.corr && r.margin >= t.margin; }

// Groups measurements that agree within tolMs and picks the best group.
export function decide(results, tolMs = 90) {
  const valid = results.filter(isValid);
  let best = null;
  for (const seed of valid) {
    const group = valid.filter(r => Math.abs(r.delayMs - seed.delayMs) <= tolMs);
    const windows = new Set(group.map(r => r.win)).size;
    const methods = new Set(group.map(r => r.method)).size;
    const weight = group.reduce((s, r) => s + r.margin, 0);
    const strongSingle = group.length === 1 && group[0].method === 'audio' && group[0].corr >= 0.6 && group[0].margin >= 0.25;
    const accepted = windows >= 2 || methods >= 2 || strongSingle;
    if (!accepted) continue;
    if (!best || weight > best.weight) best = { group, windows, methods, weight };
  }
  if (!best) return { ok: false, reason: valid.length ? 'measurements disagree' : 'no clear match', results };
  // weighted mean of the agreeing measurements; audio counts a little more than video
  let wsum = 0, dsum = 0;
  for (const r of best.group) { const w = r.margin * (r.method === 'audio' ? 1 : 0.7); wsum += w; dsum += w * r.delayMs; }
  const delayMs = Math.round(dsum / wsum);
  const confidence = best.windows >= 2 && best.methods >= 2 ? 'high' : (best.windows >= 2 || best.methods >= 2 ? 'good' : 'medium');
  return { ok: true, delayMs, confidence, votes: best.group.length, windows: best.windows, methods: best.methods, results };
}

export function probeLanguages(src, timeoutMs = 40000) {
  return new Promise(resolve => {
    const probe = ffprobePath();
    let out = '';
    let p;
    try { p = spawn(probe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream_tags=language', '-of', 'csv=p=0', src], { windowsHide: true }); } catch { return resolve([]); }
    const timer = setTimeout(() => { try { p.kill(); } catch {} resolve([]); }, timeoutMs);
    p.stdout.on('data', d => { out += d; });
    p.on('error', () => { clearTimeout(timer); resolve([]); });
    p.on('close', () => { clearTimeout(timer); resolve(out.split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean)); });
  });
}

// ---- subtitle based signal (language independent): when speech starts/stops ----
function parseSrtTime(s) {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0').slice(0, 3)) / 1000 : NaN;
}
// Reads the subtitle track of a source inside the window (times relative to the window start).
export async function decodeSubCues(src, startSec, durSec, language, timeoutMs = 90000) {
  const maps = language ? ['0:s:m:language:' + language + '?', '0:s:0'] : ['0:s:0'];
  const buf = await decodeWithFallbacks(src, startSec, durSec, ['-an', '-vn', '-copyts', '-c:s', 'srt', '-f', 'srt'], maps, 20, timeoutMs);
  const cues = [];
  for (const block of buf.toString('utf8').split(/\r?\n\r?\n/)) {
    const m = /(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)/.exec(block);
    if (!m) continue;
    const a = parseSrtTime(m[1]), b = parseSrtTime(m[2]);
    if (b > a && b > startSec && a < startSec + durSec) cues.push([Math.max(0, a - startSec), Math.min(b - startSec, durSec)]);
  }
  if (cues.length < 6) throw new Error('too few subtitle cues (' + cues.length + ')');
  return cues;
}
function cueSeries(cues, durSec) {
  const n = Math.floor(durSec / FRAME_SEC);
  const x = new Float64Array(n);
  for (const [a, b] of cues) for (let i = Math.floor(a / FRAME_SEC); i < Math.min(n, Math.ceil(b / FRAME_SEC)); i++) x[i] = 1;
  return [eventSeries(x, 1 / FRAME_SEC)];
}
// Voice activity of a source without subtitles: energy in the speech bands.
async function voiceSeries(src, startSec, durSec, language) {
  const f = await decodeAudioFeatures(src, startSec, durSec, language);
  const n = f[0].length, v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = f[1][i] + f[2][i] + f[3][i] + f[4][i];
  return [eventSeries(v, 1 / FRAME_SEC)];
}
async function subSignal(origSrc, dubSrc, win, windowSec, maxLagSec) {
  const origCues = await decodeSubCues(origSrc, win, windowSec, 'eng').catch(() => decodeSubCues(origSrc, win, windowSec, 'tur'));
  const a = cueSeries(origCues, windowSec);
  let b;
  try { b = cueSeries(await decodeSubCues(dubSrc, win, windowSec, 'tur'), windowSec); }
  catch { b = await voiceSeries(dubSrc, win, windowSec, 'tur'); }
  const len = Math.min(a[0].length, b[0].length);
  return correlate([a[0].subarray(0, len)], [b[0].subarray(0, len)], maxLagSec, FRAME_SEC);
}

export async function measureOffset(origSrc, dubSrc, opts = {}) {
  const windowSec = opts.windowSec ?? 90;
  const starts = opts.starts ?? [150, 720, 1320, 60];
  const maxLagSec = opts.maxLagSec ?? 60;
  const results = [];
  for (const win of starts) {
    const jobs = [
      ['audio', async () => correlate(await decodeAudioFeatures(origSrc, win, windowSec, 'eng'), await decodeAudioFeatures(dubSrc, win, windowSec, 'tur'), maxLagSec, FRAME_SEC)],
      ['video', async () => correlate(await decodeVideoMotion(origSrc, win, windowSec), await decodeVideoMotion(dubSrc, win, windowSec), maxLagSec, VIDEO_FRAME_SEC)],
      ['sub', () => subSignal(origSrc, dubSrc, win, windowSec, maxLagSec)],
    ];
    const settled = await Promise.allSettled(jobs.map(j => j[1]()));
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') results.push({ method: jobs[i][0], win, ...s.value });
      else results.push({ method: jobs[i][0], win, error: String(s.reason && s.reason.message || s.reason), corr: 0, margin: 0, delayMs: 0 });
    });
    const verdict = decide(results.filter(r => !r.error));
    if (verdict.ok && (verdict.windows >= 2 || starts.indexOf(win) >= 1)) return { ...verdict, results: summarize(results) };
    // two windows without a single plausible match: this source is a different cut or episode, stop early
    if (starts.indexOf(win) >= 1 && !results.some(r => !r.error && isValid(r))) break;
  }
  const verdict = decide(results.filter(r => !r.error));
  return { ...verdict, results: summarize(results) };
}

function summarize(results) {
  return results.map(r => r.error ? { m: r.method, w: r.win, err: r.error.slice(0, 60) } : { m: r.method, w: r.win, d: r.delayMs, c: +r.corr.toFixed(2), g: +r.margin.toFixed(2) });
}
