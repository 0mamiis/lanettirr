# Third-Party Notices and Licenses

This repository bundles, wraps, or interoperates with several third-party open-source projects, runtimes, and community plugin ecosystems. All third-party components remain the property of their respective authors and are governed by their original licenses.

## Core Components & Bridges

- **nuvio-stremio-bridge / nuvio-mega-bridge** — Licensed under the **GNU General Public License v3.0 (GPL-3.0)**. Provides the Stremio addon bridge and provider execution environment adapted in `mega-bridge/`.
- **CloudStream (`cs-app.jar`)** — Licensed under the **GNU General Public License v3.0 (GPL-3.0)**. Core CloudStream API and plugin host abstractions used by the local CS3 host runtime.

## Java / Android Tooling & JVM Dependencies

- **dex-tools (dex2jar / d2j-dex2jar)** — Licensed under the **Apache License 2.0 (Apache-2.0)**. Used to translate Android DEX bytecode from CS3 plugins into JVM-loadable JAR classes.
- **OkHttp, Kotlin Standard Library, and Cryptography / JVM Libraries** — Licensed under the **Apache License 2.0 (Apache-2.0)**. Networking, language runtime, and cryptographic primitives used by the JVM CS3 host.
- **Android SDK (`android.jar`)** — Android Open Source Project (AOSP) platform stubs governed by the **Apache License 2.0 (Apache-2.0)** and the **Android Software Development Kit License Agreement**. Used solely as compile/runtime stub classes for loading CS3 plugins on a desktop JVM.

## JavaScript / Node.js Dependencies

- **quickjs-emscripten** — Licensed under the **MIT License**. WebAssembly QuickJS sandbox used for executing untrusted/isolated JavaScript snippets.
- **cheerio** — Licensed under the **MIT License**. Fast HTML parsing and DOM querying for provider scrapers.
- **webtorrent** — Licensed under the **MIT License**. BitTorrent streaming client support where enabled.

## External Tools (Installed Separately by User)

- **FFmpeg / ffprobe** — Licensed under the **LGPL-2.1+ / GPL-2.0+** (depending on build flags; e.g., Gyan.FFmpeg builds via WinGet). Invoked externally for media stream probing and HLS handling.
- **cloudflared** — Licensed under the **Apache License 2.0 (Apache-2.0)**. Optional external tunnel binary when `ENABLE_TUNNEL=1`.

## Upstream Community Repositories

- **Community Nuvio & CloudStream (CS3) Provider Repositories** — Provider manifests and scraper modules are fetched dynamically at runtime from their respective upstream community repositories and remain subject to the licenses and terms published by each upstream maintainer.
