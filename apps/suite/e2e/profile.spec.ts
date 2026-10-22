import { execFileSync } from 'node:child_process';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import {
  afterSignIn,
  fillSignIn,
  openMyProfile,
  signInToSuite,
  signOutFromMenu,
  submitSignIn,
} from './sign-in';

/**
 * My profile (FR-IAM-16, T-M2-15a) with a real ordinary member (custom «Line Manager» role, no user
 * management rights) on the self-hosted stack (infra/docker/smoke.sh, after users.spec): own personal
 * details incl. Arabic digits and the interface language, then the password change. Skipped without
 * credentials (default CI run).
 */
const email = process.env.SIGNED_IN_E2E_MANAGER_EMAIL;
const password = process.env.SIGNED_IN_E2E_MANAGER_PASSWORD;
const newPassword = process.env.PROFILE_E2E_NEW_PASSWORD;
/** infra/docker/e2e-helper.sh (smoke.sh sets it): the account's trusted browsers, counted in the database. */
const helper = process.env.PROFILE_E2E_HELPER ?? '';

/** How many unexpired browsers the account trusts for the sign-in lock (T-M2-11). */
function trustedBrowsers(address: string): number {
  return Number(
    execFileSync('bash', [helper, 'trusted-browsers', address], {
      encoding: 'utf8',
      timeout: 30_000,
    }).trim(),
  );
}

/** Signs in with the English form, «Remember this browser» ticked, and waits for the suite. */
async function signInRemembered(page: Page) {
  await page.goto('/en/sign-in');
  await fillSignIn(page, 'en', email ?? '', password ?? '', { remember: true });
  await expect(page).toHaveURL(/\/en\/suite$/, afterSignIn);
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

test.describe('My profile', () => {
  test.skip(!email || !password || !newPassword, 'profile E2E credentials not set');
  test.describe.configure({ mode: 'serial' });

  test('changes own personal details; e-mail and job data stay read-only', async ({ page }) => {
    await signInToSuite(page, email, password);
    await openMyProfile(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My profile');
    await expectNoSeriousA11yViolations(page);

    const arabic = page.getByRole('group', { name: 'Name in Arabic' });
    await arabic.getByLabel('First name').fill('منيرة');
    await arabic.getByLabel('Family name').fill('الزهراني');
    // Mobile typed with Eastern Arabic digits and the 00 prefix.
    await page.getByLabel('Mobile number').fill('٠٠٩٦٦ ٥٥ ١١١ ٢٢٣٣');
    // The stored language is Arabic (the default): keep the page in English by choosing it, so the
    // save does not switch the page (that switch is checked below).
    await page.getByLabel('Interface and message language').selectOption('en');
    await page.getByRole('button', { name: 'Save changes' }).click();
    // Redesign package 6: a toast says it was saved, and the save bar goes away.
    await expect(page.getByText('Changes saved.').first()).toBeVisible();
    await expect(page.getByTestId('save-bar')).toHaveCount(0);
    await expect(page).toHaveURL(/\/en\/suite\/profile$/);
    await page.reload();
    await expect(page.getByLabel('Mobile number')).toHaveValue('+966551112233');
    await expect(page.getByTestId('account-menu')).toContainText('Mona Saeed Alzahrani'); // English name kept

    // Job data is shown, not editable: no input for the job title or department.
    await expect(page.getByRole('heading', { name: 'Work details' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Job title|Department/ })).toHaveCount(0);

    // A local number without the country code is refused.
    await page.getByLabel('Mobile number').fill('0551234567');
    await expect(page.getByTestId('save-bar')).toHaveAttribute('data-state', 'unsaved');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Enter the full number with the country code.')).toBeVisible();
    // The bar says fields need correcting and leads to the first one.
    await expect(page.getByTestId('save-bar')).toHaveAttribute('data-state', 'invalid');
    await page.getByTestId('save-bar-fix').click();
    await expect(page.getByLabel('Mobile number')).toBeFocused();

    // Choosing Arabic switches the page to Arabic.
    await page.getByLabel('Mobile number').fill('+966551112233');
    await page.getByLabel('Interface and message language').selectOption('ar');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/ar\/suite\/profile$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ملفي الشخصي');
    await expect(page.getByTestId('account-menu')).toContainText('منيرة');
    await expectNoSeriousA11yViolations(page);
    // The second tab, in Arabic too (the address keeps the tab).
    await page.getByRole('link', { name: 'الدخول والأمان' }).click();
    await expect(page).toHaveURL(/\/ar\/suite\/profile\?tab=security$/);
    await expect(page.getByRole('heading', { name: 'كلمة المرور' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('changes the password: the current one is checked, then the new one signs in; other remembered browsers are forgotten', async ({
    page,
    browser,
  }) => {
    expect(
      helper,
      'PROFILE_E2E_HELPER (infra/docker/e2e-helper.sh) must be set with the credentials',
    ).not.toBe('');
    // Another browser the member asked to remember, then this one (T-M2-11 security review L2).
    const other = await browser.newContext();
    await signInRemembered(await other.newPage());
    await other.close();
    await signInRemembered(page);
    expect(trustedBrowsers(email ?? '')).toBeGreaterThanOrEqual(2);
    // The password is a row of the Sign-in and security tab: «Change password» opens the form in place.
    await page.goto('/en/suite/profile?tab=security');
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByLabel('Current password').fill('not-the-password-123');
    await page.getByLabel(/^New password/).fill(newPassword ?? '');
    await page.getByLabel('Confirm the new password').fill(newPassword ?? '');
    await page.getByRole('button', { name: 'Change password' }).click();
    // The message sits on the field.
    await expect(page.locator('#password-current-error')).toHaveText(
      'The current password is incorrect.',
    );
    await expect(page.getByLabel('Current password')).toHaveAttribute('aria-invalid', 'true');
    // Focus moves to the field once the answer is shown (it was disabled while waiting).
    await expect(page.getByLabel('Current password')).toBeFocused();

    await page.getByLabel('Current password').fill(password ?? '');
    await page.getByLabel('Confirm the new password').fill('something-else-entirely');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('The passwords do not match.')).toBeVisible();

    await page.getByLabel('Confirm the new password').fill(newPassword ?? '');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(
      page.getByText('Password changed. Sign-in sessions on other devices have ended.').first(),
    ).toBeVisible();
    // The form closed again; the sessions list below was refreshed.
    await expect(page.getByLabel('Current password')).toHaveCount(0);
    // Closing the form returns focus to «Change password».
    await expect(page.getByTestId('password-change')).toBeFocused();
    // Every OTHER remembered browser is forgotten — in Next.js after(), once the answer was sent, outside the
    // action's transaction (integration review: proves the transaction rules let it run); this one stays.
    await expect
      .poll(() => trustedBrowsers(email ?? ''), { timeout: 20_000, intervals: [500] })
      .toBe(1);
    // This session stays signed in.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My profile');

    await signOutFromMenu(page);
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await submitSignIn(page, email, password);
    await expect(page.getByTestId('sign-in-error')).toHaveText(
      'The email or password is incorrect.',
      afterSignIn,
    );
    await signInToSuite(page, email, newPassword);
  });
});
