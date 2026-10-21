# Business flow — Audit log screen (who did what, and when)

| | |
|---|---|
| **Work package** | WP-ADM-03 (ROADMAP-by-role) · BACKLOG T-M2-50 (this flow), T-M2-30 (screen) |
| **Requirements** | FR-AUD-01 (R1 part: viewer, search, export, before/after, IP, device) · BR-IAM-3 (role changes audited with before/after) · Appendix B (Audit log: Organization Admin **V**) · NFR-OBS-01 (no personal data in logs) · boundaries: FR-AUD-02 data export (R2), FR-AUD-03 retention engine (R3), FR-AUD-04 data requests (R2) |
| **Status** | ****On hold (PO, 21 Oct 2026)** — draft kept** (21 Oct 2026) |
| **Copied from Kawadir** | Kawadir ATS has **one audit log screen, in the Super Admin console** (`/audit-logs`): the latest 500 events of **all** organizations; three cards (total, today, this week); a search box and two filters (action, item type); a detail window with time, action, item, IP address, previous and new values (raw data) and extra details; **Export CSV** of the filtered list (time, action, item type, item id, IP). It records only five event families (offers, candidates rejected/hired, roles given/removed, jobs published/closed, organization settings — *which* settings changed, never their values) and a failed record never stops the change. Organization Admins and HR Managers may read their own organization's records in the database but have **no screen**. **We copy:** the list with cards, search, filters, the detail window and the CSV export. **We do not copy:** the Super Admin reading every organization's log (tenant isolation), the 500-row cap, raw data in the detail window, a change going through without its record, and the narrow event list (FR-AUD-01 asks for every change) |

## 1. Goal
The Organization Admin (and anyone given the audit permission) can answer «who did what, when, from where» for their own organization: search and filter the record, open one event to see what changed before → after, and export the result as a CSV file for an auditor. Nobody in the organization — and no ENTLAQA staff member through the product — can change or delete a record.

## 2. Actors and roles
| Actor | Role | What they do in this flow |
|---|---|---|
| Organization's IT person | Organization Admin (standard) | Opens **Settings → Audit log**, searches, filters, opens events, exports CSV |
| Auditor / Compliance Officer | Custom role holding «View the audit log» (templates *Auditor*, *Compliance Officer*; privileged — only the Organization Admin gives it; whole-organization scope only) | Same as the Organization Admin, read-only |
| Everyone in the organization | Any | Their actions are recorded; they do not see the log |
| The product itself | System (background tasks) | Its automatic actions (imports, e-mail sending, clean-ups) are recorded as «System» |

## 3. Step-by-step flow
1. **Organization Admin → Settings → Audit log** (replaces today's «Coming soon» entry) → the list opens on the **last 7 days**, newest first, with three cards: events today, this week, in the chosen period.
2. Each row says, in plain words and in the reader's language, **when** (the organization's time zone and date style, Gregorian/Hijri as set in General), **who** (name; «System» for automatic tasks), **what** («changed the role of Omar Ali from Employee to HR Manager»), the **item** concerned, and **from where** (IP address and device, e.g. «Chrome on Windows»).
3. **Filters:** date range (required), who did it (a person), the person or item affected, area (Sign-in & security · Team members · Roles · Organization structure · Settings · Planning · Courses · Imports & files) and event type within the area, plus a search box over the event's text.
4. **Open an event** → detail panel: the full sentence, a **before → after** table of the changed fields (hidden values shown as «changed — value hidden»), IP, device, and a reference number to quote to ENTLAQA support.
5. **Export CSV** → the events matching the current filters, one row each (time, who, what, item, before → after, IP, device), readable in Excel in Arabic and English. Small results download at once; large ones are prepared in the background and offered on the page for 24 hours. The export itself is recorded in the log.
6. From a **person's profile**, «Recent activity» (exists today for audit readers) gets **See all** → the audit log filtered on that person.

## 4. Business rules
- BR-AUD-a **Who sees it:** the Organization Admin and custom roles holding «View the audit log» (privileged; whole-organization scope only, FR-IAM-08 note). Nobody else — not managers, not Department Heads (no employee tracking). Others get «page not found».
- BR-AUD-b **Own organization only:** a reader sees only their organization's events; a person in two organizations has their actions in each organization's log separately. Checked by the database and by an automated cross-organization test.
- BR-AUD-c **Cannot be changed:** no one edits or deletes an event — not the Organization Admin, not ENTLAQA staff through the product (the database refuses it today). A mistake is corrected by a new event, never by editing the old one.
- BR-AUD-d **No change without its record:** if the event cannot be written, the change itself is refused (today's behaviour; Kawadir does the opposite).
- BR-AUD-e **What is recorded** (already, from the code today): sign-in and sign-out, sessions ended, password changes and resets, authenticator set-up / removal / reset, sign-in unlocks; invitations (created, resent, cancelled, accepted, code viewed — never the code); member edits, role changes, deactivation / reactivation; bulk imports (each step); roles and custom roles; organization structure (levels, units, branches); General, Branding, Security and Email integration settings; planning settings, plan cycles and needs forms; the course library; downloads of audited files. **To add in this WP:** IP and device on every event; before → after values for member edits (today only the names of the changed fields); the audit-log export itself.
- BR-AUD-f **Before → after and hiding:** the log never shows a value its reader could not see elsewhere in the product. Shown: settings, roles, structure, courses, plans, job data (job title, unit, branch, manager, employee number). **Hidden** («changed — value hidden»): HR-only fields (gender, date of birth, employment category, grade — WP-ADM-04). **Never recorded at all:** passwords, codes, keys, tokens, file contents (files by name only).
- BR-AUD-g **IP and device:** recorded from now on (older events show «—»); the IP comes only from our own front server (a visitor cannot fake it); the device is the browser and system family only — no device fingerprint.
- BR-AUD-h **Search limits:** one search covers at most 93 days (wider → «narrow the dates»); at most 5 exports per hour per organization; export cells are made safe for Excel (no formulas run).
- BR-AUD-i **Failed sign-ins** happen before the product knows the organization: they stay in ENTLAQA's security monitoring, not in the organization's log (as today). Lockouts and unlocks of a member are in the log.
- BR-AUD-j **Retention:** events are kept for the retention period (proposed 7 years, legal validation — security decision 12); only a reviewed platform process may ever remove them (FR-AUD-03, R3). An organization that leaves gets its audit export first.

## 5. Decisions and approvals
| Decision / approval | Who decides | When | What happens |
|---|---|---|---|
| Give someone «View the audit log» | Organization Admin (privileged permission) | Any time | They see the screen at their next page |
| Export | The reader | Any time | File produced; the export is itself an event |
| Retention period | PO with legal counsel (decision 12) | Before the first customer | Written into the retention rules |

## 6. Exceptions
- **Date range too wide** or no date range → asked to narrow it.
- **Too many exports** in an hour → told when to try again.
- **Large export** → prepared in the background; the page says when it is ready; the file expires after 24 hours.
- **Event of a removed person** → the name stays as recorded; later, an erasure request (FR-AUD-04, R2) shows «Former member».
- **Unknown event type** (new feature, label not yet written) → shown with its technical code, never hidden.
- **Actions by ENTLAQA** (e.g. the Super Admin created the organization) → shown as «ENTLAQA (platform)».

## 7. Inputs and outputs
| Input (from where) | Output (to where) |
|---|---|
| Every audited action in the product (actions, background tasks) | Events in the organization's audit log |
| Filters chosen by the reader | List, detail panel, CSV file (24 h) |
| — | Later: «Last audit events» on the admin home (WP-ADM-12, same rules) |

## 8. Screens this implies
| # | Screen | Role | Main actions |
|---|---|---|---|
| 1 | Settings → Audit log (cards, filters, list) | Organization Admin, audit readers | Filter, search, open, export |
| 2 | Event detail panel | Same | Read before → after, IP, device, reference |
| 3 | Export (dialog + «ready to download» state) | Same | Export CSV, download within 24 h |
| 4 | Person profile → Recent activity → **See all** | Same | Opens the log filtered on the person |

## 9. Open questions
| # | Question | Proposed answer | PO answer |
|---|---|---|---|
| 1 | Who sees the audit log: Organization Admin + custom roles with «View the audit log» only (BRD Appendix B), or also the **HR Manager** (Kawadir lets HR read it in the database)? | **Organization Admin + custom roles only** (BRD) | |
| 2 | Does ENTLAQA's Super Admin get a screen to read organizations' logs, as in Kawadir? | **No** in R1 (tenant isolation); support access later through a time-limited support grant the organization approves | |
| 3 | Show IP address and device to audit readers (FR-AUD-01)? | **Yes**, audit readers only, browser/system family only | |
| 4 | Hiding rule BR-AUD-f: show values the reader can see elsewhere; hide HR-only fields; never record secrets? | **Yes** | |
| 5 | Export format | **CSV only** in R1 (Kawadir); Excel/JSON come with data export FR-AUD-02 (R2) | |
| 6 | Retention of events (and of IP/device) | **7 years** for both, pending legal (security decision 12); nobody can shorten it in R1 | |
| 7 | Default view and search window | **Last 7 days** by default, **93 days** maximum per search | |
| 8 | Tamper-evident seal (each event chained to the previous so even a database operator's edit is detectable, TM-0005 F-AUD-02) — in this WP? | **No**, later (before the first government customer); R1 keeps the database's append-only guard | |
