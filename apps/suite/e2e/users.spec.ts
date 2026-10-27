import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { signInToSuite } from './sign-in';
import { expectReadableTables } from './tables';

/**
 * Users pages with real data (T-M2-04, screens 1 and 3; editing details T-M2-13; redesign package 3:
 * instant filters, quick look, row menu, side panels) against a configured deployment: runs in the
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

/** The people shown: table rows on wider screens, one card each on phones (redesign package 3). */
const members = (page: Page) =>
  page
    .locator('[data-testid="users-table"] tbody tr, [data-testid="users-cards"] > li')
    .filter({ visible: true });
const member = (page: Page, name: string) => members(page).filter({ hasText: name });

/** The toasts of the page (a polite live region). */
const toasts = (page: Page) => page.getByRole('region', { name: 'Status messages' });

/** Opens a person's ⋯ menu on Team members and picks an entry. */
async function rowAction(page: Page, name: string, testId: string) {
  await member(page, name)
    .getByRole('button', { name: `More actions for ${name}` })
    .click();
  await page.getByTestId(testId).click();
}

/** Team members → ⋯ → Change role → a role (and Save): the panel closes with a toast. */
async function changeRole(page: Page, name: string, role: RegExp) {
  await page.goto('/en/suite/admin/users');
  await rowAction(page, name, 'member-menu-edit-role');
  const panel = page.getByTestId('change-role-panel');
  await panel.getByRole('radio', { name: role }).check();
  await panel.getByRole('button', { name: 'Save role' }).click();
  await expect(panel).toBeHidden();
}

async function expectNoSeriousA11yViolations(page: Page) {
  // After an in-app navigation (router.replace + refresh) the framework swaps the page's <title> while the
  // new tree streams in: check the page once it has its title again (and fail if it never gets one).
  await expect(page).toHaveTitle(/\S/);
  // From the top of the page: sticky bars may overlap content at other scroll positions.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
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

  test('English: list, views, instant search with Arabic digits, filter pills, quick look and the profile', async ({
    page,
  }) => {
    await signIn(page);
    // The navigation's entry (the Organization Admin's home also links to Team members, T-M2-21).
    await mainNavigation(page).getByRole('link', { name: 'Team members' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Team members');
    await expect(members(page)).toHaveCount(4); // admin, Sarah, Khalid, Mona
    await expect(page.getByRole('link', { name: /Pending invites/ })).toContainText('1');
    // Direction C: the status views are cards with big numbers; the current one is marked.
    const views = page.getByRole('navigation', { name: 'Team members views' });
    await expect(views.getByRole('link')).toHaveCount(4);
    await expect(page.getByTestId('users-view-all')).toHaveAttribute('aria-current', 'page');
    // The Employee number column stays (PO).
    await expect(members(page).filter({ hasText: 'Sarah Abdullah Alqahtani' })).toContainText(
      'EMP-1187',
    );
    await expectNoSeriousA11yViolations(page);
    // On a phone (390 px) one card per person: no sideways scrolling, nothing broken mid-word (T-M2-21).
    const desktop = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('users-cards')).toBeVisible();
    await expectReadableTables(page);
    await page.goto(page.url().replace('/en/', '/ar/'));
    await expectReadableTables(page);
    await page.goto(page.url().replace('/ar/', '/en/'));
    if (desktop) await page.setViewportSize(desktop);

    // Pending invites view (Kawadir team page, T-M2-43)
    await page.getByRole('link', { name: /Pending invites/ }).click();
    await expect(page.getByTestId('users-view-invited')).toHaveAttribute('aria-current', 'page');
    await expect(members(page)).toHaveCount(1);
    await expect(member(page, 'خالد إبراهيم الشهري')).toContainText('Invited');

    // Search with Eastern Arabic digits on the All view: it applies once typing pauses (no Apply button)
    // and the address keeps it.
    await page.getByRole('link', { name: /^All/ }).click();
    await page.getByRole('searchbox', { name: 'Search' }).fill('EMP-١١٨٧');
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(members(page)).toHaveCount(1);
    await expect(member(page, 'Sarah Abdullah Alqahtani')).toContainText('Training Coordinator');
    await expect(page.getByTestId('users-range')).toContainText('Showing 1–1 of 1');

    // The unit pill applies at once; the seeded structure mixes two levels (Department, Section): the
    // filter is «Department» and each one shows its level (feedback #3). Its × removes it.
    await page.getByRole('searchbox', { name: 'Search' }).fill('');
    await expect(page).not.toHaveURL(/[?&]q=/);
    await page
      .getByTestId('users-filter-department')
      .getByRole('button', { name: 'Department' })
      .click();
    await page
      .getByRole('group', { name: 'Department' })
      .getByRole('button', { name: 'Academy · Section' })
      .click();
    await expect(page).toHaveURL(/[?&]department=/);
    await expect(members(page)).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search' }).fill('nobody-matches-this');
    await expect(page.getByTestId('users-empty')).toContainText('No results match the filters');
    await page
      .getByRole('button', { name: 'Remove the filter Department: Academy · Section' })
      .click();
    await expect(page).not.toHaveURL(/[?&]department=/);

    // Quick look: the person's facts without leaving the list, then the full profile.
    await page.goto('/en/suite/admin/users');
    await member(page, 'Sarah Abdullah Alqahtani').getByTestId('member-peek').click();
    const peek = page.getByTestId('member-peek-panel');
    await expect(peek).toContainText('EMP-1187');
    await expect(peek.getByRole('button', { name: 'Copy Employee number' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Escape');
    await expect(peek).toBeHidden();
    // Focus returns to the name that opened it (WCAG 2.4.3).
    await expect(member(page, 'Sarah Abdullah Alqahtani').getByTestId('member-peek')).toBeFocused();
    await member(page, 'Sarah Abdullah Alqahtani').getByTestId('member-peek').click();
    await peek.getByTestId('peek-open-profile').click();
    await expect(page).toHaveURL(new RegExp(`/en/suite/admin/users/${SARA}$`));

    // Profile: header, tabs, overview
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sarah Abdullah Alqahtani');
    await expect(page.getByTestId('profile-header')).toContainText(
      'Training specialist · Academy · Riyadh branch',
    );
    const profile = page.getByTestId('user-profile');
    await expect(profile).toContainText('EMP-1187');
    await expect(profile).toContainText('March 3, 2024');
    await expect(profile).toContainText('1445 AH');
    await expect(page.getByTestId('user-roles')).toHaveText('Training Coordinator');
    await expect(profile).toContainText('Never signed in');
    // The Organization Admin reads the audit log: the Recent activity tab is offered.
    const tabs = page.getByRole('navigation', { name: 'Profile sections' });
    await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectNoSeriousA11yViolations(page);
    await tabs.getByRole('link', { name: 'Recent activity' }).click();
    await expect(page).toHaveURL(/\?tab=activity$/);
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();

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
    await expect(members(page)).toHaveCount(1);
    await expect(member(page, 'سارة عبدالله القحطاني')).toContainText('منسق التدريب');
    await expectNoSeriousA11yViolations(page);

    await member(page, 'سارة عبدالله القحطاني')
      .getByRole('button', { name: 'إجراءات أخرى لـسارة عبدالله القحطاني' })
      .click();
    await page.getByTestId('member-menu-profile').click();
    await expect(page).toHaveURL(new RegExp(`/ar/suite/admin/users/${SARA}$`));
    const profile = page.getByTestId('user-profile');
    await expect(profile).toContainText('22 شعبان 1445 هـ');
    await expect(page.getByTestId('profile-header')).toContainText(
      'أخصائية تدريب · الأكاديمية · فرع الرياض',
    );
    await expect(page.getByTestId('user-roles')).toHaveText('منسق التدريب');
    await expectNoSeriousA11yViolations(page);

    // A malformed filter is reported and ignored, not an error page
    await page.goto('/ar/suite/admin/users?department=not-a-uuid');
    await expect(page.getByText('تعذّر فهم عوامل التصفية')).toBeVisible();
    await expect(members(page)).toHaveCount(4);

    // A page past the end goes to the last page
    await page.goto('/ar/suite/admin/users?page=9');
    await expect(page).toHaveURL(/\/ar\/suite\/admin\/users$/);
    await expect(members(page)).toHaveCount(4);
  });

  test('custom Line Manager role: only their team (direct reports), not themselves; roles only for the team', async ({
    page,
  }) => {
    test.skip(!managerEmail || !managerPassword, 'SIGNED_IN_E2E_MANAGER_* not set');
    await signIn(page, { email: managerEmail, password: managerPassword });
    // Not an Organization Admin: the training home and the training entries, no set-up card (T-M2-21).
    await expect(page.getByRole('heading', { name: 'No training data yet' })).toBeVisible();
    await expect(page.getByTestId('setup-home')).toHaveCount(0);
    // Redesign package 6: «Your pages» lists the pages already in their menu.
    await expect(
      page.getByTestId('your-pages').getByRole('link', { name: /^Team members/ }),
    ).toBeVisible();
    await expect(page.getByText('Coming soon').first()).toBeVisible();
    await expect(mainNavigation(page).getByRole('link', { name: 'General' })).toHaveCount(0);
    await mainNavigation(page).getByRole('link', { name: 'Team members' }).click();
    // «Their team» = her direct reports only (BRD FR-IAM-08 R1 note; EP-ROLES, one role per person — PO,
    // 17 Oct 2026): Khalid (invited), not Mona herself, whose own record is My profile (FR-IAM-16). Until
    // EP-ROLES she also held the Employee role (own record) and saw herself here.
    await expect(members(page)).toHaveCount(1);
    await expect(member(page, 'خالد إبراهيم الشهري')).toContainText('Employee'); // her direct report
    await expect(member(page, 'Mona Saeed Alzahrani')).toHaveCount(0);
    // No role.assign, user.update or user.deactivate: no ⋯ menu at all, no invitations.
    await expect(page.getByRole('button', { name: /^More actions for/ })).toHaveCount(0);
    await expect(page.getByTestId('invite-user-link')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    // Outside her scope: not found, exactly like a person that does not exist
    const outside = await page.goto(`/en/suite/admin/users/${SARA}`);
    expect(outside?.status()).toBe(404);

    // Her report's profile: roles yes, audit trail no
    await page.goto(`/en/suite/admin/users/${KHALID}`);
    await expect(page.getByTestId('user-roles')).toContainText('Employee');
    await expect(page.getByRole('link', { name: 'Recent activity' })).toHaveCount(0);
    await expect(page.getByTestId('user-profile')).toContainText('Mona Saeed Alzahrani');

    // No user.update: no edit button, and the edit panel refuses
    await expect(page.getByTestId('edit-user-link')).toHaveCount(0);
    await expect(page.getByTestId('profile-actions')).toHaveCount(0);
    await page.goto(`/en/suite/admin/users/${KHALID}/edit`);
    await expect(
      page.getByTestId('edit-user-panel').getByText("You don't have permission to do this."),
    ).toBeVisible();
    await expect(page.getByTestId('edit-user')).toHaveCount(0);
    // No roles & permissions page either (T-M2-05: tenant-wide role.read)
    await expect(page.getByRole('link', { name: 'Roles & permissions' })).toHaveCount(0);
    await page.goto('/en/suite/admin/roles');
    await expect(page.getByText("You don't have permission to do this.")).toBeVisible();
    await expect(page.getByTestId('roles-table')).toHaveCount(0);

    // Nor roles (T-M2-14)
    await expect(page.getByTestId('edit-roles-link')).toHaveCount(0);
    await page.goto(`/en/suite/admin/users/${KHALID}/roles`);
    await expect(
      page.getByTestId('change-role-panel').getByText("You don't have permission to do this."),
    ).toBeVisible();
    await expect(page.getByTestId('edit-role-form')).toHaveCount(0);
  });

  // Runs last: it changes Khalid's English name, which the tests above read in Arabic.
  test('Organization Admin edits details in the side panel: unique employee number, manager picker, unsaved changes, audit', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/en/suite/admin/users/${KHALID}`);
    await page.getByTestId('edit-user-link').click();
    await expect(page).toHaveURL(new RegExp(`/en/suite/admin/users/${KHALID}/edit$`));
    const panel = page.getByTestId('edit-user-panel');
    await expect(
      panel.getByRole('heading', { name: 'Edit details of خالد إبراهيم الشهري' }),
    ).toBeVisible();
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
    await form
      .getByRole('combobox', { name: /^Department/ })
      .selectOption({ label: 'Academy · Section' });
    await expect(manager.getByRole('option')).toHaveText([
      'No direct manager',
      'Mona Saeed Alzahrani',
    ]);
    await form.getByRole('button', { name: /Show managers of all units/ }).click();
    await expect(manager.getByRole('option')).toHaveCount(3); // + the Organization Admin (heads TRN)
    await form.getByRole('button', { name: /unit's managers only/ }).click();
    await form.getByRole('combobox', { name: /^Department/ }).selectOption({
      label: 'Training and development · Department',
    });

    // Closing with unsaved changes asks first; «Keep editing» keeps them.
    await page.keyboard.press('Escape');
    const discard = page.getByTestId('discard-dialog');
    await expect(discard).toContainText('Discard your changes?');
    await discard.getByRole('button', { name: 'Keep editing' }).click();
    await expect(panel).toBeVisible();

    // Sarah's employee number is taken: the field says so and nothing is saved
    await form.getByRole('textbox', { name: /Employee number/ }).fill('EMP-1187');
    // English is the organization's default language: the English names come first and are required
    // (guided-test feedback #2); Khalid's Arabic name follows.
    await form
      .getByRole('textbox', { name: /First name/ })
      .nth(0)
      .fill('Khalid');
    await form
      .getByRole('textbox', { name: /Family name/ })
      .nth(0)
      .fill('Alshehri');
    await page.getByTestId('edit-user-save').click();
    await expect(form.getByText('This employee number belongs to someone else')).toBeVisible();

    // Eastern Arabic digits are stored as Western digits; saved → the panel closes with a toast.
    await form.getByRole('textbox', { name: /Employee number/ }).fill('EMP-٢٠٤١');
    await form.getByRole('textbox', { name: /Job title in Arabic/ }).fill('محاسب');
    await page.getByTestId('edit-user-save').click();
    await expect(panel).toBeHidden();
    await expect(toasts(page)).toContainText('Changes saved.');
    await expect(page).toHaveURL(new RegExp(`/en/suite/admin/users/${KHALID}$`));
    // Focus is back on «Edit details».
    await expect(page.getByTestId('edit-user-link')).toBeFocused();
    // Saving again with the refreshed version: nothing changed
    await page.getByTestId('edit-user-link').click();
    await page.getByTestId('edit-user-save').click();
    await expect(toasts(page)).toContainText('There are no changes to save.');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Khalid Alshehri');
    const profile = page.getByTestId('user-profile');
    await expect(profile).toContainText('EMP-2041');
    await expect(profile).toContainText('Mona Saeed Alzahrani');
    await page.goto(`/en/suite/admin/users/${KHALID}?tab=activity`);
    await expect(page.getByTestId('user-activity')).toContainText('Details updated');

    // Arabic: the old address opens the panel, right to left
    await page.goto(`/ar/suite/admin/users/${SARA}/edit`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.getByRole('heading', { name: 'تعديل بيانات سارة عبدالله القحطاني' }),
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: /الوحدة/ })).toHaveValue(/.+/);
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
    // Six standard roles and the organization's custom «Line Manager» role (seed-users.sql).
    await expect(page.getByTestId('roles-standard').getByRole('listitem')).toHaveCount(6);
    await expect(page.getByTestId('roles-custom').getByRole('listitem')).toHaveCount(1);
    await expect(page.getByTestId('role-row-tenant_admin')).toContainText('Privileged');
    await expect(page.getByTestId('role-row-custom_5eed00000001')).toContainText('3 permissions');
    await expect(page.getByTestId('create-role-link')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // A standard role: view only, each permission Allowed / Not allowed, what it does across the product.
    await page
      .getByTestId('role-row-learner')
      .getByRole('link', { name: 'Employee', exact: true })
      .click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/roles\/learner$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Employee');
    await expect(page.getByTestId('role-standard-note')).toContainText('view only');
    const permissions = page.getByTestId('role-permissions');
    await expect(permissions.getByRole('checkbox')).toHaveCount(0);
    await expect(permissions).toContainText('Not allowed');
    await permissions.getByRole('searchbox', { name: 'Search permissions' }).fill('audit');
    await expect(permissions.getByText('View the audit log')).toBeVisible();
    await expect(permissions.getByText('Invite users')).toHaveCount(0);
    await page.getByRole('link', { name: /What this role does across the product/ }).click();
    await expect(page).toHaveURL(/\?tab=across$/);
    const matrix = page.getByTestId('role-matrix');
    await expect(matrix.getByRole('row', { name: /Users & roles/ })).toContainText(
      'Own records only',
    );
    await expect(matrix.getByRole('row', { name: /Audit log/ })).toContainText('None');
    // The count matches the users list filtered by the role.
    const members_ = Number(
      ((await page.getByTestId('role-members').textContent()) ?? '').replace(/[^0-9]/g, ''),
    );
    expect(members_).toBeGreaterThan(0);
    await page.getByTestId('role-detail').getByRole('link', { name: 'View users' }).click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/users\?role=learner$/);
    await expect(members(page)).toHaveCount(members_);

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
  test('Organization Admin changes a role from the team list in a side panel, with Undo', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/en/suite/admin/users');
    await rowAction(page, 'Sarah Abdullah Alqahtani', 'member-menu-edit-role');
    const panel = page.getByTestId('change-role-panel');
    await expect(
      panel.getByRole('heading', { name: 'Change the role of Sarah Abdullah Alqahtani' }),
    ).toBeVisible();
    await expect(panel.getByRole('radio', { name: /^Training Coordinator/ })).toBeChecked();
    await expect(panel.getByTestId('role-choice-training_coordinator')).toContainText(
      'Current role',
    );
    // No authenticator code in this session, and none needed: privileged roles are open to the
    // Organization Admin (PO decision, 14 Oct 2026, reversing D-IAM-01).
    await expect(panel.getByRole('radio', { name: /^Organization Admin/ })).toBeEnabled();
    await expectNoSeriousA11yViolations(page);

    // Department Head: the hint about the departments the person heads.
    await panel.getByRole('radio', { name: /^Department Head/ }).check();
    await expect(panel.getByTestId('role-departments-hint')).toBeVisible();
    await panel.getByRole('radio', { name: /^L&D Manager/ }).check();
    await panel.getByRole('button', { name: 'Save role' }).click();
    await expect(panel).toBeHidden();
    await expect(member(page, 'Sarah Abdullah Alqahtani')).toContainText('L&D Manager');
    // Focus comes back to the row's ⋯ (WCAG 2.4.3; review, 21 Oct 2026).
    const sarahMenu = member(page, 'Sarah Abdullah Alqahtani').getByRole('button', {
      name: 'More actions for Sarah Abdullah Alqahtani',
    });
    await expect(sarahMenu).toBeFocused();

    // Undo (PO, 21 Oct 2026): the previous role back through the same action (its own audit entry). The
    // toast stays until closed and says so to screen readers (WCAG 2.2.1 / 2.1.1; review, 21 Oct 2026).
    await expect(toasts(page)).toContainText('Role saved.');
    await expect(toasts(page).getByTestId('toast-action-hint')).toHaveText(
      'You can use “Undo” from this message until you close it.',
    );
    await toasts(page).getByRole('button', { name: 'Undo' }).click();
    await expect(toasts(page)).toContainText(
      'Role change undone: Sarah Abdullah Alqahtani is Training Coordinator again.',
    );
    await expect(member(page, 'Sarah Abdullah Alqahtani')).toContainText('Training Coordinator');

    // Cancel also gives focus back: to the ⋯ that opened the panel, or to the name from the quick look.
    await rowAction(page, 'Sarah Abdullah Alqahtani', 'member-menu-edit-role');
    await panel.getByRole('button', { name: 'Cancel' }).click();
    await expect(panel).toBeHidden();
    await expect(sarahMenu).toBeFocused();
    const sarahName = member(page, 'Sarah Abdullah Alqahtani').getByTestId('member-peek');
    await sarahName.click();
    await page.getByTestId('peek-change-role').click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(sarahName).toBeFocused();
    await changeRole(page, 'Sarah Abdullah Alqahtani', /^L&D Manager/);

    await page.goto(`/en/suite/admin/users/${SARA}`);
    await expect(page.getByTestId('user-roles')).toHaveText('L&D Manager');
    await page.goto(`/en/suite/admin/users/${SARA}?tab=activity`);
    // Saved, undone, saved again: each a «Role changed» entry of its own.
    await expect(page.getByTestId('user-activity').getByText('Role changed').first()).toBeVisible();

    // The old address opens the same panel over the profile: saving the same role changes nothing.
    await page.goto(`/en/suite/admin/users/${SARA}`);
    await page.getByTestId('edit-roles-link').click();
    await expect(page).toHaveURL(new RegExp(`/en/suite/admin/users/${SARA}/roles$`));
    await page.getByTestId('change-role-panel').getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByTestId('edit-role-message')).toHaveText(
      "This is already the person's role.",
    );

    // Nobody changes their own role: no button on one's own profile, and the panel says why.
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
    const arabic = page.getByTestId('change-role-panel');
    await expect(
      arabic.getByRole('heading', { name: 'تغيير دور سارة عبدالله القحطاني' }),
    ).toBeVisible();
    await expect(arabic).toContainText('لكل شخص دور واحد');
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
    await expect(page.getByTestId('role-privileged-notice')).toBeVisible(); // audit log: high risk
    // Changed: the save bar appears.
    await expect(page.getByTestId('save-bar')).toContainText('You have unsaved changes.');
    await builder.getByRole('textbox', { name: /Name in English/ }).fill(name);
    await builder
      .getByRole('textbox', { name: /Name in Arabic/ })
      .fill(`مراجع الدورات ${Date.now()}`);
    const permissions = builder.getByTestId('role-permissions');
    await permissions.getByRole('checkbox', { name: /View the audit log/ }).uncheck();
    await expect(page.getByTestId('role-privileged-notice')).toHaveCount(0);
    // Administrative permissions need the whole organization: a narrower scope clears them — Undo brings
    // the scope and the ticks back.
    await permissions.getByRole('checkbox', { name: 'Invite users' }).check();
    await builder.locator('#role-scope-team').check();
    await expect(builder.getByTestId('role-scope-cleared')).toBeVisible();
    await expect(permissions.getByRole('checkbox', { name: 'Invite users' })).toBeDisabled();
    await builder.getByTestId('role-scope-undo').click();
    await expect(builder.locator('#role-scope-organization')).toBeChecked();
    await expect(permissions.getByRole('checkbox', { name: 'Invite users' })).toBeChecked();
    await permissions.getByRole('checkbox', { name: 'Invite users' }).uncheck();
    // Who can give what (PO, 17 Oct 2026): the training permissions, which the Organization Admin does not
    // hold, can be ticked; the organization structure (the HR Manager's) is not offered at all.
    await expect(permissions.getByRole('checkbox', { name: 'Manage courses' })).toBeEnabled();
    await expect(
      permissions.getByRole('checkbox', { name: 'Manage planning cycles' }),
    ).toBeEnabled();
    await expect(
      permissions.getByRole('checkbox', { name: 'Manage organization structure' }),
    ).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    // Leaving with unsaved changes asks first.
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').first().click();
    await expect(page.getByTestId('discard-dialog')).toBeVisible();
    await page.getByTestId('discard-dialog').getByRole('button', { name: 'Keep editing' }).click();
    await page.getByTestId('save-bar').getByRole('button', { name: 'Save role' }).click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/roles$/);
    await expect(toasts(page)).toContainText('Role saved.');
    await expect(page.getByTestId('roles-custom')).toContainText(name);

    // Give it to Mona from the team list.
    await changeRole(page, 'Mona Saeed Alzahrani', new RegExp(`^${name}`));
    await expect(member(page, 'Mona Saeed Alzahrani')).toContainText(name);

    // Mona, at her next request: the roles page (tenant-wide role.read) and everyone on Team members;
    // still no invitations (user.invite not in the role) and no organization settings.
    const context = await browser.newContext();
    const other = await context.newPage();
    await signIn(other, { email: managerEmail, password: managerPassword });
    await other.goto('/en/suite/admin/roles');
    await expect(other.getByTestId('roles-table')).toBeVisible();
    await expect(other.getByTestId('create-role-link')).toHaveCount(0);
    await other.goto('/en/suite/admin/users');
    await expect(member(other, 'Sarah Abdullah Alqahtani')).toBeVisible();
    await expect(other.getByTestId('invite-user-link')).toHaveCount(0);
    await other.goto('/en/suite/admin/users/invite');
    await expect(other.getByText("You don't have permission to do this.")).toBeVisible();
    await other.goto('/ar/suite/admin/roles/new');
    await expect(other.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(other.getByText('ليست لديك صلاحية لتنفيذ هذا الإجراء.')).toBeVisible();
    await context.close();

    // Arabic: the role's page in Arabic; it cannot be deleted while Mona holds it (also in the ⋯ menu).
    await page.goto('/en/suite/admin/roles');
    const row = page.getByTestId('roles-custom').getByRole('listitem').filter({ hasText: name });
    await row.getByRole('button', { name: `More actions for ${name}` }).click();
    await expect(page.getByRole('menuitem', { name: /Delete role/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    await row.getByRole('link', { name, exact: true }).click();
    const code = /\/roles\/(custom_[0-9a-f]{12})$/.exec(page.url())?.[1] ?? '';
    expect(code).toMatch(/^custom_[0-9a-f]{12}$/);
    await page.goto(`/ar/suite/admin/roles/${code}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('role-in-use')).toContainText('أسند إليهم دورًا آخر أولًا');
    await expectNoSeriousA11yViolations(page);

    // Mona gets her «Line Manager» role back; then the custom role is deleted.
    await changeRole(page, 'Mona Saeed Alzahrani', /^Line Manager/);
    await page.goto(`/en/suite/admin/roles/${code}`);
    await page.getByTestId('role-delete').click();
    await page.getByTestId('role-delete-confirm').click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/roles$/);
    await expect(toasts(page)).toContainText('Role deleted.');
    await expect(page.getByTestId('roles-custom')).not.toContainText(name);
  });

  test('department-limited role: Mona, limited to the Academy, sees the Academy and everything under it only (EP-ORG, T-M3-09)', async ({
    page,
    browser,
  }) => {
    test.skip(!managerEmail || !managerPassword, 'SIGNED_IN_E2E_MANAGER_* not set');
    const name = `Academy coordinator ${Date.now()}`;
    await signIn(page);
    // A custom role limited to «A department»: the unit is picked when the role is given.
    await page.goto('/en/suite/admin/roles/new');
    const builder = page.getByTestId('role-builder');
    await builder.getByRole('textbox', { name: /Name in English/ }).fill(name);
    await builder
      .getByRole('textbox', { name: /Name in Arabic/ })
      .fill(`منسق الأكاديمية ${Date.now()}`);
    await builder
      .getByTestId('role-permissions')
      .getByRole('checkbox', { name: 'View users' })
      .check();
    await builder.locator('#role-scope-departments').check();
    await expect(builder.locator('#role-scope-departments-description')).toContainText(
      'picked when the role is given',
    );
    await page.getByTestId('save-bar').getByRole('button', { name: 'Save role' }).click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/roles$/);

    // Team members → Mona → Change role: the unit picker appears inside the chosen card and is required.
    await page.goto('/en/suite/admin/users');
    await rowAction(page, 'Mona Saeed Alzahrani', 'member-menu-edit-role');
    const panel = page.getByTestId('change-role-panel');
    const unit = panel.getByRole('combobox', { name: /^Department this role covers/ });
    await expect(unit).toHaveCount(0);
    await panel.getByRole('radio', { name: new RegExp(`^${name}`) }).check();
    await expect(unit).toBeVisible();
    await panel.getByRole('button', { name: 'Save role' }).click();
    await expect(panel.getByText('Choose the unit this role covers.').first()).toBeVisible();
    // Tree order with the level's name: the Academy sits under Training and development.
    await expect(unit.locator('option')).toContainText([
      'Training and development (Department)',
      'Academy (Section)',
    ]);
    await unit.selectOption({ label: ' Academy (Section)' });
    await expectNoSeriousA11yViolations(page);
    await panel.getByRole('button', { name: 'Save role' }).click();
    await expect(panel).toBeHidden();
    const mona = member(page, 'Mona Saeed Alzahrani');
    await expect(mona).toContainText(name);
    // The unit is not at the first level: its level is named (guided-test feedback #3).
    await expect(mona.getByTestId('role-unit')).toHaveText('Covers Academy · Section');

    // Mona, at her next request: the people of the Academy (Sarah), not those of Training and development
    // above it (Khalid, her own direct report until now, and herself).
    const context = await browser.newContext();
    const other = await context.newPage();
    await signIn(other, { email: managerEmail, password: managerPassword });
    await other.goto('/en/suite/admin/users');
    await expect(member(other, 'Sarah Abdullah Alqahtani')).toBeVisible();
    await expect(member(other, 'خالد إبراهيم الشهري')).toHaveCount(0);
    await expect(member(other, 'Mona Saeed Alzahrani')).toHaveCount(0);
    expect((await other.goto(`/en/suite/admin/users/${KHALID}`))?.status()).toBe(404);
    await context.close();

    // Mona gets her «Line Manager» role back (no unit: her team again); then the custom role is deleted.
    await changeRole(page, 'Mona Saeed Alzahrani', /^Line Manager/);
    await expect(member(page, 'Mona Saeed Alzahrani').getByTestId('role-unit')).toHaveCount(0);
    await page.goto('/en/suite/admin/roles');
    await page.getByTestId('roles-custom').getByRole('link', { name, exact: true }).click();
    await page.getByTestId('role-delete').click();
    await page.getByTestId('role-delete-confirm').click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/roles$/);
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
    await expect(page.getByTestId('role-privileged-notice')).toContainText('هذا الدور مميز');
    await expect(builder.getByTestId('role-builder-announcer')).toContainText('هذا الدور مميز');
    await expect(page.getByTestId('role-summary')).toContainText('يرى');
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('save-bar').getByRole('button', { name: 'حفظ الدور' }).click();
    await expect(page).toHaveURL(/\/ar\/suite\/admin\/roles$/);
    await expect(toasts(page)).toContainText('حُفظ الدور.');
    const row = page.getByTestId('roles-custom').getByRole('listitem').filter({ hasText: name });
    await expect(row).toContainText('مميز');
    await row.getByRole('link', { name, exact: true }).click();
    // Editing: who holds the role is said with the privileged notice (review L10).
    await expect(page.getByTestId('role-holders')).toHaveText('لا يحمل أحد هذا الدور بعد.');
    await page.getByTestId('role-delete').click();
    await page.getByTestId('role-delete-confirm').click();
    await expect(page).toHaveURL(/\/ar\/suite\/admin\/roles$/);
    await expect(toasts(page)).toContainText('حُذف الدور.');
    await expect(page.getByTestId('roles-custom')).not.toContainText(name);
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
    await expect(page.getByTestId('role-privileged-notice')).toBeVisible();
    await page.getByTestId('save-bar').getByRole('button', { name: 'Save role' }).click();
    await expect(toasts(page)).toContainText('Role saved.');
    // … and Mona made an HR Manager for this test.
    await changeRole(page, 'Mona Saeed Alzahrani', /^HR Manager/);
    try {
      const context = await browser.newContext();
      const hr = await context.newPage();
      await signIn(hr, { email: managerEmail, password: managerPassword });
      await hr.goto(`/en/suite/admin/users/${SARA}/roles`);
      const choice = hr.getByTestId('change-role-panel').getByRole('radio', {
        name: new RegExp(`^${name}`),
      });
      await expect(choice).toBeDisabled();
      const card = hr.locator('[data-testid^="role-choice-"]').filter({ hasText: name });
      await expect(card).toContainText('privileged');
      await expect(card).toContainText('not available to you');
      await expectNoSeriousA11yViolations(hr);
      await context.close();
    } finally {
      await changeRole(page, 'Mona Saeed Alzahrani', /^Line Manager/);
      await page.goto('/en/suite/admin/roles');
      await page.getByTestId('roles-custom').getByRole('link', { name, exact: true }).click();
      await page.getByTestId('role-delete').click();
      await page.getByTestId('role-delete-confirm').click();
      await expect(page).toHaveURL(/\/en\/suite\/admin\/roles$/);
    }
  });
});
