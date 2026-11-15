# Proposal: from department needs to an approved training plan (WP-LD-02 + WP-LD-03)

*For the PO · 14 Nov 2026 · builds on EP-PLN §3 D, §13 (simpler approval, 12 Nov 2026) and feedback #4 (17 Oct 2026)*

## 1. What the L&D Manager can do after this

Today the L&D Manager sees each department's needs, seats, cost and envelope. Next they open **Plan** on the cycle and find the needs **already grouped into plan lines**. They merge similar lines, say how many people fit in a session and what a session costs, and the system works out **sessions and cost**. Each department shows **within** or **over** its envelope. One click sends the plan to the **HR Manager**, then to **Finance** if the organization uses that step. Once approved, the plan is **locked as version 1** and each Department Head sees their result. A **department-limited L&D Manager** («L&D – Sales») does the same for their own departments only.

## 2. The journey

**A. Consolidation (WP-LD-02)**
1. **Needs close** at the deadline (as today), or earlier with «Close needs now» once every department has submitted.
2. **L&D Manager → cycle → Plan.** Lines are pre-built: needs for the same course or the same topic (Arabic-aware) become one line, showing seats (and how many are named), departments and priority mix.
3. **Group by** Topic · Branch · Delivery type · Quarter (one switch).
4. **Tidy up:** tick lines → **Merge**, or move a need out of a line.
5. **Cost each line:** min / max people per session and cost per session (+ optional per person), pre-filled when the line uses a library course. The system proposes sessions (47 seats, max 20, min 8 → 3 sessions of 16/16/15) and cost. A shared line's cost is split by seats.
6. **Budget check:** per department, estimated cost vs. envelope (*within* / *over by X*) and the organization total. A department over its envelope needs a one-line justification.
7. **Decide:** lines start **in the plan**. L&D can lower a department's seats, move the quarter, or **leave a line out with a reason**. «Return for changes» works as today.

**B. Approval (WP-LD-03), as agreed 12 Nov 2026**
8. **Submit for approval:** a popup shows totals, over-budget departments and who approves, and warns if nobody holds the needed role. The plan is **frozen**.
9. **HR Manager approves:** every HR Manager gets a Home card. Any one of them opens the plan and presses **Approve** or **Send back with a comment**. The first decision counts.
10. **Finance confirms**, only where *Planning settings → «Finance confirms the plan»* is on (off by default). It is the same screen, for the new ready-made **Finance** role.
11. **Approved → version 1, locked.** Department Heads see their approved lines and left-out lines with reasons.
12. **Sent back:** the plan returns to L&D as a draft with the comment, then is resubmitted through the same steps.
13. **Revise plan:** opens version 2, approved through the same steps. Earlier versions are kept.

**Deferred:** line rejection by approvers, named approvers and longer chains (R2); budget scenarios (R3); plan vs. actual (R2); e-mail and bell notifications (WP-PLT-01; Home cards until then); courses and sessions from the plan (WP-LD-04).

## 3. Rules

- **Over the envelope warns, never blocks.** A department that is over needs a justification, and approvers see it highlighted. Under the envelope needs nothing.
- **Leaving a line out needs a reason**, and the Department Head sees it.
- **Frozen in approval, locked after.** Changes come only through a new version, and every version is kept.
- **Nobody approves a plan they submitted.** Another HR Manager must decide.
- **Department-limited L&D Manager:**
  - They see and edit only their departments' needs, lines, costs and envelopes.
  - On a line shared with other departments, they change only their own share.
  - Cycles, needs forms, planning settings and **submitting the plan** stay with the organization-wide L&D Manager (**one plan per organization**).
- **Audited:** every change to lines, every submission and decision (with its comment), the Finance switch and Finance role grants.

## 4. Screens implied

1. **Cycle page:** a **Plan** tab next to Progress; «Close needs now» in the row menu.
2. **Plan lines:** a table in a card, with summary cards (lines · seats · sessions · cost vs. budget) and the group-by switch.
3. **Line side panel:** needs, session size, cost, sessions, course link.
4. **Popups:** merge, leave out (reason), submit for approval.
5. **Budget panel:** each department vs. its envelope, with the justification field.
6. **Plan approvals page** (Kawadir Requisitions layout) and a **Home card** for the HR Manager and Finance.
7. **Plan review:** by department; Approve / Send back popup; steps and history.
8. **Approved plan:** locked, with versions and «Revise plan». Department Heads see their own part read-only.
9. **Planning settings:** the «Finance confirms the plan» switch.
10. **Team members / role builder:** the Finance role; the note on which permissions stay organization-wide.
11. **Department Head's needs page:** the result after approval.

## 5. Questions for the PO

| # | Question | Choices | Recommendation |
|---|---|---|---|
| 1 | When can consolidation start? | A: after the deadline, or early once all departments have submitted · B: any time | **A**: no lines built on needs still changing |
| 2 | How does a line enter the plan? | A: in by default; L&D leaves lines out · B: L&D accepts each line | **A**: far fewer clicks; the reason is still required |
| 3 | Plan time unit | A: quarter (what the needs form asks); month picked when scheduling · B: month now | **A**: the BRD says month, but heads plan in quarters |
| 4 | When does a head learn a line was left out? | A: when the plan is approved · B: immediately | **A**: one clear result; «Return for changes» covers discussion |
| 5 | Approver's «Send back» comment | A: one comment for the plan · B: one per line | **A**: per-line comments come with line rejection (R2) |

---

## Appendix A: What others do

- **SAP SuccessFactors Learning (Training Planner).**
  - A «training request period» is the budget cycle. The training manager spreads a budget across org units.
  - Requests go supervisor → training manager, who checks the cost against the available budget and approves or rejects. Estimated costs can be captured, and rejected items stay visible in their own section.
  - There is no single «approve the whole plan» step. Partners (Arago Training Manager) add needs collection, arbitration, budget scenarios and plan validation.
- **Cornerstone.**
  - «Training Demand Forecasting» collects and reviews needs and requests.
  - «Interest Tracking» shows how many people want an instructor-led event, to decide which sessions to offer. The ILT Scheduling Wizard then creates the sessions.
  - Approvals apply to requests and enrollments, not to a plan document.
- **Docebo and TalentLMS.**
  - Neither has native training planning or plan or budget approval. Docebo points customers to its partner Training Orchestra for instructor-led planning and budgets; its community uses Power Automate for approvals.
  - Training Orchestra runs needs analysis → consolidation → budget scenarios → plan.
  - TalentLMS has only blog guidance on budgets.
- **Oracle PeopleSoft** (reference): from demand («how many employees need training») it computes the cost, compares it with the proposed budget, then adjusts the budget or the head-count.
- **Kawadir ATS** has no planning module. We copy its **look**: centred small popups, tables in cards, settings with side tabs. We also copy its **Requisitions approval pattern**: summary cards, a «pending» banner, status tabs, a details dialog with approvers in order, and Approve / Reject with a comment. Approval goes to a role, and the first decision settles it.
- **Takeaway:** the big suites approve requests against a budget, or need partner add-ons for a whole-plan sign-off. Grouping needs into lines automatically, plus a one-click approval by role, is simpler than all of them.

**Sources** (the help.csod.com, blogs.sap.com and trainingorchestra.com pages could not be opened from this session because those sites are not on its network allowlist, so they are cited from search results):
- SAP Training Planner overview: https://blogs.sap.com/2017/07/25/comprehensive-overview-of-successfactors-lms-training-planner-part1/
- SAP Training Planner (YASH): https://www.yash.com/blog/successfactors-lms-training-planner
- SAP Knowledge Base Article 2355770: https://userapps.support.sap.com/sap/support/knowledge/en/2355770
- Arago Training Manager (SAP partner): https://www.sap.com/products/hcm/partners/arago-consulting-sas-arago-training-manager.html
- Cornerstone Training Demand Forecasting: https://help.csod.com/help/csod_0/Content/Catalog/Training_Forecast/Training_Demand_Forecasting.htm
- Cornerstone Interest Tracking: https://help.csod.com/help/csod_0/Content/ILT/Session_Roster/Interest_Tracking.htm
- Cornerstone ILT Scheduling Wizard: https://help.csod.com/help/csod_0/Content/ILT/ILT_Events/ILT_Scheduling_Wizard.htm
- Docebo on instructor-led training and Training Orchestra: https://www.docebo.com/learning-network/blog/five-paths-simplify-ilt/
- Docebo community (no manager approval): https://community.docebo.com/product-tips-tricks-3/how-do-you-capture-the-training-needs-of-your-learners-15564
- Training Orchestra needs analysis: https://trainingorchestra.com/training-needs-analysis/
- TalentLMS on training budgets: https://www.talentlms.com/blog/training-budget/
- Oracle PeopleSoft training demand: https://docs.oracle.com/cd/G20540_01/hcm92pbr51/eng/hcm/hhat/UnderstandingTrainingDemand-e32160.html

## Appendix B: Requirements covered

- **FR-PLN-05:** consolidation by topic or course, branch, delivery type and period.
- **FR-PLN-06:** sessions needed, estimated cost, check against envelopes.
- **FR-PLN-08:** approval by role, send back with a comment, locked and versioned.
- **FR-WFL-01** and **FR-WFL-02**, R1 part: plan approval by role in fixed sequential steps, with comments.
- **FR-IAM-08**, R1 note: unit-scoped planning permissions (feedback #4).
- **FR-IAM-07:** the ready-made Finance role.
- Uses FR-PLN-02 (envelopes) and FR-MGR-05 (the head sees the result).
- Business rules BR-PLN-2 and BR-PLN-3, and BR-PLN-b, d, f, g, h, j.
- Tasks **T-M3-06** and **T-M3-07**.
