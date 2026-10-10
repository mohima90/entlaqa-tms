# Contrast report — Jadarat design tokens

> **Generated** by `packages/ui/src/theme/theme.test.ts` from the theme contract (`packages/ui/src/theme/contract.ts`) and the shipped theme «jadarat». Do not edit by hand; after a theme change run `pnpm --filter @jadarat/ui exec vitest run -u`. CI fails when this file is out of date or when any pair fails.

WCAG 2.x relative-luminance formula (`(L1 + 0.05) / (L2 + 0.05)`); ratios shown to 2 decimals, pass/fail decided on the exact ratio. Every text/background pair and every UI-component/background pair the components use is checked in **light** and **dark**.

| Requirement | Threshold | WCAG 2.2 SC |
|---|---|---|
| Normal text (all body, label, badge text) | ≥ 4.5 : 1 | 1.4.3 Contrast (Minimum) |
| Large text (≥ 24 px regular / ≥ 18.66 px bold) | ≥ 3 : 1 — we still hold all text to 4.5 : 1 | 1.4.3 |
| UI components and graphical objects (input borders, icons, focus ring) | ≥ 3 : 1 | 1.4.11 Non-text Contrast; 2.4.13 is AAA and not targeted |

**Result for «jadarat»: 138 of 138 pairs pass (0 failures).** Tightest pair relative to its threshold: `text-subtle` on `surface-hover` (light) = **4.59 : 1** (needs 4.5).

The same 69 pairs per mode are also checked automatically for:

- every theme in `packages/ui/src/theme/themes/` (including the pending «Jadarat LMS» slot);
- organization brand colours (FR-ADM-07): `deriveOrganizationBrand` derives the brand roles so that they always pass, re-checks all pairs and refuses to return a failing brand; its tests run it on hundreds of colours (white, black, pure yellow, mid greys, a colour grid and random colours).

Notes

- `text-disabled` is intentionally excluded (disabled controls are exempt under SC 1.4.3); disabled states must also be conveyed by the `disabled` attribute / `aria-disabled`.
- `border` (decorative divider) is intentionally below 3 : 1; it must never be the only boundary of an interactive control — inputs use `border-strong`.
- The focus ring is drawn as a 2 px ring separated from the component by a 2 px `--color-bg` gap (`--focus-ring`), so the ring is measured against `bg`/`surface` (and the header and navigation colours), not against the button fill.
- Accent and suite-shell roles (`accent*`, `header*`, `nav*`) are slots for the visual design round (T-M2-04c); in «jadarat» they are aliases of the primary and surface roles.

## Light theme

| Foreground token | Background token | FG | BG | Ratio | Needs | Use | Pass |
|---|---|---|---|---:|---:|---|---|
| `text` | `bg` | `#121A1C` | `#F2F5F5` | 16.09 | 4.5 | Normal text | ✅ |
| `text-muted` | `bg` | `#465357` | `#F2F5F5` | 7.27 | 4.5 | Normal text | ✅ |
| `text-subtle` | `bg` | `#5B6A6E` | `#F2F5F5` | 5.13 | 4.5 | Normal text | ✅ |
| `primary-text` | `bg` | `#0C534D` | `#F2F5F5` | 8.12 | 4.5 | Normal text | ✅ |
| `text` | `surface` | `#121A1C` | `#FFFFFF` | 17.64 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface` | `#465357` | `#FFFFFF` | 7.97 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface` | `#5B6A6E` | `#FFFFFF` | 5.63 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface` | `#0C534D` | `#FFFFFF` | 8.90 | 4.5 | Normal text | ✅ |
| `text` | `surface-sunken` | `#121A1C` | `#F8FAFA` | 16.84 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface-sunken` | `#465357` | `#F8FAFA` | 7.61 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface-sunken` | `#5B6A6E` | `#F8FAFA` | 5.37 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface-sunken` | `#0C534D` | `#F8FAFA` | 8.49 | 4.5 | Normal text | ✅ |
| `text` | `surface-hover` | `#121A1C` | `#E3E9EA` | 14.38 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface-hover` | `#465357` | `#E3E9EA` | 6.49 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface-hover` | `#5B6A6E` | `#E3E9EA` | 4.59 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface-hover` | `#0C534D` | `#E3E9EA` | 7.25 | 4.5 | Normal text | ✅ |
| `text` | `surface-selected` | `#121A1C` | `#E7F3F1` | 15.53 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface-selected` | `#465357` | `#E7F3F1` | 7.02 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface-selected` | `#5B6A6E` | `#E7F3F1` | 4.95 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface-selected` | `#0C534D` | `#E7F3F1` | 7.83 | 4.5 | Normal text | ✅ |
| `success` | `bg` | `#1D7A43` | `#F2F5F5` | 4.89 | 4.5 | Status text on page/card | ✅ |
| `warning` | `bg` | `#955800` | `#F2F5F5` | 5.21 | 4.5 | Status text on page/card | ✅ |
| `danger` | `bg` | `#B42318` | `#F2F5F5` | 6.00 | 4.5 | Status text on page/card | ✅ |
| `info` | `bg` | `#1F5DAA` | `#F2F5F5` | 5.98 | 4.5 | Status text on page/card | ✅ |
| `success` | `surface` | `#1D7A43` | `#FFFFFF` | 5.36 | 4.5 | Status text on page/card | ✅ |
| `warning` | `surface` | `#955800` | `#FFFFFF` | 5.72 | 4.5 | Status text on page/card | ✅ |
| `danger` | `surface` | `#B42318` | `#FFFFFF` | 6.57 | 4.5 | Status text on page/card | ✅ |
| `info` | `surface` | `#1F5DAA` | `#FFFFFF` | 6.55 | 4.5 | Status text on page/card | ✅ |
| `success` | `success-subtle` | `#1D7A43` | `#E9F6EE` | 4.82 | 4.5 | Badge / alert text | ✅ |
| `warning` | `warning-subtle` | `#955800` | `#FFF5E0` | 5.28 | 4.5 | Badge / alert text | ✅ |
| `danger` | `danger-subtle` | `#B42318` | `#FDEEEC` | 5.83 | 4.5 | Badge / alert text | ✅ |
| `info` | `info-subtle` | `#1F5DAA` | `#EAF1FB` | 5.76 | 4.5 | Badge / alert text | ✅ |
| `primary-text` | `primary-subtle` | `#0C534D` | `#E7F3F1` | 7.83 | 4.5 | Badge / alert text | ✅ |
| `text` | `warning-subtle` | `#121A1C` | `#FFF5E0` | 16.29 | 4.5 | Badge / alert text | ✅ |
| `text` | `danger-subtle` | `#121A1C` | `#FDEEEC` | 15.64 | 4.5 | Badge / alert text | ✅ |
| `text` | `success-subtle` | `#121A1C` | `#E9F6EE` | 15.86 | 4.5 | Badge / alert text | ✅ |
| `text` | `info-subtle` | `#121A1C` | `#EAF1FB` | 15.52 | 4.5 | Badge / alert text | ✅ |
| `text` | `primary-subtle` | `#121A1C` | `#E7F3F1` | 15.53 | 4.5 | Badge / alert text | ✅ |
| `on-primary` | `primary` | `#FFFFFF` | `#0F665F` | 6.80 | 4.5 | Text on filled control | ✅ |
| `on-primary` | `primary-hover` | `#FFFFFF` | `#0C534D` | 8.90 | 4.5 | Text on filled control | ✅ |
| `on-danger` | `danger` | `#FFFFFF` | `#B42318` | 6.57 | 4.5 | Text on filled control | ✅ |
| `on-danger` | `danger-hover` | `#FFFFFF` | `#931C14` | 8.69 | 4.5 | Text on filled control | ✅ |
| `inverse-text` | `inverse-surface` | `#F8FAFA` | `#192123` | 15.62 | 4.5 | Text on filled control | ✅ |
| `border-strong` | `bg` | `#7A898D` | `#F2F5F5` | 3.31 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `border-strong` | `surface` | `#7A898D` | `#FFFFFF` | 3.63 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `primary` | `bg` | `#0F665F` | `#F2F5F5` | 6.21 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `primary` | `surface` | `#0F665F` | `#FFFFFF` | 6.80 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `focus-ring` | `bg` | `#177D74` | `#F2F5F5` | 4.54 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `focus-ring` | `surface` | `#177D74` | `#FFFFFF` | 4.97 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `warning-strong` | `bg` | `#C47600` | `#F2F5F5` | 3.23 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `warning-strong` | `surface` | `#C47600` | `#FFFFFF` | 3.54 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `danger` | `bg` | `#B42318` | `#F2F5F5` | 6.00 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `danger` | `surface` | `#B42318` | `#FFFFFF` | 6.57 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `accent-text` | `bg` | `#0C534D` | `#F2F5F5` | 8.12 | 4.5 | Normal text | ✅ |
| `accent-text` | `surface` | `#0C534D` | `#FFFFFF` | 8.90 | 4.5 | Normal text | ✅ |
| `accent-text` | `accent-subtle` | `#0C534D` | `#E7F3F1` | 7.83 | 4.5 | Badge / alert text | ✅ |
| `text` | `accent-subtle` | `#121A1C` | `#E7F3F1` | 15.53 | 4.5 | Badge / alert text | ✅ |
| `on-accent` | `accent` | `#FFFFFF` | `#0F665F` | 6.80 | 4.5 | Text on filled control | ✅ |
| `on-accent` | `accent-hover` | `#FFFFFF` | `#0C534D` | 8.90 | 4.5 | Text on filled control | ✅ |
| `accent` | `bg` | `#0F665F` | `#F2F5F5` | 6.21 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `accent` | `surface` | `#0F665F` | `#FFFFFF` | 6.80 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `on-header` | `header` | `#121A1C` | `#FFFFFF` | 17.64 | 4.5 | Normal text | ✅ |
| `on-header-muted` | `header` | `#465357` | `#FFFFFF` | 7.97 | 4.5 | Normal text | ✅ |
| `on-nav` | `nav` | `#121A1C` | `#FFFFFF` | 17.64 | 4.5 | Normal text | ✅ |
| `on-nav-muted` | `nav` | `#465357` | `#FFFFFF` | 7.97 | 4.5 | Normal text | ✅ |
| `on-nav` | `nav-item-hover` | `#121A1C` | `#E3E9EA` | 14.38 | 4.5 | Normal text | ✅ |
| `on-nav-item-current` | `nav-item-current` | `#0C534D` | `#E7F3F1` | 7.83 | 4.5 | Normal text | ✅ |
| `focus-ring` | `header` | `#177D74` | `#FFFFFF` | 4.97 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `focus-ring` | `nav` | `#177D74` | `#FFFFFF` | 4.97 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |

## Dark theme

| Foreground token | Background token | FG | BG | Ratio | Needs | Use | Pass |
|---|---|---|---|---:|---:|---|---|
| `text` | `bg` | `#E8EEEF` | `#0E1415` | 15.85 | 4.5 | Normal text | ✅ |
| `text-muted` | `bg` | `#AAB7BA` | `#0E1415` | 9.02 | 4.5 | Normal text | ✅ |
| `text-subtle` | `bg` | `#8E9CA0` | `#0E1415` | 6.56 | 4.5 | Normal text | ✅ |
| `primary-text` | `bg` | `#86D3C9` | `#0E1415` | 10.78 | 4.5 | Normal text | ✅ |
| `text` | `surface` | `#E8EEEF` | `#151D1F` | 14.59 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface` | `#AAB7BA` | `#151D1F` | 8.30 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface` | `#8E9CA0` | `#151D1F` | 6.04 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface` | `#86D3C9` | `#151D1F` | 9.92 | 4.5 | Normal text | ✅ |
| `text` | `surface-sunken` | `#E8EEEF` | `#0A0F10` | 16.45 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface-sunken` | `#AAB7BA` | `#0A0F10` | 9.36 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface-sunken` | `#8E9CA0` | `#0A0F10` | 6.81 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface-sunken` | `#86D3C9` | `#0A0F10` | 11.18 | 4.5 | Normal text | ✅ |
| `text` | `surface-hover` | `#E8EEEF` | `#223033` | 11.64 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface-hover` | `#AAB7BA` | `#223033` | 6.62 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface-hover` | `#8E9CA0` | `#223033` | 4.82 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface-hover` | `#86D3C9` | `#223033` | 7.91 | 4.5 | Normal text | ✅ |
| `text` | `surface-selected` | `#E8EEEF` | `#12302D` | 12.05 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface-selected` | `#AAB7BA` | `#12302D` | 6.86 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface-selected` | `#8E9CA0` | `#12302D` | 4.99 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface-selected` | `#86D3C9` | `#12302D` | 8.19 | 4.5 | Normal text | ✅ |
| `success` | `bg` | `#76D39A` | `#0E1415` | 10.23 | 4.5 | Status text on page/card | ✅ |
| `warning` | `bg` | `#F3BD5A` | `#0E1415` | 10.83 | 4.5 | Status text on page/card | ✅ |
| `danger` | `bg` | `#FF998D` | `#0E1415` | 9.02 | 4.5 | Status text on page/card | ✅ |
| `info` | `bg` | `#8FBDF5` | `#0E1415` | 9.53 | 4.5 | Status text on page/card | ✅ |
| `success` | `surface` | `#76D39A` | `#151D1F` | 9.41 | 4.5 | Status text on page/card | ✅ |
| `warning` | `surface` | `#F3BD5A` | `#151D1F` | 9.97 | 4.5 | Status text on page/card | ✅ |
| `danger` | `surface` | `#FF998D` | `#151D1F` | 8.30 | 4.5 | Status text on page/card | ✅ |
| `info` | `surface` | `#8FBDF5` | `#151D1F` | 8.77 | 4.5 | Status text on page/card | ✅ |
| `success` | `success-subtle` | `#76D39A` | `#0F2A1B` | 8.45 | 4.5 | Badge / alert text | ✅ |
| `warning` | `warning-subtle` | `#F3BD5A` | `#2F2311` | 8.94 | 4.5 | Badge / alert text | ✅ |
| `danger` | `danger-subtle` | `#FF998D` | `#3A1714` | 7.77 | 4.5 | Badge / alert text | ✅ |
| `info` | `info-subtle` | `#8FBDF5` | `#102338` | 8.16 | 4.5 | Badge / alert text | ✅ |
| `primary-text` | `primary-subtle` | `#86D3C9` | `#12302D` | 8.19 | 4.5 | Badge / alert text | ✅ |
| `text` | `warning-subtle` | `#E8EEEF` | `#2F2311` | 13.08 | 4.5 | Badge / alert text | ✅ |
| `text` | `danger-subtle` | `#E8EEEF` | `#3A1714` | 13.64 | 4.5 | Badge / alert text | ✅ |
| `text` | `success-subtle` | `#E8EEEF` | `#0F2A1B` | 13.10 | 4.5 | Badge / alert text | ✅ |
| `text` | `info-subtle` | `#E8EEEF` | `#102338` | 13.57 | 4.5 | Badge / alert text | ✅ |
| `text` | `primary-subtle` | `#E8EEEF` | `#12302D` | 12.05 | 4.5 | Badge / alert text | ✅ |
| `on-primary` | `primary` | `#041F1D` | `#62B5AB` | 7.15 | 4.5 | Text on filled control | ✅ |
| `on-primary` | `primary-hover` | `#041F1D` | `#94CCC5` | 9.60 | 4.5 | Text on filled control | ✅ |
| `on-danger` | `danger` | `#2A0906` | `#FF998D` | 8.94 | 4.5 | Text on filled control | ✅ |
| `on-danger` | `danger-hover` | `#2A0906` | `#FFB3AA` | 10.77 | 4.5 | Text on filled control | ✅ |
| `inverse-text` | `inverse-surface` | `#121A1C` | `#E8EEEF` | 15.05 | 4.5 | Text on filled control | ✅ |
| `border-strong` | `bg` | `#6B7B7F` | `#0E1415` | 4.22 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `border-strong` | `surface` | `#6B7B7F` | `#151D1F` | 3.88 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `primary` | `bg` | `#62B5AB` | `#0E1415` | 7.72 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `primary` | `surface` | `#62B5AB` | `#151D1F` | 7.10 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `focus-ring` | `bg` | `#86D3C9` | `#0E1415` | 10.78 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `focus-ring` | `surface` | `#86D3C9` | `#151D1F` | 9.92 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `warning-strong` | `bg` | `#F3BD5A` | `#0E1415` | 10.83 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `warning-strong` | `surface` | `#F3BD5A` | `#151D1F` | 9.97 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `danger` | `bg` | `#FF998D` | `#0E1415` | 9.02 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `danger` | `surface` | `#FF998D` | `#151D1F` | 8.30 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `accent-text` | `bg` | `#86D3C9` | `#0E1415` | 10.78 | 4.5 | Normal text | ✅ |
| `accent-text` | `surface` | `#86D3C9` | `#151D1F` | 9.92 | 4.5 | Normal text | ✅ |
| `accent-text` | `accent-subtle` | `#86D3C9` | `#12302D` | 8.19 | 4.5 | Badge / alert text | ✅ |
| `text` | `accent-subtle` | `#E8EEEF` | `#12302D` | 12.05 | 4.5 | Badge / alert text | ✅ |
| `on-accent` | `accent` | `#041F1D` | `#62B5AB` | 7.15 | 4.5 | Text on filled control | ✅ |
| `on-accent` | `accent-hover` | `#041F1D` | `#94CCC5` | 9.60 | 4.5 | Text on filled control | ✅ |
| `accent` | `bg` | `#62B5AB` | `#0E1415` | 7.72 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `accent` | `surface` | `#62B5AB` | `#151D1F` | 7.10 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `on-header` | `header` | `#E8EEEF` | `#151D1F` | 14.59 | 4.5 | Normal text | ✅ |
| `on-header-muted` | `header` | `#AAB7BA` | `#151D1F` | 8.30 | 4.5 | Normal text | ✅ |
| `on-nav` | `nav` | `#E8EEEF` | `#151D1F` | 14.59 | 4.5 | Normal text | ✅ |
| `on-nav-muted` | `nav` | `#AAB7BA` | `#151D1F` | 8.30 | 4.5 | Normal text | ✅ |
| `on-nav` | `nav-item-hover` | `#E8EEEF` | `#223033` | 11.64 | 4.5 | Normal text | ✅ |
| `on-nav-item-current` | `nav-item-current` | `#86D3C9` | `#12302D` | 8.19 | 4.5 | Normal text | ✅ |
| `focus-ring` | `header` | `#86D3C9` | `#151D1F` | 9.92 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `focus-ring` | `nav` | `#86D3C9` | `#151D1F` | 9.92 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
