'use strict';

const TMDB_IMG = 'https://image.tmdb.org/t/p/';
const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';

const TMDB_LANG_MAP = {
  tr: 'tr-TR',
  en: 'en-US',
  en_us: 'en-US',
  en_uk: 'en-GB',
  de: 'de-DE',
  fr: 'fr-FR',
  fr_ca: 'fr-CA',
  es: 'es-ES',
  es_es: 'es-ES',
  es_la: 'es-MX',
  pt: 'pt-PT',
  pt_br: 'pt-BR',
  it: 'it-IT',
  ru: 'ru-RU',
  uk: 'uk-UA',
  ar: 'ar-SA',
  ja: 'ja-JP',
  ko: 'ko-KR',
  zh: 'zh-CN',
  zh_cn: 'zh-CN',
  zh_tw: 'zh-TW',
  yue: 'zh-HK',
  hi: 'hi-IN',
  pl: 'pl-PL',
  nl: 'nl-NL',
  sv: 'sv-SE',
  no: 'nb-NO',
  da: 'da-DK',
  fi: 'fi-FI',
  el: 'el-GR',
  ro: 'ro-RO',
  hu: 'hu-HU',
  cs: 'cs-CZ',
  vi: 'vi-VN',
  th: 'th-TH',
  id: 'id-ID',
  ms: 'ms-MY',
  fa: 'fa-IR',
};

const MOVIE_GENRES = [
  { id: 28, tr: 'Aksiyon', en: 'Action' },
  { id: 12, tr: 'Macera', en: 'Adventure' },
  { id: 16, tr: 'Animasyon', en: 'Animation' },
  { id: 35, tr: 'Komedi', en: 'Comedy' },
  { id: 80, tr: 'Suç', en: 'Crime' },
  { id: 99, tr: 'Belgesel', en: 'Documentary' },
  { id: 18, tr: 'Dram', en: 'Drama' },
  { id: 10751, tr: 'Aile', en: 'Family' },
  { id: 14, tr: 'Fantastik', en: 'Fantasy' },
  { id: 36, tr: 'Tarih', en: 'History' },
  { id: 27, tr: 'Korku', en: 'Horror' },
  { id: 10402, tr: 'Müzik', en: 'Music' },
  { id: 9648, tr: 'Gizem', en: 'Mystery' },
  { id: 10749, tr: 'Romantik', en: 'Romance' },
  { id: 878, tr: 'Bilim Kurgu', en: 'Science Fiction' },
  { id: 53, tr: 'Gerilim', en: 'Thriller' },
  { id: 10752, tr: 'Savaş', en: 'War' },
  { id: 37, tr: 'Vahşi Batı', en: 'Western' },
];

const SERIES_GENRES = [
  { id: 10759, tr: 'Aksiyon & Macera', en: 'Action & Adventure' },
  { id: 16, tr: 'Animasyon', en: 'Animation' },
  { id: 35, tr: 'Komedi', en: 'Comedy' },
  { id: 80, tr: 'Suç', en: 'Crime' },
  { id: 99, tr: 'Belgesel', en: 'Documentary' },
  { id: 18, tr: 'Dram', en: 'Drama' },
  { id: 10751, tr: 'Aile', en: 'Family' },
  { id: 10762, tr: 'Çocuk', en: 'Kids' },
  { id: 9648, tr: 'Gizem', en: 'Mystery' },
  { id: 10765, tr: 'Bilim Kurgu & Fantastik', en: 'Sci-Fi & Fantasy' },
  { id: 10768, tr: 'Savaş & Politik', en: 'War & Politics' },
  { id: 37, tr: 'Vahşi Batı', en: 'Western' },
];

function createCatalogModule(deps) {
  const {
    tmdbKeys,
    singleflight,
    capMap,
    runPool,
    titleCache,
    imdbResolveCache,
    resolveImdbToTmdb,
  } = deps;

  const catalogCache = new Map();
  const metaCache = new Map();
  const inflight = new Map();

  function isTurkishUi(cfg) {
    const first = String(cfg?.langs?.[0] || 'tr').toLowerCase();
    return first === 'tr';
  }

  function resolveTmdbLang(cfg) {
    const first = String(cfg?.langs?.[0] || 'tr').toLowerCase();
    return TMDB_LANG_MAP[first] || 'en-US';
  }

  function hasTurkishLang(cfg) {
    const list = Array.isArray(cfg?.langs) ? cfg.langs : ['tr', 'en'];
    return list.some(c => String(c || '').toLowerCase() === 'tr');
  }

  function genreListFor(type) {
    return type === 'series' ? SERIES_GENRES : MOVIE_GENRES;
  }

  function findGenreId(type, name) {
    const needle = String(name || '').trim().toLowerCase();
    if (!needle) return null;
    for (const g of genreListFor(type)) {
      if (g.tr.toLowerCase() === needle || g.en.toLowerCase() === needle) return g.id;
    }
    return null;
  }

  function genreNamesByIds(type, ids, useTr) {
    const byId = new Map(genreListFor(type).map(g => [g.id, useTr ? g.tr : g.en]));
    return (Array.isArray(ids) ? ids : []).map(id => byId.get(id)).filter(Boolean);
  }

  function buildCatalogsForConfig(cfg) {
    if (cfg && cfg.catalogs === false) return [];
    const tr = isTurkishUi(cfg);
    const includeTrLocal = hasTurkishLang(cfg);
    const mvGenres = MOVIE_GENRES.map(g => (tr ? g.tr : g.en));
    const tvGenres = SERIES_GENRES.map(g => (tr ? g.tr : g.en));

    const catalogs = [
      {
        type: 'movie',
        id: 'lanettirr.trending.movie',
        name: tr ? 'Trend Filmler' : 'Trending Movies',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false },
        ],
      },
      {
        type: 'movie',
        id: 'lanettirr.popular.movie',
        name: tr ? 'Popüler Filmler' : 'Popular Movies',
        extra: [
          { name: 'genre', options: mvGenres, isRequired: false },
          { name: 'skip', isRequired: false },
        ],
      },
      {
        type: 'movie',
        id: 'lanettirr.top.movie',
        name: tr ? 'En Yüksek Puanlı Filmler' : 'Top Rated Movies',
        extra: [{ name: 'skip', isRequired: false }],
      },
    ];

    if (includeTrLocal) {
      catalogs.push({
        type: 'movie',
        id: 'lanettirr.tr.movie',
        name: 'Yerli Filmler (TR)',
        extra: [{ name: 'skip', isRequired: false }],
      });
    }

    catalogs.push({
      type: 'movie',
      id: 'lanettirr.anime.movie',
      name: tr ? 'Anime Filmler' : 'Anime Movies',
      extra: [{ name: 'skip', isRequired: false }],
    });

    catalogs.push(
      {
        type: 'series',
        id: 'lanettirr.trending.series',
        name: tr ? 'Trend Diziler' : 'Trending Series',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false },
        ],
      },
      {
        type: 'series',
        id: 'lanettirr.popular.series',
        name: tr ? 'Popüler Diziler' : 'Popular Series',
        extra: [
          { name: 'genre', options: tvGenres, isRequired: false },
          { name: 'skip', isRequired: false },
        ],
      },
      {
        type: 'series',
        id: 'lanettirr.top.series',
        name: tr ? 'En Yüksek Puanlı Diziler' : 'Top Rated Series',
        extra: [{ name: 'skip', isRequired: false }],
      }
    );

    if (includeTrLocal) {
      catalogs.push({
        type: 'series',
        id: 'lanettirr.tr.series',
        name: 'Yerli Diziler (TR)',
        extra: [{ name: 'skip', isRequired: false }],
      });
    }

    catalogs.push({
      type: 'series',
      id: 'lanettirr.anime.series',
      name: tr ? 'Anime Diziler' : 'Anime Series',
      extra: [{ name: 'skip', isRequired: false }],
    });

    return catalogs;
  }

  function buildResourcesForConfig(cfg) {
    if (cfg && cfg.catalogs === false) return ['stream'];
    return [
      'catalog',
      { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tmdb:'] },
      'stream',
    ];
  }

  async function fetchTmdbJson(apiPath, timeoutMs = 8000) {
    const sep = apiPath.includes('?') ? '&' : '?';
    for (const key of tmdbKeys) {
      try {
        const res = await fetch(`https://api.themoviedb.org/3${apiPath}${sep}api_key=${key}`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;
        return await res.json();
      } catch {}
    }
    return null;
  }

  function mapTmdbPreview(item, type, useTr) {
    if (!item || !item.id) return null;
    const title = item.title || item.name || item.original_title || item.original_name || '';
    if (!title) return null;
    const dateStr = String(item.release_date || item.first_air_date || '');
    const year = /^\d{4}/.test(dateStr) ? dateStr.slice(0, 4) : undefined;
    const rating = Number(item.vote_average);
    const out = {
      id: `tmdb:${item.id}`,
      type,
      name: title,
      posterShape: 'poster',
    };
    if (item.poster_path) out.poster = `${TMDB_IMG}w500${item.poster_path}`;
    if (item.backdrop_path) out.background = `${TMDB_IMG}w1280${item.backdrop_path}`;
    if (item.overview) out.description = item.overview;
    if (year) out.releaseInfo = year;
    if (Number.isFinite(rating) && rating > 0) out.imdbRating = rating.toFixed(1);
    const genres = genreNamesByIds(type, item.genre_ids, useTr);
    if (genres.length) out.genres = genres;
    return out;
  }

  function parseExtra(extraSegment, searchParams) {
    const out = {};
    if (extraSegment) {
      for (const part of String(extraSegment).split('&')) {
        if (!part) continue;
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const rawK = part.slice(0, eq);
        const rawV = part.slice(eq + 1);
        try {
          out[decodeURIComponent(rawK)] = decodeURIComponent(rawV);
        } catch {
          out[rawK] = rawV;
        }
      }
    }
    if (searchParams) {
      for (const [k, v] of searchParams.entries()) {
        if (v !== '' && out[k] === undefined) out[k] = v;
      }
    }
    return out;
  }

  async function cinemetaCatalogFallback(type, search, skip) {
    const stType = type === 'series' ? 'series' : 'movie';
    const extras = [];
    if (search) extras.push(`search=${encodeURIComponent(search)}`);
    if (skip > 0) extras.push(`skip=${skip}`);
    const extraPath = extras.length ? `/${extras.join('&')}` : '';
    try {
      const res = await fetch(`${CINEMETA_BASE}/catalog/${stType}/top${extraPath}.json`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const j = await res.json();
      return Array.isArray(j?.metas) ? j.metas : [];
    } catch {
      return [];
    }
  }

  async function getCatalogMetas(type, catalogId, extraObj, cfg) {
    if (cfg && cfg.catalogs === false) return [];
    const stType = type === 'series' ? 'series' : 'movie';
    const mediaType = stType === 'series' ? 'tv' : 'movie';
    const tmdbLang = resolveTmdbLang(cfg);
    const useTr = tmdbLang.startsWith('tr');
    const search = String(extraObj?.search || '').trim();
    const genre = String(extraObj?.genre || '').trim();
    const skip = Math.max(0, parseInt(extraObj?.skip || '0', 10) || 0);
    const page = Math.floor(skip / 20) + 1;
    const cacheKey = `${stType}|${catalogId}|${tmdbLang}|${search}|${genre}|${page}`;
    const ttlMs = search ? (10 * 60 * 1000) : (20 * 60 * 1000);

    const hit = catalogCache.get(cacheKey);
    if (hit && Date.now() - hit.at < ttlMs) return hit.metas;

    return singleflight(inflight, `cat:${cacheKey}`, async () => {
      const hit2 = catalogCache.get(cacheKey);
      if (hit2 && Date.now() - hit2.at < ttlMs) return hit2.metas;

      let apiPath = '';
      if (search) {
        apiPath = `/search/${mediaType}?language=${encodeURIComponent(tmdbLang)}&query=${encodeURIComponent(search)}&page=${page}&include_adult=false`;
      } else if (catalogId === 'lanettirr.trending.movie' || catalogId === 'lanettirr.trending.series') {
        apiPath = `/trending/${mediaType}/week?language=${encodeURIComponent(tmdbLang)}&page=${page}`;
      } else if (catalogId === 'lanettirr.top.movie' || catalogId === 'lanettirr.top.series') {
        apiPath = `/${mediaType}/top_rated?language=${encodeURIComponent(tmdbLang)}&page=${page}`;
      } else if (catalogId === 'lanettirr.tr.movie' || catalogId === 'lanettirr.tr.series') {
        const sortBy = mediaType === 'movie' ? 'popularity.desc' : 'popularity.desc';
        apiPath = `/discover/${mediaType}?language=${encodeURIComponent(tmdbLang)}&with_original_language=tr&sort_by=${sortBy}&vote_count.gte=5&page=${page}&include_adult=false`;
      } else if (catalogId === 'lanettirr.anime.movie' || catalogId === 'lanettirr.anime.series') {
        apiPath = `/discover/${mediaType}?language=${encodeURIComponent(tmdbLang)}&with_genres=16&with_original_language=ja&sort_by=popularity.desc&page=${page}&include_adult=false`;
      } else {
        const genreId = genre ? findGenreId(stType, genre) : null;
        if (genreId) {
          apiPath = `/discover/${mediaType}?language=${encodeURIComponent(tmdbLang)}&with_genres=${genreId}&sort_by=popularity.desc&page=${page}&include_adult=false`;
        } else {
          apiPath = `/${mediaType}/popular?language=${encodeURIComponent(tmdbLang)}&page=${page}`;
        }
      }

      const data = await fetchTmdbJson(apiPath, 8000);
      let metas;
      if (data && Array.isArray(data.results)) {
        metas = data.results
          .filter(x => x && !x.adult)
          .map(x => mapTmdbPreview(x, stType, useTr))
          .filter(Boolean);
      } else {
        metas = await cinemetaCatalogFallback(stType, search, skip);
      }

      catalogCache.set(cacheKey, { metas, at: Date.now() });
      capMap(catalogCache, 400);
      return metas;
    });
  }

  function warmTitleCaches(tmdbId, mediaType, detail) {
    if (!detail) return;
    const title = detail.title || detail.name || detail.original_title || detail.original_name || null;
    const isAnimation = Array.isArray(detail.genres)
      ? detail.genres.some(g => g && (g.id === 16 || /anim/i.test(String(g.name || ''))))
      : null;
    const originalLang = detail.original_language ? String(detail.original_language).toLowerCase() : null;
    const imdbId = (detail.imdb_id || detail.external_ids?.imdb_id || '').trim() || null;
    if (title) {
      titleCache.set(`${mediaType}:${tmdbId}`, {
        title,
        isAnimation,
        originalLang,
        imdbId,
        at: Date.now(),
        ttl: 60 * 60 * 1000,
      });
      capMap(titleCache, 500);
    }
    if (imdbId && /^tt\d+$/i.test(imdbId)) {
      imdbResolveCache.set(`${mediaType}:${imdbId.toLowerCase()}`, {
        val: { tmdbId: String(tmdbId), title, mediaType, isAnimation, originalLang },
        at: Date.now(),
        ttl: 60 * 60 * 1000,
      });
      capMap(imdbResolveCache, 500);
    }
  }

  async function buildTmdbMeta(type, tmdbId, cfg) {
    const stType = type === 'series' ? 'series' : 'movie';
    const mediaType = stType === 'series' ? 'tv' : 'movie';
    const tmdbLang = resolveTmdbLang(cfg);
    const cacheKey = `${stType}|${tmdbId}|${tmdbLang}`;
    const hit = metaCache.get(cacheKey);
    if (hit && Date.now() - hit.at < (60 * 60 * 1000)) return hit.meta;

    return singleflight(inflight, `meta:${cacheKey}`, async () => {
      const hit2 = metaCache.get(cacheKey);
      if (hit2 && Date.now() - hit2.at < (60 * 60 * 1000)) return hit2.meta;

      let detail = await fetchTmdbJson(
        `/${mediaType}/${encodeURIComponent(tmdbId)}?language=${encodeURIComponent(tmdbLang)}&append_to_response=credits,external_ids`,
        8000
      );
      if (!detail || !detail.id) return null;

      // Localized overview empty fallback -> try en-US overview if missing
      if (!detail.overview && !tmdbLang.startsWith('en')) {
        const enDetail = await fetchTmdbJson(`/${mediaType}/${encodeURIComponent(tmdbId)}?language=en-US`, 5000);
        if (enDetail && enDetail.overview) detail.overview = enDetail.overview;
      }

      warmTitleCaches(tmdbId, mediaType, detail);

      const name = detail.title || detail.name || detail.original_title || detail.original_name || `TMDB ${tmdbId}`;
      const dateStr = String(detail.release_date || detail.first_air_date || '');
      const year = /^\d{4}/.test(dateStr) ? dateStr.slice(0, 4) : undefined;
      const genres = Array.isArray(detail.genres) ? detail.genres.map(g => g?.name).filter(Boolean) : [];
      const cast = Array.isArray(detail.credits?.cast)
        ? detail.credits.cast.slice(0, 8).map(c => c?.name).filter(Boolean)
        : [];
      const directors = Array.isArray(detail.credits?.crew)
        ? detail.credits.crew.filter(c => c?.job === 'Director').slice(0, 3).map(c => c.name).filter(Boolean)
        : [];
      const runtimeNum = stType === 'movie'
        ? Number(detail.runtime)
        : Number(Array.isArray(detail.episode_run_time) ? detail.episode_run_time[0] : 0);
      const rating = Number(detail.vote_average);
      const imdbId = (detail.imdb_id || detail.external_ids?.imdb_id || '').trim() || undefined;

      const meta = {
        id: `tmdb:${detail.id}`,
        type: stType,
        name,
        posterShape: 'poster',
      };
      if (imdbId) meta.imdb_id = imdbId;
      if (detail.poster_path) meta.poster = `${TMDB_IMG}w500${detail.poster_path}`;
      if (detail.backdrop_path) meta.background = `${TMDB_IMG}original${detail.backdrop_path}`;
      if (detail.overview) meta.description = detail.overview;
      if (year) meta.releaseInfo = year;
      if (genres.length) meta.genres = genres;
      if (cast.length) meta.cast = cast;
      if (directors.length) meta.director = directors;
      if (Number.isFinite(runtimeNum) && runtimeNum > 0) meta.runtime = `${runtimeNum} min`;
      if (Number.isFinite(rating) && rating > 0) meta.imdbRating = rating.toFixed(1);

      if (stType === 'series' && Array.isArray(detail.seasons)) {
        const seasonNums = detail.seasons
          .map(s => Number(s?.season_number))
          .filter(n => Number.isInteger(n) && n >= 1)
          .sort((a, b) => a - b)
          .slice(0, 40);

        const seasonResults = await runPool(seasonNums, 6, async (sNum) => {
          const sData = await fetchTmdbJson(
            `/tv/${encodeURIComponent(tmdbId)}/season/${sNum}?language=${encodeURIComponent(tmdbLang)}`,
            8000
          );
          if (!sData || !Array.isArray(sData.episodes)) return [];
          return sData.episodes.map(ep => {
            const epNum = Number(ep?.episode_number);
            if (!Number.isInteger(epNum) || epNum < 1) return null;
            const v = {
              id: `tmdb:${detail.id}:${sNum}:${epNum}`,
              title: ep.name || `Bölüm ${epNum}`,
              season: sNum,
              episode: epNum,
            };
            if (ep.air_date) v.released = `${ep.air_date}T00:00:00.000Z`;
            if (ep.still_path) v.thumbnail = `${TMDB_IMG}w500${ep.still_path}`;
            if (ep.overview) v.overview = ep.overview;
            return v;
          }).filter(Boolean);
        });

        const videos = seasonResults.flat().sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
        if (videos.length) meta.videos = videos;
      }

      metaCache.set(cacheKey, { meta, at: Date.now() });
      capMap(metaCache, 300);
      return meta;
    });
  }

  async function getMetaItem(type, rawId, cfg) {
    const stType = type === 'series' ? 'series' : 'movie';
    const cleanId = String(rawId || '').trim();
    if (!cleanId) return null;

    if (/^tmdb:\d+$/i.test(cleanId)) {
      return buildTmdbMeta(stType, cleanId.slice(5), cfg);
    }
    if (/^\d+$/.test(cleanId)) {
      return buildTmdbMeta(stType, cleanId, cfg);
    }
    if (/^tt\d+$/i.test(cleanId)) {
      const resolved = await resolveImdbToTmdb(cleanId, stType === 'series' ? 'tv' : 'movie');
      if (resolved && resolved.tmdbId) {
        const m = await buildTmdbMeta(resolved.mediaType === 'tv' ? 'series' : 'movie', resolved.tmdbId, cfg);
        if (m) return { ...m, id: cleanId };
      }
      try {
        const res = await fetch(`${CINEMETA_BASE}/meta/${stType}/${encodeURIComponent(cleanId)}.json`, {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const j = await res.json();
          if (j && j.meta) return j.meta;
        }
      } catch {}
    }
    return null;
  }

  return {
    buildCatalogsForConfig,
    buildResourcesForConfig,
    parseExtra,
    getCatalogMetas,
    getMetaItem,
  };
}

module.exports = { createCatalogModule };
