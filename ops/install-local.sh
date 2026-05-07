#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

missing=()
for command_name in node npm sudo ip iptables openvpn getent awk sed grep flock curl runuser sysctl ps install chmod chown cc; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    missing+=("$command_name")
  fi
done

if [[ "${#missing[@]}" -gt 0 ]]; then
  echo "Missing required commands: ${missing[*]}" >&2
  echo "Install them first, then rerun: npm run setup:local" >&2
  exit 1
fi

chmod +x \
  ./ops/netns/install-root-helper.sh \
  ./ops/netns/openvpn.sh \
  ./ops/netns/run.sh \
  ./ops/netns/setup.sh \
  ./ops/netns/sudo-unlock.sh \
  ./ops/netns/teardown-wrapper.sh \
  ./ops/netns/teardown.sh \
  ./ops/app-control.sh

echo "Installing RedqueenX local network namespace helper..."
echo "You may be asked for sudo once. The password is handled by sudo in this terminal only."
echo

./ops/netns/install-root-helper.sh

echo
echo "Verifying helper access..."
if [[ ! -u /usr/local/sbin/redqueenx-netns ]]; then
  echo "Helper was installed, but it is not setuid root." >&2
  echo "RedqueenX cannot safely prepare the VPN namespace from the admin UI without that bit." >&2
  echo "Check that /usr/local is not mounted with nosuid, then rerun: npm run setup:local" >&2
  exit 1
fi
/usr/local/sbin/redqueenx-netns status >/dev/null
echo "Helper access OK."

echo
echo "Local setup completed."
echo
echo "Starting RedqueenX admin server..."
./ops/app-control.sh restart

echo
echo "Normal workflow from now on:"
echo "  1. Open http://127.0.0.1:3005/admin"
echo "  2. Click Start/Resume"
echo
echo "Start/Resume will prepare the VPN namespace, run diagnostics, and launch the without-API worker."
echo "You should not need to manually run netns:openvpn or netns:diagnose during normal use."

if ps -eo args= | grep -E 'ops/netns/openvpn\.sh|openvpn --cd .+redqueenx' | grep -v grep >/dev/null 2>&1; then
  echo
  echo "Existing RedqueenX VPN processes are currently running."
  echo "After closing any old OpenVPN terminal, reset once with:"
  echo "  npm run netns:teardown"
fi
