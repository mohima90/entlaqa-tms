# ADR 0002 — Multi-tenancy, tenant resolution and row-level security

**Status:** Accepted (rev. 1 after TM-0001 review) — PR #9, 30 Sep 2026; rev. 2 (§6a helper ownership, hosted Supabase) — 1 Oct 2026, accepted on PR merge · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B02 · **Related:** BRD §5 (v1 tenancy), §10.3 DR-1, §12, §15, Appendix H.3; NFR-SEC-02; Development Plan Q2 (tenant isolation), §8.3; ADR 0001, ADR 0003

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
- `platform.session_context` — session_id (the Supabase Auth session), user_id, active_tenant_id: which tenant **this session** is acting in. Keyed by session, not by user, so one person signed in to two tenant hosts at once does not flip between tenants (TM-0001 F-02).

### 3. Tenant claim in the JWT
- A **Supabase Custom Access Token Hook** (PostgreSQL function, owned by a restricted role, `EXECUTE` granted only to `supabase_auth_admin`) adds claims when a token is issued or refreshed:
  - `tenant_id` — the active tenant of **this session** (from `platform.session_context`), **only if** the membership is `active` and the tenant is `active` or `trial`;
  - `person_id` — the person record for that tenant.
- If there is no valid active membership, no `tenant_id` claim is issued; all tenant RLS policies then deny access.
- Switching tenant: an explicit **POST** server action (never a GET side effect) verifies membership, updates `session_context` for the current session, and refreshes the session so a new token with the new claim is issued.
- The hook depends on the session identifier being available in its input claims (`session_id`); verify at implementation (T-M1-D04 spike covers self-hosted parity).
- The hook is part of the self-hosted stack configuration as well (verify GoTrue hook configuration in T-M1-D04).

### 4. Tenant resolution per request (defense against cross-host session use)
1. The Next.js request proxy (formerly "middleware") resolves the **host** to a tenant via `platform.tenant_domains` (verified domains only) through a narrow lookup function returning only tenant id, slug, status and public branding; results are cached briefly in memory.
2. The session's `tenant_id` claim **must equal** the host tenant. If not, the request is not served: when the user is an active member of the host tenant, a page offers to switch (explicit POST, see §3); otherwise the user is sent to sign-in for that tenant.
3. Tenant ID is **never** taken from request bodies, query strings, headers set by the client, or local storage.

### 5. Data access path (how RLS is applied from server code)
- Tenant data is read and written **only by server code** (server components, server actions, route handlers, jobs). The browser does not query tenant tables through the Data API (ADR 0003).
- Server code connects to PostgreSQL directly through the connection pooler (transaction mode) as a dedicated login role **`app_server`** that is a member of `authenticated` with **`NOINHERIT`** (it has no table privileges until it explicitly switches role), has **no `BYPASSRLS`**, and owns no tables. Background workers use a separate login role **`app_worker`** with the same properties (ADR 0005).
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
-- NOTE: the production version additionally validates the claims (see "Claim validation" below);
-- the simple form is shown to explain the policy pattern.

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

### 6a. Claim validation inside the database (defense against credential theft — TM-0001 F-01)
Our functions and policies read claims **only** from the transaction-local setting `request.jwt.claims` (never the legacy per-claim settings `request.jwt.claim` / `request.jwt.claim.sub`, which a session-level `SET` could make survive across pooled transactions — security review of the M1 scaffold), and `withUserTx` / `withSystemTx` blank the legacy settings for each transaction. For a user claim, the session's **current** active tenant (`platform.session_context`) must also equal the claimed tenant, so an old token stops working immediately after a tenant switch.

Because the database trusts the claims that server code sets, a stolen `app_server` credential must not be enough to read any tenant's data. `private.current_tenant_id()` therefore returns a tenant **only if** the claims are valid for the login role that set them:
- **User claims** (`role = authenticated`, `sub`, `session_id`, `tenant_id`) are accepted only when `session_user = 'app_server'`, the `session_id` exists in `auth.sessions` for `sub` and is not expired, and `sub` has an **active** membership in `tenant_id` for an active/trial tenant.
- **System-actor claims** (`role = system`, `tenant_id`, job id) are accepted only when `session_user = 'app_worker'` and the tenant is active or trial (trial tenants need reminders and scheduled jobs too).
- Any other combination returns `NULL` → all tenant policies deny.
- **Future claim kinds** (R2): external API clients and MCP tokens (ADR 0011, ADR 0012) will get their own claim kind bound to their own login path; they are added to this function by a new ADR revision, never by loosening the existing checks.
- **Supabase platform services** (Storage API, Realtime) connect with their own database login roles and set the end user's claims themselves. Under the rules above they resolve to **no tenant (fail-safe deny)**. Before the first feature that uses Storage or Realtime (M2/M3), this function is extended with an explicit allow-list of those service login roles that applies the **same user-claim validation** (live session, active membership, session's active tenant) — never a weaker check. The exact role names and the claim setting each service uses are verified on the staging project (T-M1-D03), and tests are added for both services.
- **Anonymous endpoints** (host→tenant lookup, public certificate verification) never use tenant tables directly; they call narrow functions in `private` that return only the fields needed.
The check runs once per statement (wrapped in `(select …)`); its cost is measured with `EXPLAIN ANALYZE` during M2 and indexes are added as needed.

**Helper ownership and Auth sessions (rev. 2, 1 Oct 2026).** All four SECURITY DEFINER helpers of this section (`user_session_is_valid`, `has_active_membership`, `current_tenant_id`, `switch_active_tenant`) are owned by the NOLOGIN role `tenant_guard` (no BYPASSRLS, no CREATE anywhere; it reads platform tables only through explicit grants and `…_guard_read` policies). On hosted Supabase the migration role (`postgres`, not a superuser) has `USAGE` on schema `auth` **without the grant option** (observed on the second staging deploy), so `tenant_guard` cannot be granted access to `auth.sessions` directly. Instead the migration role owns a view **`private.auth_session_validity`** (`id`, `user_id`, `not_after` of `auth.sessions`, `security_barrier`): a view reads its base table with its owner's rights, and granting SELECT on a view needs no grant option on the base table. `SELECT` on the view is granted to `tenant_guard` only; no function ever runs with the migration role's rights. The migration asserts that the view's owner can read those columns and that `tenant_guard` can read the view; `scripts/sql/verify-deployment.sql` checks the exact ACLs and owners of the view and the four helpers, and the hosted-Supabase simulation gate (`scripts/db-test-hosted-sim.sh`) exercises it as a non-superuser with Supabase's observed grants.

### 7. Background jobs and platform operations
- Tenant-scoped jobs connect as **`app_worker`** and run with the same transaction mechanism (`withSystemTx`) using a **system-actor claim set** for the job's tenant (`tenant_id`, `role: 'system'`, job id) so RLS still applies (§6a); each job records its tenant and actor in the audit log.
- The **service-role key / `BYPASSRLS`** is reserved for platform-level operations that are genuinely cross-tenant (migrations, tenant provisioning, platform console aggregates). It lives only in `packages/platform-db/admin` (ADR 0001 rule), is never available to request-path code, and every use is audited.

**Implementation note T-M2-07 (7 Oct 2026, rev. 2 after security review H1): invitees create their own account through the public Auth API, gated in the database — no Auth secret key in the web app (FR-IAM-03).** Accepting an invitation must create an Auth user with the password the invitee chooses, before the person has any session. The first design used the Auth admin API from the web app (an exception to the rule above); the Product Owner chose to remove it (7 Oct 2026). The rule above now holds **without exception**: the web app has no `SUPABASE_SECRET_KEY`, nothing in `apps/suite` reaches `@jadarat/platform-db/admin` (dependency-cruiser `no-admin-or-jobs-reachable-from-suite`, `no-admin-or-jobs-db-in-suite-app`, fixture tests in `scripts/dependency-rules.test.mjs`).
- **Design.** Auth accepts public sign-ups (`/auth/v1/signup`, publishable key) and runs Supabase's **before-user-created hook** `private.before_user_created_hook` (migration `20261009090000`) for every new user, whatever the endpoint (sign-up, OTP/magic link, invite, anonymous, phone, OAuth/SSO). The hook admits **only** an e-mail sign-up (provider `email`, not anonymous, no phone) whose user metadata carries the **raw** invitation token (43 base64url characters) of a **valid** invitation for **that e-mail** — "valid" as on the link page (`private.invitation_link`: pending, unexpired, token matches, organization active, person active with the same e-mail and no membership, inviter may still give the roles, review M1). It runs as `supabase_auth_admin`, which may execute only the hook and the yes/no check `private.invitation_allows_signup` (SECURITY DEFINER, owner `invitation_guard`; it hashes the token itself and returns a boolean). Admin user creation (operator provisioning, `create-user.mjs`) does not run the hook.
- **Flow.** The accept action looks the link up again (`valid` only), signs up server-side with the cookie-bound `@supabase/ssr` client — e-mail from the invitation, never from the form; `data: { invitation: <raw token> }` — removes the token from the user metadata with the new session (`updateUser({ data: { invitation: null } })`), then accepts through `private.accept_invitation_as_caller` in `withUserTx` with the new session's verified claims (valid session, Auth e-mail = invitation e-mail), and selects the organization by refreshing that session. There is no acceptance "for a given user id" any more (`private.accept_invitation` removed): every acceptance is made by the signed-in invitee.
- **Threat model.**
  - *Fail-open hook API.* Auth admits the user when the hook returns NULL, `{}` or an error without a message, and the hook setting itself lives in Auth's configuration (dashboard / GoTrue env), outside the database. So: every path of the hook returns the explicit refusal `{"error":{"http_code":403,"message":"Sign-up is by invitation only."}}` unless the one allowed shape matched; errors are caught and refused (a raised error would also reach the client as a 500 with the PostgreSQL message); pgTAP asserts the exact refusal for each case (`39_invitations_signup_hook.sql`); `verify-deployment.sql` checks the function and its exact ACL; the hosted rollout enables the hook **before** sign-ups and rolls back by turning sign-ups off **first** (`docs/engineering/db-deploy.md` § Auth sign-up gate); the staging uptime workflow tries a sign-up without an invitation every 15 minutes and opens an issue unless Auth refuses it; the self-hosted smoke test checks refused sign-ups end to end.
  - *Caller-controlled metadata.* `user_metadata` is whatever the caller sends (`app_metadata` is not). It is only read for the token, which must match a valid invitation for the sign-up's own e-mail; there is no allow-list flag. Auth copies the metadata into `auth.users`, the identity and the access token: the client sends the raw token, never the stored hash, so nothing Auth stores can be replayed against the database, and the web app removes it right after the sign-up. Residual: the identity record keeps the (then used) token; the first access token carried it until the session is refreshed in the same request.
  - *Not atomic.* The hook runs in Auth's own transaction before the user exists (and Auth commits it even on refusal: the hook has no side effects). Acceptance checks everything again under the tenant's role lock; a change in between leaves an Auth user without membership — logged as `orphan_auth_user` (runbook: invitations contract § Operations).
  - *A token holder can call Auth directly* (bypassing the page) — equivalent to using the link: the account gets the invitation's e-mail, and nothing is accepted until that account signs in and accepts. With a valid token, an OTP/magic-link sign-up for the invitation e-mail is also admitted (the hook cannot tell the endpoints apart): it creates a password-less account whose owner must reset the password before "sign in to accept".
  - *Rate limits.* The public sign-up endpoint is reachable by anyone; each refused attempt costs one indexed lookup. Auth's per-IP sign-up limits apply to direct callers (their own IP); the accept action calls Auth from the app server, so for it Auth sees the app's egress address (as for sign-in; application-level limits per ADR 0003 / R-34).
  - *E-mail changes (security re-review N1, 7 Oct 2026).* Auth lets a signed-in account request another address (`PUT /user {"email"}`); it is applied once the confirmation link sent to that address is opened (spike on GoTrue v2.197.0: never at once for a confirmed account, also with "Confirm email" off; at once only for anonymous accounts, which are off). With sign-ups open, one click by a future invitee on an unexpected "confirm your new e-mail" message would hand their address to someone else's account. The e-mail is the organization's (HR) record and no product path changes it, so the migration adds a trigger on `auth.users` (`jadarat_refuse_email_change`) that refuses any new `email` or requested `email_change` for every role unless an operator sets `jadarat.allow_auth_email_change = on` for the transaction; Auth then answers 500 and keeps the address (sign-in, refresh, password and metadata updates unaffected — spike and self-hosted smoke). It needs the migration role's `TRIGGER` privilege on `auth.users` (Supabase grants it) and is verified by `verify-deployment.sql`.
  - *Unconfirmed accounts (re-review N3).* The hook runs only for a new user. For an existing **unconfirmed** e-mail account, Auth's `/signup` with "Confirm email" off confirms it and returns a session — for any password, without the hook (spike). Our configuration never leaves one: sign-ups are confirmed at creation, and OTP/magic-link requests create the user confirmed with a random password (spike; the hook cannot tell `/otp` from `/signup` — same payload). Accepted residual with operational controls: no unconfirmed accounts before sign-ups open and operators create users confirmed (`docs/engineering/db-deploy.md` § Auth sign-up gate); the self-hosted smoke asserts none exist after every journey.
  - *Claims in the database session (re-review N5).* `withUserTx` forwards only `sub`, `role`, `session_id`, `tenant_id`, `person_id` and `aal` as `request.jwt.claims` (allow-list, TM-0001 T-15): the access token's e-mail and `user_metadata` (caller-chosen sign-up data, e.g. the raw invitation token until it is removed) never reach PostgreSQL. The hook compares the e-mail exactly as Auth sends it (lower-cased by Auth), not normalised again. The hook sets `lock_timeout`; the statement timeout is Auth's own (`set local statement_timeout` = 2 s before the call; a function-level `statement_timeout` would not bound the running statement).
  - *Configuration.* "Confirm email" must be off (the invitation e-mail proved the address) so that the sign-up returns a session; if it is on, the flow degrades to "sign in to accept" after the e-mailed confirmation and logs a warning. Anonymous and phone sign-ups stay disabled (the hook refuses them anyway).

**Implementation note T-M2-17 (8 Oct 2026): the Auth admin key exists in the worker only (FR-NTF-02 as clarified in BRD v2.5, FR-IAM-13).** Account e-mails (password reset, "password changed") are sent by our notification service in the organization's language and brand, not by Auth's mailer (PO, 7 Oct 2026). Our service can e-mail a reset link only if it can obtain the token without Auth sending anything: Auth's admin `generate_link` (`type: recovery`), which needs the Auth secret key. That key is now used in exactly **one** place — the worker — and the web app still holds none (PO decision 7 Oct 2026; the rule above holds for request-path code without exception).
- **Why the worker, not the web app.** The reset request is unauthenticated and internet-triggered. Had the web app the key, any request-path flaw (SSRF, injection, a dependency) would expose a credential that can create, change and delete every account. The worker is not reachable from the internet, already holds the most privileged runtime credentials (`app_queue`, `app_worker`, provider keys; ADR 0005 §1, TB-9), and acts on database rows, never on request input: the web app only adds a row to a platform-level queue through `private.request_password_reset_mail(email)` (SECURITY DEFINER, owner NOLOGIN `account_mail_guard`, `session_user = app_server`), **unconditionally** — it never looks at accounts, so nothing on the request path depends on whether one exists. The worker leases the request (`private.claim_account_mail_request()`, app_worker system claims), the database resolves account, organization and language, and only then the worker calls `generate_link` for that account.
- **Verified behaviour (GoTrue v2.197.0 source, `internal/api/mail.go` `adminGenerateLink`; self-hosted smoke):** for an unknown address it answers 404 `user_not_found` before writing anything — no user is created and the before-user-created hook is not involved (it runs only for the user-creating types `signup`/`invite`/`magiclink`, which we never request); it sends no e-mail; it is not limited by `SMTP_MAX_FREQUENCY` or any rate limiter (admin routes) — the worker applies the one-a-minute rule and an hourly cap itself; it does not check bans — the worker skips banned accounts.
- **Enforcement.** The key is read only by `apps/worker` (`SUPABASE_URL` + `SUPABASE_SECRET_KEY`, checked at start-up) and handed to `createRecoveryLinkIssuer` in the restricted `@jadarat/platform-db/admin` entry point, which returns the token hash only (the one-time code and Auth's link are discarded). dependency-cruiser keeps the admin entry point to job/admin roots and the worker (`admin-client-only-in-jobs-or-admin`, `no-admin-or-jobs-reachable-from-suite`; fixture test "the Auth admin key stays in the worker"). Staging: GitHub environment `staging-jobs` only, never Vercel. Self-hosted: a service_role token signed by `gen-secrets.sh` (90 days; renewed by re-running it; the worker warns from 30 days ahead, at start-up and daily) for the worker container only; the gateway serves Auth's admin API only on an unpublished port by source network — the workers' network gets `generate_link` only, the operators' one-off `admin-cli` network gets user creation only, and the published port serves no admin path (security review); the smoke test fails if any other container holds an admin key or a service_role token, or if any of those gateway rules does not hold. The queue (`private.account_mail_requests`) is reachable only through the five `account_mail_guard` functions (catalog test, `verify-deployment.sql`, pgTAP 54–61).
- **Residual risk.** A compromised worker can use the key — as it could already use every tenant's data through `app_worker` and the provider keys. The key is a candidate for per-environment rotation with the worker credentials (ADR 0010 secrets).

**Implementation note T-M2-09 (11 Oct 2026, rev. 2 after security review): deactivation keeps the person out through the database at once, and Auth issues no token to a login that belongs nowhere any more (FR-IAM-05).**
- **Tenant action, database effect.** Deactivating a member suspends the membership, makes the person inactive, revokes their pending invitations and removes that organization's `session_context` rows (trigger `private.end_member_sessions`, owner NOLOGIN `membership_guard`). §6a already refuses every later statement of an old token (it needs an active membership), so access ends at the next request (TM-0003 T-IAM-39). An organization switch in flight cannot leave a row behind: `private.switch_active_tenant` holds a per-membership advisory lock shared until it commits, the trigger takes it exclusively before deleting (review L3; a `FOR SHARE` row lock would need UPDATE rights and an update policy for `tenant_guard`). Reactivation is the one way back to `active` on the request path: `private.reactivate_membership` (SECURITY DEFINER, owner `membership_guard`, `session_user = app_server`) checks the caller's organization, roles, never one's own membership, the person active again. A member who holds a privileged role (in force or future-dated: `private.membership_is_privileged`) is deactivated **and** reactivated only by the Organization Admin with an authenticator code (`aal2`, D-IAM-01; deactivation: trigger `private.check_privileged_deactivation`, review M4). Roles are kept as they were. Assignments of a manager or a department head serialise with deactivation through a per-organization advisory lock (`private.lock_person_employment`, order departments → branches → person_employment → roles).
- **No token for a login that belongs nowhere (the T-M2-08 follow-up).** Auth knows nothing about memberships. The Custom Access Token Hook (§3) asks `private.account_sign_in_refused(user id)` (SECURITY DEFINER, owner `membership_guard`, EXECUTE for `supabase_auth_admin` only) on every token it issues — sign-in and refresh alike — and answers Auth's documented error object `{"error":{"http_code":403,"message":"Sign-in is not available for this account."}}` instead of claims when the account has at least one membership, none of them active in an active or trial organization, and no pending, unexpired invitation for its e-mail (lower-cased) in such an organization. Accounts without any membership — platform staff, break-glass accounts, invitees who just created their account — are never refused. The rule is evaluated live, so reactivation, a reinstated organization or a new invitation lets the account in again at once, with no queue, no worker and no Auth admin call; and a tenant action can never lock a login out of another organization (TM-0003 T-IAM-40, satisfied structurally). The hook fails closed: any error inside it is answered `{"error":{"http_code":500,…}}` — no token, but **not** the refusal (review N1: auth-js treats a 403 on refresh as final and drops the session, so a database blip must not sign everyone out or read as "wrong e-mail or password") — and logged as a WARNING starting `custom_access_token_hook:` with the SQLSTATE only (for alerting). Verified on the GoTrue image of the self-hosted stack (smoke): the right password is refused and Auth keeps no session or refresh token of the attempt; a wrong password still gets `invalid_credentials`, exactly like an unknown address (the hook runs only after the password check, so only someone who knows the password learns that the account is refused); an existing session's refresh is refused; an account without membership and a deactivated account invited by another organization still sign in; a reactivated member signs in again at once; with the rule's EXECUTE revoked, Auth answers a server error, issues no token and keeps no session row. The password-reset mailer (worker mode) already sends nothing to such an account: it needs an active membership in a served organization (`no_membership`).
- **Consequences to keep in mind.** (1) Members of a **suspended or cancelled organization** — its Organization Admin included — get no Auth token at all while that is their only organization: they cannot even sign in to see a "your organization is suspended" page. The future billing / suspension pages (and any reinstatement flow driven by the customer) must account for that, e.g. by a platform-side contact path or an exemption decided with the PO. (2) **Platform staff** (FR-ADM-17): once `platform_staff` exists, `private.account_sign_in_refused` must exempt staff logins (a staff login with a former customer membership must not be refused). (3) **Residual N2:** the Auth sessions themselves are not ended — a refused refresh is rolled back, so its refresh token is never revoked; after a reactivation, a refresh token from before the deactivation works again (no organization selected; the chooser offers it without a new sign-in). Planned closure: with T-M2-10's Auth-session deletion (next), deactivation also ends the login's Auth sessions when no other active membership remains.
- **Configuration.** None beyond the existing hook (`[auth.hook.custom_access_token]`, `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*`; enabled on staging since T-M1). The worker keeps its single Auth admin call (`generate_link`, note T-M2-17).

### 8. Storage and Realtime
- Storage object keys start with the tenant ID: `<tenant_id>/<module>/<entity>/<id>/<file>`; storage policies on `storage.objects` require `(storage.foldername(name))[1] = private.current_tenant_id()::text` **and** the download/upload grant rules of ADR 0006 §4 (a clean file plus a short-lived grant created by the authorizing action). Buckets are private; downloads use short-lived signed URLs generated server-side (ADR 0006).
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
3a. **Claim-validation tests (§6a):** forged claims (unknown/expired `session_id`, no active membership, system claims under `app_server`, user claims under `app_worker`) read zero rows.
4. **Import rule:** no request-path code imports the admin client (ADR 0001).
5. **E2E (J13):** cross-tenant access attempts on every API group return 403/404.
