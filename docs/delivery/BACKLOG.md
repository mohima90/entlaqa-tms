# Jadarat TMS — Delivery Backlog

> Working task list for the PO + Claude Code agent team (Development Plan §2.3). Sessions pick the next unblocked task from the current milestone, and update the status here and in `STATUS.md` before finishing.

**Status:** ⚪ To do · 🔵 In progress · 🟣 In review (PR open) · 🟢 Done (merged) · 🔴 Blocked
**Owner:** `PO` = human Product Owner · `Claude` = Claude Code session/agents
**IDs:** tasks `T-<milestone>-NN`; epics `EP-*` (Development Plan Appendix G); features refer to `docs/brd/TMS_Feature_List.md`.

---

## M0 — Mobilize

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M0-01 | Decide delivery team model | PO | 🟢 | PO + Claude agents (Plan §2.3) |
| T-M0-02 | Adapt Development Plan to agent team model | Claude | 🟢 | #8 |
| T-M0-03 | Create backlog file (this document) | Claude | 🟢 | #8 |
| T-M0-04 | Add PR template and CODEOWNERS | Claude | 🟢 | #8 |
| T-M0-05 | Vercel project `jadarat-tms` with build-skip rule | PO + Claude | 🟢 | #6, #7 |
| T-M0-06 | GitHub branch protection on `main` (require PR, require status checks once CI exists, block force-push/deletion) | PO | 🟢 | Ruleset `main protection` (1 Oct 2026): PR required (0 approvals), conversations resolved, checks `CI gates` + CodeQL ×2, no force-push/deletion, no bypass |
| T-M0-07 | Supabase organization + project for staging (region `eu-central-1` Frankfurt) | PO | 🟢 | `jadarat-tms-staging` (ref `kgmhlmiwlbvdmalesexv`, org `entlaqa-TMS`, Free plan), Data API off (1 Oct 2026) |
| T-M0-08 | Recruit 3–5 design partners (≥ 2 Saudi, ≥ 1 government/bank) | PO | ⚪ | Needed for usability round 1 (M1) |
| T-M0-09 | Close decision D3 (planning-cycle timing) | PO | 🟢 | Decided: R2 |

**Gate G0 (adapted):** T-M0-01…06 done; T-M0-07 scheduled; design-partner recruitment started.

---

## M1 — Foundation

### Track B — Architecture (`EP-M1-ARCH`)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M1-B01 | ADR 0001 Monorepo layout & module boundaries | Claude | 🟢 | #9 |
| T-M1-B02 | ADR 0002 Tenancy, tenant resolution, RLS pattern, JWT tenant claim | Claude | 🟢 | #9 |
| T-M1-B03 | ADR 0003 AuthN/AuthZ, permissions & data scopes | Claude | 🟢 | #9 |
| T-M1-B04 | ADR 0004 Domain events (outbox + PostgreSQL queue), idempotency | Claude | 🟢 | #9 |
| T-M1-B05 | ADR 0005 Background jobs & scheduling (self-hostable) | Claude | 🟢 | #9 |
| T-M1-B06 | ADR 0006 File storage, signed URLs, virus scanning | Claude | 🟢 | #9 |
| T-M1-B07 | ADR 0007 i18n/RTL, Hijri & working calendars, prayer times | Claude | 🟢 | #9 |
| T-M1-B08 | ADR 0008 Notification service abstraction | Claude | 🟢 | #9 |
| T-M1-B09 | ADR 0009 Observability | Claude | 🟢 | #9 |
| T-M1-B10 | ADR 0010 Sovereign deployment approach | Claude | 🟢 | #9 |
| T-M1-B11 | ADR 0011 API style, versioning, error model | Claude | 🟢 | #9 |
| T-M1-B12 | ADR 0012 AI provider abstraction & governance (draft) | Claude | 🟢 | #9 (stays Draft until R2) |
| T-M1-B13 | R1 logical data model & migration conventions | Claude | 🟢 | #9 |
| T-M1-B14 | R1 estimation and re-baselined milestone plan; update BRD §16 | Claude → PO approval | ⚪ | After PR review; needs throughput data |

### Track C — Security baseline (`EP-M1-SEC`)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M1-C01 | Platform threat model (STRIDE) | Claude | 🟢 | #9 |
| T-M1-C02 | Threat models for R1 epics (M2–M6) | Claude | ⚪ | Per-epic threat models, before each epic starts |
| T-M1-C03 | Risk register | Claude | 🟢 | #9 |
| T-M1-C04 | OWASP ASVS L2 mapping to modules | Claude | 🟢 | #9 |
| T-M1-C05 | Secure coding standard | Claude | 🟢 | #9 |

### Track D — Engineering platform (`EP-M1-PLAT`)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M1-D01 | Monorepo scaffold (`apps/suite`, `packages/ui`, `packages/platform-*`, `modules/tms`) | Claude | 🟢 | #9 |
| T-M1-D02 | CI with all 14 gates (Plan §5.3) | Claude | 🟢 | #9; all 17 checks green on GitHub |
| T-M1-D03 | Walking skeleton: MFA sign-in → Arabic RTL suite shell → audit event, on staging | Claude | 🔵 | DB part done and **deployed to staging** (#9–#12, 1 Oct 2026; hook enabled); next: sign-in + MFA wiring, Auth settings, Vercel env vars |
| T-M1-D04 | Walking skeleton on self-hosted stack (Docker) | Claude | ⚪ | |
| T-M1-D05 | Vercel: Root Directory `apps/suite`, preset Next.js, move `vercel.json` | PO (dashboard) + Claude | 🟢 | Root Directory `apps/suite`, Node 24; `main` deployment Ready (1 Oct 2026) |
| T-M1-D06 | Observability baseline (errors, logs, uptime) | Claude | ⚪ | |

### Track A — UX foundation (`EP-M1-UX`)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M1-A01 | Design principles & Arabic-first design tokens | Claude | 🟢 | #9 |
| T-M1-A02 | Component library in `packages/ui` + Storybook (RTL/LTR, light/dark) | Claude | 🔵 | Primitives in packages/ui; Storybook pending |
| T-M1-A03 | Suite shell design (navigation, inboxes, search, mobile) | Claude | 🟢 | #9 |
| T-M1-A04 | Clickable prototypes of 5 critical journeys | Claude | 🟢 | #9; `docs/design/prototype/index.html` |
| T-M1-A05 | Usability test round 1 (scripts, tasks, analysis by Claude; sessions run by PO with real users) | PO + Claude | ⚪ | Kit ready (`docs/design/research/`); PO runs sessions with real users |
| T-M1-A06 | AR/EN glossary & content style guide | Claude | 🟢 | #9; 144 terms |

**Gate G1:** see Development Plan §6.3.

---

## M2–M7 — R1 build (epics; tasks are broken down at the start of each milestone)

| Milestone | Epic | Features | Status |
|---|---|---|---|
| M2 | `EP-M2-TEN` Tenancy & onboarding | ADM-01, 02, 04, 05, 07, 11, 13, 14, 17 · SUB-01 · DEP-01, 05 | ⚪ |
| M2 | `EP-M2-IAM` Identity & roles | IAM-01…05, 07, 12, 13 | ⚪ |
| M2 | `EP-M2-PEO` People directory & suite mode | STE-01, 02 | ⚪ |
| M2 | `EP-M2-AUD` Audit & consent | AUD-01, 05 | ⚪ |
| M2 | `EP-M2-SHELL` Suite shell, notifications, Hijri | STE-08 · NTF-01, 02, 07 · SCH-07 | ⚪ |
| M3 | `EP-M3-CAT` Catalog | CAT-01, 02, 03, 05, 06, 10 | ⚪ |
| M3 | `EP-M3-SCH` Scheduling & conflicts | SCH-01, 02, 03, 05, 08 · FIN-03 | ⚪ |
| M3 | `EP-M3-RES` Venues & resources | RES-01, 02, 03, 07 | ⚪ |
| M3 | `EP-M3-INS` Instructors & portal | INS-01…05 | ⚪ |
| M4 | `EP-M4-ENR` Enrollment, requests & approvals | ENR-01, 02, 03, 13 · PLN-01 | ⚪ |
| M4 | `EP-M4-MGR` Manager hub | MGR-01…04 | ⚪ |
| M4 | `EP-M4-LRN` Learner PWA | LRN-01, 03, 04, 07 · NTF-08 | ⚪ |
| M4 | `EP-M4-LOG` Logistics tasks | LOG-01, 02 | ⚪ |
| M5 | `EP-M5-ATT` Attendance | ATT-01…04, 09, 11 | ⚪ |
| M5 | `EP-M5-ASM` Assessments & surveys | ASM-01, 02, 04, 05, 08 | ⚪ |
| M5 | `EP-M5-CRT` Certificates & compliance | CRT-01…08 · REG-01 | ⚪ |
| M6 | `EP-M6-LMS` LMS framework & Jadarat connector | LMS-01, 02, 03, 05, 06, 07, 10 | ⚪ |
| M6 | `EP-M6-RPT` Reports & accessibility pass | RPT-01, 02 · LRN-08 | ⚪ |
| M7 | `EP-M7-HARD` Hardening & launch | — (Plan §6.9) | ⚪ |
