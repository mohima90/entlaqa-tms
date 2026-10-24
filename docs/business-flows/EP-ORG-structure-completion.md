# Business flow — Structure completion (addendum to EP-ORG)

| | |
|---|---|
| **Epic** | WP-HR-01 (HR Manager) — addendum to [EP-ORG](EP-ORG-organization-structure.md) (agreed 17 Oct 2026, unchanged) |
| **Requirements** | FR-ADM-05 (cost centre, drag-and-drop order, CSV import, moving a unit), FR-ADM-04 (branch address, GPS, working week with half-days, working hours), BR-ADM-3; TM-0004 T-PEO-07 / SR-STE02-04 (a move shows the affected role assignments first) |
| **Status** | Draft — in discussion with the PO. **PO answers 24 Oct 2026:** the levels are locked once people are placed (rename only — EP-ORG BR-ORG-b changed); cost centres belong to the **person** (A rewritten, Q1 agreed) |
| **Reference** | Kawadir ATS has none of these (checked in its code, 24 Oct 2026), so this flow follows the BRD. The screens will come from Mobbin after this flow is agreed |

## 1. Goal
The HR Manager can keep the structure true to the organization:
- give units a **cost centre**, so training costs can later be reported by cost centre;
- **move** a unit to another place in the tree, seeing first what changes;
- put units **in the right order**;
- load a large structure **from a file** instead of typing it;
- give each branch its **address, location and working week**, so scheduling and check-in later know when and where people work.

## 2. Actors and roles
| Actor | Role | What they do in this flow |
|---|---|---|
| HR Manager | Standard role | Everything in this flow (as for the rest of the structure) |
| Organization Admin | Standard role | Sees the structure; gives department-limited roles (EP-ORG), whose reach a move can change |
| People with a department-limited role, Department Heads | Standard / custom | What they can see follows a move at once (EP-ORG BR-ORG-e) |

## 3. Step-by-step flow

**A. Cost centres (PO, 24 Oct 2026 — as SAP SuccessFactors, Cornerstone and Workday do)**
A cost centre is the finance department's accounting code that says **which budget pays** (for example «CC-4100 Riyadh Sales»). It is not a unit of the structure: one unit can be split across several cost centres, several units can share one, and a person can be paid from a cost centre other than their unit's.
1. **Structure → Cost centres** (new tab): the HR Manager keeps the list. Each has a code, a name in English and Arabic, and active / inactive.
2. Each **person** has one cost centre (on the person's form and in the people bulk import).
3. To save typing, a unit can have a **default cost centre**: a person placed in that unit gets it unless HR picks another one for them. Changing a unit's default later does not change people who already have a cost centre.
4. A cost centre in use cannot be deleted, only deactivated. A deactivated one stays on the people who have it and cannot be picked again.
5. Training costs are charged to the **participants' cost centres** when session costs are built (FR-FIN-03). Splitting one person across several cost centres, a cost-centre approver and budgets by cost centre come later (FR-FIN-01, R2; chargeback reports FR-FIN-07, R3).

**B. Moving a unit**
1. In the tree, a unit's menu has **Move to…**. The HR Manager picks the new parent from the tree.
2. Before anything changes, a **preview** says:
   - how many units move with it and how many people are placed in them;
   - which people with a department-limited role will **see more or less** after the move (for example, «Sara — L&D Manager for Sales — will no longer see Retail»);
   - which Department Heads above gain or lose these units;
   - whether the unit takes part in an **open planning cycle**.
3. **Move** applies it at once: everything under the unit moves with it, and what people can see follows immediately. **Cancel** changes nothing.
4. The move is recorded in the audit log with the old and new parent and the counts shown in the preview.

**C. Order**
1. In the tree, the HR Manager **drags** a unit up or down among the units under the same parent.
2. Each unit's menu also has **Move up** / **Move down**, for keyboard and screen-reader users and on phones.
3. The order is the same for everyone: in the tree, in unit pickers and in lists.

**D. Importing units from a file**
1. **Structure → Import** (same steps as the people bulk import):
   - download the template (Excel or CSV);
   - fill it in and upload it;
   - the file is **checked first** and every row's problem is listed;
   - **Import** applies the good rows.
2. Columns: level, code, name (EN), name (AR), parent code, branch code, default cost centre code, head (e-mail).
3. A row with a **new code** creates a unit. A row with an **existing code** updates its names, branch, default cost centre and head (proposal — §9 Q3). The parent is never changed by the import: moving stays on screen with its preview (B).
4. Rows are read top to bottom, so a parent can be in an earlier row of the same file.

**E. A branch's address, location and working week**
1. On a branch's form, three new parts:
   - **Address** in English and Arabic.
   - **Location**: latitude and longitude, typed in or taken from a pasted map link, with «Open in map» to check it (proposal — §9 Q4).
   - **Working week**: «Same as the organization» (from Settings → General) is on by default. Turning it off sets the branch's own days and hours, including a **half-day** (for example, Thursday 8:00–12:00).
2. Where the product needs a working week (scheduling warnings, reminders, quiet hours), it uses the **branch's** own week if it has one, else the **organization's** (BR-ADM-3; legal entities come in R2).

## 4. Business rules
- BR-ORG-h: a person has at most one cost centre; a unit has at most one default cost centre, used only when a person is placed in it without one.
- BR-ORG-i: a unit can only move under a unit of the **same level as its current parent**, or to the top if it is at the first level. Its level, and the levels of everything under it, never change (EP-ORG BR-ORG-a). Moving under itself or anything below it is refused.
- BR-ORG-j: a move is never applied without its preview; if something changed while the preview was open (another person edited the tree), the move is refused and the preview is shown again.
- BR-ORG-k: the import never deletes, deactivates or moves a unit.
- BR-ORG-l: a working-week day has at most one block of hours (start before end, no work across midnight); a branch needs at least one working day.
- BR-ORG-m: every change in this flow is recorded in the audit log (who, when, before, after).

## 5. Decisions and approvals
| Decision / approval | Who decides | When | What happens |
|---|---|---|---|
| Move a unit | HR Manager | After the preview | Applied at once, or nothing changes |
| Apply an import | HR Manager | After the check | Good rows applied; problem rows listed and skipped |

No approval by another person is needed (as for the rest of the structure — TM-0004 T-PEO-07, decided 17 Oct 2026).

## 6. Exceptions
- **The unit is in an open planning cycle.** The preview warns. After the move, the cycle's lines for that unit stay with it, and the approval steps still to come use the heads of its new place.
- **The file has a parent code that is not in the organization or in an earlier row.** That row is refused with «Parent not found»; rows under it are refused too.
- **The file names a head who is not in the organization.** That row is imported without a head and listed as a warning.
- **A branch's own week leaves no working day.** It cannot be saved.

## 7. Inputs and outputs
| Input (from where) | Output (to where) |
|---|---|
| Cost centres (people), units, moves, order (HR Manager) | The structure used by roles, planning and approvals; each participant's cost centre for session costs (FR-FIN-03) and later budgets and chargeback (FR-FIN-01, 07) |
| Unit file (HR Manager) | New and updated units; a results list |
| Branch address, location, working week | Scheduling warnings (FR-SCH), check-in near the branch (FR-ATT-03 uses the venue), reminders and quiet hours (FR-NTF-07) |

## 8. Screens this implies
| # | Screen | Role | Main actions |
|---|---|---|---|
| 1 | Structure → Cost centres (list + side panel) | HR Manager | Add, edit, deactivate |
| 2 | Person form + people import: Cost centre; unit form: Default cost centre | HR Manager | Pick, clear |
| 3 | Move to… (tree picker) + preview dialog | HR Manager | Pick a parent, read the preview, move or cancel |
| 4 | Structure tree: drag handle, Move up / down | HR Manager | Reorder |
| 5 | Structure → Import (template, upload, check, results) | HR Manager | Import units |
| 6 | Branch form: Address, Location, Working week | HR Manager | Fill, check location, set the week |

## 9. Open questions
| # | Question | Proposed answer | PO answer |
|---|---|---|---|
| Q1 | Cost centres as a **list the HR Manager keeps**? | **Yes** | **Agreed (24 Oct 2026), on the person** (unit default only to save typing) — §3 A |
| Q2 | A move keeps the unit at its level (only under a unit of the same level as its current parent)? | **Yes** — the levels themselves are locked once people are placed (PO, 24 Oct 2026) | |
| Q3 | The import also **updates** existing units found by code (names, branch, cost centre, head), but never moves them? | **Yes** | |
| Q4 | Location typed or pasted from a map link, with «Open in map», and **no map inside the page** for now? | **Yes** — a built-in map needs an outside map service; in-country hosting comes first | |
