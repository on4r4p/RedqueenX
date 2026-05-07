#!/usr/bin/env bash
set -euo pipefail

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(VPN_|PLAYWRIGHT_)[A-Z0-9_]*= ]] || continue
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
HOST_IP="${VPN_NETNS_HOST_IP:-10.200.0.1}"
GUEST_IP="${VPN_NETNS_GUEST_IP:-10.200.0.2}"
HOST_VETH="rqvpn-host"
NS_VETH="rqvpn-ns"
REMOTE_HOST="${VPN_REMOTE_HOST:-}"
REMOTE_PORT="${VPN_REMOTE_PORT:-1194}"
REMOTE_PROTO="${VPN_REMOTE_PROTO:-udp}"
HOST_IFACE="${VPN_HOST_IFACE:-}"

if [[ -z "$REMOTE_HOST" ]]; then
  echo "VPN_REMOTE_HOST is required. Copy ops/netns/env.example and export it first." >&2
  exit 1
fi

if [[ -z "$HOST_IFACE" ]]; then
  HOST_IFACE="$(ip route show default | awk '{print $5; exit}')"
fi

REMOTE_IP="$(getent ahostsv4 "$REMOTE_HOST" | awk '{print $1; exit}')"
if [[ -z "$REMOTE_IP" ]]; then
  echo "Cannot resolve VPN_REMOTE_HOST=$REMOTE_HOST" >&2
  exit 1
fi

sysctl -w net.ipv4.ip_forward=1 >/dev/null

ip netns list | awk '{print $1}' | grep -qx "$NETNS" || ip netns add "$NETNS"

if ! ip link show "$HOST_VETH" >/dev/null 2>&1; then
  ip link add "$HOST_VETH" type veth peer name "$NS_VETH"
  ip link set "$NS_VETH" netns "$NETNS"
fi

ip addr replace "$HOST_IP/24" dev "$HOST_VETH"
ip link set "$HOST_VETH" up

ip netns exec "$NETNS" ip addr replace "$GUEST_IP/24" dev "$NS_VETH"
ip netns exec "$NETNS" ip link set lo up
ip netns exec "$NETNS" ip link set "$NS_VETH" up
ip netns exec "$NETNS" ip route replace default via "$HOST_IP" dev "$NS_VETH"

mkdir -p "/etc/netns/$NETNS"
printf "nameserver 1.1.1.1\n" >"/etc/netns/$NETNS/resolv.conf"

iptables -t nat -C POSTROUTING -s "$CIDR" -o "$HOST_IFACE" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s "$CIDR" -o "$HOST_IFACE" -j MASQUERADE
iptables -C FORWARD -i "$HOST_VETH" -o "$HOST_IFACE" -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -i "$HOST_VETH" -o "$HOST_IFACE" -j ACCEPT
iptables -C FORWARD -i "$HOST_IFACE" -o "$HOST_VETH" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -i "$HOST_IFACE" -o "$HOST_VETH" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

ip netns exec "$NETNS" iptables -F
ip netns exec "$NETNS" iptables -P INPUT DROP
ip netns exec "$NETNS" iptables -P FORWARD DROP
ip netns exec "$NETNS" iptables -P OUTPUT DROP
ip netns exec "$NETNS" iptables -A INPUT -i lo -j ACCEPT
ip netns exec "$NETNS" iptables -A OUTPUT -o lo -j ACCEPT
ip netns exec "$NETNS" iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip netns exec "$NETNS" iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip netns exec "$NETNS" iptables -A OUTPUT -o "$NS_VETH" -p "$REMOTE_PROTO" -d "$REMOTE_IP" --dport "$REMOTE_PORT" -j ACCEPT
ip netns exec "$NETNS" iptables -A OUTPUT -o tun+ -j ACCEPT
ip netns exec "$NETNS" iptables -A INPUT -i tun+ -j ACCEPT

if ip netns exec "$NETNS" command -v ip6tables >/dev/null 2>&1; then
  ip netns exec "$NETNS" ip6tables -F
  ip netns exec "$NETNS" ip6tables -P INPUT DROP
  ip netns exec "$NETNS" ip6tables -P FORWARD DROP
  ip netns exec "$NETNS" ip6tables -P OUTPUT DROP
fi

ip netns exec "$NETNS" sysctl -w net.ipv6.conf.all.disable_ipv6=1 >/dev/null
ip netns exec "$NETNS" sysctl -w net.ipv6.conf.default.disable_ipv6=1 >/dev/null
ip netns exec "$NETNS" sysctl -w net.ipv6.conf.lo.disable_ipv6=1 >/dev/null

cat <<EOF
Network namespace ready.
  namespace: $NETNS
  host iface: $HOST_IFACE
  VPN endpoint: $REMOTE_IP:$REMOTE_PORT/$REMOTE_PROTO

Kill switch policy:
  - only OpenVPN can leave through $NS_VETH
  - crawler traffic can leave only through tun+
EOF
