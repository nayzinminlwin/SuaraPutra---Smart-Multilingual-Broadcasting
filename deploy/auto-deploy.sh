#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEPLOY_DIR="/opt/suaraputra"
readonly LOG_FILE="${DEPLOY_DIR}/data/deploy.log"
readonly LOCK_FILE="/tmp/suaraputra-deploy.lock"
readonly BRANCH="master"

mkdir -p "${DEPLOY_DIR}/data"
touch "${LOG_FILE}"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*" >> "${LOG_FILE}"
}

on_error() {
  local exit_code=$?
  local line="${BASH_LINENO[0]}"
  trap - ERR
  printf '[%s] ERROR: deployment failed at line %s (exit %s).\n' \
    "$(date -Iseconds)" "${line}" "${exit_code}" >> "${LOG_FILE}" ||
    printf 'Deployment failed at line %s (exit %s).\n' "${line}" "${exit_code}" >&2
  exit "${exit_code}"
}
trap on_error ERR

exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
  log "Deploy already running, skipping."
  exit 0
fi

cd "${DEPLOY_DIR}"

git fetch origin "${BRANCH}" >> "${LOG_FILE}" 2>&1
LOCAL="$(git rev-parse HEAD 2>> "${LOG_FILE}")"
REMOTE="$(git rev-parse "origin/${BRANCH}" 2>> "${LOG_FILE}")"

if [[ "${LOCAL}" == "${REMOTE}" ]]; then
  exit 0
fi

log "Deploying ${REMOTE} (was ${LOCAL})..."

git pull --ff-only origin "${BRANCH}" >> "${LOG_FILE}" 2>&1
npm install --include=dev >> "${LOG_FILE}" 2>&1
npm run build -- --noEmitOnError >> "${LOG_FILE}" 2>&1
npm prune --omit=dev >> "${LOG_FILE}" 2>&1
sudo systemctl restart suaraputra >> "${LOG_FILE}" 2>&1

log "Deploy complete: $(git rev-parse --short HEAD 2>> "${LOG_FILE}")"
