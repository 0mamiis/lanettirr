# Lanettirr

[![Latest Release](https://img.shields.io/github/v/release/0mamiis/lanettirr?style=flat-square)](https://github.com/0mamiis/lanettirr/releases/latest)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20Android%20(Termux)%20%7C%20Linux-2ea44f?style=flat-square)](#installation)
[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/FSAVeeGHe)

Self-hosted, torrent-free VOD hub across **48 languages** for **Nuvio**, **CloudStream (CS3)**, and **Stremio** — featuring real `ffprobe` stream analysis, automatic failover, and custom badges.

## Highlights

- **48 Languages, Zero Torrents**: Combines 193+ Turkish sources, 154+ deduplicated English sources, and 125+ multi-language Nuvio & CloudStream repositories strictly focused on direct VOD streams.
- **Real `ffprobe` Verification**: Measures actual resolution, bitrate (`Mbps`), latency (`ms`), codecs, HDR/Dolby Vision, container, and verified dub/audio tracks — displayed on clean 2-line stream cards.
- **Auto Failover & Download Support**: Broken or timed-out sources are automatically blacklisted and skipped in real time; the proxy supports `HEAD` and `Range` (`206`) for direct downloads.
- **48-Language Web Panel (`/configure`)**: Drag-and-drop language priority, per-repo/provider toggles, resolution caps, custom sorting (default: **Quality → Bitrate → Speed → Dub**), blacklist management, and a one-click **Update** button.
- **Native App Integrations**: Works out of the box with **Nuvio** (+ custom 220-badge `/badges.json`), **CloudStream (CS3)** (dynamic `.cs3` packaging), and **Stremio**.

## Installation

### Windows (3 Steps)

1. Click **Code → Download ZIP** (or clone this repo) and extract it to a folder.
2. Run `kur.bat` to automatically install Node.js, Java 21, FFmpeg/`ffprobe`, npm packages, and `cs-host-deps.zip`.
3. Run `baslat.bat` and wait until all services report ready (`HAZIR`).

> If Windows SmartScreen warns you on `.bat` files, click **More info → Run anyway**.

### Android / Termux (1 Command)

Install [Termux](https://f-droid.org/packages/com.termux/) from F-Droid (and optionally [Termux:Widget](https://f-droid.org/packages/com.termux.widget/) for home-screen shortcuts), then run:

```bash
curl -fsSL https://raw.githubusercontent.com/0mamiis/lanettirr/main/termux-install.sh | bash
```

This installs all dependencies into `~/lanettirr`, sets up `cs-host-deps.zip`, creates Termux:Widget shortcuts and CLI commands (`lanettirr-start`, `lanettirr-stop`, `lanettirr-config`, `lanettirr-update`), and starts the hub on `127.0.0.1:17410`.

## Client Setup

First, open **`http://127.0.0.1:17410/configure`** in your browser to choose your languages, sorting, and filters, then save.

### Quick URL Reference

| Target | URL |
| :--- | :--- |
| **Web Config Panel** | `http://127.0.0.1:17410/configure` |
| **Nuvio Plugins Repo** | `http://127.0.0.1:17410/saved/nuvio-repo/manifest.json` |
| **Nuvio Fusion Badges** | `http://127.0.0.1:17410/badges.json` |
| **CloudStream (CS3) Repo** | `http://127.0.0.1:17410/saved/cs3/repo.json` |
| **Stremio Manifest** | `http://127.0.0.1:17410/saved/manifest.json` |
| **Health Check** | `http://127.0.0.1:17410/health` |

### Nuvio

1. Go to **Settings → Media → Content & Discovery → Plugins** and add `http://127.0.0.1:17410/saved/nuvio-repo/manifest.json`.
2. On the same screen, enable **Group plugin providers by repository**.
3. *(Recommended)* Go to **Appearance → Layout → Streams → Fusion Badges URL** and set `http://127.0.0.1:17410/badges.json` so stream badges appear in **Quality → Language/Dub → Container → HDR → Codec** order.

### CloudStream (CS3)

1. Open **CloudStream → Settings → Extensions → Add repository** and add `http://127.0.0.1:17410/saved/cs3/repo.json` (or tap **Open in CloudStream** from `/configure`).
2. Install the **Lanettirr** extension. Any changes saved in `/configure` apply immediately without reinstalling.

### Stremio

Add `http://127.0.0.1:17410/saved/manifest.json` as a custom addon URL in Stremio or any Stremio-compatible client.

## Daily Commands

| Action | Windows | Android (Termux) / Linux |
| :--- | :--- | :--- |
| **Start** | `baslat.bat` | `lanettirr-start` or `./start.sh` |
| **Stop** | `durdur.bat` | `lanettirr-stop` or `./stop.sh` |
| **Config UI** | `ayarlar.bat` | `lanettirr-config` or `Lanettirr-Config` widget |
| **Update** | `guncelle.bat` or UI **Update** button | `lanettirr-update`, `./guncelle.sh`, or UI **Update** button |

User data (`saved-config.json`, `blacklist.json`, `.env`) is preserved automatically during updates. To start silently on Windows login, place a shortcut to `scripts/start-hidden.vbs` in `shell:startup`.

<details>
<summary><strong>Optional: Remote Access via Cloudflare Tunnel</strong></summary>

1. Copy `.env.example` to `.env` and set `ENABLE_TUNNEL=1`.
2. Install `cloudflared` (Windows: `winget install Cloudflare.cloudflared`) and restart with `baslat.bat`.
3. Read the generated URL from `.runtime/tunnel-url.txt`. All endpoints (`/configure`, `/saved/nuvio-repo/manifest.json`, `/saved/cs3/repo.json`, `/saved/manifest.json`, `/badges.json`) work over the tunnel URL.

</details>

<details>
<summary><strong>Troubleshooting</strong></summary>

- **No streams showing**: Check `http://127.0.0.1:17410/health`. After config changes or updates, restart services (`durdur.bat` then `baslat.bat`) and refresh plugins.
- **Missing Mbps or codec badges**: Ensure `ffprobe` is installed (re-run `kur.bat`, or set `FFPROBE_PATH` / `MEGA_FFPROBE` in `.env`).
- **Port conflict (`7100` or `17410`)**: Run `durdur.bat` (or `./stop.sh`) first to clear leftover processes, then start again.
- **Incomplete setup**: Re-run `kur.bat` (or the Termux install command); it skips existing files and installs anything missing.

</details>

## Community

Join our Discord server for updates, support, and discussion: [discord.gg/FSAVeeGHe](https://discord.gg/FSAVeeGHe)

## Support / Donate

If you find Lanettirr useful, you can support the project via:

| Asset | Network | Address |
| :--- | :--- | :--- |
| **USDT** | **X Layer** | `XKOde2f6fbcdace36d5ceebdf545e992d3036269259` |
| **USDT** | **Tron (TRC20)** | `TNxCAUc1EJvRvAmEAVK5iAKrJBXp6MuJsA` |

## Star History

<a href="https://www.star-history.com/#0mamiis/lanettirr&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=0mamiis/lanettirr&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=0mamiis/lanettirr&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=0mamiis/lanettirr&type=Date" />
  </picture>
</a>

## License

Licensed under [GPL-3.0](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party licenses.
