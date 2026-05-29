#!/usr/bin/env sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_dir="$(CDPATH= cd -- "$script_dir/.." && pwd)"
target_dir="${REDQUEENX_SYSTEMD_DIR:-/etc/systemd/system}"

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "Run with sudo so the systemd units can be installed." >&2
  exit 1
fi

escaped_repo_dir="$(printf '%s' "$repo_dir" | sed 's/[&|]/\\&/g')"
tmp_service="$(mktemp)"
trap 'rm -f "$tmp_service"' EXIT
sed "s|/opt/RedqueenX|$escaped_repo_dir|g" "$repo_dir/ops/systemd/redqueenx-vps-health.service" > "$tmp_service"

install -m 0644 "$tmp_service" "$target_dir/redqueenx-vps-health.service"
install -m 0644 "$repo_dir/ops/systemd/redqueenx-vps-health.timer" "$target_dir/redqueenx-vps-health.timer"
mkdir -p "$repo_dir/runtime/docker/caddy-logs"

systemctl daemon-reload
systemctl enable --now redqueenx-vps-health.timer
systemctl start redqueenx-vps-health.service || true
systemctl status --no-pager redqueenx-vps-health.timer || true
