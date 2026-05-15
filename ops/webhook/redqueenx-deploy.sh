#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
default_deploy_dir="$(cd "$script_dir/../.." && pwd)"
deploy_dir="${REDQUEENX_DEPLOY_DIR:-$default_deploy_dir}"
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

compose() {
  if docker compose version >/dev/null 2>&1; then
    run docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    run docker-compose "$@"
  else
    log "Neither 'docker compose' nor 'docker-compose' is available."
    exit 1
  fi
}

has_local_tracked_changes() {
  ! git diff --quiet || ! git diff --cached --quiet
}

log_local_tracked_changes() {
  log "Local tracked changes are present; skipping git update and deploying with the current checkout."
  git status --short --untracked-files=no 2>&1 | tee -a "$log_file"
}

log "Starting RedqueenX deploy in $deploy_dir using $compose_file."
cd "$deploy_dir"

run git fetch --prune origin "$branch"
if has_local_tracked_changes; then
  log_local_tracked_changes
else
  run git checkout "$branch"
  run git pull --ff-only origin "$branch"
fi

compose -f "$compose_file" pull
compose -f "$compose_file" up -d --remove-orphans

log "RedqueenX deploy completed."
