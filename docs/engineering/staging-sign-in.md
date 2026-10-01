# Sign-in on a hosted environment (runbook)

> Backlog: T-M1-D03 (walking skeleton) · ADR 0002 §3–§5 · ADR 0003 §1–§2, §4
> Code: `apps/suite/src/app/[locale]/sign-in`, `…/select-organization`, `apps/suite/src/auth/actions.ts` → `packages/platform-identity/src/auth-flow.ts`
> Tooling: `.github/workflows/tenant-provision.yml` → `scripts/provision-tenant.sh` → `scripts/sql/provision-tenant.sql`

Prerequisites: the database is deployed and verified ([db-deploy.md](db-deploy.md)) and the Custom Access Token hook is enabled (same runbook, step 3).

## How sign-in works

1. The user enters e-mail and password on `/{locale}/sign-in`. A **server action** calls Supabase Auth; the browser never talks to Auth and never sees a token (HttpOnly cookies).
2. The server reads the user's active organizations (`private.session_tenants()`):
   - none → the session is signed out again: "Your account isn't linked to an active organization…";
   - one → it is selected automatically;
   - several → `/{locale}/select-organization` shows a chooser.
3. Selecting an organization records it for **this session only** (`switch_active_tenant`) and refreshes the session; the Custom Access Token hook then puts `tenant_id`/`person_id` into the new token. Without that claim the flow stops (`NOT_CONFIGURED`, logged as a warning) — e.g. when the hook is disabled.
4. `platform.auth.signed_in` / `platform.auth.signed_out` are written to `platform.audit_events` (ids only).
5. Page requests carrying a session cookie go through the request proxy, which writes new cookies when the access token was about to expire and had to be rotated (it fails open: on an Auth error the page simply sees no valid session). `/suite` requires a session **with** an organization that the **database** still accepts; a token whose session was revoked, or whose membership or organization was suspended, counts as signed out (no redirect loop between the pages).

Wrong e-mail and wrong password get the same message (no account enumeration) and are logged as a warning without personal data. If Supabase Auth itself fails (outage, wrong URL or key), the user sees the "problem on our side" message with a reference id, never "wrong password". Supabase Auth's rate limit → "Too many requests in a short time" (see Known gaps).

**Multi-factor authentication** is off by default (PO decision, 1 Oct 2026). Later, each organization chooses off / optional / required, with any authenticator app (TOTP: Google Authenticator, Microsoft Authenticator, Apple Passwords, …).

## One-time setup per environment

### Vercel (Project `jadarat-tms` → Settings → Environment Variables)

| Name | Value | Environments |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase **Project Settings → Data API → Project URL** (`https://<ref>.supabase.co`) — the URL is used by Auth even though the Data API is off | Production, Preview |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase **Project Settings → API Keys → Publishable key** (`sb_publishable_…`) — public by design | Production, Preview |
| `DATABASE_URL_APP_SERVER` | Supabase **Connect → Transaction pooler** URI (port **6543**) with the user changed to `app_server.<ref>` and the password = the `APP_SERVER_DB_PASSWORD` from the password manager, no `?…` parameters. **Sensitive** | Production, Preview |
| `DATABASE_CA_CERT` | the same certificate text as the GitHub variable `DATABASE_CA_CERT` | Production, Preview |

Then **Deployments → latest → Redeploy** (environment variables apply to new deployments only). Never use the `postgres` user or the secret/service key in the app: `app_server` cannot bypass row-level security, which is the point.

### Supabase Auth (dashboard)

1. **Authentication → Sign In / Providers → Allow new users to sign up: off.** Accounts are created by administrators only (until invitations ship).
2. **Authentication → URL Configuration → Site URL:** the app's address (e.g. `https://jadarat-tms.vercel.app`).
3. **Project Settings → JWT Keys:** the project should use **asymmetric signing keys** (ECC/RSA; new projects do by default). With the legacy shared secret, sign-in still works but every request asks the Auth server (slower).

## Adding the first organization and its administrator

1. Supabase **Authentication → Users → Add user → Create new user**: e-mail, a strong password, **Auto Confirm User** ticked. Open the user and **copy the UID**.
2. GitHub **Actions → Provision organization → Run workflow** (branch `main`): environment `staging`, mode **`plan`**, organization short name (`tenant_slug`, e.g. `entlaqa-demo`), Arabic name, English name (optional), the UID. The dry run is always rolled back.
3. Same inputs with mode **`apply`**.

An organization short name that **already exists is refused** — so a typo can never put someone into another customer's organization. To add another administrator to an existing organization, tick **add_to_existing** and give the organization's names exactly as stored. A user who is already an active member: nothing changes; a user whose membership is invited/suspended/revoked is refused — change that in the application.

Recommended: GitHub → Settings → Environments → `staging` → **Required reviewers** = the PO, so every run (DB deploy and provisioning) waits for an approval click. Anyone who can run workflows on `main` could otherwise provision.

The new member gets a person record named "مدير المنشأة" / "Tenant Admin" and an **active** membership; `platform.tenant.admin_provisioned` is audited. Inputs are visible to everyone who can read the repository's Actions runs, so the workflow takes a UID — never an e-mail or a person's name.

## Checking it works

1. Open `https://<app>/ar/sign-in`, sign in with the new user → the home page shows the organization name in the header.
2. **Sign out** → back on the sign-in page; opening `/ar/suite` now redirects to sign-in.
3. A user without an organization sees "Your account isn't linked to an active organization…".

## Troubleshooting

- **The form is disabled ("Sign-in is not configured in this environment yet")**: `NEXT_PUBLIC_SUPABASE_URL` / `…PUBLISHABLE_KEY` are missing in this deployment — set them and redeploy.
- **"…a problem on our side… Reference: …" after signing in**: usually the database connection. Check `DATABASE_URL_APP_SERVER` (transaction pooler, user `app_server.<ref>`, the right password) and `DATABASE_CA_CERT`; the reference id is in the Vercel function logs.
- **"This service isn't set up in this environment yet" right after signing in or choosing the organization**: the token has no tenant claim — enable the hook (Authentication → Hooks).
- **"Your account isn't linked to an active organization"**: run the provisioning workflow for this user's UID.

## Known gaps (tracked in STATUS)

- **Rate limiting (release blocker before any real user, e.g. design partners).** All Auth calls come from the app server, so Supabase Auth's per-IP limits count the **server's** address: they do not slow one attacker down per account, and one attacker can exhaust the shared limit for everyone (including session refreshes triggered by forged session cookies). Needed: an application limiter keyed on the client IP and an e-mail hash before Supabase Auth is called (secure coding standard SCS-16; ADR 0003 §2), plus failed sign-ins as security events. Planned with the platform rate limiter (M2).
- Session lifetime: cookies follow `@supabase/ssr` defaults (long-lived); session time-box and inactivity timeout (Supabase Auth settings, Pro plan) to be set before real users.
- Switching organization from inside the suite (ADR 0002 §3): for now sign out and sign in again (M2).
- Host tenant ↔ claim tenant check (`<slug>.<base domain>`) arrives with tenant domains (ADR 0002 §4, M2).
- No password reset or invitation flow yet (M2).
