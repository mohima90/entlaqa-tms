import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { type Browser, type Page, expect, test } from '@playwright/test';
import { afterSignIn, signInToSuite } from './sign-in';

/**
 * Invitations, admin side (T-M2-07, FR-IAM-03; screens 1 and 2; Kawadir's codes, PO 16 Oct 2026) against
 * a configured deployment: runs in the self-hosted smoke (infra/docker/smoke.sh) after
 * infra/docker/seed-users.sql, signed in as the provisioned Organization Admin. Skipped in the default CI
 * run (no Auth server, no data). The e-mail itself is checked in Mailpit by smoke.sh; the code and its
 * link work without it (copy link → sign up in a fresh browser, the typed code, resend = a new code).
 */
const email = process.env.SIGNED_IN_E2E_EMAIL;
const password = process.env.SIGNED_IN_E2E_PASSWORD;
const run = Date.now().toString(36);
const CODE = /^[A-HJ-NP-Z2-9]{8}$/;

/** The invited users' list rows. */
const rowsOf = (page: Page) => page.getByTestId('invitations-list').getByTestId('invitation-row');

/** Invites a learner through the form and returns the code shown right away (Kawadir). */
async function inviteLearner(page: Page, invitee: string, locale: 'ar' | 'en') {
  await page.goto(`/${locale}/suite/admin/users/invite`);
  const form = page.getByTestId('invite-user');
  await form.locator('#invite-email').fill(invitee);
  await form.locator('#invite-firstNameAr').fill('سلمى');
  await form.locator('#invite-familyNameAr').fill('الحربي');
  await form.getByRole('radio', { name: locale === 'ar' ? /^متدرب/ : /^Learner/ }).check();
  await form.getByRole('radio', { name: locale === 'ar' ? 'العربية' : 'English' }).check();
  await form
    .getByRole('button', { name: locale === 'ar' ? 'إرسال الدعوة' : 'Send invitation' })
    .click();
  const panel = page.getByTestId('invitation-created-panel');
  await expect(panel).toBeVisible();
  const code = (await panel.getByTestId('invite-code').textContent()) ?? '';
  expect(code).toMatch(CODE);
  return code;
}

/** Creates the account on the sign-up page of a FRESH browser (no admin session) and lands signed in. */
async function signUpInFreshBrowser(
  browser: Browser,
  locale: 'ar' | 'en',
  open: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await open(page);
  await expect(page.getByTestId('sign-up-code-valid')).toBeVisible();
  const secret = `Joiner-${randomUUID()}`;
  await page.locator('#invite-password').fill(secret);
  await page.locator('#invite-password-confirm').fill(secret);
  await page.getByTestId('invite-privacy').check();
  await page.getByRole('button', { name: locale === 'ar' ? /^انضم إلى / : /^Join / }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${locale}/(suite|select-organization|mfa)$`),
    afterSignIn,
  );
  await context.close();
}

async function signIn(page: Page) {
  await signInToSuite(page, email, password);
}

async function expectNoSeriousA11yViolations(page: Page) {
  // After an in-app navigation (router.replace + refresh) the framework swaps the page's <title> while the
  // new tree streams in: check the page once it has its title again (and fail if it never gets one).
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test.describe('invitations (admin side)', () => {
  test.skip(!email || !password, 'SIGNED_IN_E2E_* not set');
  test.describe.configure({ mode: 'serial' });

  test('English: invite, see it on the invited tab, resend, revoke', async ({ page }) => {
    const invitee = `invitee-en-${run}@sovereign.example`;
    await signIn(page);
    await page.goto('/en/suite/admin/users');
    await page.getByTestId('invite-user-link').click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/users\/invite$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Invite a user');
    const form = page.getByTestId('invite-user');
    // AAL1 Organization Admin: privileged roles are open, no authenticator code (PO decision, 14 Oct 2026).
    await expect(form.getByTestId('privileged-locked')).toHaveCount(0);
    await expect(form.getByRole('radio', { name: /^Organization Admin/ })).toBeEnabled();
    await expect(form.getByTestId('invite-notice')).toContainText('7 days');
    // Separation of duties (BR-IAM-4, T-M2-16): explained next to the roles.
    await expect(form.getByTestId('role-conflict-hint')).toContainText(
      "Organization Admin is a setup-only role and can't be combined with any other role",
    );
    await expectNoSeriousA11yViolations(page);

    // Required fields are reported inline
    await form.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByTestId('invite-message')).toBeVisible();
    await expect(form.locator('#invite-email-error')).toBeVisible();
    await expect(form.locator('#invite-firstNameAr-error')).toHaveText('This field is required.');
    await expect(form.locator('#invite-primary-error')).toHaveText('Choose a primary role.');

    await form.locator('#invite-email').fill(invitee.toUpperCase());
    await form.locator('#invite-firstNameAr').fill('نورة');
    await form.locator('#invite-familyNameAr').fill('الدوسري');
    await form.getByRole('button', { name: 'Add the name in English (optional)' }).click();
    await form.locator('#invite-firstNameEn').fill('Noura');
    await form.locator('#invite-familyNameEn').fill('Aldossari');
    await form.locator('#invite-employeeNumber').fill(`EMP-${run}`);
    await form.getByRole('radio', { name: /^Training Coordinator/ }).check();
    await form.getByRole('button', { name: 'Learner', exact: true }).click();
    await expect(form.getByRole('button', { name: 'Learner', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await form.getByRole('radio', { name: 'English' }).check();
    await form.getByRole('button', { name: 'Send invitation' }).click();

    // Kawadir: the code and the copy buttons right away (no e-mail needed).
    const panel = page.getByTestId('invitation-created-panel');
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Invitation created');
    await expect(panel.getByRole('heading', { level: 2 })).toBeFocused();
    const code = (await panel.getByTestId('invite-code').textContent()) ?? '';
    expect(code).toMatch(CODE);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await panel.getByRole('button', { name: 'Copy invite link' }).click();
    await expect(panel.getByRole('status')).toHaveText('Invitation link copied.');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(`${new URL(page.url()).origin}/en/sign-up#code=${code}`);
    await panel.getByRole('button', { name: 'Copy code' }).click();
    await expect(panel.getByRole('status')).toHaveText('Invitation code copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    await expectNoSeriousA11yViolations(page);

    // On to the users list, invited tab, with the confirmation
    await panel.getByRole('link', { name: 'Go to invited users' }).click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/users\?tab=invited&invited=1$/);
    await expect(page.getByTestId('invitation-created')).toContainText('Invitation created');
    const row = rowsOf(page).filter({ hasText: invitee });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Training Coordinator');
    await expect(row).toContainText('Invited');
    await expect(row).toContainText('Expires on');
    // The same code, copyable any time (Kawadir's pending-invite row).
    await expect(row.getByTestId('invite-code')).toHaveText(code);
    await expect(row.getByRole('button', { name: /^Copy invite link \(/ })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // Resend inline: a new code; the old one stops working.
    await row.getByRole('button', { name: /^Resend invitation \(/ }).click();
    await expect(page.getByTestId('invitations-message')).toContainText(
      'Invitation resent with a new code.',
    );
    await expect(row.getByTestId('invite-code')).not.toHaveText(code);

    // Revoke after the confirmation; the invitation leaves the list
    await row.getByRole('button', { name: /^Revoke invitation \(/ }).click();
    await expect(row).toContainText('The invitation link stops working immediately.');
    await row.getByRole('button', { name: 'Revoke invitation', exact: true }).click();
    await expect(page.getByTestId('invitations-message')).toContainText('Invitation revoked');
    await expect(rowsOf(page).filter({ hasText: invitee })).toHaveCount(0);
  });

  test('Arabic: right-to-left form, e-mail already invited, revoke', async ({ page }) => {
    const invitee = `invitee-ar-${run}@sovereign.example`;
    await signIn(page);
    await page.goto('/ar/suite/admin/users/invite');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('دعوة مستخدم');
    const form = page.getByTestId('invite-user');
    await expect(form.getByTestId('invite-notice')).toContainText('تبقى الدعوة صالحة 7 أيام');
    await expect(form.getByTestId('role-conflict-hint')).toContainText(
      'مدير المنشأة دور إعداد فقط ولا يُجمع مع أي دور آخر',
    );
    await expectNoSeriousA11yViolations(page);

    const invite = async () => {
      await form.locator('#invite-email').fill(invitee);
      await form.locator('#invite-firstNameAr').fill('أحمد');
      await form.locator('#invite-familyNameAr').fill('منصور');
      await form.getByRole('radio', { name: /^متدرب/ }).check();
      await form.getByRole('button', { name: 'إرسال الدعوة' }).click();
    };
    await invite();
    const panel = page.getByTestId('invitation-created-panel');
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText('أُنشئت الدعوة');
    await expect(panel.getByRole('button', { name: 'نسخ الرابط' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'نسخ الرمز' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await panel.getByRole('link', { name: 'الانتقال إلى المدعوين' }).click();
    await expect(page).toHaveURL(/\/ar\/suite\/admin\/users\?tab=invited&invited=1$/);
    await expect(page.getByTestId('invitation-created')).toContainText('أنشأنا الدعوة');
    const row = rowsOf(page).filter({ hasText: invitee });
    await expect(row).toContainText('أحمد منصور');
    await expect(row).toContainText('مدعو');
    await expect(page.getByRole('link', { name: /مدعو/ })).toHaveAttribute('aria-current', 'page');
    await expectNoSeriousA11yViolations(page);

    // The same e-mail again: refused next to the field
    await page.goto('/ar/suite/admin/users/invite');
    await invite();
    await expect(form.locator('#invite-email-error')).toContainText(
      'هذا البريد مسجّل لشخص آخر في المنشأة',
    );
    await expect(page).toHaveURL(/\/ar\/suite\/admin\/users\/invite$/);

    // Revoke (clean-up) in Arabic
    await page.goto('/ar/suite/admin/users?tab=invited');
    await row.getByRole('button', { name: /^إلغاء الدعوة \(/ }).click();
    await row.getByRole('button', { name: 'إلغاء الدعوة', exact: true }).click();
    await expect(page.getByTestId('invitations-message')).toContainText('أُلغيت الدعوة');
    await expect(rowsOf(page).filter({ hasText: invitee })).toHaveCount(0);
  });

  test('English: copy the link, open it in a fresh browser, sign up, signed in', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const code = await inviteLearner(page, `joiner-en-${run}@sovereign.example`, 'en');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page
      .getByTestId('invitation-created-panel')
      .getByRole('button', { name: 'Copy invite link' })
      .click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link.endsWith(`/en/sign-up#code=${code}`)).toBe(true);
    await signUpInFreshBrowser(browser, 'en', async (fresh) => {
      await fresh.goto(link);
      // The code came with the link: filled in, locked, gone from the address bar.
      await expect(fresh.getByTestId('sign-up-code')).toHaveValue(code);
      await expect(fresh.getByTestId('sign-up-code')).toHaveAttribute('readonly', '');
      expect(new URL(fresh.url()).hash).toBe('');
      await expect(fresh.getByRole('heading', { level: 1 })).toContainText('Join ');
      await expect(fresh.getByLabel('Sign-in email')).toHaveValue(
        `joiner-en-${run}@sovereign.example`,
      );
      await expectNoSeriousA11yViolations(fresh);
    });
  });

  test('Arabic: the code typed by hand (any case) on the sign-up page, signed in', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const code = await inviteLearner(page, `joiner-ar-${run}@sovereign.example`, 'ar');
    await signUpInFreshBrowser(browser, 'ar', async (fresh) => {
      await fresh.goto('/ar/suite');
      await expect(fresh).toHaveURL(/\/ar\/sign-in$/);
      await fresh.getByRole('link', { name: 'انضم بالرمز' }).click();
      await expect(fresh).toHaveURL(/\/ar\/sign-up$/);
      await fresh.getByTestId('sign-up-code').fill(code.toLowerCase());
      await expect(fresh.getByTestId('sign-up-code')).toHaveValue(code);
      await expect(fresh.locator('html')).toHaveAttribute('dir', 'rtl');
      await expectNoSeriousA11yViolations(fresh);
    });
  });

  test('resend: the new code opens the sign-up page, the old one no longer does', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const invitee = `joiner-resend-${run}@sovereign.example`;
    const first = await inviteLearner(page, invitee, 'en');
    await page.goto('/en/suite/admin/users?tab=invited');
    const row = rowsOf(page).filter({ hasText: invitee });
    await row.getByRole('button', { name: /^Resend invitation \(/ }).click();
    await expect(page.getByTestId('invitations-message')).toContainText('new code');
    await expect(row.getByTestId('invite-code')).not.toHaveText(first);
    const second = (await row.getByTestId('invite-code').textContent()) ?? '';
    expect(second).toMatch(CODE);

    const context = await browser.newContext();
    const fresh = await context.newPage();
    await fresh.goto(`/en/sign-up#code=${first}`);
    await expect(fresh.locator('#sign-up-code-error')).toHaveText(
      "This code isn't valid. Check it and try again.",
    );
    await fresh.goto(`/en/sign-up#code=${second}`);
    await expect(fresh.getByTestId('sign-up-code-valid')).toBeVisible();
    await context.close();
  });
});

/**
 * Invitations left pending for the acceptance E2E (invite-accept.spec.ts): smoke.sh passes fresh
 * addresses, then reads each e-mailed link from Mailpit (the token exists only in the e-mail). Arabic
 * invitation, Learner with Line Manager as an additional role.
 */
const pendingInvitees = (process.env.INVITE_E2E_PENDING_EMAILS ?? '').split(',').filter(Boolean);

test.describe('invitations left pending (for the acceptance E2E)', () => {
  test.skip(
    !email || !password || pendingInvitees.length === 0,
    'INVITE_E2E_PENDING_EMAILS not set',
  );

  test('invites each address through the form', async ({ page }) => {
    await signIn(page);
    for (const invitee of pendingInvitees) {
      await page.goto('/en/suite/admin/users/invite');
      const form = page.getByTestId('invite-user');
      await form.locator('#invite-email').fill(invitee);
      await form.locator('#invite-firstNameAr').fill('ريم');
      await form.locator('#invite-familyNameAr').fill('العتيبي');
      await form.getByRole('radio', { name: /^Learner/ }).check();
      await form.getByRole('button', { name: 'Line Manager', exact: true }).click();
      await expect(form.getByRole('button', { name: 'Line Manager', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await form.getByRole('radio', { name: 'العربية' }).check();
      await form.getByRole('button', { name: 'Send invitation' }).click();
      await expect(page.getByTestId('invitation-created-panel')).toBeVisible();
      await page.goto('/en/suite/admin/users?tab=invited');
      const row = rowsOf(page).filter({ hasText: invitee });
      await expect(row).toContainText('Invited');
    }
  });
});
