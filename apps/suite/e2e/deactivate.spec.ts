import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Deactivate / reactivate a member (T-M2-09, FR-IAM-05; screen 4) against a configured deployment: runs in
 * the self-hosted smoke (infra/docker/smoke.sh) after infra/docker/seed-users.sql and
 * seed-deactivation.sql, in three phases (DEACTIVATE_E2E_PHASE) around the database and Auth checks of the
 * smoke (memberships, audit, the worker's Auth ban and its lifting):
 *  - deactivate  English: Reem (direct report + department head) with reassignment; her open session loses
 *                access at once. Arabic: Huda (nothing to move). Faisal (Auditor, a privileged role): the
 *                authenticator-code step only (the admin has none). A Line Manager gets neither.
 *  - reactivate  Arabic from the deactivated tab (Reem), English from the profile (Huda).
 *  - returns     Reem signs in again, into the organization.
 * Skipped in the default CI run (no Auth server, no data).
 */
const phase = process.env.DEACTIVATE_E2E_PHASE;
const admin = {
  email: process.env.SIGNED_IN_E2E_EMAIL,
  password: process.env.SIGNED_IN_E2E_PASSWORD,
};
const manager = {
  email: process.env.SIGNED_IN_E2E_MANAGER_EMAIL,
  password: process.env.SIGNED_IN_E2E_MANAGER_PASSWORD,
};
const member = {
  email: process.env.DEACTIVATE_E2E_MEMBER_EMAIL,
  password: process.env.DEACTIVATE_E2E_MEMBER_PASSWORD,
};
// infra/docker/seed-deactivation.sql
const REEM = '5eed1000-0000-4000-8000-0000000000d1';
const HUDA = '5eed1000-0000-4000-8000-0000000000d2';

async function signIn(
  page: Page,
  as: { email?: string | undefined; password?: string | undefined },
) {
  await page.goto('/en/sign-in');
  await page.getByLabel('Email').fill(as.email ?? '');
  await page.getByLabel('Password').fill(as.password ?? '');
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

test.describe('deactivate and reactivate members', () => {
  test.skip(
    !phase || !admin.email || !admin.password,
    'DEACTIVATE_E2E_PHASE / SIGNED_IN_E2E_* not set',
  );
  test.describe.configure({ mode: 'serial' });

  test('English: reassign and deactivate; the member’s open session loses access at once', async ({
    browser,
  }) => {
    test.skip(phase !== 'deactivate', 'phase');
    test.skip(!member.email || !member.password, 'DEACTIVATE_E2E_MEMBER_* not set');
    // Reem is signed in and working in the organization.
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, member);

    const adminContext = await browser.newContext();
    const page = await adminContext.newPage();
    await signIn(page, admin);
    await page.goto(`/en/suite/admin/users/${REEM}`);
    await page.getByTestId('deactivate-user-link').click();
    await expect(page).toHaveURL(new RegExp(`/en/suite/admin/users/${REEM}/deactivate$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "Deactivate Reem Nasser Alotaibi's account?",
    );
    await expect(page.getByTestId('deactivation-effects')).toContainText(
      'All records stay as they are',
    );
    const reports = page.getByTestId('kind-platform.direct_reports');
    const departments = page.getByTestId('kind-platform.headed_departments');
    await expect(reports).toContainText('1 person reports directly to this user');
    await expect(reports).toContainText('Yasser Mohammed Alghamdi');
    await expect(departments).toContainText('1 department headed by this user');
    await expect(departments).toContainText('Quality');
    await expectNoSeriousA11yViolations(page);

    // Nothing is sent without a new owner for every kind.
    const submit = page.getByRole('button', { name: 'Move the items and deactivate the account' });
    await submit.click();
    await expect(reports).toContainText('Choose the new owner.');
    await expect(departments).toContainText('Choose the new owner.');
    await expect(page.getByRole('combobox', { name: 'New direct manager' })).toBeFocused();

    // «نقل الكل إلى» fills every kind's picker.
    await page.getByRole('combobox', { name: 'Move all to' }).selectOption({
      label: 'Mona Saeed Alzahrani',
    });
    await expect(page.getByRole('combobox', { name: 'New department head' })).toHaveValue(
      /^[0-9a-f-]{36}$/,
    );
    await page
      .getByRole('combobox', { name: /Reason for deactivation/ })
      .selectOption({ label: 'Long leave' });
    await submit.click();

    await expect(page).toHaveURL(/\/en\/suite\/admin\/users\?tab=deactivated&deactivated=1$/);
    await expect(page.getByTestId('member-deactivated')).toContainText(
      'The account was deactivated',
    );
    const table = page.getByTestId('users-table');
    await expect(table).toContainText('Reem Nasser Alotaibi');
    await expect(table).toContainText('Deactivated');
    await expectNoSeriousA11yViolations(page);

    // Reem's profile: deactivated, offered for reactivation; the report moved to Mona.
    await page.goto(`/en/suite/admin/users/${REEM}`);
    await expect(page.getByTestId('user-profile')).toContainText('Deactivated');
    await expect(page.getByTestId('deactivate-user-link')).toHaveCount(0);
    await expect(page.getByTestId('reactivate-button')).toHaveText('Reactivate user');
    await expect(page.getByTestId('user-activity')).toContainText('Account deactivated');

    // Her open session: the next request is refused by the database (no wait for the Auth ban).
    await memberPage.goto('/en/suite');
    await expect(memberPage).toHaveURL(/\/en\/sign-in$/);
    await memberContext.close();
    await adminContext.close();
  });

  test('Arabic: deactivate a member with nothing to move', async ({ page }) => {
    test.skip(phase !== 'deactivate', 'phase');
    await signIn(page, admin);
    await page.goto(`/ar/suite/admin/users/${HUDA}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('link', { name: 'تعطيل المستخدم' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تعطيل حساب هدى علي القرني؟');
    await expect(page.getByTestId('deactivation-effects')).toContainText(
      'يتوقف الدخول بهذا الحساب إلى المنشأة فورًا',
    );
    await expect(page.getByText('عناصر مسندة إلى هذا المستخدم')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: 'تعطيل الحساب' }).click();
    await expect(page).toHaveURL(/\/ar\/suite\/admin\/users\?tab=deactivated&deactivated=1$/);
    await expect(page.getByTestId('member-deactivated')).toContainText('عُطّل الحساب');
    await expect(page.getByTestId('users-table')).toContainText('هدى علي القرني');
    await expectNoSeriousA11yViolations(page);
  });

  test('a privileged member: the authenticator-code step instead of the form (AAL1 session)', async ({
    page,
  }) => {
    test.skip(phase !== 'deactivate', 'phase');
    await signIn(page, admin);
    await page.goto('/en/suite/admin/users/5eed1000-0000-4000-8000-0000000000d4');
    await page.getByTestId('deactivate-user-link').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "Deactivate Faisal Omar Alharbi's account?",
    );
    await expect(page.getByTestId('deactivation-blocked')).toContainText(
      'needs a code from an authenticator app',
    );
    await expect(page.getByTestId('deactivate')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    await page.goto('/ar/suite/admin/users/5eed1000-0000-4000-8000-0000000000d4/deactivate');
    await expect(page.getByTestId('deactivation-blocked')).toContainText('رمزًا من تطبيق المصادقة');
  });

  test('Line Manager: no deactivation, no reactivation', async ({ page }) => {
    test.skip(phase !== 'deactivate', 'phase');
    test.skip(!manager.email || !manager.password, 'SIGNED_IN_E2E_MANAGER_* not set');
    await signIn(page, manager);
    // Yasser now reports to Mona (moved above): his profile is in her scope, without account actions.
    await page.goto('/en/suite/admin/users/5eed1000-0000-4000-8000-0000000000d3');
    await expect(page.getByTestId('user-profile')).toBeVisible();
    await expect(page.getByTestId('deactivate-user-link')).toHaveCount(0);
    await page.goto(`/en/suite/admin/users/5eed1000-0000-4000-8000-0000000000d3/deactivate`);
    await expect(page.getByText("You don't have permission to do this.")).toBeVisible();
    await expect(page.getByTestId('deactivate')).toHaveCount(0);
    // Deactivated members are out of her scope; the tab offers her nothing.
    await page.goto('/en/suite/admin/users?tab=deactivated');
    await expect(page.getByTestId('reactivate-member')).toHaveCount(0);
  });

  test('Arabic: reactivate from the deactivated tab', async ({ page }) => {
    test.skip(phase !== 'reactivate', 'phase');
    await signIn(page, admin);
    await page.goto('/ar/suite/admin/users?tab=deactivated');
    const table = page.getByTestId('users-table');
    const row = table.getByRole('row').filter({ hasText: 'ريم ناصر العتيبي' });
    await row.getByRole('button', { name: /^إعادة التفعيل/ }).click();
    await expect(row).toContainText(
      'إعادة تفعيل حساب ريم ناصر العتيبي؟ يعود الدخول إلى المنشأة بالأدوار نفسها.',
    );
    await expect(row.getByTestId('reactivate-confirm')).toBeFocused();
    await expectNoSeriousA11yViolations(page);
    await row.getByTestId('reactivate-confirm').click();
    await expect(page).toHaveURL(/\/ar\/suite\/admin\/users\?tab=deactivated&reactivated=1$/);
    await expect(page.getByTestId('member-reactivated')).toContainText('أُعيد تفعيل الحساب');
    await expect(page.getByTestId('users-table')).not.toContainText('ريم ناصر العتيبي');
    await expectNoSeriousA11yViolations(page);
  });

  test('English: reactivate from the profile; the roles are the same', async ({ page }) => {
    test.skip(phase !== 'reactivate', 'phase');
    await signIn(page, admin);
    await page.goto(`/en/suite/admin/users/${HUDA}`);
    await page.getByTestId('reactivate-button').click();
    await expect(page.getByTestId('reactivate-member')).toContainText(
      "Reactivate Huda Ali Alqarni's account?",
    );
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('reactivate-button')).toBeFocused();
    await page.getByTestId('reactivate-button').click();
    await page.getByTestId('reactivate-confirm').click();
    await expect(page).toHaveURL(new RegExp(`/en/suite/admin/users/${HUDA}\\?reactivated=1$`));
    await expect(page.getByTestId('reactivated')).toContainText('The account was reactivated');
    await expect(page.getByTestId('user-profile')).toContainText('Active');
    await expect(page.getByTestId('user-roles')).toContainText('Learner');
    await expect(page.getByTestId('deactivate-user-link')).toBeVisible();
    await expect(page.getByTestId('user-activity')).toContainText('Account reactivated');
    await expectNoSeriousA11yViolations(page);
  });

  test('the reactivated member signs in to the organization again', async ({ page }) => {
    test.skip(phase !== 'returns', 'phase');
    test.skip(!member.email || !member.password, 'DEACTIVATE_E2E_MEMBER_* not set');
    await signIn(page, member);
    await expect(page.getByText('Sovereign Smoke').first()).toBeVisible();
  });
});
