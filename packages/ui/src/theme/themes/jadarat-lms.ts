import type { ThemeDefinition } from '../contract';
import { jadaratTheme } from './jadarat';

/**
 * The Jadarat LMS look (PO, 5 Oct 2026: the product follows Jadarat LMS) — PENDING.
 *
 * A slot only: until the PO sends Jadarat LMS screenshots or its brand guide
 * (docs/design/visual-round-brief.md), every value is the current look's, so nothing changes. Do not
 * guess LMS colours. In the visual round (T-M2-04c), replace the palette, colour roles, fonts, radii
 * and shadows with the values taken from the material, keep every role of the contract, then run the
 * tests (contrast in light and dark, tokens.json agreement) and review it in Storybook
 * («Theme preview», Brand = Jadarat LMS) with the PO before it becomes the shipped theme.
 */
export const jadaratLmsTheme: ThemeDefinition = {
  ...jadaratTheme,
  id: 'jadarat-lms',
  name: { ar: 'جدارات LMS (بانتظار المواد)', en: 'Jadarat LMS (waiting for material)' },
  status: 'pending',
  source:
    'Waiting for Jadarat LMS screenshots or brand guide from the PO; same values as Jadarat until then',
};
