#!/usr/bin/env sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_dir="$(CDPATH= cd -- "$script_dir/../.." && pwd)"
filter_dir="${FAIL2BAN_FILTER_DIR:-/etc/fail2ban/filter.d}"
jail_dir="${FAIL2BAN_JAIL_DIR:-/etc/fail2ban/jail.d}"
redqueenx_dir="${REDQUEENX_DIR:-$repo_dir}"
escaped_redqueenx_dir="$(printf '%s' "$redqueenx_dir" | sed 's/[&|]/\\&/g')"
tmp_jail="$(mktemp)"
trap 'rm -f "$tmp_jail"' EXIT

mkdir -p "$redqueenx_dir/runtime/docker/caddy-logs"
touch "$redqueenx_dir/runtime/docker/caddy-logs/access.log"

sed "s|/opt/RedqueenX|$escaped_redqueenx_dir|g" "$script_dir/jail.d/redqueenx-caddy.conf" > "$tmp_jail"

install -m 0644 "$script_dir/filter.d/redqueenx-caddy-status.conf" "$filter_dir/redqueenx-caddy-status.conf"
install -m 0644 "$script_dir/filter.d/redqueenx-caddy-scan-path.conf" "$filter_dir/redqueenx-caddy-scan-path.conf"
install -m 0644 "$tmp_jail" "$jail_dir/redqueenx-caddy.conf"

if command -v fail2ban-client >/dev/null 2>&1; then
  fail2ban-client reload
  fail2ban-client status redqueenx-caddy-status || true
  fail2ban-client status redqueenx-caddy-scan-path || true
else
  printf '%s\n' "fail2ban-client not found; install fail2ban, then run this script again." >&2
fi
