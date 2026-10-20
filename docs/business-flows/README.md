# Business flows

> **Rule (PO, 15 Oct 2026): business flow first, for every phase.** Before any technical work on a phase or epic, the Tech Lead writes the phase's business flow in plain language, discusses it with the PO and records the PO's agreement here. Only then are screens designed (one batch per feature area), and only after the screens are approved is it built. It is part of the Definition of Ready for an epic (Development Plan §4.1) and the first task of every epic in `docs/delivery/BACKLOG.md`.

## Index

| Flow | Epic | File | Status |
|---|---|---|---|
| Sign-in, invitations and Super Admin (Kawadir way) | EP-KAW-AUTH | [EP-KAW-AUTH-sign-in-invitations-super-admin.md](EP-KAW-AUTH-sign-in-invitations-super-admin.md) | **Agreed (PO, 16 Oct 2026)** |
| Roles and custom roles | EP-ROLES | [EP-ROLES-roles-and-custom-roles.md](EP-ROLES-roles-and-custom-roles.md) | **Agreed (PO, 17 Oct 2026)** |
| Organization structure (own levels) and department-limited roles | EP-PLN prerequisite | [EP-ORG-organization-structure.md](EP-ORG-organization-structure.md) | **Agreed (PO, 17 Oct 2026)** |
| Planning cycle (needs → consolidation → approval → hand-over) | EP-PLN | [EP-PLN-planning-cycle.md](EP-PLN-planning-cycle.md) | **Agreed (PO, 17 Oct 2026)** |
| Branding (the organization's look) | WP-ADM-02 | [EP-BRAND-branding.md](EP-BRAND-branding.md) | In discussion with the PO (20 Oct 2026) |
| E-mail sending (platform sender + Email integration) | EP-EMAIL | [EP-EMAIL-email-sending.md](EP-EMAIL-email-sending.md) | **Agreed (PO, 17 Oct 2026)** |

Status values: Draft · In discussion with the PO · **Agreed (PO, date)** · Changed after agreement (date, reason).

## How to write one

- One file per phase or epic: `docs/business-flows/<epic>-<short-name>.md` (e.g. `EP-PLN-planning-cycle.md`).
- Plain language for a non-technical reader; English with Arabic terms where useful; no implementation details (tables, APIs) — those come after agreement.
- Use the role names of BRD §4.2 (standard roles) and say when a step needs a custom role or a named person.
- Reference requirement IDs (`FR-…`) where a step implements one; flag anything that is not in the BRD as a scope question.
- Record the PO's agreement with the date in the header and in `docs/delivery/STATUS.md` (decisions log).

## Template

```markdown
# Business flow — <phase / epic name>

| | |
|---|---|
| **Epic** | EP-… |
| **Requirements** | FR-… |
| **Status** | Draft / In discussion / Agreed (PO, <date>) |

## 1. Goal
What the business gets when this flow works, in two or three sentences.

## 2. Actors and roles
| Actor | Role (standard / custom / named person) | What they do in this flow |

## 3. Step-by-step flow
1. <who> does <what> → <result>
2. …
(A simple diagram may be added; Mermaid diagrams must render on GitHub.)

## 4. Business rules
- BR-…: rule in plain language (e.g. "a need linked to an expiring certificate cannot be deleted without a reason").

## 5. Decisions and approvals
| Decision / approval | Who decides | When | What happens on approve / reject |

## 6. Exceptions
What happens when something goes wrong or is late (deadline missed, approver absent, budget exceeded, person leaves, …).

## 7. Inputs and outputs
| Input (from where) | Output (to where) |

## 8. Screens this implies
| # | Screen | Role | Main actions |

## 9. Open questions
| # | Question | Proposed answer | PO answer |
```
