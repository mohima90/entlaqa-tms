# Production set-up from a brand-new Supabase project (runbook)

| | |
|---|---|
| **Decision** | PO, 15 Oct 2026: **start Supabase over** — a new, clean Supabase project in the new ENTLAQA organization on the **Pro** plan becomes **production**; all migrations are applied fresh; the old project `jadarat-tms-staging` is deleted only after production works |
| **Backlog** | `EP-OPS`: T-M2-36 (production naming in the workflows), T-M2-37 (this set-up), T-M2-38 (automatic DB deploy) |
| **New project** | Name `jadarat-tms` · region **Central EU (Frankfurt) `eu-central-1`** (next to Vercel `fra1`) · organization **`ENTLAQA-Products`** · project ref **`pbmzlxljyjsvrzvkklbg`** |
| **Collected from** | [db-deploy.md](db-deploy.md), [staging-sign-in.md](staging-sign-in.md), [password-reset.md](password-reset.md), [background-jobs.md](background-jobs.md), [email.md](email.md), [files.md](files.md) §7, [observability.md](observability.md), [sign-in-protection.md](sign-in-protection.md) §9, [user-import.md](user-import.md) §4, `.github/workflows/uptime.yml` |

**How to use it.** The Product Owner (PO) follows the steps in order, **one at a time**; Claude guides each step in chat and waits for "done". Steps marked **PO** need the PO's accounts: Claude's container **cannot reach `*.supabase.co`** (egress policy) and has no access to the Vercel team or to GitHub secrets. Steps marked **Claude** are done by Claude (code, reading GitHub Actions logs, documentation). **Never paste a password, key or connection string into chat** — they go only into the password manager, GitHub environment secrets and Vercel environment variables. This page lists **names only, never values**.

**Nothing is copied from the old project.** Organizations and test people are created again (step 32); the old project keeps working until step 40.

---

## A. Before you start

1. **Claude** — Make sure T-M2-36 is merged: the workflows **DB deploy** and **Provision organization** offer the environment `production`, and the jobs workflow uses the environment `production-jobs`. (Until then the steps below that run a workflow cannot target the new project.)
2. **PO** — Open the password manager and create one entry "Jadarat TMS production" to keep everything generated below.

## B. Create the Supabase project (PO)

3. **Supabase dashboard → organization switcher → the new ENTLAQA organization** (`ENTLAQA-Products`, plan **Pro**). Check that your Supabase account has MFA on (Account → Security).
4. **New project**: name `jadarat-tms`; **Region: Central EU (Frankfurt)**; **Database password → Generate**, then save it in the password manager (it is the `postgres` password, used only in step 11). Under advanced options: **Postgres** (not OrioleDB); **Data API: off** ("Enable Data API" unticked); **automatic RLS / expose new tables: off** (our migrations enable and force RLS on every table). Do **not** connect the project to GitHub. → **Create**.
5. **Project Settings → Data API**: confirm it is **off**.
6. **Project Settings → JWT Keys**: confirm the project uses **asymmetric signing keys** (ECC P-256 / RSA; new projects do by default).
7. Note the **project ref** (the part before `.supabase.co` in the Project URL) and tell Claude — it is not secret. **Claude** writes it into this page, `CLAUDE.md`, `STATUS.md` and [db-deploy.md](db-deploy.md).
8. **Database → Settings → SSL Configuration → Download certificate** (keep the file; its full text is the `DATABASE_CA_CERT` value below — a public certificate, not a secret).

## C. GitHub environment `production` — database deploy (PO)

9. **GitHub → repository → Settings → Environments → New environment** `production` → **Deployment branches and tags → Selected branches → add `main`** (mandatory). **No required reviewers** (the automatic deploy after merge must not wait — PO decision 15 Oct 2026).
10. Generate **three new role passwords** in the password manager (≥ 40 characters, letters, digits, `-` and `_` only; length 48 with symbols off): for `app_server`, `app_worker`, `app_queue`. New project → new passwords.
11. **Environment secrets** of `production` (names only):

| Name | What it is |
|---|---|
| `DATABASE_URL` | Supabase **Connect → Session pooler** URI (user `postgres.<ref>`, port 5432) with the database password of step 4, no `?…` parameters |
| `APP_SERVER_DB_PASSWORD` | Step 10, `app_server` |
| `APP_WORKER_DB_PASSWORD` | Step 10, `app_worker` |
| `APP_QUEUE_DB_PASSWORD` | Step 10, `app_queue` |

12. **Environment variable** of `production`: `DATABASE_CA_CERT` = the whole text of the certificate of step 8 (including the BEGIN/END lines).

## D. Database deploy (PO runs, Claude reads the logs)

13. **Actions → DB deploy → Run workflow** (branch `main`), environment `production`, mode **`plan`**. **Claude** reads the run log: PostgreSQL version, every migration listed, dry run rolled back, no error.
14. Same workflow, same `main` commit, mode **`apply`**: all migrations, role passwords set, `verify-deployment.sql` passes. **Claude** checks the log (no warnings expected). Once T-M2-38 is built, later migrations deploy automatically after each merge.

## E. Supabase Auth settings (PO)

15. **Authentication → Hooks → Add hook → Customize Access Token (JWT) Claims → Postgres** → schema `private`, function `custom_access_token_hook` → enable. (Without it, sign-in stops at "This service isn't set up…".)
16. **Authentication → URL Configuration → Site URL** = the production web address (e.g. `https://jadarat-tms.vercel.app`, or the custom domain when it exists).
17. **Authentication → Sign In / Providers → Email**:
    - *Email OTP Length* = **10**; *Email OTP Expiration* = **3600**;
    - *Minimum password length* = **12**; password character requirements: none (PO, 6 Oct 2026);
    - *Require current password when updating* = **on**; *Secure password change* = **on**;
    - **Prevent use of leaked passwords** = **on** (Pro plan);
    - leave *Confirm email* as it is for now (step 25 turns it off).
18. **Authentication → Multi-Factor**: TOTP (authenticator app) **enroll and verify enabled**; phone and WebAuthn **disabled**.
19. **Authentication → SMTP Settings → Enable custom SMTP** with **Resend**: host, port **465** and username as shown in Resend's SMTP settings; password = a Resend API key with **sending access only** (from the Resend account holder — never in chat); sender address and name as on the old project (today `noreply@lms.entlaqa.com`, «ENTLAQA LMS»; a dedicated TMS sending subdomain is the planned follow-up); *Minimum interval between emails per user* = **60** seconds.
20. **Authentication → Emails → Templates → Reset password**: subject and body from the repository file `supabase/templates/recovery.html` (subject «إعادة تعيين كلمة المرور · Reset your password»). **Security notifications → Password changed**: **on**, body from `supabase/templates/password-changed.html`, subject as on the old project (copy it from the old project's Emails page before step 40). (Both are Auth's mailer while `PASSWORD_RESET_DELIVERY` is `auth` — [password-reset.md](password-reset.md) §5–§6.)
21. **Authentication → Rate Limits**: *Rate limit for sign ups and sign ins* = **300** per 5 minutes; *token verifications* = **150** per 5 minutes; *sending emails* = **100** per hour; *token refreshes*: leave the default (reviewed with RR-IAM-01, [sign-in-protection.md](sign-in-protection.md) §9). Leave "IP address forwarding" **off**.
22. **Authentication → Sessions** (Pro): time-box and inactivity timeout — values to be agreed with Claude first (the database already enforces each organization's own limits; this is only an outer bound, risk R-36). Skip until agreed.

## F. The sign-up gate (invitations) — in this order (PO)

23. **GitHub → Settings → Secrets and variables → Actions → Variables** (repository level, not an environment): `SUPABASE_URL` = `https://<new ref>.supabase.co`, `SUPABASE_PUBLISHABLE_KEY` = the new project's publishable key (`sb_publishable_…`, public by design; Project Settings → API Keys). The uptime check then watches the gate from the first minute.
24. **Authentication → Hooks → Add hook → Before User Created → Postgres** → schema `private`, function `before_user_created_hook` → enable.
25. **Authentication → Sign In / Providers → Email → Confirm email: off** → Save (the Email provider itself stays enabled).
26. **Authentication → Sign In / Providers → User Signups → Allow new users to sign up: on**; *anonymous sign-ins*: **off**; Phone provider: **disabled**. Rules and roll-back: [db-deploy.md](db-deploy.md) § Auth sign-up gate.

## G. Storage (PO)

27. **SQL editor** (read-only query): `select distinct usename from pg_stat_activity where usename like 'supabase_storage%';` → must show `supabase_storage_admin` (anything else: stop and tell Claude — uploads would be refused).
28. **Storage → Settings**: **S3 connection off** and no S3 access keys; **Image transformation off** (where the plan offers it).

## H. GitHub environment `production-jobs` — background worker and e-mail (PO)

29. **New environment** `production-jobs` → deployment branches: **`main` only**. Then **Supabase → Project Settings → API Keys → Secret keys → Add new secret key** named `worker-production` (shown once — straight into GitHub, never Vercel).

| Kind | Name | What it is |
|---|---|---|
| Secret | `DATABASE_URL_APP_QUEUE` | Session pooler URI (port 5432) with user `app_queue.<ref>` and its password from step 10 |
| Secret | `DATABASE_URL_APP_WORKER` | Same with user `app_worker.<ref>` |
| Secret | `RESEND_API_KEY` | Resend API key with sending access |
| Secret | `EMAIL_TEST_TO` | Address that receives the test e-mail |
| Secret | `SUPABASE_SECRET_KEY` | The `worker-production` secret key above |
| Variable | `DATABASE_CA_CERT` | Same certificate text as step 12 |
| Variable | `EMAIL_PROVIDER` | `resend` |
| Variable | `EMAIL_FROM_NAME`, `EMAIL_FROM_ADDRESS` | The sender (as step 19) |
| Variable | `APP_BASE_URL` | The production web address (https, no path) |
| Variable | `SUPABASE_URL` | `https://<new ref>.supabase.co` |
| Variable (optional) | `FILE_SCANNING` | `on` to scan uploads in each pass ([files.md](files.md) §7) |
| Variables (optional) | `FILE_ORPHAN_SWEEP`, `USER_IMPORT_INVITATION_INTERVAL_MS`, `USER_IMPORT_DAILY_INVITATIONS`, `USER_IMPORT_TRIAL_DAILY_INVITATIONS` | Leave unset for the defaults ([user-import.md](user-import.md) §4) |

30. **Actions → Jobs → Run workflow** (branch `main`), mode **`test-email`** → the test e-mail arrives at `EMAIL_TEST_TO`; then mode **`pass`** → green, log shows `worker starting (once)`, `reset links: on`, `worker stopped`. **Claude** reads both logs. (The continuously running production worker host is still a PO cost decision before the first customer — ADR 0005 §1; until then the scheduled pass runs every few minutes to hours.)

## I. Vercel (PO)

31. **Vercel → project `jadarat-tms` → Settings → Environment Variables** — set for **Production** and **Preview** (previews share the production database while there are no customers — accepted risk R-62):

| Name | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<new ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The new publishable key |
| `DATABASE_URL_APP_SERVER` | **Transaction pooler** URI (port **6543**) with user `app_server.<ref>` and its password from step 10 — mark **Sensitive** |
| `DATABASE_CA_CERT` | Same certificate text as step 12 |
| `JADARAT_ENVIRONMENT` | `production` |
| `SENTRY_DSN` (and `SENTRY_BROWSER_DSN` if used) | Unchanged |
| `PASSWORD_RESET_DELIVERY` | Leave **unset** (= `auth`) until a worker runs continuously ([password-reset.md](password-reset.md) §6) |

Never in Vercel: `SUPABASE_SECRET_KEY`, any worker or queue connection, `JADARAT_AUTH_CLIENT_HEADER`. Then **Deployments → latest production deployment → Redeploy** (variables apply to new deployments only).

## J. First organization (PO)

32. **Supabase → Authentication → Users → Add user → Create new user**: your e-mail, a strong password, **Auto Confirm User** ticked (never "Invite user"). Open the user and copy the **UID** (not secret).
33. **Actions → Provision organization → Run workflow**: environment `production`, mode **`plan`**, organization short name (e.g. `entlaqa-demo`), Arabic name, English name, the UID; then the same with mode **`apply`**. **Claude** reads both logs.

## K. Checks (PO, Claude reads the results)

34. Open `https://<app>/api/health/ready` → `ok`.
35. Sign in at `https://<app>/en/sign-in` → the header shows the organization's name; sign out → back on sign-in; `/en/suite` redirects to sign-in.
36. **GitHub → Settings → Variables** (repository): `UPTIME_URL` = the production web address. **Actions → Uptime → Run workflow** → both jobs green (readiness, and the sign-up gate refusing strangers with "Sign-up is by invitation only.").
37. In the product: invite a test person with an address you can read → the invitation e-mail arrives (after the next worker pass, or run **Jobs** by hand) → accept, set a password, signed in. Then «Forgot password?» with your own account → reset e-mail → new password works, exactly one "password changed" notice.
38. **Actions → DB deploy → `plan`** again → "nothing pending".

## L. Retire the old project (PO, only after section K is green)

39. **Claude** updates `CLAUDE.md`, `STATUS.md`, this page and [db-deploy.md](db-deploy.md) with the new ref and organization name, and removes the `staging` choices from the workflows (follow-up of T-M2-36).
40. **PO**: copy anything still needed from the old project (the *Password changed* subject, step 20), then **Supabase → old project `jadarat-tms-staging` → Project Settings → General → Delete project**; delete the old Free organization `entlaqa-TMS` if empty; **GitHub → Environments → `staging` and `staging-jobs` → Delete** (removes their secrets); revoke the old project's worker secret key and the old Resend SMTP key if it was separate.
