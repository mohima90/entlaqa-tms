# Background jobs and domain events (runbook)

| | |
|---|---|
| **Backlog** | T-M2-06a (background jobs foundation) |
| **Architecture** | ADR 0004 (domain events, transactional outbox), ADR 0005 (graphile-worker, runtime modes) |
| **Code** | `packages/platform-jobs` (runner, dispatcher, subscriber registry; `src/kick/` — the web app's request for a pass, §1a) · `apps/suite/src/app/api/cron/jobs` (Vercel Cron) · `apps/worker` (process) · `platform-db` `emitEvent` (and `markEventProcessed` / `tenantIsServed` in `./jobs`) · migration `20261007090000_platform__jobs_and_event_outbox.sql` |

## 1. How it works

```mermaid
flowchart LR
  A["Request or job<br/>(withUserTx / withSystemTx)"] -- "emitEvent() in the same transaction" --> O[("platform.event_outbox")]
  O -- "on commit: notification jadarat_events" --> W["Worker (daemon)<br/>listening"]
  W -- "queues a dispatch<br/>(also every minute)" --> Q[("graphile_worker<br/>(owned by app_queue)")]
  Q --> D["platform.events.dispatch<br/>(app_queue)"]
  D -- "one delivery job per subscriber and event<br/>job_key = subscriber:event id" --> Q
  Q --> V["platform.events.deliver"]
  V -- "withSystemTx(event tenant)<br/>inbox row + handler work, one transaction" --> I[("platform.event_inbox")]
```

1. Code that changes data calls `emitEvent(tx, { type, subject, data })` **in the same transaction**. The database stamps the tenant and the actor (user, system or platform) from the verified claims; `data` holds identifiers only (thin events, no names, e-mail addresses or phone numbers).
2. When the transaction commits, the outbox trigger's notification (channel `jadarat_events`, one per transaction, none for a rollback) wakes the workers in daemon mode, which queue a `platform.events.dispatch` job (keyed: at most one waiting). The trigger runs as the inserting role and does nothing else, so business transactions never run queue code and never wait on the queue. A minutely schedule dispatches anything a notification missed (no worker listening, a lost connection, one-pass mode).
3. The dispatcher (login role `app_queue`, no access to business tables) takes up to 500 pending events (`for update skip locked`, so dispatchers on several workers never take the same event), queues one `platform.events.deliver` job per subscriber and event in a single call, and marks the events dispatched — all in one transaction.
4. A delivery runs inside the event tenant's system transaction (`withSystemTx`, login role `app_worker`, RLS applies). If the organization is not active (suspended, cancelled) the delivery is skipped with a warning and not replayed later (ADR 0005 §4). Otherwise it records `(subscriber, event)` in `platform.event_inbox`; if that row already exists the delivery was a retry or a duplicate and the handler does not run. The inbox row and the handler's work commit together: **exactly-once effect, at-least-once delivery**. Deliveries for a subscriber that no longer exists or no longer handles the event type are skipped. **Effect subscribers** (`kind: 'effect'`, e.g. the e-mail sender) call an external service instead: they run outside any transaction and write no inbox row (**at-least-once**), so each must be idempotent on its own — claim its own delivery record in the tenant, call the service with that record's id as idempotency key, record the outcome (ADR 0004 implementation notes, T-M2-06b). They receive the attempt number and the last one; for an inactive organization their optional `discard` runs instead of `perform`.
5. A failing handler rolls back (inbox row included) and graphile-worker retries it with exponential back-off (`exp(min(attempts, 10))` seconds; 10 attempts by default, per subscriber `maxAttempts`). The error reaches the queue (`last_error`) and the logs as `delivery failed: <class> [<code>]` with stack locations only: its message may name people or quote values, so it is never kept.

## 1a. How passes start on the hosted environment (PO decision, 20 Oct 2026)

Hosted production has no always-on worker yet (ADR 0005 §1): **Actions → Jobs** runs one pass per run. GitHub starts its 5-minute schedule late, or skips it, when it is busy (20 Oct 2026: about 5 runs in the whole day), so e-mails, scans and imports waited for hours. Now three things start a pass (ADR 0005 §1 amendment):

| What | When | How |
|---|---|---|
| **Web-app kick** | Right after an action that queued work has **committed** — any action whose transaction emitted a domain event (invitations, deactivation, imports, file uploads awaiting their scan, …) or that declares `queuesWork: true` (Email integration test e-mail, own password change) or marks its transaction with `noteWorkQueued` (a Branding save whose new image is left to the worker), plus the public flows that queue account e-mails (password reset, password changed, account locked, authenticator e-mails) and the platform sender's test e-mail | defineAction's central hook (`runtime.requestWorkerPass`) and `kicksWorker` (platform-identity `auth-next.ts`) call `@jadarat/platform-jobs/kick/next`, which schedules the request with Next's `after()` — it runs after the response, never delays or changes it |
| **Vercel Cron** | Every minute (`apps/suite/vercel.json`: `{"path": "/api/cron/jobs", "schedule": "* * * * *"}`, Vercel Pro) | `GET /api/cron/jobs` with `Authorization: Bearer <CRON_SECRET>` (Vercel sends it when the project has `CRON_SECRET`); anything else → 401 |
| **GitHub schedule** | Every 5 minutes (when GitHub manages) | The safety net — unchanged |
| By hand | Any time | Actions → Jobs → Run workflow |

**How a request is made.** The web app acts as a dedicated **GitHub App** (security review H1, 21 Oct 2026 — never a personal token: a personal token acts as the PO's own GitHub user and could start *every* workflow, `platform-admin.yml` and `tenant-provision.yml` included, indistinguishable from the PO). Per request (`@jadarat/platform-jobs/kick`, `node:crypto`, no extra dependency):

1. it signs a short-lived **App JWT** (RS256; `iat` now − 60 s, `exp` now + 9 min, `iss` = the App ID) with the App's private key;
2. exchanges it at `POST https://api.github.com/app/installations/<JOBS_DISPATCH_INSTALLATION_ID>/access_tokens` for an **installation token narrowed** to `{"repositories": ["entlaqa-tms"], "permissions": {"actions": "write"}}`, kept in memory until **5 minutes before** its `expires_at` (GitHub: one hour);
3. calls `POST https://api.github.com/repos/<JOBS_DISPATCH_REPO>/actions/workflows/jobs.yml/dispatches` with `{"ref": "main"}`.

Every call has a 5-second timeout and refuses redirects; the origin is fixed (`api.github.com`), the settings only fill path segments that match strict patterns. It never fails or slows the action: errors are logged as warnings (`platform.jobs.request_pass` with the HTTP status — `github_token_http_401` wrong App ID or key, `github_token_http_404` wrong installation ID, `github_token_http_422` the App lacks the repository or Actions write, `github_http_403/404` on the dispatch) and the work waits for the next kick, the cron or the schedule. The key, the JWT, the token and GitHub's answers are never logged.

**Throttle.** Each web instance asks at most **once a minute for actions** (one shared window, in memory) and the **cron has its own window** (30 seconds — only a guard against a tight loop), so an action's kick never makes the minute's cron skip (review L1). More would be harmless: the workflow's `concurrency` group (`jobs-production`, `cancel-in-progress: false`) keeps one pass running and one waiting, and a newer waiting run replaces the older one — but each extra dispatch is an API call and a queued run for nothing. A pass takes about 1–2 minutes to start (install and bundle the worker; with `FILE_SCANNING=on` another 1–2 minutes of signatures), so a queued e-mail now goes out within a few minutes. The repository is public: GitHub Actions minutes on standard runners cost nothing; should it become private, the per-minute cron (a pass about every minute, back to back) would use Actions minutes — revisit then.

**What the App can do — and what refuses it.** Permissions: **Repository → Actions: Read and write** only (GitHub adds *Metadata: Read-only* itself), installed on **this repository only**, webhook off. With that, whoever holds its private key can, on this repository: start, cancel and re-run workflow runs; **disable or enable workflows** (e.g. disable **CI** — a denial of service until the PO enables it again); delete workflow runs and their logs, artifacts and caches; read runs and logs. It **cannot** read or change secrets, variables, code, settings, issues or pull requests, cannot approve deployments, and cannot reach the database or Storage. What it may run is limited by the workflows themselves: **every workflow with `workflow_dispatch` except Jobs** (`ci.yml`, `codeql.yml`, `db-deploy.yml`, `db-deploy-auto.yml`, `platform-admin.yml`, `tenant-provision.yml`, `selfhosted-nightly.yml`, `uptime.yml`) refuses a run whose `github.triggering_actor` is the repository variable **`JOBS_KICK_ACTOR`** (the App's bot login, e.g. `jadarat-jobs-kick[bot]`) — for any event, so a **re-run** of a PO's run by the App is refused too — and refuses a **manual start (`workflow_dispatch`) by any `[bot]`**. A refused run fails visibly (job "Refuse a start by the worker-kick app or another bot"; CI gates and CodeQL fail rather than skip, because a skipped required check would count as passed); its sensitive jobs never start, so no environment secret is reached. Dependabot's pull-request runs and the schedules are unaffected; with `JOBS_KICK_ACTOR` unset the PO and Claude still run every workflow by hand (only bots are refused). In **Jobs** the App may run the production pass only (never `environment: staging`). The environments `production` and `production-jobs` admit **`main` only** (production-setup.md step 0), so an old branch whose workflow files predate the guard cannot reach their secrets either.

**Settings (Vercel, Production only):**

| Variable | Kind | Value |
|---|---|---|
| `JOBS_DISPATCH_APP_ID` | config | The App's **App ID** (App settings → General) |
| `JOBS_DISPATCH_APP_PRIVATE_KEY` | **secret** (Sensitive) | The whole `.pem` file the App generated (`-----BEGIN RSA PRIVATE KEY-----` … `-----END …-----`); line breaks or literal `\n` both work |
| `JOBS_DISPATCH_INSTALLATION_ID` | config | The number at the end of the installation's URL (`…/settings/installations/<id>`) |
| `JOBS_DISPATCH_REPO` | config | `mohima90/entlaqa-tms` |
| `CRON_SECRET` | **secret** (Sensitive) | A random value of at least 16 characters (32+ letters and digits suggested) |
| `JOBS_DISPATCH_WORKFLOW`, `JOBS_DISPATCH_REF` | config, optional | Defaults `jobs.yml`, `main` |

GitHub repository **variable** (not a secret): `JOBS_KICK_ACTOR` = `<app-slug>[bot]`. Values are checked against strict patterns; an incomplete or invalid set logs one error naming the setting (`jobs_dispatch_config_invalid`, never the value) and turns dispatching off (the app still starts). A leftover `JOBS_DISPATCH_TOKEN` (the personal token of the first version) is ignored and logged at start-up as `jobs_dispatch_token_obsolete` — delete it from Vercel and **revoke the token on GitHub**. Previews need none of them: their queued work is picked up by production's cron within about a minute.

**When something is not set.**
- No App settings → nothing is dispatched (self-hosted installations run the continuous worker; local development) — passes come from the GitHub schedule only, as before. The cron route then answers 200 `{"outcome":"off"}`.
- No `CRON_SECRET` (or shorter than 16 characters) → the cron route answers **401 to everyone**, Vercel's cron included, and does nothing; the start-up log of a production deployment with the App configured warns `cron_secret_missing`. The after-action kicks still work. The secret and the presented bearer are trimmed the same way; a request with a bearer that does not match logs `cron_secret_mismatch` (no values, at most every 10 minutes per instance) — typically a rotated secret before the redeploy.
- No `JOBS_KICK_ACTOR` → the workflows still refuse every `[bot]` started by hand, but a **re-run** by the App of a run someone else started would not be refused: set it with the App.

**Rotation.**
- *App private key* (yearly, or at once if it may have leaked): GitHub → Settings → Developer settings → GitHub Apps → the App → **General → Private keys → Generate a private key** → Vercel → `JOBS_DISPATCH_APP_PRIVATE_KEY` → Edit → the new file's contents → **Redeploy** → check that Jobs runs started by `workflow_dispatch` appear again → back in the App, **Delete** the old key. A leak: delete the key in the App first (dispatching stops; the GitHub schedule continues), then generate a new one as above, and check **Actions** for workflows disabled or runs deleted by the App.
- *Installation tokens* are never stored: each lives at most an hour in a server's memory.
- `CRON_SECRET`: new value in Vercel, redeploy (Vercel's cron picks it up automatically).

## 2. Adding a subscriber

```ts
// packages/<package>/src/jobs/subscribers.ts  (or modules/<module>/src/jobs/…)
import type { Subscriber } from '@jadarat/platform-jobs/jobs';

export const invitationEmail: Subscriber = {
  name: 'notifications.invitation_email', // stable; it is the inbox key
  types: ['com.entlaqa.platform.invitation.created'],
  handle: async ({ tx, event }) => {
    // Database work only, in `tx` (the event's tenant). Never call an external service here:
    // write a delivery record and let a separate job call out, keyed by that record (ADR 0004 §5).
  },
};
```

Then add it to `SUBSCRIBERS` in `apps/worker/src/subscribers.ts`. Rules:

- Names are lower-case (`a-z 0-9 _ . @ -`), unique, and never reused; to reprocess events already handled (rebuilding a projection), version the name (`compliance-projector@v2`).
- Event types follow `com.entlaqa.<module>.<entity>.<action>`.
- Handlers must not assume delivery order (ADR 0004 §6).
- Job code lives in a `src/jobs/` folder: only there (and in `apps/worker`) may `withSystemTx` and `@jadarat/platform-jobs/jobs` be imported; the web app can never reach them (dependency rules, `pnpm check:deps`).

## 3. Running the worker

| Where | How | Connections |
|---|---|---|
| Local | `pnpm --filter @jadarat/worker build`, then `node apps/worker/dist/main.mjs daemon` (or `once`) | `DATABASE_URL_APP_QUEUE`, `DATABASE_URL_APP_WORKER` (names in `.env.example`) |
| Self-hosted (sovereign) | Service `worker` in `infra/docker/compose.yaml`: two replicas, daemon mode, read-only container | Same variables; TLS verify-full via `DATABASE_CA_CERT_FILE` |
| Hosted (regional SaaS) until a worker host exists | **Actions → Jobs**: one pass per run — started by the web app after queued work and by its per-minute Vercel Cron (§1a), every 5 minutes by GitHub's schedule, and on demand (§4) | Secrets of the GitHub environment `production-jobs` (the old project: `staging-jobs`, by hand only, until it is deleted) |
| Production (regional SaaS) | Worker containers (≥ 2 replicas) on a container host in Frankfurt — **host to be approved by the PO before real customers** (ADR 0005 §1) | Session-pooler or direct connections (LISTEN/NOTIFY needs a session) |

Modes: `daemon` listens for new events, runs until SIGTERM/SIGINT, lets running jobs finish and exits 0 (allow it up to a minute: a job killed half-way is retried only after graphile-worker's 4-hour lock expiry); `once` installs/upgrades the queue schema, queues a dispatch, runs every job that is due and exits — with exit code 1 when the pass could not run **or** when events written more than 10 minutes earlier are still waiting for dispatch (a stuck dispatch shows as a failed run). Failed jobs stay in the queue for their retry. `WORKER_CONCURRENCY` (default 5 in daemon mode, 2 in one-pass mode) sets the jobs run in parallel; each process opens up to `concurrency + 3` queue connections and `concurrency` tenant connections. The queue connection URL may carry TLS settings only (other parameters, such as `?host=` or `?user=`, are refused).

graphile-worker installs and upgrades its own tables in `graphile_worker` (owned by `app_queue`) when a worker starts. The migration creates the schema and graphile-worker's bootstrap table, so `app_queue` needs no privilege on the database itself. Log lines are the platform's structured JSON lines (`service: jadarat-worker`): graphile-worker's messages (task names, job ids, durations, the cleaned errors above), never job payloads.

## 4. Staging set-up (Product Owner, once, after the PR is merged)

The guide in chat gives one step at a time; this is the full list for reference. Never paste a password or connection string in chat. **The new production project is set up with [production-setup.md](production-setup.md) §C and §H** (environments `production` and `production-jobs`, T-M2-36); the steps below are the record for the old `staging` project and apply the same way.

1. **Password for the job runner.** GitHub → Settings → Environments → `staging` → Add environment secret `APP_QUEUE_DB_PASSWORD` (a new random password: at least 40 characters, only letters, digits, `-` and `_`, as for the other role passwords in [db-deploy.md](db-deploy.md)). Then **Actions → DB deploy** → `plan`, then `apply` (creates the `app_queue` role, the outbox and the inbox, and sets the password).
2. **New environment.** Settings → Environments → New environment `staging-jobs` → Deployment branches and tags → Selected branches → add `main`.
3. **Secrets of `staging-jobs`** (Supabase → Connect → Session pooler, port 5432 — the same host as `DATABASE_URL` in `staging`, with the user names below):
   - `DATABASE_URL_APP_QUEUE` = `postgresql://app_queue.<project-ref>:<APP_QUEUE_DB_PASSWORD>@<pooler host>:5432/postgres`
   - `DATABASE_URL_APP_WORKER` = `postgresql://app_worker.<project-ref>:<APP_WORKER_DB_PASSWORD>@<pooler host>:5432/postgres`
4. **Variable of `staging-jobs`**: `DATABASE_CA_CERT` = the same PEM text as the variable of the same name in `staging`.
5. **Check:** Actions → Jobs → Run workflow (branch `main`; environment `staging` for the old project, `production` for the new one). The run must be green and its log must show `worker starting (once)` and `worker stopped`. Later runs turn red when events wait for more than 10 minutes; GitHub notifies about failed scheduled runs (by default the person who last changed the workflow's schedule).

6. **Optional — files (T-M2-18):** with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` set (step of [password-reset.md](password-reset.md)) the worker also runs file housekeeping; the variable `FILE_SCANNING` = `on` adds the malware scan ([files.md](files.md) §7).

Until steps 3–4 are done, every scheduled run ends after a notice ("not configured yet") — harmless — as long as the repository variable **`JOBS_REQUIRED`** is unset; once it is `on` (repository level only; production: [production-setup.md](production-setup.md) step 30), missing connection secrets fail the run instead. Each pass holds the deploy lock shared and waits up to 8 minutes for a running DB deploy, then fails ([db-deploy.md](db-deploy.md) § Deploy lock). Good to know:
- Scheduled runs start late when GitHub is busy, so on staging an event can take several minutes to be handled; run the workflow by hand for an immediate pass. On production the web app starts passes itself (§1a).
- The repository is public, so **anyone can read these run logs**: they hold task names, job ids and cleaned errors — never payloads, personal data or passwords. A connection failure may show the database host name and the user name `app_queue.<project-ref>` (nothing secret).
- GitHub turns scheduled workflows off after 60 days without activity in a public repository; Actions shows a banner to turn it back on.

## 5. Operations

**Queue commands run only in a session logged in as `app_queue`** — for example psql with the `DATABASE_URL_APP_QUEUE` connection string — never as `postgres`, `supabase_admin` or another owner role, and not by browsing `graphile_worker` in Supabase Studio. Every object in `graphile_worker` belongs to `app_queue`, which can replace it: run by a more powerful role, a replaced function or view would execute with that role's rights (a `set role app_queue` first does not prevent this). The outbox is the exception: `platform.event_outbox` is a platform table and may be read as any role.

| Situation | What to do |
|---|---|
| Pending events pile up (`select count(*) from platform.event_outbox where dispatched_at is null`; on the hosted environment a red **Jobs** run) | Check that a worker is running and can connect (logs: `worker configuration: …` names the variable at fault). Hosted: look at the latest **Jobs** run |
| A job keeps failing | As `app_queue`: `select id, task_identifier, attempts, max_attempts, last_error, run_at from graphile_worker.jobs where attempts > 0 order by run_at`. `last_error` holds the cleaned error (class and code). After the last attempt the job stays in the table with `attempts = max_attempts` — dead-letter records and alerts are a follow-up (ADR 0004 §7) |
| Retry a failed job now | As `app_queue`: `select graphile_worker.reschedule_jobs(array[<id>]::bigint[], run_at := now(), attempts := 0)` |
| A worker died mid-job (killed, host restart) | Its jobs stay locked for 4 hours, then run again. To release them sooner: stop **all** workers (`docker compose stop worker`), then as `app_queue` run `select graphile_worker.force_unlock_workers(array(select distinct locked_by from graphile_worker.jobs where locked_by is not null))`, then start the workers. With workers still running this would also release jobs that are running right now, and they would run twice. Dispatch itself is never blocked by a dead worker (no named queue) |
| Shut down a worker | SIGTERM (`docker compose stop worker`): running jobs finish first, the process exits 0 |

Housekeeping (90-day outbox retention, dead letters, alerts on permanent failures) arrives with the first subscribers that need it (ADR 0004 §7); the R1 schedules of ADR 0005 §6 arrive with their features.
