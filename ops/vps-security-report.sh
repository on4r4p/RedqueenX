#!/usr/bin/env sh
set -eu

since="${1:-30 days ago}"
compose_file="${REDQUEENX_COMPOSE_FILE:-/opt/RedqueenX/compose.prod.yaml}"

ip_regex='([0-9]{1,3}\.){3}[0-9]{1,3}'

section() {
  printf '\n== %s ==\n' "$1"
}

count_ips() {
  grep -Eo "$ip_regex" | sort | uniq -c | sort -nr
}

section "Window"
printf '%s\n' "$since"

section "SSH accepted login IPs"
journalctl -u ssh -u sshd --since "$since" --no-pager -o cat 2>/dev/null \
  | grep -Ei 'Accepted password|Accepted publickey|Accepted keyboard-interactive' \
  | count_ips || true

section "SSH failed login IPs"
journalctl -u ssh -u sshd --since "$since" --no-pager -o cat 2>/dev/null \
  | grep -Ei 'Failed password|Invalid user|authentication failure|Connection closed by authenticating user' \
  | count_ips || true

section "fail2ban status"
if command -v fail2ban-client >/dev/null 2>&1; then
  fail2ban-client status || true
  printf '\n'
  fail2ban-client status sshd || true
else
  printf 'fail2ban-client not installed\n'
fi

section "Caddy scanner IPs"
journalctl -u caddy --since "$since" --no-pager -o cat 2>/dev/null \
  | grep -Ei '\.env|wp-login\.php|xmlrpc\.php|phpmyadmin|phpMyAdmin|cgi-bin|boaform|HNAP1|vendor/phpunit|actuator|server-status|\.git|\.aws|config\.json' \
  | count_ips || true

section "RedqueenX webhook suspicious activity"
journalctl -u redqueenx-webhook --since "$since" --no-pager -o cat 2>/dev/null \
  | grep -Ei 'invalid payload signatures|error evaluating hook|error occurred|error in exec|POST /hooks' || true

section "Docker log IPs: all services"
if command -v docker >/dev/null 2>&1 && [ -f "$compose_file" ]; then
  docker compose -f "$compose_file" logs 2>/dev/null | count_ips || true
else
  printf 'docker or compose file unavailable: %s\n' "$compose_file"
fi

