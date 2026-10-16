import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { afterSignIn } from './sign-in';

/**
 * Accepting an invitation (FR-IAM-03, T-M2-07; screens 8 and 9; Kawadir's sign-up "join" screen, PO 16 Oct
 * 2026) on the self-hosted stack (infra/docker/smoke.sh reads the e-mailed links from Mailpit:
 * `/{locale}/sign-up#code=CODE`). The flow tests are skipped unless the links are provided:
 *   INVITE_E2E_ACCEPT_URL   link of a pending invitation for an e-mail WITHOUT an account
 *   INVITE_E2E_EXPIRED_URL  link of an expired invitation (optional)
 *   INVITE_E2E_REVOKED_URL  link of a revoked invitation (optional)
 * The referrer and forwarding tests run everywhere (no database needed). Copy link → sign up, the typed
 * code and resend: invitations.spec.ts.
 */
const acceptUrl = process.env.INVITE_E2E_ACCEPT_URL;
const expiredUrl = process.env.INVITE_E2E_EXPIRED_URL;
const revokedUrl = process.env.INVITE_E2E_REVOKED_URL;

/**
 * The path, query and fragment of an e-mailed link (its host is APP_BASE_URL), in the requested
 * language. The code travels in the fragment (`#code=`).
 */
function inLocale(url: string, locale: 'ar' | 'en'): string {
  const { pathname, search, hash } = new URL(url, 'http://localhost');
  return `${pathname.replace(/^\/(ar|en)\//, `/${locale}/`)}${search}${hash}`;
}

async function expectNoSeriousA11yViolations(page: Page) {
  // After an in-app navigation (router.replace + refresh) the framework swaps the page's <title> while the
  // new tree streams in: check the page once it has its title again (and fail if it never gets one).
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test.describe('invitation link (no referrer)', () => {
  test('the sign-up and the older accept page send no referrer: header and meta tag', async ({
    page,
  }) => {
    for (const path of ['/ar/sign-up', `/ar/invite/accept?token=${'x'.repeat(43)}`]) {
      const response = await page.goto(path);
      expect(response?.headers()['referrer-policy']).toBe('no-referrer');
      await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    }
  });

  test('an older #token= link is forwarded to the sign-up page with the token in the fragment', async ({
    page,
  }) => {
    const token = 'A'.repeat(43);
    await page.goto(`/en/invite/accept#token=${token}`);
    await expect(page).toHaveURL(/\/en\/sign-up$/);
    // The sign-up page took the token from the fragment and removed it from the address bar.
    expect(new URL(page.url()).hash).toBe('');
  });
});

test.describe('accept an invitation', () => {
  test.skip(!acceptUrl, 'INVITE_E2E_ACCEPT_URL not set');
  test.describe.configure({ mode: 'serial' });

  test('Arabic: the code comes with the link, live password rules, lands signed in; the link is then used', async ({
    page,
  }) => {
    const url = inLocale(acceptUrl ?? '', 'ar');
    await page.goto(url);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('انضم إلى');
    // The code is filled in from the link and locked; the fragment left the address bar.
    await expect(page.getByTestId('sign-up-code')).toHaveAttribute('readonly', '');
    // Shown grouped XXXX-XXXX-XXXX (12 symbols).
    await expect(page.getByTestId('sign-up-code')).toHaveValue(
      /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
    );
    await expect(page.getByTestId('sign-up-code-valid')).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
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
    const join = page.getByRole('button', { name: /^انضم إلى / });
    await join.click();
    await expect(page.getByText('يلزم الاطلاع على إشعار الخصوصية للمتابعة.')).toBeVisible();
    await page.getByTestId('invite-privacy').check();
    await join.click();
    await expect(page).toHaveURL(/\/ar\/(suite|select-organization)$/, afterSignIn);

    // The link is single-use: it now says so, in Arabic and English, with the way to sign in.
    await page.goto(url);
    await expect(page.getByTestId('invite-state-used')).toBeVisible();
    await expect(page.locator('#sign-up-code-error')).toContainText('استُخدمت هذه الدعوة من قبل');
    await expectNoSeriousA11yViolations(page);
    await page.goto(inLocale(acceptUrl ?? '', 'en'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('#sign-up-code-error')).toContainText(
      'This invitation was already used',
    );
    await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  for (const locale of ['ar', 'en'] as const) {
    test(`${locale}: an unknown code shows that it is not valid`, async ({ page }) => {
      await page.goto(`/${locale}/sign-up#code=AAAA-AAAA-AAAA`);
      const invalid =
        locale === 'ar'
          ? 'هذا الرمز غير صالح. تحقّق منه وحاول مرة أخرى.'
          : "This code isn't valid. Check it and try again.";
      await expect(page.locator('#sign-up-code-error')).toHaveText(invalid);
      // Announced through the live region too (review M3).
      await expect(page.locator('#sign-up-code-status')).toHaveText(invalid);
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      await expectNoSeriousA11yViolations(page);
    });
  }
});

for (const [state, url, texts] of [
  [
    'expired',
    expiredUrl,
    {
      ar: 'انتهت صلاحية هذه الدعوة. اطلب دعوة جديدة من مدير المنشأة.',
      en: "This invitation has expired. Ask your organization's administrator for a new one.",
    },
  ],
  [
    'revoked',
    revokedUrl,
    {
      ar: 'أُلغيت هذه الدعوة. تواصل مع مدير المنشأة.',
      en: "This invitation was cancelled. Contact your organization's administrator.",
    },
  ],
] as const) {
  test.describe(`${state} invitation link`, () => {
    test.skip(!url, `INVITE_E2E_${state.toUpperCase()}_URL not set`);
    for (const locale of ['ar', 'en'] as const) {
      test(`${locale}: shows the ${state} state without a form`, async ({ page }) => {
        await page.goto(inLocale(url ?? '', locale));
        await expect(page.locator('#sign-up-code-error')).toHaveText(texts[locale]);
        await expect(page.locator('input[type="password"]')).toHaveCount(0);
        await expectNoSeriousA11yViolations(page);
      });
    }
  });
}
