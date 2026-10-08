import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Invitations, admin side (T-M2-07, FR-IAM-03; screens 1 and 2) against a configured deployment:
 * runs in the self-hosted smoke (infra/docker/smoke.sh) after infra/docker/seed-users.sql, signed in
 * as the provisioned Organization Admin (AAL1: privileged roles stay locked). Skipped in the default
 * CI run (no Auth server, no data). The e-mail itself is checked in Mailpit by smoke.sh.
 */
const email = process.env.SIGNED_IN_E2E_EMAIL;
const password = process.env.SIGNED_IN_E2E_PASSWORD;
const run = Date.now().toString(36);

async function signIn(page: Page) {
  await page.goto('/en/sign-in');
  await page.getByLabel('Email').fill(email ?? '');
  await page.getByLabel('Password').fill(password ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/suite$/);
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
    // AAL1 Organization Admin: privileged roles need an authenticator code first.
    await expect(form.getByTestId('privileged-locked')).toContainText('authenticator app');
    await expect(form.getByRole('radio', { name: /^Organization Admin/ })).toBeDisabled();
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

    // Back on the users list, invited tab, with the confirmation
    await expect(page).toHaveURL(/\/en\/suite\/admin\/users\?tab=invited&invited=1$/);
    await expect(page.getByTestId('invitation-created')).toContainText('Invitation created');
    const row = page.getByTestId('invitations-table').getByRole('row').filter({ hasText: invitee });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Training Coordinator');
    await expect(row).toContainText('Invited');
    await expect(row).toContainText('Expires on');
    await expectNoSeriousA11yViolations(page);

    // Resend inline
    await row.getByRole('button', { name: /^Resend invitation \(/ }).click();
    await expect(page.getByTestId('invitations-message')).toContainText('Invitation resent.');

    // Revoke after the confirmation; the invitation leaves the list
    await row.getByRole('button', { name: /^Revoke invitation \(/ }).click();
    await expect(row).toContainText('The invitation link stops working immediately.');
    await row.getByRole('button', { name: 'Revoke invitation', exact: true }).click();
    await expect(page.getByTestId('invitations-message')).toContainText('Invitation revoked');
    await expect(
      page.getByTestId('invitations-table').getByRole('row').filter({ hasText: invitee }),
    ).toHaveCount(0);
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
    await expect(page).toHaveURL(/\/ar\/suite\/admin\/users\?tab=invited&invited=1$/);
    await expect(page.getByTestId('invitation-created')).toContainText('أنشأنا الدعوة');
    const row = page.getByTestId('invitations-table').getByRole('row').filter({ hasText: invitee });
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
    await expect(
      page.getByTestId('invitations-table').getByRole('row').filter({ hasText: invitee }),
    ).toHaveCount(0);
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
      await expect(page).toHaveURL(/\/en\/suite\/admin\/users\?tab=invited&invited=1$/);
      const row = page
        .getByTestId('invitations-table')
        .getByRole('row')
        .filter({ hasText: invitee });
      await expect(row).toContainText('Invited');
    }
  });
});
