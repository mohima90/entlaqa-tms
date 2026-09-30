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
| 2 | `docs/delivery/Jadarat_TMS_Development_Plan.md` | **How** we deliver: quality bars, Definition of Ready/Done, CI gates, milestones M0–M7, quality gates, security program, templates |
| 3 | `docs/brd/Jadarat_TMS_BRD_v2.md` | **What** to build: requirements `FR-*`, `NFR-*`, priorities, releases, architecture guidance (Appendix H) |
| 4 | `docs/brd/TMS_Feature_List.md` | Feature IDs, release cut (R1 = 96 features), open decisions |
| 5 | `docs/research/TMS_Market_Comparison_vs_BRD.md` | Background: competitors, regulatory fact-check, sources |

Precedence: BRD wins on **scope**; the Development Plan wins on **process and quality**; `STATUS.md` records **what has actually happened**. Raise conflicts to the user (Product Owner) instead of guessing.

## Session routine

**At the start of every session**
1. Read `docs/delivery/STATUS.md` (current milestone, next actions, blockers).
2. Read the relevant milestone section of the Development Plan and the BRD requirements it references.
3. Confirm with the user which next action to take if it is not obvious from their request.

**At the end of every session (or after any meaningful change)**
1. Update `docs/delivery/STATUS.md`: milestone/task status, decisions made (with date), new blockers/risks, next actions, and a one-line entry in the session log.
2. If scope changed, update the BRD (increment version, add a revision-history row) **and** the feature list together.
3. Commit with a clear message referencing requirement IDs; push to the designated branch.

A project **Stop hook** (`.claude/settings.json` → `.claude/hooks/require-status-update.sh`) enforces step 1: if repository files changed (uncommitted, or committed on the branch but not yet on `origin/main`) and `docs/delivery/STATUS.md` is not among them, the session is asked to update `STATUS.md` before finishing. Do not disable or bypass it.

## Non-negotiables (from Development Plan §1)

- **Security:** no known critical/high vulnerabilities at any release; deny-by-default authorization; validate all inputs; no secrets or personal data in code or logs.
- **Tenant isolation:** every table has row-level security (RLS) and an automated cross-tenant test. Tenant ID comes from the server-verified JWT, never from client input.
- **Arabic-first:** Arabic is the default language; RTL via CSS logical properties; Hijri/Gregorian dates; Arabic copy from the UX writer/glossary, not machine translation.
- **Accessibility:** WCAG 2.2 AA in Arabic and English.
- **Sovereign-ready:** everything must run self-hosted in-country (KSA/UAE); no hard dependency on Vercel-only or other vendor-only features in critical paths.
- **Suite-ready:** platform services live in platform packages; modules never read another module's tables directly (use services or events).
- **Quality gates:** never skip, disable or weaken tests or CI gates to get a green build. Flaky tests are fixed or quarantined with an owner.

## Architecture & stack (decided — see BRD Appendix H and decision D6)

- Next.js (App Router), React, TypeScript **strict**; Tailwind CSS (logical properties) + shadcn/ui; next-intl (Arabic default).
- Supabase (PostgreSQL, Auth, Storage, Realtime), used in a **self-hostable** way.
  - Use `@supabase/ssr`; verify users server-side with `supabase.auth.getUser()` (not `getSession()`).
  - RLS helper functions go in a `private` schema (never the `auth` schema); tenant claim added via a Custom Access Token Hook.
- Build Next.js with `output: 'standalone'` so it runs on Vercel (regional SaaS, region `fra1`, co-located with Supabase `eu-central-1`) and in containers (sovereign).
- **Modular monolith** in a monorepo: `apps/suite` · `packages/platform-*` · `packages/ui` · `modules/tms` (later `modules/core-hr`, …). One database per deployment, one schema per module. Cross-module communication via service interfaces or domain events (transactional outbox + PostgreSQL queue).
- Middleware matches **real URL prefixes**; route groups such as `(dashboard)` never appear in URLs.
- Architecture decisions are recorded as ADRs in `docs/adr/NNNN-title.md` (template: Development Plan Appendix E).

## Conventions

- **Requirement traceability:** feature `XXX-NN` (feature list) ↔ requirement `FR-XXX-NN` (BRD), 1:1. Never renumber or reuse IDs; mark removed items as priority **W** / release **—**. Reference IDs in stories, commits and PRs.
- **Priorities & releases:** MoSCoW (M/S/C/W); releases R1–R4, `Suite` (when the related HR Suite module ships), `—` (removed).
- **Git:** small PRs, conventional commit messages, no direct pushes to `main`, no force-push on shared branches. Use the PR template in Development Plan Appendix B.
- **Definition of Done:** Development Plan §4.2 — including RLS tests for new tables/endpoints, authorization negative tests, Arabic + English E2E, accessibility checks and audit events.
- **Regulatory content** (Qiwa, HRDF, SAMA, Emiratisation, Egypt labour/PDPL): use BRD Appendix E; never invent figures; flag anything new for legal validation.
- **Docs:** keep documents in English with Arabic terms where useful; keep tables consistent with existing formatting.

## Environment notes

- The repository currently contains **documentation only** (no application code yet).
- Vercel project **`jadarat-tms`** (team "Mohamed Attia's projects") is linked to this repository. Root `vercel.json` sets region `fra1` and an `ignoreCommand` that **skips builds while no `package.json` exists**, so docs-only commits do not fail. When the M1 scaffold lands in `apps/suite`, set the project's Root Directory to `apps/suite` and move/adapt `vercel.json` there.
- The Vercel connection available to Claude sessions can read the account but **cannot create projects** (403); project creation/settings changes may need to be done by the user in the Vercel dashboard.
- Mermaid diagrams in docs must render on GitHub; validate with `@mermaid-js/mermaid-cli` when changing them.
