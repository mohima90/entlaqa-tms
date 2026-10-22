import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { afterSignIn, fillSignIn } from './sign-in';

/**
 * Planning cycle journey with data (EP-PLN, T-M3-04; FR-PLN-02): an L&D Manager creates a cycle, sets its
 * scope, an envelope, the named approvers and the reminders, launches it and follows its progress (every
 * department Not started), then extends the deadline — in English. In Arabic a second draft shows that
 * only one cycle can be open at a time and is deleted. A Training Coordinator sees the list read-only.
 *
 * Needs an organization with departments (at least one with a head) and at least two other active members
 * (the approvers): PLANNING_E2E_EMAIL / PLANNING_E2E_PASSWORD (L&D Manager), PLANNING_E2E_APPROVER_SEARCH
 * (two or more letters found in the names of at least two of those members — approvers are searched by name,
 * C-M3) and, optionally, PLANNING_E2E_COORDINATOR_EMAIL / _PASSWORD. Skipped without them (default CI run);
 * to be wired into the self-hosted stack's journeys (infra/docker/smoke.sh) by the tech lead.
 */
const email = process.env.PLANNING_E2E_EMAIL ?? '';
const password = process.env.PLANNING_E2E_PASSWORD ?? '';
const approverSearch = process.env.PLANNING_E2E_APPROVER_SEARCH ?? '';
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
 * named after the first level while every row is at that level, else «Unit» — and then each row shows its
 * level («Retail Sales · Unit»). Never the fixed word «Department» unless the organization named a level so.
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

async function createDraft(page: Page, locale: 'ar' | 'en', nameEn: string, nameAr: string) {
  await page.goto(`/${locale}/suite/planning/cycles`);
  await page.getByTestId('new-cycle-link').click();
  await page.locator('#cycle-name-en').fill(nameEn);
  await page.locator('#cycle-name-ar').fill(nameAr);
  // The organization's default needs form is preselected (T-M3-10); the launch locks it.
  await expect(page.getByTestId('cycle-needs-form')).not.toHaveValue('');
  await page.getByTestId('cycle-basics-save').click();
  await expect(page).toHaveURL(/\?step=scope$/);
}

test.describe('planning cycle journey', () => {
  test.skip(!email || !password || !approverSearch, 'PLANNING_E2E_* not set');
  test.describe.configure({ mode: 'serial' });

  test('English: set up, launch, follow and extend a cycle', async ({ page }) => {
    await signIn(page, 'en', email, password);
    await page.getByRole('link', { name: 'Planning cycles' }).first().click();
    await expect(page).toHaveURL(/\/en\/suite\/planning\/cycles$/);
    await createDraft(page, 'en', 'E2E plan', 'خطة الاختبار');

    // Scope: the first department (and everything under it).
    await page.getByTestId('scope-unit').first().check();
    await expect(page.getByTestId('scope-forms-count')).not.toContainText(': 0');
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('cycle-scope-save').click();
    await expect(page).toHaveURL(/\?step=budget$/);

    // Budget: the organization's level names label the units; an envelope for the first unit; a wrong
    // amount is caught first.
    await expectUnitColumn(page, 'budget-unit-column', 'budget-row', 'Unit', 'Head');
    await page.getByTestId('budget-amount').first().fill('12,5x');
    await page.getByTestId('cycle-budgets-save').click();
    await expect(page.getByText('Enter an amount in numbers')).toBeVisible();
    await page.getByTestId('budget-amount').first().fill('50,000');
    await page.getByTestId('cycle-budgets-save').click();
    await expect(page).toHaveURL(/\?step=approvals$/);

    // Approval chain (one approver combobox per person step, redesign package 4): name two different
    // approvers; the same person twice is refused (BR-PLN-g).
    const pick = async (step: number, option: number) => {
      const chain = page.getByTestId('chain-step').filter({
        has: page.getByTestId('chain-step-approver-search'),
      });
      await chain.nth(step).getByTestId('chain-step-approver-search').fill(approverSearch);
      const options = chain.nth(step).getByTestId('chain-step-approver-option');
      await expect(options.nth(option)).toBeVisible();
      await options.nth(option).click();
    };
    await pick(0, 0);
    await pick(0, 0);
    await page.getByTestId('cycle-steps-save').click();
    await expect(page.getByText('This person already approves another step.')).toBeVisible();
    // Change the second approver to someone else.
    await page.getByTestId('chain-step-approver-change').nth(1).click();
    await pick(0, 1);
    await page.getByTestId('cycle-steps-save').click();
    await expect(page).toHaveURL(/\?step=reminders$/);

    // Reminders save and continue to «Review & launch».
    await page.getByTestId('cycle-reminders-save').click();
    await expect(page).toHaveURL(/\?step=review$/);
    await expect(page.getByTestId('cycle-ready')).toBeVisible();
    await expect(page.getByTestId('review-approvals')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.getByTestId('cycle-launch').click();
    await expect(page.getByTestId('cycle-launch-dialog')).toBeVisible();
    await page.getByTestId('cycle-launch-confirm').click();
    // The confirmation is a toast; the flag leaves the address.
    await expect(
      page.getByText('The cycle is open. Unit heads can now fill in their needs.'),
    ).toBeVisible();
    await expect(page.getByTestId('cycle-status')).toHaveText('Open');
    await expect(page.getByTestId('progress-filters').getByRole('button')).toHaveCount(6);
    const statuses = page.getByTestId('progress-status');
    expect(await statuses.count()).toBeGreaterThan(0);
    for (const status of await statuses.all()) await expect(status).toHaveText('Not started');
    await expectUnitColumn(page, 'progress-column-department', 'progress-row', 'Unit', 'Head');
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

    // The list shows the open cycle first, as a card with its progress.
    await page.goto('/en/suite/planning/cycles');
    await expect(page.getByTestId('cycle-hero')).toHaveCount(1);
    await expect(page.getByTestId('cycle-hero')).toContainText('E2E plan');
    await expect(page.getByTestId('cycle-hero').getByRole('progressbar')).toBeVisible();
  });

  test('Arabic: a second cycle cannot be launched while one is open; the draft is deleted', async ({
    page,
  }) => {
    await signIn(page, 'ar', email, password);
    await createDraft(page, 'ar', 'Second plan', 'الخطة الثانية');
    await page.getByTestId('scope-unit').first().check();
    await page.getByTestId('cycle-scope-save').click();
    await expect(page).toHaveURL(/\?step=budget$/);
    // «Review & launch» lists the problem with a way to fix it; the launch waits.
    await page.goto(`${page.url().replace(/\?step=budget$/, '')}?step=review`);
    await expect(page.getByTestId('cycle-problem-another_open')).toBeVisible();
    await expect(page.getByTestId('cycle-problem-go-another_open')).toHaveAttribute(
      'href',
      '/ar/suite/planning/cycles',
    );
    await expect(page.getByTestId('cycle-launch')).toBeDisabled();
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('cycle-delete').click();
    await page.getByTestId('cycle-delete-confirm').click();
    await expect(page).toHaveURL(/\/ar\/suite\/planning\/cycles$/);
    await expect(page.getByText('حُذفت مسودة الحملة.')).toBeVisible();
  });

  test('the Training Coordinator follows cycles without changing them', async ({ page }) => {
    test.skip(!coordinatorEmail || !coordinatorPassword, 'PLANNING_E2E_COORDINATOR_* not set');
    await signIn(page, 'en', coordinatorEmail, coordinatorPassword);
    await page.goto('/en/suite/planning/cycles');
    await expect(page.getByTestId('new-cycle-link')).toHaveCount(0);
    // The open cycle's card (the coordinator follows it; no set-up links).
    await expect(page.getByTestId('cycle-continue')).toHaveCount(0);
    await page.getByTestId('cycle-open-link').first().click();
    await expect(page.getByTestId('progress-table')).toBeVisible();
    await expect(page.getByTestId('cycle-extend')).toHaveCount(0);
    await page.goto('/en/suite/planning/settings');
    await expect(page.getByTestId('planning-settings-read-only')).toBeVisible();
  });
});
