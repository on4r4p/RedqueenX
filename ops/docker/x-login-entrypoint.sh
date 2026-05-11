#!/usr/bin/env bash
set -euo pipefail

if [[ "${DOCKER_X11_FORWARD_ENABLED:-false}" != "true" ]]; then
  echo "DOCKER_X11_FORWARD_ENABLED must be true for docker x-login." >&2
  echo "Prepare SSH X forwarding with: ops/docker/x11-bridge.sh" >&2
  exit 1
fi

x11_host="${DOCKER_X11_HOST:-}"
x11_port="${DOCKER_X11_PORT:-6010}"
xauthority="${DOCKER_XAUTHORITY:-/tmp/redqueenx-docker.xauth}"

if [[ -z "$x11_host" ]]; then
  echo "DOCKER_X11_HOST is empty. Run ops/docker/x11-bridge.sh on the host and export its variables." >&2
  exit 1
fi
if [[ ! "$x11_port" =~ ^[0-9]+$ ]] || (( x11_port < 6001 || x11_port > 65535 )); then
  echo "DOCKER_X11_PORT must be a TCP X11 port such as 6010." >&2
  exit 1
fi
if [[ ! -r "$xauthority" ]]; then
  echo "Xauthority file is not readable in the container: $xauthority" >&2
  echo "Run ops/docker/x11-bridge.sh and mount the generated DOCKER_XAUTHORITY path." >&2
  exit 1
fi

display_number=$((x11_port - 6000))
export DISPLAY="${x11_host}:${display_number}.0"
export XAUTHORITY="$xauthority"

echo "Launching visible X login through Docker VPN using DISPLAY=$DISPLAY"
exec npm run x:login -- "$@"
