# Business flow — Planning cycle (training needs → approved plan → delivery)

| | |
|---|---|
| **Epic** | EP-PLN (BACKLOG T-M3-01; blocks T-M3-02 … T-M3-08) |
| **Requirements** | FR-ADM-04, 05 (structure, prerequisite) · FR-CAT-01, 10 (course library; FR-CAT-02 cost model follows in M4) · FR-PLN-02 (cycle) · FR-PLN-03 + FR-MGR-05 (Department Head needs) · FR-PLN-05, 06 (consolidation, budget check) · FR-PLN-08 + FR-WFL-01/02 R1 part (plan approval) · FR-PLN-09 (hand-over) · BR-PLN-1…3 · BRD v3.1 §5.4 steps 2–8 |
| **Status** | **Agreed (PO, 17 Oct 2026)** — all 18 open questions approved as proposed ("approve all"), including the two scope questions (11: built-in parallel department-head step; 14: plan vs. actual stays R2) |
| **Copied from Kawadir** | Kawadir has no planning module. The **approval screens** follow Kawadir's Requisitions page: summary cards (total / pending / approved / rejected), a «Review pending requests» banner for the approver, status tabs with counts, a details dialog listing the approvers in order with their status, **Approve / Reject** with a comment. Lists = table inside a card; short forms = dialogs; long forms (cycle set-up, needs form) = full pages (`docs/design/kawadir-alignment.md`) |
| **Background** | Roles: [`EP-ROLES`](EP-ROLES-roles-and-custom-roles.md) and [`docs/delivery/roles/README.md`](../delivery/roles/README.md) §3 steps 3–9 · Market practice: Training Orchestra, Cornerstone, SAP run a time-boxed manager needs campaign → consolidation → plan approval → draft sessions (`docs/research/TMS_Market_Comparison_vs_BRD.md` §4.1) |

## 1. Goal
Once a year the L&D Manager asks every Department Head what training their team needs, turns the answers into one costed training plan that fits each department's budget, gets it approved by the department heads, Finance and management, and hands the approved plan over to delivery as draft sessions in the training calendar. The approved plan is the organization's official record of planned training (later also the basis of the Qiwa disclosure, FR-PLN-12, R2).

## 2. Actors and roles
| Actor | Role | What they do in this flow |
|---|---|---|
| HR Manager («مدير الموارد البشرية») | Standard | Keeps branches, departments and **one head per department** up to date (prerequisite); hands over a leaver's departments |
| L&D Manager («مدير التعلم والتطوير») | Standard | Builds the course library; creates and launches the cycle; consolidates; decides lines; sets the approval chain; submits the plan; generates draft sessions |
| Training Coordinator («منسق التدريب») | Standard | Edits courses; follows up late departments; prepares the consolidation (grouping, mapping, sessions); generates draft sessions |
| Department Head («رئيس القسم») | Standard (their departments + sub-departments) | Fills and submits the needs form; answers change requests; confirms their department's lines in the approval chain |
| Finance approver | **Named person** chosen in the cycle (any member, e.g. the CFO holding Employee); optional "Finance approver" custom-role template | Approves the costed plan, rejects lines, or sends the plan back |
| Management approver | **Named person** chosen in the cycle (e.g. the General Manager) | Final sign-off |
| Employee («موظف») | Standard | Not active in R1 planning; named employees are invited when sessions are scheduled (delivery) |
| Organization Admin | Standard | No part (set-up only); sets currency, fiscal-year start and date display in General settings, which the cycle uses |

## 3. Step-by-step flow
**A. Prerequisites (before the first cycle)**
1. **HR Manager → Organization → Structure**: defines the organization's own levels (default one level, Department), builds the tree (and branches) and picks a **head** per unit (FR-ADM-04, 05; [`EP-ORG`](EP-ORG-organization-structure.md), agreed 17 Oct 2026). Units without their own head belong to the nearest head above. "Department" below means a unit of the structure at any level.
2. **L&D Manager → Courses**: creates the course library — code, title (AR/EN), description, category, delivery type, duration, minimum/maximum participants, **estimated cost for planning** (FR-CAT-01, 10). The Training Coordinator can add and edit courses.
3. **L&D Manager → Planning → Settings** (once): default approval chain (Department Head → Finance approver → management approver) and default reminder days (7 and 2 days before the deadline).

**B. Cycle set-up (FR-PLN-02)**
4. **L&D Manager → Planning cycles → New cycle** (full page, steps):
   - *Basics*: name (AR/EN), planning period (default = the next fiscal year from General settings), deadline for department forms, instructions to department heads.
   - *Scope*: departments and/or branches in scope → the screen lists the forms that will be sent (one per department in scope) and warns about **departments without a head**.
   - *Budget*: optional **budget envelope per department**, in the organization's currency.
   - *Approval chain*: copied from the default; the L&D Manager names the Finance and management approvers and may add, remove or reorder steps.
   - *Reminders*: days before the deadline.
5. **Launch** → cycle **Open**; every Department Head in scope gets a notification and a **needs form** for each department they head. Before launch the cycle is a **Draft** and can be edited or deleted freely.

**C. Department needs (FR-PLN-03, FR-MGR-05)**
6. **Department Head → My department → Training needs** opens the form: their team (from the structure), the envelope (if any), the deadline, and the needs added so far.
7. **Add need** (dialog): course from the library (search, Arabic-aware) **or** a free request (topic, description, estimated cost); number of people **and/or** named employees from their team; priority (critical / high / medium / low); reason (free text + type: role requirement, compliance / mandatory, performance, development, new project); preferred quarter of the planning period. The form shows the running estimated cost against the envelope.
8. **Save draft** any time; **Submit** before the deadline → status *Submitted*; the L&D Manager sees it. Until the deadline the head can **recall** the submission to change it. Reminders go to heads who have not submitted.
9. **L&D Manager / Training Coordinator → Cycle progress**: one row per department — *Not started · Draft · Submitted · Returned · Late* — with **Send reminder**.

**D. Consolidation and budget check (FR-PLN-05, 06)**
10. At the deadline the cycle becomes **Closed** (no more edits by department heads; L&D can still extend or reopen, §6).
11. **Consolidation** (L&D Manager, Training Coordinator): needs grouped by course (or requested topic), branch, delivery type and quarter, showing head-count, priority mix and requesting departments. Identical needs from several departments are **merged into one line**; free requests are **mapped** to an existing course or turned into a new library course.
12. For each line the system proposes the **number of sessions** (head-count ÷ maximum participants, respecting the minimum — e.g. 47 people, max 20, min 8 → 3 sessions of 16/16/15) and the **estimated cost**; the cost of a shared session is split between departments by number of people.
13. **Budget check**: per department, total estimated cost vs. envelope (*within* / *over by X*), and the organization total.
14. Per line the L&D Manager **accepts**, **adjusts** (head-count, quarter, sessions, course) or **rejects with a reason**; or **asks the department for changes** (comment + short new deadline) → that department's form reopens as *Returned* → the head changes and resubmits.
15. When every line is decided → cycle **Consolidated**; a **plan draft** (version 1) is created from the accepted lines.

**E. Plan approval (FR-PLN-08, FR-WFL-01/02 R1 part)**
16. **L&D Manager → Submit for approval** → plan *In approval*; the plan is frozen while in approval.
17. **Step 1 — Department Heads**: each head sees only **their** department's lines (and rejected lines with reasons) and **confirms** or **sends back** with a comment. The step completes when every department with lines has confirmed.
18. **Step 2 — Finance approver**: sees the whole plan with totals vs. envelopes → **Approve**, **reject individual lines** (reason required; the rest continues) or **send back** to the L&D Manager (comment required).
19. **Step 3 — Management approver**: same actions → **Approve** = plan **Approved (v1)** and **locked**.
20. A send-back returns the plan to the L&D Manager as a draft; after changes it is resubmitted and **resumes at the step that sent it back**, except that a Department Head whose lines changed confirms again first. Every round and decision is kept in the plan's history (who, when, comment, version).

**F. Hand-over to delivery (FR-PLN-09)**
21. **L&D Manager / Training Coordinator → Approved plan → Generate draft sessions**: per line, per quarter (or month) and per branch → draft sessions appear in the **training calendar**; named employees are attached as *planned participants* and are invited or pre-enrolled when the session is scheduled (scheduling and enrollment flows, M4).
22. Changes after approval go through a **revision** (new version, §6 "mid-year additions"); at the end of the period the plan is **Closed** and the cycle **Archived**.

## 4. Business rules
- BR-PLN-a: One needs form per department in scope; it belongs to the **department, not the person** — a new head inherits it.
- BR-PLN-b: A Department Head sees and edits only their departments' forms and plan lines; other departments' needs and costs stay hidden. Named employees must be in their team.
- BR-PLN-c: After the deadline only the L&D Manager can change a department's needs (extend, reopen, return for changes, or enter on behalf — recorded as "entered by L&D on behalf of …").
- BR-PLN-d: A line is rejected only with a reason, which the department head sees. A need linked to a mandatory or compliance rule cannot be removed without a reason (BR-PLN-1, once compliance pre-fill exists).
- BR-PLN-e: Every accepted line points to a library course before the plan is submitted (needed for draft sessions).
- BR-PLN-f: Over-envelope is a **warning**, not a block, in R1: the L&D Manager must write a justification per department over its envelope; Finance sees it highlighted (BR-PLN-2; block / extra approval options come with budgets, BR-FIN-2, R2).
- BR-PLN-g: Only the person (or role holder) of the **current** step can decide; the plan cannot change while in approval; one person cannot be the approver of two steps in the same chain.
- BR-PLN-h: An approved plan is locked; any change creates a new version that goes through approval again; reports always use the latest approved version with history kept (BR-PLN-3).
- BR-PLN-i: Amounts use the organization's default currency (FR-ADM-02; one currency in R1); dates and the period display in Gregorian, Hijri or both per General settings (FR-SCH-07); quarters are quarters of the planning period.
- BR-PLN-j: Every launch, submission, decision, return, approver change and version is written to the audit log (who, when, before → after).

## 5. Decisions and approvals
| Decision / approval | Who decides | When | On approve / reject |
|---|---|---|---|
| Launch the cycle | L&D Manager | After set-up | Forms sent; cycle Open |
| Accept / adjust / reject a need line | L&D Manager (Training Coordinator prepares) | Consolidation | Line in the plan draft / rejected with reason, head notified |
| Ask a department for changes | L&D Manager | Closed or consolidation | Form reopens as Returned with a short deadline |
| Department lines confirmation | Each Department Head | Approval step 1 | Next step when all confirmed / plan sent back with comment |
| Finance approval | Named Finance approver | Step 2 | Next step (minus rejected lines) / sent back to L&D |
| Final approval | Named management approver | Step 3 | Plan Approved vN, locked / sent back to L&D |
| Replace an absent approver | L&D Manager | Any time during approval | Step re-routed; both people notified; audited |

## 6. Exceptions
- **Late or missing department form**: reminders before the deadline; at the deadline the form locks and shows *Late*; the L&D Manager can (a) extend the deadline for everyone, (b) reopen one department with its own date, (c) enter needs on its behalf, or (d) consolidate without it (the department shows "no submission").
- **Department without a head** at launch: warning; HR assigns a head (the form appears for them) or the L&D Manager fills it on behalf.
- **Department head leaves or changes**: whoever deactivates the leaver hands over their departments (decision 12 Oct 2026); the new head inherits the form (draft or submitted) and any pending step-1 confirmation; both are notified.
- **Structure changes during the cycle**: a new department can be added to an open cycle's scope; a merged or removed department's needs move to the receiving department by the L&D Manager.
- **Budget exceeded**: highlighted per department; the L&D Manager trims, defers (moves to a later quarter or next cycle) or justifies (BR-PLN-f).
- **Rejected lines**: stay visible to the department with the reason; the department can raise them again as a training request (FR-PLN-01) or in the next cycle.
- **Approver absent**: reminders after a set number of days; no delegation in R1 (FR-WFL-02 R2), so the L&D Manager replaces the named approver for the current step.
- **Cycle extended / reopened**: deadline can change while Open; after Closed the L&D Manager can reopen all or some departments until the plan is submitted; after approval the cycle cannot reopen — use a revision.
- **Mid-year additions** (new project, approved training requests, new hires): the L&D Manager opens a **revision draft** of the approved plan, adds or changes lines, and resubmits; the same chain runs, with step 1 only for departments whose lines changed → Approved (vN+1). Sessions already generated stay; only new lines generate new drafts.
- **Approved plan, sessions not yet generated, line needs cancelling**: done in a revision.

## 7. Inputs and outputs
| Input (from where) | Output (to where) |
|---|---|
| Departments, branches, heads, employees (HR, FR-ADM-04/05) | Needs forms per department (Department Heads) |
| Courses with capacity and estimated cost (course library) | Consolidated lines with sessions and cost (L&D) |
| Period, deadline, scope, envelopes, chain (cycle set-up) | Budget check per department (L&D, Finance) |
| Currency, fiscal-year start, date display (General settings) | Approved, locked, versioned plan (approvers, reports, later Qiwa export) |
| Approved training requests (FR-PLN-01, optional) | Draft sessions + training calendar with planned participants (scheduling, M4) |

## 8. Screens this implies
| # | Screen | Role | Main actions |
|---|---|---|---|
| 1 | Organization → Departments (tree) and Branches | HR Manager | Add / edit, pick department head, see "no head" flags |
| 2 | Courses (table in card) + course dialog | L&D Manager, Training Coordinator | Add / edit / archive, search, estimated cost |
| 3 | Planning → Cycles (summary cards, status tabs) | L&D Manager (Training Coordinator view) | New cycle, open, archive |
| 4 | Cycle set-up (full page, 5 steps) | L&D Manager | Basics, scope, envelopes, approval chain, reminders, launch |
| 5 | Cycle progress (one row per department) | L&D Manager, Training Coordinator | Remind, extend, reopen, enter on behalf |
| 6 | My department → Training needs (full page) + add-need dialog | Department Head | Add / edit needs, save draft, submit, recall |
| 7 | Consolidation workspace (grouped table + budget panel) | L&D Manager, Training Coordinator | Merge, map, adjust, accept / reject, ask for changes, create plan |
| 8 | Plan approvals (Kawadir Requisitions layout: cards, «pending my approval» banner, tabs) + plan details dialog | Named approvers, Department Heads (own lines), L&D Manager | Approve, reject lines, send back, see approver order and history |
| 9 | Approved plan (by department / quarter, versions timeline) | L&D Manager; approvers and heads read-only (own scope) | Start revision, generate draft sessions |
| 10 | Generate draft sessions dialog → training calendar (drafts) | L&D Manager, Training Coordinator | Choose per quarter / month / branch, confirm |
| 11 | Planning settings (default chain, reminders) | L&D Manager | Edit defaults |

## 9. Notifications this implies (in-app always; e-mail too when e-mail sending is set up, `EP-EMAIL`; WhatsApp R2)
| Event | To |
|---|---|
| Cycle opened · reminder (7 and 2 days) · deadline passed · form returned for changes · deadline extended / reopened | Department Heads concerned |
| Department submitted · deadline passed with missing departments (summary) | L&D Manager, Training Coordinator |
| Plan waiting for your decision · reminder | Current step's approver(s) |
| Plan sent back · approved · line rejected | L&D Manager; Department Heads (own lines) |
| You replaced an approver / you were replaced · you became head of a department with an open form | People concerned |
| Draft sessions generated | Training Coordinator |

## 10. Security and privacy note (for the new data)
- **Department scope**: a Department Head reaches only their departments' forms, needs, named employees and costs — checked on the server and in the database, with cross-department tests.
- **Approval integrity**: a decision counts only from the current step's approver, on the exact version they saw; the plan is frozen in approval and locked after; approver changes and every decision are audited. A named approver who holds only Employee sees the plan only while named in its chain (read-only afterwards).
- **Personal data**: named employees appear only to their department head, L&D and the plan's approvers; an employee is not told about a need until a session invites them.

## 11. Open questions
| # | Question | Proposed answer | PO answer |
|---|---|---|---|
| 1 | One cycle per year, or several? | **One open cycle at a time**, period = the fiscal year by default (any dates allowed); mid-year needs through plan revisions | Approved (17 Oct 2026) |
| 2 | Budget envelope required or optional? | **Optional per department** (FR-PLN-02); without one, the budget check shows totals only | Approved (17 Oct 2026) |
| 3 | Over the envelope: warn or block? | **Warn + written justification** in R1; block / extra approval with budgets (FR-FIN-01, BR-FIN-2, R2) | Approved (17 Oct 2026) |
| 4 | Can employees self-nominate in R1? (FR-PLN-04 is S, R2) | **No**; employees use training requests (FR-PLN-01, R1), which the L&D Manager can add to a revision | Approved (17 Oct 2026) |
| 5 | Free-text needs that are not in the library? | **Allowed** (FR-PLN-03 "new topic"); L&D maps each to a library course (or creates one) before the plan is submitted | Approved (17 Oct 2026) |
| 6 | Who can edit after submit? | **Department Head can recall until the deadline**; after it, only the L&D Manager (return for changes or edit on behalf, audited) | Approved (17 Oct 2026) |
| 7 | Training Coordinator's power in consolidation | **Prepares** (merge, map, adjust); only the **L&D Manager** accepts / rejects lines and submits the plan | Approved (17 Oct 2026) |
| 8 | Should Department Heads see their envelope and costs while filling the form? | **Yes, their own only** — helps them prioritise | Approved (17 Oct 2026) |
| 9 | Sharing a session's cost between departments | **In proportion to the number of people** each department sends | Approved (17 Oct 2026) |
| 10 | Course cost for planning before the full cost model (FR-CAT-02, M4) | **Estimated cost per session + optional cost per participant** on the course; breakdown (instructor, venue, …) when FR-CAT-02 ships | Approved (17 Oct 2026) |
| 11 | Department step in the chain is "all heads in parallel" — FR-WFL-02 R1 has sequential steps only | **Accept** this one built-in parallel step (each head confirms their own lines); no general parallel steps until R2 — **scope question** | Approved (17 Oct 2026) |
| 12 | Approver absent with no delegation in R1 | **L&D Manager replaces** the current step's approver (audited); delegation stays R2 | Approved (17 Oct 2026) |
| 13 | Changes after lock (mid-year) | **New plan version** through the same chain, step 1 only for changed departments (BR-PLN-3) | Approved (17 Oct 2026) |
| 14 | Plan vs. actual (FR-PLN-10, R2) timing | **Keep R2** (needs actual costs, FR-FIN-04); R1 approved-plan page shows only "sessions generated / delivered" counts per line — **scope question** | Approved (17 Oct 2026) |
| 15 | Annual budgets (FR-FIN-01, R2) vs. envelopes | **R1 uses envelopes only**; when FIN-01 ships, envelopes are filled from department budgets | Approved (17 Oct 2026) |
| 16 | Currency | **The organization's default currency** (General settings); one currency in R1 (multi-currency FIN-12, R2) | Approved (17 Oct 2026) |
| 17 | Hijri / Gregorian period | Period chosen with the organization's date display (Gregorian, Hijri or both); quarters follow the chosen period | Approved (17 Oct 2026) |
| 18 | Hand-over timing (T-M3-08) | Build "generate draft sessions" **with scheduling at the start of M4**; M3 ends with the approved, locked plan | Approved (17 Oct 2026) |
