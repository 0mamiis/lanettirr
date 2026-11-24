import { execFile } from 'node:child_process';
const probes = new Map();
// Prefer original VOD timelines for formats the native player already decodes.
export async function canPlayDirect(url, ffprobe) {
  const prior = probes.get(url);
  if (prior && Date.now() - prior.time < 300000) return prior.promise;
  const promise = (async () => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return false;
      const text = await r.text();
      if (!text.trimStart().startsWith('#EXTM3U')) return false;
      const variants = text.split(/\r?\n/).filter(l => l.startsWith('#EXT-X-STREAM-INF:'));
      if (variants.length) {
        const codecs = variants.map(l => l.match(/CODECS="([^"]+)"/)?.[1]);
        if (codecs.every(c => c && c.split(',').every(x => /^(avc[13]\.|mp4a\.)/i.test(x.trim())))) return true;
      }
      return await new Promise(resolve => {
        execFile(ffprobe, ['-v','error','-analyzeduration','1000000','-probesize','1000000','-select_streams','v:0','-show_entries','stream=codec_name','-of','json',url],
          {windowsHide:true, timeout:18000, maxBuffer:1048576}, (error,out) => {
            if(error) return resolve(false);
            try { const streams=JSON.parse(out).streams; resolve(streams.length>0 && streams.every(s => s.codec_name==='h264')); }
            catch { resolve(false); }
          });
      });
    } catch { return false; }
  })();
  probes.set(url,{time:Date.now(),promise});
  if(probes.size>100)probes.delete(probes.keys().next().value);
  return promise;
}
export function fixTargetDuration(playlist) {
  if (playlist.includes('#EXT-X-STREAM-INF:')) return playlist;
  const values = [...playlist.matchAll(/^#EXTINF:([\d.]+)/gm)].map(m=>Number(m[1]));
  const current = playlist.match(/^#EXT-X-TARGETDURATION:(\d+)/m);
  if(!values.length || !current) return playlist;
  const target=Math.ceil(Math.max(...values));
  return target>Number(current[1]) ? playlist.replace(/^#EXT-X-TARGETDURATION:\d+/m,'#EXT-X-TARGETDURATION:'+target) : playlist;
}
export function createMediaCache({maxBytes=64*1024*1024,ttl=120000}={}) {
  const entries=new Map(), pending=new Map(); let total=0;
  return async function get(key,loader) {
    const old=entries.get(key);
    if(old && Date.now()-old.time<ttl)return old.value;
    if(old){entries.delete(key);total-=old.value.body.length;}
    if(pending.has(key))return pending.get(key);
    const promise=Promise.resolve().then(loader).then(value=>{
      if(value.status===200 && value.body.length && value.body.length<=maxBytes/2){
        while(total+value.body.length>maxBytes && entries.size){const k=entries.keys().next().value;total-=entries.get(k).value.body.length;entries.delete(k);}
        entries.set(key,{time:Date.now(),value});total+=value.body.length;
      }
      return value;
    }).finally(()=>pending.delete(key));
    pending.set(key,promise);return promise;
  };
}
