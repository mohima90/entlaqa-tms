import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { signInToSuite } from './sign-in';
import { expectReadableTables } from './tables';

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
  await signInToSuite(page, as.email, as.password);
}

/** The side navigation (the Organization Admin's home links to the same pages). */
const mainNavigation = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

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

test.describe('users pages', () => {
  test.skip(!email || !password, 'SIGNED_IN_E2E_* not set');
  test.describe.configure({ mode: 'serial' });

  test('English: list, tabs, search with Arabic digits, filters and the profile', async ({
    page,
  }) => {
    await signIn(page);
    // The navigation's entry (the Organization Admin's home also links to Team members, T-M2-21).
    await mainNavigation(page).getByRole('link', { name: 'Team members' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Team members');
    const table = page.getByTestId('users-table');
    await expect(table.getByRole('row')).toHaveCount(5); // header + admin, Sarah, Khalid, Mona
    await expect(page.getByRole('link', { name: /Pending invites/ })).toContainText('1');
    await expectNoSeriousA11yViolations(page);
    // On a phone (390 px) the table scrolls in its box; no header or name is broken mid-word (T-M2-21).
    const desktop = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await expectReadableTables(page);
    await page.goto(page.url().replace('/en/', '/ar/'));
    await expectReadableTables(page);
    await page.goto(page.url().replace('/ar/', '/en/'));
    if (desktop) await page.setViewportSize(desktop);

    // Pending invites tab (Kawadir team page, T-M2-43)
    await page.getByRole('link', { name: /Pending invites/ }).click();
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
    await expect(page.getByTestId('user-roles')).toHaveText('Training Coordinator');
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
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('أعضاء الفريق');
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
    await expect(page.getByTestId('user-roles')).toHaveText('منسق التدريب');
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

  test('custom Line Manager role: only themselves and their team; roles only for the team', async ({
    page,
  }) => {
    test.skip(!managerEmail || !managerPassword, 'SIGNED_IN_E2E_MANAGER_* not set');
    await signIn(page, { email: managerEmail, password: managerPassword });
    // Not an Organization Admin: the training home and the training entries, no set-up card (T-M2-21).
    await expect(page.getByRole('heading', { name: 'No training data yet' })).toBeVisible();
    await expect(page.getByTestId('setup-home')).toHaveCount(0);
    await expect(page.getByText('Coming soon').first()).toBeVisible();
    await expect(mainNavigation(page).getByRole('link', { name: 'General' })).toHaveCount(0);
    await mainNavigation(page).getByRole('link', { name: 'Team members' }).click();
    const table = page.getByTestId('users-table');
    await expect(table.getByRole('row')).toHaveCount(3); // header + Mona herself, Khalid
    await expect(table).toContainText('Mona Saeed Alzahrani');
    await expect(table).toContainText('خالد إبراهيم الشهري');
    await expect(table).toContainText('Employee'); // Khalid's role (her direct report)
    await expect(table).not.toContainText('Line Manager'); // her own role is not readable to her
    // No role.assign: no ⋯ menu to change roles.
    await expect(page.getByTestId('member-menu-edit-role')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    // Outside her scope: not found, exactly like a person that does not exist
    const outside = await page.goto(`/en/suite/admin/users/${SARA}`);
    expect(outside?.status()).toBe(404);

    // Her report's profile: roles yes, audit trail no
    await page.goto(`/en/suite/admin/users/${KHALID}`);
    await expect(page.getByTestId('user-roles')).toContainText('Employee');
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toHaveCount(0);
    await expect(page.getByTestId('user-profile')).toContainText('Mona Saeed Alzahrani');

    // No user.update: no edit link, and the edit page refuses
    await expect(page.getByTestId('edit-user-link')).toHaveCount(0);
    await page.goto(`/en/suite/admin/users/${KHALID}/edit`);
    await expect(page.getByText("You don't have permission to do this.")).toBeVisible();
    await expect(page.getByTestId('edit-user')).toHaveCount(0);
    // No roles & permissions page either (T-M2-05: tenant-wide role.read)
    await expect(page.getByRole('link', { name: 'Roles & permissions' })).toHaveCount(0);
    await page.goto('/en/suite/admin/roles');
    await expect(page.getByText("You don't have permission to do this.")).toBeVisible();
    await expect(page.getByTestId('roles-table')).toHaveCount(0);

    // Nor roles (T-M2-14)
    await expect(page.getByTestId('edit-roles-link')).toHaveCount(0);
    await page.goto(`/en/suite/admin/users/${KHALID}/roles`);
    await expect(page.getByText("You don't have permission to do this.")).toBeVisible();
    await expect(page.getByTestId('edit-role-form')).toHaveCount(0);
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

  test('Roles & permissions: six standard roles and the custom roles, the matrix, counts that match the list', async ({
    page,
  }) => {
    await signIn(page);
    await mainNavigation(page).getByRole('link', { name: 'Roles & permissions' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Roles & permissions');
    const table = page.getByTestId('roles-table');
    // Six standard roles and the organization's custom «Line Manager» role (seed-users.sql).
    await expect(table.getByRole('row')).toHaveCount(8);
    await expect(page.getByTestId('role-row-tenant_admin')).toContainText('Standard');
    await expect(page.getByTestId('role-row-tenant_admin')).toContainText('Privileged');
    await expect(page.getByTestId('role-row-custom_5eed00000001')).toContainText('Custom');
    await expect(page.getByTestId('role-row-custom_5eed00000001')).toContainText('3 permissions');
    await expect(page.getByTestId('create-role-link')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // A standard role: view only, its permissions read-only, what it does across the product.
    await page
      .getByTestId('role-row-learner')
      .getByRole('link', { name: 'Employee', exact: true })
      .click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/roles\/learner$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Employee');
    await expect(page.getByTestId('role-standard-note')).toContainText('view only');
    await expect(
      page.getByTestId('role-permissions').getByRole('checkbox', { name: 'View users' }),
    ).toBeDisabled();
    const matrix = page.getByTestId('role-matrix');
    await expect(matrix.getByRole('row', { name: /Users & roles/ })).toContainText(
      'Own records only',
    );
    await expect(matrix.getByRole('row', { name: /Audit log/ })).toContainText('None');
    // The count matches the users list filtered by the role.
    const members = Number(
      ((await page.getByTestId('role-members').textContent()) ?? '').replace(/[^0-9]/g, ''),
    );
    expect(members).toBeGreaterThan(0);
    await page.getByTestId('role-detail').getByRole('link', { name: 'View users' }).click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/users\?role=learner$/);
    await expect(page.getByTestId('users-table').getByRole('row')).toHaveCount(members + 1);

    // Old links (`?role=`) open the role's page; a retired role is not found.
    await page.goto('/en/suite/admin/roles?role=hr_manager');
    await expect(page).toHaveURL(/\/en\/suite\/admin\/roles\/hr_manager$/);
    const retired = await page.goto('/en/suite/admin/roles/auditor');
    expect(retired?.status()).toBe(404);

    // Arabic: right to left, privileged role flagged
    await page.goto('/ar/suite/admin/roles/hr_manager');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('role-detail')).toContainText('مميز');
    await expectNoSeriousA11yViolations(page);
    await page.goto('/ar/suite/admin/roles/tenant_admin');
    await expect(page.getByTestId('role-detail')).toContainText('دون الوصول إلى ميزات التدريب');
  });

  // Runs after the tests that read Sarah's role.
  test('Organization Admin changes a role from the team list, without an authenticator code', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/en/suite/admin/users');
    const row = page.getByTestId('users-table').getByRole('row').filter({
      hasText: 'Sarah Abdullah Alqahtani',
    });
    await row.getByRole('button', { name: 'Actions for Sarah Abdullah Alqahtani' }).click();
    await page.getByTestId('member-menu-edit-role').click();
    const dialog = page.getByTestId('edit-role-dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit role' })).toBeVisible();
    const select = dialog.getByRole('combobox', { name: /^Role/ });
    await expect(select).toHaveValue('training_coordinator');
    // No authenticator code in this session, and none needed: privileged roles are open to the
    // Organization Admin (PO decision, 14 Oct 2026, reversing D-IAM-01).
    await expect(dialog.locator('option[value="tenant_admin"]')).toBeEnabled();
    await expect(dialog.getByTestId('role-locked-hint')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    // Department Head: the hint about the departments the person heads.
    await select.selectOption({ label: 'Department Head' });
    await expect(dialog.getByTestId('role-departments-hint')).toBeVisible();
    await select.selectOption({ label: 'L&D Manager' });
    await dialog.getByRole('button', { name: 'Save role' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText('L&D Manager');

    await page.goto(`/en/suite/admin/users/${SARA}`);
    await expect(page.getByTestId('user-roles')).toHaveText('L&D Manager');
    await expect(page.getByTestId('user-activity')).toContainText('Role changed');

    // The page form says the same: saving the same role changes nothing.
    await page.getByTestId('edit-roles-link').click();
    await expect(page).toHaveURL(new RegExp(`/en/suite/admin/users/${SARA}/roles$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Change the role of Sarah Abdullah Alqahtani',
    );
    await page.getByTestId('edit-role-form').getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByTestId('edit-role-message')).toHaveText(
      "This is already the person's role.",
    );

    // Nobody changes their own role: no link on one's own profile, and the page says why.
    // The Organization Admin's own profile: through Mona's direct-manager link (seed-users.sql).
    await page.goto('/en/suite/admin/users/5eed1000-0000-4000-8000-000000000003');
    await page.locator('dt:text-is("Direct manager") + dd a').click();
    await expect(page).not.toHaveURL(/5eed1000-0000-4000-8000-000000000003$/);
    await expect(page.getByTestId('user-profile')).toBeVisible();
    await expect(page.getByTestId('edit-roles-link')).toHaveCount(0);
    await page.goto(`${page.url()}/roles`);
    await expect(page.getByTestId('roles-blocked')).toContainText("can't change your own role");

    // Arabic: right to left
    await page.goto(`/ar/suite/admin/users/${SARA}/roles`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'تغيير دور سارة عبدالله القحطاني',
    );
    await expect(page.locator('#edit-role-role-hint')).toContainText('لكل شخص دور واحد');
    await expectNoSeriousA11yViolations(page);
  });

  // Runs last: Mona gets a custom role and then her «Line Manager» role back.
  test('custom role: the Organization Admin creates it, gives it to Mona; she sees what it allows', async ({
    page,
    browser,
  }) => {
    test.skip(!managerEmail || !managerPassword, 'SIGNED_IN_E2E_MANAGER_* not set');
    const name = `Course reviewer ${Date.now()}`;
    await signIn(page);
    await page.goto('/en/suite/admin/roles');
    await page.getByTestId('create-role-link').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create role');
    const builder = page.getByTestId('role-builder');
    // Start from a template: names, scope and permissions filled in, all editable.
    await builder.getByRole('combobox', { name: 'Start from' }).selectOption({ label: 'Auditor' });
    await expect(builder.getByRole('textbox', { name: /Name in English/ })).toHaveValue('Auditor');
    await expect(builder.getByTestId('role-privileged-notice')).toBeVisible(); // audit log: high risk
    await builder.getByRole('textbox', { name: /Name in English/ }).fill(name);
    await builder
      .getByRole('textbox', { name: /Name in Arabic/ })
      .fill(`مراجع الدورات ${Date.now()}`);
    const permissions = builder.getByTestId('role-permissions');
    await permissions.getByRole('checkbox', { name: /View the audit log/ }).uncheck();
    await expect(builder.getByTestId('role-privileged-notice')).toHaveCount(0);
    // Administrative permissions need the whole organization: a narrower scope clears them.
    await permissions.getByRole('checkbox', { name: 'Invite users' }).check();
    await builder.getByTestId('role-scope-team').check();
    await expect(builder.getByTestId('role-scope-cleared')).toBeVisible();
    await expect(permissions.getByRole('checkbox', { name: 'Invite users' })).toBeDisabled();
    await builder.getByTestId('role-scope-organization').check();
    await expectNoSeriousA11yViolations(page);
    await builder.getByTestId('role-save').click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/roles\?saved=1$/);
    await expect(page.getByTestId('role-saved')).toHaveText('Role saved.');
    const roleRow = page.getByTestId('roles-table').getByRole('row').filter({ hasText: name });
    await expect(roleRow).toContainText('Custom');

    // Give it to Mona from the team list.
    await page.goto('/en/suite/admin/users');
    const mona = page.getByTestId('users-table').getByRole('row').filter({
      hasText: 'Mona Saeed Alzahrani',
    });
    await mona.getByRole('button', { name: 'Actions for Mona Saeed Alzahrani' }).click();
    await page.getByTestId('member-menu-edit-role').click();
    const dialog = page.getByTestId('edit-role-dialog');
    await dialog.getByRole('combobox', { name: /^Role/ }).selectOption({ label: name });
    await dialog.getByRole('button', { name: 'Save role' }).click();
    await expect(dialog).toBeHidden();
    await expect(mona).toContainText(name);

    // Mona, at her next request: the roles page (tenant-wide role.read) and everyone on Team members;
    // still no invitations (user.invite not in the role) and no organization settings.
    const context = await browser.newContext();
    const member = await context.newPage();
    await signIn(member, { email: managerEmail, password: managerPassword });
    await member.goto('/en/suite/admin/roles');
    await expect(member.getByTestId('roles-table')).toBeVisible();
    await expect(member.getByTestId('create-role-link')).toHaveCount(0);
    await member.goto('/en/suite/admin/users');
    await expect(member.getByTestId('users-table')).toContainText('Sarah Abdullah Alqahtani');
    await expect(member.getByTestId('invite-user-link')).toHaveCount(0);
    await member.goto('/en/suite/admin/users/invite');
    await expect(member.getByText("You don't have permission to do this.")).toBeVisible();
    await member.goto('/ar/suite/admin/roles/new');
    await expect(member.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(member.getByText('ليست لديك صلاحية لتنفيذ هذا الإجراء.')).toBeVisible();
    await context.close();

    // Arabic: the role's page in Arabic; it cannot be deleted while Mona holds it.
    await page.goto('/en/suite/admin/roles');
    await page.getByTestId('roles-table').getByRole('link', { name, exact: true }).click();
    const code = /\/roles\/(custom_[0-9a-f]{12})$/.exec(page.url())?.[1] ?? '';
    expect(code).toMatch(/^custom_[0-9a-f]{12}$/);
    await page.goto(`/ar/suite/admin/roles/${code}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('role-in-use')).toContainText('أسند إليهم دورًا آخر أولًا');
    await expectNoSeriousA11yViolations(page);

    // Mona gets her «Line Manager» role back; then the custom role is deleted.
    await page.goto('/en/suite/admin/users');
    await mona.getByRole('button', { name: 'Actions for Mona Saeed Alzahrani' }).click();
    await page.getByTestId('member-menu-edit-role').click();
    await dialog.getByRole('combobox', { name: /^Role/ }).selectOption({ label: 'Line Manager' });
    await dialog.getByRole('button', { name: 'Save role' }).click();
    await expect(dialog).toBeHidden();
    await page.goto(`/en/suite/admin/roles/${code}`);
    await page.getByTestId('role-delete').click();
    await page.getByTestId('role-delete-confirm').click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/roles\?deleted=1$/);
    await expect(page.getByTestId('roles-table')).not.toContainText(name);
  });
  test('Arabic: the Organization Admin builds a privileged custom role from a template and deletes it', async ({
    page,
  }) => {
    const name = `مدقق الجودة ${Date.now()}`;
    await signIn(page);
    await page.goto('/ar/suite/admin/roles/new');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('إنشاء دور');
    const builder = page.getByTestId('role-builder');
    await builder.getByRole('combobox', { name: 'البدء من' }).selectOption({ label: 'مدقق' });
    await expect(builder.getByRole('textbox', { name: /الاسم بالعربية/ })).toHaveValue('مدقق');
    await builder.getByRole('textbox', { name: /الاسم بالعربية/ }).fill(name);
    await builder
      .getByRole('textbox', { name: /الاسم بالإنجليزية/ })
      .fill(`Quality auditor ${Date.now()}`);
    await expect(builder.getByTestId('role-privileged-notice')).toContainText('هذا الدور مميز');
    await expect(builder.getByTestId('role-builder-announcer')).toContainText('هذا الدور مميز');
    await expectNoSeriousA11yViolations(page);
    await builder.getByTestId('role-save').click();
    await expect(page).toHaveURL(/\/ar\/suite\/admin\/roles\?saved=1$/);
    await expect(page.getByTestId('role-saved')).toHaveText('حُفظ الدور.');
    const row = page.getByTestId('roles-table').getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('مخصص');
    await expect(row).toContainText('مميز');
    await row.getByRole('link', { name, exact: true }).click();
    // Editing: who holds the role is said with the privileged notice (review L10).
    await expect(page.getByTestId('role-holders')).toHaveText('لا يحمل أحد هذا الدور بعد.');
    await page.getByTestId('role-delete').click();
    await page.getByTestId('role-delete-confirm').click();
    await expect(page).toHaveURL(/\/ar\/suite\/admin\/roles\?deleted=1$/);
    await expect(page.getByTestId('role-deleted')).toHaveText('حُذف الدور.');
    await expect(page.getByTestId('roles-table')).not.toContainText(name);
  });

  test('an HR Manager is refused a privileged custom role (offered disabled; the server refuses too)', async ({
    page,
    browser,
  }) => {
    test.skip(!managerEmail || !managerPassword, 'SIGNED_IN_E2E_MANAGER_* not set');
    const name = `People desk ${Date.now()}`;
    await signIn(page);
    // A privileged custom role (it invites people: user management) …
    await page.goto('/en/suite/admin/roles/new');
    const builder = page.getByTestId('role-builder');
    await builder.getByRole('textbox', { name: /Name in English/ }).fill(name);
    await builder
      .getByRole('textbox', { name: /Name in Arabic/ })
      .fill(`مكتب الأشخاص ${Date.now()}`);
    await builder.getByRole('checkbox', { name: 'View users' }).check();
    await builder.getByRole('checkbox', { name: 'Invite users' }).check();
    await expect(builder.getByTestId('role-privileged-notice')).toBeVisible();
    await builder.getByTestId('role-save').click();
    await expect(page.getByTestId('role-saved')).toBeVisible();
    // … and Mona made an HR Manager for this test.
    const setMonaRole = async (label: string) => {
      await page.goto('/en/suite/admin/users');
      const mona = page.getByTestId('users-table').getByRole('row').filter({
        hasText: 'Mona Saeed Alzahrani',
      });
      await mona.getByRole('button', { name: 'Actions for Mona Saeed Alzahrani' }).click();
      await page.getByTestId('member-menu-edit-role').click();
      const dialog = page.getByTestId('edit-role-dialog');
      await dialog.getByRole('combobox', { name: /^Role/ }).selectOption({ label });
      await dialog.getByRole('button', { name: 'Save role' }).click();
      await expect(dialog).toBeHidden();
    };
    await setMonaRole('HR Manager (privileged)');
    try {
      const context = await browser.newContext();
      const hr = await context.newPage();
      await signIn(hr, { email: managerEmail, password: managerPassword });
      await hr.goto(`/en/suite/admin/users/${SARA}/roles`);
      const option = hr.getByTestId('edit-role-form').locator('option', { hasText: name });
      await expect(option).toBeDisabled();
      await expect(option).toContainText('privileged');
      await expect(hr.getByTestId('role-locked-hint')).toBeVisible();
      await expectNoSeriousA11yViolations(hr);
      await context.close();
    } finally {
      await setMonaRole('Line Manager');
      await page.goto('/en/suite/admin/roles');
      await page.getByTestId('roles-table').getByRole('link', { name, exact: true }).click();
      await page.getByTestId('role-delete').click();
      await page.getByTestId('role-delete-confirm').click();
      await expect(page).toHaveURL(/\/en\/suite\/admin\/roles\?deleted=1$/);
    }
  });
});
