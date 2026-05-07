#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_USER="${SUDO_USER:-${USER:-}}"
HELPER_PATH="/usr/local/sbin/redqueenx-netns"
HELPER_SCRIPT="/usr/local/libexec/redqueenx-netns-helper.sh"
SUDOERS_PATH="/etc/sudoers.d/redqueenx-netns"

if [[ -z "$RUN_USER" ]]; then
  echo "Cannot detect the user that should run RedqueenX." >&2
  exit 1
fi

if [[ "$EUID" -ne 0 ]]; then
  exec sudo bash "$0"
fi

RUN_USER="${RUN_USER:-${SUDO_USER:-}}"
PROJECT_DIR="${PROJECT_DIR:-}"
if [[ -z "$PROJECT_DIR" || -z "$RUN_USER" ]]; then
  echo "PROJECT_DIR and RUN_USER are required." >&2
  exit 1
fi

RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
RUN_GROUP="$(id -gn "$RUN_USER")"
if [[ -z "$RUN_HOME" ]]; then
  echo "Cannot detect home directory for $RUN_USER." >&2
  exit 1
fi
if [[ -z "$RUN_GROUP" ]]; then
  echo "Cannot detect primary group for $RUN_USER." >&2
  exit 1
fi

install -d -m 0755 "$(dirname "$HELPER_PATH")"
install -d -m 0755 "$(dirname "$HELPER_SCRIPT")"

cat >"$HELPER_SCRIPT" <<EOF_HELPER
#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$PROJECT_DIR"
RUN_USER="$RUN_USER"
RUN_HOME="$RUN_HOME"
CURRENT_SESSION_FILE="\$PROJECT_DIR/runtime/current-session.log"

load_env_file() {
  local file="\$1"
  [[ -f "\$file" ]] || return 0
  local line key value
  while IFS= read -r line || [[ -n "\$line" ]]; do
    [[ "\$line" =~ ^[[:space:]]*((VPN_|PLAYWRIGHT_)[A-Z0-9_]*|CURRENT_SESSION_FILE)= ]] || continue
    key="\${line%%=*}"
    key="\${key//[[:space:]]/}"
    value="\${line#*=}"
    value="\${value%\$'\\r'}"
    if [[ "\$value" == \\"*\\" && "\$value" == *\\" ]]; then
      value="\${value:1:\${#value}-2}"
    fi
    export "\$key=\$value"
  done <"\$file"
}

append_session() {
  local level="\$1"
  local type="\$2"
  local message="\$3"
  local data="\${4:-}"
  mkdir -p "\$(dirname "\$CURRENT_SESSION_FILE")"
  if [[ -n "\$data" ]]; then
    printf '[%s] %s %s %s %s\\n' "\$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")" "\$level" "\$type" "\$message" "\$data" >>"\$CURRENT_SESSION_FILE"
  else
    printf '[%s] %s %s %s\\n' "\$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")" "\$level" "\$type" "\$message" >>"\$CURRENT_SESSION_FILE"
  fi
}

load_env_file "\$PROJECT_DIR/.env"
load_env_file "\$PROJECT_DIR/ops/netns/env.local"
CURRENT_SESSION_FILE="\${CURRENT_SESSION_FILE:-\$PROJECT_DIR/runtime/current-session.log}"

NETNS="\${VPN_NETNS_NAME:-redqueenx-vpn}"
CIDR="\${VPN_NETNS_CIDR:-10.200.0.0/24}"
HOST_IP="\${VPN_NETNS_HOST_IP:-10.200.0.1}"
GUEST_IP="\${VPN_NETNS_GUEST_IP:-10.200.0.2}"
HOST_VETH="rqvpn-host"
NS_VETH="rqvpn-ns"
REMOTE_HOST="\${VPN_REMOTE_HOST:-}"
REMOTE_PORT="\${VPN_REMOTE_PORT:-1194}"
REMOTE_PROTO="\${VPN_REMOTE_PROTO:-udp}"
HOST_IFACE="\${VPN_HOST_IFACE:-}"

require_match() {
  local label="\$1"
  local value="\$2"
  local pattern="\$3"
  if [[ ! "\$value" =~ \$pattern ]]; then
    echo "Invalid \$label: \$value" >&2
    exit 64
  fi
}

validate_config() {
  require_match "VPN_NETNS_NAME" "\$NETNS" '^[A-Za-z0-9_.-]{1,48}$'
  require_match "VPN_NETNS_CIDR" "\$CIDR" '^([0-9]{1,3}\\.){3}[0-9]{1,3}/[0-9]{1,2}$'
  require_match "VPN_NETNS_HOST_IP" "\$HOST_IP" '^([0-9]{1,3}\\.){3}[0-9]{1,3}$'
  require_match "VPN_NETNS_GUEST_IP" "\$GUEST_IP" '^([0-9]{1,3}\\.){3}[0-9]{1,3}$'
  require_match "VPN_REMOTE_PORT" "\$REMOTE_PORT" '^[0-9]{1,5}$'
  require_match "VPN_REMOTE_PROTO" "\$REMOTE_PROTO" '^(udp|tcp)$'
  if [[ -n "\$HOST_IFACE" ]]; then
    require_match "VPN_HOST_IFACE" "\$HOST_IFACE" '^[A-Za-z0-9_.:-]{1,64}$'
  fi
}

validate_config

detect_host_iface() {
  if [[ -z "\$HOST_IFACE" ]]; then
    HOST_IFACE="\$(ip route show default | awk '{print \$5; exit}')"
  fi
}

resolve_remote_ip() {
  if [[ -z "\$REMOTE_HOST" ]]; then
    echo "VPN_REMOTE_HOST is required." >&2
    exit 1
  fi
  getent ahostsv4 "\$REMOTE_HOST" | awk '{print \$1; exit}'
}

delete_rule() {
  local table="\$1"
  shift
  if [[ -n "\$table" ]]; then
    while iptables -t "\$table" -C "\$@" 2>/dev/null; do
      iptables -t "\$table" -D "\$@" 2>/dev/null || break
    done
  else
    while iptables -C "\$@" 2>/dev/null; do
      iptables -D "\$@" 2>/dev/null || break
    done
  fi
}

setup_namespace() {
  detect_host_iface
  local remote_ip
  remote_ip="\$(resolve_remote_ip)"
  if [[ -z "\$remote_ip" ]]; then
    echo "Cannot resolve VPN_REMOTE_HOST=\$REMOTE_HOST" >&2
    exit 1
  fi

  sysctl -w net.ipv4.ip_forward=1 >/dev/null
  ip netns list | awk '{print \$1}' | grep -qx "\$NETNS" || ip netns add "\$NETNS"

  if ! ip link show "\$HOST_VETH" >/dev/null 2>&1; then
    ip link add "\$HOST_VETH" type veth peer name "\$NS_VETH"
    ip link set "\$NS_VETH" netns "\$NETNS"
  fi

  ip addr replace "\$HOST_IP/24" dev "\$HOST_VETH"
  ip link set "\$HOST_VETH" up
  ip netns exec "\$NETNS" ip addr replace "\$GUEST_IP/24" dev "\$NS_VETH"
  ip netns exec "\$NETNS" ip link set lo up
  ip netns exec "\$NETNS" ip link set "\$NS_VETH" up
  ip netns exec "\$NETNS" ip route replace default via "\$HOST_IP" dev "\$NS_VETH"

  mkdir -p "/etc/netns/\$NETNS"
  printf "nameserver 1.1.1.1\\n" >"/etc/netns/\$NETNS/resolv.conf"

  iptables -t nat -C POSTROUTING -s "\$CIDR" -o "\$HOST_IFACE" -j MASQUERADE 2>/dev/null \\
    || iptables -t nat -A POSTROUTING -s "\$CIDR" -o "\$HOST_IFACE" -j MASQUERADE
  iptables -C FORWARD -i "\$HOST_VETH" -o "\$HOST_IFACE" -j ACCEPT 2>/dev/null \\
    || iptables -A FORWARD -i "\$HOST_VETH" -o "\$HOST_IFACE" -j ACCEPT
  iptables -C FORWARD -i "\$HOST_IFACE" -o "\$HOST_VETH" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null \\
    || iptables -A FORWARD -i "\$HOST_IFACE" -o "\$HOST_VETH" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

  ip netns exec "\$NETNS" iptables -F
  ip netns exec "\$NETNS" iptables -P INPUT DROP
  ip netns exec "\$NETNS" iptables -P FORWARD DROP
  ip netns exec "\$NETNS" iptables -P OUTPUT DROP
  ip netns exec "\$NETNS" iptables -A INPUT -i lo -j ACCEPT
  ip netns exec "\$NETNS" iptables -A OUTPUT -o lo -j ACCEPT
  ip netns exec "\$NETNS" iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  ip netns exec "\$NETNS" iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  ip netns exec "\$NETNS" iptables -A OUTPUT -o "\$NS_VETH" -p "\$REMOTE_PROTO" -d "\$remote_ip" --dport "\$REMOTE_PORT" -j ACCEPT
  ip netns exec "\$NETNS" iptables -A OUTPUT -o tun+ -j ACCEPT
  ip netns exec "\$NETNS" iptables -A INPUT -i tun+ -j ACCEPT

  if ip netns exec "\$NETNS" command -v ip6tables >/dev/null 2>&1; then
    ip netns exec "\$NETNS" ip6tables -F
    ip netns exec "\$NETNS" ip6tables -P INPUT DROP
    ip netns exec "\$NETNS" ip6tables -P FORWARD DROP
    ip netns exec "\$NETNS" ip6tables -P OUTPUT DROP
  fi

  ip netns exec "\$NETNS" sysctl -w net.ipv6.conf.all.disable_ipv6=1 >/dev/null
  ip netns exec "\$NETNS" sysctl -w net.ipv6.conf.default.disable_ipv6=1 >/dev/null
  ip netns exec "\$NETNS" sysctl -w net.ipv6.conf.lo.disable_ipv6=1 >/dev/null

  cat <<SETUP_EOF
Network namespace ready.
  namespace: \$NETNS
  host iface: \$HOST_IFACE
  VPN endpoint: \$remote_ip:\$REMOTE_PORT/\$REMOTE_PROTO

Kill switch policy:
  - only OpenVPN can leave through \$NS_VETH
  - crawler traffic can leave only through tun+
SETUP_EOF
}

teardown_namespace() {
  detect_host_iface
  if ip netns list | awk '{print \$1}' | grep -qx "\$NETNS"; then
    mapfile -t pids < <(ip netns pids "\$NETNS" 2>/dev/null || true)
    if [[ "\${#pids[@]}" -gt 0 ]]; then
      kill "\${pids[@]}" 2>/dev/null || true
      sleep 0.5
      kill -9 "\${pids[@]}" 2>/dev/null || true
    fi
  fi

  if ip link show "\$HOST_VETH" >/dev/null 2>&1; then
    ip link delete "\$HOST_VETH"
  fi

  if [[ -n "\$HOST_IFACE" ]]; then
    delete_rule nat POSTROUTING -s "\$CIDR" -o "\$HOST_IFACE" -j MASQUERADE
    delete_rule "" FORWARD -i "\$HOST_VETH" -o "\$HOST_IFACE" -j ACCEPT
    delete_rule "" FORWARD -i "\$HOST_IFACE" -o "\$HOST_VETH" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  fi

  if ip netns list | awk '{print \$1}' | grep -qx "\$NETNS"; then
    ip netns delete "\$NETNS"
  fi

  rm -rf "/etc/netns/\$NETNS"
  append_session "INFO" "vpn.netns.teardown" "Removed VPN namespace and RedqueenX forwarding rules" "{\\"namespace\\":\\"\$NETNS\\"}"
  echo "Removed namespace \$NETNS."
}

validate_runtime_openvpn_config() {
  local config_path="\$1"
  local expected="/tmp/redqueenx-\${NETNS}.ovpn"
  if [[ "\$config_path" != "\$expected" || ! -f "\$config_path" ]]; then
    echo "Refusing unexpected OpenVPN runtime config path: \$config_path" >&2
    exit 1
  fi

  if grep -Eiq '^[[:space:]]*(up|down|route-up|route-pre-down|ipchange|client-connect|client-disconnect|learn-address|auth-user-pass-verify|tls-verify)[[:space:]]' "\$config_path"; then
    echo "Refusing OpenVPN runtime config with script hook directives." >&2
    exit 1
  fi
}

run_in_namespace_as_user() {
  if [[ "\$#" -eq 0 ]]; then
    echo "run action requires a command." >&2
    exit 1
  fi
  local host_public_ipv4="\${VPN_HOST_PUBLIC_IPV4:-}"
  local host_public_ipv6="\${VPN_HOST_PUBLIC_IPV6:-}"
  if [[ "\${1:-}" == "--host-ipv4" ]]; then
    host_public_ipv4="\${2:-}"
    shift 2
  fi
  if [[ "\${1:-}" == "--host-ipv6" ]]; then
    host_public_ipv6="\${2:-}"
    shift 2
  fi
  if [[ "\$#" -eq 0 ]]; then
    echo "run action requires a command after host IP options." >&2
    exit 1
  fi
  local quoted_command=""
  local quoted_project=""
  local arg quoted_arg
  printf -v quoted_project "%q" "\$PROJECT_DIR"
  for arg in "\$@"; do
    printf -v quoted_arg "%q" "\$arg"
    quoted_command+="\$quoted_arg "
  done

  local run_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  local npm_path npm_dir
  if [[ -d "\$RUN_HOME/.nvm/versions/node" ]]; then
    while IFS= read -r npm_path; do
      npm_dir="\$(dirname "\$npm_path")"
      case ":\$run_path:" in
        *":\$npm_dir:"*) ;;
        *) run_path="\$npm_dir:\$run_path" ;;
      esac
    done < <(find "\$RUN_HOME/.nvm/versions/node" -path '*/bin/npm' -type f 2>/dev/null | sort -V)
  fi
  for npm_dir in "\$RUN_HOME/.local/bin" "\$RUN_HOME/bin"; do
    if [[ -d "\$npm_dir" ]]; then
      case ":\$run_path:" in
        *":\$npm_dir:"*) ;;
        *) run_path="\$npm_dir:\$run_path" ;;
      esac
    fi
  done

  ip netns exec "\$NETNS" runuser -u "\$RUN_USER" -- env \\
    HOME="\$RUN_HOME" \\
    PATH="\$run_path" \\
    CURRENT_SESSION_FILE="\$CURRENT_SESSION_FILE" \\
    VPN_DIAGNOSTIC_STRICT="\${VPN_DIAGNOSTIC_STRICT:-true}" \\
    VPN_DIAGNOSTIC_PLAYWRIGHT="\${VPN_DIAGNOSTIC_PLAYWRIGHT:-true}" \\
    VPN_CHECK_HOST_IPV4_LEAK="\${VPN_CHECK_HOST_IPV4_LEAK:-true}" \\
    VPN_CHECK_IPV6="\${VPN_CHECK_IPV6:-true}" \\
    VPN_HOST_PUBLIC_IPV4="\$host_public_ipv4" \\
    VPN_HOST_PUBLIC_IPV6="\$host_public_ipv6" \\
    REDQUEENX_VPN_NETNS="\$NETNS" \\
    REDQUEENX_VPN_PRECHECKED="true" \\
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="\${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" \\
    PLAYWRIGHT_DISABLE_SANDBOX="\${PLAYWRIGHT_DISABLE_SANDBOX:-true}" \\
    DISPLAY="\${DISPLAY:-}" \\
    WAYLAND_DISPLAY="\${WAYLAND_DISPLAY:-}" \\
    XDG_SESSION_TYPE="\${XDG_SESSION_TYPE:-}" \\
    XAUTHORITY="\${XAUTHORITY:-}" \\
    XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-}" \\
    DBUS_SESSION_BUS_ADDRESS="\${DBUS_SESSION_BUS_ADDRESS:-}" \\
    bash -lc "cd \$quoted_project && \$quoted_command"
}

action="\${1:-status}"
shift || true

case "\$action" in
  status)
    ip netns list >/dev/null
    ;;
  list)
    ip netns list
    ;;
  links)
    ip netns exec "\$NETNS" ip -o link show
    ;;
  pids)
    ip netns pids "\$NETNS" 2>/dev/null || true
    ;;
  netns-id)
    ip netns exec "\$NETNS" readlink /proc/self/ns/net
    ;;
  setup)
    setup_namespace
    ;;
  teardown)
    teardown_namespace
    ;;
  openvpn)
    config_path="\${1:-}"
    validate_runtime_openvpn_config "\$config_path"
    ip netns exec "\$NETNS" openvpn --cd "\$PROJECT_DIR" --config "\$config_path"
    ;;
  run)
    run_in_namespace_as_user "\$@"
    ;;
  *)
    echo "Unsupported redqueenx-netns action: \$action" >&2
    exit 64
    ;;
esac
EOF_HELPER

chmod 0755 "$HELPER_SCRIPT"
chown root:root "$HELPER_SCRIPT"

WRAPPER_C="$(mktemp /tmp/redqueenx-netns-wrapper.XXXXXX.c)"
cat >"$WRAPPER_C" <<EOF_C
#define _GNU_SOURCE
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static const char *helper_script = "$HELPER_SCRIPT";

static int safe_env_value(const char *value) {
  if (value == NULL) return 0;
  for (const char *p = value; *p; ++p) {
    if (*p == '\\n' || *p == '\\r') return 0;
  }
  return strlen(value) < 4096;
}

int main(int argc, char **argv) {
  const char *keys[] = {
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XDG_SESSION_TYPE",
    "XAUTHORITY",
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
    "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
    "PLAYWRIGHT_DISABLE_SANDBOX",
    NULL
  };
  char *values[sizeof(keys) / sizeof(keys[0])];
  memset(values, 0, sizeof(values));

  for (int i = 0; keys[i] != NULL; ++i) {
    const char *value = getenv(keys[i]);
    if (safe_env_value(value)) {
      values[i] = strdup(value);
      if (values[i] == NULL) {
        perror("strdup");
        return 125;
      }
    }
  }

  if (setgid(0) != 0 || setuid(0) != 0) {
    perror("setuid/setgid");
    return 126;
  }

  clearenv();
  setenv("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", 1);
  setenv("REDQUEENX_NETNS_SETUID", "1", 1);
  for (int i = 0; keys[i] != NULL; ++i) {
    if (values[i] != NULL) {
      setenv(keys[i], values[i], 1);
    }
  }

  char **exec_args = calloc((size_t)argc + 3, sizeof(char *));
  if (exec_args == NULL) {
    perror("calloc");
    return 125;
  }
  exec_args[0] = "bash";
  exec_args[1] = "-p";
  exec_args[2] = (char *)helper_script;
  for (int i = 1; i < argc; ++i) {
    exec_args[i + 2] = argv[i];
  }
  exec_args[argc + 2] = NULL;

  execv("/bin/bash", exec_args);
  perror("execv");
  return 127;
}
EOF_C

cc -O2 -Wall -Wextra -o "$HELPER_PATH" "$WRAPPER_C"
rm -f "$WRAPPER_C"
chown root:"$RUN_GROUP" "$HELPER_PATH"
chmod 4750 "$HELPER_PATH"

cat >"$SUDOERS_PATH" <<EOF_SUDOERS
# RedqueenX network namespace installer fallback.
# Runtime uses the root-owned setuid helper at $HELPER_PATH.
$RUN_USER ALL=(root) NOPASSWD: $HELPER_PATH *
EOF_SUDOERS

chmod 0440 "$SUDOERS_PATH"
chown root:root "$SUDOERS_PATH"

if command -v visudo >/dev/null 2>&1; then
  visudo -cf "$SUDOERS_PATH"
fi

echo "Installed $HELPER_PATH"
echo "Installed $HELPER_SCRIPT"
echo "Installed $SUDOERS_PATH"
echo
echo "Admin Start/Resume can now prepare the VPN namespace without asking for a sudo password."
echo "Check it with:"
echo "  $HELPER_PATH status"
