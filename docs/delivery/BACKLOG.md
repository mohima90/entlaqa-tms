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
| T-M0-08 | ~~Recruit 3–5 design partners now~~ → **deferred (PO decision, 3 Oct 2026):** the customers who shaped the BRD get **2-week trial accounts** once a near-complete product exists (target: core flow catalog → schedule → enroll → attend → certificate working, ≈ end of M5); until then usability tests use ENTLAQA staff | PO | ⏸ | Re-planned as T-M5-TRIAL (see M5 note below); not blocking G0 |
| T-M0-09 | Close decision D3 (planning-cycle timing) | PO | 🟢 | Decided: R2 |
| T-M0-10 | MFA (two-step sign-in) on every team account: GitHub, Supabase, Vercel, the e-mail account behind them; secrets only in the password manager | PO | 🟢 | Confirmed 3 Oct 2026: enabled on GitHub (passkeys, 2FA required), Supabase and Vercel since the accounts were created (PO) |
| T-M0-11 | GitHub environment `staging`: add the PO as **Required reviewer** (every DB deploy / provisioning run waits for approval) | PO | ⏸ | Deferred (3 Oct 2026): the PO is the only repository collaborator and staging holds test data only. **Do before** a second person gets repository access or before a production environment exists |
| T-M0-12 | Pen-test vendor shortlist (KSA/UAE-capable, Arabic UI) | Claude prepares, PO contacts | ⚪ | Plan §6.2; needed by M7 (independent pen test before GA). Security tooling: CI already runs CodeQL, gitleaks, `pnpm audit`, Trivy (free) — no licences needed so far |
| T-M0-13 | Error-tracking vendor | Claude (delegated by PO, 4 Oct 2026) | 🟢 | Sentry SaaS EU region (cloud) + self-hosted GlitchTip (sovereign); same SDK (ADR 0009 §4). Account set-up with T-M1-D06 |

Plan §6.2 items that do not apply to the agent-team model (§2.3): team staffing/RACI (= T-M0-01), separate project tracker (this file), Figma (design artifacts in `docs/design/`), kick-off (`CLAUDE.md` + session routine). Open decisions D4, D5, D8–D10 are scheduled in STATUS §2 ("Needed by").

**Gate G0 (adapted): 🟢 passed 3 Oct 2026.** T-M0-01…07, 09, 10 done; T-M0-08 and T-M0-11 deferred by PO decision; T-M0-12/13 are needed later (M7 / T-M1-D06), not for G0.

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
| T-M1-C02 | Threat models for R1 epics (M2–M6) | Claude | 🔵 | **M2 done** (3 Oct 2026): TM-0002 tenancy, TM-0003 identity & roles, TM-0004 people directory, TM-0005 audit & consent, TM-0006 shell & notifications; risk register v0.2 (R-34…R-55). M3–M6 models (TM-0007…0010) before each epic starts |
| T-M1-C03 | Risk register | Claude | 🟢 | #9 |
| T-M1-C04 | OWASP ASVS L2 mapping to modules | Claude | 🟢 | #9 |
| T-M1-C05 | Secure coding standard | Claude | 🟢 | #9 |

### Track D — Engineering platform (`EP-M1-PLAT`)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M1-D01 | Monorepo scaffold (`apps/suite`, `packages/ui`, `packages/platform-*`, `modules/tms`) | Claude | 🟢 | #9 |
| T-M1-D02 | CI with all 14 gates (Plan §5.3) | Claude | 🟢 | #9; all 17 checks green on GitHub |
| T-M1-D03 | Walking skeleton: sign-in → Arabic RTL suite shell → audit event, on staging | Claude | 🟢 | #9–#14. **Live on staging (1 Oct 2026):** migration `…session_tenants` applied, Vercel env vars set, Auth sign-ups off, Site URL set, ECC signing keys confirmed; organization `entlaqa-demo` provisioned; PO signed in (`/en/suite` shows "Organization: ENTLAQA"), signed out, `/ar/suite` redirects to sign-in. MFA off by default (PO). Runbook: [staging-sign-in.md](../engineering/staging-sign-in.md) |
| T-M1-D04 | Walking skeleton on self-hosted stack (Docker) | Claude | 🟢 | 4 Oct 2026: `infra/docker` (Postgres 17.11 + Auth/GoTrue + TLS gateway + distroless app image), real browser sign-in, hook / ES256-JWKS / TOTP→aal2 verified (ADR 0010 §3a), CI gate 15 on every PR; Supabase settings now read at runtime (one image for all deployments); independent review findings fixed (secrets out of logs, TLS-only database, network isolation, hardening). Spike report: `infra/docker/README.md` |
| T-M1-D05 | Vercel: Root Directory `apps/suite`, preset Next.js, move `vercel.json` | PO (dashboard) + Claude | 🟢 | Root Directory `apps/suite`, Node 24; `main` deployment Ready (1 Oct 2026) |
| T-M1-D06 | Observability baseline (errors, logs, uptime) | Claude | 🔵 | Part a (4 Oct 2026, #24 merged, live on staging): JSON logs without PII, server-side error tracking (Sentry EU, runtime DSN), `/api/health/live`+`/ready`, staging uptime workflow, PII log scan in gate 15 — `docs/engineering/observability.md`. Part b: browser errors via a scrubbing tunnel + favicon redirect (#25 merged); next: GlitchTip in `infra/docker`, source-map upload |

### Track A — UX foundation (`EP-M1-UX`)

| ID | Task | Owner | Status | Notes / PR |
|---|---|---|---|---|
| T-M1-A01 | Design principles & Arabic-first design tokens | Claude | 🟢 | #9 |
| T-M1-A02 | Component library in `packages/ui` + Storybook (RTL/LTR, light/dark) | Claude | 🟢 | v1 (3 Oct 2026): Button, Card, TextField, Alert, Badge, AppShell; Storybook 10 with Arabic/English × light/dark toolbar; CI gate 8 runs axe on every story in all 4 modes; sign-in forms use the library. Further components arrive with the M2 screens |
| T-M1-A03 | Suite shell design (navigation, inboxes, search, mobile) | Claude | 🟢 | #9 |
| T-M1-A04 | Clickable prototypes of 5 critical journeys | Claude | 🟢 | #9; `docs/design/prototype/index.html` |
| T-M1-A05 | Usability test round 1 (scripts, tasks, analysis by Claude; sessions run by PO with **ENTLAQA staff as stand-in users** — PO decision 3 Oct 2026) | PO + Claude | ⚪ | Kit ready (`docs/design/research/`); PO runs sessions with real users |
| T-M1-A06 | AR/EN glossary & content style guide | Claude | 🟢 | #9; 144 terms |

**Gate G1:** see Development Plan §6.3.

---

## M2–M7 — R1 build (epics; tasks are broken down at the start of each milestone)

| Milestone | Epic | Features | Status |
|---|---|---|---|
| M2 | `EP-M2-TEN` Tenancy & onboarding | ADM-01, 02, 04, 05, 07, 11, 13, 14, 17 · SUB-01 · DEP-01, 05 | ⚪ |
| M2 | `EP-M2-IAM` Identity & roles | IAM-01…05, 07, 12, 13 — carry-overs from T-M1-D03: application sign-in rate limit (SCS-16, release blocker for real users), failed sign-ins as security events, MFA tenant policy (IAM-12), session time-box/inactivity, organization switch in the suite, password reset + invitations | ⚪ |
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
| M5 | `T-M5-TRIAL` Customer trial: 2-week trial accounts for the customers who shaped the BRD (≥ 2 Saudi, ≥ 1 government/bank), once catalog → schedule → enroll → attend → certificate works; Claude prepares invitations, trial guide and feedback form; PO invites (replaces T-M0-08, PO decision 3 Oct 2026) | — | ⚪ |
| M6 | `EP-M6-LMS` LMS framework & Jadarat connector | LMS-01, 02, 03, 05, 06, 07, 10 | ⚪ |
| M6 | `EP-M6-RPT` Reports & accessibility pass | RPT-01, 02 · LRN-08 | ⚪ |
| M7 | `EP-M7-HARD` Hardening & launch | — (Plan §6.9) | ⚪ |
