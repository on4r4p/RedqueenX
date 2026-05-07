#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

ADMIN_PORT="3005"
ADMIN_HOST="127.0.0.1"
RUNTIME_DIR="$PROJECT_DIR/runtime"
PID_FILE="$RUNTIME_DIR/redqueenx-app.pid"
LOG_FILE="$RUNTIME_DIR/redqueenx-app.log"

load_admin_env() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*ADMIN_(HOST|PORT)= ]] || continue
    key="${line%%=*}"
    key="${key//[[:space:]]/}"
    value="${line#*=}"
    value="${value%$'\r'}"
    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    fi
    case "$key" in
      ADMIN_PORT) ADMIN_PORT="$value" ;;
      ADMIN_HOST)
        if [[ "$value" != "0.0.0.0" && "$value" != "::" && -n "$value" ]]; then
          ADMIN_HOST="$value"
        fi
        ;;
    esac
  done <"$file"
}

server_url() {
  printf 'http://%s:%s/admin/login\n' "$ADMIN_HOST" "$ADMIN_PORT"
}

app_responds() {
  curl -fsS --max-time 2 "$(server_url)" >/dev/null 2>&1
}

pid_is_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

pid_file_pid() {
  [[ -f "$PID_FILE" ]] && tr -dc '0-9' <"$PID_FILE" || true
}

start_app() {
  mkdir -p "$RUNTIME_DIR"

  if app_responds; then
    echo "RedqueenX admin already responds at $(server_url)"
    return 0
  fi

  local old_pid
  old_pid="$(pid_file_pid)"
  if [[ -n "$old_pid" ]] && ! pid_is_alive "$old_pid"; then
    rm -f "$PID_FILE"
  fi

  if [[ -f "$PID_FILE" ]]; then
    echo "PID file exists but the admin does not respond: $PID_FILE" >&2
    echo "Run npm run app:stop, then npm run app:start." >&2
    exit 1
  fi

  : >"$LOG_FILE"
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -lc 'npm run dev' >>"$LOG_FILE" 2>&1 &
  else
    nohup bash -lc 'npm run dev' >>"$LOG_FILE" 2>&1 &
  fi
  local pid="$!"
  printf '%s\n' "$pid" >"$PID_FILE"

  local elapsed=0
  while [[ "$elapsed" -lt 25 ]]; do
    if app_responds; then
      echo "RedqueenX admin started at $(server_url)"
      echo "Log: $LOG_FILE"
      return 0
    fi
    if ! pid_is_alive "$pid"; then
      echo "RedqueenX admin failed to start. Last log lines:" >&2
      tail -n 40 "$LOG_FILE" >&2 || true
      rm -f "$PID_FILE"
      exit 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "RedqueenX admin did not answer after ${elapsed}s. Last log lines:" >&2
  tail -n 40 "$LOG_FILE" >&2 || true
  exit 1
}

stop_app() {
  local pid
  pid="$(pid_file_pid)"
  if [[ -z "$pid" ]]; then
    echo "No RedqueenX app PID file found."
    return 0
  fi

  if ! pid_is_alive "$pid"; then
    rm -f "$PID_FILE"
    echo "Removed stale RedqueenX app PID file."
    return 0
  fi

  kill "-$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1 || true
  local elapsed=0
  while [[ "$elapsed" -lt 10 ]]; do
    if ! pid_is_alive "$pid"; then
      rm -f "$PID_FILE"
      echo "RedqueenX admin stopped."
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  kill -9 "-$pid" >/dev/null 2>&1 || kill -9 "$pid" >/dev/null 2>&1 || true
  rm -f "$PID_FILE"
  echo "RedqueenX admin force-stopped."
}

status_app() {
  local pid
  pid="$(pid_file_pid)"
  if app_responds; then
    echo "RedqueenX admin is reachable at $(server_url)"
    [[ -n "$pid" ]] && echo "PID file: $pid"
    return 0
  fi

  if [[ -n "$pid" ]] && pid_is_alive "$pid"; then
    echo "RedqueenX process is running but admin is not reachable yet. PID: $pid"
    echo "Log: $LOG_FILE"
    return 1
  fi

  echo "RedqueenX admin is stopped."
  return 1
}

load_admin_env ./.env

case "${1:-status}" in
  start) start_app ;;
  stop) stop_app ;;
  restart)
    stop_app
    start_app
    ;;
  status) status_app ;;
  *)
    echo "Usage: $0 start|stop|restart|status" >&2
    exit 64
    ;;
esac
