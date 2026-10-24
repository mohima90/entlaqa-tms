# Business flow — Suite mode and standalone mode

| | |
|---|---|
| **Epic** | WP-ADM-09 (Organization Admin) |
| **Requirements** | FR-STE-01 (suite or standalone per organization, one codebase), FR-STE-02 (one person record shared by all modules — built), FR-INT-01 (HR system sync — R2, PO 24 Oct 2026); BRD §3.4 |
| **Status** | **On hold (PO, 24 Oct 2026)** — drafted, not discussed; the PO moved to the next package |

## 1. Goal
Every organization is either **standalone** (it uses Jadarat TMS with another HR system, or none) or **in the Jadarat HR Suite** (its people come from Jadarat Core HR). The mode decides **where people and the organization structure are managed**. It is one setting, so an organization can later move to the suite without moving its data: the TMS already keeps one record per person (FR-STE-02).

Jadarat Core HR does not exist yet. So in release 1 **every organization is standalone**, and the suite mode is prepared but cannot be chosen yet.

## 2. Actors and roles
| Actor | Role | What they do in this flow |
|---|---|---|
| Super Admin | Platform Super Admin (ENTLAQA) | Sets the organization's mode, because it follows what the organization bought (like its plan) |
| Organization Admin | Standard role | Sees the mode and where their people are managed |
| HR Manager, Organization Admin | Standard roles | Manage people and the structure in the TMS while the organization is standalone |

## 3. Step-by-step flow

**A. Release 1 — standalone (every organization)**
1. A new organization is created as **standalone** (existing «Create organization» screen; nothing new to fill in).
2. The organization's people are added and kept up to date **in Jadarat TMS**: invitations, editing a person, deactivating, the Excel/CSV **bulk import** (all built), and the organization structure (built).
3. The Super Admin sees **Mode: Standalone** on the organization's page. The **Jadarat HR Suite** choice is shown but greyed out with «Available when Jadarat Core HR is available».
4. The Organization Admin sees one line on the **Subscription** page: «Jadarat TMS — your people and structure are managed here».

**B. Release 2 — automatic HR file import (decision 7, PO 24 Oct 2026)**
1. A standalone organization that uses another HR system can have its people imported **automatically** from a file the HR system sends every night. This needs its own business flow then.

**C. Later — moving an organization into the suite (when Jadarat Core HR ships)**
1. The Super Admin switches the organization to **Jadarat HR Suite**. The change is recorded in the platform's audit trail and the organization's own.
2. From then on, people, managers, departments and jobs come from Core HR. In the TMS these fields are **read-only** with «Managed in Jadarat Core HR». Adding people, the bulk import and editing the structure move to Core HR.
3. Everything the TMS owns stays where it is and keeps working: training records, plans, needs, courses, roles in the TMS.
4. Switching back to standalone makes the fields editable in the TMS again. Nothing is deleted either way.

## 4. Business rules
- BR-MODE-1: an organization has exactly one mode; the default is **standalone**.
- BR-MODE-2: only the Super Admin changes the mode; the Organization Admin sees it but cannot change it.
- BR-MODE-3: the mode decides **who edits** people and structure data; it never moves, copies or deletes data.
- BR-MODE-4: the suite mode cannot be chosen until Jadarat Core HR exists.

## 5. Decisions and approvals
| Decision / approval | Who decides | When | What happens |
|---|---|---|---|
| Automatic HR file import in R1 or R2 (security decision 7) | PO | **Answered 24 Oct 2026: release 2** | R1 keeps invitations + bulk import; the nightly file import gets its own flow in R2 |
| Mode of an organization | Super Admin | At creation (standalone) or later | Recorded in both audit trails |

## 6. Exceptions
- An organization asks for the suite before Core HR exists → it stays standalone; the choice is greyed out.
- When moving to the suite, people who exist in the TMS but not in Core HR → handled in Core HR's own flow when it is built (matching by e-mail or employee number); not part of release 1.

## 7. Inputs and outputs
| Input (from where) | Output (to where) |
|---|---|
| The Super Admin's choice (organization page) | The organization's mode, shown to the Super Admin and on the Subscription page |
| People and structure entered in the TMS (standalone) | The shared people directory used by every module |

## 8. Screens this implies
| # | Screen | Role | Main actions |
|---|---|---|---|
| 1 | Platform → Organizations → organization: a **Mode** row (Standalone; Suite greyed out) | Super Admin | See the mode |
| 2 | Subscription page: one line about the mode | Organization Admin | See where people are managed |

Both are one line on screens that already exist, so no separate design round is proposed (proposal — §9 Q2).

## 9. Open questions
| # | Question | Proposed answer | PO answer |
|---|---|---|---|
| Q1 | Show the greyed-out «Jadarat HR Suite» choice now, or hide it until Core HR exists? | **Show it greyed out** — it tells customers and ENTLAQA staff that the suite is coming | |
| Q2 | Build the two one-line additions without a separate Mobbin design round? | **Yes** — they follow the screens approved on 24 Oct 2026 | |
