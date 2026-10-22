import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Planning cycles without a database (EP-PLN, T-M3-04; FR-PLN-02 — the default CI run): the Planning menu,
 * the cycles list (summary cards, status tabs, empty state), the new-cycle form with its checks and the
 * planning settings (default reminders, default approval chain with add / reorder / remove), in English
 * and Arabic, with the accessibility scan and no horizontal overflow at phone width. Creating, launching
 * and following a cycle needs data: planning-journey.spec.ts (self-hosted stack).
 */
async function expectNoSeriousA11yViolations(page: Page) {
  // From the top: a control scrolled under the sticky top bar would count as an overlapped touch target.
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

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const TEXTS = {
  en: {
    cycles: 'Planning cycles',
    settings: 'Planning settings',
    empty: 'No planning cycles yet',
    newTitle: 'New planning cycle',
    required: 'Fill in this field.',
    beforeStart: 'The period must end after it starts.',
    // The built-in heads step names no fixed level (guided-test feedback #3).
    defaultSteps: ['Unit heads', 'Named person', 'Named person'],
  },
  ar: {
    cycles: 'حملات حصر الاحتياجات',
    settings: 'إعدادات التخطيط',
    empty: 'لا توجد حملات حصر احتياجات بعد',
    newTitle: 'حملة حصر احتياجات جديدة',
    required: 'عبّئ هذا الحقل.',
    beforeStart: 'يجب أن تنتهي الفترة بعد بدايتها.',
    defaultSteps: ['رؤساء الوحدات', 'شخص محدد', 'شخص محدد'],
  },
} as const;

for (const locale of ['en', 'ar'] as const) {
  const t = TEXTS[locale];

  test(`${locale}: the cycles list grouped by status (redesign package 4)`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`/${locale}/suite/planning/cycles`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.cycles);
    await expect(page.getByTestId('planning-not-configured')).toBeVisible();
    // The summary cards and tabs gave way to groups (open · drafts · closed); none without cycles.
    await expect(page.getByTestId('cycles-stats')).toHaveCount(0);
    await expect(page.getByTestId('cycles-tabs')).toHaveCount(0);
    await expect(page.getByTestId('cycles-open')).toHaveCount(0);
    await expect(page.getByTestId('cycles-empty')).toContainText(t.empty);
    // The menu opens the planning pages (preview: every entry).
    // (On phones the menu is a drawer, rendered when opened.)
    if (!testInfo.project.name.startsWith('mobile')) {
      await expect(page.getByRole('link', { name: t.settings }).first()).toBeAttached();
    }
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test(`${locale}: the new-cycle form checks its fields before saving`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/${locale}/suite/planning/cycles/new`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.newTitle);
    const form = page.getByTestId('cycle-basics');
    // Suggested period (the next fiscal year) and deadline are filled in, «Shown as» the organization does.
    await expect(form.locator('#cycle-period-start')).not.toHaveValue('');
    await expect(form.locator('#cycle-deadline')).not.toHaveValue('');
    await expect(page.getByTestId('cycle-period-shown')).toBeVisible();
    await expect(page.getByTestId('cycle-deadline-shown')).toBeVisible();
    await expect(page.getByTestId('cycle-needs-form').locator('option')).toHaveCount(1);
    // The whole journey is shown: six steps, only Basics reachable before the draft exists.
    if (!testInfo.project.name.startsWith('mobile')) {
      const steps = page.getByTestId('setup-stepper').locator('ol > li');
      await expect(steps).toHaveCount(6);
      await expect(page.getByTestId('setup-stepper').locator('ol a')).toHaveCount(1);
    } else {
      await expect(page.getByTestId('step-list-short')).toBeVisible();
    }
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);

    await page.getByTestId('cycle-basics-save').click();
    await expect(form.locator('#cycle-name-en-error')).toHaveText(t.required);
    await expect(form.locator('#cycle-name-ar-error')).toHaveText(t.required);
    await form.locator('#cycle-name-en').fill('Plan 2027');
    await form.locator('#cycle-name-ar').fill('الخطة التدريبية 2027');
    const start = await form.locator('#cycle-period-start').inputValue();
    await form.locator('#cycle-period-end').fill(start);
    await page.getByTestId('cycle-basics-save').click();
    await expect(form.locator('#cycle-period-end-error')).toHaveText(t.beforeStart);
    await expect(form.locator('#cycle-name-en-error')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test(`${locale}: planning settings edit the default chain and reminders`, async ({ page }) => {
    await page.goto(`/${locale}/suite/planning/settings`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.settings);
    const chain = page.getByTestId('approval-chain');
    const steps = chain.getByTestId('chain-step');
    await expect(steps).toHaveCount(3);
    for (const [index, kind] of t.defaultSteps.entries()) {
      await expect(steps.nth(index)).toContainText(kind);
    }
    // Reminders are chips; the save bar shows only once something changed.
    await expect(page.getByTestId('reminder-day')).toHaveCount(2);
    await expect(page.getByTestId('save-bar')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);

    await page.getByTestId('chain-add-step').click();
    await expect(steps).toHaveCount(4);
    await expect(page.getByTestId('save-bar')).toBeVisible();
    await steps.nth(3).getByTestId('chain-step-remove').click();
    await expect(steps).toHaveCount(3);
    await expect(page.getByTestId('save-bar')).toHaveCount(0);
    await page.locator('#reminder-new').fill('14');
    await page.getByTestId('reminder-add').click();
    await expect(page.getByTestId('reminder-day')).toHaveCount(3);
    await expect(page.getByTestId('save-bar')).toBeVisible();
    // A repeated day is caught when it is added, before anything is sent.
    await page.locator('#reminder-new').fill('7');
    await page.getByTestId('reminder-add').click();
    await expect(page.locator('#reminders-error')).toBeVisible();
    await expect(page.getByTestId('reminder-day')).toHaveCount(3);
    await expectNoSeriousA11yViolations(page);
    // Discard brings the saved settings back.
    await page
      .getByTestId('save-bar')
      .getByRole('button', { name: locale === 'en' ? 'Discard changes' : 'تجاهل التغييرات' })
      .click();
    await expect(page.getByTestId('reminder-day')).toHaveCount(2);
    await expect(page.getByTestId('save-bar')).toHaveCount(0);
  });
}

test('a cycle that is not a UUID is not found', async ({ page }) => {
  expect((await page.goto('/en/suite/planning/cycles/not-a-cycle'))?.status()).toBe(404);
});
