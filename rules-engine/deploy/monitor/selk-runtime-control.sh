#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-restart}"
TARGET="${2:-}"
REASON="${3:-manual}"
BASE_URL="${SELK_RUNTIME_BASE_URL:-http://127.0.0.1:19091}"
CONTROL_PATH="${SELK_RUNTIME_CONTROL_PATH:-/_selk_internal/v1/control-plane/9f3a7c4e61/restart}"
AUTH_MODE="${SELK_DISPATCH_AUTH_MODE:-bearer}"

BASE_URL="${BASE_URL%/}"
CONTROL_PATH="/${CONTROL_PATH#/}"
CONTROL_URL="${BASE_URL}${CONTROL_PATH}"

if [[ "$ACTION" != "restart" ]]; then
  echo "unsupported action: $ACTION" >&2
  exit 1
fi

if [[ "$TARGET" != "probe" && "$TARGET" != "engine" && "$TARGET" != "all" ]]; then
  echo "usage: $0 restart <probe|engine|all> [reason]" >&2
  exit 1
fi

PAYLOAD="$(python3 - "$ACTION" "$TARGET" "$REASON" <<'PY'
import json
import sys
print(json.dumps({
    "action": sys.argv[1],
    "target": sys.argv[2],
    "reason": sys.argv[3],
}, ensure_ascii=False))
PY
)"

BODY_SHA256="$(python3 - "$PAYLOAD" <<'PY'
import hashlib
import sys
print(hashlib.sha256(sys.argv[1].encode('utf-8')).hexdigest())
PY
)"

if [[ "$AUTH_MODE" == "hmac" ]]; then
  KEY_ID="${SELK_DISPATCH_KEY_ID:-}"
  SECRET="${SELK_DISPATCH_SHARED_SECRET:-}"
  SECRET_FILE="${SELK_DISPATCH_SHARED_SECRET_FILE:-}"
  if [[ -z "$SECRET" && -n "$SECRET_FILE" ]]; then
    SECRET="$(tr -d '\r\n' < "$SECRET_FILE")"
  fi
  if [[ -z "$KEY_ID" || -z "$SECRET" ]]; then
    echo "SELK_DISPATCH_KEY_ID and SELK_DISPATCH_SHARED_SECRET or SELK_DISPATCH_SHARED_SECRET_FILE are required for hmac mode" >&2
    exit 1
  fi

  TIMESTAMP="$(python3 - <<'PY'
import time
print(int(time.time()))
PY
)"
  NONCE="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
  SIGNATURE="$(python3 - "$SECRET" "$TIMESTAMP" "$NONCE" "$BODY_SHA256" "$CONTROL_PATH" <<'PY'
import hashlib
import hmac
import sys
secret, timestamp, nonce, body_sha256, path = sys.argv[1:6]
payload = "\n".join(["POST", path, timestamp, nonce, body_sha256])
print(hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest())
PY
)"

  curl -sS -X POST "$CONTROL_URL" \
    -H "Content-Type: application/json" \
    -H "Content-SHA256: ${BODY_SHA256}" \
    -H "X-Selk-Key-Id: ${KEY_ID}" \
    -H "X-Selk-Timestamp: ${TIMESTAMP}" \
    -H "X-Selk-Nonce: ${NONCE}" \
    -H "X-Selk-Signature: ${SIGNATURE}" \
    -d "$PAYLOAD"
else
  TOKEN="${SELK_DISPATCH_BEARER_TOKEN:-${SELK_RUNTIME_TOKEN:-}}"
  TOKEN_FILE="${SELK_DISPATCH_BEARER_TOKEN_FILE:-}"
  if [[ -z "$TOKEN" && -n "$TOKEN_FILE" ]]; then
    TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
  fi
  if [[ -z "$TOKEN" ]]; then
    echo "SELK_DISPATCH_BEARER_TOKEN, SELK_RUNTIME_TOKEN, or SELK_DISPATCH_BEARER_TOKEN_FILE is required for bearer mode" >&2
    exit 1
  fi

  curl -sS -X POST "$CONTROL_URL" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Content-SHA256: ${BODY_SHA256}" \
    -d "$PAYLOAD"
fi

echo
