#!/usr/bin/env bash
# Generate host-specific probe configs in configs/.
# Produces:
#   configs/probe.yaml
#   configs/suricata.generated.yaml
#   configs/probe-whitelist.generated.bpf
#
# Reads from configs/probe-stack.env (creating it from the example on first run).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

STACK_ENV="${SELK_PROBE_STACK_ENV:-$SCRIPT_DIR/configs/probe-stack.env}"
STACK_ENV_EXAMPLE="$SCRIPT_DIR/configs/probe-stack.env.example"
PROBE_TEMPLATE="$SCRIPT_DIR/configs/probe.example.yaml"
PROBE_BIN_DEFAULT="$SCRIPT_DIR/bin/selk-probe-linux-amd64"

# Strip Windows CRLF line endings from an env file in place. Run before
# `source` so bash does not interpret \r as part of values or commands.
normalize_crlf_if_needed() {
  local target="$1"
  if [[ -f "$target" ]] && LC_ALL=C grep -q $'\r' "$target"; then
    sed -i 's/\r$//' "$target"
    echo "normalized CRLF -> LF: $target"
  fi
}

# Read the current value of KEY from an env file (empty if unset).
get_env_value() {
  sed -n "s/^$2=//p" "$1" | head -n1
}

# Set KEY=VALUE in an env file, replacing the existing line or appending.
# Value is passed through the environment so any character is preserved
# verbatim (no sed metacharacter escaping needed for passwords etc.).
set_env_value() {
  local file="$1" tmp
  tmp="$(mktemp)"
  SELK_K="$2" SELK_V="$3" awk '
    BEGIN { k = ENVIRON["SELK_K"]; v = ENVIRON["SELK_V"]; done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

# Print the chosen capture interface to stdout; all UI goes to stderr so the
# result can be captured with $(choose_interface).
choose_interface() {
  local ifaces=() n state addr i reply
  for n in /sys/class/net/*; do
    [[ -e "$n" ]] || continue   # no glob match -> skip literal '/sys/class/net/*'
    n="$(basename "$n")"
    [[ "$n" == "lo" ]] && continue
    ifaces+=("$n")
  done

  if [[ ${#ifaces[@]} -eq 0 ]]; then
    read -rp "no interfaces auto-detected; enter interface name: " reply || true
    printf '%s\n' "$reply"
    return
  fi

  echo "available network interfaces:" >&2
  i=1
  for n in "${ifaces[@]}"; do
    state="$(cat "/sys/class/net/$n/operstate" 2>/dev/null || echo '?')"
    addr=""
    if command -v ip >/dev/null 2>&1; then
      addr="$(ip -4 -o addr show dev "$n" 2>/dev/null | awk '{print $4}' | paste -sd, -)"
    fi
    printf '  %d) %-14s state=%-7s %s\n' "$i" "$n" "$state" "$addr" >&2
    i=$((i + 1))
  done

  read -rp "select [1-${#ifaces[@]}] or type a name (default ${ifaces[0]}): " reply || true
  if [[ -z "$reply" ]]; then
    printf '%s\n' "${ifaces[0]}"
  elif [[ "$reply" == *","* ]]; then
    local selected=() part trimmed
    IFS=',' read -ra selected <<< "$reply"
    for part in "${selected[@]}"; do
      trimmed="$(printf '%s' "$part" | xargs)"
      if [[ "$trimmed" =~ ^[0-9]+$ ]] && (( trimmed >= 1 && trimmed <= ${#ifaces[@]} )); then
        printf '%s\n' "${ifaces[$((trimmed - 1))]}"
      elif [[ -n "$trimmed" ]]; then
        printf '%s\n' "$trimmed"
      fi
    done | paste -sd, -
  elif [[ "$reply" =~ ^[0-9]+$ ]] && (( reply >= 1 && reply <= ${#ifaces[@]} )); then
    printf '%s\n' "${ifaces[$((reply - 1))]}"
  else
    printf '%s\n' "$reply"
  fi
}

# Interactively fill the two most critical params (capture interface + Kafka)
# into the env file. Pressing Enter keeps the current/example value.
interactive_fill() {
  local file="$1" iface cur reply
  echo >&2
  echo "== interactive setup: capture interface + Kafka (Enter keeps default) ==" >&2

  iface="$(choose_interface)"
  set_env_value "$file" SELK_PROBE_INTERFACE "$iface"
  echo "  interface -> $iface" >&2

  cur="$(get_env_value "$file" SELK_KAFKA_BOOTSTRAP_SERVERS)"
  read -rp "kafka bootstrap servers [${cur}]: " reply || true
  [[ -n "$reply" ]] && set_env_value "$file" SELK_KAFKA_BOOTSTRAP_SERVERS "$reply"

  cur="$(get_env_value "$file" SELK_KAFKA_USERNAME)"
  read -rp "kafka username [${cur}]: " reply || true
  [[ -n "$reply" ]] && set_env_value "$file" SELK_KAFKA_USERNAME "$reply"

  cur="$(get_env_value "$file" SELK_KAFKA_PASSWORD)"
  read -rp "kafka password [${cur}]: " reply || true
  [[ -n "$reply" ]] && set_env_value "$file" SELK_KAFKA_PASSWORD "$reply"

  echo "updated $file" >&2
  echo >&2
}

INTERACTIVE=0
if [[ -t 0 && "${SELK_NONINTERACTIVE:-0}" != "1" ]]; then
  INTERACTIVE=1
fi

if [[ ! -f "$STACK_ENV" ]]; then
  if [[ ! -f "$STACK_ENV_EXAMPLE" ]]; then
    echo "missing $STACK_ENV_EXAMPLE; run ./build.sh first." >&2
    exit 1
  fi
  normalize_crlf_if_needed "$STACK_ENV_EXAMPLE"
  cp "$STACK_ENV_EXAMPLE" "$STACK_ENV"
  echo "created $STACK_ENV from example."
  if [[ "$INTERACTIVE" == "1" ]]; then
    # Prompt for the two critical params and continue -- no second run needed.
    interactive_fill "$STACK_ENV"
  else
    echo "non-interactive (no TTY or SELK_NONINTERACTIVE=1)." >&2
    echo "edit $STACK_ENV (interface, kafka, ...) then rerun ./init-config.sh." >&2
    exit 0
  fi
elif [[ "${SELK_RECONFIGURE:-0}" == "1" && "$INTERACTIVE" == "1" ]]; then
  # Re-prompt on demand even when the env file already exists.
  normalize_crlf_if_needed "$STACK_ENV"
  interactive_fill "$STACK_ENV"
fi

normalize_crlf_if_needed "$STACK_ENV"
set -a
# shellcheck disable=SC1090
source "$STACK_ENV"
set +a

# Ensure Suricata is installed before `selk-probe init` reads its base config
# ($SELK_SURICATA_BASE_CONFIG). Without it the probe falls back to a debug
# template the deploy package does not ship and aborts. Invoked via bash so a
# missing exec bit (e.g. after copying from Windows) is not fatal.
bash "$SCRIPT_DIR/install-suricata.sh"

if [[ ! -f "$PROBE_TEMPLATE" ]]; then
  echo "missing $PROBE_TEMPLATE; run ./build.sh first." >&2
  exit 1
fi

PROBE_BIN="${SELK_PROBE_BIN:-$PROBE_BIN_DEFAULT}"
if [[ ! -x "$PROBE_BIN" ]]; then
  echo "missing probe binary at $PROBE_BIN; run ./build.sh first." >&2
  exit 1
fi

INTERFACE="${SELK_PROBE_INTERFACE:-}"
BROKERS="${SELK_KAFKA_BOOTSTRAP_SERVERS:-}"
KAFKA_USER="${SELK_KAFKA_USERNAME:-}"
KAFKA_PASS="${SELK_KAFKA_PASSWORD:-}"

ARGS=(init --config "$PROBE_TEMPLATE" --output "configs/probe.yaml" --force)
if [[ -n "$INTERFACE" && "$INTERFACE" != "CHANGE_ME" ]]; then
  ARGS+=(--interface "$INTERFACE")
fi
if [[ -n "$BROKERS" ]]; then
  ARGS+=(--kafka-brokers "$BROKERS")
fi
if [[ -n "$KAFKA_USER" ]]; then
  ARGS+=(--kafka-username "$KAFKA_USER")
fi
if [[ -n "$KAFKA_PASS" ]]; then
  ARGS+=(--kafka-password "$KAFKA_PASS")
fi

"$PROBE_BIN" "${ARGS[@]}"

cat <<EOF

generated:
  $SCRIPT_DIR/configs/probe.yaml
  $SCRIPT_DIR/configs/suricata.generated.yaml
  $SCRIPT_DIR/configs/probe-whitelist.generated.bpf

next: sudo ./install.sh
EOF
