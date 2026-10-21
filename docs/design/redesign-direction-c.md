# Redesign direction C «Bold product» — package 1

Approved by the PO on **21 Oct 2026** (redesign package 1: shared building blocks + Area 1, sign-in and
account). This page is the short reference for engineers; the tokens are in
`packages/ui/src/theme/themes/jadarat.ts` (generated CSS: `tokens/themes/jadarat.css`, documented in
`tokens/tokens.json`), the components in `packages/ui/src` and their stories under
**Building blocks / Direction C** in Storybook.

## Tokens

| Token | Value | Notes |
|---|---|---|
| Brand gradient | `brand` → `brand-end` (135°), text `on-brand` | Jadarat slate `#2F4858` → steel `#33658A` (light), sky → light steel with very dark text (dark). An organization's colours replace it everywhere (FR-ADM-07, `deriveOrganizationBrand`): the menu, primary buttons, the current view card, the avatar, the sign-in panel, accents. |
| Side navigation | `nav` → `nav-end` (180°) | Light: the brand gradient with white entries (`on-nav`), hover white 10 % (`nav-item-hover`, as a solid), hairlines white 22 %. Dark: night 850 → 800 with light entries. |
| Current menu entry | `nav-item-current` (pill), `on-nav-item-current` | Light: a white pill with the brand colour as text. Dark: the brand gradient. |
| Top bar | `header` = `surface` | White, hairline under it. |
| Radius | `sm` 10 · `md` 14 · `lg` 18 · `xl` 24 · `2xl` 32 px · `full` | Buttons, filters, language switch and search are pills; inputs 14 px; cards, tables, dialogs 24 px; the sign-in panel 32 px. |
| Type | page title 38 px (`text-5xl`), sign-in title 44 px (`text-6xl`), section 22 px, body 15 px, small 13.5 px | Arabic sizes are slightly larger (tokens.css). Poppins / IBM Plex Sans Arabic. |
| Elevation | e1–e4 (e4 a little deeper: 0.14) + `shadow-brand-glow` | The glow sits under brand-gradient fills. |
| Motion | 160 ms (`--duration-base`) | Zero under `prefers-reduced-motion` (tokens.css); spinners and shimmers only turn with motion allowed. |

Every pair is checked in light and dark for the shipped theme and for hundreds of organization colours
(`tokens/contrast-report.md`, `organization-brand.test.ts`).

## Components

| Component | Use |
|---|---|
| `AppShell` + `NavGroup` / `NavItem` / `NavUnavailable` / `PoweredBy` | The gradient menu (264 px) with the organization chip (tile, name, the member's role — display only, no switcher yet), «Coming soon» entries as text with a pill; collapses to an 84 px rail with the toggle at the start of the top bar (remembered on the device); a modal drawer on phones. |
| Top bar | Ctrl K page search pill (`CommandPalette`, key hints in its footer), theme menu, the labelled language pill, notifications, the account menu (avatar on the gradient). |
| `PageHeader` | Breadcrumbs (optional), 38 px title, description, actions (secondary first, primary last). |
| `ViewCards` | The status views of a list with big numbers; each a link (own address), the current one on the gradient. Replace the summary cards + tabs on lists (Team members first; other lists adopt them in their packages). |
| `TabNav variant="underline"` | Views of one object (profile sections). |
| `ListSearch`, `FilterPill`, `FilterBar`, `SortHeader`, `Pagination`, `TableSkeleton`, `ListCards` / `ListCard` | Table patterns: search pill, filter pills (dashed until set, solid with × when set), sortable headers (`aria-sort`), the range with Previous / Next, loading rows (one status line for screen readers), one card per row on phones. |
| `TextField`, `FieldError`, `fieldInputClasses` | Label above with «(required)» in words, 48 px input, hint and **error under the field** (`aria-invalid`, described by it). |
| `FormSection`, `SaveBar` | Two-column settings sections; the floating save bar (unsaved → dark pill with Cancel / Save; saving → busy; at rest "Last changed by …"). |
| `SidePanel`, `Dialog` (`tone`) | See below. |
| `EmptyState` (`steps`), `Alert` (`action`), `Badge` (`dot`, `brand`), `Toaster` | First use with numbered steps / no results; banners info · success · warning (with an action) · danger; status pills; dark toasts. |
| `ShortcutsDialog` | The keyboard shortcuts list, opened from the account menu. |
| Auth frames (`apps/suite/src/components/auth/auth-shell.tsx`) | `split`: the form column + the inset brand panel (organization logo, picture and colours); `focus`: MFA, choose an organization, e-mailed link pages. |

## Side panel, dialog or full page

| Use | When |
|---|---|
| **Side panel** | Look at or edit **one item** with a few fields while the list stays in view (edit a unit, a role holder's details). Opens at the inline end, has its own Cancel / Save and the audit note in its footer. |
| **Dialog** | A **confirmation** or a **single question**. `tone="danger"` for what cannot be undone (revoke an invitation: red tile, red button); `tone="warning"` for a reversible consequence (deactivate a unit). Short forms of one or two fields may stay in a dialog. |
| **Full page** | Long forms, several steps, or anything people bookmark or share (invite user, import, role builder, settings). |

## Behaviour rules of package 1

- **Main buttons are never disabled because a field is empty**: they check when pressed and the
  message goes **on the field** (sign-in e-mail and password, MFA codes). Texts unchanged; the wrong
  password keeps the generic «The email or password is incorrect.» (no account enumeration).
  «Too many attempts» and other refusals (outage with a reference) stay **banners**. Buttons are disabled
  only while busy or when the service is not configured. Sign-up's «Create account» still waits for a
  valid code (unchanged in the package).
- **Keyboard shortcuts**: the list shows only shortcuts the product has (Ctrl K / ⌘K, Esc, ↑ ↓ and ↵
  in lists). No single-key shortcut was added (WCAG 2.1.4 would need an off switch; new feature).
- **Not built (new features, later)**: the organization switcher popover, the Home set-up checklist,
  bulk select, Undo in toasts.
