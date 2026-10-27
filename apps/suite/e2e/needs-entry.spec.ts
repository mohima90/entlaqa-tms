import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { afterSignIn, fillSignIn } from './sign-in';

/**
 * Department needs (WP-LD-01, T-M3-05; FR-PLN-03, FR-MGR-05). Without a database (the default CI run): the
 * «My team's needs» list and a department page say they need one, in English and Arabic, with the
 * accessibility scan and no horizontal overflow. With data (self-hosted stack): a Department Head opens
 * their task from Home, adds a need with a named person, submits, recalls and submits again — needs
 * NEEDS_E2E_HEAD_EMAIL / NEEDS_E2E_HEAD_PASSWORD (a Department Head whose department is in the OPEN cycle,
 * with at least one person employed in it); skipped without them.
 */
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

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const TEXTS = {
  en: {
    title: "My team's training needs",
    menu: "My team's needs",
    empty: 'Nothing to enter right now',
  },
  ar: {
    title: 'احتياجات فريقي التدريبية',
    menu: 'احتياجات فريقي',
    empty: 'لا شيء لإدخاله الآن',
  },
} as const;

const CYCLE = '11111111-1111-4111-8111-111111111111';
const DEPARTMENT = '22222222-2222-4222-8222-222222222222';

for (const locale of ['en', 'ar'] as const) {
  const t = TEXTS[locale];

  test(`${locale}: the list and a department page without a database`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`/${locale}/suite/my-team/needs`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    await expect(page.getByTestId('needs-not-configured')).toBeVisible();
    await expect(page.getByText(t.empty)).toBeVisible();
    // The menu entry sits right after Home (preview: every entry).
    if (!testInfo.project.name.startsWith('mobile')) {
      await expect(page.getByRole('link', { name: t.menu }).first()).toBeAttached();
    }
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);

    await page.goto(`/${locale}/suite/my-team/needs/${CYCLE}/${DEPARTMENT}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    await expect(page.getByTestId('needs-not-configured')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

test('a malformed department address is not found', async ({ page }) => {
  const response = await page.goto('/en/suite/my-team/needs/not-a-cycle/nor-a-department');
  expect(response?.status()).toBe(404);
});

const email = process.env.NEEDS_E2E_HEAD_EMAIL ?? '';
const password = process.env.NEEDS_E2E_HEAD_PASSWORD ?? '';

test.describe('a Department Head enters, submits and recalls (data journey)', () => {
  test.skip(!email || !password, 'NEEDS_E2E_HEAD_* not set');
  test.describe.configure({ mode: 'serial' });

  test('en: from the Home task card to a submitted set and back', async ({ page }) => {
    await page.goto('/en/sign-in');
    await fillSignIn(page, 'en', email, password);
    await expect(page).toHaveURL(/\/en\/suite$/, afterSignIn);
    // The task card on Home (design screen 1).
    await expect(page.getByTestId('home-needs')).toBeVisible();
    await page.getByTestId('needs-task-open').first().click();
    await expect(page).toHaveURL(/\/en\/suite\/my-team\/needs\/[0-9a-f-]+\/[0-9a-f-]+$/);
    await expect(page.getByTestId('needs-stats')).toBeVisible();

    // Add a need: topic, seats, one named person (the number follows the names).
    await page.getByTestId('need-add').or(page.getByTestId('need-add-first')).first().click();
    const panel = page.getByTestId('need-panel');
    await expect(panel).toBeVisible();
    await panel.getByTestId('need-topic').fill('E2E — customer service by phone');
    await panel.getByTestId('need-count').fill('3');
    const firstPerson = panel.getByTestId('need-people').getByRole('checkbox').first();
    await firstPerson.check();
    await expect(panel.getByTestId('need-chosen')).toContainText('1');
    await panel.getByTestId('need-cost').fill('1200');
    await panel.getByTestId('need-save').click();
    await expect(panel).toBeHidden();
    await expect(
      page.getByTestId('need-row').filter({ hasText: 'E2E — customer service by phone' }),
    ).toHaveCount(1);

    // Submit with the summary, then recall.
    await page.getByTestId('needs-submit').click();
    await expect(page.getByTestId('needs-summary')).toBeVisible();
    await page.getByTestId('needs-submit-confirm').click();
    await expect(page.getByTestId('needs-submitted')).toBeVisible();
    await expect(page.getByTestId('needs-header-status')).toHaveText('Submitted');
    await page.getByTestId('needs-recall').click();
    await page.getByTestId('needs-recall-confirm').click();
    await expect(page.getByTestId('needs-header-status')).toHaveText('Draft');

    // Clean up: remove the need added by the test.
    const row = page.getByTestId('need-row').filter({ hasText: 'E2E — customer service by phone' });
    await row.getByTestId('need-remove').click();
    await page.getByTestId('need-remove-confirm').click();
    await expect(row).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });
});
