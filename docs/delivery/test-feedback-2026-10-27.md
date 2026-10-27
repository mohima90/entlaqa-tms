# Role-play test feedback — 27 Oct 2026 (PO, production)

The PO ran the role-play script (`Jadarat-TMS-role-play-test-script.pdf` v2) with their team and stopped part-way: *«the
process is super complicated, I got lost between names — sometimes units, sometimes department — … Kawadir was super easy
and well organized but TMS is much more complicated»*. Nine comments (PDF «TMS Comments», 3 pages) plus that main point.

**Decision (PO, 27 Oct 2026): «Both»** — a **clean-up pass before any new feature** (one word per thing, simpler and
bigger screens, Kawadir's words where they exist; the PO approves the word list and the screens first) **and** the nine
points, in the same pass → **WP-FIX-02**.

| # | Area | Feedback | Finding | Handling | Status |
|---|---|---|---|---|---|
| 1 | Every page, every role | Branding (colours) shows on the Branding page, then «reverts to default» on Create role; another user (HR Manager) never sees it | **Bug.** `BrandStyle` injects the colours as an inline `<style>` with the request's CSP nonce; after a client-side navigation the new nonce no longer matches the document's policy (`style-src 'self' 'nonce-…'`), so the browser drops the brand layer. A full reload shows it again | Serve the colours as a stylesheet (`/api/brand/<id>.css?v=`), `'self'`-allowed, applied on every page for every role | 🔵 |
| 2 | Shell | «Adding a placeholder for the logo is the worst ever» (the dark box around the logo in the menu) | Design | Logo alone; the organization's name when there is no logo; no box | 🔵 |
| 3 | 2FA set-up | «Enhance QR of 2FA» | 184 px image from Auth's SVG | Larger and sharper (render from the secret at 240 px+) | 🔵 |
| 4 | General settings → Country | «I need search above the dropdown list» | Plain `<select>` | Searchable list (combobox) — same for other long lists | 🔵 |
| 5 | Dialogs / side panels | «Organize the placeholders and increase the size of the popups» | Narrow panels; placeholder texts uneven | Wider panels; one placeholder style; only needed fields visible, the rest behind «More» | 🔵 |
| 6 | Structure → Add Department | «I added a Sector, now adding a Department: the branch should automatically be the Sector's» | Branch starts empty | New unit takes its parent's branch by default (changeable) | 🔵 |
| 7 | Org Admin menu | «Why Grades in Org Admin» | PO decision 21/23 Oct 2026: grades managed by HR **and** the Organization Admin | PO to confirm: keep, or HR only | ⏳ PO |
| 8 | Add a course | «What are all those Delivery Types» | 9 types from BRD FR-CAT-01 | Proposal: 4 in the list (Classroom, Virtual, Blended, On-the-job); the rest only when a customer asks (BRD note) | ⏳ PO |
| 9 | Everywhere | «Lost between names — sometimes units, sometimes department» | «Unit» is the generic word (glossary #156) next to the organization's own level names (Sector / Department / Section); two words for one thing | **Word list** (16 words, Kawadir compared; artifact «Jadarat TMS Word List») **approved by the PO 27 Oct 2026**; applied to every screen EN + AR; «unit» → Department / the level's own name; menu «Structure» → «Departments»; «Email integration» → «Email settings» | 🔵 |
| 10 | Structure page | «Needs full renovation: Levels and Units are misleading; Levels first, as a sub-section, then build the hierarchy; Cost centre more user-friendly» (PO, 27 Oct, second message) | Design | In WP-FIX-02: the page starts with «Your levels» (name them once), then the tree built from them, cost centres as a simple list with one default per department; Mobbin references shown before the build | 🔵 |
| 11 | End-to-end «simple way» | «Test with Departments only: create a training cycle, department heads receive it and enter their needs, prepare the plan — which course each employee takes and when. Now, or complete the product first?» | Today the chain stops after the cycle is launched: the Department Head's needs page (WP-LD-01), consolidation (WP-LD-02), approval (WP-LD-03) and the plan (WP-LD-04) are not built | Answer: complete the chain first, in its simplest form (one level = Department), right after WP-FIX-02; then the PO tests the whole journey | ⏳ PO |
| 12 | Every «Add» / «Edit» form | «When I add anything I have a lot of fields, more than one field per row, the popups are too small. Kawadir is super organized: enter a department, then it asks for the next level if you wish; conditions are perfect there» | Kawadir's Add Department: 3 fields (English name, Arabic name, description), a small dialog, «Add Division» from the row afterwards. Ours: 6 fields with a required code | **UX standard (forms)** proposed to the PO: one form = one thing with the fewest fields (names only when creating; code automatic; the rest later or under «More»); one field per row; after saving, the next step is offered («Add a Section under it?»); full-height panel; rules shown only when they apply, in plain words. First on the Departments page, then every form | ⏳ PO |
| 13 | Testing | «Not satisfied with UX or features; I still need to test the full cycle, so I'll wait until Release 1 is complete» | — | Proposal: the PO approves the UX standard once plus one example screen; Claude applies it everywhere without per-screen approvals; a short weekly progress note with screenshots; the PO tests the full cycle when it works end to end | ⏳ PO |

Status: 🔵 in progress · ⏳ waiting on the PO · 🟢 done.
