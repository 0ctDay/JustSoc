#!/usr/bin/env bash
# Build deploy/ package: compile binaries and sync static assets from sibling source dirs.
# Run from anywhere; this script resolves paths via its own location.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GOOS_TARGET="${GOOS_TARGET:-linux}"
GOARCH_TARGET="${GOARCH_TARGET:-amd64}"

BIN_DIR="$SCRIPT_DIR/bin"
CONFIGS_DIR="$SCRIPT_DIR/configs"
MONITOR_DIR="$SCRIPT_DIR/monitor"
RULES_DIR="$SCRIPT_DIR/suricata-rules"

mkdir -p "$BIN_DIR" "$CONFIGS_DIR" "$MONITOR_DIR" "$RULES_DIR"

PROBE_OUT="$BIN_DIR/selk-probe-${GOOS_TARGET}-${GOARCH_TARGET}"
ENGINE_OUT="$BIN_DIR/threat-engine"

echo "[1/4] building selk-probe -> $PROBE_OUT"
GOWORK=off CGO_ENABLED=0 GOOS="$GOOS_TARGET" GOARCH="$GOARCH_TARGET" \
  go -C "$REPO_ROOT/probe" build -o "$PROBE_OUT" ./cmd/selk-probe

echo "[2/4] building threat-engine -> $ENGINE_OUT"
GOWORK=off CGO_ENABLED=0 GOOS="$GOOS_TARGET" GOARCH="$GOARCH_TARGET" \
  go -C "$REPO_ROOT/go-engine" build -o "$ENGINE_OUT" ./cmd/threat-engine

echo "[3/4] syncing monitor scripts -> $MONITOR_DIR"
cp -f "$REPO_ROOT/monitor/selk-runtime-monitor.py" "$MONITOR_DIR/"
cp -f "$REPO_ROOT/monitor/selk-runtime-control.sh" "$MONITOR_DIR/"
chmod 0755 "$MONITOR_DIR/selk-runtime-monitor.py" "$MONITOR_DIR/selk-runtime-control.sh"

echo "[4/4] syncing static configs and suricata rules"
cp -f "$REPO_ROOT/probe/configs/probe.example.yaml" "$CONFIGS_DIR/probe.example.yaml"
cp -f "$REPO_ROOT/go-engine/configs/engine-rules.yaml" "$CONFIGS_DIR/engine-rules.yaml"

rm -f "$RULES_DIR"/*.rules
cp -f "$REPO_ROOT/suricata-rules/"*.rules "$RULES_DIR/"

chmod 0755 "$PROBE_OUT" "$ENGINE_OUT"

cat <<EOF

deploy package ready in: $SCRIPT_DIR
binaries:        $BIN_DIR
configs:         $CONFIGS_DIR  (edit configs/probe-stack.env then run ./init-config.sh)
monitor scripts: $MONITOR_DIR
suricata rules:  $RULES_DIR

next steps:
  1. cp configs/probe-stack.env.example configs/probe-stack.env  (first time only)
  2. edit configs/probe-stack.env
  3. ./init-config.sh
  4. sudo ./install.sh
EOF
