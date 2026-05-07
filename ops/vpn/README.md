# Local OpenVPN files

Put your OpenVPN client configuration here when you want to keep VPN files inside the project folder.

Recommended local file:

- `custom.conf`: a copy of your provider `.ovpn` client configuration.

The filename does not need to be `custom.conf`. OpenVPN accepts the provider filename too, for example
`nl-free-01.protonvpn.udp.ovpn`. Set `VPN_CONFIG` in `.env` or in the admin settings to whichever file you want to use.

In the admin settings, choosing a file in `OpenVPN config path` copies it into `./ops/vpn/` automatically and stores the
copied project-local path in `VPN_CONFIG`. During that copy, RedqueenX reads the OpenVPN profile and normalizes it:

- `auth-user-pass` is pointed to a per-profile auth file next to the profile. Example:
  `ch-free-12.protonvpn.udp.ovpn` uses `ch-free-12.protonvpn.udp.auth`.
- if a matching auth file exists next to the selected source profile, it is copied too. RedqueenX looks for
  `<profile-name>.auth`, `<profile-name>.txt`, then `auth.txt`.
- provider hook lines such as `script-security`, `up`, `down`, and `remote-random` are commented out.
- the first `remote` and `proto` values are returned to the admin UI so `VPN_REMOTE_HOST`, `VPN_REMOTE_PORT`, and
  `VPN_REMOTE_PROTO` can be filled automatically.

If your VPN provider requires username/password authentication, store the credentials in the profile-specific `.auth`
file:

```text
your-openvpn-username
your-openvpn-password
```

If the provider profile contains lines such as `script-security`, `up /etc/openvpn/update-resolv-conf`, or
`down /etc/openvpn/update-resolv-conf`, leave them disabled for RedqueenX namespace mode. `ops/netns/openvpn.sh` also
strips these hooks from the temporary runtime config as a second safety layer.

These files should stay local and must not be committed.
