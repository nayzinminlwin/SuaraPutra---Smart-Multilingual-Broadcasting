#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR="/opt/suaraputra"
readonly NODE_MAJOR="22"
readonly SWAP_FILE="/swapfile"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root (for example: sudo bash setup-gcp-server.sh)." >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential ca-certificates curl git python3 sqlite3 ufw

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" != "${NODE_MAJOR}" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if [[ ! -e "${SWAP_FILE}" ]]; then
  fallocate -l 2G "${SWAP_FILE}"
  chmod 600 "${SWAP_FILE}"
  mkswap "${SWAP_FILE}"
fi
if ! swapon --show=NAME | grep -Fxq "${SWAP_FILE}"; then
  swapon "${SWAP_FILE}"
fi
if ! grep -Fqx "${SWAP_FILE} none swap sw 0 0" /etc/fstab; then
  printf '%s\n' "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
fi
printf 'vm.swappiness=10\n' > /etc/sysctl.d/99-suaraputra-memory.conf
sysctl -p /etc/sysctl.d/99-suaraputra-memory.conf

install -d -o root -g systemd-journal -m 2755 /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/suaraputra.conf
systemctl restart systemd-journald

if ! id suaraputra >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_DIR}" --create-home --shell /usr/sbin/nologin suaraputra
fi

install -d -o suaraputra -g suaraputra -m 755 "${APP_DIR}" "${APP_DIR}/data" "${APP_DIR}/data/media"
install -d -o suaraputra -g suaraputra -m 700 "${APP_DIR}/private" "${APP_DIR}/private/whatsapp-auth"

ufw allow OpenSSH
ufw --force enable
ufw status verbose
echo "SuaraPutra GCP server directories and dependencies are ready at ${APP_DIR}."
