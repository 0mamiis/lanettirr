'use strict';

const { UI_LANG_META, I18N, resolveUiLang } = require('./configure-i18n');

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeScriptJson(v) {
  return JSON.stringify(v === undefined ? null : v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const FLAG_SVGS = {
  tr: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#E30A17"/><circle cx="10" cy="8" r="4" fill="#fff"/><circle cx="11.1" cy="8" r="3.2" fill="#E30A17"/><polygon points="14.5,8 16.4,8.6 15.2,7 15.2,9 16.4,7.4" fill="#fff"/></svg>',
  en: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#012169"/><path d="M0,0 L24,16 M24,0 L0,16" stroke="#fff" stroke-width="3"/><path d="M0,0 L24,16 M24,0 L0,16" stroke="#C8102E" stroke-width="1.4"/><path d="M12,0 V16 M0,8 H24" stroke="#fff" stroke-width="4.5"/><path d="M12,0 V16 M0,8 H24" stroke="#C8102E" stroke-width="2.6"/></svg>',
  en_us: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#fff"/><rect y="0" width="24" height="1.6" fill="#B22234"/><rect y="3.2" width="24" height="1.6" fill="#B22234"/><rect y="6.4" width="24" height="1.6" fill="#B22234"/><rect y="9.6" width="24" height="1.6" fill="#B22234"/><rect y="12.8" width="24" height="1.6" fill="#B22234"/><rect width="10.5" height="8.4" fill="#3C3B6E"/><circle cx="2.5" cy="2.2" r=".7" fill="#fff"/><circle cx="5.2" cy="2.2" r=".7" fill="#fff"/><circle cx="8" cy="2.2" r=".7" fill="#fff"/><circle cx="3.8" cy="4.2" r=".7" fill="#fff"/><circle cx="6.6" cy="4.2" r=".7" fill="#fff"/><circle cx="2.5" cy="6.2" r=".7" fill="#fff"/><circle cx="5.2" cy="6.2" r=".7" fill="#fff"/><circle cx="8" cy="6.2" r=".7" fill="#fff"/></svg>',
  es: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#AA151B"/><rect y="4" width="24" height="8" fill="#F1BF00"/><rect x="5.5" y="6" width="3" height="4" fill="#AA151B" opacity=".85"/></svg>',
  es_la: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="8" height="16" fill="#006847"/><rect x="8" width="8" height="16" fill="#fff"/><rect x="16" width="8" height="16" fill="#CE1126"/><circle cx="12" cy="8" r="1.8" fill="#8B5A2B"/></svg>',
  pt: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="9.6" height="16" fill="#006600"/><rect x="9.6" width="14.4" height="16" fill="#FF0000"/><circle cx="9.6" cy="8" r="2.8" fill="#FFCC00"/><rect x="8.4" y="6.8" width="2.4" height="2.4" fill="#FF0000"/></svg>',
  pt_br: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#009C3B"/><polygon points="12,2 21,8 12,14 3,8" fill="#FFDF00"/><circle cx="12" cy="8" r="3.1" fill="#002776"/><path d="M9.2,7.3 Q12,6.4 14.8,8.3" stroke="#fff" stroke-width=".9" fill="none"/></svg>',
  fr: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="8" height="16" fill="#0055A4"/><rect x="8" width="8" height="16" fill="#fff"/><rect x="16" width="8" height="16" fill="#EF4135"/></svg>',
  fr_ca: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="6" height="16" fill="#FF0000"/><rect x="6" width="12" height="16" fill="#fff"/><rect x="18" width="6" height="16" fill="#FF0000"/><polygon points="12,4 13.4,7.5 16,6.8 14,9.5 15,11 12.6,10.5 12.6,12.5 11.4,12.5 11.4,10.5 9,11 10,9.5 8,6.8 10.6,7.5" fill="#FF0000"/></svg>',
  de: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="5.34" fill="#111"/><rect y="5.33" width="24" height="5.34" fill="#DD0000"/><rect y="10.66" width="24" height="5.34" fill="#FFCE00"/></svg>',
  it: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="8" height="16" fill="#009246"/><rect x="8" width="8" height="16" fill="#fff"/><rect x="16" width="8" height="16" fill="#CE2B37"/></svg>',
  hi: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="5.34" fill="#FF9933"/><rect y="5.33" width="24" height="5.34" fill="#fff"/><rect y="10.66" width="24" height="5.34" fill="#138808"/><circle cx="12" cy="8" r="1.9" fill="none" stroke="#000080" stroke-width=".9"/></svg>',
  bn: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#006A4E"/><circle cx="10.5" cy="8" r="4.2" fill="#F42A41"/></svg>',
  ur: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="6" height="16" fill="#fff"/><rect x="6" width="18" height="16" fill="#01411C"/><circle cx="15" cy="8" r="3.8" fill="#fff"/><circle cx="16.3" cy="7.2" r="3.2" fill="#01411C"/><polygon points="17.2,5.5 17.7,6.9 19.1,6.9 18,7.7 18.4,9.1 17.2,8.2 16,9.1 16.4,7.7 15.3,6.9 16.7,6.9" fill="#fff"/></svg>',
  ja: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#fff"/><circle cx="12" cy="8" r="4.5" fill="#BC002D"/></svg>',
  ko: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#fff"/><circle cx="12" cy="8" r="3.8" fill="#CD2E3A"/><path d="M8.2,8 A3.8,3.8 0 0,0 15.8,8 A1.9,1.9 0 0,0 12,8 A1.9,1.9 0 0,1 8.2,8 Z" fill="#0047A0"/></svg>',
  ar: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#006C35"/><rect x="5" y="6.2" width="14" height="2" rx="1" fill="#fff"/><rect x="6" y="10" width="12" height="1.2" fill="#fff"/></svg>',
  ru: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="5.34" fill="#fff"/><rect y="5.33" width="24" height="5.34" fill="#0039A6"/><rect y="10.66" width="24" height="5.34" fill="#D52B1E"/></svg>',
  uk: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="8" fill="#0057B7"/><rect y="8" width="24" height="8" fill="#FFD700"/></svg>',
  hu: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="5.34" fill="#CD2A3E"/><rect y="5.33" width="24" height="5.34" fill="#fff"/><rect y="10.66" width="24" height="5.34" fill="#436F4D"/></svg>',
  ro: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="8" height="16" fill="#002B7F"/><rect x="8" width="8" height="16" fill="#FCD116"/><rect x="16" width="8" height="16" fill="#CE1126"/></svg>',
  cs: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="8" fill="#fff"/><rect y="8" width="24" height="8" fill="#D7141A"/><polygon points="0,0 11,8 0,16" fill="#11457E"/></svg>',
  vi: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#DA251D"/><polygon points="12,3.4 13.2,7 17,7 13.9,9.2 15.1,12.8 12,10.6 8.9,12.8 10.1,9.2 7,7 10.8,7" fill="#FFFF00"/></svg>',
  zh: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#DE2910"/><polygon points="5.2,2.8 6,5.2 8.5,5.2 6.5,6.6 7.2,9 5.2,7.6 3.2,9 3.9,6.6 1.9,5.2 4.4,5.2" fill="#FFDE00"/><circle cx="10" cy="3.2" r=".65" fill="#FFDE00"/><circle cx="11.2" cy="5" r=".65" fill="#FFDE00"/><circle cx="11.2" cy="7.2" r=".65" fill="#FFDE00"/><circle cx="10" cy="9" r=".65" fill="#FFDE00"/></svg>',
  zh_tw: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#FE0000"/><rect width="12" height="8" fill="#000095"/><circle cx="6" cy="4" r="2.2" fill="#fff"/></svg>',
  yue: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#DE2910"/><circle cx="12" cy="8" r="3.6" fill="#fff"/><circle cx="12" cy="8" r="1.3" fill="#DE2910"/></svg>',
  pl: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="8" fill="#fff"/><rect y="8" width="24" height="8" fill="#DC143C"/></svg>',
  nl: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="5.34" fill="#AE1C28"/><rect y="5.33" width="24" height="5.34" fill="#fff"/><rect y="10.66" width="24" height="5.34" fill="#21468B"/></svg>',
  sv: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#006AA7"/><rect x="7" width="3.2" height="16" fill="#FECC00"/><rect y="6.4" width="24" height="3.2" fill="#FECC00"/></svg>',
  no: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#BA0C2F"/><rect x="6.5" width="4.2" height="16" fill="#fff"/><rect y="5.9" width="24" height="4.2" fill="#fff"/><rect x="7.6" width="2" height="16" fill="#00205B"/><rect y="7" width="24" height="2" fill="#00205B"/></svg>',
  da: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#C8102E"/><rect x="7" width="2.8" height="16" fill="#fff"/><rect y="6.6" width="24" height="2.8" fill="#fff"/></svg>',
  fi: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#fff"/><rect x="7" width="3.4" height="16" fill="#003580"/><rect y="6.3" width="24" height="3.4" fill="#003580"/></svg>',
  el: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#0D5EAF"/><rect y="2" width="24" height="1.8" fill="#fff"/><rect y="5.6" width="24" height="1.8" fill="#fff"/><rect y="9.2" width="24" height="1.8" fill="#fff"/><rect y="12.8" width="24" height="1.8" fill="#fff"/><rect width="9" height="9" fill="#0D5EAF"/><rect x="3.6" width="1.8" height="9" fill="#fff"/><rect y="3.6" width="9" height="1.8" fill="#fff"/></svg>',
  fa: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="5.34" fill="#239F40"/><rect y="5.33" width="24" height="5.34" fill="#fff"/><rect y="10.66" width="24" height="5.34" fill="#DA0000"/><circle cx="12" cy="8" r="1.5" fill="#DA0000"/></svg>',
  th: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#A51931"/><rect y="2.66" width="24" height="10.68" fill="#fff"/><rect y="5.33" width="24" height="5.34" fill="#2D2A4A"/></svg>',
  id: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="8" fill="#CE1126"/><rect y="8" width="24" height="8" fill="#fff"/></svg>',
  ms: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#fff"/><rect y="0" width="24" height="1.6" fill="#CC0001"/><rect y="3.2" width="24" height="1.6" fill="#CC0001"/><rect y="6.4" width="24" height="1.6" fill="#CC0001"/><rect y="9.6" width="24" height="1.6" fill="#CC0001"/><rect y="12.8" width="24" height="1.6" fill="#CC0001"/><rect width="11" height="8.4" fill="#010066"/><circle cx="5" cy="4.2" r="2.4" fill="#FFCC00"/><circle cx="5.8" cy="4.2" r="2" fill="#010066"/><circle cx="7.8" cy="4.2" r="1.1" fill="#FFCC00"/></svg>',
  tl: '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="8" fill="#0038A8"/><rect y="8" width="24" height="8" fill="#CE1126"/><polygon points="0,0 10.5,8 0,16" fill="#fff"/><circle cx="4.2" cy="8" r="1.8" fill="#FCD116"/></svg>',
};
FLAG_SVGS.en_uk = FLAG_SVGS.en;
FLAG_SVGS.es_es = FLAG_SVGS.es;
FLAG_SVGS.zh_cn = FLAG_SVGS.zh;
FLAG_SVGS.ta = FLAG_SVGS.hi;
FLAG_SVGS.te = FLAG_SVGS.hi;
FLAG_SVGS.ml = FLAG_SVGS.hi;
FLAG_SVGS.kn = FLAG_SVGS.hi;
FLAG_SVGS.mr = FLAG_SVGS.hi;
FLAG_SVGS.gu = FLAG_SVGS.hi;
FLAG_SVGS.pa = FLAG_SVGS.hi;

function flagIcon(code) {
  return FLAG_SVGS[code] || '<svg viewBox="0 0 24 16" width="24" height="16"><rect width="24" height="16" fill="#71717A"/></svg>';
}

function renderConfigureHtml(origin, cfg, catalog, repoCatalog, opts = {}) {
  cfg = cfg || {};
  const hasUrlCfg = (opts && typeof opts.hasUrlCfg === 'boolean') ? opts.hasUrlCfg : Boolean(cfg && cfg.raw);
  const initUiLang = resolveUiLang((opts && (opts.uiLang || opts.acceptLanguage)) || '');
  const initMeta = UI_LANG_META[initUiLang] || UI_LANG_META.en;
  const initDict = I18N[initUiLang] || I18N.en;
  const tr = (k) => (initDict && initDict[k]) || I18N.en[k] || k;
  const trf = (k, vars) => String(tr(k)).replace(/\{(\w+)\}/g, (_, n) => (vars && vars[n] !== undefined ? String(vars[n]) : ''));
  const htmlDir = initMeta && initMeta.rtl ? 'rtl' : 'ltr';
  const htmlLang = (initMeta && initMeta.bcp47) || 'en';
  const uiLangOptions = '<option value="auto">' + esc(tr('uiLangAuto')) + '</option>' +
    Object.entries(UI_LANG_META).map(([code, m]) => '<option value="' + esc(code) + '">' + esc(m.native) + '</option>').join('');
  const selectedArr = (cfg.langs && cfg.langs.length) ? cfg.langs.slice() : ['tr', 'en'];
  const selected = new Set(selectedArr);
  const langsArr = Object.values(catalog || {});
  const catalogOrder = langsArr.map(l => l.code);
  const catalogNames = Object.fromEntries(langsArr.map(l => [l.code, l.name]));
  const reposByLang = repoCatalog || {};
  const disabledReposInit = Array.isArray(cfg.disabledRepos) ? cfg.disabledRepos.slice() : (Array.isArray(cfg.off) ? cfg.off.slice() : []);
  const disabledProvsInit = Array.isArray(cfg.disabledProvs) ? cfg.disabledProvs.slice() : (Array.isArray(cfg.offp) ? cfg.offp.slice() : []);

  const cards = langsArr.map((l) => {
    const checked = selected.has(l.code) ? 'checked' : '';
    const cs3Tag = (Array.isArray(l.cs3Repos) && l.cs3Repos.length) ? ' + CS3' : '';
    const badgeKind = l.kind === 'trhub' ? 'trhub' : l.kind === 'enhub' ? 'enhub' : l.repos ? 'repos' : 'builtin';
    const badgeN = l.kind === 'enhub' ? 10 : (l.repos ? l.repos.length : 0);
    const badge = badgeKind === 'trhub' ? 'CS3 + Nuvio' : badgeKind === 'enhub' ? ('10 ' + tr('badgeRepo') + cs3Tag) : badgeKind === 'repos' ? (badgeN + ' ' + tr('badgeRepo') + cs3Tag) : (tr('badgeBuiltin') + cs3Tag);
    return '<label class="lang-item' + (checked ? ' is-selected' : '') + '" data-code="' + esc(l.code) + '">' +
      '<input class="sr" type="checkbox" name="lang" value="' + esc(l.code) + '" ' + checked + ' />' +
      '<span class="flag" aria-hidden="true">' + flagIcon(l.code) + '</span>' +
      '<span class="lang-meta">' +
        '<span class="lang-name">' + esc(l.name) + '</span>' +
        '<span class="lang-sub" data-badge-code="' + esc(l.code.toUpperCase()) + '" data-badge-kind="' + esc(badgeKind) + '" data-badge-n="' + esc(badgeN) + '" data-badge-cs3="' + (cs3Tag ? '1' : '') + '">' + esc(l.code.toUpperCase()) + ' · ' + esc(badge) + '</span>' +
      '</span>' +
      '<span class="ord-badge hidden" data-ord="' + esc(l.code) + '"></span>' +
      '<span class="chk" aria-hidden="true"><svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><polyline points="2,6.5 4.8,9.2 10,3"/></svg></span>' +
    '</label>';
  }).join('\n');

  const allQuals = [
    { id: '2160p', label: '4K', sub: '2160p UHD' },
    { id: '1440p', label: '2K', sub: '1440p QHD' },
    { id: '1080p', label: '1080p', sub: 'Full HD' },
    { id: '720p', label: '720p', sub: 'HD' },
    { id: '480p', label: '480p', sub: 'SD' },
  ];
  const selectedQuals = new Set((cfg.quals && cfg.quals.length) ? cfg.quals : (cfg.no4k ? ['1440p', '1080p', '720p'] : ['2160p', '1440p', '1080p', '720p']));
  const qualCards = allQuals.map((q) => {
    const qChecked = selectedQuals.has(q.id) ? 'checked' : '';
    return '<label class="qual-item' + (qChecked ? ' is-selected' : '') + '" data-qual="' + esc(q.id) + '">' +
      '<input class="sr" type="checkbox" name="qual" value="' + esc(q.id) + '" ' + qChecked + ' />' +
      '<span class="qual-meta">' +
        '<span class="qual-name">' + esc(q.label) + '</span>' +
        '<span class="qual-sub">' + esc(q.sub) + '</span>' +
      '</span>' +
      '<span class="chk" aria-hidden="true"><svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><polyline points="2,6.5 4.8,9.2 10,3"/></svg></span>' +
    '</label>';
  }).join('\n');

  const qlimMode = cfg.qlimMode === 'per' ? 'per' : 'all';
  const qlimAll = Number.isInteger(cfg.qlimAll) ? cfg.qlimAll : 1;
  const qlimMap = Object.assign({ '2160p': 1, '1440p': 1, '1080p': 1, '720p': 1, '480p': 1 }, cfg.qlimMap || {});
  const hubLim = Number.isInteger(cfg.hubLim) ? cfg.hubLim : 0;
  const streamSort = cfg.streamSort || 'qual:desc,bitrate:desc,speed:asc,dub:desc';
  const hubSort = cfg.hubSort || 'custom';
  const hubSeqOn = cfg.hubSeq ? 'checked' : '';
  const failoverOn = cfg.failover ? 'checked' : '';
  const failoverSec = Number.isInteger(cfg.failoverSec) ? cfg.failoverSec : 15;
  const timeoutSec = Number.isInteger(cfg.timeoutSec) ? cfg.timeoutSec : 45;

  const perQualLimitCards = allQuals.map((q) => {
    const val = Number.isInteger(qlimMap[q.id]) ? qlimMap[q.id] : qlimAll;
    return '<div class="qlim-card" data-qcard="' + esc(q.id) + '">' +
      '<div class="qlim-top"><span class="qlim-name">' + esc(q.label) + '</span><span class="qlim-sub">' + esc(q.id) + '</span></div>' +
      '<div class="stepper">' +
        '<button type="button" class="step-btn" data-step="-1" data-target="qmap_' + esc(q.id) + '" data-i18n-aria="decrease" aria-label="' + esc(tr('decrease')) + '">-</button>' +
        '<input type="number" min="0" max="50" class="num-inp" id="qmap_' + esc(q.id) + '" data-qmap="' + esc(q.id) + '" value="' + esc(val) + '" />' +
        '<button type="button" class="step-btn" data-step="1" data-target="qmap_' + esc(q.id) + '" data-i18n-aria="increase" aria-label="' + esc(tr('increase')) + '">+</button>' +
      '</div>' +
    '</div>';
  }).join('\n');

  const opt = (val, cur, label, i18nKey) => '<option value="' + esc(val) + '"' + (val === cur ? ' selected' : '') + (i18nKey ? ' data-i18n="' + esc(i18nKey) + '"' : '') + '>' + esc(label) + '</option>';

  return '<!doctype html><html lang="' + esc(htmlLang) + '" dir="' + esc(htmlDir) + '"><head>' +
    '<meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    '<meta name="color-scheme" content="light dark"/>' +
    '<title>Lanettirr</title>' +
    '<style>' +
    ':root{' +
      '--bg:#fafafa;--surface:#ffffff;--surface-2:#f4f4f5;--surface-hover:#ececef;' +
      '--border:#e4e4e7;--border-strong:#d4d4d8;--fg:#11181c;--fg-muted:#71717a;' +
      '--primary:#006fee;--primary-hover:#005bc4;--primary-fg:#ffffff;--primary-soft:rgba(0,111,238,.08);' +
      '--flag-ring:rgba(0,0,0,.14);--code-bg:#f4f4f5;--code-fg:#18181b;--ok:#17c964;' +
    '}' +
    '@media (prefers-color-scheme:dark){:root{' +
      '--bg:#09090b;--surface:#111113;--surface-2:#18181b;--surface-hover:#202024;' +
      '--border:#27272a;--border-strong:#3f3f46;--fg:#ecedee;--fg-muted:#a1a1aa;' +
      '--primary:#006fee;--primary-hover:#338ef7;--primary-fg:#ffffff;--primary-soft:rgba(0,111,238,.16);' +
      '--flag-ring:rgba(255,255,255,.16);--code-bg:#0c0c0e;--code-fg:#e4e4e7;--ok:#17c964;' +
    '}}' +
    '*{box-sizing:border-box;border-radius:0!important}' +
    'html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.45}' +
    '.shell{max-width:840px;margin:0 auto;padding:36px 20px 64px}' +
    '.hdr{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding-bottom:20px;margin-bottom:24px;border-bottom:1px solid var(--border)}' +
    '.ui-lang-wrap{display:inline-flex;align-items:center;gap:8px}' +
    '.ui-lang-lbl{font-size:12px;color:var(--fg-muted);white-space:nowrap}' +
    '.ui-lang-sel{height:32px;padding:0 10px;font-size:12px;font-family:inherit;color:var(--fg);background:var(--surface-2);border:1px solid var(--border-strong);cursor:pointer;outline:none;max-width:220px}' +
    '.ui-lang-sel:focus{border-color:var(--primary)}' +
    '.brand{display:flex;flex-direction:column;gap:4px}' +
    '.brand-row{display:flex;align-items:center;gap:10px}' +
    '.brand-mark{width:10px;height:10px;background:var(--primary);display:inline-block}' +
    'h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.02em}' +
    '.sub{margin:0;font-size:13px;color:var(--fg-muted)}' +
    '.panel{background:var(--surface);border:1px solid var(--border);margin-bottom:16px}' +
    '.panel-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border)}' +
    '.panel-title{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--fg-muted)}' +
    '.panel-actions{display:flex;align-items:center;gap:12px}' +
    '.count{font-size:12px;color:var(--fg-muted);font-variant-numeric:tabular-nums}' +
    '.link-btn{background:none;border:0;padding:2px 0;font-size:12px;font-weight:500;color:var(--primary);cursor:pointer;font-family:inherit}' +
    '.link-btn:hover{text-decoration:underline}' +
    '.panel-body{padding:16px 18px}' +
    '.lang-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:8px}' +
    '.qual-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}' +
    '.qual-item{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--border);cursor:pointer;transition:background .12s,border-color .12s;user-select:none}' +
    '.qual-item:hover{background:var(--surface-hover);border-color:var(--border-strong)}' +
    '.qual-item.is-selected{background:var(--primary-soft);border-color:var(--primary)}' +
    '.qual-item.is-selected .chk{background:var(--primary);border-color:var(--primary);color:var(--primary-fg)}' +
    '.qual-meta{display:flex;flex-direction:column;min-width:0}' +
    '.qual-name{font-size:13px;font-weight:600;color:var(--fg);font-variant-numeric:tabular-nums}' +
    '.qual-sub{font-size:11px;color:var(--fg-muted)}' +
    '.sr{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}' +
    '.lang-item{position:relative;display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--border);cursor:pointer;transition:background .12s,border-color .12s;user-select:none}' +
    '.lang-item:hover{background:var(--surface-hover);border-color:var(--border-strong)}' +
    '.lang-item.is-selected{background:var(--primary-soft);border-color:var(--primary)}' +
    '.flag{display:inline-flex;flex-shrink:0;outline:1px solid var(--flag-ring);line-height:0}' +
    '.flag svg{display:block}' +
    '.lang-meta{display:flex;flex-direction:column;min-width:0;flex:1}' +
    '.lang-name{font-size:13px;font-weight:500;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.lang-sub{font-size:11px;color:var(--fg-muted);font-variant-numeric:tabular-nums}' +
    '.chk{width:16px;height:16px;border:1px solid var(--border-strong);background:var(--surface);display:inline-flex;align-items:center;justify-content:center;color:transparent;flex-shrink:0;transition:.12s}' +
    '.ord-badge{min-width:18px;height:18px;padding:0 5px;background:var(--primary);color:var(--primary-fg);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}' +
    '.hub-order-box{margin-top:12px;padding:12px;background:var(--surface-2);border:1px solid var(--border)}' +
    '.hub-order-lbl{font-size:11px;color:var(--fg-muted);margin-bottom:8px;display:block}' +
    '.hub-order-list{display:flex;flex-wrap:wrap;gap:6px}' +
    '.h-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;font-size:12px;font-weight:500;background:var(--surface);border:1px solid var(--border-strong);color:var(--fg);cursor:grab;user-select:none}' +
    '.h-chip:active{cursor:grabbing}' +
    '.h-chip.is-drag{opacity:.45;border-color:var(--primary)}' +
    '.h-chip.is-over{border-color:var(--primary);background:var(--primary-soft)}' +
    '.h-num{font-size:11px;font-weight:700;color:var(--primary);font-variant-numeric:tabular-nums}' +
    '.sort-box{padding:12px;background:var(--surface-2);border:1px solid var(--border);margin-bottom:14px}' +
    '.sort-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}' +
    '.sort-list{display:flex;flex-wrap:wrap;gap:6px}' +
    '.s-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;font-size:12px;font-weight:500;background:var(--surface);border:1px solid var(--primary);color:var(--fg);cursor:grab;user-select:none}' +
    '.s-chip.is-off{border-color:var(--border);opacity:.5}' +
    '.s-chip.is-drag{opacity:.4}' +
    '.s-chip.is-over{background:var(--primary-soft)}' +
    '.s-dir{border:1px solid var(--border-strong);background:var(--surface-2);color:var(--primary);font-size:11px;font-weight:600;padding:1px 6px;cursor:pointer;font-family:inherit}' +
    '.s-dir:hover{border-color:var(--primary)}' +
    '.s-on{border:0;background:transparent;color:var(--fg-muted);font-size:12px;cursor:pointer;padding:0 2px;font-family:inherit}' +
    '.s-on:hover{color:var(--fg)}' +
    '.repo-groups{display:flex;flex-direction:column;gap:14px}' +
    '.repo-group{border:1px solid var(--border);background:var(--surface-2)}' +
    '.repo-ghead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);background:var(--surface)}' +
    '.repo-gtitle{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--fg)}' +
    '.repo-gact{display:inline-flex;align-items:center;gap:10px}' +
    '.repo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;padding:10px}' +
    '.repo-card{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--primary);background:var(--primary-soft);cursor:pointer;text-align:left;font-family:inherit;transition:background .12s,border-color .12s,opacity .12s}' +
    '.repo-card:hover{border-color:var(--primary-hover)}' +
    '.repo-card.is-off{background:var(--surface);border-color:var(--border);opacity:.58}' +
    '.repo-card.is-off:hover{opacity:.85;border-color:var(--border-strong)}' +
    '.repo-meta{display:flex;flex-direction:column;min-width:0;flex:1}' +
    '.repo-name{font-size:13px;font-weight:500;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.repo-card.is-off .repo-name{text-decoration:line-through;color:var(--fg-muted)}' +
    '.repo-sub{font-size:11px;color:var(--fg-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.rtog{position:relative;width:32px;height:18px;background:var(--primary);border:1px solid var(--primary);flex-shrink:0;transition:.15s}' +
    '.rtog::after{content:"";position:absolute;top:2px;left:15px;width:12px;height:12px;background:var(--primary-fg);transition:left .15s,background .15s}' +
    '.repo-card.is-off .rtog{background:var(--surface-2);border-color:var(--border-strong)}' +
    '.repo-card.is-off .rtog::after{left:2px;background:var(--fg-muted)}' +
    '.repo-wrap{display:flex;flex-direction:column;border:1px solid var(--primary);background:var(--primary-soft);transition:background .12s,border-color .12s,opacity .12s}' +
    '.repo-wrap.is-off{background:var(--surface);border-color:var(--border);opacity:.62}' +
    '.repo-wrap .repo-card{border:0;background:transparent;width:100%}' +
    '.repo-wrap .repo-card:hover{border:0}' +
    '.repo-foot{display:flex;align-items:center;justify-content:space-between;padding:5px 12px;border-top:1px solid var(--border);background:var(--surface)}' +
    '.repo-exp{background:none;border:0;padding:0;font-size:11px;font-weight:500;color:var(--primary);cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:4px}' +
    '.repo-exp:hover{text-decoration:underline}' +
    '.src-drawer{border-top:1px solid var(--border);background:var(--surface);padding:12px}' +
    '.src-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}' +
    '.src-search{height:30px;padding:0 9px;font-size:12px;font-family:inherit;color:var(--fg);background:var(--surface-2);border:1px solid var(--border-strong);outline:none;min-width:180px;flex:1;max-width:280px}' +
    '.src-search:focus{border-color:var(--primary)}' +
    '.src-chips{display:flex;flex-wrap:wrap;gap:6px;max-height:220px;overflow-y:auto;padding-right:6px}' +
    '*{scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent}' +
    '::-webkit-scrollbar{width:6px;height:6px}' +
    '::-webkit-scrollbar-track{background:transparent}' +
    '::-webkit-scrollbar-thumb{background:var(--border-strong)}' +
    '::-webkit-scrollbar-thumb:hover{background:var(--primary)}' +
    '::-webkit-scrollbar-button{display:none;width:0;height:0}' +
    '::-webkit-scrollbar-corner{background:transparent}' +
    '.src-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;font-size:12px;font-family:inherit;background:var(--primary-soft);border:1px solid var(--primary);color:var(--fg);cursor:pointer}' +
    '.src-chip.is-off{background:var(--surface-2);border-color:var(--border);color:var(--fg-muted);text-decoration:line-through;opacity:.65}' +
    '.lang-item.is-selected .chk{background:var(--primary);border-color:var(--primary);color:var(--primary-fg)}' +
    '.ctrl-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px}' +
    '.divider{height:1px;background:var(--border);margin:14px 0}' +
    '.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}' +
    '.field{display:flex;flex-direction:column;gap:6px}' +
    '.field-lbl{font-size:12px;font-weight:500;color:var(--fg-muted)}' +
    '.sel{width:100%;height:36px;padding:0 10px;font-size:13px;font-family:inherit;color:var(--fg);background:var(--surface-2);border:1px solid var(--border-strong);cursor:pointer;outline:none}' +
    '.sel:focus{border-color:var(--primary)}' +
    '.lim-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}' +
    '.lim-info{display:flex;flex-direction:column;gap:2px}' +
    '.lim-title{font-size:13px;font-weight:500;color:var(--fg)}' +
    '.lim-hint{font-size:11px;color:var(--fg-muted)}' +
    '.lim-ctrls{display:flex;flex-wrap:wrap;align-items:center;gap:8px}' +
    '.stepper{display:inline-flex;align-items:stretch;border:1px solid var(--border-strong);background:var(--surface-2)}' +
    '.step-btn{width:28px;height:30px;border:0;background:transparent;color:var(--fg);font-size:15px;font-weight:500;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;justify-content:center}' +
    '.step-btn:hover{background:var(--surface-hover)}' +
    '.num-inp{width:46px;height:30px;border:0;border-left:1px solid var(--border);border-right:1px solid var(--border);background:var(--surface);color:var(--fg);text-align:center;font-size:13px;font-weight:600;font-family:inherit;font-variant-numeric:tabular-nums;outline:none;-moz-appearance:textfield}' +
    '.num-inp::-webkit-outer-spin-button,.num-inp::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}' +
    '.quick-chips{display:inline-flex;gap:4px}' +
    '.qchip{height:30px;padding:0 9px;font-size:12px;font-weight:500;font-family:inherit;background:var(--surface-2);color:var(--fg-muted);border:1px solid var(--border);cursor:pointer}' +
    '.qchip:hover{background:var(--surface-hover);color:var(--fg)}' +
    '.qchip.is-active{background:var(--primary-soft);border-color:var(--primary);color:var(--primary)}' +
    '.qlim-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}' +
    '.qlim-card{display:flex;flex-direction:column;gap:8px;padding:10px;background:var(--surface-2);border:1px solid var(--border)}' +
    '.qlim-card.is-off{opacity:.4;pointer-events:none}' +
    '.qlim-card .stepper{width:100%}' +
    '.qlim-card .num-inp{flex:1;width:0;min-width:28px}' +
    '.qlim-top{display:flex;align-items:baseline;justify-content:space-between;gap:4px}' +
    '.qlim-name{font-size:13px;font-weight:600;color:var(--fg)}' +
    '.qlim-sub{font-size:11px;color:var(--fg-muted)}' +
    '.seg{display:inline-flex;border:1px solid var(--border);background:var(--surface-2);padding:2px}' +
    '.seg button{border:0;background:transparent;color:var(--fg-muted);padding:6px 12px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;transition:.12s}' +
    '.seg button.is-active{background:var(--surface);color:var(--fg);box-shadow:inset 0 0 0 1px var(--border-strong)}' +
    '.switch-wrap{display:inline-flex;align-items:center;gap:10px;cursor:pointer;user-select:none;font-size:13px;font-weight:500}' +
    '.switch-track{position:relative;width:36px;height:20px;background:var(--surface-2);border:1px solid var(--border-strong);transition:.15s;display:inline-block}' +
    '.switch-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;background:var(--fg-muted);transition:transform .15s,background .15s}' +
    'input:checked + .switch-track{background:var(--primary);border-color:var(--primary)}' +
    'input:checked + .switch-track .switch-thumb{transform:translateX(16px);background:var(--primary-fg)}' +
    '.url-row{display:flex;align-items:stretch;border:1px solid var(--border);background:var(--code-bg);margin-bottom:14px}' +
    '.url-text{flex:1;padding:11px 12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:var(--code-fg);word-break:break-all;user-select:all}' +
    '.btn-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px}' +
    '.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;text-decoration:none;border:1px solid transparent;transition:background .12s,border-color .12s}' +
    '.btn-primary{background:var(--primary);color:var(--primary-fg)}' +
    '.btn-primary:hover{background:var(--primary-hover)}' +
    '.btn-flat{background:var(--surface-2);color:var(--fg);border-color:var(--border-strong)}' +
    '.btn-flat:hover{background:var(--surface-hover)}' +
    '.status{margin-inline-start:auto;font-size:12px;color:var(--ok);font-weight:500;min-height:18px}' +
    '.preview-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}' +
    '.preview-lbl{font-size:11px;color:var(--fg-muted)}' +
    '.preview-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}' +
    '.p-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;font-size:12px;font-weight:500;background:var(--surface-2);border:1px solid var(--border);color:var(--fg)}' +
    '.p-chip.is-mega{background:var(--primary-soft);border-color:var(--primary);color:var(--primary)}' +
    '.mv-btn{border:0;background:transparent;color:var(--fg-muted);cursor:pointer;padding:0 3px;font-size:13px;line-height:1;font-family:inherit}' +
    '.mv-btn:hover{color:var(--primary)}' +
    '.mv-btn:disabled{opacity:.3;cursor:default}' +
    '.bl-form{display:grid;grid-template-columns:1fr 1fr 1.2fr auto;gap:8px;margin-bottom:10px}' +
    '@media (max-width:720px){.bl-form{grid-template-columns:1fr}}' +
    '.bl-inp{height:34px;padding:0 10px;border:1px solid var(--border);background:var(--bg);color:var(--fg);font:inherit;font-size:12px;outline:none}' +
    '.bl-inp:focus{border-color:var(--primary)}' +
    '.bl-list{display:flex;flex-direction:column;gap:6px;max-height:276px;overflow-y:auto;overflow-x:hidden;padding-right:4px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.22) transparent}' +
    '.bl-list::-webkit-scrollbar{width:6px}' +
    '.bl-list::-webkit-scrollbar-track{background:transparent}' +
    '.bl-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:3px}' +
    '.bl-list::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.34)}' +
    '.bl-item{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--border);background:var(--surface-2);font-size:12px}' +
    '.bl-meta{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}' +
    '.bl-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}' +
    '.bl-prov{font-weight:600;color:var(--fg)}' +
    '.bl-tag{font-size:10px;font-weight:600;padding:1px 6px;border:1px solid var(--border-strong);color:var(--fg-muted);text-transform:uppercase}' +
    '.bl-tag.is-auto{border-color:#f5a524;color:#f5a524}' +
    '.bl-tag.is-man{border-color:var(--primary);color:var(--primary)}' +
    '.bl-sub{font-size:11px;color:var(--fg-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.bl-del{height:26px;padding:0 10px;border:1px solid var(--border-strong);background:var(--surface);color:var(--fg);font:inherit;font-size:11px;cursor:pointer;flex-shrink:0}' +
    '.bl-del:hover{border-color:#f31260;color:#f31260}' +
    '.hidden{display:none!important}' +
    '@media (max-width:640px){.hdr{flex-direction:column;align-items:flex-start}.ctrl-row{flex-direction:column;align-items:flex-start}.status{margin-inline-start:0;width:100%}.qual-grid,.qlim-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.field-grid{grid-template-columns:1fr}}' +
    '</style></head><body><main class="shell">' +
    '<header class="hdr">' +
      '<div class="brand">' +
        '<div class="brand-row"><span class="brand-mark"></span><h1>Lanettirr</h1></div>' +
      '</div>' +
      '<label class="ui-lang-wrap">' +
        '<span class="ui-lang-lbl" data-i18n="uiLangLabel">' + esc(tr('uiLangLabel')) + '</span>' +
        '<select class="ui-lang-sel" id="uiLangSel" data-i18n-aria="uiLangLabel" aria-label="' + esc(tr('uiLangLabel')) + '">' + uiLangOptions + '</select>' +
      '</label>' +
    '</header>' +
    '<section class="panel">' +
      '<div class="panel-head">' +
        '<span class="panel-title" data-i18n="secLangs">' + esc(tr('secLangs')) + '</span>' +
        '<div class="panel-actions">' +
          '<span class="count" id="selCount"></span>' +
          '<button class="link-btn" id="presetTrEn" type="button">TR + EN</button>' +
          '<button class="link-btn" id="clearBtn" type="button" data-i18n="clear">' + esc(tr('clear')) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="panel-body"><div class="lang-grid" id="langs">' + cards + '</div></div>' +
    '</section>' +
    '<section class="panel" id="reposPanel">' +
      '<div class="panel-head">' +
        '<span class="panel-title" data-i18n="secRepos">' + esc(tr('secRepos')) + '</span>' +
        '<div class="panel-actions">' +
          '<span class="count" id="repoCount"></span>' +
          '<button class="link-btn" id="reposAllOn" type="button" data-i18n="allOn">' + esc(tr('allOn')) + '</button>' +
          '<button class="link-btn" id="reposAllOff" type="button" data-i18n="allOff">' + esc(tr('allOff')) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="panel-body"><div class="repo-groups" id="repoGroups"></div></div>' +
    '</section>' +
    '<section class="panel">' +
      '<div class="panel-head">' +
        '<span class="panel-title" data-i18n="secQuals">' + esc(tr('secQuals')) + '</span>' +
        '<div class="panel-actions">' +
          '<span class="count" id="qualCount"></span>' +
          '<button class="link-btn" id="qAll" type="button" data-i18n="qAll">' + esc(tr('qAll')) + '</button>' +
          '<button class="link-btn" id="qNo4k" type="button" data-i18n="qNo4k">' + esc(tr('qNo4k')) + '</button>' +
          '<button class="link-btn" id="q1080" type="button">1080p+</button>' +
        '</div>' +
      '</div>' +
      '<div class="panel-body"><div class="qual-grid" id="quals">' + qualCards + '</div></div>' +
    '</section>' +
    '<section class="panel">' +
      '<div class="panel-head">' +
        '<span class="panel-title" data-i18n="secLimits">' + esc(tr('secLimits')) + '</span>' +
        '<label class="switch-wrap">' +
          '<input class="sr" type="checkbox" id="qlimAllToggle" ' + (qlimMode === 'all' ? 'checked' : '') + ' />' +
          '<span class="switch-track"><span class="switch-thumb"></span></span>' +
          '<span data-i18n="qlimSingleToggle">' + esc(tr('qlimSingleToggle')) + '</span>' +
        '</label>' +
      '</div>' +
      '<div class="panel-body">' +
        '<div id="qlimAllBox" class="lim-row' + (qlimMode === 'per' ? ' hidden' : '') + '">' +
          '<div class="lim-info"><span class="lim-title" data-i18n="qlimAllTitle">' + esc(tr('qlimAllTitle')) + '</span><span class="lim-hint" data-i18n="qlimAllHint">' + esc(tr('qlimAllHint')) + '</span></div>' +
          '<div class="lim-ctrls">' +
            '<div class="quick-chips" data-qgroup="qlimAll">' +
              '<button type="button" class="qchip" data-val="1">1</button>' +
              '<button type="button" class="qchip" data-val="2">2</button>' +
              '<button type="button" class="qchip" data-val="3">3</button>' +
              '<button type="button" class="qchip" data-val="5">5</button>' +
              '<button type="button" class="qchip" data-val="0" data-i18n="unlimited">' + esc(tr('unlimited')) + '</button>' +
            '</div>' +
            '<div class="stepper">' +
              '<button type="button" class="step-btn" data-step="-1" data-target="qlimAllInp" data-i18n-aria="decrease" aria-label="' + esc(tr('decrease')) + '">-</button>' +
              '<input type="number" min="0" max="50" class="num-inp" id="qlimAllInp" value="' + esc(qlimAll) + '" />' +
              '<button type="button" class="step-btn" data-step="1" data-target="qlimAllInp" data-i18n-aria="increase" aria-label="' + esc(tr('increase')) + '">+</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="qlimPerBox" class="' + (qlimMode === 'all' ? 'hidden' : '') + '">' +
          '<div class="lim-info" style="margin-bottom:10px"><span class="lim-title" data-i18n="qlimPerTitle">' + esc(tr('qlimPerTitle')) + '</span><span class="lim-hint" data-i18n="qlimPerHint">' + esc(tr('qlimPerHint')) + '</span></div>' +
          '<div class="qlim-grid">' + perQualLimitCards + '</div>' +
        '</div>' +
        '<div class="divider"></div>' +
        '<div class="lim-row">' +
          '<div class="lim-info"><span class="lim-title" data-i18n="hubLimTitle">' + esc(tr('hubLimTitle')) + '</span><span class="lim-hint" data-i18n="hubLimHint">' + esc(tr('hubLimHint')) + '</span></div>' +
          '<div class="lim-ctrls">' +
            '<div class="quick-chips" data-qgroup="hubLim">' +
              '<button type="button" class="qchip" data-val="0" data-i18n="unlimited">' + esc(tr('unlimited')) + '</button>' +
              '<button type="button" class="qchip" data-val="5">5</button>' +
              '<button type="button" class="qchip" data-val="10">10</button>' +
              '<button type="button" class="qchip" data-val="15">15</button>' +
              '<button type="button" class="qchip" data-val="20">20</button>' +
            '</div>' +
            '<div class="stepper">' +
              '<button type="button" class="step-btn" data-step="-1" data-target="hubLimInp" data-i18n-aria="decrease" aria-label="' + esc(tr('decrease')) + '">-</button>' +
              '<input type="number" min="0" max="200" class="num-inp" id="hubLimInp" value="' + esc(hubLim) + '" />' +
              '<button type="button" class="step-btn" data-step="1" data-target="hubLimInp" data-i18n-aria="increase" aria-label="' + esc(tr('increase')) + '">+</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</section>' +
    '<section class="panel">' +
      '<div class="panel-head"><span class="panel-title" data-i18n="secSortOpts">' + esc(tr('secSortOpts')) + '</span></div>' +
      '<div class="panel-body">' +
        '<div class="sort-box">' +
          '<div class="sort-top">' +
            '<span class="field-lbl" data-i18n="sortPriorityLbl">' + esc(tr('sortPriorityLbl')) + '</span>' +
            '<div class="quick-chips" id="sortPresets">' +
              '<button type="button" class="qchip" data-sp="dub:desc,qual:desc,bitrate:desc,speed:asc" data-i18n="spDubQual">' + esc(tr('spDubQual')) + '</button>' +
              '<button type="button" class="qchip" data-sp="qual:desc,bitrate:desc,speed:asc,dub:desc" data-i18n="spQualBit">' + esc(tr('spQualBit')) + '</button>' +
              '<button type="button" class="qchip" data-sp="speed:asc,qual:desc,bitrate:desc,dub:desc" data-i18n="spSpeedQual">' + esc(tr('spSpeedQual')) + '</button>' +
              '<button type="button" class="qchip" data-sp="bitrate:desc,qual:desc,speed:asc,dub:desc" data-i18n="spBitrate">' + esc(tr('spBitrate')) + '</button>' +
              '<button type="button" class="qchip" data-sp="dub:asc,qual:desc,bitrate:desc,speed:asc" data-i18n="spSub">' + esc(tr('spSub')) + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="sort-list" id="sortOrderList"></div>' +
        '</div>' +
        '<div class="field-grid" style="grid-template-columns:1fr">' +
          '<label class="field">' +
            '<span class="field-lbl" data-i18n="hubSortLbl">' + esc(tr('hubSortLbl')) + '</span>' +
            '<select class="sel" id="hubSort">' +
              opt('custom', hubSort, tr('hsCustom'), 'hsCustom') +
              opt('catalog', hubSort, tr('hsCatalog'), 'hsCatalog') +
              opt('code_asc', hubSort, tr('hsCodeAsc'), 'hsCodeAsc') +
              opt('code_desc', hubSort, tr('hsCodeDesc'), 'hsCodeDesc') +
              opt('name_asc', hubSort, tr('hsNameAsc'), 'hsNameAsc') +
              opt('name_desc', hubSort, tr('hsNameDesc'), 'hsNameDesc') +
            '</select>' +
          '</label>' +
        '</div>' +
        '<div id="hubOrderBox" class="hub-order-box">' +
          '<span class="hub-order-lbl" data-i18n="hubOrderHint">' + esc(tr('hubOrderHint')) + '</span>' +
          '<div class="hub-order-list" id="hubOrderList"></div>' +
        '</div>' +
        '<div class="divider"></div>' +
        '<div class="lim-row">' +
          '<div class="lim-info"><span class="lim-title" data-i18n="timeoutTitle">' + esc(tr('timeoutTitle')) + '</span><span class="lim-hint" data-i18n="timeoutHint">' + esc(tr('timeoutHint')) + '</span></div>' +
          '<div class="lim-ctrls">' +
            '<div class="quick-chips" data-qgroup="timeoutSec">' +
              '<button type="button" class="qchip" data-val="15">15s</button>' +
              '<button type="button" class="qchip" data-val="30">30s</button>' +
              '<button type="button" class="qchip" data-val="45">45s</button>' +
              '<button type="button" class="qchip" data-val="60">60s</button>' +
              '<button type="button" class="qchip" data-val="90">90s</button>' +
            '</div>' +
            '<div class="stepper">' +
              '<button type="button" class="step-btn" data-step="-5" data-target="timeoutInp" data-i18n-aria="decrease" aria-label="' + esc(tr('decrease')) + '">-</button>' +
              '<input type="number" min="10" max="90" class="num-inp" id="timeoutInp" value="' + esc(timeoutSec) + '" />' +
              '<button type="button" class="step-btn" data-step="5" data-target="timeoutInp" data-i18n-aria="increase" aria-label="' + esc(tr('increase')) + '">+</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="divider"></div>' +
        '<div class="ctrl-row">' +
          '<label class="switch-wrap">' +
            '<input class="sr" type="checkbox" id="hubSeqOn" ' + hubSeqOn + ' />' +
            '<span class="switch-track"><span class="switch-thumb"></span></span>' +
            '<span data-i18n="hubSeqTitle">' + esc(tr('hubSeqTitle')) + '</span>' +
          '</label>' +
          '<span class="lim-hint" data-i18n="hubSeqHint">' + esc(tr('hubSeqHint')) + '</span>' +
        '</div>' +
        '<div class="divider"></div>' +
        '<div class="ctrl-row">' +
          '<label class="switch-wrap">' +
            '<input class="sr" type="checkbox" id="failoverOn" ' + failoverOn + ' />' +
            '<span class="switch-track"><span class="switch-thumb"></span></span>' +
            '<span data-i18n="failoverTitle">' + esc(tr('failoverTitle')) + '</span>' +
          '</label>' +
          '<span class="lim-hint" data-i18n="failoverHint">' + esc(tr('failoverHint')) + '</span>' +
        '</div>' +
        '<div class="lim-row" id="failoverBox">' +
          '<div class="lim-info"><span class="lim-title" data-i18n="failoverToTitle">' + esc(tr('failoverToTitle')) + '</span><span class="lim-hint" data-i18n="failoverToHint">' + esc(tr('failoverToHint')) + '</span></div>' +
          '<div class="lim-ctrls">' +
            '<div class="quick-chips" data-qgroup="failoverSec">' +
              '<button type="button" class="qchip" data-val="10">10s</button>' +
              '<button type="button" class="qchip" data-val="15">15s</button>' +
              '<button type="button" class="qchip" data-val="20">20s</button>' +
              '<button type="button" class="qchip" data-val="30">30s</button>' +
              '<button type="button" class="qchip" data-val="45">45s</button>' +
            '</div>' +
            '<div class="stepper">' +
              '<button type="button" class="step-btn" data-step="-5" data-target="failoverInp" data-i18n-aria="decrease" aria-label="' + esc(tr('decrease')) + '">-</button>' +
              '<input type="number" min="5" max="45" class="num-inp" id="failoverInp" value="' + esc(failoverSec) + '" />' +
              '<button type="button" class="step-btn" data-step="5" data-target="failoverInp" data-i18n-aria="increase" aria-label="' + esc(tr('increase')) + '">+</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</section>' +
    '<section class="panel">' +
      '<div class="panel-head">' +
        '<span class="panel-title" data-i18n="secBlacklist">' + esc(tr('secBlacklist')) + '</span>' +
        '<div class="panel-actions">' +
          '<span class="count" id="blCount">' + esc(trf('blCount', { n: 0 })) + '</span>' +
          '<button type="button" class="link-btn" id="blRefreshBtn" data-i18n="refresh">' + esc(tr('refresh')) + '</button>' +
          '<button type="button" class="link-btn" id="blClearBtn" data-i18n="clearAll">' + esc(tr('clearAll')) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="panel-body">' +
        '<div class="bl-form">' +
          '<input type="text" class="bl-inp" id="blMediaInp" data-i18n-ph="blMediaPh" placeholder="' + esc(tr('blMediaPh')) + '" />' +
          '<input type="text" class="bl-inp" id="blProvInp" data-i18n-ph="blProvPh" placeholder="' + esc(tr('blProvPh')) + '" />' +
          '<input type="text" class="bl-inp" id="blUrlInp" data-i18n-ph="blUrlPh" placeholder="' + esc(tr('blUrlPh')) + '" />' +
          '<button type="button" class="btn btn-flat" id="blAddBtn" data-i18n="add">' + esc(tr('add')) + '</button>' +
        '</div>' +
        '<div class="bl-list" id="blList"><span class="count" data-i18n="loading">' + esc(tr('loading')) + '</span></div>' +
      '</div>' +
    '</section>' +
    '<section class="panel">' +
      '<div class="panel-head">' +
        '<span class="panel-title" data-i18n="secInstall">' + esc(tr('secInstall')) + '</span>' +
        '<div class="seg" role="group" data-i18n-aria="installTypeAria" aria-label="' + esc(tr('installTypeAria')) + '">' +
          '<button type="button" data-install="nuvio" class="is-active" data-i18n="instNuvio">' + esc(tr('instNuvio')) + '</button>' +
          '<button type="button" data-install="aio" data-i18n="instAio">' + esc(tr('instAio')) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="panel-body">' +
        '<div class="preview-head">' +
          '<span class="preview-lbl" id="previewHint"></span>' +
          '<div class="seg" role="group" data-i18n-aria="linkTypeAria" aria-label="' + esc(tr('linkTypeAria')) + '">' +
            '<button type="button" data-linkmode="saved" class="is-active" data-i18n="linkSaved">' + esc(tr('linkSaved')) + '</button>' +
            '<button type="button" data-linkmode="inline" data-i18n="linkInline">' + esc(tr('linkInline')) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="preview-chips" id="previewChips"></div>' +
        '<div class="url-row"><div class="url-text" id="out"></div></div>' +
        '<div class="btn-row">' +
          '<button class="btn btn-primary" id="saveBtn" type="button">' +
            '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 2h8l2 2v10H3V2z"/><path d="M5 2v4h5V2"/><rect x="5" y="9" width="6" height="5"/></svg>' +
            '<span data-i18n="saveBtn">' + esc(tr('saveBtn')) + '</span>' +
          '</button>' +
          '<button class="btn btn-flat" id="copyBtn" type="button">' +
            '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="5" width="9" height="9"/><path d="M11 5V2H2v9h3"/></svg>' +
            '<span data-i18n="copyBtn">' + esc(tr('copyBtn')) + '</span>' +
          '</button>' +
          '<a class="btn btn-flat hidden" id="stremioBtn" href="#">' +
            '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3H3v10h10v-3"/><path d="M9 2h5v5"/><path d="M14 2L7 9"/></svg>' +
            '<span data-i18n="stremioBtn">' + esc(tr('stremioBtn')) + '</span>' +
          '</a>' +
          '<span class="status" id="status"></span>' +
        '</div>' +
      '</div>' +
    '</section>' +
    '</main>' +
    '<script>' +
    'const ORIGIN = ' + safeScriptJson(origin) + ';' +
    'const HAS_URL_CFG = ' + safeScriptJson(hasUrlCfg) + ';' +
    'const INIT_UI_LANG = ' + safeScriptJson(initUiLang) + ';' +
    'const UI_LANG_META = ' + safeScriptJson(UI_LANG_META) + ';' +
    'const I18N = ' + safeScriptJson(I18N) + ';' +
    'const STORAGE_KEY = "nuvio_mega_cfg_v1";' +
    'const UI_PREFS_KEY = "nuvio_mega_ui_prefs_v1";' +
    'const CATALOG_ORDER = ' + safeScriptJson(catalogOrder) + ';' +
    'const CATALOG_NAMES = ' + safeScriptJson(catalogNames) + ';' +
    'const REPOS_BY_LANG = ' + safeScriptJson(reposByLang) + ';' +
    'const FLAG_SVGS = ' + safeScriptJson(FLAG_SVGS) + ';' +
    'let langOrder = ' + safeScriptJson(selectedArr) + ';' +
    'let disabledRepos = new Set(' + safeScriptJson(disabledReposInit) + ');' +
    'let disabledProvs = new Set(' + safeScriptJson(disabledProvsInit) + ');' +
    'const srcCache = {};' +
    'const srcPending = {};' +
    'const provLangMap = {};' +
    'const openDrawers = {};' +
    'let installMode = "nuvio";' +
    'let linkMode = "saved";' +
    'let uiLangPref = "auto";' +
    'let activeUiLang = INIT_UI_LANG;' +
    'let lastBlItems = null;' +
    'let lastCfgStr = "";' +
    'let statusTimer = null;' +
    'const ALL_SORT_KEYS = ["dub", "qual", "bitrate", "speed", "prov"];' +
    'const VALID_SORT_KEYS = new Set(ALL_SORT_KEYS);' +
    'function matchBrowserLang(list) {' +
    '  for (const raw of (list || [])) {' +
    '    const tag = String(raw || "").trim().toLowerCase().replace(/_/g, "-");' +
    '    if (!tag) continue;' +
    '    const exact = tag.replace(/-/g, "_");' +
    '    if (I18N[exact]) return exact;' +
    '    const parts = tag.split("-"); const base = parts[0]; const reg = parts[1] || ""; const reg2 = parts[2] || "";' +
    '    if (base === "zh") { if (reg === "hk" || reg === "mo") return "yue"; if (reg === "tw" || reg === "hant" || reg2 === "tw") return "zh_tw"; if (reg === "cn" || reg === "sg" || reg === "hans" || reg2 === "cn") return "zh_cn"; return "zh"; }' +
    '    if (base === "es") { if (reg === "es") return "es_es"; if (reg && reg !== "es") return "es_la"; return "es"; }' +
    '    if (base === "pt") { if (reg === "br") return "pt_br"; return "pt"; }' +
    '    if (base === "en") { if (reg === "us") return "en_us"; if (reg === "gb" || reg === "uk") return "en_uk"; return "en"; }' +
    '    if (base === "fr") { if (reg === "ca") return "fr_ca"; return "fr"; }' +
    '    if (base === "fil") return "tl";' +
    '    if (base === "nb" || base === "nn") return "no";' +
    '    if (base === "yue") return "yue";' +
    '    if (I18N[base]) return base;' +
    '  }' +
    '  return INIT_UI_LANG || "en";' +
    '}' +
    'function detectBrowserUiLang() {' +
    '  try { const nav = (Array.isArray(navigator.languages) && navigator.languages.length) ? navigator.languages : (navigator.language ? [navigator.language] : []); if (nav.length) return matchBrowserLang(nav); } catch {}' +
    '  return INIT_UI_LANG || "en";' +
    '}' +
    'function t(k) { const d = I18N[activeUiLang] || I18N.en; return (d && d[k]) || I18N.en[k] || k; }' +
    'function tf(k, vars) { return String(t(k)).replace(/\{(\w+)\}/g, (_, n) => (vars && vars[n] !== undefined ? String(vars[n]) : "")); }' +
    'function activeLocale() { return (UI_LANG_META[activeUiLang] && UI_LANG_META[activeUiLang].bcp47) || "en-US"; }' +
    'function locRepoName(r) { return r && r.id === "tr_nuvio" ? t("repoTrNuvio") : (r && r.name) || ""; }' +
    'function locRepoSub(r) {' +
    '  const s = String((r && r.sub) || "");' +
    '  if (!s) return "";' +
    '  if (s === "Dahili sağlayıcı") return t("repoBuiltinProv");' +
    '  if (s === "Çoklu-dil / Çapraz ses") return t("repoMultiLangFallback");' +
    '  const ml = s.match(/^(\d+)\s+çoklu-dil sağlayıcı$/i);' +
    '  if (ml) return tf("repoMultiLangProv", { n: ml[1] });' +
    '  return s.replace(/\bkaynak\b/g, t("repoSourcesUnit"));' +
    '}' +
    'function getSortMeta() {' +
    '  return {' +
    '    dub: { name: t("smDubName"), desc: t("smDubDesc"), asc: t("smDubAsc") },' +
    '    qual: { name: t("smQualName"), desc: "4K↓", asc: "480p↑" },' +
    '    bitrate: { name: t("smBitName"), desc: t("smBitDesc"), asc: t("smBitAsc") },' +
    '    speed: { name: t("smSpeedName"), asc: t("smSpeedAsc"), desc: t("smSpeedDesc") },' +
    '    prov: { name: t("smProvName"), asc: "A→Z", desc: "Z→A" }' +
    '  };' +
    '}' +
    'function parseSortUi(str) {' +
    '  const map = { dub_qual: "dub:desc,qual:desc,bitrate:desc,speed:asc", qual_desc: "qual:desc,bitrate:desc,speed:asc,dub:desc", qual_asc: "qual:asc,speed:asc,bitrate:desc,dub:desc", sub_qual: "dub:asc,qual:desc,bitrate:desc,speed:asc", speed_asc: "speed:asc,qual:desc,bitrate:desc,dub:desc", bitrate_desc: "qual:desc,bitrate:desc,speed:asc,dub:desc", provider_asc: "prov:asc,qual:desc,speed:asc", provider_desc: "prov:desc,qual:desc,speed:asc" };' +
    '  const raw = map[str] || str || "qual:desc,bitrate:desc,speed:asc,dub:desc";' +
    '  const active = []; const seen = new Set();' +
    '  raw.split(",").forEach(p => { const [k, d] = p.trim().split(":"); if (VALID_SORT_KEYS.has(k) && !seen.has(k)) { seen.add(k); active.push({ k, d: d === "asc" ? "asc" : "desc", on: true }); } });' +
    '  ALL_SORT_KEYS.forEach(k => { if (!seen.has(k)) active.push({ k, d: k === "speed" || k === "prov" ? "asc" : "desc", on: false }); });' +
    '  return active;' +
    '}' +
    'let sortState = parseSortUi(' + safeScriptJson(streamSort) + ');' +
    'let sDragFrom = -1;' +
    'const out = document.getElementById("out");' +
    'const sbtn = document.getElementById("stremioBtn");' +
    'const statusEl = document.getElementById("status");' +
    'const selCount = document.getElementById("selCount");' +
    'const qualCount = document.getElementById("qualCount");' +
    'const previewChips = document.getElementById("previewChips");' +
    'const previewHint = document.getElementById("previewHint");' +
    'const hubOrderBox = document.getElementById("hubOrderBox");' +
    'const hubOrderList = document.getElementById("hubOrderList");' +
    'const repoGroups = document.getElementById("repoGroups");' +
    'const repoCount = document.getElementById("repoCount");' +
    'const uiLangSel = document.getElementById("uiLangSel");' +
    'let dragFrom = -1;' +
    'const inputs = [...document.querySelectorAll("input[name=lang]")];' +
    'const qInputs = [...document.querySelectorAll("input[name=qual]")];' +
    'const qlimAllToggle = document.getElementById("qlimAllToggle");' +
    'const qlimAllBox = document.getElementById("qlimAllBox");' +
    'const qlimPerBox = document.getElementById("qlimPerBox");' +
    'const qlimAllInp = document.getElementById("qlimAllInp");' +
    'const hubLimInp = document.getElementById("hubLimInp");' +
    'const sortOrderList = document.getElementById("sortOrderList");' +
    'const hubSortSel = document.getElementById("hubSort");' +
    'const hubSeqOnEl = document.getElementById("hubSeqOn");' +
    'const failoverOnEl = document.getElementById("failoverOn");' +
    'const failoverBox = document.getElementById("failoverBox");' +
    'const failoverInp = document.getElementById("failoverInp");' +
    'const timeoutInp = document.getElementById("timeoutInp");' +
    'const qMapInputs = [...document.querySelectorAll("input[data-qmap]")];' +
    'function clamp(v, min, max) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min; }' +
    'function orderedLangs(ls, mode) {' +
    '  const a = ls.slice();' +
    '  if (mode === "catalog") a.sort((x, y) => CATALOG_ORDER.indexOf(x) - CATALOG_ORDER.indexOf(y));' +
    '  else if (mode === "code_asc") a.sort((x, y) => x.localeCompare(y));' +
    '  else if (mode === "code_desc") a.sort((x, y) => y.localeCompare(x));' +
    '  else if (mode === "name_asc") a.sort((x, y) => (CATALOG_NAMES[x] || x).localeCompare(CATALOG_NAMES[y] || y, activeLocale()));' +
    '  else if (mode === "name_desc") a.sort((x, y) => (CATALOG_NAMES[y] || y).localeCompare(CATALOG_NAMES[x] || x, activeLocale()));' +
    '  return a;' +
    '}' +
    'function syncLangOrder() {' +
    '  const checkedSet = new Set(inputs.filter(i => i.checked).map(i => i.value));' +
    '  langOrder = langOrder.filter(c => checkedSet.has(c));' +
    '  for (const c of checkedSet) if (!langOrder.includes(c)) langOrder.push(c);' +
    '}' +
    'function syncQuickChips(group, val) {' +
    '  document.querySelectorAll("[data-qgroup=" + group + "] .qchip").forEach(b => b.classList.toggle("is-active", String(b.dataset.val) === String(val)));' +
    '}' +
    'function setStatus(msg, ms, isErr) {' +
    '  clearTimeout(statusTimer);' +
    '  statusEl.textContent = msg || "";' +
    '  statusEl.style.color = isErr ? "#f31260" : "";' +
    '  if (msg && ms > 0) statusTimer = setTimeout(() => { statusEl.textContent = ""; statusEl.style.color = ""; }, ms);' +
    '}' +
    'function saveUiPrefs() {' +
    '  try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ installMode, linkMode, uiLang: uiLangPref })); } catch {}' +
    '}' +
    'function applyUiLang(pref, rerender) {' +
    '  uiLangPref = (pref && pref !== "auto" && I18N[pref]) ? pref : "auto";' +
    '  activeUiLang = uiLangPref === "auto" ? detectBrowserUiLang() : uiLangPref;' +
    '  const meta = UI_LANG_META[activeUiLang] || UI_LANG_META.en;' +
    '  document.documentElement.lang = (meta && meta.bcp47) || "en";' +
    '  document.documentElement.dir = (meta && meta.rtl) ? "rtl" : "ltr";' +
    '  if (uiLangSel) {' +
    '    uiLangSel.value = uiLangPref;' +
    '    const autoOpt = uiLangSel.querySelector("option[value=auto]");' +
    '    if (autoOpt) autoOpt.textContent = t("uiLangAuto");' +
    '  }' +
    '  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });' +
    '  document.querySelectorAll("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.dataset.i18nPh); });' +
    '  document.querySelectorAll("[data-i18n-aria]").forEach(el => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });' +
    '  document.querySelectorAll("[data-badge-kind]").forEach(el => {' +
    '    const code = el.dataset.badgeCode || ""; const kind = el.dataset.badgeKind; const n = el.dataset.badgeN || "0"; const cs3 = el.dataset.badgeCs3 ? " + CS3" : "";' +
    '    const b = kind === "trhub" ? "CS3 + Nuvio" : kind === "enhub" ? ("10 " + t("badgeRepo") + cs3) : kind === "repos" ? (n + " " + t("badgeRepo") + cs3) : (t("badgeBuiltin") + cs3);' +
    '    el.textContent = code + " · " + b;' +
    '  });' +
    '  if (rerender) { renderAll(false); if (lastBlItems !== null) renderBlacklist(lastBlItems); }' +
    '}' +
    'function getSortString() {' +
    '  const activeSort = sortState.filter(x => x.on);' +
    '  return (activeSort.length ? activeSort : sortState.slice(0, 1)).map(x => x.k + ":" + x.d).join(",");' +
    '}' +
    'function syncControlStates() {' +
    '  syncLangOrder();' +
    '  inputs.forEach(i => i.closest(".lang-item").classList.toggle("is-selected", i.checked));' +
    '  selCount.textContent = tf("selCount", { n: langOrder.length });' +
    '  const qPicked = qInputs.filter(i => i.checked).map(i => i.value);' +
    '  const qs = qPicked.length ? qPicked : ["2160p", "1440p", "1080p", "720p"];' +
    '  const qSet = new Set(qs);' +
    '  qInputs.forEach(i => i.closest(".qual-item").classList.toggle("is-selected", i.checked));' +
    '  qualCount.textContent = tf("qualCount", { n: qPicked.length });' +
    '  const allMode = qlimAllToggle.checked;' +
    '  qlimAllBox.classList.toggle("hidden", !allMode);' +
    '  qlimPerBox.classList.toggle("hidden", allMode);' +
    '  qMapInputs.forEach(inp => {' +
    '    const card = inp.closest(".qlim-card");' +
    '    if (card) card.classList.toggle("is-off", !qSet.has(inp.dataset.qmap));' +
    '  });' +
    '  syncQuickChips("qlimAll", clamp(qlimAllInp.value, 0, 50));' +
    '  syncQuickChips("hubLim", clamp(hubLimInp.value, 0, 200));' +
    '  syncQuickChips("timeoutSec", clamp(timeoutInp.value, 10, 90));' +
    '  failoverBox.classList.toggle("hidden", !failoverOnEl.checked);' +
    '  syncQuickChips("failoverSec", clamp(failoverInp.value, 5, 45));' +
    '}' +
    'function renderSortList() {' +
    '  const ssort = getSortString();' +
    '  const SORT_META = getSortMeta();' +
    '  document.querySelectorAll("#sortPresets .qchip").forEach(b => b.classList.toggle("is-active", b.dataset.sp === ssort));' +
    '  sortOrderList.innerHTML = "";' +
    '  let ordNo = 0;' +
    '  sortState.forEach((item, idx) => {' +
    '    const meta = SORT_META[item.k];' +
    '    const ch = document.createElement("span"); ch.className = "s-chip" + (item.on ? "" : " is-off"); ch.draggable = true;' +
    '    ch.addEventListener("dragstart", () => { sDragFrom = idx; ch.classList.add("is-drag"); });' +
    '    ch.addEventListener("dragend", () => { sDragFrom = -1; ch.classList.remove("is-drag"); document.querySelectorAll(".s-chip.is-over").forEach(x => x.classList.remove("is-over")); });' +
    '    ch.addEventListener("dragover", e => { e.preventDefault(); if (sDragFrom >= 0 && sDragFrom !== idx) ch.classList.add("is-over"); });' +
    '    ch.addEventListener("dragleave", () => ch.classList.remove("is-over"));' +
    '    ch.addEventListener("drop", e => { e.preventDefault(); ch.classList.remove("is-over"); if (sDragFrom >= 0 && sDragFrom !== idx) { const [mv] = sortState.splice(sDragFrom, 1); sortState.splice(idx, 0, mv); sDragFrom = -1; renderSortList(); syncOutputUrl(true); } });' +
    '    const bL = document.createElement("button"); bL.type = "button"; bL.className = "mv-btn"; bL.textContent = "\u2039"; bL.disabled = idx === 0;' +
    '    bL.addEventListener("click", () => { if (idx > 0) { [sortState[idx-1], sortState[idx]] = [sortState[idx], sortState[idx-1]]; renderSortList(); syncOutputUrl(true); } });' +
    '    const num = document.createElement("span"); num.className = "h-num"; num.textContent = item.on ? ((++ordNo) + ".") : "-";' +
    '    const lbl = document.createElement("span"); lbl.textContent = meta.name;' +
    '    const bDir = document.createElement("button"); bDir.type = "button"; bDir.className = "s-dir"; bDir.title = t("sortDirTitle"); bDir.textContent = item.d === "asc" ? meta.asc : meta.desc;' +
    '    bDir.addEventListener("click", () => { item.d = item.d === "asc" ? "desc" : "asc"; item.on = true; renderSortList(); syncOutputUrl(true); });' +
    '    const bOn = document.createElement("button"); bOn.type = "button"; bOn.className = "s-on"; bOn.title = item.on ? t("sortOffTitle") : t("sortOnTitle"); bOn.textContent = item.on ? "✓" : "○";' +
    '    bOn.addEventListener("click", () => { item.on = !item.on; renderSortList(); syncOutputUrl(true); });' +
    '    const bR = document.createElement("button"); bR.type = "button"; bR.className = "mv-btn"; bR.textContent = "\u203a"; bR.disabled = idx === sortState.length - 1;' +
    '    bR.addEventListener("click", () => { if (idx < sortState.length - 1) { [sortState[idx+1], sortState[idx]] = [sortState[idx], sortState[idx+1]]; renderSortList(); syncOutputUrl(true); } });' +
    '    ch.append(bL, num, lbl, bDir, bOn, bR);' +
    '    sortOrderList.appendChild(ch);' +
    '  });' +
    '}' +
    'function renderRepoGroups() {' +
    '  const ls = langOrder.length ? langOrder.slice() : ["tr", "en"];' +
    '  const hsort = hubSortSel.value;' +
    '  const dispLangs = orderedLangs(ls, hsort);' +
    '  repoGroups.innerHTML = "";' +
    '  let totalR = 0, activeR = 0;' +
    '  dispLangs.forEach(code => {' +
    '    const list = REPOS_BY_LANG[code] || [];' +
    '    if (!list.length) return;' +
    '    const grp = document.createElement("div"); grp.className = "repo-group";' +
    '    const gOn = list.filter(r => !disabledRepos.has(r.id)).length;' +
    '    totalR += list.length; activeR += gOn;' +
    '    const gh = document.createElement("div"); gh.className = "repo-ghead";' +
    '    const gt = document.createElement("span"); gt.className = "repo-gtitle";' +
    '    const flagSp = document.createElement("span"); flagSp.className = "flag";' +
    '    if (Object.prototype.hasOwnProperty.call(FLAG_SVGS, code)) flagSp.innerHTML = FLAG_SVGS[code];' +
    '    const titleTxt = document.createElement("span"); titleTxt.textContent = code.toUpperCase() + " Hub · " + (CATALOG_NAMES[code] || code);' +
    '    gt.append(flagSp, titleTxt);' +
    '    const ga = document.createElement("span"); ga.className = "repo-gact";' +
    '    const gc = document.createElement("span"); gc.className = "count"; gc.textContent = tf("grpActive", { on: gOn, total: list.length });' +
    '    const gBtn = document.createElement("button"); gBtn.type = "button"; gBtn.className = "link-btn"; gBtn.textContent = gOn === list.length ? t("grpClose") : t("grpOpenAll");' +
    '    gBtn.addEventListener("click", () => { if (gOn === list.length) list.forEach(r => disabledRepos.add(r.id)); else list.forEach(r => disabledRepos.delete(r.id)); renderRepoGroups(); syncOutputUrl(true); });' +
    '    ga.append(gc, gBtn); gh.append(gt, ga); grp.appendChild(gh);' +
    '    const grid = document.createElement("div"); grid.className = "repo-grid";' +
    '    const drawerHost = document.createElement("div");' +
    '    async function renderDrawer(code, r) {' +
    '      const dk = code + "|" + r.id;' +
    '      drawerHost.innerHTML = "";' +
    '      if (openDrawers[code] !== r.id) return;' +
    '      const dw = document.createElement("div"); dw.className = "src-drawer";' +
    '      drawerHost.appendChild(dw);' +
    '      if (!srcCache[dk]) {' +
    '        const loadingSp = document.createElement("span"); loadingSp.className = "count"; loadingSp.textContent = t("srcLoading"); dw.appendChild(loadingSp);' +
    '        if (!srcPending[dk]) {' +
    '          srcPending[dk] = fetch(ORIGIN + "/api/repo-sources?lang=" + encodeURIComponent(code) + "&repo=" + encodeURIComponent(r.id))' +
    '            .then(res => res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status)))' +
    '            .then(j => { const arr = Array.isArray(j.sources) ? j.sources : []; srcCache[dk] = arr; arr.forEach(it => { if (!provLangMap[it.id]) provLangMap[it.id] = new Set(); provLangMap[it.id].add(code); }); return arr; })' +
    '            .catch(() => { srcCache[dk] = []; return []; })' +
    '            .finally(() => { delete srcPending[dk]; });' +
    '        }' +
    '        await srcPending[dk];' +
    '        if (!drawerHost.isConnected || openDrawers[code] !== r.id) return;' +
    '      }' +
    '      const items = srcCache[dk] || [];' +
    '      dw.innerHTML = "";' +
    '      const bar = document.createElement("div"); bar.className = "src-bar";' +
    '      const titleSp = document.createElement("span"); titleSp.className = "count";' +
    '      const rDispName = locRepoName(r);' +
    '      const srch = document.createElement("input"); srch.type = "text"; srch.className = "src-search"; srch.placeholder = tf("srcSearchPh", { name: rDispName });' +
    '      const actSp = document.createElement("span"); actSp.className = "repo-gact";' +
    '      const bOn = document.createElement("button"); bOn.type = "button"; bOn.className = "link-btn"; bOn.textContent = t("srcAllOn");' +
    '      const bOff = document.createElement("button"); bOff.type = "button"; bOff.className = "link-btn"; bOff.textContent = t("srcAllOff");' +
    '      const bCls = document.createElement("button"); bCls.type = "button"; bCls.className = "link-btn"; bCls.textContent = t("srcClose");' +
    '      actSp.append(bOn, bOff, bCls);' +
    '      bar.append(titleSp, srch, actSp);' +
    '      const chips = document.createElement("div"); chips.className = "src-chips";' +
    '      dw.append(bar, chips);' +
    '      function drawChips() {' +
    '        const q = srch.value.trim().toLowerCase();' +
    '        const activeCnt = items.filter(it => !disabledProvs.has(it.id)).length;' +
    '        titleSp.textContent = tf("srcActiveCnt", { name: rDispName, on: activeCnt, total: items.length });' +
    '        chips.innerHTML = "";' +
    '        const shown = q ? items.filter(it => it.name.toLowerCase().includes(q)) : items;' +
    '        if (!shown.length) { const emptySp = document.createElement("span"); emptySp.className = "count"; emptySp.textContent = t("srcEmpty"); chips.appendChild(emptySp); return; }' +
    '        const frag = document.createDocumentFragment();' +
    '        shown.forEach(it => {' +
    '          const off = disabledProvs.has(it.id);' +
    '          const ch = document.createElement("button"); ch.type = "button"; ch.className = "src-chip" + (off ? " is-off" : "");' +
    '          ch.textContent = it.name;' +
    '          ch.addEventListener("click", () => { if (disabledProvs.has(it.id)) disabledProvs.delete(it.id); else disabledProvs.add(it.id); drawChips(); syncOutputUrl(true); });' +
    '          frag.appendChild(ch);' +
    '        });' +
    '        chips.appendChild(frag);' +
    '      }' +
    '      let srchTimer = null;' +
    '      srch.addEventListener("input", () => { clearTimeout(srchTimer); srchTimer = setTimeout(drawChips, 100); });' +
    '      bOn.addEventListener("click", () => { items.forEach(it => disabledProvs.delete(it.id)); drawChips(); syncOutputUrl(true); });' +
    '      bOff.addEventListener("click", () => { items.forEach(it => disabledProvs.add(it.id)); drawChips(); syncOutputUrl(true); });' +
    '      bCls.addEventListener("click", () => { delete openDrawers[code]; drawerHost.innerHTML = ""; renderRepoGroups(); syncOutputUrl(true); });' +
    '      drawChips();' +
    '    }' +
    '    list.forEach(r => {' +
    '      const isOff = disabledRepos.has(r.id);' +
    '      const wrap = document.createElement("div"); wrap.className = "repo-wrap" + (isOff ? " is-off" : "");' +
    '      const btn = document.createElement("button"); btn.type = "button"; btn.className = "repo-card" + (isOff ? " is-off" : "");' +
    '      btn.setAttribute("aria-pressed", String(!isOff));' +
    '      const meta = document.createElement("span"); meta.className = "repo-meta";' +
    '      const rn = document.createElement("span"); rn.className = "repo-name"; rn.textContent = locRepoName(r);' +
    '      const rs = document.createElement("span"); rs.className = "repo-sub"; rs.textContent = locRepoSub(r);' +
    '      meta.append(rn, rs);' +
    '      const tog = document.createElement("span"); tog.className = "rtog"; tog.setAttribute("aria-hidden", "true");' +
    '      btn.append(meta, tog);' +
    '      btn.addEventListener("click", () => { if (disabledRepos.has(r.id)) disabledRepos.delete(r.id); else disabledRepos.add(r.id); renderRepoGroups(); syncOutputUrl(true); });' +
    '      const foot = document.createElement("div"); foot.className = "repo-foot";' +
    '      const isOpen = openDrawers[code] === r.id;' +
    '      const exp = document.createElement("button"); exp.type = "button"; exp.className = "repo-exp";' +
    '      exp.textContent = (isOpen ? t("srcHide") : (r.count ? tf("srcCount", { n: r.count }) : t("srcShow")));' +
    '      exp.addEventListener("click", () => { if (openDrawers[code] === r.id) delete openDrawers[code]; else openDrawers[code] = r.id; renderRepoGroups(); });' +
    '      foot.appendChild(exp);' +
    '      wrap.append(btn, foot);' +
    '      grid.appendChild(wrap);' +
    '      if (isOpen) renderDrawer(code, r);' +
    '    });' +
    '    grp.append(grid, drawerHost); repoGroups.appendChild(grp);' +
    '  });' +
    '  repoCount.textContent = tf("repoCount", { on: activeR, total: totalR });' +
    '}' +
    'function renderHubOrder() {' +
    '  const ls = langOrder.length ? langOrder.slice() : ["tr", "en"];' +
    '  const hsort = hubSortSel.value;' +
    '  const dispLangs = orderedLangs(ls, hsort);' +
    '  document.querySelectorAll("[data-ord]").forEach(el => {' +
    '    const idx = dispLangs.indexOf(el.dataset.ord);' +
    '    const showNum = hsort === "custom" && langOrder.includes(el.dataset.ord) && idx >= 0;' +
    '    el.textContent = showNum ? String(idx + 1) : "";' +
    '    el.classList.toggle("hidden", !showNum);' +
    '  });' +
    '  hubOrderBox.classList.toggle("hidden", hsort !== "custom");' +
    '  if (hsort === "custom") {' +
    '    hubOrderList.innerHTML = "";' +
    '    ls.forEach((code, idx) => {' +
    '      const chip = document.createElement("span");' +
    '      chip.className = "h-chip";' +
    '      chip.draggable = ls.length > 1;' +
    '      chip.addEventListener("dragstart", () => { dragFrom = idx; chip.classList.add("is-drag"); });' +
    '      chip.addEventListener("dragend", () => { dragFrom = -1; chip.classList.remove("is-drag"); document.querySelectorAll(".h-chip.is-over").forEach(x => x.classList.remove("is-over")); });' +
    '      chip.addEventListener("dragover", e => { e.preventDefault(); if (dragFrom >= 0 && dragFrom !== idx) chip.classList.add("is-over"); });' +
    '      chip.addEventListener("dragleave", () => chip.classList.remove("is-over"));' +
    '      chip.addEventListener("drop", e => { e.preventDefault(); chip.classList.remove("is-over"); if (dragFrom >= 0 && dragFrom !== idx) { const arr = ls.slice(); const [mv] = arr.splice(dragFrom, 1); arr.splice(idx, 0, mv); langOrder = arr; dragFrom = -1; renderRepoGroups(); renderHubOrder(); renderPreview(); syncOutputUrl(true); } });' +
    '      const bL = document.createElement("button"); bL.type = "button"; bL.className = "mv-btn"; bL.textContent = "\u2039"; bL.title = t("moveLeft"); bL.disabled = idx === 0;' +
    '      bL.addEventListener("click", () => { if (idx > 0) { const arr = ls.slice(); [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]]; langOrder = arr; renderRepoGroups(); renderHubOrder(); renderPreview(); syncOutputUrl(true); } });' +
    '      const num = document.createElement("span"); num.className = "h-num"; num.textContent = (idx + 1) + ".";' +
    '      const lbl = document.createElement("span"); lbl.textContent = code.toUpperCase() + " Hub";' +
    '      const bR = document.createElement("button"); bR.type = "button"; bR.className = "mv-btn"; bR.textContent = "\u203a"; bR.title = t("moveRight"); bR.disabled = idx === ls.length - 1;' +
    '      bR.addEventListener("click", () => { if (idx < ls.length - 1) { const arr = ls.slice(); [arr[idx+1], arr[idx]] = [arr[idx], arr[idx+1]]; langOrder = arr; renderRepoGroups(); renderHubOrder(); renderPreview(); syncOutputUrl(true); } });' +
    '      chip.append(bL, num, lbl, bR);' +
    '      hubOrderList.appendChild(chip);' +
    '    });' +
    '  }' +
    '}' +
    'function renderPreview() {' +
    '  const ls = langOrder.length ? langOrder.slice() : ["tr", "en"];' +
    '  const hsort = hubSortSel.value;' +
    '  const dispLangs = orderedLangs(ls, hsort);' +
    '  previewChips.innerHTML = "";' +
    '  if (installMode === "nuvio") {' +
    '    previewHint.textContent = t("previewNuvio");' +
    '    dispLangs.forEach(code => {' +
    '      const c = document.createElement("span");' +
    '      c.className = "p-chip";' +
    '      c.textContent = code.toUpperCase() + " Hub";' +
    '      previewChips.appendChild(c);' +
    '    });' +
    '  } else {' +
    '    previewHint.textContent = t("previewAio");' +
    '    const c = document.createElement("span"); c.className = "p-chip"; c.textContent = "Stremio (" + dispLangs.map(x => x.toUpperCase()).join("+") + ")"; previewChips.appendChild(c);' +
    '  }' +
    '}' +
    'function syncOutputUrl(persistLocal) {' +
    '  if (persistLocal === undefined) persistLocal = true;' +
    '  const ls = langOrder.length ? langOrder.slice() : ["tr", "en"];' +
    '  const hsort = hubSortSel.value;' +
    '  const dispLangs = orderedLangs(ls, hsort);' +
    '  const qPicked = qInputs.filter(i => i.checked).map(i => i.value);' +
    '  const qs = qPicked.length ? qPicked : ["2160p", "1440p", "1080p", "720p"];' +
    '  const allMode = qlimAllToggle.checked;' +
    '  const qlimAllVal = clamp(qlimAllInp.value, 0, 50);' +
    '  const hubLimVal = clamp(hubLimInp.value, 0, 200);' +
    '  const toVal = clamp(timeoutInp.value, 10, 90);' +
    '  const fbOn = failoverOnEl.checked;' +
    '  const fbVal = clamp(failoverInp.value, 5, 45);' +
    '  const ssort = getSortString();' +
    '  const parts = [' +
    '    "langs=" + ls.join(","),' +
    '    "quals=" + qs.join(","),' +
    '    "qlm=" + (allMode ? "all" : "per"),' +
    '  ];' +
    '  if (allMode) parts.push("qlim=" + qlimAllVal);' +
    '  else parts.push("qmap=" + qMapInputs.map(inp => inp.dataset.qmap + ":" + clamp(inp.value, 0, 50)).join(","));' +
    '  parts.push("hublim=" + hubLimVal);' +
    '  parts.push("ssort=" + ssort);' +
    '  parts.push("hsort=" + hsort);' +
    '  parts.push("to=" + toVal);' +
    '  if (hubSeqOnEl.checked) parts.push("hseq=1");' +
    '  if (fbOn) { parts.push("fb=1"); parts.push("fbto=" + fbVal); }' +
    '  const activeRepoIds = new Set(dispLangs.flatMap(c => (REPOS_BY_LANG[c] || []).map(r => r.id)));' +
    '  const offList = [...disabledRepos].filter(id => activeRepoIds.has(id)).sort();' +
    '  if (offList.length) parts.push("off=" + offList.join(","));' +
    '  const activeLangSet = new Set(dispLangs);' +
    '  const offPList = [...disabledProvs].filter(pid => {' +
    '    const pl = provLangMap[pid];' +
    '    if (!pl || !pl.size) return true;' +
    '    for (const c of pl) if (activeLangSet.has(c)) return true;' +
    '    return false;' +
    '  }).sort();' +
    '  if (offPList.length) parts.push("offp=" + offPList.join(","));' +
    '  if (persistLocal) {' +
    '    try {' +
    '      const qmapObj = {}; qMapInputs.forEach(inp => { qmapObj[inp.dataset.qmap] = clamp(inp.value, 0, 50); });' +
    '      localStorage.setItem(STORAGE_KEY, JSON.stringify({ langs: langOrder.slice(), quals: qPicked.slice(), qlm: allMode ? "all" : "per", qlim: qlimAllVal, qmap: qmapObj, hublim: hubLimVal, ssort, hsort, hseq: hubSeqOnEl.checked, fb: fbOn, fbto: fbVal, to: toVal, off: [...disabledRepos], offp: [...disabledProvs] }));' +
    '    } catch {}' +
    '    saveUiPrefs();' +
    '  }' +
    '  const cfg = parts.join("&");' +
    '  lastCfgStr = cfg;' +
    '  const url = linkMode === "saved" ? (installMode === "nuvio" ? (ORIGIN + "/saved/nuvio-repo/manifest.json") : (ORIGIN + "/saved/manifest.json")) : (installMode === "nuvio" ? (ORIGIN + "/c/" + encodeURIComponent(cfg) + "/nuvio-repo/manifest.json") : (ORIGIN + "/c/" + encodeURIComponent(cfg + "&mode=direct") + "/manifest.json"));' +
    '  document.getElementById("saveBtn").classList.toggle("hidden", linkMode !== "saved");' +
    '  out.textContent = url;' +
    '  sbtn.classList.toggle("hidden", installMode === "nuvio");' +
    '  sbtn.href = "stremio://" + url.replace("https://", "").replace("http://", "");' +
    '}' +
    'function renderAll(persistLocal) {' +
    '  syncControlStates();' +
    '  renderSortList();' +
    '  renderRepoGroups();' +
    '  renderHubOrder();' +
    '  renderPreview();' +
    '  syncOutputUrl(persistLocal);' +
    '}' +
    'function bindClampedNumber(inp, min, max) {' +
    '  inp.addEventListener("input", () => { syncControlStates(); syncOutputUrl(true); });' +
    '  const commit = () => { inp.value = clamp(inp.value, min, max); syncControlStates(); syncOutputUrl(true); };' +
    '  inp.addEventListener("change", commit);' +
    '  inp.addEventListener("blur", commit);' +
    '}' +
    'inputs.forEach(i => i.addEventListener("change", () => { syncControlStates(); renderRepoGroups(); renderHubOrder(); renderPreview(); syncOutputUrl(true); }));' +
    'qInputs.forEach(i => i.addEventListener("change", () => { syncControlStates(); syncOutputUrl(true); }));' +
    'qlimAllToggle.addEventListener("change", () => { syncControlStates(); syncOutputUrl(true); });' +
    'bindClampedNumber(qlimAllInp, 0, 50);' +
    'bindClampedNumber(hubLimInp, 0, 200);' +
    'qMapInputs.forEach(i => bindClampedNumber(i, 0, 50));' +
    'document.querySelectorAll("#sortPresets .qchip").forEach(b => b.addEventListener("click", () => { sortState = parseSortUi(b.dataset.sp); renderSortList(); syncOutputUrl(true); }));' +
    'hubSortSel.addEventListener("change", () => { renderRepoGroups(); renderHubOrder(); renderPreview(); syncOutputUrl(true); });' +
    'hubSeqOnEl.addEventListener("change", () => { syncControlStates(); syncOutputUrl(true); });' +
    'failoverOnEl.addEventListener("change", () => { syncControlStates(); syncOutputUrl(true); });' +
    'bindClampedNumber(failoverInp, 5, 45);' +
    'bindClampedNumber(timeoutInp, 10, 90);' +
    'document.querySelectorAll(".step-btn").forEach(btn => btn.addEventListener("click", () => {' +
    '  const inp = document.getElementById(btn.dataset.target);' +
    '  if (!inp) return;' +
    '  const delta = parseInt(btn.dataset.step, 10) || 0;' +
    '  inp.value = clamp((parseInt(inp.value, 10) || 0) + delta, parseInt(inp.min, 10) || 0, parseInt(inp.max, 10) || 200);' +
    '  syncControlStates(); syncOutputUrl(true);' +
    '}));' +
    'document.querySelectorAll("[data-qgroup=qlimAll] .qchip").forEach(btn => btn.addEventListener("click", () => { qlimAllInp.value = btn.dataset.val; syncControlStates(); syncOutputUrl(true); }));' +
    'document.querySelectorAll("[data-qgroup=hubLim] .qchip").forEach(btn => btn.addEventListener("click", () => { hubLimInp.value = btn.dataset.val; syncControlStates(); syncOutputUrl(true); }));' +
    'document.querySelectorAll("[data-qgroup=timeoutSec] .qchip").forEach(btn => btn.addEventListener("click", () => { timeoutInp.value = btn.dataset.val; syncControlStates(); syncOutputUrl(true); }));' +
    'document.querySelectorAll("[data-qgroup=failoverSec] .qchip").forEach(btn => btn.addEventListener("click", () => { failoverInp.value = btn.dataset.val; syncControlStates(); syncOutputUrl(true); }));' +
    'const blListEl = document.getElementById("blList");' +
    'const blCountEl = document.getElementById("blCount");' +
    'const blMediaInp = document.getElementById("blMediaInp");' +
    'const blProvInp = document.getElementById("blProvInp");' +
    'const blUrlInp = document.getElementById("blUrlInp");' +
    'function renderBlacklist(items) {' +
    '  const arr = Array.isArray(items) ? items : [];' +
    '  lastBlItems = arr;' +
    '  blCountEl.textContent = tf("blCount", { n: arr.length });' +
    '  blListEl.innerHTML = "";' +
    '  if (!arr.length) { const sp = document.createElement("span"); sp.className = "count"; sp.textContent = t("blEmpty"); blListEl.appendChild(sp); return; }' +
    '  arr.forEach(it => {' +
    '    const row = document.createElement("div"); row.className = "bl-item";' +
    '    const meta = document.createElement("div"); meta.className = "bl-meta";' +
    '    const top = document.createElement("div"); top.className = "bl-top";' +
    '    const prov = document.createElement("span"); prov.className = "bl-prov"; prov.textContent = it.provider || t("blUrlEntry");' +
    '    const tag = document.createElement("span"); const isAuto = String(it.reason || "").startsWith("auto"); tag.className = "bl-tag " + (isAuto ? "is-auto" : "is-man");' +
    '    tag.textContent = it.reason === "auto_timeout" ? t("blAutoTimeout") : it.reason === "auto_error" ? t("blAutoError") : t("blManual");' +
    '    const mk = document.createElement("span"); mk.className = "bl-tag"; mk.textContent = it.mediaKey === "*" ? t("blAllMedia") : (it.mediaLabel || it.mediaKey);' +
    '    top.append(prov, tag, mk);' +
    '    const sub = document.createElement("div"); sub.className = "bl-sub";' +
    '    const dt = it.createdAt ? new Date(it.createdAt).toLocaleString(activeLocale()) : "";' +
    '    sub.textContent = [it.url || "", dt].filter(Boolean).join(" · ");' +
    '    meta.append(top, sub);' +
    '    const del = document.createElement("button"); del.type = "button"; del.className = "bl-del"; del.textContent = t("remove");' +
    '    del.addEventListener("click", async () => {' +
    '      if (del.disabled) return;' +
    '      del.disabled = true;' +
    '      try {' +
    '        const r = await fetch(ORIGIN + "/api/blacklist/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id }) });' +
    '        if (!r.ok) throw new Error("HTTP " + r.status);' +
    '        const j = await r.json();' +
    '        renderBlacklist(j.items);' +
    '      } catch { del.disabled = false; setStatus(t("blRemoveErr"), 3500, true); }' +
    '    });' +
    '    row.append(meta, del); blListEl.appendChild(row);' +
    '  });' +
    '}' +
    'async function loadBlacklistUi() { try { const r = await fetch(ORIGIN + "/api/blacklist"); if (!r.ok) throw new Error("HTTP " + r.status); const j = await r.json(); renderBlacklist(j.items); } catch { lastBlItems = null; blListEl.innerHTML = ""; const sp = document.createElement("span"); sp.className = "count"; sp.textContent = t("blReadErr"); blListEl.appendChild(sp); } }' +
    'document.getElementById("blRefreshBtn").addEventListener("click", loadBlacklistUi);' +
    'document.getElementById("blClearBtn").addEventListener("click", async () => {' +
    '  if (!confirm(t("blClearConfirm"))) return;' +
    '  try {' +
    '    const r = await fetch(ORIGIN + "/api/blacklist/clear", { method: "POST" });' +
    '    if (!r.ok) throw new Error("HTTP " + r.status);' +
    '    const j = await r.json();' +
    '    renderBlacklist(j.items);' +
    '  } catch { setStatus(t("blClearErr"), 3500, true); }' +
    '});' +
    'document.getElementById("blAddBtn").addEventListener("click", async () => {' +
    '  const provider = blProvInp.value.trim(); const url = blUrlInp.value.trim(); const mediaKey = blMediaInp.value.trim() || "*";' +
    '  if (!provider && !url) return;' +
    '  try {' +
    '    const r = await fetch(ORIGIN + "/api/blacklist/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaKey, mediaLabel: mediaKey, provider, url }) });' +
    '    if (!r.ok) throw new Error("HTTP " + r.status);' +
    '    const j = await r.json();' +
    '    renderBlacklist(j.items);' +
    '    blMediaInp.value = ""; blProvInp.value = ""; blUrlInp.value = "";' +
    '  } catch { setStatus(t("blAddErr"), 3500, true); }' +
    '});' +
    'document.getElementById("qAll").addEventListener("click", () => { qInputs.forEach(i => i.checked = true); syncControlStates(); syncOutputUrl(true); });' +
    'document.getElementById("qNo4k").addEventListener("click", () => { qInputs.forEach(i => i.checked = (i.value !== "2160p")); syncControlStates(); syncOutputUrl(true); });' +
    'document.getElementById("q1080").addEventListener("click", () => { qInputs.forEach(i => i.checked = (i.value === "2160p" || i.value === "1440p" || i.value === "1080p")); syncControlStates(); syncOutputUrl(true); });' +
    'document.querySelectorAll(".seg button[data-install]").forEach(b => b.addEventListener("click", () => {' +
    '  installMode = b.dataset.install;' +
    '  document.querySelectorAll(".seg button[data-install]").forEach(x => x.classList.toggle("is-active", x === b));' +
    '  saveUiPrefs(); renderPreview(); syncOutputUrl(false);' +
    '}));' +
    'document.querySelectorAll(".seg button[data-linkmode]").forEach(b => b.addEventListener("click", () => {' +
    '  linkMode = b.dataset.linkmode;' +
    '  document.querySelectorAll(".seg button[data-linkmode]").forEach(x => x.classList.toggle("is-active", x === b));' +
    '  saveUiPrefs(); renderPreview(); syncOutputUrl(false);' +
    '}));' +
    'async function saveToServer(silent) {' +
    '  try {' +
    '    const res = await fetch(ORIGIN + "/api/save-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cfg: lastCfgStr }) });' +
    '    if (res.ok && !silent) setStatus(t("stSaved"), 3500, false);' +
    '    else if (!res.ok && !silent) setStatus(t("stSaveErr"), 3500, true);' +
    '    return res.ok;' +
    '  } catch { if (!silent) setStatus(t("stSaveErr"), 3500, true); return false; }' +
    '}' +
    'document.getElementById("saveBtn").addEventListener("click", () => saveToServer(false));' +
    'sbtn.addEventListener("click", async (e) => {' +
    '  if (linkMode === "saved") {' +
    '    e.preventDefault();' +
    '    await saveToServer(true);' +
    '    window.location.href = sbtn.href;' +
    '  }' +
    '});' +
    'document.getElementById("presetTrEn").addEventListener("click", () => {' +
    '  inputs.forEach(i => i.checked = (i.value === "tr" || i.value === "en"));' +
    '  langOrder = ["tr", "en"];' +
    '  syncControlStates(); renderRepoGroups(); renderHubOrder(); renderPreview(); syncOutputUrl(true);' +
    '});' +
    'document.getElementById("clearBtn").addEventListener("click", () => {' +
    '  inputs.forEach(i => i.checked = false);' +
    '  langOrder = [];' +
    '  syncControlStates(); renderRepoGroups(); renderHubOrder(); renderPreview(); syncOutputUrl(true);' +
    '});' +
    'document.getElementById("reposAllOn").addEventListener("click", () => { disabledRepos.clear(); disabledProvs.clear(); renderRepoGroups(); syncOutputUrl(true); });' +
    'document.getElementById("reposAllOff").addEventListener("click", () => { const ls = langOrder.length ? langOrder : ["tr", "en"]; ls.forEach(c => (REPOS_BY_LANG[c] || []).forEach(r => disabledRepos.add(r.id))); renderRepoGroups(); syncOutputUrl(true); });' +
    'document.getElementById("copyBtn").addEventListener("click", async () => {' +
    '  if (linkMode === "saved") await saveToServer(true);' +
    '  try { await navigator.clipboard.writeText(out.textContent); setStatus(linkMode === "saved" ? t("stSavedCopied") : t("stCopied"), 2500, false); }' +
    '  catch { setStatus(t("stSelectCopy"), 3000, false); }' +
    '});' +
    'if (uiLangSel) uiLangSel.addEventListener("change", () => { applyUiLang(uiLangSel.value, true); saveUiPrefs(); });' +
    'try {' +
    '  const uiRaw = localStorage.getItem(UI_PREFS_KEY);' +
    '  const uiSrc = uiRaw ? JSON.parse(uiRaw) : JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");' +
    '  if (uiSrc && typeof uiSrc === "object") {' +
    '    if (uiSrc.installMode === "nuvio" || uiSrc.installMode === "aio") { installMode = uiSrc.installMode; document.querySelectorAll(".seg button[data-install]").forEach(x => x.classList.toggle("is-active", x.dataset.install === installMode)); }' +
    '    if (uiSrc.linkMode === "saved" || uiSrc.linkMode === "inline") { linkMode = uiSrc.linkMode; document.querySelectorAll(".seg button[data-linkmode]").forEach(x => x.classList.toggle("is-active", x.dataset.linkmode === linkMode)); }' +
    '    if (typeof uiSrc.uiLang === "string") uiLangPref = uiSrc.uiLang;' +
    '  }' +
    '} catch {}' +
    'if (!HAS_URL_CFG) {' +
    '  try {' +
    '    const raw = localStorage.getItem(STORAGE_KEY);' +
    '    if (raw) {' +
    '      const s = JSON.parse(raw);' +
    '      if (Array.isArray(s.langs)) { const lSet = new Set(s.langs); inputs.forEach(i => { i.checked = lSet.has(i.value); }); langOrder = s.langs.filter(c => CATALOG_ORDER.includes(c)); }' +
    '      if (Array.isArray(s.quals)) { const qS = new Set(s.quals); qInputs.forEach(i => { i.checked = qS.has(i.value); }); }' +
    '      if (s.qlm === "all" || s.qlm === "per") qlimAllToggle.checked = (s.qlm === "all");' +
    '      if (s.qlim !== undefined) qlimAllInp.value = clamp(s.qlim, 0, 50);' +
    '      if (s.qmap && typeof s.qmap === "object") qMapInputs.forEach(inp => { if (s.qmap[inp.dataset.qmap] !== undefined) inp.value = clamp(s.qmap[inp.dataset.qmap], 0, 50); });' +
    '      if (s.hublim !== undefined) hubLimInp.value = clamp(s.hublim, 0, 200);' +
    '      if (s.ssort) sortState = parseSortUi(s.ssort);' +
    '      if (s.hsort && [...hubSortSel.options].some(o => o.value === s.hsort)) hubSortSel.value = s.hsort;' +
    '      if (typeof s.hseq === "boolean") hubSeqOnEl.checked = s.hseq;' +
    '      if (typeof s.fb === "boolean") failoverOnEl.checked = s.fb;' +
    '      if (s.fbto !== undefined) failoverInp.value = clamp(s.fbto, 5, 45);' +
    '      if (s.to !== undefined) timeoutInp.value = clamp(s.to, 10, 90);' +
    '      if (Array.isArray(s.off)) disabledRepos = new Set(s.off);' +
    '      if (Array.isArray(s.offp)) disabledProvs = new Set(s.offp);' +
    '    }' +
    '  } catch {}' +
    '}' +
    'applyUiLang(uiLangPref, false);' +
    'renderAll(false);' +
    'loadBlacklistUi();' +
    '</script></body></html>';
}

module.exports = { renderConfigureHtml };
