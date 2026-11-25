# Uptime Monitor

A small, self-hosted uptime monitor that runs entirely on Cloudflare's free tier:

- **Cron Trigger** runs HTTP checks against your sites every 5 minutes
- **D1** (SQLite) stores every check, each monitor's state and an incident log
- **Discord or Slack alerts** fire when a site goes down and when it recovers
- **React + Vite status page** shows 90-day uptime bars, 24 h response times and recent incidents
- Everything is **one Worker**, deployed with one command

![Status page](docs/screenshot.png)

## How it works

```
             every 5 min                      HTTP checks
 Cron Trigger ──────────► Worker.scheduled() ───────────► your sites
                               │
                               ├─ store results ────────► D1: checks
                               ├─ update state / incidents ► D1: monitors, incidents
                               └─ on state change ──────► Discord / Slack webhook

 Browser ──► Worker.fetch()
               ├─ /api/*  ──► JSON API (reads D1)
               └─ else    ──► React status page (static assets)
```

- A monitor is marked **down** only after `FAILURE_THRESHOLD` failed checks in a row (default 2), so one blip doesn't page you. One alert goes out when it goes down and one when it recovers.
- A check fails on timeout (default 10 s), network error, or a status outside the expected range (default 200–399). Latency is measured to the response headers.
- Check rows older than `RETENTION_DAYS` (default 90) are deleted once a day.

## Project layout

```
worker/       Cloudflare Worker (TypeScript)
  index.ts      fetch + scheduled handlers
  checks.ts     HTTP checks, state machine, incidents
  alerts.ts     Discord / Slack webhook
  api.ts        public JSON API + token-protected admin API
src/          React status page (Vite)
shared/       Types shared by the Worker and the frontend
migrations/   D1 schema
seed.sql      Starter monitors (edit me)
wrangler.jsonc Worker config: cron schedule, D1 binding, settings
```

## Run it locally

Requires Node.js 18+.

```bash
npm install
npm run db:migrate:local      # create the tables in a local D1 database
npm run db:seed:local         # add the monitors from seed.sql (edit it first)
npm run dev                   # status page + API at http://localhost:5173
```

The cron doesn't fire on its own in dev. Trigger a run manually:

```bash
curl "http://localhost:5173/cdn-cgi/handler/scheduled"
```

To test alerts and the admin API locally, create a `.dev.vars` file (git-ignored):

```
ADMIN_TOKEN=some-local-token
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## Deploy to Cloudflare

```bash
npx wrangler login                       # once, opens the browser
npx wrangler d1 create uptime            # copy the database_id it prints into wrangler.jsonc
npm run db:migrate:remote
npm run db:seed:remote
npx wrangler secret put ALERT_WEBHOOK_URL   # paste your Discord or Slack webhook URL
npx wrangler secret put ADMIN_TOKEN         # any long random string
npm run deploy
```

It goes live at `https://uptime-monitor.<your-subdomain>.workers.dev`. To use your own domain, add a custom domain to the Worker in the Cloudflare dashboard.

Getting a webhook URL:
- **Discord:** Server Settings → Integrations → Webhooks → New Webhook → Copy URL
- **Slack:** create an app with Incoming Webhooks enabled and copy the webhook URL

## Configuration

In `wrangler.jsonc`:

| Setting | Default | What it does |
| --- | --- | --- |
| `triggers.crons` | `*/5 * * * *` | How often checks run |
| `vars.SITE_TITLE` | `Status` | Title on the status page |
| `vars.FAILURE_THRESHOLD` | `2` | Failed checks in a row before "down" + alert |
| `vars.RETENTION_DAYS` | `90` | How long check history is kept (and the bar chart window) |

Secrets (`npx wrangler secret put <NAME>`):

| Secret | Required | What it does |
| --- | --- | --- |
| `ALERT_WEBHOOK_URL` | No | Discord or Slack incoming webhook; no alerts without it |
| `ADMIN_TOKEN` | No | Enables the admin API; disabled without it |

## API

Public (read-only, no URLs exposed):

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/summary` | All monitors with status, uptime, daily buckets, recent incidents |
| GET | `/api/monitors/:id/latency?hours=24` | Individual checks for the latency chart (max 168 h) |

Admin (send `Authorization: Bearer <ADMIN_TOKEN>`):

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/admin/monitors` | List monitors including URLs |
| POST | `/api/admin/monitors` | `{ "name": "...", "url": "https://...", "method": "GET", "timeout_ms": 10000, "expected_status_min": 200, "expected_status_max": 399 }` |
| PATCH | `/api/admin/monitors/:id` | Any of `name`, `url`, `paused`, `timeout_ms` |
| DELETE | `/api/admin/monitors/:id` | Deletes the monitor and its history |
| POST | `/api/admin/run` | Runs all checks now and returns the results |

Example:

```bash
curl -X POST https://uptime-monitor.<you>.workers.dev/api/admin/monitors \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "My site", "url": "https://example.com"}'
```

## Ideas for next steps

- **Multi-region checks:** run checkers in Durable Objects with location hints (e.g. Western Europe, US East, Asia) and only mark a site down when several regions agree. That avoids false alarms from one region's network.
- **Admin page** in the React app, behind Cloudflare Access or the admin token.
- **Keyword checks** (the page must contain a string) and TCP checks via the Workers `connect()` API.
- **Certificate expiry warnings** (a Worker's `fetch` doesn't expose the TLS certificate, so this needs another source such as Certificate Transparency logs).
