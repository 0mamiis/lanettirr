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

pkill -f "mega-bridge/index.js" >/dev/null 2>&1 || true
pkill -f "trhub/hub.mjs" >/dev/null 2>&1 || true
pkill -f "kraptor-bridge/server.mjs" >/dev/null 2>&1 || true
pkill -f "egress/egress.mjs" >/dev/null 2>&1 || true
pkill -f "cs-host/out.*Host" >/dev/null 2>&1 || true
pkill -f "run-host.sh" >/dev/null 2>&1 || true

if command -v termux-wake-unlock >/dev/null 2>&1; then
  termux-wake-unlock >/dev/null 2>&1 || true
fi

echo "[OK] Lanettirr stopped."
if command -v termux-toast >/dev/null 2>&1; then
  termux-toast "Lanettirr stopped" >/dev/null 2>&1 || true
fi

