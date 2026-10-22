import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Course library without a database (T-M3-03; FR-CAT-01, FR-CAT-10 — the default CI run; redesign
 * package 4): the example courses, English and Arabic — view cards, the table (cards on phones), instant
 * search with Arabic-aware matching («اداره» finds «الإدارة الاستراتيجية») and filter pills, the course
 * panel, the add / edit side panel with its checks, archive without a confirmation; no console errors, no
 * horizontal overflow on a phone, axe clean. Saving
 * needs data: the database tests (99_course_library_*.sql) and the action tests cover who may save.
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

const TEXTS = {
  en: {
    title: 'Courses',
    add: 'Add course',
    addTitle: 'Add a course',
    save: 'Save course',
    required: 'Enter a value.',
    minAboveMax: "The minimum can't be more than the maximum.",
    preview: 'This is a preview: nothing is saved in this environment.',
    virtual: 'Virtual',
    archiveTitle: 'Archive this course?',
    perSession: 'per session',
  },
  ar: {
    title: 'الدورات',
    add: 'إضافة دورة',
    addTitle: 'إضافة دورة',
    save: 'حفظ الدورة',
    required: 'أدخل قيمة.',
    minAboveMax: 'لا يمكن أن يزيد الحد الأدنى على الحد الأقصى.',
    preview: 'هذه معاينة: لا يُحفظ أي شيء في هذه البيئة.',
    virtual: 'افتراضي',
    archiveTitle: 'أرشفة هذه الدورة؟',
    perSession: 'للجلسة',
  },
} as const;

for (const locale of ['en', 'ar'] as const) {
  const t = TEXTS[locale];

  test(`${locale}: the course library (redesign package 4)`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`/${locale}/suite/courses`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    await expect(page.getByTestId('courses-not-configured')).toBeVisible();
    // View cards (the status filter): all, active, archived.
    await expect(page.getByTestId('courses-stats')).toContainText('4');
    await expect(page.getByTestId('courses-stats')).toContainText('3');
    await expect(page.getByTestId('courses-view-all')).toHaveAttribute('aria-current', 'page');
    if ((page.viewportSize()?.width ?? 0) >= 768) {
      const table = page.getByTestId('courses-table');
      await expect(table.getByRole('row')).toHaveCount(5); // header + four example courses
      await expect(page.getByTestId('course-row-LEAD-101')).toContainText(t.perSession);
    } else {
      // Phones: one card per course.
      await expect(page.getByTestId('courses-cards').getByRole('listitem')).toHaveCount(4);
    }
    // The navigation links the page (on phones the menu is a drawer, opened from the top bar).
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      await expect(
        page.getByRole('navigation').getByRole('link', { name: t.title }).first(),
      ).toHaveAttribute('href', `/${locale}/suite/courses`);
    }
    await expectNoSeriousA11yViolations(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test(`${locale}: Arabic-aware search and filters`, async ({ page }) => {
    await page.goto(`/${locale}/suite/courses`);
    const rows = page.locator('[data-testid^="course-row-"]');
    const cards = page.getByTestId('courses-cards').getByRole('listitem');
    const wide = (page.viewportSize()?.width ?? 0) >= 768;
    const shown = wide ? rows : cards;
    // BRD FR-CAT-10 acceptance: «إدارة» (and the spelling without hamza and with heh) finds the course.
    // The search applies by itself once typing pauses (no Apply button).
    await page.getByRole('searchbox').fill('اداره');
    await expect(page).toHaveURL(/q=/);
    await expect(shown).toHaveCount(1);
    await expect(shown.first()).toContainText('LEAD-101');

    // Filter pills apply at once and stay in the address.
    await page.goto(`/${locale}/suite/courses`);
    await page.getByTestId('courses-filter-type').getByRole('button').first().click();
    await page.getByTestId('courses-filter-type').getByRole('button', { name: t.virtual }).click();
    await expect(page).toHaveURL(/type=virtual/);
    await expect(shown).toHaveCount(1);
    await expect(shown.first()).toContainText(t.virtual);

    await page.goto(`/${locale}/suite/courses?q=zzz`);
    await expect(page.getByTestId('courses-empty')).toBeVisible();
    // A malformed filter value is ignored, never an error page.
    await page.goto(`/${locale}/suite/courses?category=${encodeURIComponent("x' or 1=1")}`);
    await expect(shown).toHaveCount(4);
  });

  test(`${locale}: the add-course panel checks the values`, async ({ page }) => {
    await page.goto(`/${locale}/suite/courses`);
    const add = page.getByTestId('course-add');
    await expect(add).toHaveText(t.add);
    await add.click();
    const dialog = page.getByTestId('course-dialog');
    await expect(dialog.getByRole('heading', { name: t.addTitle })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await dialog.getByRole('button', { name: t.save }).click();
    await expect(dialog.getByText(t.required).first()).toBeVisible();
    await expect(dialog.getByTestId('course-field-code')).toHaveAttribute('aria-invalid', 'true');

    await dialog.getByTestId('course-field-code').fill('SAFE-200');
    await dialog.getByTestId('course-field-titleEn').fill('Fire safety');
    await dialog.getByTestId('course-field-titleAr').fill('السلامة من الحرائق');
    await dialog.getByTestId('course-field-durationHours').fill('٦');
    await dialog.getByTestId('course-field-minParticipants').fill('30');
    await dialog.getByTestId('course-field-maxParticipants').fill('20');
    await dialog.getByRole('button', { name: t.save }).click();
    await expect(dialog.getByText(t.minAboveMax)).toBeVisible();

    await dialog.getByTestId('course-field-minParticipants').fill('5');
    await dialog.getByTestId('course-field-category').selectOption('new');
    await expect(dialog.getByTestId('course-field-newCategoryEn')).toBeVisible();
    await dialog.getByTestId('course-field-newCategoryEn').fill('Safety');
    await dialog.getByTestId('course-field-newCategoryAr').fill('السلامة');
    await dialog.getByRole('button', { name: t.save }).click();
    // Without a database the form checks the values and saves nothing.
    await expect(dialog.getByTestId('course-form-message')).toHaveText(t.preview);

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(add).toBeFocused();
  });

  test(`${locale}: a course's panel, edit and archive from a row`, async ({ page }) => {
    await page.goto(`/${locale}/suite/courses`);
    const wide = (page.viewportSize()?.width ?? 0) >= 768;
    const menu = (code: string) =>
      (wide ? page.getByTestId(`course-row-${code}`) : page.getByTestId('courses-cards'))
        .getByTestId(`course-menu-${code}`)
        .click();

    // The read panel: facts and cost, with Edit.
    await menu('LEAD-101');
    await page.getByTestId('course-view-LEAD-101').click();
    const view = page.getByTestId('course-panel-view');
    await expect(view).toBeVisible();
    await expect(view).toContainText(t.perSession);
    await expectNoSeriousA11yViolations(page);
    await view.getByTestId('course-panel-edit').click();
    const dialog = page.getByTestId('course-dialog');
    await expect(dialog.getByTestId('course-field-code')).toHaveValue('LEAD-101');
    await expect(dialog.getByTestId('course-field-estCostPerSession')).toHaveValue('15000');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Archive without a confirmation (Undo comes with the toast); the preview saves nothing.
    await menu('LEAD-101');
    await page.getByTestId('course-archive-LEAD-101').click();
    await expect(page.getByText(t.preview)).toBeVisible();
    await expect(page.getByTestId('course-status-dialog')).toHaveCount(0);
    // An archived course is restored, not edited.
    await menu('OLD-001');
    await expect(page.getByTestId('course-restore-OLD-001')).toBeVisible();
    await expect(page.getByTestId('course-edit-OLD-001')).toHaveCount(0);
  });
}
