# ADR 0003 — Authentication, authorization, permissions and data scopes

**Status:** Accepted (rev. 1 after TM-0001 review) — PR #9, 30 Sep 2026; rev. 2 (§4.7 pre-tenant actions; MFA off by default until the tenant policy ships — PO, 1 Oct 2026) — T-M1-D03, 1 Oct 2026 · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B03 · **Related:** BRD FR-IAM-01…15, FR-ADM-17, FR-WFL-02, Appendix B (roles & permission matrix), NFR-SEC-01/02/09; Development Plan §8.3; ADR 0001, ADR 0002

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
| Lockout & rate limits | All sign-in, MFA, OTP, recovery and invitation flows run through **server actions** (never directly from the browser to Auth), so application limits and per-tenant lockout apply before Supabase Auth is called; plus Supabase Auth's own rate limits | R1 |
| Bot protection | Self-hostable **proof-of-work challenge** on public forms (sign-up, sign-in after failed attempts, public certificate verification); library chosen at implementation; no third-party CAPTCHA that cannot run in-country (TM-0001 F-05) | R1 |

**Sessions**
- Cookies managed with `@supabase/ssr` **on the server only**; `HttpOnly`, `Secure`, `SameSite=Lax`, host-only. Because the browser cannot read `HttpOnly` cookies, **all authentication flows** (sign-in, MFA challenge/verify, recovery, sign-out, tenant switch) are server actions (TM-0001 F-04). Verify `@supabase/ssr` cookie options at implementation.
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
4. **Browser.** The browser never queries tenant tables directly; all data flows through server code. The only browser use of Supabase is **Realtime** (where needed, e.g., live attendance rosters): the server hands the browser a short-lived access token kept **in memory only** (`realtime.setAuth`), refreshed through a server call; channels are private and authorized by RLS. Storage objects are never readable by that token alone (ADR 0006 download grants).
5. **CSRF / origin.** Server Actions rely on Next.js's built-in Origin/Host check; cookie-authenticated route handlers that change state must verify `Origin` and reject cross-site requests. The external API (R2) uses bearer tokens, not cookies (ADR 0011).
6. **Mechanical enforcement.** A lint rule/test fails the build if any exported server action or mutating route handler in `modules/**` or `packages/platform-*/**` is not created with `defineAction` / `defineRoute`.
7. **Pre-tenant actions (rev. 2, T-M1-D03).** Sign-in, organization selection and sign-out run before a tenant (and therefore any grant) exists, so they cannot use `defineAction`. They use `definePublicAction` (`@jadarat/platform-rbac`): zod-validated input, the same error contract (ADR 0011), unexpected errors → `INTERNAL_ERROR` with a correlation id, no permission check. The CI gate allows it **only** in `apps/suite/src/auth/*.ts(x)`; every other use fails the build. The handlers call `platform-identity`, which verifies every token it acts on (strict `getUser()` before a session gains a tenant) and requires the tenant claim after selection.

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

## Implementation notes

### T-M2-03 (5 Oct 2026): system roles in code, assignments in the database
- **System roles live in code** (`packages/platform-rbac/src/system-roles.ts`): the 14 tenant roles of BRD Appendix B with their Arabic/English names, a `privileged` flag and their grants (permission + role scope `tenant` / `own` / `direct_reports` / `reports_tree` / `headed_departments`). They cannot be edited by organizations (FR-IAM-07), so versioning them with the permissions they grant avoids per-tenant permission rows and their drift. Platform Super Admin is not a tenant role (§6).
- The database keeps only what it must reference or enforce: `platform.ref_roles` (G: code, `is_privileged`; a unit test compares it with the code) and `platform.role_assignments` (T: member, role, primary flag, validity window). `roles` / `role_permissions` / `ref_permissions` (data model §2.3) arrive with custom roles (R2, FR-IAM-07 builder); R1 data scopes are fixed per system role (configurable scopes are R2, FR-IAM-08).
- **Grant loading**: `defineAction` reads the member's role assignments and the departments they head on every action (`loadMemberAuthorizationFacts`), so role changes apply on the next request; there is no per-request cache yet.
- **Who may give which role** (PO decision 5 Oct 2026, TM-0003 D-IAM-03): the application rule is `canAssignRole` (evaluated with `authorize()`: `platform.role.assign` for ordinary roles; `platform.role.assign_privileged` — high risk, AAL2 — for the privileged roles Organization Admin, HR Manager, Finance Manager, Compliance Officer, Auditor; never on one's own membership). The PO decision replaces §5's "only roles whose permissions the assigner holds": an HR Manager gives every non-privileged role, and a test keeps sensitive permissions (user/role management, organization and security settings, audit log) out of non-privileged roles.
- **Database guards** (defence in depth, review of T-M2-03): `private.check_role_assignment_actor` (no self-change; privileged roles only by an active Organization Admin; other roles only by an Organization Admin or HR Manager; system jobs never touch privileged roles) and `private.check_membership_change_actor` (the same people invite and change members' status; a member holding a privileged role only by an Organization Admin; never oneself; system jobs never change privileged members). Each organization keeps at least one active Organization Admin **without an end date** (assignment and membership triggers), so end dates cannot be used to leave it without an admin later. Role and membership changes are serialised per tenant (advisory lock) and refused outside READ COMMITTED, the only isolation level where that lock-then-check is correct. Request-path code is recognised by `current_user = authenticated`; platform operations (migrations, provisioning, reviewed definer functions) are audited separately.
- **Department head scope** uses the departments the member heads that are not deleted (inactive departments still count: they still have people).
- Provisioning gives the provisioned member the Organization Admin role, and gives it back (audited) when re-run for an active member who lost it — the recovery path for an organization without an admin. Existing active memberships were backfilled as Organization Admins (they were all created by provisioning).

### T-M2-04 (5 Oct 2026): authorized reads for pages
- **`defineQuery`** runs the same pipeline as `defineAction` (claims → tenant → zod input → `withUserTx` → grants → resource → `authorize()`) without the audit write and without the server-action marker; pages bind query definitions kept in platform packages (e.g. `platform-rbac/src/iam/users.ts`) so they are unit-tested with a fake runtime. Sensitive reads that must be audited stay actions.
- **Scoped lists** turn the grants of the query's permission into a `PersonScope` (`personScopeFromGrants(grants, permission)`) and then into SQL (`personScopePredicate`); the single-person check uses the same attributes (`personResourceAttributes`). An integration test proves both agree for every role.
- **`ctx.can(permission, target)`** answers "may the member also do X?" from the grants already loaded — `target` is a resource, `'tenant'` or `'any'` — so a page decides what else it shows (roles need `platform.role.read`, the recent activity `platform.audit.read`) instead of hard-coding it.
- **Navigation** uses `loadMemberGrants()` for display only; every page authorizes itself.

### T-M2-15a (5 Oct 2026): My profile and person write guard
- **Member permissions** (`member-permissions.ts`): `platform.profile.manage_own` is held by every active member with scope `own`, outside every role (FR-IAM-16), so My profile works for members without roles and no role widens it.
- **Own-profile actions** are `scoped` and touch only `ctx.actor.personId`; input is a strict schema (names AR/EN, mobile, interface language). E-mail and job data are read-only (PO decision 5 Oct 2026).
- **Database guard** `private.check_person_writer` (TM-0004 F-PEO-01): on the request path, `persons` and `person_employment` are written only by an active Organization Admin or HR Manager (a privileged member's record only by an Organization Admin, as for memberships), by system jobs, or — `persons` only — by the member on their own row limited to the self-service columns.
- **Password change**: the current password is checked on a cookie-less Supabase client whose session is ended at once (the user's own session is untouched), Auth sets the new password (also checking `current_password` where "require current password" is on) and every other sign-in session ends. Passwords never reach logs or the audit trail; the audit records `platform.auth.password_changed` and `platform.profile.updated` with changed field names only.

### T-M2-13 (6 Oct 2026): editing a user's details
- **One rule, two places**: `private.actor_may_manage_person(tenant, person)` is the single SQL rule "may the signed-in member change this person's record?" (Organization Admin or HR Manager in force; a privileged member's record only by an Organization Admin). The database guard `check_person_writer` and the application (`getEditableUser().mayManage`, `mayManagePerson`) both call it, so the page never offers an edit the database would refuse.
- **Edit query/action** (`iam/edit-user.ts`): permission `platform.user.update` on the person (out of scope → 404 as for reads), then the manage rule (→ FORBIDDEN). Strict input of the approved screen 2 fields; optimistic concurrency with a `"<person version>:<placement version>"` token re-checked in every UPDATE (→ `CONFLICT_VERSION`); database refusals (duplicate e-mail or employee number, manager loop or inactive manager, deleted unit) come back as field errors. The login e-mail of a member with an account is not changed here (it changes only through Auth, later). Audit `platform.user.updated` with changed field names only.
- **Profile link**: the user profile shows "Edit details" only when `ctx.can(platform.user.update, person)` and the manage rule both hold.

### T-M2-14 (6 Oct 2026): changing a member's roles
- **`ctx.access(permission, target)`** returns `allowed`, `step_up_required` (the member holds the permission but the session is AAL1) or `denied`, so a page can say what is needed instead of only hiding a control.
- **Two actions, one handler** (`iam/edit-roles.ts`): `platform.role.assign` for changes that touch only ordinary roles, and `platform.role.assign_privileged` (high risk, AAL2, strict session check) for any change that gives, removes or alters a privileged role. The ordinary action re-checks the stored roles and refuses a privileged change (STEP_UP_REQUIRED or FORBIDDEN). PO decision D-IAM-01 (6 Oct 2026): AAL2 is required even when the organization keeps MFA off, so until TOTP enrolment exists (T-M2-10) privileged roles are locked in the screens.
- **Database guard** (`check_role_assignment_actor`, migration `20261006110000`): besides "never one's own roles" and "privileged roles only by an Organization Admin", a member who holds a privileged role is managed by an Organization Admin only — every role of theirs (same rule as their record and membership).
- **Writes**: under the per-tenant role lock, only the differences are written (deletes, then rows giving up the primary slot, then the row taking it); a version token over every assignment refuses concurrent edits. Validity dates are whole days in the organization's time zone (headquarters branch, else Asia/Riyadh): a role starts at the beginning of its first day and ends after its last day.
- **Audit** `platform.user.roles_changed` with the roles before and after (role codes and days; BR-IAM-3).


### T-M2-07 (7 Oct 2026): accepting an invitation (invitee side)
- **Public page** `/[locale]/invite/accept#token=…` (screens 8 and 9): the token travels in the URL **fragment** (security review M3, 7 Oct 2026), which browsers never send to the server — so it is in no access log, proxy log or Referer header. The server renders only the page shell; a client component reads the fragment, removes it from the address bar at once (`history.replaceState`) and asks the public action `lookupInvitationAction({ token })` (token in the action body, checked against the e-mailed format — 43 base64url characters — and hashed with SHA-256 before any lookup). `private.invitation_by_token` answers `valid | expired | revoked | used | invalid` and never returns ids; for a valid link the action also says whether the visitor is signed in as the invited account, another account or not at all. The route still sends **no referrer** (`Referrer-Policy: no-referrer` for `/:locale/invite/*` and a referrer meta tag), error reports drop query strings in the browser and again in the tunnel, and the token is never logged or stored in the browser (memory only; the language switch carries it in the fragment).
- **The inviter's authority is checked again when the link is used** (security review M1): a link is `valid` and accepted only while the inviter is an ACTIVE Organization Admin, or an active HR Manager for an invitation without privileged roles (`private.invitation_inviter_may_grant`, under the per-tenant role lock). Revoking, suspending or demoting the inviter stops their pending invitations; the mailer likewise acts on `created` / `resend_requested` events only while their member actor may still manage the invitation (M2), and a resend is a database-checked request (`resend_requested_at`, same actor rules as revoking).
- **Three public actions** in `apps/suite/src/auth/invitations.ts` (`definePublicAction`; flow in `platform-identity/src/invitation-accept.ts`, framework-free and unit-tested):
  - *new account* — strict input (password 12+ characters and ≤ 72 bytes as for My profile, confirmation, optional display names ≤ 200, privacy-notice acknowledgement `true`); `valid` lookup → public Auth **sign-up** with the cookie-bound server client (publishable key; e-mail from the invitation; the raw token in the user metadata), admitted only by the before-user-created hook (ADR 0002 §7 note T-M2-07 rev. 2, security review H1 — the web app holds no Auth secret key) → the token is removed from the metadata → `private.accept_invitation_as_caller` (with the display names) in `withUserTx` with the new session's verified claims → the organization is selected for that session (refresh: token with the tenant claim, audit `platform.auth.signed_in`). Auth's answers: 403 (the hook) → "not valid"; `user_already_exists` / `email_exists` → "an account with this e-mail exists — sign in to accept"; `weak_password`, 429 → their own messages; anything else → internal error with a correlation id. A refused or failed acceptance signs the new session out again;
  - *sign in to accept* — password sign-in as the **invitation's** e-mail (never an e-mail from the form; `startPasswordSession`, no organization required), then `private.accept_invitation_as_caller` in `withUserTx` with the new session's verified claims, then the organization is selected for that session. A refusal (`INVITATION_NOT_VALID`, `INVITATION_ALREADY_MEMBER`, `INVITATION_ACCOUNT_MISMATCH`, each with its own message) or failure signs that just-created session out again (review L3);
  - *signed in already* — `getUser()`-confirmed session (sensitive operation), the session's e-mail must be the invitation's (the database checks the Auth e-mail again), then the same as above.
- A visitor signed in with **another** account sees a notice and a sign-out button (the page stays open, the link keeps working); no form is shown.
- MFA step 2 of screen 8 is not built yet (MFA is off by default, PO 1 Oct 2026; T-M2-10).
- **Sign-ups are open in Auth, gated by the hook** (rev. 7 Oct 2026, review H1): unlike sign-in, the sign-up endpoint can be called directly from the internet, not only through our server action; the hook refuses every sign-up without a valid invitation token for that e-mail (threat model and checks: ADR 0002 §7 note T-M2-07; hosted settings and their safe order: `docs/engineering/db-deploy.md` § Auth sign-up gate).
- **Orphan Auth users** (review L2): if the invitation changes between the sign-up (the hook checked it) and `accept_invitation_as_caller`, the new Auth user has no membership. The flow logs `reason=orphan_auth_user` with the Auth user id and the link's state (no e-mail, no names); the runbook is in `docs/engineering/invitations-contract.md` § Operations.

### T-M2-08 (7 Oct 2026): forgot / reset password
- **Supabase Auth's own recovery**, two public actions in `apps/suite/src/auth/password-reset.ts` (flow in `platform-identity/src/password-reset.ts`, framework-free and unit-tested). Both run on a **stateless** Supabase client (publishable key, session in memory only, implicit flow — no PKCE, which does not protect the token-hash path): the recovery session never reaches the browser or the session cookies. Runbook and GoTrue spike findings: `docs/engineering/password-reset.md`.
- **No account enumeration** (NFR-SEC-01): the request action always answers the same after a constant 1.5 s and never waits for Auth (`after()`), because Auth itself tells accounts apart (an existing account is answered later, and with 429 on a repeat within a minute). Auth's errors are logged as codes and treated as success; the address is never logged. Application limits per trusted client address (IPv6 by /64) and, for an allowed client, per account (HMAC of the address under a random per-process key) apply before Auth (in memory, evicting rather than refusing when full, until the shared limiter of ADR 0011 §4).
- **Link**: the e-mail links to `/{ar,en}/reset-password#token_hash=…&type=recovery`; the token is in the URL fragment (as for invitations, review M3), the page verifies nothing on load (link scanners cannot spend it), removes the fragment and sends the token with the new password. Order on the server: password rules (zod, before the single-use link is spent) → `verifyOtp(recovery)` → `updateUser(password)` → `signOut(global)` (every session of the account, the recovery session included) → security log `platform.auth.password_reset` (user id only; no tenant audit row — no tenant session exists) → the visitor signs in with the new password. A password Auth refuses after the link was spent ends the recovery session and asks for a new link with the reason; expired, used, unknown links and banned accounts get one answer. `Referrer-Policy: no-referrer` for the page; error reports drop fragments. Auth's link token hash is `sha224(e-mail + one-time code)`, so the code length is GoTrue's maximum, 10 digits, in every environment (security review H, 7 Oct 2026 — 6 digits are guessable offline once the address is known).
- Auth sends the reset e-mail and a "password changed" notice itself (ADR 0008 implementation note T-M2-08) — or, with the web app's server setting `PASSWORD_RESET_DELIVERY=worker` (T-M2-17), our notification service does: the action queues the request unconditionally in the database, the worker creates the token through Auth's admin API (the key exists in the worker only, ADR 0002 §7 note T-M2-17) and e-mails it in the organization's language and brand; after a completed reset and after a My profile change the "password changed" notice is queued too (never failing the change). The link, the page and the completion are the same in both modes (`docs/engineering/password-reset.md`).
