import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Users pages with real data (T-M2-04, screens 1 and 3) against a configured deployment: runs in the
 * self-hosted smoke (infra/docker/smoke.sh) after infra/docker/seed-users.sql, signed in as the
 * provisioned Organization Admin. Skipped in the default CI run (no Auth server, no data).
 */
const email = process.env.SIGNED_IN_E2E_EMAIL;
const password = process.env.SIGNED_IN_E2E_PASSWORD;
const SARA = '5eed1000-0000-4000-8000-000000000001';

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
    await expect(table.getByRole('row')).toHaveCount(4); // header + admin, Sarah, Khalid
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

    // Another organization's or an unknown person: not found (no existence leak)
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
    await expect(page.getByTestId('users-table').getByRole('row')).toHaveCount(4);
  });
});
