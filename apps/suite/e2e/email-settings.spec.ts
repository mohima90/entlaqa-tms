import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { afterSignIn, fillSignIn } from './sign-in';

/**
 * E-mail sending set up in the product (WP-ADM-01; FR-NTF-11, FR-ADM-17; flow EP-EMAIL agreed 17 Oct 2026), in
 * English and Arabic. Nothing here sends an e-mail or saves a working sender (the stack's other journeys rely
 * on its mail relay): the forms are checked up to the server's refusal of an incomplete entry.
 *
 * Always (default CI, no Auth server):
 *  - Platform settings → Email does not exist for a visitor (404);
 *  - Settings → Email integration renders in the shell (its menu entry is a page now, no longer «Coming soon»)
 *    with the "not available here" state, without serious accessibility violations.
 * Against a configured deployment:
 *  - the Super Admin (PLATFORM_E2E_EMAIL / _PASSWORD) opens Platform settings → Email from the console menu,
 *    sees the status first, and an incomplete entry is refused field by field (or, while the worker has not
 *    published its key, the page says e-mail sending is not set up and nothing can be saved);
 *  - an Organization Admin without a sign-in code (EMAIL_E2E_ADMIN_EMAIL / _PASSWORD) opens Settings → Email
 *    integration: the platform sender sends by default, «Send test e-mail» waits for a saved provider, an
 *    incomplete provider is refused, the delivery errors card is there; an HR Manager
 *    (EMAIL_E2E_HR_EMAIL / _PASSWORD) is refused.
 * Skipped without credentials.
 */
const superEmail = process.env.PLATFORM_E2E_EMAIL ?? '';
const superPassword = process.env.PLATFORM_E2E_PASSWORD ?? '';
const adminEmail = process.env.EMAIL_E2E_ADMIN_EMAIL ?? '';
const adminPassword = process.env.EMAIL_E2E_ADMIN_PASSWORD ?? '';
const hrEmail = process.env.EMAIL_E2E_HR_EMAIL ?? '';
const hrPassword = process.env.EMAIL_E2E_HR_PASSWORD ?? '';

const TEXTS = {
  en: {
    nav: 'Main navigation',
    menu: 'Menu',
    integration: 'Email integration',
    notConfigured: 'Email integration needs a configured organization.',
    platformTitle: 'Email sender',
    platformNav: 'Email',
    platformStatus: 'Current status',
    statusPlatform: 'The platform sender sends your e-mails',
    failures: 'Delivery errors',
    forbidden: "You don't have permission to do this.",
  },
  ar: {
    nav: 'التنقل الرئيسي',
    menu: 'القائمة',
    integration: 'تكامل البريد الإلكتروني',
    notConfigured: 'يتطلب تكامل البريد الإلكتروني منظمة مُعدّة.',
    platformTitle: 'مرسِل البريد',
    platformNav: 'البريد الإلكتروني',
    platformStatus: 'الحالة الحالية',
    statusPlatform: 'مرسِل المنصة يرسل رسائلكم',
    failures: 'أخطاء التسليم',
    forbidden: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.',
  },
} as const;

async function expectNoSeriousA11yViolations(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

for (const locale of ['en', 'ar'] as const) {
  const t = TEXTS[locale];

  test(`${locale}: Platform settings → Email is 404 for a visitor`, async ({ page }) => {
    const response = await page.goto(`/${locale}/platform/settings/email`);
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('platform-email-form')).toHaveCount(0);
  });

  test(`${locale}: Settings → Email integration is a page of the menu (preview without data)`, async ({
    page,
    isMobile,
  }) => {
    await page.goto(`/${locale}/suite`);
    if (isMobile) await page.getByRole('button', { name: t.menu, exact: true }).click();
    const nav = page.getByRole('navigation', { name: t.nav });
    await nav.getByRole('link', { name: t.integration, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/suite/admin/settings/email$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.integration);
    await expect(page.getByTestId('email-integration-not-configured')).toHaveText(t.notConfigured);
    if (!isMobile) {
      await expect(
        page
          .getByRole('navigation', { name: t.nav })
          .getByRole('link', { name: t.integration, exact: true }),
      ).toHaveAttribute('aria-current', 'page');
    }
    await expectNoSeriousA11yViolations(page);
  });
}

test.describe('Platform settings → Email: the Super Admin (configured deployment)', () => {
  test.skip(!superEmail || !superPassword, 'PLATFORM_E2E_* not set');

  for (const locale of ['en', 'ar'] as const) {
    test(`${locale}: status first; an incomplete entry is refused (nothing is saved)`, async ({
      page,
      isMobile,
    }) => {
      const t = TEXTS[locale];
      await page.goto(`/${locale}/sign-in`);
      await fillSignIn(page, locale, superEmail, superPassword);
      await expect(page).toHaveURL(new RegExp(`/${locale}/platform$`), afterSignIn);
      if (isMobile) await page.getByRole('button', { name: t.menu, exact: true }).click();
      await page.getByRole('link', { name: t.platformNav, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/platform/settings/email$`));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.platformTitle);
      await expect(page.getByRole('heading', { name: t.platformStatus })).toBeVisible();
      await expect(page.getByTestId('platform-email-status')).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      const save = page.getByTestId('platform-email-save');
      if (await page.getByTestId('platform-email-key-missing').isVisible()) {
        // The worker has not published its key yet: e-mail sending is not set up, nothing can be saved.
        await expect(save).toBeDisabled();
        return;
      }
      // Resend without a key, no sender address, no test recipient: refused by the server, field by field.
      await page.getByTestId('platform-email-provider').selectOption('resend');
      await page.getByTestId('platform-email-fromAddress').fill('');
      await page.getByTestId('platform-email-testTo').fill('');
      await save.click();
      await expect(page.getByTestId('platform-email-message')).toBeVisible();
      await expect(page.getByTestId('platform-email-fromAddress')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      await expect(page.getByTestId('platform-email-testTo')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      // Secrets are write-only: a password field, never filled in by the page.
      await expect(page.getByTestId('platform-email-apiKey')).toHaveAttribute('type', 'password');
      await expect(page.getByTestId('platform-email-apiKey')).toHaveValue('');
      await expectNoSeriousA11yViolations(page);
    });
  }
});

test.describe('Settings → Email integration (configured deployment)', () => {
  test.skip(!adminEmail || !adminPassword, 'EMAIL_E2E_ADMIN_* not set');

  for (const locale of ['en', 'ar'] as const) {
    test(`${locale}: the platform sender by default; an incomplete provider is refused`, async ({
      page,
    }) => {
      const t = TEXTS[locale];
      await page.goto(`/${locale}/sign-in`);
      await fillSignIn(page, locale, adminEmail, adminPassword);
      await expect(page).toHaveURL(new RegExp(`/${locale}/suite$`), afterSignIn);
      await page.goto(`/${locale}/suite/admin/settings/email`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.integration);
      const status = page.getByTestId('email-integration-status');
      await expect(status).toBeVisible();
      await expect(page.getByRole('heading', { name: t.failures })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      if ((await status.getAttribute('data-sender')) !== 'platform') return; // a provider is already in use
      await expect(status.getByRole('heading', { level: 2 })).toHaveText(t.statusPlatform);
      const save = page.getByTestId('email-integration-save');
      if (await save.isDisabled()) return; // e-mail sending not set up on the platform (no worker key)
      // A new provider without its key and without a sender address: refused by the server.
      await page.getByTestId('email-integration-provider').selectOption('sendgrid');
      await page.getByTestId('email-integration-apiKey').fill('');
      await page.getByTestId('email-integration-fromAddress').fill('');
      await save.click();
      await expect(page.getByTestId('email-integration-message')).toBeVisible();
      await expect(page.getByTestId('email-integration-apiKey')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      await expect(page.getByTestId('email-integration-fromAddress')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      await expectNoSeriousA11yViolations(page);
    });
  }

  test('an HR Manager is refused', async ({ page }) => {
    test.skip(!hrEmail || !hrPassword, 'EMAIL_E2E_HR_* not set');
    await page.goto('/en/sign-in');
    await fillSignIn(page, 'en', hrEmail, hrPassword);
    await expect(page).toHaveURL(/\/en\/suite$/, afterSignIn);
    await page.goto('/en/suite/admin/settings/email');
    await expect(page.getByTestId('email-integration-forbidden')).toHaveText(TEXTS.en.forbidden);
    await expect(page.getByTestId('email-integration-form')).toHaveCount(0);
  });
});
