# ADR 0003 — Authentication, authorization, permissions and data scopes

**Status:** Proposed · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B03 · **Related:** BRD FR-IAM-01…15, FR-ADM-17, FR-WFL-02, Appendix B (roles & permission matrix), NFR-SEC-01/02/09; Development Plan §8.3; ADR 0001, ADR 0002

## Context

- Users: tenant staff (admins, training managers, coordinators, HR, finance, compliance), managers, learners, internal/external instructors, provider staff, mentors, auditors; plus ENTLAQA platform staff.
- BRD requires 15 default roles, custom roles (R2), data scopes (own, reports, departments, branches, legal entity), separation-of-duties rules, delegation, MFA per role, SSO (R2), SCIM (R3).
- Security bar: no known critical/high issues; deny by default; privilege changes effective immediately; sovereign deployments on self-hosted Supabase.

## Decision

### 1. Identities
- **`auth.users`** (Supabase Auth) = the login identity (global, one per email/phone).
- **`platform.persons`** = the tenant-scoped person (people directory shared by all suite modules, FR-STE-02). A person may exist without a login (not yet invited, contractor without access).
- **`platform.tenant_memberships`** links a login to a person in a tenant, with status. One login may have memberships in several tenants (ADR 0002).
- **Platform staff** (ENTLAQA) are logins listed in `platform.platform_staff`; they have **no tenant membership by default** (see §6).

### 2. Authentication
| Capability | Decision | Release |
|---|---|---|
| Primary sign-in | Email + password (min length and complexity from tenant policy; breached-password check); invitation acceptance sets the password | R1 |
| MFA | TOTP (authenticator apps) via Supabase Auth MFA; tenant policy: off / optional / required for all / required for roles; privileged permissions require **AAL2** (`aal` claim) | R1 |
| Other second factors (SMS / e-mail OTP per FR-IAM-12) | Spike in M2 to confirm Supabase support in cloud and self-hosted; fall back to TOTP-only if not supported natively | R1 spike → R2 |
| SSO | SAML 2.0 via Supabase SSO; OIDC for Microsoft Entra ID / Google via supported providers; generic OIDC to be validated | R2 |
| SCIM | Platform endpoint provisioning persons/memberships | R3 |
| Lockout & rate limits | Supabase Auth rate limits plus application-level limits on sign-in, OTP, invitation and password-reset endpoints (self-hostable store) | R1 |

**Sessions**
- Cookies managed with `@supabase/ssr`; `HttpOnly`, `Secure`, `SameSite=Lax`, host-only.
- Short-lived access tokens (target **15 min**) with refresh-token rotation and reuse detection, so revocations, suspensions and tenant switches take effect quickly.
- The request proxy refreshes sessions; it does not make authorization decisions.
- **Every** server component, server action, route handler and job verifies identity server-side:
  - `getClaims()` with **asymmetric JWT signing keys** (signature verified locally against the project's keys) for normal requests;
  - `getUser()` (round-trip to Auth) before sensitive operations (role/permission changes, exports, security settings, impersonation) to ensure the session is not revoked.
- Only claims from a verified JWT are passed to the database (`withUserTx`, ADR 0002).
- Tenant session timeout / inactivity timeout (FR-IAM-13) enforced by the application where the Auth tier does not provide it.

### 3. Authorization model
**Permissions** are namespaced strings `<module>.<resource>.<action>`, e.g. `tms.session.create`, `tms.enrollment.approve`, `platform.user.invite`, `platform.role.manage`.
- Each module declares its permissions in code (registry) with metadata: code, AR/EN label, description, **risk level** (low/medium/high), and whether **AAL2** is required.
- The registry is the single source of truth; a migration check fails if the database references unknown permission codes.

**Roles** are named sets of permissions: 15 **system roles** (BRD Appendix B) seeded per tenant and not editable; **custom roles** (R2) cloned or created by Tenant Admins.

**Role assignments** attach a role to a membership with a **data scope**:

| Scope | Meaning |
|---|---|
| `own` | Records where the subject person is the member themself |
| `direct_reports` | Persons whose manager is the member |
| `reports_tree` | Direct and indirect reports |
| `org_units` | Listed departments (optionally including descendants) |
| `branches` | Listed branches |
| `legal_entity` | Listed legal entities (R3) |
| `tenant` | Whole tenant |
| `assigned` | Resources explicitly assigned (e.g., an external instructor's sessions, a mentor's trainees, a provider's sessions) |

Effective access = **union** of the member's assignments, each limited by its scope.

### 4. Enforcement
1. **Server layer (primary, fine-grained).** Every server action and route handler is declared through a single helper:
   ```ts
   export const approveEnrollment = defineAction({
     permission: 'tms.enrollment.approve',
     input: ApproveEnrollmentInput,            // zod schema — validated before the handler runs
     resource: (input) => ({ type: 'enrollment', id: input.enrollmentId }),
     handler: async ({ ctx, input }) => { … }  // ctx: verified identity, tenant, effective grants, tx
   });
   ```
   `defineAction` verifies the session, loads effective grants (cached per request), checks the permission and that the resource is within scope, enforces AAL2 when required, runs the handler in `withUserTx`, and emits audit events. **Deny by default**: out-of-scope resources return 404 (no existence leak); missing permissions return 403.
2. **List queries** use `scopeFilter(ctx, 'tms.enrollment.read', …)`, which turns the member's scopes into SQL predicates so lists never over-fetch and then filter in memory.
3. **Database layer (defense in depth).** RLS enforces tenant isolation on every table (ADR 0002) and, where cheap and stable, ownership rules (for example, learners reading their own enrollments). RLS does not replace server-side permission checks.
4. **Browser.** The browser never queries tenant tables directly; all data flows through server code. The Supabase browser client is used only for authentication flows and Realtime channels (authorized by RLS).
5. **CSRF / origin.** Server Actions rely on Next.js's built-in Origin/Host check; cookie-authenticated route handlers that change state must verify `Origin` and reject cross-site requests. The external API (R2) uses bearer tokens, not cookies (ADR 0011).
6. **Mechanical enforcement.** A lint rule/test fails the build if any exported server action or mutating route handler in `modules/**` or `packages/platform-*/**` is not created with `defineAction` / `defineRoute`.

### 5. Governance rules
- **No privilege escalation:** a member can only grant roles whose permissions they themselves hold, within their own scope; `platform.role.manage` is high-risk and requires AAL2.
- **Separation of duties** (FR-IAM-09): configurable rules evaluated in `defineAction` (e.g., requester ≠ approver; purchase-order creator ≠ invoice approver).
- **Delegation** (FR-IAM-14): time-boxed delegation of approval permissions; actions record both delegate and delegator.
- **Immediate effect:** effective grants are computed from the database on each request (not embedded in the JWT); a membership version counter invalidates any per-request cache.
- **Audit:** all role, permission, assignment, MFA, SSO and security-policy changes are audited with before/after values (FR-AUD-01).

### 6. Platform staff access (FR-ADM-17)
- Platform staff sign in to a separate **platform console** route with AAL2 always required (optional IP allow-list).
- Staff have no standing access to tenant data. Access to a tenant is granted only through an **impersonation / support grant**: reason, ticket reference, target tenant (and optionally user), maximum duration (default 60 min), approved according to policy; the grant yields a session whose claims include the tenant and `act_as` / `actor` fields.
- During a grant, the tenant UI shows a visible banner; every action is audited with both the staff identity and the impersonated identity; grants and their use are visible to the Tenant Admin in the audit log.

### 7. Machine clients
Integrations (LMS connectors, public API clients, webhooks) authenticate with OAuth 2.0 client credentials or scoped API keys; each client maps to a set of permissions and a tenant; detailed in ADR 0011 (R2).

## Consequences

**Positive:** one enforcement path (`defineAction`) that is easy to review and test; immediate privilege changes; data scopes cover the BRD's manager/department/branch requirements; strong defaults for MFA and sessions.

**Negative / costs:** computing grants per request costs a query (mitigated by per-request caching and indexes); `scopeFilter` must be implemented carefully for each resource type; short token lifetimes increase refresh traffic.

## Security impact
Addresses Development Plan §8.3 "Broken authorization" and "Authentication & sessions". Main residual risks: a handler with a wrong resource-scope mapping (mitigated by negative tests per action), and misconfiguration of MFA or SSO (mitigated by secure defaults and audit).

## Sovereign deployment impact
Uses Supabase Auth features available in self-hosted GoTrue (password, TOTP MFA, hooks, SAML — verify SAML and asymmetric keys in the self-hosted spike, T-M1-D04). Application-level controls are deployment-independent.

## Suite impact
Permission namespaces per module (`core_hr.*`, `payroll.*`, …) and shared scopes let future modules plug in without changing the model; roles may bundle permissions across licensed modules.

## Verification
1. Unit tests for `authorize` and `scopeFilter` covering every scope type and edge cases (manager changes, deactivated persons, delegation windows).
2. For every action: a **positive** test and **negative** tests (no permission → 403; out of scope → 404; other tenant → 404; AAL1 when AAL2 required → step-up required).
3. Lint/test gate: all exported actions and mutating routes use `defineAction` / `defineRoute`.
4. E2E: role-restricted navigation and API access per default role (Development Plan Appendix F, J2 and J13).
5. Security review (separate pass) on every PR touching `platform-identity`, `platform-rbac` or `defineAction`.
