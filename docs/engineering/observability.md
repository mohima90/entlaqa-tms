# Observability baseline (runbook)

> Backlog: **T-M1-D06** (part a) · ADR 0009 §2, §4, §6 · Decision T-M0-13 (Sentry EU for the regional cloud, GlitchTip for sovereign)
> Code: `packages/platform-observability` (logger, scrubbing, error-reporting hook), `apps/suite/src/instrumentation.ts` → `src/lib/observability.ts`, `src/lib/health.ts`, `packages/platform-db/src/health.ts`, `.github/workflows/uptime.yml`

## What we collect, and what we never collect

| Signal | Where it goes | Content |
|---|---|---|
| **Logs** | stdout/stderr as one JSON object per line (Vercel runtime logs; `docker compose logs` in containers) | `time, level, msg, service, env, deployment, version` + a **closed** set of fields: `action, permission, correlation_id, tenant_id, status, outcome, duration_ms, error_code, error_name, route` |
| **Errors** | Sentry (EU data region, org `entlaqa-qv`, project `javascript-nextjs`) for the cloud; GlitchTip in-country for sovereign installations | Error class, scrubbed message, stack frames, route, release, environment, tags `action`, `permission`, `correlation_id`, `tenant_id` |
| **Uptime** | GitHub Actions every 15 min → issue "Uptime: staging is down" | HTTP status of `/api/health/ready` |

**Never sent or logged** (ADR 0009 §2): names, e-mails, phone numbers, national IDs (Saudi ID/Iqama, Emirates ID, Egyptian ID), IP addresses, request or response bodies, query strings, cookies, headers, tokens, passwords, local variables, source code lines, breadcrumbs. Enforcement:

1. The logger API only accepts the fields above. There is no way to log an object.
2. Error messages are not logged; only the error class is.
3. Every string in a log line or error report goes through `scrubText`, which replaces e-mails, phone numbers, national IDs, IP addresses, tokens and URL credentials. UUIDs are kept.
4. The error tracker's `beforeSend` (`scrubErrorEvent`) drops the user, request headers, cookies, body and query string, breadcrumbs, extra data, local variables and the server name.
5. `sendDefaultPii: false`, no tracing, no session replay, and the `ContextLines` integration is off.
6. Sentry organization settings (PO, 4 Oct 2026): Data Scrubber, Default Scrubbers and Prevent Storing of IP Addresses are all **required**.
7. Tests:
   - unit tests per pattern;
   - the self-hosted smoke test (gate 15) fails if the test users' e-mail or password, or any e-mail address, appears in the app logs after the sign-in journeys;
   - an end-to-end check of a real error report through the built app (4 Oct 2026) found no e-mail, password or source line in it.

**Correlation:** an unexpected error shows the user a reference id (`correlation_id`). Search for it in the logs or in Sentry (tag `correlation_id`) to find the matching log line and error report.

## Configuration (runtime environment variables, nothing baked into the build)

| Variable | Example | Purpose |
|---|---|---|
| `SENTRY_DSN` | Sentry → Settings → Projects → `javascript-nextjs` → **Client Keys (DSN)** | Turns error tracking on. Unset or invalid = logs only. Must be `https://` (plain `http://` only to a single-label host on the installation's private network, e.g. `http://key@glitchtip:8000/1`) |
| `JADARAT_ENVIRONMENT` | `staging`, `production`, `self-hosted` | `env` in logs, `environment` in Sentry (default: Vercel's `VERCEL_ENV`, else `NODE_ENV`) |
| `JADARAT_DEPLOYMENT` | `eu-saas-1`, `sa-gov-1` | `deployment` in logs (optional) |
| `JADARAT_RELEASE` | git SHA | `version` / `release` (default on Vercel: `VERCEL_GIT_COMMIT_SHA`) |
| `UPTIME_URL` (GitHub **repository variable**) | `https://<staging domain>` | Turns the scheduled uptime check on |

### Staging (Vercel project `jadarat-tms`)
Add the variables under **Settings → Environment Variables**:
- `SENTRY_DSN` for Production and Preview;
- `JADARAT_ENVIRONMENT` = `staging` for Production only.

Then redeploy. The DSN is not a password: it only lets a sender *submit* events. Keep it in the environment, not in code, so each deployment points at its own project.

### Sovereign installations
Run GlitchTip in-country and set `SENTRY_DSN` in `infra/docker/.secrets/.env`; compose passes it to the app. GlitchTip in the compose file and its parity check are T-M1-D06 part b.

## Health endpoints

| Endpoint | Answers | Use |
|---|---|---|
| `GET /api/health/live` | `200 {"status":"ok"}` while the process runs | container health check (`app.Dockerfile`), orchestrators |
| `GET /api/health/ready` | `200 {"status":"ok"}`, or `503 {"status":"unavailable"}` when the database cannot be reached as `app_server` | uptime monitors, load balancers |

Both are public and `no-store`, and never return versions, hosts or error details. The readiness result is reused for 5 seconds, so the endpoint cannot be used to load the database. More dependencies (Storage, worker heartbeat, ClamAV) join `/ready` when they exist (ADR 0009 §6).

## Uptime check (staging)

`.github/workflows/uptime.yml` runs at minutes 7, 22, 37 and 52 of every hour (GitHub may delay scheduled runs by several minutes):
- If `/api/health/ready` fails twice 30 s apart, it opens the issue **"Uptime: staging is down"**, or comments on it if it is already open. GitHub notifies watchers of the repository.
- The issue is closed automatically after the next successful check.
- Run it by hand: **Actions → Uptime (staging) → Run workflow**.

This is a staging baseline. Production needs external checks from at least two regions and a public status page (ADR 0009 §5, NFR-OBS-03). That vendor is chosen before the first customer goes live.

## When an incident issue opens or Sentry alerts

1. Open `https://<staging domain>/api/health/ready`. A `503` means the app cannot reach the database: check the Supabase project status and `DATABASE_URL_APP_SERVER` (see [staging-sign-in.md](staging-sign-in.md), Troubleshooting).
2. Look at Vercel → the deployment → **Logs** (filter `level:error`). Take the `correlation_id` and find the matching Sentry issue.
3. Record the incident and its fix in `docs/delivery/STATUS.md` (session log).

## Known limits (follow-ups)

| Gap | Why | Planned |
|---|---|---|
| Stack traces show compiled (minified) server code | In-process source maps are not applied by Next.js 16 / Turbopack at runtime (tried 4 Oct 2026). Disabling minification would also unminify the browser bundle | Upload source maps privately at build time to Sentry and GlitchTip (ADR 0009 §4), T-M1-D06 part b |
| Browser (client-side) errors are not reported | The browser SDK needs a runtime DSN, which means a tunnel route through our server, plus a check against the bundle budget | T-M1-D06 part b |
| GlitchTip not yet in `infra/docker` | — | T-M1-D06 part b |
| Traces and metrics (OpenTelemetry), alert rules, status page | Need a backend (ADR 0009 §5) | M2/M3, with the worker (ADR 0005) |
| `actor_ref` (HMAC of the user id) in logs | No per-user logging needed yet | When the first module action logs per actor |
