# Roles — approach, standard set and mandatory-roles analysis

| | |
|---|---|
| **Status** | **Approved (PO, 17 Oct 2026)** — the six-role set, the Arabic labels, the templates and the mapping below; business flow agreed in [`EP-ROLES-roles-and-custom-roles.md`](../../business-flows/EP-ROLES-roles-and-custom-roles.md) (one role per person, Instructor as a template, line managers from the reporting line, named plan approvers). Tech Lead proposal of 15 Oct 2026 |
| **Decisions behind it** | PO, 14 Oct 2026: build role by role with full feature lists · PO, 15 Oct 2026: "too many users roles; I suggest 4 or 5 now and through users permissions I can create a custom role and give it a name and privileges" · PO, 15 Oct 2026: Training Coordinator is a standard role ("it's crucial") · PO, 15 Oct 2026: "search for any mandatory role to set it up from scratch" |
| **Requirements** | BRD v3.1 §4.2, §5.4, Appendix B; FR-IAM-07 (custom role builder, R1), FR-IAM-08 (R1 note), BR-IAM-1 (one role per person), BR-IAM-4 |
| **Build plan** | `BACKLOG.md` → `EP-ROLES` |

## 1. How we work role by role

1. **Business flow first** (PO, 15 Oct 2026): before a role's screens are designed, the phase it belongs to has an agreed business flow in [`docs/business-flows/`](../../business-flows/README.md) — who does what, in which order, with which approvals.
2. **Full feature list per role**: Claude lists the role's features from the BRD with releases and status; the PO discusses and approves them (example: [`organization-admin.md`](organization-admin.md), approved 14 Oct 2026).
3. **Screens per feature area in one batch** (Kawadir ATS layout, [`docs/design/kawadir-alignment.md`](../../design/kawadir-alignment.md)), approved by the PO, then built as one PR per complete feature area.

Since 15 Oct 2026 the order follows the R1 core journey (BRD §5.4) rather than one role at a time: Organization Admin set-up → HR Manager structure → L&D Manager course library and planning cycle → Department Head needs → consolidation → plan approval → delivery. Role pages are written as each role's part of the journey comes up.

| Role | Feature list | Status |
|---|---|---|
| Organization Admin | [`organization-admin.md`](organization-admin.md) | Approved 14 Oct 2026; remaining items paused until after the planning core (PO, 15 Oct 2026) |
| HR Manager | — | With `EP-PLN` (structure and department heads) |
| L&D Manager | — | With `EP-PLN` (course library, planning cycle, consolidation, plan approval) |
| Training Coordinator | — | With `EP-PLN` (consolidation support) and the delivery epics |
| Department Head | — | With `EP-PLN` (needs form, plan-line approval) |
| Employee | — | With the delivery epics (requests, My learning, certificates) |

## 2. Standard roles (six; approved 17 Oct 2026)

| Role | Code (today) | Arabic label | Scope | Privileged | Main job |
|---|---|---|---|---|---|
| Organization Admin | `tenant_admin` | **«مدير المنظمة»** (Kawadir ATS; approved 17 Oct 2026 — formerly «مدير المنشأة») | Organization | Yes | Set-up only (settings, branding, team members, roles, security, integrations, e-mail integration, subscription, audit); holds no other role (BR-IAM-4) |
| HR Manager | `hr_manager` | مدير الموارد البشرية | Organization | Yes | Employee records, structure (branches, departments, department heads), compliance rules, HR system |
| L&D Manager | `training_manager` | مدير التعلم والتطوير | Organization | No | Course library, planning cycles, plan and budget envelopes, approval chain, sessions, notifications, training reports |
| Training Coordinator | `training_coordinator` | منسق التدريب | Organization | No | Scheduling, logistics, enrollments, attendance; in planning, helps collect and consolidate needs |
| Department Head | `department_head` | رئيس القسم | Headed departments + sub-departments | No | Proposes the department's needs, approves its plan lines and requests, team view |
| Employee | `learner` | **«موظف»** (replaces «متدرب»; approved 17 Oct 2026) | Own | No | Own requests, training, certificates |

The Platform Super Admin (ENTLAQA staff) stays outside tenant roles (platform console, FR-ADM-17). Permissions per area: BRD Appendix B. Privileged = Organization Admin, HR Manager, and every custom role with a high-risk permission; only an Organization Admin assigns those (PO, 5 Oct 2026, rule kept).

**Custom roles** (FR-IAM-07, R1): the Organization Admin gives a role a name (AR/EN) and picks permissions grouped by module, with high-risk permissions flagged, and one data scope for the role (own, direct reports, reports tree, headed departments, organization — the scopes already built; per-assignment scopes stay R2, FR-IAM-08). Templates for the former default roles are listed in BRD Appendix B.

## 3. Mandatory-roles analysis: setting up a new organization from scratch

**Method.** Walk the R1 journey of a brand-new organization step by step and name, for each step, the role that must exist for the step to happen at all. Sources: BRD v3.0 §4.2, §5.2 (P1–P10), §5.4, the actors named in §6 (ADM, IAM, PLN, CAT, SCH, ENR, ATT, ASM, CRT, RPT), Appendix B, the approval rules in FR-WFL-01/02, FR-PLN-08, FR-ENR-01…03, FR-FIN (R2+); the market research (`docs/research/TMS_Market_Comparison_vs_BRD.md`); and Kawadir ATS's roles.

**What the comparison sources say about roles.** The market research did not record competitors' full role catalogues; what it shows is the *actors* their journeys assume: an L&D / training administrator running plans and sessions, managers filling time-boxed needs forms and approving (Training Orchestra, Cornerstone), plan approval before sessions are drafted (Training Orchestra, SAP), an **instructor portal** for internal and external trainers (Training Orchestra; BRD FR-INS-05), a manager team hub (all leaders), and provider/vendor users as an optional extension. Kawadir ATS ships six roles: `super_admin` (platform, like our Platform Super Admin), `org_admin` (set-up, like our Organization Admin), `hr_manager`, `recruiter` (the day-to-day operator — like our L&D Manager / Training Coordinator), `hiring_manager` (the business-side requester and approver — like our Department Head) and `interviewer` (a task-scoped participant who acts only on what they are assigned — like an **Instructor** in a TMS). The parallel suggests that a task-scoped participant role is part of a minimal set.

### 3.1 Step by step

| # | Step (R1) | What happens | Role that must exist | Can a standard role cover it? | Requirements |
|---|---|---|---|---|---|
| 1 | Sign-up and provisioning | Organization created, trial, standard roles provisioned | **Platform Super Admin** (ENTLAQA; for sales-led set-up and support) — self sign-up needs no tenant role | Not a tenant role | FR-ADM-01, 17 |
| 2 | Organization set-up | General settings, branding, e-mail integration, team members and roles, security, integrations | **Organization Admin** | — (mandatory) | FR-ADM-02, 07, 11, 13; FR-IAM-01…05, 07; FR-NTF-11 |
| 3 | Structure | Branches, departments, department heads, employee records | **HR Manager** | Not by the Organization Admin (setup role; structure moved to HR, PO, 11 Oct 2026). A small organization without HR could give one person HR Manager | FR-ADM-04, 05; FR-IAM-01, 02 |
| 4 | Course library | Courses, categories, delivery types, cost model | **L&D Manager** (Training Coordinator edits) | — (mandatory) | FR-CAT-01, 02, 10 |
| 5 | Planning cycle | Period, deadline, scope, budget envelope per department | **L&D Manager** | — | FR-PLN-02 |
| 6 | Department needs | Each department head proposes needs for their team | **Department Head** | — (mandatory: the cycle sends one form per headed department; without heads there is no one to send it to) | FR-PLN-03, FR-MGR-05 |
| 7 | Consolidation and budget check | Needs grouped, sessions needed, cost vs. envelopes | **L&D Manager**, assisted by the **Training Coordinator** | L&D Manager alone is enough in a small team | FR-PLN-05, 06 |
| 8a | Plan approval — department step | Department Head approves the department's lines | **Department Head** | — | FR-PLN-08 |
| 8b | Plan approval — Finance step | Finance confirms cost and budget | **Finance approver** | **Yes, by default**: the step's approver can be a **named person** (any member, e.g. the CFO holding Employee) or the L&D Manager; a "Finance approver" custom role is needed only when finance staff should also see budgets and cost reports | FR-PLN-08, FR-WFL-02 (R1 part) |
| 8c | Plan approval — management step | Final sign-off | **Management approver** | **Yes, by default**: a named person (e.g. the general manager holding Employee) — the step needs no role. Not the Organization Admin (setup role without training features) | FR-PLN-08 |
| 9 | Plan → sessions, scheduling | Draft sessions from the plan, dates, venues, instructors, conflicts | **Training Coordinator** / L&D Manager | — | FR-PLN-09, FR-SCH-01…08, FR-RES-01…03, FR-INS-01…04 |
| 10 | Enrollment and approvals | Self, manager and bulk enrollment; approval chain (direct manager or Department Head → L&D Manager) | **Employee** (self), **Department Head** (approves, nominates), Training Coordinator (bulk) | Direct managers who do not head a department: see question Q2 | FR-ENR-01…03, 13; FR-MGR-01…04 |
| 11 | Logistics | Task checklists, joining instructions | **Training Coordinator** | — | FR-LOG-01, 02 |
| 12 | Attendance | Roster, QR check-in shown by the trainer, check-in/out | **Training Coordinator** (roster), **Employee** (self check-in); **Instructor** for the instructor portal | The Training Coordinator can mark every roster, but FR-INS-05 (instructor portal, R1) and the rotating QR shown by the trainer assume an **instructor login** — see Q1 | FR-ATT-01…04, 09, 11; FR-INS-05 |
| 13 | Assessment | Tests, grading rubrics, L1 surveys | **Employee** (takes them), **Instructor** (grades) | The Training Coordinator or L&D Manager can grade, but FR-ASM-04 (instructor grading, R1) assumes the instructor — see Q1 | FR-ASM-01, 02, 04, 05, 08 |
| 14 | Certificates and compliance | Automatic issue, verification, expiry; external certifications approved; compliance rules | **L&D Manager** (templates), **HR Manager** (compliance rules, approves external certificates) | A Compliance Officer is optional (template) | FR-CRT-01…08, FR-REG-01 |
| 15 | Reports | Executive and operational reports | **L&D Manager**, **HR Manager**, **Department Head** (department) | An Auditor is optional (template) | FR-RPT-01, 02 |
| 16 | LMS connection (blended) | Connect Jadarat LMS, mapping, sync | **Organization Admin** | — | FR-LMS-01…03, 10 |

### 3.2 Conclusions (approved by the PO, 17 Oct 2026)

**(a) Mandatory standard roles** — the journey cannot run without them:

| Role | Why it is mandatory |
|---|---|
| Organization Admin | The only role that sets the organization up (step 2) and connects integrations (step 16); it never holds training features |
| HR Manager | The structure and department heads (step 3) are the input of the planning cycle; the PO moved them to HR (11 Oct 2026) |
| L&D Manager | Owns the course library, the cycle, consolidation and the plan (steps 4–7) |
| Training Coordinator | Runs delivery day to day (steps 9–12) and supports consolidation (step 7) — PO: "it's crucial" |
| Department Head | The cycle is built around one needs form and one approval per headed department (steps 6, 8a, 10) |
| Employee | Every person who requests, enrols, attends and receives certificates (steps 10–14) |

**(b) Roles needed only in some organizations → custom-role templates** (BRD Appendix B):

| Template | Step that needs it | Covered by default without it? |
|---|---|---|
| Finance approver | 8b plan approval (finance step); later budgets, expenses, POs (FIN, R2+) | **Yes** — the step's approver is a named person or the L&D Manager; the role is only for finance staff who must also see budgets and costs |
| Management approver | 8c final approval | **Yes** — a named person; no permissions beyond approving the plan |
| Line Manager | 10 approvals and team view for managers who do not head a department | **Partly** — the Department Head covers department heads; others depend on Q2 |
| Instructor (internal) | 12–13 instructor portal, attendance, grading | **Partly** — the Training Coordinator can do it for them; see Q1 |
| Compliance Officer | 14 compliance dashboards and regulatory reports | **Yes** — the HR Manager holds compliance (Appendix B) |
| Auditor | 15 read-only review incl. audit log | **Yes** — the Organization Admin reads the audit log |
| Training Provider Admin | Provider portal (FR-VND-04, R2) | Not needed in R1 |
| External Instructor | Instructor portal for non-employees (FR-IAM-15, R2) | Not needed in R1 (non-employee logins are R2) |
| Mentor / Assessor | OJT sign-off (FR-OJT, R2) | Not needed in R1 |

**(c) Roles the analysis shows may be missing from the six — PO answers (17 Oct 2026):** Q1 **Instructor = a template** of the role builder (keeps six standard roles); Q2 **line managers from the reporting line** (anyone with direct reports sees and approves for them; no role); Q3 **a named person per approval step** (no role); Q4 **«مدير المنظمة»** and **«موظف»**. Also agreed: **one role per person** (Kawadir). The options as proposed:

| # | Gap | Why it matters | Options (Tech Lead recommendation first) |
|---|---|---|---|
| Q1 | **Instructor** (المدرب) | R1 includes the instructor portal (FR-INS-05), instructor grading (FR-ASM-04) and the trainer-shown rotating QR (FR-ATT-02); without an instructor login, the Training Coordinator must do all of it. Kawadir's `interviewer` is the same kind of task-scoped role | (1) **Make Instructor a 7th standard role** (scope: assigned sessions only; not privileged) — recommended, because every organization that runs its own classroom training has internal trainers; (2) keep it a template that the setup wizard creates on request; (3) Training Coordinator does it in R1 |
| Q2 | **Direct managers who are not department heads** (Line Manager) | Enrollment and request approvals and the manager hub (FR-ENR-02, FR-MGR-01…04, R1) name "the manager"; the Department Head covers only those who head a department | (1) **Give team access from the reporting line in the person's record** — anyone with direct reports sees and approves for their team, with no role (recommended; needs a short security design); (2) Line Manager custom-role template; (3) route all approvals to the Department Head |
| Q3 | **Plan and budget approvers** (Finance, management) | Plan approval (FR-PLN-08) names Finance and management steps | (1) **Named person per step, no role** (recommended, already in FR-PLN-08 R1 text); (2) Finance approver / Management approver templates |
| Q4 | **Arabic labels** | «مدير المنظمة» (Kawadir) vs current «مدير المنشأة»; «موظف» for Employee vs «متدرب» | PO choice; then the UX writer updates the glossary |

## 4. Mapping existing role assignments (applied by migration `20261019090300`)

The database today holds 14 system roles (T-M2-03). When the six standard roles ship (`EP-ROLES`), each existing assignment is mapped as below. The current database holds test organizations only (no customers), so the mapping is low risk; it still runs as a checked migration with a dry-run count per role (DB deploy `plan`).

| Former role (code) | Maps to | Notes |
|---|---|---|
| Organization Admin (`tenant_admin`) | Organization Admin | Unchanged; still held alone |
| HR Manager (`hr_manager`) | HR Manager | Unchanged |
| L&D Manager (`training_manager`) | L&D Manager | Unchanged (key kept) |
| Training Coordinator (`training_coordinator`) | Training Coordinator | Unchanged (standard role, PO 15 Oct 2026) |
| Department Head (`department_head`) | Department Head | Unchanged |
| Learner (`learner`) | Employee | Renamed |
| Line Manager (`line_manager`) | Employee | Team access from the reporting line (Q2); the Line Manager template when an explicit role is wanted |
| Internal Instructor (`internal_instructor`) | Employee | The Instructor template when needed (Q1) |
| Finance Manager (`finance_manager`) | Employee | The Organization Admin may create the Finance approver template (privileged) and give it back |
| Compliance Officer (`compliance_officer`) | Employee | Compliance Officer template (privileged) on request |
| Auditor (`auditor`) | Employee | Auditor template (privileged) on request |
| Mentor / Assessor (`mentor`) | Employee | OJT is R2 |
| External Instructor (`external_instructor`), Training Provider Admin (`provider_admin`) | Assignment ended | Non-employee user types are R2 (FR-IAM-15); none exist outside tests |

Rule for the migration: nobody gains permissions they did not have — every former role maps to Employee or ends, and the counts per former role are written to the deploy log (DB deploy) so the Organization Admin can re-create the access with a custom role; the Organization Admin rule (BR-IAM-4) and the last-admin guard stay.

**One role per person (PO, 17 Oct 2026):** each member keeps one role — the one in force (or the Organization Admin role, else the primary one); the extra roles are removed (counted in the deploy log). Pending invitations keep their primary role (former roles → Employee; non-employee roles revoked) and lose their additional roles. The database then holds one role per membership (unique index) and no pending invitation with additional roles. Migrations `20261019090300` (mapping) and `20261019090400` (constraints).
