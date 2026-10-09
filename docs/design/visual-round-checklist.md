# Visual design round — checklist of where the look appears

| | |
|---|---|
| **Task** | T-M2-04c (look of Jadarat LMS; PO, 5 Oct 2026) |
| **Use** | Work through every row in the round so nothing keeps the old look. Each row: where it lives, what it takes from the theme today, what the round must do |
| **Prepared** | 9 Oct 2026, from an audit of `packages/ui`, `apps/suite`, `modules/tms` and `packages/platform-notifications` |
| **Related** | [`theming.md`](theming.md) (architecture, steps), [`visual-round-brief.md`](visual-round-brief.md) (material from the PO) |

**Audit result (9 Oct 2026):** every colour in `packages/ui`, `apps/suite` and `modules/tms` is a semantic role (no hex or `rgb()` values, one arbitrary layout value: the roles matrix column width). Radii, shadows, type sizes and font weights also come from tokens. The gaps are listed below as **Gap**: things that do not follow the theme yet. Material from the PO is needed for every row marked 🎨.

## 1. Foundations

| ✓ | Item | Where | Today | Round |
|---|---|---|---|---|
| ☐ | 🎨 Theme values (palette, roles light + dark, radii, shadows) | `packages/ui/src/theme/themes/jadarat-lms.ts` → generated `docs/design/tokens/themes/*.css` | Pending slot = current look | Fill from the material; tests must pass (contrast, tokens.json); ship it ([`theming.md`](theming.md) §4) |
| ☐ | 🎨 Fonts (Arabic, Latin, mono) | Theme `font`; loading: `apps/suite/src/app/[locale]/layout.tsx`, Storybook preview | **Gap:** no web font is loaded anywhere; users see system fonts | Self-host the licensed fonts (`next/font/local` or `@font-face` with woff2 files in the repo, ADR 0007); CSP `font-src 'self'` already fits; same files for Storybook, e-mail fallbacks and PDFs (M5). Check Arabic sizes (+10–15 %) and line heights (NFR-L10N-02) still read well with the new font |
| ☐ | 🎨 Logo and wordmark | `AppShell` `brand` prop (from `apps/suite/src/components/suite-shell.tsx`); auth page headers (§3); e-mail header (§6); `apps/suite/src/app/icon.svg` | Text «جدارات · التدريب»; generic icon | Logo files (SVG, light/dark); `alt` text AR/EN; tenant logo replaces it later (FR-ADM-07, suite-shell §3) |
| ☐ | 🎨 Density | `--size-control-*`, row padding `px-4 py-3`, header height 56 px, side navigation 264 px | Current values | Adjust to the LMS rhythm if it differs; keep 44 px touch targets |
| ☐ | Dark mode | `color.dark` of the theme; the app follows the system setting (no switch yet) | Current dark palette | Dark values for the new theme (derived if the LMS has none, PO decision 3 in the brief); theme switch in the user menu comes later (suite-shell §10) |
| ☐ | Focus ring | `--focus-ring` (2 px bg gap + 2 px `focus-ring`) | Checked on bg, surface, header, nav | Check visibility on any new coloured surface; add contract pairs if a new surface appears |

## 2. Suite shell

| ✓ | Item | Where | Today | Round |
|---|---|---|---|---|
| ☐ | 🎨 Header | `packages/ui/src/app-shell.tsx` | Shell roles `header`, `on-header`, `header-border` (= surface/text) | Set the shell roles in the theme |
| ☐ | Header content | `apps/suite/src/components/suite-shell.tsx` (organization name `text-text-muted`, profile link `text-text`) | **Gap:** uses surface text roles | Switch to `text-on-header-muted` / `text-on-header` (as in the Storybook preview kit) before a coloured header ships |
| ☐ | 🎨 Side navigation | `app-shell.tsx` (container: `nav`, `on-nav`, `nav-border`) | Shell roles (= surface/text) | Set the shell roles in the theme |
| ☐ | Navigation entries | `suite-shell.tsx` `NavLink`, «قريبًا» entries, «إدارة المنشأة» heading | **Gap:** own classes on surface roles (`bg-surface-selected`, `text-text`, `text-text-muted`) | Replace with `NavItem`, `NavUnavailable`, `navHeadingClasses` from `@jadarat/ui` (same look today) |
| ☐ | Avatar, language switch, sign-out | `suite-shell.tsx`, `language-toggle.tsx`, `auth/sign-out-button.tsx` | `bg-primary` avatar; secondary small buttons | Check on the new header colour |
| ☐ | Mobile drawer, bottom navigation, module switcher, inboxes, search | Not built yet (suite-shell §2–8) | — | Build on the shell roles when they come |

## 3. Pages outside the shell (sign-in and account pages)

| ✓ | Item | Where | Today | Round |
|---|---|---|---|---|
| ☐ | 🎨 Public page header (product name + language switch) | Repeated in 8 files: `apps/suite/src/app/[locale]/{page,sign-in,forgot-password,reset-password,select-organization,invite/accept}/page.tsx`, `components/invite/accept-invitation.tsx`, `components/password-reset/reset-password-view.tsx` | **Gap:** hand-written header (`border-b border-border bg-surface px-4 py-3`) | Extract one public layout component into `@jadarat/ui` (header roles + logo), then restyle once |
| ☐ | 🎨 Sign-in page | `sign-in/page.tsx`, `components/auth/sign-in-form.tsx` | Centred card | Follow screenshot 1 of the brief |
| ☐ | Password rules list | `components/auth/password-rules-list.tsx` | Status roles | Check icons/colours |

## 4. Patterns inside pages

| ✓ | Item | Where | Today | Round |
|---|---|---|---|---|
| ☐ | 🎨 Buttons | `packages/ui/src/button.tsx` (`primary`, `secondary`, `ghost`, `danger`; `buttonClasses` for links) | Roles + `rounded-md` | Shape, weight, padding from the material |
| ☐ | 🎨 Links | Everywhere (`<a>` in tables, breadcrumbs, profile, forms) | **Gap:** no link style — Tailwind's preflight makes links inherit the text colour with no underline, so links inside text are not distinguishable (SC 1.4.1) | Decide the link style (e.g. `primary-text` + underline) and add it to the base styles; add a contrast pair if it is a new role |
| ☐ | 🎨 Text fields | `packages/ui/src/text-field.tsx` | Roles | Border, radius, height, label style |
| ☐ | 🎨 Selects | `apps/suite/src/components/users/edit-user-form.tsx` `SelectField`; filters in `users/page.tsx` (`fieldClass`) | **Gap:** two copies in the app; native arrow | Move `SelectField` into `@jadarat/ui`; style the arrow if the LMS does |
| ☐ | 🎨 Radio buttons and check boxes | `invite-user-form.tsx`, `edit-roles-form.tsx`, `accept-invitation.tsx`, `reset-password-view.tsx` | **Gap:** browser default colour (blue), not the brand | `accent-color: var(--color-primary)` in the base styles (or custom controls); check contrast of the mark |
| ☐ | Role cards and role chips | `invite-user-form.tsx`, `edit-roles-form.tsx` | `border-primary bg-primary-subtle`; chips `bg-primary text-on-primary` | Extract into `@jadarat/ui` if reused; restyle |
| ☐ | 🎨 Tables | `users/page.tsx`, `components/users/invitations-table.tsx`, `suite/admin/roles/page.tsx` | Hand-written (`rounded-lg border bg-surface`, `thead bg-surface-sunken`, `px-4 py-3`) | Extract a table pattern into `@jadarat/ui`; row height 48/40 px (design principles P3); mobile card view later |
| ☐ | 🎨 Tabs | `users/page.tsx` (status tabs with counts) | Hand-written underline tabs (`border-primary`, `text-primary-text`) | Extract; follow the LMS tab style |
| ☐ | 🎨 Badges | `packages/ui/src/badge.tsx` (status, counts) | Roles, `rounded-full` | Shape and tone style from the material |
| ☐ | 🎨 Alerts and banners | `packages/ui/src/alert.tsx` (inline start border), expired-invitations banner | Roles | Style and icons (status needs an icon and a word) |
| ☐ | 🎨 Cards | `packages/ui/src/card.tsx` | `rounded-lg`, `shadow-1` | Radius, shadow, padding |
| ☐ | 🎨 Dialogs | Not built yet (confirmations are inline, e.g. revoke invitation) | — | Build with `surface-raised`, `elevation-3/4`, `overlay`, focus trap |
| ☐ | Empty states, pagination, breadcrumbs, page title | `users/page.tsx`, `users/[personId]/page.tsx`, … | Hand-written | Restyle; extract when reused |
| ☐ | Page width and spacing | `AppShell` main (`max-w-7xl`, `p-4 lg:p-8`) | 1280 px | Follow the LMS |

## 5. Organization branding (FR-ADM-07, later in M2 with `EP-M2-TEN`)

| ✓ | Item | Where | Round |
|---|---|---|---|
| ☐ | Derivation from the organization's colour | `deriveOrganizationBrand` (`@jadarat/ui/theme`) | Re-run its tests on the new theme; extend it if the LMS theme puts the brand colour on more roles (e.g. a brand-coloured navigation) |
| ☐ | Delivery in the app | Locale layout | Nonce'd `<style>` from the server (theming.md §3) |
| ☐ | Admin screen with live preview and adjustment notes | To design (screens first, PO approval) | Use the «Colours and contrast» story as a model |

## 6. E-mails

| ✓ | Item | Where | Today | Round |
|---|---|---|---|---|
| ☐ | 🎨 Layout colours | `packages/platform-notifications/src/layout.ts` `EMAIL_COLORS`, button text `#FFFFFF` | **Gap:** hand-copied token values (cannot import `@jadarat/ui`, ADR 0001) | Take them from the new theme (theming.md §6 point 1); keep 4.5 : 1 |
| ☐ | 🎨 Fonts and logo | `layout.ts` `FONTS`, organization header | IBM Plex names with Tahoma/Arial fallback | New font names with safe fallbacks (e-mail clients rarely load web fonts); logo image when branding exists |
| ☐ | Templates | `packages/platform-notifications/src/templates/` (invitation, password reset, password changed) | Same layout | Check rendering in AR/EN after the change |
| ☐ | Auth fallback templates | `supabase/templates/` (`recovery.html`, `password-changed.html`) | Fallback only | Align colours if they are still used |

## 7. Tooling and proof

| ✓ | Item | Where | Round |
|---|---|---|---|
| ☐ | Storybook preview | «Theme preview» stories, toolbar Brand | Publish the static build for the PO; keep the preview kit in sync with the users pages until their patterns move into `@jadarat/ui` |
| ☐ | Golden record and contrast report | `packages/ui/src/theme/__snapshots__/tokens.test.ts.snap`, `docs/design/tokens/contrast-report.md` | `vitest run -u` after shipping the theme; review the diff |
| ☐ | Story gate | `packages/ui/e2e/stories.spec.ts` (`BRAND_MATRIX` in `.storybook/brands.ts`) | Keep the LMS theme in the matrix; all stories pass axe in 4 modes |
| ☐ | App E2E | `apps/suite/e2e/*.spec.ts` (axe in AR/EN) | Must stay green; no screenshot baselines exist (fonts differ between machines) |
| ☐ | Design documents | `docs/design/README.md`, `design-principles.md` §2.5 (fonts), `suite-shell.md`, `tokens/tokens.json` | Update fonts, brand and any changed rules; mock-ups and prototype keep loading Google Fonts (documents only, never the product) |
