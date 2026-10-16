import type { ThemeDefinition } from '../contract';

/**
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
    'Jadarat palette of «Meridian» (PO, 14 Oct 2026, T-M2-21) in the Kawadir ATS layout (PO, 15 Oct 2026, T-M2-43)',
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
      // Kawadir: the top bar sits on the page background (a hairline under it), not on white.
      header: '{semantic.bg}',
      'on-header': '{semantic.text}',
      'on-header-muted': '{semantic.text-muted}',
      'header-border': '{semantic.border}',
      // Side navigation (Kawadir layout, T-M2-43): a white panel like the cards; muted entries, a
      // light hover fill, and the current entry filled with the brand gradient (135°, from
      // `nav-item-current` to `nav-item-current-end`) with white text.
      nav: '{semantic.surface}',
      'nav-end': '{semantic.nav}',
      'on-nav': '{semantic.text-muted}',
      'on-nav-muted': '{semantic.text-subtle}',
      'nav-border': '{semantic.border}',
      'nav-item-hover': '{semantic.surface-hover}',
      // The Jadarat brand gradient (135°, slate → steel), also on primary buttons, the summary cards,
      // the dashboard title and the sign-in panel.
      'nav-item-current': '{color.jadarat.slate}',
      'nav-item-current-end': '{color.jadarat.steel}',
      'on-nav-item-current': '{color.neutral.0}',
      'nav-focus-ring': '{semantic.focus-ring}',
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
      // The navigation panel and its text follow the dark surface (aliases); the brand gradient is the
      // light Jadarat one (sky → light steel) with very dark text, so it stands out on the dark panel.
      'nav-item-current': '{color.jadarat.sky}',
      'nav-item-current-end': '{color.jadarat.steel-light}',
      'on-nav-item-current': '{color.brand.950}',
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
  // Kawadir: base radius 0.75rem (`lg`); `md` for buttons and inputs, `xl` for cards (rounded-xl).
  radius: { sm: '8px', md: '10px', lg: '12px', xl: '16px' },
  // Soft, low-contrast shadows (Kawadir): 1 cards, 2 menus and popovers, 3 dialogs, 4 drawers.
  elevation: {
    light: {
      1: '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
      2: '0 4px 12px rgba(15, 23, 42, 0.06)',
      3: '0 12px 40px rgba(15, 23, 42, 0.08)',
      4: '0 24px 60px rgba(15, 23, 42, 0.12)',
    },
    dark: {
      1: '0 1px 2px rgba(0, 0, 0, 0.20)',
      2: '0 4px 12px rgba(0, 0, 0, 0.30)',
      3: '0 12px 40px rgba(0, 0, 0, 0.40)',
      4: '0 24px 60px rgba(0, 0, 0, 0.50)',
    },
  },
};
