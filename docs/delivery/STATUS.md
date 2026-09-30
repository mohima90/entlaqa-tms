# Jadarat TMS — Project Status

> Living document. **Every session reads this first and updates it before finishing** (see `CLAUDE.md`).

| | |
|---|---|
| **Last updated** | 30 September 2026 |
| **Current phase** | **M0 Mobilize in progress** (team model decided; PO setup tasks open) |
| **Next gate** | G0 (end of M0) |
| **Overall status** | 🟢 On track (no build started; dates are targets until Gate G1 re-baseline) |

---

## 1. Milestone Tracker

Status values: ⚪ Not started · 🔵 In progress · 🟢 Done (gate passed) · 🟡 Conditional pass · 🔴 Blocked / failed

| Milestone | Target weeks | Status | Gate | Notes |
|---|---|---|---|---|
| Planning (research, BRD, feature list, delivery plan) | — | 🟢 Done | — | See §4 documents |
| M0 Mobilize | 1–2 | 🔵 In progress | G0 | Team = PO + Claude agents; see `BACKLOG.md` M0 tasks |
| M1 Foundation | 3–8 | ⚪ Not started | G1 | Tracks A (UX), B (architecture), C (security), D (engineering platform) |
| M2 Platform core | 9–12 | ⚪ Not started | G2 | |
| M3 Catalog & scheduling | 13–16 | ⚪ Not started | G3 | |
| M4 Enrollment & manager | 17–19 | ⚪ Not started | G4 | |
| M5 Delivery & credentials | 20–23 | ⚪ Not started | G5 | |
| M6 Integration & insights | 24–26 | ⚪ Not started | G6 | |
| M7 Hardening & R1 GA | 27–30 | ⚪ Not started | G7 | |
| R2 / R3 / R4 | months ~8–22 | ⚪ Not started | — | Outline in Development Plan §6.10 |

### M1 Foundation — deliverables checklist

- [ ] Track A: design system v1 (tokens, components in `packages/ui`, Storybook RTL/LTR)
- [ ] Track A: suite shell design (navigation, inboxes, search, mobile)
- [ ] Track A: clickable prototypes of 5 critical journeys
- [ ] Track A: usability test round 1 (Arabic, 5–8 users per persona) and fixes
- [ ] Track A: AR/EN glossary and content style guide
- [ ] Track B: ADRs 1–11 approved, ADR 12 drafted (list in Development Plan §6.3)
- [ ] Track B: R1 data model and migration conventions
- [ ] Track B: R1 estimation → re-baselined plan; BRD §16 updated
- [ ] Track C: threat models (platform + R1 epics); risk register
- [ ] Track C: ASVS L2 mapping; secure coding standard
- [ ] Track D: monorepo scaffold; CI/CD with all 14 gates
- [ ] Track D: walking skeleton on staging **and** self-hosted stack
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

**Next Claude session** — start M1 (order recommended):
1. Track B: ADRs 0001–0003 (monorepo/modules, tenancy/RLS, auth/permissions) → then 0004–0012.
2. Track C: platform threat model + ASVS L2 mapping (in parallel with B).
3. Track D: monorepo scaffold + CI gates once ADR 0001–0003 are merged; walking skeleton once Supabase staging exists.
4. Track A: design tokens + clickable prototypes (can run in parallel).

---

## 6. Session Log

| Date | Summary |
|---|---|
| 27 Sep 2026 | Market research and competitor/regulatory fact-check; old codebase removed; feature list (280) and BRD v2.0 written |
| 30 Sep 2026 | Decisions D1, D2, D6, D7 and HR Suite positioning recorded (BRD v2.1); Development Plan v1.0; `CLAUDE.md` and this status tracker added for session handover |
| 30 Sep 2026 | Added project Stop hook (`.claude/settings.json`, `.claude/hooks/require-status-update.sh`) that requires this file to be updated whenever other files change in a session |
| 30 Sep 2026 | Vercel: API project creation refused (403) for Claude's connection; added `vercel.json` (region `fra1`, skip builds until `package.json` exists); PO to create project `jadarat-tms` in the dashboard |
| 30 Sep 2026 | PO created Vercel project `jadarat-tms` linked to `mohima90/entlaqa-tms`; first deployment canceled by the build-skip rule (0 check errors) |
| 30 Sep 2026 | M0 started: team model PO + Claude agents (Plan §2.3); `BACKLOG.md` created (M0/M1 tasks, M2–M7 epics covering all 96 R1 features); PR template + CODEOWNERS added |
