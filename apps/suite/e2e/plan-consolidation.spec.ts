import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { afterSignIn, fillSignIn } from './sign-in';

/**
 * The training plan — consolidation and the budget check (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06; approved
 * screens docs/design/screens/m3-consolidation-approval/README.md 1–3). Without a database (the default CI
 * run): a cycle's Plan tab says it needs one, in English and Arabic, with the accessibility scan and no
 * horizontal overflow. With data (the self-hosted stack, infra/docker/smoke.sh): the L&D Manager opens the
 * Plan tab of the open cycle whose every department has submitted, closes the needs early and builds the
 * plan, costs a line in its popup, leaves a line out with a reason and brings it back, moves a line to
 * another quarter, groups by quarter and opens the budget by department — then reads the plan in Arabic.
 * Needs PLAN_E2E_EMAIL / PLAN_E2E_PASSWORD (an L&D Manager) and PLAN_E2E_CYCLE_ID (that cycle); skipped
 * without them.
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

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const PREVIEW_CYCLE = '11111111-1111-4111-8111-111111111111';

for (const locale of ['en', 'ar'] as const) {
  test(`${locale}: the Plan tab without a database`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`/${locale}/suite/planning/cycles/${PREVIEW_CYCLE}?tab=plan`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByTestId('planning-not-configured')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

const email = process.env.PLAN_E2E_EMAIL ?? '';
const password = process.env.PLAN_E2E_PASSWORD ?? '';
const cycleId = process.env.PLAN_E2E_CYCLE_ID ?? '';

const TEXTS = {
  en: {
    closeNow: 'Close needs now',
    inPlan: 'In the plan',
    leftOut: 'Left out',
    planTab: 'Plan',
    q3: 'Q3',
  },
  ar: {
    closeNow: 'إغلاق الاحتياجات الآن',
    inPlan: 'في الخطة',
    leftOut: 'مستبعدة',
    planTab: 'الخطة',
    q3: 'الربع الثالث',
  },
} as const;

async function signIn(page: Page, locale: 'ar' | 'en') {
  await page.goto(`/${locale}/sign-in`);
  await fillSignIn(page, locale, email, password);
  await expect(page).toHaveURL(new RegExp(`/${locale}/suite$`), afterSignIn);
}

test.describe('the L&D Manager builds and checks the plan (data journey)', () => {
  test.skip(!email || !password || !cycleId, 'PLAN_E2E_* not set');
  test.describe.configure({ mode: 'serial' });

  test('en: close the needs, cost, leave out and bring back, change the quarter, read the budget', async ({
    page,
  }) => {
    const t = TEXTS.en;
    await signIn(page, 'en');
    await page.goto(`/en/suite/planning/cycles/${cycleId}`);
    // Progress and Plan are two tabs of the cycle; the Plan tab has its own address.
    const tabs = page.getByTestId('cycle-tabs');
    await expect(tabs.getByRole('link')).toHaveCount(2);
    await tabs.getByRole('link', { name: t.planTab }).click();
    await expect(page).toHaveURL(/\?tab=plan$/);

    // Before the plan: every department submitted, so the needs can close now — after a question.
    await expect(page.getByTestId('plan-not-open')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: t.closeNow }).click();
    await expect(page.getByTestId('plan-open-dialog')).toBeVisible();
    await page.getByTestId('plan-open-confirm').click();
    await expect(page.getByTestId('plan-tab')).toBeVisible();
    await expect(page.getByTestId('plan-status')).toBeVisible();
    await expect(page.getByTestId('plan-summary')).toBeVisible();
    // New lines have no cost yet: «Needs your attention» says so.
    await expect(page.getByTestId('plan-attention-uncosted')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);

    // The shared line (Excel, every department): cost it in its popup, the figures follow the typing.
    const excel = page.getByTestId('plan-line-row').filter({ hasText: 'Excel' });
    await expect(excel).toHaveCount(1);
    await excel.getByTestId('plan-line-title').click();
    const popup = page.getByTestId('plan-line-dialog');
    await expect(popup).toBeVisible();
    await popup.getByTestId('plan-line-min').fill('4');
    await popup.getByTestId('plan-line-max').fill('20');
    await popup.getByTestId('plan-line-cost').fill('5,000');
    await expect(popup.getByTestId('plan-line-preview')).toContainText('SAR');
    await expectNoSeriousA11yViolations(page);
    await popup.getByTestId('plan-line-save').click();
    await expect(popup).toBeHidden();
    await expect(excel.getByTestId('plan-line-status')).toHaveText(t.inPlan);

    // Leave the other line out with a reason (required), then bring it back from its menu.
    const other = page.getByTestId('plan-line-row').filter({ hasNotText: 'Excel' }).first();
    await other.getByTestId('plan-line-menu').click();
    await page.getByTestId('plan-line-menu-leave-out').click();
    const leave = page.getByTestId('plan-leave-out-dialog');
    await leave.getByTestId('plan-leave-out-confirm').click();
    await expect(leave.locator('#plan-leave-out-reason')).toHaveAttribute('aria-invalid', 'true');
    await leave.getByTestId('plan-leave-out-reason').fill('E2E: planned for next year.');
    await expectNoSeriousA11yViolations(page);
    await leave.getByTestId('plan-leave-out-confirm').click();
    await expect(leave).toBeHidden();
    const leftOut = page
      .getByTestId('plan-line-row')
      .filter({ hasText: 'E2E: planned for next year.' });
    await expect(leftOut.getByTestId('plan-line-status')).toHaveText(t.leftOut);
    await leftOut.getByTestId('plan-line-menu').click();
    await page.getByTestId('plan-line-menu-bring-back').click();
    await expect(
      page.getByTestId('plan-line-row').filter({ hasText: 'E2E: planned for next year.' }),
    ).toHaveCount(0);

    // Move the Excel line to Q3, then group by quarter: it sits under Q3.
    await excel.getByTestId('plan-line-select').check();
    await expect(page.getByTestId('plan-bulk-bar')).toBeVisible();
    await page.getByTestId('plan-bulk-quarter').click();
    const quarter = page.getByTestId('plan-quarter-dialog');
    await quarter.getByText(t.q3, { exact: true }).click();
    await quarter.getByTestId('plan-quarter-confirm').click();
    await expect(quarter).toBeHidden();
    await page.getByTestId('plan-group-quarter').click();
    await expect(page).toHaveURL(/group=quarter/);
    const q3 = page.getByTestId('plan-group').filter({ hasText: t.q3 });
    await expect(q3.getByTestId('plan-line-row').filter({ hasText: 'Excel' })).toHaveCount(1);

    // The budget by department: one row per department and the organization's total.
    await page.getByTestId('plan-view-budget').click();
    await expect(page).toHaveURL(/view=budget/);
    await expect(page.getByTestId('plan-budget-row').first()).toBeVisible();
    await expect(page.getByTestId('plan-budget-total')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);
  });

  test('ar: the plan reads right to left, the line popup included', async ({ page }) => {
    const t = TEXTS.ar;
    await signIn(page, 'ar');
    await page.goto(`/ar/suite/planning/cycles/${cycleId}?tab=plan`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.getByTestId('cycle-tabs').getByRole('link', { name: t.planTab }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('plan-tab')).toBeVisible();
    const excel = page.getByTestId('plan-line-row').filter({ hasText: 'Excel' });
    await expect(excel.getByTestId('plan-line-status')).toHaveText(t.inPlan);
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);
    await excel.getByTestId('plan-line-title').click();
    const popup = page.getByTestId('plan-line-dialog');
    await expect(popup).toBeVisible();
    await expect(popup.getByTestId('plan-line-needs')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await page.getByTestId('plan-view-budget').click();
    await expect(page.getByTestId('plan-budget-total')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
