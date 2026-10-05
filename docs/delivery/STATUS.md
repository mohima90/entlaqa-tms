# Jadarat TMS — Project Status

> Living document. **Every session reads this first and updates it before finishing** (see `CLAUDE.md`).

| | |
|---|---|
| **Last updated** | 4 October 2026 |
| **Current phase** | **M2 Platform core in progress** — started 4 Oct 2026 with users & roles: product-level Arabic screens in PO review before building · **M1 done** (staging live: sign-in, self-hosted stack, observability; estimation postponed and mock-up test cancelled by the PO) · **M0 done** (Gate G0 passed 3 Oct 2026) |
| **Next gate** | G2 (Platform core) |
| **Overall status** | 🟢 On track (no time plan: the PO chose to build step by step, 4 Oct 2026) |

---

## 1. Milestone Tracker

Status values: ⚪ Not started · 🔵 In progress · 🟢 Done (gate passed) · 🟡 Conditional pass · 🔴 Blocked / failed

| Milestone | Target weeks | Status | Gate | Notes |
|---|---|---|---|---|
| Planning (research, BRD, feature list, delivery plan) | — | 🟢 Done | — | See §4 documents |
| M0 Mobilize | 1–2 | 🟢 Done | G0 | **Gate G0 passed 3 Oct 2026.** T-M0-01…07, 09, 10 done (MFA on GitHub, Supabase, Vercel confirmed); T-M0-08 (→ 2-week customer trials ≈ end of M5) and T-M0-11 deferred by PO; T-M0-12/13 needed later |
| M1 Foundation | 3–8 | 🟢 Done | G1 | Foundation merged (#9); walking skeleton live on staging (#10–#14); component library + Storybook done (T-M1-A02); M2 threat models done (TM-0002…0006); self-hosted stack verified (T-M1-D04, gate 15); observability baseline done (T-M1-D06). Estimation (T-M1-B14) postponed and mock-up usability round (T-M1-A05) cancelled by the PO (4 Oct 2026) |
| M2 Platform core | 9–12 | 🔵 In progress | G2 | Started 4 Oct 2026 with users & roles (`EP-M2-IAM`): 11 Arabic screens **approved by the PO** (4 Oct 2026); build broken into T-M2-01…12 (BACKLOG); T-M2-01…04 merged (#28, #30–#33); next T-M2-05 |
| M3 Catalog & scheduling | 13–16 | ⚪ Not started | G3 | |
| M4 Enrollment & manager | 17–19 | ⚪ Not started | G4 | |
| M5 Delivery & credentials | 20–23 | ⚪ Not started | G5 | |
| M6 Integration & insights | 24–26 | ⚪ Not started | G6 | |
| M7 Hardening & R1 GA | 27–30 | ⚪ Not started | G7 | |
| R2 / R3 / R4 | months ~8–22 | ⚪ Not started | — | Outline in Development Plan §6.10 |

### M1 Foundation — deliverables checklist

- [x] Track A: design system v1 — tokens + contrast report; component library v1 in `packages/ui` with Storybook (Arabic/English × light/dark), every story axe-checked in CI (T-M1-A02)
- [x] Track A: suite shell design (`docs/design/suite-shell.md`) — merged (#9)
- [x] Track A: clickable prototype of 5 journeys (`docs/design/prototype/index.html`) — merged (#9)
- [ ] Track A: usability test round 1 — kit ready (`docs/design/research/`); **PO runs sessions with ENTLAQA staff** (PO decision, 3 Oct 2026)
- [x] Track A: AR/EN glossary (144 terms) and content style guide — merged (#9)
- [x] Track B: ADRs 0001–0011 **Accepted** (#9), 0012 Draft
- [x] Track B: R1 data model and migration conventions (`docs/architecture/`) — merged (#9)
- [ ] Track B: R1 estimation → re-baselined plan; BRD §16 updated
- [~] Track C: platform threat model TM-0001 + risk register merged (#9); per-epic models pending
- [x] Track C: ASVS 5.0 L2 mapping; secure coding standard — merged (#9)
- [x] Track D: monorepo scaffold; CI with the §5.3 gates — merged (#9), all checks green on GitHub; `CI gates` + CodeQL required on `main`
- [x] Track D: walking skeleton on staging (T-M1-D03, #10–#14) — sign-in → Arabic RTL suite shell → audit event, verified by the PO on 1 Oct 2026
- [x] Track D: walking skeleton on the self-hosted stack (T-M1-D04) — `infra/docker`, CI gate 15 (4 Oct 2026)
- [x] Track D: observability baseline (T-M1-D06) — #24, #25 and GlitchTip in `infra/docker` (4 Oct 2026); source-map upload and traces are later follow-ups
- [x] Track D: Vercel project `jadarat-tms` builds from `apps/suite` (Next.js, Node 24); `main` deployment Ready (1 Oct 2026)

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
| 1 Oct 2026 | — | Staging database: Supabase project `jadarat-tms-staging` (org `entlaqa-TMS`, Frankfurt `eu-central-1`, **Free plan** for now — PO deferred the Pro upgrade), Data API **off**, automatic RLS off (migrations enforce RLS). Migrations reach hosted environments only through the manual `DB deploy` workflow (plan → apply) |
| 1 Oct 2026 | — | `main` protected by ruleset `main protection`: PR required (0 approvals — PO is the only human), conversation resolution, required checks `CI gates` + CodeQL (javascript-typescript, actions), no force-push/deletion, empty bypass list |
| 4 Oct 2026 | — | **Technical choices are delegated to Claude (Tech Lead)** (PO, non-technical): Claude decides technical/tooling questions and records them here; only business, cost, legal and scope decisions go to the PO, explained in plain language |
| 4 Oct 2026 | — | **Re-baselined plan / estimation (T-M1-B14) postponed** (PO): no time plan now; we build the product step by step, feature by feature, starting with M2. Gate G1 is passed without the estimation item; the mock-up usability round (T-M1-A05) stays open and runs when the PO is ready |
| 5 Oct 2026 | — | **Confirmed by the PO:** the **Compliance Officer** role counts as privileged (it reads the audit log, like the Auditor), so only the Organization Admin can give it; the HR Manager gives every other ordinary role (Tech Lead proposal from the T-M2-03 review, PO "yes") |
| 5 Oct 2026 | — | **Who may manage users and roles** (PO, security decision 4 / TM-0003 D-IAM-03): the **HR Manager** may invite, edit and deactivate users and give ordinary roles; only the **Organization Admin** (Tenant Admin) may give the Organization Admin role or other privileged roles (HR Manager, Finance Manager, Auditor); nobody may give roles to themselves |
| 5 Oct 2026 | — | **My profile (self-service)** (PO, new scope FR-IAM-16 / IAM-16, R1; BRD v2.2): every user opens My profile from their own picture and changes their own **personal details** — names AR/EN, mobile, interface language, profile photo — and their **password**; the **e-mail cannot be changed**; job data (employee number, job title, department, branch, manager, hire date) stays read-only and is changed by HR / Organization Admin. Order (PO: continue the user sequence): My profile (T-M2-15) → edit user details (T-M2-13) → change roles (T-M2-14) → roles page (T-M2-05) → invitations…; no screen approval for My profile (PO: the whole UI/UX will be redesigned later) |
| 5 Oct 2026 | — | **Visual design** (PO question, not a change request): the approved screens fix content and flow only; the whole product needs an elegant visual design, and each organization admin must be able to apply their own colors and identity (FR-ADM-07, R1; theme builder FR-ADM-08 R2). The look must be **similar to Jadarat LMS** (PO). The visual design round (T-M2-04c, matching Jadarat LMS on the real pages) is **on hold until the PO asks** (PO: "continue as normal and leave the UI now"); screens keep the current tokens meanwhile; organization colors/logo (FR-ADM-07) later in M2 with `EP-M2-TEN`, on the same tokens |
| 5 Oct 2026 | — | Dependabot no longer proposes PostgreSQL **major** versions for the self-hosted stack (PO closed #29, 17 → 18): database majors are a planned migration matching hosted Supabase and CI |
| 5 Oct 2026 | — | Nationality / "is national" on person profiles stored as ordinary personal data (`pii:indirect`) **pending legal validation** of whether it is a special category under KSA/UAE/Egypt PDPL (T-M2-02 review); flagged for the legal check before the first customer |
| 4 Oct 2026 | — | **Users & roles screens approved** (PO): 11 screens kept in `docs/design/screens/m2-users-roles/`. PO feedback applied before approval: the direct manager is **picked from a list** of the department's managers (department head, line managers, …), not typed; role names stay as in BRD §4.2 («رئيس القسم» / Department Head). The approved screens show **14 roles per organization**; Platform Super Admin is ENTLAQA-only and never shown (answers security decision 3, TM-0003 D-IAM-02) |
| 4 Oct 2026 | — | **Mock-up usability round (T-M1-A05) cancelled; screens before building** (PO found the clickable mock-up too shallow; Claude proposed, PO agreed to proceed): before each feature is built, Claude shows the PO product-level Arabic screens on a design canvas for approval; ENTLAQA staff test the real product once journeys work |
| 4 Oct 2026 | — | Sentry organization `entlaqa-qv` created by the PO in the **EU data region** (verified); Data Scrubber, Default Scrubbers and Prevent Storing of IP Addresses **required** for all projects. Free plan after the 14-day trial (no card) |
| 4 Oct 2026 | — | Observability implementation choices (Tech Lead, ADR 0009 implementation notes): own closed JSON logger instead of `pino`; Sentry SDK errors-only (no tracing/OTel takeover/module patching, no source lines); Sentry CLI (FSL licence, build-time only) removed by pnpm override rather than a licence exception; staging uptime via a scheduled GitHub Actions check that opens an issue — production uptime vendor + status page to be chosen before the first customer |
| 4 Oct 2026 | — | Error tracking (T-M0-13, ADR 0009 §4): **Sentry SaaS, EU data region** for the regional cloud; **self-hosted GlitchTip** for sovereign (in-country) deployments — same Sentry SDK, no PII (`sendDefaultPii: false`, scrubbing). Account creation (PO, guided) happens with T-M1-D06 |
| 3 Oct 2026 | — | **Customer feedback via trial accounts, not design partners now** (PO): the customers who shaped the BRD will get **2-week trial accounts** on a near-complete product (target ≈ end of M5, when catalog → schedule → enroll → attend → certificate works); until then usability tests use **ENTLAQA staff** as stand-in users. Replaces "3–5 design partners signed in M0" (Development Plan §6.2, Gate G0) |
| 3 Oct 2026 | — | Dependency audit: single-advisory exception for GHSA-vfj7-8cjw-p6xm (`braces`, dev-time lint tooling only, no fix released) accepted by the PO — risk R-33; removed when a patch ships |
| 3 Oct 2026 | — | T-M0-11 (staging required reviewer) deferred: the PO is the only repository collaborator; do it before a second person gets access or before production |
| 1 Oct 2026 | — | **MFA off by default** (PO): sign-in is e-mail + password for now; later each organization chooses off / optional / required, with any authenticator app (TOTP: Google, Microsoft, Apple, …) — FR-IAM-12 unchanged (it includes "off"); ADR 0003 rev. 2 |
| 1 Oct 2026 | — | Pre-tenant server actions (sign-in, organization selection, sign-out) use `definePublicAction`, allowed only in `apps/suite/src/auth/` (CI gate) — ADR 0003 §4.7 (rev. 2) |
| 1 Oct 2026 | — | Organizations are provisioned by the manual `Provision organization` workflow (inputs: organization data + user UID only, no personal data); an existing organization is joined only with an explicit `add_to_existing` and matching names |
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
| Dependency | Customer trial (2-week trial accounts for the customers who shaped the BRD, ≥ 2 Saudi, ≥ 1 government/bank) when the core flow works (≈ end of M5) | PO | Planned |
| Risk | Usability tests with ENTLAQA staff instead of customer users (PO decision, 3 Oct 2026): staff may not behave like customers' HR/training staff and learners, so usability problems can surface later (at the M5 trial, when they cost more to fix). Mitigation: pick staff who did not work on the BRD, include non-technical roles, and keep the M5 trial early enough to fix findings before GA. Reference customers at launch depend on the trial | PO | Open |
| Dependency | Jadarat LMS APIs/webhooks for connector (needed by M6) | PO / Jadarat team | Open |
| Note | Vercel project `jadarat-tms` (team "Mohamed Attia's projects") builds from Root Directory `apps/suite` since 1 Oct 2026. The **old** project `entlaqa-tms` (team "Mohamed Ibrahim's projects") is still connected to the repo (seen on PR #10, 1 Oct 2026); the root `vercel.json` (`ignoreCommand: exit 0`) makes it skip builds — keep it until the PO deletes that project | PO | Open |
| Risk | Staging is on Supabase **Free**: pauses after ~7 days idle (Restore in dashboard), no daily backups. Upgrade the org to Pro before customer trials | PO | Open |
| Note | Dependabot npm run of 30 Sep 2026 failed: it tried `@types/node` 24 → 26 (wrong for the Node 24 runtime) and pnpm's 3-day release-age rule refused the then-new `next-intl` 4.14.8 in the lockfile. Fixed: `@types/node` major updates ignored; the release-age refusal clears by itself before the next weekly run | DevOps | Done 1 Oct 2026 |
| Note | First `DB deploy plan` on staging (1 Oct 2026): connection + TLS `verify-full` OK, PostgreSQL 17.11; dry run stopped at migration `…120000` (`ALTER ROLE … NOSUPERUSER` is refused to a non-superuser) — nothing changed. Fixed (attributes asserted instead of set; CREATE on `private` granted to `tenant_guard` only during ownership hand-over; `auth` grants asserted) and a CI gate now runs the deploy as a non-superuser (`scripts/db-test-hosted-sim.sh`) | DevOps | Fix in PR |
| Note | Second `DB deploy plan` (1 Oct 2026, after PR #11): passed `…120000`, stopped loudly in `…120100` — hosted `postgres` has `USAGE` on `auth` without the grant option, so `tenant_guard` cannot read `auth.sessions`. Nothing changed. Resolved by **ADR 0002 §6a rev. 2**: `tenant_guard` reads `auth.sessions` through the view `private.auth_session_validity` (owned by the migration role, SELECT for `tenant_guard` only; no function runs with the migration role's rights); simulation gate now mirrors the observed Supabase grants | DevOps | Done (PR #12) |
| Note | **Staging database deployed (1 Oct 2026):** third `plan` clean; `apply` ran all 6 migrations, set `app_server`/`app_worker` passwords (SCRAM) and passed `verify-deployment.sql` with **no warnings** on PostgreSQL 17.11; PO enabled Authentication → Hooks → Customize Access Token → `private.custom_access_token_hook` | DevOps | Done |
| Note | `revoke temporary on database … from public` took effect on hosted Supabase (no warning from `verify-deployment.sql` on 1 Oct 2026) — risk closed | DevOps | Closed |
| Risk | **Sign-in rate limiting** (register **R-34**, score 20; security review of T-M1-D03, Medium): Auth calls come from the app server, so Supabase's per-IP limits count the server's address — no per-attacker/per-account slowdown, and one attacker can exhaust the shared limit (also via forged session cookies that trigger refreshes). Application limiter (client IP + e-mail hash, SCS-16) + failed-sign-in security events in `EP-M2-IAM`. **Release blocker before any real user** (design partners); acceptable on staging with test accounts only | Claude (M2) / PO accepts for staging | Open |
| Risk | Session lifetime (register **R-36**): `@supabase/ssr` cookie defaults are long-lived; set Supabase Auth session time-box + inactivity timeout (Pro plan) before real users | PO / Claude | Open |
| Risk | Regulatory figures need legal validation before release (BRD Appendix E) | PO / Legal | Open |
| Security | Old codebase history (commit `9ca478b`) contained a committed `.env.local`: the leaked Vercel OIDC token was short-lived (hours) and project-bound — the old Vercel project itself still exists and should be deleted (see note above) and the old Supabase project `wtsdtyizauavvgolmygx` is deleted (DNS NXDOMAIN, checked 1 Oct 2026); the "Stripe" value was a UI placeholder (`sk_live_xxxx…`), not a key. History purge optional | PO | **Closed** 1 Oct 2026 |
| Decision | Scope questions in `docs/architecture/r1-data-model.md` §7: LMS trigger without programs, competency prerequisites, audiences in R1, provider evaluations before registry, external-instructor logins in R1, data scopes in R1, audit retention, vendor approvals | PO | Open |
| Decision | Design: brand colours/logo, IBM Plex font licence & self-hosting, two Arabic terms to validate in usability round 1 | PO | Open |
| Legal | Egypt PDPL grace period ends ~2 Nov 2026 (Egyptian tenants at GA?); SDAIA SCCs + transfer risk assessment before first Saudi tenant | PO / Legal | Open |

---

## 4. Documents

| Document | Version | Status |
|---|---|---|
| `docs/brd/Jadarat_TMS_BRD_v2.md` | 2.2 | Draft for stakeholder review (FR-IAM-16 added 5 Oct 2026) |
| `docs/brd/TMS_Feature_List.md` | 5 Oct 2026 | Current (290 features; 281 in scope; R1 = 97 — IAM-16 added) |
| `docs/delivery/Jadarat_TMS_Development_Plan.md` | 1.1 | §2.3 agent-team operating model added |
| `docs/research/TMS_Market_Comparison_vs_BRD.md` | 27 Sep 2026 | Reference |
| `docs/delivery/BACKLOG.md` | 1 Oct 2026 | Current task list (M0, M1 tasks; M2–M7 epics) |
| `docs/adr/` | — | 0001–0011 Accepted (#9); 0012 Draft |
| `docs/engineering/db-deploy.md` | 1 Oct 2026 | Runbook for migrations on hosted environments |
| `docs/engineering/staging-sign-in.md` | 1 Oct 2026 | Runbook: sign-in configuration (Vercel env vars, Supabase Auth), provisioning organizations, checks |
| `docs/adr/0003-authentication-and-authorization.md` | rev. 2 | §4.7 pre-tenant actions; MFA off by default |

---

## 5. Next Actions

**Product Owner (user)** — Claude guides each step one action at a time (PO request, 1 Oct 2026)
1. Later: **T-M0-11** required reviewer on `staging` — before anyone else gets repository access.
2. Old Vercel project `entlaqa-tms` (team "Mohamed Ibrahim's projects"): the PO's Vercel account has no access to that team (1 Oct 2026). Harmless while the root `vercel.json` skips its builds; delete it if access is recovered, or ask Vercel support.
3. Optional: upgrade Supabase org `entlaqa-TMS` to Pro (no pausing, backups) before customer trials.
4. Soon (T-M2-06): choose the e-mail sending service for the cloud version (Claude will explain the options and costs in one message).
5. When the first real journeys work: pick 5–8 ENTLAQA staff who did not work on the BRD to try the real product (Claude prepares the sessions).
6. ~~DB deploy of T-M2-01…04a to staging~~ **Done 5 Oct 2026** (plan, then apply: 13 migrations, verification passed; the roles backfill made only the PO's account Organization Admin — one provisioning run ever, one member).
7. After My profile is merged (T-M2-15a): one migration to deploy (plan → apply), and two Supabase Auth settings on staging — "Require current password when updating" on, minimum password length 12 (`docs/engineering/db-deploy.md`); Claude guides one click at a time.

**Security decisions for M2 (from TM-0002…0006, 3 Oct 2026)** — needed before the related M2 stories start; Claude will bring them one at a time:
1. Always require an authenticator code for high-risk actions (role changes, exports), even when an organization turns MFA off? (TM-0003 D-IAM-01; recommended: yes)
2. Ask each new organization's first administrator to set up an authenticator app during onboarding ("required for administrators" by default)? (TM-0002 F-TEN-05)
3. ~~"Platform Super Admin" only for ENTLAQA staff → 14 roles per organization?~~ **Answered 4 Oct 2026** with the approved screens (14 roles shown) — BRD §4.2 wording to be aligned in the next BRD revision (TM-0003 D-IAM-02)
4. ~~HR Managers may invite users and give ordinary roles; only a Tenant Admin can create another Tenant Admin?~~ **Answered 5 Oct 2026: yes** (TM-0003 D-IAM-03)
5. A person in several organizations follows the strictest password rules? (TM-0003 D-IAM-04)
6. No national ID / Iqama numbers collected in R1 (no R1 feature needs them)? (TM-0004 F-PEO-05)
7. Automatic HR file/SFTP sync: R1 or R2? (BRD and feature list disagree; TM-0004 F-PEO-06)
8. Which ENTLAQA console actions need a second staff approval (delete organization, change data location, exports, reactivation)? (TM-0002 PC-5)
9. No paper/offline consent in R1? (TM-0005 F-AUD-06)
10. Which countries may sign up without sales at launch (Egypt time-critical, ~2 Nov 2026)? (R-40; legal)
11. May support staff outside KSA/UAE access in-country customers' data? (legal; TM-0002 L-TEN-04)
12. Retention: audit logs (7 years proposed), expired trials, cancelled organizations, leavers' contact details (legal)
13. Counsel to confirm lawful basis for location at check-in, photos, WhatsApp, AI; effect of consent withdrawal; whether nationality/gender/birth date are sensitive (legal)
14. Manual procedure for employee data requests ready before the first paying customer? (R-51)
15. Supabase Pro before real users (session time limits)? (R-36)
16. Accept residual risks: self-declared organization identity/country, repeated free trials, rare missing sign-out records, HR may change who manages whom, e-mail content leaves our control, "delivered" ≠ read (RR-TEN-01/02/07, RR-AUD-05, RR-PEO-01, RR-SHL-01/07)
17. Who at ENTLAQA confirms official Hijri dates and holidays each year? (TM-0006 RR-SHL-04)

**Next Claude session** — M2:
0. Build `EP-M2-IAM` in the BACKLOG order (T-M2-01 → T-M2-12). Bring security decisions 4 (at T-M2-03) and 1, 2, 5 (at T-M2-10) and the e-mail provider (T-M2-06) to the PO one at a time when the task needs them. Decision 3 is answered (14 roles, screens approval).
1. Turn the Tech Lead findings of TM-0002…0006 into M2 backlog stories/ADR updates (e.g. audit-table hardening F-AUD-01, `persons` grants F-PEO-01, host resolution F-TEN-02/03, Host-derived tenant label F-SHL-08); T-M1-C02 for M3–M6 epics before each starts.
2. Observability follow-ups (scheduled uptime check confirmed running: first scheduled run green, 4 Oct 2026 17:04 UTC): before the first customer — separate Sentry browser project (`SENTRY_BROWSER_DSN`), per-key rate limits in Sentry, optional Vercel firewall rule, production uptime vendor + status page (PO, guided; runbook); later — source-map upload, OpenTelemetry traces/metrics + alerts (M2/M3).
3. T-M1-B14 estimation: postponed by the PO; only when the PO asks.
4. Check R-33 (`braces` advisory) at the start of each session: when a patched release exists, update and remove the `ignoreGhsas` entry in `pnpm-workspace.yaml`.
5. M0 support: T-M0-12 pen-test vendor shortlist.
6. Self-hosted follow-ups (infra/docker/README.md): JWT key rotation with overlap, verification-attempt hooks (with R-34), Storage/Realtime/Supavisor when used.

---

## 6. Session Log

| Date | Summary |
|---|---|
| 5 Oct 2026 | T-M2-15a built (My profile): own personal details + password change, header picture link, person write guard in the database (F-PEO-01); unit, pgTAP, preview E2E (100 checks) and signed-in E2E on the self-hosted stack pass; review next |
| 5 Oct 2026 | PO added self-service My profile (personal details + password, e-mail locked, job data with HR): BRD v2.2 FR-IAM-16, feature IAM-16 (R1 = 97), backlog T-M2-15 next in the user sequence |
| 5 Oct 2026 | PO checked the users page on staging (works: one Organization Admin). Gap found: no task for editing a user's details or roles (screen 3) → added T-M2-13 and T-M2-14 to the backlog |
| 5 Oct 2026 | PR #33 merged (T-M2-04b users pages) → T-M2-04 done; the PO can open **إدارة المنشأة ← المستخدمون** on staging. Next: T-M2-05 roles & permissions page (screen 5) |
| 5 Oct 2026 | Staging DB deploy with the PO: plan green, apply OK (13 migrations: org structure, person profile, roles, search key, audit indexes; `verify-deployment` passed). Backfill checked first: one provisioned member only (the PO) |
| 5 Oct 2026 | T-M2-04b review: approve with fixes (2 Medium, 10 Low) → all fixed with tests (paging, screen-reader text, roles per row by role.read scope, manager link, language switch keeps filters, department filter with sub-departments); new signed-in E2E as a Line Manager passes on the self-hosted stack; re-review **approve** (2 nits fixed) |
| 5 Oct 2026 | T-M2-04b built: users list and user profile pages (Arabic/English), Organization admin → Users navigation by permission, roles/activity shown only with their permissions; unit, preview E2E (84 checks incl. axe) and signed-in E2E on the self-hosted stack pass; review next |
| 5 Oct 2026 | PR #32 merged (T-M2-04a). T-M2-04b (users pages) in progress: permission helper for pages, page queries, Hijri dates, Arabic-digit search, shared suite shell, AR/EN copy. PO: the product look must follow Jadarat LMS (visual design round T-M2-04c on hold until the PO asks) |
| 5 Oct 2026 | T-M2-04a review: approve with fixes (2 Medium, 6 Low) → all fixed with tests (activity needs audit-log permission, Arabic-aware search, audit indexes, list/profile agreement test per role); re-review **approve** (2 nits fixed; permission helper for pages carried to 04b) |
| 5 Oct 2026 | PR #31 merged (T-M2-03 roles). T-M2-04 started, split into 04a (authorized page reads, people scope filter, users list/profile queries — built, unit + integration tests pass, review next) and 04b (pages + E2E) |
| 5 Oct 2026 | T-M2-03 review: request changes (1 High: suspending/removing members was not limited by role; 4 Medium) → fixed with tests (membership guard, admin roles with end dates do not count, system jobs never touch privileged roles, `canAssignRole` via `authorize()` incl. AAL2; Compliance Officer made privileged so HR can give every other role, consistent app ↔ database); re-review next |
| 5 Oct 2026 | T-M2-03 built: 14 system roles with their permissions, role assignments (one primary + extras), database guard for who may give which role (PO decision), at least one Organization Admin kept, grants now loaded on every action; database, integration and unit tests pass; review next |
| 5 Oct 2026 | PR #30 merged (T-M2-02 person profile). PO closed Dependabot #29 (PostgreSQL 18); majors now ignored. PO decided who manages users & roles (HR Manager: ordinary roles; Organization Admin: privileged roles). T-M2-03 (roles) started |
| 5 Oct 2026 | PR #28 merged (T-M2-01 branches + departments; approved screens + M2 plan). T-M2-02 built: person profile fields (Arabic/English name parts, mobile, locale, nationality) and placement table (branch, department, job title, direct manager with no loops); all database tests + hosted simulation pass; independent review (2 Medium + 7 Low fixed) → **approve** |
| 4 Oct 2026 | T-M2-01 built: branches + departments tables with tenant isolation, tree rules and tamper-proof created/updated/deleted stamps; three independent review rounds (2 Medium + 7 Low fixed, concurrency verified with two sessions) → **approve**; all database tests and the hosted-Supabase simulation pass |
| 4 Oct 2026 | PO approved the 11 users & roles screens after one change (direct manager chosen from the department's managers); screens saved in `docs/design/screens/m2-users-roles/`, glossary +4 terms (sign-in session, invitation, deactivate, primary/additional role); `EP-M2-IAM` broken into T-M2-01…12 |
| 4 Oct 2026 | M2 started with users & roles: 11 product-level Arabic screens (users list with filters, invite with primary + extra roles, profile with sign-in sessions and audit trail, deactivate with reassignment, roles & permission matrix from BRD Appendix B, security settings, bilingual invitation e-mail, accept invitation, expired/revoked/used links, forgot/reset password) sent to the PO for review; T-M1-A05 cancelled (mock-up too shallow), M1 closed |
| 4 Oct 2026 | PR #27 merged (GlitchTip in-country error tracking; T-M1-D06 done). PO: skip the time plan for now, build step by step — M2 starts with users & roles (invitations, roles, password reset) |
| 4 Oct 2026 | T-M1-D06 done: GlitchTip 6.2.6 (MIT) in `infra/docker` (all-in-one, own `errors-db`, 90-day retention, UI on 127.0.0.1:8100, registration off), bootstrap script prints the internal DSN; gate 15 now sends a browser error (tunnel) and a server error (sign-in with Auth down, new `e2e/auth-outage.spec.ts`) and checks both arrive in GlitchTip redacted, without planted personal data — passed locally |
| 4 Oct 2026 | PR #25 merged (browser errors via scrubbing tunnel, `definePublicRoute`); Dependabot #20, #21, #23 merged by the PO. Dependabot now sends ONE combined weekly PR for all minor/patch updates (PO request; majors stay separate); vite 8.3.2 applied by hand with a lockfile dedupe (Dependabot #22 could not rebase — two vite copies broke type-checking) |
| 4 Oct 2026 | T-M1-D06 part b (1): browser error reporting through a same-origin scrubbing tunnel (`/api/monitoring/errors`, rate-limited, error events only, re-scrubbed, runtime DSN), verified live (no PII, CSP clean); review fixes: events rebuilt from an allow-list, one event per envelope, per-client + per-instance limits, optional separate browser DSN, `definePublicRoute` gate tightened; found Sentry v11 replaced `sendDefaultPii` with `dataCollection` (defaults collect everything) — now explicitly off for server and browser; `/favicon.ico` → `/icon.svg`; client JS 207/250 KiB |
| 4 Oct 2026 | PR #24 merged (T-M1-D06 part a). Staging configured by the PO (guided): Vercel `SENTRY_DSN` (Production + Preview) and `JADARAT_ENVIRONMENT=staging`, redeployed — logs show "error tracking on", `/api/health/ready` = ok; GitHub variable `UPTIME_URL=https://jadarat-tms.vercel.app` — first uptime run green |
| 4 Oct 2026 | PR #19 merged (T-M1-D04). T-M1-D06 part a: PO created Sentry (EU, scrubbing required); new `platform-observability` (closed JSON logger, PII scrubbing, error-reporting hook); server-side Sentry with runtime DSN, verified end to end with a real sign-in error (no e-mail/password/source lines sent); `/api/health/live` + `/ready`; staging uptime workflow; smoke test now scans app logs for PII; runbook `docs/engineering/observability.md`. Independent review (request changes) fixed: query strings removed from reports, exception messages redacted by default (error codes tagged instead), bounded/truncated scrubbing (ReDoS), console output scrubbed, Vercel `waitUntil` for reports, single in-flight readiness probe with cancel, uptime issues limited to the workflow's own. Found: Supabase Auth logs sign-in e-mails (third-party; follow-up) |
| 4 Oct 2026 | T-M1-D04 done: whole product runs self-hosted (Postgres 17.11, Supabase Auth/GoTrue with the access-token hook, TLS gateway, distroless app container); real sign-in, audit, session revocation and TLS verified; ADR 0010 §3a blockers pass (hook incl. session_id, ES256/JWKS, TOTP→aal2); new CI gate 15 + app image scan; fix: Supabase settings read at runtime (were inlined at build time); risk R-56 (third-party image patching). Independent review fixes: Auth DB password sent only as a SCRAM verifier (was visible in the DDL log), TLS required by `pg_hba.conf`, isolated networks (app reaches Auth only via the gateway), name-constrained CA, keys 0600, container hardening + health checks; smoke test now asserts each of these |
| 4 Oct 2026 | PR #18 merged (M2 threat models, risk register v0.2); PO delegated technical choices to Claude; T-M0-13 decided: Sentry EU (cloud) + GlitchTip (sovereign) |
| 3 Oct 2026 | Independent review of the M2 threat models: approve with fixes — fixed (8 new risks rescored to at least their worst threat, R-34 and R-37 now 20; evidence/wording corrections; register v0.2 in the index) |
| 3 Oct 2026 | T-M1-C02 (M2 part): five per-epic threat models TM-0002 tenancy & onboarding (39 threats), TM-0003 identity & roles (44), TM-0004 people directory (30), TM-0005 audit & consent (33), TM-0006 shell & notifications (32); IDs `T-<AREA>-NN`; risk register v0.2 (R-34…R-55, 55 risks); 17 PO decisions and 43 Tech Lead findings collected for M2 planning |
| 3 Oct 2026 | T-M1-A02 component library v1: TextField, Alert, Badge added (Button, Card, AppShell existed); Storybook 10 with language/direction and theme toolbar; new CI gate (part of gate 8) opens every story in Arabic/English × light/dark and requires zero axe violations (proved to fail on an unlabelled input); sign-in forms now use the library. Independent review: approve with minor follow-ups — all fixed (Alert announcement guidance, TextField keeps caller descriptions + «(مطلوب)» marker per design principles §4, test server hardened, new dependency rule `no-prod-to-test-files`) |
| 3 Oct 2026 | New advisory GHSA-vfj7-8cjw-p6xm (`braces`, high, no patched release) turned CI gate 11 red on every branch; reached only via lint tooling, not in the production build → PO accepted a single-advisory audit exception (risk R-33, review 3 Nov 2026) |
| 3 Oct 2026 | CI database moved to **PostgreSQL 17.11** (same as staging; `postgres:17` pinned by digest), `supabase/config.toml` `major_version = 17`, docs updated |
| 3 Oct 2026 | MFA confirmed on GitHub (passkeys), Supabase and Vercel (T-M0-10) → **Gate G0 passed, M0 done** |
| 3 Oct 2026 | PO decisions: no design partners now — customers get 2-week trial accounts on a near-complete product (≈ end of M5); usability round 1 with ENTLAQA staff; T-M0-11 deferred. Gate G0 now waits only on T-M0-10 (MFA) |
| 1 Oct 2026 | M0 check against Development Plan §6.2: four untracked items added to BACKLOG (T-M0-10 MFA on team accounts, T-M0-11 staging required reviewer, T-M0-12 pen-test shortlist, T-M0-13 error-tracking vendor); G0 stays conditional |
| 1 Oct 2026 | PR #14 merged; **sign-in live on staging**: `DB deploy` plan + apply (`…session_tenants`, verification clean); PO set 4 Vercel env vars (publishable values as Config, DB URL as Secret) and redeployed; Supabase Auth sign-ups off, Site URL set, ECC P-256 signing key confirmed; test user created; `Provision organization` plan + apply → `entlaqa-demo`; PO signed in (organization name shown), signed out, `/ar/suite` redirects to sign-in — **T-M1-D03 done** |
| 1 Oct 2026 | T-M1-D03 sign-in built: e-mail + password via server actions (`definePublicAction`, CI-gated), `private.session_tenants()`, organization chooser, `/suite` gated on a database-accepted tenant, sign-out, `platform.auth.signed_in/_out` audit, proxy cookie refresh, verify-full TLS for app DB connections, `Provision organization` workflow (hosted-sim tested); MFA off by default (PO). Independent reviews: code "request changes" (redirect loop on revoked sessions, outage shown as wrong password, provisioning could join an existing org) and security "approve with fixes" (0 Critical/High, 2 Medium) — all fixed with tests except app-level rate limiting (recorded risk, M2); code re-review: approve |
| 1 Oct 2026 | PR #12 merged (ADR 0002 §6a rev. 2 accepted); third staging plan clean; **`DB deploy apply` succeeded** (6 migrations, role passwords, verification with no warnings, PG 17.11); PO enabled the Custom Access Token hook — staging database live |
| 1 Oct 2026 | PR #11 merged; second staging plan stopped (no grant option on `auth` for hosted `postgres`, nothing changed) → ADR 0002 §6a rev. 2: `tenant_guard` reads Auth sessions through an owner-rights view (independent review preferred it over a migration-role-owned function); simulation mirrors observed Supabase grants and reproduces both staging failures with the old code |
| 1 Oct 2026 | PR #10 merged; PO configured GitHub environment `staging` (main only; `DATABASE_URL`, two role passwords, `DATABASE_CA_CERT`); first `DB deploy plan`: TLS verify-full OK, PG 17.11, stopped on a superuser-only `ALTER ROLE` (nothing changed). Fixed migrations for a non-superuser migration role, added the hosted-Supabase simulation CI gate and stronger post-deploy checks; old Vercel project cannot be deleted (no access) |
| 1 Oct 2026 | PR #9 merged; Vercel builds `apps/suite` (Ready); Supabase staging created (Frankfurt, Data API off, Free); leaked old credentials revoked (old Supabase project deleted; old Vercel project still connected — PO to delete); `main` ruleset active; ADRs 0001–0011 Accepted; added `DB deploy` workflow (dry-run plan, apply with Supabase-CLI-compatible history, SCRAM role passwords, TLS verify-full, post-deploy verification also run in CI); independent code + security review: approve with fixes (2 High: password in libpq errors, unverified TLS; 4 Medium) — all fixed with tests |
| 27 Sep 2026 | Market research and competitor/regulatory fact-check; old codebase removed; feature list (280) and BRD v2.0 written |
| 30 Sep 2026 | Decisions D1, D2, D6, D7 and HR Suite positioning recorded (BRD v2.1); Development Plan v1.0; `CLAUDE.md` and this status tracker added for session handover |
| 30 Sep 2026 | Added project Stop hook (`.claude/settings.json`, `.claude/hooks/require-status-update.sh`) that requires this file to be updated whenever other files change in a session |
| 30 Sep 2026 | Vercel: API project creation refused (403) for Claude's connection; added `vercel.json` (region `fra1`, skip builds until `package.json` exists); PO to create project `jadarat-tms` in the dashboard |
| 30 Sep 2026 | PO created Vercel project `jadarat-tms` linked to `mohima90/entlaqa-tms`; first deployment canceled by the build-skip rule (0 check errors) |
| 30 Sep 2026 | M1 review cycle: independent code review (approve with fixes) and security review (0 Critical/High, 3 Medium, 5 Low); all findings fixed with regression tests; re-review: code **approve**, security **approve** after closing the admin-client re-export gap (new reachability rules + tests); ADR 0002 updated (transaction-local claims only, session-bound tenant, Supabase service roles) |
| 30 Sep 2026 | M1 started (PO approved tracks A–D; D3 = R2): ADRs 0001–0012, R1 data model, security baseline (TM-0001, risk register, ASVS, coding standard), design foundation + prototype, monorepo scaffold with CI gates and tested DB isolation; independent code + security review |
| 30 Sep 2026 | M0 started: team model PO + Claude agents (Plan §2.3); `BACKLOG.md` created (M0/M1 tasks, M2–M7 epics covering all 96 R1 features); PR template + CODEOWNERS added |
