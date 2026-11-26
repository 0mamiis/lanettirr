#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$ROOT/.runtime"
LOG_DIR="$RUNTIME_DIR/logs"
PID_FILE="$RUNTIME_DIR/pids.txt"
mkdir -p "$LOG_DIR"

if [ -f "$ROOT/.env" ]; then
  while IFS= read -r raw || [ -n "$raw" ]; do
    line="$(printf '%s' "$raw" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    key="${line%%=*}"
    val="${line#*=}"
    key="$(printf '%s' "$key" | sed 's/[[:space:]]*$//')"
    val="$(printf '%s' "$val" | sed 's/^[[:space:]]*//')"
    if [ "${#val}" -ge 2 ]; then
      first="${val%"${val#?}"}"
      last="${val#"${val%?}"}"
      if [ "$first$last" = '""' ] || [ "$first$last" = "''" ]; then
        val="${val#?}"
        val="${val%?}"
      fi
    fi
    if [ -n "$key" ]; then export "$key=$val"; fi
  done < "$ROOT/.env"
fi

export BB_PORT="${BB_PORT:-7200}"
export EGRESS_PORT="${EGRESS_PORT:-7301}"
export EGRESS_HOST="127.0.0.1"
export BRIDGE_PORT="${BRIDGE_PORT:-7000}"
export BRIDGE_HOST="127.0.0.1"
export BRIDGE_ORIGIN="http://127.0.0.1:$BRIDGE_PORT"
export BB_HOST="http://127.0.0.1:$BB_PORT"
export HUB_PORT="${HUB_PORT:-7100}"
export HUB_HOST="127.0.0.1"
export UNIFIED_PORT="$HUB_PORT"
export NU_CONC="${NU_CONC:-12}"
export PORT="${MEGA_PORT:-${PORT:-3001}}"
export HOST="${MEGA_HOST:-${HOST:-127.0.0.1}}"
export HUB_URL="http://127.0.0.1:$HUB_PORT"

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock >/dev/null 2>&1 || true
fi

port_open() {
  local p="$1"
  if command -v node >/dev/null 2>&1; then
    node -e 'const n=require("net");const s=n.connect(Number(process.argv[1]),"127.0.0.1");s.setTimeout(350);s.on("connect",()=>{s.destroy();process.exit(0)});s.on("error",()=>process.exit(1));s.on("timeout",()=>{s.destroy();process.exit(1)});' "$p" >/dev/null 2>&1
    return $?
  fi
  return 1
}

wait_http() {
  local url="$1" secs="$2" i=0
  while [ "$i" -lt "$((secs * 2))" ]; do
    if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
    i=$((i + 1))
  done
  return 1
}

wait_port() {
  local p="$1" secs="$2" i=0
  while [ "$i" -lt "$((secs * 2))" ]; do
    if port_open "$p"; then return 0; fi
    sleep 0.5
    i=$((i + 1))
  done
  return 1
}

start_svc() {
  local name="$1" port="$2" workdir="$3"
  shift 3
  if [ "$port" -gt 0 ] && port_open "$port"; then
    echo "[SKIP] $name already listening on port $port"
    return 0
  fi
  (cd "$workdir" && nohup "$@" >"$LOG_DIR/$name.out.log" 2>"$LOG_DIR/$name.err.log" </dev/null & echo "$name $!" >> "$PID_FILE")
  echo "[START] $name (port $port)"
}

: > "$PID_FILE"
echo "=== Starting Lanettirr ==="

if [ -f "$ROOT/cs-host/lib/cs-app.jar" ] && [ -x "$ROOT/cs-host/run-host.sh" ] && command -v java >/dev/null 2>&1; then
  start_svc "cs-host" "$BB_PORT" "$ROOT/cs-host" bash "$ROOT/cs-host/run-host.sh"
  wait_http "http://127.0.0.1:$BB_PORT/health" 20 || true
else
  echo "[INFO] cs-host skipped (Java or cs-host-deps not installed)"
fi

start_svc "egress" "$EGRESS_PORT" "$ROOT/egress" node egress.mjs
wait_port "$EGRESS_PORT" 8 || true

start_svc "kraptor-bridge" "$BRIDGE_PORT" "$ROOT/kraptor-bridge" node server.mjs
wait_port "$BRIDGE_PORT" 12 || true

start_svc "trhub" "$HUB_PORT" "$ROOT/trhub" node hub.mjs
wait_http "http://127.0.0.1:$HUB_PORT/en-repo/manifest.json" 20 || true

start_svc "mega-bridge" "$PORT" "$ROOT/mega-bridge" node index.js
if wait_http "http://127.0.0.1:$PORT/health" 20; then
  echo ""
  echo "=== Lanettirr Ready ==="
  echo "  Configure UI : http://127.0.0.1:$PORT/configure"
  echo "  Nuvio Repo   : http://127.0.0.1:$PORT/saved/nuvio-repo/manifest.json"
  echo "  CloudStream  : http://127.0.0.1:$PORT/saved/cs3/repo.json"
  echo "  Fusion Badges: http://127.0.0.1:$PORT/badges.json"
  echo "  Stremio/AIO  : http://127.0.0.1:$PORT/saved/manifest.json"
  if command -v termux-toast >/dev/null 2>&1; then
    termux-toast "Lanettirr ready on :$PORT" >/dev/null 2>&1 || true
  fi
else
  echo "[WARN] mega-bridge did not respond on :$PORT yet. Check $LOG_DIR/mega-bridge.err.log"
fi

