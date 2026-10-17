import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Organization → Structure and Branches without a database (FR-ADM-04/05, T-M3-02; business flow EP-ORG;
 * the default CI run): the page frame, the summary cards, the two views (tree, levels) with the default level
 * every organization starts with — Department / «إدارة» — and the branches list, in English and Arabic,
 * accessible (axe). Building the tree, the levels, and the department picker of department-limited roles need
 * data: invitations.spec.ts (an HR Manager signs up and builds the structure) and users.spec.ts (a role
 * limited to one unit), both in the self-hosted smoke.
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
    title: 'Organization structure',
    tree: 'Structure',
    levels: 'Levels',
    empty: 'No units yet',
    level: 'Level 1',
    branches: 'Branches',
    noBranches: 'No branches yet',
  },
  ar: {
    title: 'الهيكل التنظيمي',
    tree: 'الهيكل',
    levels: 'المستويات',
    empty: 'لا توجد وحدات بعد',
    level: 'المستوى 1',
    branches: 'الفروع',
    noBranches: 'لا توجد فروع بعد',
  },
} as const;

for (const locale of ['en', 'ar'] as const) {
  const t = TEXTS[locale];

  test(`${locale}: the structure page — tree and levels views, default level`, async ({ page }) => {
    await page.goto(`/${locale}/suite/admin/structure`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByTestId('structure-not-configured')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    await expect(page.getByTestId('structure-stats')).toBeVisible();
    const views = page.getByTestId('structure-views');
    await expect(views.getByRole('link', { name: t.tree })).toHaveAttribute('aria-current', 'page');
    const tree = page.getByTestId('structure-tree');
    await expect(tree.getByRole('heading', { level: 3 })).toHaveText(t.empty);
    // Without the database nobody changes the structure here.
    await expect(page.getByTestId('unit-add-top')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    await views.getByRole('link', { name: t.levels }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/suite/admin/structure\\?view=levels$`));
    await expect(views.getByRole('link', { name: t.levels })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const row = page.getByTestId('level-row-1');
    await expect(row).toContainText(t.level);
    await expect(row).toContainText('Department');
    await expect(row).toContainText('إدارة');
    await expect(page.getByTestId('levels-table').getByRole('row')).toHaveCount(2);
    await expect(page.getByTestId('level-add')).toHaveCount(0);
    await expect(page.getByTestId('level-rename')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test(`${locale}: the branches page`, async ({ page }) => {
    await page.goto(`/${locale}/suite/admin/branches`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByTestId('branches-not-configured')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.branches);
    await expect(page.getByTestId('branches-card').getByRole('heading', { level: 3 })).toHaveText(
      t.noBranches,
    );
    await expect(page.getByTestId('branch-add')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });
}

test('the menu links Structure and Branches (Organization group)', async ({ page }) => {
  await page.goto('/en/suite');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Structure' })).toHaveAttribute(
    'href',
    '/en/suite/admin/structure',
  );
  await expect(nav.getByRole('link', { name: 'Branches' })).toHaveAttribute(
    'href',
    '/en/suite/admin/branches',
  );
  // The other view of the structure page is its own address (bookmarkable, server-rendered).
  await page.goto('/en/suite/admin/structure?view=unknown');
  await expect(
    page.getByTestId('structure-views').getByRole('link', { name: 'Structure' }),
  ).toHaveAttribute('aria-current', 'page');
});
