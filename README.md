# lanettirr

Self-hosted **Lanettirr (Mega Bridge)** + **TR Hub** + **EN Hub** package — brings hundreds of torrent-free VOD sources across 48 languages to **Nuvio** and **Stremio / AIOStreams** with real `ffprobe` stream verification, automatic failover, and custom badges.

Repository: https://github.com/0mamiis/lanettirr

## Features

- **Unified Multi-Language Hub (48 Languages)**:
  - **TR Hub**: 193+ Turkish sources (CloudStream `.cs3` + Nuvio TR repositories) with verified dub/subtitle separation.
  - **EN Hub**: 154+ deduplicated English sources from 10 EN repositories (torrent providers excluded).
  - **46 Additional Languages**: 87 Nuvio JS + 38 CloudStream (CS3) repositories, strictly VOD-focused (no torrents or live TV).
- **Web Configuration Panel (`/configure`)**:
  - Auto-detected 48-language interface (including RTL support).
  - Language selection with drag-and-drop priority ordering.
  - Per-language repository and per-provider enable/disable toggles.
  - Resolution filters (`4K / 2K / 1080p / 720p / 480p`), plus per-quality and per-hub result limits.
  - Customizable stream sorting (default: **Quality → Bitrate → Speed → Dub**).
  - Sequential hub loading (`hseq`), provider timeouts, automatic failover timer, and blacklist management.
  - Built-in automatic update checker and one-click **Update** button with a live progress bar.
- **Real Video Probing (`ffprobe`) & Clean 2-Line Cards**:
  - Top line shows real measured resolution, bitrate (`Mbps`), and response time (`ms`).
  - Bottom line displays verified language/dub metadata along with container, HDR, video/audio codec, and channel tags (`MKV/MP4`, `HDR10`, `Dolby Vision`, `HEVC/H.264/AV1`, `5.1`, `AAC`, `Dual/Multi Audio`, `Multi Sub`).
- **Custom Fusion Badges URL (`/badges.json`)**:
  - Local/tunnel endpoint serving the 220-badge `FR-Badges` pack ordered by **Quality → Language/Dub → Container → HDR/Bit Depth → Codec/Audio**.
- **Automatic Failover, Blacklist & Download Support**:
  - The `/play/` pipeline automatically blacklists broken or timed-out streams and falls back to the next working source.
  - The `/p/` proxy includes SSRF protection as well as `HEAD`, `Range` (`206`), and continuous streaming support compatible with Nuvio's built-in download button.

## 3-Step Installation (Windows)

1. **Download & extract**: On the [GitHub page](https://github.com/0mamiis/lanettirr), click **Code → Download ZIP** and extract the archive to a folder. If Windows SmartScreen warns you, select **More info → Run anyway**.
2. **Run setup**: Double-click `kur.bat`. Node.js, Java 21, FFmpeg/`ffprobe`, required npm packages, and `cs-host-deps.zip` are installed automatically.
3. **Start services**: Run `baslat.bat` and wait until all services report ready (`HAZIR`).

## Nuvio Desktop Setup

### 1. Configuration Panel (Recommended First Step)

Open the web panel in your browser to configure and save your languages, repositories, sorting, and failover settings:

- **Configuration Panel**: `http://127.0.0.1:3001/configure`

### 2. Plugins (Lanettirr Multi-Language Hub)

Go to **Settings → Media → Content & Discovery → Plugins** and add the following URL:

- **Lanettirr (Using Saved Config)**: `http://127.0.0.1:3001/saved/nuvio-repo/manifest.json`

On the same screen, enable **"Group plugin providers by repository"**.

*(Optional raw hub endpoints are also available directly: `http://127.0.0.1:7100/nuvio-repo/manifest.json` and `http://127.0.0.1:7100/en-repo/manifest.json`.)*

### 3. Fusion Badges URL (Recommended)

To display stream card icons in the proper **Quality → Language/Dub → Container → HDR → Codec** order, set **Appearance → Layout → Streams → Fusion Badges URL** to:

- **Fusion Badges**: `http://127.0.0.1:3001/badges.json`

### 4. Stremio / AIOStreams & Compatible Apps (Optional)

To use Lanettirr with Stremio, AIOStreams, or any Stremio-compatible client:

- **Stremio Manifest**: `http://127.0.0.1:3001/saved/manifest.json`

## Daily Usage

- **Start**: `baslat.bat`
- **Stop**: `durdur.bat`
- **Update**: Click the one-click **Update** button in the top bar of the web configuration panel (`http://127.0.0.1:3001/configure`), or run `guncelle.bat` (Windows) / `./guncelle.sh` (Linux/Termux). Your user data (`saved-config.json`, `blacklist.json`, `.env`) is preserved automatically during updates.
- **Health check**: `http://127.0.0.1:3001/health`
- **Auto-start on Windows boot**: Create a shortcut to `scripts/start-hidden.vbs` inside your Windows Startup folder (`shell:startup`) to launch the services silently in the background at login.

## Optional: Phone / Remote Access & AIOStreams

To access your self-hosted instance from your phone or connect it to AIOStreams externally:

1. Copy `.env.example` and rename the copy to `.env`.
2. Set `ENABLE_TUNNEL=1` inside `.env` and, if needed, fill in your AIOStreams variables (`AIOSTREAMS_BASE_URL`, `AIOSTREAMS_UUID`, `AIOSTREAMS_PASSWORD`).
3. Install `cloudflared` if it is not already installed (`winget install Cloudflare.cloudflared`), then restart services with `baslat.bat`.
4. The generated tunnel URL is written to `.runtime/tunnel-url.txt`. The same `/configure`, `/saved/nuvio-repo/manifest.json`, `/saved/manifest.json`, and `/badges.json` endpoints work over the tunnel URL as well.

## Quick Troubleshooting

- **SmartScreen / PowerShell warning**: The `.bat` scripts invoke PowerShell with `-ExecutionPolicy Bypass`. Click **More info → Run anyway** if Windows prompts you.
- **No streams showing in Nuvio**: Verify the services are running (`http://127.0.0.1:3001/health`). After configuration or update changes, run `durdur.bat` followed by `baslat.bat`, then refresh plugins in Nuvio.
- **Mbps or codec badges missing on cards**: `ffprobe` must be available. `kur.bat` installs FFmpeg automatically via WinGet, or you can set `FFPROBE_PATH` / `MEGA_FFPROBE` in `.env`.
- **Port conflict (`7100` or `3001`)**: Run `durdur.bat` first to stop leftover processes, then start cleanly with `baslat.bat`.
- **Incomplete setup**: Simply run `kur.bat` again; it checks for and installs any missing components.

## License & Third-Party Notices

- Project license: [LICENSE](LICENSE)
- Third-party licenses and notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## Support / Donate

If you would like to support the project, you can donate using the addresses below:

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

