/**
 * @jadarat/ui/theme — the theme layer (T-M2-04c): contract, themes, contrast checks and organization
 * brand colours (FR-ADM-07). Pure TypeScript (no React, no DOM): usable on the server.
 * Architecture: docs/design/theming.md.
 */
export {
  type Hex,
  contrastRatio,
  displayRatio,
  mix,
  normalizeHex,
  relativeLuminance,
} from './color';
export {
  BRAND_ROLES,
  COLOR_ROLES,
  CONTRAST_PAIRS,
  CONTRAST_USE_LABEL,
  type ColorMode,
  type ColorRole,
  type ContrastPair,
  type ContrastUse,
  type ThemeDefinition,
  type TokenValue,
} from './contract';
export { brandLayerCss, fontStack, themeCss } from './css';
export {
  type BrandAdjustment,
  InvalidBrandColorError,
  type OrganizationBrand,
  type OrganizationBrandInput,
  deriveOrganizationBrand,
} from './organization-brand';
export {
  type BrandLayer,
  type ContrastResult,
  checkContrast,
  checkTheme,
  resolveThemeColors,
} from './resolve';
export { jadaratLmsTheme } from './themes/jadarat-lms';
export { jadaratTheme } from './themes/jadarat';

import { jadaratLmsTheme } from './themes/jadarat-lms';
import { jadaratTheme } from './themes/jadarat';

/** The theme the product ships today (its CSS: docs/design/tokens/themes/jadarat.css). */
export const SHIPPED_THEME = jadaratTheme;

/** Every theme, for previews and tests. */
export const THEMES = [jadaratTheme, jadaratLmsTheme] as const;
