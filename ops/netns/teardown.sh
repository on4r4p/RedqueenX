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
CIDR="${VPN_NETNS_CIDR:-10.200.0.0/24}"
HOST_VETH="rqvpn-host"
HOST_IFACE="${VPN_HOST_IFACE:-}"
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

if [[ -z "$HOST_IFACE" ]]; then
  HOST_IFACE="$(ip route show default | awk '{print $5; exit}')"
fi

delete_rule() {
  local table="$1"
  shift
  if [[ -n "$table" ]]; then
    while iptables -t "$table" -C "$@" 2>/dev/null; do
      iptables -t "$table" -D "$@" 2>/dev/null || break
    done
  else
    while iptables -C "$@" 2>/dev/null; do
      iptables -D "$@" 2>/dev/null || break
    done
  fi
}

if ip netns list | awk '{print $1}' | grep -qx "$NETNS"; then
  mapfile -t pids < <(ip netns pids "$NETNS" 2>/dev/null || true)
  if [[ "${#pids[@]}" -gt 0 ]]; then
    kill "${pids[@]}" 2>/dev/null || true
    sleep 0.5
    kill -9 "${pids[@]}" 2>/dev/null || true
  fi
fi

if ip link show "$HOST_VETH" >/dev/null 2>&1; then
  ip link delete "$HOST_VETH"
fi

if [[ -n "$HOST_IFACE" ]]; then
  delete_rule nat POSTROUTING -s "$CIDR" -o "$HOST_IFACE" -j MASQUERADE
  delete_rule "" FORWARD -i "$HOST_VETH" -o "$HOST_IFACE" -j ACCEPT
  delete_rule "" FORWARD -i "$HOST_IFACE" -o "$HOST_VETH" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
fi

if ip netns list | awk '{print $1}' | grep -qx "$NETNS"; then
  ip netns delete "$NETNS"
fi

rm -rf "/etc/netns/$NETNS"
append_session "INFO" "vpn.netns.teardown" "Removed VPN namespace and RedqueenX forwarding rules" "{\"namespace\":\"$NETNS\"}"
echo "Removed namespace $NETNS."
