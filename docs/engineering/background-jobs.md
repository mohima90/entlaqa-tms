# Background jobs and domain events (runbook)

| | |
|---|---|
| **Backlog** | T-M2-06a (background jobs foundation) |
| **Architecture** | ADR 0004 (domain events, transactional outbox), ADR 0005 (graphile-worker, runtime modes) |
| **Code** | `packages/platform-jobs` (runner, dispatcher, subscriber registry) · `apps/worker` (process) · `platform-db` `emitEvent` (and `markEventProcessed` / `tenantIsServed` in `./jobs`) · migration `20261007090000_platform__jobs_and_event_outbox.sql` |

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

**Platform tasks** (ADR 0005 §4) are work that belongs to no tenant yet: a payload-free job per task drains a platform-level queue through its own definer functions, queued on every wake-up, every minute and in each one-pass round. Today: `platform.account_mail` (password-reset e-mails and "password changed" notices, [password-reset.md](password-reset.md)) and, when the Auth admin API is configured, `platform.account_access` (T-M2-09: ban in Auth an account that signs in nowhere after a deactivation, lift the ban on reactivation or a new invitation — ADR 0002 §7 note T-M2-09). The worker's start-up line says which run: `reset links: on|off; account bans: on|off`.

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
| Staging (regional SaaS) | **Actions → Jobs (staging)**: one pass every 5 minutes and on demand (§4) | Secrets of the GitHub environment `staging-jobs` |
| Production (regional SaaS) | Worker containers (≥ 2 replicas) on a container host in Frankfurt — **host to be approved by the PO before real customers** (ADR 0005 §1) | Session-pooler or direct connections (LISTEN/NOTIFY needs a session) |

Modes: `daemon` listens for new events, runs until SIGTERM/SIGINT, lets running jobs finish and exits 0 (allow it up to a minute: a job killed half-way is retried only after graphile-worker's 4-hour lock expiry); `once` installs/upgrades the queue schema, queues a dispatch, runs every job that is due and exits — with exit code 1 when the pass could not run **or** when events written more than 10 minutes earlier are still waiting for dispatch (a stuck dispatch shows as a failed run). Failed jobs stay in the queue for their retry. `WORKER_CONCURRENCY` (default 5 in daemon mode, 2 in one-pass mode) sets the jobs run in parallel; each process opens up to `concurrency + 3` queue connections and `concurrency` tenant connections. The queue connection URL may carry TLS settings only (other parameters, such as `?host=` or `?user=`, are refused).

graphile-worker installs and upgrades its own tables in `graphile_worker` (owned by `app_queue`) when a worker starts. The migration creates the schema and graphile-worker's bootstrap table, so `app_queue` needs no privilege on the database itself. Log lines are the platform's structured JSON lines (`service: jadarat-worker`): graphile-worker's messages (task names, job ids, durations, the cleaned errors above), never job payloads.

## 4. Staging set-up (Product Owner, once, after the PR is merged)

The guide in chat gives one step at a time; this is the full list for reference. Never paste a password or connection string in chat.

1. **Password for the job runner.** GitHub → Settings → Environments → `staging` → Add environment secret `APP_QUEUE_DB_PASSWORD` (a new random password: at least 40 characters, only letters, digits, `-` and `_`, as for the other role passwords in [db-deploy.md](db-deploy.md)). Then **Actions → DB deploy** → `plan`, then `apply` (creates the `app_queue` role, the outbox and the inbox, and sets the password).
2. **New environment.** Settings → Environments → New environment `staging-jobs` → Deployment branches and tags → Selected branches → add `main`.
3. **Secrets of `staging-jobs`** (Supabase → Connect → Session pooler, port 5432 — the same host as `DATABASE_URL` in `staging`, with the user names below):
   - `DATABASE_URL_APP_QUEUE` = `postgresql://app_queue.<project-ref>:<APP_QUEUE_DB_PASSWORD>@<pooler host>:5432/postgres`
   - `DATABASE_URL_APP_WORKER` = `postgresql://app_worker.<project-ref>:<APP_WORKER_DB_PASSWORD>@<pooler host>:5432/postgres`
4. **Variable of `staging-jobs`**: `DATABASE_CA_CERT` = the same PEM text as the variable of the same name in `staging`.
5. **Check:** Actions → Jobs (staging) → Run workflow (branch `main`). The run must be green and its log must show `worker starting (once)` and `worker stopped`. Later runs turn red when events wait for more than 10 minutes; GitHub notifies about failed scheduled runs (by default the person who last changed the workflow's schedule).

Until steps 3–4 are done, every scheduled run ends after a notice ("not configured yet") — harmless. Good to know:
- Scheduled runs start late when GitHub is busy, so on staging an event can take several minutes to be handled; run the workflow by hand for an immediate pass. The same holds for the Auth ban after a deactivation (T-M2-09): the database refuses the person at once, the ban follows at the next pass.
- The repository is public, so **anyone can read these run logs**: they hold task names, job ids and cleaned errors — never payloads, personal data or passwords. A connection failure may show the database host name and the user name `app_queue.<project-ref>` (nothing secret).
- GitHub turns scheduled workflows off after 60 days without activity in a public repository; Actions shows a banner to turn it back on.

## 5. Operations

**Queue commands run only in a session logged in as `app_queue`** — for example psql with the `DATABASE_URL_APP_QUEUE` connection string — never as `postgres`, `supabase_admin` or another owner role, and not by browsing `graphile_worker` in Supabase Studio. Every object in `graphile_worker` belongs to `app_queue`, which can replace it: run by a more powerful role, a replaced function or view would execute with that role's rights (a `set role app_queue` first does not prevent this). The outbox is the exception: `platform.event_outbox` is a platform table and may be read as any role.

| Situation | What to do |
|---|---|
| Pending events pile up (`select count(*) from platform.event_outbox where dispatched_at is null`; on staging a red **Jobs (staging)** run) | Check that a worker is running and can connect (logs: `worker configuration: …` names the variable at fault). Staging: look at the latest **Jobs (staging)** run |
| A job keeps failing | As `app_queue`: `select id, task_identifier, attempts, max_attempts, last_error, run_at from graphile_worker.jobs where attempts > 0 order by run_at`. `last_error` holds the cleaned error (class and code). After the last attempt the job stays in the table with `attempts = max_attempts` — dead-letter records and alerts are a follow-up (ADR 0004 §7) |
| Retry a failed job now | As `app_queue`: `select graphile_worker.reschedule_jobs(array[<id>]::bigint[], run_at := now(), attempts := 0)` |
| A worker died mid-job (killed, host restart) | Its jobs stay locked for 4 hours, then run again. To release them sooner: stop **all** workers (`docker compose stop worker`), then as `app_queue` run `select graphile_worker.force_unlock_workers(array(select distinct locked_by from graphile_worker.jobs where locked_by is not null))`, then start the workers. With workers still running this would also release jobs that are running right now, and they would run twice. Dispatch itself is never blocked by a dead worker (no named queue) |
| Shut down a worker | SIGTERM (`docker compose stop worker`): running jobs finish first, the process exits 0 |
| Auth bans wait (T-M2-09) | `select count(*), max(attempts) from private.account_access_checks` (as the migration role; account ids only). Worker logs `account ban failed (<code>); retried later (attempt n)` — an error from the 5th attempt (back-off up to an hour, never given up): check `SUPABASE_URL` / `SUPABASE_SECRET_KEY` (expired self-hosted token: re-run `gen-secrets.sh`) and the gateway. `refused by Auth (<code>)` closes the check: the account stays as it was; the next membership or invitation change of the account decides again |

Housekeeping (90-day outbox retention, dead letters, alerts on permanent failures) arrives with the first subscribers that need it (ADR 0004 §7); the R1 schedules of ADR 0005 §6 arrive with their features.
