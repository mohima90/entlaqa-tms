import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { expectReadableTables } from './tables';

/**
 * Smoke E2E (Development Plan §5.3 gates 7–8): Arabic + English render, `dir`, no console errors
 * (including CSP violations), no horizontal overflow at 390px, axe: 0 serious/critical violations.
 */
const pages = [
  { path: '/ar', lang: 'ar', dir: 'rtl', heading: 'نظام إدارة التدريب' },
  { path: '/en', lang: 'en', dir: 'ltr', heading: 'Training Management System' },
  { path: '/ar/suite', lang: 'ar', dir: 'rtl', heading: 'الرئيسية' },
  { path: '/en/suite', lang: 'en', dir: 'ltr', heading: 'Home' },
  // Kawadir's sign-in (PO, 16 Oct 2026): «مرحبًا بعودتك» / "Welcome back".
  { path: '/ar/sign-in', lang: 'ar', dir: 'rtl', heading: 'مرحبًا بعودتك' },
  { path: '/en/sign-in', lang: 'en', dir: 'ltr', heading: 'Welcome back' },
  // Join with an invitation code (Kawadir's sign-up): without Auth configured it says so.
  { path: '/ar/sign-up', lang: 'ar', dir: 'rtl', heading: 'انضم إلى منشأتك' },
  { path: '/en/sign-up', lang: 'en', dir: 'ltr', heading: 'Join your organization' },
  { path: '/ar/forgot-password', lang: 'ar', dir: 'rtl', heading: 'نسيت كلمة المرور؟' },
  { path: '/en/forgot-password', lang: 'en', dir: 'ltr', heading: 'Forgot your password?' },
  // Without Auth configured (CI) the reset page says so; the flow runs on the self-hosted stack.
  { path: '/ar/reset-password', lang: 'ar', dir: 'rtl', heading: 'تعيين كلمة مرور جديدة' },
  { path: '/en/reset-password', lang: 'en', dir: 'ltr', heading: 'Set a new password' },
  { path: '/ar/suite/admin/users', lang: 'ar', dir: 'rtl', heading: 'أعضاء الفريق' },
  { path: '/en/suite/admin/users', lang: 'en', dir: 'ltr', heading: 'Team members' },
  { path: '/ar/suite/profile', lang: 'ar', dir: 'rtl', heading: 'ملفي الشخصي' },
  { path: '/en/suite/profile', lang: 'en', dir: 'ltr', heading: 'My profile' },
  {
    path: '/ar/suite/admin/users/a1000000-0000-4000-8000-0000000000a1',
    lang: 'ar',
    dir: 'rtl',
    heading: 'أعضاء الفريق',
  },
  {
    // Since redesign package 3 the edit, role and deactivation addresses open their panel over the
    // profile; without data the profile frame says the page needs a configured environment.
    path: '/en/suite/admin/users/a1000000-0000-4000-8000-0000000000a1/edit',
    lang: 'en',
    dir: 'ltr',
    heading: 'Team members',
  },
  {
    path: '/ar/suite/admin/users/a1000000-0000-4000-8000-0000000000a1/roles',
    lang: 'ar',
    dir: 'rtl',
    heading: 'أعضاء الفريق',
  },
  { path: '/ar/suite/admin/roles', lang: 'ar', dir: 'rtl', heading: 'الأدوار والصلاحيات' },
  // Settings → General (organization profile, T-M2-22; Kawadir layout, T-M2-43): the frame and the
  // "not available here" state without a database.
  { path: '/ar/suite/admin/settings', lang: 'ar', dir: 'rtl', heading: 'الإعدادات العامة' },
  { path: '/en/suite/admin/settings', lang: 'en', dir: 'ltr', heading: 'General settings' },
  // Organization → Branding (WP-ADM-02): the page in preview mode without a database.
  { path: '/en/suite/admin/branding', lang: 'en', dir: 'ltr', heading: 'Branding' },
  { path: '/ar/suite/admin/branding', lang: 'ar', dir: 'rtl', heading: 'الهوية البصرية' },
  // Organization → Grades (WP-ADM-04): the page in preview mode without a database.
  { path: '/en/suite/admin/grades', lang: 'en', dir: 'ltr', heading: 'Grades' },
  { path: '/ar/suite/admin/grades', lang: 'ar', dir: 'rtl', heading: 'الدرجات الوظيفية' },
  // Settings → Email integration (WP-ADM-01): the frame and the "not available here" state without a database.
  { path: '/en/suite/admin/settings/email', lang: 'en', dir: 'ltr', heading: 'Email integration' },
  {
    path: '/ar/suite/admin/settings/email',
    lang: 'ar',
    dir: 'rtl',
    heading: 'تكامل البريد الإلكتروني',
  },
  // A standard role's page (EP-ROLES): view only, without a database too.
  { path: '/en/suite/admin/roles/hr_manager', lang: 'en', dir: 'ltr', heading: 'HR Manager' },
  { path: '/ar/suite/admin/roles/learner', lang: 'ar', dir: 'rtl', heading: 'موظف' },
  { path: '/en/suite/admin/roles/new', lang: 'en', dir: 'ltr', heading: 'Create role' },
  // Planning → Needs forms (T-M3-10), the library on the preview copy.
  { path: '/ar/suite/planning/needs-forms', lang: 'ar', dir: 'rtl', heading: 'نماذج الاحتياجات' },
  { path: '/en/suite/planning/needs-forms', lang: 'en', dir: 'ltr', heading: 'Needs forms' },
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
      // Pages whose link carries a token send no referrer at all (security-headers.ts SECRET_URL_PAGES).
      expect(headers['referrer-policy']).toBe(
        path.endsWith('/reset-password') || path.endsWith('/sign-up')
          ? 'no-referrer'
          : 'strict-origin-when-cross-origin',
      );
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

test('the root redirects to English, the default for now (PO, 14 Oct 2026)', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('an Arabic browser still lands in English at the root, and Arabic stays one click away', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'ar-SA' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/en$/);
  await page.getByTestId('language-toggle').click();
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await context.close();
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

test('the sign-in form cannot be submitted and explains why when sign-in is not configured', async ({
  page,
}) => {
  await page.goto('/en/sign-in');
  await expect(page.getByTestId('auth-not-configured')).toBeVisible();
  // The e-mail step asks nothing of the server; the password step cannot be used.
  await page.locator('#email').fill('someone@example.com');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#password')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
});

// Kawadir's two steps (PO, 16 Oct 2026): the e-mail first (a typo is caught before the password step),
// then the password with «نسيت؟» next to its label; "Change" goes back with the address kept.
for (const t of [
  {
    locale: 'ar',
    continue: 'متابعة',
    invalid: 'أدخل بريدًا إلكترونيًا مثل name@company.com.',
    change: 'تغيير البريد الإلكتروني',
    forgot: 'نسيت؟',
    join: 'انضم بالرمز',
  },
  {
    locale: 'en',
    continue: 'Continue',
    invalid: 'Enter an email address such as name@company.com.',
    change: 'Change the email',
    forgot: 'Forgot?',
    join: 'Join with your code',
  },
] as const) {
  test(`${t.locale}: sign-in asks for the e-mail first, then the password`, async ({ page }) => {
    await page.goto(`/${t.locale}/sign-in`);
    await expect(page.locator('#password')).toHaveCount(0);
    // Direction C: the main button is never disabled — pressed with nothing typed, it says so on the field.
    const next = page.getByRole('button', { name: t.continue });
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page.locator('#email-error')).toHaveText(t.invalid);
    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#email')).toBeFocused();
    await expect(page.getByRole('link', { name: t.join })).toHaveAttribute(
      'href',
      `/${t.locale}/sign-up`,
    );
    await page.locator('#email').fill('not-an-address');
    await page.getByRole('button', { name: t.continue }).click();
    await expect(page.locator('#email-error')).toHaveText(t.invalid);
    await page.locator('#email').fill('noura@raya.example');
    await page.getByRole('button', { name: t.continue }).click();
    await expect(page.getByTestId('sign-in-email')).toHaveText('noura@raya.example');
    // (Focus moves to the password where sign-in is configured: e2e/sign-in-limits.spec.ts; here the
    // field is disabled, sign-in not being configured.)
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByTestId('forgot-password-link')).toHaveText(t.forgot);
    await page.getByRole('button', { name: t.change }).click();
    await expect(page.locator('#email')).toHaveValue('noura@raya.example');
    await expect(page.locator('#email')).toBeFocused();
  });
}

// «تذكّر هذا المتصفح» (T-M2-11, PO decision 9 Oct 2026: opt-in): a labelled check box, unticked by default,
// its explanation announced with it. Using it end to end (keyboard, trust, lock): e2e/sign-in-limits.spec.ts
// on the self-hosted stack.
for (const { locale, label, hint } of [
  {
    locale: 'ar',
    label: 'تذكّر هذا المتصفح',
    hint: 'يبقى بإمكانك الدخول من هذا المتصفح 30 يومًا حتى إن أُوقف تسجيل الدخول إلى حسابك مؤقتًا بسبب محاولات من مكان آخر. لا تختره على جهاز مشترك.',
  },
  {
    locale: 'en',
    label: 'Remember this browser',
    hint: "For 30 days, you can still sign in from this browser even if sign-in to your account is paused after attempts from elsewhere. Don't tick this on a shared computer.",
  },
] as const) {
  test(`${locale}: the sign-in page offers «Remember this browser», unticked and described`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/sign-in`);
    await page.locator('#email').fill('someone@example.com');
    await page.getByRole('button', { name: locale === 'ar' ? 'متابعة' : 'Continue' }).click();
    const box = page.getByRole('checkbox', { name: label, exact: true });
    await expect(box).toHaveCount(1);
    await expect(box).not.toBeChecked();
    await expect(box).toHaveAccessibleDescription(hint);
  });
}

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
  await page.goto('/en/suite');
  // On a phone the navigation is behind the menu button (T-M2-21).
  // (The preview home also links to Team members from its set-up card: use the navigation's entry.)
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
  await navigation.getByRole('link', { name: 'Team members' }).click();
  await expect(page).toHaveURL(/\/en\/suite\/admin\/users$/);
  if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
  await expect(navigation.getByRole('link', { name: 'Team members' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  if (isMobile) await page.keyboard.press('Escape');
  await expect(page.getByTestId('users-not-configured')).toContainText('connected to the database');
  await page.getByTestId('language-toggle').click();
  await expect(page).toHaveURL(/\/ar\/suite\/admin\/users$/);
});

// The approved shell (T-M2-21): navigation at the inline-start edge, a drawer on phones.
for (const { locale, menu, close, home } of [
  { locale: 'en', menu: 'Menu', close: 'Close menu', home: 'Home' },
  { locale: 'ar', menu: 'القائمة', close: 'إغلاق القائمة', home: 'الرئيسية' },
] as const) {
  test(`${locale}: the navigation sits at the inline-start edge (desktop) or opens as a drawer (phone)`, async ({
    page,
    isMobile,
  }) => {
    await page.goto(`/${locale}/suite`);
    const navigation = page.locator('#app-navigation');
    const menuButton = page.getByRole('button', { name: menu, exact: true });
    if (!isMobile) {
      await expect(menuButton).toBeHidden();
      await expect(navigation).toBeVisible();
      const box = await navigation.boundingBox();
      const width = await page.evaluate(() => document.documentElement.clientWidth);
      // Left in English, right in Arabic.
      if (locale === 'en') expect(box?.x ?? -1).toBe(0);
      else expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(width);
      await expect(navigation.getByRole('link', { name: home })).toHaveAttribute(
        'aria-current',
        'page',
      );
      return;
    }
    // Phone: closed, then a disclosure that moves focus in and gives it back.
    await expect(navigation).toBeHidden();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    const size = await menuButton.boundingBox();
    expect(size?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(size?.height ?? 0).toBeGreaterThanOrEqual(44);
    await menuButton.click();
    await expect(navigation).toBeVisible();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: close })).toBeFocused();
    // Open, the drawer is a modal dialog named like the menu button; the page behind it (skip link
    // included) is inert.
    const dialog = page.getByRole('dialog', { name: menu });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(await page.locator('main#main').evaluate((el) => el.closest('[inert]') !== null)).toBe(
      true,
    );
    await expect(page.locator('a[href="#main"]')).toHaveAttribute('inert', '');
    // Tab loops inside: from the last entry back to the close button, and Shift+Tab the other way.
    const entries = dialog.locator('a[href], button');
    await entries.last().focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: close })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(entries.last()).toBeFocused();
    // A modal opened over the drawer (e.g. the idle-session warning) keeps its own Tab order.
    await page.evaluate(() => {
      const modal = document.createElement('dialog');
      modal.id = 'over-drawer';
      for (const label of ['First', 'Second']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        modal.append(button);
      }
      document.body.append(modal);
      modal.showModal();
    });
    const overDrawer = page.locator('#over-drawer');
    await expect(overDrawer.getByRole('button', { name: 'First' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(overDrawer.getByRole('button', { name: 'Second' })).toBeFocused();
    await page.evaluate(() => {
      const modal = document.querySelector<HTMLDialogElement>('#over-drawer');
      modal?.close();
      modal?.remove();
    });
    await expect(navigation).toBeVisible();
    await page.getByRole('button', { name: close }).focus();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.help} (${v.nodes.length})`),
    ).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(navigation).toBeHidden();
    await expect(menuButton).toBeFocused();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    // The close button closes it too.
    await menuButton.click();
    await page.getByRole('button', { name: close }).click();
    await expect(navigation).toBeHidden();
    await expect(menuButton).toBeFocused();
    // Widening the window with the drawer open: the navigation stays in place, no longer a dialog,
    // and focus moves from the (now hidden) close button to the current entry, not to the body.
    await menuButton.click();
    await expect(page.getByRole('button', { name: close })).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(navigation).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(navigation.getByRole('link', { name: home })).toBeFocused();
  });
}

// Tables on phones and desktops (T-M2-21): the roles matrix (its own tab since redesign package 3) renders
// without data in the preview.
for (const locale of ['en', 'ar'] as const) {
  test(`${locale}: table cells never break inside a word, and wide tables scroll in their box`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/suite/admin/roles/hr_manager?tab=across`);
    await expectReadableTables(page);
  });
}
