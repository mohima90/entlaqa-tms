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
 * (the approvers): PLANNING_E2E_EMAIL / PLANNING_E2E_PASSWORD (L&D Manager) and, optionally,
 * PLANNING_E2E_COORDINATOR_EMAIL / _PASSWORD. Skipped without them (default CI run); to be wired into the
 * self-hosted stack's journeys (infra/docker/smoke.sh) by the tech lead.
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
  test.skip(!email || !password, 'PLANNING_E2E_* not set');
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

    // Budget: an envelope for the first department; a wrong amount is caught first.
    await page.getByTestId('budget-amount').first().fill('12,5x');
    await page.getByTestId('cycle-budgets-save').click();
    await expect(page.getByText('Enter an amount in numbers')).toBeVisible();
    await page.getByTestId('budget-amount').first().fill('50,000');
    await page.getByTestId('cycle-budgets-save').click();
    await expect(page).toHaveURL(/\?step=approvals$/);

    // Approval chain: name two different approvers; the same person twice is refused (BR-PLN-g).
    const approvers = page.getByTestId('chain-step-approver');
    await approvers.nth(0).selectOption({ index: 1 });
    await approvers.nth(1).selectOption({ index: 1 });
    await page.getByTestId('cycle-steps-save').click();
    await expect(page.getByText('This person already approves another step.')).toBeVisible();
    await approvers.nth(1).selectOption({ index: 2 });
    await page.getByTestId('cycle-steps-save').click();
    await expect(page).toHaveURL(/\?step=reminders$/);

    await page.getByTestId('cycle-reminders-save').click();
    await expect(page.getByTestId('cycle-ready')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.getByTestId('cycle-launch').click();
    await expect(page.getByTestId('cycle-launch-dialog')).toBeVisible();
    await page.getByTestId('cycle-launch-confirm').click();
    await expect(page).toHaveURL(/\?launched=1$/);
    await expect(page.getByTestId('cycle-launched')).toBeVisible();
    await expect(page.getByTestId('cycle-status')).toHaveText('Open');
    const statuses = page.getByTestId('progress-status');
    expect(await statuses.count()).toBeGreaterThan(0);
    for (const status of await statuses.all()) await expect(status).toHaveText('Not started');
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
    await expect(page.getByTestId('cycle-deadline')).not.toHaveText(before ?? '');

    await page.goto('/en/suite/planning/cycles?tab=open');
    await expect(page.getByTestId('cycle-row')).toHaveCount(1);
    await expect(page.getByTestId('cycle-row')).toContainText('E2E plan');
  });

  test('Arabic: a second cycle cannot be launched while one is open; the draft is deleted', async ({
    page,
  }) => {
    await signIn(page, 'ar', email, password);
    await createDraft(page, 'ar', 'Second plan', 'الخطة الثانية');
    await page.getByTestId('scope-unit').first().check();
    await page.getByTestId('cycle-scope-save').click();
    await expect(page).toHaveURL(/\?step=budget$/);
    await expect(page.getByTestId('cycle-problem-another_open')).toBeVisible();
    await expect(page.getByTestId('cycle-launch')).toBeDisabled();
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('cycle-delete').click();
    await page.getByTestId('cycle-delete-confirm').click();
    await expect(page).toHaveURL(/\/ar\/suite\/planning\/cycles\?deleted=1$/);
    await expect(page.getByTestId('cycle-deleted')).toBeVisible();
  });

  test('the Training Coordinator follows cycles without changing them', async ({ page }) => {
    test.skip(!coordinatorEmail || !coordinatorPassword, 'PLANNING_E2E_COORDINATOR_* not set');
    await signIn(page, 'en', coordinatorEmail, coordinatorPassword);
    await page.goto('/en/suite/planning/cycles');
    await expect(page.getByTestId('new-cycle-link')).toHaveCount(0);
    await page.getByTestId('cycle-row').first().getByRole('link').first().click();
    await expect(page.getByTestId('progress-table')).toBeVisible();
    await expect(page.getByTestId('cycle-extend')).toHaveCount(0);
    await page.goto('/en/suite/planning/settings');
    await expect(page.getByTestId('planning-settings-read-only')).toBeVisible();
  });
});
