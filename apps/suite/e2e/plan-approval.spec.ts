import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { afterSignIn, fillSignIn } from './sign-in';

/**
 * Approving the training plan (WP-LD-03, T-M3-07; FR-PLN-08, FR-WFL-01/02 R1 part; approved screens
 * docs/design/screens/m3-consolidation-approval/README.md 4–6b). Without a database (the default CI run): the
 * Approvals page and a plan review say they need one, and Planning settings shows «Finance confirms the plan» as a
 * switch — in English and Arabic, with the accessibility scan and no horizontal overflow. With data (the
 * self-hosted stack, infra/docker/smoke.sh, after plan-consolidation.spec.ts built the plan): the L&D Manager makes
 * the plan ready (leaves out the lines still without a cost, gives a reason for each department over its budget)
 * and submits it from its popup; an HR Manager finds it on Home, opens the review and sends it back with a
 * comment (required); the L&D Manager reads the comment and submits it again; the HR Manager approves it — in
 * Arabic, from the Approvals menu with its count; the L&D Manager sees version 1 locked and opens it from
 * «Versions». Needs PLAN_E2E_EMAIL / PLAN_E2E_PASSWORD (the L&D Manager), PLAN_E2E_CYCLE_ID (that cycle) and
 * APPROVAL_E2E_HR_EMAIL / APPROVAL_E2E_HR_PASSWORD (an HR Manager); skipped without them.
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
  test(`${locale}: Approvals, a plan review and the Finance switch without a database`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`/${locale}/suite/approvals`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByTestId('approvals-not-configured')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);

    await page.goto(`/${locale}/suite/approvals/${PREVIEW_CYCLE}`);
    await expect(page.getByTestId('approvals-not-configured')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // Planning settings: «Finance confirms the plan» is a switch, off by default; turning it on asks to save.
    await page.goto(`/${locale}/suite/planning/settings`);
    const finance = page.getByTestId('finance-confirms');
    await expect(finance).toHaveAttribute('role', 'switch');
    await expect(finance).toHaveAttribute('aria-checked', 'false');
    await finance.click();
    await expect(finance).toHaveAttribute('aria-checked', 'true');
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

const lndEmail = process.env.PLAN_E2E_EMAIL ?? '';
const lndPassword = process.env.PLAN_E2E_PASSWORD ?? '';
const cycleId = process.env.PLAN_E2E_CYCLE_ID ?? '';
const hrEmail = process.env.APPROVAL_E2E_HR_EMAIL ?? '';
const hrPassword = process.env.APPROVAL_E2E_HR_PASSWORD ?? '';

const TEXTS = {
  en: { needsCost: 'Needs a cost', approvals: 'Approvals', approved: 'Approved' },
  ar: { needsCost: 'تحتاج إلى تكلفة', approvals: 'الموافقات', approved: 'معتمد' },
} as const;

const COMMENT = 'E2E: please explain the Excel cost before I approve.';

async function signIn(page: Page, locale: 'ar' | 'en', email: string, password: string) {
  await page.goto(`/${locale}/sign-in`);
  await fillSignIn(page, locale, email, password);
  await expect(page).toHaveURL(new RegExp(`/${locale}/suite$`), afterSignIn);
}

test.describe('the plan is submitted, sent back, approved and locked (data journey)', () => {
  test.skip(
    !lndEmail || !lndPassword || !cycleId || !hrEmail || !hrPassword,
    'PLAN_E2E_* / APPROVAL_E2E_* not set',
  );
  test.describe.configure({ mode: 'serial' });

  test('en: the L&D Manager makes the plan ready and submits it', async ({ page }) => {
    await signIn(page, 'en', lndEmail, lndPassword);
    await page.goto(`/en/suite/planning/cycles/${cycleId}?tab=plan`);
    await expect(page.getByTestId('plan-tab')).toBeVisible();

    // Lines still without a cost are left out with a reason (the plan is refused while one is in it).
    for (let guard = 0; guard < 20; guard++) {
      const uncosted = page
        .getByTestId('plan-line-row')
        .filter({ has: page.getByTestId('plan-line-status').getByText(TEXTS.en.needsCost) });
      const left = await uncosted.count();
      if (left === 0) break;
      await uncosted.first().getByTestId('plan-line-menu').click();
      await page.getByTestId('plan-line-menu-leave-out').click();
      const leave = page.getByTestId('plan-leave-out-dialog');
      await leave.getByTestId('plan-leave-out-reason').fill('E2E: not costed this year.');
      await leave.getByTestId('plan-leave-out-confirm').click();
      await expect(leave).toBeHidden();
      // Wait for the refreshed list before looking again (else the same line is offered twice).
      await expect(uncosted).toHaveCount(left - 1);
    }
    // A department over its budget needs a reason.
    await page.getByTestId('plan-view-budget').click();
    for (let guard = 0; guard < 20; guard++) {
      const empty = page.locator(
        '[data-testid="plan-budget-reason"][aria-describedby$="-needed"]:visible',
      );
      if ((await empty.count()) === 0) break;
      await empty.first().fill('E2E: two new branches open this year.');
      await page.locator('[data-testid="plan-budget-reason-save"]:visible').first().click();
      await expect(page.locator('[data-testid="plan-budget-reason-save"]:visible')).toHaveCount(0);
    }

    await page.getByTestId('plan-submit').click();
    const dialog = page.getByTestId('plan-submit-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('plan-submit-who')).toBeVisible();
    await expect(dialog.getByTestId('plan-submit-problem')).toHaveCount(0);
    await expect(dialog.getByTestId('plan-submit-no-hr')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    await dialog.getByTestId('plan-submit-confirm').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('plan-waiting')).toBeVisible();
    // Frozen: no line can be ticked or changed any more.
    await expect(page.getByTestId('plan-line-select')).toHaveCount(0);
    await expect(page.getByTestId('plan-submit')).toHaveCount(0);
  });

  test('en: an HR Manager finds it on Home and sends it back with a comment', async ({ page }) => {
    await signIn(page, 'en', hrEmail, hrPassword);
    await expect(page.getByTestId('home-approvals-banner')).toBeVisible();
    await expect(page.getByTestId('home-approvals').getByTestId('approval-card')).toHaveCount(1);
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('home-approvals').getByTestId('approval-review').click();
    await expect(page).toHaveURL(new RegExp(`/en/suite/approvals/${cycleId}`));
    await expect(page.getByTestId('review-info')).toBeVisible();
    await expect(page.getByTestId('approval-steps')).toBeVisible();
    await expect(page.getByTestId('plan-budget-table')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);

    await page.getByTestId('review-send-back').click();
    const dialog = page.getByTestId('review-send-back-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('review-send-back-confirm').click();
    await expect(dialog.locator('#review-comment')).toHaveAttribute('aria-invalid', 'true');
    await dialog.getByTestId('review-comment').fill(COMMENT);
    await expectNoSeriousA11yViolations(page);
    await dialog.getByTestId('review-send-back-confirm').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('review-decided')).toBeVisible();
    await expect(page.getByTestId('review-actions')).toHaveCount(0);
  });

  test('en: the L&D Manager reads the comment and submits again', async ({ page }) => {
    await signIn(page, 'en', lndEmail, lndPassword);
    await page.goto(`/en/suite/planning/cycles/${cycleId}?tab=plan`);
    await expect(page.getByTestId('plan-sent-back-comment')).toHaveText(COMMENT);
    await page.getByTestId('plan-submit').click();
    const dialog = page.getByTestId('plan-submit-dialog');
    await dialog.getByTestId('plan-submit-confirm').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('plan-waiting')).toBeVisible();
  });

  test('ar: the HR Manager approves from the Approvals menu, right to left', async ({ page }) => {
    await signIn(page, 'ar', hrEmail, hrPassword);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('nav-count-approvals')).toBeVisible();
    await page
      .getByRole('link', { name: new RegExp(TEXTS.ar.approvals) })
      .first()
      .click();
    await expect(page).toHaveURL(/\/ar\/suite\/approvals$/);
    await expect(page.getByTestId('approvals-pending')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);
    await page.getByTestId('approvals-waiting').getByTestId('approval-review').click();
    await expect(page.getByTestId('review-actions')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);
    await page.getByTestId('review-approve').click();
    const dialog = page.getByTestId('review-approve-dialog');
    await expect(dialog).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await dialog.getByTestId('review-approve-confirm').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('review-decided')).toBeVisible();
    await expect(page.getByTestId('approval-step-hr')).toBeVisible();
  });

  test('en: version 1 is locked; «Versions» opens it read only', async ({ page }) => {
    await signIn(page, 'en', lndEmail, lndPassword);
    await page.goto(`/en/suite/planning/cycles/${cycleId}?tab=plan`);
    await expect(page.getByTestId('plan-approved')).toBeVisible();
    await expect(page.getByTestId('plan-revise')).toBeVisible();
    await expect(
      page.getByTestId('plan-line-status').filter({ hasText: TEXTS.en.approved }).first(),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('plan-versions').click();
    await page.getByTestId('plan-version-item').first().click();
    await expect(page).toHaveURL(new RegExp(`/en/suite/planning/cycles/${cycleId}/versions/1$`));
    await expect(page.getByTestId('plan-version-lines')).toBeVisible();
    await expect(page.getByTestId('plan-version-budget')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);
  });
});
