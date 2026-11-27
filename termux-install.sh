#!/usr/bin/env bash
set -euo pipefail

REPO="${LANETTIRR_REPO:-0mamiis/lanettirr}"
BRANCH="${LANETTIRR_BRANCH:-main}"
INSTALL_DIR="${LANETTIRR_DIR:-$HOME/lanettirr}"
DEPS_URL="${LANETTIRR_DEPS_URL:-https://github.com/${REPO}/releases/latest/download/cs-host-deps.zip}"
EXPECTED_SHA256="260a9ee198fdda6a02853a6ada1866c01887c44f5a346981e6c9321120477d7e"
SKIP_CS_HOST="${SKIP_CS_HOST:-0}"
NO_START="${NO_START:-0}"

IS_TERMUX=0
if [ -n "${PREFIX:-}" ] && printf '%s' "$PREFIX" | grep -q "com.termux"; then
  IS_TERMUX=1
fi

echo "==========================================="
echo "  Lanettirr Android (Termux) Installer"
echo "==========================================="
echo "Target folder: $INSTALL_DIR"

if [ "$IS_TERMUX" -eq 1 ]; then
  echo "[1/6] Installing Termux packages (Node.js, Java, FFmpeg, Git, Curl, Unzip)..."
  pkg update -y >/dev/null 2>&1 || true
  pkg install -y nodejs-lts git curl unzip procps ffmpeg || pkg install -y nodejs git curl unzip procps ffmpeg
  if [ "$SKIP_CS_HOST" -eq 0 ]; then
    pkg install -y openjdk-21 || pkg install -y openjdk-17 || echo "[WARN] OpenJDK install failed; cs-host will be skipped."
  fi
else
  echo "[1/6] Checking system tools..."
  for bin in node npm git curl unzip; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      echo "[ERROR] Missing required tool: $bin" >&2
      exit 1
    fi
  done
fi

BAK_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t lanettirr-bak)"
cleanup() { rm -rf "$BAK_DIR" 2>/dev/null || true; }
trap cleanup EXIT

for rel in .env mega-bridge/saved-config.json mega-bridge/blacklist.json; do
  if [ -f "$INSTALL_DIR/$rel" ]; then
    mkdir -p "$BAK_DIR/$(dirname "$rel")"
    cp -f "$INSTALL_DIR/$rel" "$BAK_DIR/$rel"
  fi
done

echo "[2/6] Fetching Lanettirr ($REPO@$BRANCH)..."
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" fetch origin "$BRANCH" --depth 1
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
else
  if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]; then
    TAR_PATH="$BAK_DIR/repo.tar.gz"
    EXT_DIR="$BAK_DIR/extract"
    mkdir -p "$EXT_DIR"
    curl -fsSL --retry 3 --retry-delay 2 -o "$TAR_PATH" "https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz"
    tar -xzf "$TAR_PATH" -C "$EXT_DIR"
    SRC_ROOT="$(find "$EXT_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    cp -rf "$SRC_ROOT"/. "$INSTALL_DIR"/
  else
    git clone --depth 1 --branch "$BRANCH" "https://github.com/${REPO}.git" "$INSTALL_DIR"
  fi
fi

for rel in .env mega-bridge/saved-config.json mega-bridge/blacklist.json; do
  if [ -f "$BAK_DIR/$rel" ]; then
    mkdir -p "$INSTALL_DIR/$(dirname "$rel")"
    cp -f "$BAK_DIR/$rel" "$INSTALL_DIR/$rel"
  fi
done

echo "[3/6] Installing Node.js dependencies..."
(cd "$INSTALL_DIR/trhub" && (npm ci --no-audit --no-fund || npm install --no-audit --no-fund))
(cd "$INSTALL_DIR/mega-bridge" && (npm ci --no-audit --no-fund || npm install --no-audit --no-fund))

if [ "$SKIP_CS_HOST" -eq 0 ] && command -v java >/dev/null 2>&1; then
  if [ ! -f "$INSTALL_DIR/cs-host/lib/cs-app.jar" ] || [ ! -f "$INSTALL_DIR/cs-host/lib/android.jar" ]; then
    echo "[4/6] Downloading cs-host runtime dependencies..."
    ZIP_TMP="$BAK_DIR/cs-host-deps.zip"
    curl -fL --retry 3 --retry-delay 2 -o "$ZIP_TMP" "$DEPS_URL"
    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL_SHA="$(sha256sum "$ZIP_TMP" | awk '{print tolower($1)}')"
      if [ "$ACTUAL_SHA" != "$EXPECTED_SHA256" ]; then
        echo "[ERROR] cs-host-deps.zip SHA-256 mismatch!" >&2
        exit 1
      fi
    fi
    unzip -oq "$ZIP_TMP" -d "$INSTALL_DIR"
  else
    echo "[4/6] cs-host runtime dependencies already present."
  fi
else
  echo "[4/6] Skipping cs-host runtime dependencies."
fi

echo "[5/6] Fixing script permissions & creating shortcuts..."
for f in "$INSTALL_DIR/start.sh" "$INSTALL_DIR/stop.sh" "$INSTALL_DIR/update.sh" "$INSTALL_DIR/termux-install.sh" "$INSTALL_DIR/cs-host/run-host.sh"; do
  if [ -f "$f" ]; then
    sed -i 's/\r$//' "$f" 2>/dev/null || true
    chmod +x "$f"
    if command -v termux-fix-shebang >/dev/null 2>&1; then termux-fix-shebang "$f" >/dev/null 2>&1 || true; fi
  fi
done
for f in "$INSTALL_DIR/cs-host/tools/dex-tools-v2.4/"*.sh; do
  if [ -f "$f" ]; then
    sed -i 's/\r$//' "$f" 2>/dev/null || true
    chmod +x "$f"
    if command -v termux-fix-shebang >/dev/null 2>&1; then termux-fix-shebang "$f" >/dev/null 2>&1 || true; fi
  fi
done

if [ "$IS_TERMUX" -eq 1 ]; then
  mkdir -p "$HOME/.shortcuts"
  cat > "$HOME/.shortcuts/Lanettirr-Start" <<EOF
#!/usr/bin/env bash
"$INSTALL_DIR/start.sh"
EOF
  cat > "$HOME/.shortcuts/Lanettirr-Stop" <<EOF
#!/usr/bin/env bash
"$INSTALL_DIR/stop.sh"
EOF
  cat > "$HOME/.shortcuts/Lanettirr-Config" <<EOF
#!/usr/bin/env bash
INSTALL_DIR="$INSTALL_DIR"
EOF
  cat >> "$HOME/.shortcuts/Lanettirr-Config" <<'EOF'
PORT_VAL=""
if [ -f "$INSTALL_DIR/.env" ]; then
  PORT_VAL="$(grep -E '^[[:space:]]*MEGA_PORT[[:space:]]*=' "$INSTALL_DIR/.env" 2>/dev/null | tail -n 1 | cut -d= -f2- | sed 's/#.*//' | tr -d "\"'\r\t " || true)"
  if [ -z "$PORT_VAL" ]; then
    PORT_VAL="$(grep -E '^[[:space:]]*PORT[[:space:]]*=' "$INSTALL_DIR/.env" 2>/dev/null | tail -n 1 | cut -d= -f2- | sed 's/#.*//' | tr -d "\"'\r\t " || true)"
  fi
fi
case "$PORT_VAL" in ''|*[!0-9]*) PORT_VAL="" ;; esac
URL="http://127.0.0.1:${PORT_VAL:-${MEGA_PORT:-${PORT:-17410}}}/configure"
if command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "$URL"
elif command -v am >/dev/null 2>&1; then
  am start -a android.intent.action.VIEW -d "$URL" >/dev/null 2>&1 || true
else
  echo "Open in browser: $URL"
fi
EOF
  cat > "$HOME/.shortcuts/Lanettirr-Update" <<EOF
#!/usr/bin/env bash
"$INSTALL_DIR/update.sh"
EOF
  chmod +x "$HOME/.shortcuts/Lanettirr-"*
  if command -v termux-fix-shebang >/dev/null 2>&1; then
    termux-fix-shebang "$HOME/.shortcuts/Lanettirr-"* >/dev/null 2>&1 || true
  fi
  if [ -d "$PREFIX/bin" ] && [ -w "$PREFIX/bin" ]; then
    ln -sf "$HOME/.shortcuts/Lanettirr-Start" "$PREFIX/bin/lanettirr-start"
    ln -sf "$HOME/.shortcuts/Lanettirr-Stop" "$PREFIX/bin/lanettirr-stop"
    ln -sf "$HOME/.shortcuts/Lanettirr-Config" "$PREFIX/bin/lanettirr-config"
    ln -sf "$HOME/.shortcuts/Lanettirr-Update" "$PREFIX/bin/lanettirr-update"
  fi
fi

echo "[6/6] Finishing setup..."
if [ "$NO_START" -eq 0 ]; then
  "$INSTALL_DIR/stop.sh" >/dev/null 2>&1 || true
  "$INSTALL_DIR/start.sh"
fi

echo ""
echo "Installation complete!"
if [ "$IS_TERMUX" -eq 1 ]; then
  echo "Termux commands : lanettirr-start | lanettirr-stop | lanettirr-config | lanettirr-update"
  echo "Termux:Widget   : Add the Termux:Widget to your home screen for 1-tap Start/Stop/Config/Update."
fi

