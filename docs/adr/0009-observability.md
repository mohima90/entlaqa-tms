# ADR 0009 — Observability

**Status:** Accepted — PR #9, 30 Sep 2026 · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B09 · **Related:** BRD §11.7 (NFR-OBS-01…03), §11.3 (NFR-AVL-01…04), §12.2, FR-AUD-01, FR-LMS-10, FR-AI-10, §15; Development Plan §6.3 Track D, §8.2 (Operate), T-M1-D06; ADR 0002, ADR 0004, ADR 0005, ADR 0008, ADR 0010

## Context

- NFR-OBS-01: centralized structured logs, metrics and distributed traces with tenant correlation IDs and **no personal data in logs**. NFR-OBS-02: alerts on error rate, latency, queue depth, sync failures, message delivery failures and AI cost anomalies. NFR-OBS-03: public status page with incident history.
- SLAs up to 99.95–99.99 % (NFR-AVL-01) require detection within minutes.
- Sovereign deployments require all logs and telemetry to stay in-country (FR-DEP-03), so every component needs a self-hostable option.
- Two very different "logs" exist: the **tenant-facing audit log** (business record, FR-AUD-01) and **operational telemetry** (engineering). They must not be confused.

## Options considered

1. **Vendor-specific agents/SDKs** (one APM vendor end-to-end) — quick, but lock-in and often no in-country option.
2. **OpenTelemetry everywhere + pluggable backends** — vendor-neutral instrumentation (OTLP); backends chosen per deployment (managed EU backend for regional SaaS; self-hosted Grafana stack in-country).
3. **Platform logs only** (Vercel runtime logs, Supabase logs) — insufficient retention/correlation; not available self-hosted.

Error tracking: Sentry SaaS (EU data region available — verify) vs. self-hosted Sentry (heavy) vs. **GlitchTip** (open source, Sentry-SDK-compatible, lightweight — verify feature coverage of the Next.js SDK).

## Decision

Option 2: **OpenTelemetry for traces and metrics, structured JSON logs, Sentry-protocol error tracking**, all exported to backends that can run in-country.

### 1. Instrumentation
- Next.js `instrumentation.ts` registers the OTel Node SDK (`@vercel/otel` works outside Vercel — verify — or `@opentelemetry/sdk-node` directly) for `apps/suite`; the worker (ADR 0005) uses the same SDK. Auto-instrumentation: HTTP, fetch, `pg`; manual spans for `defineAction`, job tasks, event dispatch/delivery, provider adapters, LMS calls, AI calls.
- **Context propagation:** W3C `traceparent` across HTTP; into events via the CloudEvents `traceparent` extension (ADR 0004) and into job payloads, so a trace links "user approves enrollment → event → notification e-mail → LMS push".
- **Correlation ID:** the request proxy assigns `x-request-id` (or accepts it only from the trusted edge), stored in the request context, written to logs, audit events (`correlation_id`), events (`correlationid`) and RFC 9457 error bodies (ADR 0011).
- Common attributes: `service.name` (`suite-web`, `suite-worker`), `deployment.environment`, `service.version`, `jadarat.deployment` (e.g., `eu-saas-1`, `sa-gov-1`), `jadarat.tenant_id` (UUID), `jadarat.actor_type`.

### 2. Logs without personal data
- `pino` JSON logs to stdout; fields: `time, level, msg, service, env, deployment, trace_id, span_id, correlation_id, tenant_id, actor_type, actor_ref, action/task, duration_ms, outcome, error.code`.
- **Allowed identifiers:** tenant UUID, entity UUIDs, and `actor_ref` = keyed HMAC of the user/person id (per-deployment secret, rotated yearly) — enough to correlate one actor's requests without a direct identifier.
- **Forbidden:** names, e-mails, phone numbers, national IDs, IP addresses (except truncated /24 or /48 in security logs), request/response bodies, tokens, cookies, secrets, provider payloads, AI prompts/outputs. Enforced by: typed logger API (no free-form object logging of domain entities), `pino` redaction paths as a backstop, a lint rule against logging `input`/`body`/`user` objects, and a CI job that scans logs from E2E runs for PII patterns (e-mail, KSA/UAE/Egypt phone formats, 10-digit Saudi IDs/Iqama).
- Errors are logged with stable `error.code` and sanitized messages; PostgreSQL errors are mapped (constraint names, not values).

### 3. Metrics (RED/USE + domain)
| Area | Metrics |
|---|---|
| Web | request rate, error rate, latency p50/p95/p99 per route/action (NFR-PERF-02), LCP from real-user monitoring (NFR-PERF-01, sampled, no PII) |
| Database | connections by role, pool saturation, slow queries (`pg_stat_statements`), replication lag, disk |
| Jobs & events | runnable jobs by task, oldest runnable job age, failures, outbox lag (oldest undispatched event), dead-letter count (ADR 0004/0005) |
| Notifications | sends/failures per channel/provider, deferred count, provider latency (ADR 0008) |
| LMS | sync success rate (target ≥ 99.5 %, BRD §19.2), latency, retries, dead letters, connections auto-paused (FR-LMS-10) |
| Security | sign-in failures, lockouts, MFA challenges, 403/404 rates on authorization, rate-limit hits, malware detections, signature age of ClamAV |
| AI (R2) | tokens, cost per tenant/feature, budget utilisation (FR-AI-10) |

`tenant_id` is **not** a metric label on high-volume series (cardinality with ≥ 1,000 tenants); per-tenant drill-down uses traces/logs and low-volume business metrics only.

### 4. Error tracking
- Sentry SDK API in web and worker. Regional SaaS: Sentry SaaS in its EU region (PO to approve the vendor/sub-processor) — or GlitchTip if the PO prefers one stack. Sovereign: **GlitchTip** in-country. `sendDefaultPii: false`, `beforeSend` scrubbing (same rules as logs), no session replay, source maps uploaded privately.

### 5. Backends per deployment
| Signal | Regional SaaS (R1) | In-country / customer-hosted |
|---|---|---|
| Collection | OTel Collector (container on the worker host, ADR 0005) receiving OTLP from web (Vercel) and worker; Vercel log drain or direct OTLP export — verify plan features | OTel Collector in cluster |
| Traces / logs / metrics | Managed Grafana-compatible backend in the EU (Tempo/Loki/Prometheus-compatible; vendor chosen by PO) or self-hosted on the EU container host | Self-hosted Grafana, Tempo, Loki, Prometheus/Mimir |
| Errors | Sentry EU or GlitchTip | GlitchTip |
| Uptime & status page | External synthetic checks from ≥ 2 regions (e.g., Better Stack / Checkly — PO choice) + public status page | Gatus or Uptime Kuma in-country + customer-facing status page |
| Alert routing | Alertmanager/Grafana alerting → e-mail + chat + on-call phone for Sev-1 | Same, customer/ENTLAQA NOC per contract |

Retention defaults: logs 30 days, traces 14 days, metrics 13 months, errors 90 days — all in the deployment's jurisdiction.

### 6. Health endpoints and uptime
`/api/health/live` (process), `/api/health/ready` (DB, Storage, worker heartbeat freshness, ClamAV), not exposing versions or internals publicly. Synthetic journeys (sign-in page load, certificate verification page, check-in endpoint) every minute. Status page components: Web app, API, Notifications, LMS sync, File processing; incidents published with history (NFR-OBS-03).

### 7. Audit log vs operational logs
| | Audit log (`platform.audit_events`) | Operational telemetry |
|---|---|---|
| Purpose | Evidence of who did what (FR-AUD-01), tenant-visible, exportable | Engineering diagnosis |
| Content | Actor, impersonator, IP/device, before/after diff — may contain personal data, protected by RLS and permissions | No personal data (§2) |
| Store | PostgreSQL, append-only, same transaction as the change | Collector backends |
| Retention | Per contract/regulation (years) | Days/months (§5) |
| Access | Tenant Admin, Auditor, Compliance (Appendix B) | ENTLAQA engineers/on-call |

Rules: audit diffs are never written to telemetry; telemetry is never used as audit evidence; the correlation ID links both.

### 8. Alerts (initial SLO-based set, NFR-OBS-02)
5xx rate > 1 % for 5 min; p95 read latency > 500 ms / write > 800 ms for 10 min; oldest runnable job > 5 min; outbox lag > 2 min; dead letters > 0 (warning) / growing (page); notification failure rate > 5 % per provider; LMS auto-pause events; ClamAV signatures > 24 h old; sign-in failure spike; certificate-verification request spike (enumeration); DB connections > 80 %; backup/PITR failure; AI cost anomaly (R2). Runbooks linked from every alert (M7 deliverable).

## Consequences

**Positive:** vendor-neutral instrumentation; end-to-end traces across async boundaries; in-country parity; clear separation from the audit log.

**Negative / costs:** running a collector and (in-country) a Grafana stack is real ops work; strict no-PII logging makes some debugging slower (mitigated by correlation IDs and the audit log); HMAC actor refs need key management.

## Security impact
Telemetry is a data-leak channel; the no-PII rules, scrubbing, access control on backends (SSO + MFA), and in-jurisdiction storage address NFR-OBS-01 and privacy requirements (§12.2). Security metrics and alerts support incident response (NFR-SEC-10).

## Sovereign deployment impact
Every component (Collector, Grafana stack, GlitchTip, Gatus/Uptime Kuma, Alertmanager) is open source and self-hostable; nothing leaves the country.

## Suite impact
Shared logger, tracing helpers and metric conventions in `platform-core`/`platform-jobs`; new modules get dashboards and alerts by convention (`module` attribute).

## Verification
1. CI PII scan of E2E logs (gate); unit tests for redaction and HMAC refs.
2. Trace test: one E2E journey produces a single trace spanning web → outbox → worker → notification.
3. Alert rules tested with synthetic failures in staging (queue stall, provider failure).
4. Self-hosted stack (ADR 0010) ships the Collector + GlitchTip + Gatus in the compose file used for smoke tests (T-M1-D04/D06).

## Implementation notes (T-M1-D06 part a, 4 Oct 2026)
Runbook: [`docs/engineering/observability.md`](../engineering/observability.md).
- **§2 logger:** a small typed JSON-lines writer in `packages/platform-observability`. Instead of `pino`, the API is closed (fixed fields, no object logging) and every string is scrubbed. Same output format and redaction intent, one fewer dependency and no worker-thread transport inside the Next.js bundle. `pino` can replace the writer later without changing callers.
- **§4 error tracking:**
  - Server-side `@sentry/nextjs` is started from `instrumentation.ts` with a runtime `SENTRY_DSN`, errors only. The SDK's OpenTelemetry setup and runtime module patching are off, so traces keep their own OTel pipeline.
  - The reporter is registered on `globalThis`, because Next.js bundles instrumentation separately from route code.
  - The Sentry CLI (FSL licence, build-time only) is removed from the install with a pnpm override.
  - Exception messages are redacted by default (an allow-list keeps messages built from constants); a stable `error_code` (application code or SQLSTATE) is tagged instead. Console output, Next.js error lines included, goes through the same scrubbing.
  - Source maps are not uploaded yet, so stack frames are minified. Browser errors and GlitchTip come in part b.
- **§6 health:** `/api/health/live` and `/api/health/ready` (database as `app_server`; one probe in flight per instance, result reused 5 s, cancelled after 3 s).
- **Uptime:** a scheduled GitHub Actions check opens and closes an incident issue for staging. Production uptime from at least two regions, plus a status page, is still to be chosen (§5).
- **Verification 1:** the PII scan of app logs runs in the self-hosted smoke test (gate 15), after the real sign-in journeys.
