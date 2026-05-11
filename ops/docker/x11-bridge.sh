#!/usr/bin/env bash
set -euo pipefail

if ! command -v socat >/dev/null 2>&1; then
  echo "socat is required on the host. Install it before running the Docker x-login bridge." >&2
  exit 1
fi
if ! command -v xauth >/dev/null 2>&1; then
  echo "xauth is required on the host. Install it before running the Docker x-login bridge." >&2
  exit 1
fi
if [[ -z "${DISPLAY:-}" ]]; then
  echo "DISPLAY is empty. Connect with SSH X forwarding first, for example: ssh -X user@server." >&2
  exit 1
fi

display_value="$DISPLAY"
display_number="$(sed -E 's/^([^:]+:)?([0-9]+)(\.[0-9]+)?$/\2/' <<<"$display_value")"
if [[ ! "$display_number" =~ ^[0-9]+$ ]]; then
  echo "Unable to parse DISPLAY=$DISPLAY. Expected an SSH X forwarding display like localhost:10.0." >&2
  exit 1
fi

source_port=$((6000 + display_number))
source_host="127.0.0.1"
if [[ "$display_value" =~ ^([^:]+): ]]; then
  raw_host="${BASH_REMATCH[1]}"
  if [[ -n "$raw_host" && "$raw_host" != "localhost" && "$raw_host" != "unix" ]]; then
    source_host="$raw_host"
  fi
fi

docker_host_ip="$(ip -4 addr show docker0 2>/dev/null | awk '/inet / { split($2, a, "/"); print a[1]; exit }')"
if [[ -z "$docker_host_ip" ]]; then
  docker_host_ip="$(ip -4 route get 172.17.0.2 2>/dev/null | awk '{ for (i=1; i<=NF; i++) if ($i == "src") { print $(i+1); exit } }')"
fi
if [[ -z "$docker_host_ip" ]]; then
  echo "Unable to find a Docker bridge IPv4 address. Is Docker running?" >&2
  exit 1
fi

xauthority="${DOCKER_XAUTHORITY:-/tmp/redqueenx-docker.xauth}"
rm -f "$xauthority"
touch "$xauthority"
chmod 600 "$xauthority"

if ! xauth nlist "$DISPLAY" | sed -e 's/^..../ffff/' | xauth -f "$xauthority" nmerge - >/dev/null 2>&1; then
  echo "Unable to copy xauth entries for DISPLAY=$DISPLAY into $xauthority." >&2
  exit 1
fi

cat <<EOF
Docker X11 bridge is ready.

Export these variables in the shell that runs docker compose:
  export DOCKER_X11_FORWARD_ENABLED=true
  export DOCKER_X11_HOST=$docker_host_ip
  export DOCKER_X11_PORT=$source_port
  export DOCKER_XAUTHORITY=$xauthority

Then run:
  docker compose run --rm x-login --account-id <id>

Bridge: $docker_host_ip:$source_port -> $source_host:$source_port
Keep this process running while x-login is open.
EOF

exec socat "TCP-LISTEN:${source_port},bind=${docker_host_ip},reuseaddr,fork" "TCP:${source_host}:${source_port}"
