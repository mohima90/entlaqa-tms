import { expect, test } from '@playwright/test';

/**
 * Real sign-in against a configured deployment (T-M1-D03/D04): runs only when credentials are given,
 * e.g. against the self-hosted stack (infra/docker/smoke.sh) — never in the default CI run, which has
 * no Auth server. Covers: wrong password, sign-in → organization shown, sign-out, /suite protected.
 */
const email = process.env.SIGNED_IN_E2E_EMAIL;
const password = process.env.SIGNED_IN_E2E_PASSWORD;
const organization = process.env.SIGNED_IN_E2E_ORGANIZATION_EN;

test.describe('signed-in flow', () => {
  test.skip(!email || !password || !organization, 'SIGNED_IN_E2E_* not set');
  test.describe.configure({ mode: 'serial' });

  test('a wrong password gets the generic message', async ({ page }) => {
    await page.goto('/en/sign-in');
    await page.getByLabel('Email').fill(email ?? '');
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('sign-in-error')).toHaveText(
      'The email or password is incorrect.',
    );
  });

  test('sign in shows the organization; sign out protects the suite again', async ({ page }) => {
    await page.goto('/en/sign-in');
    await page.getByLabel('Email').fill(email ?? '');
    await page.getByLabel('Password').fill(password ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/en\/suite$/);
    await expect(page.getByText(`Organization: ${organization ?? ''}`)).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await page.goto('/ar/suite');
    await expect(page).toHaveURL(/\/ar\/sign-in$/);
  });
});
