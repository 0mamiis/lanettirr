'use strict';

/**
 * Optional AIOStreams manifest updater for Nuvio Mega Bridge.
 *
 * Reads credentials from environment variables or repo-root .env without
 * overwriting already-set process.env values. Exits cleanly (code 0) when
 * AIOStreams configuration is omitted so watchdogs can run in local-only mode.
 *
 * Usage:
 *   node scripts/update-aio.js <https://your-tunnel-url>
 */

const fs = require('fs');
const path = require('path');

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const cleaned = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eq = cleaned.indexOf('=');
    if (eq <= 0) continue;
    const key = cleaned.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key] !== '') continue;
    let val = cleaned.slice(eq + 1).trim();
    if (val.length >= 2) {
      const q = val[0];
      if ((q === String.fromCharCode(34) || q === String.fromCharCode(39)) && val.endsWith(q)) {
        val = val.slice(1, -1);
      }
    }
    process.env[key] = val;
  }
}

loadDotEnv(path.resolve(__dirname, '..', '.env'));

const baseUrl = (process.env.AIOSTREAMS_BASE_URL || '').trim().replace(/\/+$/, '');
const uuid = (process.env.AIOSTREAMS_UUID || '').trim();
const password = (process.env.AIOSTREAMS_PASSWORD || '').trim();
const instanceId = (process.env.AIOSTREAMS_INSTANCE_ID || 'nmb').trim() || 'nmb';
const applyPreset = String(process.env.AIOSTREAMS_APPLY_PRESET || '0').trim() === '1';

const rawTunnelUrl = String(process.argv[2] || process.env.MEGA_BRIDGE_URL || '').trim();

if (!baseUrl || !uuid || !password) {
  console.log('[update-aio] AIOSTREAMS_BASE_URL, AIOSTREAMS_UUID, or AIOSTREAMS_PASSWORD not set; skipping AIOStreams sync.');
  process.exit(0);
}

if (!/^https?:\/\//i.test(rawTunnelUrl)) {
  console.error('[update-aio] Missing or invalid bridge URL argument. Usage: node scripts/update-aio.js <https://your-tunnel-url>');
  process.exit(1);
}

const trimmedUrl = rawTunnelUrl.replace(/\/+$/, '');
const manifestUrl = trimmedUrl.endsWith('/manifest.json') ? trimmedUrl : trimmedUrl + '/manifest.json';
const authHeader = 'Basic ' + Buffer.from(uuid + ':' + password).toString('base64');

const PRISM_NAME = "{stream.filename::~Mega[\"Mega - \"||\"\"]}{stream.resolution::exists[\"{stream.resolution::replace('2160p','4K')::replace('1440p','2K')::replace('1080p','1080p')::replace('720p','720p')::replace('576p','576p')::replace('480p','480p')::replace('360p','360p')::replace('240p','240p')::replace('144p','144p')}\"||\"Mega\"]}";
const PRISM_DESCRIPTION = ["{stream.filename::~Mega[\"{stream.filename}\"||\"\"]}","{?🎥 {stream.quality} ?}{?📺 {stream.visualTags::join(' | ')} ?}{?🎞️ {stream.encode} ?}","{?🎧 {stream.audioTags::join(' | ')} ?}{?🔊 {stream.audioChannels::join(' | ')} ?}{stream.languages::exists[\"🗣️ {stream.languageEmojis::join(' / ')}\"||\"\"]}","{stream.size::>0[\"📦 {stream.size::sbytes} \"||\"\"]}{?🔍 {stream.indexer}?}","{?ℹ️ {stream.message}?}"].join('\n');

async function main() {
  const getRes = await fetch(baseUrl + '/api/v1/user', {
    headers: { Authorization: authHeader },
  });
  if (!getRes.ok) {
    throw new Error('GET /api/v1/user failed with HTTP ' + getRes.status);
  }
  const payload = await getRes.json();
  if (!payload || !payload.success || !payload.data || !payload.data.userData) {
    throw new Error('Unexpected AIOStreams /api/v1/user response');
  }

  const userData = payload.data.userData;
  const presets = Array.isArray(userData.presets) ? userData.presets : [];
  const targetPreset = presets.find((p) => p && p.instanceId === instanceId);

  if (!targetPreset) {
    console.warn('[update-aio] No AIOStreams preset found with instanceId="' + instanceId + '". Skipping manifest update.');
    process.exit(0);
  }

  targetPreset.options = targetPreset.options || {};
  targetPreset.options.manifestUrl = manifestUrl;

  if (applyPreset) {
    userData.excludedResolutions = ['240p', '360p'];
    userData.sortCriteria = {
      global: [
        { key: 'language', direction: 'desc' },
        { key: 'resolution', direction: 'desc' },
        { key: 'quality', direction: 'desc' },
        { key: 'cached', direction: 'desc' },
        { key: 'seeders', direction: 'desc' },
        { key: 'bitrate', direction: 'desc' },
      ],
    };
    userData.formatter = {
      id: 'prism',
      definitions: {
        overrides: {
          prism: { name: PRISM_NAME, description: PRISM_DESCRIPTION },
        },
      },
    };
  }

  const putRes = await fetch(baseUrl + '/api/v1/user', {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ config: userData }),
  });
  if (!putRes.ok) {
    throw new Error('PUT /api/v1/user failed with HTTP ' + putRes.status);
  }
  const out = await putRes.json();
  if (!out || !out.success) {
    throw new Error('AIOStreams rejected config update: ' + JSON.stringify(out));
  }
  console.log('[update-aio] Updated preset "' + instanceId + '" manifestUrl -> ' + manifestUrl + (applyPreset ? ' (with optional Prism/sort preset)' : ''));
}

main().catch((err) => {
  console.error('[update-aio] Error:', err && err.message ? err.message : err);
  process.exit(1);
});
