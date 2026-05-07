# RedqueenX

RedqueenX is a TypeScript crawler/admin service for managing security-focused X/Twitter searches, scoring visible posts, and reviewing accepted or rejected results from a local web admin UI.

The project supports two operating modes:

- **X API mode**: uses official X API credentials and budget limits.
- **Search without API mode**: uses Playwright through a Linux network namespace and OpenVPN so only the browser worker uses the VPN network.

## Local Installation

```bash
npm install
cp .env.example .env
```

Edit `.env` before starting:

- set `ADMIN_PASSWORD`
- set `SESSION_SECRET` to a long random value
- choose `DATABASE_URL`, usually `./redqueenx.sqlite`
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
- `GET /raw-timeline`: raw Playwright/API results, including rejected items and rejection reasons

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
