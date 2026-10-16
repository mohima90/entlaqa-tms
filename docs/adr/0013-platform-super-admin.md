# ADR 0013 — Platform Super Admin console and grant

**Status:** Proposed · **Date:** 16 Oct 2026 · **Requirement:** FR-ADM-17; BRD §4.2 (Platform Super Admin «مشرف المنصة» = ENTLAQA staff, not a tenant role) · **Related:** ADR 0002 (§5–§7 roles, RLS, claim validation), ADR 0003 (§2 claims, getUser for sensitive operations), invitations contract §0 (codes), [runbook](../engineering/platform-console.md) · **Migration:** `20261018100000_private__platform_super_admin.sql`

## Context

- Production starts empty (PO, 15 Oct 2026). Until now an organization and its first administrator were made by an operator through the **Provision organization** workflow, which needs an existing Auth user for the administrator — and the sign-up gate admits new users only with an invitation.
- PO, 16 Oct 2026: do it **the Kawadir ATS way**. The PO's own account becomes a **Platform Super Admin** (created directly in Supabase, granted by UID through a GitHub workflow); from the product the Super Admin creates the organization (`entlaqa`) and gives a **new** user its Organization Admin role with an invitation **link / code to copy** — no e-mail.
- A Super Admin is not a member of any organization: the session has **no tenant claim**, so `defineAction` (which requires one) and every `tenant_isolation` policy (which return nothing without one) do not apply.
- An invitation is valid only while its inviter may still give its roles — an ACTIVE Organization Admin of the organization (review M1). A new organization has no member, so that rule cannot admit its first Organization Admin.

## Options considered

1. **Super Admin as a tenant role** (e.g. a membership in every organization) — rejected: BRD §4.2 says it is not a tenant role; it would put ENTLAQA staff in every organization's people and audit data and break BR-IAM-4 checks.
2. **Keep operator provisioning only** (Provision organization workflow) — rejected by the PO for the product flow: it needs the administrator's Auth account first and exposes no console.
3. **A BYPASSRLS / service-role path in the web app** — rejected: the web app holds no Auth secret key (ADR 0002 §7) and never bypasses RLS.
4. **A reviewed set of SECURITY DEFINER functions owned by a NOLOGIN guard role, callable by `app_server` with verified user claims of a Super Admin; Super Admins granted by UID from a workflow** — chosen (the pattern of `tenant_guard`, `invitation_guard`).

## Decision

1. **Data.** `private.platform_admins` (user id → `auth.users`, `granted_at`, `granted_by`), `private.platform_invitations` (the invitations the console created) and `private.platform_audit_events` (append-only, ids only). Schema `private`, not `platform`: they are not tenant tables (every `platform` table carries the tenant isolation policy — catalog test, `verify-deployment.sql` check 3). RLS forced; no application role has any privilege on them.
2. **Guard role `platform_admin_guard`** (NOLOGIN, NOINHERIT, no BYPASSRLS, nobody acts as it) owns the console's functions and reaches the platform tables through explicit column grants and policies `to platform_admin_guard` only: organizations (read; insert active), their default settings and security policy (the tenant triggers), the Organization Admin's person and invitation (insert; code; revoke and replace after 4 codes), memberships and role assignments (read, for counts and the Organization Admin's state), the organization's audit trail (insert of three allow-listed actions).
3. **Caller check, in the database, in every function:** `session_user = app_server`, user claims (`role = authenticated`), a valid session (`private.user_session_is_valid`: exists, not ended, not expired, at most 24 h old) and the user in `private.platform_admins`. Anything else: 42501 (`private.is_platform_admin()` answers false and never raises). No tenant claim needed.
4. **Functions.** `is_platform_admin()`, `platform_list_tenants()` (no personal data: names of organizations, status, counts, Organization Admin state `active | pending | expired | none`), `platform_create_tenant(…)` (validates again; creates the organization exactly as provisioning does, the person and a pending invitation with the **Organization Admin role alone**, its first code; returns the code), `platform_admin_invitation_code(tenant)` (audited read), `platform_reissue_admin_code(tenant)` (new code; after 4 codes a replacing invitation). `grant_platform_admin(uid)` / `revoke_platform_admin(uid)`: EXECUTE for the migration role only — the **Platform admin** workflow (`scripts/platform-admin.sh`, plan = rolled-back dry run, deploy lock, UID only).
5. **Console invitations** are valid while their **issuer is still a Super Admin** and they give the Organization Admin role alone (`private.invitation_issuer_may_grant`, used by the link's state and by acceptance); every other invitation keeps the inviter rule unchanged. Revoking a Super Admin stops their pending console invitations. The invitee joins through the existing sign-up page, hook (that e-mail only) and acceptance. Code issuing is one shared step (`private.write_invitation_code`) for the tenant path and the console.
6. **Web app.** Public actions (`apps/suite/src/auth/platform-console.ts`, the reviewed place for pre-tenant entry points) with strict zod input; the checks are in `@jadarat/platform-identity` (`platform-console.ts`): verified claims (`getClaims`), **`getUser` before create / copy code / new code** (ADR 0003 §2), and the database's decision. Everyone else gets **404** for `/[locale]/platform` and every action. Sign-in: a Super Admin without organizations lands on `/[locale]/platform`; with organizations, the chooser offers "Platform console". Copied links use the server's base URL (`APP_BASE_URL`, else the request host).

## Consequences

- **Positive:** the PO creates organizations and their administrators from the product, the Kawadir way, without e-mail and without operator access; the web app gains no secret and no RLS bypass; every platform action is audited; the grant needs repository write access **and** the `main`-only `production` environment.
- **Negative:** the console's functions are a cross-tenant surface (listed, owned and checked in `verify-deployment.sql`, the catalog test and pgTAP 95/96; security review required on any change). A code is a bearer credential shown to the Super Admin (same trade-off as invitation codes, contract §0). The organization's audit trail names an ENTLAQA account id as actor of its creation (ids only).
- **Open — PO question (TODO):** FR-ADM-17 requires **MFA for the Super Admin**. Not enforced now (PO, 15 Oct 2026: no extra authenticator layers for now). Before production organizations other than test ones exist, decide: require an authenticator code (AAL2) for the console (the database can check `private.request_aal2()` in `platform_admin_caller`), or record the accepted risk.
- **Later (FR-ADM-17 rest):** plan / limits / status changes, feature flags, health, announcements, impersonation with reason and banner, platform settings (e-mail provider) — each a new reviewed function on this guard.

## Security impact

Deny by default at three layers (page/action → identity flow → database function). No tenant claim is ever forged or widened: the console never sets `tenant_id`; tenant tables stay unreadable to the Super Admin's session (pgTAP 96: no rows without a tenant claim). The guard has no BYPASSRLS, no table-wide privilege on tenant tables, no CREATE, owns no relation. Inputs are validated in the web app and again in the database (short name, names, e-mail, language, reserved names). Codes never reach logs or audit data. The workflow takes a UID only (no personal data in run inputs).

## Sovereign deployment impact

None: plain PostgreSQL functions and a shell script (`scripts/platform-admin.sh`) that run the same on a self-hosted stack; no vendor-only feature. Creating the Super Admin's Auth user self-hosted uses the Auth admin API (`infra/docker/create-user.mjs`).

## Suite (multi-module) impact

The console is a platform service (`packages/platform-identity`, `packages/platform-db`, schema `private`); later suite modules add their platform operations as new functions on the same guard, never by reading module tables directly.
