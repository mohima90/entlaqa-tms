# ADR 0002 — Multi-tenancy, tenant resolution and row-level security

**Status:** Proposed · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B02 · **Related:** BRD §5 (v1 tenancy), §10.3 DR-1, §12, §15, Appendix H.3; NFR-SEC-02; Development Plan Q2 (tenant isolation), §8.3; ADR 0001, ADR 0003

## Context

- Jadarat TMS is multi-tenant SaaS (many customer organizations on shared infrastructure) and must also run as dedicated single-tenant and in-country deployments (FR-DEP-01…04) from the same code.
- Cross-tenant data exposure is the most severe failure possible (Development Plan Q2: Sev-1 incident).
- One person can legitimately belong to more than one tenant (external instructors, provider staff, consultants, ENTLAQA staff), and email identities in Supabase Auth are global.
- Server code needs multi-statement transactions (e.g., write a business row and its outbox event atomically — ADR 0004), which the PostgREST Data API does not provide.

## Options considered

| Option | Isolation | Ops cost | Fit |
|---|---|---|---|
| A. Database per tenant | Strongest | Very high (thousands of DBs, migrations × N) | Only for sovereign/dedicated deals |
| B. Schema per tenant | Strong | High (migrations × N, catalog bloat) | Poor at SME scale |
| C. **Shared schema + `tenant_id` + RLS** | Strong if enforced mechanically | Low | Good; same model works for dedicated deployments (one tenant) |

## Decision

### 1. Model
**Shared database, shared schemas, `tenant_id` on every tenant-owned row, enforced by PostgreSQL row-level security (RLS)** — option C. Dedicated and in-country deployments use the same model with one (or few) tenants.

### 2. Core tables (schema `platform`)
- `platform.tenants` — id, slug, status (`trial|active|suspended|cancelled`), plan/edition, data-residency label.
- `platform.tenant_domains` — tenant_id, hostname, kind (`subdomain|custom`), verified_at.
- `platform.persons` — tenant-scoped person record (the shared people directory, FR-STE-02); may exist without a login.
- `platform.tenant_memberships` — user_id (→ `auth.users`), tenant_id, person_id, status (`invited|active|suspended|revoked`).
- `platform.user_session_context` — user_id, active_tenant_id (which tenant the user is currently acting in).

### 3. Tenant claim in the JWT
- A **Supabase Custom Access Token Hook** (PostgreSQL function, owned by a restricted role, `EXECUTE` granted only to `supabase_auth_admin`) adds claims when a token is issued or refreshed:
  - `tenant_id` — the user's active tenant, **only if** the membership is `active` and the tenant is `active` or `trial`;
  - `person_id` — the person record for that tenant.
- If there is no valid active membership, no `tenant_id` claim is issued; all tenant RLS policies then deny access.
- Switching tenant: a server action verifies membership, updates `user_session_context`, and refreshes the session so a new token with the new claim is issued.
- The hook is part of the self-hosted stack configuration as well (verify GoTrue hook configuration in T-M1-D04).

### 4. Tenant resolution per request (defense against cross-host session use)
1. The Next.js request proxy (formerly "middleware") resolves the **host** to a tenant via `platform.tenant_domains` (verified domains only) through a narrow lookup function returning only tenant id, slug, status and public branding; results are cached briefly in memory.
2. The session's `tenant_id` claim **must equal** the host tenant. If not: when the user is an active member of the host tenant, the active tenant is switched (step 3); otherwise the request is rejected and the user is sent to sign-in for that tenant.
3. Tenant ID is **never** taken from request bodies, query strings, headers set by the client, or local storage.

### 5. Data access path (how RLS is applied from server code)
- Tenant data is read and written **only by server code** (server components, server actions, route handlers, jobs). The browser does not query tenant tables through the Data API (ADR 0003).
- Server code connects to PostgreSQL directly through the connection pooler (transaction mode) as a dedicated login role **`app_server`** that is a member of `authenticated`, has **no `BYPASSRLS`**, and owns no tables.
- Every unit of work runs in a transaction opened by `platform-db`'s `withUserTx(verifiedClaims, fn)`:
  ```sql
  begin;
  set local role authenticated;
  select set_config('request.jwt.claims', $1, true);  -- $1 = claims from a server-verified JWT only
  -- … queries …
  commit;
  ```
  so RLS evaluates exactly as it would for the signed-in user. Claims are only ever produced from a JWT whose signature was verified server-side (ADR 0003).
- Query building: **Drizzle ORM** as a typed query builder over this connection (schema types generated from the database). **Migrations stay in SQL** (`supabase/migrations`) because RLS policies, grants and functions are first-class.
- Supabase client libraries remain in use for **Auth, Storage and Realtime**.
- Tenant schemas (`platform`, `tms`, …) are **not exposed** through the Data API; only schemas explicitly designed for it (none in R1) may be.

### 6. RLS pattern (every tenant-owned table)
```sql
-- helper: private schema is not exposed through the API
create or replace function private.current_tenant_id()
returns uuid language sql stable set search_path = ''
as $$ select nullif((select auth.jwt()) ->> 'tenant_id', '')::uuid $$;

create table tms.sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id()
            references platform.tenants(id),
  -- … columns …
  unique (tenant_id, id)                       -- enables composite FKs
);
create index on tms.sessions (tenant_id);

alter table tms.sessions enable row level security;
alter table tms.sessions force row level security;

-- RESTRICTIVE: ANDed with every other policy, so no permissive policy can ever widen access across tenants
create policy tenant_isolation on tms.sessions
  as restrictive for all to authenticated
  using      (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));

-- PERMISSIVE policies then grant access within the tenant (ownership / scope rules where applicable)
create policy sessions_read on tms.sessions for select to authenticated using (true);
```
Rules:
- **Composite foreign keys** `(tenant_id, parent_id) → parent(tenant_id, id)` for every reference between tenant-owned tables, so a row can never point to another tenant's row.
- No grants to `anon` on tenant tables. Grants to `authenticated` are explicit per table and operation.
- `(select …)` wrapping of helper calls so they are evaluated once per statement (performance).
- `security definer` functions are avoided; when unavoidable they live in `private`, set `search_path = ''`, check tenant explicitly, and are reviewed as security-relevant.
- `platform.tenants` itself: policy `id = current_tenant_id()`.

### 7. Background jobs and platform operations
- Tenant-scoped jobs run with the same `withUserTx` mechanism using a **system actor claim set** for the job's tenant (`tenant_id`, `role: 'system'`, actor id) so RLS still applies; each job records its tenant and actor in the audit log.
- The **service-role key / `BYPASSRLS`** is reserved for platform-level operations that are genuinely cross-tenant (migrations, tenant provisioning, platform console aggregates). It lives only in `packages/platform-db/admin` (ADR 0001 rule), is never available to request-path code, and every use is audited.

### 8. Storage and Realtime
- Storage object keys start with the tenant ID: `<tenant_id>/<module>/<entity>/<id>/<file>`; storage policies on `storage.objects` require `(storage.foldername(name))[1] = private.current_tenant_id()::text`. Buckets are private; downloads use short-lived signed URLs generated server-side (ADR 0006).
- Realtime uses private channels authorized by RLS (Realtime Authorization) with tenant-prefixed topic names; verify exact configuration at implementation.

### 9. Tenant lifecycle
Provisioning (platform console / sign-up) creates tenant, domain, default roles and the first admin membership in one transaction. Suspension removes the `tenant_id` claim at next token refresh (short access-token lifetime, ADR 0003) and blocks requests immediately via the host-resolution status check. Export and deletion follow FR-AUD-02/03/04.

## Consequences

**Positive:** single schema to migrate; strong, testable isolation at the database layer; identical model for SaaS, dedicated and in-country deployments; transactions available to server code; minimal public API surface.

**Negative / costs:** every table needs RLS, policies, composite keys and tests (automated below); the direct-connection + `set local` pattern must be implemented carefully in `platform-db`; the access-token hook adds a dependency to test in self-hosted setups.

## Security impact
This ADR is the primary control for Development Plan Q2. Residual risks: mistakes in policies (mitigated by restrictive tenant policy + automated tests), misuse of the admin client (mitigated by import rules + audit), forged claims (mitigated: claims only from verified JWTs).

## Sovereign deployment impact
Works identically on self-hosted Supabase/PostgreSQL; the pooler and access-token hook must be part of the in-country stack (ADR 0010).

## Suite impact
All suite modules follow the same pattern; `platform.persons` and memberships are shared by every module.

## Verification (CI gates)
1. **Catalog check:** a SQL test fails if any table in `platform`, `tms` (and future module schemas) lacks `ENABLE`/`FORCE ROW LEVEL SECURITY` or the restrictive `tenant_isolation` policy (explicit allow-list for global tables such as reference data).
2. **Isolation tests (pgTAP):** for every table, as a tenant-A user: cannot read, insert, update or delete tenant-B rows; cannot insert a row with tenant-B `tenant_id`; cannot reference a tenant-B parent via FK.
3. **No-claim test:** a token without `tenant_id` reads zero rows from every tenant table.
4. **Import rule:** no request-path code imports the admin client (ADR 0001).
5. **E2E (J13):** cross-tenant access attempts on every API group return 403/404.
