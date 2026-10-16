# Platform Super Admin console (runbook)

| | |
|---|---|
| **Requirement** | FR-ADM-17 (platform console); BRD §4.2: Platform Super Admin «مشرف المنصة» = ENTLAQA staff, **not** a tenant role |
| **Decisions** | PO, 16 Oct 2026: the PO's own account becomes the first Super Admin — the PO creates the Auth user **directly in Supabase** (no invitation), Claude grants Super Admin **by UID** through the **Platform admin** workflow; then, in the product, the Super Admin creates the test organization `entlaqa` and gives a **new** user its Organization Admin role with an invitation **link / code to copy** (no e-mail). UX as Kawadir ATS `(admin)/organizations` |
| **Design record** | [ADR 0013](../adr/0013-platform-super-admin.md) · migration `20261018100000_private__platform_super_admin.sql` |
| **Code** | `apps/suite/src/app/[locale]/platform/` · `apps/suite/src/auth/platform-console.ts` · `packages/platform-identity/src/platform-console.ts` · `packages/platform-db/src/platform-console.ts` · `scripts/platform-admin.sh` · `.github/workflows/platform-admin.yml` |

**One action per message.** Claude guides the PO one step at a time and waits for "done". Never paste a password, key or connection string into chat. The UID of a user is **not** secret (it identifies the account, it does not open it) — the workflow takes the UID, **never an e-mail**.

---

## 1. Make an account a Super Admin

### 1.1 The PO creates the Auth user (Supabase dashboard)

The sign-up gate (`private.before_user_created_hook`, [db-deploy.md](db-deploy.md) § Auth sign-up gate) refuses every new user without a valid invitation. A Super Admin has no invitation, so the account is created by the PO in the dashboard. In the GoTrue version we tested (v2.197.0) the dashboard's **Add user** (the Auth admin API) does **not** run the hook; if the hosted project's Auth does, the hook must be switched off for the minute it takes — **with sign-ups closed first**, so nobody else can create an account in that minute.

1. **Supabase → project `jadarat-tms` → Authentication → Users → Add user → Create new user**: your e-mail, a strong password (password manager), **Auto Confirm User: ticked** (never "Send invitation": an unconfirmed account must never exist while sign-ups are open — re-review N3) → **Create user**.
2. **Only if step 1 failed with "Sign-up is by invitation only."** (the hook ran), in this exact order:
   1. **Authentication → Sign In / Providers → User Signups → Allow new users to sign up: off** → Save. (The public sign-up endpoint is closed; the dashboard can still add users.)
   2. **Authentication → Hooks → Before User Created → disable** (do not delete it).
   3. Repeat step 1.
   4. **Authentication → Hooks → Before User Created → enable** — straight away.
   5. **Allow new users to sign up: on** → Save (invitees need it).
   6. **Authentication → Users**: sort by *Created* — the only account created in these minutes is yours. Anything else: tell Claude at once (delete it).
   7. **Claude** runs **Actions → Uptime → Run workflow**: the sign-up gate check must be green ("Sign-up is by invitation only." for a stranger).
3. Open the new user → **Copy UID** → send the UID in chat (not secret). Do not send the e-mail address.

### 1.2 Claude grants Super Admin (GitHub workflow)

1. **Actions → Platform admin → Run workflow** (branch `main`): environment `production`, mode **`plan`**, action **`grant`**, `admin_user_id` = the UID. The log ends with `platform-admin: dry run OK (grant; rolled back, nothing changed)` and the notice "the user is now a Platform Super Admin".
2. The same with mode **`apply`** → `platform-admin: apply OK (grant)`.

Refusals are clear and change nothing: a UID with no Auth user → "no Auth user with this UID (create the user in Authentication → Users first)"; an e-mail or anything that is not a UUID → refused before connecting. Granting twice is a no-op ("already a Platform Super Admin"). Every grant and revocation is written to `private.platform_audit_events` (`platform.admin.granted` / `.revoked`, the UID only, actor = the workflow).

The workflow uses the `production` environment's `DATABASE_URL` (migration role) and takes the deploy lock like **Provision organization**; it runs on `main` only. The migration `20261018100000` must be deployed first (DB deploy).

### 1.3 Revoke

Same workflow, action **`revoke`** (`plan`, then `apply`). The account keeps its organizations (if any); it loses the console at once, and the **pending** Organization Admin invitations it created stop working (the link reads as invalid; any other Super Admin can issue a new code from the console). Off-boarding an ENTLAQA employee: revoke first, then delete or ban the Auth user.

## 2. Use the console

1. Sign in on the normal page `https://<app>/en/sign-in` (two steps: e-mail, then password). A Super Admin without organizations lands on **`/en/platform`** (`/ar/platform` in Arabic). A Super Admin who is also a member of organizations sees the organization chooser with **Platform console**.
2. **Organizations** («المنظمات»): stat cards (organizations, active, Organization Admin pending), the table (name, short name, status, created, members, Organization Admin state).
3. **Create organization** («إنشاء منظمة»): short name (`^[a-z0-9-]{3,40}$`, no hyphen at either end, never changed later; `admin`, `api`, `app`, `auth`, `platform`, `www` … are reserved), name in Arabic (required), name in English, the Organization Admin's work e-mail, optional first / family names, the invitation language (English by default) → **Create organization**.
4. The success dialog shows the **code** and **Copy code** / **Copy invite link** (`/{language}/sign-up#code=…`, valid 7 days). Send it to the Organization Admin by any channel you trust (no e-mail is sent).
5. The Organization Admin opens the link, sets a password (and their name) and joins: they land in the organization as its **Organization Admin** («مدير المنشأة») and can invite everyone else from **Users**.
6. Until they join, the row action **Organization Admin link** («رابط مدير المنشأة») shows the current code again (an audited read) and **New code** («رمز جديد»): the old link stops working and the invitation gets 7 more days (after 4 codes the invitation is replaced by a new one for the same person).

**First organization (PO, 16 Oct 2026):** short name `entlaqa`, the Organization Admin = a **new** user (not the Super Admin's own account — an Organization Admin holds no other role, and the Super Admin stays outside organizations).

## 3. What the console may and may not do (security)

- **Deny by default.** `/[locale]/platform` and the three actions answer **404** to everyone who is not a Super Admin: signed-out visitors, members of any organization (including Organization Admins), any other account. The page checks on the server, before anything renders: verified claims (`getClaims`) and the **database's** answer (`private.is_platform_admin()`); create, copy code and new code also confirm the session with Auth (`getUser`, ADR 0003 §2). Every database function checks again itself (app_server connection, valid session, Super Admin).
- **No tenant claim, no tenant data.** The Super Admin's session acts in no organization; the console reads organizations only through its reviewed functions (counts and states, no people's names or e-mails). It cannot read members, people or audit trails of organizations, and it gives a role only through the invitation (Organization Admin alone).
- **Audit.** `private.platform_audit_events`: organization created, code issued, code viewed, Super Admin granted / revoked. The organization's own audit trail records `platform.tenant.created`, `platform.invitation.created` and `platform.invitation.resend_requested` with the Super Admin as actor. Never the code or an e-mail.
- **MFA** for Super Admins (FR-ADM-17) is **not enforced yet** — open PO question in ADR 0013.
- **Copied links** use the server's base URL: set `APP_BASE_URL` in the web app's environment (Vercel: Production and Preview) to the public origin, e.g. `https://tms.example.com`; without it the link uses the request's host.

## 4. Self-hosted

The same workflow logic runs anywhere: `DATABASE_URL=… DATABASE_CA_CERT=… ADMIN_USER_ID=<uid> bash scripts/platform-admin.sh plan|apply` (`ADMIN_ACTION=revoke` to revoke) as the migration role. The Auth user is created with the Auth admin API (`create-user.mjs` in `infra/docker`), which does not run the sign-up hook.
