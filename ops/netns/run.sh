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
RUN_USER="${SUDO_USER:-$USER}"
HOST_PUBLIC_IPV4="${VPN_HOST_PUBLIC_IPV4:-}"
HOST_PUBLIC_IPV6="${VPN_HOST_PUBLIC_IPV6:-}"
CURRENT_SESSION_FILE="${CURRENT_SESSION_FILE:-./runtime/current-session.log}"
AUTOSTART_TIMEOUT_SECONDS="${VPN_NETNS_AUTOSTART_TIMEOUT_SECONDS:-90}"
AUTOSTART_LOG="${VPN_NETNS_AUTOSTART_LOG:-./runtime/netns-openvpn-autostart.log}"
AUTOSTART_PID_FILE="${VPN_NETNS_AUTOSTART_PID_FILE:-./runtime/netns-openvpn-autostart.pid}"
HELPER="${REDQUEENX_NETNS_HELPER:-/usr/local/sbin/redqueenx-netns}"

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

detect_cloudflare_trace_ip() {
  local family="$1"
  local url="$2"
  curl "-$family" -fsSk --max-time 4 "$url" 2>/dev/null | awk -F= '$1 == "ip" { print $2; exit }' | tr -d '\r'
}

detect_plain_ip() {
  local family="$1"
  local url="$2"
  curl "-$family" -fsS --max-time 4 "$url" 2>/dev/null | tr -d '\r' | awk 'NF { print $1; exit }'
}

is_ipv4() {
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

is_ipv6() {
  [[ "$1" == *:* ]]
}

detect_host_public_ipv4() {
  local candidate
  for candidate in \
    "$(detect_cloudflare_trace_ip 4 https://1.1.1.1/cdn-cgi/trace)" \
    "$(detect_cloudflare_trace_ip 4 https://1.0.0.1/cdn-cgi/trace)" \
    "$(detect_plain_ip 4 https://api.ipify.org)" \
    "$(detect_plain_ip 4 https://ipv4.icanhazip.com)" \
    "$(detect_plain_ip 4 https://ifconfig.me/ip)" \
    "$(curl -4 -fsS --max-time 4 --resolve api.ipify.org:443:104.26.12.205 https://api.ipify.org 2>/dev/null | tr -d '\r' || true)"
  do
    if is_ipv4 "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

detect_host_public_ipv6() {
  local candidate
  for candidate in \
    "$(detect_cloudflare_trace_ip 6 https://[2606:4700:4700::1111]/cdn-cgi/trace)" \
    "$(detect_cloudflare_trace_ip 6 https://[2606:4700:4700::1001]/cdn-cgi/trace)" \
    "$(detect_plain_ip 6 https://api64.ipify.org)" \
    "$(detect_plain_ip 6 https://ipv6.icanhazip.com)"
  do
    if is_ipv6 "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if [[ "$#" -eq 0 ]]; then
  echo "Usage: $0 <command...>" >&2
  echo "Example: $0 npm run diagnose:vpn:dev" >&2
  exit 1
fi

original_npm_command() {
  if [[ -n "${REDQUEENX_ORIGINAL_NPM_COMMAND:-}" ]]; then
    echo "$REDQUEENX_ORIGINAL_NPM_COMMAND"
    return 0
  fi

  local script="${npm_lifecycle_event:-}"
  if [[ -z "$script" ]]; then
    echo "npm run netns:x-login -- --account-id <id>"
    return 0
  fi

  local remain=""
  if [[ -n "${npm_config_argv:-}" ]]; then
    remain="$(node -e '
      try {
        const parsed = JSON.parse(process.env.npm_config_argv || "{}");
        const args = Array.isArray(parsed.remain) ? parsed.remain : [];
        process.stdout.write(args.join(" "));
      } catch {}
    ' 2>/dev/null || true)"
  fi

  if [[ -n "$remain" ]]; then
    echo "npm run $script -- $remain"
  else
    echo "npm run $script"
  fi
}

print_vpn_start_instructions() {
  local original_command
  original_command="$(original_npm_command)"
  echo "" >&2
  echo "To run this command safely, start the VPN namespace first:" >&2
  echo "  npm run netns:teardown" >&2
  echo "  npm run netns:openvpn" >&2
  echo "" >&2
  echo "Keep npm run netns:openvpn running in that terminal, then open a second terminal and run:" >&2
  echo "  npm run netns:diagnose" >&2
  echo "  $original_command" >&2
}

print_x_login_context() {
  local original_command="$1"
  if [[ "$original_command" != *"x-login"* && "$original_command" != *"x:login"* ]]; then
    return 0
  fi

  node ./scripts/x-login-context.cjs "$original_command" >&2 || true
}

netns_exists() {
  if helper_available; then
    "$HELPER" list | awk '{print $1}' | grep -qx "$NETNS"
  else
    ip netns list | awk '{print $1}' | grep -qx "$NETNS"
  fi
}

tun_exists() {
  if ! netns_exists; then
    return 1
  fi

  if helper_available; then
    "$HELPER" links | awk -F': ' '{print $2}' | grep -q '^tun'
  else
    sudo ip netns exec "$NETNS" ip -o link show | awk -F': ' '{print $2}' | grep -q '^tun'
  fi
}

helper_available() {
  [[ -x "$HELPER" && -u "$HELPER" ]] && "$HELPER" status >/dev/null 2>&1
}

prompt_yes_no_default_yes() {
  local prompt="$1"
  local response

  if [[ "${VPN_NETNS_AUTOSTART:-true}" == "false" ]]; then
    return 1
  fi

  if [[ -r /dev/tty && -w /dev/tty ]]; then
    printf "%s [Y/n] " "$prompt" >/dev/tty
    IFS= read -r response </dev/tty || response=""
  else
    response="${VPN_NETNS_AUTOSTART_DEFAULT:-yes}"
    echo "$prompt [Y/n] $response" >&2
  fi

  [[ -z "$response" || "$response" =~ ^[Yy] ]]
}

tail_autostart_log() {
  if [[ -f "$AUTOSTART_LOG" ]]; then
    echo "" >&2
    echo "Last OpenVPN autostart log lines:" >&2
    tail -n 25 "$AUTOSTART_LOG" >&2 || true
  fi
}

wait_for_tun() {
  local pid="$1"
  local elapsed=0

  while [[ "$elapsed" -lt "$AUTOSTART_TIMEOUT_SECONDS" ]]; do
    if tun_exists; then
      return 0
    fi

    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 1
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

start_openvpn_for_command() {
  local reason="$1"
  local original_command
  local log_dir
  local pid_dir
  original_command="$(original_npm_command)"
  print_x_login_context "$original_command"

  if ! helper_available && ! prompt_yes_no_default_yes "Start the VPN namespace now and continue $original_command?"; then
    append_session "PROB" "vpn.autostart.declined" "VPN autostart declined by user" "{\"namespace\":\"$NETNS\",\"reason\":\"$reason\"}"
    return 1
  fi

  append_session "INFO" "vpn.autostart.started" "Starting VPN namespace automatically before command" "{\"namespace\":\"$NETNS\",\"reason\":\"$reason\"}"

  log_dir="$(dirname "$AUTOSTART_LOG")"
  pid_dir="$(dirname "$AUTOSTART_PID_FILE")"
  mkdir -p "$log_dir" "$pid_dir"
  : >"$AUTOSTART_LOG"

  echo "Preparing the VPN namespace..." >&2
  if ! helper_available; then
    sudo -v
  fi
  npm run netns:teardown

  echo "Starting npm run netns:openvpn in the background..." >&2
  echo "OpenVPN autostart log: $AUTOSTART_LOG" >&2
  npm run netns:openvpn >>"$AUTOSTART_LOG" 2>&1 &
  local openvpn_pid="$!"
  printf "%s\n" "$openvpn_pid" >"$AUTOSTART_PID_FILE"

  echo "Waiting for the VPN tunnel to become ready..." >&2
  if wait_for_tun "$openvpn_pid"; then
    append_session "INFO" "vpn.autostart.completed" "VPN namespace started automatically" "{\"namespace\":\"$NETNS\",\"pid\":$openvpn_pid}"
    echo "VPN tunnel is ready. Continuing $original_command." >&2
    return 0
  fi

  append_session "PROB" "vpn.autostart.failed" "VPN namespace autostart failed or timed out" "{\"namespace\":\"$NETNS\",\"pid\":$openvpn_pid,\"timeoutSeconds\":$AUTOSTART_TIMEOUT_SECONDS}"
  echo "VPN autostart failed or timed out after ${AUTOSTART_TIMEOUT_SECONDS}s." >&2
  tail_autostart_log
  return 1
}

ensure_vpn_ready() {
  local reason="$1"
  local message="$2"
  append_session "PROB" "vpn.precheck.blocked" "$message" "{\"namespace\":\"$NETNS\"}"
  echo "$message" >&2

  if start_openvpn_for_command "$reason"; then
    return 0
  fi

  print_vpn_start_instructions
  return 1
}

if ! netns_exists; then
  ensure_vpn_ready "missing_namespace" "Network namespace $NETNS does not exist. Start OpenVPN first with ops/netns/openvpn.sh." || exit 1
fi

if ! tun_exists; then
  ensure_vpn_ready "missing_tun" "No tun interface found in namespace $NETNS. Refusing to run without an active VPN tunnel." || exit 1
fi

if [[ "${VPN_CHECK_HOST_IPV4_LEAK:-true}" != "false" && -z "$HOST_PUBLIC_IPV4" ]]; then
  HOST_PUBLIC_IPV4="$(detect_host_public_ipv4 || true)"
fi

if [[ "${VPN_CHECK_IPV6:-true}" != "false" && -z "$HOST_PUBLIC_IPV6" ]]; then
  HOST_PUBLIC_IPV6="$(detect_host_public_ipv6 || true)"
fi

append_session "INFO" "vpn.precheck.host_ip" "Host public IP detected before namespace run" "{\"namespace\":\"$NETNS\",\"hostPublicIpv4\":\"$HOST_PUBLIC_IPV4\",\"hostPublicIpv6\":\"$HOST_PUBLIC_IPV6\"}"

run_in_namespace() {
  if helper_available; then
    if [[ "${1:-}" == "npm" ]]; then
      "$HELPER" run --host-ipv4 "$HOST_PUBLIC_IPV4" --host-ipv6 "$HOST_PUBLIC_IPV6" /usr/bin/env "PATH=$PATH" "$@"
    else
      "$HELPER" run --host-ipv4 "$HOST_PUBLIC_IPV4" --host-ipv6 "$HOST_PUBLIC_IPV6" "$@"
    fi
  else
    sudo ip netns exec "$NETNS" runuser -u "$RUN_USER" -- env \
    HOME="$HOME" \
    PATH="$PATH" \
    CURRENT_SESSION_FILE="$CURRENT_SESSION_FILE" \
    VPN_DIAGNOSTIC_STRICT="${VPN_DIAGNOSTIC_STRICT:-true}" \
    VPN_DIAGNOSTIC_PLAYWRIGHT="${VPN_DIAGNOSTIC_PLAYWRIGHT:-true}" \
    VPN_CHECK_HOST_IPV4_LEAK="${VPN_CHECK_HOST_IPV4_LEAK:-true}" \
    VPN_CHECK_IPV6="${VPN_CHECK_IPV6:-true}" \
    VPN_HOST_PUBLIC_IPV4="$HOST_PUBLIC_IPV4" \
    VPN_HOST_PUBLIC_IPV6="$HOST_PUBLIC_IPV6" \
    REDQUEENX_VPN_NETNS="$NETNS" \
    REDQUEENX_VPN_PRECHECKED="true" \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" \
    PLAYWRIGHT_DISABLE_SANDBOX="${PLAYWRIGHT_DISABLE_SANDBOX:-true}" \
    DISPLAY="${DISPLAY:-}" \
    WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-}" \
    XDG_SESSION_TYPE="${XDG_SESSION_TYPE:-}" \
    XAUTHORITY="${XAUTHORITY:-}" \
    XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-}" \
    DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-}" \
      bash -lc "cd '$PWD' && $*"
  fi
}

if [[ "${VPN_PRECHECK:-true}" != "false" && "$*" != *"diagnose:vpn"* ]]; then
  echo "Running mandatory VPN/IP leak precheck before command..."
  append_session "INFO" "vpn.precheck.started" "Running mandatory VPN/IP leak precheck before command" "{\"namespace\":\"$NETNS\"}"
  if ! run_in_namespace npm run diagnose:vpn:dev; then
    append_session "PROB" "vpn.precheck.failed" "VPN checks failed; command blocked" "{\"namespace\":\"$NETNS\",\"checksPassed\":false}"
    exit 1
  fi
  append_session "INFO" "vpn.precheck.completed" "VPN checks passed; command allowed" "{\"namespace\":\"$NETNS\",\"checksPassed\":true}"
fi

append_session "INFO" "vpn.netns.command" "Running command in VPN namespace" "{\"namespace\":\"$NETNS\"}"
run_in_namespace "$@"

if [[ "$*" == *"diagnose:vpn"* ]]; then
  append_session "INFO" "vpn.diagnose.completed" "VPN diagnostics command completed successfully" "{\"namespace\":\"$NETNS\",\"checksPassed\":true}"
  echo
  echo "VPN diagnostics passed: all required checks completed successfully."
fi
