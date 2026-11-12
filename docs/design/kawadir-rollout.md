# The Kawadir experience across the product — inventory and roll-out (WP-UX-01)

**Decision (PO, 12 Nov 2026):** Kawadir is the reference for the look and the user experience again, Mobbin where Kawadir has no matching screen; the «Cycle set-up pilot» mock-up was approved and the PO asked to «apply this UX across the whole product». The pattern is `forms-standard.md` rules 8–9. This page is the inventory of 12 Nov 2026 (BACKLOG T-M3-19) and the order of work. No behaviour or data changes unless a row says so.

## The pattern in one paragraph

Creating, adding or inviting is **one centred popup** (448 px for a simple thing, 672 px for a rich one): the few fields needed now, defaults already filled, a red asterisk on required fields, «Cancel» then the primary button at the end. Everything optional lives on the thing's **own settings page** (tabs at the side, one «Save»). Launching or publishing is a **row-menu action** with a small confirmation. Lists are a table in a card under a page header with the primary action at the end, tabs with counts, and an empty state that offers the first action. The name in the organization's default language is required; the other language is optional.

## What the inventory found (12 Nov 2026)

- Most create / edit forms are **side panels** (560 or 720 px): invite, edit person, change role, department, branch, cost centre, course, need, create organization, plan.
- The cycle set-up is a **6-step wizard**; its launch is a button on the last step, not a row action.
- The shared `Dialog` has no 672 px size; `TabNav` has no side-tab variant; there is no course settings page.
- «(required)» is printed in words on every form (changed to the red asterisk in WP-FIX-03).
- Both language names are still required on departments, branches, levels, roles, needs forms and courses; creating an organization requires the Arabic name and not the English one.
- Two places skip the shared dialog: the reset-authenticator `<dialog>` and a `window.confirm` in the need panel.
- List pages differ: only the needs page has stat cards; cycles, needs forms and roles are card grids; several empty states offer no first action.

## Order of work

| Wave | What | Screens (inventory #) | Size | PR |
|---|---|---|---|---|
| 0 | Red asterisk on required fields, at the shared field components | every form | S | WP-FIX-03 |
| 1 | **Foundations + the pilot**: `Dialog` 672 px, side tabs, the row «⋯» menu on the cycles list; **planning cycle** = one popup to create, launch from the row menu with a confirmation, an optional settings page; the «Approval chain» step leaves the cycle (EP-PLN §13) | 26, 27, 28 | L | WP-UX-01 a (T-M3-20) |
| 2 | **Organization set-up popups**: department, cost centre, level, grade, change role, reset authenticator (container swap); branch (names, code and time zone in the popup, the rest on the branch's settings); invite a member (e-mail, name, role — and its department — in the popup, the rest behind «More») | 1, 3, 8, 9, 12, 13, 14, 15 | S–M | WP-UX-01 b |
| 3 | **Learning & development popups**: course (titles, delivery type, hours in the popup; a new course settings page for the rest; archive from the row menu), a need (popup, no browser confirm), new needs form (672 px), new role (popup: start from + names, then the builder as the role's settings) | 17, 20, 24, 30 | M–L | WP-UX-01 c |
| 4 | **Platform (Super Admin)**: create organization, plan | 31, 32 | M | WP-UX-01 d |
| 5 | **Settings pages and lists**: edit a person as settings tabs on the profile; side tabs on My profile, the role page and Planning settings; list pages brought to one shape (header action, tabs with counts, table in a card, empty state with a first action) | 2, 18, 29, 35 + list pages | L | WP-UX-01 e |

In every wave: the default-language name rule on the forms touched, EN + AR, E2E and stories updated (the inventory lists the specs per screen), screenshots in both languages to the PO before the PR merges.

## What stays as it is (and why)

- **Needs-form builder** and its inspectors — a builder, not a form.
- **User import** and **department import** — file-driven, several real steps.
- **Organization, Branding, Security, E-mail settings** — long settings pages that already save with one bar; they only gain side tabs where they have tabs.
- **Sign-in, sign-up, invitation, password and two-step pages** — full-page flows copied from Kawadir on 16 Oct 2026.
- **Confirmation dialogs** — already small centred popups.
