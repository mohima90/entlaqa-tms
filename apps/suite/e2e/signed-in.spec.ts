import { expect, test } from '@playwright/test';
import { afterSignIn, submitSignIn } from './sign-in';

/**
 * Real sign-in against a configured deployment (T-M1-D03/D04): runs only when credentials are given,
 * e.g. against the self-hosted stack (infra/docker/smoke.sh) — never in the default CI run, which has
 * no Auth server. Covers: wrong password, sign-in → the Organization Admin's authenticator prompt
 * postponed → organization shown, sign-out, /suite protected.
 */
const email = process.env.SIGNED_IN_E2E_EMAIL;
const password = process.env.SIGNED_IN_E2E_PASSWORD;
const organization = process.env.SIGNED_IN_E2E_ORGANIZATION_EN;

test.describe('signed-in flow', () => {
  test.skip(!email || !password || !organization, 'SIGNED_IN_E2E_* not set');
  test.describe.configure({ mode: 'serial' });

  test('a wrong password gets the generic message', async ({ page }) => {
    await submitSignIn(page, email, 'not-the-password');
    await expect(page.getByTestId('sign-in-error')).toHaveText(
      'The email or password is incorrect.',
      afterSignIn,
    );
  });

  test('sign in shows the organization; sign out protects the suite again', async ({
    page,
    isMobile,
  }) => {
    await submitSignIn(page, email, password);
    // PO decision 2 (T-M2-10): the Organization Admin, without an authenticator app yet, is invited to
    // set one up and may postpone it; the choice is remembered (the later specs land on the suite).
    await expect(page).toHaveURL(/\/en\/mfa$/, afterSignIn);
    await expect(page.getByTestId('mfa-prompt-admin')).toBeVisible();
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page).toHaveURL(/\/en\/suite$/);
    // The Organization Admin's home (T-M2-21): a set-up card with the pages that exist, never the
    // training home; its menu has the set-up sections and no training entries.
    const setup = page.getByTestId('setup-home');
    await expect(setup.getByRole('heading', { name: 'Set up your organization' })).toBeVisible();
    await expect(setup.getByRole('link')).toHaveText([
      'Users',
      'Roles & permissions',
      'Security policy',
    ]);
    await expect(page.getByText('No training data yet')).toHaveCount(0);
    await expect(page.getByText('Calendar')).toHaveCount(0);
    await page.goto('/ar/suite');
    await expect(
      page.getByTestId('setup-home').getByRole('heading', { name: 'إعداد منشأتك' }),
    ).toBeVisible();
    await page.goto('/en/suite');
    // The organization is named in the navigation's organization block (behind the menu on a phone).
    if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByText(`Organization: ${organization ?? ''}`)).toBeVisible();
    if (isMobile) await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await page.goto('/ar/suite');
    await expect(page).toHaveURL(/\/ar\/sign-in$/);
  });
});
