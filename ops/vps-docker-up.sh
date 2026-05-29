#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"
compose_file="${REDQUEENX_COMPOSE_FILE:-compose.prod.yaml}"
with_caddy="${REDQUEENX_WITH_CADDY:-false}"
pull_images="${REDQUEENX_PULL_IMAGES:-true}"

cd "$repo_dir"

if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  compose=(docker-compose)
else
  echo "Docker Compose is missing. Install the Docker Compose plugin or docker-compose first." >&2
  exit 1
fi

if [ ! -f "$compose_file" ]; then
  echo "Compose file not found: $repo_dir/$compose_file" >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example."
fi

append_env_if_missing() {
  local key="$1"
  local value="$2"
  if ! grep -Eq "^${key}=" .env; then
    printf '%s=%s\n' "$key" "$value" >> .env
    echo "Added $key=$value to .env"
  fi
}

append_env_if_missing ADMIN_HOST "0.0.0.0"
append_env_if_missing ADMIN_PORT "3005"
append_env_if_missing ADMIN_TRUST_PROXY "true"
append_env_if_missing SEARCH_WITHOUT_API_ISOLATION "docker_vpn"
append_env_if_missing SEARCH_WITHOUT_API_HEADLESS "true"
append_env_if_missing X_LOGIN_NOVNC_PORT "6080"

if ! grep -Eq '^SESSION_SECRET=.+' .env || grep -Eq '^SESSION_SECRET=dev-session-secret-change-me$' .env; then
  echo "Warning: set SESSION_SECRET in .env to a long random value before exposing the admin UI." >&2
fi

if ! grep -Eq '^ADMIN_PASSWORD_HASH=|^ADMIN_PASSWORD=.+' .env; then
  echo "Warning: set ADMIN_PASSWORD in .env before opening the admin UI." >&2
fi

vpn_config="$(grep -E '^VPN_CONFIG=' .env | tail -n 1 | cut -d= -f2- || true)"
vpn_config="${vpn_config:-./ops/vpn/custom.conf}"
host_vpn_config="$vpn_config"
case "$host_vpn_config" in
  /app/ops/vpn/*) host_vpn_config="./ops/vpn/${host_vpn_config#/app/ops/vpn/}" ;;
esac
if [ ! -f "$host_vpn_config" ]; then
  echo "Warning: VPN config not found: $host_vpn_config" >&2
  echo "Add an OpenVPN profile under ops/vpn/ or set VPN_CONFIG in .env before starting long runs." >&2
fi

if [ -z "${REDQUEENX_UID:-}" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    export REDQUEENX_UID="$(stat -c '%u' "$repo_dir")"
    [ "$REDQUEENX_UID" != "0" ] || export REDQUEENX_UID=1000
  else
    export REDQUEENX_UID="$(id -u)"
  fi
fi

if [ -z "${REDQUEENX_GID:-}" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    export REDQUEENX_GID="$(stat -c '%g' "$repo_dir")"
    [ "$REDQUEENX_GID" != "0" ] || export REDQUEENX_GID=1000
  else
    export REDQUEENX_GID="$(id -g)"
  fi
fi

mkdir -p runtime/docker/caddy-logs
chown "$REDQUEENX_UID:$REDQUEENX_GID" .env 2>/dev/null || true
chown -R "$REDQUEENX_UID:$REDQUEENX_GID" runtime/docker 2>/dev/null || true

services=(admin vpn worker)
if [ "$with_caddy" = "true" ]; then
  services=(admin vpn worker caddy)
fi

echo "Using compose: ${compose[*]} -f $compose_file"
echo "Using runtime owner: $REDQUEENX_UID:$REDQUEENX_GID"

if [ "$pull_images" = "true" ]; then
  "${compose[@]}" -f "$compose_file" pull "${services[@]}"
fi

"${compose[@]}" -f "$compose_file" up -d --remove-orphans "${services[@]}"
"${compose[@]}" -f "$compose_file" ps

cat <<EOF

RedqueenX is starting.
Admin local endpoint: http://127.0.0.1:3005/admin

If this is a remote VPS and no reverse proxy is configured, open it from your PC with:
  ssh -L 3005:127.0.0.1:3005 <user>@<server-host>

Then open locally:
  http://127.0.0.1:3005/admin

Host health/fail2ban helpers:
  sudo ./ops/install-vps-health-collector.sh
  sudo ./ops/fail2ban/install-redqueenx.sh
EOF
