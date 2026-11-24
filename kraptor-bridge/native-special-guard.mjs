// Normal-season provider code is unchanged. Only season-zero calls use the corrected adapter.
export function patchSpecialDefaults(code) {
 return code
  .replace(/(?<![\w$.])((?:[\w$]+\.)*(?:season(?:Num|Number)?|sNum))\s*\|\|\s*1\b/g,'($1 == null ? 1 : $1)')
  .replace(/parseInt\((season(?:Num|Number)?)(?:,\s*10)?\)\s*\|\|\s*1\b/g,'(isNaN(parseInt($1,10)) ? 1 : parseInt($1,10))')
  .replace(/tmdbId\.season\s*\|\|\s*seasonNum/g,'(tmdbId.season == null ? seasonNum : tmdbId.season)');
}
export function wrapNativeProvider(code) {
 if(code.includes('NUVIO_SPECIAL_GUARD_V1'))return code;
 const fixed=patchSpecialDefaults(code);
 // Export selection stays inside a function scope so bundler globals cannot collide.
 return code+'\n;/* NUVIO_SPECIAL_GUARD_V1 */\n'+`
(function(){
 var normal=module.exports.getStreams;
 if(typeof normal!=='function')return;
 var special=(function(){var module={exports:{}};var exports=module.exports;
 ${fixed}
 ;return module.exports.getStreams;})();
 module.exports.getStreams=function(){
  var a=Array.prototype.slice.call(arguments),obj=a[0]&&typeof a[0]==='object'?a[0]:null;
  var type=obj?(obj.mediaType||obj.type||a[1]):a[1];
  var s=obj?(obj.season==null?a[2]:obj.season):a[2];
  var e=obj?(obj.episode==null?a[3]:obj.episode):a[3];
  var tv=type==='tv'||type==='series'||type==='show';
  var isSpecial=tv && s!=null && Number(s)===0;
  if(!isSpecial)return normal.apply(this,a);
  return Promise.resolve(special.apply(this,a)).then(function(rows){
   return (Array.isArray(rows)?rows:[]).filter(function(r){
    var text=[r.name,r.title,r.description].filter(Boolean).join(' '),found=false;
    var rx=/(?:^|\\W)S(\\d{1,3})\\s*E(\\d{1,3})(?:\\W|$)/gi,m;
    while((m=rx.exec(text))!==null){if(Number(m[1])!==0||Number(m[2])!==Number(e))return false;found=true;}
    if(!found){
     var url=String(r.url||'');
     found=new RegExp('/(?:0|s0)/(?:'+Number(e)+'|e0*'+Number(e)+')(?:/|[?.]|$)','i').test(url)
       ||new RegExp('[-/]0[-/]sezon[-/]'+Number(e)+'[-/]bolum','i').test(url);
    }
    return found;
   });
  });
 };
})();`;
}
