# ADR 0001 — Monorepo layout and module boundaries

**Status:** Proposed · **Date:** 30 Sep 2026 · **Backlog:** T-M1-B01 · **Related:** BRD §3.4, Appendix H.1/H.4/H.5; FR-STE-01, FR-STE-02, FR-STE-08; Q8 sovereign-ready, Q9 suite-ready

## Context

- Jadarat TMS is the first module of the Jadarat HR Suite (Core HR, Payroll & Time, Performance & Skills, Recruitment & Onboarding will follow) and is also sold standalone from the same codebase (decision of 30 Sep 2026).
- The same code must run on Vercel + Supabase (regional SaaS) and in containers with self-hosted Supabase in KSA/UAE (decision D2/D6).
- The delivery team is the PO plus Claude Code agents working in parallel, often in separate sessions without shared memory. Boundaries must be **mechanically enforced**, not left to discipline.
- Platform capabilities (identity, people directory, roles, workflow, notifications, audit, files, i18n) will be reused by every future suite module.

## Options considered

1. **Single Next.js app, folders by feature** — fastest start; boundaries only by convention; platform code tangles with TMS code; hard to add Core HR later.
2. **Microservices per module from day one** — strong isolation; heavy operational cost (many deployables, distributed transactions, in-country ops burden); premature for one module.
3. **Modular monolith in a monorepo** — one deployable app and one database per deployment; code split into workspace packages with enforced dependency rules; modules can be extracted later if scale demands.

## Decision

Adopt option 3: a **modular monolith in a pnpm + Turborepo monorepo**.

### Repository layout

```
apps/
  suite/                    Next.js (App Router) — the only deployable web app ("Jadarat Suite shell")
    app/[locale]/…          thin route files; import pages/actions from modules/* and packages/*
packages/
  config/                   shared tsconfig, ESLint, Prettier, Tailwind preset, dependency-cruiser rules
  ui/                       design system (shadcn/ui-based, RTL-first, tokens from docs/design/tokens)
  platform-core/            shared kernel: Result/errors, ids, clock, tenant & request context types, zod helpers
  platform-db/              Supabase clients (server, browser, admin), generated DB types, query helpers
  platform-identity/        sign-in, sessions, MFA, invitations, tenant memberships, people directory API
  platform-rbac/            permissions registry, roles, data scopes, authorize()
  platform-audit/           audit event writer/reader
  platform-events/          transactional outbox + queue producer/consumer (ADR 0004)
  platform-jobs/            background job runner & schedules (ADR 0005)
  platform-notifications/   channel abstraction, templates (ADR 0008)
  platform-files/           storage, signed URLs, scanning (ADR 0006)
  platform-i18n/            next-intl config, messages, Hijri/working calendars, formatting (ADR 0007)
  platform-integration/     connector transport, HMAC signing/verification, safeFetch (SSRF guard), secrets access (before M6; TM-0001 F-12)
  platform-ai/              AI provider abstraction and governance (before R2; ADR 0012)
  platform-workflow/        approval workflow engine (FR-WFL; R1 default chain, builder in R2)
  contracts/                cross-module contracts only: event payload schemas, service interfaces (types + zod)
modules/
  tms/                      Jadarat TMS domain: services, server actions, UI screens, permissions, events
  (core-hr/, payroll/, …)   future suite modules, same shape
supabase/
  migrations/               SQL migrations for all schemas (naming convention below)
  tests/                    pgTAP tests (RLS, tenant isolation, functions)
  seed/                     seed data (synthetic only)
  config.toml
infra/
  docker/                   self-hosted stack (compose) for sovereign/local parity (ADR 0010);
                            images: suite (Next.js standalone), worker (jobs, ADR 0005), pdf-renderer (isolated, ADR 0006)
docs/                       BRD, plan, status, ADRs, security, design
```

### Dependency rules (enforced in CI with dependency-cruiser; build fails on violation)

| From → To | `packages/config` | `packages/ui` | `packages/platform-*` | `packages/contracts` | `modules/*` (same) | `modules/*` (other) | `apps/suite` |
|---|---|---|---|---|---|---|---|
| `apps/suite` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `modules/X` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `packages/platform-*` | ✅ | ❌ (UI-free, except `platform-i18n` message types) | ✅ (acyclic) | ✅ | ❌ | ❌ | ❌ |
| `packages/ui` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `packages/contracts` | ✅ | ❌ | ❌ (types only from `platform-core`) | ✅ | ❌ | ❌ | ❌ |

Additional rules:
- A module talks to another module **only** through `packages/contracts` (event schemas, service interfaces) and domain events. No imports of another module's code, no reads of another module's tables.
- Database login roles (ADRs 0002, 0004, 0005): `app_server` (web requests), `app_worker` (job handlers), `app_queue` (queue runner/dispatcher); none has `BYPASSRLS`.
- Only `packages/platform-db/admin` may create a service-role Supabase client, and only code under `**/jobs/**` or `**/admin/**` may import it (ADR 0002).
- Each package exposes a public API through its `package.json` `exports`; deep imports into another package's internals are forbidden.
- No circular dependencies anywhere.

### Database ownership

- One PostgreSQL database per deployment; **one schema per module/platform area**: `platform` (tenancy, identity, people, rbac, audit, events, files metadata, notifications), `tms`, later `core_hr`, `payroll`, …; plus `private` for security-definer helpers not exposed through the API.
- A module owns its schema. Foreign keys **from** a module **to** `platform` tables (tenants, people/persons, org units) are allowed; foreign keys between two business modules are forbidden (use IDs + events).
- Migrations live in the single `supabase/migrations/` folder (Supabase CLI requirement) and are named `YYYYMMDDHHMMSS_<schema>__<description>.sql` so ownership is visible; CODEOWNERS and review rules apply per schema.
- Schemas exposed to the Data API are limited to what server code needs (ADR 0003: the browser does not query tenant tables directly).

### Build, runtime and deployment

- **pnpm** workspaces (lockfile committed), **Turborepo** for task orchestration and caching (remote cache optional, not required).
- Node.js **24 LTS** for CI and production (22 LTS acceptable locally until upgraded).
- TypeScript **strict** everywhere; ESM; path aliases via package names, not relative cross-package paths.
- `apps/suite` builds with `output: 'standalone'` so the same build runs on Vercel and in a container (ADR 0010). Vercel project Root Directory = `apps/suite`.
- Next.js: current stable major at scaffold time (16.x at the time of writing), pinned in the lockfile; upgrades via PR with changelog review.
- Licensing of suite modules is runtime configuration (FR-STE-01): navigation, permissions and APIs of unlicensed modules are disabled per tenant; code is always present.

## Consequences

**Positive**
- One deployable and one database keep operations simple, including in-country deployments.
- Platform services are built once and reused by Core HR and later modules (FR-STE-02, FR-STE-08).
- Enforced boundaries let multiple agents work in parallel with low collision risk and make later extraction of a module into a service feasible.

**Negative / costs**
- Initial scaffolding and boundary tooling take time in M1.
- A single deployable means a failing module can affect the whole app; mitigated by tests, feature flags and module-level error boundaries.
- Supabase's single migrations folder requires the naming convention above to keep ownership clear.

## Security impact

- Clear separation of service-role usage (only admin/jobs code) reduces the risk of accidental RLS bypass.
- Smaller, well-defined public APIs per package make security review tractable.

## Sovereign deployment impact

- Standalone Next.js output and a self-hosted Supabase stack (`infra/docker`) are first-class from M1; no feature may depend on Vercel-only services in critical paths.

## Suite (multi-module) impact

- New suite modules are added as `modules/<name>` + schema `<name>`; they reuse platform packages and communicate through `packages/contracts` and events.

## Verification

- dependency-cruiser rules run in CI (gate: build fails on any violation).
- CI job asserts every migration file matches the naming convention.
- CI job asserts no file outside `**/jobs/**` and `**/admin/**` imports `@jadarat/platform-db/admin`.
