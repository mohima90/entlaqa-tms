# Observability baseline (runbook)

> Backlog: **T-M1-D06** (part a) · ADR 0009 §2, §4, §6 · Decision T-M0-13 (Sentry EU for the regional cloud, GlitchTip for sovereign)
> Code: `packages/platform-observability` (logger, scrubbing, error-reporting hook), `apps/suite/src/instrumentation.ts` → `src/lib/observability.ts`, `src/lib/health.ts`, `packages/platform-db/src/health.ts`, `.github/workflows/uptime.yml`

## What we collect, and what we never collect

| Signal | Where it goes | Content |
|---|---|---|
| **Logs** | stdout/stderr as one JSON object per line (Vercel runtime logs; `docker compose logs` in containers) | `time, level, msg, service, env, deployment, version` + a **closed** set of fields: `action, permission, correlation_id, tenant_id, status, outcome, duration_ms, error_code, error_name, route` |
| **Errors** | Sentry (EU data region, org `entlaqa-qv`, project `javascript-nextjs`) for the cloud; GlitchTip in-country for sovereign installations | Error class, stack locations (file, function, line), route without query string, release, environment, tags `action`, `permission`, `correlation_id`, `tenant_id`, `error_code` (e.g. PostgreSQL SQLSTATE `23505`). The message is `[redacted]`, except for allow-listed error classes whose messages contain no input. **Server and browser** errors; browser reports carry the tag `source: browser` |
| **Uptime** | GitHub Actions every 15 min → issue "Uptime: staging is down" | HTTP status of `/api/health/ready` |

**Never sent or logged by our code** (ADR 0009 §2): names, e-mails, phone numbers, national IDs (Saudi ID/Iqama, Emirates ID, Egyptian ID), IP addresses, request or response bodies, query strings, cookies, headers, tokens, passwords, local variables, source code lines, breadcrumbs. Enforcement:

1. The logger API only accepts the fields above. There is no way to log an object.
2. **Error messages are redacted**: in our log lines (only the class and code are logged), in error reports (`exception.value` = `[redacted]`), and in errors passed to the console, Next.js `⨯ Error: …` lines included (class, code, Next.js digest and stack locations only). Limit: an error nested inside an object passed to the console is printed by `util.inspect` with its message, which is then pattern-scrubbed but not redacted. Error messages routinely embed input, such as a failed query with its parameters. The only exceptions are allow-listed classes built from constants (`SAFE_MESSAGE_ERRORS`, e.g. `AuthServiceError`).
3. Strings in log lines, error reports and console output go through `scrubText`. It replaces e-mails (Arabic addresses included), phone numbers (KSA/UAE/Egypt, local and international), national IDs, IP addresses, tokens and URL credentials. UUIDs are kept. Input is truncated to 2,000 characters first and every pattern is bounded, so a hostile string cannot make scrubbing slow (tested on 100,000-character inputs). Side effect: 10-digit numbers starting with 1 or 2, such as epoch seconds, also become `[national-id]`.
4. The error tracker's `beforeSend` (`scrubErrorEvent`) drops:
   - the user;
   - request headers, cookies, body and query string, and query strings in context URLs/paths;
   - breadcrumbs, extra data and threads;
   - local variables, source lines and the server name.
   Objects nested more than 6 levels deep are replaced by `[depth]`.
5. The SDK's own data collection is fully off (`dataCollection` = `NO_DATA_COLLECTION`): no user info, cookies, headers, bodies, query strings, local variables or source lines. Sentry v11 replaced `sendDefaultPii` with `dataCollection`, and its defaults collect all of these. There is no tracing and no session replay, the `ContextLines` integration is off, and unhandled rejections are reported without being printed.
6. Sentry organization settings (PO, 4 Oct 2026): Data Scrubber, Default Scrubbers and Prevent Storing of IP Addresses are all **required**.
7. Tests:
   - unit tests per pattern;
   - the self-hosted smoke test (gate 15) runs after the sign-in journeys. It fails if a test user's password appears in any container's logs, or if a test user's e-mail or any e-mail address appears in the app's logs;
   - an end-to-end check of a real error report through the built app (4 Oct 2026) found no e-mail, password or source line in it.

**Correlation:** an unexpected error shows the user a reference id (`correlation_id`). Search for it in the logs or in Sentry (tag `correlation_id`) to find the matching log line and error report.

## Configuration (runtime environment variables, nothing baked into the build)

| Variable | Example | Purpose |
|---|---|---|
| `SENTRY_BROWSER_DSN` (optional) | DSN of a separate Sentry project for browser errors | Browser reports go here instead of `SENTRY_DSN` |
| `JADARAT_CLIENT_IP_HEADER` (optional) | `x-real-ip` | Header holding the client IP that the load balancer in front of the app **overwrites** (never one it appends to, such as `x-forwarded-for`), for per-client limits. Vercel's `x-real-ip` is trusted automatically; without a trusted header all clients share one limit |
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
GlitchTip 6.2.6 runs in-country, in `infra/docker` (`glitchtip` with its own database `errors-db`, events kept 90 days):
- One-time set-up: run `glitchtip/bootstrap.py` to create the operator account, organization and project. It prints the DSN with the internal host (`http://<key>@glitchtip:8000/<id>`); put that DSN in `.secrets/.env` as `SENTRY_DSN`. Steps are in [`infra/docker/README.md`](../../infra/docker/README.md).
- The same SDK, scrubbing and tunnel are used as with Sentry EU.
- Gate 15 proves it on every PR: one browser error and one server error (Auth down) must arrive in GlitchTip, redacted and without planted personal data.

## Browser errors (`POST /api/monitoring/errors`)

The browser reports uncaught errors and unhandled rejections through **our own server**, never directly to Sentry:
- `src/instrumentation-client.ts` uses the `@sentry/browser` SDK. It adds about 29 KiB gzip of client JS (total 207 of the 250 KiB budget). The scrubbing patterns need Safari 16.4 or later, Next.js 16's own baseline.
- The browser sends to the same-origin endpoint `/api/monitoring/errors` (`connect-src 'self'`) with a placeholder DSN on the never-resolving `.invalid` domain. Sessions, tracing, breadcrumbs and console capture are off.

The server (`lib/error-tunnel.ts`, created with `definePublicRoute`) is a **public, unauthenticated** endpoint, so it is bounded:
- It refuses cross-site browser requests (`Sec-Fetch-Site`). Scripts that send no fetch-metadata headers are accepted, which is why the limits below exist.
- At most 64 KiB and **one** error event per envelope. The event is **rebuilt from an allow-list** (`sanitizeBrowserEvent`):
  - kept: exception types, values and frame locations, level, timestamp and page URL;
  - dropped: user, tags, headers, contexts, extra data, debug metadata, the client fingerprint and SDK settings.

  It is then scrubbed like server events, and the browser's environment and release are replaced by the server's own.
- Rate limits per minute and per instance: at most **10 forwarded reports per client** (keyed on a client-IP header the platform overwrites: `x-real-ip` on Vercel, or the one named in `JADARAT_CLIENT_IP_HEADER`; only a valid IP address counts; kept in memory, never logged) and **60 in total**.
- The upstream request times out after 5 seconds, and the browser always gets the same answer.
- Destination: `SENTRY_BROWSER_DSN` if set, otherwise `SENTRY_DSN`. A separate browser project keeps forged browser reports from using up the quota that server errors depend on. With no DSN at all, reports are dropped (`204`).

**Before the first customer (PO, guided):**
1. Create a separate Sentry project for browser errors and set `SENTRY_BROWSER_DSN`.
2. Set a per-key rate limit on both Sentry projects (Settings → Client Keys → Rate limits).
3. Consider a Vercel firewall rate-limit rule for `/api/monitoring/errors`.

## Health endpoints

| Endpoint | Answers | Use |
|---|---|---|
| `GET /api/health/live` | `200 {"status":"ok"}` while the process runs | container health check (`app.Dockerfile`), orchestrators |
| `GET /api/health/ready` | `200 {"status":"ok"}`, or `503 {"status":"unavailable"}` when the database cannot be reached as `app_server` | uptime monitors, load balancers |

Both are public and `no-store`, and never return versions, hosts or error details. Each app instance runs at most one readiness probe at a time: concurrent requests share it, and its result is reused for 5 seconds. A probe that takes longer than 3 seconds is cancelled so it does not hold a database connection. More dependencies (Storage, worker heartbeat, ClamAV) join `/ready` when they exist (ADR 0009 §6).

## Uptime check (staging)

`.github/workflows/uptime.yml` runs at minutes 7, 22, 37 and 52 of every hour (GitHub may delay scheduled runs by several minutes):
- If `/api/health/ready` fails twice 30 s apart, it opens the issue **"Uptime: staging is down"** (label `uptime`), or comments on it if it is already open. GitHub notifies watchers of the repository.
- The issue is closed automatically after the next successful check.
- Only issues opened by the workflow itself (author `github-actions`) are touched. The repository is public, so staging incidents are visible; staging has no customer data.
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
| Supabase Auth (GoTrue) writes the e-mail of each sign-in to its own logs (`actor_username`, `user_email`; seen in the self-hosted smoke test). On the hosted cloud, Supabase keeps those logs | Third-party component; we cannot change its log content | Self-hosted: collect GoTrue logs through a scrubbing collector with short retention (ADR 0009 §5 Collector, M2). Cloud: covered by the Supabase sub-processor terms and the log access rules |
| Source-map upload vs. the licence policy | The Sentry CLI used for uploads is FSL-licensed and removed from the install | Part b: upload through the Sentry/GlitchTip HTTP API from a small script, or a PO-approved licence exception for a build-only tool |
| Traces and metrics (OpenTelemetry), alert rules, status page | Need a backend (ADR 0009 §5) | M2/M3, with the worker (ADR 0005) |
| `actor_ref` (HMAC of the user id) in logs | No per-user logging needed yet | When the first module action logs per actor |
