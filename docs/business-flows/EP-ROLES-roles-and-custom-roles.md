# Business flow — Roles and custom roles

| | |
|---|---|
| **Epic** | EP-ROLES (BACKLOG T-M2-39 … T-M2-41) |
| **Requirements** | FR-IAM-07 (roles, custom role builder — R1), FR-IAM-08 (data scope, R1 note), BR-IAM-4 (Organization Admin held alone) |
| **Status** | **Agreed (PO, 17 Oct 2026)** — all five open questions approved as proposed; PO chose **option B**: Kawadir's fixed standard roles **plus** our own custom role builder now. **Changed after agreement (PO, 17 Oct 2026):** the custom-role scope «their departments» becomes **«A department»** — the unit is picked when the role is given and covers everything under it ([`EP-ORG`](EP-ORG-organization-structure.md)). **Changed after agreement (PO, 17 Oct 2026):** **who can give what (PO, 17 Oct 2026, replacing "nobody gives a permission they do not hold"):** (1) the Organization Admin builds custom roles with any permission except the admin-only ones that are never allowed in custom roles, and gives any role; (2) the HR Manager gives every ordinary (non-privileged) role — L&D Manager, Training Coordinator, Department Head, Employee and ordinary custom roles; (3) privileged roles (a high-risk permission, or one that manages users or roles) are given only by the Organization Admin |
| **Copied from Kawadir** | One role per person; roles chosen when inviting and changed on Team members (edit-role dialog); Department Manager tied to departments; every role change logged automatically. Kawadir's unfinished "Roles & Permissions" screen (role name EN/AR, description, permissions grouped by module with checkboxes, System/Custom badge, permission count) is the layout for our custom role builder |
| **Background** | Mandatory-roles analysis: [`docs/delivery/roles/README.md`](../delivery/roles/README.md) |

## 1. Goal
Every organization starts with six ready standard roles that cover the whole training journey, and the Organization Admin can create extra roles of their own (e.g. "Finance approver", "Instructor") by naming them and ticking permissions — without asking ENTLAQA.

## 2. Actors and roles
| Actor | Role | What they do in this flow |
|---|---|---|
| Organization Admin | Standard (privileged) | Views the standard roles; creates, edits and deletes custom roles; gives roles to people (invite, Team members) |
| HR Manager | Standard (privileged) | Invites people and gives them **ordinary** roles (not privileged ones) |
| Everyone else | Their role | Sees the menu and pages their role allows |

## 3. The six standard roles (ready in every organization, cannot be deleted or changed)
| Role | Arabic | Sees / does |
|---|---|---|
| Organization Admin | مدير المنظمة (Kawadir) | Set-up only: settings, branding, team members, roles, security, integrations, subscription, audit. No training features; holds no other role |
| HR Manager | مدير الموارد البشرية | Employee records, branches, departments and department heads, compliance rules |
| L&D Manager | مدير التعلم والتطوير | Course library, planning cycles, plan and budget, approvals, sessions, notifications, training reports |
| Training Coordinator | منسق التدريب | Scheduling, logistics, enrollments, attendance; helps collect and consolidate needs |
| Department Head | رئيس القسم | Their departments only: proposes needs, approves plan lines and requests, sees the team |
| Employee | موظف | Own requests, training, certificates |

## 4. Step-by-step flow
1. **Organization Admin → Organization → Roles & permissions**: sees all roles as a list — name, *Standard* or *Custom* badge, number of permissions, number of people holding it.
2. **Create role** → name (English, Arabic), description, **start from** a standard role or blank → permissions grouped by module (Organization, People, Courses, Planning, Sessions, Enrollment, Attendance, Certificates, Reports, …) as checkboxes; sensitive permissions carry a **"High risk"** flag → **what data it sees**: own only · their team · a department (picked when the role is given, everything under it included) · whole organization → **Save**.
3. A role with any high-risk permission is **privileged**: only the Organization Admin can give it.
4. **Give a role**: when inviting (Team members → Invite) or later (Team members → ⋯ → **Edit role**), pick one role from a list containing the standard and custom roles; for a custom role limited to «A department», pick **one unit** from the structure tree (any level; it covers everything under it). A Department Head's units come from the structure (the units they head).
5. **Edit a custom role**: change name, permissions or data scope → everyone holding it gets the change at their next page load.
6. **Delete a custom role**: only when nobody holds it (otherwise the screen says how many people must be moved first).
7. Every create / edit / delete / assignment is written to the audit log (who, when, before → after).

## 5. Business rules
- **One role per person** in an organization (Kawadir). The Organization Admin role is always held alone.
- Standard roles cannot be edited or deleted (their permissions can be viewed).
- Who can give what (PO, 17 Oct 2026): the Organization Admin builds custom roles with any permission except the admin-only ones, and gives any role; the HR Manager gives every ordinary role (L&D Manager, Training Coordinator, Department Head, Employee, ordinary custom roles); only the Organization Admin gives privileged roles. (Replaces "nobody can give a permission they do not have", which blocked training permissions because the Organization Admin holds none.)
- The last Organization Admin cannot be removed or downgraded.
- A custom role's name must be unique in the organization (English and Arabic).
- Permission changes apply at once; access is always checked on the server and in the database (never only in the menu).

## 6. Exceptions
- Deleting a role still held → refused with the number of holders.
- Removing a permission that someone is using right now → their next action is refused with a clear message.
- An HR Manager tries to give a privileged role → not offered in the list; refused if forced.

## 7. Inputs and outputs
| Input | Output |
|---|---|
| Role name, permissions, data scope (Organization Admin) | A custom role available in invite and edit-role lists |
| Person + role (+ departments) | The person's menu, pages and data |

## 8. Screens
| # | Screen | Role |
|---|---|---|
| 1 | Organization → Roles & permissions (list) | Organization Admin (others with permission: view) |
| 2 | Create / edit role (permissions by module, data scope) | Organization Admin |
| 3 | Team members → Invite (role dropdown incl. custom roles, department picker) | Organization Admin, HR Manager |
| 4 | Team members → Edit role dialog | Organization Admin, HR Manager (ordinary roles) |

## 9. Open questions
| # | Question | Proposed answer | PO answer |
|---|---|---|---|
| 1 | One role per person (Kawadir) — today our system allows a main role plus extra roles | **One role per person**, like Kawadir; a person needing more gets a custom role combining the permissions | Approved (17 Oct 2026) |
| 2 | Instructor: a 7th standard role, or a custom role? | **Custom role template "Instructor"** (sessions assigned to them only) — keeps six standard roles | Approved (17 Oct 2026) |
| 3 | Line managers who are not department heads: how do they approve their team's requests? | **From the reporting line** in the person's record (anyone with direct reports sees and approves for them) — no extra role | Approved (17 Oct 2026) |
| 4 | Finance and management plan approvers | **A named person per approval step** (chosen in the planning cycle) — no role needed | Approved (17 Oct 2026) |
| 5 | Arabic labels | «مدير المنظمة» for Organization Admin, «موظف» for Employee | Approved (17 Oct 2026) |
