#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT/.runtime/pids.txt"

if [ -f "$PID_FILE" ]; then
  while read -r name pid; do
    if [ -n "${pid:-}" ] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

for pat in "$ROOT/mega-bridge/index.js" "$ROOT/trhub/hub.mjs" "$ROOT/kraptor-bridge/server.mjs" "$ROOT/egress/egress.mjs" "mega-bridge/index.js" "trhub/hub.mjs" "kraptor-bridge/server.mjs" "egress/egress.mjs" "cs-host/out.*Host" "run-host.sh"; do
  pkill -f "$pat" >/dev/null 2>&1 || true
done

if command -v termux-wake-unlock >/dev/null 2>&1; then
  termux-wake-unlock >/dev/null 2>&1 || true
fi

echo "[OK] Lanettirr stopped."
if command -v termux-toast >/dev/null 2>&1; then
  termux-toast "Lanettirr stopped" >/dev/null 2>&1 || true
fi

