import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Organization → Structure and Branches without a database (FR-ADM-04/05, T-M3-02; business flow EP-ORG;
 * the default CI run; direction C, redesign package 2): the page frame with its breadcrumbs, the summary
 * strip, the two views «Departments» and «Levels» (Q2-10; the levels as a top-to-bottom chain) with the default level
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
    tree: 'Departments',
    levels: 'Levels',
    chain: 'Levels from the top down',
    explanation:
      'Name the levels of your organization in order. The structure follows these names.',
    empty: 'No departments yet',
    level: 'Level 1',
    units: 'No departments',
    branches: 'Branches',
    noBranches: 'No branches yet',
    breadcrumb: 'Breadcrumb',
    costCentres: 'Cost centres',
    noCostCentres: 'No cost centres yet',
    importTitle: 'Import departments',
  },
  ar: {
    title: 'الهيكل التنظيمي',
    tree: 'الإدارات',
    levels: 'المستويات',
    chain: 'المستويات من الأعلى إلى الأسفل',
    explanation: 'سمِّ مستويات منظمتك بالترتيب، ويتبع الهيكل هذه الأسماء.',
    empty: 'لا توجد إدارات بعد',
    level: 'المستوى 1',
    units: 'لا إدارات',
    branches: 'الفروع',
    noBranches: 'لا توجد فروع بعد',
    breadcrumb: 'مسار التنقل',
    costCentres: 'مراكز التكلفة',
    noCostCentres: 'لا توجد مراكز تكلفة بعد',
    importTitle: 'استيراد الإدارات',
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
    await expect(
      page.getByRole('navigation', { name: t.breadcrumb }).locator('[aria-current="page"]'),
    ).toBeVisible();
    // The level chain beside the views: the organization's own level names, top down.
    await expect(page.getByTestId('structure-chain')).toContainText(
      locale === 'ar' ? 'إدارة' : 'Department',
    );
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
    // The organization tree: the levels as a top-to-bottom chain — an ordered list with its own name
    // (guided-test feedback #1), the explanation above it.
    const card = page.getByTestId('structure-levels');
    await expect(card.getByRole('heading', { name: t.levels })).toBeVisible();
    await expect(card).toContainText(t.explanation);
    const chain = page.getByRole('list', { name: t.chain });
    await expect(chain).toHaveAttribute('data-testid', 'levels-chain');
    await expect(chain.getByRole('listitem')).toHaveCount(1);
    const row = page.getByTestId('level-row-1');
    await expect(row).toContainText(t.level);
    await expect(row.getByTestId('level-name')).toHaveText(
      locale === 'ar' ? 'إدارة' : 'Department',
    );
    await expect(row).toContainText(locale === 'ar' ? 'Department' : 'إدارة');
    await expect(row.getByTestId('level-units')).toHaveText(t.units);
    await expect(page.getByTestId('level-connector')).toHaveCount(0);
    await expect(page.getByTestId('level-add')).toHaveCount(0);
    await expect(page.getByTestId('level-rename')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test(`${locale}: cost centres view and the unit import page (WP-HR-01)`, async ({ page }) => {
    await page.goto(`/${locale}/suite/admin/structure`);
    const views = page.getByTestId('structure-views');
    await views.getByRole('link', { name: t.costCentres }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${locale}/suite/admin/structure\\?view=costCentres$`),
    );
    await expect(views.getByRole('link', { name: t.costCentres })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const list = page.getByTestId('cost-centres');
    await expect(list.getByRole('heading', { level: 2 })).toHaveText(t.costCentres);
    await expect(list.getByRole('heading', { level: 3 })).toHaveText(t.noCostCentres);
    // Without the database nobody adds one here.
    await expect(page.getByTestId('cost-centre-add')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    await page.goto(`/${locale}/suite/admin/structure/import`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.importTitle);
    await expect(page.getByTestId('structure-not-configured')).toBeVisible();
    // The breadcrumb leads back to the structure.
    await expect(
      page
        .getByRole('navigation', { name: t.breadcrumb })
        .locator(`a[href="/${locale}/suite/admin/structure"]`),
    ).toBeVisible();
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
    await expect(page.getByRole('navigation', { name: t.breadcrumb })).toContainText(t.branches);
    // Without branches there is nothing to filter.
    await expect(page.getByTestId('branch-filters')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });
}

test('the menu links Structure and Branches (Organization group)', async ({ page, isMobile }) => {
  await page.goto('/en/suite');
  if (isMobile) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Departments' })).toHaveAttribute(
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
    page.getByTestId('structure-views').getByRole('link', { name: 'Departments' }),
  ).toHaveAttribute('aria-current', 'page');
});
