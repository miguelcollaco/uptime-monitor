# Uptime Monitor

**Live:** [uptime-monitor.miguel-l-collaco.workers.dev](https://uptime-monitor.miguel-l-collaco.workers.dev)

A small, self-hosted uptime monitor that runs entirely on Cloudflare's free tier:

- **Cron Trigger** runs HTTP checks against your sites every 5 minutes
- **Multi-region checks** from Europe, US East and Asia-Pacific: a site only counts as down when most regions agree, so one region's network trouble doesn't cause false alarms
- **D1** (SQLite) stores every check, each monitor's state and an incident log
- **Discord or Slack alerts** fire when a site goes down and when it recovers
- **React + Vite status page** shows 90-day uptime bars, 24 h response times per region and recent incidents
- **Admin page** at `/admin` to add, edit, pause and delete monitors, behind a password login
- **Live updates** over WebSockets through a Durable Object: open pages change as soon as checks run, no refresh needed
- Everything is **one Worker**, deployed with one command

![Status page showing three monitors, per-region latency and recent incidents](docs/screenshot.png)

<sub>Screenshot uses sample data.</sub>

## How it works

```
             every 5 min                    in parallel                 HTTP checks
 Cron Trigger ──────────► Worker.scheduled() ──┬─► RegionChecker "weur" ─┐
                               │               ├─► RegionChecker "enam" ─┼─► your sites
                               │               └─► RegionChecker "apac" ─┘
                               │
                               ├─ majority vote per monitor (results come back from every region)
                               ├─ store results ────────► D1: checks, daily_stats, region_checks
                               ├─ update state / incidents ► D1: monitors, incidents
                               ├─ on state change ──────► Discord / Slack webhook
                               └─ publish ──────────────► LiveStatus Durable Object
                                                            │ rebuilds the summary once,
                                                            ▼ pushes it to every open page
 Browser ──► Worker.fetch()
               ├─ /api/live ──► WebSocket to LiveStatus
               ├─ /api/*    ──► JSON API
               └─ else      ──► React status page (static assets)
```

- **Regions:** each region in `REGIONS` has a `RegionChecker` Durable Object created with that region as its location hint. A Durable Object stays where it was created, so its checks always leave from the same part of the world. Location hints are best-effort, so each check also records the datacenter it actually ran from (e.g. `FRA`).
- **Majority vote:** every run checks each monitor from all regions at once. The run counts as failed only when more than half of the regions that answered saw it fail; its latency is the median of the regions that succeeded. If no region answers at all, the Worker checks from wherever it's running so monitoring never stops.
- A monitor is marked **down** only after `FAILURE_THRESHOLD` failed runs in a row (default 2), so one blip doesn't page you. One alert goes out when it goes down (naming the regions that failed, e.g. "Down in 2/3 regions (Europe, US East): Timed out after 10000 ms") and one when it recovers.
- A check fails on timeout (default 10 s), network error, or a status outside the expected range (default 200–399). Latency is measured to the response headers.
- Check rows older than `RETENTION_DAYS` (default 90) are deleted once a day. Per-region rows (`region_checks`) are kept for 7 days, which is as far back as the latency chart goes.
- **Staying in the free tier:** each check also updates a per-day row in `daily_stats`, so building the summary reads about 90 rows per monitor for the uptime bars instead of every check in the window. The `LiveStatus` Durable Object builds the summary once per cron run and serves it to every viewer, so D1 reads don't grow with traffic. Its WebSockets use the Hibernation API, so idle connections cost nothing. If the socket drops, the page polls `/api/summary` every 30 s and keeps reconnecting. Three regions add about 900 Durable Object requests a day and triple the D1 writes for checks, both far below the free limits.

## Project layout

```
worker/       Cloudflare Worker (TypeScript)
  index.ts      fetch + scheduled handlers
  checks.ts     HTTP checks, state machine, incidents
  regions.ts    RegionChecker Durable Object and the majority vote
  alerts.ts     Discord / Slack webhook
  api.ts        public JSON API + admin API
  auth.ts       admin login: password check, signed session cookie, lockout
  summary.ts    builds the status summary from D1
  live.ts       LiveStatus Durable Object: cached summary + WebSockets
src/          React status page (Vite)
  admin/        admin page at /admin (loaded only there)
shared/       Types shared by the Worker and the frontend
migrations/   D1 schema
seed.sql      Starter monitors (edit me)
wrangler.jsonc Worker config: cron schedule, D1 binding, settings
```

## Run it locally

Requires Node.js 22.12+ and [pnpm](https://pnpm.io/installation).

```bash
pnpm install
pnpm db:migrate:local      # create the tables in a local D1 database
pnpm db:seed:local         # add the monitors from seed.sql (edit it first)
pnpm dev                   # status page + API at http://localhost:5173
```

The cron doesn't fire on its own in dev. Trigger a run manually:

```bash
curl "http://localhost:5173/cdn-cgi/handler/scheduled"
```

To use the admin page and test alerts locally, create a `.dev.vars` file (git-ignored):

```
ADMIN_TOKEN=some-local-token
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## Deploy to Cloudflare

Everything fits in the Workers Free plan.

### First deploy

```bash
pnpm wrangler login                  # opens the browser (on WSL, add --browser=false and open the link yourself)
pnpm wrangler d1 create uptime       # put the database_id it prints into wrangler.jsonc
pnpm db:migrate:remote               # create the tables
pnpm db:seed:remote                  # optional: the starter monitors from seed.sql
pnpm run deploy                      # build and deploy the Worker
pnpm wrangler secret put ADMIN_TOKEN         # admin password: a long random string
pnpm wrangler secret put ALERT_WEBHOOK_URL   # optional: Discord or Slack webhook
```

- **Forked this repo?** `wrangler.jsonc` contains the original author's `database_id`. Replace it with the one `d1 create` prints for you.
- **New Cloudflare account?** The first deploy needs a workers.dev subdomain. If `deploy` asks for one, set it up under **Workers & Pages** in the dashboard.
- **Secrets go after the first deploy**, because they're attached to an existing Worker. They're kept across later deploys.
- **`seed.sql`** includes "Example (should be down)", a monitor that always fails so you can see an outage. Delete it from `/admin` once you've seen how it looks.

It goes live at `https://uptime-monitor.<your-subdomain>.workers.dev`. To use your own domain, add a custom domain to the Worker in the Cloudflare dashboard.

Getting a webhook URL:
- **Discord:** Server Settings → Integrations → Webhooks → New Webhook → Copy URL
- **Slack:** create an app with Incoming Webhooks enabled and copy the webhook URL

### Deploy from GitHub

Instead of running `pnpm run deploy` yourself, connect the repo in the dashboard: **Workers & Pages → Create**, then import your GitHub repository. Cloudflare detects pnpm and builds with Vite before running `wrangler deploy`. After that, every push to `main` builds and deploys automatically. You still create the D1 database, run the migrations and set the secrets once, as above.

### Updating

When a change adds a file to `migrations/`, run `pnpm db:migrate:remote` **before** deploying it (or before pushing, with GitHub deploys). The new code writes to the new tables on its first cron run, so applying migrations afterwards would make checks fail until you do.

## Configuration

In `wrangler.jsonc`:

| Setting | Default | What it does |
| --- | --- | --- |
| `triggers.crons` | `*/5 * * * *` | How often checks run |
| `vars.SITE_TITLE` | `Uptime Monitor` | Title on the status page and browser tab |
| `vars.FAILURE_THRESHOLD` | `2` | Failed runs in a row (each decided by the region vote) before "down" + alert |
| `vars.RETENTION_DAYS` | `90` | How long check history is kept (and the bar chart window) |
| `vars.REGIONS` | `weur,enam,apac` | Where checks run from. Any of `wnam` (US West), `enam` (US East), `sam` (South America), `weur` (Europe), `eeur` (Eastern Europe), `apac` (Asia-Pacific), `oc` (Oceania), `afr` (Africa), `me` (Middle East). An odd number avoids ties; a tie counts as up. |

Secrets (`pnpm wrangler secret put <NAME>`):

| Secret | Required | What it does |
| --- | --- | --- |
| `ALERT_WEBHOOK_URL` | No | Discord or Slack incoming webhook; no alerts without it |
| `ADMIN_TOKEN` | No | Password for the admin page and token for the admin API; both are disabled without it. Changing it logs out every session. |

## Public API

Read-only. Monitor URLs aren't exposed:

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/summary` | All monitors with status, uptime, daily buckets, recent incidents |
| GET (WebSocket) | `/api/live` | Sends the summary on connect and again after every check run. Send `ping` to get `pong`. |
| GET | `/api/monitors/:id/latency?hours=24` | Each run's combined result plus each region's own checks, for the latency chart (max 168 h) |

## Admin page

Go to `/admin` and log in with your `ADMIN_TOKEN`. From there you can add monitors, edit them (name, URL, method, timeout, expected status range), pause or resume them, delete them, and run all checks right away. Changes show up on open status pages immediately.

- Logging in sets a session cookie that lasts 7 days: `HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS, and only sent to `/api/admin`. It's signed with a key derived from `ADMIN_TOKEN`, so no sessions are stored and changing the token logs everyone out.
- Writes made with the cookie are refused unless they come from the site's own origin.
- After 10 wrong passwords from one IP, logins from that IP are refused for 15 minutes.

## Admin API

For scripts, send `Authorization: Bearer <ADMIN_TOKEN>` (the admin page's session cookie also works):

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/admin/monitors` | List monitors including URLs |
| POST | `/api/admin/monitors` | `{ "name": "...", "url": "https://...", "method": "GET", "timeout_ms": 10000, "expected_status_min": 200, "expected_status_max": 399 }` |
| PATCH | `/api/admin/monitors/:id` | Any of `name`, `url`, `method`, `timeout_ms`, `expected_status_min`, `expected_status_max`, `paused` |
| DELETE | `/api/admin/monitors/:id` | Deletes the monitor and its history |
| POST | `/api/admin/run` | Runs all checks now and returns the results |
| POST | `/api/admin/login` | `{ "password": "..." }`: sets the session cookie |
| POST | `/api/admin/logout` | Clears the session cookie |
| GET | `/api/admin/session` | 200 when logged in, 401 when not |

Example:

```bash
curl -X POST https://uptime-monitor.<you>.workers.dev/api/admin/monitors \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "My site", "url": "https://example.com"}'
```

## Ideas for next steps

- **Regional alerts:** a lighter "degraded" alert when a minority of regions keeps failing (the status page already shows it).
- **Keyword checks** (the page must contain a string) and TCP checks via the Workers `connect()` API.
