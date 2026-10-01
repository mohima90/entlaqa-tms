# ADR 0004 — Domain events: transactional outbox and PostgreSQL queue

**Status:** Accepted — PR #9, 30 Sep 2026 · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B04 · **Related:** BRD §3.4.1, §7.2, §7.7, §9.1 (FR-INT-03), §9.3, Appendix C (LMS sync record), Appendix H.1/H.5; FR-STE-03, FR-LMS-06/07/10; NFR-SCAL-03, NFR-OBS-01; ADR 0001, ADR 0002, ADR 0005, ADR 0011

## Context

- Modules never read each other's tables (ADR 0001); they communicate through service interfaces in `packages/contracts` and **domain events**. Suite modules (Core HR, Payroll & Time, …) will publish and consume events in the same database (FR-STE-03…09).
- Many R1 features react to state changes: notifications (NTF-07/08), compliance recalculation (CRT-07/08), certificate issuance (CRT-03), LMS enrollment push and completion pull (LMS-06/07), audit-adjacent projections, reports. R2 adds outbound webhooks (FR-INT-03).
- A business change and "the fact that it happened" must be committed atomically: no event for a rolled-back change, no lost event for a committed one (dual-write problem).
- The mechanism must run identically on Supabase cloud and on self-hosted PostgreSQL in-country (ADR 0010), without vendor-only services.
- No user-facing request may wait on a third-party call (NFR-SCAL-03).

## Options considered

**Where the outbox lives**
1. **Outbox table per schema** (`tms.outbox`, `core_hr.outbox`, …) — ownership is obvious, but N relays, N retention jobs, and the suite-wide event log is fragmented.
2. **One platform-wide outbox** (`platform.event_outbox`) written through the `platform-events` API — one relay, one log, one replay tool; ownership is expressed by the event `type` namespace, not by the table. Modules already may reference `platform` (ADR 0001).

**Queue**
| Option | Pros | Cons |
|---|---|---|
| A. `pgmq` (Supabase Queues) | Transactional `send`, visibility timeout, archive; available on Supabase | A second queue next to the job runner (ADR 0005); no built-in fan-out, dead-letter or per-key ordering (hand-rolled anyway); extension availability on non-Supabase PostgreSQL in-country must be verified |
| B. Outbox table + `FOR UPDATE SKIP LOCKED` dispatcher, deliveries executed by the job runner of ADR 0005 (graphile-worker) | One queue technology for events and jobs; plain SQL (no extension); full control of envelope, retention, replay and RLS | We own the dispatcher code (small) |
| C. External broker (Kafka, RabbitMQ, NATS) | High throughput, rich routing | Extra stateful service in every deployment incl. in-country; still needs an outbox for atomicity; premature |

## Decision

**Option 2 + B:** a single platform-wide transactional outbox in PostgreSQL, dispatched by a `SKIP LOCKED` dispatcher that fans events out to subscriber jobs in graphile-worker (ADR 0005). `pgmq` is not used in R1; it may be reconsidered if a Supabase-native consumer (e.g., Edge Functions) ever needs events.

### 1. Producing events
- Producers call `ctx.events.emit(type, data, { aggregate })` inside the same `withUserTx` / `withSystemTx` transaction as the business write (ADR 0002). The helper validates `data` against the contract schema, then inserts into `platform.event_outbox`.
- `tenant_id` defaults to `private.current_tenant_id()` and is checked by RLS (`with check`); actor fields come from the verified claims, never from the caller.
- RLS on `platform.event_outbox`: restrictive `tenant_isolation`; `authenticated` may **insert only** (no select/update/delete). The table is append-only for application roles.

### 2. Envelope (CloudEvents 1.0, structured JSON)
| Attribute | Value |
|---|---|
| `specversion` | `"1.0"` |
| `id` | UUID of the outbox row (globally unique; the idempotency key for consumers) |
| `source` | `jadarat://<deployment>/<module>` (e.g., `jadarat://sa-gov-1/tms`) |
| `type` | `com.entlaqa.<module>.<entity>.<action>` — e.g., `com.entlaqa.tms.enrollment.approved`, `com.entlaqa.platform.person.updated` (matches BRD §7.7 / §9.3) |
| `subject` | aggregate id (e.g., enrollment UUID) |
| `time` | commit-time timestamp (UTC, RFC 3339) |
| `datacontenttype` | `application/json` |
| `dataschema` | `urn:jadarat:event:<module>.<entity>.<action>:v<major>` — the schema version |
| extensions | `tenantid`, `actortype` (`user`/`system`/`integration`/`platform_staff`), `actorid`, `onbehalfof` (impersonation, ADR 0003 §6), `correlationid`, `causationid`, `aggregateversion`, `traceparent`/`tracestate` (CloudEvents distributed-tracing extension) |

Extension names follow the CloudEvents rule (lower-case alphanumerics, no underscores). `data` uses snake_case JSON and carries **identifiers and the changed facts needed to react** (thin events) — no free-text personal data (names, e-mails, phones). Consumers that need more fetch it through the owning module's service interface.

### 3. Contracts
- Every event type has a zod schema in `packages/contracts/events/<module>/<entity>.<action>.v<N>.ts` and a registry entry (type → schema, owner module, public/internal, PII classification).
- Within a major version only additive, optional changes are allowed; CI diffs the generated JSON Schemas against `main` and fails on breaking changes. A breaking change creates `v<N+1>`; producers dual-publish both versions for one release while consumers migrate.
- JSON Schemas for public event types are exported for the webhook documentation (R2, ADR 0011).

### 4. Dispatch
- An `AFTER INSERT … FOR EACH STATEMENT` trigger calls `private.kick_event_dispatcher()` (security definer, owned by the queue role, `search_path = ''`), which adds a graphile-worker job `platform.events.dispatch` with a fixed `job_key` (debounced: at most one pending dispatch job) in the named queue `events-dispatch` (runs serially). The job is visible to workers only after the business transaction commits.
- The dispatcher (role `app_queue`, **not** a member of `authenticated`, own narrow `select`/`update` policy on the outbox — no `BYPASSRLS`) loops: `select … where dispatched_at is null order by position limit 500 for update skip locked`; for each event and each matching subscriber it adds a delivery job `platform.events.deliver` with `job_key = <subscriber>:<event_id>` (duplicate-safe), then sets `dispatched_at`.
- Subscribers are registered in code (`platform-events` registry): name, event types, handler, `max_attempts`, optional ordering key. The registry is the single source of truth; unknown types fail CI.

### 5. Consuming (idempotent)
- A delivery job opens `withSystemTx(event.tenantid, actor = subscriber)` under the `app_worker` login (ADR 0002 §6a/§7, ADR 0005 §2) so RLS applies, then inserts `(subscriber, event_id)` into `platform.event_inbox`; on conflict the event was already processed and the job ends successfully. Handler work and the inbox row commit in one transaction (exactly-once **effect**, at-least-once delivery).
- Handlers must be side-effect-safe on retry: external calls (e-mail, LMS, webhooks) are not made inside the handler transaction; the handler writes a delivery record (e.g., `platform.message_deliveries`, `tms.lms_sync_records`) and enqueues a separate job that calls out with an idempotency key derived from that record.

### 6. Ordering
- Dispatch order follows `position` (single serial dispatcher), but **delivery order is not guaranteed** (parallel workers, retries). Consumers that care about order compare `aggregateversion` with the last version they applied and skip stale events or retry until the predecessor is applied. No consumer may assume global ordering.

### 7. Retries, dead-letter, replay
- Retries use graphile-worker exponential backoff (verify the exact formula at implementation); default `max_attempts = 10` for internal subscribers; subscriber-specific schedules where the BRD sets one (webhooks: up to 24 h, FR-INT-03).
- After the final attempt the wrapper writes `platform.event_dead_letters` (tenant, event, subscriber, attempts, sanitized last error, status `open|replayed|discarded`) and raises an alert (ADR 0009). Integration-facing dead letters are also mirrored into tenant-visible records (`tms.lms_sync_records` status `Dead-letter`, Appendix C).
- **Replay:** (a) single dead letter → re-enqueue the delivery; (b) bulk replay for a subscriber by tenant/type/time range from the outbox; to reprocess already-handled events (e.g., rebuilding a projection) the subscriber's inbox key is versioned (`compliance-projector@v2`). Replays are audited platform operations.
- Retention: dispatched outbox rows are kept **90 days** (configurable) for replay, then deleted in batches by a housekeeping job; inbox rows 30 days after the outbox row expires. The outbox is not the audit log (FR-AUD-01 is `platform.audit_events`).

### 8. Relation to webhooks and LMS sync
- **LMS (R1):** the LMS connector is a subscriber. Outbound (e.g., enrollment push) → `tms.lms_sync_records` row (status `Queued`) → delivery job with `Idempotency-Key = <sync_record_id>` (BRD §7.7) → status transitions per Appendix C. Inbound LMS webhooks are verified, stored in `tms.lms_inbound_events` (deduplicated on the LMS event id) and turned into internal events; nightly reconciliation (ADR 0005) closes gaps.
- **Webhooks (R2):** a `webhooks` subscriber maps internal events whose registry entry is `public` to the §9.3 catalog, builds the payload with the public API serializers (ADR 0011) and creates `platform.webhook_deliveries`. Internal-only events never leave the deployment.

## Consequences

**Positive:** atomic business change + event; one mechanism for all modules and all deployment models; replayable, observable (outbox lag, dead letters); no extra infrastructure beyond PostgreSQL and the job runner.

**Negative / costs:** dispatcher and subscriber registry must be built and tested in M1/M2; at-least-once delivery forces idempotent handlers everywhere; the outbox adds one insert per state change; a serial dispatcher caps throughput (thousands of events/second — ample for NFR-SCAL targets; revisit with partitioned dispatch if needed).

## Security impact
- Events carry identifiers, not personal data, so queue tables and logs hold no PII. The payload contract carries a PII classification reviewed at PR time.
- Tenant comes from claims (RLS `with check`); consumers run with system claims for the event's tenant, so RLS still isolates their work. The dispatcher role can read the outbox across tenants but cannot read business tables.
- Dead-letter errors are sanitized (no payloads, tokens or provider responses containing personal data).

## Sovereign deployment impact
Pure PostgreSQL tables + graphile-worker (a Node library with its own SQL schema) — no extension or cloud service required; identical on Supabase cloud and self-hosted PostgreSQL.

## Suite impact
Every suite module publishes `com.entlaqa.<module>.*` events through the same outbox and consumes others' events via subscribers; e.g., TMS subscribes to `com.entlaqa.core_hr.employee.*` (FR-STE-03) and publishes training days to Payroll & Time (FR-STE-04).

## Verification
1. Unit/integration tests: emit inside a rolled-back transaction → no event; committed → exactly one outbox row; duplicate delivery → handler effect once (inbox).
2. pgTAP: outbox RLS (tenant A cannot insert with tenant B id; `authenticated` cannot select/update/delete); dispatcher role cannot read `tms.*`.
3. CI: contract schema compatibility check; every emitted type registered; every subscriber type exists.
4. Chaos test in CI: kill the worker mid-batch → all events delivered once after restart; LMS retry test with no duplicates (Gate G6).
5. Metrics and alerts: outbox lag (oldest undispatched event age), dead-letter count (ADR 0009).
