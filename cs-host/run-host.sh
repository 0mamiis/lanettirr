#!/usr/bin/env bash
set -euo pipefail

CS_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$CS_DIR"

JAVA_EXE=""
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  JAVA_EXE="$JAVA_HOME/bin/java"
elif command -v java >/dev/null 2>&1; then
  JAVA_EXE="$(command -v java)"
elif [ -n "${PREFIX:-}" ] && [ -x "$PREFIX/lib/jvm/java-21-openjdk/bin/java" ]; then
  JAVA_EXE="$PREFIX/lib/jvm/java-21-openjdk/bin/java"
  export JAVA_HOME="$PREFIX/lib/jvm/java-21-openjdk"
elif [ -n "${PREFIX:-}" ] && [ -x "$PREFIX/lib/jvm/java-17-openjdk/bin/java" ]; then
  JAVA_EXE="$PREFIX/lib/jvm/java-17-openjdk/bin/java"
  export JAVA_HOME="$PREFIX/lib/jvm/java-17-openjdk"
fi

if [ -z "$JAVA_EXE" ]; then
  echo "[cs-host] ERROR: Java not found. Install openjdk-21 (pkg install openjdk-21)." >> "$CS_DIR/host.log"
  echo "[cs-host] ERROR: Java not found." >&2
  exit 1
fi

export BB_DEX2JAR="$CS_DIR/tools/dex-tools-v2.4"
CP="$CS_DIR/out:$CS_DIR/lib/builtins:$CS_DIR/lib/okhttp-jvm.jar:$CS_DIR/lib/kotlin-reflect.jar:$CS_DIR/lib/cryptography-provider-jdk-jvm.jar:$CS_DIR/lib/cryptography-provider-optimal-jvm.jar:$CS_DIR/lib/cryptography-core-jvm.jar:$CS_DIR/lib/cryptography-provider-base-jvm.jar:$CS_DIR/lib/cryptography-random-jvm.jar:$CS_DIR/lib/cryptography-serialization-asn1-jvm.jar:$CS_DIR/lib/cryptography-serialization-asn1-modules-jvm.jar:$CS_DIR/lib/cryptography-serialization-pem-jvm.jar:$CS_DIR/lib/cryptography-bigint-jvm.jar:$CS_DIR/lib/cs-app.jar:$CS_DIR/lib/android.jar"

if [ -n "${PREFIX:-}" ] && printf '%s' "$PREFIX" | grep -q "com.termux"; then
  if [ -f "$CS_DIR/host.log" ] && [ "$(wc -c < "$CS_DIR/host.log" 2>/dev/null || echo 0)" -gt 2097152 ]; then mv -f "$CS_DIR/host.log" "$CS_DIR/host.log.old" 2>/dev/null || : > "$CS_DIR/host.log"; fi
  XMX="${CS_HOST_XMX:-256m}"
  exec "$JAVA_EXE" -Xms32m -Xmx"$XMX" -XX:+UseSerialGC -XX:MaxHeapFreeRatio=20 -XX:MinHeapFreeRatio=10 -cp "$CP" Host >> "$CS_DIR/host.log" 2>&1
else
  if [ -f "$CS_DIR/host.log" ] && [ "$(wc -c < "$CS_DIR/host.log" 2>/dev/null || echo 0)" -gt 2097152 ]; then mv -f "$CS_DIR/host.log" "$CS_DIR/host.log.old" 2>/dev/null || : > "$CS_DIR/host.log"; fi
  XMX="${CS_HOST_XMX:-384m}"
  exec "$JAVA_EXE" -Xms48m -Xmx"$XMX" -XX:+UseG1GC -XX:MaxHeapFreeRatio=25 -XX:MinHeapFreeRatio=10 -cp "$CP" Host >> "$CS_DIR/host.log" 2>&1
fi

