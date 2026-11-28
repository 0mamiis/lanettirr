'use strict';

const { UI_LANG_META, I18N, resolveUiLang } = require('./configure-i18n');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  const appVersion = (opts && opts.appVersion) ? String(opts.appVersion).trim().replace(/^v/i, '') : '1.3.6';
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
      '<span class="chk" aria-hidden="true"><svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6.5 4.8,9.2 10,3"/></svg></span>' +
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
      '<span class="chk" aria-hidden="true"><svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6.5 4.8,9.2 10,3"/></svg></span>' +
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
  const catalogsOn = cfg.catalogs !== false ? 'checked' : '';

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

  return '<!doctype html><html lang="' + esc(htmlLang) + '" dir="' + esc(htmlDir) + '" data-palette="signal"><head>' +
    '<meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    '<meta name="color-scheme" content="light dark"/>' +
    '<title>Lanettirr</title>' +
    '<style>' +
    ':root,html[data-palette="signal"]{' +
      '--bg:#101010;--dot:#242424;--surface:#161616;--surface-2:#1d1d1d;--surface-3:#262626;--surface-hover:#252525;' +
      '--border:#2c2c2c;--border-strong:#424242;--fg:#f1f0eb;--fg-muted:#91908a;' +
      '--primary:#ff4d00;--primary-hover:#ff621f;--primary-fg:#111111;--primary-soft:rgba(255,77,0,.13);--primary-ring:rgba(255,77,0,.28);' +
      '--flag-ring:rgba(241,240,235,.16);--code-bg:#111111;--code-fg:#e2e0d8;' +
      '--ok:#46c077;--ok-soft:rgba(70,192,119,.13);--warn:#f0a135;--warn-soft:rgba(240,161,53,.14);--danger:#e25353;--danger-soft:rgba(226,83,83,.14);' +
      '--shadow-sm:0 1px 2px rgba(0,0,0,.35);--shadow-md:0 14px 36px -18px rgba(0,0,0,.72);' +
      '--don-bg:#161616;--don-border:#2c2c2c;--don-tile-bg:#1d1d1d;--don-tile-border:#333333;' +
      '--inst-bg:#161616;--inst-head:#1a1a1a;--inst-border:#383838;--inst-inner:#1d1d1d;--inst-inner-border:#2e2e2e;' +
      '--r-xs:4px;--r-sm:5px;--r-md:6px;--r-lg:6px;--r-pill:999px;' +
    '}' +
    'html[data-palette="chalk"]{' +
      '--bg:#eae7df;--dot:#d4cfc3;--surface:#f6f4ee;--surface-2:#e3dfd5;--surface-3:#d7d2c6;--surface-hover:#dbd6ca;' +
      '--border:#cbc5b7;--border-strong:#ada696;--fg:#191815;--fg-muted:#6b665c;' +
      '--primary:#d94111;--primary-hover:#be360b;--primary-fg:#ffffff;--primary-soft:rgba(217,65,17,.11);--primary-ring:rgba(217,65,17,.25);' +
      '--flag-ring:rgba(25,24,21,.16);--code-bg:#e7e3d9;--code-fg:#26231e;' +
      '--ok:#257a48;--ok-soft:rgba(37,122,72,.12);--warn:#b4690e;--warn-soft:rgba(180,105,14,.12);--danger:#c03232;--danger-soft:rgba(192,50,50,.11);' +
      '--shadow-sm:0 1px 2px rgba(25,24,21,.06);--shadow-md:0 10px 26px -14px rgba(25,24,21,.15);' +
      '--don-bg:#f6f4ee;--don-border:#cbc5b7;--don-tile-bg:#ebe7dd;--don-tile-border:#c4beb0;' +
      '--inst-bg:#f6f4ee;--inst-head:#ece8de;--inst-border:#bdb6a6;--inst-inner:#e7e3d9;--inst-inner-border:#cbc5b7;' +
    '}' +
    'html[data-palette="sage"]{' +
      '--bg:#0c100e;--dot:#1d2922;--surface:#121815;--surface-2:#18201c;--surface-3:#202b25;--surface-hover:#202b25;' +
      '--border:#25332b;--border-strong:#394d42;--fg:#ebf2ed;--fg-muted:#84968b;' +
      '--primary:#56cf85;--primary-hover:#6edb98;--primary-fg:#0b140e;--primary-soft:rgba(86,207,133,.13);--primary-ring:rgba(86,207,133,.28);' +
      '--flag-ring:rgba(235,242,237,.16);--code-bg:#0e1310;--code-fg:#d7e5dc;' +
      '--ok:#56cf85;--ok-soft:rgba(86,207,133,.13);--warn:#e5a03c;--warn-soft:rgba(229,160,60,.14);--danger:#e25858;--danger-soft:rgba(226,88,88,.14);' +
      '--shadow-sm:0 1px 2px rgba(0,0,0,.35);--shadow-md:0 14px 36px -18px rgba(0,0,0,.72);' +
      '--don-bg:#121815;--don-border:#25332b;--don-tile-bg:#18201c;--don-tile-border:#2e3f35;' +
      '--inst-bg:#121815;--inst-head:#161e1a;--inst-border:#2e4035;--inst-inner:#18201c;--inst-inner-border:#28382e;' +
    '}' +
    'html[data-palette="amber"]{' +
      '--bg:#100e0c;--dot:#26211b;--surface:#171411;--surface-2:#201c17;--surface-3:#2a241e;--surface-hover:#29231d;' +
      '--border:#322b23;--border-strong:#4a3f33;--fg:#f3ede2;--fg-muted:#9a9082;' +
      '--primary:#e69f38;--primary-hover:#f0ae4d;--primary-fg:#161109;--primary-soft:rgba(230,159,56,.13);--primary-ring:rgba(230,159,56,.28);' +
      '--flag-ring:rgba(243,237,226,.16);--code-bg:#110f0c;--code-fg:#e2dad0;' +
      '--ok:#57bc7e;--ok-soft:rgba(87,188,126,.13);--warn:#e69f38;--warn-soft:rgba(230,159,56,.14);--danger:#df544f;--danger-soft:rgba(223,84,79,.14);' +
      '--shadow-sm:0 1px 2px rgba(0,0,0,.35);--shadow-md:0 14px 36px -18px rgba(0,0,0,.72);' +
      '--don-bg:#171411;--don-border:#322b23;--don-tile-bg:#201c17;--don-tile-border:#3c3329;' +
      '--inst-bg:#171411;--inst-head:#1c1814;--inst-border:#40362b;--inst-inner:#201c17;--inst-inner-border:#362e25;' +
    '}' +
    'html[data-palette="crimson"]{' +
      '--bg:#111113;--dot:#242428;--surface:#17171a;--surface-2:#1f1f23;--surface-3:#29292f;--surface-hover:#27272d;' +
      '--border:#2d2d34;--border-strong:#44444e;--fg:#f1f1f4;--fg-muted:#90909a;' +
      '--primary:#e63946;--primary-hover:#f24b58;--primary-fg:#ffffff;--primary-soft:rgba(230,57,70,.14);--primary-ring:rgba(230,57,70,.28);' +
      '--flag-ring:rgba(241,241,244,.16);--code-bg:#121215;--code-fg:#e0e0e6;' +
      '--ok:#4ec27d;--ok-soft:rgba(78,194,125,.13);--warn:#e8a23b;--warn-soft:rgba(232,162,59,.14);--danger:#e63946;--danger-soft:rgba(230,57,70,.14);' +
      '--shadow-sm:0 1px 2px rgba(0,0,0,.35);--shadow-md:0 14px 36px -18px rgba(0,0,0,.72);' +
      '--don-bg:#17171a;--don-border:#2d2d34;--don-tile-bg:#1f1f23;--don-tile-border:#36363e;' +
      '--inst-bg:#17171a;--inst-head:#1c1c20;--inst-border:#3a3a43;--inst-inner:#1f1f23;--inst-inner-border:#32323a;' +
    '}' +
    '*{box-sizing:border-box}' +
    'html,body{margin:0;padding:0;height:100%;background-color:var(--bg);background-image:radial-gradient(var(--dot) 1px,transparent 1px);background-size:16px 16px;color:var(--fg);font-family:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.45;overflow:hidden;-webkit-text-size-adjust:100%}' +
    'button,label,select,input,a{touch-action:manipulation}' +
    ':focus-visible{outline:2px solid var(--primary);outline-offset:2px}' +
    '.shell{display:grid;grid-template-columns:270px minmax(0,1fr);height:100vh;width:100vw}' +
    '.rack{background:var(--surface);border-inline-end:1px solid var(--border);display:flex;flex-direction:column;padding:16px 14px;gap:14px;overflow-y:auto;min-width:0}' +
    '.unit-hdr{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:12px;border-bottom:1px dashed var(--border-strong)}' +
    '.unit-brand{display:flex;align-items:center;gap:10px;min-width:0}' +
    '.led-logo{width:28px;height:28px;border-radius:5px;background:var(--surface-2);border:1px solid var(--border-strong);display:inline-flex;align-items:center;justify-content:center;font-family:"Cascadia Mono",Consolas,monospace;font-weight:800;font-size:14px;position:relative;flex-shrink:0;color:var(--fg)}' +
    '.led-logo::after{content:"";position:absolute;top:4px;right:4px;width:5px;height:5px;border-radius:50%;background:var(--primary);box-shadow:0 0 6px var(--primary)}' +
    'h1{margin:0;font-family:"Bahnschrift","Segoe UI Variable Display","Segoe UI",sans-serif;font-size:17px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}' +
    '.unit-rev{font-family:"Cascadia Mono",Consolas,monospace;font-size:10px;color:var(--fg-muted)}' +
    '.ver-pill{font-family:"Cascadia Mono",Consolas,monospace;font-size:10.5px;font-weight:600;color:var(--fg-muted);background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:2px 7px;font-variant-numeric:tabular-nums}' +
    '.telemetry-strip{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:var(--r-md);background:var(--surface-2);border:1px solid var(--border);font-size:11.5px}' +
    '.tally{display:inline-flex;align-items:center;gap:7px;font-weight:600}' +
    '.tally-dot{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 7px var(--ok);flex-shrink:0}' +
    '.tally-dot.is-wait{background:var(--warn);box-shadow:0 0 7px var(--warn)}' +
    '.nav{display:flex;flex-direction:column;gap:5px;flex:1}' +
    '.nav-sec{font-family:"Cascadia Mono",Consolas,monospace;font-size:10px;letter-spacing:.1em;color:var(--fg-muted);padding:4px 4px 2px;text-transform:uppercase}' +
    '.nav-item{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:9px 10px;border-radius:var(--r-md);border:1px solid var(--border);background:transparent;color:var(--fg-muted);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;text-align:start;transition:all .1s ease}' +
    '.nav-item:hover{background:var(--surface-2);color:var(--fg);border-color:var(--border-strong)}' +
    '.nav-item.is-active{background:var(--fg);color:var(--bg);border-color:var(--fg)}' +
    '.nav-left{display:flex;align-items:center;gap:7px;min-width:0;overflow:hidden}' +
    '.nav-left>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.nav-num{font-family:"Cascadia Mono",Consolas,monospace;font-size:10.5px;opacity:.75;flex-shrink:0}' +
    '.nav-item.is-active .nav-num{color:var(--primary);opacity:1;font-weight:800}' +
    '.nav-tag{font-family:"Cascadia Mono",Consolas,monospace;font-size:10px;padding:1px 6px;border-radius:4px;background:var(--surface-2);color:var(--fg-muted);border:1px solid var(--border);flex-shrink:0}' +
    '.nav-item.is-active .nav-tag{background:var(--primary);color:var(--primary-fg);border-color:var(--primary);font-weight:700}' +
    '.palette-box{padding:10px;border-radius:var(--r-md);background:var(--surface-2);border:1px solid var(--border);display:flex;flex-direction:column;gap:8px}' +
    '.palette-head{display:flex;align-items:center;justify-content:space-between;font-family:"Cascadia Mono",Consolas,monospace;font-size:10px;letter-spacing:.08em;color:var(--fg-muted)}' +
    '.swatch-row{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}' +
    '.swatch{height:28px;border-radius:5px;border:1px solid var(--border-strong);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .1s,border-color .12s}' +
    '.swatch:hover{transform:translateY(-1px)}' +
    '.swatch.is-active{border:2px solid var(--fg)}' +
    '.swatch-dot{width:10px;height:10px;border-radius:50%}' +
    '.desk{display:flex;flex-direction:column;min-width:0;height:100vh}' +
    '.hdr{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 22px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0}' +
    '.hdr-left{display:flex;flex-direction:column;gap:1px;min-width:0}' +
    '.top-crumb{font-family:"Cascadia Mono",Consolas,monospace;font-size:10px;color:var(--primary);letter-spacing:.08em;text-transform:uppercase}' +
    '.top-title{font-family:"Bahnschrift","Segoe UI Variable Display","Segoe UI",sans-serif;font-size:16.5px;font-weight:700;margin:0}' +
    '.hdr-right{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;min-width:0}' +
    '.hdr-ctrls{display:inline-flex;align-items:center;gap:8px;min-width:0}' +
    '.ui-lang-wrap{display:inline-flex;align-items:center;gap:7px;min-width:0}' +
    '.ui-lang-lbl{font-size:11.5px;font-weight:600;color:var(--fg-muted);white-space:nowrap}' +
    '.ui-lang-sel{height:34px;min-width:0;padding:0 10px;font-size:12px;font-weight:500;font-family:inherit;color:var(--fg);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:5px;cursor:pointer;outline:none;max-width:200px}' +
    '.hui-select-native{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;pointer-events:none!important}' +
    '.hui-select{position:relative;display:inline-flex;min-width:0}' +
    '.hui-select--full{display:flex;width:100%}' +
    '.hui-select__trigger{position:relative;isolation:isolate;display:inline-flex;align-items:center;justify-content:space-between;gap:8px;min-height:34px;padding:0 30px 0 10px;border-radius:5px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--fg);font:inherit;font-size:12px;font-weight:600;line-height:1.25;text-align:start;cursor:pointer;outline:none;user-select:none;transition:background-color .14s,border-color .14s}' +
    '.hui-select--full .hui-select__trigger{width:100%;min-height:36px;font-size:12.5px}' +
    '.hui-select--compact .hui-select__trigger{min-width:146px;max-width:206px}' +
    '.hui-select__trigger:hover{background:var(--surface-hover);border-color:var(--primary)}' +
    '.hui-select__trigger[aria-expanded="true"],.hui-select__trigger:focus-visible{border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-ring);outline:none}' +
    '.hui-select__value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.hui-select__indicator{position:absolute;inset-block:0;inset-inline-end:8px;margin:auto 0;width:15px;height:15px;display:inline-flex;align-items:center;justify-content:center;color:var(--fg-muted);pointer-events:none;transition:transform .16s,color .15s}' +
    '.hui-select__trigger[aria-expanded="true"] .hui-select__indicator{transform:rotate(180deg);color:var(--primary)}' +
    '.hui-select__popover{position:fixed;z-index:9999;box-sizing:border-box;border-radius:6px;background:var(--surface);border:1px solid var(--border-strong);box-shadow:var(--shadow-md);padding:5px;overflow-y:auto;overscroll-behavior:contain;max-height:min(308px,48vh);scrollbar-width:thin;opacity:0;transform:translateY(-4px) scale(.97);transform-origin:top center;transition:opacity .14s,transform .14s}' +
    '.hui-select__popover[data-placement="top"]{transform:translateY(4px) scale(.97);transform-origin:bottom center}' +
    '.hui-select__popover.is-open{opacity:1;transform:translateY(0) scale(1)}' +
    '.hui-listbox{display:flex;flex-direction:column;gap:2px;outline:none}' +
    '.hui-option{position:relative;display:flex;align-items:center;gap:8px;width:100%;padding:7px 30px 7px 9px;border:0;border-radius:4px;background:transparent;color:var(--fg);font:inherit;font-size:12.5px;font-weight:500;line-height:1.3;text-align:start;cursor:pointer;outline:none;user-select:none;transition:background-color .1s,color .1s}' +
    '.hui-option:hover,.hui-option.is-active{background:var(--surface-2)}' +
    '.hui-option[aria-selected="true"]{background:var(--primary-soft);color:var(--primary);font-weight:700}' +
    '.hui-option__label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.hui-option__check{position:absolute;inset-block:0;inset-inline-end:8px;margin:auto 0;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;color:var(--primary);opacity:0}' +
    '.hui-option[aria-selected="true"] .hui-option__check{opacity:1}' +
    '.icon-btn{width:34px;height:34px;padding:0;border-radius:5px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--fg-muted);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:border-color .14s,color .14s}' +
    '.icon-btn:hover{border-color:var(--primary);color:var(--primary)}' +
    '.upd-bar{background:var(--surface-2);border:1px solid var(--border);border-radius:5px;padding:5px 10px;min-height:34px;display:flex;flex-direction:column;justify-content:center;gap:5px;max-width:100%}' +
    '.upd-bar.is-avail,.upd-bar.is-busy{border-color:var(--primary)}' +
    '.upd-bar.is-done{border-color:var(--ok)}' +
    '.upd-bar.is-err{border-color:var(--danger)}' +
    '.upd-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}' +
    '.upd-left{display:flex;align-items:center;gap:7px;min-width:0;font-family:"Cascadia Mono",Consolas,monospace;font-size:11px;color:var(--fg)}' +
    '.upd-dot{width:7px;height:7px;border-radius:50%;background:var(--fg-muted);flex-shrink:0}' +
    '.upd-bar.is-ok .upd-dot,.upd-bar.is-done .upd-dot{background:var(--ok)}' +
    '.upd-bar.is-avail .upd-dot,.upd-bar.is-busy .upd-dot{background:var(--primary);box-shadow:0 0 6px var(--primary)}' +
    '.upd-bar.is-err .upd-dot{background:var(--danger)}' +
    '.upd-msg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.upd-act{display:flex;align-items:center;gap:6px;flex-shrink:0}' +
    '.upd-pct{font-family:"Cascadia Mono",Consolas,monospace;font-size:11px;font-weight:700;color:var(--primary)}' +
    '.upd-bar.is-done .upd-pct{color:var(--ok)}' +
    '.upd-btn{height:24px;padding:0 9px;font-size:11px;font-weight:700;font-family:inherit;border-radius:4px;border:1px solid transparent;cursor:pointer;display:inline-flex;align-items:center;gap:5px;text-decoration:none}' +
    '.upd-btn-primary{background:var(--primary);color:var(--primary-fg)}' +
    '.upd-btn-primary:hover{background:var(--primary-hover)}' +
    '.upd-btn-primary:disabled{opacity:.55;cursor:default}' +
    '.upd-btn-ghost{background:var(--surface);color:var(--fg);border-color:var(--border-strong)}' +
    '.upd-auto{display:inline-flex;align-items:center;gap:5px;cursor:pointer;user-select:none;font-size:11px;font-weight:600;color:var(--fg-muted);padding:2px 7px;border-radius:4px;border:1px solid var(--border);background:var(--surface)}' +
    '.upd-auto .switch-track{width:26px;height:15px}' +
    '.upd-auto .switch-thumb{width:9px;height:9px;top:2px;left:2px}' +
    '.upd-auto input:checked + .switch-track .switch-thumb{transform:translateX(11px)}' +
    'html[dir="rtl"] .upd-auto .switch-thumb{left:auto;right:2px}' +
    'html[dir="rtl"] .upd-auto input:checked + .switch-track .switch-thumb{transform:translateX(-11px)}' +
    '.upd-track{width:100%;height:4px;background:var(--surface);border-radius:2px;overflow:hidden}' +
    '.upd-fill{height:100%;width:0%;background:var(--primary);transition:width .35s ease}' +
    '.upd-bar.is-done .upd-fill{background:var(--ok)}' +
    '.upd-bar.is-err .upd-fill{background:var(--danger)}' +
    '.sec-nav{display:none;align-items:center;gap:6px;padding:8px 14px;background:var(--surface);border-bottom:1px solid var(--border);overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;flex-shrink:0}' +
    '.sec-nav::-webkit-scrollbar{display:none}' +
    '.sec-pill{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border-radius:5px;background:var(--surface-2);border:1px solid var(--border);color:var(--fg-muted);font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0}' +
    '.sec-pill.is-active{background:var(--fg);border-color:var(--fg);color:var(--bg)}' +
    '.stage{flex:1;overflow-y:auto;padding:18px 22px 26px}' +
    '.view{display:none;flex-direction:column;gap:14px;max-width:1060px}' +
    '.view.is-active{display:flex}' +
    '.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}' +
    '.metric-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:11px 13px;display:flex;flex-direction:column;gap:3px}' +
    '.metric-k{font-family:"Cascadia Mono",Consolas,monospace;font-size:10px;color:var(--fg-muted);letter-spacing:.08em;text-transform:uppercase}' +
    '.metric-v{font-family:"Bahnschrift","Segoe UI Variable Display","Segoe UI",sans-serif;font-size:20px;font-weight:700;color:var(--fg)}' +
    '.metric-s{font-family:"Cascadia Mono",Consolas,monospace;font-size:10.5px;color:var(--primary)}' +
    '.grid-inst{display:grid;grid-template-columns:minmax(0,1.28fr) minmax(0,.92fr);gap:14px;align-items:start}' +
    '.side-stack{display:flex;flex-direction:column;gap:14px;min-width:0}' +
    '.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--shadow-sm);overflow:hidden}' +
    '.panel-body,.setting-block,.lim-ctrls,.repo-group{min-width:0}' +
    '.panel-install{background:var(--inst-bg);border-color:var(--inst-border);box-shadow:var(--shadow-md)}' +
    '.panel-install .panel-head{background:var(--inst-head);border-bottom-color:var(--inst-border)}' +
    '.panel-install .panel-ico,.panel-install .seg,.panel-install .preview-box,.panel-install .url-row,.panel-install .btn-flat{background:var(--inst-inner);border-color:var(--inst-inner-border)}' +
    '.panel-install .seg button.is-active{background:var(--fg);color:var(--bg)}' +
    '.panel-install .p-chip{background:var(--inst-bg);border-color:var(--inst-inner-border)}' +
    '.panel-install .btn-flat:hover{border-color:var(--primary);color:var(--primary)}' +
    '.panel-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:1px dashed var(--border);background:var(--surface)}' +
    '.panel-title-wrap{display:inline-flex;align-items:center;gap:9px;min-width:0}' +
    '.panel-ico{width:25px;height:25px;border-radius:5px;background:var(--surface-2);border:1px solid var(--border);color:var(--primary);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}' +
    '.panel-title{font-family:"Bahnschrift","Segoe UI Variable Display","Segoe UI",sans-serif;font-size:13.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--fg)}' +
    '.panel-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
    '.count{font-family:"Cascadia Mono",Consolas,monospace;font-size:11px;font-weight:600;color:var(--fg-muted);background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:3px 8px;white-space:nowrap}' +
    '.count.is-plain{background:transparent;border:0;padding:0;font-weight:500;font-family:inherit}' +
    '.link-btn{background:var(--surface-2);border:1px solid var(--border-strong);border-radius:4px;padding:4px 9px;font-size:11.5px;font-weight:600;color:var(--fg);cursor:pointer;font-family:inherit;transition:border-color .12s,background .12s,color .12s;white-space:nowrap}' +
    '.link-btn:hover{border-color:var(--primary);color:var(--primary);background:var(--primary-soft)}' +
    '.link-btn.is-active{background:var(--primary-soft);border-color:var(--primary);color:var(--primary)}' +
    '.panel-body{padding:15px 16px}' +
    '.svc-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:5px;background:var(--surface-2);border:1px solid var(--border);font-size:12px}' +
    '.svc-port{font-family:"Cascadia Mono",Consolas,monospace;font-size:11px;color:var(--fg-muted)}' +
    '.svc-ok{font-family:"Cascadia Mono",Consolas,monospace;font-size:10.5px;font-weight:700;color:var(--ok);background:var(--ok-soft);padding:2px 7px;border-radius:4px}' +
    '.lang-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}' +
    '.search-wrap{position:relative;flex:1;min-width:190px;display:flex;align-items:center}' +
    '.search-ico{position:absolute;inset-inline-start:11px;color:var(--fg-muted);pointer-events:none;display:inline-flex}' +
    '.search-inp{width:100%;height:36px;padding:0 32px 0 34px;border-radius:5px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--fg);font:inherit;font-size:12.5px;outline:none}' +
    'html[dir="rtl"] .search-inp{padding:0 34px 0 32px}' +
    '.search-inp:focus{border-color:var(--primary);background:var(--surface)}' +
    '.search-clr{position:absolute;inset-inline-end:6px;width:24px;height:24px;border:0;border-radius:4px;background:transparent;color:var(--fg-muted);font-size:15px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}' +
    '.search-clr:hover{background:var(--surface-hover);color:var(--fg)}' +
    '.lang-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:8px;align-content:start;max-height:420px;overflow-y:auto;overflow-x:hidden;padding-inline-end:6px}' +
    '.lang-empty{grid-column:1/-1;padding:18px 12px;text-align:center;font-size:12.5px;color:var(--fg-muted);background:var(--surface-2);border:1px dashed var(--border-strong);border-radius:5px}' +
    '.qual-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}' +
    '.qual-item{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:5px;cursor:pointer;transition:background .12s,border-color .12s;user-select:none}' +
    '.qual-item,.lang-item,.qlim-card{min-width:0}' +
    '.qual-item:hover{background:var(--surface-hover);border-color:var(--border-strong)}' +
    '.qual-item.is-selected{background:var(--primary-soft);border-color:var(--primary)}' +
    '.qual-item.is-selected .chk{background:var(--primary);border-color:var(--primary);color:var(--primary-fg)}' +
    '.qual-meta{display:flex;flex-direction:column;min-width:0;gap:1px}' +
    '.qual-name{font-family:"Bahnschrift",sans-serif;font-size:14px;font-weight:700;color:var(--fg)}' +
    '.qual-sub{font-family:"Cascadia Mono",Consolas,monospace;font-size:10.5px;color:var(--fg-muted)}' +
    '.sr{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}' +
    '.lang-item{position:relative;display:flex;align-items:center;gap:10px;padding:9px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:5px;cursor:pointer;transition:background .12s,border-color .12s;user-select:none}' +
    '.lang-item:hover{background:var(--surface-hover);border-color:var(--border-strong)}' +
    '.lang-item.is-selected{background:var(--primary-soft);border-color:var(--primary)}' +
    '.flag{display:inline-flex;flex-shrink:0;border-radius:3px;overflow:hidden;box-shadow:0 0 0 1px var(--flag-ring);line-height:0}' +
    '.flag svg{display:block}' +
    '.lang-meta{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}' +
    '.lang-name{font-size:12.5px;font-weight:600;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.lang-sub{font-family:"Cascadia Mono",Consolas,monospace;font-size:10px;color:var(--fg-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.chk{width:17px;height:17px;border-radius:4px;border:1.5px solid var(--border-strong);background:var(--surface);display:inline-flex;align-items:center;justify-content:center;color:transparent;flex-shrink:0}' +
    '.lang-item.is-selected .chk{background:var(--primary);border-color:var(--primary);color:var(--primary-fg)}' +
    '.ord-badge{min-width:19px;height:19px;padding:0 5px;border-radius:4px;background:var(--primary);color:var(--primary-fg);font-family:"Cascadia Mono",Consolas,monospace;font-size:10.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}' +
    '.hub-order-box{margin-top:10px;padding:12px 14px;background:var(--surface-2);border:1px solid var(--border);border-radius:5px}' +
    '.hub-order-lbl{font-size:11.5px;color:var(--fg-muted);margin-bottom:8px;display:block}' +
    '.hub-order-list{display:flex;flex-wrap:wrap;gap:6px}' +
    '.h-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border-radius:4px;font-family:"Cascadia Mono",Consolas,monospace;font-size:11.5px;font-weight:600;background:var(--surface);border:1px solid var(--border-strong);color:var(--fg);cursor:grab;user-select:none}' +
    '.h-chip:active{cursor:grabbing}' +
    '.h-chip.is-drag{opacity:.45;border-color:var(--primary)}' +
    '.h-chip.is-over{border-color:var(--primary);background:var(--primary-soft)}' +
    '.h-num{font-size:11px;font-weight:700;color:var(--primary)}' +
    '.sort-box{padding:13px;background:var(--surface-2);border:1px solid var(--border);border-radius:5px;margin-bottom:12px}' +
    '.sort-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}' +
    '.sort-list{display:flex;flex-wrap:wrap;gap:7px}' +
    '.s-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:4px;font-size:12px;font-weight:600;background:var(--surface);border:1px solid var(--primary);color:var(--fg);cursor:grab;user-select:none}' +
    '.s-chip.is-off{border-color:var(--border);opacity:.55}' +
    '.s-chip.is-drag{opacity:.4}' +
    '.s-chip.is-over{background:var(--primary-soft)}' +
    '.s-dir{border:1px solid var(--border-strong);border-radius:4px;background:var(--surface-2);color:var(--primary);font-family:"Cascadia Mono",Consolas,monospace;font-size:10.5px;font-weight:700;padding:2px 6px;cursor:pointer}' +
    '.s-on{border:0;border-radius:4px;background:transparent;color:var(--fg-muted);font-size:12px;cursor:pointer;padding:2px 4px}' +
    '.s-on:hover{color:var(--fg);background:var(--surface-2)}' +
    '.repo-groups{display:flex;flex-direction:column;gap:8px;max-height:560px;overflow-y:auto;overflow-x:hidden;padding-inline-end:4px}' +
    '.repo-group{border:1px solid var(--border);border-radius:5px;background:var(--surface-2);flex-shrink:0;overflow:hidden}' +
    '.repo-ghead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 13px;background:var(--surface);cursor:pointer;user-select:none}' +
    '.repo-ghead:hover{background:var(--surface-2)}' +
    '.repo-group.is-open .repo-ghead{border-bottom:1px dashed var(--border)}' +
    '.repo-gtog{display:inline-flex;align-items:center;gap:9px;background:none;border:0;padding:0;font-size:13px;font-weight:600;color:var(--fg);font-family:inherit;cursor:pointer;text-align:start;min-width:0;flex:1}' +
    '.repo-gtog-txt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.repo-chev{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;background:var(--surface-2);color:var(--fg-muted);flex-shrink:0;transition:transform .16s}' +
    'html[dir="rtl"] .repo-chev{transform:rotate(180deg)}' +
    '.repo-group.is-open .repo-chev{transform:rotate(90deg);color:var(--primary);background:var(--primary-soft)}' +
    '.repo-gact{display:inline-flex;align-items:center;gap:8px;flex-shrink:0}' +
    '.repo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;padding:10px;align-content:start;max-height:280px;overflow-y:auto}' +
    '.repo-wrap{display:flex;flex-direction:column;border:1px solid var(--primary);border-radius:5px;background:var(--primary-soft);overflow:hidden}' +
    '.repo-wrap.is-off{background:var(--surface);border-color:var(--border);opacity:.66}' +
    '.repo-wrap.is-off:hover{opacity:.9;border-color:var(--border-strong)}' +
    '.repo-card{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px;border:0;background:transparent;width:100%;cursor:pointer;text-align:start;font-family:inherit}' +
    '.repo-meta{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}' +
    '.repo-name{font-size:12.5px;font-weight:600;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.repo-card.is-off .repo-name{text-decoration:line-through;color:var(--fg-muted)}' +
    '.repo-sub{font-size:10.5px;color:var(--fg-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.rtog{position:relative;width:34px;height:19px;border-radius:var(--r-pill);background:var(--primary);flex-shrink:0}' +
    '.rtog::after{content:"";position:absolute;top:2.5px;left:17px;width:14px;height:14px;border-radius:var(--r-pill);background:var(--primary-fg);transition:left .15s}' +
    '.repo-card.is-off .rtog{background:var(--surface-3)}' +
    '.repo-card.is-off .rtog::after{left:3px;background:var(--fg-muted)}' +
    '.repo-foot{display:flex;align-items:center;justify-content:space-between;padding:5px 11px;border-top:1px dashed var(--border);background:var(--surface)}' +
    '.repo-exp{background:none;border:0;padding:0;font-size:11px;font-weight:600;color:var(--primary);cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:4px}' +
    '.repo-exp:hover{text-decoration:underline}' +
    '.src-drawer{border-top:1px dashed var(--border);background:var(--surface);padding:12px 13px}' +
    '.src-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}' +
    '.src-search{height:32px;padding:0 10px;font-size:12px;font-family:inherit;color:var(--fg);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:4px;outline:none;min-width:170px;flex:1;max-width:280px}' +
    '.src-search:focus{border-color:var(--primary)}' +
    '.src-chips{display:flex;flex-wrap:wrap;gap:6px;max-height:220px;overflow-y:auto;padding-inline-end:6px}' +
    '.src-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:4px;font-size:11.5px;font-weight:600;font-family:inherit;background:var(--primary-soft);border:1px solid var(--primary);color:var(--fg);cursor:pointer}' +
    '.src-chip.is-off{background:var(--surface-2);border-color:var(--border);color:var(--fg-muted);text-decoration:line-through;opacity:.68}' +
    '*{scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent}' +
    '.setting-stack{display:flex;flex-direction:column;gap:10px}' +
    '.setting-block{padding:12px 14px;background:var(--surface-2);border:1px solid var(--border);border-radius:5px;display:flex;flex-direction:column;gap:11px}' +
    '.ctrl-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 14px}' +
    '.divider{height:1px;border-top:1px dashed var(--border);margin:2px 0}' +
    '.field-grid{display:grid;grid-template-columns:1fr;gap:12px}' +
    '.field{display:flex;flex-direction:column;gap:6px}' +
    '.field-lbl{font-size:12px;font-weight:600;color:var(--fg-muted)}' +
    '.sel{width:100%;height:36px;padding:0 10px;font-size:12.5px;font-weight:500;font-family:inherit;color:var(--fg);background:var(--surface);border:1px solid var(--border-strong);border-radius:5px;cursor:pointer;outline:none}' +
    '.lim-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}' +
    '.lim-info{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}' +
    '.lim-title{font-size:13px;font-weight:600;color:var(--fg)}' +
    '.lim-hint{font-size:11.5px;color:var(--fg-muted);line-height:1.4}' +
    '.lim-ctrls{display:flex;flex-wrap:wrap;align-items:center;gap:8px}' +
    '.stepper{display:inline-flex;align-items:stretch;border:1px solid var(--border-strong);border-radius:5px;background:var(--surface);overflow:hidden}' +
    '.step-btn{width:28px;height:30px;border:0;background:transparent;color:var(--fg);font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;justify-content:center}' +
    '.step-btn:hover{background:var(--surface-hover)}' +
    '.num-inp{width:44px;height:30px;border:0;border-inline:1px solid var(--border);background:var(--surface);color:var(--fg);text-align:center;font-family:"Cascadia Mono",Consolas,monospace;font-size:12.5px;font-weight:700;outline:none;-moz-appearance:textfield}' +
    '.num-inp::-webkit-outer-spin-button,.num-inp::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}' +
    '.quick-chips{display:inline-flex;flex-wrap:wrap;gap:5px}' +
    '.qchip{height:30px;padding:0 9px;border-radius:4px;font-family:"Cascadia Mono",Consolas,monospace;font-size:11.5px;font-weight:600;background:var(--surface);color:var(--fg-muted);border:1px solid var(--border);cursor:pointer}' +
    '.qchip:hover{background:var(--surface-hover);color:var(--fg);border-color:var(--border-strong)}' +
    '.qchip.is-active{background:var(--primary-soft);border-color:var(--primary);color:var(--primary)}' +
    '.qlim-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}' +
    '.qlim-card{display:flex;flex-direction:column;gap:8px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:5px}' +
    '.qlim-card.is-off{opacity:.42;pointer-events:none}' +
    '.qlim-card .stepper{width:100%}' +
    '.qlim-card .num-inp{flex:1;width:0;min-width:28px}' +
    '.qlim-top{display:flex;align-items:baseline;justify-content:space-between;gap:4px}' +
    '.qlim-name{font-size:13px;font-weight:700;color:var(--fg)}' +
    '.qlim-sub{font-family:"Cascadia Mono",Consolas,monospace;font-size:10px;color:var(--fg-muted)}' +
    '.seg{display:inline-flex;border:1px solid var(--border);border-radius:5px;background:var(--surface-2);padding:3px;gap:3px}' +
    '.seg.seg-full{display:flex;width:100%}' +
    '.seg.seg-full button{flex:1;min-width:0;text-align:center}' +
    '.seg button{border:0;border-radius:4px;background:transparent;color:var(--fg-muted);padding:7px 9px;font-size:11.5px;line-height:1.25;font-weight:600;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit}' +
    '.seg button:hover{color:var(--fg)}' +
    '.seg button.is-active{background:var(--fg);color:var(--bg)}' +
    '.switch-wrap{display:inline-flex;align-items:center;gap:10px;cursor:pointer;user-select:none;font-size:13px;font-weight:600;color:var(--fg)}' +
    '.switch-track{position:relative;width:36px;height:20px;border-radius:var(--r-pill);background:var(--surface-3);border:1px solid var(--border-strong);transition:background .15s,border-color .15s;display:inline-block;flex-shrink:0}' +
    '.switch-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:var(--r-pill);background:var(--fg-muted);transition:transform .16s,background .15s}' +
    'input:checked + .switch-track{background:var(--primary);border-color:var(--primary)}' +
    'input:checked + .switch-track .switch-thumb{transform:translateX(16px);background:var(--primary-fg)}' +
    'html[dir="rtl"] .switch-thumb{left:auto;right:2px}' +
    'html[dir="rtl"] input:checked + .switch-track .switch-thumb{transform:translateX(-16px)}' +
    '.inst-stack{display:flex;flex-direction:column;gap:11px}' +
    '.preview-box{padding:10px 12px;border-radius:5px;background:var(--surface-2);border:1px solid var(--border);display:flex;flex-direction:column;gap:8px}' +
    '.preview-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}' +
    '.preview-lbl{font-size:11.5px;color:var(--fg-muted);line-height:1.35}' +
    '.preview-chips{display:flex;flex-wrap:wrap;gap:6px}' +
    '.p-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:4px;font-family:"Cascadia Mono",Consolas,monospace;font-size:11px;font-weight:600;background:var(--surface);border:1px solid var(--border);color:var(--fg)}' +
    '.inst-guide{padding:10px 12px;border-radius:5px;background:var(--surface-2);border:1px solid var(--border);border-inline-start:3px solid var(--primary);display:flex;flex-direction:column;gap:6px}' +
    '.inst-guide-title{font-size:11.5px;font-weight:700;color:var(--fg)}' +
    '.inst-guide-list{margin:0;padding-inline-start:16px;display:flex;flex-direction:column;gap:5px;font-size:11.5px;line-height:1.45;color:var(--fg-muted)}' +
    '.inst-guide-list code{font-family:"Cascadia Mono",Consolas,monospace;font-size:10.5px;padding:1px 5px;border-radius:3px;background:var(--code-bg);color:var(--fg);word-break:break-all}' +
    '.url-row{display:flex;align-items:stretch;border:1px solid var(--border);border-radius:5px;background:var(--code-bg);overflow:hidden}' +
    '.url-text{flex:1;padding:9px 11px;font-family:"Cascadia Mono",Consolas,monospace;font-size:11px;color:var(--code-fg);overflow-wrap:anywhere;word-break:normal;user-select:all;line-height:1.45;max-height:92px;overflow-y:auto}' +
    '.btn-row-sub{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}' +
    '.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 14px;border-radius:5px;font-size:12.5px;font-weight:700;font-family:inherit;cursor:pointer;text-decoration:none;border:1px solid transparent;transition:background .12s,border-color .12s,color .12s}' +
    '.btn-primary{background:var(--primary);color:var(--primary-fg);font-family:"Cascadia Mono",Consolas,monospace;letter-spacing:.02em}' +
    '.btn-primary:hover{background:var(--primary-hover)}' +
    '.btn-flat{background:var(--surface-2);color:var(--fg);border-color:var(--border-strong)}' +
    '.btn-flat:hover{border-color:var(--primary);color:var(--primary)}' +
    '.unsaved-dot{width:7px;height:7px;border-radius:50%;background:var(--warn);display:none;flex-shrink:0;box-shadow:0 0 6px var(--warn)}' +
    '.unsaved-dot.is-show{display:inline-block}' +
    '.status{font-family:"Cascadia Mono",Consolas,monospace;font-size:11.5px;color:var(--ok);font-weight:700}' +
    '.mv-btn{border:0;border-radius:4px;background:transparent;color:var(--fg-muted);cursor:pointer;padding:1px 4px;font-size:13px;line-height:1;font-family:inherit}' +
    '.mv-btn:hover{color:var(--primary);background:var(--surface-2)}' +
    '.mv-btn:disabled{opacity:.3;cursor:default}' +
    '.bl-form{display:grid;grid-template-columns:1fr 1fr 1.2fr auto;gap:8px;margin-bottom:12px}' +
    '.bl-inp{height:36px;padding:0 10px;border:1px solid var(--border-strong);border-radius:5px;background:var(--surface-2);color:var(--fg);font:inherit;font-size:12.5px;outline:none}' +
    '.bl-inp:focus{border-color:var(--primary);background:var(--surface)}' +
    '.bl-list{display:flex;flex-direction:column;gap:7px;max-height:360px;overflow-y:auto;padding-inline-end:4px}' +
    '.bl-item{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 11px;border:1px solid var(--border);border-radius:5px;background:var(--surface-2);font-size:12px}' +
    '.bl-meta{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}' +
    '.bl-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}' +
    '.bl-prov{font-weight:700;color:var(--fg)}' +
    '.bl-tag{font-family:"Cascadia Mono",Consolas,monospace;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;border:1px solid var(--border-strong);background:var(--surface);color:var(--fg-muted);text-transform:uppercase}' +
    '.bl-tag.is-auto{border-color:var(--warn);background:var(--warn-soft);color:var(--warn)}' +
    '.bl-tag.is-man{border-color:var(--primary);background:var(--primary-soft);color:var(--primary)}' +
    '.bl-sub{font-family:"Cascadia Mono",Consolas,monospace;font-size:10.5px;color:var(--fg-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.bl-del{height:27px;padding:0 10px;border:1px solid var(--border-strong);border-radius:4px;background:var(--surface);color:var(--fg);font:inherit;font-size:11.5px;font-weight:600;cursor:pointer;flex-shrink:0}' +
    '.bl-del:hover{border-color:var(--danger);color:var(--danger);background:var(--danger-soft)}' +
    '.don-card{padding:14px 16px;border-radius:var(--r-lg);border:1px solid var(--don-border);background:var(--don-bg);box-shadow:var(--shadow-sm)}' +
    '.don-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}' +
    '.don-title-wrap{display:flex;align-items:center;gap:10px;min-width:0}' +
    '.don-emblem{width:32px;height:32px;border-radius:5px;background:var(--surface-2);border:1px solid var(--border-strong);color:var(--primary);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}' +
    '.don-head-text{display:flex;flex-direction:column;gap:2px;min-width:0}' +
    '.don-title{font-family:"Bahnschrift",sans-serif;font-size:13px;font-weight:700;color:var(--fg);text-transform:uppercase;letter-spacing:.03em}' +
    '.don-desc{font-size:11.5px;color:var(--fg-muted);margin:0;line-height:1.4}' +
    '.don-status{font-family:"Cascadia Mono",Consolas,monospace;font-size:10.5px;font-weight:700;color:var(--ok);background:var(--ok-soft);border:1px solid var(--ok);border-radius:4px;padding:2px 8px;white-space:nowrap;opacity:0;transition:opacity .15s;flex-shrink:0}' +
    '.don-status.is-show{opacity:1}' +
    '.don-grid{display:grid;grid-template-columns:1fr;gap:8px}' +
    '.don-tile{display:flex;flex-direction:column;gap:7px;padding:10px;border-radius:5px;border:1px solid var(--don-tile-border);background:var(--don-tile-bg)}' +
    '.don-tile:hover{border-color:var(--primary)}' +
    '.don-tile-top{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
    '.don-coin{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:var(--fg)}' +
    '.don-dot{width:7px;height:7px;border-radius:50%}' +
    '.don-tile.is-xlayer .don-dot{background:var(--primary)}' +
    '.don-tile.is-tron .don-dot{background:var(--warn)}' +
    '.don-net-pill{font-family:"Cascadia Mono",Consolas,monospace;font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;background:var(--surface);color:var(--fg-muted);border:1px solid var(--border)}' +
    '.don-addr-box{padding:7px 9px;border-radius:4px;background:var(--code-bg);border:1px solid var(--border);font-family:"Cascadia Mono",Consolas,monospace;font-size:10.5px;color:var(--code-fg);word-break:break-all;user-select:all}' +
    '.don-copy{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:4px;border:1px solid var(--border-strong);background:var(--surface);color:var(--fg);font:inherit;font-size:11px;font-weight:600;cursor:pointer}' +
    '.don-copy:hover{border-color:var(--primary);color:var(--primary)}' +
    '.don-copy.is-done{background:var(--ok)!important;border-color:var(--ok)!important;color:#fff!important}' +
    '.dock{height:54px;flex-shrink:0;background:var(--surface);border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 22px}' +
    '.dock-l{display:flex;align-items:center;gap:10px;font-family:"Cascadia Mono",Consolas,monospace;font-size:11px;color:var(--fg-muted);min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}' +
    '.dock-r{display:flex;align-items:center;gap:8px;flex-shrink:0}' +
    '.hidden{display:none!important}' +
    '@media (max-width:959px){' +
      'html,body{height:auto;overflow:auto}' +
      '.shell{display:flex;flex-direction:column;height:auto;min-height:100vh}' +
      '.rack{display:none}' +
      '.desk{height:auto;min-height:100vh}' +
      '.sec-nav{display:flex}' +
      '.stage{overflow:visible;padding:14px 12px 84px}' +
      '.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}' +
      '.grid-inst{grid-template-columns:1fr}' +
      '.qual-grid,.qlim-grid{grid-template-columns:repeat(2,minmax(0,1fr))}' +
      '.bl-form{grid-template-columns:1fr}' +
      '.dock{position:fixed;left:0;right:0;bottom:0;z-index:50;padding:0 12px}' +
      '.dock-l{display:none}' +
      '.dock-r{width:100%;justify-content:flex-end}' +
    '}' +
    '</style></head><body><div class="shell">' +
    '<aside class="rack">' +
      '<div class="unit-hdr">' +
        '<div class="unit-brand">' +
          '<span class="led-logo" aria-hidden="true">L</span>' +
          '<div><h1>Lanettirr</h1><div class="unit-rev">MK-' + esc(appVersion) + ' // VOD HUB</div></div>' +
        '</div>' +
        '<span class="ver-pill" id="verPill">v' + esc(appVersion) + '</span>' +
      '</div>' +
      '<div class="telemetry-strip">' +
        '<span class="tally"><span class="tally-dot" id="liveDot"></span><span id="liveStatusTxt">ONLINE</span></span>' +
        '<span class="unit-rev" id="liveProvTxt">-- SRC</span>' +
      '</div>' +
      '<nav class="nav" id="rackNav" aria-label="Modules">' +
        '<div class="nav-sec">// MODULES</div>' +
        '<button type="button" class="nav-item is-active" data-tab="install"><span class="nav-left"><span class="nav-num">01</span><span data-i18n="tabInstall">' + esc(tr('tabInstall')) + '</span></span><span class="nav-tag" id="navInstTag">NUVIO</span></button>' +
        '<button type="button" class="nav-item" data-tab="langs"><span class="nav-left"><span class="nav-num">02</span><span data-i18n="tabLangs">' + esc(tr('tabLangs')) + '</span></span><span class="nav-tag" id="navLangTag">02</span></button>' +
        '<button type="button" class="nav-item" data-tab="repos"><span class="nav-left"><span class="nav-num">03</span><span data-i18n="tabRepos">' + esc(tr('tabRepos')) + '</span></span><span class="nav-tag" id="navRepoTag">--</span></button>' +
        '<button type="button" class="nav-item" data-tab="quals"><span class="nav-left"><span class="nav-num">04</span><span data-i18n="tabQuals">' + esc(tr('tabQuals')) + '</span></span><span class="nav-tag" id="navQualTag">03</span></button>' +
        '<button type="button" class="nav-item" data-tab="sort"><span class="nav-left"><span class="nav-num">05</span><span data-i18n="tabSort">' + esc(tr('tabSort')) + '</span></span><span class="nav-tag" id="navCatTag">ON</span></button>' +
        '<button type="button" class="nav-item" data-tab="blacklist"><span class="nav-left"><span class="nav-num">06</span><span data-i18n="tabBlacklist">' + esc(tr('tabBlacklist')) + '</span></span><span class="nav-tag" id="navBlTag">0</span></button>' +
      '</nav>' +
      '<div class="palette-box">' +
        '<div class="palette-head"><span data-i18n="paletteLbl">' + esc(tr('paletteLbl')) + '</span><span id="paletteName">SIGNAL</span></div>' +
        '<div class="swatch-row" id="swatchRow"></div>' +
      '</div>' +
    '</aside>' +
    '<div class="desk">' +
      '<header class="hdr">' +
        '<div class="hdr-left">' +
          '<span class="top-crumb" id="topCrumb">01 // ' + esc(tr('tabInstall')) + '</span>' +
          '<div class="top-title" id="topTitle" data-i18n="tabInstall">' + esc(tr('tabInstall')) + '</div>' +
        '</div>' +
        '<div class="hdr-right">' +
          '<div class="upd-bar" id="updBar">' +
            '<div class="upd-top">' +
              '<div class="upd-left"><span class="upd-dot"></span><span class="upd-msg" id="updMsg">' + esc(tr('updChecking')) + '</span></div>' +
              '<div class="upd-act">' +
                '<span class="upd-pct hidden" id="updPct">0%</span>' +
                '<label class="upd-auto" id="updAutoWrap"><input class="sr" type="checkbox" id="updAutoToggle" checked /><span class="switch-track"><span class="switch-thumb"></span></span><span data-i18n="updAutoLabel">' + esc(tr('updAutoLabel')) + '</span></label>' +
                '<button type="button" class="link-btn hidden" id="updCheckBtn" data-i18n="updCheckBtn">' + esc(tr('updCheckBtn')) + '</button>' +
                '<button type="button" class="upd-btn upd-btn-primary hidden" id="updNowBtn" data-i18n="updNowBtn">' + esc(tr('updNowBtn')) + '</button>' +
                '<a class="upd-btn upd-btn-ghost hidden" id="updManualBtn" href="https://github.com/0mamiis/lanettirr" target="_blank" rel="noopener" data-i18n="updManualBtn">' + esc(tr('updManualBtn')) + '</a>' +
                '<button type="button" class="upd-btn upd-btn-ghost hidden" id="updReloadBtn" data-i18n="updReloadBtn">' + esc(tr('updReloadBtn')) + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="upd-track hidden" id="updTrack"><div class="upd-fill" id="updFill"></div></div>' +
          '</div>' +
          '<div class="hdr-ctrls">' +
            '<div class="ui-lang-wrap">' +
              '<label class="ui-lang-lbl" for="uiLangSel_trigger" data-i18n="uiLangLabel">' + esc(tr('uiLangLabel')) + '</label>' +
              '<select class="ui-lang-sel" id="uiLangSel" data-i18n-aria="uiLangLabel" aria-label="' + esc(tr('uiLangLabel')) + '">' + uiLangOptions + '</select>' +
            '</div>' +
            '<button type="button" class="icon-btn" id="themeBtn" aria-label="Palette" title="Palette"></button>' +
          '</div>' +
        '</div>' +
      '</header>' +
      '<nav class="sec-nav" id="secNav" aria-label="Sections">' +
        '<button type="button" class="sec-pill is-active" data-tab="install" data-i18n="tabInstall">' + esc(tr('tabInstall')) + '</button>' +
        '<button type="button" class="sec-pill" data-tab="langs" data-i18n="tabLangs">' + esc(tr('tabLangs')) + '</button>' +
        '<button type="button" class="sec-pill" data-tab="repos" data-i18n="tabRepos">' + esc(tr('tabRepos')) + '</button>' +
        '<button type="button" class="sec-pill" data-tab="quals" data-i18n="tabQuals">' + esc(tr('tabQuals')) + '</button>' +
        '<button type="button" class="sec-pill" data-tab="sort" data-i18n="tabSort">' + esc(tr('tabSort')) + '</button>' +
        '<button type="button" class="sec-pill" data-tab="blacklist" data-i18n="tabBlacklist">' + esc(tr('tabBlacklist')) + '</button>' +
      '</nav>' +
      '<main class="stage">' +
        '<!-- 01 INSTALL & STATUS -->' +
        '<section class="view is-active" data-view="install">' +
          '<div class="metrics">' +
            '<div class="metric-card"><span class="metric-k" data-i18n="statHubsLbl">' + esc(tr('statHubsLbl')) + '</span><span class="metric-v" id="statLangs">TR + EN</span><span class="metric-s" id="statLangSub">2 Hub</span></div>' +
            '<div class="metric-card"><span class="metric-k" data-i18n="statCatalogLbl">' + esc(tr('statCatalogLbl')) + '</span><span class="metric-v" id="statCatalog">10</span><span class="metric-s" id="statCatSub">TMDB + META</span></div>' +
            '<div class="metric-card"><span class="metric-k" data-i18n="statQualLbl">' + esc(tr('statQualLbl')) + '</span><span class="metric-v" id="statQuals">4K</span><span class="metric-s" id="statQualSub">ffprobe</span></div>' +
            '<div class="metric-card"><span class="metric-k" data-i18n="statProvsLbl">' + esc(tr('statProvsLbl')) + '</span><span class="metric-v" id="statProvs">--</span><span class="metric-s" id="statProvsSub">LIVE</span></div>' +
          '</div>' +
          '<div class="grid-inst">' +
            '<section class="panel panel-install" id="sec-install">' +
              '<div class="panel-head">' +
                '<div class="panel-title-wrap">' +
                  '<span class="panel-ico" aria-hidden="true"><svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 10.5l3-3"/><path d="M9.5 6.5l1.8-1.8a2.5 2.5 0 0 1 3.5 3.5L13 10"/><path d="M8.5 11.5l-1.8 1.8a2.5 2.5 0 0 1-3.5-3.5L5 8"/></svg></span>' +
                  '<span class="panel-title" data-i18n="secInstall">' + esc(tr('secInstall')) + '</span>' +
                '</div>' +
              '</div>' +
              '<div class="panel-body">' +
                '<div class="inst-stack">' +
                  '<div class="seg seg-full" role="group" data-i18n-aria="installTypeAria" aria-label="' + esc(tr('installTypeAria')) + '">' +
                    '<button type="button" data-install="nuvio" class="is-active" data-i18n="instNuvio">' + esc(tr('instNuvio')) + '</button>' +
                    '<button type="button" data-install="aio" data-i18n="instAio">' + esc(tr('instAio')) + '</button>' +
                    '<button type="button" data-install="cs3" data-i18n="instCs3">' + esc(tr('instCs3')) + '</button>' +
                  '</div>' +
                  '<div class="preview-box">' +
                    '<div class="preview-head"><span class="preview-lbl" id="previewHint"></span></div>' +
                    '<div class="preview-chips" id="previewChips"></div>' +
                  '</div>' +
                  '<div class="seg seg-full" role="group" data-i18n-aria="linkTypeAria" aria-label="' + esc(tr('linkTypeAria')) + '">' +
                    '<button type="button" data-linkmode="saved" class="is-active" data-i18n="linkSaved">' + esc(tr('linkSaved')) + '</button>' +
                    '<button type="button" data-linkmode="inline" data-i18n="linkInline">' + esc(tr('linkInline')) + '</button>' +
                  '</div>' +
                  '<div class="url-row"><div class="url-text" id="out"></div></div>' +
                  '<div class="inst-guide" id="installGuideBox">' +
                    '<div class="inst-guide-title" id="installGuideTitle" data-i18n="instGuideTitle">' + esc(tr('instGuideTitle')) + '</div>' +
                    '<ul class="inst-guide-list" id="installGuideList"></ul>' +
                  '</div>' +
                  '<div class="btn-row-sub">' +
                    '<button class="btn btn-flat" id="copyBtn" type="button">' +
                      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1h2.5"/></svg>' +
                      '<span data-i18n="copyBtn">' + esc(tr('copyBtn')) + '</span>' +
                    '</button>' +
                    '<a class="btn btn-flat hidden" id="stremioBtn" href="#">' +
                      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5H3.5v9h9v-3"/><path d="M9.5 2.5h4v4"/><path d="M13.5 2.5L7.5 8.5"/></svg>' +
                      '<span id="stremioBtnLbl" data-i18n="stremioBtn">' + esc(tr('stremioBtn')) + '</span>' +
                    '</a>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</section>' +
            '<div class="side-stack">' +
              '<section class="panel">' +
                '<div class="panel-head">' +
                  '<div class="panel-title-wrap"><span class="panel-title">ENDPOINTS // PORT</span></div>' +
                  '<span class="svc-ok" id="healthStateBadge">CHECKING</span>' +
                '</div>' +
                '<div class="panel-body" style="display:flex;flex-direction:column;gap:7px">' +
                  '<div class="svc-row"><span>Nuvio Addons (Catalog+Stream)</span><span class="svc-port">/saved/manifest.json</span></div>' +
                  '<div class="svc-row"><span>Nuvio Plugins (Stream)</span><span class="svc-port">/saved/nuvio-repo/manifest.json</span></div>' +
                  '<div class="svc-row"><span>Nuvio Badges</span><span class="svc-port">/badges.json</span></div>' +
                  '<div class="svc-row"><span>CloudStream (CS3)</span><span class="svc-port">/saved/cs3/repo.json</span></div>' +
                '</div>' +
              '</section>' +
              '<section class="don-card">' +
                '<div class="don-head">' +
                  '<div class="don-title-wrap">' +
                    '<span class="don-emblem" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12"/><path d="M12 7v11"/><ellipse cx="12" cy="12.2" rx="6.5" ry="2.2"/></svg></span>' +
                    '<div class="don-head-text"><span class="don-title" data-i18n="secDonate">' + esc(tr('secDonate')) + '</span><p class="don-desc" data-i18n="donateDesc">' + esc(tr('donateDesc')) + '</p></div>' +
                  '</div>' +
                  '<span class="don-status" id="donStatus"></span>' +
                '</div>' +
                '<div class="don-grid">' +
                  '<div class="don-tile is-xlayer"><div class="don-tile-top"><span class="don-coin"><span class="don-dot"></span>USDT</span><span class="don-net-pill">X Layer</span></div><div class="don-addr-box">XKOde2f6fbcdace36d5ceebdf545e992d3036269259</div><button type="button" class="don-copy" data-don-addr="XKOde2f6fbcdace36d5ceebdf545e992d3036269259"><span data-i18n="copyBtn">' + esc(tr('copyBtn')) + '</span></button></div>' +
                  '<div class="don-tile is-tron"><div class="don-tile-top"><span class="don-coin"><span class="don-dot"></span>USDT</span><span class="don-net-pill">Tron · TRC20</span></div><div class="don-addr-box">TNxCAUc1EJvRvAmEAVK5iAKrJBXp6MuJsA</div><button type="button" class="don-copy" data-don-addr="TNxCAUc1EJvRvAmEAVK5iAKrJBXp6MuJsA"><span data-i18n="copyBtn">' + esc(tr('copyBtn')) + '</span></button></div>' +
                '</div>' +
              '</section>' +
            '</div>' +
          '</div>' +
        '</section>' +
        '<!-- 02 LANGUAGES -->' +
        '<section class="view" data-view="langs">' +
          '<section class="panel" id="sec-langs">' +
            '<div class="panel-head">' +
              '<div class="panel-title-wrap"><span class="panel-ico" aria-hidden="true"><svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="7"/><path d="M2.5 9h13"/><path d="M9 2a10.5 10.5 0 0 1 0 14a10.5 10.5 0 0 1 0-14z"/></svg></span><span class="panel-title" data-i18n="secLangs">' + esc(tr('secLangs')) + '</span></div>' +
              '<div class="panel-actions"><span class="count" id="selCount"></span><button class="link-btn" id="presetTrEn" type="button">TR + EN</button><button class="link-btn" id="clearBtn" type="button" data-i18n="clear">' + esc(tr('clear')) + '</button></div>' +
            '</div>' +
            '<div class="panel-body">' +
              '<div class="lang-toolbar">' +
                '<div class="search-wrap"><span class="search-ico" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="7" cy="7" r="4.8"/><path d="M10.8 10.8L14 14"/></svg></span><input type="text" class="search-inp" id="langSearch" placeholder="' + esc(trf('srcSearchPh', { name: tr('secLangs') })) + '" /><button type="button" class="search-clr hidden" id="langSearchClear" aria-label="Clear">×</button></div>' +
                '<button type="button" class="link-btn" id="langOnlySel">✓</button>' +
              '</div>' +
              '<div class="lang-grid" id="langs">' + cards + '</div>' +
            '</div>' +
          '</section>' +
        '</section>' +
        '<!-- 03 REPOS -->' +
        '<section class="view" data-view="repos">' +
          '<section class="panel" id="reposPanel">' +
            '<div class="panel-head">' +
              '<div class="panel-title-wrap"><span class="panel-ico" aria-hidden="true"><svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5L2.5 6l6.5 3.5L15.5 6 9 2.5z"/><path d="M2.5 9.5L9 13l6.5-3.5"/><path d="M2.5 13L9 16.5l6.5-3.5"/></svg></span><span class="panel-title" data-i18n="secRepos">' + esc(tr('secRepos')) + '</span></div>' +
              '<div class="panel-actions"><span class="count" id="repoCount"></span><button class="link-btn" id="reposAllOn" type="button" data-i18n="allOn">' + esc(tr('allOn')) + '</button><button class="link-btn" id="reposAllOff" type="button" data-i18n="allOff">' + esc(tr('allOff')) + '</button></div>' +
            '</div>' +
            '<div class="panel-body"><div class="repo-groups" id="repoGroups"></div></div>' +
          '</section>' +
        '</section>' +
        '<!-- 04 QUALS & LIMITS -->' +
        '<section class="view" data-view="quals">' +
          '<section class="panel" id="sec-quals">' +
            '<div class="panel-head">' +
              '<div class="panel-title-wrap"><span class="panel-ico" aria-hidden="true"><svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="13" height="10" rx="2"/><path d="M6.5 16h5"/><path d="M9 13.5V16"/></svg></span><span class="panel-title" data-i18n="secQuals">' + esc(tr('secQuals')) + '</span></div>' +
              '<div class="panel-actions"><span class="count" id="qualCount"></span><button class="link-btn" id="qAll" type="button" data-i18n="qAll">' + esc(tr('qAll')) + '</button><button class="link-btn" id="qNo4k" type="button" data-i18n="qNo4k">' + esc(tr('qNo4k')) + '</button><button class="link-btn" id="q1080" type="button">1080p+</button></div>' +
            '</div>' +
            '<div class="panel-body"><div class="qual-grid" id="quals">' + qualCards + '</div></div>' +
          '</section>' +
          '<section class="panel" id="sec-limits">' +
            '<div class="panel-head">' +
              '<div class="panel-title-wrap"><span class="panel-ico" aria-hidden="true"><svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h12"/><circle cx="7" cy="5" r="1.8" fill="var(--surface)"/><path d="M3 9h12"/><circle cx="12" cy="9" r="1.8" fill="var(--surface)"/><path d="M3 13h12"/><circle cx="6" cy="13" r="1.8" fill="var(--surface)"/></svg></span><span class="panel-title" data-i18n="secLimits">' + esc(tr('secLimits')) + '</span></div>' +
              '<label class="switch-wrap"><input class="sr" type="checkbox" id="qlimAllToggle" ' + (qlimMode === 'all' ? 'checked' : '') + ' /><span class="switch-track"><span class="switch-thumb"></span></span><span data-i18n="qlimSingleToggle">' + esc(tr('qlimSingleToggle')) + '</span></label>' +
            '</div>' +
            '<div class="panel-body"><div class="setting-stack">' +
              '<div id="qlimAllBox" class="setting-block' + (qlimMode === 'per' ? ' hidden' : '') + '"><div class="lim-row"><div class="lim-info"><span class="lim-title" data-i18n="qlimAllTitle">' + esc(tr('qlimAllTitle')) + '</span><span class="lim-hint" data-i18n="qlimAllHint">' + esc(tr('qlimAllHint')) + '</span></div><div class="lim-ctrls"><div class="quick-chips" data-qgroup="qlimAll"><button type="button" class="qchip" data-val="1">1</button><button type="button" class="qchip" data-val="2">2</button><button type="button" class="qchip" data-val="3">3</button><button type="button" class="qchip" data-val="5">5</button><button type="button" class="qchip" data-val="0" data-i18n="unlimited">' + esc(tr('unlimited')) + '</button></div><div class="stepper"><button type="button" class="step-btn" data-step="-1" data-target="qlimAllInp" data-i18n-aria="decrease" aria-label="' + esc(tr('decrease')) + '">-</button><input type="number" min="0" max="50" class="num-inp" id="qlimAllInp" value="' + esc(qlimAll) + '" /><button type="button" class="step-btn" data-step="1" data-target="qlimAllInp" data-i18n-aria="increase" aria-label="' + esc(tr('increase')) + '">+</button></div></div></div></div>' +
              '<div id="qlimPerBox" class="setting-block' + (qlimMode === 'all' ? ' hidden' : '') + '"><div class="lim-info"><span class="lim-title" data-i18n="qlimPerTitle">' + esc(tr('qlimPerTitle')) + '</span><span class="lim-hint" data-i18n="qlimPerHint">' + esc(tr('qlimPerHint')) + '</span></div><div class="qlim-grid">' + perQualLimitCards + '</div></div>' +
              '<div class="setting-block"><div class="lim-row"><div class="lim-info"><span class="lim-title" data-i18n="hubLimTitle">' + esc(tr('hubLimTitle')) + '</span><span class="lim-hint" data-i18n="hubLimHint">' + esc(tr('hubLimHint')) + '</span></div><div class="lim-ctrls"><div class="quick-chips" data-qgroup="hubLim"><button type="button" class="qchip" data-val="0" data-i18n="unlimited">' + esc(tr('unlimited')) + '</button><button type="button" class="qchip" data-val="5">5</button><button type="button" class="qchip" data-val="10">10</button><button type="button" class="qchip" data-val="15">15</button><button type="button" class="qchip" data-val="20">20</button></div><div class="stepper"><button type="button" class="step-btn" data-step="-1" data-target="hubLimInp" data-i18n-aria="decrease" aria-label="' + esc(tr('decrease')) + '">-</button><input type="number" min="0" max="200" class="num-inp" id="hubLimInp" value="' + esc(hubLim) + '" /><button type="button" class="step-btn" data-step="1" data-target="hubLimInp" data-i18n-aria="increase" aria-label="' + esc(tr('increase')) + '">+</button></div></div></div></div>' +
            '</div></div>' +
          '</section>' +
        '</section>' +
        '<!-- 05 SORT, FAILOVER & CATALOG -->' +
        '<section class="view" data-view="sort">' +
          '<section class="panel" id="sec-sort">' +
            '<div class="panel-head"><div class="panel-title-wrap"><span class="panel-ico" aria-hidden="true"><svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5v11"/><path d="M3.5 6L6 3.5 8.5 6"/><path d="M12 14.5v-11"/><path d="M9.5 12L12 14.5 14.5 12"/></svg></span><span class="panel-title" data-i18n="secSortOpts">' + esc(tr('secSortOpts')) + '</span></div></div>' +
            '<div class="panel-body">' +
              '<div class="sort-box">' +
                '<div class="sort-top"><span class="field-lbl" data-i18n="sortPriorityLbl">' + esc(tr('sortPriorityLbl')) + '</span><div class="quick-chips" id="sortPresets"><button type="button" class="qchip" data-sp="dub:desc,qual:desc,bitrate:desc,speed:asc" data-i18n="spDubQual">' + esc(tr('spDubQual')) + '</button><button type="button" class="qchip" data-sp="qual:desc,bitrate:desc,speed:asc,dub:desc" data-i18n="spQualBit">' + esc(tr('spQualBit')) + '</button><button type="button" class="qchip" data-sp="speed:asc,qual:desc,bitrate:desc,dub:desc" data-i18n="spSpeedQual">' + esc(tr('spSpeedQual')) + '</button><button type="button" class="qchip" data-sp="bitrate:desc,qual:desc,speed:asc,dub:desc" data-i18n="spBitrate">' + esc(tr('spBitrate')) + '</button><button type="button" class="qchip" data-sp="dub:asc,qual:desc,bitrate:desc,speed:asc" data-i18n="spSub">' + esc(tr('spSub')) + '</button></div></div>' +
                '<div class="sort-list" id="sortOrderList"></div>' +
              '</div>' +
              '<div class="setting-stack">' +
                '<div class="setting-block"><div class="field-grid"><div class="field"><label class="field-lbl" for="hubSort_trigger" data-i18n="hubSortLbl">' + esc(tr('hubSortLbl')) + '</label><select class="sel" id="hubSort">' + opt('custom', hubSort, tr('hsCustom'), 'hsCustom') + opt('catalog', hubSort, tr('hsCatalog'), 'hsCatalog') + opt('code_asc', hubSort, tr('hsCodeAsc'), 'hsCodeAsc') + opt('code_desc', hubSort, tr('hsCodeDesc'), 'hsCodeDesc') + opt('name_asc', hubSort, tr('hsNameAsc'), 'hsNameAsc') + opt('name_desc', hubSort, tr('hsNameDesc'), 'hsNameDesc') + '</select></div></div><div id="hubOrderBox" class="hub-order-box" style="margin-top:0"><span class="hub-order-lbl" data-i18n="hubOrderHint">' + esc(tr('hubOrderHint')) + '</span><div class="hub-order-list" id="hubOrderList"></div></div></div>' +
                '<div class="setting-block"><div class="lim-row"><div class="lim-info"><span class="lim-title" data-i18n="timeoutTitle">' + esc(tr('timeoutTitle')) + '</span><span class="lim-hint" data-i18n="timeoutHint">' + esc(tr('timeoutHint')) + '</span></div><div class="lim-ctrls"><div class="quick-chips" data-qgroup="timeoutSec"><button type="button" class="qchip" data-val="15">15s</button><button type="button" class="qchip" data-val="30">30s</button><button type="button" class="qchip" data-val="45">45s</button><button type="button" class="qchip" data-val="60">60s</button><button type="button" class="qchip" data-val="90">90s</button></div><div class="stepper"><button type="button" class="step-btn" data-step="-5" data-target="timeoutInp" data-i18n-aria="decrease" aria-label="' + esc(tr('decrease')) + '">-</button><input type="number" min="10" max="90" class="num-inp" id="timeoutInp" value="' + esc(timeoutSec) + '" /><button type="button" class="step-btn" data-step="5" data-target="timeoutInp" data-i18n-aria="increase" aria-label="' + esc(tr('increase')) + '">+</button></div></div></div><div class="divider"></div><div class="ctrl-row"><label class="switch-wrap"><input class="sr" type="checkbox" id="hubSeqOn" ' + hubSeqOn + ' /><span class="switch-track"><span class="switch-thumb"></span></span><span data-i18n="hubSeqTitle">' + esc(tr('hubSeqTitle')) + '</span></label><span class="lim-hint" data-i18n="hubSeqHint">' + esc(tr('hubSeqHint')) + '</span></div></div>' +
                '<div class="setting-block"><div class="ctrl-row"><label class="switch-wrap"><input class="sr" type="checkbox" id="failoverOn" ' + failoverOn + ' /><span class="switch-track"><span class="switch-thumb"></span></span><span data-i18n="failoverTitle">' + esc(tr('failoverTitle')) + '</span></label><span class="lim-hint" data-i18n="failoverHint">' + esc(tr('failoverHint')) + '</span></div><div class="lim-row" id="failoverBox"><div class="lim-info"><span class="lim-title" data-i18n="failoverToTitle">' + esc(tr('failoverToTitle')) + '</span><span class="lim-hint" data-i18n="failoverToHint">' + esc(tr('failoverToHint')) + '</span></div><div class="lim-ctrls"><div class="quick-chips" data-qgroup="failoverSec"><button type="button" class="qchip" data-val="10">10s</button><button type="button" class="qchip" data-val="15">15s</button><button type="button" class="qchip" data-val="20">20s</button><button type="button" class="qchip" data-val="30">30s</button><button type="button" class="qchip" data-val="45">45s</button></div><div class="stepper"><button type="button" class="step-btn" data-step="-5" data-target="failoverInp" data-i18n-aria="decrease" aria-label="' + esc(tr('decrease')) + '">-</button><input type="number" min="5" max="45" class="num-inp" id="failoverInp" value="' + esc(failoverSec) + '" /><button type="button" class="step-btn" data-step="5" data-target="failoverInp" data-i18n-aria="increase" aria-label="' + esc(tr('increase')) + '">+</button></div></div></div></div>' +
                '<div class="setting-block"><div class="ctrl-row"><label class="switch-wrap"><input class="sr" type="checkbox" id="catalogsOn" ' + catalogsOn + ' /><span class="switch-track"><span class="switch-thumb"></span></span><span data-i18n="catalogsTitle">' + esc(tr('catalogsTitle')) + '</span></label><span class="lim-hint" data-i18n="catalogsHint">' + esc(tr('catalogsHint')) + '</span></div><div class="lim-row" id="catalogsInfoBox"><div class="lim-info"><span class="lim-hint" data-i18n="catalogsListLbl">' + esc(tr('catalogsListLbl')) + '</span></div></div></div>' +
              '</div>' +
            '</div>' +
          '</section>' +
        '</section>' +
        '<!-- 06 BLACKLIST -->' +
        '<section class="view" data-view="blacklist">' +
          '<section class="panel" id="sec-blacklist">' +
            '<div class="panel-head">' +
              '<div class="panel-title-wrap"><span class="panel-ico" aria-hidden="true"><svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="9" cy="9" r="6.5"/><path d="M4.5 4.5l9 9"/></svg></span><span class="panel-title" data-i18n="secBlacklist">' + esc(tr('secBlacklist')) + '</span></div>' +
              '<div class="panel-actions"><span class="count" id="blCount">' + esc(trf('blCount', { n: 0 })) + '</span><button type="button" class="link-btn" id="blRefreshBtn" data-i18n="refresh">' + esc(tr('refresh')) + '</button><button type="button" class="link-btn" id="blClearBtn" data-i18n="clearAll">' + esc(tr('clearAll')) + '</button></div>' +
            '</div>' +
            '<div class="panel-body">' +
              '<div class="bl-form"><input type="text" class="bl-inp" id="blMediaInp" data-i18n-ph="blMediaPh" placeholder="' + esc(tr('blMediaPh')) + '" /><input type="text" class="bl-inp" id="blProvInp" data-i18n-ph="blProvPh" placeholder="' + esc(tr('blProvPh')) + '" /><input type="text" class="bl-inp" id="blUrlInp" data-i18n-ph="blUrlPh" placeholder="' + esc(tr('blUrlPh')) + '" /><button type="button" class="btn btn-flat" id="blAddBtn" data-i18n="add">' + esc(tr('add')) + '</button></div>' +
              '<div class="bl-list" id="blList"><span class="count is-plain" data-i18n="loading">' + esc(tr('loading')) + '</span></div>' +
            '</div>' +
          '</section>' +
        '</section>' +
      '</main>' +
      '<footer class="dock">' +
        '<div class="dock-l"><span class="unsaved-dot" id="dirtyDot"></span><span id="dockSummary">TR + EN</span><span class="status" id="status"></span></div>' +
        '<div class="dock-r">' +
          '<button class="btn btn-primary" id="saveBtn" type="button">' +
            '<span class="unsaved-dot" aria-hidden="true"></span>' +
            '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.5h8l2.5 2.5V13.5H3V2.5z"/><path d="M5.5 2.5v3.5h5V2.5"/><rect x="5.5" y="9" width="5" height="4.5"/></svg>' +
            '<span data-i18n="saveBtn">' + esc(tr('saveBtn')) + '</span>' +
          '</button>' +
        '</div>' +
      '</footer>' +
    '</div></div>' +
    '<script>' +
    'const APP_VERSION = ' + safeScriptJson(appVersion) + ';' +
    'const ORIGIN = ' + safeScriptJson(origin) + ';' +
    'const HAS_URL_CFG = ' + safeScriptJson(hasUrlCfg) + ';' +
    'const HAS_SAVED_CFG = ' + safeScriptJson(Boolean(cfg && cfg.raw)) + ';' +
    'const STORAGE_KEY = "nuvio_mega_cfg_v1";' +
    'const UI_PREFS_KEY = "nuvio_mega_ui_prefs_v1";' +
    'const CATALOG_ORDER = ' + safeScriptJson(catalogOrder) + ';' +
    'const CATALOG_NAMES = ' + safeScriptJson(catalogNames) + ';' +
    'const REPOS_BY_LANG = ' + safeScriptJson(reposByLang) + ';' +
    'const UI_LANG_META = ' + safeScriptJson(UI_LANG_META) + ';' +
    'const I18N = ' + safeScriptJson(I18N) + ';' +
    'const INIT_UI_LANG = ' + safeScriptJson(initUiLang) + ';' +
    'const FLAG_SVGS = ' + safeScriptJson(FLAG_SVGS) + ';' +
    'const PALETTES = [' +
      '{ id: "signal",  label: "SIGNAL",  bg: "#161616", dot: "#ff4d00" },' +
      '{ id: "chalk",   label: "CHALK",   bg: "#f6f4ee", dot: "#d94111" },' +
      '{ id: "sage",    label: "SAGE",    bg: "#121815", dot: "#56cf85" },' +
      '{ id: "amber",   label: "AMBER",   bg: "#171411", dot: "#e69f38" },' +
      '{ id: "crimson", label: "CRIMSON", bg: "#17171a", dot: "#e63946" }' +
    '];' +
    'let langOrder = ' + safeScriptJson(selectedArr) + ';' +
    'let disabledRepos = new Set(' + safeScriptJson(disabledReposInit) + ');' +
    'let disabledProvs = new Set(' + safeScriptJson(disabledProvsInit) + ');' +
    'let openRepoGroups = {};' +
    'let openDrawers = {};' +
    'const srcCache = {};' +
    'const srcPending = {};' +
    'const provLangMap = {};' +
    'let lastCfgStr = "";' +
    'let savedCfgSnapshot = null;' +
    'let lastBlItems = null;' +
    'let installMode = "nuvio";' +
    'let linkMode = "saved";' +
    'let uiLangPref = "auto";' +
    'let activeUiLang = INIT_UI_LANG;' +
    'let palettePref = "signal";' +
    'let activeTab = "install";' +
    'let langOnlySelOn = false;' +
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
    'function tf(k, vars) { return String(t(k)).replace(/\\{(\\w+)\\}/g, (_, n) => (vars && vars[n] !== undefined ? String(vars[n]) : "")); }' +
    'function activeLocale() { return (UI_LANG_META[activeUiLang] && UI_LANG_META[activeUiLang].bcp47) || "en-US"; }' +
    'function locRepoName(r) { return r && r.id === "tr_nuvio" ? t("repoTrNuvio") : (r && r.name) || ""; }' +
    'function locRepoSub(r) {' +
    '  const s = String((r && r.sub) || "");' +
    '  if (!s) return "";' +
    '  if (s === "Dahili sağlayıcı") return t("repoBuiltinProv");' +
    '  if (s === "Çoklu-dil / Çapraz ses") return t("repoMultiLangFallback");' +
    '  const ml = s.match(/^(\\d+)\\s+çoklu-dil sağlayıcı$/i);' +
    '  if (ml) return tf("repoMultiLangProv", { n: ml[1] });' +
    '  return s.replace(/\\bkaynak\\b/g, t("repoSourcesUnit"));' +
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
    'const installGuideList = document.getElementById("installGuideList");' +
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
    'const catalogsOnEl = document.getElementById("catalogsOn");' +
    'const catalogsInfoBox = document.getElementById("catalogsInfoBox");' +
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
    '  inputs.forEach(i => { if (i.checked && !langOrder.includes(i.value)) langOrder.push(i.value); });' +
    '}' +
    'function setStatus(msg, ms, isErr) {' +
    '  clearTimeout(statusTimer);' +
    '  statusEl.textContent = msg || "";' +
    '  statusEl.style.color = isErr ? "var(--danger)" : "var(--ok)";' +
    '  if (ms > 0) statusTimer = setTimeout(() => { statusEl.textContent = ""; }, ms);' +
    '}' +
    'function syncQuickChips(group, val) {' +
    '  document.querySelectorAll("[data-qgroup=" + group + "] .qchip").forEach(b => {' +
    '    b.classList.toggle("is-active", Number(b.dataset.val) === val);' +
    '  });' +
    '}' +
    'function saveUiPrefs() {' +
    '  try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ installMode, linkMode, uiLang: uiLangPref, palette: palettePref })); } catch {}' +
    '}' +
    'const TAB_META = {' +
    '  install: { num: "01", key: "tabInstall" },' +
    '  langs: { num: "02", key: "tabLangs" },' +
    '  repos: { num: "03", key: "tabRepos" },' +
    '  quals: { num: "04", key: "tabQuals" },' +
    '  sort: { num: "05", key: "tabSort" },' +
    '  blacklist: { num: "06", key: "tabBlacklist" }' +
    '};' +
    'function switchTab(tab) {' +
    '  if (!TAB_META[tab]) tab = "install";' +
    '  activeTab = tab;' +
    '  document.querySelectorAll("#rackNav .nav-item, #secNav .sec-pill").forEach(b => b.classList.toggle("is-active", b.dataset.tab === tab));' +
    '  document.querySelectorAll(".view[data-view]").forEach(v => v.classList.toggle("is-active", v.dataset.view === tab));' +
    '  const meta = TAB_META[tab];' +
    '  const tc = document.getElementById("topCrumb"); const tt = document.getElementById("topTitle");' +
    '  if (tc) tc.textContent = meta.num + " // " + t(meta.key);' +
    '  if (tt) tt.textContent = t(meta.key);' +
    '}' +
    'document.querySelectorAll("#rackNav .nav-item, #secNav .sec-pill").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));' +
    'function applyPalette(id) {' +
    '  const p = PALETTES.find(x => x.id === id) || PALETTES[0];' +
    '  palettePref = p.id;' +
    '  document.documentElement.setAttribute("data-palette", p.id);' +
    '  const pn = document.getElementById("paletteName"); if (pn) pn.textContent = p.label;' +
    '  renderSwatches();' +
    '  if (themeBtn) { themeBtn.title = p.label; themeBtn.setAttribute("aria-label", p.label); }' +
    '}' +
    'function renderSwatches() {' +
    '  const row = document.getElementById("swatchRow"); if (!row) return;' +
    '  row.innerHTML = "";' +
    '  PALETTES.forEach(p => {' +
    '    const b = document.createElement("button"); b.type = "button";' +
    '    b.className = "swatch" + (palettePref === p.id ? " is-active" : "");' +
    '    b.style.background = p.bg; b.title = p.label;' +
    '    const dot = document.createElement("span"); dot.className = "swatch-dot"; dot.style.background = p.dot;' +
    '    b.appendChild(dot);' +
    '    b.addEventListener("click", () => { applyPalette(p.id); saveUiPrefs(); });' +
    '    row.appendChild(b);' +
    '  });' +
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
    '  switchTab(activeTab);' +
    '  if (rerender) { renderAll(false); if (lastBlItems !== null) renderBlacklist(lastBlItems); }' +
    '  const lsInp = document.getElementById("langSearch"); if (lsInp) lsInp.placeholder = tf("srcSearchPh", { name: t("secLangs") });' +
    '  if (typeof filterLangCards === "function") filterLangCards();' +
    '  if (typeof renderUpdateBar === "function") renderUpdateBar();' +
    '  if (typeof syncHeroSelects === "function") syncHeroSelects();' +
    '}' +
    'function getSortString() {' +
    '  const activeSort = sortState.filter(x => x.on);' +
    '  return (activeSort.length ? activeSort : sortState.slice(0, 1)).map(x => x.k + ":" + x.d).join(",");' +
    '}' +
    'function syncControlStates() {' +
    '  syncLangOrder();' +
    '  inputs.forEach(i => i.closest(".lang-item").classList.toggle("is-selected", i.checked));' +
    '  selCount.textContent = tf("selCount", { n: langOrder.length });' +
    '  const loBtn = document.getElementById("langOnlySel"); if (loBtn) { loBtn.textContent = "✓ " + langOrder.length; loBtn.classList.toggle("is-active", langOnlySelOn); }' +
    '  if (typeof filterLangCards === "function") filterLangCards();' +
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
    '  catalogsInfoBox.classList.toggle("hidden", !catalogsOnEl.checked);' +
    '  const ls = langOrder.length ? langOrder : ["tr", "en"];' +
    '  const navL = document.getElementById("navLangTag"); if (navL) navL.textContent = String(ls.length).padStart(2, "0");' +
    '  const navQ = document.getElementById("navQualTag"); if (navQ) navQ.textContent = String(qs.length).padStart(2, "0");' +
    '  const navC = document.getElementById("navCatTag"); if (navC) navC.textContent = catalogsOnEl.checked ? "ON" : "OFF";' +
    '  const sl = document.getElementById("statLangs"); if (sl) sl.textContent = ls.slice(0, 3).map(c => c.toUpperCase()).join("+") + (ls.length > 3 ? "+" : "");' +
    '  const sls = document.getElementById("statLangSub"); if (sls) sls.textContent = ls.length + " HUB";' +
    '  const sc = document.getElementById("statCatalog"); if (sc) sc.textContent = catalogsOnEl.checked ? (ls.includes("tr") ? "10" : "8") : t("offLabel");' +
    '  const sq = document.getElementById("statQuals"); if (sq) sq.textContent = qs[0] ? qs[0].toUpperCase() : "-";' +
    '  const sqs = document.getElementById("statQualSub"); if (sqs) sqs.textContent = qs.join(" · ");' +
    '  const ds = document.getElementById("dockSummary"); if (ds) ds.textContent = ls.map(c => c.toUpperCase()).join("+") + " // " + qs.join(",").toUpperCase() + " // CAT:" + (catalogsOnEl.checked ? "ON" : "OFF") + " // FB:" + (failoverOnEl.checked ? "ON" : "OFF");' +
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
    '    const bL = document.createElement("button"); bL.type = "button"; bL.className = "mv-btn"; bL.textContent = "\\u2039"; bL.disabled = idx === 0;' +
    '    bL.addEventListener("click", () => { if (idx > 0) { [sortState[idx-1], sortState[idx]] = [sortState[idx], sortState[idx-1]]; renderSortList(); syncOutputUrl(true); } });' +
    '    const num = document.createElement("span"); num.className = "h-num"; num.textContent = item.on ? ((++ordNo) + ".") : "-";' +
    '    const lbl = document.createElement("span"); lbl.textContent = meta.name;' +
    '    const bDir = document.createElement("button"); bDir.type = "button"; bDir.className = "s-dir"; bDir.title = t("sortDirTitle"); bDir.textContent = item.d === "asc" ? meta.asc : meta.desc;' +
    '    bDir.addEventListener("click", () => { item.d = item.d === "asc" ? "desc" : "asc"; item.on = true; renderSortList(); syncOutputUrl(true); });' +
    '    const bOn = document.createElement("button"); bOn.type = "button"; bOn.className = "s-on"; bOn.title = item.on ? t("sortOffTitle") : t("sortOnTitle"); bOn.textContent = item.on ? "✓" : "○";' +
    '    bOn.addEventListener("click", () => { item.on = !item.on; renderSortList(); syncOutputUrl(true); });' +
    '    const bR = document.createElement("button"); bR.type = "button"; bR.className = "mv-btn"; bR.textContent = "\\u203a"; bR.disabled = idx === sortState.length - 1;' +
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
    '    const grpOpen = Boolean(openRepoGroups[code]);' +
    '    const grp = document.createElement("div"); grp.className = "repo-group" + (grpOpen ? " is-open" : "");' +
    '    const gOn = list.filter(r => !disabledRepos.has(r.id)).length;' +
    '    totalR += list.length; activeR += gOn;' +
    '    const gh = document.createElement("div"); gh.className = "repo-ghead";' +
    '    const gt = document.createElement("button"); gt.type = "button"; gt.className = "repo-gtog"; gt.setAttribute("aria-expanded", String(grpOpen));' +
    '    const chev = document.createElement("span"); chev.className = "repo-chev"; chev.setAttribute("aria-hidden", "true"); chev.innerHTML = "<svg viewBox=\\"0 0 12 12\\" width=\\"11\\" height=\\"11\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"square\\"><polyline points=\\"4,2 8,6 4,10\\"/></svg>";' +
    '    const flagSp = document.createElement("span"); flagSp.className = "flag";' +
    '    if (Object.prototype.hasOwnProperty.call(FLAG_SVGS, code)) flagSp.innerHTML = FLAG_SVGS[code];' +
    '    const titleTxt = document.createElement("span"); titleTxt.className = "repo-gtog-txt"; titleTxt.textContent = code.toUpperCase() + " Hub · " + (CATALOG_NAMES[code] || code);' +
    '    gt.append(chev, flagSp, titleTxt);' +
    '    const ga = document.createElement("span"); ga.className = "repo-gact";' +
    '    const gc = document.createElement("span"); gc.className = "count"; gc.textContent = tf("grpActive", { on: gOn, total: list.length });' +
    '    const gBtn = document.createElement("button"); gBtn.type = "button"; gBtn.className = "link-btn"; gBtn.textContent = gOn === list.length ? t("grpClose") : t("grpOpenAll");' +
    '    gBtn.addEventListener("click", (e) => { e.stopPropagation(); if (gOn === list.length) list.forEach(r => disabledRepos.add(r.id)); else list.forEach(r => disabledRepos.delete(r.id)); renderRepoGroups(); syncOutputUrl(true); });' +
    '    gh.addEventListener("click", (e) => { if (e.target && e.target.closest && e.target.closest(".repo-gact button")) return; if (openRepoGroups[code]) { delete openRepoGroups[code]; delete openDrawers[code]; } else { openRepoGroups[code] = true; } renderRepoGroups(); });' +
    '    ga.append(gc, gBtn); gh.append(gt, ga); grp.appendChild(gh);' +
    '    if (!grpOpen) { repoGroups.appendChild(grp); return; }' +
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
    '  const nr = document.getElementById("navRepoTag"); if (nr) nr.textContent = activeR + "/" + totalR;' +
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
    '      const bL = document.createElement("button"); bL.type = "button"; bL.className = "mv-btn"; bL.textContent = "\\u2039"; bL.title = t("moveLeft"); bL.disabled = idx === 0;' +
    '      bL.addEventListener("click", () => { if (idx > 0) { const arr = ls.slice(); [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]]; langOrder = arr; renderRepoGroups(); renderHubOrder(); renderPreview(); syncOutputUrl(true); } });' +
    '      const num = document.createElement("span"); num.className = "h-num"; num.textContent = (idx + 1) + ".";' +
    '      const lbl = document.createElement("span"); lbl.textContent = code.toUpperCase() + " Hub";' +
    '      const bR = document.createElement("button"); bR.type = "button"; bR.className = "mv-btn"; bR.textContent = "\\u203a"; bR.title = t("moveRight"); bR.disabled = idx === ls.length - 1;' +
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
    '  const navI = document.getElementById("navInstTag");' +
    '  if (installMode === "nuvio") {' +
    '    if (navI) navI.textContent = "NUVIO";' +
    '    previewHint.textContent = t("previewNuvio");' +
    '    dispLangs.forEach(code => {' +
    '      const c = document.createElement("span"); c.className = "p-chip"; c.textContent = code.toUpperCase() + " Hub"; previewChips.appendChild(c);' +
    '    });' +
    '  } else if (installMode === "cs3") {' +
    '    if (navI) navI.textContent = "CS3";' +
    '    previewHint.textContent = t("previewCs3");' +
    '    const c = document.createElement("span"); c.className = "p-chip"; c.textContent = "CloudStream 3 (" + dispLangs.map(x => x.toUpperCase()).join("+") + ")"; previewChips.appendChild(c);' +
    '  } else {' +
    '    if (navI) navI.textContent = "ADDON";' +
    '    previewHint.textContent = t("previewAio");' +
    '    const c = document.createElement("span"); c.className = "p-chip"; c.textContent = "Stremio (" + dispLangs.map(x => x.toUpperCase()).join("+") + ")"; previewChips.appendChild(c);' +
    '    if (catalogsOnEl && catalogsOnEl.checked) { const cc = document.createElement("span"); cc.className = "p-chip"; cc.textContent = t("catalogChipOn"); previewChips.appendChild(cc); }' +
    '  }' +
    '  if (installGuideList) {' +
    '    installGuideList.innerHTML = "";' +
    '    const addStep = (txt, codeText) => {' +
    '      const li = document.createElement("li");' +
    '      if (codeText && txt.includes("{badges}")) {' +
    '        const parts = txt.split("{badges}");' +
    '        li.appendChild(document.createTextNode(parts[0]));' +
    '        const cd = document.createElement("code"); cd.textContent = codeText; li.appendChild(cd);' +
    '        li.appendChild(document.createTextNode(parts.slice(1).join("{badges}")));' +
    '      } else { li.textContent = txt; }' +
    '      installGuideList.appendChild(li);' +
    '    };' +
    '    if (installMode === "nuvio") { addStep(t("guideNuvio1")); addStep(t("guideNuvio2")); addStep(t("guideNuvio3"), ORIGIN + "/badges.json"); }' +
    '    else if (installMode === "cs3") { addStep(t("guideCs31")); addStep(t("guideCs32")); }' +
    '    else { addStep(t("guideAio1")); addStep(t("guideAio2")); addStep(t("guideAio3")); }' +
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
    '  const parts = ["langs=" + ls.join(","), "quals=" + qs.join(","), "qlm=" + (allMode ? "all" : "per")];' +
    '  if (allMode) parts.push("qlim=" + qlimAllVal);' +
    '  else parts.push("qmap=" + qMapInputs.map(inp => inp.dataset.qmap + ":" + clamp(inp.value, 0, 50)).join(","));' +
    '  parts.push("hublim=" + hubLimVal);' +
    '  parts.push("ssort=" + ssort);' +
    '  parts.push("hsort=" + hsort);' +
    '  parts.push("to=" + toVal);' +
    '  if (hubSeqOnEl.checked) parts.push("hseq=1");' +
    '  if (fbOn) { parts.push("fb=1"); parts.push("fbto=" + fbVal); }' +
    '  parts.push("cat=" + (catalogsOnEl.checked ? "1" : "0"));' +
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
    '      localStorage.setItem(STORAGE_KEY, JSON.stringify({ langs: langOrder.slice(), quals: qPicked.slice(), qlm: allMode ? "all" : "per", qlim: qlimAllVal, qmap: qmapObj, hublim: hubLimVal, ssort, hsort, hseq: hubSeqOnEl.checked, fb: fbOn, fbto: fbVal, to: toVal, cat: catalogsOnEl.checked, off: [...disabledRepos], offp: [...disabledProvs] }));' +
    '    } catch {}' +
    '    saveUiPrefs();' +
    '  }' +
    '  const cfg = parts.join("&");' +
    '  lastCfgStr = cfg;' +
    '  if (savedCfgSnapshot === null) savedCfgSnapshot = cfg;' +
    '  const isDirty = savedCfgSnapshot !== cfg;' +
    '  const sb = document.getElementById("saveBtn"); if (sb) sb.classList.toggle("is-dirty", isDirty);' +
    '  const dd = document.getElementById("dirtyDot"); if (dd) dd.classList.toggle("is-show", isDirty);' +
    '  const url = linkMode === "saved" ? (installMode === "nuvio" ? (ORIGIN + "/saved/nuvio-repo/manifest.json") : (installMode === "cs3" ? (ORIGIN + "/saved/cs3/repo.json") : (ORIGIN + "/saved/manifest.json"))) : (installMode === "nuvio" ? (ORIGIN + "/c/" + encodeURIComponent(cfg) + "/nuvio-repo/manifest.json") : (installMode === "cs3" ? (ORIGIN + "/c/" + encodeURIComponent(cfg) + "/cs3/repo.json") : (ORIGIN + "/c/" + encodeURIComponent(cfg + "&mode=direct") + "/manifest.json")));' +
    '  out.textContent = url;' +
    '  sbtn.classList.toggle("hidden", installMode === "nuvio");' +
    '  const sbtnLbl = document.getElementById("stremioBtnLbl");' +
    '  if (sbtnLbl) sbtnLbl.textContent = t(installMode === "cs3" ? "cs3Btn" : "stremioBtn");' +
    '  sbtn.href = (installMode === "cs3" ? "cloudstreamrepo://" : "stremio://") + url.replace("https://", "").replace("http://", "");' +
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
    '  inp.addEventListener("change", commit); inp.addEventListener("blur", commit);' +
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
    'catalogsOnEl.addEventListener("change", () => { renderPreview(); syncControlStates(); syncOutputUrl(true); });' +
    'bindClampedNumber(failoverInp, 5, 45);' +
    'bindClampedNumber(timeoutInp, 10, 90);' +
    'document.querySelectorAll(".step-btn").forEach(btn => btn.addEventListener("click", () => {' +
    '  const inp = document.getElementById(btn.dataset.target); if (!inp) return;' +
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
    '  const navBl = document.getElementById("navBlTag"); if (navBl) navBl.textContent = String(arr.length);' +
    '  blListEl.innerHTML = "";' +
    '  if (!arr.length) { const sp = document.createElement("span"); sp.className = "count is-plain"; sp.textContent = t("blEmpty"); blListEl.appendChild(sp); return; }' +
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
    '      if (del.disabled) return; del.disabled = true;' +
    '      try { const r = await fetch(ORIGIN + "/api/blacklist/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: it.id }) }); if (!r.ok) throw new Error("HTTP " + r.status); const j = await r.json(); renderBlacklist(j.items); }' +
    '      catch { del.disabled = false; setStatus(t("blRemoveErr"), 3500, true); }' +
    '    });' +
    '    row.append(meta, del); blListEl.appendChild(row);' +
    '  });' +
    '}' +
    'async function loadBlacklistUi() { try { const r = await fetch(ORIGIN + "/api/blacklist"); if (!r.ok) throw new Error("HTTP " + r.status); const j = await r.json(); renderBlacklist(j.items); } catch { lastBlItems = null; blListEl.innerHTML = ""; const sp = document.createElement("span"); sp.className = "count is-plain"; sp.textContent = t("blReadErr"); blListEl.appendChild(sp); } }' +
    'document.getElementById("blRefreshBtn").addEventListener("click", loadBlacklistUi);' +
    'document.getElementById("blClearBtn").addEventListener("click", async () => { if (!confirm(t("blClearConfirm"))) return; try { const r = await fetch(ORIGIN + "/api/blacklist/clear", { method: "POST" }); if (!r.ok) throw new Error("HTTP " + r.status); const j = await r.json(); renderBlacklist(j.items); } catch { setStatus(t("blClearErr"), 3500, true); } });' +
    'document.getElementById("blAddBtn").addEventListener("click", async () => { const provider = blProvInp.value.trim(); const url = blUrlInp.value.trim(); const mediaKey = blMediaInp.value.trim() || "*"; if (!provider && !url) return; try { const r = await fetch(ORIGIN + "/api/blacklist/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaKey, mediaLabel: mediaKey, provider, url }) }); if (!r.ok) throw new Error("HTTP " + r.status); const j = await r.json(); renderBlacklist(j.items); blMediaInp.value = ""; blProvInp.value = ""; blUrlInp.value = ""; } catch { setStatus(t("blAddErr"), 3500, true); } });' +
    'document.getElementById("qAll").addEventListener("click", () => { qInputs.forEach(i => i.checked = true); syncControlStates(); syncOutputUrl(true); });' +
    'document.getElementById("qNo4k").addEventListener("click", () => { qInputs.forEach(i => i.checked = (i.value !== "2160p")); syncControlStates(); syncOutputUrl(true); });' +
    'document.getElementById("q1080").addEventListener("click", () => { qInputs.forEach(i => i.checked = (i.value === "2160p" || i.value === "1440p" || i.value === "1080p")); syncControlStates(); syncOutputUrl(true); });' +
    'document.querySelectorAll(".seg button[data-install]").forEach(b => b.addEventListener("click", () => { installMode = b.dataset.install; document.querySelectorAll(".seg button[data-install]").forEach(x => x.classList.toggle("is-active", x === b)); saveUiPrefs(); renderPreview(); syncOutputUrl(false); }));' +
    'document.querySelectorAll(".seg button[data-linkmode]").forEach(b => b.addEventListener("click", () => { linkMode = b.dataset.linkmode; document.querySelectorAll(".seg button[data-linkmode]").forEach(x => x.classList.toggle("is-active", x === b)); saveUiPrefs(); renderPreview(); syncOutputUrl(false); }));' +
    'async function saveToServer(silent) {' +
    '  try {' +
    '    const res = await fetch(ORIGIN + "/api/save-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cfg: lastCfgStr }) });' +
    '    if (res.ok) { savedCfgSnapshot = lastCfgStr; const sb = document.getElementById("saveBtn"); if (sb) sb.classList.remove("is-dirty"); const dd = document.getElementById("dirtyDot"); if (dd) dd.classList.remove("is-show"); }' +
    '    if (res.ok && !silent) setStatus(t("stSaved"), 3500, false);' +
    '    else if (!res.ok && !silent) setStatus(t("stSaveErr"), 3500, true);' +
    '    return res.ok;' +
    '  } catch { if (!silent) setStatus(t("stSaveErr"), 3500, true); return false; }' +
    '}' +
    'document.getElementById("saveBtn").addEventListener("click", () => saveToServer(false));' +
    'sbtn.addEventListener("click", async (e) => { if (linkMode === "saved") { e.preventDefault(); await saveToServer(true); window.location.href = sbtn.href; } });' +
    'document.getElementById("presetTrEn").addEventListener("click", () => { inputs.forEach(i => i.checked = (i.value === "tr" || i.value === "en")); langOrder = ["tr", "en"]; syncControlStates(); renderRepoGroups(); renderHubOrder(); renderPreview(); syncOutputUrl(true); });' +
    'document.getElementById("clearBtn").addEventListener("click", () => { inputs.forEach(i => i.checked = false); langOrder = []; syncControlStates(); renderRepoGroups(); renderHubOrder(); renderPreview(); syncOutputUrl(true); });' +
    'document.getElementById("reposAllOn").addEventListener("click", () => { disabledRepos.clear(); disabledProvs.clear(); renderRepoGroups(); syncOutputUrl(true); });' +
    'document.getElementById("reposAllOff").addEventListener("click", () => { const ls = langOrder.length ? langOrder : ["tr", "en"]; ls.forEach(c => (REPOS_BY_LANG[c] || []).forEach(r => disabledRepos.add(r.id))); renderRepoGroups(); syncOutputUrl(true); });' +
    'document.getElementById("copyBtn").addEventListener("click", async () => { if (linkMode === "saved") await saveToServer(true); try { await navigator.clipboard.writeText(out.textContent); setStatus(linkMode === "saved" ? t("stSavedCopied") : t("stCopied"), 2500, false); } catch { setStatus(t("stSelectCopy"), 3000, false); } });' +
    'let donTimer = null;' +
    'document.querySelectorAll(".don-copy[data-don-addr]").forEach(btn => btn.addEventListener("click", async () => {' +
    '  const addr = btn.dataset.donAddr || ""; const ds = document.getElementById("donStatus");' +
    '  try { await navigator.clipboard.writeText(addr); btn.classList.add("is-done"); setTimeout(() => btn.classList.remove("is-done"), 1400); if (ds) { ds.textContent = t("donateCopied"); ds.classList.add("is-show"); clearTimeout(donTimer); donTimer = setTimeout(() => { ds.classList.remove("is-show"); }, 2200); } }' +
    '  catch { if (ds) { ds.textContent = t("stSelectCopy"); ds.classList.add("is-show"); clearTimeout(donTimer); donTimer = setTimeout(() => { ds.classList.remove("is-show"); }, 2800); } }' +
    '}));' +
    'if (uiLangSel) uiLangSel.addEventListener("change", () => { applyUiLang(uiLangSel.value, true); saveUiPrefs(); });' +
    'const heroSelectApi = [];' +
    'let openHeroSelect = null;' +
    'function closeHeroSelect(api, focusTrigger) {' +
    '  if (!api || !api.open) return; api.open = false;' +
    '  api.trigger.setAttribute("aria-expanded", "false"); api.popover.classList.remove("is-open");' +
    '  const pop = api.popover; clearTimeout(api.closeTimer);' +
    '  api.closeTimer = setTimeout(() => { if (!api.open && pop.parentNode) pop.parentNode.removeChild(pop); }, 150);' +
    '  if (openHeroSelect === api) openHeroSelect = null;' +
    '  if (focusTrigger) api.trigger.focus();' +
    '}' +
    'function mountHeroSelect(sel, opts) {' +
    '  if (!sel || sel.dataset.huiMounted) return null;' +
    '  sel.dataset.huiMounted = "1"; sel.classList.add("hui-select-native"); sel.tabIndex = -1; sel.setAttribute("aria-hidden", "true");' +
    '  const wrap = document.createElement("div"); wrap.className = "hui-select " + (opts && opts.full ? "hui-select--full" : "hui-select--compact");' +
    '  sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);' +
    '  const listId = sel.id + "_listbox";' +
    '  const trigger = document.createElement("button"); trigger.type = "button"; trigger.id = sel.id + "_trigger"; trigger.className = "hui-select__trigger";' +
    '  trigger.setAttribute("role", "combobox"); trigger.setAttribute("aria-haspopup", "listbox"); trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-controls", listId);' +
    '  if (sel.getAttribute("aria-label")) trigger.setAttribute("aria-label", sel.getAttribute("aria-label"));' +
    '  const valSpan = document.createElement("span"); valSpan.className = "hui-select__value";' +
    '  const ind = document.createElement("span"); ind.className = "hui-select__indicator"; ind.setAttribute("aria-hidden", "true");' +
    '  ind.innerHTML = ' + safeScriptJson('<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>') + ';' +
    '  trigger.append(valSpan, ind); wrap.appendChild(trigger);' +
    '  const popover = document.createElement("div"); popover.className = "hui-select__popover";' +
    '  const listbox = document.createElement("div"); listbox.className = "hui-listbox"; listbox.id = listId; listbox.setAttribute("role", "listbox"); listbox.tabIndex = -1;' +
    '  popover.appendChild(listbox);' +
    '  const api = { sel, wrap, trigger, valSpan, popover, listbox, open: false, activeIdx: 0, closeTimer: 0 };' +
    '  function syncLabel() { const chosen = sel.options[sel.selectedIndex] || sel.options[0]; valSpan.textContent = chosen ? chosen.textContent : ""; if (sel.getAttribute("aria-label")) trigger.setAttribute("aria-label", sel.getAttribute("aria-label")); }' +
    '  function setActive(idx, scrollIntoView) { const items = [...listbox.querySelectorAll(".hui-option")]; if (!items.length) return; api.activeIdx = (idx + items.length) % items.length; items.forEach((el, i) => el.classList.toggle("is-active", i === api.activeIdx)); const act = items[api.activeIdx]; if (act && act.id) trigger.setAttribute("aria-activedescendant", act.id); if (scrollIntoView && act) act.scrollIntoView({ block: "nearest" }); }' +
    '  function selectValue(val) { const changed = sel.value !== val; sel.value = val; syncLabel(); closeHeroSelect(api, true); if (changed) sel.dispatchEvent(new Event("change", { bubbles: true })); }' +
    '  function renderOptions() {' +
    '    listbox.innerHTML = "";' +
    '    [...sel.options].forEach((o, idx) => {' +
    '      const btn = document.createElement("button"); btn.type = "button"; btn.id = listId + "_opt_" + idx; btn.className = "hui-option"; btn.setAttribute("role", "option"); btn.setAttribute("aria-selected", o.value === sel.value ? "true" : "false");' +
    '      const lbl = document.createElement("span"); lbl.className = "hui-option__label"; lbl.textContent = o.textContent;' +
    '      const chk = document.createElement("span"); chk.className = "hui-option__check"; chk.setAttribute("aria-hidden", "true"); chk.innerHTML = ' + safeScriptJson('<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-6.5"/></svg>') + ';' +
    '      btn.append(lbl, chk); btn.addEventListener("click", () => selectValue(o.value)); btn.addEventListener("mouseenter", () => setActive(idx, false)); listbox.appendChild(btn);' +
    '    });' +
    '    api.activeIdx = Math.max(0, sel.selectedIndex); setActive(api.activeIdx, false);' +
    '  }' +
    '  function positionPopover() {' +
    '    const rect = trigger.getBoundingClientRect(); const vw = window.innerWidth; const vh = window.innerHeight;' +
    '    if (rect.bottom < 0 || rect.top > vh) { closeHeroSelect(api, false); return; }' +
    '    const width = Math.min(Math.max(rect.width, opts && opts.minWidth ? opts.minWidth : 180), vw - 16);' +
    '    const spaceBelow = vh - rect.bottom - 12; const spaceAbove = rect.top - 12;' +
    '    const placeTop = spaceBelow < 210 && spaceAbove > spaceBelow;' +
    '    const maxH = Math.max(120, Math.min(308, (placeTop ? spaceAbove : spaceBelow) - 8));' +
    '    let left = document.documentElement.dir === "rtl" ? (rect.right - width) : rect.left; left = Math.max(8, Math.min(left, vw - width - 8));' +
    '    popover.dataset.placement = placeTop ? "top" : "bottom"; popover.style.width = width + "px"; popover.style.maxHeight = maxH + "px"; popover.style.left = left + "px";' +
    '    if (placeTop) { popover.style.top = "auto"; popover.style.bottom = (vh - rect.top + 6) + "px"; } else { popover.style.bottom = "auto"; popover.style.top = (rect.bottom + 6) + "px"; }' +
    '  }' +
    '  function openMenu() {' +
    '    if (openHeroSelect && openHeroSelect !== api) closeHeroSelect(openHeroSelect, false); clearTimeout(api.closeTimer); renderOptions();' +
    '    if (!popover.parentNode) document.body.appendChild(popover); positionPopover(); api.open = true; openHeroSelect = api; trigger.setAttribute("aria-expanded", "true");' +
    '    requestAnimationFrame(() => { if (!api.open) return; popover.classList.add("is-open"); const cur = listbox.querySelector("[aria-selected=true]"); if (cur) cur.scrollIntoView({ block: "nearest" }); });' +
    '  }' +
    '  trigger.addEventListener("click", (e) => { e.preventDefault(); if (api.open) closeHeroSelect(api, false); else openMenu(); });' +
    '  trigger.addEventListener("keydown", (e) => {' +
    '    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!api.open) openMenu(); else setActive(api.activeIdx + (e.key === "ArrowDown" ? 1 : -1), true); }' +
    '    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!api.open) openMenu(); else { const act = listbox.querySelectorAll(".hui-option")[api.activeIdx]; if (act) act.click(); } }' +
    '    else if (e.key === "Escape" && api.open) { e.preventDefault(); closeHeroSelect(api, true); }' +
    '  });' +
    '  api.sync = syncLabel; api.position = positionPopover; heroSelectApi.push(api); syncLabel(); return api;' +
    '}' +
    'function syncHeroSelects() { heroSelectApi.forEach(a => a.sync()); }' +
    'document.addEventListener("pointerdown", (e) => { if (!openHeroSelect) return; const t = e.target; if (!openHeroSelect.wrap.contains(t) && !openHeroSelect.popover.contains(t)) closeHeroSelect(openHeroSelect, false); });' +
    'window.addEventListener("resize", () => { if (openHeroSelect) openHeroSelect.position(); });' +
    'window.addEventListener("scroll", (e) => { if (openHeroSelect && !openHeroSelect.popover.contains(e.target)) openHeroSelect.position(); }, true);' +
    'mountHeroSelect(uiLangSel, { full: false, minWidth: 206 });' +
    'mountHeroSelect(hubSortSel, { full: true, minWidth: 220 });' +
    'const themeBtn = document.getElementById("themeBtn");' +
    'if (themeBtn) { themeBtn.innerHTML = ' + safeScriptJson('<svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="9" r="3.3"/><path d="M9 2v1.6M9 14.4V16M2 9h1.6M14.4 9H16M4.1 4.1l1.1 1.1M12.8 12.8l1.1 1.1M13.9 4.1l-1.1 1.1M5.2 12.8l-1.1 1.1"/></svg>') + '; themeBtn.addEventListener("click", () => { const idx = PALETTES.findIndex(x => x.id === palettePref); const next = PALETTES[(idx + 1) % PALETTES.length].id; applyPalette(next); saveUiPrefs(); }); }' +
    'try {' +
    '  const uiRaw = localStorage.getItem(UI_PREFS_KEY);' +
    '  const uiSrc = uiRaw ? JSON.parse(uiRaw) : JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");' +
    '  if (uiSrc && typeof uiSrc === "object") {' +
    '    if (uiSrc.installMode === "nuvio" || uiSrc.installMode === "aio" || uiSrc.installMode === "cs3") { installMode = uiSrc.installMode; document.querySelectorAll(".seg button[data-install]").forEach(x => x.classList.toggle("is-active", x.dataset.install === installMode)); }' +
    '    if (uiSrc.linkMode === "saved" || uiSrc.linkMode === "inline") { linkMode = uiSrc.linkMode; document.querySelectorAll(".seg button[data-linkmode]").forEach(x => x.classList.toggle("is-active", x.dataset.linkmode === linkMode)); }' +
    '    if (typeof uiSrc.uiLang === "string") uiLangPref = uiSrc.uiLang;' +
    '    if (typeof uiSrc.palette === "string" && PALETTES.some(p => p.id === uiSrc.palette)) palettePref = uiSrc.palette;' +
    '  }' +
    '} catch {}' +
    'if (!HAS_URL_CFG && !HAS_SAVED_CFG) {' +
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
    '      if (typeof s.cat === "boolean") catalogsOnEl.checked = s.cat;' +
    '      if (s.fbto !== undefined) failoverInp.value = clamp(s.fbto, 5, 45);' +
    '      if (s.to !== undefined) timeoutInp.value = clamp(s.to, 10, 90);' +
    '      if (Array.isArray(s.off)) disabledRepos = new Set(s.off);' +
    '      if (Array.isArray(s.offp)) disabledProvs = new Set(s.offp);' +
    '    }' +
    '  } catch {}' +
    '}' +
    'const verPillEl = document.getElementById("verPill");' +
    'const updBarEl = document.getElementById("updBar");' +
    'const updMsgEl = document.getElementById("updMsg");' +
    'const updPctEl = document.getElementById("updPct");' +
    'const updCheckBtn = document.getElementById("updCheckBtn");' +
    'const updNowBtn = document.getElementById("updNowBtn");' +
    'const updManualBtn = document.getElementById("updManualBtn");' +
    'const updReloadBtn = document.getElementById("updReloadBtn");' +
    'const updAutoToggle = document.getElementById("updAutoToggle");' +
    'const updTrackEl = document.getElementById("updTrack");' +
    'const updFillEl = document.getElementById("updFill");' +
    'const updState = { mode: "checking", currentVersion: APP_VERSION, latestVersion: null, canSelfUpdate: false, autoUpdate: true, repoUrl: "https://github.com/0mamiis/lanettirr", stage: "idle", percent: 0, error: "", targetVersion: null };' +
    'let updPollTimer = null; let updReconnecting = false;' +
    'function updStageText(stage) {' +
    '  if (stage === "starting") return t("updStStarting");' +
    '  if (stage === "backup") return t("updStBackup");' +
    '  if (stage === "download") return t("updStDownload");' +
    '  if (stage === "extract") return t("updStExtract");' +
    '  if (stage === "install") return t("updStInstall");' +
    '  if (stage === "restart") return t("updStRestart");' +
    '  if (stage === "done") return tf("updStDone", { ver: updState.targetVersion || updState.currentVersion });' +
    '  if (stage === "error") return t("updStErr");' +
    '  return t("updStStarting");' +
    '}' +
    'function renderUpdateBar() {' +
    '  if (!updBarEl) return;' +
    '  if (verPillEl) verPillEl.textContent = "v" + updState.currentVersion;' +
    '  updBarEl.classList.remove("is-ok", "is-avail", "is-busy", "is-done", "is-err");' +
    '  const pct = Math.max(0, Math.min(100, Math.round(Number(updState.percent) || 0)));' +
    '  const m = updState.mode;' +
    '  updPctEl.classList.add("hidden"); updCheckBtn.classList.add("hidden"); updNowBtn.classList.add("hidden"); updManualBtn.classList.add("hidden"); updReloadBtn.classList.add("hidden"); updTrackEl.classList.add("hidden");' +
    '  updNowBtn.disabled = false; updNowBtn.textContent = t("updNowBtn"); updCheckBtn.textContent = t("updCheckBtn");' +
    '  if (m === "checking") { updMsgEl.textContent = t("updChecking"); }' +
    '  else if (m === "ok") { updBarEl.classList.add("is-ok"); updMsgEl.textContent = "v" + updState.currentVersion + " · " + t("updUpToDate"); updCheckBtn.classList.remove("hidden"); }' +
    '  else if (m === "avail") { updBarEl.classList.add("is-avail"); updMsgEl.textContent = tf("updAvailable", { cur: updState.currentVersion, new: updState.latestVersion || "" }); updCheckBtn.classList.remove("hidden"); if (updState.canSelfUpdate) updNowBtn.classList.remove("hidden"); else { updManualBtn.href = updState.repoUrl || "https://github.com/0mamiis/lanettirr"; updManualBtn.classList.remove("hidden"); } }' +
    '  else if (m === "busy") { updBarEl.classList.add("is-busy"); updMsgEl.textContent = updStageText(updState.stage); updPctEl.textContent = pct + "%"; updPctEl.classList.remove("hidden"); updTrackEl.classList.remove("hidden"); updFillEl.style.width = pct + "%"; }' +
    '  else if (m === "done") { updBarEl.classList.add("is-done"); updMsgEl.textContent = tf("updStDone", { ver: updState.currentVersion }); updPctEl.textContent = "100%"; updPctEl.classList.remove("hidden"); updTrackEl.classList.remove("hidden"); updFillEl.style.width = "100%"; updReloadBtn.classList.remove("hidden"); }' +
    '  else if (m === "err") { updBarEl.classList.add("is-err"); updMsgEl.textContent = updState.error ? (t("updStErr") + " · " + updState.error) : t("updCheckErr"); updCheckBtn.classList.remove("hidden"); if (updState.canSelfUpdate && updState.latestVersion) { updNowBtn.textContent = t("updRetryBtn"); updNowBtn.classList.remove("hidden"); } }' +
    '}' +
    'async function checkForUpdateUi(force) {' +
    '  if (updState.mode === "busy") return;' +
    '  updState.mode = "checking"; updState.error = ""; renderUpdateBar();' +
    '  try {' +
    '    const r = await fetch(ORIGIN + "/api/update/check" + (force ? "?force=1" : ""), { cache: "no-store" });' +
    '    const j = await r.json();' +
    '    if (j.currentVersion) updState.currentVersion = j.currentVersion;' +
    '    if (j.latestVersion) updState.latestVersion = j.latestVersion;' +
    '    updState.canSelfUpdate = Boolean(j.canSelfUpdate);' +
    '    if (typeof j.autoUpdate === "boolean") { updState.autoUpdate = j.autoUpdate; if (updAutoToggle) updAutoToggle.checked = j.autoUpdate; }' +
    '    if (j.repoUrl) updState.repoUrl = j.repoUrl;' +
    '    if (!j.ok) { updState.mode = "err"; updState.error = ""; }' +
    '    else if (j.updateAvailable) updState.mode = "avail";' +
    '    else updState.mode = "ok";' +
    '  } catch { updState.mode = "err"; updState.error = ""; }' +
    '  renderUpdateBar();' +
    '}' +
    'function schedulePoll(ms, fn) { clearTimeout(updPollTimer); updPollTimer = setTimeout(fn, ms); }' +
    'async function waitForBridgeOnline(tries) {' +
    '  updReconnecting = true; updState.mode = "busy"; updState.stage = "restart"; updState.percent = Math.max(updState.percent, 92); renderUpdateBar();' +
    '  try { const r = await fetch(ORIGIN + "/health?t=" + Date.now(), { cache: "no-store" }); if (r.ok) { pollUpdateStatus(); return; } } catch {}' +
    '  if (tries > 60) { updReconnecting = false; updState.mode = "err"; updState.error = "Timeout"; renderUpdateBar(); return; }' +
    '  schedulePoll(1200, () => waitForBridgeOnline(tries + 1));' +
    '}' +
    'async function pollUpdateStatus() {' +
    '  try {' +
    '    const r = await fetch(ORIGIN + "/api/update/status?t=" + Date.now(), { cache: "no-store" });' +
    '    if (!r.ok) throw new Error("HTTP " + r.status);' +
    '    const j = await r.json();' +
    '    if (j.currentVersion) updState.currentVersion = j.currentVersion;' +
    '    if (j.targetVersion) updState.targetVersion = j.targetVersion;' +
    '    if (typeof j.canSelfUpdate === "boolean") updState.canSelfUpdate = j.canSelfUpdate;' +
    '    if (typeof j.autoUpdate === "boolean") { updState.autoUpdate = j.autoUpdate; if (updAutoToggle) updAutoToggle.checked = j.autoUpdate; }' +
    '    if (j.running) { updState.mode = "busy"; updState.stage = j.stage || "starting"; updState.percent = Math.max(updState.percent, Number(j.percent) || 5); renderUpdateBar(); schedulePoll(900, pollUpdateStatus); }' +
    '    else if (j.done || j.stage === "done" || updReconnecting) { updReconnecting = false; updState.mode = "done"; updState.percent = 100; renderUpdateBar(); schedulePoll(1600, () => window.location.reload()); }' +
    '    else if (j.stage === "error" || j.error) { updReconnecting = false; updState.mode = "err"; updState.error = j.error || ""; renderUpdateBar(); }' +
    '    else checkForUpdateUi(false);' +
    '  } catch { if (updState.mode === "busy" || updReconnecting) waitForBridgeOnline(1); else { updState.mode = "err"; updState.error = ""; renderUpdateBar(); } }' +
    '}' +
    'async function startUpdateUi() {' +
    '  if (updState.mode === "busy") return;' +
    '  updReconnecting = false; updState.mode = "busy"; updState.stage = "starting"; updState.percent = 5; updState.error = "";' +
    '  updState.targetVersion = updState.latestVersion || updState.currentVersion; renderUpdateBar();' +
    '  try { const r = await fetch(ORIGIN + "/api/update/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetVersion: updState.latestVersion || "" }) }); const j = await r.json(); if (r.ok || r.status === 409) schedulePoll(700, pollUpdateStatus); else { updState.mode = "err"; updState.error = (j && j.error) || ("HTTP " + r.status); renderUpdateBar(); } } catch { updState.mode = "err"; updState.error = "Network"; renderUpdateBar(); }' +
    '}' +
    'if (updCheckBtn) updCheckBtn.addEventListener("click", () => checkForUpdateUi(true));' +
    'if (updNowBtn) updNowBtn.addEventListener("click", startUpdateUi);' +
    'if (updReloadBtn) updReloadBtn.addEventListener("click", () => window.location.reload());' +
    'if (updAutoToggle) updAutoToggle.addEventListener("change", async () => { const next = updAutoToggle.checked; updAutoToggle.disabled = true; try { const r = await fetch(ORIGIN + "/api/update/auto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) }); const j = await r.json(); if (r.ok && typeof j.autoUpdate === "boolean") { updState.autoUpdate = j.autoUpdate; updAutoToggle.checked = j.autoUpdate; } else updAutoToggle.checked = !next; } catch { updAutoToggle.checked = !next; } finally { updAutoToggle.disabled = false; } });' +
    'const langSearchEl = document.getElementById("langSearch");' +
    'const langSearchClearEl = document.getElementById("langSearchClear");' +
    'const langOnlySelEl = document.getElementById("langOnlySel");' +
    'const langsGridEl = document.getElementById("langs");' +
    'function filterLangCards() {' +
    '  const q = langSearchEl ? langSearchEl.value.trim().toLowerCase() : "";' +
    '  if (langSearchClearEl) langSearchClearEl.classList.toggle("hidden", !q);' +
    '  let visible = 0;' +
    '  inputs.forEach(inp => {' +
    '    const card = inp.closest(".lang-item"); if (!card) return;' +
    '    const code = (card.dataset.code || "").toLowerCase();' +
    '    const nm = (CATALOG_NAMES[code] || card.textContent || "").toLowerCase();' +
    '    const matchQ = !q || code.includes(q) || nm.includes(q);' +
    '    const matchSel = !langOnlySelOn || inp.checked;' +
    '    const show = matchQ && matchSel;' +
    '    card.classList.toggle("hidden", !show); if (show) visible++;' +
    '  });' +
    '  if (langsGridEl) {' +
    '    let emp = document.getElementById("langEmptyMsg");' +
    '    if (visible === 0) { if (!emp) { emp = document.createElement("div"); emp.id = "langEmptyMsg"; emp.className = "lang-empty"; langsGridEl.appendChild(emp); } emp.textContent = t("srcEmpty"); }' +
    '    else if (emp) emp.remove();' +
    '  }' +
    '}' +
    'if (langSearchEl) langSearchEl.addEventListener("input", filterLangCards);' +
    'if (langSearchClearEl) langSearchClearEl.addEventListener("click", () => { if (langSearchEl) { langSearchEl.value = ""; langSearchEl.focus(); } filterLangCards(); });' +
    'if (langOnlySelEl) langOnlySelEl.addEventListener("click", () => { langOnlySelOn = !langOnlySelOn; langOnlySelEl.classList.toggle("is-active", langOnlySelOn); filterLangCards(); });' +
    '[blMediaInp, blProvInp, blUrlInp].forEach(el => { if (el) el.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const b = document.getElementById("blAddBtn"); if (b) b.click(); } }); });' +
    'async function pollHealthBadge() {' +
    '  try {' +
    '    const r = await fetch(ORIGIN + "/health?t=" + Date.now(), { cache: "no-store" });' +
    '    if (!r.ok) throw new Error();' +
    '    const j = await r.json();' +
    '    const cnt = Number(j.providersLoaded) || 0;' +
    '    const lp = document.getElementById("liveProvTxt"); if (lp) lp.textContent = cnt + " SRC";' +
    '    const sp = document.getElementById("statProvs"); if (sp) sp.textContent = cnt > 0 ? String(cnt) : "WAIT";' +
    '    const dot = document.getElementById("liveDot"); if (dot) dot.classList.toggle("is-wait", cnt <= 0);' +
    '    const hb = document.getElementById("healthStateBadge"); if (hb) hb.textContent = cnt > 0 ? "ONLINE" : "LOADING";' +
    '  } catch {' +
    '    const dot = document.getElementById("liveDot"); if (dot) dot.classList.add("is-wait");' +
    '    const hb = document.getElementById("healthStateBadge"); if (hb) hb.textContent = "OFFLINE";' +
    '  }' +
    '}' +
    'applyPalette(palettePref);' +
    'applyUiLang(uiLangPref, false);' +
    'syncHeroSelects();' +
    'renderAll(false);' +
    'loadBlacklistUi();' +
    'pollHealthBadge();' +
    'setInterval(pollHealthBadge, 15000);' +
    '(async () => {' +
    '  try { const r = await fetch(ORIGIN + "/api/update/status?t=" + Date.now(), { cache: "no-store" }); if (r.ok) { const j = await r.json(); if (j && j.running) { updState.mode = "busy"; updState.stage = j.stage || "starting"; updState.percent = Number(j.percent) || 5; renderUpdateBar(); schedulePoll(800, pollUpdateStatus); return; } } } catch {}' +
    '  checkForUpdateUi(false);' +
    '})();' +
    '</script></body></html>';
}

module.exports = { renderConfigureHtml };
