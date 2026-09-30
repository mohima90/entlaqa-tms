# Secure Coding Standard — Jadarat Platform & TMS

| | |
|---|---|
| **Backlog** | T-M1-C05 |
| **Version** | 0.1 — 30 Sep 2026 |
| **Owner** | Security Lead (Claude agent) · approved by Tech Lead and PO |
| **Applies to** | All code in `apps/`, `packages/`, `modules/`, `supabase/`, `infra/` and CI workflows — written by people or Claude agents |
| **Related** | [TM-0001](threat-models/TM-0001-platform.md) · [ASVS L2 mapping](asvs-l2-mapping.md) · ADR 0001 (monorepo), 0002 (tenancy/RLS/data path), 0003 (authN/authZ) · Development Plan §4.2 (DoD), §5.3 (CI gates), §8 |

**Keywords.** **MUST** / **MUST NOT** are mandatory; a PR that violates them is not mergeable. **SHOULD** needs a written reason in the PR if not followed. Where a rule depends on a product detail not yet proven in our stack it says *verify at implementation*; the first PR that implements it records the result here.

**Exceptions.** Only via a PR comment approved by the security-review pass, recorded in `docs/security/reviews/` with an expiry date. "The test was flaky" or "the gate was noisy" is never an exception (CLAUDE.md, Plan §1).

Package names below use the `@jadarat/` scope and the helpers named in ADR 0002/0003 (`getRequestContext`, `defineAction`, `defineRoute`, `scopeFilter`, `withUserTx`); signatures are indicative until the scaffold (T-M1-D01) lands.

---

## Contents

1. TypeScript and project hygiene
2. Request context and tenant resolution
3. Server actions, route handlers and server components
4. Input validation (Zod) and MENA-specific normalization
5. Data access, PostgreSQL and RLS
6. Output encoding and XSS
7. Security headers and CSP with nonces
8. Cookies, CSRF and origin checks
9. Authentication and session use
10. File handling
11. Outbound requests and SSRF
12. Webhooks and signed tokens (QR, approval links)
13. Cryptography and field-level encryption
14. Secrets and configuration
15. Logging, audit and error handling
16. Rate limiting and anti-automation
17. Caching
18. Background jobs, events and privileged access
19. AI prompt handling (R2+)
20. Dependencies and supply chain
21. PR security checklist
Appendix A — Mechanical enforcement

---

## SCS-1 TypeScript and project hygiene

- **MUST** compile with `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` (from `packages/config` base tsconfig). No `// @ts-ignore`; `// @ts-expect-error` only with a reason.
- **MUST NOT** use `any` for data that crosses a trust boundary (request input, DB rows returned to clients, webhook payloads, AI output). Use `unknown` and parse.
- **MUST** start every server-only module (DB access, secrets, crypto, admin) with `import 'server-only';` so an accidental client import fails the build.
- **MUST NOT** use `eval`, `new Function`, `vm`, dynamic `require`/`import()` of user-controlled paths, or `child_process` with user input.
- **MUST NOT** deep-merge untrusted objects into configuration/state (prototype pollution); reject `__proto__`, `constructor`, `prototype` keys (Zod `strictObject` does this for known shapes).
- **SHOULD** keep module-scope state immutable: serverless and container instances are reused across requests and tenants.

## SCS-2 Request context and tenant resolution

The tenant **always** comes from the verified JWT claim, cross-checked with the host (ADR 0002 §4). It never comes from a body, query string, client header, cookie other than the session, or local storage.

```ts
// packages/platform-identity/src/server/request-context.ts
import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { createServerAuthClient } from './supabase-server';
import { resolveTenantByHost } from './tenant-resolution';
import { toVerifiedClaims } from '@jadarat/platform-db';
import { NotFound, Unauthenticated, TenantMismatch } from '@jadarat/platform-core/errors';

// React cache() = memoized per request only (never across requests).
export const getRequestContext = cache(async () => {
  const h = await headers();                                   // async in Next.js 15+
  const tenant = await resolveTenantByHost(h.get('host'));      // verified domains only; public fields only
  if (!tenant || tenant.status === 'suspended') throw new NotFound();

  const supabase = await createServerAuthClient();
  const { data, error } = await supabase.auth.getClaims();      // verifies signature (asymmetric keys) + expiry
  if (error || !data?.claims) throw new Unauthenticated();

  if (data.claims.tenant_id !== tenant.id) {
    throw new TenantMismatch();                                 // logged as a security event (SCS-15)
  }
  return { tenant, claims: toVerifiedClaims(data.claims) };     // branded type, see SCS-5.2
});
```

- **MUST** call `getRequestContext()` (directly or via `defineAction`/`defineRoute`) in every server component, action and route that touches tenant data. The request proxy refreshes sessions but **MUST NOT** be the only place a check happens (the proxy/middleware layer has had bypass CVEs, e.g., CVE-2025-29927).
- **MUST** trust `Host`/`X-Forwarded-Host` only as configured for the edge (Vercel, or the sovereign ingress that overwrites these headers). Self-hosted ingress **MUST** drop client-supplied `X-Forwarded-*`.
- **DON'T**
  ```ts
  const tenantId = formData.get('tenantId');          // client-controlled
  const tenantId = request.headers.get('x-tenant-id'); // client-controlled
  const tenantId = searchParams.tenant;                // client-controlled
  ```

## SCS-3 Server actions, route handlers and server components

Server actions are **public HTTP endpoints** (anyone can POST to them with the action ID), whether or not the UI shows the button.

- **MUST** declare every server action with `defineAction` and every mutating route handler with `defineRoute` (ADR 0003 §4). CI fails otherwise (Appendix A).
- **MUST** declare a permission, a Zod input schema and — for anything addressing a specific record — a `resource` resolver so scope is checked. Out-of-scope or other-tenant → 404; missing permission → 403.
- **MUST** return DTOs (explicit field lists), never raw rows, never objects containing C4 fields the caller may not see (TM T-35).
- **MUST NOT** export helper functions from `'use server'` files (every export becomes an endpoint).

**DO**

```ts
// modules/tms/src/sessions/actions.ts
'use server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { defineAction } from '@jadarat/platform-rbac/server';
import { sessions } from '../db/schema';

const RenameSessionInput = z.strictObject({
  sessionId: z.uuid(),
  titleAr: z.string().trim().min(1).max(200),
  titleEn: z.string().trim().min(1).max(200),
});

export const renameSession = defineAction({
  permission: 'tms.session.update',
  input: RenameSessionInput,
  resource: (input) => ({ type: 'tms.session', id: input.sessionId }),
  audit: 'tms.session.renamed',
  handler: async ({ ctx, input }) => {
    // ctx.tx is a withUserTx transaction: RLS applies as the signed-in user
    const [row] = await ctx.tx
      .update(sessions)
      .set({ titleAr: input.titleAr, titleEn: input.titleEn, updatedBy: ctx.personId })
      .where(eq(sessions.id, input.sessionId))
      .returning({ id: sessions.id, titleAr: sessions.titleAr, titleEn: sessions.titleEn });
    if (!row) return ctx.notFound();
    return row;                                   // DTO only
  },
});
```

**DON'T**

```ts
'use server';
import { createClient } from '@supabase/supabase-js';
export async function renameSession(data: any) {                        // no authz, no validation
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!);   // bypasses RLS in a request path
  await admin.from('sessions').update(data).eq('id', data.id);          // mass assignment, any tenant
}
```

- Server components that read data **MUST** use the same services as actions (which call `scopeFilter` / `withUserTx`); they **MUST NOT** pass whole records to client components — serialize only fields the UI needs.
- **MUST** keep state-changing work out of GET handlers and out of rendering (link scanners and prefetching trigger GETs).

## SCS-4 Input validation (Zod) and MENA-specific normalization

- **MUST** validate every boundary input with Zod before use: server-action arguments, route bodies/queries/params, webhook payloads, import rows, job payloads, AI tool arguments, environment variables.
- **MUST** use `z.strictObject` (unknown keys rejected) for inputs; **MUST NOT** spread input into inserts/updates (`.values({...input})`) — map fields explicitly (mass assignment, TM T-17).
- **MUST** bound every string (`.max()`), array (`.max()`), number (`.int().min().max()`) and page size.
- **SHOULD** use shared validators from `@jadarat/platform-core/validation`:

```ts
import { z } from 'zod';

// Arabic-Indic (U+0660–0669) and Extended/Persian (U+06F0–06F9) digits → ASCII before numeric checks
export const normalizeDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
   .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

// Bidi override/isolate controls enable filename and display spoofing; RLM/LRM (U+200E/U+200F) stay allowed in text
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;

export const safeText = (max: number) =>
  z.string().transform((s) => s.normalize('NFC').replace(BIDI_CONTROLS, '').trim()).pipe(z.string().min(1).max(max));

export const tenantSlug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/); // ASCII only: no homoglyphs
export const phoneE164 = z.string().transform(normalizeDigits).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/));

// Saudi national ID / Iqama: 10 digits starting 1 (citizen) or 2 (resident); checksum per issuer algorithm — verify at implementation
export const saudiNationalId = z.string().transform(normalizeDigits).pipe(z.string().regex(/^[12]\d{9}$/));
```

- **MUST** treat client-side validation as UX only.
- **MUST** validate URLs with `new URL()` and an explicit scheme allow-list (`https:` for integrations; `https:`/`mailto:` for user links). `javascript:`, `data:`, `vbscript:` are rejected.

## SCS-5 Data access, PostgreSQL and RLS

### 5.1 Rules

- **MUST** access tenant data only through `withUserTx` (user requests) or `withSystemTx` (jobs) from `@jadarat/platform-db`. The raw Drizzle/driver instance is **not exported** from the package.
- **MUST NOT** use the Supabase Data API (PostgREST/GraphQL) for tenant data; `platform`, `tms` and future module schemas are not exposed (ADR 0002 §5). The Supabase JS client is used only for Auth, Storage and Realtime.
- **MUST NOT** import `@jadarat/platform-db/admin` outside `**/jobs/**` and `**/admin/**` (ADR 0001; dependency-cruiser gate).
- **MUST** use Drizzle query builders or the `sql` tagged template (parameterized). `sql.raw()` only in reviewed helpers with allow-listed identifiers.

### 5.2 Setting the RLS context (only in `platform-db`)

```ts
// packages/platform-db/src/tx.ts
import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Tx } from './internal/client';   // postgres.js via pooler (transaction mode), prepare: false

declare const brand: unique symbol;
export type VerifiedClaims = Readonly<{
  sub: string; session_id: string; tenant_id: string; person_id: string;
  role: 'authenticated'; aal: 'aal1' | 'aal2'; exp: number;
}> & { readonly [brand]: 'VerifiedClaims' };

// Only called by platform-identity after getClaims()/getUser() succeeded.
export function toVerifiedClaims(c: Record<string, unknown>): VerifiedClaims { /* Zod-parse allow-listed keys */ }

export function withUserTx<T>(claims: VerifiedClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const payload = JSON.stringify({
    sub: claims.sub, session_id: claims.session_id, tenant_id: claims.tenant_id,
    person_id: claims.person_id, role: 'authenticated', aal: claims.aal, exp: claims.exp,
  });
  return db.transaction(async (tx) => {                       // rolls back on throw
    await tx.execute(sql`set local role authenticated`);
    await tx.execute(sql`select set_config('request.jwt.claims', ${payload}, true)`); // bound parameter; local to tx
    return fn(tx);
  });
}
```

- **MUST** use `set local` / `set_config(…, true)` only. **MUST NOT** issue session-level `SET ROLE`, `set_config(…, false)` or legacy `request.jwt.claim.*` keys — on a transaction-mode pooler they would leak to the next client of that server connection (TM T-16).
- **MUST NOT** reference `request.jwt.claims` or `set_config` anywhere except `platform-db` (Semgrep rule).
- The `app_server` login role is a member of `authenticated`, has no `BYPASSRLS`, owns no tables and **SHOULD** be `NOINHERIT` so a query outside `withUserTx` fails with "permission denied" instead of silently running (created by infrastructure scripts, not by migrations, because it has a password).

### 5.3 Table template (every tenant-owned table)

Migration file name: `YYYYMMDDHHMMSS_<schema>__<description>.sql` (ADR 0001).

```sql
create table tms.session_days (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default private.current_tenant_id() references platform.tenants (id),
  session_id  uuid not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  -- composite FK: a day can never point to another tenant's session
  foreign key (tenant_id, session_id) references tms.sessions (tenant_id, id) on delete cascade,
  check (ends_at > starts_at)
);
create index on tms.session_days (tenant_id, session_id);

comment on column tms.session_days.starts_at is 'class:C2';   -- data classification (TM-0001 §2)

alter table tms.session_days enable row level security;
alter table tms.session_days force row level security;

revoke all on tms.session_days from public, anon;
grant select, insert, update, delete on tms.session_days to authenticated;

create policy tenant_isolation on tms.session_days
  as restrictive for all to authenticated
  using      (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));

-- permissive policy: grants access inside the tenant; fine-grained rules live in defineAction/scopeFilter
create policy session_days_rw on tms.session_days
  for all to authenticated using (true) with check (true);
```

Ownership rules that are cheap and stable **SHOULD** also be expressed in RLS (defense in depth), e.g. learners reading only their own check-ins:

```sql
create policy checkins_learner_own on tms.checkins
  for select to authenticated
  using (person_id = (select private.current_person_id())
         or (select private.has_tenant_staff_access()));   -- private helper, stable, reviewed
```

### 5.4 DON'T in SQL

```sql
-- ❌ policy without WITH CHECK: lets a user write rows into another tenant
create policy p on tms.x for all to authenticated using (tenant_id = private.current_tenant_id());

-- ❌ authorization from user-editable metadata (users can change user_metadata themselves)
using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin')

-- ❌ view that bypasses RLS (views run as their owner unless security_invoker is set)
create view tms.v_sessions as select * from tms.sessions;

-- ❌ security definer in an exposed schema, mutable search_path, no tenant filter
create function public.all_sessions() returns setof tms.sessions language sql security definer
as $$ select * from tms.sessions $$;
```

**DO**

```sql
create view tms.v_session_summary with (security_invoker = true) as
  select s.tenant_id, s.id, s.title_ar, s.title_en, count(d.id) as days
  from tms.sessions s left join tms.session_days d on d.tenant_id = s.tenant_id and d.session_id = s.id
  group by s.tenant_id, s.id;

-- unavoidable definer: private schema, empty search_path, explicit tenant filter, minimal columns, reviewed
create function private.certificate_public_status(p_tenant_id uuid, p_code text)
returns table (status text, holder_display text, course_title_ar text, course_title_en text, issued_on date)
language sql stable security definer set search_path = ''
as $$
  select c.status, c.holder_display_name, c.course_title_ar, c.course_title_en, c.issued_on
  from tms.certificates c
  where c.tenant_id = p_tenant_id                                          -- tenant from host resolution
    and c.verification_code_hash = extensions.digest(p_code, 'sha256')    -- random code, not the sequential number
$$;
revoke all on function private.certificate_public_status(uuid, text) from public, anon, authenticated;
grant execute on function private.certificate_public_status(uuid, text) to app_server;  -- NOINHERIT role: callable without SET ROLE
```

(The public verification route calls this outside `withUserTx`, with rate limiting and the tenant resolved from the host; it is the only object `app_server` can use without switching role. The `digest` function's schema depends on where `pgcrypto` is installed — verify.)

### 5.5 Other database rules

- **MUST** add `statement_timeout` for `authenticated` (and `app_server`) appropriate to OLTP (e.g., 8 s) and use jobs for longer work.
- **MUST** make audit tables append-only: insert via a `private` function; no `update`/`delete` grants; a trigger raising on update/delete.
- **MUST NOT** create materialized views over tenant data in exposed schemas (no RLS on materialized views).
- **MUST** keep migrations reviewable and reversible per the migration conventions (Plan §5.3 gate 4); security-relevant objects (policies, grants, functions, roles) need the security-review pass.
- The Custom Access Token Hook: `EXECUTE` only to `supabase_auth_admin`, revoked from `public, anon, authenticated`; `set search_path = ''`; reads only memberships/session context through explicit grants/policies for `supabase_auth_admin`; never reads `raw_user_meta_data`; re-validates membership and tenant status on every issuance (TM T-50).

### 5.6 RLS tests (pgTAP, CI gate 5)

Every new table ships with isolation tests; CI also runs a catalog check that every table in module schemas has RLS enabled + forced and a restrictive `tenant_isolation` policy.

```sql
-- supabase/tests/tms/session_days_isolation.test.sql
begin;
select plan(4);

-- act as a user of tenant A (fixture ids from supabase/tests/fixtures)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated","aal":"aal1",
    "tenant_id":"00000000-0000-0000-0000-0000000000aa","session_id":"00000000-0000-0000-0000-00000000a5e1"}', true);

select is_empty($$ select 1 from tms.session_days where tenant_id = '00000000-0000-0000-0000-0000000000bb' $$,
  'tenant A cannot read tenant B days');

select throws_ok($$ insert into tms.session_days (tenant_id, session_id, starts_at, ends_at)
  values ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-00000000b501', now(), now() + interval '1 hour') $$,
  '42501', null, 'tenant A cannot insert a tenant B row');

select throws_ok($$ insert into tms.session_days (session_id, starts_at, ends_at)
  values ('00000000-0000-0000-0000-00000000b501', now(), now() + interval '1 hour') $$,
  '23503', null, 'tenant A cannot reference a tenant B session (composite FK)');

select results_eq($$ select count(*) from tms.session_days d
  join tms.sessions s on s.tenant_id = d.tenant_id and s.id = d.session_id $$,
  $$ select count(*) from tms.session_days $$, 'joins stay inside the tenant');

select * from finish();
rollback;
```

A **no-claim** test (claims without `tenant_id`) must read zero rows from every tenant table (ADR 0002 verification 3).

### 5.7 Storage and Realtime policies

```sql
-- Storage (ADR 0006 §4): tenant prefix is necessary but not sufficient (TM T-34, F-13).
-- can_read_object = platform.files row is 'clean', not deleted, and a <= 5-min download grant
-- for auth.uid() exists (inserted by the defineAction that authorized the download).
create policy tenant_objects_read on storage.objects for select to authenticated
using (
  (storage.foldername(name))[1] = (select private.current_tenant_id())::text
  and private.can_read_object(bucket_id, name)       -- private, security definer, search_path '', reviewed
);
-- no UPDATE/DELETE policies for authenticated; moves/purges run in jobs through the Storage API

-- Realtime Authorization (private channels); topic convention tenant:<tenant_id>:<resource>:<id>
create policy tenant_topics_receive on realtime.messages for select to authenticated
using (
  split_part((select realtime.topic()), ':', 1) = 'tenant'
  and split_part((select realtime.topic()), ':', 2) = (select private.current_tenant_id())::text
  and (select private.can_subscribe((select realtime.topic())))   -- permission/ownership per resource
);
```

Verify `realtime.topic()` and storage helper behaviour against the Supabase version in use (cloud and self-hosted). Broadcast **minimal** payloads (IDs and event type); clients refetch through server code.

## SCS-6 Output encoding and XSS

1. **MUST** rely on React's escaping for text. **MUST NOT** use `dangerouslySetInnerHTML` (ESLint `react/no-danger` = error) except inside `@jadarat/ui`'s `SafeRichText`, which sanitizes with a DOMPurify allow-list (no `style`, no event handlers, no `iframe`/`object`/`svg`/`form`, links forced to `https:`/`mailto:` with `rel="noopener noreferrer nofollow"`). Rich text is sanitized server-side on save **and** on render.
2. **MUST** validate URL schemes before rendering `href`/`src` from data (SCS-4). Do not rely on framework behaviour for `javascript:` URLs.
3. **MUST NOT** inject data into `<script>` blocks; if JSON must be embedded (e.g., JSON-LD), use `JSON.stringify(data).replace(/</g, '\\u003c')` and a nonce.
4. **MUST** treat tenant-controlled content as untrusted in the **platform console** too (render as text; TM T-40).
5. E-mail, WhatsApp, certificate and PDF templates **MUST** use logic-less templating with escaped variables (no user-editable template code); certificate HTML is rendered in the isolated renderer with JavaScript disabled and no network except the asset allow-list (TM F-06).
6. CSV/XLSX exports **MUST** neutralize formula injection:

```ts
const FORMULA_START = /^[=+\-@\t\r]/;
export const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  const safe = FORMULA_START.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
```

7. **SHOULD** strip bidi control characters from single-line identifiers shown in security-relevant contexts (file names, sender names, URLs) (SCS-4).

## SCS-7 Security headers and CSP with nonces

Next.js 16 renames Middleware to **Proxy** (`proxy.ts`); confirm the file/export name at scaffold time. Next.js reads the nonce from the request's CSP header and applies it to its own scripts; nonce-based CSP requires dynamic rendering of those pages.

```ts
// apps/suite/proxy.ts (security-header part; session refresh and host resolution omitted)
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const supabase = process.env.SUPABASE_URL!;             // e.g. https://<ref>.supabase.co
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src-elem 'self' 'nonce-${nonce}'`,
    `style-src-attr 'unsafe-inline'`,                     // React style props; revisit when feasible
    `img-src 'self' blob: data: ${supabase}`,
    `font-src 'self'`,                                     // Arabic fonts self-hosted
    `connect-src 'self' ${supabase} ${supabase.replace('https://', 'wss://')}`,
    `frame-ancestors 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}
```

Static headers in `next.config.ts`:

```ts
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];
export default {
  output: 'standalone',
  poweredByHeader: false,
  async headers() { return [{ source: '/:path*', headers: securityHeaders }]; },
  images: { remotePatterns: [] },          // add explicit hosts only; never tenant-controlled hosts
  experimental: { serverActions: { bodySizeLimit: '1mb' } },   // location of this option: verify for Next 16
};
```

- **MUST NOT** add `'unsafe-inline'` or `'unsafe-eval'` to `script-src` in production (development may need `'unsafe-eval'` for React tooling).
- **MUST NOT** pass private signed URLs through the Next.js image optimizer (its cache is shared and outlives the URL); use `unoptimized` for private images.
- **SHOULD** send CSP reports to our own endpoint and review them weekly. If Next.js or fonts emit inline `<style>` without a nonce, prefer hashes over relaxing `style-src-elem` — verify at scaffold.
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` **MUST** be set (same value across instances of one deployment, different per environment) for multi-instance/container deployments.

## SCS-8 Cookies, CSRF and origin checks

- Session cookies (via `@supabase/ssr`) **MUST** be `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, **host-only** (no `Domain` attribute) (ADR 0003). Use the `__Host-` prefix if the cookie-name option and chunked cookies allow it (verify). Host-only cookies also stop a tenant subdomain from tossing cookies into another tenant's subdomain.

```ts
// packages/platform-identity/src/server/supabase-server.ts
import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function createServerAuthClient() {
  const store = await cookies();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
    cookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },   // verify option support
  });
}
```

- Because cookies are `HttpOnly`, sign-in, MFA challenge/verify, recovery and sign-out **MUST** run server-side (server actions / route handlers). The browser receives only a short-lived access token for Realtime (TM F-04).
- Server Actions: Next.js compares `Origin` with the host; **MUST NOT** widen `serverActions.allowedOrigins` beyond our own hosts.
- Cookie-authenticated route handlers that change state **MUST** verify origin (done inside `defineRoute`):

```ts
export function assertSameOrigin(req: Request, expectedHost: string) {
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  if (!origin || new URL(origin).host !== expectedHost || (site && site !== 'same-origin')) {
    throw new Forbidden('cross_origin');
  }
}
```

- **MUST NOT** change state on GET. **MUST NOT** enable CORS on cookie-authenticated routes. The public API (R2) uses bearer tokens and ignores cookies.

## SCS-9 Authentication and session use

- **MUST** use `supabase.auth.getClaims()` (normal requests) or `supabase.auth.getUser()` (before role/permission changes, exports, security settings, impersonation) on the server. **MUST NOT** use `getSession()` in server code for authorization — it does not verify the token.
- **MUST** read authorization-relevant attributes only from verified claims and the database — never from `user_metadata`.
- **MUST** enforce AAL2 through permission metadata (`aal2: true` in the registry), not ad-hoc checks.
- **MUST** validate post-login redirects:

```ts
export function safeNextPath(next: string | null): string {
  if (!next) return '/';
  const base = 'https://app.invalid';
  const u = new URL(next, base);                  // also normalizes "/\\evil.com" → //evil.com
  return u.origin === base ? `${u.pathname}${u.search}` : '/';
}
```

- Supabase Auth settings (cloud config and self-hosted env) **MUST** be kept as code and asserted in CI: MFA TOTP on, leaked-password protection on (self-hosted fallback per TM F-09), secure e-mail change, reauthentication for password change, refresh-token rotation + reuse interval, access-token TTL (target 15 min), rate limits, redirect allow-list without broad wildcards.
- **MUST** sign out all sessions of a login when it is deactivated or its only membership is revoked (admin path, audited).

## SCS-10 File handling

- **MUST** generate object keys server-side: `<tenant_id>/<module>/<entity>/<entity_id>/<uuid>`; original file names are metadata only, sanitized (NFC, no bidi/control characters, no path separators, ≤ 255 chars).
- **MUST** check declared size and type when issuing the signed upload URL, and verify **magic bytes** after upload in the scanner job; files stay `pending_scan` (not downloadable) until clean.
- **MUST** set `Content-Disposition: attachment` for everything except re-encoded raster images; **MUST NOT** serve user SVG/HTML inline. Images are re-encoded (e.g., `sharp`), which also strips EXIF GPS.
- **MUST** issue download URLs only through `files.getDownloadUrl` (`defineAction` authorization + download grant, ADR 0006 §5): TTL 60 s for documents, ≤ 5 min for media; downloads of personal-data files are audited.
- **MUST NOT** process a file (import, certificate, preview) before its status is `clean`.
- Imports (CSV/XLSX): size and row limits (10,000 rows), parser with entity expansion disabled, decompressed-size cap, dry-run preview, per-batch audit.

Module code wraps the platform flow (`files.requestUpload` → direct upload → `files.completeUpload` → scan job, ADR 0006 §3) rather than re-implementing it:

```ts
export const requestMaterialUpload = defineAction({
  permission: 'tms.material.create',
  input: z.strictObject({
    courseId: z.uuid(),
    fileName: safeText(255),
    contentType: z.enum(['application/pdf', 'video/mp4',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
    size: z.number().int().positive().max(200 * 1024 * 1024),     // FR-CAT-06
  }),
  resource: (i) => ({ type: 'tms.course', id: i.courseId }),
  handler: async ({ ctx, input }) => {
    // platform-files builds the key <tenant>/tms/course/<id>/<uuid>, checks purpose allow-list and quota,
    // inserts platform.files (pending_upload, 15-min expiry) and signs the upload URL with the user's session
    return ctx.files.requestUpload(ctx.tx, {
      bucket: 'materials', owner: { module: 'tms', type: 'course', id: input.courseId },
      originalName: input.fileName, declaredMime: input.contentType, sizeBytes: input.size,
    });
  },
});
```

## SCS-11 Outbound requests and SSRF

All server-side requests to URLs that a tenant, user or partner can influence (LMS instance URL, webhook targets, LRS, avatar/URL imports, custom-domain checks) **MUST** use `safeFetch` from `@jadarat/platform-core/net` (to move to `platform-integration`, TM F-12). Plain `fetch` to such URLs fails review.

```ts
import 'server-only';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';

export async function safeFetch(raw: string, init: { method?: string; headers?: Record<string, string>;
  body?: string; timeoutMs?: number; maxBytes?: number } = {}) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || (url.port !== '' && url.port !== '443') || url.username || url.password) {
    throw new SsrfBlocked('scheme_port_or_credentials');
  }
  const addrs = await lookup(url.hostname, { all: true, verbatim: true });
  // allow-list: only globally routable unicast (blocks loopback, private, link-local incl. 169.254.169.254,
  // CGNAT, ULA, multicast, reserved; ipaddr.process() unwraps IPv4-mapped IPv6)
  if (!addrs.length || addrs.some((a) => ipaddr.process(a.address).range() !== 'unicast')) {
    throw new SsrfBlocked('non_public_address');
  }
  const pinned = addrs[0]!;
  // connect to the address we vetted (defeats DNS rebinding); TLS still validates url.hostname via SNI
  const dispatcher = new Agent({
    connect: {
      // Node may call lookup with { all: true } (autoSelectFamily) — answer both shapes; verify with the Node/undici versions in use
      lookup: (_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
        opts?.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family),
    },
  });
  const res = await fetch(url, { method: init.method ?? 'GET', headers: init.headers, body: init.body,
    redirect: 'manual', dispatcher, signal: AbortSignal.timeout(init.timeoutMs ?? 10_000) });
  if (res.status >= 300 && res.status < 400) throw new SsrfBlocked('redirect');
  return readCapped(res, init.maxBytes ?? 5 * 1024 * 1024);   // stream with a byte cap; abort beyond it
}
```

- Sovereign deployments **MUST** additionally route worker egress through an egress proxy with an allow-list (ADR 0010).
- Platform-operated integrations with fixed hosts (e-mail/SMS/AI providers) use a static host allow-list.

## SCS-12 Webhooks and signed tokens (QR, approval links)

**Inbound webhooks** (LMS, messaging providers):

```ts
// apps/suite/app/api/hooks/lms/[connectionId]/route.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export async function POST(req: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const conn = await loadConnectionForWebhook(connectionId);          // gives tenant + secret (from vault)
  const raw = await req.text();                                        // verify the exact bytes received
  const sig = req.headers.get('x-jadarat-signature') ?? '';           // format: t=<unix>,v1=<hex>
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig);
  if (!conn || !m) return new Response(null, { status: 401 });
  const t = Number(m[1]);
  if (Math.abs(Date.now() / 1000 - t) > 300) return new Response(null, { status: 401 });
  const expected = createHmac('sha256', conn.secret).update(`${t}.${raw}`).digest();
  const given = Buffer.from(m[2]!, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response(null, { status: 401 });

  const event = InboundLmsEvent.parse(JSON.parse(raw));               // Zod; payload "tenant" field is ignored
  await enqueueInbound(conn.tenantId, conn.id, event);                // dedupe on (connection_id, event.id)
  return new Response(null, { status: 202 });
}
```

- Tenant **MUST** come from the connection, never the payload. Replay cache on event id. Accept multiple active secrets during rotation. Provider-specific schemes (e.g., Meta `X-Hub-Signature-256`) follow the provider's documentation.
- Outbound webhooks (R2) sign the same way, include an event id and timestamp, and are sent via `safeFetch`.

**QR check-in tokens** (FR-ATT-02; 60 s rotation; accept current + previous window only):

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const WINDOW_S = 60;
const mac = (key: Buffer, s: string) => createHmac('sha256', key).update(s).digest().subarray(0, 16);

export function issueQrToken(k: { kid: string; key: Buffer }, tenantId: string, sessionDayId: string, now = Date.now()) {
  const w = Math.floor(now / 1000 / WINDOW_S);
  return `${k.kid}.${sessionDayId}.${w}.${mac(k.key, `qr.v1|${tenantId}|${sessionDayId}|${w}`).toString('base64url')}`;
}

export function verifyQrToken(token: string, tenantId: string, keyFor: (kid: string) => Buffer | undefined, now = Date.now()) {
  const [kid, sessionDayId, wStr, tag] = token.split('.');
  const key = kid ? keyFor(kid) : undefined;
  const w = Number(wStr); const cur = Math.floor(now / 1000 / WINDOW_S);
  if (!key || !sessionDayId || !tag || !Number.isInteger(w) || (w !== cur && w !== cur - 1)) return null;
  const expected = mac(key, `qr.v1|${tenantId}|${sessionDayId}|${w}`);
  const given = Buffer.from(tag, 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected) ? { sessionDayId } : null;
}
```

Then, inside `defineAction` (learner authenticated): check enrollment, geo-fence if enabled, and insert with a unique constraint `(tenant_id, session_day_id, person_id, kind)` — a duplicate is a no-op, not an error page.

**Approval links** (single-use): store only a hash of a random token.

```ts
const token = randomBytes(32).toString('base64url');           // sent in the link
await tx.insert(approvalLinks).values({ tokenHash: sha256(token), stepId, approverPersonId, expiresAt });

// consume atomically — and only for the signed-in approver (link alone never approves)
const [link] = await tx.update(approvalLinks).set({ usedAt: sql`now()` })
  .where(and(eq(approvalLinks.tokenHash, sha256(token)), isNull(approvalLinks.usedAt),
             gt(approvalLinks.expiresAt, sql`now()`), eq(approvalLinks.approverPersonId, ctx.personId)))
  .returning();
```

The link's GET shows a confirmation page; the decision is a POST (defeats mail scanners and prefetch).

## SCS-13 Cryptography and field-level encryption

- **MUST** use Node `crypto`/WebCrypto or vetted libraries only; no custom algorithms; constant-time comparison for MACs/tokens.
- **MUST** use `crypto.randomBytes`/`randomUUID`/`getRandomValues` for anything security-relevant; `Math.random` is banned in server code.
- **MUST** encrypt C4 identifiers (national ID/Iqama, bank details) at the application layer with AES-256-GCM using envelope encryption (data key wrapped by KMS/vault; key version stored with the ciphertext) and bind ciphertext to its row via AAD:

```ts
import { createCipheriv, randomBytes } from 'node:crypto';
export function encryptField(dek: { version: number; key: Buffer }, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dek.key, iv);
  c.setAAD(Buffer.from(aad));                               // e.g. `${tenantId}:platform.persons:national_id:${personId}`
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return `v${dek.version}.${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url')}`;
}
// Equality lookup / uniqueness: blind index = HMAC-SHA256(indexKey, normalizeDigits(value)), stored separately.
```

- Keys: per-purpose keys (QR, approvals, webhooks, field encryption, blind index) with `kid` and rotation; KEKs in KMS/Vault/HSM with envelope encryption and scheduled rotation (ADR 0010 §5); key inventory per TM F-07.

## SCS-14 Secrets and configuration

- **MUST NOT** commit secrets, `.env` files with real values, or production data. gitleaks runs in CI (gate 12) and pre-commit where possible.
- **MUST** validate environment at boot with a Zod schema in `@jadarat/platform-core/env` (server-only). Boot **MUST** fail if a secret-looking value appears in any `NEXT_PUBLIC_*` variable.
- The web runtime holds only: publishable key, `app_server` connection string, and keys needed for request-path features. Service-role/secret keys and worker credentials live only in the worker/admin runtime (TM F-03).
- Separate Supabase projects and credentials per environment (preview/staging/production). Previews never receive production credentials.
- Connector and webhook secrets are stored in the vault, shown once at creation, rotatable, and redacted in sync logs (FR-LMS-10).

## SCS-15 Logging, audit and error handling

- Use the shared logger (`@jadarat/platform-core/log`, structured JSON). **MUST NOT** log: names, e-mails, phone numbers, national IDs, geo-coordinates, tokens, cookies, `Authorization` headers, request/response bodies, AI prompts. Log IDs (UUIDs), tenant id, request id, error codes.

```ts
export const log = pino({
  redact: { paths: ['req.headers.cookie', 'req.headers.authorization', '*.email', '*.phone',
                    '*.nationalId', '*.password', '*.token', '*.lat', '*.lng'], censor: '[redacted]' },
});
log.warn({ event: 'authz.denied', tenantId: ctx.tenantId, actorId: ctx.personId, permission, resourceId }, 'denied');
// ❌ log.info(`User ${user.email} checked in at ${lat},${lng}`)
```

- Security events (auth failures, lockouts, MFA changes, authz denials, host/claim mismatch, webhook signature failures, SSRF blocks, rate-limit hits, impersonation, admin-client use) **MUST** be emitted with a stable `event` name (ASVS V16.3).
- Audit (FR-AUD-01): `defineAction` emits the declared audit event with before/after diff; C4 fields in diffs are redacted or encrypted (TM F-08). Sensitive reads and every export are audited.
- Errors: expected failures return typed results (`{ ok: false, code }`) localized in the UI; unexpected errors are logged and surface as generic RFC 9457 problems / Next.js error digests. **MUST NOT** return DB error text, stack traces or SQL to clients. Authorization, crypto and configuration errors fail closed.

## SCS-16 Rate limiting and anti-automation

- **MUST** apply `rateLimit()` (PostgreSQL token buckets, ADR 0011 §4) to: sign-in, sign-up, password reset, OTP send/verify, invitation send/accept, certificate verification, QR check-in, exports, import start, AI calls.

| Endpoint | Key | Starting limit (tune with data) |
|---|---|---|
| Sign-in | IP + e-mail hash | 10 / 15 min, then lockout per tenant policy |
| OTP send | identity + IP | 3 / 10 min; daily cap per tenant for SMS |
| Certificate verification | IP | 30 / min + bot challenge on excess |
| QR check-in submit | person + session-day | 10 / min |
| Export / import start | person + tenant | 5 / hour |

- Return 429 with `Retry-After`; log a security event; never reveal whether an account exists.

## SCS-17 Caching

- **MUST NOT** place tenant or user data in any cross-request cache (`'use cache'`, `unstable_cache`, fetch cache, module-level maps, CDN) unless the cache key includes tenant **and** the user or scope that determines visibility, and the entry is invalidated on change. `React.cache` (per request) is allowed.
- Authenticated responses **MUST** send `Cache-Control: private, no-store`.
- The host→tenant cache stores only public tenant metadata (id, slug, status, public branding).

## SCS-18 Background jobs, events and privileged access

- Jobs **MUST** run tenant work through `withSystemTx(tenantId, { jobId, initiatorId }, fn)` so RLS applies, and **MUST** take the tenant from the message, then re-read entities under that tenant (never trust IDs from another tenant's payload).
- Consumers **MUST** be idempotent (idempotency key + unique constraint or processed-message table) (ADR 0004).
- The admin client (`@jadarat/platform-db/admin`, service role or `BYPASSRLS`) is for genuinely cross-tenant platform operations only; each use **MUST** write an audit event with operator, reason and affected tenants.
- Scheduled jobs and outbound calls **MUST NOT** run inside user requests (NFR-SCAL-03); enqueue instead.

## SCS-19 AI prompt handling (R2+)

- AI tools **MUST** be implemented as `defineAction`s and executed with the requesting user's context; data-changing tools **MUST** require explicit user confirmation of a previewed diff (FR-AI-01).
- Retrieval **MUST** run through `withUserTx` (RLS) with tenant filters on vector search; no shared cross-tenant index.
- Untrusted content (course text, uploaded materials, comments, e-mails, LMS data) **MUST** be passed as clearly delimited data, never concatenated into system instructions; system prompts contain no secrets.
- Model output is untrusted: validate tool-call arguments with Zod, render through `SafeRichText`, never execute returned code/SQL/URLs.
- **MUST NOT** send C4 data to a model unless the feature requires it, the tenant enabled it, and the provider region is permitted for that tenant (BRD §12.2). Log feature, model, tokens, cost, user and tenant (FR-AI-10) without storing prompts outside the tenant's retention policy.
- Every AI feature ships with an Arabic + English red-team test set (prompt injection, data exfiltration, tool misuse) in CI.

## SCS-20 Dependencies and supply chain

- New runtime dependencies need a PR note: purpose, maintenance status, licence, weekly downloads/age, alternatives. Prefer platform APIs and existing dependencies.
- Allowed licences: MIT, Apache-2.0, BSD-2/3-Clause, ISC, 0BSD, MPL-2.0 (file-level). GPL/AGPL/SSPL/unknown **MUST NOT** ship in images delivered to customers (gate 1).
- `pnpm install --frozen-lockfile` in CI; dependency lifecycle scripts allowed only for an explicit allow-list (pnpm `onlyBuiltDependencies`); a minimum release age for new versions (pnpm `minimumReleaseAge`) — verify option names for the pnpm version in use.
- GitHub Actions pinned by full commit SHA; `permissions:` least privilege per workflow; no `pull_request_target` with checkout of PR code; cloud access via OIDC, not stored keys.
- Renovate/Dependabot PRs are reviewed like code; critical/high advisories follow the remediation SLAs in the [README](README.md).
- SBOM (CycloneDX) per release; container images built from pinned digests, scanned (gate 13) and signed for sovereign delivery.

## SCS-21 PR security checklist

Copy into the PR (extends Development Plan Appendix B). Tick or write "N/A — reason".

```markdown
### Security checklist
- [ ] Every new/changed server action and mutating route uses `defineAction`/`defineRoute` with permission, Zod `strictObject` input and resource scope
- [ ] Positive + negative tests: no permission → 403; out of scope → 404; other tenant → 404; AAL1 where AAL2 required → step-up
- [ ] Tenant comes only from `getRequestContext()`; no tenant/owner/status fields accepted from the client
- [ ] New tables: `tenant_id`, composite FKs, ENABLE + FORCE RLS, restrictive `tenant_isolation`, explicit grants, pgTAP isolation tests, column classification comments
- [ ] No `sql.raw`, `set_config`, `SET ROLE`, `security definer`, views without `security_invoker`, or admin-client imports outside allowed paths (or security review attached)
- [ ] No `dangerouslySetInnerHTML`; URLs scheme-checked; exports neutralize formulas; templates escaped
- [ ] Outbound requests to configurable URLs use `safeFetch`; webhooks verify HMAC + timestamp on the raw body
- [ ] Files: server-generated keys, type/size checks, quarantine, attachment disposition, short signed URLs
- [ ] No secrets or PII in code, logs, errors, URLs, analytics or AI prompts; restricted fields projected by permission
- [ ] Audit events for create/update/delete, sensitive reads and exports; security events for denials
- [ ] Rate limits on new public or expensive endpoints; no tenant/user data in shared caches
- [ ] New dependency justified; licence allowed; lockfile updated
- [ ] Threat model (TM-0001 or the epic's TM) still accurate — updated if a trust boundary, entry point or third party changed
- [ ] Security-relevant PR? Separate security-review pass completed and findings resolved
```

---

## Appendix A — Mechanical enforcement

| Rule | Mechanism | CI gate (Plan §5.3) |
|---|---|---|
| Every action/mutating route uses `defineAction`/`defineRoute` | Custom lint rule / test enumerating `'use server'` exports and route handlers | 2 / 3 |
| Admin client only in `**/jobs/**`, `**/admin/**`; module boundaries | dependency-cruiser | 2 |
| No `getSession()` in server code; no `set_config`/`request.jwt`/`SET ROLE` outside `platform-db`; no `sql.raw` outside helpers; no `Math.random` in server code; no `child_process`/`eval` | Semgrep custom rules | 10 |
| No `dangerouslySetInnerHTML` outside `SafeRichText` | ESLint `react/no-danger` (error) with file-level allow | 2 |
| Every table has ENABLE + FORCE RLS and restrictive `tenant_isolation`; no `anon` grants; views `security_invoker` | SQL catalog test + `supabase db lint` | 4 / 5 |
| Cross-tenant isolation per table; no-claim test | pgTAP | 5 |
| Supabase Auth/Data API configuration (exposed schemas, GraphQL off, MFA, rotation, TTL) | Config assertion job (cloud `config.toml` + self-hosted env) | 4 |
| Secrets | gitleaks + boot-time env schema | 12 / 3 |
| Dependencies, licences, images | OSV/audit, licence checker, Trivy, SBOM | 1 / 11 / 13 |
| Headers/CSP/cookies | Playwright assertions on representative routes | 7 |
| DAST | ZAP baseline nightly against staging | nightly |
