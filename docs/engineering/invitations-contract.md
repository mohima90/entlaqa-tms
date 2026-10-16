# Invitations (T-M2-07) — build contract

Shared contract for the parallel build of T-M2-07 (FR-IAM-03; screens 2, 7, 8, 9 in `docs/design/screens/m2-users-roles/`). Each track builds against the names and shapes below; changes go through the tech lead. Once T-M2-07 is merged this file becomes the design record (moved into ADR implementation notes).

## 0. Revision 2 — invitation codes, as Kawadir ATS (PO decision 16 Oct 2026)

> "Implement what is in Kawadir ATS for sign-in and invitation exactly. No need to send e-mail — a copyable link like Kawadir." Migration `20261018090000_platform__invitation_codes.sql`. Where §§1–5 below differ, this section wins.

| | Before (rev. 1) | Now (rev. 2) |
|---|---|---|
| Link secret | 43-character token (32 random bytes) issued by the **mailer job**; only its SHA-256 stored | **8-character code** of `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (40 random bits, `gen_random_uuid()`'s strong bytes) issued by the **database** when inviting and on resend; stored as `invite_code` **and** `token_hash = sha256(code)` (the hook, link lookup and acceptance keep using the hash) |
| Who sees it | Only the e-mail | The members who may **manage** that invitation, at any time: Organization Admin all; HR Manager only invitations without a privileged role (per-row rule of inviting) — through `private.invitation_codes()`; never readable from the table by `authenticated` (no column grant); `token_hash` unreadable as before |
| Link | `/{locale}/invite/accept#token=…` | `/{locale}/sign-up#code=CODE` (fragment, review M3); the old route forwards `#token=` links to it in the browser |
| E-mail | Required for the invitee to get the link | **Optional**: the mailer (when e-mail is on) e-mails the *current* code's link (`private.invitation_code_for_mail`, app_worker system claims) and changes nothing |
| Resend | Request; the mailer issued a new token | `private.issue_invitation_code`: **new code, old one stops working, 7 more days**; at most 4 codes (first + 3 resends); copying is not a resend |
| Import invitations | Mailer issued the first token on release | The **release** (lifecycle trigger, worker) issues the first code — «إرسال الدعوات (N)» gives codes without e-mail |
| Lookups | Per client and per link; failed open | Per client and per code (its hash), **plus unknown codes per client** (20 per 15 min, shared clients 500; real invitations give their miss back) on every invitation action; **fail closed** |

### Database (`20261018090000`)

- `platform.invitations.invite_code text` — check `^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$` and `token_hash = sha256(convert_to(invite_code,'UTF8'))`; unique (`invitations_invite_code_uq`). `UPDATE (token_hash)` revoked from `authenticated` (the request path writes no token hash; the mailer issues none).
- `private.issue_invitation_code(id) → text` (SECURITY DEFINER, owner `invitation_guard`): `session_user = app_server`, user claims validated by `private.current_tenant_id()`, tenant role lock, the invitation of that tenant pending and sent (not held), actor = `private.invitation_inviter_may_grant(tenant, caller, roles)` (Organization Admin; HR Manager for ordinary roles), `send_count < 4`; retries a code collision. Errors: `42501` (caller/actor) → `ROLE_NOT_ALLOWED`, `JI004` → `limit_reached`, `JI005` → `not_pending`. The lifecycle trigger lets only `invitation_guard` (or a platform operation) set `invite_code` and derives `token_hash`, `token_issued_at`, `send_count + 1`, `expires_at = now() + 7 days` from it.
- `private.invitation_codes(ids uuid[] default null) → (invitation_id, invite_code)` — same caller check; pending, sent invitations of the caller's tenant the caller may manage (per row).
- `private.invitation_code_for_mail(id) → text` — `session_user = app_worker`, system claims of an active tenant; pending, sent invitations only.
- `private.new_invitation_code()` — SECURITY INVOKER generator (no table access); used by the issuer and by the trigger on release.
- Sign-up gate: `before_user_created_hook` / `invitation_allows_signup` accept an 8-character code (exact case) or a legacy 43-character token; everything else as §4.
- Tests: `92_invitation_codes_app_server.sql` (issue/rotate/read; HR vs privileged; learner; other tenant; forged tenant claim; expired session; no claims; revoked/accepted/unknown; limit 4; rotation invalidates the old code; legacy token replaced), `93_invitation_codes_app_worker.sql` (mailer read only), `94_invitation_codes_owner.sql` (generator alphabet and spread, constraints, uniqueness, the hook with codes, rotation at the gate), adapted `36`, `37`, `88`; catalog and `verify-deployment.sql` list the new definer functions and column privileges.

### Web

- Admin (`/[locale]/suite/admin/users/invite`): after inviting, a panel with the **code (Copy code)** and **Copy invite link** (`${window.location.origin}/${invitation locale}/sign-up#code=…`), "Go to invited users", "Invite another user". Invited tab: Kawadir pending-invite rows with the code chip, copy code / copy link (announced in an `aria-live` status), «إعادة إرسال الدعوة» (new code) and «إلغاء الدعوة». The actions return the code to the member only; audit records never carry it.
- Invitee (`/[locale]/sign-up`, Kawadir's "join" screen): the code from the fragment (read, removed from the address bar, locked) or typed (upper-cased, looked up once complete, 500 ms pause); organization name; the invited e-mail filled in and locked; display names; password + confirmation with the live rules; privacy acknowledgement; «انضم إلى {organization}» → hook-gated sign-up → acceptance → signed in (as §1 step 5). "Already have an account? Sign in" and the "sign in to accept" / "accept as the signed-in invitee" paths unchanged. Sign-in page: «لديك رمز دعوة؟ انضم بالرمز» → `/sign-up`.
- `Referrer-Policy: no-referrer` for `/:locale/sign-up` (and `/:locale/invite/*`).

### Security trade-offs (for the security review)

1. **The code is a bearer credential visible to managers.** With "Confirm email" off, whoever holds a valid code can create the invitee's account with a password of their choice (the hook still binds the code to the invitation's e-mail). That is Kawadir's model and the PO's decision; it is limited to the members who may manage that invitation (an HR Manager never sees the code of a privileged invitation), and the acceptance still re-checks inviter authority, person, tenant and e-mail.
2. **40 bits instead of 256.** Brute force is bounded by the unknown-code budget per client (20 / 15 min, fail closed) on every invitation action, the per-code and per-client lookup budgets, Auth's own sign-up limits, the e-mail binding at the gate and the 7-day life of a code.
3. **The code is stored in clear** (`invite_code`) so it can be copied at any time; `token_hash` remains the lookup key. Codes are excluded from audit data and logs; the queued e-mail carries it until sent (content removed then, as before).

## 1. Flow

1. **Invite** (web, `defineAction`, permission `platform.user.invite`): in the user's transaction create the person (+ employment), the invitation (`pending`, no token yet, `expires_at = now() + 7 days`) and emit `com.entlaqa.platform.invitation.created` (subject = invitation id, no data). Audit `platform.invitation.created`.
2. **Mail** (worker, transactional subscriber `platform.invitations.mailer`, types `…invitation.created` and `…invitation.resend_requested`): acts only on events of a **member** (`actorType = 'user'`) who may still manage the invitation — current roles, privileged invitations by an Organization Admin only (`invitationActorMayManage`, security review M2); then in the tenant's system transaction generate a random token (32 bytes, base64url), store **only its SHA-256** (`token_hash`) with `token_issued_at = now()`, `expires_at = now() + 7 days`, `send_count + 1`; build `acceptUrl = ${APP_BASE_URL}/${locale}/invite/accept#token=<token>` (token in the URL **fragment**, never sent to the server — review M3); `queueEmail(tx, { template: 'platform.invitation', locale, to, variables, recipientPersonId, sourceEventId })`. The raw token exists only in the queued e-mail (removed from the delivery log once sent). A newer token replaces the older one (old links stop working).
3. **Resend** (web, `platform.user.invite`; a privileged invitation needs `platform.role.assign_privileged` like inviting with it): allowed while `pending`, not expired or expired, `send_count < 4` (first send + 3 resends): a database-checked request (`resend_requested_at`, stamped with the actor; same actor rules as revoking), then emit `…invitation.resend_requested`; audit. **Revoke** (web): `pending → revoked` (privileged invitations: Organization Admin only — `ROLE_NOT_ALLOWED` otherwise); audit; emit `…invitation.revoked`.
4. **Open link** (public page `/[locale]/invite/accept#token=…`): the server renders the page shell; in the browser the page reads the fragment, removes it from the address bar (`history.replaceState`) and calls the public action `lookupInvitationAction({ token })`, which hashes the token and calls `private.invitation_by_token(hash)` → state `valid | expired | revoked | used | invalid` plus what screen 8 shows (organization name AR/EN, login e-mail, display name AR/EN, invitation locale) and who is looking (`anonymous | invitee | other-account`). States other than `valid` render screen 9. A link is `valid` only while its inviter may still give its roles (an ACTIVE Organization Admin, or HR Manager for ordinary roles — review M1).
5. **Accept** (web, `definePublicAction` in `apps/suite/src/auth/`): input `{ token, displayNameAr?, displayNameEn?, password, confirmPassword, privacyAcknowledged: true }`. Steps: hash → `invitation_by_token` must be `valid` → **public Auth sign-up** `signUp({ email: <the invitation's>, password, options: { data: { invitation: <raw token> } } })` with the cookie-bound server client (publishable key; §4: Auth's before-user-created hook admits only a valid invitation for that e-mail) → the token is removed from the user metadata (`updateUser({ data: { invitation: null } })`) → `private.accept_invitation_as_caller(hash, display names)` with the new session → the organization is selected for that session → home (or the organization chooser). Auth's answers: 403 (hook) → `INVITATION_NOT_VALID`; `user_already_exists` / `email_exists` (a person already has an account, e.g. member of another organization) → "sign in to accept" — after sign-in the same page calls `private.accept_invitation_as_caller(hash)` (authenticated, the caller's verified user id and e-mail must match the invitation); `weak_password` → `INVITATION_PASSWORD_REJECTED`; 429 → `RATE_LIMITED`. If an acceptance is refused (`INVITATION_NOT_VALID`, `INVITATION_ALREADY_MEMBER`, `INVITATION_ACCOUNT_MISMATCH`) the session just created for it is signed out again (review L3). Display names must contain visible text (review L1). Acceptance also requires the inviter's current authority (review M1); a refusal after the account was created leaves an orphan Auth user (§6).
6. **Expire**: computed (`status = 'pending' and expires_at <= now()` reads as `expired`); no job in this slice.

## 2. Database (track A) — migration `20261009090000_platform__invitations.sql`

`platform.invitations` (tenant table, RLS forced, restrictive `tenant_isolation`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid | default `private.current_tenant_id()` |
| `person_id` | uuid not null | composite FK to persons; one open (pending) invitation per person (partial unique) |
| `email` | text not null | lowercase, = persons.email; unique among pending invitations per tenant |
| `locale` | text not null | `ar` / `en` (invitation language) |
| `primary_role` | text not null | FK `ref_roles` |
| `additional_roles` | text[] not null default '{}' | each in `ref_roles`, none equal to primary, no duplicates (trigger) |
| `status` | text not null default `pending` | `pending`, `accepted`, `revoked` |
| `token_hash` | bytea | SHA-256 of the current token; null until the first e-mail; unique |
| `token_issued_at`, `expires_at` | timestamptz | `expires_at` not null |
| `send_count` | smallint not null default 0 | 0–4 |
| `resend_requested_at`, `resend_requested_by` | timestamptz, uuid | last resend request and its member (stamped by the trigger; review M2) |
| `invited_by` | uuid not null | auth user id of the inviter (from claims) |
| `accepted_at`, `accepted_user_id`, `revoked_at`, `revoked_by` | | |
| `created_at`, `updated_at` | timestamptz | |

Policies / grants:
- **Users** (`platform.user.invite` holders, enforced in the action + DB guard `tenant_admin`/`hr_manager`, privileged roles only by `tenant_admin`, same rules as `check_role_assignment_actor`): insert pending rows (no token fields), select (never `token_hash`: column grants), update only `pending → revoked` and `resend_requested_at` (resend request, pending stays pending); a token only from system jobs (trigger).
- **Jobs** (system claims): select, update token fields / `send_count` / `expires_at` on pending rows.
- **Nobody** deletes.
- Definer functions (owner: new NOLOGIN role **`invitation_guard`**, no BYPASSRLS, explicit grants + policies `to invitation_guard`; ownership hand-over like `tenant_guard`; added to `verify-deployment.sql`, `10_catalog.sql`, hosted-sim):
  - `private.invitation_link(p_token_hash bytea)` (SECURITY INVOKER, `invitation_guard` only) — the one definition of a link's state (`valid | expired | revoked | used | invalid` plus what screen 8 shows), read by the two functions below.
  - `private.invitation_by_token(p_token_hash bytea) returns table (state text, tenant_name_ar text, tenant_name_en text, email text, display_name_ar text, display_name_en text, locale text)` — `session_user = 'app_server'` only; no claims needed; never returns ids.
  - `private.accept_invitation_as_caller(p_token_hash bytea, p_display_name_ar text default null, p_display_name_en text default null) returns uuid` (tenant id) — authenticated user claims (valid session, `private.user_session_is_valid`); the invitation must be valid (checked again under the tenant's role lock); the caller's Auth e-mail must equal the invitation e-mail (read through a security-barrier view `private.auth_user_email` (id, email) owned by the migration role, select for `invitation_guard` only — same pattern as `private.auth_session_validity`); the caller must not already be a member of that tenant. Creates the membership `active` (user_id, person_id), the role assignments (primary + additional), updates person display names if given, marks the invitation `accepted`, writes `platform.audit_events` (`platform.invitation.accepted`, actor = the new user) and emits `…invitation.accepted`. Single-use: a second call fails. It is the **only** way to accept (security review H1: no acceptance for a given user id).
  - `private.invitation_allows_signup(p_email text, p_token text) returns boolean` — EXECUTE for `supabase_auth_admin` only; hashes the raw token itself; yes only for a `valid` link with that e-mail (§4).
- `private.before_user_created_hook(event jsonb) returns jsonb` (SECURITY INVOKER, owner the migration role, EXECUTE for `supabase_auth_admin` only): Supabase Auth's sign-up gate (§4).
- pgTAP: isolation (users of tenant B see nothing), column privileges (`token_hash` unreadable by users), guard negatives (HR cannot invite with a privileged role, self-acceptance rules, revoked/expired/used/invalid states, single use, wrong e-mail user refused, `app_worker` / no claims cannot accept), job token update allowed only for pending rows; the hook with crafted Auth events (`39_invitations_signup_hook.sql`: the exact refusal for every case, `{}` only for a valid invitation and its e-mail).
- `packages/platform-db`: request-path helpers `src/invitations.ts` (`createInvitation`, `listInvitations`, `revokeInvitation`, `requestInvitationResend`, `invitationByToken`, `acceptInvitationAsCaller`) and job helpers `src/jobs/invitations.ts` (`loadInvitationForMail(tx, id)` returning everything the e-mail needs, `issueInvitationToken(tx, id, tokenHash)`).

### TypeScript signatures (tracks B, C, D code against these; track A implements them)

```ts
// @jadarat/platform-db (request path, inside withUserTx — ClaimsTx)
export type InvitationState = 'pending' | 'expired' | 'accepted' | 'revoked';
export interface NewInvitation {
  readonly email: string;               // lowercase work e-mail
  readonly firstNameAr: string; readonly familyNameAr: string;
  readonly firstNameEn?: string | null; readonly familyNameEn?: string | null;
  readonly departmentId?: string | null; readonly branchId?: string | null;
  readonly managerPersonId?: string | null; readonly employeeNumber?: string | null;
  readonly primaryRole: string; readonly additionalRoles: readonly string[];
  readonly locale: 'ar' | 'en';
}
export function createInvitation(tx: ClaimsTx, input: NewInvitation): Promise<{ invitationId: string; personId: string }>;
  // errors (thrown as DomainError codes): EMAIL_TAKEN, EMPLOYEE_NUMBER_TAKEN, ROLE_NOT_ALLOWED,
  // ROLE_CONFLICT (Organization Admin with another role, BR-IAM-4, T-M2-16; SQLSTATE JR001)
export interface InvitationRow {
  readonly id: string; readonly personId: string; readonly email: string;
  readonly displayNameAr: string; readonly displayNameEn: string | null;
  readonly primaryRole: string; readonly state: InvitationState;
  readonly sendCount: number; readonly expiresAt: Date; readonly createdAt: Date;
}
export function listInvitations(tx: ClaimsTx, filter?: { state?: InvitationState }): Promise<InvitationRow[]>;
export function revokeInvitation(tx: ClaimsTx, id: string): Promise<boolean>;            // false: not pending
export function requestInvitationResend(tx: ClaimsTx, id: string): Promise<'queued' | 'limit_reached' | 'not_pending'>;
  // throws ROLE_NOT_ALLOWED (database-checked request, review M2)
export function getInvitationRoles(tx: ClaimsTx, id: string): Promise<{ primaryRole: string; additionalRoles: string[] } | null>;
export type TokenLookup =
  | { readonly state: 'valid'; readonly email: string; readonly locale: 'ar' | 'en';
      readonly organizationName: { ar: string; en: string | null };
      readonly displayName: { ar: string; en: string | null } }
  | { readonly state: 'expired' | 'revoked' | 'used' | 'invalid' };
export function invitationByToken(tokenHash: Buffer): Promise<TokenLookup>;              // app_server, no claims
export function acceptInvitationAsCaller(tx: ClaimsTx, tokenHash: Buffer,
  displayName?: { ar?: string | null; en?: string | null }): Promise<{ tenantId: string }>;
  // throws INVITATION_NOT_VALID, INVITATION_ACCOUNT_MISMATCH, ALREADY_MEMBER
export function hashInvitationToken(token: string): Buffer;                                // sha256(utf8)

// @jadarat/platform-db/jobs (worker, SystemTx)
export interface InvitationForMail {
  readonly id: string; readonly status: 'pending' | 'accepted' | 'revoked'; readonly sendCount: number;
  readonly email: string; readonly locale: 'ar' | 'en'; readonly personId: string;
  readonly recipientName: { ar: string; en: string | null };
  readonly inviterName: { ar: string; en: string | null };
  readonly organizationName: { ar: string; en: string | null };
  readonly primaryRole: string;
}
export function loadInvitationForMail(tx: SystemTx, id: string): Promise<InvitationForMail | null>;
export function issueInvitationToken(tx: SystemTx, id: string, tokenHash: Buffer): Promise<{ expiresAt: Date } | null>; // null: not pending or limit reached
export function invitationActorMayManage(tx: SystemTx, id: string, userId: string): Promise<boolean>; // the event's member, current roles (M2)
```

Events (thin, subject = invitation id, no data): `com.entlaqa.platform.invitation.created`, `.resend_requested`, `.revoked`, `.accepted`.

## 3. Worker (track B)

`packages/platform-identity/src/jobs/invitation-mailer.ts` exporting `createInvitationMailer({ appBaseUrl, log })` (TransactionalSubscriber, name `platform.invitations.mailer`); registered in `apps/worker/src/subscribers.ts`. Env `APP_BASE_URL` (worker; https, or http only for localhost; required when e-mail is on, read in `apps/worker/src/config.ts`; `.env.example`, compose (`http://localhost:3200`), `jobs.yml` variable). Template variables from `InvitationVariables`: names from persons (`display_name_ar/en`), inviter = person of `invited_by` in the tenant, organization = tenant names, role = `getSystemRole(primary_role).name`, `expiresAt` ISO, `timeZone: 'Asia/Riyadh'` (tenant setting later), `loginEmail = email`. Skips (no error) when the invitation is no longer pending or `send_count >= 4`. Tests: unit (fake tx) + integration (real DB: created event → one queued e-mail whose accept URL token hashes to the stored hash; resend replaces the hash).

## 4. Sign-up gate — no Auth secret key in the web app (ADR 0002 §7 note T-M2-07 rev. 2, security review H1)

The web app makes **no** Auth admin call and has no `SUPABASE_SECRET_KEY` (PO decision, 7 Oct 2026; the first design's request-path exception was removed). The invitee creates their account through the **public** sign-up endpoint with the cookie-bound server client (publishable key), exactly like sign-in. Auth accepts sign-ups (hosted: "Allow new users to sign up" ON, "Confirm email" OFF; self-hosted: `GOTRUE_DISABLE_SIGNUP=false`, `GOTRUE_MAILER_AUTOCONFIRM=true`; anonymous and phone sign-ups off) and runs the **before-user-created hook** `private.before_user_created_hook` for every new user. The hook returns `{}` (admit) only when **all** hold: `user.app_metadata.provider = 'email'`, `user.is_anonymous = false`, no phone, a non-empty e-mail, `user.user_metadata.invitation` is a string of 43 base64url characters, and `private.invitation_allows_signup(email, token)` says yes (the link is `valid` per `private.invitation_link` and its e-mail is **exactly** the sign-up's — Auth sends it lower-cased; the hook does not normalise it, re-review N5). Every other case — including errors inside the hook — returns exactly `{"error":{"http_code":403,"message":"Sign-up is by invitation only."}}`: the hook API is **fail-open** (NULL, `{}` or an error without a message would admit the user). The hook has no side effects (Auth commits its transaction even on refusal) and is not atomic with the user insert, so acceptance checks everything again. The client sends the **raw** token (never a stored hash); the web app removes it from the metadata right after the sign-up. Operator provisioning (`create-user.mjs`, Auth's admin API) does not run the hook. Related guards (security re-review, 7 Oct 2026): an account's **e-mail never changes through Auth** — the trigger `jadarat_refuse_email_change` on `auth.users` refuses the self-service "change e-mail" request and its confirmation link (otherwise any signed-in account could ask for a future invitee's address and get it once that person opens the unexpected confirmation e-mail; N1); **no unconfirmed e-mail account may exist** while sign-ups are open — with "Confirm email" off Auth signs in anyone who signs up again with such an account's e-mail, without a password and without the hook (N3; our flows never leave one: the sign-up and OTP/magic-link paths create users confirmed; checked by the self-hosted smoke and the rollout runbook); `withUserTx` forwards only `sub`, `role`, `session_id`, `tenant_id`, `person_id` and `aal` (plus the derived `code_at`, T-M2-10) to PostgreSQL, so the sign-up metadata (and the raw token) never reaches the database session (N5). Hosted rollout and rollback order, and the staging uptime check that proves the gate refuses a sign-up without an invitation: `docs/engineering/db-deploy.md` § Auth sign-up gate. Security review required on every change to the hook or the accept flow.

## 5. Web (tracks C and D)

- **C — admin side:** page `/[locale]/suite/admin/users/invite` (screen 2: work e-mail, first + family name AR (EN optional), department, branch, direct manager list, employee number, primary role + additional roles, invitation language, 7-day/resend notice, MFA notice for roles that require it later); actions in `packages/platform-rbac/src/iam/invitations.ts` (`inviteUser`, `resendInvitation`, `revokeInvitation`) wrapped in `apps/suite/src/actions/invitations.ts`; users list `invited` tab shows invitations (pending / expired with «انتهت الدعوة»), resend inline (≤ 3), revoke, banner for expired invitations (screen 1); i18n `invitations` namespace AR/EN (glossary #146); E2E (Arabic + English) on the self-hosted stack: invite → Mailpit has the e-mail.
- **D — invitee side:** `/[locale]/invite/accept` (screen 8: login e-mail read-only, display name editable, live password rules — 12+ characters, ≤ 72 bytes, privacy-notice acknowledgement), states page (screen 9: expired → "ask your administrator for a new invitation", revoked, already used → sign in / forgot password, invalid), "sign in to accept" path; accept action in `apps/suite/src/auth/invitations.ts`; E2E on the self-hosted stack: read the accept link from Mailpit, accept, land signed in; expired/revoked/used states.

## 6. Operations

### Orphan Auth users after a failed acceptance (review L2)

A new account is created by the hook-gated sign-up right after the link was looked up again as `valid` (and the hook checked it once more). If the invitation changes before the acceptance (revoked, expired, the inviter lost their authority, the person changed) `accept_invitation_as_caller` refuses, the session just opened is signed out, and the Auth user is left **without any membership**: it can sign in to nothing, but it holds the invitee's e-mail and password. Each case is logged by the web app at level `warn`:

```json
{ "msg": "invitation: Auth user created but the invitation was not accepted", "action": "platform.invitation.accept",
  "reason": "orphan_auth_user", "entity_type": "auth_user", "entity_id": "<auth user uuid>", "state": "<link state now>" }
```

No e-mail or name is logged. `state = valid` means the link still works: the invitee can retry, which takes the "sign in to accept" path with the password they chose — do not delete such a user before the link has expired. Otherwise:

1. **Find** orphan Auth users (accounts that belong to no organization) — Supabase dashboard → SQL editor (hosted) or `psql` as the migration role (self-hosted):
   ```sql
   select u.id, u.created_at
   from auth.users u
   where not exists (select 1 from platform.tenant_memberships m where m.user_id = u.id)
     and u.created_at < now() - interval '7 days'      -- no link of theirs can still be valid
   order by u.created_at;
   ```
   Cross-check with the `entity_id` values of the log lines above (the query also lists accounts created by provisioning before their organization was set up — confirm before deleting).
2. **Delete** each confirmed orphan in the Supabase dashboard → Authentication → Users → the user → *Delete user* (self-hosted: Studio, same place). Nothing else references it (no membership); `platform.invitations.accepted_user_id` is only set on success.
3. If the invitee still needs access, an Organization Admin or HR Manager sends a new invitation; the invitee then creates the account again.

A lease that reserves the invitation during account creation would avoid the orphan; it is not built (cheap part only, 7 Oct 2026).

### Follow-ups (tracked)

- **Orphan accounts (re-review N2, Low — not built in T-M2-07):** the invitations list shows "account created, not yet accepted" for an invitation whose e-mail already has an Auth account without membership; a scheduled orphan-account sweep replaces the manual runbook above; offer "forgot password" on the "sign in to accept" path (T-M2-08 shipped the page `/[locale]/forgot-password`; the "already used" state links to it, the "sign in to accept" form not yet).
- **Auth e-mail corrections (re-review N1):** today only an operator can change an account's e-mail (SQL, `jadarat.allow_auth_email_change`, `docs/engineering/db-deploy.md` § Auth sign-up gate). When HR-driven e-mail changes of members are built, they go through a reviewed platform function, not through Auth's own "change e-mail" flow.
- **Unconfirmed Auth accounts (verification pass, Low):** today an operational control (rollout count must be 0, smoke assertion). Before the first real customer: a deferred constraint trigger on `auth.users` refusing an e-mail user still unconfirmed at commit, or the count query in the uptime workflow.
- **Support impersonation (ADR 0003 §6, Info):** the JWT claims allow-list (`DATABASE_CLAIM_KEYS`, `withUserTx`) must be extended and tested together with the `act_as` / `actor` claims when impersonation is built.

## 7. Shared rules

Arabic first, CSS logical properties, WCAG 2.2 AA, no names/e-mails in events or logs, audit for create/resend/revoke/accept, conventional commits referencing FR-IAM-03 / T-M2-07, every check in `pnpm check:all`, `pnpm db:test`, `pnpm db:test:hosted-sim` green.
