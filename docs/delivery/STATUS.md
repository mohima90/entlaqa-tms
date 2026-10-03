# Jadarat TMS — Project Status

> Living document. **Every session reads this first and updates it before finishing** (see `CLAUDE.md`).

| | |
|---|---|
| **Last updated** | 1 October 2026 |
| **Current phase** | **M1 Foundation in progress** — foundation merged (PR #9); **staging database live** (all migrations applied and verified, access-token hook enabled, 1 Oct 2026); **sign-in live on staging** (T-M1-D03 done: e-mail + password, organization `entlaqa-demo`, sign-out, audit) — CI on PostgreSQL 17 and component library done — next: threat models, self-hosted spike, estimation · **M0 done** (Gate G0 passed 3 Oct 2026) |
| **Next gate** | G0 (PO setup tasks) → G1 (Foundation sign-off) |
| **Overall status** | 🟢 On track (no build started; dates are targets until Gate G1 re-baseline) |

---

## 1. Milestone Tracker

Status values: ⚪ Not started · 🔵 In progress · 🟢 Done (gate passed) · 🟡 Conditional pass · 🔴 Blocked / failed

| Milestone | Target weeks | Status | Gate | Notes |
|---|---|---|---|---|
| Planning (research, BRD, feature list, delivery plan) | — | 🟢 Done | — | See §4 documents |
| M0 Mobilize | 1–2 | 🟢 Done | G0 | **Gate G0 passed 3 Oct 2026.** T-M0-01…07, 09, 10 done (MFA on GitHub, Supabase, Vercel confirmed); T-M0-08 (→ 2-week customer trials ≈ end of M5) and T-M0-11 deferred by PO; T-M0-12/13 needed later |
| M1 Foundation | 3–8 | 🔵 In progress | G1 | Foundation merged (#9); walking skeleton live on staging (#10–#14); component library + Storybook done (T-M1-A02); remaining: per-epic threat models, self-hosted spike, estimation |
| M2 Platform core | 9–12 | ⚪ Not started | G2 | |
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
- [ ] Track D: walking skeleton on the self-hosted stack (T-M1-D04)
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
| Risk | **Sign-in rate limiting** (security review of T-M1-D03, Medium): Auth calls come from the app server, so Supabase's per-IP limits count the server's address — no per-attacker/per-account slowdown, and one attacker can exhaust the shared limit (also via forged session cookies that trigger refreshes). Application limiter (client IP + e-mail hash, SCS-16) + failed-sign-in security events in `EP-M2-IAM`. **Release blocker before any real user** (design partners); acceptable on staging with test accounts only | Claude (M2) / PO accepts for staging | Open |
| Risk | Session lifetime: `@supabase/ssr` cookie defaults are long-lived; set Supabase Auth session time-box + inactivity timeout (Pro plan) before real users | PO / Claude | Open |
| Risk | Regulatory figures need legal validation before release (BRD Appendix E) | PO / Legal | Open |
| Security | Old codebase history (commit `9ca478b`) contained a committed `.env.local`: the leaked Vercel OIDC token was short-lived (hours) and project-bound — the old Vercel project itself still exists and should be deleted (see note above) and the old Supabase project `wtsdtyizauavvgolmygx` is deleted (DNS NXDOMAIN, checked 1 Oct 2026); the "Stripe" value was a UI placeholder (`sk_live_xxxx…`), not a key. History purge optional | PO | **Closed** 1 Oct 2026 |
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
3. **T-M0-13** Approve the error-tracking vendor (Claude prepares a one-page recommendation: Sentry EU vs. GlitchTip).
4. Optional: upgrade Supabase org `entlaqa-TMS` to Pro (no pausing, backups) before customer trials.
5. When usability round 1 is due (end of M1): pick 5–8 ENTLAQA staff who did not work on the BRD (Claude prepares the sessions).

**Next Claude session** — continue M1:
1. T-M1-C02 per-epic threat models for M2 epics.
2. T-M1-D04 self-hosted stack spike (needs a Docker-capable environment).
3. T-M1-B14 estimation and re-baselined plan → Gate G1.
4. Check R-33 (`braces` advisory) at the start of each session: when a patched release exists, update and remove the `ignoreGhsas` entry in `pnpm-workspace.yaml`.
5. M0 support: T-M0-12 pen-test vendor shortlist; T-M0-13 error-tracking recommendation (Sentry EU vs. GlitchTip, ADR 0009 §4).

---

## 6. Session Log

| Date | Summary |
|---|---|
| 3 Oct 2026 | T-M1-A02 component library v1: TextField, Alert, Badge added (Button, Card, AppShell existed); Storybook 10 with language/direction and theme toolbar; new CI gate (part of gate 8) opens every story in Arabic/English × light/dark and requires zero axe violations (proved to fail on an unlabelled input); sign-in forms now use the library |
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
