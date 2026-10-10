import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import {
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
  expect,
  test,
} from '@playwright/test';
import { freshCode, wrongCode } from './totp';

/**
 * Security policy per organization (FR-IAM-12, FR-IAM-13; T-M2-10 and its security review; approved
 * screens 3 and 6) on the self-hosted stack (infra/docker/smoke.sh, the LAST browser journey: it makes an
 * authenticator app required for everyone in the smoke organization). Real Auth, real TOTP codes computed
 * from the set-up key the page shows (RFC 6238), real e-mails read from the stand-in relay through
 * infra/docker/e2e-helper.sh. Covers, in Arabic and English:
 *  - a new app counts only once its owner opened the e-mailed confirmation link (review H1): the waiting
 *    state, "send again" (only the newest link works), single use, the link opened on another device;
 *  - "not you? remove this app": the app is removed and every session of the account ends;
 *  - the Organization Admin changes the policy only with a code (AAL2, PO decision D-IAM-01); lockout
 *    limited to the platform default or stricter, applied with the next update (badge);
 *  - an organization that requires MFA makes a member set an app up, then asks for its code at sign-in;
 *  - a new password shorter than the strictest rule of the member's organizations is refused;
 *  - a user manager ends a member's sign-in sessions; the member must sign in again;
 *  - a code older than 15 minutes is asked again before a high-risk action, which then goes on (L3);
 *    `next` never leaves the suite;
 *  - the Organization Admin resets a member's lost app after a confirmation (PO answer, 9 Oct 2026); a
 *    member without user management sees no reset.
 * Skipped without credentials (default CI run).
 */
const adminEmail = process.env.SIGNED_IN_E2E_EMAIL ?? '';
const adminPassword = process.env.SIGNED_IN_E2E_PASSWORD ?? '';
const memberEmail = process.env.SIGNED_IN_E2E_MANAGER_EMAIL ?? '';
/** The member's password after profile.spec changed it. */
const memberPassword = process.env.SECURITY_E2E_MANAGER_PASSWORD ?? '';
/** infra/docker/e2e-helper.sh: the set-up e-mail's links (the relay) and an older code (Auth). */
const helper = process.env.SECURITY_E2E_HELPER ?? '';
/** A private temporary file of the smoke test: the set-up keys, for its leak checks (never printed). */
const keysFile = process.env.SECURITY_E2E_KEYS_FILE;
/** Mona Saeed Alzahrani (infra/docker/seed-users.sql): the member above. */
const MONA = '5eed1000-0000-4000-8000-000000000003';
/** Khalid, Mona's report (invited, no account). */
const KHALID = '5eed1000-0000-4000-8000-000000000002';
/** At least 12 characters (the platform minimum), shorter than the 16 this spec sets. */
const SHORTER_PASSWORD = 'shorter-pass14';

/** Set-up keys of the apps this spec registers (kept in memory only, never logged). */
let adminKey = '';
let memberKey = '';

function runHelper(args: readonly string[]): string {
  return execFileSync('bash', [helper, ...args], { encoding: 'utf8', timeout: 150_000 }).trim();
}

/** The confirm / remove link of the newest set-up e-mail once at least `count` reached `address`. */
function mfaLink(address: string, kind: 'confirm' | 'remove', locale: 'ar' | 'en', count: number) {
  return runHelper(['mfa-link', address, kind, locale, String(count)]);
}

function rememberKey(key: string) {
  if (keysFile) appendFileSync(keysFile, `${key}\n`, { mode: 0o600 });
}

async function enterCode(page: Page, key: string) {
  await page.getByTestId('mfa-code').fill(await freshCode(key));
  await page.getByTestId('mfa-verify').click();
}

/**
 * Sets up an app on the /mfa page: start → QR code and key → first code. The app then waits for its
 * e-mailed confirmation (review H1): the page shows that state. Returns the key.
 */
async function setUpApp(page: Page): Promise<string> {
  await page.getByTestId('mfa-start').click();
  await expect(page.getByTestId('mfa-qr')).toBeVisible();
  const key = ((await page.getByTestId('mfa-secret').textContent()) ?? '').replace(/\s/g, '');
  expect(key).toMatch(/^[A-Z2-7]{16,64}$/);
  rememberKey(key);
  await enterCode(page, key);
  await expect(page.getByTestId('mfa-pending')).toBeVisible();
  return key;
}

/**
 * Opens an e-mailed link as a new page load: from a page of the same path, a link that differs only in
 * its fragment would be a same-document navigation (no request, no new page).
 */
async function openLink(page: Page, url: string): Promise<Response | null> {
  await page.goto('about:blank');
  return page.goto(url);
}

/** Opens an e-mailed authenticator link and clicks its one button (the token leaves the address bar). */
async function useMfaLink(page: Page, url: string) {
  await openLink(page, url);
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  await page.getByTestId('mfa-link-submit').click();
}

async function signIn(page: Page, locale: 'ar' | 'en', email: string, secret: string) {
  await page.goto(`/${locale}/sign-in`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(secret);
  await page.getByRole('button', { name: locale === 'ar' ? 'تسجيل الدخول' : 'Sign in' }).click();
}

/** Signs in and passes the code of an organization that requires one. */
async function signInWithCode(
  page: Page,
  locale: 'ar' | 'en',
  email: string,
  secret: string,
  key: string,
) {
  await signIn(page, locale, email, secret);
  await expect(page).toHaveURL(new RegExp(`/${locale}/mfa$`));
  await expect(page.getByTestId('mfa-challenge')).toBeVisible();
  await enterCode(page, key);
  await expect(page).toHaveURL(new RegExp(`/${locale}/suite$`));
}

/** The browser's next request ends on the sign-in page with the notice (and the session is signed out). */
async function expectSessionEnded(page: Page, locale: 'ar' | 'en') {
  const signedOut = page.waitForResponse(
    (response: Response) =>
      response.request().method() === 'POST' &&
      response.request().headers()['next-action'] !== undefined,
  );
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/${locale}/sign-in\\?notice=session-ended$`));
  await signedOut;
  await page.waitForLoadState('networkidle');
}

async function withContext<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext();
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

/**
 * Makes the browser's session look expired (the `expires_at` of the Supabase session cookie, possibly
 * chunked), so the next page request refreshes it at Auth — as happens every 15 minutes. Auth then issues
 * an access token whose `amr` carries the time of the session's code (aged by e2e-helper.sh age-code).
 */
async function expireAccessToken(context: BrowserContext) {
  const pattern = /^sb-.+-auth-token(\.\d+)?$/;
  const cookies = (await context.cookies()).filter((c) => pattern.test(c.name));
  const base = cookies[0]?.name.replace(/\.\d+$/, '');
  if (!base) throw new Error('no session cookie');
  const index = (name: string) => (name === base ? -1 : Number(name.slice(base.length + 1)));
  const ordered = cookies.sort((a, b) => index(a.name) - index(b.name));
  const raw = ordered.map((c) => c.value).join('');
  if (!raw.startsWith('base64-')) throw new Error('unexpected session cookie encoding');
  const session = JSON.parse(Buffer.from(raw.slice(7), 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  session.expires_at = Math.floor(Date.now() / 1000) - 60;
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
  const template = ordered[0];
  if (!template) throw new Error('no session cookie');
  await context.clearCookies({ name: pattern });
  // @supabase/ssr: one cookie up to 3,180 characters, else `.0`, `.1`, … (base64url needs no encoding).
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += 3180) chunks.push(value.slice(i, i + 3180));
  await context.addCookies(
    chunks.map((chunk, i) => ({
      name: chunks.length === 1 ? base : `${base}.${String(i)}`,
      value: chunk,
      domain: template.domain,
      path: template.path,
      expires: template.expires,
      httpOnly: template.httpOnly,
      secure: template.secure,
      sameSite: template.sameSite,
    })),
  );
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
  await page.locator('#password-current').fill(memberPassword);
  await page.locator('#password-new').fill(SHORTER_PASSWORD);
  await page.locator('#password-confirm').fill(SHORTER_PASSWORD);
  await page
    .getByRole('button', { name: locale === 'ar' ? 'تغيير كلمة المرور' : 'Change password' })
    .click();
  await expect(page.locator('#password-new-error')).toHaveText(`${rule}.`);
}

test.describe('Security policy, MFA and sign-in sessions', () => {
  test.skip(
    !adminEmail || !adminPassword || !memberEmail || !memberPassword || !helper,
    'security E2E credentials or the smoke helper not set',
  );
  test.describe.configure({ mode: 'serial' });

  test('the Organization Admin confirms a new app from the mailbox, then changes the policy with a code', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await signIn(page, 'en', adminEmail, adminPassword);
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

    // No app yet: the code page sets one up…
    await page.getByTestId('security-step-up-link').click();
    const stepUpUrl = /\/en\/mfa\?next=%2Fen%2Fsuite%2Fadmin%2Fsecurity$/;
    await expect(page).toHaveURL(stepUpUrl);
    await expect(page.getByTestId('mfa-enrol')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    adminKey = await setUpApp(page);
    // …which counts only once it is confirmed from the mailbox (review H1): the page says so and stays.
    await expect(page).toHaveURL(stepUpUrl);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Confirm your authenticator app',
    );
    await expect(page.getByTestId('mfa-pending-steps')).toContainText(
      'Check your email to finish turning it on.',
    );
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('mfa-pending-check').click();
    await expect(page.getByTestId('mfa-pending-message')).toHaveText(
      "The app isn't confirmed yet. Open the link in the email first, then check again.",
    );
    await expect(page).toHaveURL(stepUpUrl);
    // The settings are still read only: a code from an unconfirmed app does not count.
    await page.goto('/en/suite/admin/security');
    await expect(page.getByTestId('security-step-up')).toBeVisible();
    await page.getByTestId('security-step-up-link').click();
    await expect(page.getByTestId('mfa-pending')).toBeVisible();

    // "Send the email again": only the newest link works.
    const first = mfaLink(adminEmail, 'confirm', 'en', 1);
    await page.getByTestId('mfa-pending-resend').click();
    await expect(page.getByTestId('mfa-pending-message')).toHaveText(
      "We've sent the email again. Only the link in the newest email works.",
    );
    const newest = mfaLink(adminEmail, 'confirm', 'en', 2);
    expect(newest).not.toBe(first);

    // The e-mail opened on another device, without a session: one click confirms; the replaced link and a
    // second use of the newest change nothing.
    await withContext(browser, async (mail) => {
      await useMfaLink(mail, first);
      await expect(mail.getByTestId('mfa-link-invalid')).toBeVisible();
      await expect(mail.getByRole('heading', { level: 1 })).toHaveText("This link isn't valid");

      const response = await openLink(mail, newest);
      expect(response?.headers()['referrer-policy']).toBe('no-referrer');
      await expect(mail.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
      await expect(mail.getByRole('heading', { level: 1 })).toHaveText(
        'Confirm your authenticator app',
      );
      await expectNoSeriousA11yViolations(mail);
      await useMfaLink(mail, newest);
      await expect(mail.getByTestId('mfa-link-confirmed')).toBeVisible();
      await expect(mail.getByRole('heading', { level: 1 })).toHaveText(
        'Authenticator app confirmed',
      );
      await expect(mail.getByRole('heading', { level: 1 })).toBeFocused();
      await expect(mail.getByTestId('mfa-link-continue')).toHaveAttribute('href', '/en/suite');
      await expectNoSeriousA11yViolations(mail);

      await useMfaLink(mail, newest);
      await expect(mail.getByTestId('mfa-link-invalid')).toBeVisible();
    });

    // Back on the set-up page: "check again" goes on to the settings, now editable.
    await page.getByTestId('mfa-pending-check').click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/security$/);
    await expect(page.getByTestId('security-step-up')).toHaveCount(0);

    // Lockout: the platform default or stricter (review L5), applied by the sign-in limiter (T-M2-11).
    await expect(page.getByTestId('security-lockout-pending')).toHaveText(
      'Takes effect with the next update',
    );
    await page.getByTestId('security-lockoutThreshold').fill('10');
    await page.getByTestId('security-lockoutMinutes').fill('5');
    await page.getByTestId('security-save').click();
    await expect(page.locator('#security-lockoutThreshold-error')).toHaveText(
      'Enter a whole number from 3 to 5.',
    );
    await expect(page.locator('#security-lockoutMinutes-error')).toHaveText(
      'Enter a whole number from 15 to 60.',
    );
    await page.getByTestId('security-lockoutThreshold').fill('5');
    await page.getByTestId('security-lockoutMinutes').fill('15');

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
    await expect(page.getByTestId('security-lockout-pending')).toHaveText('يسري مع التحديث القادم');
    await expectNoSeriousA11yViolations(page);
  });

  test('"not you": the e-mailed link removes an app and ends every session; a confirmed app is asked for at sign-in', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await signIn(page, 'ar', memberEmail, memberPassword);
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
    await setUpApp(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تأكيد تطبيق المصادقة');
    await expect(page.getByTestId('mfa-skip')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    // Not confirmed: still refused.
    await page.goto('/ar/suite');
    await expect(page).toHaveURL(/\/ar\/mfa$/);
    await expect(page.getByTestId('mfa-pending')).toBeVisible();

    // "Not you? Remove this app" from the e-mail, opened elsewhere: the app goes, every session ends.
    const remove = mfaLink(memberEmail, 'remove', 'ar', 1);
    await withContext(browser, async (mail) => {
      await openLink(mail, remove);
      await expect(mail.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(mail.getByRole('heading', { level: 1 })).toHaveText('إزالة تطبيق المصادقة');
      await expect(mail.getByTestId('mfa-link-submit')).toHaveText(
        'إزالة التطبيق وتسجيل الخروج من كل الأجهزة',
      );
      await expectNoSeriousA11yViolations(mail);
      await useMfaLink(mail, remove);
      await expect(mail.getByTestId('mfa-link-removed')).toBeVisible();
      await expect(mail.getByRole('heading', { level: 1 })).toHaveText('أُزيل التطبيق');
      await expect(mail.getByTestId('mfa-link-new-password')).toHaveAttribute(
        'href',
        '/ar/forgot-password',
      );
      await expectNoSeriousA11yViolations(mail);
    });
    await expectSessionEnded(page, 'ar');

    // A new app, confirmed from the e-mail on the same device: "continue" goes on into the suite.
    await signIn(page, 'ar', memberEmail, memberPassword);
    await expect(page).toHaveURL(/\/ar\/mfa$/);
    await expect(page.getByTestId('mfa-enrol')).toBeVisible();
    memberKey = await setUpApp(page);
    const confirm = mfaLink(memberEmail, 'confirm', 'ar', 2);
    await useMfaLink(page, confirm);
    await expect(page.getByTestId('mfa-link-confirmed')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تم تأكيد تطبيق المصادقة');
    await page.getByTestId('mfa-link-continue').click();
    await expect(page).toHaveURL(/\/ar\/suite$/);

    // The next sign-in asks for the app's code; a wrong code is refused.
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await expect(page).toHaveURL(/\/ar\/sign-in$/);
    await signIn(page, 'ar', memberEmail, memberPassword);
    await expect(page).toHaveURL(/\/ar\/mfa$/);
    await expect(page.getByTestId('mfa-challenge')).toBeVisible();
    // Lost the app: the administrator resets it, or ENTLAQA support (no contradicting texts).
    await expect(page.getByText(/فريق دعم ENTLAQA/)).toBeVisible();
    await page.getByTestId('mfa-code').fill(wrongCode(memberKey));
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
      await signInWithCode(member, 'en', memberEmail, memberPassword, memberKey);
      await member.goto('/en/suite/profile');
      const own = member.getByTestId('sessions-own');
      await expect(own.locator('[data-testid="session-row"][data-current="true"]')).toHaveCount(1);

      // The admin's own sign-in now needs the code too (required for everyone).
      await signInWithCode(admin, 'en', adminEmail, adminPassword, adminKey);
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
      await expectSessionEnded(member, 'en');
      await expect(member.getByTestId('session-ended-notice')).toHaveText(
        'Your sign-in session has ended. Sign in again to continue.',
      );
      // Only the sessions ended, not the account.
      await signInWithCode(member, 'en', memberEmail, memberPassword, memberKey);
    } finally {
      await memberContext.close();
      await adminContext.close();
    }
  });

  test('a code older than 15 minutes is asked again; then the Organization Admin resets a lost app', async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await signInWithCode(page, 'en', adminEmail, adminPassword, adminKey);
    // `next` never leaves the suite: anything else goes to the suite home.
    await page.goto('/en/mfa?next=https%3A%2F%2Fevil.example%2Fen%2Fsuite');
    await expect(page).toHaveURL(/\/en\/suite$/);

    // The code was entered 20 minutes ago (as far as Auth's next token says).
    expect(Number(runHelper(['age-code', adminEmail]))).toBeGreaterThanOrEqual(1);
    await expireAccessToken(context);
    const profile = `/en/suite/admin/users/${MONA}`;
    await page.goto(profile);
    const reset = page.getByTestId('user-mfa-reset');
    await expect(reset).toContainText(
      'Resetting it needs a code from your own authenticator app, entered in the last 15 minutes.',
    );
    await expect(page.getByTestId('user-mfa-reset-open')).toHaveCount(0);
    await expect(page.getByTestId('user-mfa-reset-support')).toContainText('ENTLAQA support');
    // The settings too.
    await page.goto('/en/suite/admin/security');
    await expect(page.getByTestId('security-step-up')).toBeVisible();

    // The code step asks again and returns to the profile.
    await page.goto(profile);
    await page.getByTestId('user-mfa-reset-step-up').click();
    await expect(page).toHaveURL(
      new RegExp(`/en/mfa\\?next=%2Fen%2Fsuite%2Fadmin%2Fusers%2F${MONA}$`),
    );
    await expect(page.getByTestId('mfa-challenge')).toBeVisible();
    await expect(page.getByTestId('mfa-intro')).toHaveText(
      'For your security, sensitive actions need a code entered in the last 15 minutes. Enter the code your app shows now.',
    );
    await enterCode(page, adminKey);
    await expect(page).toHaveURL(new RegExp(`${profile}$`));

    // Reset, with a confirmation step (cancel first: nothing happens).
    await page.getByTestId('user-mfa-reset-open').click();
    const dialog = page.getByTestId('user-mfa-reset-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Mona Saeed Alzahrani's authenticator app will be removed");
    await expectNoSeriousA11yViolations(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('user-mfa-status')).toContainText('On · authenticator app since');
    await page.getByTestId('user-mfa-reset-open').click();
    await page.getByTestId('user-mfa-reset-confirm').click();
    await expect(page.getByTestId('user-mfa-reset-message')).toHaveText(
      "Mona Saeed Alzahrani's authenticator app was reset. They've been emailed and will set up a new app at their next sign-in.",
    );
    await expect(page.getByTestId('user-mfa-status')).toHaveText('Not set up');
    await expect(page.getByTestId('sessions-member').getByTestId('session-row')).toHaveCount(0);
  });

  test('after the reset the member sets up a new app; a member without user management sees no reset; the reset in Arabic', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    await withContext(browser, async (member) => {
      await signIn(member, 'en', memberEmail, memberPassword);
      await expect(member).toHaveURL(/\/en\/mfa$/);
      await expect(member.getByTestId('mfa-enrol')).toBeVisible();
      memberKey = await setUpApp(member);
      await expect(member.getByTestId('mfa-pending-steps')).toContainText('72 hours');
      const confirm = mfaLink(memberEmail, 'confirm', 'en', 3);
      const mail = await member.context().newPage();
      await useMfaLink(mail, confirm);
      await expect(mail.getByTestId('mfa-link-confirmed')).toBeVisible();
      await mail.close();
      await member.getByTestId('mfa-pending-check').click();
      await expect(member).toHaveURL(/\/en\/suite$/);
      // A line manager (no user management): her report's profile has no sessions and no reset.
      await member.goto(`/en/suite/admin/users/${KHALID}`);
      await expect(member.getByTestId('user-profile')).toBeVisible();
      await expect(member.getByTestId('user-mfa-reset')).toHaveCount(0);
      await expect(member.getByTestId('sessions-member')).toHaveCount(0);
    });

    await withContext(browser, async (admin) => {
      await signInWithCode(admin, 'ar', adminEmail, adminPassword, adminKey);
      await admin.goto(`/ar/suite/admin/users/${MONA}`);
      await expect(admin.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(admin.getByTestId('user-mfa-status')).toContainText(
        'مفعّل · تطبيق المصادقة منذ',
      );
      // Her Arabic name as the page shows it (profile.spec changed it earlier in the smoke).
      const name = ((await admin.getByRole('heading', { level: 1 }).textContent()) ?? '').trim();
      expect(name).not.toBe('');
      await admin.getByTestId('user-mfa-reset-open').click();
      await expect(admin.getByTestId('user-mfa-reset-dialog')).toContainText(
        `سيُزال تطبيق المصادقة الخاص بـ${name} وتنتهي جميع جلسات دخوله`,
      );
      await expectNoSeriousA11yViolations(admin);
      await admin.getByTestId('user-mfa-reset-confirm').click();
      await expect(admin.getByTestId('user-mfa-reset-message')).toHaveText(
        `أُعيد ضبط تطبيق المصادقة الخاص بـ${name}، وأُبلغ بالبريد الإلكتروني ليُعدّ تطبيقًا جديدًا عند دخوله التالي.`,
      );
      await expect(admin.getByTestId('user-mfa-status')).toHaveText('غير مُعدّ');
      await expectNoSeriousA11yViolations(admin);
    });
  });
});
