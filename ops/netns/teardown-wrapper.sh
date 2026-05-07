#!/usr/bin/env bash
set -euo pipefail

HELPER="${REDQUEENX_NETNS_HELPER:-/usr/local/sbin/redqueenx-netns}"

if [[ -x "$HELPER" && -u "$HELPER" ]] && "$HELPER" status >/dev/null 2>&1; then
  exec "$HELPER" teardown
fi

exec sudo ./ops/netns/teardown.sh
