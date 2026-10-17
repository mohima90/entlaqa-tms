import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Planning → Needs forms (T-M3-10; FR-PLN-02/03) without a database (the default CI run): the library and the
 * builder work on the browser tab's preview copy with the same rules as the server, in English and Arabic —
 * the seeded default form, create a form, add a dropdown with options in both languages and a field shown on
 * one of its answers, reorder, the live preview (the condition), set the default, duplicate. The database
 * path is covered by the pgTAP suite (99_needs_forms_*), the TMS module's integration test and its
 * authorization tests.
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

const TEXTS = {
  en: {
    title: 'Needs forms',
    defaultForm: 'Default needs form',
    defaultBadge: 'Default',
    newName: 'Engineering needs',
    copyName: 'Engineering needs (copy)',
    section: 'Training needs',
    topic: 'Training topic',
    people: 'People',
    level: 'Level',
    details: 'Advanced details',
    basic: 'Basic',
    advanced: 'Advanced',
    condition: 'Shown when «Level» is «Advanced»',
    moveUp: 'Move field «Advanced details» up',
    planning: 'Planning',
  },
  ar: {
    title: 'نماذج الاحتياجات',
    defaultForm: 'نموذج الاحتياجات الافتراضي',
    defaultBadge: 'افتراضي',
    newName: 'احتياجات الهندسة',
    copyName: 'احتياجات الهندسة (نسخة)',
    section: 'الاحتياجات التدريبية',
    topic: 'موضوع التدريب',
    people: 'المشاركون',
    level: 'المستوى',
    details: 'تفاصيل المستوى المتقدم',
    basic: 'أساسي',
    advanced: 'متقدم',
    condition: 'يظهر عندما تكون إجابة «المستوى» «متقدم»',
    moveUp: 'نقل حقل «تفاصيل المستوى المتقدم» إلى الأعلى',
    planning: 'التخطيط',
  },
} as const;

/** Closes the confirmation toasts (on a phone they cover the buttons at the bottom of the screen). */
async function dismissToasts(page: Page) {
  const close = page.locator('li[data-tone] button');
  while ((await close.count()) > 0) await close.first().click();
}

const card = (page: Page, name: string) =>
  page
    .getByTestId('needs-form-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });

async function addField(
  page: Page,
  values: {
    en: string;
    ar: string;
    type: string;
    options?: [string, string][];
    condition?: [string, string];
  },
) {
  await page.getByTestId('field-add').click();
  const dialog = page.getByTestId('field-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#field-label-en').fill(values.en);
  await dialog.locator('#field-label-ar').fill(values.ar);
  await dialog.locator('#field-type').selectOption(values.type);
  for (const [en, ar] of values.options ?? []) {
    await dialog.locator('#field-option-en').fill(en);
    await dialog.locator('#field-option-ar').fill(ar);
    await dialog.getByTestId('field-option-add').click();
  }
  if (values.condition) {
    await dialog.locator('#field-condition-field').selectOption({ label: values.condition[0] });
    await dialog.locator('#field-condition-value').selectOption(values.condition[1]);
  }
  await dialog.getByTestId('field-dialog-save').click();
  await expect(dialog).toBeHidden();
  await dismissToasts(page);
}

for (const locale of ['en', 'ar'] as const) {
  const t = TEXTS[locale];

  test(`${locale}: design a needs form — create, fields with options and a condition, reorder, preview, default, duplicate`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/suite/planning/needs-forms`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    await expect(page.getByTestId('needs-forms-preview')).toBeVisible();
    // Every organization starts with the default form.
    await expect(page.getByTestId('needs-form-card')).toHaveCount(1);
    await expect(card(page, t.defaultForm).getByText(t.defaultBadge, { exact: true })).toHaveCount(
      1,
    );
    await expect(card(page, t.defaultForm)).toContainText(
      locale === 'en' ? '1 sections · 10 fields' : '1 أقسام · 10 حقول',
    );
    await expectNoSeriousA11yViolations(page);

    // Create a form: it starts with the «Training needs» section and its two fixed fields.
    await page.getByTestId('needs-form-create').click();
    const dialog = page.getByTestId('needs-form-dialog');
    await dialog.locator('#needs-form-name-en').fill('Engineering needs');
    await dialog.locator('#needs-form-name-ar').fill('احتياجات الهندسة');
    await expectNoSeriousA11yViolations(page);
    await dialog.getByTestId('needs-form-dialog-submit').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('needs-form-card')).toHaveCount(2);
    await dismissToasts(page);

    // The builder.
    await card(page, t.newName).getByTestId('needs-form-edit').click();
    await expect(page.getByTestId('needs-form-title')).toHaveText(t.newName);
    const labels = page.getByTestId('builder-field-label');
    await expect(labels).toHaveText([`${t.topic}*`, `${t.people}*`]);
    // Fixed fields: no delete, no show/hide.
    await expect(page.getByTestId('builder-field').first().getByTestId('field-delete')).toHaveCount(
      0,
    );

    await addField(page, {
      en: 'Level',
      ar: 'المستوى',
      type: 'select',
      options: [
        ['Basic', 'أساسي'],
        ['Advanced', 'متقدم'],
      ],
    });
    await addField(page, {
      en: 'Advanced details',
      ar: 'تفاصيل المستوى المتقدم',
      type: 'textarea',
      condition: [t.level, 'advanced'],
    });
    await expect(labels).toHaveText([`${t.topic}*`, `${t.people}*`, t.level, t.details]);
    await expect(page.getByTestId('builder-field-condition')).toHaveText(t.condition);

    // Reorder: the details move above the dropdown.
    await page.getByRole('button', { name: t.moveUp }).click();
    await expect(labels).toHaveText([`${t.topic}*`, `${t.people}*`, t.details, t.level]);
    await expectNoSeriousA11yViolations(page);
    // No horizontal overflow (the phone project runs at 390 px).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // The live preview: the details appear only on the «Advanced» answer.
    await page.getByTestId('needs-form-preview-open').click();
    const preview = page.getByTestId('needs-form-preview-dialog');
    await expect(preview.getByLabel(t.topic, { exact: false }).first()).toBeVisible();
    await expect(preview.getByText(t.details)).toHaveCount(0);
    await preview
      .getByRole('combobox', { name: new RegExp(t.level) })
      .selectOption({ label: t.advanced });
    await expect(preview.getByText(t.details)).toBeVisible();
    await preview
      .getByRole('combobox', { name: new RegExp(t.level) })
      .selectOption({ label: t.basic });
    await expect(preview.getByText(t.details)).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();

    // Back to the library: the new form becomes the default, then is duplicated.
    await page
      .getByRole('link', {
        name: locale === 'en' ? 'Back to needs forms' : 'العودة إلى نماذج الاحتياجات',
      })
      .click();
    await expect(card(page, t.newName)).toContainText(
      locale === 'en' ? '1 sections · 4 fields' : '1 أقسام · 4 حقول',
    );
    await card(page, t.newName).getByTestId('needs-form-set-default').click();
    await expect(card(page, t.newName).getByText(t.defaultBadge, { exact: true })).toHaveCount(1);
    await dismissToasts(page);
    await expect(card(page, t.defaultForm).getByText(t.defaultBadge, { exact: true })).toHaveCount(
      0,
    );
    // The default form cannot be deleted: no Delete on its card.
    await expect(card(page, t.newName).getByTestId('needs-form-delete')).toHaveCount(0);

    await card(page, t.newName).getByTestId('needs-form-duplicate').click();
    await expect(dialog.locator('#needs-form-name-en')).toHaveValue('Engineering needs (copy)');
    await dialog.getByTestId('needs-form-dialog-submit').click();
    await expect(page.getByTestId('needs-form-card')).toHaveCount(3);
    await expect(card(page, t.copyName)).toContainText(
      locale === 'en' ? '1 sections · 4 fields' : '1 أقسام · 4 حقول',
    );
    await expect(card(page, t.copyName).getByText(t.defaultBadge, { exact: true })).toHaveCount(0);

    // The menu has Planning → Needs forms (on a phone the menu is a drawer, shell.spec.ts covers it).
    if (test.info().project.name.startsWith('mobile')) return;
    await expect(
      page.getByRole('navigation').getByRole('link', { name: t.title, exact: true }),
    ).toHaveCount(1);
  });
}

test('names are unique: a second form with the same name is refused', async ({ page }) => {
  await page.goto('/en/suite/planning/needs-forms');
  await page.getByTestId('needs-form-create').click();
  const dialog = page.getByTestId('needs-form-dialog');
  await dialog.locator('#needs-form-name-en').fill('default NEEDS form');
  await dialog.locator('#needs-form-name-ar').fill('آخر');
  await dialog.getByTestId('needs-form-dialog-submit').click();
  await expect(dialog.getByTestId('needs-form-dialog-error')).toHaveText(
    'Another form already has this name.',
  );
  await expect(page.locator('#needs-form-name-en-error')).toHaveText(
    'Another form already has this name.',
  );
});

test('an unknown form is not found; a malformed id is a 404', async ({ page }) => {
  await page.goto('/en/suite/planning/needs-forms/00000000-0000-4000-8000-000000000000');
  await expect(page.getByTestId('needs-form-not-found')).toBeVisible();
  expect((await page.goto('/en/suite/planning/needs-forms/not-a-form'))?.status()).toBe(404);
});
