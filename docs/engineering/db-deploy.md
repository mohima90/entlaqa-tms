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

5. **Environment variable** (not a secret — it is a public certificate): `DATABASE_CA_CERT` = full text of the CA file from Supabase **Database Settings → SSL Configuration → Download certificate**, including the `-----BEGIN CERTIFICATE-----` / `-----END CERTIFICATE-----` lines. TLS is always `verify-full` (certificate chain + host name); Supabase's root CA is not in any system trust store, so the run fails without it.

Store the two role passwords in the password manager too: the app needs them later (`DATABASE_URL_APP_SERVER`, `DATABASE_URL_APP_WORKER` in Vercel / the worker).

## Running it

1. GitHub → **Actions → DB deploy → Run workflow** (branch `main`), environment `staging`, mode **`plan`**: validates the configuration and the role passwords, lists pending migrations and applies them all in one transaction that is **always rolled back**. Nothing changes.
2. If `plan` is green, run again on the **same `main` commit** with mode **`apply`**: each pending migration is applied in its own transaction together with its row in `supabase_migrations.schema_migrations` (Supabase CLI's history table; the `statements` column is left empty, so `supabase migration fetch` cannot rebuild files — the repository is the source); then the role passwords are set; then `verify-deployment.sql` must pass:
   - `app_server`/`app_worker`/`tenant_guard` attributes, and memberships exactly `{authenticated}`;
   - RLS enabled + forced on every table, RESTRICTIVE `tenant_isolation` (ALL, `authenticated`) on every platform/module table;
   - no privileges or schema usage for `anon` / `service_role`;
   - the access-token hook executable by `supabase_auth_admin` (with `USAGE` on `private`) and by no other role;
   - the Data API (`pgrst.db_schemas`) does not expose our schemas — best effort: hosted Supabase stores this outside the database, so there the dashboard setting **Data API off** (checked at creation; re-check under Project Settings → Data API after any project change) is the control.
3. After the first successful apply on a project, enable the hook in the dashboard: **Authentication → Hooks → Customize Access Token (JWT) Claims → Postgres → schema `private`, function `custom_access_token_hook`**.

Every transaction runs with `lock_timeout = 10s` and `statement_timeout = 5min`. A failed `apply` stops at the failing migration; earlier migrations stay applied (and recorded). Fix forward with a new migration; use `supabase/rollbacks/` only on staging and only deliberately.

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
- `revoke temporary on database … from public` may be a no-op when `postgres` does not own the database; the verification prints a **warning** (not a failure). Track it in STATUS risks if it appears.
- The server version is printed on the first line of every run. New Supabase projects are expected to run PostgreSQL 17 while CI tests on 16 — if so, align CI (`ci.yml` service image, `supabase/config.toml` `major_version`) in a follow-up.
