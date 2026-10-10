# Database deployment to hosted environments (runbook)

> Backlog: T-M1-D03 (walking skeleton on staging) · ADR 0002 §5–§7 · migration-conventions.md
> Tooling: `.github/workflows/db-deploy.yml` → `scripts/db-deploy.sh` (+ `pg-connection.mjs`, `role-passwords-sql.mjs`) → `scripts/sql/verify-deployment.sql`

## Environments

| Environment | Supabase project | Region | Plan | GitHub environment |
|---|---|---|---|---|
| staging | `jadarat-tms-staging` (ref `kgmhlmiwlbvdmalesexv`, org `entlaqa-TMS`) | `eu-central-1` Frankfurt | Free (pauses after ~7 days idle; Restore in the dashboard) | `staging` |
| production | — (M7) | — | — | — |

Project settings applied at creation (1 Oct 2026): **Data API disabled**, *automatically expose new tables* off, *automatic RLS* off (our migrations enable and force RLS on every table; the CI catalog test enforces it), Postgres (not OrioleDB), not connected to GitHub.

## One-time setup of a GitHub environment (GitHub → Settings → Environments → New environment)

1. Name: `staging`.
2. **Deployment branches and tags → Selected branches → add `main`.** Mandatory: this rule, not the workflow's `if:`, is what stops a run from another branch from reaching the secrets.
3. Optional: **Required reviewers** (the PO) — each run then waits for an approval click; recommended for production.
4. **Environment secrets:**

| Secret | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase **Connect → Session pooler** URI (user `postgres.<ref>`, host `aws-…pooler.supabase.com`, port 5432) with the database password filled in, **no `?…` parameters** | The direct host is IPv6-only; GitHub runners need the pooler. A password with special characters must be percent-encoded in the URI |
| `APP_SERVER_DB_PASSWORD` | ≥ 40 characters, only letters, digits, `-`, `_` (e.g. a password manager's generator with symbols off, length 48) | Becomes the `app_server` password; it is sent to the server only as a SCRAM-SHA-256 verifier |
| `APP_WORKER_DB_PASSWORD` | as above, different value | `app_worker` |
| `APP_QUEUE_DB_PASSWORD` | as above, different value | `app_queue`, the background-job runner (T-M2-06a; [background-jobs.md](background-jobs.md)) |

5. **Environment variable** (not a secret — it is a public certificate): `DATABASE_CA_CERT` = full text of the CA file from Supabase **Database Settings → SSL Configuration → Download certificate**, including the `-----BEGIN CERTIFICATE-----` / `-----END CERTIFICATE-----` lines. TLS is always `verify-full` (certificate chain + host name); Supabase's root CA is not in any system trust store, so the run fails without it.

Store the role passwords in the password manager too: the app and the worker need them (`DATABASE_URL_APP_SERVER` in Vercel; `DATABASE_URL_APP_QUEUE` and `DATABASE_URL_APP_WORKER` for the worker — on staging in the GitHub environment `staging-jobs`, [background-jobs.md](background-jobs.md) §4).

## Running it

1. GitHub → **Actions → DB deploy → Run workflow** (branch `main`), environment `staging`, mode **`plan`**: validates the configuration and the role passwords, lists pending migrations and applies them all in one transaction that is **always rolled back**. Nothing changes.
2. If `plan` is green, run again on the **same `main` commit** with mode **`apply`**: each pending migration is applied in its own transaction together with its row in `supabase_migrations.schema_migrations` (Supabase CLI's history table; the `statements` column is left empty, so `supabase migration fetch` cannot rebuild files — the repository is the source); then the role passwords are set; then `verify-deployment.sql` must pass:
   - `app_server`/`app_worker`/`tenant_guard` attributes, and memberships exactly `{authenticated}`; `app_queue` (job runner) attributes, member of nothing, owner of schema `graphile_worker`;
   - the SECURITY DEFINER functions: exactly the reviewed list, each with its owner (`tenant_guard`, or `invitation_guard` for invitation acceptance — FR-IAM-03), empty `search_path` and exact `EXECUTE` ACL; nobody but the deploying role acts as either guard role;
   - RLS enabled + forced on every table, RESTRICTIVE `tenant_isolation` (ALL, `authenticated`) on every platform/module table;
   - no privileges or schema usage for `anon` / `service_role`;
   - the access-token hook executable by `supabase_auth_admin` (with `USAGE` on `private`) and by no other role;
   - the sign-up hook `private.before_user_created_hook` (T-M2-07): SECURITY INVOKER, empty `search_path`, executable by `supabase_auth_admin` and nobody else, and its check `private.invitation_allows_signup` likewise; no `private.accept_invitation` (removed, security review H1);
   - the Data API (`pgrst.db_schemas`) does not expose our schemas — best effort: hosted Supabase stores this outside the database, so there the dashboard setting **Data API off** (checked at creation; re-check under Project Settings → Data API after any project change) is the control.
3. After the first successful apply on a project, enable the hook in the dashboard: **Authentication → Hooks → Customize Access Token (JWT) Claims → Postgres → schema `private`, function `custom_access_token_hook`**.
4. After the first apply that contains migration `20261009090000` (invitations), turn on the sign-up gate in the order below (§ Auth sign-up gate).

Every transaction runs with `lock_timeout = 10s` and `statement_timeout = 5min`. A failed `apply` stops at the failing migration; earlier migrations stay applied (and recorded). Fix forward with a new migration; use `supabase/rollbacks/` only on staging and only deliberately.

## Auth settings on hosted projects (dashboard)

Self-hosted Auth gets these from `infra/docker/compose.yaml`; on hosted Supabase they are dashboard settings (Authentication → Sign In / Providers → Email, and Authentication → Policies / Passwords):

| Setting | Value | Why |
|---|---|---|
| Require current password when updating | On | My profile password change (FR-IAM-16): Auth checks the current password itself, in addition to the app's own check |
| Minimum password length | 12 | Same rule as the app (screen 6 proposed default, FR-IAM-13). Auth counts **bytes** (6 Arabic letters are 12 bytes); the app counts characters and applies the organization's longer rule (strictest wins, T-M2-10) wherever it sets a password — a password set directly through Auth's API keeps only Auth's floor (TM-0003 RR-IAM-09) |
| Secure password change | On | A session signed in more than 24 hours ago re-authenticates before it sets a password (T-M2-10 review M1; local `config.toml` and self-hosted `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION` the same) |
| Multi-factor (TOTP) | Enroll and verify **enabled** | Authenticator apps (FR-IAM-12, T-M2-10). Leave the other factor types (phone, WebAuthn) disabled |

## Auth sign-up gate (T-M2-07, FR-IAM-03, security review H1)

Invitees create their own account through Auth's public sign-up; the web app has no Auth secret key. Only the **before-user-created hook** stops anyone else from signing up, and that hook API is **fail-open**: if the hook is off, points at the wrong function, or answers `{}`, every sign-up succeeds. The database side is verified by `apply`; the Auth side is a dashboard setting, so it is turned on in this order — the hook **before** sign-ups — and watched by the uptime workflow (ADR 0002 §7 note T-M2-07).

The same migration also installs the **e-mail change guard** (trigger `jadarat_refuse_email_change` on `auth.users`, re-review N1): with sign-ups open, a signed-in account must not be able to take another address (e.g. a future invitee's) through Auth's "change e-mail" flow. It is part of the migration, so it is in place **before** "Confirm email" goes off and sign-ups open; `apply` verifies it (`verify-deployment.sql` §5c). It needs the `TRIGGER` privilege of `postgres` on `auth.users` (Supabase grants it; the migration fails loudly otherwise — then stop here and report it).

**Before you start (once):**
- **Authentication → Hooks**: the **"Before User Created"** hook type is listed for the project (Free plan included). If it is not, stop: sign-ups must stay off.
- GitHub → Settings → Secrets and variables → Actions → **Variables**: `SUPABASE_URL` = the Project URL (`https://<ref>.supabase.co`) and `SUPABASE_PUBLISHABLE_KEY` = the publishable key (`sb_publishable_…`, public by design). Set them **before** sign-ups are enabled, so the uptime probe watches the gate from the first minute.
- **No unconfirmed e-mail accounts** (re-review N3): with "Confirm email" off, Auth signs in anyone who "signs up" again with the e-mail of an existing **unconfirmed** account — without a password and without the hook. Supabase dashboard → SQL editor: `select count(*) from auth.users where email is not null and email_confirmed_at is null;` must be **0** (delete or confirm any such account first). Create accounts in the dashboard only with **"Auto Confirm User"** ticked; never use "Invite user" (the hook refuses it anyway).

**Turn on (PO, Supabase dashboard of the project, after the DB deploy `apply` of migration `20261009090000` is green):**
1. **Authentication → Hooks → Add hook → "Before User Created" → Postgres** → schema **`private`**, function **`before_user_created_hook`** → **Create / Save** (enabled). From now on every new Auth user goes through the hook (sign-ups are still off).
2. **Authentication → Sign In / Providers → Email**: **"Confirm email" OFF** → Save. (The invitation e-mail already proved the address; the sign-up must return a session. Leave the Email provider itself enabled.)
3. **Authentication → Sign In / Providers → User Signups**: **"Allow new users to sign up" ON** → Save. Keep **"Allow anonymous sign-ins" OFF** and the Phone provider disabled.
4. **Verify the gate refuses:** **Actions → Uptime (staging) → Run workflow**: the job **"Sign-up gate (no account without an invitation)"** must be green — Auth refused both probes (a sign-up without an invitation, and one with a well-formed but unknown invitation token, from `uptime-probe-…@lms.entlaqa.com`) with **403 and the hook's message "Sign-up is by invitation only."**. It runs every 15 minutes from then on and opens an issue ("Uptime: staging sign-up gate is not refusing sign-ups") if a probe is ever accepted (HTTP 200) or answered any other way.
5. **Verify the gate admits an invitee (positive test):** on staging, an Organization Admin invites a test person with an address you can read (Users → Invite), opens the e-mailed link, sets a password and lands signed in in the organization; the person then shows as an active member. If this fails, turn sign-ups off again (roll back step 1) and report it.

**Turn off / roll back (always sign-ups first):**
1. **Authentication → Sign In / Providers → User Signups → "Allow new users to sign up" OFF** → Save. New invitees then cannot accept (the page answers with an error); existing users are not affected.
2. Only then, if needed: **Authentication → Hooks → Before User Created → disable / delete**, and "Confirm email" back as wanted.
3. A database rollback of migration `20261009090000` (staging only, `supabase/rollbacks/`) requires steps 1–2 first: without the function every sign-up fails, and without the hook sign-ups would be open. It also removes the e-mail change guard: sign-ups must stay off without it.

If the uptime check ever reports HTTP 200: do step 1 of the roll back **at once**, then look for accounts created by the probe (`uptime-probe-…@lms.entlaqa.com`) or by anyone else without an organization (invitations contract § Operations) and delete them.

**Memberships (operators).** To take someone out of an organization, **suspend** (or revoke) the membership — `update platform.tenant_memberships set status = 'suspended' where tenant_id = '<tenant>' and person_id = '<person>' and status = 'active';` — never `delete` it. Only the status change runs the deactivation triggers: the person's sign-in sessions in that organization end, and when it was the login's last active membership in an active or trial organization, every Auth session of the login ends too (T-M2-09, T-M2-10). A deleted membership skips them, and a login left with no membership at all is **not** refused by the access-token hook (that is how platform staff and new invitees sign in), so it would keep signing in. A membership is deleted only for an erasure request: suspend it first (its own transaction), then delete it — and the Auth account too when the person has no other membership (ADR 0002 §7 note T-M2-09).

**E-mail of an account (operators).** Auth never changes an account's e-mail any more — not the user's own "change e-mail" request, not the dashboard or admin API (they answer with an error; re-review N1). If an address must be corrected, an operator does it in the SQL editor in one transaction: `begin; set local jadarat.allow_auth_email_change = 'on'; update auth.users set email = '<new>' where id = '<uid>'; update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb('<new>'::text)) where user_id = '<uid>' and provider = 'email'; commit;` — and the person's e-mail in the organization (HR record) is changed to match. A future Auth upgrade that rewrites e-mails would be refused by the guard too: if a Supabase Auth upgrade ever fails on `jadarat_refuse_email_change`, report it (the guard is dropped only by the migration rollback).

## Separation of duties (T-M2-16, BR-IAM-4)

Migration `20261010090000` makes the database refuse an **Organization Admin holding any other role** in the same organization (PO decisions 7 and 8 Oct 2026, BRD v2.6): the Organization Admin is a setup-only role — no learner, HR Manager or any other role next to it — and invitations never give it together with another role. Before it installs the guards it locks `role_assignments` and `invitations` against writes for the rest of its transaction (at most the deploy's 10 s lock timeout; if the old app version keeps them busy, `apply` fails and can simply be run again), checks the existing data and **changes nothing**: if any member already holds the Organization Admin role together with another role (validity periods overlapping from now on) or a **pending** invitation would give it with another role, `plan`/`apply` stops with `separation of duties (BR-IAM-4): N member(s) … and M pending invitation(s) …` (counts only). `verify-deployment.sql` §7 checks the same after every deploy (it fails if the verifying role cannot bypass row-level security, rather than reading 0).

Staging is expected to pass: its only real member, the PO, holds the Organization Admin role only (no automatic second role exists: provisioning gives exactly `tenant_admin`, invitation acceptance gives exactly the invitation's roles, the database backfill gave `tenant_admin` only to members without any role). If it stops:
1. Find them (SQL editor, read-only): `select m.tenant_id, m.person_id, array_agg(ra.role_code) from platform.role_assignments ra join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id where (ra.valid_until is null or ra.valid_until > now()) group by 1, 2 having bool_or(ra.role_code = 'tenant_admin') and count(*) > 1;` and `select tenant_id, id from platform.invitations where status = 'pending' and 'tenant_admin' = any (array[primary_role] || additional_roles) and cardinality(array[primary_role] || additional_roles) > 1;`
2. The **PO decides with the organization** whether each person stays Organization Admin (then their other roles are removed) or keeps the other roles (then someone else becomes Organization Admin — an organization needs at least one Organization Admin without an end date, so give that role to the other person first). Nobody can change their own roles, and an HR Manager cannot change a privileged member's roles, so: if another Organization Admin (holding that role alone) exists, they make the change in the app (Users → profile → Edit roles); if the person is the organization's only Organization Admin, first invite a second Organization Admin with that role alone, who then removes the first person's other roles (or takes over). Pending invitations: revoke and invite again with the Organization Admin role alone. Nobody deletes roles in SQL on the organization's behalf.
3. Re-run `plan`, then `apply`.

The tenant provisioning recovery path (`scripts/provision-tenant.sh` with `ADD_TO_EXISTING=true` for an existing member) refuses a member who holds other roles (`… holds other roles in this organization …`): remove them in the app first, or choose another person.

## Troubleshooting

- **`SSL error: certificate verify failed`** or **`server certificate … does not match host name`**: the CA in `DATABASE_CA_CERT` is not the one that signed the server/pooler certificate, or the file was pasted incompletely. Re-download it from Database Settings → SSL Configuration and paste the whole file. **Never** work around it by lowering `sslmode` — the script does not allow it for remote hosts.
- **`DATABASE_URL is not a valid URL` / `invalid percent-encoding`**: the database password contains characters that must be percent-encoded in the URI; easiest is to reset the database password to letters and digits only.
- **`must be at least 40 characters` / `only letters, digits`**: regenerate the role password with symbols turned off.

## Security notes

- The connection URL is split by `scripts/pg-connection.mjs` into libpq variables and a 0600 pgpass file: the password never appears in process arguments or in libpq error messages, and every form of it is masked in the job log. Malformed URLs fail with generic messages that quote no part of the URL.
- Role passwords never reach the server in clear text. Their SCRAM verifiers do (that is how PostgreSQL stores passwords); `pg_stat_statements` on the server may retain the `ALTER ROLE` text, which is readable only by privileged roles. Rotate a role password by updating the secret and re-running `apply`.
- `verify-deployment.sql` also runs in CI on every PR (`scripts/db-test.sh`), so it stays in step with the migrations.
- On hosted Supabase the migration role `postgres` is **not a superuser**. CI therefore also runs the whole deploy path as a non-superuser shaped like it (`scripts/db-test-hosted-sim.sh`): migrations must not name `SUPERUSER` in `ALTER ROLE` (nor `BYPASSRLS`/`REPLICATION` unless the migration role has them), must give a new owner `CREATE` on the schema while handing over ownership, and must assert (not trust) grants on Supabase-owned schemas such as `auth`, because a GRANT without the grant option only warns.

## Hosted-Supabase items this verifies (from engineering/README §7)

- Hosted Supabase's `postgres` has `USAGE` on schema `auth` **without** the grant option (second staging plan, 1 Oct 2026), so `tenant_guard` cannot be given access to `auth.sessions`; it reads the view `private.auth_session_validity` (owned by the migration role, SELECT for `tenant_guard` only — ADR 0002 §6a rev. 2), and migration `…120100` asserts that the view's owner can read `auth.sessions`.
- Invitation acceptance (T-M2-07, migration `…20261009090000`): `invitation_guard` reads Auth users only through the view `private.auth_user_email` (`auth.users` id, e-mail), owned by the migration role, SELECT for `invitation_guard` only. The migration asserts that `postgres` can read those two columns of `auth.users`; **to confirm on the staging `plan` run** (the CI hosted simulation grants them to its migrator, like `auth.sessions`).
- E-mail change guard (re-review N1, same migration): `postgres` creates the trigger `jadarat_refuse_email_change` on `auth.users`, which needs the `TRIGGER` privilege on that table (owned by `supabase_auth_admin`). Assumed from Supabase's own image `supabase/postgres:17.11.0.003` (the staging version): `auth.users` ACL `postgres=ar*wdDxtm/supabase_auth_admin` — no ownership, but `t` (TRIGGER). The hosted simulation grants exactly that; the migration checks it and fails loudly otherwise; **to confirm on the staging `plan` run**. Only the table owner may `DROP TRIGGER`, so the rollback drops the trigger function with `CASCADE`. The sign-up hook and its check are granted to `supabase_auth_admin` by the migration role (as the access-token hook); the hosted simulation runs both as `supabase_auth_admin` after the non-superuser deploy.
- Authenticator apps and sign-in sessions (T-M2-10, migration `…20261012090100`): the migration role must be able to **read, `DELETE` from and `REFERENCES`** `auth.mfa_factors`, and **read and `DELETE` from** `auth.sessions` — removing an app ("not you?", "added from another sign-in", the purge of apps unconfirmed after 72 hours, the resets) and ending a session delete the Auth rows through the views `private.auth_mfa_factor` / `private.auth_session_validity` (owned by the migration role, `DELETE` for `tenant_guard` only), and `private.mfa_factor_confirmations` has a foreign key to `auth.mfa_factors`. Assumed from the same ACL as `auth.users` (`postgres=ar*wdDxtm/supabase_auth_admin`: `d` = DELETE, `x` = REFERENCES); the hosted simulation grants exactly these. **What to look for in the staging `plan` run (re-review N4):** it must pass `20261012090100_private__mfa_enforcement`; if it stops there, the message names the missing privilege — `cannot read auth.mfa_factors (<column>)`, `cannot delete from auth.mfa_factors`, `cannot reference auth.mfa_factors`, `cannot read auth.sessions (<column>)` or `cannot delete from auth.sessions` (role `postgres`). Then do **not** `apply`: the app's removals and sign-outs depend on it; raise it with the Tech Lead (the fallback is a worker-side removal through Auth's admin API).
- **First worker run after this deploy (T-M2-10 re-review N2):** the session purger removes every authenticator app that is verified in Auth but was never confirmed with the e-mailed code and is older than 72 hours — on staging that includes the **test apps set up earlier through Auth's API** (spikes, parity checks, the old confirmation-link flow). Their sessions end, the removal is audited (`platform.auth.mfa_removed`, `via: expired`) and the owner of an account that is an active member of an organization gets the «Authenticator app removed» e-mail. Expected; tell testers before the deploy. A tester who still wants the app sets it up again (the code then comes by e-mail).
- `revoke temporary on database … from public` may be a no-op when `postgres` does not own the database; the verification prints a **warning** (not a failure). Track it in STATUS risks if it appears.
- The server version is printed on the first line of every run. Staging runs **PostgreSQL 17.11** (1 Oct 2026); CI tests on the same version (`postgres:17` pinned by digest in `ci.yml`, `supabase/config.toml` `major_version = 17`). When Supabase upgrades the project, bump CI the same way.
