# Production set-up from a brand-new Supabase project (runbook)

| | |
|---|---|
| **Decision** | PO, 15 Oct 2026: **start Supabase over** — a new, clean Supabase project in the new ENTLAQA organization on the **Pro** plan becomes **production**; all migrations are applied fresh; the old project `jadarat-tms-staging` is deleted only after production works |
| **Backlog** | `EP-OPS`: T-M2-36 (production naming in the workflows), T-M2-37 (this set-up), T-M2-38 (automatic DB deploy) |
| **New project** | Name `jadarat-tms` · region **Central EU (Frankfurt) `eu-central-1`** (next to Vercel `fra1`) · organization **`ENTLAQA-Products`** · project ref **`pbmzlxljyjsvrzvkklbg`** |
| **Collected from** | [db-deploy.md](db-deploy.md), [staging-sign-in.md](staging-sign-in.md), [password-reset.md](password-reset.md), [background-jobs.md](background-jobs.md), [email.md](email.md), [files.md](files.md) §7, [observability.md](observability.md), [sign-in-protection.md](sign-in-protection.md) §9, [user-import.md](user-import.md) §4, `.github/workflows/uptime.yml` |

**How to use it.** The Product Owner (PO) follows the steps in order, **one at a time**; Claude guides each step in chat and waits for "done". Steps marked **PO** need the PO's accounts: Claude's container **cannot reach `*.supabase.co`** (egress policy) and has no access to the Vercel team or to GitHub secrets. Steps marked **Claude** are done by Claude (code, reading GitHub Actions logs, documentation). **Never paste a password, key or connection string into chat** — they go only into the password manager, GitHub environment secrets and Vercel environment variables. This page lists **names only, never values**.

**Nothing is copied from the old project.** Organizations and test people are created again (steps 32–33b, from the platform console); the old project keeps working until step 40.

---

## A. Before you start

0. **PO — before the PR of T-M2-36/T-M2-38 is merged:** **GitHub → repository → Settings → Environments → New environment** `production` → **Deployment branches and tags → Selected branches → add `main`** → no required reviewers, **no secrets yet**; then the same for **`production-jobs`**. (Once merged, the **Jobs** schedule and the automatic deploy would otherwise create both environments themselves, **without** the `main`-only rule.) Leave the repository variables `DB_DEPLOY_AUTO` and `JOBS_REQUIRED` **unset** until steps 14 and 30 (both are set at **repository level only**, never in an environment, where a variable of the same name would override them).
1. **Claude** — Make sure T-M2-36 and T-M2-38 are merged: the workflows **DB deploy** and **Provision organization** offer the environment `production` (the default; `staging` stays selectable until step 39), the **Jobs** workflow runs its schedule in the environment `production-jobs`, and **DB deploy (after merge)** deploys to `production` after every push to `main`. (Until then the steps below that run a workflow cannot target the new project.) Until the secrets below exist (and while `DB_DEPLOY_AUTO` / `JOBS_REQUIRED` are unset), the scheduled **Jobs** runs and the automatic deploy end green with a notice and change nothing.
2. **PO** — Open the password manager and create one entry "Jadarat TMS production" to keep everything generated below.

## B. Create the Supabase project (PO)

3. **Supabase dashboard → organization switcher → the new ENTLAQA organization** (`ENTLAQA-Products`, plan **Pro**). Check that your Supabase account has MFA on (Account → Security).
4. **New project**: name `jadarat-tms`; **Region: Central EU (Frankfurt)**; **Database password → Generate**, then save it in the password manager (it is the `postgres` password, used only in step 11). Under advanced options: **Postgres** (not OrioleDB); **Data API: off** ("Enable Data API" unticked); **automatic RLS / expose new tables: off** (our migrations enable and force RLS on every table). Do **not** connect the project to GitHub. → **Create**.
5. **Project Settings → Data API**: confirm it is **off**. Then **Authentication → Sign In / Providers → User Signups → Allow new users to sign up: off** (a new project allows sign-ups by default; nothing but the sign-up hook may let anyone in, so they stay off until step 26, after the hook of step 24).
6. **Project Settings → JWT Keys**: confirm the project uses **asymmetric signing keys** (ECC P-256 / RSA; new projects do by default).
7. Note the **project ref** (the part before `.supabase.co` in the Project URL) and tell Claude — it is not secret. **Claude** writes it into this page, `CLAUDE.md`, `STATUS.md` and [db-deploy.md](db-deploy.md).
8. **Database → Settings → SSL Configuration → Download certificate** (keep the file; its full text is the `DATABASE_CA_CERT` value below — a public certificate, not a secret).

## C. GitHub environment `production` — database deploy (PO)

9. **GitHub → repository → Settings → Environments →** `production` (created in step 0; if it is missing, **New environment** `production`) → check **Deployment branches and tags → Selected branches → `main`** (mandatory, and **before** any secret: an environment created automatically by a workflow run has no such rule). **No required reviewers** (the automatic deploy after merge must not wait — PO decision 15 Oct 2026).
10. Generate **three new role passwords** in the password manager (≥ 40 characters, letters, digits, `-` and `_` only; length 48 with symbols off): for `app_server`, `app_worker`, `app_queue`. New project → new passwords.
11. **Environment secrets** of `production` (names only):

| Name | What it is |
|---|---|
| `DATABASE_URL` | Supabase **Connect → Session pooler** URI (user `postgres.<ref>`, port 5432) with the database password of step 4, no `?…` parameters |
| `APP_SERVER_DB_PASSWORD` | Step 10, `app_server` |
| `APP_WORKER_DB_PASSWORD` | Step 10, `app_worker` |
| `APP_QUEUE_DB_PASSWORD` | Step 10, `app_queue` |

12. **Environment variable** of `production`: `DATABASE_CA_CERT` = the whole text of the certificate of step 8 (including the BEGIN/END lines).

From the moment `DATABASE_URL` exists, every merge to `main` deploys to the new project by itself (**DB deploy (after merge)**: `plan`, then `apply`; it waits for the deploy lock if a manual run is busy). Until step 14 is done, merge nothing — the first deploy is watched by hand below.

## D. Database deploy (PO runs, Claude reads the logs)

13. **Actions → DB deploy → Run workflow** (branch `main`), environment `production`, mode **`plan`**. **Claude** reads the run log: PostgreSQL version, every migration listed, dry run rolled back, no error.
14. Same workflow, same `main` commit, mode **`apply`**: all migrations, role passwords set, `verify-deployment.sql` passes. **Claude** checks the log (no warnings expected). From now on later migrations deploy automatically after each merge (**Actions → DB deploy (after merge)**); a failure opens an issue labelled `db-deploy-auto` ([db-deploy.md](db-deploy.md) § Automatic deploy after merge). Then **GitHub → Settings → Secrets and variables → Actions → Variables** (repository level only — not in the environment) → **New repository variable** `DB_DEPLOY_AUTO` = `on`: from now on a missing `DATABASE_URL` fails the automatic deploy (and opens the issue) instead of skipping it. Never re-run an old deploy run; use **Run workflow** on `main`. Lock check (Supabase SQL editor, read-only): `select count(*) from pg_locks where locktype = 'advisory' and classid = 20261015;` → **0** (no deploy lock left behind — [db-deploy.md](db-deploy.md) § Deploy lock).

## E. Supabase Auth settings (PO)

15. **Authentication → Hooks → Add hook → Customize Access Token (JWT) Claims → Postgres** → schema `private`, function `custom_access_token_hook` → enable. (Without it, sign-in stops at "This service isn't set up…".)
16. **Authentication → URL Configuration → Site URL** = the production web address (e.g. `https://jadarat-tms.vercel.app`, or the custom domain when it exists).
17. **Authentication → Sign In / Providers → Email**:
    - *Email OTP Length* = **10**; *Email OTP Expiration* = **3600**; *minimum interval between e-mails per user* = **60** seconds (**Authentication → SMTP Settings** on some dashboards) — **unchanged by the sign-in code**: the e-mailed sign-in code is not Auth's one-time password but one the app makes itself (step 26a; [sign-in-protection.md](sign-in-protection.md) §12), so Auth's long, hour-long code stays as it was and the password-reset link keeps its 60 minutes;
    - *Minimum password length* = **12**; password character requirements: none (PO, 6 Oct 2026);
    - *Require current password when updating* = **on**; *Secure password change* = **on**;
    - **Prevent use of leaked passwords** = **on** (Pro plan);
    - leave *Confirm email* as it is for now (step 25 turns it off).
18. **Authentication → Multi-Factor**: TOTP (authenticator app) **enroll and verify enabled**; phone and WebAuthn **disabled**.
19. ~~Supabase custom SMTP~~ — **skipped (PO, 16 Oct 2026, Kawadir alignment):** Supabase's own mailer sends nothing; every e-mail (invitations, password reset, password changed) goes through our notification service (`PASSWORD_RESET_DELIVERY=auth` with the Send Email hook of step 26a: the reset link is e-mailed at once by the web app, ADR 0005 23 Oct 2026; step 31). The platform sender is set by the Super Admin **inside the product** (Platform settings → Email, FR-ADM-17), never in GitHub; organizations may use their own provider (Email integration) — sender rule as Kawadir `sender-rule` ([business flow](../business-flows/EP-EMAIL-email-sending.md)).
20. ~~Supabase e-mail templates~~ — **skipped** (same decision): in **Authentication → Emails → Security notifications** keep **Password changed: off** (our service sends that notice).
21. **Authentication → Rate Limits**: *Rate limit for sign ups and sign ins* = **300** per 5 minutes; *token verifications* = **150** per 5 minutes; *sending emails* = **100** per hour; *token refreshes*: leave the default (reviewed with RR-IAM-01, [sign-in-protection.md](sign-in-protection.md) §9). Leave "IP address forwarding" **off**.
22. **Authentication → Sessions** (Pro): time-box and inactivity timeout — values to be agreed with Claude first (the database already enforces each organization's own limits; this is only an outer bound, risk R-36). Skip until agreed.

## F. The sign-up gate (invitations) — in this order (PO)

23. **GitHub → Settings → Secrets and variables → Actions → Variables** (repository level, not an environment): `SUPABASE_URL` = `https://<new ref>.supabase.co`, `SUPABASE_PUBLISHABLE_KEY` = the new project's publishable key (`sb_publishable_…`, public by design; Project Settings → API Keys). The uptime check then watches the gate from the first minute.
24. **Authentication → Hooks → Add hook → Before User Created → Postgres** → schema `private`, function `before_user_created_hook` → enable.
25. **Authentication → Sign In / Providers → Email → Confirm email: off** → Save (the Email provider itself stays enabled).
26. **Authentication → Sign In / Providers → User Signups → Allow new users to sign up: on**; *anonymous sign-ins*: **off**; Phone provider: **disabled**. Rules and roll-back: [db-deploy.md](db-deploy.md) § Auth sign-up gate.

26a. **PO — the sign-in code's e-mail hook (the Kawadir way: e-mails arrive at once).** Order matters; do it only after the release that contains `/api/auth/send-email` is the **production** deployment (a hook that points at a missing page makes Auth fail when it tries to send):
    0. **Vercel:** `APP_BASE_URL` (step 31, **config**) must be set — the hook builds links from it.
    1. **Vercel → project `jadarat-tms` → Settings → Environment Variables → Add**, **Production** (and Preview only if you want previews to send codes): `EMAIL_CREDENTIALS_KEY` = the **same** 64-character value as the worker's (section H, step 29) — **secret** (mark **Sensitive**). It opens the e-mail provider secrets saved in the product; without it the code cannot be sent through any sender. Step 31's "never in Vercel" list no longer includes it (ADR 0005 amendment, 23 Oct 2026).
    2. **Supabase → Authentication → Hooks → Add hook → Send Email → HTTPS**; **URL** `https://<app domain>/api/auth/send-email` (the production address, not a preview); **Generate secret** → copy the whole value (`v1,whsec_…`, shown once) → **Create/Enable**. Do not paste the value into chat.
    3. **Vercel → Environment Variables → Add**, Production: `SEND_EMAIL_HOOK_SECRET` = that value — **secret** (Sensitive). It signs Auth's calls AND derives the key that seals Auth's token in our database; rotate it only if it leaks (codes in flight, at most ten minutes old, then stop working). → **Redeploy** (variables apply to new deployments only). Until this is done the button «Email me a code instead» is not offered (the app does not pretend to send a code that could not arrive).
    4. **What the hook does.** For the sign-in e-mail (type `magiclink`) it does **not** e-mail Auth's own one-time password: it makes its own six-digit code, stores its keyed hash with Auth's token (encrypted) in our database and e-mails ours (so nobody can guess a short code against Auth's public `/verify`). It acts once per call (replays within five minutes are ignored) and e-mails an account at most 10 codes in 15 minutes and 40 a day. Once enabled the hook receives EVERY e-mail Auth would send; the app **refuses every other type** except `recovery` (nothing is sent, the type is logged). **Password reset (`recovery`, PO 23 Oct 2026: «forgot password» arrives at once too):** Auth creates the reset token and hands it to the hook; the hook e-mails the reset link (the same link the page has always taken, the token in the address fragment) through the organization's sender, or the platform sender for an account of several organizations or a platform role, in the same way as the code — at most 5 reset e-mails per account in 15 minutes and 20 a day in the hook, and 5 an hour per person in the database. It needs no Auth secret key in Vercel. It answers Auth with success whether or not an account exists, so the answer does not tell. If the e-mail cannot be sent at once (provider down, function stopped) it waits in the delivery log and the worker sends it later. Set `PASSWORD_RESET_DELIVERY=auth` **explicitly** in Vercel for this — only AFTER the database deploy of the same release (unset keeps the worker; the hook answers success without sending if the database is not migrated yet) (step 31; `worker` keeps the old path for a deployment whose worker holds the Auth key). Invitations are the app's own, there are no sign-up confirmations ("Confirm email" is off) and no e-mail-change flow. Nothing that works today changes. If an Auth e-mail type ever appears in the logs as "not handled", it is a flow someone added: tell Claude.
    5. **Roll-back:** Supabase → Authentication → Hooks → Send Email → disable; remove `SEND_EMAIL_HOOK_SECRET` in Vercel and redeploy (the button disappears). Nothing else depends on it.

## G. Storage (PO)

27. **SQL editor** (read-only query): `select distinct usename from pg_stat_activity where usename like 'supabase_storage%';` → must show `supabase_storage_admin` (anything else: stop and tell Claude — uploads would be refused).
28. **Storage → Settings**: **S3 connection off** and no S3 access keys; **Image transformation off** (where the plan offers it).

## H. GitHub environment `production-jobs` — background worker and e-mail (PO)

> **Changed (PO, 16 Oct 2026): no e-mail sender settings in GitHub, Vercel or Supabase.** As in Kawadir ATS and FR-ADM-17, the platform sender (provider, key, sender name and address, test) is set by the Super Admin **inside the product** (Platform settings → Email) and stored encrypted in the database; organizations may connect their own provider on **Settings → Email integration** ([business flow](../business-flows/EP-EMAIL-email-sending.md)). Built in WP-ADM-01: steps 29–30 hold the worker's database connections **and one secret, `EMAIL_CREDENTIALS_KEY`**, which lets the worker open the provider secrets saved in the product (they are sealed for the worker; Vercel holds no key — [email.md](email.md) §1a). `RESEND_API_KEY`, `EMAIL_TEST_TO`, `EMAIL_PROVIDER`, `EMAIL_FROM_NAME` and `EMAIL_FROM_ADDRESS` are **not** set anywhere (delete them if they exist).

29. **Environment** `production-jobs` (`main` only) — **`EMAIL_CREDENTIALS_KEY` is added before the WP-ADM-01 pull request is merged** (deploy order, [email.md](email.md) §3) → secrets `DATABASE_URL_APP_QUEUE`, `DATABASE_URL_APP_WORKER` (session pooler, users `app_queue.<ref>` / `app_worker.<ref>`), `SUPABASE_SECRET_KEY` (new key `worker-production`, never Vercel), **`EMAIL_CREDENTIALS_KEY`** (**SECRET**: a generated 64-character password from your password manager; keep a copy there — a new value means the e-mail senders' keys must be entered again; also in Vercel, for the sign-in code only (step 26a), never in chat); variables (**CONFIG**) `DATABASE_CA_CERT`, `APP_BASE_URL`, `SUPABASE_URL`. Optional variables as [files.md](files.md) §7 and [user-import.md](user-import.md) §4.
30. **Claude** runs **Actions → Jobs** (`pass`) and reads the log (`e-mail settings key: on`; the worker publishes its key). Then the PO sets the repository variable `JOBS_REQUIRED` = `on`. The platform sender itself is set in the product after section J (step 33c).

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
| `PASSWORD_RESET_DELIVERY` | `auth` — **config** (PO, 23 Oct 2026: with the Send Email hook of step 26a on, the reset link is e-mailed at once by the web app; our own «password changed» notice is sent at once too, and Auth's own «password changed» e-mail stays off). Change it from `worker`, which sends the reset on the next worker pass. A blank value keeps `worker`. `worker` stays possible (a worker that runs continuously and holds the Auth key) |
| `SEND_EMAIL_HOOK_SECRET` | The secret Supabase generated for the Send Email hook (step 26a), `v1,whsec_…`. **Secret** — mark **Sensitive**. Verifies that a call to `/api/auth/send-email` comes from Auth; unset = the sign-in code is not offered |
| `EMAIL_CREDENTIALS_KEY` | The **same** value as the worker's (step 29): opens the e-mail provider secrets saved in the product, so the sign-in code can be sent at once from here. **Secret** — mark **Sensitive** |
| `APP_BASE_URL` | The app's public origin, e.g. `https://<app domain>` (https, no path). **Configuration, not a secret** (not Sensitive). **Required for e-mails sent at once** (reset links from the Send Email hook, invitations): without it the hook logs «APP_BASE_URL is not a usable origin» and sends nothing (found 24 Oct 2026). The canonical origin of copied invitation links (Users → Invited, the Super Admin console); without it the browser's own origin is used and a production deployment logs `app_base_url_missing`; an invalid value stops the app at start-up. Set it for **Production and Preview** (previews share the production database, so their links should open production) — [platform-console.md](platform-console.md) §3 |

Never in Vercel: `SUPABASE_SECRET_KEY`, any worker or queue connection (`EMAIL_CREDENTIALS_KEY` is the one worker value that is also in Vercel, for the sign-in code only — ADR 0005 amendment of 23 Oct 2026), `JADARAT_AUTH_CLIENT_HEADER`. Then **Deployments → latest production deployment → Redeploy** (variables apply to new deployments only).

**Faster background work (PO decision, 20 Oct 2026; GitHub App since the security review of 21 Oct 2026; [background-jobs.md](background-jobs.md) §1a).** The web app starts the **Jobs** workflow itself after an action queued work, and Vercel's cron does so every minute — so e-mails no longer wait for GitHub's late 5-minute schedule. The worker's keys stay in GitHub; Vercel gets only the key of a small **GitHub App** that may start this repository's workflows — and every workflow except Jobs refuses it. One step at a time (each value says whether it is **secret** or **config**):

31a. **PO — create the GitHub App.** GitHub (your account, `mohima90`) → **Settings → Developer settings → GitHub Apps → New GitHub App**: **GitHub App name** `jadarat-jobs-kick` (if taken, add a suffix — note the name); **Homepage URL** the app's address, e.g. `https://<app domain>`; **Webhook → Active: untick** (no webhook); **Permissions → Repository permissions → Actions: Read and write** — **nothing else** (GitHub adds *Metadata: Read-only* by itself); no account or organization permissions; no events; **Where can this GitHub App be installed? → Only on this account** → **Create GitHub App**. On the page that opens, note the **App ID** (**config**) and the app's URL name (the *slug*, e.g. `jadarat-jobs-kick`).
31b. **PO — generate its private key.** Same page → **Private keys → Generate a private key** → a `.pem` file downloads. Store it in the password manager (**secret**) and delete the downloaded file afterwards.
31c. **PO — install it on this repository only.** Same App → **Install App** → your account → **Only select repositories →** `entlaqa-tms` → **Install**. The browser lands on `https://github.com/settings/installations/<number>`: that number is the **Installation ID** (**config**).
31d. **PO — Vercel → project `jadarat-tms` → Settings → Environment Variables → Add**, environment **Production only** (not Preview), one at a time:
   - `JOBS_DISPATCH_APP_ID` = the App ID of 31a (**config** — not Sensitive);
   - `JOBS_DISPATCH_APP_PRIVATE_KEY` = the whole contents of the `.pem` file of 31b, from `-----BEGIN` to `-----END … KEY-----` (**secret** — mark **Sensitive**);
   - `JOBS_DISPATCH_INSTALLATION_ID` = the Installation ID of 31c (**config**);
   - `JOBS_DISPATCH_REPO` = `mohima90/entlaqa-tms` (**config**).
   If an earlier `JOBS_DISPATCH_TOKEN` exists: **delete** it in Vercel, and in GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → `jadarat-tms-jobs-dispatch` → **Delete** (it is no longer used).
31e. **PO — GitHub → repository → Settings → Secrets and variables → Actions → Variables → New repository variable:** `JOBS_KICK_ACTOR` = the slug of 31a followed by `[bot]`, e.g. `jadarat-jobs-kick[bot]` (**config**, a variable, not a secret; repository level, never in an environment). With it, every workflow but Jobs refuses runs and re-runs started by the App.
31f. **PO — Vercel, same page, Production only:** `CRON_SECRET` = a new random value from the password manager, **32 characters, letters and digits only** (**secret** — mark **Sensitive**). Vercel sends it to the per-minute cron (`/api/cron/jobs`, set in `apps/suite/vercel.json`). **Without `CRON_SECRET` the cron is refused (401) and nothing runs from it** — only the after-action kicks and GitHub's schedule start passes.
31g. **PO — Deployments → latest production deployment → Redeploy.**
31h. **Claude** checks: Vercel → project → **Settings → Cron Jobs** lists `/api/cron/jobs` every minute (PO screenshot), and **Actions → Jobs** shows new runs started by **workflow_dispatch** from `jadarat-jobs-kick[bot]` about every minute or two (Claude reads the list). No run: the runtime logs show `platform.jobs.request_pass` with `jobs_dispatch_config_invalid` (a setting named in the message), `github_token_http_401` (App ID or key), `github_token_http_404` (Installation ID), `github_token_http_422` (App not installed on the repository, or Actions write missing) or `github_http_404` (repository name).
31i. **Claude** confirms the guard: it starts **Actions → Platform admin** (mode `plan`, action `list`) by hand — it runs as before (the PO's or Claude's own start is never refused); a run started by the App would end with the failed job "Refuse a start by the worker-kick app or another bot".

What the App can still do if its key leaks (start, cancel or re-run workflows, disable a workflow such as CI, delete run logs — never secrets, code or the database), the key's rotation and `CRON_SECRET`'s: [background-jobs.md](background-jobs.md) §1a.

## J. Super Admin and the first organization (PO; changed 16 Oct 2026 — the Kawadir way)

> Instead of the **Provision organization** workflow, the PO becomes the **Platform Super Admin** «مشرف المنصة» and creates the organization from the product ([platform-console.md](platform-console.md), ADR 0013). Needs migration `20261018100000` deployed (section D).

32. **Supabase → Authentication → Users → Add user → Create new user**: your e-mail, a strong password, **Auto Confirm User** ticked (never "Send invitation"). If Supabase answers "Sign-up is by invitation only.", follow [platform-console.md](platform-console.md) §1.1 step 2 exactly (**sign-ups off → hook off → add user → hook on → sign-ups on**, then check the users list and the Uptime run). Open the user and send the **UID** in chat (not secret; never the e-mail).
33. **Claude** runs **Actions → Platform admin → Run workflow**: environment `production`, action `grant`, mode **`plan`**, the UID; then the same with mode **`apply`**, and reads both logs.
33a. **PO**: sign in at `https://<app>/en/sign-in` → you land on **Organizations** (`/en/platform`) → **Create organization**: short name `entlaqa`, the Arabic and English names, the e-mail of the **new** person who will be its Organization Admin (not your own account), invitation language → **Copy invite link** and send it to that person.
33b. **The new Organization Admin** opens the link in their browser, sets a password and joins → lands in `entlaqa` as Organization Admin. On the console the row shows "Joined".
33c. **PO (Super Admin)**: console menu **Platform settings → Email** → provider **Resend**, its API key (sending access), **From address** on the verified domain (e.g. `noreply@lms.entlaqa.com`), **From name** `Jadarat`, **Send the test to** your own address → **Save and send test**. After the next Jobs run (started by the save itself — steps 31a–31i — usually within a few minutes; otherwise ≤ 5 minutes, or later when GitHub is busy) the page says «Working» and the test e-mail is in your inbox; e-mails that waited go out ([email.md](email.md) §3).

`APP_BASE_URL` (section I, Production and Preview) makes the copied links point at the public origin ([platform-console.md](platform-console.md) §3). To see who the Super Admins are: **Platform admin** with action `list` (UIDs and grant times only).

## K. Checks (PO, Claude reads the results)

34. Open `https://<app>/api/health/ready` → `ok`.
35. Sign in at `https://<app>/en/sign-in` as the new Organization Admin → the header shows the organization's name; sign out → back on sign-in; `/en/suite` redirects to sign-in.
36. **GitHub → Settings → Variables** (repository): `UPTIME_URL` = the production web address. **Actions → Uptime → Run workflow** → both jobs green (readiness, and the sign-up gate refusing strangers with "Sign-up is by invitation only.").
37. In the product: invite a test person with an address you can read → the invitation e-mail arrives (after the next worker pass, or run **Jobs** by hand) → accept, set a password, signed in. Then «Forgot password?» with your own account → the reset e-mail arrives within seconds → new password works, exactly one "password changed" notice (also within seconds).
37a. **Sign-in code (step 26a):** sign out → `https://<app>/en/sign-in` → your address → **Email me a code instead** → the e-mail arrives within seconds, in the organization's look (or the platform sender's if you belong to several organizations) → type the six digits → signed in (this is the check that proves Auth accepts the released token: if the screen says the code is wrong with a right code, the hook secret in Vercel is not the one Supabase generated). Tick «Remember this browser» (the organization's setting must not be Off), close and reopen the browser → still signed in; sign out → asked again. A wrong code says so with the tries left.
38. **Actions → DB deploy → `plan`** again → "nothing pending"; then the lock check of step 14 (`select count(*) from pg_locks where locktype = 'advisory' and classid = 20261015;`) → **0**.

## L. Retire the old project (PO, only after section K is green)

39. **Claude** updates `CLAUDE.md`, `STATUS.md`, this page and [db-deploy.md](db-deploy.md) with the new ref and organization name, and removes the `staging` choices from the workflows **DB deploy**, **Provision organization**, **Platform admin** and **Jobs** (follow-up of T-M2-36).
40. **PO**: copy anything still needed from the old project (the *Password changed* subject, step 20), then **Supabase → old project `jadarat-tms-staging` → Project Settings → General → Delete project**; delete the old Free organization `entlaqa-TMS` if empty; **GitHub → Environments → `staging` and `staging-jobs` → Delete** (removes their secrets); revoke the old project's worker secret key and the old Resend SMTP key if it was separate.
