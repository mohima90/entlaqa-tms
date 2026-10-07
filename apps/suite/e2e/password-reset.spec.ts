import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Forgot / reset password (FR-IAM-13, T-M2-08; screens 10 and 11) on the self-hosted stack
 * (infra/docker/smoke.sh runs it in two steps and reads the link from Mailpit in between — from OUR
 * e-mail, sent by the worker through the notification service with PASSWORD_RESET_DELIVERY=worker,
 * T-M2-17; the smoke test also checks the "password changed" notice). The page and its answers are the
 * same whichever service sends the e-mail. The flow tests are skipped unless their variables are set:
 *   RESET_E2E_EMAIL         step 1: an account's e-mail — request a link through the forgot page
 *   RESET_E2E_LINK_URL      step 2: the reset link of the newest e-mail to that account
 *   RESET_E2E_NEW_PASSWORD  step 2: the new password to set (the smoke then signs in with it and checks
 *                           that the old one is refused)
 * The referrer test runs everywhere (no Auth needed).
 */
const resetEmail = process.env.RESET_E2E_EMAIL;
const linkUrl = process.env.RESET_E2E_LINK_URL;
const newPassword = process.env.RESET_E2E_NEW_PASSWORD;

/** The path and fragment of an e-mailed link (its host is the Auth site URL), in the given language. */
function inLocale(url: string, locale: 'ar' | 'en'): string {
  const { pathname, search, hash } = new URL(url, 'http://localhost');
  return `${pathname.replace(/^\/(ar|en)\//, `/${locale}/`)}${search}${hash}`;
}

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test.describe('reset link (no referrer)', () => {
  test('the reset page sends no referrer: header and meta tag', async ({ page }) => {
    const response = await page.goto(
      `/ar/reset-password#token_hash=${'0'.repeat(56)}&type=recovery`,
    );
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  });
});

test.describe('request a reset link', () => {
  test.skip(!resetEmail, 'RESET_E2E_EMAIL not set');

  test('Arabic: from sign-in to "the message is on its way", with the resend wait', async ({
    page,
  }) => {
    await page.goto('/ar/sign-in');
    await page.getByTestId('forgot-password-link').click();
    await expect(page).toHaveURL(/\/ar\/forgot-password$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('نسيت كلمة المرور؟');
    await expectNoSeriousA11yViolations(page);

    // A malformed address is refused before anything is sent.
    await page.getByLabel('البريد الإلكتروني').fill('not-an-address');
    await page.getByRole('button', { name: 'إرسال الرابط' }).click();
    await expect(page.getByText('يلزم إدخال بريد إلكتروني صحيح')).toBeVisible();

    await page.getByLabel('البريد الإلكتروني').fill(resetEmail ?? '');
    await page.getByRole('button', { name: 'إرسال الرابط' }).click();
    const sent = page.getByTestId('forgot-sent');
    await expect(sent).toBeVisible();
    await expect(sent.getByRole('heading', { level: 2 })).toHaveText('الرسالة في الطريق');
    await expect(sent).toContainText(resetEmail ?? '');
    await expect(sent).toContainText('60 دقيقة');
    // Send again only after a minute.
    await expect(page.getByTestId('forgot-resend')).toBeDisabled();
    await expect(page.getByTestId('forgot-resend')).toContainText('إعادة الإرسال (بعد');
    await expectNoSeriousA11yViolations(page);
  });

  test('English: an unknown address gets exactly the same answer (no account enumeration)', async ({
    page,
  }) => {
    const unknown = `nobody-${randomUUID()}@sovereign.example`;
    await page.goto('/en/forgot-password');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.getByLabel('Email').fill(unknown);
    await page.getByRole('button', { name: 'Send link' }).click();
    const sent = page.getByTestId('forgot-sent');
    await expect(sent.getByRole('heading', { level: 2 })).toHaveText('Check your email');
    await expect(sent).toContainText(`If ${unknown} has an account with us`);
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe('set a new password from the e-mailed link', () => {
  test.skip(!linkUrl || !newPassword, 'RESET_E2E_LINK_URL / RESET_E2E_NEW_PASSWORD not set');
  test.describe.configure({ mode: 'serial' });

  test('Arabic: live rules, saved, sent to sign-in with the notice; the link is then spent', async ({
    page,
  }) => {
    const url = inLocale(linkUrl ?? '', 'ar');
    await page.goto(url);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تعيين كلمة مرور جديدة');
    // The token left the address bar at once.
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    await expectNoSeriousA11yViolations(page);

    const rules = page.locator('#reset-password-rules');
    await page.locator('#reset-password').fill('قصيرة');
    await expect(rules.getByText('12 حرفًا على الأقل')).toContainText('(غير متحقق بعد)');
    // Too short: refused in the page, the single-use link is not spent.
    await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click();
    await expect(page.getByText('12 حرفًا على الأقل.')).toBeVisible();

    await page.locator('#reset-password').fill(newPassword ?? '');
    await page.locator('#reset-password-confirm').fill(newPassword ?? '');
    await expect(rules.getByText('كلمتا المرور متطابقتان')).toContainText('(متحقق)');
    await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click();
    await expect(page).toHaveURL(/\/ar\/sign-in\?notice=password-reset$/);
    await expect(page.getByTestId('password-reset-notice')).toContainText(
      'حُفظت كلمة المرور الجديدة',
    );
    await expectNoSeriousA11yViolations(page);
  });

  test('English: a second use of the same link asks for a new one', async ({ page }) => {
    await page.goto(inLocale(linkUrl ?? '', 'en'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    const again = `Again-${randomUUID()}`;
    await page.locator('#reset-password').fill(again);
    await page.locator('#reset-password-confirm').fill(again);
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByTestId('reset-link-invalid')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'This link has expired or was already used',
    );
    await expect(page.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/en/forgot-password',
    );
    await expectNoSeriousA11yViolations(page);
  });

  for (const locale of ['ar', 'en'] as const) {
    test(`${locale}: without a token the page asks for a new link at once`, async ({ page }) => {
      await page.goto(`/${locale}/reset-password`);
      await expect(page.getByTestId('reset-link-invalid')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        locale === 'ar'
          ? 'انتهت صلاحية الرابط أو استُخدم'
          : 'This link has expired or was already used',
      );
      await expectNoSeriousA11yViolations(page);
    });
  }
});
