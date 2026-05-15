# RedqueenX

RedqueenX is a TypeScript crawler/admin service for managing security-focused X/Twitter searches, scoring visible posts, and reviewing accepted or rejected results from a local web admin UI.

The project supports two operating modes:

- **X API mode**: uses official X API credentials and budget limits.
- **Search without API mode**: uses Playwright through a Linux network namespace and OpenVPN so only the browser worker uses the VPN network.

## Screenshots

Screenshots are optional, but useful if you want the README to show the UI.
Put them here:

```text
docs/screenshots/timeline.png
docs/screenshots/admin-lists.png
docs/screenshots/session-alerts.png
docs/screenshots/settings.png
```

Then add the images in this section, for example:

```md
![Timeline](docs/screenshots/timeline.png)
![Admin lists](docs/screenshots/admin-lists.png)
![Session alerts](docs/screenshots/session-alerts.png)
![Settings](docs/screenshots/settings.png)
```

## Local Installation

```bash
npm install
cp .env.example .env
npm run env:sync -- --dry-run
```

Edit `.env` before starting:

- set `ADMIN_PASSWORD`
- set `SESSION_SECRET` to a long random value
- choose `DATABASE_URL`, usually `./redqueenx.sqlite`
- optionally set `ADMIN_IPV4_WHITELIST` / `ADMIN_IPV4_BLACKLIST` with comma-separated IPv4 or CIDR entries
- configure either X API mode or Search without API mode

Start the admin server:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3005/admin
```

The SQLite database is created automatically when `DATABASE_URL` does not exist. A fresh install starts with empty lists; import or add keywords from the admin UI.

## Useful Commands

```bash
npm run typecheck
npm test
npm run build
npm run security:check
```

Run a focused media cache test:

```bash
npm run test:media-cache
```

Run the without-API smoke test through the VPN namespace:

```bash
npm run netns:worker:smoke
```

## Admin UI

Main pages:

- `GET /admin/login`: login page
- `GET /admin`: protected admin console
- `GET /timeline`: accepted tweets timeline
- `GET /rejected-timeline`: rejected Playwright/API results with rejection reasons

The admin console manages:

- lists and imports
- scoring settings
- X API settings and budget counters
- Search without API settings
- Linux namespace / OpenVPN settings
- X browser accounts
- session alerts
- database maintenance
- tests and Playwright snapshots

## X API Mode

Set `X_API_ENABLED=true` and configure the relevant X credentials in `.env`.

Write actions are disabled unless:

```env
ENABLE_X_WRITE=true
```

Budget and run limits are configured in the X API settings section. The admin UI shows remaining credit, total credit used, API call windows, and per-run spend limits.

## Search Without API Mode

This mode keeps the admin HTTP server on the normal host network and runs only the Playwright browser worker through a VPN namespace.

```text
admin server      -> normal host network
Playwright worker -> Linux netns -> OpenVPN -> internet
```

Install the local helper once:

```bash
npm run setup:local
```

The installer may ask for sudo once. It installs a limited root-owned helper at:

```text
/usr/local/sbin/redqueenx-netns
```

After that, normal use should be:

```bash
npm run dev
```

Then open the admin UI and click `Start` or `Resume`. The app will prepare the VPN namespace, run leak diagnostics, and start the without-API worker only if the checks pass.

Manual debugging commands still exist:

```bash
npm run netns:diagnose
npm run netns:openvpn
npm run netns:worker
npm run netns:teardown
```

## OpenVPN Profiles

Add OpenVPN files from the admin settings page or place them under `ops/vpn/`.

Files in `ops/vpn/` are ignored by Git except:

- `ops/vpn/README.md`
- `ops/vpn/custom.conf.example`

For username/password VPN profiles, create an `.auth` file with:

```text
username
password
```

The admin UI can create or update the auth file for the selected profile.

## X Browser Sessions

For Search without API mode, each X browser account is linked to one or more VPN profiles. The saved browser state lives in `runtime/x-auth/`.

To create or refresh a session manually:

```bash
npm run netns:x-login -- --account-id <id>
```

Or use the admin button:

```text
Launch visible X login
```

If X asks for CAPTCHA, 2FA, or manual verification, RedqueenX stops scraping and creates an `X Session Alert`. The alert locks that X account until a human resolves the issue, marks the alert as resolved with a note, and saves a fresh session.

## VPN Diagnostics

Search without API mode runs diagnostics before browser work:

- host public IPv4
- namespace public IPv4
- IPv6 reachability
- DNS resolver behavior
- Playwright-visible public IP
- WebRTC candidates

The worker refuses to run if diagnostics detect a host IP leak or cannot verify the required network state.

## SQLite

The database is generated automatically by the app.

For a fresh user:

1. `DATABASE_URL` points to a missing file.
2. The app starts.
3. Migrations create the schema.
4. Lists, runs, timelines, and alerts are empty.

This behavior is covered by `tests/fresh-database.test.ts`.

## Troubleshooting

If Chromium cannot open visibly on Linux, check whether your desktop uses Wayland or X11 and whether the app has access to the display. Headless mode is safer on servers.

If namespace setup fails, rerun:

```bash
npm run setup:local
npm run netns:teardown
```

Then try from the admin UI again.

If VPN diagnostics fail, inspect:

```bash
runtime/netns-openvpn-autostart.log
```

If a run is blocked by an X session alert, resolve the account manually from the usual VPN/IP profile first, then mark the alert as resolved in admin.

## Docker / Server Use

Docker is optional. For a normal local setup, start with the npm install above.
Docker is mainly useful when RedqueenX runs on a separate machine and you want
the browser worker, VPN, and admin service isolated into containers.

On a server, the shortest path is:

```bash
./ops/vps-docker-up.sh
```

The script creates `.env` from `.env.example` if needed, adds the Docker defaults
that are missing, pulls the published images, starts `admin`, `vpn`, and
`worker`, then prints the local admin URL and SSH tunnel command.

Before long runs, edit `.env` and set at least:

- `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH`
- `SESSION_SECRET`
- `VPN_CONFIG` and the matching OpenVPN auth file if your profile needs one

To configure Docker manually instead, set:

```env
SEARCH_WITHOUT_API_ISOLATION=docker_vpn
```

Then start the main services:

```bash
export REDQUEENX_UID=$(id -u)
export REDQUEENX_GID=$(id -g)
docker compose up -d admin vpn worker
```

The stack is split into a few services:

- `admin`: RedqueenX admin server exposed on `127.0.0.1:${ADMIN_PORT:-3005}`.
- `vpn`: the only service with `NET_ADMIN` and `/dev/net/tun`; it runs OpenVPN and applies an internal kill switch.
- `worker`: shares `vpn` networking with `network_mode: service:vpn`; it picks up without-API runs and media-cache jobs from SQLite.
- `x-login`: temporary service for visible X login only; it opens a browser through noVNC on localhost.
- `init-runtime`: one-shot helper that creates persistent runtime directories and fixes ownership for the configured UID/GID.

If you put the admin UI behind a reverse proxy, proxy to the local Docker admin port:

```caddyfile
your-domain.example {
  reverse_proxy 127.0.0.1:3005
}
```

For a self-contained local Docker stack with the bundled Caddy container, use:

```bash
docker compose --profile caddy up -d admin vpn worker caddy
```

In Docker mode, `Load medias` records a media-cache job in SQLite. The worker
then downloads the media through the VPN container.

For visible X login, launch the temporary noVNC service:

```bash
docker compose run --rm --service-ports x-login --account-id <id>
```

Then open:

```text
http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale
```

If RedqueenX runs on a remote host, keep noVNC bound to `127.0.0.1` and use an SSH tunnel:

```bash
ssh -L 6080:127.0.0.1:6080 <user>@<server-host>
```

Keep that SSH tunnel open on your local computer, keep the `x-login` command running on the remote host, then open the same `http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale` URL in your local browser.

The noVNC port is controlled by `X_LOGIN_NOVNC_PORT`.
Docker login can use Chrome or Firefox with `X_LOGIN_BROWSER`; Firefox is the recommended fallback when X rejects Chrome with onboarding code 399. In Firefox noVNC mode, close the Firefox window after X Home is visible; RedqueenX then extracts the cookies and saves the session, so no terminal Enter is required.
Keep `X_LOGIN_REUSE_BROWSER_PROFILE=false` when testing X login, because a partial failed login flow can poison the next attempt.

For clipboard input, use the noVNC side panel clipboard control. Direct host clipboard sync depends on the browser and is not always automatic. The container enables NumLock for the numeric keypad and can set an X keyboard layout with `X_LOGIN_KEYBOARD_LAYOUT=fr` or another layout code.

If Docker noVNC keeps returning to the login screen with X onboarding `code 399`, use the session import workaround:

1. Run the host/non-Docker X login flow that works on the local desktop.
2. Open Admin > Settings > X browser account and export that saved session.
3. Switch back to Docker mode, select the same X browser account, and import the exported session JSON.
4. Confirm the account shows `session file present`, then run a small Search without Api test before a long run.

This avoids repeating the rejected noVNC login flow while still letting Docker workers reuse a valid Playwright `storageState`.

For alert recovery:

```bash
docker compose run --rm --service-ports x-login --account-id <id> --resolve-alert
```

Only noVNC is exposed, and Compose binds it to localhost by default. The `x-login` service exits after the browser session is saved, and `X_LOGIN_SERVICE_MAX_SECONDS` limits how long one noVNC login container may stay alive if it is forgotten.

Useful Docker validation commands:

```bash
docker compose config --quiet
docker compose build
docker compose exec worker ip route get 1.1.1.1
docker compose exec worker npm run diagnose:vpn
```

The route check must show `dev tun...`. If OpenVPN is stopped or `tun+` disappears, the worker and media fetcher fail closed instead of using the host route.

Keep the admin port bound to localhost when RedqueenX is on a server. Put your
own reverse proxy or SSH tunnel in front of it depending on how you want to
access the UI.
