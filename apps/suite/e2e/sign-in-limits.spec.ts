import { type Page, expect, test } from '@playwright/test';

/**
 * Sign-in protection (T-M2-11, FR-IAM-13; TM-0003 T-IAM-01/27): runs only against the self-hosted stack
 * (infra/docker/smoke.sh), whose app runs with AUTH_RATE_LIMIT_WINDOW_SECONDS so the 15-minute lock lasts
 * seconds. After 5 wrong passwords the account is locked: even the right password gets the generic
 * "too many attempts" message — the same as for an e-mail without an account — and after the window the
 * right password signs in. Arabic first, then English.
 */
const email = process.env.SIGN_IN_LIMITS_E2E_EMAIL;
const password = process.env.SIGN_IN_LIMITS_E2E_PASSWORD;
const windowSeconds = Number(process.env.SIGN_IN_LIMITS_E2E_WINDOW_SECONDS ?? '');
const unknownEmail = process.env.SIGN_IN_LIMITS_E2E_UNKNOWN_EMAIL;

const TEXTS = {
  ar: {
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    submit: 'تسجيل الدخول',
    invalid: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    limited:
      'أُوقف تسجيل الدخول مؤقتًا بعد محاولات كثيرة لم تنجح. يمكنك المحاولة مرة أخرى لاحقًا، أو استعادة كلمة المرور من «نسيت كلمة المرور؟».',
    signOut: 'تسجيل الخروج',
  },
  en: {
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    invalid: 'The email or password is incorrect.',
    limited:
      'Sign-in is paused for now after too many unsuccessful attempts. Try again later, or reset your password with “Forgot password?”.',
    signOut: 'Sign out',
  },
} as const;

type Locale = keyof typeof TEXTS;

async function attempt(page: Page, locale: Locale, address: string, secret: string) {
  const t = TEXTS[locale];
  await page.goto(`/${locale}/sign-in`);
  await page.getByLabel(t.email).fill(address);
  await page.getByLabel(t.password, { exact: false }).fill(secret);
  await page.getByRole('button', { name: t.submit }).click();
}

async function expectError(page: Page, text: string) {
  await expect(page.getByTestId('sign-in-error')).toHaveText(text);
}

test.describe('sign-in protection', () => {
  test.skip(
    !email || !password || !unknownEmail || !Number.isInteger(windowSeconds) || windowSeconds < 1,
    'SIGN_IN_LIMITS_E2E_* not set',
  );
  test.describe.configure({ mode: 'serial' });

  for (const locale of ['ar', 'en'] as const) {
    test(`${locale}: 5 wrong passwords lock the account; the right one works after the window`, async ({
      page,
    }) => {
      test.setTimeout(60_000 + windowSeconds * 2_000);
      const t = TEXTS[locale];
      for (let i = 0; i < 5; i += 1) {
        await attempt(page, locale, email ?? '', `not-the-password-${String(i)}`);
        await expectError(page, t.invalid);
      }
      // Locked: the right password does not open it, and the answer is the generic one.
      await attempt(page, locale, email ?? '', password ?? '');
      await expectError(page, t.limited);
      await expect(page).toHaveURL(new RegExp(`/${locale}/sign-in$`));

      // An e-mail without an account behaves exactly the same (no account enumeration).
      if (locale === 'ar') {
        for (let i = 0; i < 5; i += 1) {
          await attempt(page, locale, unknownEmail ?? '', `not-the-password-${String(i)}`);
          await expectError(page, t.invalid);
        }
        await attempt(page, locale, unknownEmail ?? '', 'any-password-at-all');
        await expectError(page, t.limited);
      }

      // After the window the right password signs in (and ends the run of failures).
      await page.waitForTimeout((windowSeconds + 2) * 1_000);
      await attempt(page, locale, email ?? '', password ?? '');
      await expect(page).toHaveURL(new RegExp(`/${locale}/suite$`));
      await page.getByRole('button', { name: t.signOut }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/sign-in$`));
    });
  }
});
