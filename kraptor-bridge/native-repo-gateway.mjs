import {wrapNativeProvider} from './native-special-guard.mjs';
export const NATIVE_REPOS={
 anthology:'https://raw.githubusercontent.com/falsisdev/anthology/main/manifest.json',
 tapframe:'https://raw.githubusercontent.com/phisher98/nuvio-providers/main/manifest.json',
 eclipsia:'https://gitea.com/eclipsia/nuvio-plugin/raw/branch/main/manifest.json',
 sinewix:'https://raw.githubusercontent.com/tcl-iffalcon/PrometheusTV/main/manifest.json',
};
const cache=new Map();
async function get(url){
 const old=cache.get(url);if(old&&Date.now()-old.time<3600000)return old.text;
 try{const r=await fetch(url,{signal:AbortSignal.timeout(18000)});if(!r.ok)throw Error('upstream HTTP '+r.status);const text=await r.text();cache.set(url,{time:Date.now(),text});return text;}
 catch(e){if(old)return old.text;throw e;}
}
export async function nativeRepoResponse(route,req,res){
 const m=route.match(/^\/native\/(anthology|tapframe|eclipsia|sinewix)\/(manifest\.json|providers\/([^/]+)\.js)$/);
 if(!m)return false;
 const upstream=NATIVE_REPOS[m[1]],headers={'access-control-allow-origin':'*','cache-control':'no-cache'};
 try{
  const manifest=JSON.parse(await get(upstream));
  if(m[2]==='manifest.json'){
   const output={...manifest,version:String(manifest.version||'1.0.0')+'-special1',scrapers:(manifest.scrapers||[]).map((s,i)=>({...s,version:String(s.version||'1.0.0')+'-special1',filename:'providers/'+i+'.js'}))};
   res.writeHead(200,{...headers,'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(output));
  }else{
   const scraper=manifest.scrapers[Number(m[3])];
   if(!scraper?.filename){res.writeHead(404,headers);res.end();return true;}
   const code=wrapNativeProvider(await get(new URL(scraper.filename,upstream).href));
   res.writeHead(200,{...headers,'content-type':'application/javascript; charset=utf-8'});res.end(code);
  }
 }catch(e){res.writeHead(502,{...headers,'content-type':'application/json'});res.end(JSON.stringify({error:String(e.message)}));}
 return true;
}
