#!/usr/bin/env bash
# Ensure Suricata is installed on this host.
#
# init-config.sh renders configs/suricata.generated.yaml FROM the host's base
# Suricata config (default /etc/suricata/suricata.yaml). If Suricata is not
# installed that base config is missing, so `selk-probe init` falls back to a
# debug template that the deploy package does not ship and aborts with:
#   read Suricata config template .../suricata.debug.example.yaml: no such file
#
# Installing Suricata provides the real base config, so the fallback is never
# used. Idempotent: if the suricata binary and base config already exist this
# does nothing. Set SELK_SKIP_SURICATA_INSTALL=1 to bypass entirely.
set -euo pipefail

BASE_CONFIG="${SELK_SURICATA_BASE_CONFIG:-/etc/suricata/suricata.yaml}"
SURICATA_BIN="${SELK_SURICATA_BINARY:-suricata}"

log() { echo "[install-suricata] $*"; }

if [[ "${SELK_SKIP_SURICATA_INSTALL:-0}" == "1" ]]; then
  log "SELK_SKIP_SURICATA_INSTALL=1, skipping"
  exit 0
fi

if command -v "$SURICATA_BIN" >/dev/null 2>&1 && [[ -f "$BASE_CONFIG" ]]; then
  log "already present: $("$SURICATA_BIN" -V 2>/dev/null | head -n1); base config $BASE_CONFIG"
  exit 0
fi

# Installing packages requires root.
SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    log "must run as root (or have sudo) to install suricata" >&2
    exit 1
  fi
fi

install_apt() {
  log "installing via apt-get"
  $SUDO apt-get update -y
  # On Ubuntu the OISF stable PPA ships a current Suricata; ignore failures and
  # fall back to the distro package so air-gapped/Debian hosts still work.
  if grep -qi ubuntu /etc/os-release 2>/dev/null; then
    $SUDO apt-get install -y software-properties-common || true
    $SUDO add-apt-repository -y ppa:oisf/suricata-stable || true
    $SUDO apt-get update -y || true
  fi
  $SUDO apt-get install -y suricata
}

install_dnf() {
  log "installing via dnf"
  $SUDO dnf install -y epel-release || true
  $SUDO dnf install -y suricata
}

install_yum() {
  log "installing via yum"
  $SUDO yum install -y epel-release || true
  $SUDO yum install -y suricata
}

install_zypper() {
  log "installing via zypper"
  $SUDO zypper --non-interactive install suricata
}

install_pacman() {
  log "installing via pacman"
  $SUDO pacman -Sy --noconfirm suricata
}

if command -v apt-get >/dev/null 2>&1; then
  install_apt
elif command -v dnf >/dev/null 2>&1; then
  install_dnf
elif command -v yum >/dev/null 2>&1; then
  install_yum
elif command -v zypper >/dev/null 2>&1; then
  install_zypper
elif command -v pacman >/dev/null 2>&1; then
  install_pacman
else
  log "no supported package manager (apt/dnf/yum/zypper/pacman); install suricata manually" >&2
  exit 1
fi

if ! command -v "$SURICATA_BIN" >/dev/null 2>&1; then
  log "install reported success but '$SURICATA_BIN' is not on PATH" >&2
  exit 1
fi

if [[ ! -f "$BASE_CONFIG" ]]; then
  log "suricata installed but base config $BASE_CONFIG is missing" >&2
  log "set SELK_SURICATA_BASE_CONFIG to the package's default config path and rerun" >&2
  exit 1
fi

log "ready: $("$SURICATA_BIN" -V 2>/dev/null | head -n1); base config $BASE_CONFIG"
