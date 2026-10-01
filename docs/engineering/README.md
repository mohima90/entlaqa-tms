# Jadarat — Engineering Guide

| | |
|---|---|
| **Backlog** | T-M1-D01 (monorepo scaffold), T-M1-D02 (CI with the 14 gates), database part of T-M1-D03 (walking skeleton) |
| **Architecture** | ADR 0001 (monorepo, boundaries), ADR 0002 rev. 1 (tenancy, RLS, claim validation), ADR 0003 rev. 1 (authN/authZ, `defineAction`); `docs/architecture/migration-conventions.md`, `docs/architecture/r1-data-model.md` |
| **Status** | Scaffold — 30 Sep 2026 |

This guide is for engineers (human or Claude sessions) working in the code. Product scope lives in the BRD, process and quality bars in the Development Plan, current state in `docs/delivery/STATUS.md`.

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | **24 LTS** (`.nvmrc`); `>= 22.12` accepted locally | CI and production use 24 |
| pnpm | 10.x (pinned by `packageManager` in `package.json`) | `corepack enable` picks the right version |
| PostgreSQL client + server | 16 | Only for `pnpm db:test` (plain PostgreSQL, no Docker needed) |
| Playwright Chromium | matching `@playwright/test` | `pnpm --filter @jadarat/suite exec playwright install chromium` (or set `PW_CHROMIUM_EXECUTABLE` to an existing Chromium) |
| Docker | — | Not needed yet; required for the self-hosted stack (T-M1-D04) |

No Supabase project or secrets are needed to build, test or run the app: without `NEXT_PUBLIC_SUPABASE_*` / `DATABASE_URL_*` it runs in a visible **"not configured"** state. Variable **names** are listed in `.env.example`; values never go into git (put them in `apps/suite/.env.local`, which is git-ignored).

## 2. Commands

| Command | What it does | CI gate (Plan §5.3) |
|---|---|---|
| `pnpm install` | Install with the committed lockfile (CI: `--frozen-lockfile`; dependency install scripts are blocked) | 1 |
| `pnpm check:licenses` | Fails on disallowed licences (`scripts/lib/licenses.mjs`) | 1 |
| `pnpm dev` | Next.js dev server for `apps/suite` on http://localhost:3000 (redirects to `/ar`) | — |
| `pnpm typecheck` | `tsc --noEmit` in every package (+ `next typegen` for the app) | 2 |
| `pnpm lint` | ESLint (type-aware, jsx-a11y, Next rules, security syntax bans) + RTL logical-properties check + `defineAction` check | 2 |
| `pnpm format:check` / `pnpm format` | Prettier | 2 |
| `pnpm test` / `pnpm test:coverage` | Vitest unit tests; coverage thresholds (≥ 80 % lines) per package | 3 |
| `pnpm check:migrations` | Migration file naming + a rollback file per migration | 4 |
| `pnpm check:deps` | dependency-cruiser: ADR 0001 boundaries, admin/jobs import rules, no cycles | 4 (boundaries) |
| `pnpm db:test` | Throwaway DB → test-only Supabase shim → migrations **up → down → up** → SQL tests (catalog, isolation, claim validation, access-token hook, tenant switch) | 4, 5 |
| `DB_TEST_INTEGRATION=1 pnpm db:test` | …plus the TypeScript integration tests (`withUserTx` / `withSystemTx` against real PostgreSQL) | 6 |
| `pnpm db:test:hosted-sim` | Runs the real deploy path (`db-deploy.sh` plan + apply + `verify-deployment.sql`) as a **non-superuser** migration role shaped like hosted Supabase's `postgres` — catches superuser-only statements that `db:test` cannot see | 4 |
| `pnpm build` | Production build (`output: 'standalone'`) + copies static assets into `.next/standalone` | — |
| `pnpm --filter @jadarat/suite check:budget` | Client JS / CSS gzip budget (`apps/suite/performance-budget.json`) | 9 |
| `pnpm e2e` | Playwright smoke against the standalone server: Arabic + English, `dir`, no console/CSP errors, no horizontal overflow at 390 px, axe (0 serious/critical) | 7, 8 |
| `pnpm check:all` | typecheck + lint + format + coverage + migrations + deps | — |
| `bash scripts/db-deploy.sh plan\|apply` | Hosted environments only, normally via **Actions → DB deploy** (runbook: [db-deploy.md](db-deploy.md)) | — |
| `bash scripts/provision-tenant.sh plan\|apply` | Hosted environments only, normally via **Actions → Provision organization** (runbook: [staging-sign-in.md](staging-sign-in.md)) | — |

### Database tests locally

`scripts/db-test.sh` uses the standard libpq variables and needs a **superuser** connection to a scratch PostgreSQL 16 server (it creates and drops its own database):

```bash
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=...   # a local, throwaway server
pnpm db:test                                 # SQL gate
DB_TEST_INTEGRATION=1 pnpm db:test           # + TypeScript integration tests
DB_TEST_KEEP=1 pnpm db:test                  # keep the database for debugging
```

The script sets random, per-run passwords on the `app_server` / `app_worker` login roles so tests can connect **as those roles** (the database's claim validation depends on `session_user`), and clears them on exit. Passwords never appear in migrations.

### E2E locally

```bash
pnpm build
pnpm e2e                                      # uses the Playwright-managed Chromium
PW_CHROMIUM_EXECUTABLE=/path/to/chromium pnpm e2e   # or an existing Chromium binary
```

## 3. Repository map

```
apps/suite/                 Next.js 16 App Router — the only deployable (standalone output)
  src/proxy.ts              request proxy: host → tenant classification (placeholder), locale routing, CSP nonce. No authz.
  src/app/[locale]/         thin route files (landing, /suite shell); Arabic default, English
  src/lib/                  security headers, host classification, config status
  e2e/                      Playwright smoke + axe
packages/
  config/                   tsconfig bases, ESLint flat config, Prettier, Tailwind v4 preset, Vitest presets, dependency-cruiser rules
  platform-core/            Result/AppError, ids, verified-claims + request-context types, zod input helper
  platform-db/              postgres.js + Drizzle; withUserTx (app_server); ./jobs withSystemTx (app_worker); ./admin (jobs/admin only); server Supabase client
  platform-identity/        verifyClaims (getClaims) / verifyClaimsStrict (getUser) → VerifiedClaims; ./next adapter (cookies)
  platform-rbac/            permission registry, data scopes, authorize(), defineAction()
  platform-i18n/            locales, direction, next-intl routing, AR/EN messages
  ui/                       RTL-first primitives (Button, Card, AppShell); imports docs/design/tokens/tokens.css
  contracts/                cross-module contracts (example: TmsSessionScheduledV1 event)
modules/tms/                TMS module skeleton: permissions, a domain service, an example server action
supabase/
  migrations/               SQL migrations (YYYYMMDDHHMMSS_<schema>__<description>.sql)
  rollbacks/                one rollback per migration (tested up → down → up, never auto-run in production)
  tests/                    SQL tests; first line declares the connection: -- db-test: run-as=owner|app_server|app_worker
  tests/_shim/              TEST-ONLY Supabase shim for plain PostgreSQL (roles, auth.jwt/uid, auth.users/sessions)
  config.toml               local Supabase CLI config (hook enabled, Data API disabled — nothing exposed, gated by check:migrations)
scripts/                    db-test.sh, db-deploy.sh (+ sql/verify-deployment.sql) and repository gate scripts (+ their tests)
.github/                    CI (ci.yml, codeql.yml), composite setup action, Dependabot
```

Dependency rules (enforced by `pnpm check:deps`, ADR 0001): apps → anything; `modules/X` → config, ui, platform-*, contracts, itself (never another module, never the app); `platform-*` → config, contracts, other platform packages (acyclic), never ui/modules; `ui` → config only; `contracts` → config and **type-only** platform-core. Additional rules: `@jadarat/platform-db/admin` only from real job/admin roots — `packages|modules/<name>/src/{jobs,admin}/` and the future `apps/worker/` (a route folder merely *named* `admin/` or `jobs/`, e.g. `apps/suite/src/app/[locale]/admin/page.tsx`, is rejected; nothing in `apps/suite` may import either); `@jadarat/platform-db/jobs` only from `packages|modules/<name>/src/jobs/` and `apps/worker/`; `@jadarat/platform-core/internal/verified-claims` only from platform-core/platform-identity (and tests); `@supabase/*` and `postgres` only inside platform-db; no relative imports into another package; production code never imports a devDependency (a peer + dev dependency, like `next` in platform-identity, is allowed). `node_modules` is **not** excluded from the cruise (only not followed), so rules on installed packages fire; fixture tests in `scripts/dependency-rules.test.mjs` prove each rule.

## 4. How the data path works (read before touching platform-db, SQL or actions)

1. **Identity.** `platform-identity` verifies the session JWT with `getClaims()` (asymmetric keys) — or `getUser()` for sensitive operations — and only then brands the payload as `VerifiedClaims`. ESLint forbids casts to any `…Claims` type (`VerifiedClaims`, `TenantClaims`, …); dependency-cruiser restricts the brand function.
2. **Actions.** Every server action is `export const x = defineAction({ permission, input, resource? | scoped?, audit?, handler })` in a `'use server'` file, with `defineAction` imported from `@jadarat/platform-rbac`. `defineAction` verifies the session (`getUser()` round-trip for high-risk or AAL2 permissions, `getClaims()` otherwise), requires a tenant claim, validates input with zod (422 `VALIDATION_FAILED` + `fieldErrors`), then inside `withUserTx`: loads grants → resolves the resource → `authorize()` → handler → audit event. Authorization targets: with `resource`, some grant's scope must cover it (404 otherwise); without one the action is **tenant-wide** and needs a `tenant`-scope grant (403 otherwise — an `own`/`org_units` grant never suffices); with `scoped: true` the handler gets **all** matching grants in `ctx.grants` and must restrict its queries with them (scopeFilter, ADR 0003 §4.2). Handler failures roll back; unexpected errors return `INTERNAL_ERROR` with a correlation id (also logged). Errors follow ADR 0011 (`AppError`: SCREAMING_SNAKE `code`, `status`, `messageKey`, `params`, `fieldErrors`, `expose`; messages under `errors.*` in the catalogs). `pnpm check:actions` fails on any other export shape (TS and JS files, `export *`, CommonJS exports, a local or foreign `defineAction`).
3. **Transactions.** `withUserTx(claims, fn)` (connection role `app_server`) runs `begin; set local role authenticated; select set_config('request.jwt.claims', $1, true);` and blanks the legacy `request.jwt.claim` / `request.jwt.claim.sub` settings for the transaction — ADR 0002 §5. Jobs use `withSystemTx({ tenantId, jobId }, fn)` (role `app_worker`, claims `role: 'system'`).
4. **Database.** Every tenant table has ENABLE + FORCE RLS and a RESTRICTIVE `tenant_isolation` policy that is exactly `<tenant column> = (select private.current_tenant_id())`, which **re-validates the claims** (ADR 0002 §6a): user claims only under `app_server` with a live `auth.sessions` row, an active membership in an active/trial tenant, and `platform.session_context` of that session still pointing at the claimed tenant (a pre-switch token stops working at once); system claims only under `app_worker`. Anything else → NULL → zero rows. Policies and functions read claims **only** from `request.jwt.claims` via `private.request_claims()` / `private.request_user_id()` — never `auth.jwt()` / `auth.uid()` (Supabase's versions prefer the legacy per-claim settings, which a session-level `SET` could leak across pooled transactions); the catalog test enforces this. Request-path code can only invite members (never create active memberships), change membership `status` only to suspend/revoke, and write audit events whose `actor_user_id`/`actor_person_id` match the claims with `impersonator_user_id` NULL.
5. **Tenant claim.** The Custom Access Token Hook (`private.custom_access_token_hook`) adds `tenant_id`/`person_id` for the **session's** active tenant (`platform.session_context`). Tenant switch = `switchActiveTenant(tx, tenantId)` (calls `private.switch_active_tenant`) + session refresh.

## 5. How to add…

### …a migration
Follow `docs/architecture/migration-conventions.md` (templates, naming, required tests). In short:
1. `supabase/migrations/<UTC timestamp>_<schema>__<verb_description>.sql` — one logical change; a new table ships **with** RLS, policies, grants and indexes.
2. `supabase/rollbacks/<same file name>` — the reverse (or `-- irreversible: …` for contract steps).
3. Tests: fixtures for ≥ 2 tenants in `00_helpers_and_fixtures.sql`; add the table to the coverage guard and add insert/FK cases in `20_isolation.sql`; table-specific grant/constraint tests. The catalog, no-claim and forged-claim checks pick the table up automatically.
4. Update the Drizzle table definitions in `packages/platform-db/src/schema/` (types only; SQL is the source of truth).
5. `pnpm check:migrations && pnpm db:test`.

### …a server action
1. Declare the permission in the module's registry (`definePermissions('<module>', [...])`: AR/EN labels, risk, AAL2).
2. Write the domain logic as a plain, unit-tested service returning `Result`.
3. In a `'use server'` file: `export const doThing = defineAction({ permission, input: ZodSchema, resource, audit, handler })`.
4. Tests: positive + negative (403, 404 out of scope, 404 other tenant, step-up) — see `packages/platform-rbac/src/define-action.test.ts` for the pattern.

### …a package
`packages/<name>/` with `package.json` (`"name": "@jadarat/<name>"`, `exports` pointing at `src/*.ts`, scripts `typecheck`, `test`, `test:coverage`), `tsconfig.json` extending `@jadarat/config/tsconfig/library.json`, `vitest.config.ts` using `defineJadaratVitestConfig()`. Add it to `transpilePackages` in `apps/suite/next.config.ts` if the app imports it, and to the dependency-cruiser rules if it needs special boundaries.

### …a module
`modules/<name>/` shaped like `modules/tms` (permissions, services, actions, UI later), its own schema `<name>` (migrations named `<timestamp>_<name>__…`; the migration check derives allowed schemas from `modules/*`), talking to other modules only through `packages/contracts` and events.

## 6. CI gates (Development Plan §5.3) → implementation

| # | Gate | Where | Status |
|---|---|---|---|
| 1 | Install with lockfile; licence check | `ci.yml` → install | ✅ active |
| 2 | Type-check, lint, format | typecheck, lint | ✅ active |
| 3 | Unit tests + coverage threshold | unit (Vitest v8 thresholds per package) | ✅ active |
| 4 | Migration check (clean apply; reversible) | boundaries (naming, rollbacks) + db (up → down → up on an empty DB) | ✅ active — "last release snapshot" starts with the first release |
| 5 | RLS / tenant-isolation suite | db (`supabase/tests`) | ✅ active |
| 6 | Integration tests | db (`DB_TEST_INTEGRATION=1`) | ✅ active (DB layer); server actions against local Supabase from T-M1-D03 |
| 7 | E2E smoke (Arabic + English) | e2e (production standalone server) | ✅ active — against the preview environment once Vercel builds (T-M1-D05) |
| 8 | Accessibility scan | e2e (axe, 0 serious/critical) | ✅ active |
| 9 | Lighthouse / bundle-size budget | build (bundle budget) | 🟡 bundle budget active; Lighthouse CI with preview deployments |
| 10 | SAST | `codeql.yml` (security-extended; JS/TS + Actions) | ✅ runs on GitHub only |
| 11 | Dependency vulnerability scan | audit (`pnpm audit --audit-level high`) | ✅ active |
| 12 | Secret scanning | secrets (gitleaks: working tree + PR/push commit range) | ✅ runs in CI; see note below |
| 13 | Container / IaC scanning | iac (Trivy config scan) | 🟡 active on config; image scanning with T-M1-D04 |
| 14 | OpenAPI breaking-change check | openapi | 🟡 placeholder — fails as soon as an OpenAPI file is added without a real check |

Make the aggregate job **`CI gates`** and the CodeQL checks required status checks on `main` (PO, repository settings).

**Secret-scanning note:** a full-history gitleaks scan reports findings in commits of the *removed* pre-rebuild codebase (e.g. a committed `.env.local`). CI therefore scans the working tree and the commits of each PR/push. The historical credentials were revoked on 1 Oct 2026 (old Vercel and Supabase projects deleted; see STATUS); they are not allow-listed.

## 7. What is stubbed, and what comes next

| Area | State | Next |
|---|---|---|
| Sign-in, MFA, session refresh in the proxy | E-mail + password sign-in, organization chooser and sign-out as server actions (`definePublicAction`, `apps/suite/src/auth/` only — CI gate); the proxy refreshes session cookies; `/suite` requires a session with a tenant claim; `platform.auth.signed_in/_out` audited; app DB connections use verify-full TLS (`DATABASE_CA_CERT`). Runbook: [staging-sign-in.md](staging-sign-in.md). MFA off by default (PO, 1 Oct 2026) | Per-tenant MFA policy (off/optional/required, any TOTP app), password reset and invitations, application-level rate limiting (M2) |
| Host → tenant resolution | Proxy classifies the Host header only; on every path except `/_next/static` it strips client-sent `x-jadarat-*`/`x-nonce` headers and sets the nonce CSP (`/_next/static` gets a strict static CSP from `next.config.ts`) | Narrow `private` lookup over verified `tenant_domains` + claim/host comparison (ADR 0002 §4) |
| Grants / roles | `defineAction` default runtime loads **no grants** → every action is denied (403) | Roles, role assignments and resource resolvers (M2) |
| Audit | `defineAction` writes `platform.audit_events` rows | `platform-audit` package, `actor_type`, before/after, partitioning (M2, data model §2.5) |
| DB types | Hand-written Drizzle definitions for the six platform tables | `pnpm db:types` (supabase gen types + drizzle-kit pull) with a drift gate (migration-conventions §8) |
| Design tokens | `packages/ui` imports `docs/design/tokens/tokens.css` directly (single source of truth) | Component library + Storybook (T-M1-A02) |
| Self-hosted stack | — | **T-M1-D04** (Docker): GoTrue hook config, `auth.sessions` grants, image scanning |
| Vercel | Project Root Directory = `apps/suite` (Next.js preset, Node 24, files outside root included) — production deployment of `main` is Ready (1 Oct 2026). Root `vercel.json` (`ignoreCommand: exit 0`) keeps the **old** project `entlaqa-tms` (team "Mohamed Ibrahim's projects", still connected) from building | Remove root `vercel.json` only after the PO deletes the old project; Supabase env vars for sign-in: [staging-sign-in.md](staging-sign-in.md) |

### Items to verify on the Supabase staging project (T-M0-07)
The first two are exercised by `DB deploy` (`plan` fails on a refused grant; `verify-deployment.sql` checks role attributes); the others are confirmed by the first staging sign-in ([staging-sign-in.md](staging-sign-in.md) §Checking it works).
- ~~`grant select … on auth.sessions to tenant_guard`~~ — not permitted on hosted Supabase (no grant option on `auth`); resolved by ADR 0002 §6a rev. 2: `tenant_guard` reads the view `private.auth_session_validity`, owned by the migration role. Still to confirm: the FK `platform.session_context → auth.sessions` is permitted, and `auth.sessions` has no RLS that hides rows from the view's owner.
- `grant authenticated to app_server/app_worker` and `NOINHERIT` behave as tested; pooler user names are `app_server.<project-ref>`.
- The access-token hook input contains `session_id` (ADR 0002 §3).
- Storage and Realtime authorization: `private.current_tenant_id()` returns NULL for claims set by other login roles (Storage API, Realtime, PostgREST), so ADR 0002 §8/ADR 0006 storage policies need their own reviewed path.
