import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Accepting an invitation (FR-IAM-03, T-M2-07; screens 8 and 9) on the self-hosted stack
 * (infra/docker/smoke.sh reads the links from Mailpit). The flow tests are skipped unless the links are
 * provided:
 *   INVITE_E2E_ACCEPT_URL   accept link of a pending invitation for an e-mail WITHOUT an account
 *   INVITE_E2E_EXPIRED_URL  accept link of an expired invitation (optional)
 *   INVITE_E2E_REVOKED_URL  accept link of a revoked invitation (optional)
 * The referrer test runs everywhere (no database needed).
 */
const acceptUrl = process.env.INVITE_E2E_ACCEPT_URL;
const expiredUrl = process.env.INVITE_E2E_EXPIRED_URL;
const revokedUrl = process.env.INVITE_E2E_REVOKED_URL;

/**
 * The path, query and fragment of an e-mailed link (its host is APP_BASE_URL), in the requested
 * language. The token may travel in the query (`?token=`) or the fragment (`#token=`).
 */
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

test.describe('invitation link (no referrer)', () => {
  test('the accept page sends no referrer: header and meta tag', async ({ page }) => {
    const response = await page.goto(`/ar/invite/accept?token=${'x'.repeat(43)}`);
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  });
});

test.describe('accept an invitation', () => {
  test.skip(!acceptUrl, 'INVITE_E2E_ACCEPT_URL not set');
  test.describe.configure({ mode: 'serial' });

  test('Arabic: sets a password with live rules, lands signed in; the link is then used', async ({
    page,
  }) => {
    const url = inLocale(acceptUrl ?? '', 'ar');
    await page.goto(url);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('مرحبًا بك في');
    // The sign-in e-mail is shown, read-only, left-to-right.
    const email = page.getByLabel('اسم الدخول');
    await expect(email).toHaveAttribute('readonly', '');
    await expect(email).toHaveAttribute('dir', 'ltr');
    await expectNoSeriousA11yViolations(page);

    // Live password rules.
    const rules = page.locator('#invite-password-rules');
    await page.locator('#invite-password').fill('قصيرة');
    await expect(rules.getByText('12 حرفًا على الأقل')).toContainText('(غير متحقق بعد)');
    const password = `Invitee-${randomUUID()}`;
    await page.locator('#invite-password').fill(password);
    await expect(rules.getByText('12 حرفًا على الأقل')).toContainText('(متحقق)');
    await page.locator('#invite-password-confirm').fill(`${password}x`);
    await expect(rules.getByText('كلمتا المرور متطابقتان')).toContainText('(غير متحقق بعد)');
    await page.locator('#invite-password-confirm').fill(password);
    await expect(rules.getByText('كلمتا المرور متطابقتان')).toContainText('(متحقق)');

    // The privacy acknowledgement is required.
    await page.getByRole('button', { name: 'متابعة' }).click();
    await expect(page.getByText('يلزم الاطلاع على إشعار الخصوصية للمتابعة.')).toBeVisible();
    await page.getByTestId('invite-privacy').check();
    await page.getByRole('button', { name: 'متابعة' }).click();
    await expect(page).toHaveURL(/\/ar\/(suite|select-organization)$/);

    // The link is single-use: it now shows the "already used" state, in Arabic and English.
    await page.goto(url);
    await expect(page.getByTestId('invite-state-used')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الحساب جاهز بالفعل');
    await expectNoSeriousA11yViolations(page);
    await page.goto(inLocale(acceptUrl ?? '', 'en'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Your account is already set up',
    );
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  for (const locale of ['ar', 'en'] as const) {
    test(`${locale}: an unknown token shows the invalid-link state`, async ({ page }) => {
      await page.goto(`/${locale}/invite/accept?token=${'A'.repeat(43)}`);
      await expect(page.getByTestId('invite-state-invalid')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        locale === 'ar' ? 'رابط الدعوة غير صالح' : "This invitation link isn't valid",
      );
      await expectNoSeriousA11yViolations(page);
    });
  }
});

for (const [state, url, titles] of [
  ['expired', expiredUrl, { ar: 'انتهت صلاحية هذه الدعوة', en: 'This invitation has expired' }],
  [
    'revoked',
    revokedUrl,
    { ar: 'لم تعد هذه الدعوة صالحة', en: 'This invitation is no longer valid' },
  ],
] as const) {
  test.describe(`${state} invitation link`, () => {
    test.skip(!url, `INVITE_E2E_${state.toUpperCase()}_URL not set`);
    for (const locale of ['ar', 'en'] as const) {
      test(`${locale}: shows the ${state} state without a form`, async ({ page }) => {
        await page.goto(inLocale(url ?? '', locale));
        await expect(page.getByTestId(`invite-state-${state}`)).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titles[locale]);
        await expect(page.locator('input[type="password"]')).toHaveCount(0);
        await expectNoSeriousA11yViolations(page);
      });
    }
  });
}
