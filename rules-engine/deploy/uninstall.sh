#!/usr/bin/env bash
# Stop and remove JustSoc probe stack systemd services.
# Leaves the deploy/ directory in place by default; set REMOVE_LOGS=1 to wipe log files too.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_ENV="${SELK_PROBE_STACK_ENV:-$SCRIPT_DIR/configs/probe-stack.env}"

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

SYSTEMD_DIR="${SYSTEMD_DIR:-${SELK_SYSTEMD_DIR:-/etc/systemd/system}}"
PROBE_SERVICE_NAME="${SELK_PROBE_SERVICE:-selk-probe}"
ENGINE_SERVICE_NAME="${SELK_ENGINE_SERVICE:-justsoc-threat-engine}"
DISPATCHER_SERVICE_NAME="${SELK_DISPATCHER_SERVICE:-selk-probe-dispatcher}"
LOG_DIR="${SELK_LOG_DIR:-/var/log/selk}"
RUN_DIR="${SELK_RUN_DIR:-/run/selk}"
REMOVE_LOGS="${REMOVE_LOGS:-0}"

stop_and_disable_service() {
  local service_name="$1"
  if systemctl list-unit-files | grep -Fq "${service_name}.service"; then
    systemctl disable --now "${service_name}.service" || true
  fi
  rm -f "$SYSTEMD_DIR/${service_name}.service"
}

stop_and_disable_service "$DISPATCHER_SERVICE_NAME"
stop_and_disable_service "$ENGINE_SERVICE_NAME"
stop_and_disable_service "$PROBE_SERVICE_NAME"
# Legacy unit name that may exist on hosts upgraded from previous layouts.
stop_and_disable_service "selk-runtime-monitor"

systemctl daemon-reload

rm -f "$RUN_DIR/runtime-status.json"

if [[ "$REMOVE_LOGS" == "1" ]]; then
  rm -f "$LOG_DIR/selk-probe.log" "$LOG_DIR/threat-engine.log"
  rmdir "$LOG_DIR" 2>/dev/null || true
fi

cat <<EOF

removed services:   ${PROBE_SERVICE_NAME}, ${ENGINE_SERVICE_NAME}, ${DISPATCHER_SERVICE_NAME}
deploy directory:   $SCRIPT_DIR (left in place)
removed logs:       $LOG_DIR (REMOVE_LOGS=$REMOVE_LOGS)
EOF
