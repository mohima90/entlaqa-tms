import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { afterSignIn, fillSignIn } from './sign-in';

/**
 * Planning cycle journey with data (EP-PLN, T-M3-04; the Kawadir pattern — forms standard rule 9, WP-UX-01 a /
 * T-M3-20; FR-PLN-02), in English and in Arabic: an L&D Manager creates a cycle in the «New cycle» popup,
 * edits it in the same popup from its row menu, gives one department a budget on the cycle's Settings page
 * and launches it from the row menu with the confirmation. In English the cycle is launched — no approval
 * chain is asked for (EP-PLN §13 e) —, its progress followed (every department Not started) and its deadline
 * extended. In Arabic the same journey runs up to the confirmation, which says that another cycle is open
 * (one open cycle at a time); the draft is then deleted from its row menu. A Training Coordinator sees the
 * list read-only.
 *
 * Needs an organization with departments: PLANNING_E2E_EMAIL / PLANNING_E2E_PASSWORD (L&D Manager) and,
 * optionally, PLANNING_E2E_COORDINATOR_EMAIL / _PASSWORD. Skipped without them (default CI run); to be wired
 * into the self-hosted stack's journeys (infra/docker/smoke.sh) by the tech lead.
 */
const email = process.env.PLANNING_E2E_EMAIL ?? '';
const password = process.env.PLANNING_E2E_PASSWORD ?? '';
const coordinatorEmail = process.env.PLANNING_E2E_COORDINATOR_EMAIL ?? '';
const coordinatorPassword = process.env.PLANNING_E2E_COORDINATOR_PASSWORD ?? '';

async function signIn(page: Page, locale: 'ar' | 'en', who: string, secret: string) {
  await page.goto(`/${locale}/sign-in`);
  await fillSignIn(page, locale, who, secret);
  await expect(page).toHaveURL(new RegExp(`/${locale}/suite$`), afterSignIn);
}

async function expectNoSeriousA11yViolations(page: Page) {
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

/**
 * The organization's own level names (guided-test feedback #3, PO 17 Oct 2026): the unit column of a table is
 * named after the first level while every row is at that level, else «Department» — and then each row shows its
 * level («Retail Sales · Department»); the general word is «Department» (word list, PO 27 Oct 2026).
 */
async function expectUnitColumn(
  page: Page,
  column: string,
  rows: string,
  neutral: string,
  heading: string,
) {
  const label = ((await page.getByTestId(column).textContent()) ?? '').trim();
  expect(label).not.toBe('');
  const names = await page.getByTestId(rows).locator('th[scope="row"]').allTextContents();
  expect(names.length).toBeGreaterThan(0);
  if (label === neutral) {
    for (const name of names) expect(name).toContain(' · ');
  } else {
    for (const name of names) expect(name).not.toContain(' · ');
  }
  // The heads column says «Head», not «Department head».
  await expect(page.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
}

const TEXTS = {
  en: {
    newTitle: 'New planning cycle',
    created: (name: string) => `${name} is saved as a draft. Launch it when you are ready.`,
    updated: 'Changes saved.',
    editTitle: (name: string) => `Edit ${name}`,
    menu: (name: string) => `Actions for ${name}`,
    launchTitle: (name: string) => `Launch ${name}?`,
    unitNeutral: 'Department',
    head: 'Head',
    invalidAmount: 'Enter an amount in numbers',
    draft: 'Draft',
    deleted: 'The draft cycle was deleted.',
  },
  ar: {
    newTitle: 'حملة حصر احتياجات جديدة',
    created: (name: string) => `حُفظت ${name} مسودةً. أطلقها متى كنت جاهزًا.`,
    updated: 'حُفظت التغييرات.',
    editTitle: (name: string) => `تعديل ${name}`,
    menu: (name: string) => `إجراءات ${name}`,
    launchTitle: (name: string) => `إطلاق ${name}؟`,
    unitNeutral: 'الإدارة',
    head: 'الرئيس',
    invalidAmount: 'أدخل مبلغًا بالأرقام',
    draft: 'مسودة',
    deleted: 'حُذفت مسودة الحملة.',
  },
} as const;

/** The row of a cycle in the list, by its name. */
const cycleRow = (page: Page, name: string) =>
  page.getByTestId('cycle-row').filter({ has: page.getByTestId('cycle-name').getByText(name) });

/** Opens a draft's row menu and picks one of its actions. */
async function rowAction(
  page: Page,
  locale: 'ar' | 'en',
  name: string,
  action: 'edit' | 'settings' | 'launch' | 'delete',
) {
  await page.getByRole('button', { name: TEXTS[locale].menu(name), exact: true }).click();
  // The menu carries the same name as the button that opens it.
  await expect(
    page.getByRole('menu', { name: TEXTS[locale].menu(name), exact: true }),
  ).toBeVisible();
  await page.getByTestId(`cycle-menu-${action}`).click();
}

/**
 * Create in the popup → edit in the same popup → a budget for one department on the Settings page → the
 * launch confirmation from the row menu (left open). `names`: the cycle's name as created and as renamed,
 * in the page's language.
 */
async function journeyToLaunch(
  page: Page,
  locale: 'ar' | 'en',
  names: { readonly first: string; readonly renamed: string; readonly other: string },
) {
  const t = TEXTS[locale];
  const own = locale === 'ar' ? '#cycle-name-ar' : '#cycle-name-en';
  const otherName = locale === 'ar' ? '#cycle-name-en' : '#cycle-name-ar';
  await page.goto(`/${locale}/suite/planning/cycles`);

  // 1. One popup creates the cycle: the name, the suggested period and deadline, every department and
  //    the default needs form are there already.
  await page.getByTestId('new-cycle').click();
  const create = page.getByRole('dialog', { name: t.newTitle });
  await expect(create).toBeVisible();
  // English is the default language of the test organization: its name is the required one.
  await page.locator('#cycle-name-en').fill(locale === 'en' ? names.first : names.other);
  if (locale === 'ar') await page.locator('#cycle-name-ar').fill(names.first);
  await expect(page.getByTestId('scope-all')).toBeChecked();
  await expect(page.getByTestId('scope-forms-count')).not.toContainText(': 0');
  // The organization's default needs form is preselected (T-M3-10); the launch locks it.
  await expect(page.getByTestId('cycle-needs-form')).not.toHaveValue('');
  await expectNoSeriousA11yViolations(page);
  await page.getByTestId('cycle-form-save').click();
  await expect(create).toBeHidden();
  await expect(page.getByText(t.created(names.first))).toBeVisible();
  // The list shows the new draft, and the summary cards count it.
  const row = cycleRow(page, names.first);
  await expect(row.getByTestId('cycle-status')).toHaveText(t.draft);
  await expect(page.getByTestId('cycles-stat-draft')).not.toContainText('0');
  await expectNoSeriousA11yViolations(page);

  // 2. «Edit» in the row menu is the same popup, pre-filled.
  await rowAction(page, locale, names.first, 'edit');
  const edit = page.getByRole('dialog', { name: t.editTitle(names.first) });
  await expect(edit).toBeVisible();
  await expect(page.locator(own)).toHaveValue(names.first);
  // A refused save says so where the person is: the focus moves to the field with the message (the
  // English name is the required one in the test organization).
  const requiredName = page.locator('#cycle-name-en');
  const requiredValue = await requiredName.inputValue();
  await requiredName.fill('');
  await page.getByTestId('cycle-form-save').click();
  await expect(requiredName).toBeFocused();
  await expect(requiredName).toHaveAttribute('aria-invalid', 'true');
  await requiredName.fill(requiredValue);
  // «Edit» is one save: the names, the dates, the form and the departments together.
  await page.locator(own).fill(names.renamed);
  if (locale === 'en') await page.locator(otherName).fill(names.other);
  await page.getByTestId('cycle-form-save').click();
  await expect(edit).toBeHidden();
  await expect(page.getByText(t.updated).first()).toBeVisible();
  await expect(cycleRow(page, names.renamed)).toHaveCount(1);
  // Focus is back on the row menu's button.
  await expect(
    page.getByRole('button', { name: t.menu(names.renamed), exact: true }),
  ).toBeFocused();

  // 3. «Settings»: the optional parts on the cycle's own page — a budget for one department.
  await rowAction(page, locale, names.renamed, 'settings');
  await expect(page).toHaveURL(/\/planning\/cycles\/[0-9a-f-]{36}\/settings$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(names.renamed);
  await expect(page.getByTestId('cycle-settings-tabs').getByRole('link')).toHaveCount(4);
  // The organization's level names label the departments; a wrong amount is caught first.
  await expectUnitColumn(page, 'budget-unit-column', 'budget-row', t.unitNeutral, t.head);
  await expect(page.getByTestId('save-bar')).toHaveCount(0);
  await page.getByTestId('budget-amount').first().fill('12,5x');
  await page.getByTestId('save-bar-save').click();
  await expect(page.getByText(t.invalidAmount)).toBeVisible();
  await page.getByTestId('budget-amount').first().fill('50,000');
  await expectNoSeriousA11yViolations(page);
  await page.getByTestId('save-bar-save').click();
  await expect(page.getByText(t.updated).first()).toBeVisible();
  await expect(page.getByTestId('save-bar')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('budget-amount').first()).toHaveValue('50000');
  // There is no approval chain to set up any more (EP-PLN §13 e).
  await expect(page.getByTestId('cycle-steps')).toHaveCount(0);

  // 4. «Launch cycle» in the row menu asks first: how many departments, until when, and their heads.
  await page.goto(`/${locale}/suite/planning/cycles`);
  await rowAction(page, locale, names.renamed, 'launch');
  const launch = page.getByRole('dialog', { name: t.launchTitle(names.renamed) });
  await expect(launch).toBeVisible();
  expect(await page.getByTestId('cycle-launch-department').count()).toBeGreaterThan(0);
  await expectNoSeriousA11yViolations(page);
  return launch;
}

test.describe('planning cycle journey', () => {
  test.skip(!email || !password, 'PLANNING_E2E_* not set');
  test.describe.configure({ mode: 'serial' });

  test('English: create in the popup, edit, set a budget, launch from the row menu, follow and extend', async ({
    page,
  }) => {
    await signIn(page, 'en', email, password);
    await page.getByRole('link', { name: 'Planning cycles' }).first().click();
    await expect(page).toHaveURL(/\/en\/suite\/planning\/cycles$/);
    const launch = await journeyToLaunch(page, 'en', {
      first: 'E2E plan',
      renamed: 'E2E plan 2027',
      other: 'خطة الاختبار',
    });
    // Nothing stops the launch: no approver has to be named (EP-PLN §13 e).
    await expect(page.getByTestId('cycle-problems')).toHaveCount(0);
    await expect(page.getByTestId('cycle-launch-confirm')).toBeEnabled();
    await page.getByTestId('cycle-launch-confirm').click();
    await expect(launch).toBeHidden();
    // The confirmation is a toast on the cycle's progress; the flag leaves the address.
    await expect(
      page.getByText('The cycle is open. Department heads can now fill in their needs.'),
    ).toBeVisible();
    await expect(page.getByTestId('cycle-status')).toHaveText('Open');
    await expect(page.getByTestId('progress-filters').getByRole('button')).toHaveCount(6);
    const statuses = page.getByTestId('progress-status');
    expect(await statuses.count()).toBeGreaterThan(0);
    for (const status of await statuses.all()) await expect(status).toHaveText('Not started');
    await expectUnitColumn(
      page,
      'progress-column-department',
      'progress-row',
      'Department',
      'Head',
    );
    // The approval chain is not shown on a launched cycle either.
    await expect(page.getByTestId('cycle-chain')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    // Extend the deadline while open.
    const before = await page.getByTestId('cycle-deadline').textContent();
    await page.getByTestId('cycle-extend').click();
    const field = page.locator('#cycle-extend-deadline');
    const current = await field.inputValue();
    const later = new Date(`${current}T00:00:00Z`);
    later.setUTCDate(later.getUTCDate() + 7);
    await field.fill(later.toISOString().slice(0, 10));
    await page.getByTestId('cycle-extend-confirm').click();
    await expect(page.getByText('The deadline was extended.')).toBeVisible();
    await expect(page.getByTestId('cycle-deadline')).not.toHaveText(before ?? '');

    // The list shows the open cycle in its row: status, how many submitted, the way to its progress —
    // and no row menu (a launched cycle's settings no longer change).
    await page.goto('/en/suite/planning/cycles');
    const row = cycleRow(page, 'E2E plan 2027');
    await expect(row.getByTestId('cycle-status')).toHaveText('Open');
    await expect(row.getByRole('progressbar')).toBeVisible();
    await expect(row.getByTestId('cycle-open-link')).toBeVisible();
    await expect(row.getByTestId('cycle-menu')).toHaveCount(0);
    // Its old set-up address leads to its progress now.
    await row.getByTestId('cycle-open-link').click();
    await expect(page.getByTestId('progress-table')).toBeVisible();
    await page.goto(`${page.url()}/settings`);
    await expect(page).toHaveURL(/\/planning\/cycles\/[0-9a-f-]{36}$/);
  });

  test('Arabic: the same journey; the launch waits while another cycle is open; the draft is deleted', async ({
    page,
  }) => {
    await signIn(page, 'ar', email, password);
    const launch = await journeyToLaunch(page, 'ar', {
      first: 'الخطة الثانية',
      renamed: 'الخطة الثانية 2027',
      other: 'Second plan',
    });
    // The confirmation says what stops the launch — the cycle opened in English — and waits.
    await expect(page.getByTestId('cycle-problem-another_open')).toBeVisible();
    await expect(page.getByTestId('cycle-launch-confirm')).toBeDisabled();
    await page.getByTestId('cycle-launch-cancel').click();
    await expect(launch).toBeHidden();
    // «Delete draft» in the row menu asks first, then the list says it is gone.
    await rowAction(page, 'ar', 'الخطة الثانية 2027', 'delete');
    await page.getByTestId('cycle-delete-confirm').click();
    await expect(page.getByText(TEXTS.ar.deleted)).toBeVisible();
    await expect(cycleRow(page, 'الخطة الثانية 2027')).toHaveCount(0);
    await expect(page).toHaveURL(/\/ar\/suite\/planning\/cycles$/);
  });

  test('the Training Coordinator follows cycles without changing them', async ({ page }) => {
    test.skip(!coordinatorEmail || !coordinatorPassword, 'PLANNING_E2E_COORDINATOR_* not set');
    await signIn(page, 'en', coordinatorEmail, coordinatorPassword);
    await page.goto('/en/suite/planning/cycles');
    await expect(page.getByTestId('new-cycle')).toHaveCount(0);
    // The open cycle's row (the coordinator follows it; no row menus).
    await expect(page.getByTestId('cycle-menu')).toHaveCount(0);
    await page.getByTestId('cycle-open-link').first().click();
    await expect(page.getByTestId('progress-table')).toBeVisible();
    await expect(page.getByTestId('cycle-extend')).toHaveCount(0);
    await page.goto('/en/suite/planning/settings');
    await expect(page.getByTestId('planning-settings-read-only')).toBeVisible();
  });
});
