import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Course library without a database (T-M3-03; FR-CAT-01, FR-CAT-10 — the default CI run; redesign
 * package 4): the example courses, English and Arabic — view cards, the table (cards on phones), instant
 * search with Arabic-aware matching («اداره» finds «الإدارة الاستراتيجية») and filter pills, the course
 * panel; the Kawadir pattern (WP-UX-01 c): «Add course» as one popup with its checks, the course's
 * Settings page (side tabs, one save bar), archive / restore from the row menu after a small confirmation;
 * no console errors, no horizontal overflow on a phone, axe clean. Saving
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
    settings: 'Settings',
    settingsTitle: 'Course settings',
    tabs: ['About the course', 'Delivery and duration', 'Participants and cost'],
    unsaved: 'You have unsaved changes.',
    keep: 'Cancel',
    archive: 'Archive',
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
    settings: 'الإعدادات',
    settingsTitle: 'إعدادات الدورة',
    tabs: ['عن الدورة', 'التقديم والمدة', 'المشاركون والتكلفة'],
    unsaved: 'لديك تغييرات لم تُحفظ.',
    keep: 'إلغاء',
    archive: 'أرشفة',
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

  test(`${locale}: «Add course» is one popup with the few fields needed now`, async ({ page }) => {
    await page.goto(`/${locale}/suite/courses`);
    const add = page.getByTestId('course-add');
    await expect(add).toHaveText(t.add);
    await add.click();
    const dialog = page.getByTestId('course-dialog');
    await expect(dialog.getByRole('heading', { name: t.addTitle })).toBeVisible();
    // The page's language is asked first (no database: no organization default) and is required; the
    // other title is optional. No code, participants or costs in the popup: they wait on the settings.
    const first = locale === 'ar' ? 'titleAr' : 'titleEn';
    const other = locale === 'ar' ? 'titleEn' : 'titleAr';
    await expect(dialog.getByTestId(`course-field-${first}`)).toHaveAttribute('required', '');
    await expect(dialog.getByTestId(`course-field-${other}`)).not.toHaveAttribute('required', '');
    await expect(dialog.getByTestId('course-field-code')).toHaveCount(0);
    await expect(dialog.getByTestId('course-field-maxParticipants')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    await dialog.getByTestId('course-save').click();
    await expect(dialog.getByText(t.required).first()).toBeVisible();
    await expect(dialog.getByTestId(`course-field-${first}`)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(dialog.getByTestId(`course-field-${other}`)).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );

    await dialog
      .getByTestId(`course-field-${first}`)
      .fill(locale === 'ar' ? 'السلامة من الحرائق' : 'Fire safety');
    await dialog.getByTestId('course-field-deliveryType').selectOption('virtual');
    await dialog.getByTestId('course-field-durationHours').fill('٦');
    await dialog.getByTestId('course-save').click();
    // Without a database the popup checks the values and saves nothing.
    await expect(dialog.getByTestId('course-form-message')).toHaveText(t.preview);

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(add).toBeFocused();
  });

  test(`${locale}: a course's panel, its settings and archive from a row`, async ({ page }) => {
    await page.goto(`/${locale}/suite/courses`);
    const wide = (page.viewportSize()?.width ?? 0) >= 768;
    const menu = (code: string) =>
      (wide ? page.getByTestId(`course-row-${code}`) : page.getByTestId('courses-cards'))
        .getByTestId(`course-menu-${code}`)
        .click();

    // The read panel: facts and cost, with Settings.
    await menu('LEAD-101');
    await page.getByTestId('course-view-LEAD-101').click();
    const view = page.getByTestId('course-panel-view');
    await expect(view).toBeVisible();
    await expect(view).toContainText(t.perSession);
    await expectNoSeriousA11yViolations(page);
    await expect(view.getByTestId('course-panel-edit')).toHaveText(t.settings);
    await page.keyboard.press('Escape');
    await expect(view).not.toBeVisible();

    // Archive asks first (a small confirmation); «Cancel» keeps the course and goes back to the menu.
    await menu('LEAD-101');
    await page.getByTestId('course-archive-LEAD-101').click();
    const confirm = page.getByTestId('course-status-dialog');
    await expect(confirm.getByRole('heading', { name: t.archiveTitle })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await confirm.getByTestId('course-status-cancel').click();
    await expect(confirm).not.toBeVisible();
    await menu('LEAD-101');
    await page.getByTestId('course-archive-LEAD-101').click();
    await expect(confirm.getByTestId('course-status-confirm')).toHaveText(t.archive);
    await confirm.getByTestId('course-status-confirm').click();
    // The preview saves nothing.
    await expect(page.getByText(t.preview)).toBeVisible();
    await expect(confirm).not.toBeVisible();
    // An archived course is restored, not edited.
    await menu('OLD-001');
    await expect(page.getByTestId('course-restore-OLD-001')).toBeVisible();
    await expect(page.getByTestId('course-edit-OLD-001')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // «Settings» in the row menu opens the course's own page.
    await menu('LEAD-101');
    await page.getByTestId('course-edit-LEAD-101').click();
    await expect(page).toHaveURL(/\/suite\/courses\/[0-9a-f-]+\/settings$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test(`${locale}: a course's settings — side tabs, one save bar, the checks`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    // LEAD-101 of the example library.
    const settings = `/${locale}/suite/courses/00000000-0000-4000-8000-00000000c001/settings`;
    await page.goto(settings);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByTestId('course-settings-title')).toContainText(
      locale === 'ar' ? 'الإدارة الاستراتيجية' : 'Strategic management',
    );
    const tabs = page.getByTestId('course-settings-tabs');
    await expect(tabs.getByRole('link')).toHaveText([...t.tabs]);
    await expect(tabs.getByRole('link', { name: t.tabs[0] })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByTestId('course-field-code')).toHaveValue('LEAD-101');
    // No save bar until something changes.
    await expect(page.getByTestId('save-bar')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    await page.getByTestId('course-field-code').fill('LEAD 101');
    await expect(page.getByTestId('save-bar-message')).toHaveText(t.unsaved);
    await page.getByTestId('save-bar-save').click();
    await expect(page.getByTestId('course-field-code')).toHaveAttribute('aria-invalid', 'true');
    // «Discard changes»: back to the stored course.
    await page.getByTestId('save-bar').getByRole('button').first().click();
    await expect(page.getByTestId('course-field-code')).toHaveValue('LEAD-101');
    await expect(page.getByTestId('save-bar')).toHaveCount(0);

    // Each section is its own address.
    await tabs.getByRole('link', { name: t.tabs[2] }).click();
    await expect(page).toHaveURL(/tab=capacity/);
    await expect(page.getByTestId('course-field-estCostPerSession')).toHaveValue('15000');
    await page.getByTestId('course-field-minParticipants').fill('30');
    await page.getByTestId('save-bar-save').click();
    await expect(page.getByText(t.minAboveMax)).toBeVisible();
    await page.getByTestId('course-field-minParticipants').fill('5');
    await page.getByTestId('save-bar-save').click();
    // Without a database the form checks the values and saves nothing.
    await expect(page.getByTestId('course-form-message')).toHaveText(t.preview);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}
