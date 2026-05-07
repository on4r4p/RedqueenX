#!/usr/bin/env bash
set -euo pipefail

CURRENT_SESSION_FILE="${CURRENT_SESSION_FILE:-./runtime/current-session.log}"

append_session() {
  local level="$1"
  local type="$2"
  local message="$3"
  local data="${4:-}"
  local dir
  dir="$(dirname "$CURRENT_SESSION_FILE")"
  mkdir -p "$dir"
  if [[ -n "$data" ]]; then
    printf '[%s] %s %s %s %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")" "$level" "$type" "$message" "$data" >>"$CURRENT_SESSION_FILE"
  else
    printf '[%s] %s %s %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")" "$level" "$type" "$message" >>"$CURRENT_SESSION_FILE"
  fi
}

echo "RedqueenX sudo unlock"
echo "This does not store your sudo password in RedqueenX."
echo "It only asks sudo to cache your authorization for this local machine."
echo

sudo -v

if sudo -n ip netns list >/dev/null 2>&1; then
  append_session "INFO" "vpn.sudo_unlocked" "Sudo is available without a prompt for VPN namespace checks" "{\"available\":true}"
  echo
  echo "Sudo is currently available without a prompt."
  echo "You can now press Start/Resume in admin; RedqueenX will still run VPN diagnostics before opening Playwright."
  echo
  echo "If Start still says sudo is required, keep npm run netns:openvpn running in a terminal."
else
  append_session "PROB" "vpn.sudo_unlock_failed" "Sudo unlock did not make non-interactive namespace commands available" "{\"available\":false}"
  echo
  echo "Sudo accepted the password, but non-interactive namespace commands are still unavailable."
  echo "This usually means sudo timestamps are tied to this terminal."
  echo "Fallback: keep this running in a terminal before pressing Start:"
  echo "  npm run netns:openvpn"
  exit 1
fi
