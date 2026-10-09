import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { type Page, type Response, expect, test } from '@playwright/test';

/**
 * Security policy per organization (FR-IAM-12, FR-IAM-13; T-M2-10; approved screens 3 and 6) on the
 * self-hosted stack (infra/docker/smoke.sh, the LAST browser journey: it makes an authenticator app
 * required for everyone in the smoke organization). Real Auth, real TOTP codes computed from the set-up
 * key the page shows (RFC 6238). Covers, in Arabic and English:
 *  - the Organization Admin changes the policy only with a code (AAL2, PO decision D-IAM-01);
 *  - an organization that requires MFA makes a member set an app up, then asks for its code at sign-in;
 *  - a new password shorter than the strictest rule of the member's organizations is refused;
 *  - a user manager ends a member's sign-in sessions; the member must sign in again.
 * Skipped without credentials (default CI run).
 */
const adminEmail = process.env.SIGNED_IN_E2E_EMAIL;
const adminPassword = process.env.SIGNED_IN_E2E_PASSWORD;
const memberEmail = process.env.SIGNED_IN_E2E_MANAGER_EMAIL;
/** The member's password after profile.spec changed it. */
const memberPassword = process.env.SECURITY_E2E_MANAGER_PASSWORD;
/** Mona Saeed Alzahrani (infra/docker/seed-users.sql): the member above. */
const MONA = '5eed1000-0000-4000-8000-000000000003';
/** At least 12 characters (the platform minimum), shorter than the 16 this spec sets. */
const SHORTER_PASSWORD = 'shorter-pass14';

/** Set-up keys of the apps this spec registers (kept in memory only, never logged). */
let adminKey = '';
let memberKey = '';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 6238 TOTP (HMAC-SHA-1, 30-second steps, 6 digits) of a base32 key at a time step. */
function totp(key: string, step: number): string {
  let bits = '';
  for (const char of key.toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error('the set-up key is not base32');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest.readUInt8(digest.length - 1) & 0xf;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * A code from a time step not used before with this key, and not about to expire: an app shows one code
 * per 30 seconds, so a second sign-in in the same step waits for the next one, as a person would.
 */
const lastStep = new Map<string, number>();
async function freshCode(key: string): Promise<string> {
  const used = lastStep.get(key) ?? -1;
  for (;;) {
    const now = Date.now();
    const step = Math.floor(now / 30_000);
    if (step > used && now % 30_000 < 26_000) {
      lastStep.set(key, step);
      return totp(key, step);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function enterCode(page: Page, key: string) {
  await page.getByTestId('mfa-code').fill(await freshCode(key));
  await page.getByTestId('mfa-verify').click();
}

/** Sets up an app on the /mfa page: start → QR code and key → first code. Returns the key. */
async function setUpApp(page: Page): Promise<string> {
  await page.getByTestId('mfa-start').click();
  await expect(page.getByTestId('mfa-qr')).toBeVisible();
  const key = ((await page.getByTestId('mfa-secret').textContent()) ?? '').replace(/\s/g, '');
  expect(key).toMatch(/^[A-Z2-7]{16,64}$/);
  await enterCode(page, key);
  return key;
}

async function signIn(page: Page, locale: 'ar' | 'en', email: string, secret: string) {
  await page.goto(`/${locale}/sign-in`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(secret);
  await page.getByRole('button', { name: locale === 'ar' ? 'تسجيل الدخول' : 'Sign in' }).click();
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

/** Tries a new password on My profile; the strictest rule (16) refuses it before Auth is asked. */
async function expectShorterPasswordRefused(page: Page, locale: 'ar' | 'en') {
  await page.goto(`/${locale}/suite/profile`);
  const rule = locale === 'ar' ? '16 حرفًا على الأقل' : 'At least 16 characters';
  await expect(page.locator('#password-rules')).toContainText(rule);
  await page.locator('#password-current').fill(memberPassword ?? '');
  await page.locator('#password-new').fill(SHORTER_PASSWORD);
  await page.locator('#password-confirm').fill(SHORTER_PASSWORD);
  await page
    .getByRole('button', { name: locale === 'ar' ? 'تغيير كلمة المرور' : 'Change password' })
    .click();
  await expect(page.locator('#password-new-error')).toHaveText(`${rule}.`);
}

test.describe('Security policy, MFA and sign-in sessions', () => {
  test.skip(
    !adminEmail || !adminPassword || !memberEmail || !memberPassword,
    'security E2E credentials not set',
  );
  test.describe.configure({ mode: 'serial' });

  test('the Organization Admin changes the policy only with a code from an authenticator app', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, 'en', adminEmail ?? '', adminPassword ?? '');
    // The set-up prompt was postponed in signed-in.spec (PO decision 2): it is not shown again.
    await expect(page).toHaveURL(/\/en\/suite$/);
    await page.getByRole('link', { name: 'Security', exact: true }).click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/security$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Security');

    // Signed in with the password only (AAL1): the settings are shown, not editable, with the way on.
    await expect(page.getByTestId('security-step-up')).toBeVisible();
    await expect(page.getByTestId('security-passwordMinLength')).toBeDisabled();
    await expect(page.getByTestId('security-mode-off')).toBeChecked();
    await expect(page.getByTestId('security-save')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    // No app yet: the code page sets one up, then returns to the settings.
    await page.getByTestId('security-step-up-link').click();
    await expect(page).toHaveURL(/\/en\/mfa\?next=%2Fen%2Fsuite%2Fadmin%2Fsecurity$/);
    await expect(page.getByTestId('mfa-enrol')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    adminKey = await setUpApp(page);
    await expect(page).toHaveURL(/\/en\/suite\/admin\/security$/);
    await expect(page.getByTestId('security-step-up')).toHaveCount(0);

    // An app required for everyone, from now (no grace period), and a longer minimum password length.
    await page.getByTestId('security-mode-required_all').check();
    await page.getByTestId('security-mfaGraceDays').fill('0');
    await page.getByTestId('security-passwordMinLength').fill('40');
    await page.getByTestId('security-save').click();
    await expect(page.locator('#security-passwordMinLength-error')).toHaveText(
      'Enter a whole number from 12 to 36.',
    );
    await page.getByTestId('security-passwordMinLength').fill('16');
    await page.getByTestId('security-save').click();
    await expect(page.getByTestId('security-message')).toHaveText('Security settings saved.');

    await page.reload();
    await expect(page.getByTestId('security-mode-required_all')).toBeChecked();
    await expect(page.getByTestId('security-mfaGraceDays')).toHaveValue('0');
    await expect(page.getByTestId('security-passwordMinLength')).toHaveValue('16');
    await expect(page.getByText(/^Last changed: /)).toBeVisible();

    // The same page in Arabic (right to left).
    await page.goto('/ar/suite/admin/security');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الأمان');
    await expect(page.getByTestId('security-passwordMinLength')).toHaveValue('16');
    await expectNoSeriousA11yViolations(page);
  });

  test('a required app is set up at sign-in, then its code is asked; a shorter password is refused', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await signIn(page, 'ar', memberEmail ?? '', memberPassword ?? '');
    // Required for everyone, no grace period: setting an app up is the way in (no "later").
    await expect(page).toHaveURL(/\/ar\/mfa$/);
    await expect(page.getByTestId('mfa-enrol')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('إعداد تطبيق المصادقة');
    await expect(page.getByTestId('mfa-skip')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    // The database refuses the session until then: the suite sends it back.
    await page.goto('/ar/suite');
    await expect(page).toHaveURL(/\/ar\/mfa$/);
    memberKey = await setUpApp(page);
    await expect(page).toHaveURL(/\/ar\/suite$/);

    // The next sign-in asks for the app's code; a wrong code is refused.
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await expect(page).toHaveURL(/\/ar\/sign-in$/);
    await signIn(page, 'ar', memberEmail ?? '', memberPassword ?? '');
    await expect(page).toHaveURL(/\/ar\/mfa$/);
    await expect(page.getByTestId('mfa-challenge')).toBeVisible();
    const step = Math.floor(Date.now() / 30_000);
    const wrong = String((Number(totp(memberKey, step)) + 500_000) % 1_000_000).padStart(6, '0');
    await page.getByTestId('mfa-code').fill(wrong);
    await page.getByTestId('mfa-verify').click();
    await expect(page.getByTestId('mfa-error')).toHaveText(
      'الرمز غير صحيح أو انتهت صلاحيته. يمكنك إدخال الرمز الظاهر الآن في التطبيق.',
    );
    await expectNoSeriousA11yViolations(page);
    await enterCode(page, memberKey);
    await expect(page).toHaveURL(/\/ar\/suite$/);

    // PO decision 5: the strictest rule of the member's organizations (16 here), Arabic then English.
    await expectShorterPasswordRefused(page, 'ar');
    await expectShorterPasswordRefused(page, 'en');
    await expect(page.getByTestId('profile-mfa-status')).toHaveText('On · authenticator app');
  });

  test("a user manager ends a member's sign-in sessions; the member signs in again", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const memberContext = await browser.newContext();
    const adminContext = await browser.newContext();
    const member = await memberContext.newPage();
    const admin = await adminContext.newPage();
    try {
      await signIn(member, 'en', memberEmail ?? '', memberPassword ?? '');
      await expect(member).toHaveURL(/\/en\/mfa$/);
      await enterCode(member, memberKey);
      await expect(member).toHaveURL(/\/en\/suite$/);
      await member.goto('/en/suite/profile');
      const own = member.getByTestId('sessions-own');
      await expect(own.locator('[data-testid="session-row"][data-current="true"]')).toHaveCount(1);

      // The admin's own sign-in now needs the code too (required for everyone).
      await signIn(admin, 'en', adminEmail ?? '', adminPassword ?? '');
      await expect(admin).toHaveURL(/\/en\/mfa$/);
      await expect(admin.getByTestId('mfa-challenge')).toBeVisible();
      await enterCode(admin, adminKey);
      await expect(admin).toHaveURL(/\/en\/suite$/);
      await admin.goto(`/en/suite/admin/users/${MONA}`);
      await expect(admin.getByTestId('user-mfa-status')).toContainText(
        'On · authenticator app since',
      );
      const sessions = admin.getByTestId('sessions-member');
      await expect(sessions.getByTestId('session-row').first()).toBeVisible();
      await expectNoSeriousA11yViolations(admin);
      await sessions.getByTestId('sessions-end-all').click();
      await expect(admin.getByTestId('sessions-message')).toHaveText(
        'The selected sign-in sessions have ended.',
      );
      await expect(sessions.getByTestId('session-row')).toHaveCount(0);

      // The member's next request is refused: the sign-in page says why and signs the session out.
      const signedOut = member.waitForResponse(
        (response: Response) =>
          response.request().method() === 'POST' &&
          response.request().headers()['next-action'] !== undefined,
      );
      await member.reload();
      await expect(member).toHaveURL(/\/en\/sign-in\?notice=session-ended$/);
      await expect(member.getByTestId('session-ended-notice')).toHaveText(
        'Your sign-in session has ended. Sign in again to continue.',
      );
      await signedOut;
      await member.waitForLoadState('networkidle');
      // Only the sessions ended, not the account.
      await signIn(member, 'en', memberEmail ?? '', memberPassword ?? '');
      await expect(member).toHaveURL(/\/en\/mfa$/);
      await enterCode(member, memberKey);
      await expect(member).toHaveURL(/\/en\/suite$/);
    } finally {
      await memberContext.close();
      await adminContext.close();
    }
  });
});
