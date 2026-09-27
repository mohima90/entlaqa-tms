# Best-in-Class TMS Features vs. Jadarat TMS BRD (v1.0, 15 Mar 2026)

**Prepared:** 27 Sep 2026 · **Scope:** Market scan of leading Training Management Systems (TMS) and enterprise LMS platforms with ILT modules, MENA competitors, analyst buyer guides, and a regulatory fact-check — compared against `BRD_Jadarat_TMS_v2.md`.

**Method note:** Research used vendor help centers, release notes, press releases, analyst summaries and review sites. Several vendor/government sites were blocked by the research proxy, so some findings come from search-indexed excerpts of those pages; items that could not be confirmed are marked *unverified*. Legal/regulatory figures should be re-checked against official gazettes before being cited to customers.

---

## 1. Executive Summary

**Verdict:** The BRD is unusually complete on *tenant administration* (branding, domains, RBAC, integration hub, AI governance, audit) and on *MENA localization* (RTL, Hijri, prayer times, Arabic naming). Those are genuine strengths. However:

1. **The competitor matrix (§18) is materially inaccurate.** QR attendance, e-signature attendance, OJT/observation checklists and mobile apps all exist in major competitors (SAP SuccessFactors, Docebo, Cornerstone, 360Learning, Arlo, accessplanit). Using this matrix in sales material is a credibility risk. See §3.
2. **The BRD is missing the "planning" half of a TMS.** Best-in-class systems (Training Orchestra, Cornerstone, SAP) run an annual cycle: Training Needs Analysis (TNA) campaign → demand consolidation → budget scenarios → training plan → published calendar → plan-vs-actual. The BRD starts at "create a course/session". This is the single biggest functional gap.
3. **Operational logistics & finance depth is thin** vs. Training Orchestra/Administrate: no vendor/provider entity (despite a `vendor` role), no trainer contracts/payments, no session task checklists, no materials/printing/travel logistics, no no-show/cancellation charging, no chargebacks, no POs.
4. **Assessment is under-specified:** evaluation forms exist, but there is no exam/test engine, no Kirkpatrick Level 3 manager follow-up automation, and no Open Badges 3.0 / verifiable credentials.
5. **Several regulatory facts are wrong or outdated** (Nitaqat bands, UAE penalty, SAMA certificate names, "CSF Level 3" as a certificate), and **two high-value Saudi obligations are missing entirely**: the Qiwa annual training-data disclosure (due 31 Jan) and the 2026 OJT quota (2% of workforce). See §6.
6. **Hosting in Frankfurt blocks the Government segment.** Saudi NCA CCC and UAE Cloud-First policy require in-country hosting for government/CNI data; the BRD's "Government: Dedicated" tier has no in-country deployment design. See §6.5.
7. **Defensible differentiators remain real** once reframed: Arabic-first UX, Hijri/prayer/Ramadan scheduling, WhatsApp-native workflows, Qiwa/HRDF/Emiratization/Egypt-law reporting, AI scheduling for ILT (only Administrate ships this), and SME-friendly pricing (competitors start at ~$25K–$65K/yr).

---

## 2. Platforms Benchmarked

| Platform | Category | Target | Arabic / RTL | MENA hosting | Notable 2025–26 AI | Price signal |
|---|---|---|---|---|---|---|
| **Training Orchestra** | Dedicated TMS | Enterprise L&D + training providers | Not found (16 UI languages) | Not found | None shipped (commentary only) | Quote; 3rd-party "from ~$560/mo" |
| **Administrate** | Dedicated TMS | Large enterprise ILT/VILT | Not found | Not found | **AI Scheduler**, **AI Assistant** (agentic, reversible actions), Insights, AI Automator | ~$65K/yr → mid-six figures |
| **Arlo** | Dedicated TMS | Commercial training providers | **No** ("localisation not supported") | Not found | AI eLearning authoring (May 2025) | Per-admin + per-registration fee (~$89–$249/admin/mo) |
| **accessplanit** | Dedicated TMS | UK providers + internal | Not found | Not found | accessplanit AI, "Juno" advisor, NL filters/automation | From ~$296/mo + $7–9K setup |
| **SAP SuccessFactors Learning** | Suite LMS w/ strong ILT | Large enterprise, regulated | Yes (RTL) | **Yes – Riyadh & Dubai DCs** | Joule agents, Learning Compliance Agent (1H 2026), AI skills inference | Quote (PEPM) |
| **Cornerstone (Galaxy)** | Suite LMS w/ ILT | Enterprise | Claimed | Unverified | Galaxy AI agents, AgentReady, **Workforce AI** (May 2026) | Quote |
| **Docebo** | LMS/LXP | Enterprise | Yes (RTL flag) | **No Gulf region** | Harmony, AI Creator, **AgentHub** (Apr 2026), MCP server | ~$25K–$60K+/yr |
| **Workday Learning** | Suite LMS | Workday HCM customers | Yes (bi-di) | No KSA/UAE region found | Illuminate agents, **Sana** acquisition (Nov 2025) | Suite |
| **Absorb** | LMS | Mid-market/enterprise | **Arabic yes, RTL not supported** | No ME region | **Absorb Aura** (May 2026) | Quote |
| **360Learning** | Collaborative LMS | Mid-market/enterprise | Unverified | Unverified | AI Companion, NL bulk edit | Quote |
| **Totara / Moodle Workplace** | Open-source LMS | Enterprise / gov | Full RTL (Moodle core) | **Self-host anywhere (on-prem / in-country)** | Totara 19.1 AI assistants; Moodle AI subsystem | Partner-priced |
| **Jisr + Lumofy** (KSA) | HR suite + LXP | Saudi SMEs/mid | Yes | KSA | Lumofy skills AI | Bundled |
| **Tqdm (tqdm.net)** | Arabic TMS | MENA corporates | Yes | Unverified | Unverified | Unverified |
| **EDAA Portal** (KSA) | Arabic LMS | KSA | Yes | Unverified | — | — |
| **Menaitech (MenaLMS)** | HRMS module | GCC/Jordan | Yes | Regional | — | Bundled |
| **Classera** | Learning platform | Education + gov + corp | Yes | Regional | AI content | Quote |

> **Closest MENA threats:** Tqdm (Arabic TMS with approvals/attendance/certs) and Jisr+Lumofy (claims "Qiwa-ready training compliance tracking" bundled into the dominant Saudi HR suite). Neither showed ILT scheduling depth, budgets, WhatsApp or Hijri scheduling.

---

## 3. BRD Competitor Matrix (§18) — Corrected

Legend: ✅ has it · ⚠️ partial/via partner · ❌ not found · ❓ unverified

| Feature | BRD claim for competitors | Evidence-based correction |
|---|---|---|
| **QR Attendance** | ❌ for all | **SAP SF ✅** (standard, QR in email/app, instructor scans) · **Docebo ✅** (per-event QR self check-in via Go.Learn) · **Cornerstone ✅** (per-session-part QR in Galaxy app) · Training Orchestra ⚠️ (via Edusign partner: QR/NFC/email) · Administrate ❌ · Arlo ❌ (but has native mobile attendance app) |
| **Digital Signatures** | ❌ for all | **SAP SF ✅** (21 CFR Part 11 e-signatures) · **360Learning ✅** (audit-proof e-signed attendance: login, IP, timestamp) · **accessplanit ✅** (signatures in trainer portal) · Docebo ⚠️ (QR-signed attendance sheet) · Training Orchestra ⚠️ (Edusign) |
| **OJT Tracking** | ❌ for all | **Cornerstone ✅** (dedicated OJT object + observation checklists) · **SAP SF ✅** (Task Checklists + Observer, mobile e-sign) · **Docebo ✅** (observation checklists) · **Absorb ✅** · **Workday ✅** (2025R2/2026R1) |
| **Mobile** | ❌ for TO/Administrate/Arlo | **Arlo ✅** native iOS/Android presenter app · Administrate ⚠️ responsive portals · SAP/Docebo/Cornerstone ✅ incl. **offline** mode |
| **LMS Integration** | "generic" for TO/Administrate, ❌ Arlo | TO: **named 2-way connectors** (Docebo, Workday, 360Learning, D2L, Cornerstone) · Administrate: native Docebo, Workday, Salesforce, GraphQL API · **Arlo ✅** Moodle plugin + built-in eLearning |
| **AI Scheduling** | ✅ only Administrate | Correct. Also note Administrate's **AI Assistant** (agentic) — understated in BRD |
| **Budget Mgmt** | ❌ Docebo; "Basic" SAP; ✅ Arlo | Docebo ❌ (uses TO) — correct · SAP: cost/chargebacks/allocation codes → **more than basic** · **Cornerstone ✅** training-plan budgets · Arlo: revenue/profitability, **not** corporate budgeting |
| **Arabic-First UI** | Partial/limited | SAP, Docebo, Workday **support RTL**; none is *Arabic-first*. Absorb: no RTL; Arlo: no localization |
| **On-Premise** | ✅ SAP SF | SuccessFactors is SaaS-only (on-prem is legacy SAP HCM T&E) — *verify*. Totara/Moodle Workplace are the real on-prem options |
| **MENA Data Residency** | Limited for SAP | **SAP ✅ Riyadh + Dubai** · Docebo/Absorb/Workday ❌ no Gulf region |
| **Arabic AI Chatbot / WhatsApp / Hijri / Prayer / Nitaqat / Emiratization** | ❌ for all | Consistent with evidence — **these remain genuine differentiators** (none found in any competitor) |
| **Mobile PWA / Digital Signatures / On-prem for Jadarat** | ✅ | BRD itself schedules these for **Phase 3–4** — the matrix should say "Roadmap" |

**Recommendation:** Replace the matrix with a "depth" framing. Claiming *absence* of QR/OJT/e-signature is refutable in a demo; claiming *Arabic-first, offline-capable, WhatsApp-native, MENA-regulator-ready* versions of them is defensible.

---

## 4. Feature-by-Feature: BRD Coverage vs. Best-in-Class

Legend: ✅ BRD covers well · ⚠️ partial · ❌ missing · **TS** = table stakes · **DIFF** = differentiator · Priority P0 (must add before GA) / P1 (next phase) / P2 (later)

### 4.1 Planning & Needs Analysis
| Best-in-class capability | Tier | Who does it | BRD | Priority |
|---|---|---|---|---|
| Training request intake (ad-hoc requests with justification) | TS | Cognota, Cornerstone | ⚠️ enrollment requests only; no request for *new/external* training | **P0** |
| TNA campaign: time-boxed manager survey pre-filled with team, mandatory & expiring items, skills gaps | DIFF | Training Orchestra, Cornerstone | ❌ (AI-007 TNA is AI-driven, no manager campaign workflow) | **P0** |
| Demand consolidation → sessions needed (headcount ÷ capacity) | DIFF | Cornerstone Demand Forecasting / Interest Tracking | ❌ | **P0** |
| Budget scenario simulation for the plan | DIFF | Training Orchestra | ❌ | P1 |
| Annual training plan approval → auto-draft sessions → publish calendar | DIFF | TO, SAP | ❌ | **P0** |
| Plan-vs-actual (sessions, hours, headcount, cost) with year-end forecast | DIFF | TO | ⚠️ budget-vs-actual only | P1 |
| Interest lists that trigger new sessions | DIFF | Cornerstone | ❌ | P1 |

> **Why P0:** Saudi Qiwa requires establishments (50+ staff) to disclose the *training plan* and *next year's committed budget* by 31 Jan (§6.1). The plan entity is a compliance artifact, not just a nice-to-have.

### 4.2 Catalog & Course Design
| Capability | Tier | BRD | Priority |
|---|---|---|---|
| Course → session → multi-day structure, bilingual | TS | ✅ FR-CM-001, FR-SS-001 | — |
| Programs / blended paths (ILT + e-learning + OJT) | TS | ✅ FR-CM-003, INT-003 | — |
| Course templates carrying default resources, materials, tasks, cost | TS | ⚠️ costs yes; tasks/materials/resource templates no | P1 |
| Course versioning / history & equivalencies | TS (regulated) | ❌ | P1 |
| Skills/competency tagging | DIFF→TS | ✅ competencies table, prerequisite_competencies | — |
| AI course/outline generation | DIFF | ✅ AI-004 | — |
| Public catalog | TS | ✅ `(public)/catalog` | — |

### 4.3 Scheduling & Resource Optimisation
| Capability | Tier | BRD | Priority |
|---|---|---|---|
| Calendar (month/week/day), drag-drop | TS | ✅ FR-SS-002 | — |
| **Resource Gantt / timeline view** (trainers × rooms × equipment) | TS | ❌ calendar only | P1 |
| Conflict detection (trainer, room, learner, holidays) | TS | ✅ FR-SS-004 (+ prayer times — DIFF) | — |
| Trainer matching by qualification/language/availability | TS | ✅ FR-IM-001/002 | — |
| AI/auto-scheduling | DIFF | ✅ AI-006 (Phase 2 in §9, Phase 3 in §17 — inconsistent) | — |
| **VILT integration** (auto-create Zoom/Teams links, import attendance) | TS | ⚠️ `virtual_meeting_url` field only; no integration or attendance import | **P0** |
| Multi-timezone/multi-site | TS | ✅ | — |
| Trainer "call for tender" (trainers apply for open sessions) | DIFF | ❌ (Training Orchestra has it) | P2 |

### 4.4 Instructor & Vendor Management
| Capability | Tier | BRD | Priority |
|---|---|---|---|
| Profiles, qualifications w/ expiry, workload | TS | ✅ FR-IM-001/003 | — |
| External trainer portal | TS | ✅ FR-IM-004 | — |
| **Training provider / vendor entity** (company, contracts, catalogue, rates, accreditation e.g. TVTC) | DIFF | ❌ `vendor` role exists but no `vendors` table; FR-BC-002 mentions "vendor management" without spec | **P0** |
| Trainer contracts: rate cards, contracted vs consumed days | DIFF | ⚠️ hourly/daily rate fields only | P1 |
| **Trainer payment calculation** (days × rate + expenses → payable) | DIFF | ❌ | P1 |
| Vendor RFQ / quote comparison | DIFF (rare) | ❌ | P2 |
| AI instructor matching | DIFF | ✅ AI-010 (dialect-aware — unique) | — |

### 4.5 Enrollment, Registration & Approvals
| Capability | Tier | BRD | Priority |
|---|---|---|---|
| Self / manager / admin / rule-based enrollment | TS | ✅ FR-EM-001/002, dynamic groups FR-ORG-035 | — |
| Multi-step configurable approvals, escalation | TS | ✅ FR-EM-003, FR-ORG-080 | — |
| Waitlist with auto-promotion | TS | ✅ FR-EM-004 | — |
| **Seat quotas per department / nominations** | DIFF | ❌ | P1 |
| **Cancellation policy & no-show charging** (fee windows, chargeback to cost center) | DIFF | ❌ (no-show *analysis* only) | P1 |
| External / public learners (B2B/B2C, extended enterprise) | DIFF (TS for providers) | ❌ all users are tenant employees | P2 |
| E-commerce (payments, invoices, promo codes, group bookings) | TS for providers | ❌ (Stripe only for SaaS billing) | P2 |

> Decide explicitly: is Jadarat TMS **corporate-L&D-only**, or will it also serve **training providers/institutes** (a large MENA segment — TVTC-accredited centres, HRDF strategic partners)? If the latter, e-commerce, public registration and provider invoicing become P0.

### 4.6 Attendance
| Capability | Tier | BRD | Priority |
|---|---|---|---|
| Manual roster, partial / per-day | TS | ✅ FR-AT-002 | — |
| QR with rotating code + geo-fence | DIFF | ✅ FR-AT-001 (60s rotation, geo — stronger than most) | — |
| E-signature attendance | TS in regulated/EU | ✅ FR-AT-003 (but Phase 3) — **pull into Phase 1–2** | P1 |
| **Offline capture with later sync** | DIFF | ⚠️ PWA offline in Phase 4 only | P1 |
| **VILT attendance import** (Zoom/Teams participant reports) | TS | ❌ | **P0** |
| NFC / kiosk / biometric | DIFF | ⚠️ enum values exist, no FR | P2 |
| Attendance thresholds driving certificate/subsidy eligibility | TS | ❌ (e.g. HRDF Tamheer withholds stipend at >10% absence) | P1 |

### 4.7 Evaluation & Assessment
| Capability | Tier | BRD | Priority |
|---|---|---|---|
| L1 reaction surveys auto-sent | TS | ✅ evaluation_forms + deadline | — |
| **Pre/post tests (L2) with question bank, scoring, pass mark** | TS | ⚠️ `assessment_score` field; no exam engine / question bank | **P0** |
| **L3 behaviour follow-up to learner + manager at 30/60/90 days** | DIFF | ⚠️ "Kirkpatrick L1–4 tracking" named, no workflow | P1 |
| L4 / Phillips ROI | DIFF | ✅ AI-011 (Phase 4) | — |
| AI analysis of free-text comments | DIFF | ⚠️ AI-008 NLG reports; not comment analysis | P2 |
| Trainer evaluation of learners (grades, comments) | TS | ⚠️ grade field only | P1 |

### 4.8 Certification & Compliance
| Capability | Tier | BRD | Priority |
|---|---|---|---|
| PDF certificates, QR verification, numbering | TS | ✅ very strong (FR-CC-001, FR-ORG-070–074) | — |
| Expiry / recertification / auto re-enrollment | TS | ✅ FR-CC-002, AI-005 | — |
| Compliance matrix by role/site/regulation | TS | ✅ FR-CC-003 | — |
| **External certifications held by employees** (upload proof, e.g. SAMA/FA exams, professional licences) | TS | ⚠️ user_certifications tied to internal courses | **P0** for banking segment |
| **Open Badges 3.0 / W3C Verifiable Credentials** | DIFF→TS by 2027 | ❌ | P1 |
| Wallet export (Credly/Accredible, LinkedIn) | DIFF | ❌ | P2 |

### 4.9 Finance
| Capability | Tier | BRD | Priority |
|---|---|---|---|
| Budgets by dept/category/year; commitments vs actuals | TS | ✅ FR-BC-001/003 (commitments not explicit) | — |
| Cost per session/learner/hour | TS | ✅ | — |
| **Internal chargebacks to cost centres** | DIFF | ❌ (cost_center_code exists) | P1 |
| **POs, vendor invoices matched to sessions, ERP sync** | DIFF | ⚠️ receipts upload; no PO/invoice matching or ERP export | P1 |
| **Training subsidy / levy claims** (HRDF KSA, Egypt training-fund exemption evidence) | TS in levy countries | ❌ | **P0** (KSA) |
| Multi-currency | TS | ✅ §13.4 | — |

### 4.10 OJT / Observation / Skills Sign-off
| Capability | Tier | BRD | Priority |
|---|---|---|---|
| Structured OJT plans, mentor, supervisor, evidence, scoring | DIFF→TS | ✅ FR-OJT-001–004 (competitive, **not unique**) | — |
| **Reusable observation checklists** usable inside any course (not only OJT plans) | TS | ❌ | P1 |
| Offline mobile sign-off by assessor with e-signature | DIFF | ⚠️ (PWA offline Phase 4) | P1 |
| **Qiwa OJT contracts & 2% quota tracking** (KSA 2026 mandate) | DIFF (unique) | ❌ | **P0** |

### 4.11 Learner & Manager Experience
| Capability | Tier | BRD | Priority |
|---|---|---|---|
| Learner "My" area, .ics, certificates | TS | ✅ `/my/*` | — |
| Manager team dashboard (team calendar, gaps, approvals, one-click nominate) | TS | ⚠️ persona + permissions exist; no dedicated FR/route | **P0** |
| Mobile / PWA | TS | ✅ (install config FR-ORG-024); offline late | — |
| Flow-of-work: approvals & check-in inside WhatsApp / Teams / Slack | DIFF | ✅ WhatsApp (strong) · ⚠️ Teams/Slack listed in marketplace only | P1 |
| **Joining instructions / pre-work / materials** delivery per session | TS | ⚠️ participant_instructions field | P1 |
| Accessibility WCAG 2.2 AA | TS | ⚠️ BRD targets **2.1** AA → update to 2.2 | P1 |

### 4.12 Logistics (often-forgotten)
| Capability | BRD | Priority |
|---|---|---|
| **Session task checklists** with owners & due dates relative to session date (book room, print, ship materials, send joining instructions) | ❌ | **P0** — this is where Persona "Nada" loses 60% of her time |
| Materials / printing quantities driven by enrolment | ❌ | P1 |
| Catering requests | ⚠️ FR-VR-002 mentions; no spec | P1 |
| Travel & accommodation for trainers/trainees, per-diems | ❌ | P1 |
| Room setup checklists (layout, AV, accessibility) | ⚠️ setup styles only | P2 |

### 4.13 Reporting & Analytics
| Capability | Tier | BRD | Priority |
|---|---|---|---|
| Standard ops reports (fill rate, no-shows, utilisation, cost) | TS | ✅ FR-AR-003 | — |
| Custom report builder, scheduled delivery | TS | ✅ FR-AR-005 | — |
| BI export / warehouse connector | TS | ⚠️ Power BI in marketplace list only | P1 |
| **ESG / human-capital reporting** (GRI 404-1, ESRS S1-13: hours per employee by gender & category) | DIFF | ❌ (no gender field on user_profiles) | P1 |
| Predictive: no-show risk, demand forecast, budget burn | DIFF | ⚠️ burn-rate projection only | P2 |
| "Ask your data" natural-language reporting | DIFF | ⚠️ NLG summaries; not conversational query | P2 |

### 4.14 Integrations & Standards
| Capability | Tier | BRD | Priority |
|---|---|---|---|
| HRIS, SSO (SAML/OIDC), REST API, webhooks | TS | ✅ | — |
| **SCIM user provisioning** | TS (enterprise) | ❌ | P1 |
| xAPI / LRS | DIFF | ✅ INT-005 | — |
| cmi5 | DIFF | ❌ | P2 |
| **Named LMS connectors beyond Jadarat** (Moodle, Docebo, SAP SF, Cornerstone) | TS for enterprise deals | ⚠️ listed in marketplace, no spec | P1 |
| ERP/finance (SAP, Oracle, Odoo, Xero) | DIFF | ❌ | P1 |
| **Government platforms**: Qiwa (disclosure + OJT contracts), HRDF, Masar (gov HR), UAE MoHRE/Nafis exports | DIFF (unique) | ⚠️ "Qiwa report format" one line | **P0** |
| Low-code automation canvas | DIFF | ⚠️ workflow builder is approvals-only | P2 |

### 4.15 AI
| Capability | Market | BRD | Assessment |
|---|---|---|---|
| Admin copilot that *executes* actions (with audit + undo) | Administrate AI Assistant, SAP Joule agents, Docebo Harmony, Absorb Aura, Cornerstone agents | ⚠️ chatbot is learner-facing Q&A | **Gap — this is now the market's headline feature.** Add an "Ops Agent" (Arabic-first) that can schedule, enroll, pull reports, with confirmation + audit + reversible actions |
| AI scheduling for ILT | Only Administrate (TO: assisted) | ✅ AI-006 | Real differentiator — keep and prioritise |
| Content/course generation | Everyone | ✅ AI-004 | Table stakes |
| Skills inference & recommendations | SAP, Cornerstone, Workday | ✅ AI-001, AI-013 | Parity |
| AI governance console (toggles, model choice, BYOK, cost caps) | SAP AI Services admin | ✅ FR-ORG-060–062 | **Ahead of most** |
| Sovereign Arabic model option (Jais) | None | ✅ | Unique |
| **MCP server / agent interoperability** | Docebo MCP (GA Jul 2026) | ❌ | P1 — expose TMS actions to customers' own agents |
| Predictive no-shows + overbooking, auto-drafted Qiwa/HRDF claims, L3 feedback summarisation | Not found in any vendor | ❌ | Whitespace — P2 differentiators |

---

## 5. Prioritised Additions to the BRD

### P0 — add before GA
1. **FR-PLN: Training Planning Cycle** — TNA campaigns, request intake, demand consolidation, plan approval, calendar publication, plan-vs-actual. New tables: `training_needs_campaigns`, `training_requests`, `training_plans`, `training_plan_lines`.
2. **FR-GOV-KSA: Qiwa & HRDF compliance pack** — annual training-data disclosure (hours ≥ 8 units/trainee, trainees, plan, next-year budget; due 31 Jan; fines SAR 5–15K); OJT 2% quota tracking + Qiwa contract reference; HRDF claim evidence (attendance ≥ 90% for Tamheer, certificate authentication).
3. **FR-VND: Training Providers/Vendors** — provider entity, accreditation (TVTC), contracts, rate cards, provider catalogue, provider portal (role already exists).
4. **FR-ASM: Assessment Engine** — question banks, pre/post tests, pass marks, attempts, L2 gain reports.
5. **FR-LOG: Session Task Checklists** — templated tasks per course/session type with owners, relative due dates, reminders.
6. **FR-VILT: Virtual classroom integration** — Zoom/Teams/Webex meeting creation + attendance import.
7. **FR-MGR: Manager Hub** — team calendar, compliance gaps, pending approvals, nominate/assign.
8. **External certifications** — employees upload externally earned licences/certs (SAMA/FA, CMA, SCFHS, etc.) with expiry and verification.
9. **In-country hosting architecture** for Government/CNI/banking tenants (see §6.5).

### P1 — next phase
Resource timeline (Gantt) view · trainer payments · chargebacks & no-show fees · POs/invoice matching + ERP export · seat quotas · L3 follow-up automation · Open Badges 3.0 · reusable observation checklists · offline PWA attendance moved earlier · e-signature attendance moved earlier · SCIM · BI connector · ESG reporting (add `gender`, `employment_category` to users) · travel & accommodation · Teams/Slack approvals · Arabic Ops Agent (agentic admin copilot) · MCP server · course versioning · WCAG 2.2.

### P2 — later / segment-dependent
E-commerce & public/B2B learners (P0 if targeting training providers) · vendor RFQ · trainer call-for-tender · cmi5 · NFC/biometric · predictive no-show · conversational analytics · credential wallets.

---

## 6. Regulatory Fact-Check (BRD §13, §15)

| # | BRD statement | Verdict | Correct fact |
|---|---|---|---|
| 1 | Nitaqat colors "Platinum/Green/Red" | ⚠️ | **Five bands: Platinum, High Green, Medium Green, Low Green, Red** (Yellow removed ~2020). New Nitaqat Mutawar phase began 2026. Model as 5-value enum. |
| 2 | UAE: 2% annual increase | ✅ | 1% per half-year (30 Jun / 31 Dec), firms 50+ employees, skilled roles |
| 3 | UAE: 10% by 2026 | ✅ | — |
| 4 | UAE penalty AED 96,000–108,000 | ⚠️ outdated | AED 72K (2022) → 84K → 96K → 108K → **AED 120,000/yr for 2026** (AED 10K/month). **Missing:** firms with **20–49 employees in 14 sectors** must hire 1 Emirati/yr (2024, 2025) |
| 5 | Nafis "500 Emiratis/year for Cat 1" requirement | ⚠️ | It is **one optional route** to MoHRE Category 1, not a requirement |
| 6 | Egypt Law 14/2025 training fund | ✅ + detail | In force **1 Sep 2025**; employers with **30+** staff pay **0.25% of minimum insurance wage per employee (EGP 10–30/employee/yr)**; Minister may **exempt** firms that run their own training → TMS should generate exemption evidence. *(Verify rate against Arabic text.)* |
| 7 | Egypt PDPL 151/2020 | ✅ + deadline | Executive Regulations (Decree 816/2025) effective **2 Nov 2025**; **1-year grace → compliance due ~Nov 2026** (imminent) |
| 8 | SAMA certs "Retail Banking, Credit Advisor L1, Banking & Transfer" | ⚠️ names | **Retail Banking Foundations; Credit Advisor Certificate – Level 1; Professional Certificate in Exchange & Transfer; Foreign Exchange Professional Exam; Compliance Foundations** (Financial Academy). Rollout: within 2 yrs, ≥25% certified every 6 months; Exchange & Transfer within 1 yr of hire, ≥90% coverage |
| 9 | SAMA AML/CTF | ⚠️ | Dedicated AML/CTF exam (CME-2) is a **CMA** (capital markets) mandate; add CMA as a framework |
| 10 | "Cybersecurity Framework Level 3 maturity training" | ❌ | SAMA CSF Level 3 is an **institutional maturity level**, not an employee certification. Remove from certificate tracking; could be supported as an org-level awareness-training KPI |
| 11 | Weekends table | ✅ mostly | UAE federal gov has a **Friday half-day**; private sector chooses. Make work-week per-branch configurable **with half-days** |
| 12 | Saudi PDPL | ✅ | Fully enforceable since 14 Sep 2024. Transfers to EU **allowed** with SDAIA SCCs + transfer risk assessment (no adequacy list) |
| 13 | Hosting Frankfurt for all tiers | ❌ for Gov | See 6.5 |

### 6.1 Missing Saudi obligations (high value)
- **Qiwa annual training-data disclosure** (Ministerial Resolution 3568, 2023): establishments ≥50 employees, by **31 January** each year: training hours (≥ 8 training units/trainee/year), trainee count, training plan, **next year's committed training budget**. Fines SAR 5,000–15,000 (doubled on repeat).
- **OJT mandate** (Ministerial Decision 116264, effective **18 Apr 2026**): establishments ≥50 employees must train **≥2% of workforce per year** in OJT of 2–6 months (≥100 trainees for 5,000+ employees); contracts signed on Qiwa.
- **HRDF (Hadaf)**: Tamheer stipend withheld if absence >10%; strategic-partner training covers 75% of cost (≤ SAR 3,000/month, ≤24 months); professional-certificate reimbursement after passing (268 certificates); Maharat requires TVTC-authenticated completion certificates.

These three turn Jadarat's existing modules (attendance, OJT, budgets, certificates) into **regulator-ready evidence** — a much stronger pitch than "Nitaqat color calculation" (which is an HR-workforce metric, not a training metric, and is already computed by Qiwa itself).

### 6.5 Hosting & sovereignty
- **Saudi NCA Cloud Cybersecurity Controls (CCC-2:2024)** apply to government entities and CNI operators and restrict data location; top-secret data must stay on in-Kingdom private cloud.
- **UAE** federal PDPL excludes government data; Cloud-First policy keeps sensitive government data in-country.
- **Implication:** Vercel + Supabase in Frankfurt works for private-sector tenants (with SCCs), but the **Government tier requires an in-country deployment** (e.g. self-hosted Supabase + Next.js standalone on a KSA/UAE cloud such as STC Cloud, Oracle Jeddah/Riyadh, Azure UAE North, AWS me-central-1, G42/Core42). The BRD currently lists on-prem only as "documentation" in Phase 4 — this should be a Phase 3 architectural workstream if Government is a Year-1 segment.
- SAP SuccessFactors already runs in Riyadh and Dubai data centres — the BRD's "MENA data residency" advantage does **not** hold against SAP.

---

## 7. Internal Consistency & Technical Issues Found in the BRD

| Section | Issue | Suggested fix |
|---|---|---|
| §14.1 | `"regions": ["cdg1"]` commented as Frankfurt — **cdg1 is Paris**; Frankfurt is `fra1` | Use `fra1` to co-locate with Supabase eu-central-1 |
| §5.3 | `pathname.includes('/(dashboard)')` — **route groups never appear in URLs**, so the auth redirect never fires | Match real protected prefixes (e.g. `/[locale]/(?!login|register|catalog)`) |
| §5.3 | Uses deprecated `@supabase/auth-helpers-nextjs` and `getSession()` in middleware | Use `@supabase/ssr` and `supabase.auth.getUser()` (server-verified) |
| §5.4 | Creates `auth.tenant_id()` in the `auth` schema — Supabase restricts custom objects in `auth` | Create in `public`/`private` schema; also add `tenant_id` via a Custom Access Token Hook |
| §6 | `user_profiles` references `departments`/`branches`/`roles` before they are created; `courses` references `certification_templates` before creation | Reorder migrations or add FKs via `ALTER TABLE` |
| §18 vs §17 | Matrix claims ✅ for Digital Signatures, Mobile PWA, On-prem, but roadmap puts them in Phase 3–4 | Mark as "Roadmap" |
| §9 vs §17 | AI-006 scheduling: "Phase 2 (months 7–12)" in §9, Phase 3 (months 7–9) in §17; AI features in §9 span 18 months, roadmap spans 12 | Align timelines |
| §17 Phase 4 | Items duplicated (instructor matching, ROI, STT, NLG, competency viz, PWA, on-prem listed twice) | De-duplicate |
| §8.11 / stack | SMS via Twilio and push notifications in FR-NC-001 but not in tech stack or env vars | Add provider (Twilio / Unifonic — Unifonic is MENA-native) |
| §9 AI-001 vs FR-ORG-061 | Embeddings via OpenAI while default LLM is Anthropic; Government tenants told to use Jais "data stays in-region" while embeddings still go to OpenAI | Define per-tenant embedding provider too (sovereignty) |
| §15.2 | "Separation of duties enforcement" — no spec | Define SoD rules (e.g. requester ≠ approver, budget creator ≠ approver) |
| §13.5 | Nitaqat penalty/colour calculation duplicates Qiwa's own computation and depends on full workforce data the TMS won't own | Reposition: training-side contribution (hours per Saudi employee, OJT quota, HRDF evidence) |
| §19.2 | WCAG 2.1 AA | Upgrade to WCAG 2.2 AA |
| §6 `user_profiles` | No `gender` / `date_of_birth` / `employment_category` fields | Required for ESG (GRI 404-1) and many ministry reports |

---

## 8. Differentiators That Survive Scrutiny (Recommended Positioning)

| Differentiator | Why it holds | Evidence of absence elsewhere |
|---|---|---|
| **Arabic-first UX** (not just RTL) — 4-part names, Arabic morphological search, Hijri dual dates, Eastern numerals, formality-aware AI tone | Competitors support RTL at best; Absorb/Arlo not at all | §2 |
| **MENA-aware scheduling** — prayer blocks, Jumu'ah, Ramadan hours, country weekends/half-days, Hijri holidays | Not found in any competitor | All vendor research |
| **Regulator-ready evidence packs** — Qiwa disclosure, OJT 2% quota, HRDF claims, Emiratization/Nafis, Egypt training-fund exemption, SAMA/FA certificate coverage rules | Only Jisr claims partial "Qiwa-ready" tracking | §2, §6 |
| **WhatsApp-native operations** — approvals, reminders, check-in, chatbot | No TMS/LMS competitor found with native WhatsApp | All vendor research |
| **AI scheduling for ILT + Arabic Ops Agent** | Only Administrate ships AI scheduling; no Arabic agentic admin anywhere | §4.15 |
| **Sovereign AI option (Jais) + AI cost governance** | Unique | — |
| **SME price point** ($3–8/user/mo) | Competitors: Docebo ~$25K+/yr, Administrate ~$65K+/yr, TO quote-based | §2 |
| **Unified offline + Jadarat LMS record** (offline vs LMS source differentiation) | Comparable to TO↔Docebo pairing, but single-vendor and Arabic | — |

**Drop or soften:** "only platform with QR attendance / OJT / digital signatures / mobile" and "MENA data residency" (vs SAP).

---

## 9. Key Sources

**Dedicated TMS**
- Training Orchestra — budgets: https://trainingorchestra.com/training-management-system/budget-and-cost-tracking/ · instructor portal: https://trainingorchestra.com/instructor-engagement-portal/ · Edusign integration: https://help.edusign.com/en/articles/8497682-training-orchestra · Docebo connector: https://help.docebo.com/hc/en-us/articles/4695335533586-Docebo-for-Training-Orchestra · TNA: https://trainingorchestra.com/training-needs-analysis/
- Administrate — AI Scheduler: https://www.getadministrate.com/features/ai/scheduler/ · AI Assistant: https://getadministrate.com/features/ai/assistant/ · pricing: https://getadministrate.com/pricing/
- Arlo — mobile attendance: https://support.arlo.co/hc/en-gb/articles/211909463-Record-attendance-and-grades-in-Arlo-for-Mobile · Moodle: https://arlo.co/features/moodle-integration · localisation: https://support.arlo.co/hc/en-gb/articles/211903023
- accessplanit — trainer portal/signatures: https://www.accessplanit.com/trainer-portal

**Enterprise LMS**
- SAP SF QR attendance: https://help.sap.com/docs/successfactors-learning/managing-sap-successfactors-learning-for-administrators/enabling-qr-codes-to-record-attendance · e-signatures: https://help.sap.com/docs/successfactors-learning/creating-learning-approval-processes/e-signatures · Task Checklist Observer: https://help.sap.com/docs/successfactors-learning/creating-assessments-to-test-users-learning/task-checklist-observer · GCC data centres: https://www.tahawultech.com/news/sap-gcc-data-centres/ · 1H 2026 agentic learning: https://community.sap.com/t5/human-capital-management-blog-posts-by-sap/first-half-2026-release-agentic-ai-in-sap-successfactors-learning/ba-p/14379826
- Docebo QR attendance: https://help.docebo.com/hc/en-us/articles/4408352796434 · observation checklists: https://help.docebo.com/hc/en-us/articles/360020124179-Creating-observation-checklists · AgentHub: https://www.docebo.com/company/newsroom/docebo-launches-docebo-agenthub-and-unites-skills-intelligence-enterprise-knowledge-and-agentic-ai-in-a-single-platform/ · hosting: https://www.docebo.com/company/docebo-service-descriptions-ee/
- Cornerstone QR for ILT: https://help.csod.com/help/csod_0/Content/Cornerstone_CSX_App/CSOD_Learn_-_QR_Codes_for_ILT.htm · OJT: https://help.csod.com/help/csod_0/Content/Catalog/On_the_Job_Training/On_the_Job_Training_-_Overview.htm · Demand forecasting: https://help.csod.com/help/csod_0/Content/Catalog/Training_Forecast/Training_Demand_Forecasting.htm · Workforce AI: https://www.cornerstoneondemand.com/company/news-room/press-releases/cornerstone-launches-cornerstone-workforce-ai-the-intelligence-platform-for-workforce-readiness-built-to-amplify-human-potential-exponentially-with-ai/
- Workday observational checklists: https://doc.workday.com/admin-guide/en-us/human-capital-management/learning/learning-content/observational-checklists/create-observational-checklist.html · Sana: https://newsroom.workday.com/2025-11-04-Workday-Completes-Acquisition-of-Sana
- Absorb languages (no RTL): https://support.absorblms.com/hc/en-us/articles/220311588-Supported-Languages · Aura: https://www.globenewswire.com/news-release/2026/05/19/3297575/0/en/
- 360Learning audit-proof attendance: https://360learning.com/blog/product-update-audit-proof-attendance/

**Analysts / buyer guides**
- Brandon Hall — ILT resurgence: https://brandonhall.com/the-resurgence-of-ilt/ · Fosway 9-Grid 2025: https://learningnews.com/news/fosway/2025/2025-fosway-9-grid-for-learning-systems · G2 TMS category: https://www.g2.com/categories/training-management-systems · Explorance MTM: https://explorance.com/products/metrics-that-matter/ · Open Badges 3.0 (Credly): https://learn.credly.com/blog/credly-supports-open-badge-3.0 · GRI 404: https://www.globalreporting.org/publications/documents/english/gri-404-training-and-education-2016/

**MENA & regulation**
- Jisr/Lumofy: https://www.jisr.net/en/product-updates/june-2025 · Tqdm: https://tqdm.net/ · EDAA: https://www.edaaportal.com/
- Qiwa training disclosure: https://www.hrsd.gov.sa/en/media-center/news/15114520 · https://me-insights.bakermckenzie.com/2023/09/03/saudi-arabia-resolution-concerning-training-data-disclosure-issued/
- OJT 2% mandate: https://www.argaam.com/en/article/articledetail/id/1881358 · https://www.spa.gov.sa/en/N2517122
- Nitaqat bands: https://www.fragomen.com/insights/elimination-of-yellow-band-from-nitaqat-program.html
- UAE Emiratisation: https://mohre.gov.ae/en/media-center/news/6/1/2023/ · 20–49 employees: https://www.mohre.gov.ae/en/media-center/news/2/1/2024/
- Egypt Labour Law 14/2025: https://www.ey.com/en_gl/technical/tax-alerts/egypt-enacts-new-labor-law-with-changes-affecting-employers-beginning-1-september-2025 · PDPL regulations: https://www.tamimi.com/law_update_articles/from-policy-to-practice-egypt-issues-executive-regulations-of-the-personal-data-protection-law/
- SAMA professional certificates: https://rulebook.sama.gov.sa/en/professional-certificates-financial-institution-employees · SAMA CSF: https://rulebook.sama.gov.sa/en/cyber-security-framework-2
- Saudi PDPL transfers: https://www.mayerbrown.com/en/insights/publications/2024/10/updates-to-saudi-arabias-personal-data-protection-regulations-sccs-guidelines-and-more · NCA CCC: https://nca.gov.sa/en/regulatory-documents/controls-list/ccc/
- HRDF Tamheer: https://www.hrdf.org.sa/en/products-and-services/programs/establishments/training/graduate-development/
