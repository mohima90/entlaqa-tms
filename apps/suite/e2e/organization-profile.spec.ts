import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { afterSignIn } from './sign-in';
import { freshCode } from './totp';

/**
 * Settings → General — the organization profile and regional settings (approved screen «بيانات المنشأة»; since T-M2-43 «الإعدادات العامة» / "General settings",
 * PO 14 Oct 2026; FR-ADM-02, FR-SCH-07; T-M2-22) on the self-hosted stack (infra/docker/smoke.sh, after
 * the security journey: the smoke organization requires an authenticator code at sign-in, so the
 * Organization Admin signs in with one; saving itself needs no code — PO decision, 14 Oct 2026). In English
 * and Arabic:
 *  - the Organization Admin opens the page from the menu (no longer «Coming soon»), sees a field error and
 *    keeps what was typed, picks a country (its suggestions fill in), saves; the new display name shows in
 *    the menu and the users list shows dates in the chosen display (Gregorian + Hijri, then Hijri);
 *  - the page reads well at phone width and has no serious accessibility violation;
 *  - an HR Manager (another organization, no code needed there) has no menu entry and is refused.
 * Skipped without credentials (default CI run).
 */
const adminEmail = process.env.ORG_PROFILE_E2E_EMAIL ?? '';
const adminPassword = process.env.ORG_PROFILE_E2E_PASSWORD ?? '';
/** The Organization Admin's authenticator set-up key (the smoke reads it from Auth; never printed). */
const adminKey = process.env.ORG_PROFILE_E2E_TOTP_KEY ?? '';
const hrEmail = process.env.ORG_PROFILE_E2E_HR_EMAIL ?? '';
const hrPassword = process.env.ORG_PROFILE_E2E_HR_PASSWORD ?? '';

const EN_NAME = 'Sovereign Smoke Holding';
const AR_NAME = 'شركة الاختبار السيادي القابضة';

async function signIn(page: Page, locale: 'ar' | 'en', email: string, secret: string) {
  await page.goto(`/${locale}/sign-in`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(secret);
  await page.getByRole('button', { name: locale === 'ar' ? 'تسجيل الدخول' : 'Sign in' }).click();
}

/** Password, then the authenticator code the organization requires at sign-in (its MFA policy). */
async function signInWithCode(page: Page, locale: 'ar' | 'en') {
  await signIn(page, locale, adminEmail, adminPassword);
  await expect(page).toHaveURL(new RegExp(`/${locale}/mfa$`), afterSignIn);
  await page.getByTestId('mfa-code').fill(await freshCode(adminKey));
  await page.getByTestId('mfa-code-submit').click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/suite$`), afterSignIn);
}

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

test.describe('organization profile', () => {
  test.skip(!adminEmail || !adminPassword || !adminKey, 'ORG_PROFILE_E2E_* not set');
  test.describe.configure({ mode: 'serial' });

  test('English: the Organization Admin edits and saves; the menu and the users list follow', async ({
    page,
  }) => {
    await signInWithCode(page, 'en');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('link', { name: 'General', exact: true }).click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/settings$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('General settings');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
      'Settings/General settings',
    );
    await expect(nav.getByRole('link', { name: 'General', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Provisioned without industry or country (nothing guessed); the defaults of the backfill.
    await expect(page.getByTestId('org-industry')).toHaveValue('');
    await expect(page.getByTestId('org-countryCode')).toHaveValue('');
    await expect(page.getByTestId('org-display-gregorian')).toBeChecked();
    await expect(page.getByTestId('organization-read-only')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    // A field error: announced, tied to its field, and nothing typed is lost.
    await page.getByTestId('org-nameEn').fill('   ');
    await page.getByTestId('org-nameAr').fill(AR_NAME);
    await page.getByTestId('org-workStartsAt').fill('17:00');
    await page.getByTestId('organization-save').click();
    await expect(page.getByTestId('organization-message')).toHaveAttribute('role', 'alert');
    // The first field with an error has the focus (review L4).
    await expect(page.getByTestId('org-nameEn')).toBeFocused();
    await expect(page.getByTestId('org-nameEn')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#org-nameEn-error')).toHaveText('Enter the display name.');
    await expect(page.getByTestId('org-nameEn')).toHaveAttribute(
      'aria-describedby',
      /org-nameEn-error/,
    );
    await expect(page.locator('#org-workEndsAt-error')).toHaveText(
      'The end must be after the start.',
    );
    await expect(page.locator('#org-industry-error')).toHaveText('Choose an industry.');
    await expect(page.locator('#org-countryCode-error')).toHaveText('Choose a country.');
    await expect(page.getByTestId('org-nameAr')).toHaveValue(AR_NAME);
    await expectNoSeriousA11yViolations(page);

    // Country fills in the rest (suggestions only, applied when the country changes).
    await page.getByTestId('org-nameEn').fill(EN_NAME);
    await page.getByTestId('org-workStartsAt').fill('٠٨:٠٠'); // Arabic digits are accepted
    await page.getByTestId('org-industry').selectOption('banking_financial');
    await page.getByTestId('org-currencyCode').selectOption('USD');
    await page.getByTestId('org-countryCode').selectOption('SA');
    await expect(page.getByTestId('org-preset-note')).toHaveText(
      'Suggestions for Saudi Arabia filled in. Check them, then save.',
    );
    await expect(page.getByTestId('org-currencyCode')).toHaveValue('SAR');
    await expect(page.getByTestId('org-timeZone')).toHaveValue('Asia/Riyadh');
    await expect(page.getByTestId('org-display-dual')).toBeChecked();
    await expect(page.getByTestId('org-date-preview')).toContainText(' · ');
    await expect(page.getByTestId('org-date-preview')).toContainText('AH');
    for (const day of ['0', '1', '2', '3', '4']) {
      await expect(page.getByTestId(`org-day-${day}`)).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(page.getByTestId('org-day-5')).toHaveAttribute('aria-pressed', 'false');
    // Everything stays editable: Saturday added, the language of new people English.
    await page.getByTestId('org-day-6').click();
    await expect(page.getByTestId('org-day-6')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('org-language-en').check();
    await page.getByTestId('org-fiscalYearStartMonth').selectOption('4');

    await page.getByTestId('organization-save').click();
    await expect(page.getByTestId('organization-message')).toHaveText('General settings saved.');
    await expect(page.getByTestId('tenant-context')).toContainText(EN_NAME);
    await expect(page.getByTestId('organization-last-changed')).toContainText('Last changed by');
    await expect(page.getByTestId('organization-last-changed')).toContainText(' AH');
    await page.reload();
    await expect(page.getByTestId('org-countryCode')).toHaveValue('SA');
    await expect(page.getByTestId('org-day-6')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('org-language-en')).toBeChecked();

    // A formatted date elsewhere: the users list shows Gregorian and Hijri (Umm al-Qura).
    await page.goto('/en/suite/admin/users');
    await expect(
      page.getByTestId('user-last-sign-in').filter({ hasText: ' AH' }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId('user-last-sign-in').filter({ hasText: ' · ' }).first(),
    ).toBeVisible();
  });

  test('Arabic: the Arabic name in the menu, Hijri dates in the users list', async ({ page }) => {
    await signInWithCode(page, 'ar');
    await expect(page.getByTestId('tenant-context')).toContainText(AR_NAME);
    await page.goto('/ar/suite/admin/settings');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الإعدادات العامة');
    await expect(page.getByTestId('org-countryCode')).toHaveValue('SA');
    await expect(page.getByTestId('org-countryCode').locator('option:checked')).toHaveText(
      'المملكة العربية السعودية',
    );
    await expect(page.getByTestId('org-day-0')).toHaveText('الأحد');
    await expectNoSeriousA11yViolations(page);

    await page.getByTestId('org-nameAr').fill(`${AR_NAME} المحدودة`);
    await page.getByTestId('org-display-hijri').check();
    await expect(page.getByTestId('org-date-preview')).toContainText('هـ');
    await page.getByTestId('organization-save').click();
    await expect(page.getByTestId('organization-message')).toHaveText('حُفظت الإعدادات العامة.');
    await expect(page.getByTestId('tenant-context')).toContainText(`${AR_NAME} المحدودة`);

    await page.goto('/ar/suite/admin/users');
    const lastSignIn = page.getByTestId('user-last-sign-in').filter({ hasText: 'هـ' }).first();
    await expect(lastSignIn).toBeVisible();
    // Hijri only: no Gregorian month in the text.
    await expect(lastSignIn).not.toContainText(' · ');
  });

  test('phone width: one column, nothing wider than the screen, 44 px day buttons', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInWithCode(page, 'en');
    await page.goto('/en/suite/admin/settings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('General settings');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.getByTestId('org-day-0').boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expectNoSeriousA11yViolations(page);
  });

  test('an HR Manager has no menu entry and is refused', async ({ page }) => {
    test.skip(!hrEmail || !hrPassword, 'ORG_PROFILE_E2E_HR_* not set');
    await signIn(page, 'en', hrEmail, hrPassword);
    await expect(page).toHaveURL(/\/en\/suite$/, afterSignIn);
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', {
        name: 'General',
        exact: true,
      }),
    ).toHaveCount(0);
    await page.goto('/en/suite/admin/settings');
    await expect(page.getByTestId('organization-forbidden')).toHaveText(
      "You don't have permission to do this.",
    );
    await expect(page.getByTestId('organization-profile-form')).toHaveCount(0);
    await page.goto('/ar/suite/admin/settings');
    await expect(page.getByTestId('organization-forbidden')).toBeVisible();
  });
});
