#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/deploy/bin}"
GOOS_TARGET="${GOOS_TARGET:-linux}"
GOARCH_TARGET="${GOARCH_TARGET:-amd64}"
OUTPUT_PATH="$OUT_DIR/selk-probe-${GOOS_TARGET}-${GOARCH_TARGET}"

mkdir -p "$OUT_DIR"
cd "$ROOT_DIR"

GOWORK=off \
CGO_ENABLED=0 \
GOOS="$GOOS_TARGET" \
GOARCH="$GOARCH_TARGET" \
go build -o "$OUTPUT_PATH" ./cmd/selk-probe

printf 'built %s\n' "$OUTPUT_PATH"
