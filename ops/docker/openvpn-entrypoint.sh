#!/usr/bin/env bash
set -euo pipefail

config_path="${VPN_CONFIG:-/app/ops/vpn/custom.conf}"
remote_host="${VPN_REMOTE_HOST:-}"
remote_port="${VPN_REMOTE_PORT:-1194}"
remote_proto="${VPN_REMOTE_PROTO:-udp}"
novnc_port="${X_LOGIN_NOVNC_PORT:-6080}"

if [[ ! -f "$config_path" ]]; then
  echo "OpenVPN config not found: $config_path" >&2
  exit 1
fi

first_remote="$(awk '$1 == "remote" { print $2, $3, $4; exit }' "$config_path")"
if [[ -z "$remote_host" && -n "$first_remote" ]]; then
  remote_host="$(awk '{ print $1 }' <<<"$first_remote")"
fi
if [[ "${VPN_REMOTE_PORT:-}" == "" && -n "$first_remote" ]]; then
  parsed_port="$(awk '{ print $2 }' <<<"$first_remote")"
  [[ -n "$parsed_port" ]] && remote_port="$parsed_port"
fi
if [[ "${VPN_REMOTE_PROTO:-}" == "" && -n "$first_remote" ]]; then
  parsed_proto="$(awk '{ print $3 }' <<<"$first_remote")"
  [[ -n "$parsed_proto" ]] && remote_proto="$parsed_proto"
fi
case "$remote_proto" in
  tcp*) remote_proto="tcp" ;;
  udp*) remote_proto="udp" ;;
esac

if [[ -z "$remote_host" ]]; then
  echo "VPN_REMOTE_HOST is empty and no remote line was found in $config_path." >&2
  exit 1
fi

remote_ip="$remote_host"
if [[ ! "$remote_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  remote_ip="$(getent ahostsv4 "$remote_host" | awk '{ print $1; exit }')"
fi
if [[ -z "$remote_ip" ]]; then
  echo "Unable to resolve VPN remote host: $remote_host" >&2
  exit 1
fi

if [[ ! "$novnc_port" =~ ^[0-9]+$ ]] || (( novnc_port < 1 || novnc_port > 65535 )); then
  echo "Warning: invalid X_LOGIN_NOVNC_PORT=$novnc_port; noVNC login UI will not be allowed." >&2
  novnc_port=""
fi

mkdir -p /app/runtime
sanitized_config="/app/runtime/docker-openvpn.conf"
config_dir="$(cd "$(dirname "$config_path")" && pwd)"

awk \
  -v remote_ip="$remote_ip" \
  -v remote_port="$remote_port" \
  -v remote_proto="$remote_proto" \
  -v config_dir="$config_dir" '
    function absolute_path(value) {
      if (value ~ /^\//) return value;
      if (value ~ /^\.\/ops\/vpn\//) return "/app/" substr(value, 3);
      if (value ~ /^ops\/vpn\//) return "/app/" value;
      return config_dir "/" value;
    }
    $1 == "remote" {
      if (!remote_done) {
        print "remote " remote_ip " " remote_port " " remote_proto;
        remote_done = 1;
      }
      next;
    }
    $1 ~ /^(up|down|route-up|route-pre-down|iproute|script-security|plugin)$/ { next; }
    $1 ~ /^(auth-user-pass|ca|cert|key|tls-auth|tls-crypt|pkcs12)$/ && NF >= 2 && $2 !~ /^<.*>$/ {
      print $1 " " absolute_path($2) (NF >= 3 ? " " $3 : "");
      next;
    }
    { print; }
    END {
      if (!remote_done) print "remote " remote_ip " " remote_port " " remote_proto;
    }
  ' "$config_path" > "$sanitized_config"

echo "Applying Docker VPN kill switch for $remote_ip:$remote_port/$remote_proto"
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP
iptables -F
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -o eth0 -p "$remote_proto" -d "$remote_ip" --dport "$remote_port" -j ACCEPT
if [[ -n "$novnc_port" ]]; then
  echo "Allowing Docker noVNC login UI on tcp/$novnc_port"
  iptables -A INPUT -i eth0 -p tcp --dport "$novnc_port" -j ACCEPT
fi
iptables -A OUTPUT -o tun+ -j ACCEPT

if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -P INPUT DROP || true
  ip6tables -P FORWARD DROP || true
  ip6tables -P OUTPUT DROP || true
  ip6tables -F || true
fi

exec openvpn --config "$sanitized_config"
