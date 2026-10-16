# Contrast report — Jadarat design tokens

> **Generated** by `packages/ui/src/theme/theme.test.ts` from the theme contract (`packages/ui/src/theme/contract.ts`) and the shipped theme «jadarat». Do not edit by hand; after a theme change run `pnpm --filter @jadarat/ui exec vitest run -u`. CI fails when this file is out of date or when any pair fails.

WCAG 2.x relative-luminance formula (`(L1 + 0.05) / (L2 + 0.05)`); ratios shown to 2 decimals, pass/fail decided on the exact ratio. Every text/background pair and every UI-component/background pair the components use is checked in **light** and **dark**.

| Requirement | Threshold | WCAG 2.2 SC |
|---|---|---|
| Normal text (all body, label, badge text) | ≥ 4.5 : 1 | 1.4.3 Contrast (Minimum) |
| Large text (≥ 24 px regular / ≥ 18.66 px bold) | ≥ 3 : 1 — we still hold all text to 4.5 : 1 | 1.4.3 |
| UI components and graphical objects (input borders, icons, focus ring) | ≥ 3 : 1 | 1.4.11 Non-text Contrast; 2.4.13 is AAA and not targeted |

**Result for «jadarat»: 156 of 156 pairs pass (0 failures).** Tightest pair relative to its threshold: `text-subtle` on `surface-selected` (light) = **4.61 : 1** (needs 4.5).

The same 78 pairs per mode are also checked automatically for:

- every theme in `packages/ui/src/theme/themes/` (including the pending «Jadarat LMS» slot);
- organization brand colours (FR-ADM-07): `deriveOrganizationBrand` derives the brand roles so that they always pass, re-checks all pairs and refuses to return a failing brand; its tests run it on hundreds of colours (white, black, pure yellow, mid greys, a colour grid and random colours).

Notes

- `text-disabled` is intentionally excluded (disabled controls are exempt under SC 1.4.3); disabled states must also be conveyed by the `disabled` attribute / `aria-disabled`.
- `border` (decorative divider) is intentionally below 3 : 1; it must never be the only boundary of an interactive control — inputs use `border-strong`.
- The focus ring is drawn as a 2 px ring separated from the component by a 2 px `--color-bg` gap (`--focus-ring`), so the ring is measured against `bg`/`surface` and the header, not against the button fill. Inside the side navigation the ring is `nav-focus-ring` (an outline 2 px away from the entry), measured against both ends of the navigation panel.
- The side navigation panel runs from `nav` (top) to `nav-end` (bottom; one colour in the Kawadir layout): its text and focus ring are checked against **both** ends. The current entry is filled with the brand gradient (135°) from `nav-item-current` to `nav-item-current-end`: its text is checked on **both** gradient ends, and both ends must stand out from the panel (3 : 1).
- `accent*` roles are aliases of the primary roles in «jadarat»; the header roles are aliases of the surface and text roles (a white top bar).

## Light theme

| Foreground token | Background token | FG | BG | Ratio | Needs | Use | Pass |
|---|---|---|---|---:|---:|---|---|
| `text` | `bg` | `#1F3340` | `#F5F7F9` | 12.18 | 4.5 | Normal text | ✅ |
| `text-muted` | `bg` | `#46596A` | `#F5F7F9` | 6.75 | 4.5 | Normal text | ✅ |
| `text-subtle` | `bg` | `#5F6F7C` | `#F5F7F9` | 4.83 | 4.5 | Normal text | ✅ |
| `primary-text` | `bg` | `#2B5677` | `#F5F7F9` | 7.24 | 4.5 | Normal text | ✅ |
| `text` | `surface` | `#1F3340` | `#FFFFFF` | 13.08 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface` | `#46596A` | `#FFFFFF` | 7.25 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface` | `#5F6F7C` | `#FFFFFF` | 5.18 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface` | `#2B5677` | `#FFFFFF` | 7.78 | 4.5 | Normal text | ✅ |
| `text` | `surface-sunken` | `#1F3340` | `#FAFBFC` | 12.62 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface-sunken` | `#46596A` | `#FAFBFC` | 7.00 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface-sunken` | `#5F6F7C` | `#FAFBFC` | 5.00 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface-sunken` | `#2B5677` | `#FAFBFC` | 7.51 | 4.5 | Normal text | ✅ |
| `text` | `surface-hover` | `#1F3340` | `#EEF3F7` | 11.71 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface-hover` | `#46596A` | `#EEF3F7` | 6.49 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface-hover` | `#5F6F7C` | `#EEF3F7` | 4.64 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface-hover` | `#2B5677` | `#EEF3F7` | 6.96 | 4.5 | Normal text | ✅ |
| `text` | `surface-selected` | `#1F3340` | `#EAF3F9` | 11.64 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface-selected` | `#46596A` | `#EAF3F9` | 6.45 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface-selected` | `#5F6F7C` | `#EAF3F9` | 4.61 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface-selected` | `#2B5677` | `#EAF3F9` | 6.92 | 4.5 | Normal text | ✅ |
| `success` | `bg` | `#16794A` | `#F5F7F9` | 5.06 | 4.5 | Status text on page/card | ✅ |
| `warning` | `bg` | `#8A5300` | `#F5F7F9` | 5.89 | 4.5 | Status text on page/card | ✅ |
| `danger` | `bg` | `#BE2A2F` | `#F5F7F9` | 5.49 | 4.5 | Status text on page/card | ✅ |
| `info` | `bg` | `#2B5677` | `#F5F7F9` | 7.24 | 4.5 | Status text on page/card | ✅ |
| `success` | `surface` | `#16794A` | `#FFFFFF` | 5.43 | 4.5 | Status text on page/card | ✅ |
| `warning` | `surface` | `#8A5300` | `#FFFFFF` | 6.33 | 4.5 | Status text on page/card | ✅ |
| `danger` | `surface` | `#BE2A2F` | `#FFFFFF` | 5.90 | 4.5 | Status text on page/card | ✅ |
| `info` | `surface` | `#2B5677` | `#FFFFFF` | 7.78 | 4.5 | Status text on page/card | ✅ |
| `success` | `success-subtle` | `#16794A` | `#E9F5EE` | 4.85 | 4.5 | Badge / alert text | ✅ |
| `warning` | `warning-subtle` | `#8A5300` | `#FEF4DF` | 5.79 | 4.5 | Badge / alert text | ✅ |
| `danger` | `danger-subtle` | `#BE2A2F` | `#FCECEC` | 5.15 | 4.5 | Badge / alert text | ✅ |
| `info` | `info-subtle` | `#2B5677` | `#EAF3F9` | 6.92 | 4.5 | Badge / alert text | ✅ |
| `primary-text` | `primary-subtle` | `#2B5677` | `#EAF3F9` | 6.92 | 4.5 | Badge / alert text | ✅ |
| `text` | `warning-subtle` | `#1F3340` | `#FEF4DF` | 11.97 | 4.5 | Badge / alert text | ✅ |
| `text` | `danger-subtle` | `#1F3340` | `#FCECEC` | 11.43 | 4.5 | Badge / alert text | ✅ |
| `text` | `success-subtle` | `#1F3340` | `#E9F5EE` | 11.68 | 4.5 | Badge / alert text | ✅ |
| `text` | `info-subtle` | `#1F3340` | `#EAF3F9` | 11.64 | 4.5 | Badge / alert text | ✅ |
| `text` | `primary-subtle` | `#1F3340` | `#EAF3F9` | 11.64 | 4.5 | Badge / alert text | ✅ |
| `on-primary` | `primary` | `#FFFFFF` | `#33658A` | 6.23 | 4.5 | Text on filled control | ✅ |
| `on-primary` | `primary-hover` | `#FFFFFF` | `#2A5574` | 7.92 | 4.5 | Text on filled control | ✅ |
| `on-danger` | `danger` | `#FFFFFF` | `#BE2A2F` | 5.90 | 4.5 | Text on filled control | ✅ |
| `on-danger` | `danger-hover` | `#FFFFFF` | `#9E2227` | 7.74 | 4.5 | Text on filled control | ✅ |
| `inverse-text` | `inverse-surface` | `#F5F7F9` | `#1F3340` | 12.18 | 4.5 | Text on filled control | ✅ |
| `border-strong` | `bg` | `#7A8A97` | `#F5F7F9` | 3.31 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `border-strong` | `surface` | `#7A8A97` | `#FFFFFF` | 3.55 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `primary` | `bg` | `#33658A` | `#F5F7F9` | 5.80 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `primary` | `surface` | `#33658A` | `#FFFFFF` | 6.23 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `focus-ring` | `bg` | `#33658A` | `#F5F7F9` | 5.80 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `focus-ring` | `surface` | `#33658A` | `#FFFFFF` | 6.23 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `warning-strong` | `bg` | `#A36500` | `#F5F7F9` | 4.43 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `warning-strong` | `surface` | `#A36500` | `#FFFFFF` | 4.75 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `danger` | `bg` | `#BE2A2F` | `#F5F7F9` | 5.49 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `danger` | `surface` | `#BE2A2F` | `#FFFFFF` | 5.90 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `accent-text` | `bg` | `#2B5677` | `#F5F7F9` | 7.24 | 4.5 | Normal text | ✅ |
| `accent-text` | `surface` | `#2B5677` | `#FFFFFF` | 7.78 | 4.5 | Normal text | ✅ |
| `accent-text` | `accent-subtle` | `#2B5677` | `#EAF3F9` | 6.92 | 4.5 | Badge / alert text | ✅ |
| `text` | `accent-subtle` | `#1F3340` | `#EAF3F9` | 11.64 | 4.5 | Badge / alert text | ✅ |
| `on-accent` | `accent` | `#FFFFFF` | `#33658A` | 6.23 | 4.5 | Text on filled control | ✅ |
| `on-accent` | `accent-hover` | `#FFFFFF` | `#2A5574` | 7.92 | 4.5 | Text on filled control | ✅ |
| `accent` | `bg` | `#33658A` | `#F5F7F9` | 5.80 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `accent` | `surface` | `#33658A` | `#FFFFFF` | 6.23 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `on-header` | `header` | `#1F3340` | `#FFFFFF` | 13.08 | 4.5 | Normal text | ✅ |
| `on-header-muted` | `header` | `#46596A` | `#FFFFFF` | 7.25 | 4.5 | Normal text | ✅ |
| `focus-ring` | `header` | `#33658A` | `#FFFFFF` | 6.23 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `on-nav` | `nav` | `#46596A` | `#FFFFFF` | 7.25 | 4.5 | Normal text | ✅ |
| `on-nav-muted` | `nav` | `#5F6F7C` | `#FFFFFF` | 5.18 | 4.5 | Normal text | ✅ |
| `nav-item-current` | `nav` | `#33658A` | `#FFFFFF` | 6.23 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `nav-item-current-end` | `nav` | `#2F4858` | `#FFFFFF` | 9.59 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `nav-focus-ring` | `nav` | `#33658A` | `#FFFFFF` | 6.23 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `on-nav` | `nav-end` | `#46596A` | `#FFFFFF` | 7.25 | 4.5 | Normal text | ✅ |
| `on-nav-muted` | `nav-end` | `#5F6F7C` | `#FFFFFF` | 5.18 | 4.5 | Normal text | ✅ |
| `nav-item-current` | `nav-end` | `#33658A` | `#FFFFFF` | 6.23 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `nav-item-current-end` | `nav-end` | `#2F4858` | `#FFFFFF` | 9.59 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `nav-focus-ring` | `nav-end` | `#33658A` | `#FFFFFF` | 6.23 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `on-nav` | `nav-item-hover` | `#46596A` | `#EEF3F7` | 6.49 | 4.5 | Normal text | ✅ |
| `on-nav-muted` | `nav-item-hover` | `#5F6F7C` | `#EEF3F7` | 4.64 | 4.5 | Normal text | ✅ |
| `on-nav-item-current` | `nav-item-current` | `#FFFFFF` | `#33658A` | 6.23 | 4.5 | Normal text | ✅ |
| `on-nav-item-current` | `nav-item-current-end` | `#FFFFFF` | `#2F4858` | 9.59 | 4.5 | Normal text | ✅ |

## Dark theme

| Foreground token | Background token | FG | BG | Ratio | Needs | Use | Pass |
|---|---|---|---|---:|---:|---|---|
| `text` | `bg` | `#E6EDF2` | `#0F1A22` | 14.91 | 4.5 | Normal text | ✅ |
| `text-muted` | `bg` | `#B0BFCB` | `#0F1A22` | 9.37 | 4.5 | Normal text | ✅ |
| `text-subtle` | `bg` | `#94A6B4` | `#0F1A22` | 7.03 | 4.5 | Normal text | ✅ |
| `primary-text` | `bg` | `#9DCBEB` | `#0F1A22` | 10.22 | 4.5 | Normal text | ✅ |
| `text` | `surface` | `#E6EDF2` | `#15232E` | 13.54 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface` | `#B0BFCB` | `#15232E` | 8.51 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface` | `#94A6B4` | `#15232E` | 6.38 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface` | `#9DCBEB` | `#15232E` | 9.28 | 4.5 | Normal text | ✅ |
| `text` | `surface-sunken` | `#E6EDF2` | `#0B141B` | 15.72 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface-sunken` | `#B0BFCB` | `#0B141B` | 9.88 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface-sunken` | `#94A6B4` | `#0B141B` | 7.41 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface-sunken` | `#9DCBEB` | `#0B141B` | 10.77 | 4.5 | Normal text | ✅ |
| `text` | `surface-hover` | `#E6EDF2` | `#1F3240` | 11.18 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface-hover` | `#B0BFCB` | `#1F3240` | 7.03 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface-hover` | `#94A6B4` | `#1F3240` | 5.27 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface-hover` | `#9DCBEB` | `#1F3240` | 7.66 | 4.5 | Normal text | ✅ |
| `text` | `surface-selected` | `#E6EDF2` | `#183750` | 10.44 | 4.5 | Normal text | ✅ |
| `text-muted` | `surface-selected` | `#B0BFCB` | `#183750` | 6.56 | 4.5 | Normal text | ✅ |
| `text-subtle` | `surface-selected` | `#94A6B4` | `#183750` | 4.92 | 4.5 | Normal text | ✅ |
| `primary-text` | `surface-selected` | `#9DCBEB` | `#183750` | 7.16 | 4.5 | Normal text | ✅ |
| `success` | `bg` | `#6CD09A` | `#0F1A22` | 9.34 | 4.5 | Status text on page/card | ✅ |
| `warning` | `bg` | `#F2C163` | `#0F1A22` | 10.56 | 4.5 | Status text on page/card | ✅ |
| `danger` | `bg` | `#FF9E97` | `#0F1A22` | 8.89 | 4.5 | Status text on page/card | ✅ |
| `info` | `bg` | `#9DCBEB` | `#0F1A22` | 10.22 | 4.5 | Status text on page/card | ✅ |
| `success` | `surface` | `#6CD09A` | `#15232E` | 8.48 | 4.5 | Status text on page/card | ✅ |
| `warning` | `surface` | `#F2C163` | `#15232E` | 9.59 | 4.5 | Status text on page/card | ✅ |
| `danger` | `surface` | `#FF9E97` | `#15232E` | 8.07 | 4.5 | Status text on page/card | ✅ |
| `info` | `surface` | `#9DCBEB` | `#15232E` | 9.28 | 4.5 | Status text on page/card | ✅ |
| `success` | `success-subtle` | `#6CD09A` | `#11291D` | 8.19 | 4.5 | Badge / alert text | ✅ |
| `warning` | `warning-subtle` | `#F2C163` | `#2E2410` | 9.15 | 4.5 | Badge / alert text | ✅ |
| `danger` | `danger-subtle` | `#FF9E97` | `#3A1719` | 8.04 | 4.5 | Badge / alert text | ✅ |
| `info` | `info-subtle` | `#9DCBEB` | `#183750` | 7.16 | 4.5 | Badge / alert text | ✅ |
| `primary-text` | `primary-subtle` | `#9DCBEB` | `#183750` | 7.16 | 4.5 | Badge / alert text | ✅ |
| `text` | `warning-subtle` | `#E6EDF2` | `#2E2410` | 12.91 | 4.5 | Badge / alert text | ✅ |
| `text` | `danger-subtle` | `#E6EDF2` | `#3A1719` | 13.49 | 4.5 | Badge / alert text | ✅ |
| `text` | `success-subtle` | `#E6EDF2` | `#11291D` | 13.07 | 4.5 | Badge / alert text | ✅ |
| `text` | `info-subtle` | `#E6EDF2` | `#183750` | 10.44 | 4.5 | Badge / alert text | ✅ |
| `text` | `primary-subtle` | `#E6EDF2` | `#183750` | 10.44 | 4.5 | Badge / alert text | ✅ |
| `on-primary` | `primary` | `#0B1A26` | `#7FB2D6` | 7.77 | 4.5 | Text on filled control | ✅ |
| `on-primary` | `primary-hover` | `#0B1A26` | `#A5CAE4` | 10.23 | 4.5 | Text on filled control | ✅ |
| `on-danger` | `danger` | `#2A0906` | `#FF9E97` | 9.29 | 4.5 | Text on filled control | ✅ |
| `on-danger` | `danger-hover` | `#2A0906` | `#FFBAB4` | 11.34 | 4.5 | Text on filled control | ✅ |
| `inverse-text` | `inverse-surface` | `#1F3340` | `#E6EDF2` | 11.06 | 4.5 | Text on filled control | ✅ |
| `border-strong` | `bg` | `#6E8494` | `#0F1A22` | 4.53 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `border-strong` | `surface` | `#6E8494` | `#15232E` | 4.11 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `primary` | `bg` | `#7FB2D6` | `#0F1A22` | 7.76 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `primary` | `surface` | `#7FB2D6` | `#15232E` | 7.05 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `focus-ring` | `bg` | `#9DCBEB` | `#0F1A22` | 10.22 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `focus-ring` | `surface` | `#9DCBEB` | `#15232E` | 9.28 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `warning-strong` | `bg` | `#F2C163` | `#0F1A22` | 10.56 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `warning-strong` | `surface` | `#F2C163` | `#15232E` | 9.59 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `danger` | `bg` | `#FF9E97` | `#0F1A22` | 8.89 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `danger` | `surface` | `#FF9E97` | `#15232E` | 8.07 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `accent-text` | `bg` | `#9DCBEB` | `#0F1A22` | 10.22 | 4.5 | Normal text | ✅ |
| `accent-text` | `surface` | `#9DCBEB` | `#15232E` | 9.28 | 4.5 | Normal text | ✅ |
| `accent-text` | `accent-subtle` | `#9DCBEB` | `#183750` | 7.16 | 4.5 | Badge / alert text | ✅ |
| `text` | `accent-subtle` | `#E6EDF2` | `#183750` | 10.44 | 4.5 | Badge / alert text | ✅ |
| `on-accent` | `accent` | `#0B1A26` | `#7FB2D6` | 7.77 | 4.5 | Text on filled control | ✅ |
| `on-accent` | `accent-hover` | `#0B1A26` | `#A5CAE4` | 10.23 | 4.5 | Text on filled control | ✅ |
| `accent` | `bg` | `#7FB2D6` | `#0F1A22` | 7.76 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `accent` | `surface` | `#7FB2D6` | `#15232E` | 7.05 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `on-header` | `header` | `#E6EDF2` | `#15232E` | 13.54 | 4.5 | Normal text | ✅ |
| `on-header-muted` | `header` | `#B0BFCB` | `#15232E` | 8.51 | 4.5 | Normal text | ✅ |
| `focus-ring` | `header` | `#9DCBEB` | `#15232E` | 9.28 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `on-nav` | `nav` | `#B0BFCB` | `#15232E` | 8.51 | 4.5 | Normal text | ✅ |
| `on-nav-muted` | `nav` | `#94A6B4` | `#15232E` | 6.38 | 4.5 | Normal text | ✅ |
| `nav-item-current` | `nav` | `#7FB2D6` | `#15232E` | 7.05 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `nav-item-current-end` | `nav` | `#5E95BD` | `#15232E` | 4.96 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `nav-focus-ring` | `nav` | `#9DCBEB` | `#15232E` | 9.28 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `on-nav` | `nav-end` | `#B0BFCB` | `#15232E` | 8.51 | 4.5 | Normal text | ✅ |
| `on-nav-muted` | `nav-end` | `#94A6B4` | `#15232E` | 6.38 | 4.5 | Normal text | ✅ |
| `nav-item-current` | `nav-end` | `#7FB2D6` | `#15232E` | 7.05 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `nav-item-current-end` | `nav-end` | `#5E95BD` | `#15232E` | 4.96 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `nav-focus-ring` | `nav-end` | `#9DCBEB` | `#15232E` | 9.28 | 3.0 | UI component / focus (SC 1.4.11) | ✅ |
| `on-nav` | `nav-item-hover` | `#B0BFCB` | `#1F3240` | 7.03 | 4.5 | Normal text | ✅ |
| `on-nav-muted` | `nav-item-hover` | `#94A6B4` | `#1F3240` | 5.27 | 4.5 | Normal text | ✅ |
| `on-nav-item-current` | `nav-item-current` | `#0B1A26` | `#7FB2D6` | 7.77 | 4.5 | Normal text | ✅ |
| `on-nav-item-current` | `nav-item-current-end` | `#0B1A26` | `#5E95BD` | 5.47 | 4.5 | Normal text | ✅ |
