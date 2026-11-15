import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { afterSignIn, fillSignIn } from './sign-in';

/**
 * From the approved plan to courses and draft sessions (WP-LD-04, T-M3-08; FR-PLN-09, FR-CAT-01, FR-SCH-01;
 * approved screens docs/design/screens/m3-plan-to-sessions/README.md). Without a database (the default CI run):
 * the cycle's «Courses and sessions» page and the Training calendar show the example plan — the Course and Draft
 * sessions columns, the filter pills, «A course for …», «Create draft sessions», the year by quarter, the list, a
 * draft's popup — in English and Arabic, with the accessibility scan and no horizontal overflow (phone too). With
 * data (the self-hosted stack, infra/docker/smoke.sh, after plan-approval.spec.ts left the plan approved as v1):
 * the L&D Manager creates the Excel line's course from the line and its draft sessions; then, in Arabic, opens the
 * calendar, changes a draft's seats, deletes a draft and creates it again from «Not drafted yet». Needs
 * PLAN_E2E_EMAIL / PLAN_E2E_PASSWORD (the L&D Manager) and PLAN_E2E_CYCLE_ID; skipped without them.
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

const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

/** The example plan's cycle and its lines (lib/plan-delivery-preview.ts). */
const PREVIEW_CYCLE = '40000000-0000-4000-8000-000000000001';
const PREVIEW_DRAFT = '90000000-0000-4000-8000-000000000001';

for (const locale of ['en', 'ar'] as const) {
  test(`${locale}: «Courses and sessions» and its popups without a database`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`/${locale}/suite/planning/cycles/${PREVIEW_CYCLE}/sessions`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByTestId('delivery-card')).toBeVisible();
    await expect(page.getByTestId('cycle-tabs')).toBeVisible();
    const rows = page.getByTestId('delivery-line-row');
    await expect(rows).toHaveCount(5);
    await expect(rows.filter({ has: page.getByTestId('delivery-drafts') })).toHaveCount(1);
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);

    // The pills filter by address: «Needs a course» keeps the two lines without a course.
    await page.getByTestId('delivery-filter-needs_course').click();
    await expect(page).toHaveURL(/show=needs_course/);
    await expect(rows).toHaveCount(2);

    // «A course for …»: filled in from the line, by its address; Cancel goes back.
    await rows.first().getByTestId('delivery-create-course').click();
    const course = page.getByTestId('line-course-dialog');
    await expect(course).toBeVisible();
    await expect(course.getByTestId('line-course-titleEn')).not.toHaveValue('');
    await expectNoSeriousA11yViolations(page);
    await course.getByTestId('line-course-mode-link').click();
    await expect(course.getByTestId('line-course-option')).toHaveCount(2);
    await course.getByTestId('line-course-cancel').click();
    await expect(course).toBeHidden();
    await expect(page).not.toHaveURL(/open=/);
    await expect(page).toHaveURL(/show=needs_course/);

    // «Create draft sessions» of the line with its course and no drafts.
    await page.getByTestId('delivery-filter-needs_sessions').click();
    await expect(rows).toHaveCount(1);
    await rows.first().getByTestId('delivery-create-sessions').click();
    const sessions = page.getByTestId('create-sessions-dialog');
    await expect(sessions).toBeVisible();
    await expect(sessions.getByTestId('create-sessions-row')).toHaveCount(1);
    await expect(sessions.getByTestId('create-sessions-all-placed')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await sessions.getByTestId('create-sessions-confirm').click();
    await expect(sessions.getByTestId('create-sessions-message')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sessions).toBeHidden();
    expect(errors).toEqual([]);
  });

  test(`${locale}: the Training calendar without a database`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`/${locale}/suite/calendar`);
    await expect(page.getByTestId('calendar-summary')).toBeVisible();
    await expect(page.getByTestId('calendar-year')).toBeVisible();
    await expect(visible(page, 'calendar-quarter')).toHaveCount(4);
    await expect(visible(page, 'calendar-draft')).toHaveCount(3);
    await expect(visible(page, 'calendar-not-drafted').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);

    // A quarter pill keeps that quarter only; the list view lists its months.
    await page.getByTestId('calendar-quarter-2').click();
    await expect(page).toHaveURL(/quarter=2/);
    await expect(visible(page, 'calendar-quarter')).toHaveCount(1);
    await expect(visible(page, 'calendar-draft')).toHaveCount(0);
    await page.goto(`/${locale}/suite/calendar?year=2027&view=list`);
    await expect(page.getByTestId('calendar-list')).toBeVisible();
    await expect(visible(page, 'calendar-draft')).toHaveCount(3);
    await expectNoSeriousA11yViolations(page);

    // A draft opens in its popup, by its address.
    await visible(page, 'calendar-draft').first().click();
    await expect(page).toHaveURL(new RegExp(`draft=${PREVIEW_DRAFT}`));
    const draft = page.getByTestId('draft-session-dialog');
    await expect(draft).toBeVisible();
    await expect(draft.getByTestId('draft-session-person').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await draft.getByTestId('draft-session-delete').click();
    await expect(page.getByTestId('draft-session-delete-dialog')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Escape');
    await draft.getByTestId('draft-session-cancel').click();
    await expect(draft).toBeHidden();
    await expect(page).not.toHaveURL(/draft=/);

    // A phone opens the list (design 4p), with the filters behind one button.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${locale}/suite/calendar`);
    await expect(page.getByTestId('calendar-list')).toBeVisible();
    await expect(page.getByTestId('calendar-year')).toBeHidden();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);
    await page.goto(`/${locale}/suite/planning/cycles/${PREVIEW_CYCLE}/sessions`);
    await expect(visible(page, 'delivery-line-card')).toHaveCount(5);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

const lndEmail = process.env.PLAN_E2E_EMAIL ?? '';
const lndPassword = process.env.PLAN_E2E_PASSWORD ?? '';
const cycleId = process.env.PLAN_E2E_CYCLE_ID ?? '';

async function signIn(page: Page, locale: 'ar' | 'en') {
  await page.goto(`/${locale}/sign-in`);
  await fillSignIn(page, locale, lndEmail, lndPassword);
  await expect(page).toHaveURL(new RegExp(`/${locale}/suite$`), afterSignIn);
}

test.describe('the approved plan gets its course and draft sessions (data journey)', () => {
  test.skip(!lndEmail || !lndPassword || !cycleId, 'PLAN_E2E_* not set');
  test.describe.configure({ mode: 'serial' });

  test('en: the L&D Manager creates the Excel line’s course and its draft sessions', async ({
    page,
  }) => {
    await signIn(page, 'en');
    await page.goto(`/en/suite/planning/cycles/${cycleId}?tab=plan`);
    await expect(page.getByTestId('delivery-card')).toBeVisible();
    await page.getByTestId('delivery-card-open').click();
    await expect(page).toHaveURL(new RegExp(`/cycles/${cycleId}/sessions`));
    const excel = page.getByTestId('delivery-line-row').filter({ hasText: 'Excel' });
    await expect(excel).toHaveCount(1);
    await expectNoSeriousA11yViolations(page);

    // The course, created from the line: what the line did not say is asked.
    await excel.getByTestId('delivery-create-course').click();
    const course = page.getByTestId('line-course-dialog');
    await expect(course).toBeVisible();
    await expect(course.getByTestId('line-course-titleEn')).toHaveValue(/Excel/);
    const type = course.getByTestId('line-course-deliveryType');
    if ((await type.inputValue()) === '') await type.selectOption('classroom');
    const hours = course.getByTestId('line-course-durationHours');
    if ((await hours.inputValue()) === '') await hours.fill('6');
    await expectNoSeriousA11yViolations(page);
    await course.getByTestId('line-course-create').click();
    await expect(course).toBeHidden();
    await expect(excel.getByTestId('delivery-course')).toContainText('created from this line');

    // Its draft sessions, as proposed.
    await excel.getByTestId('delivery-create-sessions').click();
    const sessions = page.getByTestId('create-sessions-dialog');
    await expect(sessions).toBeVisible();
    const proposed = await sessions.getByTestId('create-sessions-row').count();
    expect(proposed).toBeGreaterThan(0);
    await expect(sessions.getByTestId('create-sessions-all-placed')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await sessions.getByTestId('create-sessions-confirm').click();
    await expect(sessions).toBeHidden();
    await expect(excel.getByTestId('delivery-drafts')).toBeVisible();
    await expect(page.getByTestId('delivery-filter-sessions_created')).toContainText('1');
  });

  test('ar: the calendar shows the drafts; a draft is changed, deleted and drafted again', async ({
    page,
  }) => {
    await signIn(page, 'ar');
    await page.goto(`/ar/suite/planning/cycles/${cycleId}?tab=plan`);
    await page.getByTestId('delivery-card-calendar').click();
    await expect(page).toHaveURL(/\/ar\/suite\/calendar\?year=\d{4}/);
    const drafts = visible(page, 'calendar-draft');
    const count = await drafts.count();
    expect(count).toBeGreaterThan(0);
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);

    // One more seat on the first draft.
    await drafts.first().click();
    const draft = page.getByTestId('draft-session-dialog');
    await expect(draft).toBeVisible();
    const seats = draft.getByTestId('draft-session-seats');
    const before = Number(await seats.inputValue());
    await seats.fill(String(before + 1));
    await expectNoSeriousA11yViolations(page);
    await draft.getByTestId('draft-session-save').click();
    await expect(draft).toBeHidden();
    await expect(drafts.first()).toContainText(String(before + 1));

    // Deleted after a confirmation: the line waits under «Not drafted yet».
    await drafts.last().click();
    await expect(draft).toBeVisible();
    await draft.getByTestId('draft-session-delete').click();
    await page.getByTestId('draft-session-delete-confirm').click();
    await expect(draft).toBeHidden();
    await expect(drafts).toHaveCount(count - 1);
    const waiting = visible(page, 'calendar-not-drafted').filter({ hasText: 'Excel' });
    await expect(waiting).toHaveCount(1);

    // Drafted again from there.
    await waiting.getByTestId('calendar-create-sessions').click();
    const sessions = page.getByTestId('create-sessions-dialog');
    await expect(sessions).toBeVisible();
    await expect(sessions.getByTestId('create-sessions-row')).toHaveCount(1);
    await sessions.getByTestId('create-sessions-confirm').click();
    await expect(sessions).toBeHidden();
    await expect(drafts).toHaveCount(count);
  });
});
