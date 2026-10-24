# Business flow — Plan, limits and feature switches

| | |
|---|---|
| **Epic** | WP-ADM-06 (Organization Admin) |
| **Requirements** | FR-ADM-13, FR-SUB-01, FR-ADM-17 (organization plan, limits and status); BRD §14.1 editions |
| **Status** | **Agreed (PO, 24 Oct 2026)** — with the PO's answers in §9 (they change §3 A and C) |
| **Reference** | Kawadir ATS: plans ("tiers") set by the Super Admin, each organization on one plan with its own status and dates; a trial banner; when an organization is not active, its members see a notice and only the Organization Admin keeps full access |

## Changes after the PO's answers (24 Oct 2026)
- **A. Plans:** the Super Admin **creates** plans (name, limits: people and storage, and a tick-list of the product's features); there are no fixed plans. Editing a plan applies to every organization on it, except a limit special to one organization.
- **C. The Organization Admin's view:** **read-only** — plan name, status (days left in a trial), limits with usage, and the features the plan includes. No switching off; BR-PLAN-2/3/7 and the «switched off» page fall away. A feature not in the plan is simply not shown in menus and pages.

## Design (approved by the PO, 24 Oct 2026)
Screens as in the artifact «Plans and Limits Design». The Organization Admin's page is reached from the menu item **Subscription** (name kept).

**Suspension (PO, 24 Oct 2026):** the Organization Admin reaches the **Subscription** page only while suspended (not all settings); reactivation from that page comes with online payment later.

## Built (24 Oct 2026) — how the rules were applied
- **People** counted against the limit: everyone with an account (active or invited) and everyone with a pending, unexpired invitation, each person once. Deactivated people do not count; reactivating one takes a place again.
- **Storage** counted: every stored or uploading file by its real size (deleted, rejected and infected files and abandoned uploads do not count). 1 GB = 1024³ bytes.
- **Refused at the moment of the action** (the database decides, whoever acts): inviting, reactivating, a bulk-import row («people limit reached» on that row; the other rows go on), uploading a file.
- **Features without a permission of their own** (bulk import, own branding, own e-mail provider): hidden in menus and pages and refused when saved; outside the plan the organization's e-mails go through the platform sender with the Jadarat look, and the product shows the Jadarat look. Data saved before is kept.
- **Trial:** ends at the end of the chosen day (Riyadh time); a worker task checks every ten minutes and suspends the organization (audited). A new organization can start on a plan as a 30-day trial straight from «Create organization».
- **Suspended:** the Organization Admin signs in and sees only the plan page (status, plan, contact ENTLAQA) — nothing else of the organization opens; everyone else is told «Access paused» at sign-in. **Cancelled:** nobody signs in.
- **Audit:** every plan change and every change of an organization's plan or status is in the platform's trail; the organization's own trail records its plan and status changes and the end of its trial.

## 1. Goal
Every organization is on a **plan** (edition) that decides which parts of Jadarat TMS it has and how big it may grow. ENTLAQA's Super Admin sets the plan, its limits and the organization's status. The Organization Admin sees the plan and how much of each limit is used, and can **switch off** parts its people should not use (for example, hide Planning until the organization is ready). Nothing here takes or shows payments: it decides what is available, not what it costs.

## 2. Actors and roles
| Actor | Role | What they do in this flow |
|---|---|---|
| Super Admin | Platform Super Admin (ENTLAQA, not an organization role) | Defines the plans; puts each organization on a plan; changes a single organization's limits when agreed; sets the status (trial, active, suspended, cancelled) and the trial's end date |
| Organization Admin | Standard role | Sees the plan, the limits and the usage; switches parts of the product off or on again for the organization's people |
| Everyone else in the organization | Any role | Sees only the parts that are both in the plan and switched on; is told plainly when the organization is suspended or its trial ended |

## 3. Step-by-step flow

**A. Plans (once, then rarely)**
1. The Super Admin opens **Platform → Plans** and sees the four plans of BRD §14.1: **Starter, Professional, Enterprise, Government**. For each plan: which parts are included and the limits (number of people, storage).
2. The Super Admin can change a plan's limits or included parts. The change applies to every organization on that plan, except limits set specially for one organization (step B3).

**B. An organization's plan**
1. When the Super Admin creates an organization (existing screen), they also choose its **plan** and **status** — a new organization starts as **Trial** with an end date (proposed default: 30 days).
2. On **Platform → Organizations → [organization]**, the Super Admin can later change the plan, the status and the trial end date.
3. If ENTLAQA agrees a special arrangement, the Super Admin can set a **different limit for that organization only** (for example 300 people instead of the plan's 200). It is shown as "special for this organization".
4. Every change is recorded in the platform audit trail with who, when, before and after.

**C. The Organization Admin's view**
1. The Organization Admin opens **Settings → Plan and features** and sees: the plan's name, the status (and, during a trial, the days left), each limit with how much is used ("142 of 200 people"), and the list of parts of the product.
2. Each part shows whether the plan includes it. A part the plan includes can be **switched off** (and back on). A part the plan does not include is shown as "Not in your plan" with a line to contact ENTLAQA — it cannot be switched on here.
3. Switching a part off hides it from everyone in the organization — menus, home page tiles and direct links — until it is switched on again. Data already entered is kept, never deleted.
4. Every switch is recorded in the organization's audit trail.

**D. Limits in daily use**
1. When an action would go over a limit (for example inviting the 201st person on a 200-person plan), it is refused with a clear message saying which limit and who to contact; nothing else stops working.
2. When usage reaches 90% of a limit, the Organization Admin sees a notice on their home page.

**E. Status**
1. **Trial:** everything in the plan works; a banner tells the Organization Admin how many days are left.
2. **Active:** normal.
3. **Suspended** (or trial ended): people can still sign in, but see a page saying the organization's access is paused and to contact their administrator; the Organization Admin keeps access to settings so they can resolve it with ENTLAQA. Nothing is deleted. (Same approach as Kawadir.)
4. **Cancelled:** nobody in the organization can sign in; data is kept for the period agreed in the contract (deletion rules are a later, separate decision).

## 4. Business rules
- BR-PLAN-1: An organization is on exactly one plan at a time.
- BR-PLAN-2: A part is available to people only if the plan includes it **and** the Organization Admin has not switched it off.
- BR-PLAN-3: Switching a part off never deletes data; switching it back on shows everything as it was.
- BR-PLAN-4: The Organization Admin cannot switch on a part the plan does not include, nor change limits or status.
- BR-PLAN-5: A limit special to one organization wins over the plan's limit; removing it returns to the plan's limit.
- BR-PLAN-6: Going over a limit is refused at the moment of the action; already-existing people or data above a lowered limit are kept (nothing is removed), but no new ones can be added until usage is below the limit.
- BR-PLAN-7: Some parts cannot be switched off because the product needs them: Team members, Roles, Organization settings and My profile.

## 5. Decisions and approvals
| Decision | Who decides | When | Effect |
|---|---|---|---|
| Plan, status, trial end date, special limits | Super Admin | Any time | Applies at once; audited |
| Switch a part off or on | Organization Admin | Any time | Applies at once to everyone in the organization; audited |

## 6. Exceptions
- **Trial ends without a decision:** the organization becomes "trial ended" automatically and behaves like Suspended (E3) until the Super Admin sets it Active or extends the trial.
- **A plan is lowered and the organization is above the new limit:** nothing is removed; new additions are refused (BR-PLAN-6); the Organization Admin sees the over-limit notice.
- **A part is switched off while someone is using it:** their next click shows a short "this part is switched off by your administrator" page.

## 7. Inputs and outputs
| Input (from where) | Output (to where) |
|---|---|
| Plan definitions (Super Admin) | What each organization may use |
| Organization's plan, status, special limits (Super Admin) | Menus, home page, refusals at limits, status pages |
| Feature switches (Organization Admin) | Menus and pages shown to the organization's people |
| Usage counts (people, storage) | The Organization Admin's limits view and 90% notices |

## 8. Screens this implies
| # | Screen | Role | Main actions |
|---|---|---|---|
| 1 | Platform → Plans | Super Admin | See and edit the four plans: included parts, limits |
| 2 | Platform → Organizations → organization detail (plan section) | Super Admin | Change plan, status, trial end date, special limits |
| 3 | Settings → Plan and features | Organization Admin | See plan, status, limits with usage; switch parts off/on |
| 4 | "Access paused" page | Everyone (not the Organization Admin) | Read the notice; sign out |
| 5 | Trial / 90% banners and the "switched off" page | Organization Admin / everyone | Read; go to Plan and features |

## 9. Open questions
| # | Question | Proposed answer | PO answer |
|---|---|---|---|
| 1 | Which plans in R1? | The four of BRD §14.1 (Starter, Professional, Enterprise, Government) | **The Super Admin creates the plans and selects each plan's features** (no fixed four) |
| 2 | Which parts can be switched (today)? | Planning cycle, Needs forms, Course library, Branding images, Bulk import; later parts join the list as they are built | **No switches for the Organization Admin**: only the plan decides; the Org Admin sees plan and limits (FR-ADM-13 updated, BRD v3.4) |
| 3 | Which limits in R1? | Number of people and storage only (sessions, AI, WhatsApp and connectors join when those parts exist) |**Yes** |
| 4 | Trial length by default? | 30 days |**Yes** |
| 5 | When suspended, may the Organization Admin still work normally? | Yes, settings only (as Kawadir: they resolve it with ENTLAQA) |**Yes** |
