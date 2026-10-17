import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { type Browser, type Page, expect, test } from '@playwright/test';
import { afterSignIn, fillSignIn, signInToSuite } from './sign-in';

/**
 * Platform Super Admin console «مشرف المنصة» (FR-ADM-17; Kawadir ATS's /organizations; PO 16 Oct 2026).
 *
 * Always (default CI, no Auth server): /platform does not exist for a visitor — 404 in both languages.
 * Against a configured deployment (the self-hosted stack) with a Super Admin account granted by UID
 * (PLATFORM_E2E_EMAIL / PLATFORM_E2E_PASSWORD; the account has no organization): the Super Admin signs in
 * on the normal page and lands on the console, creates an organization with its Organization Admin's
 * e-mail, copies the invite link; a NEW user opens it in a fresh browser, signs up and lands in that
 * organization as its Organization Admin — in English and in Arabic. A member of an organization
 * (SIGNED_IN_E2E_*) gets 404.
 *
 * The Super Admin journey CREATES organizations: it runs only against the self-hosted stack — E2E_SELF_HOSTED=1
 * and an E2E_BASE_URL on localhost — never against production or a preview (they share the production
 * database; security review L8). Anywhere else it is skipped, whatever PLATFORM_E2E_* say.
 */
const superEmail = process.env.PLATFORM_E2E_EMAIL;
const superPassword = process.env.PLATFORM_E2E_PASSWORD;
const memberEmail = process.env.SIGNED_IN_E2E_EMAIL;
const memberPassword = process.env.SIGNED_IN_E2E_PASSWORD;
const run = Date.now().toString(36);
/** A code as shown: 12 symbols grouped XXXX-XXXX-XXXX. */
const CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
/** The link carries the 12 symbols without the grouping. */
const linkCode = (shown: string) => shown.replaceAll('-', '');
/** Only the self-hosted stack on this machine (never production or a preview: L8). */
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

test.describe('platform console: deny by default', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`/${locale}/platform is 404 for a visitor`, async ({ page }) => {
      const response = await page.goto(`/${locale}/platform`);
      expect(response?.status()).toBe(404);
      await expect(page.getByTestId('organizations-table')).toHaveCount(0);
      await expect(page.getByTestId('create-organization')).toHaveCount(0);
    });
  }

  test('a member of an organization gets 404 too', async ({ page }) => {
    test.skip(!memberEmail || !memberPassword, 'SIGNED_IN_E2E_* not set');
    await signInToSuite(page, memberEmail, memberPassword);
    const response = await page.goto('/en/platform');
    expect(response?.status()).toBe(404);
  });
});

const TEXTS = {
  en: {
    open: 'Create organization',
    submit: 'Create organization',
    copyLink: 'Copy invite link',
    linkCopied: 'Invitation link copied.',
    done: 'Done',
    pending: 'Invited, not joined yet',
    joined: 'Joined',
    newCode: 'New code',
    newCodeIssued: 'A new code was issued. The previous code no longer works.',
    adminLink: 'Organization Admin link',
  },
  ar: {
    open: 'إنشاء منظمة',
    submit: 'إنشاء المنظمة',
    copyLink: 'نسخ الرابط',
    linkCopied: 'نُسخ رابط الدعوة.',
    done: 'تم',
    pending: 'مدعو ولم ينضم بعد',
    joined: 'انضم',
    newCode: 'رمز جديد',
    newCodeIssued: 'أُصدر رمز جديد. الرمز السابق لم يعد يعمل.',
    adminLink: 'رابط مدير المنظمة',
  },
} as const;

/** The new Organization Admin opens the copied link in a FRESH browser, signs up and lands in the organization. */
async function joinAsOrganizationAdmin(
  browser: Browser,
  link: string,
  locale: 'ar' | 'en',
  organizationName: string,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.getByTestId('sign-up-code-valid')).toBeVisible();
  const secret = `OrgAdmin-${randomUUID()}`;
  await page.locator('#invite-password').fill(secret);
  await page.locator('#invite-password-confirm').fill(secret);
  await page.getByTestId('invite-privacy').check();
  await page.getByRole('button', { name: locale === 'ar' ? /^انضم إلى / : /^Join / }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/(suite|mfa)$`), afterSignIn);
  if (page.url().endsWith('/suite')) {
    await expect(page.getByTestId('tenant-context')).toContainText(organizationName);
    // The Organization Admin's set-up home (no training features, T-M2-21).
    await expect(page.getByTestId('setup-home')).toBeVisible();
  }
  // A new Organization Admin is no Super Admin.
  expect((await page.goto(`/${locale}/platform`))?.status()).toBe(404);
  await context.close();
}

test.describe('platform console: the Super Admin (configured deployment)', () => {
  test.skip(
    !selfHostedStack,
    'creates organizations: the self-hosted stack only (E2E_SELF_HOSTED=1, E2E_BASE_URL on localhost)',
  );
  test.skip(!superEmail || !superPassword, 'PLATFORM_E2E_* not set');
  // One organization per language and project: the short name must be unique.
  test.describe.configure({ mode: 'serial' });

  for (const locale of ['en', 'ar'] as const) {
    test(`${locale}: sign in → create an organization → copy the link → the new user joins as its Organization Admin`, async ({
      page,
      browser,
      context,
    }, testInfo) => {
      const t = TEXTS[locale];
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      // The normal sign-in page; a Super Admin without organizations lands on the console.
      await page.goto(`/${locale}/sign-in`);
      await fillSignIn(page, locale, superEmail ?? '', superPassword ?? '');
      await expect(page).toHaveURL(new RegExp(`/${locale}/platform$`), afterSignIn);
      await expect(page.getByTestId('platform-context')).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      const project = testInfo.project.name.startsWith('mobile') ? 'm' : 'd';
      const slug = `e2e-${locale}-${project}-${run}`;
      const nameAr = `منظمة ${slug}`;
      const nameEn = `Organization ${slug}`;
      const adminEmail = `org-admin-${slug}@example.test`;
      await page.getByRole('button', { name: t.open }).click();
      const dialog = page.getByTestId('create-organization-dialog');
      await expect(dialog).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      // Validated before sending: a short name with upper case is refused.
      await dialog.getByTestId('create-org-slug').fill('Bad Name');
      await dialog.getByTestId('create-organization-submit').click();
      await expect(dialog.getByTestId('create-org-slug')).toHaveAttribute('aria-invalid', 'true');
      await dialog.getByTestId('create-org-slug').fill(slug);
      await dialog.getByTestId('create-org-nameAr').fill(nameAr);
      await dialog.getByTestId('create-org-nameEn').fill(nameEn);
      await dialog.getByTestId('create-org-adminEmail').fill(adminEmail);
      await dialog.getByTestId('create-org-adminFirstNameAr').fill('سارة');
      await dialog.getByTestId('create-org-adminFamilyNameAr').fill('العتيبي');
      await dialog.getByTestId('create-org-locale').selectOption(locale);
      await dialog.getByRole('button', { name: t.submit }).click();

      const created = page.getByTestId('organization-created-dialog');
      await expect(created).toBeVisible();
      const code = (await created.getByTestId('invite-code').textContent()) ?? '';
      expect(code).toMatch(CODE);
      await created.getByRole('button', { name: t.copyLink }).click();
      await expect(created.getByRole('status')).toHaveText(t.linkCopied);
      const link = await page.evaluate(() => navigator.clipboard.readText());
      // APP_BASE_URL on the self-hosted stack is this origin; the link carries the 12 symbols.
      expect(link).toBe(`${new URL(page.url()).origin}/${locale}/sign-up#code=${linkCode(code)}`);
      await created.getByRole('button', { name: t.done }).click();

      const row = page.locator(`[data-testid="organization-row"][data-slug="${slug}"]`);
      await expect(row.getByTestId('org-admin-state')).toHaveText(t.pending);
      // The row action shows the same code (an audited read) and issues a new one on request.
      await row.getByRole('button', { name: new RegExp(t.adminLink) }).click();
      const invite = page.getByTestId('org-admin-invite-dialog');
      await expect(invite.getByTestId('invite-code')).toHaveText(code);
      await invite.getByRole('button', { name: t.newCode }).click();
      await expect(invite.getByTestId('org-admin-invite-message')).toHaveText(t.newCodeIssued);
      const newCode = (await invite.getByTestId('invite-code').textContent()) ?? '';
      expect(newCode).toMatch(CODE);
      expect(newCode).not.toBe(code);
      await page.keyboard.press('Escape');

      await joinAsOrganizationAdmin(
        browser,
        `${new URL(page.url()).origin}/${locale}/sign-up#code=${linkCode(newCode)}`,
        locale,
        locale === 'en' ? nameEn : nameAr,
      );
      await page.reload();
      await expect(row.getByTestId('org-admin-state')).toHaveText(t.joined);
    });
  }
});
