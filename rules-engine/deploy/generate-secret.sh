#!/usr/bin/env bash
# Generate a random HMAC shared secret for the probe dispatcher, write it to
# configs/dispatcher.shared_secret with 0600, and print it to the console so
# you can hand it to the platform / client side.
#
# Usage:
#   ./generate-secret.sh              # generate only if missing
#   ./generate-secret.sh --force      # overwrite an existing secret
#   ./generate-secret.sh --show       # print the existing secret without regenerating
#
# Honors SELK_DISPATCH_SHARED_SECRET_FILE from configs/probe-stack.env.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_ENV="${SELK_PROBE_STACK_ENV:-$SCRIPT_DIR/configs/probe-stack.env}"

FORCE=0
SHOW_ONLY=0
for arg in "$@"; do
  case "$arg" in
    -f|--force) FORCE=1 ;;
    -s|--show)  SHOW_ONLY=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ -f "$STACK_ENV" ]]; then
  if LC_ALL=C grep -q $'\r' "$STACK_ENV"; then
    sed -i 's/\r$//' "$STACK_ENV"
    echo "normalized CRLF -> LF: $STACK_ENV"
  fi
  set -a
  # shellcheck disable=SC1090
  source "$STACK_ENV"
  set +a
fi

KEY_ID="${SELK_DISPATCH_KEY_ID:-probe-prod-dispatcher}"
SECRET_FILE_RAW="${SELK_DISPATCH_SHARED_SECRET_FILE:-configs/dispatcher.shared_secret}"
if [[ "$SECRET_FILE_RAW" = /* ]]; then
  SECRET_FILE="$SECRET_FILE_RAW"
else
  SECRET_FILE="$SCRIPT_DIR/$SECRET_FILE_RAW"
fi

print_banner() {
  local action="$1" secret="$2"
  local boundary="============================================================"
  cat <<EOF

$boundary
HMAC dispatcher credentials ($action)
$boundary
key id      : $KEY_ID
secret      : $secret
secret file : $SECRET_FILE  (chmod 0600)
$boundary
keep this secret out of source control.
hand it to the platform / client side so they can sign requests.
$boundary

EOF
}

read_existing_secret() {
  tr -d '\r\n' < "$SECRET_FILE"
}

if [[ "$SHOW_ONLY" == "1" ]]; then
  if [[ ! -f "$SECRET_FILE" ]]; then
    echo "no secret file at $SECRET_FILE" >&2
    exit 1
  fi
  print_banner "existing" "$(read_existing_secret)"
  exit 0
fi

if [[ -f "$SECRET_FILE" && "$FORCE" != "1" ]]; then
  echo "secret already exists at $SECRET_FILE" >&2
  echo "use --force to regenerate, or --show to print it." >&2
  exit 1
fi

mkdir -p "$(dirname "$SECRET_FILE")"

# Generate via Python's secrets.token_urlsafe (48 bytes -> ~64 url-safe chars).
SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"

umask 077
printf '%s\n' "$SECRET" > "$SECRET_FILE"
chmod 0600 "$SECRET_FILE"

action="generated"
if [[ "$FORCE" == "1" && -s "$SECRET_FILE" ]]; then
  action="regenerated"
fi

print_banner "$action" "$SECRET"
