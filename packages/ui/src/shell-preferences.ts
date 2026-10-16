/**
 * Per-device preferences of the suite shell (Kawadir: theme light / dark / system, sidebar collapsed),
 * kept in first-party cookies so the server renders the page in the right state at once (no flash, no
 * inline script — the CSP allows none). Not personal data; never used for authorization.
 */
export type ThemeMode = 'light' | 'dark' | 'system';
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];
export const THEME_COOKIE = 'jadarat_theme';
export const NAV_COOKIE = 'jadarat_nav';
const ONE_YEAR = 60 * 60 * 24 * 365;

/** A cookie value → a theme mode; anything else (absent, tampered) → `system`. */
export function parseThemeMode(value: string | null | undefined): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** The `data-theme` attribute for <html>: none for `system` (the tokens then follow the OS). */
export function themeAttribute(mode: ThemeMode): 'light' | 'dark' | undefined {
  return mode === 'system' ? undefined : mode;
}

/** The navigation is collapsed only when the cookie says so (expanded by default). */
export function parseNavCollapsed(value: string | null | undefined): boolean {
  return value === 'collapsed';
}

/** A `Set-Cookie`-style string for `document.cookie` (Secure on https). */
export function preferenceCookie(name: string, value: string, secure: boolean): string {
  return `${name}=${value}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function writeCookie(name: string, value: string) {
  document.cookie = preferenceCookie(name, value, window.location.protocol === 'https:');
}

/** Applies a theme mode to the page now and remembers it on this device. */
export function applyThemeMode(mode: ThemeMode) {
  const attribute = themeAttribute(mode);
  if (attribute) document.documentElement.dataset.theme = attribute;
  else delete document.documentElement.dataset.theme;
  writeCookie(THEME_COOKIE, mode);
}

/** Remembers the navigation state on this device. */
export function rememberNavCollapsed(collapsed: boolean) {
  writeCookie(NAV_COOKIE, collapsed ? 'collapsed' : 'expanded');
}
