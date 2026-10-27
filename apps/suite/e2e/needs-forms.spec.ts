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

/** The builder's Outline / Preview tabs (below the widest screens the panes are tabs). */
async function showPane(page: Page, pane: 'outline' | 'preview') {
  const tab = page.getByTestId(`builder-tab-${pane}`);
  if (await tab.isVisible()) await tab.click();
}

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
  await showPane(page, 'outline');
  await page.getByTestId('field-add').first().click();
  // The field settings open in the inspector pane (redesign package 4: no dialog).
  const inspector = page.getByTestId('field-inspector');
  await expect(inspector).toBeVisible();
  await inspector.locator('#field-label-en').fill(values.en);
  await inspector.locator('#field-label-ar').fill(values.ar);
  await inspector.getByTestId(`field-type-${values.type}`).check({ force: true });
  for (const [en, ar] of values.options ?? []) {
    await inspector.locator('#field-option-en').fill(en);
    await inspector.locator('#field-option-ar').fill(ar);
    await inspector.getByTestId('field-option-add').click();
  }
  if (values.condition) {
    await inspector.locator('#field-condition-field').selectOption({ label: values.condition[0] });
    await inspector.locator('#field-condition-value').selectOption(values.condition[1]);
  }
  await expect(inspector.getByTestId('field-unsaved')).toBeVisible();
  await inspector.getByTestId('field-save').click();
  // Saved: the field stays open in the inspector, «All changes saved» says so (no toast per save).
  await expect(inspector.getByTestId('field-unsaved')).toHaveCount(0);
  await expect(inspector.getByTestId('field-type-change')).toBeVisible();
  await expect(page.getByTestId('builder-save-status')).toBeVisible();
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
    // Counts in words with the right plural (redesign package 4: no more «1 sections»).
    await expect(card(page, t.defaultForm)).toContainText(
      locale === 'en' ? '1 section · 9 fields' : 'قسم واحد · 9 حقول',
    );
    await expectNoSeriousA11yViolations(page);

    // Create a form from the two fixed fields: the builder opens on it.
    await page.getByTestId('needs-form-create').click();
    const dialog = page.getByTestId('needs-form-dialog');
    await expect(dialog.getByTestId('needs-form-start-blank').getByRole('radio')).toBeChecked();
    await dialog.locator('#needs-form-name-en').fill('Engineering needs');
    await dialog.locator('#needs-form-name-ar').fill('احتياجات الهندسة');
    await expectNoSeriousA11yViolations(page);
    await dialog.getByTestId('needs-form-dialog-submit').click();
    await expect(page).toHaveURL(
      new RegExp(`/${locale}/suite/planning/needs-forms/[0-9a-f-]{36}$`),
    );
    await dismissToasts(page);

    // The builder: outline, and the preview always there (a tab on smaller screens).
    await expect(page.getByTestId('needs-form-title')).toHaveText(t.newName);
    await expect(page.getByTestId('builder-save-status')).toBeVisible();
    const labels = page.getByTestId('builder-field-label');
    await expect(labels).toHaveText([t.topic, t.people]);
    // Fixed fields: no delete, no show/hide in their menu.
    await page.getByTestId('builder-field').first().getByTestId('field-menu').click();
    await expect(page.getByRole('menuitem')).toHaveCount(2);
    await page.keyboard.press('Escape');

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
    await expect(labels).toHaveText([t.topic, t.people, t.level, t.details]);
    await expect(page.getByTestId('builder-field-condition')).toHaveText(t.condition);

    // Reorder from the row menu: the details move above the dropdown.
    await page
      .getByTestId('builder-field')
      .filter({ hasText: t.details })
      .getByTestId('field-menu')
      .click();
    await page.getByRole('menuitem', { name: t.moveUp }).click();
    await expect(labels).toHaveText([t.topic, t.people, t.details, t.level]);
    await expectNoSeriousA11yViolations(page);
    // No horizontal overflow (the phone project runs at 390 px).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // The live preview (always visible): the details appear only on the «Advanced» answer; the field
    // being edited is outlined.
    await showPane(page, 'preview');
    const preview = page.getByTestId('needs-form-preview-pane');
    await expect(preview.getByLabel(t.topic, { exact: false }).first()).toBeVisible();
    await expect(preview.getByText(t.details)).toHaveCount(0);
    await preview
      .getByRole('combobox', { name: new RegExp(t.level) })
      .selectOption({ label: t.advanced });
    await expect(preview.getByText(t.details)).toBeVisible();
    await expect(preview.locator('[data-highlighted]')).toContainText(t.details);
    await preview
      .getByRole('combobox', { name: new RegExp(t.level) })
      .selectOption({ label: t.basic });
    await expect(preview.getByText(t.details)).toHaveCount(0);
    // Both languages can be checked from the same page.
    const other = locale === 'en' ? 'ar' : 'en';
    await preview.getByTestId(`preview-language-${other}`).click();
    await expect(preview.getByText(locale === 'en' ? 'المستوى' : 'Level').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // Back to the library: the new form becomes the default, then is duplicated.
    await page
      .getByRole('link', {
        name: locale === 'en' ? 'Back to needs forms' : 'العودة إلى نماذج الاحتياجات',
      })
      .click();
    await expect(card(page, t.newName)).toContainText(
      locale === 'en' ? '1 section · 4 fields' : 'قسم واحد · 4 حقول',
    );
    await card(page, t.newName).getByTestId('needs-form-menu').click();
    await page.getByTestId('needs-form-set-default').click();
    await expect(card(page, t.newName).getByText(t.defaultBadge, { exact: true })).toHaveCount(1);
    await dismissToasts(page);
    await expect(card(page, t.defaultForm).getByText(t.defaultBadge, { exact: true })).toHaveCount(
      0,
    );
    // The default form cannot be deleted: no Delete in its menu.
    await card(page, t.newName).getByTestId('needs-form-menu').click();
    await expect(page.getByTestId('needs-form-delete')).toHaveCount(0);

    // Duplicate (in the menu): the copy opens in the builder.
    await page.getByTestId('needs-form-duplicate').click();
    await expect(dialog.locator('#needs-form-name-en')).toHaveValue('Engineering needs (copy)');
    await dialog.getByTestId('needs-form-dialog-submit').click();
    await expect(page.getByTestId('needs-form-title')).toHaveText(t.copyName);
    await page
      .getByRole('link', {
        name: locale === 'en' ? 'Back to needs forms' : 'العودة إلى نماذج الاحتياجات',
      })
      .click();
    await expect(page.getByTestId('needs-form-card')).toHaveCount(3);
    await expect(card(page, t.copyName)).toContainText(
      locale === 'en' ? '1 section · 4 fields' : 'قسم واحد · 4 حقول',
    );
    await expect(card(page, t.copyName).getByText(t.defaultBadge, { exact: true })).toHaveCount(0);

    // Switching a form off can be undone from the toast (Switch on).
    await dismissToasts(page);
    await card(page, t.copyName).getByTestId('needs-form-menu').click();
    await page.getByTestId('needs-form-toggle-active').click();
    await expect(card(page, t.copyName)).toContainText(locale === 'en' ? 'Off' : 'متوقف');
    await page.getByTestId('toast-action').click();
    await expect(
      card(page, t.copyName).getByText(locale === 'en' ? 'Off' : 'متوقف', { exact: true }),
    ).toHaveCount(0);

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
