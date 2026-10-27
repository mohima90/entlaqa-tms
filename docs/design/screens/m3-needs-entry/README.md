# M3 — Department Head enters the team's training needs (design for approval)

> **Status:** **Approved by the PO on 27 Oct 2026** («approved»; Arabic design page «تصميم: إدخال احتياجات الإدارة», five screens) — **built in WP-LD-01** (T-M3-05, 27 Oct 2026; see «As built» below) · Roles: Department Head (filling), L&D Manager / Training Coordinator (progress)
> **Requirements:** FR-PLN-03, FR-MGR-05, FR-PLN-02 (progress), FR-PLN-06 (envelope) · **Business flow:** `docs/business-flows/EP-PLN-planning-cycle.md` §3 C6–9 as amended 27 Oct 2026 · **Proposal and decisions:** `docs/product/proposals/step-10-needs-entry.md`
> **Source:** Mobbin references listed below (links only; no images in the repository), applied in Direction C (`docs/design/redesign-direction-c.md`) with the forms standard (`docs/design/forms-standard.md`).

## The five screens

| # | Screen | Who | Pattern and its Mobbin reference |
|---|---|---|---|
| 1 | **Home: one clear task** — amber banner «Training needs 2027 are due in 12 days» + a task card (status pill, team size, deadline, needs so far, «Enter needs») | Department Head | Task card + banner: Kawadir (pending scorecards); «Things to do» lists with a date per item: [Remote](https://mobbin.com/screens/425014d9-aea0-4c7e-a217-d062da016d7f), [Gusto](https://mobbin.com/screens/1a6001a9-476b-4011-8e29-c2b84efbf2fb), [Aboard](https://mobbin.com/screens/cb9fecf9-7bac-4677-9510-0125393cce8a) |
| 2 | **Needs page** — deadline + instructions, big numbers (needs, seats named/unnamed, cost vs envelope with a meter, status), the needs table (topic, who, priority, quarter, cost, ⋯), «Add a need», «Submit» (disabled until one need) | Department Head | View cards (ours); line items with a running total: [Navan](https://mobbin.com/screens/97e613ac-a435-471d-92b4-b30132ecf71d), [Airwallex](https://mobbin.com/screens/423f0ec0-457f-4e61-8c89-18438f51b9f7); contributor page with period, window and requests: Cornerstone |
| 3 | **Add a need** side panel (560 px) — *Training topic* (required; or pick a course from the library), *How many people* (required), *Who* (optional people picker from the team, «Everyone (14)»), «More» (priority, reason, quarter, delivery type, estimated cost from the organization's form), «Save and add another» / «Save» | Department Head | [Sweatpals](https://mobbin.com/screens/74ab232f-2d17-4586-84fb-a77f277bc60e), [Airwallex add line item](https://mobbin.com/screens/19606310-d267-49ff-a60d-7526ae6828a9); seats or named learners: Oracle Learning |
| 4 | **Submit summary** dialog — needs, seats, of which named, cost / envelope with a pill (within / over by X, never a block); «Recall until {deadline}» after | Department Head | [Frame.io](https://mobbin.com/screens/745782a2-690d-4c1b-9c11-ec041d2864c8), [Emergent](https://mobbin.com/screens/dbaa002c-0bcb-493d-8588-77ac4bce8727); lock the set, recall until the window closes: Cornerstone / SAP |
| 5 | **Cycle progress** — view cards (in scope, submitted, in progress, not started, no head), table per department (head, status, needs, seats, cost / envelope, last activity, action), «Send reminder» per row and for the selection (bulk bar), «Extend» for all or one, «View» → read-only needs with «Return for changes», «Assign a head» | L&D Manager, Training Coordinator | [Fresha](https://mobbin.com/screens/77260bad-dd3d-4ba6-8db8-cd9fefa57982), [Wrike](https://mobbin.com/screens/c86b8eb7-d680-4505-a337-9c88d994254f); bulk action bar: [Hex](https://mobbin.com/screens/301409ca-c27b-4fa6-9b28-d1014d9babe0); remind in bulk: Skillup; daily nudge capped at 14 days: Kawadir |

## Rules the screens carry (from the 27 Oct decisions)

- **Seats are the unit** (Q1): *How many people* is required, names optional; choosing more names than the number raises the number; unnamed seats are shown as such and are named at scheduling.
- **The envelope is visible** (Q2): one line with a meter; over the envelope the meter turns amber and the text says by how much; submitting is never blocked.
- **Late stays with L&D** (Q3): after the deadline an unsubmitted department shows *Late · N days* on the progress page and a «Late» banner on its own page; **entry closes** (what was saved stays) until the L&D Manager extends — the whole cycle or one department — or proceeds; nothing auto-submits.
- States: *Not started · In progress · Submitted · Returned · Late*, plus the *No head* warning (assign a head from the row).
- Submit locks the set; **Recall** until the deadline; after it only L&D returns or edits on behalf (audited).
- Notifications: cycle opened, reminders (7 and 2 days), returned, extended, late summary to L&D; no e-mail per saved need. Full in-app delivery needs WP-PLT-01; until then e-mail + the Home card.
- Phones: tables become cards; the panel is full-screen.

## Effects elsewhere

- Needs form builder: the two fixed fields become *Training topic* and *How many people (+ who)*; other fields are shown under «appear under More».
- Consolidation (WP-LD-02): a plan line = topic + seats + cost; unnamed seats counted per line.
- Employee profile: «needs requested for you» appears read-only only after the plan is approved.

## Open points for the PO

None pending beyond the approval itself; changes are taken per screen number.

## As built (WP-LD-01, 27 Oct 2026)

- **Screen 1** — Home: a banner (due in N days / late / returned) with the one action, and the task card list under «Your team's training needs»; the menu entry «My team's needs» right after Home (`/suite/my-team/needs`). The team size is shown on the needs page, not on the card (one query less on Home).
- **Screen 2** — `/suite/my-team/needs/{cycle}/{department}`: banners, the four figures (needs; seats with named / to be named later; estimated cost with the envelope meter and line; deadline with the status pill), the needs table (topic with «From the course library», who, cost, last change, Edit / Remove), «Add a need», «Submit» (disabled with a hint until one need), «Recall» with «until {date}». The cycle form's other sections (answered once per department) under «About your department».
- **Screen 3** — the side panel: course from the library (search), topic, how many people, who (search, «Everyone (N)», the number follows the names), «More» (the form's other fields), estimated cost; «Save and add another».
- **Screen 4** — the submit summary (needs, seats, named, to be named later, cost, envelope with Within / Over by); the recall confirmation.
- **Screen 5** — the cycle's progress table gained «Needs · seats», «Extended to {date}» under the status and a «View» per department → `/suite/planning/cycles/{cycle}/departments/{department}`: the same page read-only with «Return for changes» (note required) and «Extend for this department». «Send reminder», the bulk bar and «Assign a head» from the row wait for WP-PLT-01 (in-app notifications) and are not built here.
- Not in this package (as proposed): automatic 7- and 2-day reminders and the late summary to L&D (WP-PLT-01); edit on behalf after the deadline (WP-LD-02 consolidation decides what it needs).

