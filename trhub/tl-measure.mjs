import { decodeAudioFeatures, decodeVideoMotion, correlate, decide, isValid, FRAME_SEC, VIDEO_FRAME_SEC } from '../unified/audiosync.mjs';
let mRunning = 0; const mWait = [];
export const mSlot = () => new Promise((res) => { const go = () => { mRunning++; res(() => { mRunning--; const n = mWait.shift(); if (n) n(); }); }; if (mRunning < 2) go(); else mWait.push(go); });
// Orijinalin (torrent) ozellikleri bir kez cikarilir; her ses kaynagi icin yalnizca onun ozellikleri hesaplanir.
export async function measureDub(s, d) {
  const WIN = 90, starts = [150, 720];
  s.oc = s.oc || new Map();
  const orig = (kind, win) => { const key = kind + win; if (!s.oc.has(key)) s.oc.set(key, kind === 'a' ? decodeAudioFeatures(s.file.url, win, WIN, 'eng') : decodeVideoMotion(s.file.url, win, WIN)); return s.oc.get(key); };
  const results = [];
  for (let wi = 0; wi < starts.length; wi++) {
    const win = starts[wi];
    const jobs = [
      ['audio', async () => correlate(await orig('a', win), await decodeAudioFeatures(d.probe, win, WIN, 'tur'), 60, FRAME_SEC)],
      ['video', async () => correlate(await orig('v', win), await decodeVideoMotion(d.probe, win, WIN), 60, VIDEO_FRAME_SEC)],
    ];
    const settled = await Promise.allSettled(jobs.map((j) => j[1]()));
    settled.forEach((x, i) => { if (x.status === 'fulfilled') results.push({ method: jobs[i][0], win, ...x.value }); });
    const verdict = decide(results);
    if (verdict.ok && (verdict.windows >= 2 || wi >= 1)) return verdict;
    if (wi >= 1 && !results.some(isValid)) break;
  }
  return decide(results);
}
