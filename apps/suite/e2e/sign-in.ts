import { type Page, expect } from '@playwright/test';

/**
 * Sign-in for the E2E journeys on the self-hosted stack (infra/docker/smoke.sh).
 *
 * A sign-in answer is not one quick request: the sign-in protection (FR-IAM-13, T-M2-11) runs two short
 * limiter transactions around Auth's password check (bcrypt), the session is verified and refreshed, the
 * organization is chosen and the audit event written, and a refused attempt is padded to the same
 * minimum duration as an accepted one. On a loaded runner that can take longer than Playwright's default
 * 5-second expect timeout, so every assertion that waits for the page after a sign-in uses this longer
 * wait: the password step, the authenticator or e-mailed code step, and the other ways in that sign in
 * through Auth (accepting an invitation, saving a new password from a reset link). The global expect
 * timeout stays at its default.
 */
export const SIGN_IN_TIMEOUT_MS = 20_000;

/** Options for an assertion that waits for the page a sign-in (or a code) leads to. */
export const afterSignIn = { timeout: SIGN_IN_TIMEOUT_MS } as const;

/** Fills in and submits the English sign-in form; the caller asserts where it leads. */
export async function submitSignIn(
  page: Page,
  email: string | undefined,
  password: string | undefined,
) {
  await page.goto('/en/sign-in');
  await page.getByLabel('Email').fill(email ?? '');
  await page.getByLabel('Password').fill(password ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Signs in with the English form and waits for the suite home page. */
export async function signInToSuite(
  page: Page,
  email: string | undefined,
  password: string | undefined,
) {
  await submitSignIn(page, email, password);
  await expect(page).toHaveURL(/\/en\/suite$/, afterSignIn);
}

/**
 * Signs out from the account menu of the top bar (Kawadir layout, T-M2-43): open the menu, choose «Sign
 * out». Language-neutral (test ids); the caller asserts where it leads.
 */
export async function signOutFromMenu(page: Page) {
  await page.getByTestId('account-menu').click();
  await page.getByTestId('sign-out').click();
}

/** Opens My profile from the account menu (T-M2-43). */
export async function openMyProfile(page: Page) {
  await page.getByTestId('account-menu').click();
  await page.getByTestId('my-profile-link').click();
}
