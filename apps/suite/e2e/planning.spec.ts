import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Planning cycles without a database (EP-PLN, T-M3-04; the Kawadir pattern — forms standard rule 9, WP-UX-01 a /
 * T-M3-20; FR-PLN-02 — the default CI run): the Planning menu, the cycles list (the primary action in the
 * header, four summary cards that filter, the first-use empty state), the «New cycle» popup with its fields,
 * defaults and checks (also from the old address /cycles/new) and the planning settings (default reminders;
 * no approval chain any more), in English and Arabic, with the accessibility scan and no horizontal overflow
 * at phone width. Creating, editing, launching and following a cycle needs data:
 * planning-journey.spec.ts (self-hosted stack).
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
    newCycle: 'New cycle',
    newTitle: 'New planning cycle',
    cards: ['All cycles', 'Draft', 'Open', 'Closed'],
    nameRequired: 'Cycle name (English)',
    nameOther: 'Cycle name (Arabic)',
    dates: ['Plan starts', 'Plan ends', 'Needs deadline'],
    departments: 'Departments in this cycle',
    needsForm: 'Needs form',
    note: 'Approval is the same for every cycle: the HR Manager approves.',
    cancel: 'Cancel',
    create: 'Create cycle',
    required: 'Fill in this field.',
    beforeStart: 'The period must end after it starts.',
    discard: 'Discard changes',
  },
  ar: {
    cycles: 'حملات حصر الاحتياجات',
    settings: 'إعدادات التخطيط',
    empty: 'لا توجد حملات حصر احتياجات بعد',
    newCycle: 'حملة جديدة',
    newTitle: 'حملة حصر احتياجات جديدة',
    cards: ['كل الحملات', 'المسودات', 'المفتوحة', 'المغلقة'],
    nameRequired: 'اسم الحملة (بالإنجليزية)',
    nameOther: 'اسم الحملة (بالعربية)',
    dates: ['بداية الخطة', 'نهاية الخطة', 'الموعد النهائي للاحتياجات'],
    departments: 'الإدارات في هذه الحملة',
    needsForm: 'نموذج الاحتياجات',
    note: 'الاعتماد واحد في كل الحملات: يعتمد مدير الموارد البشرية الخطة',
    cancel: 'إلغاء',
    create: 'إنشاء الحملة',
    required: 'عبّئ هذا الحقل.',
    beforeStart: 'يجب أن تنتهي الفترة بعد بدايتها.',
    discard: 'تجاهل التغييرات',
  },
} as const;

for (const locale of ['en', 'ar'] as const) {
  const t = TEXTS[locale];

  test(`${locale}: the cycles list — header action, summary cards that filter, empty state`, async ({
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
    // The primary action sits in the page header.
    await expect(page.getByTestId('new-cycle')).toHaveText(t.newCycle);
    // Four summary cards, each a link with its own address; «All» is the current one.
    const cards = page.getByTestId('cycles-stats').getByRole('link');
    await expect(cards).toHaveCount(4);
    for (const [index, label] of t.cards.entries()) {
      await expect(cards.nth(index)).toContainText(label);
      await expect(cards.nth(index)).toContainText('0');
    }
    await expect(cards.nth(0)).toHaveAttribute('aria-current', 'page');
    await expect(cards.nth(1)).toHaveAttribute(
      'href',
      `/${locale}/suite/planning/cycles?status=draft`,
    );
    // No cycle yet: the empty state explains a cycle and offers the first one. The old groups are gone.
    await expect(page.getByTestId('cycles-empty')).toContainText(t.empty);
    await expect(page.getByTestId('new-cycle-empty')).toBeVisible();
    await expect(page.getByTestId('cycles-table')).toHaveCount(0);
    await expect(page.getByTestId('cycle-hero')).toHaveCount(0);
    // The menu opens the planning pages (preview: every entry).
    // (On phones the menu is a drawer, rendered when opened.)
    if (!testInfo.project.name.startsWith('mobile')) {
      await expect(page.getByRole('link', { name: t.settings }).first()).toBeAttached();
    }
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);
    // The card of a status is the current one on its address.
    await cards.nth(2).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/suite/planning/cycles\\?status=open$`));
    await expect(page.getByTestId('cycles-stat-open')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('cycles-stat-all')).not.toHaveAttribute('aria-current', 'page');
    expect(errors).toEqual([]);
  });

  test(`${locale}: «New cycle» is one centred popup that checks its fields before saving`, async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name.startsWith('mobile');
    await page.goto(`/${locale}/suite/planning/cycles`);
    const opener = page.getByTestId('new-cycle');
    await opener.click();
    const dialog = page.getByRole('dialog', { name: t.newTitle });
    await expect(dialog).toBeVisible();
    // 672 px on a desktop; the whole width (less its margin) on a phone.
    const box = await dialog.boundingBox();
    if (mobile) expect(box?.width ?? 0).toBeLessThanOrEqual(390);
    else expect(Math.round(box?.width ?? 0)).toBe(672);
    // The few fields needed now. The name of the default language (English) is required and first.
    const form = page.getByTestId('cycle-form');
    await expect(form.getByLabel(t.nameRequired)).toHaveAttribute('required', '');
    await expect(form.getByLabel(t.nameOther, { exact: true })).not.toHaveAttribute('required', '');
    await expect(form.locator('label[for="cycle-name-en"] [data-required-mark]')).toHaveText('*');
    await expect(form.locator('label[for="cycle-name-ar"] [data-required-mark]')).toHaveCount(0);
    for (const label of t.dates)
      await expect(form.getByLabel(label)).toHaveAttribute('required', '');
    await expect(form.getByText(t.departments, { exact: true })).toBeVisible();
    await expect(form.getByLabel(t.needsForm)).toBeVisible();
    await expect(page.getByTestId('cycle-dialog-note')).toContainText(t.note);
    // Sensible defaults: the suggested period (the next fiscal year) and deadline are filled in.
    await expect(form.locator('#cycle-period-start')).not.toHaveValue('');
    await expect(form.locator('#cycle-period-end')).not.toHaveValue('');
    await expect(form.locator('#cycle-deadline')).not.toHaveValue('');
    // Side by side on a desktop (the two names; the three dates), one field per row on a phone.
    const top = async (id: string) => (await form.locator(id).boundingBox())?.y ?? 0;
    const nameRows = [await top('#cycle-name-en'), await top('#cycle-name-ar')];
    const dateRows = [
      await top('#cycle-period-start'),
      await top('#cycle-period-end'),
      await top('#cycle-deadline'),
    ];
    if (mobile) {
      expect(nameRows[1]).toBeGreaterThan(nameRows[0] ?? 0);
      expect(dateRows[1]).toBeGreaterThan(dateRows[0] ?? 0);
      expect(dateRows[2]).toBeGreaterThan(dateRows[1] ?? 0);
    } else {
      expect(nameRows[1]).toBe(nameRows[0]);
      expect(new Set(dateRows).size).toBe(1);
    }
    // «Cancel», then the primary button, at the end of the popup.
    const buttons = form.getByRole('button');
    await expect(buttons.last()).toHaveText(t.create);
    await expect(form.getByTestId('cycle-form-cancel')).toHaveText(t.cancel);
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);

    await page.getByTestId('cycle-form-save').click();
    // Only the name in the organization's default language (English) is required; the Arabic name is
    // optional and stays empty here (WP-FIX-03; PO, 12 Nov 2026).
    await expect(form.locator('#cycle-name-en-error')).toHaveText(t.required);
    await expect(form.locator('#cycle-name-ar-error')).toHaveCount(0);
    await form.locator('#cycle-name-en').fill('Plan 2027');
    const start = await form.locator('#cycle-period-start').inputValue();
    await form.locator('#cycle-period-end').fill(start);
    await page.getByTestId('cycle-form-save').click();
    await expect(form.locator('#cycle-period-end-error')).toHaveText(t.beforeStart);
    await expect(form.locator('#cycle-name-en-error')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    // Escape closes the popup and focus returns to the button that opened it.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    // Opened again, it starts from the defaults (nothing typed is kept).
    await page.getByTestId('new-cycle-empty').click();
    await expect(form.locator('#cycle-name-en')).toHaveValue('');
    await page.getByTestId('cycle-form-cancel').click();
    await expect(dialog).toBeHidden();
  });

  test(`${locale}: the old «new cycle» address opens the list with the popup`, async ({ page }) => {
    await page.goto(`/${locale}/suite/planning/cycles/new`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.cycles);
    await expect(page.getByRole('dialog', { name: t.newTitle })).toBeVisible();
    // The popup's flag leaves the address: a reload does not reopen it.
    await expect(page).toHaveURL(new RegExp(`/${locale}/suite/planning/cycles$`));
    await page.reload();
    await expect(page.getByRole('dialog', { name: t.newTitle })).toBeHidden();
    // The set-up's step list is gone.
    await expect(page.getByTestId('setup-stepper')).toHaveCount(0);
  });

  test(`${locale}: planning settings keep the default reminders; the approval chain is gone`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/suite/planning/settings`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.settings);
    // Approval is the same for every cycle (EP-PLN §13): no chain to set up here any more.
    await expect(page.getByTestId('approval-chain')).toHaveCount(0);
    await expect(page.getByTestId('chain-step')).toHaveCount(0);
    // Reminders are chips; the save bar shows only once something changed.
    await expect(page.getByTestId('reminder-day')).toHaveCount(2);
    await expect(page.getByTestId('save-bar')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);

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
    await page.getByTestId('save-bar').getByRole('button', { name: t.discard }).click();
    await expect(page.getByTestId('reminder-day')).toHaveCount(2);
    await expect(page.getByTestId('save-bar')).toHaveCount(0);
  });
}

test('a cycle that is not a UUID is not found — its page and its settings', async ({ page }) => {
  expect((await page.goto('/en/suite/planning/cycles/not-a-cycle'))?.status()).toBe(404);
  expect((await page.goto('/en/suite/planning/cycles/not-a-cycle/settings'))?.status()).toBe(404);
});
