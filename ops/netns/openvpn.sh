#!/usr/bin/env bash
set -euo pipefail

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*((VPN_|PLAYWRIGHT_)[A-Z0-9_]*|CURRENT_SESSION_FILE)= ]] || continue
    key="${line%%=*}"
    key="${key//[[:space:]]/}"
    value="${line#*=}"
    value="${value%$'\r'}"
    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "$key=$value"
  done <"$file"
}

load_env_file ./.env
load_env_file ./ops/netns/env.local

NETNS="${VPN_NETNS_NAME:-redqueenx-vpn}"
VPN_CONFIG="${VPN_CONFIG:-./ops/vpn/custom.conf}"
REMOTE_HOST="${VPN_REMOTE_HOST:-}"
REMOTE_PORT="${VPN_REMOTE_PORT:-1194}"
REMOTE_PROTO="${VPN_REMOTE_PROTO:-udp}"
CURRENT_SESSION_FILE="${CURRENT_SESSION_FILE:-./runtime/current-session.log}"
RUNTIME_CONFIG="/tmp/redqueenx-${NETNS}.ovpn"
LOCK_FILE="/tmp/redqueenx-${NETNS}.openvpn.lock"
HELPER="${REDQUEENX_NETNS_HELPER:-/usr/local/sbin/redqueenx-netns}"
CLEANUP_ENABLED=false
SUDO_KEEPALIVE_PID=""

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

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$CLEANUP_ENABLED" == "true" ]]; then
    append_session "INFO" "vpn.openvpn.cleanup" "OpenVPN process ended; cleaning namespace resources" "{\"namespace\":\"$NETNS\",\"exitCode\":$status}"
    stop_sudo_keepalive
    if helper_available; then
      cleanup_command=("$HELPER" teardown)
    else
      cleanup_command=(sudo -n --preserve-env=VPN_NETNS_NAME,VPN_HOST_IFACE,VPN_NETNS_CIDR,VPN_NETNS_HOST_IP,VPN_NETNS_GUEST_IP,VPN_REMOTE_HOST,VPN_REMOTE_PORT,VPN_REMOTE_PROTO,CURRENT_SESSION_FILE bash ./ops/netns/teardown.sh)
    fi
    if ! "${cleanup_command[@]}" >/dev/null 2>&1; then
      append_session "PROB" "vpn.openvpn.cleanup_failed" "OpenVPN cleanup needs sudo; run npm run netns:teardown" "{\"namespace\":\"$NETNS\"}"
      echo "OpenVPN stopped, but cleanup needs sudo. Run: npm run netns:teardown" >&2
    fi
    rm -f "$RUNTIME_CONFIG"
  else
    stop_sudo_keepalive
  fi
  exit "$status"
}

trap cleanup EXIT INT TERM

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  append_session "PROB" "vpn.openvpn.blocked" "OpenVPN start refused because another RedqueenX OpenVPN launcher is already running" "{\"namespace\":\"$NETNS\"}"
  echo "Another RedqueenX OpenVPN launcher is already running for namespace $NETNS." >&2
  echo "Use the existing terminal, or stop it before starting a new VPN session." >&2
  exit 1
fi

helper_available() {
  [[ -x "$HELPER" && -u "$HELPER" ]] && "$HELPER" status >/dev/null 2>&1
}

start_sudo_keepalive() {
  if helper_available; then
    return 0
  fi
  sudo -v
  (
    while true; do
      sleep 60
      sudo -n true >/dev/null 2>&1 || exit 0
    done
  ) &
  SUDO_KEEPALIVE_PID="$!"
}

stop_sudo_keepalive() {
  if [[ -n "$SUDO_KEEPALIVE_PID" ]]; then
    kill "$SUDO_KEEPALIVE_PID" >/dev/null 2>&1 || true
    wait "$SUDO_KEEPALIVE_PID" 2>/dev/null || true
    SUDO_KEEPALIVE_PID=""
  fi
}

if [[ ! -f "$VPN_CONFIG" ]]; then
  echo "OpenVPN config not found: $VPN_CONFIG" >&2
  exit 1
fi

if [[ -z "$REMOTE_HOST" ]]; then
  echo "VPN_REMOTE_HOST is required. Copy ops/netns/env.example and export it first." >&2
  exit 1
fi

HOST_TUNNELS="$(ip -o link show | awk -F': ' '{print $2}' | sed 's/@.*//' | grep -E '^(tun|wg)[0-9A-Za-z_.-]*$' | paste -sd ',' - || true)"
if [[ "${VPN_REFUSE_HOST_TUN:-true}" != "false" && -n "$HOST_TUNNELS" ]]; then
  append_session "PROB" "vpn.openvpn.blocked" "Host tunnel interface already exists; refusing to start OpenVPN outside an isolated state" "{\"namespace\":\"$NETNS\",\"hostTunnels\":\"$HOST_TUNNELS\"}"
  echo "Host tunnel interface already exists: $HOST_TUNNELS" >&2
  echo "Refusing to start to avoid touching or relying on the host network." >&2
  echo "If this is stale, remove the stale host tunnel before retrying." >&2
  echo "If it is intentional, set VPN_REFUSE_HOST_TUN=false." >&2
  exit 1
fi

REMOTE_IP="$(getent ahostsv4 "$REMOTE_HOST" | awk '{print $1; exit}')"
if [[ -z "$REMOTE_IP" ]]; then
  echo "Cannot resolve VPN_REMOTE_HOST=$REMOTE_HOST" >&2
  exit 1
fi

start_sudo_keepalive

if helper_available; then
  namespace_list_command=("$HELPER" list)
  namespace_pids_command=("$HELPER" pids)
else
  namespace_list_command=(sudo ip netns list)
  namespace_pids_command=(sudo ip netns pids "$NETNS")
fi

if "${namespace_list_command[@]}" | awk '{print $1}' | grep -qx "$NETNS"; then
  mapfile -t namespace_pids < <("${namespace_pids_command[@]}" 2>/dev/null || true)
  for namespace_pid in "${namespace_pids[@]}"; do
    process_name="$(ps -p "$namespace_pid" -o comm= 2>/dev/null | tr -d '[:space:]' || true)"
    if [[ "$process_name" == "openvpn" ]]; then
      append_session "PROB" "vpn.openvpn.blocked" "OpenVPN start refused because an OpenVPN process already exists in the namespace" "{\"namespace\":\"$NETNS\",\"pid\":$namespace_pid}"
      echo "OpenVPN is already running inside namespace $NETNS (pid $namespace_pid)." >&2
      echo "Stop it first with Ctrl+C in its terminal or run: npm run netns:teardown" >&2
      exit 1
    fi
  done
fi

if helper_available; then
  "$HELPER" setup
else
  sudo --preserve-env=VPN_NETNS_NAME,VPN_HOST_IFACE,VPN_NETNS_CIDR,VPN_NETNS_HOST_IP,VPN_NETNS_GUEST_IP,VPN_REMOTE_HOST,VPN_REMOTE_PORT,VPN_REMOTE_PROTO,VPN_CONFIG,VPN_CHECK_HOST_IPV4_LEAK,VPN_CHECK_IPV6,VPN_DIAGNOSTIC_STRICT,VPN_DIAGNOSTIC_PLAYWRIGHT,PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,PLAYWRIGHT_DISABLE_SANDBOX,CURRENT_SESSION_FILE \
    bash ./ops/netns/setup.sh
fi
CLEANUP_ENABLED=true

HOST_NETNS_ID="$(readlink /proc/self/ns/net)"
if helper_available; then
  TARGET_NETNS_ID="$("$HELPER" netns-id)"
else
  TARGET_NETNS_ID="$(sudo ip netns exec "$NETNS" readlink /proc/self/ns/net)"
fi
if [[ "$HOST_NETNS_ID" == "$TARGET_NETNS_ID" ]]; then
  append_session "PROB" "vpn.openvpn.blocked" "Namespace isolation check failed; refusing OpenVPN start" "{\"namespace\":\"$NETNS\"}"
  echo "Namespace isolation check failed. Refusing to start OpenVPN." >&2
  exit 1
fi

awk '
  /^[[:space:]]*remote[[:space:]]+/ { next }
  /^[[:space:]]*remote-random([[:space:]]|$)/ { next }
  /^[[:space:]]*script-security([[:space:]]|$)/ { next }
  /^[[:space:]]*(up|down|route-up|route-pre-down|ipchange|client-connect|client-disconnect|learn-address|auth-user-pass-verify|tls-verify)([[:space:]]|$)/ { next }
  /^[[:space:]]*down-pre([[:space:]]|$)/ { next }
  { print }
' "$VPN_CONFIG" >"$RUNTIME_CONFIG"
{
  printf "\n# RedqueenX safety overrides: never run provider host DNS/hooks.\n"
  printf "script-security 0\n"
  printf "pull-filter ignore \"dhcp-option DNS\"\n"
  printf "pull-filter ignore \"dhcp-option DOMAIN\"\n"
  printf "pull-filter ignore \"ifconfig-ipv6\"\n"
  printf "pull-filter ignore \"route-ipv6\"\n"
  printf "pull-filter ignore \"redirect-gateway ipv6\"\n"
  printf "\n# Resolved on the host before the namespace kill switch is applied.\n"
  printf "remote %s %s %s\n" "$REMOTE_IP" "$REMOTE_PORT" "$REMOTE_PROTO"
} >>"$RUNTIME_CONFIG"
chmod 600 "$RUNTIME_CONFIG"

echo "Starting OpenVPN inside namespace $NETNS ..."
append_session "INFO" "vpn.openvpn.started" "Starting OpenVPN inside network namespace" "{\"namespace\":\"$NETNS\",\"remote\":\"$REMOTE_IP:$REMOTE_PORT/$REMOTE_PROTO\"}"
if helper_available; then
  "$HELPER" openvpn "$RUNTIME_CONFIG"
else
  sudo ip netns exec "$NETNS" openvpn --cd "$PWD" --config "$RUNTIME_CONFIG"
fi
