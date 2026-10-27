# Jadarat TMS — Product map (the customer's journey)

**Status:** sent to the PO 27 Oct 2026 (Arabic page «خريطة منتج جدارات للتدريب»); becomes the order of the menu, of the
«Set up your organization» checklist and of the remaining Release 1 work once the PO agrees. Written after the PO's
role-play feedback (`docs/delivery/test-feedback-2026-10-27.md`): the product had features but no visible order.

**Why this order.** It is the order Kawadir ATS uses (its Org Admin «Complete your setup»: branding → departments →
invite team → settings, then jobs → candidates → interviews → offers; `org-admin-dashboard.tsx`, `nav.json`) and the order
of the global products' own set-up guides: TalentLMS (portal basics → categories → users → courses → assign),
Docebo (configure the platform → users in branches/groups → courses → enrollment rules) and SAP SuccessFactors
Learning (org units and jobs → users → identify needs → items and curricula → assignment → history). Common pattern:
**look & settings → structure → people → content → needs & assignment → delivery → records & reports.** Jadarat adds
what they lack and the region asks for: the yearly planning cycle approved by Department Heads, Finance and management.

## Two direct answers (PO questions, 27 Oct 2026)

- **Structure first, then people?** Yes: General settings → Departments (one level named «Department» is enough) →
  Branches if any → invite people. The department is optional on the invitation (`invitations.ts`: `departmentId:
  optionalId`), so a person invited before the structure gets their department later from their record. The
  **Department Head** matters: they receive the planning cycle and enter their team's needs.
- **Is the manager needed?** Optional. It drives two things: the manager sees the person in «their team», and the
  person's own training requests go to the manager for approval (EP-ROLES Q3, PO 17 Oct 2026). Without one, the
  Department Head covers both. A simple organization sets heads only.

## The journey in four phases

Status on 27 Oct 2026: ✅ exists · 🟡 partly · ⬜ not built.

### Phase 1 — Set up the organization (once; Org Admin + HR Manager; 1–2 hours)

| # | Step | Who | Required | Optional | If skipped | Today |
|---|---|---|---|---|---|---|
| 0 | Create the organization (platform console) | Jadarat Super Admin | name, slug, admin e-mail | plan, trial | — | ✅ |
| 1 | General settings | Org Admin | country, timezone, default language | industry, working week, date display (Hijri/Gregorian) | defaults apply | ✅ |
| 2 | Departments (levels, then the tree) | HR Manager | ≥ 1 level and the departments | more levels, branches, cost centres | people cannot be placed; no planning cycle | 🟡 exists; reordered and simplified in WP-FIX-02 |
| 3 | A head for each department | HR Manager | heads of the departments that plan | — | the department receives no cycle, enters no needs | ✅ |
| 4 | People (invite or import) | HR Manager | e-mail, name, role | department, branch, manager, grade, cost centre | no department: outside every team and plan; no manager: the head covers | ✅ |
| 5 | Roles | Org Admin | nothing (six standard roles) | custom roles, department-limited roles | standard roles work | ✅ |
| 6 | Branding | Org Admin | nothing | logo, colours, sign-in image | Jadarat look | 🟡 colours lost after navigation (bug, WP-FIX-02 #1) |
| 7 | Courses | L&D Manager | nothing before planning | title, category, delivery type, duration, cost | needs are written as topics; courses created from the approved plan | ✅ delivery-type list to shorten |

### Phase 2 — Yearly planning (L&D Manager + Department Heads; 3–6 weeks)

| # | Step | Who | Required | Optional | If skipped | Today |
|---|---|---|---|---|---|---|
| 8 | Needs form | L&D Manager | nothing (default form) | edit the questions | default form | ✅ |
| 9 | Create and launch the planning cycle | L&D Manager | name, period, departments in scope, deadline | budget per department, reminders | no budget: no cost check; no reminders: manual follow-up | ✅ reminders wait for notifications (WP-PLT-01) |
| 10 | Department Head receives the cycle and enters needs | Department Heads | topic, people (count or names) | priority, quarter, cost, reason | the department drops out of the plan | ⬜ **next to build (WP-LD-01)** |
| 11 | Consolidate needs into plan lines (topic, branch, month; cost vs budget) | L&D Manager | a decision per line | link a line to an existing course | — | ⬜ WP-LD-02 |
| 12 | Plan approval (heads → Finance → management) | named approvers | ≥ 1 approval | longer chain, comments | a plan without approval is a draft | ⬜ WP-LD-03 |
| 13 | Plan → courses → draft sessions on the calendar (who, when) | L&D Manager | a course and a date per approved line | instructor, venue | — | ⬜ WP-LD-04 |

### Phase 3 — Delivery (all year; Training Coordinator, instructors, employees)

| # | Step | Who | Required | Optional | Today |
|---|---|---|---|---|---|
| 14 | Sessions and calendar (days, times, venue or link, instructor) | Training Coordinator | date and time | venue, instructor, minimum enrollment | ⬜ WP-LD-08 |
| 15 | Enrollment and nomination (self, by the head, in bulk) | everyone by role | — | manager approval | ⬜ WP-LD-09 |
| 16 | Logistics and attendance (joining instructions, roster, QR) | Training Coordinator | attendance recorded | QR, geo-fence | ⬜ WP-TC-01/02 |
| 17 | Evaluation and certificates | instructor, L&D Manager | — | pre/post test, certificate design | ⬜ WP-LD-11/12 |

### Phase 4 — Results (management, L&D Manager, employees)

| # | Step | Who | Today |
|---|---|---|---|
| 18 | Budget follow-up (approved, committed, spent, remaining per department) | L&D Manager | ⬜ WP-LD-14 |
| 19 | Reports (executive dashboard, hours, attendance, cost; per department and branch) | management | ⬜ WP-LD-13 |
| 20 | Employee page «My learning» (upcoming, required, my requests, my certificates) | employee | ⬜ WP-EMP-01/02 |

## What changes in the product because of the map

1. **Menu in journey order:** Home (with «Set up your organization», steps 1–7) · Planning (cycles, needs forms, *plan & budget*) · Delivery (courses, *sessions & calendar*, *attendance & certificates*) · Organization (Team members, **Departments** — was «Structure» —, Branches, Roles & permissions) · Settings (General, Branding, Grades, Email settings, Security, Subscription, Audit log) · *Reports*. Italics = not built yet.
2. **«Set up your organization» checklist** like Kawadir's: General → Departments → Team members and heads → Branding → Courses → Launch the first planning cycle; one button per step, each disappears when done.
3. **Forms the Kawadir way:** one form = one thing with the fewest fields (adding a department asks for its name only; code automatic); one field per row; after saving, the next step is offered («Add a Section under it?»); full-height panel; rules shown only when they apply, in plain words.
4. **Order of the remaining Release 1 work:** (a) clean up what exists (words, forms, Departments page, the nine role-play points — WP-FIX-02); (b) steps 10–13 (WP-LD-01…04) in their simplest form; (c) the PO's first full test: an organization with departments only, from set-up to the plan; (d) steps 14–17; (e) steps 18–20; (f) the remaining Org Admin extras (audit log, custom fields, …) last.

## Sources

- Kawadir ATS code: `src/app/(org)/org/dashboards/org-admin-dashboard.tsx` («Complete your setup»), `src/messages/en/nav.json`, `src/app/(org)/org/departments/page.tsx` (three-field dialog, «Add Division» from the row).
- TalentLMS, [Getting started with TalentLMS](https://help.talentlms.com/hc/en-us/articles/360014658393-Getting-started-with-TalentLMS/).
- Docebo, [Accessing and navigating your platform's Setup guide](https://help.docebo.com/hc/en-us/articles/360020127379-Accessing-and-navigating-your-platform-s-Setup-guide).
- SAP SuccessFactors Learning, [Implementing the Learning Needs Management Model](https://learning.sap.com/courses/sap-successfactors-learning-academy/implementing-the-learning-needs-management-model).
- `docs/research/TMS_Market_Comparison_vs_BRD.md` §4.1 (planning practice at Training Orchestra, Cornerstone, SAP).
