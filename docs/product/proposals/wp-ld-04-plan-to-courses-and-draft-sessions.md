# WP-LD-04 — From the approved plan to courses and draft sessions (proposal for the PO)

*Business proposal before building. 15 Nov 2026. Covers PLN-09, CAT-01 (course from a plan line), SCH-01 (draft sessions core). BACKLOG T-M3-08.*

**The story we follow:** the approved 2027 plan has the line **«Advanced Excel», Q1, 47 people** (Finance 20, Sales 15, HR 12), at most 20 per session. The plan already worked out **3 sessions (16 / 16 / 15)** at SAR 9,000 each.

## 1. What the L&D Manager can do after this feature

Once the plan is approved, the L&D Manager opens it and gives each line a course: one click creates «Advanced Excel» in the course library, filled in from the line, or links a course that already exists. A second click creates the line's **3 draft sessions**, one each in January, February and March, with 16 / 16 / 15 seats and the named employees attached as *planned participants*. All drafts show on a new **Training calendar** (the year, month by month). The plan becomes the year's delivery to-do list. Days, times, venue and instructor come next (WP-LD-08).

## 2. The journey, step by step (simplest R1 version)

1. **Planning → cycle → Plan (approved)**: every line gets two new columns: **Course** («Create course» / «Link course», or the course name) and **Sessions** («0 of 3»).
2. **Create course**: a small popup filled from the line (title, delivery type, duration, min / max, cost). The code is given automatically. **Save**, or **Save and next line**.
3. Or **Link course**: search the library and pick one. A line whose need already named a course is linked from the start.
4. **Create draft sessions**: the popup shows *3 sessions, Q1* and suggests Jan / Feb / Mar, 16 / 16 / 15 seats and the branch. Change anything, then confirm.
5. **Delivery → Training calendar**: the drafts by month (year view + list), with filters for quarter, branch and course. A draft opens a popup: change its month, branch or seats, see its planned participants, or delete it.
6. The line reads «3 of 3».

**Deferred:**
- Days, times, venue or link, instructor, multi-day, repeats, time zone; statuses after Draft; week / day views, drag-and-drop, clash checks, minimum enrollment, actual cost → **WP-LD-08** (SCH-01 rest, SCH-02, 03, 05, 08, FIN-03).
- **Showing the calendar to employees and inviting or pre-enrolling the named people** → at scheduling, **WP-LD-08 + WP-LD-09**. This is the part of PLN-09 (Must) that is not done here.
- Course tags → WP-LD-05. Committed budget → WP-LD-14.

## 3. Rules

- **One course per line**, created from the line or linked. Lines may share a course (Excel Q1 and Q3). Lines that were left out get none. Editing the course later does not change the approved plan.
- **A draft session holds** its line, course, **month**, branch (optional), seats, planned participants and estimated cost. It has **no date, time, venue or instructor yet**.
- **Who sees drafts:** only the L&D Manager and the Training Coordinator. **Employees and Department Heads do not see them.** A draft promises nothing, so it can be deleted freely. Every change is audited.
- **Who acts:** the L&D Manager creates or links courses (also Coordinators who may add courses). Both the L&D Manager and the Coordinator create drafts (EP-PLN step 21).
- **Quarter → month → day:** the plan says the quarter, the draft the month, scheduling the day. Months follow the organization's date display (Gregorian / Hijri).
- **Plan revised after drafts exist:** drafts stay as they are. New lines can get drafts. If a line now needs fewer sessions, it shows «3 drafts, plan says 2» and L&D deletes one. Nothing is deleted automatically.

## 4. Screens implied

1. Approved plan: lines with **Course** and **Sessions** columns (existing page, extended).
2. «Create course» popup, filled from the line.
3. «Link course» popup with a search.
4. «Create draft sessions» popup: month, branch and seats per session.
5. **Training calendar**: year by month + list, with filters (the «coming soon» menu item goes live).
6. Draft session popup: edit or delete.
7. Course page: «From the plan: Advanced Excel, Q1».

## 5. Open questions

| # | Question | Choices | Recommendation |
|---|---|---|---|
| 1 | Which month do drafts get? | **A** spread over the quarter (Jan / Feb / Mar) · **B** all in the first month · **C** L&D picks each | **A**: fastest, and still changeable |
| 2 | A line's departments are in two branches (Riyadh 32, Jeddah 15) | **A** keep the plan's 3 sessions; branch pre-filled when there is only one, else L&D picks · **B** split by branch automatically (can mean more sessions and cost than approved) | **A**: matches the approved number and cost |
| 3 | Can a draft move outside its quarter? | **A** yes, marked «outside the planned quarter» · **B** only by revising the plan | **A**: an operational decision; the approved plan stays as it is |

---

## Appendix A — How others do it

- **Cornerstone (ILT):** an *event* (like our course) holds *sessions*. The **Scheduling Wizard** creates several sessions in one go from a date pattern, with a summary to check before saving. Sessions waiting for a room or instructor owner to confirm are *Tentative* and cannot be found by learners. *Interest tracking* lets interested people register early when a session is created (like our planned participants).
- **SAP SuccessFactors Learning:** you schedule a class (*scheduled offering*) **from the item** with Actions → *Schedule*, and the class summary is filled in from the item. SAP calls this the most efficient way. A class is Active or Inactive, and can be Cancelled or Closed.
- **Docebo:** ILT course → sessions → events (dates). Sessions are created in the course's Sessions tab, or imported in bulk from CSV. A session without an event shows no date to learners, the same split as our draft (month) → scheduled (dates).
- **TalentLMS:** an ILT unit inside a course holds sessions (name, colour on the calendar, start, duration, location, capacity). Learners see sessions on the calendar only once they are enrolled in the course.
- **Administrate** (training-operations tool, like Training Orchestra): its *Scheduler* is a planning workspace where sessions are **drafted** before they are booked into the live calendar. A schedule's status is *Draft* while it is a work in progress. This is the closest match to our proposal. Training Orchestra's own plan → session steps are not public; a review only mentions instructor-availability checks and recurring session templates.
- **Kawadir ATS:** has no matching feature. Only its look applies: small centred popups, tables in cards, side tabs.

**Sources**
- Cornerstone Scheduling Wizard: https://help.csod.com/help/csod_0/Content/ILT/ILT_Events/ILT_Scheduling_Wizard.htm
- Cornerstone Manage Events and Sessions: https://help.csod.com/help/csod_0/Content/ILT/ILT_Events/Manage_Events_and_Sessions_-_ILT_Overview.htm
- Cornerstone Interest Tracking: https://help.csod.com/help/csod_0/Content/ILT/Session_Roster/Interest_Tracking.htm
- Cornerstone ILT Preferences (tentative sessions): https://help.csod.com/help/csod_0/Content/Preferences/Learning_Preferences/ILT_Preferences_General.htm
- SAP Learning, classes from items: https://learning.sap.com/courses/sap-successfactors-learning-administration/introducing-classes-1
- SAP KBA, Schedule from item: https://userapps.support.sap.com/sap/support/knowledge/en/2538285
- SAP Managing Classes (statuses): https://learning.sap.com/courses/sap-successfactors-learning-project-team-orientation/managing-classes-1
- Docebo ILT sessions: https://help.docebo.com/hc/en-us/articles/360020124099 · community: https://community.docebo.com/product-q-a-7/ilt-courses-sessions-and-events-507
- TalentLMS ILT unit: https://help.talentlms.com/hc/en-us/articles/9651360955676-How-to-create-an-Instructor-Led-Training-ILT-unit · calendar: https://help.talentlms.com/hc/en-us/articles/15303959778460-How-to-work-with-the-TalentLMS-Calendar
- Administrate Scheduler (search result only; the host was blocked for a full read): https://support.getadministrate.com/hc/en-us/articles/14758156474513
- Training Orchestra (review mention only): https://gitnux.org/best/training-calendar-software/

## Appendix B — Requirements covered

- **FR-PLN-09** (M, R1): course from each approved line or link one; draft sessions per line, per quarter / month, per branch; training calendar of drafts. *Publishing to audiences and pre-enrolling or inviting named people → WP-LD-08 / WP-LD-09.*
- **FR-CAT-01** (M, R1): «Create course from plan line» (the code, title, delivery type, duration and min / max fields that exist today). *Tags → WP-LD-05.*
- **FR-SCH-01** (M, R1), core only: a session belongs to a course and has a delivery type and a code. *Days, times, venue, instructors, repeats and time zone → WP-LD-08.*
- Also uses FR-SCH-07 (Hijri / Gregorian display). Flow: EP-PLN §3 F step 21, §6 «mid-year additions», screens 9–10.

## Appendix C — Notes for the build (not for the PO)

- There is no sessions table yet. Only `modules/tms/src/services/session-draft.ts` (`buildSessionDraft`: a pure check that needs full start/end times) and `actions/sessions.ts` (always 403). A draft here has a **month**, not times, so that input changes.
- `tms.plan_lines` has `course_id` (FK to `tms.courses`), `quarter` 1–4, min/max per session, costs and duration, but **no branch**: the branch comes from the line's departments (`branchOf` in consolidation-rules). The session count comes from `sessionsFor` (consolidation-rules.ts, about line 452).
- Pre-fill gaps: a plan line has **one `title`** (no AR/EN), so it fills the title field of the language it was written in. Its `category` is a needs-form option value, not a `tms.course_categories` row: match it by name, or leave it empty.
- The approved state lives in `training_plan_versions.snapshot`. Linking a course to a line after approval writes `plan_lines.course_id` on a locked plan, so the plan's guard must allow it (or a separate link table).
