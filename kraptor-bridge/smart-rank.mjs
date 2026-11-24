// Turns raw provider results into a short, readable and ranked source list.
// Ranking: Turkish audio first, then usable quality, then measured response speed.
const QUALITY_TIERS = [
  [2160, '4K'],
  [1440, '2K'],
  [1080, '1080p'],
  [720, '720p'],
  [480, '480p'],
  [360, '360p'],
];
const probeCache = new Map();
const PROBE_TTL = 10 * 60 * 1000;
const PROBE_LIMIT = 14;
const PER_PROVIDER_LIMIT = 3;

const norm = (value) => String(value || '')
  .toLocaleLowerCase('tr')
  .replace(/ı/g, 'i');

function qualityFrom(stream) {
  const source = `${stream.quality || ''} ${stream._res || ''} ${stream.name || ''} ${stream.title || ''}`;
  const explicit = Number(stream._res) || 0;
  if (explicit) return qualityLabel(explicit);
  if (/\b(4k|2160)\b/i.test(source)) return '4K';
  if (/\b(2k|1440)\b/i.test(source)) return '2K';
  if (/\bfhd\b/i.test(source)) return '1080p';
  if (/\bhd\b/i.test(source)) return '720p';
  for (const [height, label] of QUALITY_TIERS) {
    if (new RegExp(`\\b${height}p?\\b`, 'i').test(source)) return label;
  }
  return '';
}

function qualityLabel(height) {
  for (const [tier, label] of QUALITY_TIERS) if (height >= tier) return label;
  return height ? `${height}p` : '';
}

function qualityScore(label) {
  return { '1080p': 200, '720p': 190, '2K': 165, '4K': 120, '480p': 60, '360p': 20 }[label] || 90;
}

function languageFrom(stream) {
  const text = norm(`${stream.name} ${stream.title} ${stream.description || ''} ${stream.addonName || ''}`);
  const marker = stream._l || '';
  const foreign = stream._g === 'foreign' || /\byabanci\b/.test(text);
  if (/dual|çift ses|cift ses/.test(text)) return { code: 'dual', label: 'Çift Ses', score: 900 };
  if (/dublaj|dubbed|t[uü]rk[cç]e ses/.test(text) || marker === 'Dublaj') return { code: 'dub', label: 'TR Dublaj', score: 1000 };
  if (/altyaz|subtitle|sub\b/.test(text) || marker === 'Altyazı') return { code: 'sub', label: 'TR Altyazı', score: 520 };
  if (foreign) return { code: 'foreign', label: 'Yabancı', score: 260 };
  return { code: 'unknown', label: 'Dil belirsiz', score: 340 };
}

function providerFrom(stream) {
  const raw = String(stream.name || stream.addonName || '').trim();
  if (/kraptor/i.test(raw)) return 'Kraptor FHD';
  if (/cizgimax|çizgimax/i.test(raw)) return 'ÇizgiMax';
  if (/jetfilmizle/i.test(raw)) return 'JetFilmizle';
  const parts = raw.split('·').map((p) => p.trim()).filter(Boolean);
  let candidate = parts.length > 1 ? parts[parts.length - 1] : raw;
  if (parts.length === 1) {
    const known = ['Kraptor', 'Feroxx', 'JetFilmizle', 'ÇizgiMax'];
    const hit = known.find((k) => norm(candidate).includes(norm(k)));
    if (hit) return hit === 'Kraptor' ? 'Kraptor FHD' : hit;
  }
  candidate = candidate
    .replace(/\b(4k|2160p?|2k|1440p?|1080p?|720p?|480p?|360p?)\b/gi, ' ')
    .replace(/\b(tr|t[uü]rk[cç]e|dublaj|altyaz[iı]l[iı]?|altyaz[iı]|dil belirsiz|yabanci|orijinal|original|dual|çift ses)\b/gi, ' ')
    .replace(/[|()\[\]•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return candidate || 'Kaynak';
}

export async function measureLatency(url) {
  // Transcode URLs start an encoder job when opened, so never use them as a speed probe.
  const isTranscode = url.includes('/tx/') && !/[?&]c=1(?:&|$)/.test(url);
  if (isTranscode) return undefined;
  const cached = probeCache.get(url);
  if (cached && Date.now() - cached.at < PROBE_TTL) {
    return cached.ms == null ? null : { ms: cached.ms, height: cached.height || 0, turkishAudio: !!cached.turkishAudio };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal,
    });
    const ms = Date.now() - started;
    const ok = response.ok || response.status === 206;
    let height = 0;
    let turkishAudio = false;
    const contentType = response.headers.get('content-type') || '';
    if (ok && /mpegurl/i.test(contentType)) {
      try {
        const text = await response.text();
        const heights = [...text.matchAll(/RESOLUTION=\d+x(\d+)/g)].map((m) => Number(m[1]));
        if (heights.length) height = Math.max(...heights);
        turkishAudio = text.split(/\r?\n/).some((line) => /#EXT-X-MEDIA:TYPE=AUDIO/i.test(line)
          && /(LANGUAGE="(tr|tur)[^"]*"|NAME="[^"]*(t[uü]rk|turkish))/i.test(line));
      } catch {}
    } else {
      try { await response.body?.cancel(); } catch {}
    }
    probeCache.set(url, { at: Date.now(), ms: ok ? ms : null, height, turkishAudio });
    return ok ? { ms, height, turkishAudio } : null;
  } catch {
    probeCache.set(url, { at: Date.now(), ms: null, height: 0 });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function latencyBonus(ms) {
  if (ms === undefined) return 0;
  if (ms == null) return -40;
  if (ms < 700) return 130;
  if (ms < 1500) return 100;
  if (ms < 3000) return 60;
  if (ms < 6000) return 10;
  return -50;
}

function latencyText(ms) {
  if (ms === undefined) return '';
  if (ms == null) return 'yanıt yok';
  return ms < 1000 ? `${(ms / 1000).toFixed(1)} sn` : `${Math.round(ms / 1000)} sn`;
}

function badge(index) {
  return index === 0 ? '🥇 ' : index === 1 ? '🥈 ' : index === 2 ? '🥉 ' : '';
}

export async function rankStreams(streams, { probe = true } = {}) {
  if (!Array.isArray(streams) || !streams.length) return [];
  const described = streams.map((stream, order) => {
    const language = languageFrom(stream);
    const quality = qualityFrom(stream);
    const provider = providerFrom(stream);
    const lines = stream.title ? String(stream.title).split('\n').map((l) => l.trim()).filter(Boolean) : [];
    const base = lines.length > 1 ? lines[lines.length - 1] : (lines[0] || '');
    return {
      stream,
      order,
      language,
      quality,
      provider,
      detail: base,
      score: language.score + qualityScore(quality),
    };
  });

  const seenUrls = new Set();
  const unique = described.filter((item) => {
    const key = item.stream.url;
    if (!key || seenUrls.has(key)) return false;
    seenUrls.add(key);
    return true;
  });

  if (probe) {
    const probeTargets = [...unique]
      .sort((a, b) => b.score - a.score)
      .slice(0, PROBE_LIMIT);
    await Promise.allSettled(probeTargets.map(async (item) => {
      const measured = await measureLatency(item.stream.url);
      if (measured === undefined) item.latency = undefined;
      else if (measured) item.latency = measured.ms;
      else item.latency = null;
      item.score += latencyBonus(item.latency);
      if (!item.quality && measured?.height) {
        item.quality = qualityLabel(measured.height);
        item.score += qualityScore(item.quality);
      }
      if (measured?.turkishAudio && item.language.score < 900) {
        item.score += 1000 - item.language.score;
        item.language = { code: 'dub', label: 'TR Dublaj', score: 1000 };
      }
    }));
  }

  unique.sort((a, b) => b.score - a.score || a.order - b.order);

  const perProvider = new Map();
  const selected = [];
  for (const item of unique) {
    const count = perProvider.get(item.provider) || 0;
    if (count >= PER_PROVIDER_LIMIT) continue;
    perProvider.set(item.provider, count + 1);
    selected.push(item);
  }

  return selected.map((item, index) => {
    const { _res, _g, _l, quality, ...rest } = item.stream;
    const qualityText = item.quality || 'Kalite ?';
    const speedText = item.latency == null || item.latency === undefined ? '' : ` · ~${latencyText(item.latency)}`;
    const rawDetail = String(item.detail || '').replace(/\s+/g, ' ').trim();
    const detail = rawDetail.length > 58 ? `${rawDetail.slice(0, 57)}…` : rawDetail;
    return {
      ...rest,
      name: `${badge(index)}${item.language.label} · ${qualityText} · ${item.provider}`,
      title: `${item.provider}${detail ? ' — ' + detail : ''}${speedText}`,
    };
  });
}
