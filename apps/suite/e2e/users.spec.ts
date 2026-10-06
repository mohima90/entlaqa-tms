import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Users pages with real data (T-M2-04, screens 1 and 3; editing details T-M2-13) against a configured
 * deployment: runs in the
 * self-hosted smoke (infra/docker/smoke.sh) after infra/docker/seed-users.sql, signed in as the
 * provisioned Organization Admin. Skipped in the default CI run (no Auth server, no data).
 */
const email = process.env.SIGNED_IN_E2E_EMAIL;
const password = process.env.SIGNED_IN_E2E_PASSWORD;
const managerEmail = process.env.SIGNED_IN_E2E_MANAGER_EMAIL;
const managerPassword = process.env.SIGNED_IN_E2E_MANAGER_PASSWORD;
const SARA = '5eed1000-0000-4000-8000-000000000001';
const KHALID = '5eed1000-0000-4000-8000-000000000002';

async function signIn(
  page: Page,
  as: { email: string | undefined; password: string | undefined } = { email, password },
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

test.describe('users pages', () => {
  test.skip(!email || !password, 'SIGNED_IN_E2E_* not set');
  test.describe.configure({ mode: 'serial' });

  test('English: list, tabs, search with Arabic digits, filters and the profile', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Users' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Users');
    const table = page.getByTestId('users-table');
    await expect(table.getByRole('row')).toHaveCount(5); // header + admin, Sarah, Khalid, Mona
    await expect(page.getByRole('link', { name: /Invited/ })).toContainText('1');
    await expectNoSeriousA11yViolations(page);

    // Invited tab
    await page.getByRole('link', { name: /Invited/ }).click();
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('خالد إبراهيم الشهري');
    await expect(table).toContainText('Invited');

    // Search with Eastern Arabic digits on the All tab
    await page.getByRole('link', { name: /^All/ }).click();
    await page.getByRole('searchbox', { name: 'Search' }).fill('EMP-١١٨٧');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('Sarah Abdullah Alqahtani');
    await expect(table).toContainText('Training Coordinator');
    await expect(table).toContainText('and 1 additional role');

    // Department filter includes no one else; clearing brings everyone back
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await page.getByRole('combobox', { name: 'Department' }).selectOption({ label: 'Academy' });
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(table.getByRole('row')).toHaveCount(2);
    await page.getByRole('searchbox', { name: 'Search' }).fill('nobody-matches-this');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('users-empty')).toContainText('No results match the filters');

    // Profile
    await page.goto(`/en/suite/admin/users/${SARA}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sarah Abdullah Alqahtani');
    const profile = page.getByTestId('user-profile');
    await expect(profile).toContainText('Training specialist · Academy · Riyadh branch');
    await expect(profile).toContainText('EMP-1187');
    await expect(profile).toContainText('March 3, 2024');
    await expect(profile).toContainText('1445 AH');
    await expect(page.getByTestId('user-roles')).toContainText('Training CoordinatorPrimary role');
    await expect(profile).toContainText('Never signed in');
    // The Organization Admin reads the audit log: the activity section is shown.
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // An unknown person or a malformed id: not found (no existence leak)
    const missing = await page.goto('/en/suite/admin/users/5eed1000-0000-4000-8000-0000000000ff');
    expect(missing?.status()).toBe(404);
    const malformed = await page.goto('/en/suite/admin/users/not-a-uuid');
    expect(malformed?.status()).toBe(404);
  });

  test('Arabic: right-to-left list and profile, search ignores hamza and teh marbuta', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/ar/suite/admin/users?q=' + encodeURIComponent('ساره عبدالله'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('المستخدمون');
    const table = page.getByTestId('users-table');
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('سارة عبدالله القحطاني');
    await expect(table).toContainText('منسق التدريب');
    await expectNoSeriousA11yViolations(page);

    await table.getByRole('link', { name: 'سارة عبدالله القحطاني' }).click();
    await expect(page).toHaveURL(new RegExp(`/ar/suite/admin/users/${SARA}$`));
    const profile = page.getByTestId('user-profile');
    await expect(profile).toContainText('22 شعبان 1445 هـ');
    await expect(profile).toContainText('أخصائية تدريب · الأكاديمية · فرع الرياض');
    await expect(page.getByTestId('user-roles')).toContainText('دور إضافي');
    await expectNoSeriousA11yViolations(page);

    // A malformed filter is reported and ignored, not an error page
    await page.goto('/ar/suite/admin/users?department=not-a-uuid');
    await expect(page.getByText('تعذّر فهم عوامل التصفية')).toBeVisible();
    await expect(page.getByTestId('users-table').getByRole('row')).toHaveCount(5);

    // A page past the end goes to the last page
    await page.goto('/ar/suite/admin/users?page=9');
    await expect(page).toHaveURL(/\/ar\/suite\/admin\/users$/);
    await expect(page.getByTestId('users-table').getByRole('row')).toHaveCount(5);
  });

  test('Line Manager + Learner: only themselves and their team; roles only for the team', async ({
    page,
  }) => {
    test.skip(!managerEmail || !managerPassword, 'SIGNED_IN_E2E_MANAGER_* not set');
    await signIn(page, { email: managerEmail, password: managerPassword });
    await page.getByRole('link', { name: 'Users' }).click();
    const table = page.getByTestId('users-table');
    await expect(table.getByRole('row')).toHaveCount(3); // header + Mona herself, Khalid
    await expect(table).toContainText('Mona Saeed Alzahrani');
    await expect(table).toContainText('خالد إبراهيم الشهري');
    await expect(table).toContainText('Learner'); // Khalid's role (her direct report)
    await expect(table).not.toContainText('Line Manager'); // her own roles are not readable to her
    await expectNoSeriousA11yViolations(page);

    // Outside her scope: not found, exactly like a person that does not exist
    const outside = await page.goto(`/en/suite/admin/users/${SARA}`);
    expect(outside?.status()).toBe(404);

    // Her report's profile: roles yes, audit trail no
    await page.goto(`/en/suite/admin/users/${KHALID}`);
    await expect(page.getByTestId('user-roles')).toContainText('Learner');
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toHaveCount(0);
    await expect(page.getByTestId('user-profile')).toContainText('Mona Saeed Alzahrani');

    // No user.update: no edit link, and the edit page refuses
    await expect(page.getByTestId('edit-user-link')).toHaveCount(0);
    await page.goto(`/en/suite/admin/users/${KHALID}/edit`);
    await expect(page.getByText("You don't have permission to do this.")).toBeVisible();
    await expect(page.getByTestId('edit-user')).toHaveCount(0);
    // Nor roles (T-M2-14)
    await expect(page.getByTestId('edit-roles-link')).toHaveCount(0);
    await page.goto(`/en/suite/admin/users/${KHALID}/roles`);
    await expect(page.getByText("You don't have permission to do this.")).toBeVisible();
    await expect(page.getByTestId('edit-roles')).toHaveCount(0);
  });

  // Runs last: it changes Khalid's English name, which the tests above read in Arabic.
  test('Organization Admin edits details: unique employee number, manager picker, audit', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/en/suite/admin/users/${KHALID}`);
    await page.getByTestId('edit-user-link').click();
    await expect(page).toHaveURL(new RegExp(`/en/suite/admin/users/${KHALID}/edit$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Edit details of خالد إبراهيم الشهري',
    );
    const form = page.getByTestId('edit-user');
    // The login e-mail is shown, not editable
    await expect(form.getByLabel('Work email')).toHaveValue('sample.khalid@sovereign.example');
    await expect(form.getByLabel('Work email')).toHaveAttribute('readonly', '');
    // The Arabic name had no parts: it was placed in "First name" to be split
    await expect(form.getByText('The full name was placed in "First name"')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // Manager picker: the department's managers; another department keeps the current manager;
    // "all departments" shows everyone with a managing role.
    const manager = form.getByRole('combobox', { name: /Direct manager/ });
    await expect(manager).toHaveValue('5eed1000-0000-4000-8000-000000000003'); // Mona
    await form.getByRole('combobox', { name: /Department/ }).selectOption({ label: 'Academy' });
    await expect(manager.getByRole('option')).toHaveText([
      'No direct manager',
      'Mona Saeed Alzahrani',
    ]);
    await form.getByRole('button', { name: /Show managers of all departments/ }).click();
    await expect(manager.getByRole('option')).toHaveCount(3); // + the Organization Admin (heads TRN)
    await form.getByRole('button', { name: /department's managers only/ }).click();
    await form.getByRole('combobox', { name: /Department/ }).selectOption({
      label: 'Training and development',
    });

    // Sarah's employee number is taken: the field says so and nothing is saved
    await form.getByRole('textbox', { name: /Employee number/ }).fill('EMP-1187');
    await form
      .getByRole('textbox', { name: /First name/ })
      .nth(1)
      .fill('Khalid');
    await form
      .getByRole('textbox', { name: /Family name/ })
      .nth(1)
      .fill('Alshehri');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(form.getByText('This employee number belongs to someone else')).toBeVisible();

    // Eastern Arabic digits are stored as Western digits
    await form.getByRole('textbox', { name: /Employee number/ }).fill('EMP-٢٠٤١');
    await form.getByRole('textbox', { name: /Job title in Arabic/ }).fill('محاسب');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('edit-user-message')).toHaveText('Changes saved.');
    // Saving again with the refreshed version: nothing changed
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('edit-user-message')).toHaveText('There are no changes to save.');

    await page.goto(`/en/suite/admin/users/${KHALID}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Khalid Alshehri');
    const profile = page.getByTestId('user-profile');
    await expect(profile).toContainText('EMP-2041');
    await expect(profile).toContainText('Mona Saeed Alzahrani');
    await expect(page.getByTestId('user-activity')).toContainText('Details updated');

    // Arabic edit page: right to left
    await page.goto(`/ar/suite/admin/users/${SARA}/edit`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'تعديل بيانات سارة عبدالله القحطاني',
    );
    await expect(page.getByRole('combobox', { name: /القسم/ })).toHaveValue(/.+/);
    // Hire date: Gregorian field, Hijri equivalent shown under it
    await expect(page.getByText('يوافق 22 شعبان 1445 هـ')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  // Runs last: it changes Sarah's roles, which the tests above read.
  test('Organization Admin changes roles: ordinary roles now, privileged ones need a code', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/en/suite/admin/users/${SARA}`);
    await page.getByTestId('edit-roles-link').click();
    await expect(page).toHaveURL(new RegExp(`/en/suite/admin/users/${SARA}/roles$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Edit roles of Sarah Abdullah Alqahtani',
    );
    const form = page.getByTestId('edit-roles');
    // No authenticator code in this session: privileged roles are locked (PO decision D-IAM-01).
    await expect(page.getByTestId('privileged-locked')).toContainText('authenticator app');
    await expect(form.getByRole('radio', { name: /^Organization Admin/ })).toBeDisabled();
    await expect(form.getByRole('checkbox', { name: /^Auditor/ })).toBeDisabled();
    await expect(form.getByRole('radio', { name: /^Training Coordinator/ })).toBeChecked();
    await expect(form.getByRole('checkbox', { name: /^Learner/ })).toBeChecked();
    await expectNoSeriousA11yViolations(page);

    await form.getByRole('radio', { name: /^Training Manager/ }).check();
    await form.locator('#role-learner-validUntil').fill('2030-12-31');
    await form.getByRole('checkbox', { name: /^Mentor/ }).check();
    await form.locator('#role-mentor-validFrom').fill('2026-01-01');
    await form.getByRole('button', { name: 'Save roles' }).click();
    await expect(page.getByTestId('edit-roles-message')).toHaveText('Roles saved.');
    await form.getByRole('button', { name: 'Save roles' }).click();
    await expect(page.getByTestId('edit-roles-message')).toHaveText(
      'There are no changes to save.',
    );

    await page.goto(`/en/suite/admin/users/${SARA}`);
    const roles = page.getByTestId('user-roles');
    await expect(roles).toContainText('Training ManagerPrimary role');
    await expect(roles).toContainText('Until Dec 31, 2030');
    await expect(roles).toContainText('Mentor');
    await expect(page.getByTestId('user-activity')).toContainText('Roles changed');

    // Nobody changes their own roles: no link on one's own profile, and the page says why.
    // The Organization Admin's own profile: through Mona's direct-manager link (seed-users.sql).
    await page.goto('/en/suite/admin/users/5eed1000-0000-4000-8000-000000000003');
    await page.locator('dt:text-is("Direct manager") + dd a').click();
    await expect(page).not.toHaveURL(/5eed1000-0000-4000-8000-000000000003$/);
    await expect(page.getByTestId('user-profile')).toBeVisible();
    await expect(page.getByTestId('edit-roles-link')).toHaveCount(0);
    await page.goto(`${page.url()}/roles`);
    await expect(page.getByTestId('roles-blocked')).toContainText("can't change your own roles");

    // Arabic: right to left
    await page.goto(`/ar/suite/admin/users/${SARA}/roles`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'تعديل أدوار سارة عبدالله القحطاني',
    );
    await expectNoSeriousA11yViolations(page);
  });
});
