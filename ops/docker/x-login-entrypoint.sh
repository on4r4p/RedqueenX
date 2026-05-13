#!/usr/bin/env bash
set -euo pipefail

display="${X_LOGIN_DISPLAY:-:99}"
screen="${X_LOGIN_SCREEN:-1920x1080x24}"
novnc_port="${X_LOGIN_NOVNC_PORT:-6080}"
vnc_port="${X_LOGIN_VNC_PORT:-5900}"
service_max_seconds="${X_LOGIN_SERVICE_MAX_SECONDS:-1200}"
runtime_dir="${XDG_RUNTIME_DIR:-/tmp/redqueenx-x-login-runtime}"
display_number="${display#*:}"
display_number="${display_number%%.*}"

if [[ ! "$display" =~ ^:[0-9]+(\.[0-9]+)?$ ]]; then
  echo "X_LOGIN_DISPLAY must be a local display such as :99." >&2
  exit 1
fi
if [[ ! "$novnc_port" =~ ^[0-9]+$ ]] || (( novnc_port < 1 || novnc_port > 65535 )); then
  echo "X_LOGIN_NOVNC_PORT must be a TCP port such as 6080." >&2
  exit 1
fi
if [[ ! "$vnc_port" =~ ^[0-9]+$ ]] || (( vnc_port < 1 || vnc_port > 65535 )); then
  echo "X_LOGIN_VNC_PORT must be a TCP port such as 5900." >&2
  exit 1
fi
if [[ ! "$service_max_seconds" =~ ^[0-9]+$ ]] || (( service_max_seconds < 60 || service_max_seconds > 86400 )); then
  echo "X_LOGIN_SERVICE_MAX_SECONDS must be between 60 and 86400 seconds." >&2
  exit 1
fi

mkdir -p "$runtime_dir"
chmod 700 "$runtime_dir"
export XDG_RUNTIME_DIR="$runtime_dir"
export DISPLAY="$display"

rm -f "/tmp/.X${display_number}-lock" "/tmp/.X11-unix/X${display_number}"

pids=()
login_pid=""
cleanup() {
  trap - EXIT INT TERM
  if [[ -n "${login_pid:-}" ]] && kill -0 "$login_pid" >/dev/null 2>&1; then
    kill "$login_pid" >/dev/null 2>&1 || true
    for _ in $(seq 1 50); do
      if ! kill -0 "$login_pid" >/dev/null 2>&1; then
        break
      fi
      sleep 0.1
    done
    if kill -0 "$login_pid" >/dev/null 2>&1; then
      kill -9 "$login_pid" >/dev/null 2>&1 || true
    fi
  fi
  if command -v pkill >/dev/null 2>&1; then
    pkill -TERM -f "node .*xLogin\\.js|npm run x:login|google-chrome|chromium|firefox" >/dev/null 2>&1 || true
  fi
  for pid in "${pids[@]:-}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
}
handle_signal() {
  cleanup
  exit 130
}
trap cleanup EXIT
trap handle_signal INT TERM

Xvfb "$display" -screen 0 "$screen" -nolisten tcp >/tmp/redqueenx-xvfb.log 2>&1 &
pids+=("$!")

display_ready() {
  timeout 1s xdpyinfo -display "$display" >/dev/null 2>&1
}

for _ in $(seq 1 50); do
  if display_ready; then
    break
  fi
  sleep 0.1
done
if ! display_ready; then
  echo "Xvfb did not become ready on DISPLAY=$display." >&2
  cat /tmp/redqueenx-xvfb.log >&2 || true
  exit 1
fi

fluxbox >/tmp/redqueenx-fluxbox.log 2>&1 &
pids+=("$!")

if command -v numlockx >/dev/null 2>&1; then
  numlockx on >/tmp/redqueenx-numlockx.log 2>&1 || true
fi

if [[ -n "${X_LOGIN_KEYBOARD_LAYOUT:-}" ]] && command -v setxkbmap >/dev/null 2>&1; then
  setxkbmap "$X_LOGIN_KEYBOARD_LAYOUT" >/tmp/redqueenx-setxkbmap.log 2>&1 || true
fi

if command -v autocutsel >/dev/null 2>&1; then
  autocutsel -selection CLIPBOARD >/tmp/redqueenx-autocutsel-clipboard.log 2>&1 &
  pids+=("$!")
  autocutsel -selection PRIMARY >/tmp/redqueenx-autocutsel-primary.log 2>&1 &
  pids+=("$!")
fi

x11vnc -display "$display" -rfbport "$vnc_port" -listen 127.0.0.1 -forever -shared -nopw -quiet >/tmp/redqueenx-x11vnc.log 2>&1 &
pids+=("$!")

websockify --web=/usr/share/novnc "0.0.0.0:${novnc_port}" "127.0.0.1:${vnc_port}" >/tmp/redqueenx-novnc.log 2>&1 &
pids+=("$!")

echo "Launching visible X login through Docker VPN using noVNC."
echo "Open: http://127.0.0.1:${novnc_port}/vnc.html?autoconnect=1&resize=scale"
echo "If this runs on a VPS, open the URL through an SSH tunnel to 127.0.0.1:${novnc_port}."
echo "This noVNC login service will stop automatically after ${service_max_seconds}s."

set +e
timeout --foreground --kill-after=15s "${service_max_seconds}s" npm run x:login -- "$@" &
login_pid="$!"
wait "$login_pid"
status=$?
login_pid=""
set -e
if [[ "$status" == "124" || "$status" == "137" ]]; then
  echo "X login noVNC service reached its maximum lifetime and was stopped." >&2
fi
exit "$status"
