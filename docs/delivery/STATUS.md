# Jadarat TMS — Project Status

> Living document. **Every session reads this first and updates it before finishing** (see `CLAUDE.md`).

| | |
|---|---|
| **Last updated** | 30 September 2026 |
| **Current phase** | **M1 Foundation in progress** (all four tracks drafted; PR in review) · M0 PO setup tasks still open |
| **Next gate** | G0 (PO setup tasks) → G1 (Foundation sign-off) |
| **Overall status** | 🟢 On track (no build started; dates are targets until Gate G1 re-baseline) |

---

## 1. Milestone Tracker

Status values: ⚪ Not started · 🔵 In progress · 🟢 Done (gate passed) · 🟡 Conditional pass · 🔴 Blocked / failed

| Milestone | Target weeks | Status | Gate | Notes |
|---|---|---|---|---|
| Planning (research, BRD, feature list, delivery plan) | — | 🟢 Done | — | See §4 documents |
| M0 Mobilize | 1–2 | 🔵 In progress | G0 | Team = PO + Claude agents; see `BACKLOG.md` M0 tasks |
| M1 Foundation | 3–8 | 🔵 In progress | G1 | Tracks A–D drafted and reviewed; see `BACKLOG.md` M1 |
| M2 Platform core | 9–12 | ⚪ Not started | G2 | |
| M3 Catalog & scheduling | 13–16 | ⚪ Not started | G3 | |
| M4 Enrollment & manager | 17–19 | ⚪ Not started | G4 | |
| M5 Delivery & credentials | 20–23 | ⚪ Not started | G5 | |
| M6 Integration & insights | 24–26 | ⚪ Not started | G6 | |
| M7 Hardening & R1 GA | 27–30 | ⚪ Not started | G7 | |
| R2 / R3 / R4 | months ~8–22 | ⚪ Not started | — | Outline in Development Plan §6.10 |

### M1 Foundation — deliverables checklist

- [~] Track A: design system v1 — tokens + contrast report done; primitives in `packages/ui`; Storybook pending
- [x] Track A: suite shell design (`docs/design/suite-shell.md`) — in PR
- [x] Track A: clickable prototype of 5 journeys (`docs/design/prototype/index.html`) — in PR
- [ ] Track A: usability test round 1 — kit ready (`docs/design/research/`); **PO runs sessions**
- [x] Track A: AR/EN glossary (144 terms) and content style guide — in PR
- [x] Track B: ADRs 0001–0011 proposed, 0012 draft — in PR (approved on merge)
- [x] Track B: R1 data model and migration conventions (`docs/architecture/`) — in PR
- [ ] Track B: R1 estimation → re-baselined plan; BRD §16 updated
- [~] Track C: platform threat model TM-0001 + risk register done — in PR; per-epic models pending
- [x] Track C: ASVS 5.0 L2 mapping; secure coding standard — in PR
- [x] Track D: monorepo scaffold; CI with the §5.3 gates (green locally; CodeQL/Trivy run on GitHub) — in PR
- [~] Track D: walking skeleton — database part done and tested; needs Supabase staging (T-M0-07); self-hosted stack pending (T-M1-D04)
- [ ] Track D: point Vercel project `jadarat-tms` Root Directory to `apps/suite` and move `vercel.json` there (project created before M1 with build-skip rule)

---

## 2. Decisions Log

| Date | ID | Decision |
|---|---|---|
| 27 Sep 2026 | — | Old codebase removed from `main`; rebuild from new BRD |
| 30 Sep 2026 | D1 | No Commerce for training providers; TMS serves employers (provider management as suppliers stays) |
| 30 Sep 2026 | D2 | Government and banks are Year-1 targets → in-country KSA/UAE deployment (R3); self-hostable from R1 |
| 30 Sep 2026 | D6 | Stack: Next.js + Supabase, self-hostable, for the whole Jadarat HR Suite |
| 30 Sep 2026 | D7 | Product name: **Jadarat TMS** |
| 30 Sep 2026 | — | TMS is the first module of the planned Jadarat HR Suite (Core HR, Payroll & Time, Performance & Skills, Recruitment & Onboarding) and is also sold standalone |
| 30 Sep 2026 | — | R1 GA re-targeted to ~month 7 (week 30) including Foundation; confirmed at Gate G1 |
| 30 Sep 2026 | D3 | Full planning cycle (TNA campaigns, training plan, plan vs. actual) ships in **R2**; R1 includes training requests (PLN-01) only |
| 30 Sep 2026 | — | **Delivery team = Product Owner + Claude Code agents** (Development Plan §2.3): agents author and review (separate review/security passes); PO merges and owns human-only activities (accounts, design partners, usability sessions, legal, pen test, go/no-go) |

### Open decisions (BRD §20)

| ID | Decision | Recommended default | Needed by |
|---|---|---|---|
| D4 | Next LMS connectors after Jadarat | Moodle, then SAP SuccessFactors | Before R3 |
| D5 | Messaging vendors (SMS/WhatsApp) | MENA SMS gateway + Meta WhatsApp Cloud API / BSP | Before R2 |
| D8 | Active-user vs. per-employee pricing | Active user | Before GA |
| D9 | Suite pricing model | Per-employee module pricing on shared suite licence | Before GA |
| D10 | Order of HR Suite modules after TMS | Core HR next | Before R2 planning |

---

## 3. Blockers, Risks & Dependencies

| Type | Item | Owner | Status |
|---|---|---|---|
| Dependency | Human-only activities (Plan §2.3): accounts, design partners, usability sessions, legal validation, pen test | PO | Open |
| Dependency | 3–5 design-partner customers (≥ 2 Saudi, ≥ 1 government/bank) | PO | Open |
| Dependency | Jadarat LMS APIs/webhooks for connector (needed by M6) | PO / Jadarat team | Open |
| Note | Vercel project `jadarat-tms` created 30 Sep 2026 (team "Mohamed Attia's projects", repo `mohima90/entlaqa-tms`, branch `main`, preset Other, root `./`). First deployment **canceled by the build-skip rule** as intended. At M1 scaffold: set Root Directory `apps/suite`, preset Next.js, move `vercel.json` | DevOps | Done (revisit at M1) |
| Risk | Regulatory figures need legal validation before release (BRD Appendix E) | PO / Legal | Open |
| **Security** | Old codebase history contains a committed `.env.local` (commit `9ca478b`: Vercel OIDC token, Supabase anon key) and Stripe-like values — **rotate/revoke those credentials**; consider purging history | PO | **Open — urgent** |
| Decision | Scope questions in `docs/architecture/r1-data-model.md` §7: LMS trigger without programs, competency prerequisites, audiences in R1, provider evaluations before registry, external-instructor logins in R1, data scopes in R1, audit retention, vendor approvals | PO | Open |
| Decision | Design: brand colours/logo, IBM Plex font licence & self-hosting, two Arabic terms to validate in usability round 1 | PO | Open |
| Legal | Egypt PDPL grace period ends ~2 Nov 2026 (Egyptian tenants at GA?); SDAIA SCCs + transfer risk assessment before first Saudi tenant | PO / Legal | Open |

---

## 4. Documents

| Document | Version | Status |
|---|---|---|
| `docs/brd/Jadarat_TMS_BRD_v2.md` | 2.1 | Draft for stakeholder review |
| `docs/brd/TMS_Feature_List.md` | 30 Sep 2026 | Current (289 features; 280 in scope; R1 = 96) |
| `docs/delivery/Jadarat_TMS_Development_Plan.md` | 1.1 | §2.3 agent-team operating model added |
| `docs/research/TMS_Market_Comparison_vs_BRD.md` | 27 Sep 2026 | Reference |
| `docs/delivery/BACKLOG.md` | 30 Sep 2026 | Current task list (M0, M1 tasks; M2–M7 epics) |
| `docs/adr/` | — | Not created yet (M1 Track B) |

---

## 5. Next Actions

**Product Owner (user)** — M0 tasks in `BACKLOG.md`
1. Merge the open pull request (M0: team model, backlog, PR template, CODEOWNERS).
2. **T-M0-06** GitHub branch protection: repo → Settings → Rules → Rulesets → New branch ruleset for `main`: require a pull request before merging, block force pushes, restrict deletions. (Add "require status checks" after CI exists in M1.)
3. **T-M0-07** Supabase: create an organization and a staging project in region **eu-central-1 (Frankfurt)**; share the project URL when ready (never paste keys into chat — they go into Vercel/GitHub secrets).
4. **T-M0-08** Start recruiting 3–5 design partners.
5. **T-M0-09** Decide D3 (planning cycle in R2 recommended).

**Next Claude session** — continue M1 (after the M1 foundation PR is merged):
1. Mark merged ADRs **Accepted** in `docs/adr/README.md`.
2. T-M1-D03 walking skeleton against Supabase staging (needs T-M0-07): sign-in with MFA → Arabic shell → audit event.
3. T-M1-A02 Storybook for `packages/ui`; T-M1-C02 per-epic threat models for M2 epics.
4. T-M1-D04 self-hosted stack spike (needs a Docker-capable environment).
5. T-M1-B14 estimation and re-baselined plan → Gate G1.

---

## 6. Session Log

| Date | Summary |
|---|---|
| 27 Sep 2026 | Market research and competitor/regulatory fact-check; old codebase removed; feature list (280) and BRD v2.0 written |
| 30 Sep 2026 | Decisions D1, D2, D6, D7 and HR Suite positioning recorded (BRD v2.1); Development Plan v1.0; `CLAUDE.md` and this status tracker added for session handover |
| 30 Sep 2026 | Added project Stop hook (`.claude/settings.json`, `.claude/hooks/require-status-update.sh`) that requires this file to be updated whenever other files change in a session |
| 30 Sep 2026 | Vercel: API project creation refused (403) for Claude's connection; added `vercel.json` (region `fra1`, skip builds until `package.json` exists); PO to create project `jadarat-tms` in the dashboard |
| 30 Sep 2026 | PO created Vercel project `jadarat-tms` linked to `mohima90/entlaqa-tms`; first deployment canceled by the build-skip rule (0 check errors) |
| 30 Sep 2026 | M1 started (PO approved tracks A–D; D3 = R2): ADRs 0001–0012, R1 data model, security baseline (TM-0001, risk register, ASVS, coding standard), design foundation + prototype, monorepo scaffold with CI gates and tested DB isolation; independent code + security review |
| 30 Sep 2026 | M0 started: team model PO + Claude agents (Plan §2.3); `BACKLOG.md` created (M0/M1 tasks, M2–M7 epics covering all 96 R1 features); PR template + CODEOWNERS added |
