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

const SIGN_IN_TEXTS = {
  ar: { continue: 'متابعة', submit: 'تسجيل الدخول', remember: 'تذكّر هذا المتصفح' },
  en: { continue: 'Continue', submit: 'Sign in', remember: 'Remember this browser' },
} as const;

/**
 * The two-step sign-in on the current page (Kawadir ATS, PO 16 Oct 2026): the work e-mail, «متابعة» /
 * "Continue", then the password (and «تذكّر هذا المتصفح» when asked) and «تسجيل الدخول» / "Sign in".
 */
export async function fillSignIn(
  page: Page,
  locale: 'ar' | 'en',
  email: string,
  password: string,
  options: { readonly remember?: boolean } = {},
) {
  const t = SIGN_IN_TEXTS[locale];
  await page.locator('#email').fill(email);
  await page.getByRole('button', { name: t.continue }).click();
  await page.locator('#password').fill(password);
  if (options.remember) await page.getByRole('checkbox', { name: t.remember }).check();
  await page.getByRole('button', { name: t.submit }).click();
}

/** Fills in and submits the English sign-in form; the caller asserts where it leads. */
export async function submitSignIn(
  page: Page,
  email: string | undefined,
  password: string | undefined,
) {
  await page.goto('/en/sign-in');
  await fillSignIn(page, 'en', email ?? '', password ?? '');
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
