# Step 10 — Department Head enters the team's training needs (business proposal)

| | |
|---|---|
| **Status** | Sent to the PO 27 Oct 2026 (Arabic page «اقتراح: إدخال احتياجات الإدارة»). **Q1 decided (PO, 27 Oct 2026): the number of people is required, names optional; the plan counts seats**; **Q2 decided (PO, 27 Oct 2026): the head sees the department's envelope** (one quiet line, warning when over, never a block). Q3 open |
| **Builds on** | `docs/business-flows/EP-PLN-planning-cycle.md` §3 C6–9, §9, §12 (agreed 17 Oct 2026); `docs/design/forms-standard.md`; product map step 10 |
| **Work package** | WP-LD-01 (PLN-03 filling, MGR-05, PLN-02 progress; T-M3-05) |
| **Research** | Kawadir ATS code (dashboard task card, banner, bell, cron nudges), Cornerstone Training Demand Forecasting, SAP SuccessFactors Training Planner, Skillup, Oracle Learning (research brief kept in the session; sources in the Arabic page's footer) |

## The idea in two lines

The L&D Manager launches a planning cycle with a deadline. Every Department Head finds one clear task on Home («Training needs 2027 · due 15 Nov»), opens it, adds needs (topic + who needs it), saves whenever, then presses **Submit**. The L&D Manager sees who submitted and who did not, and reminds the late ones. No course library needed first; no e-mail per saved need.

## What the Department Head sees

1. **Knows something is asked**: Home task card + banner + bell (e-mail when e-mail sending is set up). All open the same page.
2. **One page with everything**: deadline, instructions, the team from the structure, the department's envelope if any, the needs so far.
3. **Add a need with the fewest fields**: *Training topic* and *Who needs it* (names from the team or a number) on top; priority, reason, quarter, delivery type, cost behind «More». An existing course can be picked instead of a topic, never required. The organization's needs form (builder) still applies; topic + people are always present.
4. **Saves and comes back**: every need saved at once; from the first saved need the department is *In progress*.
5. **Submits with a summary**: needs, people, cost vs envelope (warning, not a block); the set locks; **Recall** until the deadline.
6. **Is reminded**: 7 and 2 days before; after the deadline a daily *Late* nudge that stops after 14 days; «Send reminder» per department and in bulk.

## What the L&D Manager sees

Progress table: one row per department — head, status (*Not started · In progress · Submitted · Returned · Late*; *No head* flagged), needs count, cost / envelope, actions (view, return for changes, send reminder, assign a head).

## Rules

- Submit locks the whole set; recall until the deadline only; after it the L&D Manager alone returns or edits on behalf (audited).
- The envelope warns, never blocks; one quiet line for the head.
- The head sees only their team and their department's needs; a department without a head goes to the nearest head above.
- Extension for everyone or reopening one department, as agreed in EP-PLN §6.
- Few notifications: open, reminders, return, extension, late summary to L&D. No e-mail per saved need.

## Taken from

| Product | What we copy |
|---|---|
| Kawadir | Task card + amber banner on Home, bell deep links, Save draft / Submit, daily nudge capped at 14 days, fewest fields |
| Cornerstone | One contributor page (period, window, requests); statuses Not started / In progress / Submitted; topic or external request without a catalog item |
| SAP SuccessFactors | An open planning period without repeated e-mails; extension by changing the period; the supervisor sees the team budget |
| Skillup / Oracle | «Remind the manager» per row and in bulk; seats or named learners |

## Deferred to R2

Co-planners (Cornerstone), budget lock by L&D after review (SAP), pre-fill from last year / expiring certificates, escalation to the head's manager.

## Decisions (27 Oct 2026)

**Q1 — «Who needs it»: the number of people is required, names optional; the plan counts seats (PO, «ممتاز»).** The PO's reasoning: turnover and new hires are not known at planning time, and nobody must train everyone right after approval, so the unit of the plan is the **seat**, as in Oracle Learning / Cornerstone demand forecasting. Names stay allowed because some needs are personal by nature (a safety licence before March) and forbidding them pushes the head to remember them outside the system. Consequences across features (the PO asked for this kind of cross-feature thinking every time):
- Needs form (default): fixed fields are *Training topic* and *How many people* (required) with *Who* (optional names from the team); priority, reason, quarter, delivery type, cost stay optional and removable in the builder. The builder (T-M3-10) stays; most organizations never touch it.
- Consolidation (WP-LD-02): a plan line = topic + **seats** + cost; named people are candidates for the seats, not the plan's unit; the L&D Manager sees how many seats are unnamed.
- Approval (WP-LD-03): Finance and management approve seats and money, not people.
- Scheduling / enrollment (M4): seats are filled or re-filled freely (a leaver's seat stays, a new hire takes one); candidates pre-fill the invitation list.
- Reports: planned seats vs. trained people becomes the natural «plan vs. actual» (R2).

## Questions to the PO (A = proposed)

1. ~~«Who needs it»~~ — decided above (number required, names optional, seats in the plan).
2. ~~Does the head see the envelope?~~ — decided: **yes** (one quiet line, warning when over, no block; the head trims before submitting, fewer return rounds for L&D).
3. Deadline passed and not submitted: **A** shown to L&D as *Late* with what was saved; L&D extends or proceeds · B auto-submitted as is.
