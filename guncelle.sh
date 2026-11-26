#!/usr/bin/env bash
set -euo pipefail

REPO="${LANETTIRR_UPDATE_REPO:-0mamiis/lanettirr}"
BRANCH="${LANETTIRR_UPDATE_BRANCH:-main}"
FROM_UI=0
NO_RESTART=0
SKIP_NPM=0
STATUS_FILE=""
TARGET_VER=""

while [ $# -gt 0 ]; do
  case "$1" in
    --from-ui) FROM_UI=1; shift ;;
    --no-restart) NO_RESTART=1; shift ;;
    --skip-npm) SKIP_NPM=1; shift ;;
    --status-file) STATUS_FILE="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --target-version) TARGET_VER="$2"; shift 2 ;;
    *) shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR"
RUNTIME_DIR="$ROOT/.runtime"
mkdir -p "$RUNTIME_DIR"
if [ -z "$STATUS_FILE" ]; then
  STATUS_FILE="$RUNTIME_DIR/update-status.json"
else
  mkdir -p "$(dirname "$STATUS_FILE")"
fi

read_local_ver() {
  for f in "$ROOT/VERSION" "$ROOT/mega-bridge/VERSION"; do
    if [ -f "$f" ]; then
      tr -d '\r\n ' < "$f" | sed 's/^v//'
      return 0
    fi
  done
  echo "0.0.0"
}

CUR_VER="$(read_local_ver)"
if [ -z "$TARGET_VER" ]; then TARGET_VER="$CUR_VER"; fi
STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date)"
LAST_PCT=5

write_status() {
  local running="$1" stage="$2" pct="$3" msg="$4" done="$5" err="$6"
  LAST_PCT="$pct"
  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date)"
  local tmp="${STATUS_FILE}.tmp.$$"
  if command -v node >/dev/null 2>&1; then
    node -e 'const fs=require("fs");const [r,st,pc,m,dn,er,cv,tv,sa,ua,out]=process.argv.slice(1);fs.writeFileSync(out,JSON.stringify({running:r==="true",stage:st,percent:Number(pc)||0,message:m,done:dn==="true",error:er||null,currentVersion:cv,targetVersion:tv,startedAt:sa,updatedAt:ua},null,2));' "$running" "$stage" "$pct" "$msg" "$done" "$err" "$CUR_VER" "$TARGET_VER" "$STARTED_AT" "$now" "$tmp"
  else
    printf '{"running":%s,"stage":"%s","percent":%s,"message":"%s","done":%s,"error":%s,"currentVersion":"%s","targetVersion":"%s","startedAt":"%s","updatedAt":"%s"}\n' "$running" "$stage" "$pct" "$msg" "$done" "$([ -n "$err" ] && printf '"%s"' "$err" || printf 'null')" "$CUR_VER" "$TARGET_VER" "$STARTED_AT" "$now" > "$tmp"
  fi
  mv -f "$tmp" "$STATUS_FILE"
}

say() {
  if [ "$FROM_UI" -eq 0 ]; then printf '%s\n' "$1"; fi
}

TMP_WORK="$(mktemp -d 2>/dev/null || mktemp -d -t lanettirr-upd)"
cleanup() { rm -rf "$TMP_WORK" 2>/dev/null || true; }
on_err() {
  local code=$?
  write_status false "error" "$LAST_PCT" "Update failed" false "Update exited with code $code" || true
  say "[HATA] Guncelleme basarisiz (kod: $code)"
  cleanup
  exit "$code"
}
trap on_err ERR
trap cleanup EXIT

say "=== Lanettirr Guncelleyici ==="
write_status true "starting" 5 "Starting update..." false ""

if command -v curl >/dev/null 2>&1; then
  RV="$(curl -fsSL --max-time 10 "https://raw.githubusercontent.com/${REPO}/${BRANCH}/VERSION" 2>/dev/null | tr -d '\r\n ' | sed 's/^v//' || true)"
  if [ -n "$RV" ]; then TARGET_VER="$RV"; fi
fi

say "[1/5] Ayarlar yedekleniyor..."
write_status true "backup" 15 "Backing up user settings..." false ""
BAK_DIR="$TMP_WORK/backup"
mkdir -p "$BAK_DIR"
for rel in .env mega-bridge/saved-config.json mega-bridge/blacklist.json saved-config.json blacklist.json; do
  if [ -f "$ROOT/$rel" ]; then
    mkdir -p "$BAK_DIR/$(dirname "$rel")"
    cp -f "$ROOT/$rel" "$BAK_DIR/$rel"
  fi
done

hash_file() {
  if [ ! -f "$1" ]; then echo ""; return 0; fi
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; return 0; fi
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; return 0; fi
  wc -c < "$1"
}

TR_PKG_B="$(hash_file "$ROOT/trhub/package.json")"
TR_LCK_B="$(hash_file "$ROOT/trhub/package-lock.json")"
MB_DIR="$ROOT/mega-bridge"
if [ ! -d "$MB_DIR" ] && [ -f "$ROOT/index.js" ]; then MB_DIR="$ROOT"; fi
MB_PKG_B="$(hash_file "$MB_DIR/package.json")"
MB_LCK_B="$(hash_file "$MB_DIR/package-lock.json")"

if [ -d "$ROOT/.git" ] && command -v git >/dev/null 2>&1; then
  say "[2/5] Git uzerinden son surum cekiliyor..."
  write_status true "download" 35 "Fetching latest version via Git..." false ""
  git -C "$ROOT" fetch origin "$BRANCH" --depth 1
  write_status true "extract" 55 "Applying updated files..." false ""
  git -C "$ROOT" reset --hard "origin/$BRANCH"
else
  say "[2/5] Son surum indiriliyor..."
  write_status true "download" 35 "Downloading latest package..." false ""
  TAR_URL="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz"
  TAR_PATH="$TMP_WORK/repo.tar.gz"
  EXT_DIR="$TMP_WORK/extract"
  mkdir -p "$EXT_DIR"
  curl -fsSL --retry 3 --retry-delay 2 -o "$TAR_PATH" "$TAR_URL"
  say "[3/5] Dosyalar cikariliyor ve uygulaniyor..."
  write_status true "extract" 55 "Extracting and applying files..." false ""
  tar -xzf "$TAR_PATH" -C "$EXT_DIR"
  SRC_ROOT="$(find "$EXT_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [ -z "$SRC_ROOT" ]; then exit 1; fi
  if [ "$MB_DIR" = "$ROOT" ] && [ -d "$SRC_ROOT/mega-bridge" ]; then
    for f in index.js configure-ui.js configure-i18n.js badges-custom.json lang-repos.json package.json package-lock.json VERSION; do
      if [ -f "$SRC_ROOT/mega-bridge/$f" ]; then cp -f "$SRC_ROOT/mega-bridge/$f" "$ROOT/$f"; fi
    done
    if [ -f "$SRC_ROOT/guncelle.sh" ]; then cp -f "$SRC_ROOT/guncelle.sh" "$ROOT/guncelle.sh" && chmod +x "$ROOT/guncelle.sh"; fi
  else
    (cd "$SRC_ROOT" && find . -type f) | while IFS= read -r rel; do
      clean="${rel#./}"
      case "$clean" in
        .git/*|.runtime/*|node_modules/*|*/node_modules/*|.env|cloudflared.exe|mega-bridge/saved-config.json|mega-bridge/blacklist.json|saved-config.json|blacklist.json|trhub/speed.json|trhub/provstat.json|trhub/tl/*|kraptor-bridge/cache/*|kraptor-bridge/tx/*|cs-host/cache/*|cs-host/lib/*|cs-host/tools/*) continue ;;
      esac
      mkdir -p "$ROOT/$(dirname "$clean")"
      cp -f "$SRC_ROOT/$clean" "$ROOT/$clean"
    done
    if [ -f "$ROOT/guncelle.sh" ]; then chmod +x "$ROOT/guncelle.sh"; fi
  fi
fi

for rel in .env mega-bridge/saved-config.json mega-bridge/blacklist.json saved-config.json blacklist.json; do
  if [ -f "$BAK_DIR/$rel" ] && [ ! -f "$ROOT/$rel" ]; then
    mkdir -p "$ROOT/$(dirname "$rel")"
    cp -f "$BAK_DIR/$rel" "$ROOT/$rel"
  fi
done

write_status true "install" 75 "Checking dependencies..." false ""
if [ "$SKIP_NPM" -eq 0 ] && command -v npm >/dev/null 2>&1; then
  if [ -f "$ROOT/trhub/package.json" ]; then
    if [ ! -d "$ROOT/trhub/node_modules" ] || [ "$TR_PKG_B" != "$(hash_file "$ROOT/trhub/package.json")" ] || [ "$TR_LCK_B" != "$(hash_file "$ROOT/trhub/package-lock.json")" ]; then
      say "[4/5] trhub paketleri guncelleniyor..."
      (cd "$ROOT/trhub" && npm install --no-audit --no-fund >/dev/null 2>&1)
    fi
  fi
  if [ -f "$MB_DIR/package.json" ]; then
    if [ ! -d "$MB_DIR/node_modules" ] || [ "$MB_PKG_B" != "$(hash_file "$MB_DIR/package.json")" ] || [ "$MB_LCK_B" != "$(hash_file "$MB_DIR/package-lock.json")" ]; then
      say "[4/5] mega-bridge paketleri guncelleniyor..."
      (cd "$MB_DIR" && npm install --no-audit --no-fund >/dev/null 2>&1)
    fi
  fi
fi

CUR_VER="$(read_local_ver)"
if [ "$CUR_VER" != "0.0.0" ]; then TARGET_VER="$CUR_VER"; fi

if [ "$NO_RESTART" -eq 0 ]; then
  say "[5/5] Servisler yeniden baslatiliyor..."
  write_status true "restart" 90 "Restarting services..." false ""
  if [ "$FROM_UI" -eq 1 ]; then sleep 0.5; fi
  if [ -x "$ROOT/stop.sh" ] && [ -x "$ROOT/start.sh" ]; then
    "$ROOT/stop.sh" >/dev/null 2>&1 || true
    sleep 1
    "$ROOT/start.sh" >/dev/null 2>&1 || true
  elif [ -x "$HOME/.shortcuts/lanettirr-stop" ] && [ -x "$HOME/.shortcuts/lanettirr-start" ]; then
    "$HOME/.shortcuts/lanettirr-stop" >/dev/null 2>&1 || true
    sleep 1
    "$HOME/.shortcuts/lanettirr-start" >/dev/null 2>&1 || true
  else
    pkill -f "mega-bridge/index.js" >/dev/null 2>&1 || pkill -f "$MB_DIR/index.js" >/dev/null 2>&1 || true
    sleep 1
    nohup node "$MB_DIR/index.js" >"$RUNTIME_DIR/mega-bridge.out.log" 2>"$RUNTIME_DIR/mega-bridge.err.log" &
  fi
  MEGA_PORT="${MEGA_PORT:-${PORT:-3001}}"
  for _ in $(seq 1 25); do
    if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "http://127.0.0.1:${MEGA_PORT}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
fi

write_status false "done" 100 "Updated to v${CUR_VER}" true ""
say "[OK] Guncelleme tamamlandi! Aktif surum: v${CUR_VER}"
