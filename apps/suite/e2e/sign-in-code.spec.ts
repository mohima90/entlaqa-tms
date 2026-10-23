import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { afterSignIn } from './sign-in';

/**
 * «Email me a code instead» (WP-ADM-05, FR-IAM-12; PO 23 Oct 2026): a second way to sign in, instead of the
 * password, offered to everybody. Runs against the self-hosted stack (infra/docker/smoke.sh). What this checks
 * needs no mailbox and no account: the button is on the password step for any address, the screen that follows is
 * the same for an address without an account (no enumeration), the six boxes are labelled and take a pasted code,
 * a wrong code is said ON the field with the tries left and focus returns to the boxes, five wrong codes kill the
 * code and pause code checks, "Use my password instead" goes back, and axe finds nothing in Arabic or English.
 * The whole journey with a real code (and a remembered browser) is read from Mailpit by smoke.sh.
 */
const TEXTS = {
  ar: {
    continue: 'متابعة',
    codeInstead: 'أرسل لي رمزًا بالبريد بدلًا من ذلك',
    title: 'تفقّد بريدك الإلكتروني',
    group: 'رمز الدخول',
    digit: (n: number) => `الرقم ${String(n)} من 6`,
    submit: 'تحقق وسجّل الدخول',
    format: 'أدخل الأرقام الستة كاملة.',
    wrong: 'هذا الرمز غير صحيح.',
    locked: 'لم يعد هذا الرمز صالحًا',
    usePassword: 'استخدام كلمة المرور بدلًا من ذلك',
    remember: 'تذكّر هذا المتصفح',
    password: 'كلمة المرور',
  },
  en: {
    continue: 'Continue',
    codeInstead: 'Email me a code instead',
    title: 'Check your email',
    group: 'Sign-in code',
    digit: (n: number) => `Digit ${String(n)} of 6`,
    submit: 'Verify and sign in',
    format: 'Enter all 6 digits.',
    wrong: 'That code isn’t right.',
    locked: 'This code no longer works',
    usePassword: 'Use my password instead',
    remember: 'Remember this browser',
    password: 'Password',
  },
} as const;

async function toCodeScreen(page: Page, locale: 'ar' | 'en', address: string) {
  const t = TEXTS[locale];
  await page.goto(`/${locale}/sign-in`);
  await page.locator('#email').fill(address);
  await page.getByRole('button', { name: t.continue }).click();
  await page.getByRole('button', { name: t.codeInstead }).click();
  await expect(page.getByTestId('sign-in-code-form')).toBeVisible(afterSignIn);
}

for (const locale of ['ar', 'en'] as const) {
  test.describe(`sign in with an e-mailed code (${locale})`, () => {
    const t = TEXTS[locale];
    // An address nobody has: the screen must be exactly the one a real address gets.
    const address = `nobody.${locale}.${String(Date.now())}@example.test`;

    test('the same screen for any address; labelled boxes; paste; wrong codes on the field; the lock', async ({
      page,
    }) => {
      await toCodeScreen(page, locale, address);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
      await expect(page.getByTestId('sign-in-code-intro')).toContainText(address);
      // Six boxes, each named, in a labelled group; the first asks for the browser's one-time-code autofill.
      await expect(page.getByTestId('sign-in-code-box')).toHaveCount(6);
      for (let n = 1; n <= 6; n += 1) {
        await expect(page.getByRole('textbox', { name: t.digit(n) })).toBeVisible();
      }
      await expect(page.getByRole('group', { name: t.group })).toBeVisible();
      await expect(page.locator('#sign-in-code-1')).toHaveAttribute(
        'autocomplete',
        'one-time-code',
      );
      await expect(page.getByTestId('sign-in-code-countdown')).toBeVisible();
      // "Remember this browser" is always there, unticked.
      await expect(page.getByRole('checkbox', { name: t.remember })).not.toBeChecked();

      // Pressing the button with an incomplete code says so ON the field and keeps focus there.
      await page.getByRole('button', { name: t.submit }).click();
      await expect(page.getByTestId('sign-in-code-error')).toHaveText(t.format);
      await expect(page.locator('#sign-in-code-1')).toBeFocused();

      // A pasted code fills all six boxes.
      await page.locator('#sign-in-code-1').focus();
      await page.evaluate(() => {
        const data = new DataTransfer();
        data.setData('text', '000000');
        document
          .getElementById('sign-in-code-1')
          ?.dispatchEvent(
            new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
          );
      });
      for (let n = 1; n <= 6; n += 1) {
        await expect(page.locator(`#sign-in-code-${String(n)}`)).toHaveValue('0');
      }

      // Accessibility on the code screen (error showing).
      await page.getByRole('button', { name: t.submit }).click();
      await expect(page.getByTestId('sign-in-code-error')).toContainText(t.wrong, afterSignIn);
      await expect(page.locator('#sign-in-code-1')).toBeFocused();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);

      // Four more wrong codes: the fifth kills the code and pauses checks - the boxes stop, the password is offered.
      for (let i = 0; i < 4; i += 1) {
        await page.locator('#sign-in-code-1').focus();
        await page.keyboard.type('111111');
        await page.getByRole('button', { name: t.submit }).click();
        await expect(
          page.getByTestId('sign-in-code-banner').or(page.getByTestId('sign-in-code-error')),
        ).toBeVisible(afterSignIn);
      }
      await expect(page.getByTestId('sign-in-code-banner')).toContainText(t.locked);
      await expect(page.locator('#sign-in-code-1')).toBeDisabled();
      await page.getByRole('button', { name: t.usePassword }).click();
      await expect(page.getByLabel(t.password).first()).toBeVisible();
    });
  });
}
