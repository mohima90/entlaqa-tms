import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Roles & permissions without a database (EP-ROLES, FR-IAM-07/08; the default CI run): the six standard
 * roles in the Kawadir roles table, a standard role's page (view only: read-only permissions accordion,
 * data scope, matrix), in English and Arabic. Building, giving and deleting custom roles needs data: the
 * last journey of users.spec.ts (self-hosted smoke).
 */
async function expectNoSeriousA11yViolations(page: Page) {
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
    team: 'The units they head',
  },
  ar: {
    standard: 'قياسي',
    privileged: 'مميز',
    employee: 'موظف',
    viewOnly: 'للعرض فقط',
    team: 'الوحدات التي يرأسها',
  },
} as const;

for (const locale of ['en', 'ar'] as const) {
  const t = TEXTS[locale];

  test(`${locale}: the six standard roles in the roles table`, async ({ page }) => {
    await page.goto(`/${locale}/suite/admin/roles`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByTestId('roles-not-configured')).toBeVisible();
    const table = page.getByTestId('roles-table');
    await expect(table.getByRole('row')).toHaveCount(7); // header + six standard roles
    for (const code of [
      'tenant_admin',
      'hr_manager',
      'training_manager',
      'training_coordinator',
      'department_head',
      'learner',
    ]) {
      await expect(page.getByTestId(`role-row-${code}`)).toContainText(t.standard);
    }
    await expect(page.getByTestId('role-row-tenant_admin')).toContainText(t.privileged);
    await expect(page.getByTestId('role-row-hr_manager')).toContainText(t.privileged);
    await expect(page.getByTestId('role-row-learner')).not.toContainText(t.privileged);
    // Without the database nobody manages roles here: no «Create role», no edit or delete.
    await expect(page.getByTestId('create-role-link')).toHaveCount(0);
    await expect(table.getByTestId('role-edit')).toHaveCount(0);
    await expect(table.getByTestId('role-delete')).toHaveCount(0);
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
    await expect(page.getByTestId('role-scope')).toHaveText(t.team);
    const accordion = page.getByTestId('role-permissions');
    const boxes = accordion.getByRole('checkbox');
    expect(await boxes.count()).toBeGreaterThan(0);
    for (const box of await boxes.all()) await expect(box).toBeDisabled();
    // Each module heading counts what the role holds (screen readers get the words).
    await expect(accordion.locator('summary').first()).toContainText('/');
    await expect(page.getByTestId('role-matrix')).toBeVisible();
    await expect(page.getByTestId('role-copy')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });
}

test('the HR Manager’s page lists the organization structure, which no custom role holds', async ({
  page,
}) => {
  // Who can give what (PO, 17 Oct 2026): platform.org.manage left the role builder's catalogue but stays
  // on the standard role's page (read-only).
  await page.goto('/en/suite/admin/roles/hr_manager');
  const structure = page
    .getByTestId('role-permissions')
    .getByRole('checkbox', { name: 'Manage organization structure' });
  await expect(structure).toBeChecked();
  await expect(structure).toBeDisabled();
});

test('unknown and retired roles are not found; old links open the role page', async ({ page }) => {
  expect((await page.goto('/en/suite/admin/roles/auditor'))?.status()).toBe(404);
  expect((await page.goto('/en/suite/admin/roles/Not-A-Role'))?.status()).toBe(404);
  await page.goto('/en/suite/admin/roles?role=training_manager');
  await expect(page).toHaveURL(/\/en\/suite\/admin\/roles\/training_manager$/);
  await page.goto('/en/suite/admin/roles?role=../../x');
  await expect(page).toHaveURL(/\/en\/suite\/admin\/roles$/);
});
