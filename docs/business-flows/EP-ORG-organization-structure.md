# Business flow — Organization structure (levels, units, heads) and department-limited roles

| | |
|---|---|
| **Epic** | EP-PLN prerequisite (BACKLOG T-M3-02, T-M3-09) |
| **Requirements** | FR-ADM-05 (department tree), FR-IAM-08 (data scope, R1 note), FR-IAM-07 (custom roles) |
| **Status** | **Agreed (PO, 17 Oct 2026)** — "each tenant might have different hierarchy, so each tenant customizes their own one"; default **one level, Department** (not Kawadir's three levels); a department-limited role is given for one unit and covers everything under it |
| **Copied from Kawadir** | Kawadir's Departments page: tree view, «Add <next level>» in each row's menu, the HR Manager owns it, a unit with anything under it cannot be deleted, Arabic and English names. Kawadir's three fixed levels (Department → Division → Unit) are **not** copied: each organization names its own levels. Kawadir's Department Manager sees only the exact department picked; Jadarat TMS includes everything under it (PO, 17 Oct 2026) |

## 1. Goal
Every organization draws its own structure — its own number of levels with its own names — and can limit a person's role to one part of it (e.g. an L&D Manager for Sales only).

## 2. Actors and roles
| Actor | Role | What they do |
|---|---|---|
| HR Manager | Standard | Defines the levels; builds the tree; picks a head per unit |
| Organization Admin | Standard | Gives department-limited custom roles (and the HR Manager gives ordinary ones), picking the unit |
| Department Head | Standard | Sees the units they head and everything under them |
| Holder of a department-limited custom role | Custom | Sees the unit picked for them and everything under it |

## 3. Step-by-step flow
1. **HR Manager → Organization → Structure → Levels**: the levels in order, each with an English and an Arabic name, up to 10. A new organization starts with **one level: Department («إدارة»)**. Examples: Sector → General Department → Department → Section (قطاع → إدارة عامة → إدارة → قسم); Department → Team.
2. **HR Manager → Organization → Structure** (tree, Kawadir layout): «Add <first level>» at the top; each row's menu offers «Add <next level>» (e.g. «Add Section» under a Department); the last level has no children. Per unit: names (AR/EN), code, branch, **head** (any level).
3. **Give a department-limited role**: a custom role whose data scope is **«A department»** (role builder, `EP-ROLES`); when it is given (invite or Team members → Edit role), the giver picks **one unit** from the tree, at any level.
4. The person sees that unit **and everything under it**. A Department Head sees the units they head and everything under them.

## 4. Business rules
- BR-ORG-a: Levels are per organization; a unit always sits directly under a unit of the level above (no skipping).
- BR-ORG-b: A level can be renamed at any time; added at the bottom at any time; removed only when no unit uses it.
- BR-ORG-c: A unit with units under it, or people or a role scope pointing at it, cannot be deleted (the refusal says what is left); it can be deactivated.
- BR-ORG-d: One unit per role assignment (Kawadir); choosing a higher unit covers everything under it.
- BR-ORG-e: Moving a unit to another parent moves everything under it; access follows at once.
- BR-ORG-f: Every change to levels, units, heads and role units is written to the audit log.

## 5. Exceptions
- The picked unit is deactivated → the person keeps access to nothing under it until a new unit is picked; the giver is told.
- A level is removed while units use it → refused, with the number of units.

## 6. Screens
| # | Screen | Role |
|---|---|---|
| 1 | Structure → Levels (ordered list, names AR/EN) | HR Manager |
| 2 | Structure tree with «Add <next level>», head picker | HR Manager |
| 3 | Invite / Edit role: unit picker (tree) when the role's scope is «A department» | Organization Admin, HR Manager |
