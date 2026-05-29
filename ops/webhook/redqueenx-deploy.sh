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

run_host_security_helper() {
  local label="$1"
  local script="$2"

  if [[ "${REDQUEENX_DEPLOY_HOST_SECURITY:-true}" != "true" ]]; then
    log "Host security helper disabled; skipping $label."
    return 0
  fi

  if [[ ! -x "$script" ]]; then
    log "Host security helper not found or not executable: $script; skipping $label."
    return 0
  fi

  if [[ "$(id -u)" -ne 0 ]]; then
    log "Host security helper requires root; skipping $label."
    return 0
  fi

  log "+ $script"
  if "$script" 2>&1 | tee -a "$log_file"; then
    log "Host security helper completed: $label."
    return 0
  fi

  log "Host security helper failed: $label."
  if [[ "${REDQUEENX_DEPLOY_HOST_SECURITY_STRICT:-false}" == "true" ]]; then
    exit 1
  fi
  log "Continuing deploy because REDQUEENX_DEPLOY_HOST_SECURITY_STRICT is not true."
}

sync_env_file() {
  if [[ ! -f scripts/sync-env.cjs ]]; then
    log "env sync script not found; skipping .env sync."
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    run node scripts/sync-env.cjs
    return 0
  fi

  if command -v npm >/dev/null 2>&1; then
    run npm run env:sync
    return 0
  fi

  log "node/npm are not available; skipping .env sync."
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

sync_env_file

if [[ -f .env ]]; then
  env_owner="${REDQUEENX_UID:-1000}:${REDQUEENX_GID:-1000}"
  if chown "$env_owner" .env >/dev/null 2>&1; then
    log "Set .env owner to $env_owner so the admin container can save settings."
  else
    log "Could not chown .env to $env_owner; admin settings may not be able to write .env."
  fi
fi

run_host_security_helper "VPS health collector" "$deploy_dir/ops/install-vps-health-collector.sh"
run_host_security_helper "RedqueenX fail2ban jails" "$deploy_dir/ops/fail2ban/install-redqueenx.sh"

compose -f "$compose_file" pull
compose -f "$compose_file" up -d --remove-orphans

log "RedqueenX deploy completed."
