import type { ThemeDefinition } from '../contract';

/**
 * Direction C «Bold product» (redesign package 1, approved by the PO on 21 Oct 2026): the side
 * navigation is the brand gradient (slate → steel) with a white pill for the current entry, the top
 * bar is white, shapes are rounder (radius 10–32 px, pill buttons) and the brand gradient fills primary
 * buttons and the current view card. The palette below is unchanged. Earlier:
 *
 * The Jadarat look: the Jadarat palette of «Meridian» (UI design approved by the PO on 14 Oct 2026,
 * T-M2-21) in the Kawadir ATS layout (PO, 15 Oct 2026 — docs/design/kawadir-alignment.md; T-M2-43):
 * calm slate neutrals on a muted page with white cards, hairline borders, one steel-blue accent for
 * action, selection, focus and links, base radius 0.75rem (12 px) with soft, low-contrast shadows, and a
 * WHITE side navigation whose current entry carries the Jadarat brand gradient (135°, slate → steel)
 * with white text and a glow tinted from it. The same gradient fills primary buttons, the dashboard
 * title, the sign-in brand panel and the summary (KPI) cards — one hue family, no mixed colours (PO,
 * 16 Oct 2026: Kawadir's screenshots carry one tenant's branding). An organization's own colours replace
 * it everywhere (FR-ADM-07). Values are exactly those of docs/design/tokens/tokens.json; the generated
 * stylesheet docs/design/tokens/themes/jadarat.css is what the product ships.
 *
 * Design values kept as approved, except one: the approved control border #CBD5DD is only 1.5 : 1 on
 * white, so `border-strong` (input and button boundaries, SC 1.4.11) is the darker `neutral.400`, and
 * #CBD5DD (`neutral.300`) is used for decoration only.
 */
export const jadaratTheme: ThemeDefinition = {
  id: 'jadarat',
  name: { ar: 'جدارات', en: 'Jadarat' },
  status: 'active',
  source:
    'Jadarat palette of «Meridian» (PO, 14 Oct 2026, T-M2-21) in the Kawadir ATS layout (PO, 15 Oct 2026, T-M2-43), direction C «Bold product» (PO, 21 Oct 2026)',
  palette: {
    neutral: {
      0: '#FFFFFF',
      25: '#FAFBFC',
      50: '#F5F7F9',
      100: '#EEF3F7',
      200: '#E0E6EB',
      300: '#CBD5DD',
      400: '#7A8A97',
      450: '#9AA7B2',
      500: '#5F6F7C',
      600: '#46596A',
      900: '#1F3340',
    },
    brand: {
      50: '#EAF3F9',
      200: '#A5CAE4',
      300: '#7FB2D6',
      500: '#33658A',
      600: '#2B5677',
      700: '#2A5574',
      950: '#0B1A26',
    },
    // The Jadarat brand palette. Slate → steel is the brand gradient (white text ≥ 6 : 1 on both); in
    // dark mode sky → `steel-light` with very dark text. Amber and orange are accents for charts,
    // highlights and warnings only (under 4.5 : 1 on white: never body text; orange as text is
    // `orange-text`) — never in the brand gradient.
    jadarat: {
      slate: '#2F4858',
      steel: '#33658A',
      sky: '#86BBD8',
      amber: '#F6AE2D',
      orange: '#F26419',
      'orange-text': '#B5440B',
      // A lighter steel: the end of the dark-mode brand gradient (very dark text ≥ 4.5 : 1 on it).
      'steel-light': '#5E95BD',
    },
    green: { 50: '#E9F5EE', 300: '#6CD09A', 700: '#16794A', 900: '#11291D' },
    amber: { 50: '#FEF4DF', 300: '#F2C163', 600: '#A36500', 700: '#8A5300', 900: '#2E2410' },
    red: { 50: '#FCECEC', 300: '#FF9E97', 600: '#BE2A2F', 700: '#9E2227', 900: '#3A1719' },
    // Dark-mode slates (surfaces and the dark navigation gradient).
    night: {
      50: '#E6EDF2',
      100: '#B0BFCB',
      200: '#94A6B4',
      300: '#6E8494',
      400: '#5D6F7D',
      700: '#2A3B48',
      750: '#1F3240',
      800: '#1B2B37',
      850: '#15232E',
      900: '#0F1A22',
      950: '#0B141B',
    },
  },
  color: {
    light: {
      bg: '{color.neutral.50}',
      surface: '{color.neutral.0}',
      'surface-raised': '{color.neutral.0}',
      'surface-sunken': '{color.neutral.25}',
      'surface-hover': '{color.neutral.100}',
      'surface-selected': '{color.brand.50}',
      text: '{color.neutral.900}',
      'text-muted': '{color.neutral.600}',
      'text-subtle': '{color.neutral.500}',
      'text-disabled': '{color.neutral.450}',
      border: '{color.neutral.200}',
      'border-strong': '{color.neutral.400}',
      primary: '{color.brand.500}',
      'primary-hover': '{color.brand.700}',
      'on-primary': '{color.neutral.0}',
      'primary-subtle': '{color.brand.50}',
      'primary-text': '{color.brand.600}',
      'focus-ring': '{color.brand.500}',
      accent: '{semantic.primary}',
      'accent-hover': '{semantic.primary-hover}',
      'on-accent': '{semantic.on-primary}',
      'accent-subtle': '{semantic.primary-subtle}',
      'accent-text': '{semantic.primary-text}',
      success: '{color.green.700}',
      'success-subtle': '{color.green.50}',
      warning: '{color.amber.700}',
      'warning-strong': '{color.amber.600}',
      'warning-subtle': '{color.amber.50}',
      danger: '{color.red.600}',
      'danger-hover': '{color.red.700}',
      'on-danger': '{color.neutral.0}',
      'danger-subtle': '{color.red.50}',
      info: '{color.brand.600}',
      'info-subtle': '{color.brand.50}',
      'inverse-surface': '{color.neutral.900}',
      'inverse-text': '{color.neutral.50}',
      overlay: 'rgba(15, 26, 34, 0.55)',
      // The Jadarat brand gradient (135°, slate → steel; direction C): the navigation panel, primary
      // buttons, the current view card, the avatar and the sign-in panel. White text on both ends.
      brand: '{color.jadarat.slate}',
      'brand-end': '{color.jadarat.steel}',
      'on-brand': '{color.neutral.0}',
      // Direction C: the top bar is white, with a hairline under it.
      header: '{semantic.surface}',
      'on-header': '{semantic.text}',
      'on-header-muted': '{semantic.text-muted}',
      'header-border': '{semantic.border}',
      // Side navigation (direction C «Bold product», PO 21 Oct 2026): the brand gradient from top
      // (`nav`) to bottom (`nav-end`) with white entries, a translucent white hover fill (as a solid:
      // white 10 % over steel, where white text has the least contrast), hairlines in white 22 %, and
      // the current entry as a white pill with slate text.
      nav: '{semantic.brand}',
      'nav-end': '{semantic.brand-end}',
      'on-nav': '{semantic.on-brand}',
      'on-nav-muted': '{semantic.on-nav}',
      'nav-border': 'rgba(255, 255, 255, 0.22)',
      'nav-item-hover': '#477496',
      'nav-item-current': '{semantic.surface}',
      'nav-item-current-end': '{semantic.nav-item-current}',
      'on-nav-item-current': '{semantic.brand}',
      'nav-focus-ring': '{semantic.on-nav}',
    },
    dark: {
      bg: '{color.night.900}',
      surface: '{color.night.850}',
      'surface-raised': '{color.night.800}',
      'surface-sunken': '{color.night.950}',
      'surface-hover': '{color.night.750}',
      'surface-selected': '#183750',
      text: '{color.night.50}',
      'text-muted': '{color.night.100}',
      'text-subtle': '{color.night.200}',
      'text-disabled': '{color.night.400}',
      border: '{color.night.700}',
      'border-strong': '{color.night.300}',
      primary: '{color.brand.300}',
      'primary-hover': '{color.brand.200}',
      'on-primary': '{color.brand.950}',
      'primary-subtle': '#183750',
      'primary-text': '#9DCBEB',
      'focus-ring': '#9DCBEB',
      success: '{color.green.300}',
      'success-subtle': '{color.green.900}',
      warning: '{color.amber.300}',
      'warning-strong': '{color.amber.300}',
      'warning-subtle': '{color.amber.900}',
      danger: '{color.red.300}',
      'danger-hover': '#FFBAB4',
      'on-danger': '#2A0906',
      'danger-subtle': '{color.red.900}',
      info: '#9DCBEB',
      'info-subtle': '#183750',
      'inverse-surface': '{color.night.50}',
      'inverse-text': '{color.neutral.900}',
      overlay: 'rgba(0, 0, 0, 0.65)',
      // The brand gradient in dark mode: the light Jadarat one (sky → light steel) with very dark text.
      brand: '{color.jadarat.sky}',
      'brand-end': '{color.jadarat.steel-light}',
      'on-brand': '{color.brand.950}',
      header: '{semantic.surface}',
      // The navigation panel in dark mode runs over the dark surfaces (night 850 → 800) with light
      // entries; the current entry carries the brand gradient with its very dark text.
      nav: '{color.night.850}',
      'nav-end': '{color.night.800}',
      'on-nav': '{semantic.text}',
      'on-nav-muted': '{semantic.text-muted}',
      'nav-border': '{semantic.border}',
      'nav-item-hover': '{semantic.surface-hover}',
      'nav-item-current': '{semantic.brand}',
      'nav-item-current-end': '{semantic.brand-end}',
      'on-nav-item-current': '{semantic.on-brand}',
      'nav-focus-ring': '{semantic.focus-ring}',
    },
  },
  font: {
    // Self-hosted (packages/ui/src/fonts.css, ADR 0007 §4). Arabic text uses IBM Plex Sans Arabic
    // first; Latin text in English uses Poppins, with IBM Plex Sans Arabic for Arabic words in it.
    arabic: [
      'IBM Plex Sans Arabic',
      'Noto Sans Arabic',
      'Segoe UI',
      'Tahoma',
      'Geeza Pro',
      'system-ui',
      'sans-serif',
    ],
    latin: [
      'Poppins',
      'IBM Plex Sans Arabic',
      'Segoe UI',
      'Roboto',
      'Helvetica Neue',
      'Arial',
      'system-ui',
      'sans-serif',
    ],
    mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
  },
  // Direction C «Bold product» (PO, 21 Oct 2026): rounder shapes — `sm` 10 px (small controls, menu
  // entries), `md` 14 px (inputs), `lg` 18 px (view cards, panels), `xl` 24 px (cards, tables,
  // dialogs); buttons and filters are pills (`full`); `2xl` 32 px (the sign-in panel) is in tokens.css.
  radius: { sm: '10px', md: '14px', lg: '18px', xl: '24px' },
  // Soft, low-contrast shadows (Kawadir): 1 cards, 2 menus and popovers, 3 dialogs, 4 drawers.
  elevation: {
    light: {
      1: '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
      2: '0 4px 12px rgba(15, 23, 42, 0.06)',
      3: '0 12px 40px rgba(15, 23, 42, 0.08)',
      4: '0 24px 60px rgba(15, 23, 42, 0.14)',
    },
    dark: {
      1: '0 1px 2px rgba(0, 0, 0, 0.20)',
      2: '0 4px 12px rgba(0, 0, 0, 0.30)',
      3: '0 12px 40px rgba(0, 0, 0, 0.40)',
      4: '0 24px 60px rgba(0, 0, 0, 0.50)',
    },
  },
};
