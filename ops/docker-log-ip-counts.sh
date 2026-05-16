#!/usr/bin/env bash
set -euo pipefail

redqueenx_dir="${REDQUEENX_DIR:-/opt/RedqueenX}"
compose_file="${REDQUEENX_COMPOSE_FILE:-compose.prod.yaml}"
ip_regex='([0-9]{1,3}\.){3}[0-9]{1,3}'

cd "$redqueenx_dir"

count_ips() {
  local label="$1"
  local service="${2:-}"
  local result

  echo "===== $label ====="
  if [[ -n "$service" ]]; then
    result="$(docker compose -f "$compose_file" logs "$service" 2>&1 | grep -Eo "$ip_regex" | sort | uniq -c | sort -nr || true)"
  else
    result="$(docker compose -f "$compose_file" logs 2>&1 | grep -Eo "$ip_regex" | sort | uniq -c | sort -nr || true)"
  fi

  if [[ -z "$result" ]]; then
    echo "No IP found."
  else
    printf '%s\n' "$result"
  fi
  echo
}

count_ips "all services"
count_ips "admin" "admin"
count_ips "worker" "worker"
count_ips "vpn" "vpn"
