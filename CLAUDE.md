# CLAUDE.md — Jadarat TMS

Guidance for every Claude Code session working in this repository. Read this file first, then follow the session routine below.

## What this project is

**Jadarat TMS** is an Arabic-first, multi-tenant SaaS **Training Management System** built by **ENTLAQA**. It manages the full training lifecycle (plan → schedule → enroll → deliver → assess → certify → pay → report) for classroom, virtual, blended and on-the-job training. It is:

- the **first module of the planned Jadarat HR Suite** (Core HR, Payroll & Time, Performance & Skills, Recruitment & Onboarding, Jadarat LMS, Jadarat TMS), built on a shared **Jadarat Platform**; and
- also sold **standalone** to organizations using other HR systems (same codebase, per-tenant mode).

It integrates with **Jadarat LMS** (reference connector) and any other LMS through an open, standards-based LMS Integration Framework.

## Source-of-truth documents (read in this order)

| # | Document | Use it for |
|---|---|---|
| 1 | `docs/delivery/STATUS.md` | **Current state**: phase, milestone progress, decisions, blockers, next actions, session log |
| 1b | `docs/delivery/BACKLOG.md` | **Task list**: pick the next unblocked task of the current milestone; update its status |
| 2 | `docs/delivery/Jadarat_TMS_Development_Plan.md` | **How** we deliver: quality bars, Definition of Ready/Done, CI gates, milestones M0–M7, quality gates, security program, templates |
| 3 | `docs/brd/Jadarat_TMS_BRD_v2.md` | **What** to build: requirements `FR-*`, `NFR-*`, priorities, releases, architecture guidance (Appendix H) |
| 4 | `docs/brd/TMS_Feature_List.md` | Feature IDs, release cut (R1 = 107 features, v3.2), open decisions |
| 5 | `docs/research/TMS_Market_Comparison_vs_BRD.md` | Background: competitors, regulatory fact-check, sources |

Precedence: BRD wins on **scope**; the Development Plan wins on **process and quality**; `STATUS.md` records **what has actually happened**. Raise conflicts to the user (Product Owner) instead of guessing.

## Session routine

**At the start of every session**
1. Read `docs/delivery/STATUS.md` — first its **«Current state by role»** section (next actions, waiting on the PO), then blockers and the latest decisions — and `docs/delivery/ROADMAP-by-role.md` (R1 features by role, **work packages** and their order), then your work package's section in `docs/delivery/BACKLOG.md`. **A new or second Claude account starts with `docs/delivery/HOW-TO-START.md`** (what to read, how to claim a work package on its own branch `claude/<wp-id>-<short>`, migration ranges, shared files, hand-back).
2. Read the work package's business flow, the relevant section of the Development Plan and the BRD requirements it references.
3. Confirm with the user which next action to take if it is not obvious from their request.
4. **Business flow first (PO, 15 Oct 2026):** before any technical work on a phase or epic, its business flow (actors/roles, steps, rules, approvals, exceptions, inputs/outputs, screens implied, open questions) must be written in `docs/business-flows/`, discussed with the PO and agreed (recorded in STATUS). No agreed flow → write and discuss the flow; do not design screens or build.

**At the end of every session (or after any meaningful change)**
1. Update `docs/delivery/STATUS.md` (your role's line in «Current state by role»), task statuses in `docs/delivery/BACKLOG.md` and feature statuses / «Claimed by» in `docs/delivery/ROADMAP-by-role.md`: milestone/task status, decisions made (with date), new blockers/risks, next actions, and a one-line entry in the session log.
2. If scope changed, update the BRD (increment version, add a revision-history row) **and** the feature list together.
3. Commit with a clear message referencing requirement IDs; push to the designated branch.

A project **Stop hook** (`.claude/settings.json` → `.claude/hooks/require-status-update.sh`) enforces step 1: if repository files changed (uncommitted, or committed on the branch but not yet on `origin/main`) and `docs/delivery/STATUS.md` is not among them, the session is asked to update `STATUS.md` before finishing. Do not disable or bypass it.

## Team model (Development Plan §2.3)

The delivery team is the **user as Product Owner + Claude Code sessions and sub-agents**. Claude acts as tech lead, engineers, designer, QA, DevOps and security. Every PR gets **one** separate code-review pass (and a security-review pass when security-relevant) before the PO merges.

**Lighter process (PO decision, 15 Oct 2026 — Development Plan §2.4):** business flow agreed first for every phase; one independent review per PR (security review only for security-relevant changes; a second look only to confirm Critical/High fixes); one PR per complete feature area; **no separate screen approval (PO, 17 Oct 2026)** — screens are built directly in the Kawadir ATS layout with the Jadarat palette once the flow is agreed, no screenshots needed; database changes batched; documentation only where it matters; several engineering agents in parallel on independent work — **since 17 Oct 2026 organized by role and work package** (Organization Admin → HR Manager → L&D Manager → other roles; one work package = one PR; a second Claude account claims work packages per `docs/delivery/HOW-TO-START.md`); a weekly progress report against the feature list (STATUS §7). The non-negotiables below are unchanged. Never merge to `main` yourself. Human-only work (accounts/billing, design partners, usability sessions with real users, legal validation, pen test, go/no-go) belongs to the PO — prepare materials for it, do not attempt it.

## Non-negotiables (from Development Plan §1)

- **Security:** no known critical/high vulnerabilities at any release; deny-by-default authorization; validate all inputs; no secrets or personal data in code or logs.
- **Tenant isolation:** every table has row-level security (RLS) and an automated cross-tenant test. Tenant ID comes from the server-verified JWT, never from client input.
- **Arabic-first → English default for now (PO, 14 Oct 2026):** English is the default language until the PO says otherwise; Arabic stays fully supported with the same features; RTL via CSS logical properties; Hijri/Gregorian dates; Arabic copy from the UX writer/glossary, not machine translation.
- **Accessibility:** WCAG 2.2 AA in Arabic and English.
- **Sovereign-ready:** everything must run self-hosted in-country (KSA/UAE); no hard dependency on Vercel-only or other vendor-only features in critical paths.
- **Suite-ready:** platform services live in platform packages; modules never read another module's tables directly (use services or events).
- **Quality gates:** never skip, disable or weaken tests or CI gates to get a green build. Flaky tests are fixed or quarantined with an owner.

## Architecture & stack (decided — see BRD Appendix H and decision D6)

- Next.js (App Router), React, TypeScript **strict**; Tailwind CSS (logical properties) + shadcn/ui; next-intl (Arabic default).
- Supabase (PostgreSQL, Auth, Storage, Realtime), used in a **self-hostable** way.
  - Use `@supabase/ssr` on the server only (HttpOnly cookies; all auth flows are server actions). Verify users server-side: `getClaims()` (asymmetric JWT signing keys) for normal requests and `getUser()` before sensitive operations — never `getSession()` (ADR 0003 §2).
  - Server code reaches tenant data through a direct PostgreSQL connection as `app_server` with verified claims set per transaction (`withUserTx`); jobs use `app_worker` (`withSystemTx`). Tenant schemas are not exposed through the Supabase Data API (ADR 0002).
  - RLS helper functions go in a `private` schema (never the `auth` schema); tenant claim added via a Custom Access Token Hook.
- Build Next.js with `output: 'standalone'` so it runs on Vercel (regional SaaS, region `fra1`, co-located with Supabase `eu-central-1`) and in containers (sovereign).
- **Modular monolith** in a monorepo: `apps/suite` · `packages/platform-*` · `packages/ui` · `modules/tms` (later `modules/core-hr`, …). One database per deployment, one schema per module. Cross-module communication via service interfaces or domain events (transactional outbox + PostgreSQL queue).
- Middleware matches **real URL prefixes**; route groups such as `(dashboard)` never appear in URLs.
- Architecture decisions are recorded as ADRs in `docs/adr/NNNN-title.md` (template: Development Plan Appendix E).
- **UI/UX and Organization Admin settings follow Kawadir ATS one-to-one** (ENTLAQA's sister product, separate codebase; PO, 15 Oct 2026): `docs/design/kawadir-alignment.md`.

## Conventions

- **Requirement traceability:** feature `XXX-NN` (feature list) ↔ requirement `FR-XXX-NN` (BRD), 1:1. Never renumber or reuse IDs; mark removed items as priority **W** / release **—**. Reference IDs in stories, commits and PRs.
- **Priorities & releases:** MoSCoW (M/S/C/W); releases R1–R4, `Suite` (when the related HR Suite module ships), `—` (removed).
- **Git:** small PRs, conventional commit messages, no direct pushes to `main`, no force-push on shared branches. Use the PR template in Development Plan Appendix B.
- **Definition of Done:** Development Plan §4.2 — including RLS tests for new tables/endpoints, authorization negative tests, Arabic + English E2E, accessibility checks and audit events.
- **Regulatory content** (Qiwa, HRDF, SAMA, Emiratisation, Egypt labour/PDPL): use BRD Appendix E; never invent figures; flag anything new for legal validation.
- **Docs:** keep documents in English with Arabic terms where useful; keep tables consistent with existing formatting.

## Environment notes

- The repository contains the **M1 foundation** (monorepo, migrations, CI gates — see `docs/engineering/README.md`) plus the documentation.
- Vercel project **`jadarat-tms`** (team "Mohamed Attia's projects") builds from Root Directory **`apps/suite`** (Next.js preset, Node 24, region `fra1` in `apps/suite/vercel.json`). The root `vercel.json` (`ignoreCommand: exit 0`) must stay while the **old** Vercel project `entlaqa-tms` (team "Mohamed Ibrahim's projects") is still connected to this repo: it makes that project skip every build. Remove it only after that project is deleted (the PO's Vercel account has no access to that team, 1 Oct 2026).
- **One environment: production (PO, 15 Oct 2026).** While there are 0 customers there is one hosted environment, production; pull-request previews share the production database (accepted, risk R-62), so production holds test organizations only. A separate test environment is added when the first customer arrives.
- **Supabase starts over (PO, 15 Oct 2026):** a **new, clean Supabase project** `jadarat-tms` (ref **`pbmzlxljyjsvrzvkklbg`**) in the new ENTLAQA organization **`ENTLAQA-Products`** on the **Pro** plan (daily backups, no pausing), region Frankfurt `eu-central-1` next to Vercel `fra1`, Data API off, becomes production. All migrations are applied fresh; the connection secrets change and are re-entered by the PO in GitHub environments (`production`, `production-jobs`) and Vercel; Auth settings (hooks, SMTP, templates, rate limits, …) are redone from the runbooks — complete ordered checklist: `docs/engineering/production-setup.md` (BACKLOG T-M2-37). The old project `jadarat-tms-staging` (ref `kgmhlmiwlbvdmalesexv`, org `entlaqa-TMS`, Free) keeps running until production works, then the PO deletes it. Older docs still say "staging" for the old project.
- Claude's container **cannot reach `*.supabase.co`** (egress policy). Migrations reach the hosted database only through GitHub Actions: **decided (PO, 15 Oct 2026): automatic DB deploy after every merge to `main`** (plan, then apply only if plan is green; a failure opens/updates a `db-deploy-auto` issue) — **to build** (BACKLOG T-M2-38); until it exists, and as fallback afterwards, the manual **Actions → DB deploy** workflow run by the user (`docs/engineering/db-deploy.md`). Write migrations expand-first (the app and the database deploy in parallel). Never ask for keys or passwords in chat — they go into GitHub environment secrets / Vercel env vars.
- **Self-hosted stack tested nightly** (gate 15, `selfhosted-nightly.yml`, 23:59 Riyadh time on `main`; PO, 14 Oct 2026) — not part of the per-PR `CI gates`; run `infra/docker/smoke.sh` locally only when a change touches `infra/docker`. A failed nightly run opens/updates a `selfhosted-nightly` issue, fixed before further merges.
- Hosted Supabase's migration role `postgres` is **not a superuser**: migrations must pass `pnpm db:test:hosted-sim` (CI) as well as `pnpm db:test`.
- `main` is protected by the ruleset `main protection` (PR required, `CI gates` + CodeQL checks required, no force-push).
- **Guiding the user (PO):** give **one action per message** (exact click/field), then wait for "done" before the next. Never group several steps in one message. For every value the PO must enter, say up front whether it is **secret** or **config** (Vercel/GitHub ask). Do the work yourself where you can: Claude starts GitHub workflows (`DB deploy`, `Provision organization`, `Platform admin`, `Jobs`) through the GitHub tools and reads their logs — the PO only does what needs their accounts (Supabase, Vercel, GitHub settings).
- **Kawadir first (PO, 16 Oct 2026):** before designing a flow or screen, check how Kawadir ATS (`ENTLAQA-UAE/kawadir-ats`) does it — deeply, in its code — and copy it exactly (sign-in, invitations with copy link/code, Super Admin, settings pages, layout). Product settings (e-mail sender, branding, integrations) live **inside the product**, never as GitHub/Vercel/Supabase configuration. Kawadir's screenshots carry one customer's branding: Jadarat TMS uses the **Jadarat palette by default** (slate → steel gradient, no mixed hues), replaced by each organization's own colours (FR-ADM-07).
- **Talk to the PO in plain, short language** (non-technical): what was done, what it means for them, the one thing needed from them. Show progress with screenshots or side-by-side comparisons rather than descriptions.
- The Vercel connection available to Claude sessions **cannot create, list or read projects/deployments** in this team (403/empty results). Check deployment status in the Vercel dashboard (or ask the user for a screenshot); project settings changes are done by the user. To give Claude access, reconnect Vercel in claude.ai → Settings → Connectors with access to the team.
- Mermaid diagrams in docs must render on GitHub; validate with `@mermaid-js/mermaid-cli` when changing them.
