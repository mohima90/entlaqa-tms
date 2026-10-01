# ADR 0005 — Background jobs and scheduling (self-hostable)

**Status:** Accepted — PR #9, 30 Sep 2026 · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B05 · **Related:** BRD Appendix H.1; FR-NTF-08, FR-CRT-05, FR-CRT-07/08, FR-SCH-08, FR-LOG-01/02, FR-ASM-05, FR-LMS-05/07/10, FR-IAM-03/04, FR-RPT-02; NFR-PERF-05, NFR-SCAL-03, NFR-AVL-04; TM-0001 F-01, F-03 (TB-9); ADR 0001, ADR 0002 §5–§7 (incl. §6a), ADR 0004, ADR 0006, ADR 0009, ADR 0010

## Context

- R1 needs asynchronous work (event deliveries from ADR 0004, e-mail sending, file scanning, PDF certificates, imports of 10,000 users ≤ 5 min, report exports ≤ 2 min) and **schedules** (reminders, certificate expiry, compliance recalculation, LMS reconciliation).
- The same code must run on Vercel (regional SaaS: serverless functions, no long-running processes) and in containers (sovereign, customer-hosted), with no Vercel-only feature in a critical path (CLAUDE.md, BRD §15).
- Jobs touch tenant data and must respect RLS with a per-tenant system actor (ADR 0002 §7).
- Malware scanning needs a ClamAV daemon (ADR 0006), which cannot run on Vercel — so every production deployment needs at least one container host anyway.

## Options considered

| Option | Runs TypeScript jobs | Self-hostable | Scheduling | Notes |
|---|---|---|---|---|
| `pg_cron` (Supabase Cron) | No (SQL only; HTTP via `pg_net`) | Yes (extension) | Cron in DB | Good trigger, not a job runner; retries/backoff/visibility are ours to build |
| Vercel Cron | Calls an HTTP route | No (Vercel-only) | Per-minute on paid plans (verify plan limits) | Trigger only; function duration limits apply |
| Supabase Edge Functions | Deno, separate runtime | Edge runtime self-hostable | Via pg_cron | Second runtime and toolchain; not in the monorepo build |
| **graphile-worker** | Yes (Node) | Yes (SQL schema, no extension) | Built-in distributed crontab | `add_job` callable from SQL inside transactions; `job_key` dedupe/debounce; named queues for serial execution; LISTEN/NOTIFY for low latency; `runOnce` mode |
| pg-boss | Yes (Node) | Yes | `schedule()` cron | Built-in dead-letter queues and throttling; polling-based; transactional enqueue needs a custom `db` executor (verify) |

## Decision

**graphile-worker is the single job runner and scheduler** for all deployment models (package `platform-jobs`). Its schema `graphile_worker` lives in the application database. pg_cron and Vercel Cron are only **optional triggers** for non-production environments, never the place where job logic lives.

### 1. Runtime modes (same job code, same image)
| Mode | Where | How |
|---|---|---|
| **Daemon** (the only production mode) | Container `worker` (Node 24, same monorepo build as `apps/suite`, different entrypoint) | `run()` with LISTEN/NOTIFY; concurrency per process configurable; **≥ 2 replicas** for availability; graceful shutdown on SIGTERM |
| **Tick** (previews and local development only) | Route handler `POST /api/internal/jobs/tick` | Exists only in builds for preview/local environments, which hold **no production secrets** (synthetic data only). Shared secret compared in **constant time**, route rate-limited, bounded time budget; triggered by Vercel Cron on previews or manually |

- **Production resilience comes from a second worker replica, not from the web tier** (TM-0001 F-03). The web deployment's environment never contains the `app_worker`/`app_queue` credentials or the Supabase service key; privileged credentials exist only in the worker runtime (trust boundary TB-9).
- **Regional SaaS (R1):** web on Vercel `fra1`; ≥ 2 `worker` replicas (plus ClamAV, ADR 0006) on a container host in Frankfurt next to Supabase `eu-central-1` (host to be approved by the PO). The production Vercel project has no tick route and no cron entries.
- **Sovereign / dedicated / customer-hosted:** `worker` Deployment (≥ 2 replicas) in the same cluster (ADR 0010).

### 2. Database roles and connections
- `app_worker`: login role, member of `authenticated` with **`NOINHERIT`**, **no `BYPASSRLS`**, owns nothing (ADR 0002 §5). Used by job handlers through `withSystemTx`, which does `set local role authenticated` and sets the **system-actor claim set** defined in ADR 0002 §7 (`role: 'system'`, `tenant_id`, job id). `private.current_tenant_id()` accepts system claims **only when `session_user = 'app_worker'`** and the tenant is active or trial (ADR 0002 §6a), so a leaked `app_server` credential cannot impersonate jobs and vice versa.
- `app_queue`: login role that owns the `graphile_worker` schema; **not** a member of `authenticated`; no `BYPASSRLS`; used by the runner itself and the event dispatcher (ADR 0004). It has narrow explicit policies (outbox dispatch columns, `platform.tenants` id/status/timezone) and can read no business table. Worker schema migrations run at deploy time with a direct/session connection (they use session-level advisory locks).
- The worker process therefore holds two pools: `app_queue` (runner, dispatcher) and `app_worker` (handlers). The Supabase service key (Storage operations in ADR 0006) is present only in the worker environment.
- Daemon mode needs a **session** connection (direct or Supavisor session mode) for LISTEN/NOTIFY; handler pools may use the transaction pooler (prepared statements disabled if required — verify).
- No grants on `graphile_worker` to `authenticated`/`anon`; the schema is never exposed through the Data API. It is on the RLS catalog-check allow-list as infrastructure.

### 3. Enqueuing
- Request-path code does **not** enqueue jobs directly. It emits a domain event or a command-style event (e.g., `com.entlaqa.platform.file.uploaded`, `com.entlaqa.platform.export.requested`) through the outbox (ADR 0004); subscribers turn them into jobs. One transactional path, no lost jobs.
- Job payloads contain only IDs (`tenant_id`, entity ids, event id) — never personal data or secrets.
- Deduplication with `job_key` (e.g., `cert-expiry:<tenant>:<date>`); serial execution where needed with named queues (e.g., one queue per LMS connection).

### 4. Tenant execution context
- Every tenant job runs inside `withSystemTx(tenantId, { jobId, task })` with the system-actor claim set of ADR 0002 §7 (validated in the database per §6a), so RLS applies exactly as for users. Audit events and outbox rows written by jobs carry actor type `system` and the task name. `withSystemTx` is importable only from `**/jobs/**` (dependency-cruiser rule) and only works under the `app_worker` login.
- Jobs check the tenant is `active`/`trial` and the feature is licensed/enabled (FR-ADM-13, SUB-01) before doing work.
- Cross-tenant work (fan-out over tenants, housekeeping) uses `app_queue` with explicit narrow policies (e.g., read `platform.tenants.id, status, default_timezone`) or the admin client — the latter only in `**/jobs/**`, audited (ADR 0002 §7).

### 5. Scheduling model
- Global crontab entries (UTC) run **fan-out** tasks that enumerate eligible tenants and enqueue one job per tenant with a window `job_key`, so every tenant job is idempotent per window and can be retried safely.
- Tenant-local times (digests at 07:00 local, quiet hours) are evaluated inside the per-tenant job using the tenant/branch timezone and working calendar (ADR 0007).
- Scan-based reminders ("what is due in this window?") are preferred over per-item future jobs, so reschedules and cancellations need no job cleanup; each reminder is recorded (`platform.scheduled_dispatches` unique on `(tenant, rule, subject, offset)`) to prevent duplicates.

### 6. R1 schedules
| Task | Schedule (default) | Feature |
|---|---|---|
| Session reminders T-7d/T-3d/T-1d/T-1h; task reminders and overdue escalation | every 5 min | NTF-08, LOG-01 |
| Joining instructions due to send | every 15 min | LOG-02 |
| Manager/coordinator digests | hourly fan-out, sent at tenant-local time | NTF-08 |
| Minimum-enrollment check (warn, auto-confirm, auto-cancel at T-N) | hourly | SCH-08 |
| Session status auto-transition (in progress / completed) and L1 survey dispatch at session end | every 5 min | SCH-02, ASM-05 |
| Certificate status (Active → Expiring → Expired), expiry reminders 90/60/30/7 d, recertification enrollment | daily 02:00 tenant-local | CRT-05 |
| Instructor qualification and teach-authorization expiry alerts | daily | INS-02/03 |
| Compliance recalculation — full nightly run + event-driven incremental updates; daily snapshot for trends | daily 03:00 tenant-local | CRT-07/08, RPT-01 |
| LMS catalog refresh | per connection schedule (default hourly) | LMS-05 |
| LMS reconciliation (missed completions/enrollments) | nightly per connection | LMS-07/10 |
| LMS health checks; auto-pause after repeated failures | every 5 min | LMS-10 |
| Invitation expiry; trial expiry reminders | daily | IAM-03, ADM-01 |
| Report KPI snapshot refresh | every 15 min | RPT-01/02 |
| Housekeeping: outbox/inbox retention, expired exports, orphan uploads, quarantine purge, delivery-log retention (12 months), audit partition creation | daily | ADR 0004/0006/0008, FR-AUD-01 |

On-demand jobs: event deliveries, e-mail/in-app sends, file scanning and image variants, certificate PDF rendering, user import (IAM-04) and bulk enrollment (ENR-03) with progress, report exports.

### 7. Failure handling
Exponential backoff (graphile-worker default; verify formula), `max_attempts` per task, permanent failures recorded in `platform.job_failures` (sanitized) and alerted; long jobs checkpoint progress (imports in batches of 500 rows) so a retry resumes. Job-level timeouts are enforced by the task wrapper.

## Consequences

**Positive:** one runner, one scheduler, one set of semantics everywhere; transactional enqueue via the outbox; per-tenant idempotent schedules; no vendor lock-in.

**Negative / costs:** regional SaaS needs a small container host besides Vercel with at least two worker replicas (also required by ClamAV); graphile-worker's crontab and backoff semantics must be learned and tested; LISTEN requires session connections (connection budget planning).

## Security impact
Privileged credentials (`app_worker`, `app_queue`, service key, provider keys) exist only in the worker runtime (TM-0001 F-03, TB-9); no tick route in production; system claims only constructed in `**/jobs/**` and accepted by the database only under `app_worker` (F-01); no PII in job payloads; admin-client use limited and audited; job failures sanitized before storage/logging.

## Sovereign deployment impact
graphile-worker needs only PostgreSQL and Node — both in-country. No cloud scheduler required.

## Suite impact
Each module registers tasks and crontab entries in its `jobs/` folder with namespaced names (`tms.*`, `core_hr.*`); the platform runner loads all licensed modules' tasks.

## Verification
1. Integration tests run tasks against a real PostgreSQL (local Supabase) with two tenants; RLS isolation holds under `withSystemTx`.
2. Idempotency tests: running a scheduled task twice in the same window produces no duplicate reminders/notifications.
3. Self-hosted smoke test (ADR 0010): daemon mode processes an event, a scan job and a scheduled task; tick mode verified only on the Vercel preview.
6. Configuration tests: the production web environment contains no worker/service credentials and no tick route; system claims set under `app_server` read zero rows (ADR 0002 §6a test 3a); killing one worker replica does not stop processing.
4. Import performance test: 10,000 users ≤ 5 min (NFR-PERF-05).
5. Alerts on queue depth, oldest runnable job age and permanent failures (ADR 0009).
