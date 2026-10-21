# Jadarat TMS — R1 roadmap by role

> Living document. The R1 features grouped by the role that owns them, with their verified status and the **work packages** (WP) that finish them. **One work package = one complete feature area = one PR.** A second Claude account claims a WP here (column «Claimed by») and in `BACKLOG.md` — see [`HOW-TO-START.md`](HOW-TO-START.md).

| | |
|---|---|
| **As of** | 17 Oct 2026 — branch `claude/youthful-davinci-00yhgl` @ `6ef8d58` (includes PR #61 Kawadir shell / invitation codes / Super Admin console, PR #63 roles, PR #64 structure + department-limited roles + course library + planning cycle + needs form builder + who-can-give-what) |
| **Decision** | PO, 17 Oct 2026 «Work organized by role» (STATUS §2): Organization Admin first (finish what is open), then HR Manager, then L&D Manager, then the other roles |
| **Sources** | Feature list v3.2 (`docs/brd/TMS_Feature_List.md`, R1 = 107), BRD v3.2, `docs/business-flows/`, `BACKLOG.md`, `STATUS.md`, `test-feedback-2026-10-17.md`; statuses checked in `supabase/migrations/`, `apps/suite/src/`, `packages/`, `modules/tms/` |
| **Rows** | **108** = the 107 R1 features + **IAM-08 (R1 part)**, which the R1 work builds although its release column says R2 (§7 flag 1). For split features (IAM-07, IAM-13, WFL-01/02, LMS-02 L2) only the R1 part is assessed |

**Status meanings.** **Done** = the R1 part is merged on `main` and live in production. **Partly** = some of it is merged; «What's missing» says what is left. **Not started** = no working code (a database column or a «Coming soon» menu entry counts as Not started).

**Owner rule.** The owner is the role that sets the feature up or is accountable for it (BRD §4.2, Appendix B, the FR text and the STATUS decisions of 15–17 Oct 2026). Where the L&D Manager and the Training Coordinator share a feature, the L&D Manager owns set-up and scheduling and the Training Coordinator owns day-to-day session execution (logistics, attendance). Instructor work (a custom-role template) sits with the L&D Manager / Training Coordinator.

---

## 1. Summary

| Role | Features | Done | Partly | Not started | Work packages |
|---|---|---|---|---|---|
| Organization Admin («مدير المنظمة») | 22 ¹ | 7 | 4 | 11 | WP-ADM-01 … 12 |
| HR Manager | 6 | 0 | 2 | 4 | WP-HR-01, 02 (+ WP-ADM-04 for IAM-02) |
| L&D Manager | 47 | 0 | 5 | 42 | WP-LD-01 … 13 |
| Training Coordinator | 7 | 0 | 0 | 7 | WP-TC-01, 02 |
| Department Head | 6 | 0 | 0 | 6 | WP-DH-01 (+ WP-LD-01, WP-LD-09) |
| Employee («موظف») | 8 | 0 | 1 | 7 | WP-EMP-01 … 04 (+ WP-ADM-04, WP-LD-09) |
| Platform Super Admin (ENTLAQA) | 2 | 0 | 1 | 1 | WP-SA-01 (+ WP-ADM-01, WP-ADM-06) |
| Platform / cross-cutting | 10 | 1 | 4 | 5 | WP-PLT-01 … 06 |
| **Total** | **108** | **8** | **17** | **83** | 41 WPs + WP-FIX-01 (in flight) |

¹ Includes IAM-08 (R1 part). Over the 107 R1 features only: **7 Done, 17 Partly, 83 Not started**.

**Changes since the pre-#64 inventory (17 Oct 2026, morning):** IAM-08 Partly → **Done** (department-limited roles, T-M3-09); ADM-04 and ADM-05 stay **Partly** but now with screens (levels, tree, heads, branches — T-M3-02); CAT-01, CAT-10 (course library minimal — T-M3-03), PLN-02 (cycle set-up, launch, progress — T-M3-04) and PLN-03 (needs form builder — T-M3-10) Not started → **Partly**. IAM-07 now includes the «who can give what» rule (PR #64).

---

## 2. In flight

| WP | Goal | Features | Business flow | Code areas | Migrations | Claimed by |
|---|---|---|---|---|---|---|
| **WP-FIX-01** Test feedback fixes 1–3 | The guided test's three approved fixes: Levels tab → «Organization tree» with the level chain; name fields follow the default language (English required, Arabic optional) on invite, profile, edit details and import; the organization's own level names everywhere instead of a fixed «Department» | ADM-05, IAM-01, IAM-03, IAM-04, PLN-02 (labels) | Not needed — PO approved the fixes (`test-feedback-2026-10-17.md` #1–3) | `apps/suite/src/components/{structure,users,invite,user-import,planning,roles}`, `packages/platform-import/src/users`, `packages/platform-i18n/messages` | `202610211xxxxx` (only if a check changes) | Tech lead session (17 Oct 2026, building) |

Feedback #4 (department-limited L&D Manager) is **agreed** and built with consolidation → WP-LD-02.

---

## 3. Features by role

Business-flow files live in `docs/business-flows/`: **EP-EMAIL** (`EP-EMAIL-email-sending.md`, *In discussion*), **EP-KAW-AUTH** (*Agreed 16 Oct*), **EP-ROLES** (*Agreed 17 Oct*), **EP-ORG** (*Agreed 17 Oct*), **EP-PLN** (`EP-PLN-planning-cycle.md`, *Agreed 17 Oct*). «none» = no flow written yet.

### 3.1 Organization Admin («مدير المنظمة») — set-up role, no training features (BR-IAM-4)

Done 7 · Partly 4 · Not started 11

| ID | Feature (R1 part) | Status | What's missing | Business flow | WP |
|---|---|---|---|---|---|
| ADM-02 | General settings: industry, country presets, timezone, language, date display, currency, fiscal year, working week | **Done** | The AR/EN display names moved to Branding (built 20 Oct 2026 in WP-ADM-02; the page links there) | none (built before the flow rule; Kawadir alignment §5) | WP-ADM-02 (names move) |
| ADM-07 | Branding: names AR/EN, logo, favicon, sign-in image, primary + secondary colour, gradient, presets, website | **Built (PR pending)** | Built 20 Oct 2026 in WP-ADM-02: Organization → Branding (names, logo / favicon / sign-in image — PNG/JPG/WebP, checked by content, not virus-scanned since 20 Oct 2026 (PO «B»: shown at once on save) —, colours with picker, presets, «Use gradient», contrast warning, website, live preview, reset); applied to the shell, favicon, sign-in page and e-mails; public metadata-free copies at `/api/brand/<id>`, published when saved (WP-ADM-02b) (`docs/engineering/branding.md`). Awaiting review and merge | EP-BRAND — **Agreed** (20 Oct 2026) | WP-ADM-02 |
| NTF-11 | Email integration: platform sender by default, or the organization's own provider; from, reply-to, test send | **Built (PR pending)** | Built 17 Oct 2026 in WP-ADM-01: Settings → Email integration (Resend / SMTP / SendGrid / Mailgun / Microsoft 365, from, reply-to, test send, enable / switch back, delivery errors); platform sender set by the Super Admin; secrets sealed for the worker. Awaiting review and merge | EP-EMAIL — **Agreed** (17 Oct 2026) | WP-ADM-01 |
| IAM-07 | Six standard roles, custom role builder, one role per person, who can give what | **Done** | Remove / restore standard roles is R2 | EP-ROLES — Agreed | — |
| IAM-08 | (R1 part) one scope per custom role: own / team / a department (one unit picked when given, everything under it) / organization | **Done** | Unit-scoped *manage* permissions for planning (feedback #4) come with WP-LD-02. Feature list release column still says R2 (§7 flag 1) | EP-ORG + EP-ROLES — Agreed | (WP-LD-02) |
| IAM-01 | User directory: AR/EN names, employee no., job title, unit, branch, manager, nationality, photo, custom fields | **Partly** | Profile photo; custom fields; `grade` column unused. English-first required name → WP-FIX-01 | none (screens approved 4 Oct) | WP-ADM-04, WP-ADM-07 |
| IAM-03 | Invitations: codes and links (Copy code / Copy invite link), resend = new code, revoke, 7 days; Team members page | **Done** | Custom invitation text is NTF-10 (R2). E-mailed invitations need a sender (WP-ADM-01) | EP-KAW-AUTH — Agreed | — |
| IAM-04 | Bulk import wizard CSV/XLSX | **Done** | HR-only fields join with WP-ADM-04 | none (screens approved 9 Oct) | — |
| IAM-05 | Deactivate / reactivate with hand-over | **Done** | Module hand-overs (sessions, approvals) plug into `lib/responsibilities.ts` as modules ship | none (screens approved 4 Oct) | — |
| IAM-12 | MFA: TOTP + e-mail OTP; off / optional / required; grace; trusted-device duration | **Partly** | E-mail one-time codes and trusted-device duration («Coming soon») | EP-KAW-AUTH — Agreed (extras to confirm) | WP-ADM-05 |
| IAM-13 | (R1 part) password policy, lockout, session rules, active sessions, force sign-out | **Done** | IP allow-list / access hours are R3 | EP-KAW-AUTH — Agreed | — |
| AUD-01 | Immutable audit log, searchable and exportable, before/after, IP, device | **Partly** | Audit log screen («Coming soon»), search / filter / export, IP and device columns, a general before/after diff with field redaction (TM-0005 AA-03). Exists: append-only log, every admin action audited, recent activity on the profile | none | WP-ADM-03 |
| ADM-13 | Feature toggles per organization within the edition | **Not started** | Everything (only `tenants.edition` exists) | none | WP-ADM-06 |
| ADM-11 | Custom fields builder | **Not started** | Everything | none | WP-ADM-07 |
| AUD-05 | Consent capture and withdrawal | **Not started** | Everything; legal questions open (security decision 13) | none | WP-ADM-08 |
| STE-01 | Suite or standalone mode per organization | **Not started** | Everything (only `tenants.mode` exists) | none | WP-ADM-09 |
| LMS-01 | Generic LMS connector framework | **Not started** | Everything | none | WP-ADM-10 |
| LMS-02 | Jadarat LMS connector, L2 (set-up wizard, test connection) | **Not started** | Everything; needs the Jadarat LMS APIs (open dependency) | none | WP-ADM-10 |
| LMS-03 | SSO TMS ↔ LMS, deep links | **Not started** | Everything | none | WP-ADM-10 |
| LMS-10 | Mapping UI, conflict rules, sync schedules, retry, health | **Not started** | Everything | none | WP-ADM-10 |
| ADM-01 | Self-service sign-up → trial → set-up wizard ending with «invite your L&D Manager» | **Not started** | Organizations are created from the Super Admin console (Kawadir way); `/sign-up` is «join with a code». PO decision whether still R1 (§7 flag 4) | none (conflicts with EP-KAW-AUTH) | WP-ADM-11 |
| ADM-14 | Admin home: users by status, limits, integration health, pending items, last audit events | **Not started** | `/suite` shows a set-up card only | none | WP-ADM-12 |

### 3.2 HR Manager — people records, structure, compliance

Done 0 · Partly 2 · Not started 4 (the HR Manager also uses IAM-01/03/04/05 with the Organization Admin; they count there)

| ID | Feature (R1 part) | Status | What's missing | Business flow | WP |
|---|---|---|---|---|---|
| ADM-05 | Units with levels defined per organization (default one level, Department), head per unit, cost centres | **Partly** | Cost centres; moving a unit to another parent (database supports it, no screen; preview of affected units/roles); drag-and-drop order; CSV import. «Organization tree» tab and level names → WP-FIX-01. Exists: levels, tree with «Add <next level>», heads, deactivate/delete rules (T-M3-02) | EP-ORG — Agreed (cost centres / CSV / move to confirm) | WP-HR-01 |
| ADM-04 | Branches: names, code, address, GPS, timezone, HQ, parent, working week and hours | **Partly** | GPS; working week and hours per branch. Exists: Branches page with the core fields (T-M3-02) | EP-ORG — Agreed | WP-HR-01 |
| IAM-02 | Gender, date of birth, employment category, grade (HR / Compliance only) | **Not started** | Everything (`person_employment.grade` exists, unused); legal check whether these are sensitive (security decision 13) | none | WP-ADM-04 |
| CRT-07 | Compliance rules engine (who / what / when / framework / grace) | **Not started** | Everything | none | WP-HR-02 |
| CRT-08 | Compliance dashboards and overdue alerts | **Not started** | Everything | none | WP-HR-02 |
| REG-01 | Compliance-framework engine (frameworks, requirements, evidence, packs) | **Not started** | Everything | none | WP-HR-02 |

### 3.3 L&D Manager — planning, catalog, delivery set-up, notifications, reports

Done 0 · Partly 5 · Not started 42

| ID | Feature (R1 part) | Status | What's missing | Business flow | WP |
|---|---|---|---|---|---|
| PLN-03 | Needs form: builder (forms library, sections, 12 field types, AR/EN, conditions; topic + people always present; locked at launch) and Department Head filling | **Partly** | The Department Head's needs page (filling, submit, recall) — T-M3-05. Exists: forms library, builder with preview, answer validator, default form per organization, lock at launch (T-M3-10) | EP-PLN §12 — Agreed | WP-LD-01 |
| PLN-02 | Planning cycle: name, period, scope, deadline, reminders, budget envelope per unit, needs form | **Partly** | Reminder sending and «Send reminder» (need in-app notifications — WP-PLT-01); automatic closing after the deadline (scheduled job); progress shows real states once the needs page exists. Exists: cycles list, set-up, launch, progress, deadline extension, planning settings (T-M3-04) | EP-PLN — Agreed | WP-PLT-01 (reminders), WP-LD-01 (progress) |
| PLN-05 | Consolidation by topic / course, branch, delivery type, month | **Not started** | Everything — T-M3-06 | EP-PLN — Agreed | WP-LD-02 |
| PLN-06 | Sessions needed + estimated cost per line; check against envelopes | **Not started** | Everything — T-M3-06 | EP-PLN — Agreed | WP-LD-02 |
| PLN-08 | Plan approval (Department Head → Finance → management), line rejection, locked and versioned | **Not started** | Everything — T-M3-07 | EP-PLN — Agreed | WP-LD-03 |
| WFL-01 | (R1 part) sequential approval chain, for the plan and for training requests | **Not started** | Plan chain — T-M3-07; training-request chain with WP-EMP-01 (no flow yet) | EP-PLN (plan chain only) | WP-LD-03, WP-EMP-01 |
| WFL-02 | (R1 part) steps: department head / role / named person; comments; reminders; built-in parallel Department Head step | **Not started** | Everything — T-M3-07 | EP-PLN — Agreed | WP-LD-03 |
| PLN-09 | Approved plan → courses created from lines → draft sessions and calendar | **Not started** | Everything — T-M3-08 (built with the start of scheduling, EP-PLN Q18) | EP-PLN — Agreed | WP-LD-04 |
| CAT-01 | Courses: code, AR/EN title, description, category, tags, delivery type, duration, min/max | **Partly** | Tags; «Create course from plan line» (WP-LD-04). Exists: course library with categories, delivery types, duration, min/max, estimated cost, archive (T-M3-03) | EP-PLN (minimal) — Agreed; rest none | WP-LD-05 (tags), WP-LD-04 |
| CAT-10 | Searchable catalog, Arabic normalization, filters, card/list views | **Partly** | Card/list switch; Employee read access (deferred to M4 — T-M3-03). Exists: Arabic-aware search, filters, summary cards | EP-PLN (minimal) — Agreed; rest none | WP-LD-05 |
| CAT-02 | Course templates | **Not started** | Everything | none | WP-LD-05 |
| CAT-03 | Prerequisites (AND/OR), equivalencies, target audience | **Not started** | Everything | none | WP-LD-05 |
| CAT-05 | Learning objectives and competencies | **Not started** | Everything | none | WP-LD-05 |
| CAT-06 | Materials library (versioned files, trainer-only vs. learner) | **Not started** | Everything (file storage + scanning exist) | none | WP-LD-05 |
| RES-01 | Venues | **Not started** | Everything | none | WP-LD-06 |
| RES-02 | Rooms with capacity by set-up style | **Not started** | Everything | none | WP-LD-06 |
| RES-03 | Equipment inventory and booking | **Not started** | Everything | none | WP-LD-06 |
| RES-07 | Accessibility / facility attributes | **Not started** | Everything | none | WP-LD-06 |
| INS-01 | Instructor profiles (internal / external) | **Not started** | Everything | none | WP-LD-07 |
| INS-02 | Qualifications and certifications with expiry alerts | **Not started** | Everything | none | WP-LD-07 |
| INS-03 | Qualified-to-teach matrix | **Not started** | Everything | none | WP-LD-07 |
| INS-04 | Availability, blocked dates, limits | **Not started** | Everything | none | WP-LD-07 |
| INS-05 | Instructor portal (used by the Instructor custom-role template) | **Not started** | Everything | none | WP-LD-07 |
| SCH-01 | Sessions: multi-day, per-day venue/time, recurrence, timezone | **Not started** | Everything (only a validation skeleton `buildSessionDraft` and permission `tms.session.create`) | none (draft sessions: EP-PLN) | WP-LD-04 (draft sessions), WP-LD-08 |
| SCH-02 | Session lifecycle (draft → … → completed, cancel, postpone) | **Not started** | Everything (event contract `tms-session-scheduled` exists) | none | WP-LD-08 |
| SCH-03 | Calendar views with drag-and-drop | **Not started** | Everything («Calendar» says «Coming soon») | none | WP-LD-08 |
| SCH-05 | Conflict detection (instructor, room, learner, holidays) | **Not started** | Everything | none | WP-LD-08 |
| SCH-08 | Minimum-enrollment warnings, auto-confirm / auto-cancel | **Not started** | Everything | none | WP-LD-08 |
| FIN-03 | Session cost model, estimate → actual, cost-centre allocation | **Not started** | Everything | none | WP-LD-08 |
| ENR-03 | Admin bulk enrollment (list, group, unit) | **Not started** | Everything | none | WP-LD-09 |
| ENR-13 | Learner schedule-conflict detection | **Not started** | Everything | none | WP-LD-09 |
| ASM-01 | Question bank AR/EN | **Not started** | Everything | none | WP-LD-11 |
| ASM-02 | Pre/post tests | **Not started** | Everything | none | WP-LD-11 |
| ASM-04 | Instructor grading and rubrics | **Not started** | Everything | none | WP-LD-11 |
| ASM-05 | Level 1 reaction surveys, anonymous, NPS | **Not started** | Everything | none | WP-LD-11 |
| ASM-08 | Instructor, venue, provider evaluation forms | **Not started** | Everything | none | WP-LD-11 |
| ATT-09 | Attendance thresholds → completion / certificate / subsidy eligibility | **Not started** | Everything | none | WP-LD-12 |
| CRT-01 | Certificate designer (bilingual, variables, Hijri, QR) | **Not started** | Everything | none | WP-LD-12 |
| CRT-02 | Signatories, stamps, numbering | **Not started** | Everything | none | WP-LD-12 |
| CRT-03 | Automatic issuance on completion | **Not started** | Everything | none | WP-LD-12 |
| CRT-04 | Public verification page + API | **Not started** | Everything | none | WP-LD-12 |
| CRT-05 | Expiry, renewal reminders, recertification | **Not started** | Everything | none | WP-LD-12 |
| NTF-02 | Branded bilingual e-mail templates; account e-mails sent by the platform | **Partly** | Logo/colours (WP-ADM-02); a sender set in the product (WP-ADM-01); look and texts owned by the L&D Manager (WP-LD-10). Exists: bilingual account e-mails from our worker with the organization's name | EP-EMAIL — In discussion (sending) | WP-ADM-01, WP-ADM-02, WP-LD-10 |
| NTF-07 | Event catalog with rules per event / role / channel, quiet hours | **Not started** | Everything (jobs and outbox exist) | none | WP-LD-10 |
| NTF-08 | Scheduled reminders and digests | **Not started** | Everything | none | WP-LD-10 |
| RPT-01 | Executive dashboard | **Not started** | Everything | none | WP-LD-13 |
| RPT-02 | Standard operational reports, saved views, export | **Not started** | Everything | none | WP-LD-13 |

### 3.4 Training Coordinator — day-to-day session execution

Done 0 · Partly 0 · Not started 7 (the Coordinator already adds/edits courses and views cycles and needs forms)

| ID | Feature (R1 part) | Status | What's missing | Business flow | WP |
|---|---|---|---|---|---|
| LOG-01 | Session task checklists from templates | **Not started** | Everything | none | WP-TC-01 |
| LOG-02 | Joining instructions from templates, sent automatically and on change | **Not started** | Everything | none | WP-TC-01 |
| ATT-01 | Manual roster, bulk mark | **Not started** | Everything | none | WP-TC-02 |
| ATT-02 | Rotating QR check-in | **Not started** | Everything | none | WP-TC-02 |
| ATT-03 | Geo-fenced check-in, device fingerprint | **Not started** | Everything; needs consent (WP-ADM-08) | none | WP-TC-02 |
| ATT-04 | Check-in/out per day, attended minutes | **Not started** | Everything | none | WP-TC-02 |
| ATT-11 | Printable sign-in sheets, scanned upload | **Not started** | Everything | none | WP-TC-02 |

### 3.5 Department Head — needs, approvals, team

Done 0 · Partly 0 · Not started 6

| ID | Feature (R1 part) | Status | What's missing | Business flow | WP |
|---|---|---|---|---|---|
| MGR-05 | Needs form for the team (topics, people, priority, quarter, cost, justification; submit / recall) | **Not started** | Everything — T-M3-05 (department-scoped read of the cycle is a TODO in T-M3-04) | EP-PLN — Agreed | WP-LD-01 |
| MGR-02 | Pending approvals inbox, bulk approve | **Not started** | Everything (plan approval itself is WP-LD-03) | none | WP-DH-01 |
| MGR-01 | Team dashboard | **Not started** | Everything | none | WP-DH-01 |
| MGR-03 | Team training calendar | **Not started** | Everything | none | WP-DH-01 |
| MGR-04 | One-click nominate / assign with deadline | **Not started** | Everything | none | WP-DH-01 |
| ENR-02 | Manager enrollment / nomination of direct reports | **Not started** | Everything | none | WP-LD-09 |

### 3.6 Employee («موظف»)

Done 0 · Partly 1 · Not started 7

| ID | Feature (R1 part) | Status | What's missing | Business flow | WP |
|---|---|---|---|---|---|
| IAM-16 | My profile: own names, mobile, language, photo, password | **Partly** | Profile photo (file purpose `platform.profile_photo` exists, no upload) — T-M2-15b | none (PO: no screen approval) | WP-ADM-04 |
| PLN-01 | Training requests → approval → plan line or enrollment | **Not started** | Everything; no flow (EP-PLN treats requests as an input only) | none | WP-EMP-01 |
| ENR-01 | Self-enrollment with prerequisite / capacity checks | **Not started** | Everything | none | WP-LD-09 |
| LRN-01 | My learning | **Not started** | Everything | none | WP-EMP-02 |
| LRN-03 | Personal calendar, updating .ics | **Not started** | Everything | none | WP-EMP-02 |
| LRN-07 | Notification preferences | **Not started** | Everything (interface language is in My profile) | none | WP-EMP-02 |
| LRN-04 | Installable PWA (check-in, materials, surveys, certificates) | **Not started** | Everything | none | WP-EMP-03 |
| CRT-06 | External certifications uploaded by employees, with approval | **Not started** | Everything | none | WP-EMP-04 |

### 3.7 Platform Super Admin (ENTLAQA)

Done 0 · Partly 1 · Not started 1

| ID | Feature (R1 part) | Status | What's missing | Business flow | WP |
|---|---|---|---|---|---|
| ADM-17 | Platform console: organizations, plan, limits, status, health, announcements, impersonation, platform e-mail settings; MFA | **Partly** | Platform e-mail settings (WP-ADM-01); organization status / plan / limits (WP-ADM-06); health, announcements, audited impersonation, console MFA (risk R-65) (WP-SA-01). Exists: Super Admin by user ID, Organizations list, create organization with an Org Admin code/link, reissue, platform audit | EP-KAW-AUTH — Agreed; e-mail part EP-EMAIL — In discussion | WP-ADM-01, WP-ADM-06, WP-SA-01 |
| SUB-01 | Editions and add-ons decide features and limits | **Not started** | Everything (only `tenants.edition`) | none | WP-ADM-06 |

### 3.8 Platform / cross-cutting

Done 1 · Partly 4 · Not started 5

| ID | Feature (R1 part) | Status | What's missing | Business flow | WP |
|---|---|---|---|---|---|
| STE-02 | Shared people and organization directory | **Done** (foundation) | — (the TMS module now reads people and units through platform services) | none | — |
| STE-08 | Suite shell: one navigation, module switcher, notification inbox, search, approvals inbox, PWA | **Partly** | Bell (placeholder), approvals inbox, module switcher, PWA. Exists: Kawadir shell, ⌘K page search, theme, language, account menu | none (Kawadir alignment §5; PO approved the shell 16 Oct) | WP-PLT-01 (bell), WP-PLT-03 |
| SCH-07 | Hijri / Gregorian / dual on all date pickers and displays | **Partly** | Hijri date picker; per-user preference. Exists: organization date display on every page | none | WP-PLT-02 |
| LRN-08 | WCAG 2.2 AA in Arabic and English | **Partly** (ongoing) | Kept in every WP (axe in Storybook and E2E); final pass | n/a | every WP; WP-PLT-06 |
| DEP-01 | Regional multi-tenant cloud; SDAIA SCCs + transfer risk assessment | **Partly** | Legal SCCs / TRA (PO). Exists: production on Supabase Pro Frankfurt + Vercel `fra1`, automatic DB deploy | none | PO (legal) |
| DEP-05 | Arabic-only operating mode | **Not started** | Everything | none | WP-PLT-04 |
| NTF-01 | In-app notification center (real-time) | **Not started** | Everything (bell placeholder) | none | WP-PLT-01 |
| LMS-05 | Catalog sync from LMS | **Not started** | Everything | none | WP-PLT-05 |
| LMS-06 | Enrollment push to LMS | **Not started** | Everything | none | WP-PLT-05 |
| LMS-07 | Completion / progress pull + reconciliation | **Not started** | Everything | none | WP-PLT-05 |

---

## 4. Work packages

**Columns.** *Flow* = is a business flow needed before building (CLAUDE.md «business flow first»), and its status. *Depends on* = WPs that must be merged first (soft = can start, merge after). *Code areas* = the folders the WP owns; shared files are touched only with small additive edits (HOW-TO-START §5). *Migrations* = the migration timestamp range reserved for the WP (`YYYYMMDDH…`: the WP's own day, hours 10–19 UTC), so two accounts never pick the same timestamp. *Claimed by* = session / account name, empty = free.

Path shorthands: `app/` = `apps/suite/src/app/[locale]/` · `cmp/` = `apps/suite/src/components/` · `act/` = `apps/suite/src/actions/` · `lib/` = `apps/suite/src/lib/` · `pkg/` = `packages/` · `tms/` = `modules/tms/src/` · `e2e/` = `apps/suite/e2e/` · `pgtap/` = `supabase/tests/`.

### 4.1 Organization Admin

| WP | Goal (plain language) | Features | Flow needed? | Depends on | Code areas | Migrations | Claimed by |
|---|---|---|---|---|---|---|---|
| **WP-ADM-01** E-mail sending | E-mails actually go out again: the Super Admin sets the platform sender in the console and sends a test; an organization can connect its own provider (Resend, SMTP, SendGrid, Mailgun, Microsoft 365) on **Settings → Email integration**. Today production has no sender (withdrawn from GitHub 16 Oct), so invitation and reset e-mails are not delivered | NTF-11, NTF-02 (sending), ADM-17 (platform e-mail settings); T-M2-20 (unsent invitation shown as sent); stale-delivery sweeper; production-setup §H (worker) | **Yes — EP-EMAIL, Agreed (PO, 17 Oct 2026)** | — (unblocks WP-ADM-05, WP-LD-10, WP-TC-01) | `pkg/platform-notifications/src/jobs`, `apps/worker`, new `app/suite/admin/email`, `app/platform` (settings tab), `cmp/platform`, `pkg/platform-db/src` (settings reads), `.github/workflows/jobs*.yml`, `docs/engineering/{email,production-setup}.md` | `20261022100000`, `20261022100100` | **Built 17 Oct 2026** (branch, PR to open; review pending) |
| **WP-ADM-02** Branding | The organization uploads its logo, favicon and sign-in image, picks colours (gradient, presets) and website; the product and the e-mails take its look. Display names move here from General | ADM-07, NTF-02 (brand part) | **Yes — EP-BRAND, Agreed (PO, 20 Oct 2026)** | — (soft: WP-ADM-01, both touch the e-mail layout) | new `app/suite/admin/branding`, `cmp/branding`, `pkg/ui/src/theme`, `pkg/platform-files` (new purposes, publishing task), `pkg/platform-notifications/src/layout.ts`, `act/organization.ts`, `app/api/brand` | `20261023100000`–`20261023100300` | **Built 20 Oct 2026** (branch, PR to open; review pending) |
| **WP-ADM-03** Audit log screen | Search, filter and export who did what and when, with before/after values (personal data redacted) | AUD-01 | Yes — short flow (who sees it, filters, export, retention); **not written** | — | new `app/suite/admin/audit`, `cmp/audit`, `pkg/platform-db/src/audit.ts`, audit diff builder with field redaction (TM-0005 AA-03, T-AUD-21) | `202610241xxxxx` | |
| **WP-ADM-04** People record completion | Profile photo (My profile and the person page); HR-only fields gender, date of birth, employment category, grade — seen and edited by HR / Compliance only, also in import | IAM-16 (photo), IAM-01 (photo), IAM-02; T-M2-15b, T-M2-25 | Yes — short flow (who sees the HR-only fields; legal flag for sensitive data); **not written** | WP-FIX-01 (same person forms) | `cmp/profile`, `cmp/users`, `act/{profile,users}.ts`, `lib/edit-user-form.ts`, `pkg/platform-import/src/users`, `pkg/platform-db/src/{my-profile,users,user-admin}.ts`, `pkg/platform-files` | `202610251xxxxx` | |
| **WP-ADM-05** Sign-in extras | E-mail one-time codes as a second sign-in method; «trust this device for N days» | IAM-12; T-M2-28 (= T-M2-10c without SMS) | Yes — addendum to EP-KAW-AUTH (confirm the two extras); **not written** | WP-ADM-01 | `pkg/platform-identity/src` (MFA), `cmp/security`, `cmp/mfa`, `app/mfa`, `act/security.ts` | `202610261xxxxx` | |
| **WP-ADM-06** Plan, limits and feature toggles | The Super Admin sets an organization's edition, limits and status; the Organization Admin sees the plan and its limits and switches features off for its users | ADM-13, SUB-01, ADM-17 (organization plan / limits / status); T-M2-27 | Yes — short flow (Super Admin vs. Org Admin split); **not written** | — | tenancy tables, new `app/suite/admin/subscription`, `app/platform`, `cmp/platform`, `lib/suite-navigation.ts` (toggles) | `202610271xxxxx` | |
| **WP-ADM-07** Custom fields | The organization adds its own fields to people (then courses, sessions, venues…) | ADM-11; T-M2-26 | Yes; **not written** | best after WP-LD-05, WP-LD-06, WP-LD-08 (the entities exist) — people fields can ship first | new `custom_fields` tables, `cmp/users`, forms, `pkg/platform-import` | `202610281xxxxx` | |
| **WP-ADM-08** Consent settings | Which consents are asked (location at check-in, photos, WhatsApp, AI) and how people withdraw them | AUD-05; T-M2-31 | Yes; **not written**; legal answers first (security decision 13) | legal | new consent tables, `app/suite/admin/consent` | `202610291xxxxx` | |
| **WP-ADM-09** Suite / standalone mode | Choose whether the organization runs TMS alone or inside the HR Suite (people data source) | STE-01; T-M2-32 (HR system CSV/SFTP sync is R2 in the feature list — §7 flag 5) | Yes; **not written**; security decision 7 | — | tenancy tables, `app/suite/admin/integrations` | `202610301xxxxx` | |
| **WP-ADM-10** LMS connection | Connect Jadarat LMS: set-up wizard, test, SSO and deep links, field mapping, sync schedule, health | LMS-01, LMS-02 (L2), LMS-03, LMS-10; T-M2-33 | Yes; **not written** | Jadarat LMS APIs (open dependency); WP-LD-05 | new connector package `pkg/platform-lms` (or `tms/lms`), `app/suite/admin/integrations` | `202610311xxxxx` | |
| **WP-ADM-11** Self-service sign-up + wizard | An organization signs up alone, gets a trial and is walked through set-up up to «invite your L&D Manager» | ADM-01; T-M2-24 | **PO decision first** (today organizations are created by the Super Admin, the Kawadir way), then flow | WP-ADM-01, WP-ADM-02 | `app/sign-up`, provisioning, `pkg/platform-identity` | `202611011xxxxx` | |
| **WP-ADM-12** Admin home (last) | Dashboard: users by status, limits, integration health, pending invitations, last audit events | ADM-14; T-M2-34 | Yes — short; **not written** | WP-ADM-03, WP-ADM-06, WP-ADM-10 | `app/suite/page.tsx`, `cmp/home` | `202611021xxxxx` | |

### 4.2 HR Manager

| WP | Goal (plain language) | Features | Flow needed? | Depends on | Code areas | Migrations | Claimed by |
|---|---|---|---|---|---|---|---|
| **WP-HR-01** Structure completion | Finish the structure: cost centres, move a unit under another parent (with a preview of what changes), order units by drag-and-drop, import units from CSV; GPS and working week / hours per branch | ADM-05 (rest), ADM-04 (rest) | Yes — addendum to EP-ORG (cost centres, CSV, move); **not written** | WP-FIX-01 (same structure pages) | `cmp/structure`, `act/{structure,branches}.ts`, `app/suite/admin/{structure,branches}`, `pkg/platform-db/src/branches.ts` (+ units), `pkg/platform-import` | `202611031xxxxx` | |
| **WP-HR-02** Compliance | Rules for who must take what by when, compliance dashboards with overdue alerts, regulator frameworks | CRT-07, CRT-08, REG-01 | Yes; **not written**; regulatory content from BRD Appendix E only | WP-LD-05, WP-LD-12, WP-EMP-04 | new `tms/compliance`, `app/suite/compliance` | `202611041xxxxx` | |

IAM-02 (HR-only fields) is in **WP-ADM-04**.

### 4.3 L&D Manager

| WP | Goal (plain language) | Features | Flow needed? | Depends on | Code areas | Migrations | Claimed by |
|---|---|---|---|---|---|---|---|
| **WP-LD-01** Department Head needs page | Each Department Head opens the launched cycle, sees their team from the structure and fills the cycle's needs form (topics, people, priority, quarter, cost, justification), saves, submits and can recall before the deadline; the L&D Manager's progress page shows real states | PLN-03 (filling), MGR-05, PLN-02 (progress); **T-M3-05** | Yes — **EP-PLN, Agreed** | soft: WP-FIX-01 (level names) | new `app/suite/planning/needs`, `cmp/needs-forms/needs-form-renderer.tsx` (reuse), `tms/planning`, `tms/needs-forms/validate-answers.ts`, `act/needs-forms.ts` | `202611051xxxxx` | |
| **WP-LD-02** Consolidation and budget check | L&D groups the needs by topic, branch, delivery type and month into plan lines with sessions needed and estimated cost, and compares totals with each unit's envelope; a **department-limited L&D Manager** does this for their own units (feedback #4) | PLN-05, PLN-06, IAM-08 (unit-scoped planning permissions); **T-M3-06** | Yes — **EP-PLN, Agreed**; feedback #4 agreed | WP-LD-01 | `tms/planning`, new `app/suite/planning/consolidation`, `pkg/platform-rbac` (unit-scoped permissions), `lib/role-builder.ts` (explain organization-wide permissions), permission migration | `202611061xxxxx` | |
| **WP-LD-03** Plan approval | The plan goes through the chain set at cycle set-up (Department Heads in parallel → Finance → management, named people); comments, line rejection; locked and versioned on approval; audited | PLN-08, WFL-01 (plan chain), WFL-02; **T-M3-07** | Yes — **EP-PLN, Agreed**; security review (approval integrity) | WP-LD-02; soft WP-PLT-01 (approver notifications) | `tms/planning` (+ approval engine, reusable for WP-EMP-01), new `app/suite/planning/approvals` | `202611071xxxxx` | |
| **WP-LD-04** Plan → courses → draft sessions | From each approved line, «Create course» (pre-filled) or link an existing one, then create draft sessions on a training calendar — the hand-over to delivery | PLN-09, CAT-01 (from plan line), SCH-01 (draft sessions core); **T-M3-08** | Yes — **EP-PLN, Agreed** (draft sessions); session details with WP-LD-08 | WP-LD-03 | `tms/courses/service.ts` (`createCourse`), `tms/actions/sessions.ts`, `tms/services/session-draft.ts`, new sessions table, `app/suite/planning`, `app/suite/courses` | `202611081xxxxx` | |
| **WP-LD-05** Catalog completion | Tags, templates, prerequisites and audience, objectives and competencies, materials library; card/list view; employees can browse the catalog | CAT-01 (tags), CAT-02, CAT-03, CAT-05, CAT-06, CAT-10 (rest) | Yes; **not written** | soft: WP-LD-04 (both touch the course service) | `tms/courses`, `cmp/courses`, `app/suite/courses`, `pkg/platform-files` | `202611091xxxxx` | |
| **WP-LD-06** Venues and resources | Venues, rooms with capacity, equipment, accessibility attributes | RES-01, RES-02, RES-03, RES-07 | Yes; **not written** | — | new `tms/venues`, `app/suite/venues`, `cmp/venues` | `202611101xxxxx` | |
| **WP-LD-07** Instructors and portal | Instructor profiles, qualifications with expiry alerts, qualified-to-teach matrix, availability, instructor portal | INS-01 … INS-05 | Yes; **not written** | — (Instructor custom-role template exists) | new `tms/instructors`, `app/suite/instructors`, `app/suite/teach` (portal) | `202611111xxxxx` | |
| **WP-LD-08** Sessions and scheduling | Full sessions: multi-day, recurrence, lifecycle, calendar with drag-and-drop, conflicts, minimum-enrollment rules, cost estimate → actual | SCH-01 (rest), SCH-02, SCH-03, SCH-05, SCH-08, FIN-03 | Yes; **not written** | WP-LD-04, WP-LD-06, WP-LD-07 | `tms/actions/sessions.ts`, new `tms/scheduling`, `app/suite/calendar`, `app/suite/sessions`, `pkg/contracts/src/events` | `202611121xxxxx` | |
| **WP-LD-09** Enrollment | Admin bulk enrollment, employee self-enrollment, manager nomination, learner conflict check | ENR-03, ENR-13, ENR-01 (Employee), ENR-02 (Department Head) | Yes; **not written** | WP-LD-08 | new `tms/enrollment`, `app/suite/sessions/[id]/enrollments`, `app/suite/my-learning` (enroll button) | `202611131xxxxx` | |
| **WP-LD-10** Notifications set-up | The L&D Manager sets which events notify whom on which channel, quiet hours, scheduled reminders and digests, and the e-mail look and texts | NTF-07, NTF-08, NTF-02 (look / texts) | Yes; **not written** | WP-PLT-01, WP-ADM-01, WP-ADM-02 | `pkg/platform-notifications`, new `app/suite/settings/notifications` | `202611141xxxxx` | |
| **WP-LD-11** Assessments and surveys | Question bank, pre/post tests, instructor grading, reaction surveys, evaluation forms | ASM-01, ASM-02, ASM-04, ASM-05, ASM-08 | Yes; **not written** | WP-LD-08 | new `tms/assessments`, `app/suite/assessments` | `202611151xxxxx` | |
| **WP-LD-12** Certificates | Certificate designer, signatories, automatic issuance after attendance thresholds, public verification, expiry and renewal | CRT-01 … CRT-05, ATT-09 | Yes; **not written** | WP-TC-02, WP-LD-11 | new `tms/certificates`, `app/suite/certificates`, public `app/verify` | `202611161xxxxx` | |
| **WP-LD-13** Reports | Executive dashboard and standard operational reports with filters, saved views, export | RPT-01, RPT-02 | Yes; **not written** | data from WP-LD-08 … 12 | new `tms/reports`, `app/suite/reports` | `202611171xxxxx` | |

### 4.4 Training Coordinator

| WP | Goal (plain language) | Features | Flow needed? | Depends on | Code areas | Migrations | Claimed by |
|---|---|---|---|---|---|---|---|
| **WP-TC-01** Logistics | Task checklists per session from templates; joining instructions sent automatically and on change | LOG-01, LOG-02 | Yes; **not written** | WP-LD-08, WP-ADM-01 | new `tms/logistics`, `app/suite/sessions/[id]/tasks` | `202611181xxxxx` | |
| **WP-TC-02** Attendance | Manual roster, rotating QR check-in, geo-fenced check-in, per-day minutes, printable sheets | ATT-01, ATT-02, ATT-03, ATT-04, ATT-11 | Yes; **not written** | WP-LD-09; WP-ADM-08 (for ATT-03) | new `tms/attendance`, `app/suite/sessions/[id]/attendance`, check-in route | `202611191xxxxx` | |

### 4.5 Department Head

| WP | Goal (plain language) | Features | Flow needed? | Depends on | Code areas | Migrations | Claimed by |
|---|---|---|---|---|---|---|---|
| **WP-DH-01** Manager hub | Team dashboard, approvals inbox, team calendar, one-click nominate with deadline | MGR-01, MGR-02, MGR-03, MGR-04 | Yes; **not written** | WP-LD-03, WP-LD-09 | new `app/suite/team`, `cmp/team` | `202611201xxxxx` | |

MGR-05 is in **WP-LD-01**; ENR-02 in **WP-LD-09**.

### 4.6 Employee

| WP | Goal (plain language) | Features | Flow needed? | Depends on | Code areas | Migrations | Claimed by |
|---|---|---|---|---|---|---|---|
| **WP-EMP-01** Training requests | An employee asks for a course (catalog or external) with a justification and cost; the request goes through its approval chain into a plan line or an enrollment | PLN-01, WFL-01 (request chain) | Yes; **not written** | WP-LD-03 (approval engine), WP-LD-05 | new `tms/requests`, `app/suite/requests` | `202611211xxxxx` | |
| **WP-EMP-02** My learning | My learning page (upcoming, required, requests, history, certificates), personal calendar with updating .ics, notification preferences | LRN-01, LRN-03, LRN-07 | Yes; **not written** | WP-LD-09 | new `app/suite/my-learning`, `cmp/my-learning` | `202611221xxxxx` | |
| **WP-EMP-03** Mobile app (PWA) | Installable app for check-in, materials, surveys, certificates | LRN-04 | Yes; **not written** | WP-TC-02, WP-EMP-02 | `apps/suite` (manifest, service worker), `app/suite/my-learning` | `202611231xxxxx` | |
| **WP-EMP-04** External certifications | Employees upload external certificates; HR approves them | CRT-06 | Yes; **not written** | WP-LD-12 | `tms/certificates`, `app/suite/my-learning` | `202611241xxxxx` | |

IAM-16 (photo) is in **WP-ADM-04**; ENR-01 in **WP-LD-09**.

### 4.7 Platform Super Admin

| WP | Goal (plain language) | Features | Flow needed? | Depends on | Code areas | Migrations | Claimed by |
|---|---|---|---|---|---|---|---|
| **WP-SA-01** Console completion | Console MFA (risk R-65), suspend / reactivate an organization, health, announcements, audited impersonation | ADM-17 (rest) | Yes — addendum to EP-KAW-AUTH; **not written**; security review | — | `app/platform`, `cmp/platform`, `pkg/platform-identity/src/platform-console.ts` | `202611251xxxxx` | |

Platform e-mail settings are in **WP-ADM-01**; editions, limits and organization status in **WP-ADM-06**.

### 4.8 Platform / cross-cutting

| WP | Goal (plain language) | Features | Flow needed? | Depends on | Code areas | Migrations | Claimed by |
|---|---|---|---|---|---|---|---|
| **WP-PLT-01** In-app notifications | The bell works: real-time notification center; planning-cycle reminders and «Send reminder» are sent; open cycles close automatically after their deadline | NTF-01, PLN-02 (reminders, closing job), STE-08 (bell) | Yes — short; **not written** | — (outbox and jobs exist); can start any time | `pkg/platform-notifications`, `pkg/platform-jobs`, `apps/worker`, `cmp/suite-shell.tsx` (bell), `tms/planning` (reminder events) | `202611261xxxxx` | |
| **WP-PLT-02** Hijri date picker | Date pickers and displays in Hijri, Gregorian or both, with a per-user preference | SCH-07 | No (UI component; follows the organization's setting) | — | `pkg/ui` (date picker), `pkg/platform-i18n/src/{hijri,dates}.ts`, `cmp/profile` (preference) | `202611271xxxxx` | |
| **WP-PLT-03** Suite shell completion | Approvals inbox, module switcher, mobile shell | STE-08 (rest) | Yes — short; **not written** | WP-LD-03, WP-PLT-01 | `cmp/suite-shell.tsx`, `lib/suite-navigation.ts`, `pkg/ui` | `202611281xxxxx` | |
| **WP-PLT-04** Arabic-only mode | Government organizations can run in Arabic only | DEP-05 | Yes — short; **not written** | — (late) | `pkg/platform-i18n`, tenant settings, `apps/suite/src/proxy.ts` | `202611291xxxxx` | |
| **WP-PLT-05** LMS sync | Catalog sync from the LMS, enrollment push, completion pull and reconciliation | LMS-05, LMS-06, LMS-07 | Yes; **not written** | WP-ADM-10, WP-LD-09, WP-TC-02 | LMS connector package, `apps/worker` | `202611301xxxxx` | |
| **WP-PLT-06** Accessibility pass and hardening | Final WCAG 2.2 AA pass in Arabic and English; M7 hardening | LRN-08; `EP-M7-HARD` | No | most WPs | whole app (fixes only) | `202612011xxxxx` | |

DEP-01's remaining part (SDAIA SCCs, transfer risk assessment) is legal work for the PO. STE-02 is done.

---

## 5. Order of the work packages

Role order (PO, 17 Oct 2026). Within a role, top to bottom. **A free account takes the first unclaimed WP whose flow is agreed and whose dependencies are merged**; if none is ready, it writes the next flow for the PO (HOW-TO-START §3).

| # | WP | One line | Ready now? |
|---|---|---|---|
| 0 | WP-FIX-01 | Test feedback fixes 1–3 | In flight |
| 1 | WP-ADM-01 | E-mail sending (platform sender + Email integration) | Built 17 Oct 2026 — PR, review, merge; then PO set-up (email.md §3) |
| 2 | WP-ADM-02 | Branding page | Built 20 Oct 2026 — PR, review, merge |
| 3 | WP-ADM-03 | Audit log screen | Flow to write |
| 4 | WP-ADM-04 | Profile photo + HR-only person fields | Flow to write; after WP-FIX-01 |
| 5 | WP-ADM-05 | Sign-in extras (e-mail codes, trusted devices) | After WP-ADM-01 |
| 6 | WP-ADM-06 | Plan, limits and feature toggles | Flow to write |
| 7 | WP-ADM-07 | Custom fields | Later (entities first) |
| 8 | WP-ADM-08 | Consent settings | Legal answers first |
| 9 | WP-ADM-09 | Suite / standalone mode | Flow to write |
| 10 | WP-ADM-10 | LMS connection | Jadarat LMS APIs |
| 11 | WP-ADM-11 | Self-service sign-up + wizard | R1 confirmed (PO, 21 Oct 2026) — flow to write |
| 12 | WP-ADM-12 | Admin home | Last |
| 13 | WP-HR-01 | Structure completion (cost centres, move, CSV, branch GPS / hours) | Flow addendum; after WP-FIX-01 |
| 14 | WP-HR-02 | Compliance | M5 |
| 15 | WP-LD-01 | Department Head needs page (T-M3-05) | **Yes** — flow agreed |
| 16 | WP-LD-02 | Consolidation + department-limited L&D (T-M3-06) | After WP-LD-01 |
| 17 | WP-LD-03 | Plan approval (T-M3-07) | After WP-LD-02 |
| 18 | WP-LD-04 | Plan → courses → draft sessions (T-M3-08) | After WP-LD-03 |
| 19 | WP-LD-05 | Catalog completion | Flow to write |
| 20 | WP-LD-06 | Venues and resources | Flow to write |
| 21 | WP-LD-07 | Instructors and portal | Flow to write |
| 22 | WP-LD-08 | Sessions and scheduling | After WP-LD-04/06/07 |
| 23 | WP-LD-09 | Enrollment | After WP-LD-08 |
| 24 | WP-LD-10 | Notifications set-up | After WP-PLT-01, WP-ADM-01/02 |
| 25 | WP-LD-11 | Assessments and surveys | After WP-LD-08 |
| 26 | WP-LD-12 | Certificates | After WP-TC-02, WP-LD-11 |
| 27 | WP-LD-13 | Reports | Late |
| 28 | WP-TC-01 | Logistics tasks and joining instructions | After WP-LD-08 |
| 29 | WP-TC-02 | Attendance | After WP-LD-09 |
| 30 | WP-DH-01 | Manager hub | After WP-LD-03, WP-LD-09 |
| 31 | WP-EMP-01 | Training requests | After WP-LD-03 |
| 32 | WP-EMP-02 | My learning | After WP-LD-09 |
| 33 | WP-EMP-03 | Mobile app (PWA) | After WP-TC-02 |
| 34 | WP-EMP-04 | External certifications | After WP-LD-12 |
| 35 | WP-SA-01 | Console completion (MFA, suspend, health, impersonation) | Flow addendum |
| 36 | WP-PLT-01 | In-app notifications + planning reminders | Flow to write — no dependency, good parallel pick |
| 37 | WP-PLT-02 | Hijri date picker | **Yes** — no flow needed |
| 38 | WP-PLT-03 | Suite shell completion | After WP-LD-03, WP-PLT-01 |
| 39 | WP-PLT-04 | Arabic-only mode | Late |
| 40 | WP-PLT-05 | LMS sync | After WP-ADM-10, WP-LD-09 |
| 41 | WP-PLT-06 | Accessibility pass and hardening | M6–M7 |

**Today (17 Oct 2026):** one account finishes WP-FIX-01 and brings EP-EMAIL to agreement (then WP-ADM-01); a second account can start **WP-LD-01** (agreed flow, no blocking dependency) or **WP-PLT-02**; flows for WP-ADM-02 / WP-ADM-03 are written for the PO in between.

---

## 6. Keeping this document current

- Claiming, branches, migrations and shared files: [`HOW-TO-START.md`](HOW-TO-START.md).
- When a WP merges: set its features' status in §3, the counts in §1 and the «Claimed by» cell to «merged #NN»; update `BACKLOG.md` and the «Current state by role» section of `STATUS.md`.
- New scope from the PO: BRD + feature list first (CLAUDE.md), then a row here.

---

## 7. Flags (not guessed — for the PO or the tech lead)

1. **IAM-08 release.** The feature list's release column says **R2**, but its R1 part was built (T-M2-41, T-M3-09) and the text defines an R1 part. Counted here as an extra row (108). The PO should confirm IAM-08 «R1 part» in the feature list (would make R1 = 108).
2. **BACKLOG was behind the code** — fixed in this reorganization (T-M2-36/38/43/44/45 now 🟢, T-M2-37 🔵 with what is left, T-M2-19 done through T-M3-02, T-M2-35/42 closed as superseded, `EP-M2-IAM` row). See BACKLOG «Archive».
3. **Production e-mail.** Per STATUS (16 Oct) there is no sender in production; not verifiable from the container. WP-ADM-01 restores it once EP-EMAIL is agreed.
4. **ADM-01 vs. the Kawadir way.** FR-ADM-01 (R1, M) wants self-service sign-up with a trial; the agreed EP-KAW-AUTH flow creates organizations from the Super Admin console. PO decision before WP-ADM-11.
5. **INT-01 (HR system CSV/SFTP sync).** `roles/organization-admin.md` #40 and T-M2-32 call it R1 (CSV/SFTP part); the feature list says R2 (security decision 7 open). Not counted.
6. **IAM-02 owner.** `roles/organization-admin.md` #20 lists these fields under the Org Admin; FR-IAM-02 restricts them to HR / Compliance. Placed under HR Manager, built in WP-ADM-04 together with the profile photo.
7. **NTF-02 split.** Look and texts belong to the L&D Manager (WP-LD-10); the R1 brand and sender parts depend on WP-ADM-01/02.
8. **L&D Manager vs. Training Coordinator.** Both hold «F» on sessions, logistics and attendance (Appendix B). Split used here: scheduling / enrollment set-up → L&D; logistics / attendance → Coordinator.
9. **WFL-01 R1 part** includes the training-request chain; EP-PLN covers only the plan chain. The request chain needs its own flow (WP-EMP-01).
10. **Judgement statuses.** STE-02 (Done, foundation), DEP-01 (Partly: legal not verifiable) and LRN-08 (Partly, ongoing gate).
11. **Migration ranges** are for collision-free parallel work only; on `main` timestamps must stay increasing (`docs/architecture/migration-conventions.md`) — a WP that merges after a WP with a later range renames its files before its PR (HOW-TO-START §4).
