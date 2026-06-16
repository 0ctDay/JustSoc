#!/usr/bin/env bash
set -euo pipefail

ENGINE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ENGINE_ROOT/.." && pwd)"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/deploy/bin}"
GOOS_TARGET="${GOOS_TARGET:-linux}"
GOARCH_TARGET="${GOARCH_TARGET:-amd64}"
OUTPUT_PATH="$OUT_DIR/threat-engine"

mkdir -p "$OUT_DIR"

GOWORK=off \
CGO_ENABLED=0 \
GOOS="$GOOS_TARGET" \
GOARCH="$GOARCH_TARGET" \
go -C "$ENGINE_ROOT" build -o "$OUTPUT_PATH" ./cmd/threat-engine

printf 'built %s\n' "$OUTPUT_PATH"
