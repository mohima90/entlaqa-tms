# ADR 0011 — API style, versioning and error model

**Status:** Proposed · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B11 · **Related:** BRD §7 (FR-LMS-01…10), §9 (FR-INT-02, FR-INT-03, §9.2, §9.3), FR-CRT-04, FR-ATT-02, FR-AI-11, NFR-PERF-02, NFR-MNT-05, NFR-SEC-02/04/07, NFR-L10N-01; Development Plan §6.8 security focus, §8.3; TM-0001 F-05, F-12; ADR 0002 (§4, §6a), ADR 0003 (§2, §4, §7), ADR 0004, ADR 0005, ADR 0009

## Context

- The UI needs a fast, type-safe way to read and mutate data with one authorization path (`defineAction`, ADR 0003).
- External integrators need a stable, documented REST API (`/api/v1`, OpenAPI 3.1, OAuth 2.0 / API keys, cursor pagination, idempotency, rate limits, RFC 9457 errors — FR-INT-02, **R2**) and signed webhooks (FR-INT-03, R2).
- R1 already has public/unauthenticated endpoints (certificate verification page + verification API, FR-CRT-04; QR check-in, FR-ATT-02) and integration endpoints (LMS inbound webhooks and outbound calls, FR-LMS-07/10).
- Errors must be consistent between UI and API and localized (Arabic default).

## Options considered

1. **REST for everything, UI included** — one surface, but the UI loses type-safety and server components' direct data access; doubles work.
2. **tRPC/GraphQL internally + REST externally** — two schema systems; GraphQL adds query-cost and authorization complexity.
3. **Server components/actions internally, REST externally, zod as the single schema source** — chosen.

## Decision

### 1. Internal (UI) surface
- **Reads:** server components call module services directly (no internal HTTP hop), passing the request context; lists use `scopeFilter` (ADR 0003).
- **Mutations:** server actions created with `defineAction` only (zod input, permission, scope, AAL, audit, `withUserTx`). Server actions are public POST endpoints in practice: they are treated as an API (validation, authorization, rate limits on sensitive actions), never trusting hidden form fields.
- **Route handlers** (`defineRoute`) only where an HTTP contract is required: file/cron/health endpoints, provider and LMS webhooks, public endpoints (verification, check-in), OAuth token endpoint, and `/api/v1` (R2).
- Action results are serializable `Result<T, AppError>`; actions do not throw to the client for expected failures.

### 2. Schemas: zod as source of truth
- Input/output schemas (zod 4) live with the module; cross-module and public ones in `packages/contracts`. OpenAPI 3.1 is **generated** from zod (via `z.toJSONSchema()` / an OpenAPI generator compatible with zod 4 — verify library at implementation); event schemas are exported the same way (ADR 0004).
- Public JSON uses **snake_case** (consistent with BRD §7.7 samples); internal TypeScript uses camelCase; mapping happens in the API serializers only.
- CI publishes the generated spec as an artifact and runs a breaking-change diff (e.g., `oasdiff`) against the last released spec.

### 3. Error model (shared by UI and API)
`AppError` in `platform-core`: `code` (stable, SCREAMING_SNAKE, namespaced registry, e.g., `ENROLLMENT_CAPACITY_FULL`, `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `STEP_UP_REQUIRED`, `CONFLICT_VERSION`, `RATE_LIMITED`), `status`, `messageKey` (next-intl key), `params`, optional `fieldErrors[]`, `expose` flag.
- **UI:** the action returns the error; the client renders `messageKey` in the active locale and maps `fieldErrors` onto form fields. Unexpected errors become `INTERNAL_ERROR` with the correlation ID; no stack traces or SQL reach the client.
- **HTTP/API:** RFC 9457 `application/problem+json`:
```json
{ "type": "https://<api-docs-host>/problems/enrollment-capacity-full",
  "title": "المقاعد ممتلئة", "status": 409,
  "detail": "Session TMS-SAF-2026-014 has no remaining seats.",
  "instance": "/api/v1/enrollments", "code": "ENROLLMENT_CAPACITY_FULL",
  "errors": [{ "pointer": "/session_id", "code": "CAPACITY_FULL" }],
  "correlation_id": "01J…" }
```
`title`/`detail` localized via `Accept-Language` (default `ar`); clients must rely on `code`, not text. Status usage: 400 malformed, 401 unauthenticated, 403 missing permission, **404 out of scope or other tenant** (ADR 0003, no existence leak), 409 state/version conflict, 412 `If-Match` failure, 422 validation, 429 rate limit (`Retry-After`), 5xx server.

### 4. Public REST API `/api/v1` (R2; conventions apply to any R1 public endpoint)
- **Resources:** plural kebab-case per BRD §9.2 (`/sessions`, `/session-days`, `/enrollments`, …); IDs are UUIDs; timestamps RFC 3339 UTC; money `{ "amount": "1250.000", "currency": "KWD" }` (string decimal).
- **Authentication:** OAuth 2.0 **client credentials** (token endpoint `/api/oauth/token`, short-lived JWT access tokens ≤ 15 min signed with our keys, audience `api`) and **scoped API keys** (`jdr_<env>_<prefix>_<secret>`, shown once, stored hashed with the prefix for lookup, expiry, rotation, last-used, optional IP allow-list). Authorization code + PKCE for user-delegated apps and MCP follows in R2/R3 (ADR 0012). Each client belongs to one tenant, maps to a permission subset (scopes = permission codes, ADR 0003) and acts as actor type `integration`. Database access uses a third claim kind (`role: 'integration'`, `tenant_id`, `client_id`, `token_id`) that `private.current_tenant_id()` must validate against an active, unexpired `platform.api_client_tokens` row — **this requires extending ADR 0002 §6a before R2** (today it accepts only user claims under `app_server` and system claims under `app_worker`). Bearer tokens only — never cookies — so CSRF does not apply.
- **Pagination:** cursor-based: `?limit=` (default 50, max 200), `?cursor=` (opaque, base64url of the sort key + id, validated); response `{ "data": [...], "next_cursor": "…", "has_more": true }`.
- **Filtering/sorting/fields:** `filter[status]=confirmed`, `filter[starts_at][gte]=…`, `updated_since=` for sync; `sort=-starts_at,code` on an allow-list; sparse fields `fields=id,code,status`. Unknown parameters → 400.
- **Concurrency:** `ETag` = row `version`; `If-Match` required on `PATCH`/`DELETE` of mutable resources.
- **Idempotency:** `Idempotency-Key` header (IETF httpapi draft) required on `POST`, optional on `PATCH`; stored in `platform.idempotency_keys` (tenant, client, key, request hash, status, response) for 24 h; same key + different body → 422; in-flight duplicate → 409.
- **Rate limits:** token bucket per tenant + client (edition-based quotas) and per IP for unauthenticated endpoints, stored in PostgreSQL (unlogged bucket table via a `private` function; a Valkey adapter may be added later) — no Vercel-only firewall dependency. Responses include `Retry-After` on 429 and `RateLimit`/`RateLimit-Policy` headers (IETF draft, verify version).
- **Bulk:** asynchronous jobs (`POST /api/v1/imports` → `202` + job resource) backed by `platform.bulk_jobs` (ADR 0005).
- **Documentation:** interactive docs generated from the spec; sandbox tenants (R2).

### 5. Versioning and deprecation
- Major version in the path (`/api/v1`). Additive changes (new resources, optional fields, new enum values that clients must tolerate) do not bump the version; clients must ignore unknown fields.
- Breaking changes ship as `/api/v2` running in parallel; deprecations announced **≥ 6 months** ahead (NFR-MNT-05) with `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) headers, changelog entries and tenant-admin notifications listing affected clients.
- Event and webhook payload versions follow ADR 0004 (`dataschema` major version).

### 6. Webhooks (outbound, R2)
- Subscriptions per tenant and event type (§9.3 catalog). Payload: CloudEvents 1.0 structured JSON (ADR 0004) built with public serializers.
- **Signatures** following the Standard Webhooks convention: headers `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64(HMAC-SHA256(secret, id.timestamp.body))>`; receivers reject timestamps outside ±5 min; secret rotation with overlapping secrets (multiple signatures during rotation); secrets encrypted at rest and never shown after creation (NFR-SEC-04).
- **Delivery:** `platform.webhook_deliveries` per attempt; retries with exponential backoff up to 24 h (FR-INT-03), 2xx = success, 410 = auto-unsubscribe, repeated failure for 3 days → endpoint disabled + tenant admin notified; delivery log with truncated request/response (redacted); manual **replay** and **test send**; consumers deduplicate by `webhook-id` (= event id).
- **SSRF protections** (also for LMS instance URLs and any tenant-supplied URL, R1), implemented once as `safeFetch` in the integration platform package (TM-0001 F-12 proposes `platform-integration` in ADR 0001) and used by every outbound call to tenant-configured URLs: HTTPS only (except local dev); DNS resolved by us and the connection pinned to the resolved IP; block loopback, private (RFC 1918), link-local/metadata (169.254.0.0/16), CGNAT (100.64.0.0/10), unique-local/link-local IPv6 and our own ingress ranges; no redirects followed; connect/total timeouts (5 s/10 s); response size cap; egress through a proxy with allow-listing in sovereign deployments.

### 7. Inbound integration endpoints (R1)
LMS webhooks at `/api/hooks/lms/<connection_id>`: the web tier holds no connector secrets and has no tenant claims for these requests, so it only applies body-size and per-connection rate limits and stores the raw request through a narrow `private` function into an infrastructure inbox (`platform.inbound_webhook_inbox`, no tenant access, 7-day retention), returning `202` immediately. A worker job (system claims for the connection's tenant) verifies signature + timestamp per connector with the secret from `platform.tenant_secrets`, discards invalid requests (metric + alert on spikes), deduplicates on the LMS event id into `tms.lms_inbound_events` and continues asynchronously (ADR 0004). Provider status webhooks (ADR 0008) follow the same pattern.

### 8. Public unauthenticated endpoints (R1)
Certificate verification (page and `GET /api/v1/certificates/verify/{code}`) and check-in: high-entropy codes/tokens only (no sequential identifiers), minimal data (holder name as printed, course, dates, status), per-IP rate limits and the self-hostable proof-of-work challenge of ADR 0003 §2 (TM-0001 F-05) after repeated requests, uniform responses for unknown codes, audit/metrics for enumeration spikes (Plan §6.7). Certificate verification reads through a narrow `private.verify_certificate(tenant_id, code)` function (tenant from the verified host, ADR 0002 §4), because anonymous requests carry no tenant claims. Sign-in, OTP and invitation flows are server actions (ADR 0003 §2), so the same limiter applies before Supabase Auth is called.

## Consequences

**Positive:** one authorization path; types flow from zod to UI, API docs and events; consistent localized errors; R2 API builds on conventions already exercised by R1 public endpoints.

**Negative / costs:** OpenAPI generation from zod must be kept in sync; server actions are not usable by external clients (by design); PostgreSQL-backed rate limiting adds writes on limited endpoints.

## Security impact
Addresses Plan §8.3 "Broken authorization", "Webhooks & connectors" and "Public endpoints": deny-by-default routes, 404 for out-of-scope, idempotency and replay protection, HMAC with timestamps, SSRF defenses, hashed API keys, short-lived tokens, rate limits.

## Sovereign deployment impact
No external API gateway or vendor rate limiter required; token issuance, rate limiting and webhook delivery run in-app and in PostgreSQL.

## Suite impact
All modules expose resources under the same `/api/v1` conventions (namespaced paths when needed, e.g., `/api/v1/core-hr/employees`) and share the error-code registry, auth and webhook machinery.

## Verification
1. Lint/test gate: every route handler uses `defineRoute`; every action `defineAction` (ADR 0003).
2. Contract tests: generated OpenAPI valid 3.1; breaking-change diff gate; problem+json shape tests; localized titles in `ar`/`en`.
3. Security tests: SSRF block list (incl. DNS-rebinding and redirect cases); webhook signature verification incl. old timestamps; idempotency replay; 429 behavior; verification-endpoint enumeration test.
4. E2E J13: cross-tenant access on every API group → 403/404.
