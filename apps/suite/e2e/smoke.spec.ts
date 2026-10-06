import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Smoke E2E (Development Plan §5.3 gates 7–8): Arabic + English render, `dir`, no console errors
 * (including CSP violations), no horizontal overflow at 390px, axe: 0 serious/critical violations.
 */
const pages = [
  { path: '/ar', lang: 'ar', dir: 'rtl', heading: 'نظام إدارة التدريب' },
  { path: '/en', lang: 'en', dir: 'ltr', heading: 'Training Management System' },
  { path: '/ar/suite', lang: 'ar', dir: 'rtl', heading: 'الرئيسية' },
  { path: '/en/suite', lang: 'en', dir: 'ltr', heading: 'Home' },
  { path: '/ar/sign-in', lang: 'ar', dir: 'rtl', heading: 'تسجيل الدخول' },
  { path: '/en/sign-in', lang: 'en', dir: 'ltr', heading: 'Sign in' },
  { path: '/ar/suite/admin/users', lang: 'ar', dir: 'rtl', heading: 'المستخدمون' },
  { path: '/en/suite/admin/users', lang: 'en', dir: 'ltr', heading: 'Users' },
  { path: '/ar/suite/profile', lang: 'ar', dir: 'rtl', heading: 'ملفي الشخصي' },
  { path: '/en/suite/profile', lang: 'en', dir: 'ltr', heading: 'My profile' },
  {
    path: '/ar/suite/admin/users/a1000000-0000-4000-8000-0000000000a1',
    lang: 'ar',
    dir: 'rtl',
    heading: 'المستخدمون',
  },
  {
    path: '/en/suite/admin/users/a1000000-0000-4000-8000-0000000000a1/edit',
    lang: 'en',
    dir: 'ltr',
    heading: 'Edit user details',
  },
  {
    path: '/ar/suite/admin/users/a1000000-0000-4000-8000-0000000000a1/roles',
    lang: 'ar',
    dir: 'rtl',
    heading: 'تعديل الأدوار',
  },
  { path: '/ar/suite/admin/roles', lang: 'ar', dir: 'rtl', heading: 'الأدوار والصلاحيات' },
  {
    path: '/en/suite/admin/roles?role=auditor',
    lang: 'en',
    dir: 'ltr',
    heading: 'Roles & permissions',
  },
] as const;

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  return errors;
}

for (const { path, lang, dir, heading } of pages) {
  test.describe(path, () => {
    test('renders in the right language and direction without console errors', async ({ page }) => {
      const errors = collectConsoleErrors(page);
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      await page.waitForLoadState('networkidle');
      expect(errors).toEqual([]);
    });

    test('sends security headers with a per-request CSP nonce', async ({ page }) => {
      const response = await page.goto(path);
      const headers = response?.headers() ?? {};
      expect(headers['content-security-policy']).toMatch(
        /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
      );
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(headers['strict-transport-security']).toContain('max-age=');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['permissions-policy']).toContain('camera=()');
      expect(headers['x-powered-by']).toBeUndefined();
    });

    test('has no horizontal overflow', async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('has no serious or critical accessibility violations (axe)', async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
    });
  });
}

test('the root redirects to Arabic', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('the language toggle switches between Arabic and English on the same page', async ({
  page,
}) => {
  await page.goto('/ar/suite');
  await page.getByTestId('language-toggle').click();
  await expect(page).toHaveURL(/\/en\/suite$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByTestId('language-toggle').click();
  await expect(page).toHaveURL(/\/ar\/suite$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('shows the "not configured" state when Supabase is not configured', async ({ page }) => {
  await page.goto('/en');
  await expect(page.getByTestId('config-status')).toContainText('not configured');
});

test('the sign-in form is disabled and explains why when sign-in is not configured', async ({
  page,
}) => {
  await page.goto('/en/sign-in');
  await expect(page.getByTestId('auth-not-configured')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
});

test('the skip link is the first focusable element and targets main', async ({ page }) => {
  await page.goto('/ar/suite');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toHaveAttribute('href', '#main');
  await expect(focused).toHaveText('تخطَّ إلى المحتوى');
});

test('the users pages explain that they need a configured environment (preview)', async ({
  page,
  isMobile,
}) => {
  if (isMobile) {
    // The side navigation is desktop-only for now (AppShell); open the page directly.
    await page.goto('/en/suite/admin/users');
  } else {
    await page.goto('/en/suite');
    await page.getByRole('link', { name: 'Users' }).click();
    await expect(page.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
  }
  await expect(page).toHaveURL(/\/en\/suite\/admin\/users$/);
  await expect(page.getByTestId('users-not-configured')).toContainText('connected to the database');
  await page.getByTestId('language-toggle').click();
  await expect(page).toHaveURL(/\/ar\/suite\/admin\/users$/);
});
