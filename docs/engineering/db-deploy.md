# Database deployment to hosted environments (runbook)

> Backlog: T-M1-D03 (walking skeleton on staging) · ADR 0002 §5–§7 · migration-conventions.md
> Tooling: `.github/workflows/db-deploy.yml` → `scripts/db-deploy.sh` → `scripts/sql/verify-deployment.sql`

## Environments

| Environment | Supabase project | Region | Plan | GitHub environment |
|---|---|---|---|---|
| staging | `jadarat-tms-staging` (ref `kgmhlmiwlbvdmalesexv`, org `entlaqa-TMS`) | `eu-central-1` Frankfurt | Free (pauses after ~7 days idle; Restore in the dashboard) | `staging` |
| production | — (M7) | — | — | — |

Project settings applied at creation (30 Sep / 1 Oct 2026): **Data API disabled**, *automatically expose new tables* off, *automatic RLS* off (our migrations enable and force RLS on every table; the CI catalog test enforces it), Postgres (not OrioleDB), not connected to GitHub.

## Secrets (GitHub → Settings → Environments → `staging` → Environment secrets)

| Secret | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase **Connect → Session pooler** URI (user `postgres.<ref>`, port 5432) with the database password | The direct host is IPv6-only; GitHub runners need the pooler. Never paste it anywhere else |
| `APP_SERVER_DB_PASSWORD` | 40+ random characters, letters/digits/`-_` only | Becomes the `app_server` password (sent as a SCRAM verifier) |
| `APP_WORKER_DB_PASSWORD` | as above, different value | `app_worker` |

The two role passwords are also needed later by the app (`DATABASE_URL_APP_SERVER`, `DATABASE_URL_APP_WORKER` in Vercel / the worker), so store them in the password manager too.

## Running it

1. GitHub → **Actions → DB deploy → Run workflow** (branch `main`), environment `staging`, mode **`plan`**: lists pending migrations and applies them all in one transaction that is **always rolled back**. Nothing changes.
2. If `plan` is green, run again with mode **`apply`**: each pending migration is applied in its own transaction together with its row in `supabase_migrations.schema_migrations` (Supabase CLI's history table); then the role passwords are set; then `verify-deployment.sql` must pass (role attributes, RLS enabled + forced on every table, no `anon` access, hook executable only by `supabase_auth_admin`).
3. After the first successful apply on a project, enable the hook in the dashboard: **Authentication → Hooks → Customize Access Token (JWT) Claims → Postgres → schema `private`, function `custom_access_token_hook`**.

A failed `apply` stops at the failing migration; earlier migrations stay applied (and recorded). Fix forward with a new migration; use `supabase/rollbacks/` only on staging and only deliberately.

## Hosted-Supabase items this verifies (from engineering/README §7)

- `grant select (…) on auth.sessions to tenant_guard` is permitted for the `postgres` role (migration `…120100`) — a failure appears in `plan`.
- `revoke temporary on database … from public` may be a no-op when `postgres` does not own the database; the verification prints a **warning** (not a failure). Track it in STATUS risks if it appears.
- The server version is printed on the first line of every run. New Supabase projects are expected to run PostgreSQL 17 while CI tests on 16 — if so, align CI (`ci.yml` service image, `supabase/config.toml` `major_version`) in a follow-up.
