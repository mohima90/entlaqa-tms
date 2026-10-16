// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { NAV_COOKIE, THEME_COOKIE } from './index';
import { applyThemeMode, rememberNavCollapsed } from './shell-preferences';

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe('shell preferences in the browser (T-M2-43)', () => {
  it('applies an explicit theme to <html> at once and remembers it on this device', () => {
    applyThemeMode('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
    applyThemeMode('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.cookie).toContain(`${THEME_COOKIE}=light`);
  });

  it('removes data-theme for the system setting (the tokens follow prefers-color-scheme)', () => {
    applyThemeMode('dark');
    applyThemeMode('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.cookie).toContain(`${THEME_COOKIE}=system`);
  });

  it('remembers the navigation state', () => {
    rememberNavCollapsed(true);
    expect(document.cookie).toContain(`${NAV_COOKIE}=collapsed`);
    rememberNavCollapsed(false);
    expect(document.cookie).toContain(`${NAV_COOKIE}=expanded`);
    expect(document.cookie).not.toContain(`${NAV_COOKIE}=collapsed`);
  });
});
