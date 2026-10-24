import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { afterSignIn, fillSignIn, signInToSuite } from './sign-in';

/**
 * Plans, limits and the organization's status (WP-ADM-06; FR-ADM-13, FR-SUB-01, FR-ADM-17).
 *
 * Always (default CI, no Auth server): the console's Plans page and an organization's page do not exist for a
 * visitor — 404 in both languages; the paused page sends a visitor to sign-in; the Subscription page renders
 * its preview in both languages without serious accessibility violations.
 * Against a configured deployment: the Organization Admin (SIGNED_IN_E2E_*) sees the Subscription page; the
 * Super Admin (PLATFORM_E2E_*, the self-hosted stack only — it creates plans and changes an organization)
 * creates a plan, edits it, and puts an organization on it as a 30-day trial.
 */
const superEmail = process.env.PLATFORM_E2E_EMAIL;
const superPassword = process.env.PLATFORM_E2E_PASSWORD;
const memberEmail = process.env.SIGNED_IN_E2E_EMAIL;
const memberPassword = process.env.SIGNED_IN_E2E_PASSWORD;
const run = Date.now().toString(36);
/** Only the self-hosted stack on this machine (never production or a preview: they share its database). */
const selfHostedStack =
  process.env.E2E_SELF_HOSTED === '1' &&
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(process.env.E2E_BASE_URL ?? '');

async function expectNoSeriousA11yViolations(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test.describe('plans: deny by default', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`/${locale}/platform/plans and an organization's page are 404 for a visitor`, async ({
      page,
    }) => {
      expect((await page.goto(`/${locale}/platform/plans`))?.status()).toBe(404);
      await expect(page.getByTestId('plans-table')).toHaveCount(0);
      await expect(page.getByTestId('plan-new')).toHaveCount(0);
      const organization = `/${locale}/platform/organizations/a0000000-0000-4000-8000-000000000001`;
      expect((await page.goto(organization))?.status()).toBe(404);
      await expect(page.getByTestId('organization-plan-form')).toHaveCount(0);
    });
  }

  test('a member of an organization gets 404 too', async ({ page }) => {
    test.skip(!memberEmail || !memberPassword, 'SIGNED_IN_E2E_* not set');
    await signInToSuite(page, memberEmail, memberPassword);
    expect((await page.goto('/en/platform/plans'))?.status()).toBe(404);
  });
});

test.describe('subscription: the Organization Admin reads the plan', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`${locale}: the page renders (preview without data, or the plan when signed in)`, async ({
      page,
    }) => {
      if (memberEmail && memberPassword) await signInToSuite(page, memberEmail, memberPassword);
      await page.goto(`/${locale}/suite/admin/subscription`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        locale === 'ar' ? 'الاشتراك' : 'Subscription',
      );
      if (memberEmail && memberPassword) {
        // The Organization Admin: the plan card and the features (an organization on no plan has them all).
        await expect(page.getByTestId('plan-card')).toBeVisible();
        await expect(page.getByTestId('plan-features')).toBeVisible();
      }
      await expectNoSeriousA11yViolations(page);
    });
  }

  test('the paused page sends a visitor to sign-in', async ({ page }) => {
    test.skip(!process.env.E2E_BASE_URL && !memberEmail, 'needs a configured deployment');
    await page.goto('/en/paused');
    await expect(page).toHaveURL(/\/en\/sign-in/);
  });
});

test.describe('plans: the Super Admin (configured deployment)', () => {
  test.skip(
    !selfHostedStack,
    'creates plans and changes an organization: the self-hosted stack only (E2E_SELF_HOSTED=1, E2E_BASE_URL on localhost)',
  );
  test.skip(!superEmail || !superPassword, 'PLATFORM_E2E_* not set');
  test.describe.configure({ mode: 'serial' });

  test('creates a plan, edits it, and puts a new organization on it as a 30-day trial', async ({
    page,
  }, testInfo) => {
    const project = testInfo.project.name.startsWith('mobile') ? 'm' : 'd';
    const name = `E2E plan ${project}-${run}`;
    await page.goto('/en/sign-in');
    await fillSignIn(page, 'en', superEmail ?? '', superPassword ?? '');
    await expect(page).toHaveURL(/\/en\/platform$/, afterSignIn);

    // Plans → New plan: 50 people, 5 GB, every feature but own branding.
    await page.goto('/en/platform/plans');
    await page.getByTestId('plan-new').click();
    const panel = page.getByTestId('plan-panel');
    await expect(panel).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await panel.getByTestId('plan-name').fill(name);
    await panel.getByTestId('plan-maxPeople').fill('0');
    await panel.getByTestId('plan-save').click();
    // Refused before sending: a limit is a whole number from 1 (or empty for none).
    await expect(panel.getByTestId('plan-maxPeople')).toHaveAttribute('aria-invalid', 'true');
    await panel.getByTestId('plan-maxPeople').fill('50');
    await panel.getByTestId('plan-maxStorageGb').fill('5');
    await panel.getByTestId('plan-feature-branding').uncheck();
    await panel.getByTestId('plan-save').click();
    await expect(panel).toBeHidden();
    const row = page
      .getByTestId(project === 'm' ? 'plan-card' : 'plan-row')
      .filter({ hasText: name });
    await expect(row).toContainText('50 people');
    await expect(row).toContainText('5 of 6');

    // Edit: 60 people.
    await row.getByTestId('plan-edit').click();
    await expect(panel.getByTestId('plan-name')).toHaveValue(name);
    await panel.getByTestId('plan-maxPeople').fill('60');
    await panel.getByTestId('plan-save').click();
    await expect(panel).toBeHidden();
    await expect(row).toContainText('60 people');

    // A new organization, then its page: the plan, a trial (30 days by default).
    await page.goto('/en/platform');
    const slug = `e2e-plan-${project}-${run}`;
    await page.getByTestId('create-organization').click();
    const create = page.getByTestId('create-organization-panel');
    await create.getByTestId('create-org-slug').fill(slug);
    await create.getByTestId('create-org-nameAr').fill(`منظمة ${slug}`);
    await create.getByTestId('create-org-nameEn').fill(`Organization ${slug}`);
    await create.getByTestId('create-org-adminEmail').fill(`org-admin-${slug}@example.test`);
    await create.getByTestId('create-organization-submit').click();
    await expect(page.getByTestId('organization-created-dialog')).toBeVisible();
    await page.getByTestId('organization-created-done').click();
    await page
      .locator(`[data-slug="${slug}"]`)
      .getByRole('link', { name: `Organization ${slug}` })
      .first()
      .click();
    const form = page.getByTestId('organization-plan-form');
    await expect(form).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await form.getByTestId('organization-plan-plan').selectOption({ label: name });
    await form.getByTestId('organization-plan-status').selectOption('trial');
    await expect(form.getByTestId('organization-plan-trial-ends')).not.toHaveValue('');
    await form.getByTestId('organization-plan-people-special').check();
    await form.getByTestId('organization-plan-maxPeopleOverride').fill('75');
    await form.getByTestId('organization-plan-save').click();
    await expect(page.getByTestId('organization-status')).toContainText(/Trial · \d+ days left/);
    await page.reload();
    await expect(form.getByTestId('organization-plan-plan')).toHaveValue(/.+/);
    await expect(form.getByTestId('organization-plan-maxPeopleOverride')).toHaveValue('75');
  });
});
