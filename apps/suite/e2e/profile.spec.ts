import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * My profile (FR-IAM-16, T-M2-15a) with a real ordinary member (Line Manager + Learner, no user
 * management rights) on the self-hosted stack (infra/docker/smoke.sh, after users.spec): own personal
 * details incl. Arabic digits and the interface language, then the password change. Skipped without
 * credentials (default CI run).
 */
const email = process.env.SIGNED_IN_E2E_MANAGER_EMAIL;
const password = process.env.SIGNED_IN_E2E_MANAGER_PASSWORD;
const newPassword = process.env.PROFILE_E2E_NEW_PASSWORD;

async function signIn(page: Page, secret: string) {
  await page.goto('/en/sign-in');
  await page.getByLabel('Email').fill(email ?? '');
  await page.getByLabel('Password').fill(secret);
  await page.getByRole('button', { name: 'Sign in' }).click();
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

test.describe('My profile', () => {
  test.skip(!email || !password || !newPassword, 'profile E2E credentials not set');
  test.describe.configure({ mode: 'serial' });

  test('changes own personal details; e-mail and job data stay read-only', async ({ page }) => {
    await signIn(page, password ?? '');
    await expect(page).toHaveURL(/\/en\/suite$/);
    await page.getByTestId('my-profile-link').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My profile');
    await expectNoSeriousA11yViolations(page);

    const arabic = page.getByRole('group', { name: 'Name in Arabic' });
    await arabic.getByLabel('First name').fill('منيرة');
    await arabic.getByLabel('Family name').fill('الزهراني');
    // Mobile typed with Eastern Arabic digits and the 00 prefix.
    await page.getByLabel('Mobile number').fill('٠٠٩٦٦ ٥٥ ١١١ ٢٢٣٣');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('profile-message')).toHaveText('Changes saved.');
    await page.reload();
    await expect(page.getByLabel('Mobile number')).toHaveValue('+966551112233');
    await expect(page.getByTestId('my-profile-link')).toContainText('Mona Saeed Alzahrani'); // English name kept

    // Job data is shown, not editable: no input for the job title or department.
    await expect(page.getByRole('heading', { name: 'Work details' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Job title|Department/ })).toHaveCount(0);

    // A local number without the country code is refused.
    await page.getByLabel('Mobile number').fill('0551234567');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Enter the full number with the country code.')).toBeVisible();

    // Choosing Arabic switches the page to Arabic.
    await page.getByLabel('Mobile number').fill('+966551112233');
    await page.getByLabel('Interface and message language').selectOption('ar');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/ar\/suite\/profile$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ملفي الشخصي');
    await expect(page.getByTestId('my-profile-link')).toContainText('منيرة');
    await expectNoSeriousA11yViolations(page);
  });

  test('changes the password: the current one is checked, then the new one signs in', async ({
    page,
  }) => {
    await signIn(page, password ?? '');
    await expect(page).toHaveURL(/\/en\/suite$/);
    await page.goto('/en/suite/profile');
    await page.getByLabel('Current password').fill('not-the-password-123');
    await page.getByLabel(/^New password/).fill(newPassword ?? '');
    await page.getByLabel('Confirm the new password').fill(newPassword ?? '');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByTestId('password-message')).toHaveText(
      'The current password is incorrect.',
    );

    await page.getByLabel('Current password').fill(password ?? '');
    await page.getByLabel('Confirm the new password').fill('something-else-entirely');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('The passwords do not match.')).toBeVisible();

    await page.getByLabel('Confirm the new password').fill(newPassword ?? '');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByTestId('password-message')).toHaveText(
      'Password changed. Sign-in sessions on other devices have ended.',
    );
    // This session stays signed in.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My profile');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await signIn(page, password ?? '');
    await expect(page.getByTestId('sign-in-error')).toHaveText(
      'The email or password is incorrect.',
    );
    await signIn(page, newPassword ?? '');
    await expect(page).toHaveURL(/\/en\/suite$/);
  });
});
