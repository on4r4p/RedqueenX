#!/usr/bin/env bash
set -euo pipefail

deploy_dir="${REDQUEENX_DEPLOY_DIR:-/opt/redqueenx}"
compose_file="${REDQUEENX_COMPOSE_FILE:-compose.prod.yaml}"
branch="${REDQUEENX_DEPLOY_BRANCH:-main}"
log_file="${REDQUEENX_DEPLOY_LOG:-/var/log/redqueenx-deploy.log}"
lock_file="${REDQUEENX_DEPLOY_LOCK:-/tmp/redqueenx-deploy.lock}"

mkdir -p "$(dirname "$log_file")"

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "[$(date -Is)] Deploy already running." | tee -a "$log_file"
  exit 0
fi

log() {
  echo "[$(date -Is)] $*" | tee -a "$log_file"
}

run() {
  log "+ $*"
  "$@" 2>&1 | tee -a "$log_file"
}

log "Starting RedqueenX deploy in $deploy_dir using $compose_file."
cd "$deploy_dir"

run git fetch --prune origin "$branch"
run git checkout "$branch"
run git pull --ff-only origin "$branch"

run docker compose -f "$compose_file" pull
run docker compose -f "$compose_file" up -d --remove-orphans

log "RedqueenX deploy completed."
