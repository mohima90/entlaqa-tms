import AxeBuilder from '@axe-core/playwright';
import { type Browser, type Page, expect, test } from '@playwright/test';

/**
 * Sign-in protection (T-M2-11, FR-IAM-13; TM-0003 T-IAM-01/27; PO decisions 9 Oct 2026): runs only
 * against the self-hosted stack (infra/docker/smoke.sh), whose app runs with AUTH_RATE_LIMIT_WINDOW_SECONDS
 * (compose.smoke.yaml) so the 15-minute lock lasts seconds. After 5 wrong passwords the account is locked
 * for browsers it does not know: even the right password gets the generic "too many attempts" message —
 * the same as for an e-mail without an account — and after the window the right password signs in.
 * Remembered browsers are opt-in: «تذكّر هذا المتصفح» / "Remember this browser" is unticked by default,
 * labelled, described and keyboard-operable; a browser that signed in with it ticked still signs in while
 * the account is locked for others, one that signed in unticked does not (and gets no trusted-device
 * cookie); the Organization Admin ends the lock from the member's profile («إلغاء إيقاف تسجيل الدخول»).
 * Arabic first, then English. The lockout and unlock e-mails are checked in Mailpit by smoke.sh.
 */
const email = process.env.SIGN_IN_LIMITS_E2E_EMAIL;
const password = process.env.SIGN_IN_LIMITS_E2E_PASSWORD;
const windowSeconds = Number(process.env.SIGN_IN_LIMITS_E2E_WINDOW_SECONDS ?? '');
const unknownEmail = process.env.SIGN_IN_LIMITS_E2E_UNKNOWN_EMAIL;
const memberEmail = process.env.SIGN_IN_LIMITS_E2E_MEMBER_EMAIL;
const memberPassword = process.env.SIGN_IN_LIMITS_E2E_MEMBER_PASSWORD;
const memberPersonId = process.env.SIGN_IN_LIMITS_E2E_MEMBER_PERSON_ID;

const TEXTS = {
  ar: {
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    submit: 'تسجيل الدخول',
    invalid: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    limited:
      'أُوقف تسجيل الدخول مؤقتًا بعد محاولات كثيرة لم تنجح. يمكنك المحاولة مرة أخرى لاحقًا، أو استعادة كلمة المرور من «نسيت كلمة المرور؟».',
    signOut: 'تسجيل الخروج',
    remember: 'تذكّر هذا المتصفح',
    rememberHint:
      'يبقى بإمكانك الدخول من هذا المتصفح 30 يومًا حتى إن أُوقف تسجيل الدخول إلى حسابك مؤقتًا بسبب محاولات من مكان آخر. لا تختره على جهاز مشترك.',
    lockTitle: 'تسجيل الدخول موقوف مؤقتًا',
    unlock: 'إلغاء إيقاف تسجيل الدخول',
    unlocked: 'أُلغي إيقاف تسجيل الدخول، ويمكن لصاحب الحساب تسجيل الدخول الآن.',
  },
  en: {
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    invalid: 'The email or password is incorrect.',
    limited:
      'Sign-in is paused for now after too many unsuccessful attempts. Try again later, or reset your password with “Forgot password?”.',
    signOut: 'Sign out',
    remember: 'Remember this browser',
    rememberHint:
      "For 30 days, you can still sign in from this browser even if sign-in to your account is paused after attempts from elsewhere. Don't tick this on a shared computer.",
    lockTitle: 'Sign-in is paused',
    unlock: 'Unlock sign-in',
    unlocked: 'Sign-in unlocked. This person can sign in again now.',
  },
} as const;

type Locale = keyof typeof TEXTS;

async function attempt(
  page: Page,
  locale: Locale,
  address: string,
  secret: string,
  options: { readonly remember?: boolean } = {},
) {
  const t = TEXTS[locale];
  await page.goto(`/${locale}/sign-in`);
  await page.getByLabel(t.email).fill(address);
  await page.getByLabel(t.password, { exact: false }).fill(secret);
  if (options.remember) await page.getByRole('checkbox', { name: t.remember }).check();
  await page.getByRole('button', { name: t.submit }).click();
}

/** The browser's trusted-device cookie, if any (`__Host-jadarat-device`). */
async function deviceCookie(page: Page) {
  return (await page.context().cookies()).find((c) => c.name.endsWith('jadarat-device'));
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
    test(`${locale}: «Remember this browser» is unticked by default, labelled, described and keyboard-operable`, async ({
      page,
    }) => {
      const t = TEXTS[locale];
      await page.goto(`/${locale}/sign-in`);
      const box = page.getByRole('checkbox', { name: t.remember, exact: true });
      await expect(box).toBeEnabled();
      await expect(box).not.toBeChecked();
      await expect(box).toHaveAccessibleDescription(t.rememberHint);
      // In the reading order: e-mail, password, the box, the button — and Space ticks and unticks it.
      await page.getByLabel(t.email).focus();
      await page.keyboard.press('Tab');
      await expect(page.getByLabel(t.password, { exact: false })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(box).toBeFocused();
      await page.keyboard.press('Space');
      await expect(box).toBeChecked();
      await page.keyboard.press('Space');
      await expect(box).not.toBeChecked();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: t.submit })).toBeFocused();
      await expectNoSeriousA11yViolations(page);
    });

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

  /** A fresh browser (no cookies): unknown to every account. */
  async function freshBrowser(browser: Browser) {
    const context = await browser.newContext();
    return { context, page: await context.newPage() };
  }

  async function signIn(
    page: Page,
    locale: Locale,
    address: string,
    secret: string,
    options: { readonly remember?: boolean } = {},
  ) {
    await attempt(page, locale, address, secret, options);
    await expect(page).toHaveURL(new RegExp(`/${locale}/suite$`));
  }

  async function signOut(page: Page, locale: Locale) {
    await page.getByRole('button', { name: TEXTS[locale].signOut }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/sign-in$`));
  }

  /** Five wrong passwords from an unknown browser lock the member; the right one is refused there. */
  async function lockMember(page: Page, locale: Locale) {
    const t = TEXTS[locale];
    for (let i = 0; i < 5; i += 1) {
      await attempt(page, locale, memberEmail ?? '', `not-the-password-${String(i)}`);
      await expectError(page, t.invalid);
    }
    await attempt(page, locale, memberEmail ?? '', memberPassword ?? '');
    await expectError(page, t.limited);
  }

  /** The Organization Admin sees the member's lock on the profile and ends it. */
  async function adminUnlocks(browser: Browser, locale: Locale) {
    const t = TEXTS[locale];
    const admin = await freshBrowser(browser);
    await signIn(admin.page, locale, email ?? '', password ?? '');
    await admin.page.goto(`/${locale}/suite/admin/users/${memberPersonId ?? ''}`);
    const lock = admin.page.getByTestId('sign-in-lock');
    await expect(lock).toContainText(t.lockTitle);
    await lock.getByRole('button', { name: t.unlock }).click();
    await expect(admin.page.getByTestId('unlock-sign-in-message')).toHaveText(t.unlocked);
    // The lock is gone from the profile.
    await admin.page.reload();
    await expect(admin.page.getByTestId('user-profile')).toBeVisible();
    await expect(admin.page.getByTestId('sign-in-lock')).toHaveCount(0);
    await signOut(admin.page, locale);
    await admin.context.close();
  }

  test('ar: a remembered browser still signs in while the account is locked, an unticked one does not; the Organization Admin unlocks it', async ({
    browser,
  }) => {
    test.skip(
      !memberEmail || !memberPassword || !memberPersonId,
      'SIGN_IN_LIMITS_E2E_MEMBER_* not set',
    );
    test.setTimeout(120_000);
    // The member signs in from one browser WITHOUT ticking the box: no trusted-device cookie (opt-in).
    const plain = await freshBrowser(browser);
    await signIn(plain.page, 'ar', memberEmail ?? '', memberPassword ?? '');
    expect(await deviceCookie(plain.page)).toBeUndefined();
    await signOut(plain.page, 'ar');
    // …and from their own browser with «تذكّر هذا المتصفح» ticked: from now on the account trusts it.
    const mine = await freshBrowser(browser);
    await signIn(mine.page, 'ar', memberEmail ?? '', memberPassword ?? '', { remember: true });
    const device = await deviceCookie(mine.page);
    expect(device?.httpOnly).toBe(true);
    expect(device?.sameSite).toBe('Lax');
    expect(device?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(device?.value).not.toContain(memberEmail ?? '');
    await signOut(mine.page, 'ar');

    // Someone else locks the account from another browser.
    const other = await freshBrowser(browser);
    await lockMember(other.page, 'ar');

    // The remembered browser is not stopped by the lock; the unticked one is.
    await signIn(mine.page, 'ar', memberEmail ?? '', memberPassword ?? '');
    await signOut(mine.page, 'ar');
    await attempt(plain.page, 'ar', memberEmail ?? '', memberPassword ?? '');
    await expectError(plain.page, TEXTS.ar.limited);

    // The Organization Admin ends the lock; the other browser signs in again.
    await adminUnlocks(browser, 'ar');
    await signIn(other.page, 'ar', memberEmail ?? '', memberPassword ?? '');
    await signOut(other.page, 'ar');
    await mine.context.close();
    await other.context.close();
    await plain.context.close();
  });

  test('en: the Organization Admin unlocks a locked member', async ({ browser }) => {
    test.skip(
      !memberEmail || !memberPassword || !memberPersonId,
      'SIGN_IN_LIMITS_E2E_MEMBER_* not set',
    );
    test.setTimeout(120_000);
    const other = await freshBrowser(browser);
    await lockMember(other.page, 'en');
    await adminUnlocks(browser, 'en');
    // Signed in without ticking the box: still no trusted-device cookie.
    await signIn(other.page, 'en', memberEmail ?? '', memberPassword ?? '');
    expect(await deviceCookie(other.page)).toBeUndefined();
    await signOut(other.page, 'en');
    await other.context.close();
  });
});
