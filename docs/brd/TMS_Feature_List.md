# Jadarat TMS — Full Feature List

**Date:** 6 Oct 2026 (v2.3) · **Status:** Decisions D1, D2, D6, D7 applied; IAM-16 added (PO, 5 Oct 2026); ADM-17 extended with platform settings (PO, 6 Oct 2026) · **BRD:** `docs/brd/Jadarat_TMS_BRD_v2.md` · **Basis:** Market research in `docs/research/TMS_Market_Comparison_vs_BRD.md` + Jadarat TMS BRD v1.0

**Legend**

- **Tier:** `Core` = table stakes (buyers expect it) · `Plus` = advanced / enterprise depth · `★` = MENA / ENTLAQA differentiator
- **Proposed release:** `R1` MVP (months 0–4) · `R2` Growth (5–8) · `R3` Enterprise & Sovereign (9–12) · `R4` Intelligence & Scale (13–18) · `Suite` = when the related Jadarat HR Suite module ships · `—` = removed from scope
- **In v1 BRD?** `✅` covered · `⚠️` partial · `❌` new (not in v1 BRD)

**Totals:** 29 modules · 290 features, of which 281 in scope and 9 removed by decision D1 (Commerce, public registration) · In scope: 107 new and 40 partial vs. v1 BRD · By release: R1 97 · R2 110 · R3 56 · R4 13 · Suite 5

---

## 1. Tenant Platform & Administration (ADM)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| ADM-01 | Self-service tenant sign-up, trial and onboarding wizard (org → branding → users → first course) | Core | R1 | ✅ |
| ADM-02 | Organization profile (AR/EN names, CR number, VAT number, country, currency, timezone) | Core | R1 | ✅ |
| ADM-03 | Legal entities (multiple companies under one tenant, own currency/VAT/branding) | Plus | R3 | ❌ |
| ADM-04 | Branches with hierarchy, GPS, working week and hours per branch | Core | R1 | ✅ |
| ADM-05 | Hierarchical departments, cost centers, department heads | Core | R1 | ✅ |
| ADM-06 | Interactive org chart with head-count and compliance overlay | Plus | R3 | ✅ |
| ADM-07 | Branding: logos, colors, fonts, WCAG contrast check | Core | R1 | ✅ |
| ADM-08 | Theme builder with live preview, presets, version history, dark mode | Plus | R2 | ✅ |
| ADM-09 | Custom login page (backgrounds, seasonal themes e.g. Ramadan/National Day) | Plus | R2 | ✅ |
| ADM-10 | Default subdomain + custom domains with DNS wizard and auto SSL | Plus | R2 | ✅ |
| ADM-11 | Custom fields builder for users, courses, sessions, enrollments, vendors | Core | R1 | ✅ |
| ADM-12 | Terminology overrides (e.g., "Course" → "Program") in AR/EN | Plus | R2 | ✅ |
| ADM-13 | Feature toggles per tenant, driven by edition | Core | R1 | ✅ |
| ADM-14 | Admin overview dashboard (usage vs. limits, integration health, AI spend, pending items) | Core | R1 | ✅ |
| ADM-15 | Sandbox / test tenant cloned from production configuration | Plus | R3 | ❌ |
| ADM-16 | Configuration export/import between tenants (templates, workflows, roles) | Plus | R3 | ❌ |
| ADM-17 | ENTLAQA platform super-admin console (tenants, plans, impersonation with audit, announcements, platform settings such as the e-mail provider key, sender and test message) | Core | R1 | ⚠️ |

## 2. Identity, Users & Access (IAM)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| IAM-01 | User directory with AR/EN names, 4-part Arabic name, employee ID, manager, nationality | Core | R1 | ✅ |
| IAM-02 | Add gender, date of birth, employment category, grade (for ESG & ministry reports) | Core | R1 | ❌ |
| IAM-03 | E-mail invitations: resend, revoke, bulk | Core | R1 | ✅ |
| IAM-04 | Bulk import wizard (CSV/XLSX, mapping, validation, dry run, upsert modes) | Core | R1 | ✅ |
| IAM-05 | User lifecycle: deactivate with reassignment, archive, reactivate | Core | R1 | ✅ |
| IAM-06 | Static and dynamic (rule-based) groups / audiences | Core | R2 | ✅ |
| IAM-07 | 15 default roles + custom role builder with permission matrix and risk flags | Core | R1/R2 | ✅ |
| IAM-08 | Data scoping of roles by branch / department / legal entity | Plus | R2 | ❌ |
| IAM-09 | Separation-of-duties rules (requester ≠ approver, creator ≠ approver) | Plus | R2 | ⚠️ |
| IAM-10 | SSO: SAML 2.0 / OIDC, multiple identity providers, just-in-time provisioning, force SSO | Plus | R2 | ✅ |
| IAM-11 | SCIM 2.0 provisioning (Entra ID, Okta, Google) | Plus | R3 | ❌ |
| IAM-12 | MFA (TOTP, e-mail, SMS) with per-role enforcement | Core | R1 | ✅ |
| IAM-13 | Password policy, lockout, session timeout, IP allow-list, access hours | Core | R1/R3 | ✅ |
| IAM-14 | Delegation (approver out-of-office delegate) | Plus | R2 | ❌ |
| IAM-15 | Non-employee users (provider staff, external instructors, contractor learners) | Plus | R2 | ❌ |
| IAM-16 | My profile (self-service): own names, mobile, language, photo and password; e-mail locked; job data read-only (PO, 5 Oct 2026) | Core | R1 | ❌ |

## 3. Training Needs Analysis & Planning (PLN) — new module

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| PLN-01 | Training request intake (employee/manager requests with justification and cost, including external courses) | Core | R1 | ❌ |
| PLN-02 | TNA campaigns (time-boxed, scoped by department, with a deadline and a budget envelope) | ★ | R2 | ❌ |
| PLN-03 | Pre-filled manager forms (team, mandatory items, expiring certifications, skills gaps) | ★ | R2 | ❌ |
| PLN-04 | Employee self-nomination into a campaign, with manager validation | Plus | R2 | ❌ |
| PLN-05 | Demand consolidation by course, branch and month | ★ | R2 | ❌ |
| PLN-06 | Demand → sessions conversion (head-count ÷ capacity) with auto cost estimate | ★ | R2 | ❌ |
| PLN-07 | Budget scenarios (compare, trim, defer) | Plus | R3 | ❌ |
| PLN-08 | Plan approval workflow (Department → Finance → HR/L&D) | Core | R2 | ❌ |
| PLN-09 | Plan → draft sessions in bulk; publish annual/quarterly training calendar | ★ | R2 | ❌ |
| PLN-10 | Plan vs. actual (sessions, hours, head-count, cost) with year-end forecast | ★ | R2 | ❌ |
| PLN-11 | Interest lists that trigger new sessions when a threshold is reached | Plus | R2 | ❌ |
| PLN-12 | Regulatory plan export (Qiwa: training plan + next-year committed budget) | ★ | R2 | ❌ |

## 4. Catalog, Courses & Programs (CAT)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| CAT-01 | Courses with bilingual fields, codes, categories, tags, delivery types (ILT, VILT, hybrid, OJT, conference, exam) | Core | R1 | ✅ |
| CAT-02 | Course templates (default duration, resources, tasks, materials, cost model, evaluation) | Core | R1 | ⚠️ |
| CAT-03 | Prerequisites (AND/OR), equivalencies, target audience | Core | R1 | ✅ |
| CAT-04 | Course versioning with history (for regulated audits) | Plus | R2 | ❌ |
| CAT-05 | Learning objectives and competency tagging | Core | R1 | ✅ |
| CAT-06 | Materials library (versioned files, trainer-only vs. learner materials) | Core | R1 | ⚠️ |
| CAT-07 | Programs / learning paths (sequence, mandatory vs. elective, deadlines) | Core | R2 | ✅ |
| CAT-08 | Blended programs combining ILT, VILT, LMS online modules and OJT | ★ | R2 | ✅ |
| CAT-09 | Auto-enrollment rules on hire, transfer or role change | Core | R2 | ✅ |
| CAT-10 | Searchable catalog, Arabic morphological search, filters, card/list views | Core | R1 | ✅ |
| CAT-11 | Public catalog page (per tenant, SEO-friendly) | Plus | R2 | ✅ |
| CAT-12 | Provider catalog import (courses offered by external providers) | Plus | R3 | ❌ |

## 5. Scheduling & Sessions (SCH)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| SCH-01 | Sessions: multi-day, per-day venue and time, recurrence | Core | R1 | ✅ |
| SCH-02 | Session lifecycle: draft → scheduled → confirmed → in progress → completed, plus cancel and postpone | Core | R1 | ✅ |
| SCH-03 | Calendar views (month/week/day) with drag-and-drop | Core | R1 | ✅ |
| SCH-04 | Resource timeline (Gantt) of trainers × rooms × equipment | Core | R2 | ❌ |
| SCH-05 | Conflict detection (instructor, room, learner, public holidays) | Core | R1 | ✅ |
| SCH-06 | Prayer-time, Jumu'ah and Ramadan-hours aware scheduling | ★ | R2 | ✅ |
| SCH-07 | Hijri/Gregorian dual calendar | ★ | R1 | ✅ |
| SCH-08 | Minimum-enrollment warnings and auto-confirm / auto-cancel rules | Core | R1 | ✅ |
| SCH-09 | Bulk session creation (from plan, from template, copy a term) | Core | R2 | ❌ |
| SCH-10 | VILT integration: auto-create Zoom / Teams / Webex meetings | Core | R2 | ❌ |
| SCH-11 | Hybrid sessions (in-room + remote participants) | Plus | R2 | ❌ |
| SCH-12 | AI schedule optimizer (instructors, rooms, cost, deadlines, prayer constraints) | ★ | R3 | ✅ |
| SCH-13 | Instructor "call for tender" (qualified trainers apply for open sessions) | Plus | R3 | ❌ |
| SCH-14 | Two-way calendar sync (Microsoft 365 / Google) and .ics invites that update on change | Core | R2 | ⚠️ |

## 6. Venues & Resources (RES)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| RES-01 | Internal and external venues with photos, map, contacts | Core | R1 | ✅ |
| RES-02 | Rooms with capacity by setup style (classroom, U-shape, theatre…) | Core | R1 | ✅ |
| RES-03 | Equipment inventory and booking (projectors, laptops, simulators) | Core | R1 | ✅ |
| RES-04 | Room/resource booking with owner approval | Plus | R2 | ❌ |
| RES-05 | Venue cost rates and external venue contracts | Core | R2 | ✅ |
| RES-06 | Utilization reports per venue, room and equipment | Core | R2 | ✅ |
| RES-07 | Accessibility attributes (wheelchair access, prayer room, women's facilities) | ★ | R1 | ⚠️ |

## 7. Instructor Management (INS)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| INS-01 | Internal and external instructor profiles (bilingual, specializations, languages/dialects) | Core | R1 | ✅ |
| INS-02 | Qualifications and trainer certifications with expiry alerts | Core | R1 | ✅ |
| INS-03 | Qualified-to-teach matrix (which trainer may deliver which course) | Core | R1 | ❌ |
| INS-04 | Availability patterns, blocked dates, weekly and monthly limits | Core | R1 | ✅ |
| INS-05 | Instructor portal: schedule, rosters, attendance, materials, grading, evaluations | Core | R1 | ✅ |
| INS-06 | Workload and utilization dashboard | Core | R2 | ✅ |
| INS-07 | Performance: ratings, pass rates, attendance rates, trends | Core | R2 | ✅ |
| INS-08 | Trainer contracts and rate cards (hourly, daily, per-participant), contracted vs. consumed days | Plus | R2 | ⚠️ |
| INS-09 | Trainer payment calculation (days × rate + expenses) → payable to ERP/payroll | Plus | R2 | ❌ |
| INS-10 | Trainer onboarding documents (CV, ID, bank details, NDA) | Plus | R2 | ❌ |
| INS-11 | AI instructor matching (topic, dialect, ratings, cost) | ★ | R4 | ✅ |

## 8. Training Providers & Vendors (VND) — new module

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| VND-01 | Provider registry (company, CR, VAT, accreditation e.g. TVTC, contacts, status) | Core | R2 | ❌ |
| VND-02 | Provider contracts, framework agreements, price lists, validity | Plus | R2 | ❌ |
| VND-03 | Provider catalog (courses offered, prices, languages) | Plus | R2 | ❌ |
| VND-04 | Provider portal: offerings, assigned sessions, rosters, attendance, invoices | Plus | R2 | ⚠️ |
| VND-05 | RFQ / quote requests to approved providers, with quote comparison | ★ | R3 | ❌ |
| VND-06 | Provider performance scorecard (ratings, pass rates, on-time, cost) | Plus | R3 | ❌ |
| VND-07 | Provider document compliance (licenses, insurance) with expiry | Plus | R3 | ❌ |

## 9. Enrollment, Registration & Approvals (ENR)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| ENR-01 | Self-enrollment with prerequisite and capacity checks, terms acceptance | Core | R1 | ✅ |
| ENR-02 | Manager enrollment / nomination of direct reports | Core | R1 | ✅ |
| ENR-03 | Admin bulk enrollment (by list, group or department) | Core | R1 | ✅ |
| ENR-04 | Rule-based auto-enrollment (mandatory, recertification, audiences) | Core | R2 | ✅ |
| ENR-05 | Configurable multi-step approvals: thresholds, parallel/sequential, escalation, auto-approve | Core | R2 | ✅ |
| ENR-06 | One-tap approvals on web, mobile, e-mail link and WhatsApp | ★ | R2 | ✅ |
| ENR-07 | Waitlist with auto-promotion and alternative-session suggestions | Core | R2 | ✅ |
| ENR-08 | Seat quotas per department or branch | Plus | R2 | ❌ |
| ENR-09 | Cancellation policy engine (cut-off windows, substitutions, transfers) | Plus | R2 | ❌ |
| ENR-10 | No-show and late-cancellation fees charged back to cost center | Plus | R3 | ❌ |
| ENR-11 | Registration forms with custom questions (dietary, accessibility, T-shirt size…) | Core | R2 | ❌ |
| ENR-12 | ~~External / public learner registration (B2C) and client-company registration (B2B)~~ — removed (D1) | — | — | ❌ |
| ENR-13 | Learner schedule-conflict detection | Core | R1 | ✅ |

## 10. Session Logistics & Operations (LOG) — new module

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| LOG-01 | Session task checklists from templates, with owners and due dates relative to the session date | Core | R1 | ❌ |
| LOG-02 | Joining instructions and pre-work (location, map, parking, dress code, prayer room) | Core | R1 | ⚠️ |
| LOG-03 | Materials and printing orders, with quantities driven by enrollment | Plus | R2 | ❌ |
| LOG-04 | Catering requests (per day, dietary counts) | Plus | R2 | ⚠️ |
| LOG-05 | Travel and accommodation (flights, hotels, per diems) for trainers and trainees | Plus | R3 | ❌ |
| LOG-06 | Room setup checklist (layout, AV, accessibility) | Plus | R2 | ❌ |
| LOG-07 | Session operations board (today's sessions, readiness status, issues) | Core | R2 | ❌ |
| LOG-08 | Shipment of materials / kits to branches | Plus | R3 | ❌ |

## 11. Attendance (ATT)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| ATT-01 | Manual roster (present, absent, late, excused, partial), bulk mark | Core | R1 | ✅ |
| ATT-02 | Rotating QR check-in (60 s refresh), no app required | ★ | R1 | ✅ |
| ATT-03 | Geo-fenced check-in (within X m of venue) and device fingerprint | ★ | R1 | ✅ |
| ATT-04 | Check-in and check-out per day, partial-attendance minutes | Core | R1 | ✅ |
| ATT-05 | E-signature attendance with IP, timestamp and hash (audit-grade) | Plus | R2 | ✅ (was Phase 3) |
| ATT-06 | Kiosk / tablet sign-in mode, NFC badge | Plus | R3 | ⚠️ |
| ATT-07 | VILT attendance import (Zoom / Teams participant reports, minutes attended) | Core | R2 | ❌ |
| ATT-08 | Offline attendance capture (PWA) with later sync | ★ | R2 | ✅ (was Phase 4) |
| ATT-09 | Attendance thresholds driving completion, certificate and subsidy eligibility | Core | R1 | ❌ |
| ATT-10 | Anomaly detection (shared devices, impossible locations) | ★ | R3 | ✅ |
| ATT-11 | Printable sign-in sheets (fallback) | Core | R1 | ❌ |

## 12. Assessment & Evaluation (ASM) — expanded

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| ASM-01 | Question bank (MCQ, true/false, matching, short answer, essay), AR/EN | Core | R1 | ❌ |
| ASM-02 | Pre/post tests with pass marks, attempts, time limits, randomization | Core | R1 | ❌ |
| ASM-03 | Learning-gain reports (Kirkpatrick Level 2) | Core | R2 | ⚠️ |
| ASM-04 | Instructor grading and practical assessment rubrics | Core | R1 | ⚠️ |
| ASM-05 | Level 1 reaction surveys, auto-sent, anonymous option, NPS | Core | R1 | ✅ |
| ASM-06 | Level 3 behaviour follow-up to learner and manager at 30/60/90 days | ★ | R2 | ⚠️ |
| ASM-07 | Level 4 business-impact linkage and Phillips ROI | Plus | R4 | ✅ |
| ASM-08 | Instructor, venue and provider evaluation forms | Core | R1 | ✅ |
| ASM-09 | AI analysis of free-text comments (Arabic sentiment and themes) | ★ | R3 | ❌ |
| ASM-10 | AI question generation from course objectives and materials | Plus | R3 | ⚠️ |
| ASM-11 | Third-party proctoring integration for high-stakes exams | Plus | R4 | ❌ |

## 13. Certification, Credentials & Compliance (CRT)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| CRT-01 | Visual certificate designer (bilingual, variables, Hijri date, QR) | Core | R1 | ✅ |
| CRT-02 | Signatories, stamps, numbering rules | Core | R1 | ✅ |
| CRT-03 | Automatic issuance on completion criteria | Core | R1 | ✅ |
| CRT-04 | Public verification page and verification API | Core | R1 | ✅ |
| CRT-05 | Expiry, renewal reminders (90/60/30/7 days), recertification auto-enrollment | Core | R1 | ✅ |
| CRT-06 | External certifications uploaded by employees (e.g., SAMA/FA exams, licenses), with approval | Core | R1 | ❌ |
| CRT-07 | Compliance rules engine (by role, department, site, regulation) | Core | R1 | ✅ |
| CRT-08 | Compliance matrix and dashboards, overdue alerts | Core | R1 | ✅ |
| CRT-09 | Coverage-target rules (e.g., "≥ 90% of remittance staff certified within 1 year") | ★ | R2 | ❌ |
| CRT-10 | Open Badges 3.0 / W3C Verifiable Credentials issuance | Plus | R3 | ❌ |
| CRT-11 | Share to LinkedIn / credential wallets | Plus | R3 | ❌ |
| CRT-12 | PKI digital signing of certificates | Plus | R3 | ⚠️ |

## 14. OJT & Skills Sign-off (OJT)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| OJT-01 | OJT plans with sequential tasks linked to competencies | Core | R2 | ✅ |
| OJT-02 | Assignment to trainee with mentor and supervisor | Core | R2 | ✅ |
| OJT-03 | Task progress with evidence (photo, video, document) | Core | R2 | ✅ |
| OJT-04 | Reusable observation checklists usable in any course or session | Core | R2 | ❌ |
| OJT-05 | Offline mobile sign-off by assessor with e-signature | ★ | R2 | ⚠️ |
| OJT-06 | Final evaluation, extension or re-assignment workflow | Core | R2 | ✅ |
| OJT-07 | Logbook for hours and practical activities | Plus | R3 | ❌ |
| OJT-08 | Saudi OJT mandate: 2% workforce quota tracking + Qiwa contract reference | ★ | R2 | ❌ |
| OJT-09 | Graduate / apprenticeship programs (e.g., Tamheer) with stipend-eligibility attendance rules | ★ | R3 | ❌ |

## 15. Competencies & Development (SKL)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| SKL-01 | Competency frameworks, proficiency levels, role profiles | Core | R2 | ✅ |
| SKL-02 | Self and manager assessment of competencies | Core | R2 | ⚠️ |
| SKL-03 | Gap analysis per person, team and role | Core | R2 | ✅ |
| SKL-04 | Individual development plans (IDPs) linked to catalog | Plus | R3 | ❌ |
| SKL-05 | Skills import from HRIS/LMS; skills taxonomy import (e.g., ESCO/O*NET) | Plus | R3 | ❌ |
| SKL-06 | AI skills inference from completions and assessments | ★ | R4 | ⚠️ |
| SKL-07 | Competency heat-map and knowledge graph | Plus | R4 | ✅ |

## 16. Budget & Finance (FIN)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| FIN-01 | Annual budgets by department, branch, category and cost center | Core | R2 | ✅ |
| FIN-02 | Commitments (approved but not spent) vs. actuals vs. budget | Core | R2 | ⚠️ |
| FIN-03 | Session cost model (trainer, venue, materials, catering, travel) with estimate → actual | Core | R1 | ✅ |
| FIN-04 | Expense capture with receipts and approval | Core | R2 | ✅ |
| FIN-05 | Purchase orders for vendors / trainers | Plus | R3 | ❌ |
| FIN-06 | Vendor invoice capture and 3-way match (PO ↔ session ↔ invoice) | Plus | R3 | ❌ |
| FIN-07 | Internal chargebacks / cross-charging to cost centers | Plus | R3 | ❌ |
| FIN-08 | Cost per learner, per hour, per course, per department | Core | R2 | ✅ |
| FIN-09 | Budget alerts, burn rate, year-end forecast | Core | R2 | ✅ |
| FIN-10 | Subsidy / levy claim evidence packs (HRDF; Egypt training-fund exemption) | ★ | R3 | ❌ |
| FIN-11 | ERP export / integration (SAP, Oracle, Microsoft Dynamics, Odoo) | Plus | R3 | ❌ |
| FIN-12 | Multi-currency with exchange rates; VAT handling | Core | R2 | ✅ |

## 17. Commerce for Training Providers (COM) — removed from scope (decision D1)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| COM-01 | ~~Price lists (public, corporate, member, early-bird)~~ | — | — | ❌ |
| COM-02 | ~~Public checkout (cards, Mada, Apple Pay; STC Pay, Fawry)~~ | — | — | ❌ |
| COM-03 | ~~Corporate client accounts, group bookings, purchase-order payment~~ | — | — | ❌ |
| COM-04 | ~~Vouchers, discounts, promo codes, training credits~~ | — | — | ❌ |
| COM-05 | ~~Quotes → orders → invoices; refunds and credit notes~~ | — | — | ❌ |
| COM-06 | ~~E-invoicing compliance: ZATCA (KSA), ETA (Egypt)~~ | — | — | ❌ |
| COM-07 | ~~Revenue and profitability per course and session~~ | — | — | ❌ |
| COM-08 | ~~Client-company portal (their learners, bookings, invoices, certificates)~~ | — | — | ❌ |

## 18. Learner Experience (LRN)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| LRN-01 | My learning: upcoming sessions, enrollments, requests, history, certificates | Core | R1 | ✅ |
| LRN-02 | Unified transcript (TMS + LMS records) with source badges | ★ | R2 | ✅ |
| LRN-03 | Personal calendar and .ics / calendar sync | Core | R1 | ✅ |
| LRN-04 | Installable PWA: mobile check-in, materials, surveys, certificates | Core | R1 | ✅ |
| LRN-05 | Offline mode (materials, OJT evidence, attendance) | ★ | R2 | ⚠️ |
| LRN-06 | Recommendations ("for you", "required", "popular in your team") | Plus | R2 | ✅ |
| LRN-07 | Notification preferences (channel, language) | Core | R1 | ✅ |
| LRN-08 | Accessibility (WCAG 2.2 AA, screen readers in Arabic and English) | Core | R1 | ⚠️ |

## 19. Manager Hub (MGR) — new module

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| MGR-01 | Team dashboard: compliance gaps, expiring certificates, upcoming sessions | Core | R1 | ⚠️ |
| MGR-02 | Pending approvals inbox with bulk approve | Core | R1 | ⚠️ |
| MGR-03 | Team training calendar | Core | R1 | ❌ |
| MGR-04 | One-click nominate / assign with deadline | Core | R1 | ✅ |
| MGR-05 | TNA campaign form for the team | ★ | R2 | ❌ |
| MGR-06 | Level 3 follow-up tasks (confirm skill application) | ★ | R2 | ❌ |
| MGR-07 | Team skills and gap view | Plus | R2 | ❌ |

## 20. Communications & Notifications (NTF)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| NTF-01 | In-app notification center (real-time) | Core | R1 | ✅ |
| NTF-02 | E-mail with branded bilingual templates and variables | Core | R1 | ✅ |
| NTF-03 | WhatsApp Business (templates, reminders, approvals, check-in links) | ★ | R2 | ✅ |
| NTF-04 | SMS (MENA gateways, e.g. Unifonic or Twilio) | Core | R2 | ✅ |
| NTF-05 | Web push notifications | Core | R2 | ✅ |
| NTF-06 | Microsoft Teams / Slack notifications and approvals | Plus | R3 | ⚠️ |
| NTF-07 | Event catalog with per-event, per-role, per-channel rules and quiet hours | Core | R1 | ✅ |
| NTF-08 | Scheduled reminders (7 days / 3 days / 1 day / 1 hour) and digests | Core | R1 | ✅ |
| NTF-09 | Broadcast messages to audiences / session participants | Core | R2 | ❌ |

## 21. Reporting & Analytics (RPT)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| RPT-01 | Executive dashboard (KPIs, trends, heat maps) | Core | R1 | ✅ |
| RPT-02 | Operational reports (fill rate, no-shows, utilization, cost) | Core | R1 | ✅ |
| RPT-03 | Training effectiveness (Kirkpatrick L1–L4, NPS) | Core | R2 | ✅ |
| RPT-04 | Plan vs. actual and budget vs. actual | ★ | R2 | ⚠️ |
| RPT-05 | Report builder, saved reports, scheduled e-mail delivery, Excel/PDF/CSV export | Core | R2 | ✅ |
| RPT-06 | BI connector / data export (Power BI, Tableau, data warehouse) | Plus | R3 | ⚠️ |
| RPT-07 | ESG human-capital reports (GRI 404-1, ESRS S1-13: hours per employee by gender and category) | ★ | R3 | ❌ |
| RPT-08 | Predictive insights (no-show risk, demand forecast, budget burn) | ★ | R4 | ❌ |
| RPT-09 | AI narrative summaries (Arabic/English) and anomaly alerts | ★ | R3 | ✅ |
| RPT-10 | Conversational analytics ("ask your data") | ★ | R4 | ❌ |

## 22. Regulatory Packs (REG)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| REG-01 | Configurable compliance-framework engine (any regulator, rules, evidence) | Core | R1 | ⚠️ |
| REG-02 | KSA — Qiwa annual training-data disclosure (hours, trainees, plan, next-year budget; due 31 Jan) | ★ | R2 | ❌ |
| REG-03 | KSA — OJT 2% mandate tracking | ★ | R2 | ❌ |
| REG-04 | KSA — HRDF (Hadaf) program evidence: Tamheer attendance, certificate support | ★ | R3 | ❌ |
| REG-05 | KSA — SAMA / Financial Academy certification coverage (correct certificate names, rollout %) | ★ | R2 | ⚠️ |
| REG-06 | KSA — CMA certifications (capital-market firms) | ★ | R3 | ❌ |
| REG-07 | KSA — Saudization training contribution (hours per Saudi employee; Nitaqat band as input, 5 bands) | ★ | R2 | ⚠️ |
| REG-08 | UAE — Emiratisation tracking (2%/yr, 20–49-employee rule), Nafis trainee records | ★ | R3 | ⚠️ |
| REG-09 | Egypt — Labour Law 14/2025 training-fund exemption evidence; Ministry of Labour reports | ★ | R3 | ⚠️ |
| REG-10 | Health sector — CPD/CME hours (e.g., SCFHS, DHA) | Plus | R4 | ❌ |

## 23. AI Capabilities (AI)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| AI-01 | Arabic Ops Agent: admin copilot that executes tasks (schedule, enroll, report) with confirmation, audit and undo | ★ | R3 | ❌ |
| AI-02 | Learner assistant (web + WhatsApp): catalog Q&A, my schedule, enroll, policies (RAG) | ★ | R2 | ✅ |
| AI-03 | AI schedule optimizer | ★ | R3 | ✅ |
| AI-04 | Recommendations (role, gaps, peers, trends) | Plus | R2 | ✅ |
| AI-05 | Content generation (session plans, facilitator guides, assessments, surveys) with review gate | Plus | R2 | ✅ |
| AI-06 | TNA assistant (proposes team needs from gaps, expiries and roles) | ★ | R3 | ⚠️ |
| AI-07 | Evaluation comment analysis (Arabic sentiment / themes) | ★ | R3 | ❌ |
| AI-08 | Auto-drafted regulatory reports and subsidy claims | ★ | R4 | ❌ |
| AI-09 | Session transcription (Arabic speech-to-text) → notes and FAQ | Plus | R4 | ✅ |
| AI-10 | AI governance: toggles, model choice (incl. sovereign Jais), BYOK, cost caps, usage logs | ★ | R2 | ✅ |
| AI-11 | MCP server exposing TMS actions to customers' own AI agents | Plus | R3 | ❌ |

## 24. Workflow & Automation (WFL)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| WFL-01 | Visual approval-workflow builder (enrollment, plan, budget, expense, session, certificate, OJT) | Core | R2 | ✅ |
| WFL-02 | Conditions, thresholds, parallel/sequential steps, escalation, delegation | Core | R2 | ✅ |
| WFL-03 | Automation rules ("when X then Y", e.g., when fill rate < 50% at T-7, alert and suggest merge) | Plus | R3 | ❌ |
| WFL-04 | SLA timers and overdue dashboards | Plus | R3 | ❌ |

## 25. Audit, Data & Privacy (AUD)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| AUD-01 | Immutable audit log with before/after diff, IP, device | Core | R1 | ✅ |
| AUD-02 | Data export (full / filtered; XLSX, CSV, JSON; attachments ZIP) | Core | R2 | ✅ |
| AUD-03 | Retention policies per data type, legal hold | Plus | R3 | ✅ |
| AUD-04 | Data subject requests (access, erasure) under Saudi / Egypt / UAE data-protection laws | Core | R2 | ⚠️ |
| AUD-05 | Consent management (e.g., WhatsApp opt-in, geo-location, AI processing) | Core | R1 | ❌ |
| AUD-06 | Data cleanup: duplicate merge, archive, orphan files | Plus | R3 | ✅ |

## 26. SaaS Subscription & Billing (SUB)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| SUB-01 | Editions and feature gating (Starter, Professional, Enterprise, Government) | Core | R1 | ✅ |
| SUB-02 | Usage metering (active users, sessions, storage, AI, WhatsApp) and alerts | Core | R2 | ✅ |
| SUB-03 | Online subscription payments, invoices, upgrade/downgrade, proration | Core | R2 | ✅ |
| SUB-04 | Local payment methods and bank transfer; ZATCA-compliant invoices for KSA customers | ★ | R2 | ❌ |
| SUB-05 | Add-on marketplace (AI pack, WhatsApp bundle, connectors, commerce) | Plus | R3 | ❌ |

## 27. Integration & LMS Interoperability (INT / LMS)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| LMS-01 | **Generic LMS connector framework** (pluggable connectors, capability levels, mapping, sync engine) | ★ | R1 | ❌ (v1 was Jadarat-only) |
| LMS-02 | Jadarat LMS certified connector (SSO, users, catalog, enrollments, completions, certificates) | ★ | R1 | ✅ |
| LMS-03 | SSO between TMS and LMS (OIDC / SAML), deep links | Core | R1 | ✅ |
| LMS-04 | User provisioning to LMS (SCIM 2.0 or connector API) | Core | R2 | ✅ |
| LMS-05 | Catalog sync (LMS online courses visible in TMS programs) | Core | R1 | ✅ |
| LMS-06 | Enrollment push (TMS → LMS) for blended programs | Core | R1 | ✅ |
| LMS-07 | Completion/progress/score pull (webhook + scheduled reconciliation) | Core | R1 | ✅ |
| LMS-08 | xAPI statements to any LRS (attendance, assessments, OJT) | Plus | R2 | ✅ |
| LMS-09 | LTI 1.3 / cmi5 launch of LMS content from TMS | Plus | R3 | ❌ |
| LMS-10 | Field mapping UI, conflict rules, sync schedules, retry, health monitoring | Core | R1 | ✅ |
| LMS-11 | Additional connectors: Moodle, Docebo, SAP SuccessFactors, Cornerstone, Canvas, TalentLMS | Plus | R3 | ⚠️ |
| LMS-12 | Connector SDK + certification program for partners | Plus | R4 | ❌ |
| INT-01 | HRIS connectors (SAP, Oracle, Workday, Jisr, ZenHR, Menaitech, BambooHR) + CSV/SFTP | Core | R2 | ⚠️ |
| INT-02 | Public REST API (OpenAPI 3.1, OAuth 2.0, rate limits, versioning) | Core | R2 | ✅ |
| INT-03 | Outgoing webhooks (signed, retries, delivery log, replay) | Core | R2 | ✅ |
| INT-04 | Government platforms: Qiwa / HRDF / MoHRE report formats and exports | ★ | R2 | ⚠️ |
| INT-05 | E-signature providers (e.g., DocuSign, Adobe Sign) for contracts | Plus | R3 | ❌ |
| INT-06 | Storage (SharePoint, Google Drive) for materials | Plus | R3 | ✅ |
| INT-07 | Zapier / Make / Power Automate connector | Plus | R4 | ❌ |

## 28. Deployment & Sovereignty (DEP) — decision-critical

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| DEP-01 | Regional multi-tenant cloud (EU region near MENA, with Saudi SCCs + transfer risk assessment) | Core | R1 | ✅ |
| DEP-02 | Dedicated single-tenant deployment | Plus | R3 | ⚠️ |
| DEP-03 | In-country deployment KSA / UAE (for government, critical infrastructure, banks) | ★ | R3 | ❌ (v1: docs only, Phase 4) |
| DEP-04 | Customer-hosted / on-premise package | Plus | R4 | ⚠️ |
| DEP-05 | Arabic-only operating mode (government) | ★ | R1 | ⚠️ |

## 29. HR Suite Integration & Platform (STE) — new (v2.1)

| ID | Feature | Tier | Release | In v1? |
|---|---|---|---|---|
| STE-01 | Suite mode and standalone mode per tenant, one codebase | ★ | R1 | ❌ |
| STE-02 | Shared people & organization directory (single person record across suite modules) | Core | R1 | ❌ |
| STE-03 | Consume Core HR lifecycle events (hire, transfer, promotion, termination) | Core | Suite | ❌ |
| STE-04 | Publish training days and absences to Payroll & Time | Plus | Suite | ❌ |
| STE-05 | Send payroll items (instructor allowances, stipends, training deductions) | Plus | Suite | ❌ |
| STE-06 | Training agreements / training bonds with pro-rata recovery on exit | ★ | R3 | ❌ |
| STE-07 | Exchange with Performance & Skills (training history ↔ appraisals and IDPs) | Plus | Suite | ❌ |
| STE-08 | Suite shell: one navigation, notification inbox, approvals inbox, search, mobile app | ★ | R1 | ❌ |
| STE-09 | Onboarding journeys trigger TMS programs | Plus | Suite | ❌ |

---

## Decisions Needed

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Include training providers / institutes (Commerce module, public registration, e-invoicing)? | Yes in R3 · Later · No | **Decided: No** (30 Sep 2026) |
| D2 | Is the Government segment a Year-1 target? | Yes → in-country hosting in R3 · No → R4 | **Decided: Yes** (30 Sep 2026) |
| D3 | Pull the planning cycle (PLN) into R1? | R1 · R2 | **Decided: R2** (30 Sep 2026), with only PLN-01 (requests) in R1 |
| D4 | First LMS connectors after Jadarat | Moodle · Docebo · SAP SF · Cornerstone | **Moodle** (MENA gov/edu footprint), then SAP SF |
| D5 | Messaging vendor for SMS / WhatsApp | Unifonic (MENA) · Twilio · Meta Cloud API direct | Unifonic for SMS + Meta Cloud API for WhatsApp |
| D6 | Keep the Next.js / Supabase / Vercel stack for in-country deployments? | Keep + self-host variant · Change | **Decided: Next.js + Supabase, self-hostable**, for the whole HR Suite (30 Sep 2026) |
| D7 | Product name | ENTLAQA TMS · Jadarat TMS · new | **Decided: Jadarat TMS** (30 Sep 2026) |

## Suggested R1 (MVP) Cut — 97 features

ADM-01, 02, 04, 05, 07, 11, 13, 14, 17 · IAM-01…05, 07, 12, 13, 16 · PLN-01 · CAT-01…03, 05, 06, 10 · SCH-01…03, 05, 07, 08 · RES-01…03, 07 · INS-01…05 · ENR-01…03, 13 · LOG-01, 02 · ATT-01…04, 09, 11 · ASM-01, 02, 04, 05, 08 · CRT-01…08 · LRN-01, 03, 04, 07, 08 · MGR-01…04 · FIN-03 · NTF-01, 02, 07, 08 · RPT-01, 02 · REG-01 · AUD-01, 05 · SUB-01 · LMS-01…03, 05…07, 10 · DEP-01, 05 · STE-01, 02, 08
