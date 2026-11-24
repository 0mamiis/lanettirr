// Provider adapters must preserve season zero: it means Specials, never season one.
export function preserveSpecialSeason(code, repo, name) {
  if (repo === 'dexter' && name === 'VidRift') {
    const anchor = 'var s = season || 1;';
    if (!code.includes(anchor)) throw new Error('VidRift season adapter changed');
    return code.replace(anchor, 'var s = season == null ? 1 : season;');
  }
  if (repo === 'anthology' && name === 'DiziBak') {
    const anchor = 'var season = parseInt(seasonNum) || 1;';
    if (!code.includes(anchor)) throw new Error('DiziBak season adapter changed');
    return code.replace(anchor, 'var season = Number.isNaN(parseInt(seasonNum)) ? 1 : parseInt(seasonNum);')
      .replace('seasonNum = tmdbId.season || seasonNum;', 'seasonNum = tmdbId.season == null ? seasonNum : tmdbId.season;');
  }
  if (repo === 'yoruix' && name === 'Castle') {
    const anchor = 'const season = seasons.find((s) => s.number === seasonNum);';
    if (!code.includes(anchor)) throw new Error('Castle season adapter changed');
    return code.replaceAll('mediaType === "tv" && seasonNum && episodeNum', 'mediaType === "tv" && seasonNum != null && episodeNum > 0')
      .replace(anchor, anchor + '\n        if (seasonNum === 0 && !season) return [];');
  }
  return code;
}

export function matchesEpisode(result, season, episode) {
  const text = [result.name, result.title, result.description].filter(Boolean).join(' ');
  const patterns = [/(?:^|\W)S(\d{1,3})\s*E(\d{1,3})(?:\W|$)/gi, /(?:^|\W)(\d{1,3})[xX](\d{1,3})(?:\W|$)/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (Number(match[1]) !== season || Number(match[2]) !== episode) return false;
    }
  }
  return true;
}

export function matchesSpecialDuration(seconds, expectedMinutes) {
  if (!(expectedMinutes > 0) || !(seconds > 0)) return true;
  const expected = expectedMinutes * 60;
  // Editions differ, but a 45 minute pilot cannot stand in for a 3 minute minisode.
  return seconds <= Math.max(expected * 1.75, expected + 120);
}
