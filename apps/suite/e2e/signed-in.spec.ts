import { expect, test } from '@playwright/test';
import { afterSignIn, submitSignIn, signOutFromMenu } from './sign-in';

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

  test('a wrong password gets the generic message, on the password field', async ({ page }) => {
    await submitSignIn(page, email, 'not-the-password');
    await expect(page.getByTestId('sign-in-error')).toHaveText(
      'The email or password is incorrect.',
      afterSignIn,
    );
    // Direction C: the message sits on the field — marked invalid and described by it.
    const field = page.locator('#password');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveAccessibleDescription(/The email or password is incorrect\./);
    // Focus moves to the field, so a screen reader reads the message out.
    await expect(field).toBeFocused();
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
      'Team members',
      'Roles & permissions',
      'General',
      'Security',
    ]);
    await expect(page.getByText('No training data yet')).toHaveCount(0);
    await expect(page.getByText('Calendar')).toHaveCount(0);
    await page.goto('/ar/suite');
    await expect(
      page.getByTestId('setup-home').getByRole('heading', { name: 'إعداد منشأتك' }),
    ).toBeVisible();
    await page.goto('/en/suite');
    // Top-bar controls are 44 px touch targets on a phone (Kawadir top bar, T-M2-43).
    if (isMobile) {
      for (const control of [
        page.getByRole('button', { name: 'Menu' }),
        page.getByTestId('command-palette-trigger'),
        page.getByTestId('theme-menu'),
        page.getByTestId('language-toggle'),
        page.getByTestId('notification-bell'),
        page.getByTestId('account-menu'),
      ]) {
        expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    }
    // The organization is named in the navigation's organization block (behind the menu on a phone).
    if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByText(`Organization: ${organization ?? ''}`)).toBeVisible();
    if (isMobile) await page.keyboard.press('Escape');

    // The account menu shows "Organization · Role" (Kawadir) and holds sign-out.
    await expect(page.getByTestId('account-menu')).toContainText(
      `${organization ?? ''} · Organization Admin`,
    );
    await signOutFromMenu(page);
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await page.goto('/ar/suite');
    await expect(page).toHaveURL(/\/ar\/sign-in$/);
  });
});
