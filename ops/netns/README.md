# Linux network namespace mode

This mode avoids packaging a browser into a container image. It is useful when the AWS disk is too small for that approach.

The admin server keeps the normal machine network. Only the browser crawler runs inside a Linux network namespace where OpenVPN owns the tunnel.

```text
host/admin -> normal network
netns      -> OpenVPN -> browser crawler
```

## Requirements

Install these on the Linux host:

```bash
sudo apt install -y openvpn iproute2 iptables curl dnsutils tcpdump chromium
```

On non-Debian systems, install the equivalent packages.

## Configure

Namespace and OpenVPN values can be edited from `Admin > Settings > Search without Api`.

Run the local installer once:

```bash
npm run setup:local
```

The installer creates `/usr/local/sbin/redqueenx-netns` and a limited sudoers rule for that helper only. After that,
Admin `Start`/`Resume` can prepare the namespace and run diagnostics without asking for a sudo password. It also starts
the local admin server if it is not already running.

For local overrides outside the admin UI, copy the example values:

```bash
cp ops/netns/env.example ops/netns/env.local
```

Edit `ops/netns/env.local` and set:

```bash
VPN_REMOTE_HOST=your-vpn-host-or-ip
VPN_REMOTE_PORT=1194
VPN_REMOTE_PROTO=udp
VPN_CONFIG=./ops/vpn/custom.conf
```

`VPN_REMOTE_HOST` can be a hostname. The script resolves it on the host before starting OpenVPN, then writes a temporary OpenVPN config using the resolved IPv4 address. This avoids DNS lookup inside the namespace before the tunnel exists.

The scripts load VPN and Playwright variables from `.env` first, then from `ops/netns/env.local` when it exists.

## Normal Use

After `npm run setup:local`, open:

```text
http://127.0.0.1:3005/admin
```

Press `Start`. RedqueenX prepares OpenVPN automatically, runs VPN/IP leak diagnostics, then starts
the worker only if those checks pass.

## Manual OpenVPN Debugging

You can still start OpenVPN manually when debugging:

```bash
npm run netns:openvpn
```

Keep this process running only for that manual debugging session.

`openvpn.sh` rewrites a temporary runtime config in `/tmp/redqueenx-<namespace>.ovpn` before starting OpenVPN. It removes
provider `up`, `down`, and `script-security` hooks so OpenVPN cannot call host DNS helper scripts such as
`/etc/openvpn/update-resolv-conf`. This is important because the browser crawler is isolated by network namespace, not by
a full VM.

When `openvpn.sh` exits or is stopped with `Ctrl+C`, it runs `ops/netns/teardown.sh` automatically to remove the namespace,
the veth interface, and RedqueenX forwarding/NAT rules. You should not need to restart NetworkManager or systemd-resolved
after normal use.

By default, `openvpn.sh` refuses to start if a host `tun0` already exists. That usually means OpenVPN was started outside
the namespace or a previous host VPN is still active. Fix that state first instead of stacking another tunnel.

## Run diagnostics in the namespace

Terminal 2:

```bash
./ops/netns/run.sh npm run diagnose:vpn:dev
```

The diagnostic must show the VPN IP, not the host/AWS IP.
By default, `run.sh` detects the host public IPv4 before entering the namespace and passes it as
`VPN_HOST_PUBLIC_IPV4`; it also detects host public IPv6 as `VPN_HOST_PUBLIC_IPV6` when available.
The detector tries DNS-free Cloudflare trace endpoints first, then named fallback services. This keeps the comparison
working even when local DNS is temporarily unavailable. The diagnostic fails if the namespace/browser reports the same
host IP. IPv4 and IPv6 leak checks are on by default.

VPN startup, precheck, success/failure, and cleanup events are appended to `CURRENT_SESSION_FILE`, so they are visible in
Admin > Show current session.

If `run.sh` detects that the namespace or `tun+` tunnel is missing, it prompts before doing the recovery work. The default
answer is yes. When accepted, it runs `npm run netns:teardown`, starts `npm run netns:openvpn` in the background, waits for
the tunnel, and then continues the command that originally failed. The background OpenVPN output is written to
`runtime/netns-openvpn-autostart.log`.

## Run the future browser worker

```bash
./ops/netns/run.sh npm run worker:without-api:dev
```

`run.sh` refuses to start commands when no `tun+` interface exists in the namespace. It also runs the VPN diagnostics
before every non-diagnostic command by default, so the IP leak checks happen before the worker starts. Set
`VPN_PRECHECK=false` only for manual troubleshooting.

## Stop and clean up

Normal stop: press `Ctrl+C` in the `openvpn.sh` terminal. Cleanup runs automatically.

Manual cleanup, if you need it:

```bash
npm run netns:teardown
```

## Kill switch

The namespace firewall blocks direct crawler traffic through the host interface. It allows:

- OpenVPN traffic to the configured VPN endpoint through the veth interface.
- Browser/crawler traffic through `tun+` only.

If OpenVPN drops and `tun0` disappears, crawler traffic should fail instead of leaking through the host IP.

The host gets only the forwarding/NAT rules needed for the namespace to reach the VPN endpoint before the tunnel is up. The kill switch itself lives inside the namespace.
