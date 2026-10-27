import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Roles & permissions without a database (EP-ROLES, FR-IAM-07/08; the default CI run; redesign package 3):
 * the six standard roles as the Standard group, a standard role's page (view only: each permission
 * Allowed / Not allowed, the data it sees and the matrix in their own tabs), in English and Arabic. Building, giving and deleting custom roles needs data: the
 * last journey of users.spec.ts (self-hosted smoke).
 */
async function expectNoSeriousA11yViolations(page: Page) {
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

const TEXTS = {
  en: {
    standard: 'Standard',
    privileged: 'Privileged',
    employee: 'Employee',
    viewOnly: 'view only',
    team: 'The departments they head',
    allowed: 'Allowed',
    notAllowed: 'Not allowed',
    scopeTab: 'Data this role sees',
    acrossTab: 'What this role does across the product',
  },
  ar: {
    standard: 'قياسي',
    privileged: 'مميز',
    employee: 'موظف',
    viewOnly: 'للعرض فقط',
    team: 'الإدارات التي يرأسها',
    allowed: 'مسموح',
    notAllowed: 'غير مسموح',
    scopeTab: 'البيانات التي يراها هذا الدور',
    acrossTab: 'ما يفعله هذا الدور في المنتج',
  },
} as const;

for (const locale of ['en', 'ar'] as const) {
  const t = TEXTS[locale];

  test(`${locale}: the six standard roles in the Standard group`, async ({ page }) => {
    await page.goto(`/${locale}/suite/admin/roles`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByTestId('roles-not-configured')).toBeVisible();
    const group = page.getByTestId('roles-standard');
    await expect(group.getByRole('heading', { level: 2 })).toContainText(t.standard);
    const table = page.getByTestId('roles-table');
    await expect(table.getByRole('listitem')).toHaveCount(6);
    for (const code of [
      'tenant_admin',
      'hr_manager',
      'training_manager',
      'training_coordinator',
      'department_head',
      'learner',
    ]) {
      await expect(table.getByTestId(`role-row-${code}`)).toBeVisible();
    }
    // Without the database there are no custom roles to show.
    await expect(page.getByTestId('roles-custom')).toHaveCount(0);
    await expect(page.getByTestId('role-row-tenant_admin')).toContainText(t.privileged);
    await expect(page.getByTestId('role-row-hr_manager')).toContainText(t.privileged);
    await expect(page.getByTestId('role-row-learner')).not.toContainText(t.privileged);
    // Without the database nobody manages roles here: no «Create role», no edit or delete.
    await expect(page.getByTestId('create-role-link')).toHaveCount(0);
    await expect(table.getByTestId('role-edit')).toHaveCount(0);
    await expect(table.getByTestId('role-menu')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    await page
      .getByTestId('role-row-learner')
      .getByRole('link', { name: t.employee, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/suite/admin/roles/learner$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.employee);
  });

  test(`${locale}: a standard role is view only`, async ({ page }) => {
    await page.goto(`/${locale}/suite/admin/roles/department_head`);
    await expect(page.getByTestId('role-standard-note')).toContainText(t.viewOnly);
    // Every permission in words — Allowed or Not allowed — no ticked-but-disabled checkboxes.
    const permissions = page.getByTestId('role-permissions');
    await expect(permissions.getByRole('checkbox')).toHaveCount(0);
    await expect(permissions.locator('[data-allowed="true"]').first()).toContainText(t.allowed);
    await expect(permissions.locator('[data-allowed="false"]').first()).toContainText(t.notAllowed);
    // Each module counts what the role holds.
    await expect(permissions.getByRole('heading', { level: 3 }).first()).toBeVisible();
    await expect(page.getByTestId('role-copy')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('link', { name: t.scopeTab }).click();
    await expect(page).toHaveURL(/\?tab=scope$/);
    await expect(page.getByTestId('role-scope')).toHaveText(t.team);
    await page.getByRole('link', { name: t.acrossTab }).click();
    await expect(page).toHaveURL(/\?tab=across$/);
    await expect(page.getByTestId('role-matrix')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
}

test('the HR Manager’s page lists the organization structure, which no custom role holds', async ({
  page,
}) => {
  // Who can give what (PO, 17 Oct 2026): platform.org.manage left the role builder's catalogue but stays
  // on the standard role's page (read-only).
  await page.goto('/en/suite/admin/roles/hr_manager');
  const structure = page.getByTestId('permission-platform.org.manage');
  await expect(structure).toContainText('Manage organization structure');
  await expect(structure).toHaveAttribute('data-allowed', 'true');
  await expect(structure).toContainText('Allowed');
});

test('unknown and retired roles are not found; old links open the role page', async ({ page }) => {
  expect((await page.goto('/en/suite/admin/roles/auditor'))?.status()).toBe(404);
  expect((await page.goto('/en/suite/admin/roles/Not-A-Role'))?.status()).toBe(404);
  await page.goto('/en/suite/admin/roles?role=training_manager');
  await expect(page).toHaveURL(/\/en\/suite\/admin\/roles\/training_manager$/);
  await page.goto('/en/suite/admin/roles?role=../../x');
  await expect(page).toHaveURL(/\/en\/suite\/admin\/roles$/);
});
