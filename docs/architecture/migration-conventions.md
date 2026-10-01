# Database Migration Conventions

**Status:** Proposed · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B13 · **Related:** ADR 0001 (database ownership, naming), ADR 0002 (RLS pattern, §6a claim validation, verification gates), ADR 0003, ADR 0004/0005 (roles `app_queue`, `app_worker`), ADR 0010 §8 (upgrade process); NFR-MNT-03/04, NFR-AVL-04; Development Plan §4.2 (DoD), §5.3 (CI gates); `docs/architecture/r1-data-model.md`

These rules apply to every file in `supabase/migrations/` and `supabase/tests/`. The walking-skeleton migrations (`20260930120000…120500`) already follow them and are the reference examples.

---

## 1. Files and naming

- One folder for all schemas (Supabase CLI requirement): `supabase/migrations/`.
- File name: **`YYYYMMDDHHMMSS_<schema>__<description>.sql`** (ADR 0001), e.g. `20261102093000_tms__create_sessions.sql`, `20261102094500_platform__add_persons_name_parts.sql`, `20260930120100_private__tenant_claim_validation.sql`.
  - `<schema>` = the schema that **owns** the change (`platform`, `tms`, `private`, later `core_hr`, …). A migration never changes objects in two business schemas.
  - `<description>` = lower snake_case, verb first: `create_<table>`, `add_<table>_<column>`, `drop_<table>_<column>`, `backfill_<table>_<column>`, `alter_<table>_<what>`, `seed_ref_<table>`.
  - Create files with `supabase migration new <schema>__<description>` (it adds the timestamp); timestamps are UTC and strictly increasing on `main` — rebase and rename if another PR merged a later timestamp first.
- CI gate `pnpm check:migrations` fails on names that do not match `^\d{14}_[a-z][a-z0-9_]*__[a-z0-9_]+\.sql$` or on an unknown schema prefix.
- **Merged migrations are immutable.** Fixes are new migrations.

## 2. One change per migration

A migration contains **one logical change** that can be reviewed, tested and rolled back on its own:
- ✅ one new table **with** its constraints, indexes, triggers, RLS, policies, grants and comments (they are one unit — a table without RLS must never exist, even between two migrations);
- ✅ one column addition (plus its index/check) across the places that need it;
- ❌ schema change and data backfill in the same file (backfills are separate, batched migrations or jobs);
- ❌ changes to `platform` and `tms` in the same file;
- ❌ unrelated tables "while we are here".

Large data changes on populated tables (> ~100k rows) run as a background job (ADR 0005) in batches, not in a migration.

## 3. Naming inside SQL

| Object | Convention | Example |
|---|---|---|
| Tables | plural snake_case; `ref_` prefix for global reference tables | `tms.session_days`, `platform.ref_currencies` |
| Columns | snake_case; `_id` FK, `_at` timestamptz, `_on` date, `is_/has_` boolean, `_ar/_en` bilingual, `_amount`/`_currency` money | `starts_at`, `expires_on`, `title_ar` |
| Primary key | `id` | |
| Indexes | `<table>_<columns>_idx`; unique `<table>_<columns>_uq` | `session_days_tenant_starts_at_idx` |
| Constraints | `<table>_<columns>_fkey`, `<table>_<column>_check`, `<table>_<what>_excl` | `sessions_status_check` |
| Policies | `tenant_isolation` (restrictive, mandatory); others `<table>_<operation>[_<who>]` | `sessions_read`, `files_guard_read` |
| Triggers | `<table>_<purpose>` | `sessions_set_updated_at` |
| Functions | in `private` unless intentionally callable; verb first; `security invoker` by default; always `set search_path = ''` and fully qualified names | `private.can_read_object()` |

## 4. Templates

### 4.1 Tenant-scoped table (class T — the default)

```sql
-- <Purpose in one line>. Features: <FR-IDs>. ADR 0002 §6 pattern. Class: T.
-- PII: <none | columns + classification>.

create table tms.session_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  session_id uuid not null,
  day_no smallint not null check (day_no > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  room_id uuid,
  -- [std] columns (data model §1.4)
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),                                   -- composite key: target of all FKs
  unique (tenant_id, session_id, day_no),
  constraint session_days_period_check check (ends_at > starts_at),
  foreign key (tenant_id, session_id) references tms.sessions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, room_id) references tms.rooms (tenant_id, id)
);
comment on table tms.session_days is 'Days of a session (FR-SCH-01). Owner: tms. Class: T.';

-- every composite FK gets an index that starts with tenant_id
create index session_days_tenant_session_idx on tms.session_days (tenant_id, session_id);
create index session_days_tenant_room_idx on tms.session_days (tenant_id, room_id) where room_id is not null;
create index session_days_tenant_starts_at_idx on tms.session_days (tenant_id, starts_at);

create trigger session_days_set_updated_at before update on tms.session_days
  for each row execute function private.set_updated_at();

alter table tms.session_days enable row level security;
alter table tms.session_days force row level security;

-- mandatory, restrictive, identical everywhere (checked by supabase/tests/10_catalog.sql)
create policy tenant_isolation on tms.session_days
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));

-- permissive policies: within-tenant access; fine-grained permissions/scopes are enforced by defineAction
create policy session_days_read   on tms.session_days for select to authenticated using (true);
create policy session_days_insert on tms.session_days for insert to authenticated with check (true);
create policy session_days_update on tms.session_days for update to authenticated using (true) with check (true);
create policy session_days_delete on tms.session_days for delete to authenticated using (true);  -- only for non-soft-delete tables

revoke all on tms.session_days from public, anon;
grant select, insert, update, delete on tms.session_days to authenticated;
```

Rules:
- **Never** omit `enable` + `force row level security` or the restrictive `tenant_isolation` policy; never write a permissive policy that references another tenant or bypasses `current_tenant_id()`. The `tenant_isolation` expressions must be exactly `<tenant column> = (select private.current_tenant_id())` (the catalog test compares the normalized expression).
- Read claims in policies and functions **only** through `private.request_claims()` / `private.request_user_id()` (they read `request.jwt.claims`). Never `auth.jwt()` / `auth.uid()` or the legacy `request.jwt.claim*` settings: Supabase's helpers prefer those legacy settings, which a session-level `SET` can leak across pooled transactions. The catalog test fails on any use.
- Nothing goes into the `public` schema (the catalog test fails on any table, view, sequence, function or type there); no module creates temporary objects (`TEMPORARY` is revoked from `PUBLIC`).
- Grant only the operations the table needs: soft-delete tables ([sd]) get **no** `delete` grant; append-only tables ([ao]) get only `select, insert` and a trigger that raises on `update`/`delete`.
- Ownership rules that are cheap and stable may be added as permissive policies (e.g., learners see their own enrollments), but never replace `defineAction` checks (ADR 0003 §4.3).
- Grants to `app_queue`, `tenant_guard` or `supabase_auth_admin` are **column-level** and paired with a dedicated policy `…_guard_read`/`…_queue_read` (see `20260930120200_platform__tenancy_core.sql`).
- No grants to `anon` on any table in module schemas; public (unauthenticated) reads go through a reviewed `private` function returning minimal columns (e.g., `private.verify_certificate`).
- Money, time, bilingual, status and PII conventions: data model §1.5–§1.12. Status sets are `text` + named `check`.
- Partitioned tables (e.g., `audit_events`): RLS and policies on the parent; revoke all privileges on partitions so they cannot be queried directly.

### 4.2 Global reference table (class G)

```sql
create table platform.ref_currencies (
  code char(3) primary key check (code ~ '^[A-Z]{3}$'),
  minor_units smallint not null check (minor_units between 0 and 4),
  name_ar text not null,
  name_en text not null
);
comment on table platform.ref_currencies is 'ISO 4217 currencies (NFR-L10N-09). Class: G (global reference).';
alter table platform.ref_currencies enable row level security;
alter table platform.ref_currencies force row level security;
create policy ref_currencies_read on platform.ref_currencies for select to authenticated using (true);
revoke all on platform.ref_currencies from public, anon;
grant select on platform.ref_currencies to authenticated;
```
…and add the table to the allow-list `tests.global_tables()` in `supabase/tests/00_helpers_and_fixtures.sql` **with a one-line reason** (reviewed as a security change).

### 4.3 Infrastructure table (class I)
RLS enabled + forced, no grants to `authenticated`/`anon`, explicit grants and policies only for the role that uses it (`app_queue`, `tenant_guard`), listed in `tests.global_tables()` with the reason "infrastructure". Payloads never contain personal data (ADR 0004/0005).

### 4.4 Functions
- `security invoker` unless impossible; `security definer` only in `private`, owned by `tenant_guard` (or `app_queue` for queue helpers). Supabase-owned tables they must read (e.g. `auth.sessions`) are reached through a column-limited view in `private`, owned by the migration role and selectable by `tenant_guard` only (ADR 0002 §6a rev. 2), `set search_path = ''`, explicit tenant checks, `revoke all … from public` then `grant execute` to the exact roles. Every definer function is flagged in the PR for the security-review pass.
- Immutable helpers used in generated columns/indexes (e.g., `private.normalize_ar`) must be truly immutable and have unit parity tests with the application implementation (ADR 0007 §9).

## 5. Required tests per new table (Definition of Done)

Database tests are SQL files in `supabase/tests/` using the `tests.*` helpers (`tests.assert`, `tests.assert_eq`, `tests.assert_fails`, `tests.rows_affected`, `tests.set_claims`, `tests.user_claims`); run with `pnpm db:test` locally and in CI. For every new table:

| # | Test | Where |
|---|---|---|
| 1 | Catalog: RLS enabled + forced; restrictive `tenant_isolation` for ALL commands to `authenticated` using `current_tenant_id()`; no `anon`/`PUBLIC` privileges — automatic for every table in module schemas | `10_catalog.sql` (automatic) |
| 2 | Isolation (connected as `app_server` with valid tenant-A claims): sees only tenant-A rows; update/delete of tenant-B rows affect 0 rows; insert with tenant-B `tenant_id` fails (42501); FK to a tenant-B parent fails (23503/42501). **Add the table to the coverage guard list** — the build fails otherwise | `20_isolation.sql` |
| 3 | No-claim / forged-claim: zero rows without claims, with an unknown `session_id`, or with system claims under `app_server` (ADR 0002 §6a) — automatic for listed tables | `30_…`, `31_…` |
| 4 | Grants: operations not granted (e.g., `delete` on [sd] tables, `update` on [ao] tables) fail | table-specific file |
| 5 | Constraints: each status `check`, exclusion constraint (e.g., room double-booking), partial unique index and cross-column check has at least one failing case | table-specific file |
| 6 | Functions/policies with special logic (ownership policies, `private.*` definers): positive and negative cases, including another tenant | table-specific file |
| 7 | Fixtures: two tenants (A, B) minimum with rows in the new table, added to `00_helpers_and_fixtures.sql` | fixtures |

Application-level tests (Development Plan §4.2) — `defineAction` positive/negative tests (403/404/other tenant) and E2E J13 — are required in the same PR as the first action that uses the table.

## 6. Zero-downtime and rollback

Production migrations are **forward-only** (the Supabase CLI has no down migrations); reversibility (NFR-MNT-04) is achieved as follows:

1. **Expand/contract** (ADR 0010 §8): release N only *adds* (new tables, nullable columns or columns with constant defaults, new indexes, new check constraints as `not valid` then `validate constraint`); code of release N-1 must keep working. Removals/renames (*contract*) ship in N+1 or later, after no deployed code reads the old shape. Renames = add new column → dual-write/backfill → switch reads → drop old.
2. **Down script for review and CI:** every migration PR includes `supabase/rollbacks/<same file name>` with the SQL that reverses it (or the explicit statement `-- irreversible: <reason>, restore from backup`, allowed only for contract steps). CI applies *up → down → up* on a scratch database to prove the pair is consistent. Down scripts are **not** run automatically in production; they are the tested basis for an emergency fix-forward migration.
3. **Production rollback of code** = redeploy the previous image digests (compatible thanks to expand/contract). Point-in-time recovery is the last resort and requires PO approval (data loss window).
4. **Lock safety:** start migrations that touch existing tables with `set lock_timeout = '5s';` and keep them short; build indexes on large existing tables with `create index concurrently` in a migration of its own (it cannot run inside a transaction block — verify how the Supabase CLI wraps migration files and document the chosen approach in the first such PR); never rewrite a large table in a migration (e.g., changing a column type) — use expand/contract.
5. **Backups:** a verified backup precedes every production migration run (ADR 0010 §8).

## 7. Seed and reference data

| Kind | Where | Rules |
|---|---|---|
| Reference data needed in production (currencies, countries, editions, permission catalog, default working weeks, system notification templates) | Migrations (`seed_ref_<table>`), idempotent `insert … on conflict do update` | Only public or ENTLAQA-owned data; regulatory values (holidays, regulator packs) only when marked legally validated (BRD Appendix E) |
| Test fixtures for DB tests | `supabase/tests/00_helpers_and_fixtures.sql` | Fixed, readable UUIDs; ≥ 2 tenants; all edge statuses |
| Local/preview/staging demo data | `supabase/seed/*.sql` (referenced from `config.toml`) or a seeding script | **Synthetic only**: generated Arabic/English names, `@example.com`/`.test` e-mails, `+9665000000xx`-style fake numbers, no real national IDs (use documented invalid ranges), no customer data ever (Development Plan §3.4: production data is never copied to lower environments) |

Seed scripts never run against production. Secrets, API keys and passwords never appear in any seed or migration.

## 8. Regenerating database types

After any migration that changes tables, views or functions used by code:
```bash
supabase db reset            # apply all migrations + fixtures locally
pnpm db:types                # to be added in packages/platform-db (T-M1-D01/D03):
                             #  1) supabase gen types typescript --local --schema platform,tms
                             #       > packages/platform-db/src/generated/database.types.ts
                             #  2) drizzle-kit pull (schemaFilter: platform, tms) → packages/platform-db/src/generated/schema/
```
- Generated files are committed and never edited by hand; CI regenerates them from a fresh database and fails on `git diff --exit-code` (drift gate).
- Drizzle is a query builder only (ADR 0002 §5): **SQL migrations remain the source of truth**; `drizzle-kit generate/push` are not used. Verify `drizzle-kit pull` output for policies/check constraints and exclude what is not needed for typing.
- Zod schemas in `packages/contracts` are hand-written for API/event contracts and tested against the generated types where they overlap.

## 9. Review checklist (paste into the PR)

- [ ] File name and schema prefix correct; one logical change; timestamp later than `main`
- [ ] Class (T/G/I) stated in the table comment; PII columns tagged
- [ ] T tables: `tenant_id` default, `unique (tenant_id, id)`, composite FKs, tenant-leading indexes, enable + force RLS, restrictive `tenant_isolation`, minimal grants, nothing to `anon`
- [ ] Status sets as `text` + named `check`, values match `packages/contracts` enums and the data model §5
- [ ] Definer functions (if any) in `private`, `search_path = ''`, execute grants explicit — flagged for security review
- [ ] Tests 1–7 of §5 added/updated; coverage guard list updated
- [ ] Rollback script present and CI up/down/up green; expand/contract respected
- [ ] DB types regenerated; data model document updated if the logical model changed
