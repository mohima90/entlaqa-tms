import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { type Browser, type Page, expect, test } from '@playwright/test';
import { afterSignIn, signInToSuite } from './sign-in';

/**
 * Invitations, admin side (T-M2-07, FR-IAM-03; screens 1 and 2; Kawadir's codes, PO 16 Oct 2026) against
 * a configured deployment: runs in the self-hosted smoke (infra/docker/smoke.sh) after
 * infra/docker/seed-users.sql, signed in as the provisioned Organization Admin. Skipped in the default CI
 * run (no Auth server, no data). The e-mail itself is checked in Mailpit by smoke.sh; the code and its
 * link work without it (copy link → sign up in a fresh browser, the typed code, resend = a new code).
 */
const email = process.env.SIGNED_IN_E2E_EMAIL;
const password = process.env.SIGNED_IN_E2E_PASSWORD;
const run = Date.now().toString(36);
/** A code as shown: 12 symbols grouped XXXX-XXXX-XXXX (the link carries them without the hyphens). */
const CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const linkCode = (shown: string) => shown.replaceAll('-', '');

/** The invited users' rows: table rows on wider screens, one card each on phones (redesign package 3). */
const rowsOf = (page: Page) =>
  page
    .locator('[data-testid="invitation-row"], [data-testid="invitations-cards"] > li')
    .filter({ visible: true });
/** The toasts of the page (a polite live region). */
const toasts = (page: Page) => page.getByRole('region', { name: 'Status messages' });
/** A row's ⋯ menu entry (Copy code, Resend invitation, Revoke invitation). */
async function rowMenu(page: Page, row: ReturnType<typeof rowsOf>, name: string, entry: RegExp) {
  await row.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: entry }).click();
}
/** «Send invitation» sits in the invite panel's footer (redesign package 3). */
const sendInvitation = (page: Page, locale: 'ar' | 'en' = 'en') =>
  page
    .getByTestId('invite-panel')
    .getByRole('button', { name: locale === 'ar' ? 'إرسال الدعوة' : 'Send invitation' });

/** Invites a learner through the form and returns the code shown right away (Kawadir). */
async function inviteLearner(page: Page, invitee: string, locale: 'ar' | 'en') {
  await page.goto(`/${locale}/suite/admin/users/invite`);
  const form = page.getByTestId('invite-user');
  await form.locator('#invite-email').fill(invitee);
  // English is the organization's default language: the English names are the required ones.
  await form.locator('#invite-firstNameEn').fill('Salma');
  await form.locator('#invite-familyNameEn').fill('Alharbi');
  await form
    .getByRole('combobox', { name: locale === 'ar' ? /^الدور/ : /^Role/ })
    .selectOption({ label: locale === 'ar' ? 'موظف' : 'Employee' });
  await form.getByRole('radio', { name: locale === 'ar' ? 'العربية' : 'English' }).check();
  await sendInvitation(page, locale).click();
  const panel = page.getByTestId('invitation-created-panel');
  await expect(panel).toBeVisible();
  const code = (await panel.getByTestId('invite-code').textContent()) ?? '';
  expect(code).toMatch(CODE);
  return code;
}

/** Creates the account on the sign-up page of a FRESH browser (no admin session) and lands signed in. */
async function signUpInFreshBrowser(
  browser: Browser,
  locale: 'ar' | 'en',
  open: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await open(page);
  await expect(page.getByTestId('sign-up-code-valid')).toBeVisible();
  const secret = `Joiner-${randomUUID()}`;
  await page.locator('#invite-password').fill(secret);
  await page.locator('#invite-password-confirm').fill(secret);
  await page.getByTestId('invite-privacy').check();
  await page.getByRole('button', { name: locale === 'ar' ? /^انضم إلى / : /^Join / }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${locale}/(suite|select-organization|mfa)$`),
    afterSignIn,
  );
  await context.close();
}

async function signIn(page: Page) {
  await signInToSuite(page, email, password);
}

async function expectNoSeriousA11yViolations(page: Page) {
  // After an in-app navigation (router.replace + refresh) the framework swaps the page's <title> while the
  // new tree streams in: check the page once it has its title again (and fail if it never gets one).
  await expect(page).toHaveTitle(/\S/);
  // From the top of the page: sticky bars may overlap content at other scroll positions.
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

test.describe('invitations (admin side)', () => {
  test.skip(!email || !password, 'SIGNED_IN_E2E_* not set');
  test.describe.configure({ mode: 'serial' });

  test('English: invite in the side panel, see it on the Pending invites view, resend, revoke', async ({
    page,
  }) => {
    const invitee = `invitee-en-${run}@sovereign.example`;
    await signIn(page);
    await page.goto('/en/suite/admin/users');
    await page.getByTestId('invite-user-link').click();
    // The panel's own address; the list stays behind it.
    await expect(page).toHaveURL(/\/en\/suite\/admin\/users\/invite$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Team members');
    await expect(
      page.getByTestId('invite-panel').getByRole('heading', { name: 'Invite a user' }),
    ).toBeVisible();
    const form = page.getByTestId('invite-user');
    // AAL1 Organization Admin: privileged roles are open, no authenticator code (PO decision, 14 Oct 2026).
    await expect(form.getByTestId('privileged-locked')).toHaveCount(0);
    await expect(form.locator('#invite-role option[value="tenant_admin"]')).toBeEnabled();
    await expect(form.getByTestId('invite-notice')).toContainText('7 days');
    // One role per person (EP-ROLES): explained next to the role.
    await expect(form.locator('#invite-role-hint')).toContainText('Each person has one role');
    await expectNoSeriousA11yViolations(page);

    // Required fields are reported inline
    await sendInvitation(page).click();
    await expect(page.getByTestId('invite-message')).toBeVisible();
    await expect(form.locator('#invite-email-error')).toBeVisible();
    // The names follow the organization's default language (English; guided-test feedback #2): the
    // English first and family names are required, the Arabic ones optional behind a button.
    await expect(form.locator('#invite-firstNameEn-error')).toHaveText('This field is required.');
    await expect(form.locator('#invite-familyNameEn-error')).toHaveText('This field is required.');
    await expect(form.locator('#invite-firstNameAr')).toHaveCount(0);
    await expect(form.locator('#invite-role-error')).toHaveText('Choose a role.');

    // English names only: the invitation is created without an Arabic name.
    await form.locator('#invite-email').fill(invitee.toUpperCase());
    await form.locator('#invite-firstNameEn').fill('Noura');
    await form.locator('#invite-familyNameEn').fill('Aldossari');
    await expect(
      form.getByRole('button', { name: 'Add the name in Arabic (optional)' }),
    ).toBeVisible();
    await form.locator('#invite-employeeNumber').fill(`EMP-${run}`);
    await form
      .getByRole('combobox', { name: /^Role/ })
      .selectOption({ label: 'Training Coordinator' });
    await form.getByRole('radio', { name: 'English' }).check();
    await sendInvitation(page).click();

    // Kawadir: the code and the copy buttons right away (no e-mail needed), in the same panel.
    const panel = page.getByTestId('invitation-created-panel');
    await expect(panel.getByRole('heading', { name: 'Invitation created' })).toBeFocused();
    const code = (await panel.getByTestId('invite-code').textContent()) ?? '';
    expect(code).toMatch(CODE);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await panel.getByRole('button', { name: 'Copy invite link' }).click();
    await expect(toasts(page)).toContainText('Invitation link copied.');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(`${new URL(page.url()).origin}/en/sign-up#code=${linkCode(code)}`);
    await panel.getByRole('button', { name: 'Copy code' }).click();
    await expect(toasts(page)).toContainText('Invitation code copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    await expectNoSeriousA11yViolations(page);

    // «Invite another user» keeps the role and the language from the last invitation.
    await page.getByTestId('invite-another').click();
    await expect(page.getByTestId('invite-kept')).toBeVisible();
    await expect(form.getByRole('combobox', { name: /^Role/ })).toHaveValue('training_coordinator');
    await expect(form.locator('#invite-email')).toHaveValue('');

    // Something typed: closing asks first (as Edit details; review, 21 Oct 2026).
    await form.locator('#invite-email').fill('draft@sovereign.example');
    await page.keyboard.press('Escape');
    const discard = page.getByTestId('discard-dialog');
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: 'Keep editing' }).last().click();
    await expect(discard).toBeHidden();
    await expect(form.locator('#invite-email')).toHaveValue('draft@sovereign.example');
    await page.keyboard.press('Escape');
    await discard.getByTestId('discard-confirm').click();

    // Closing returns to the list (focus on «Invite user»); the Pending invites view shows the invitation.
    await expect(page).toHaveURL(/\/en\/suite\/admin\/users$/);
    await expect(page.getByTestId('invite-user-link')).toBeFocused();
    await page.getByRole('link', { name: /Pending invites/ }).click();
    const row = rowsOf(page).filter({ hasText: invitee });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Noura Aldossari');
    await expect(row).toContainText('Training Coordinator');
    await expect(row).toContainText('Invited');
    await expect(row).toContainText('Expires on');
    // The same code, copyable any time (Kawadir's pending-invite row) — never in the page: read when
    // copied, and audited (security review M2).
    expect(await page.content()).not.toContain(linkCode(code));
    await rowMenu(page, row, 'Noura Aldossari', /^Copy code/);
    await expect(toasts(page)).toContainText('Invitation code copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    await row.getByRole('button', { name: /^Copy invite link \(/ }).click();
    await expect(toasts(page)).toContainText('Invitation link copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(linkCode(code));
    await expectNoSeriousA11yViolations(page);

    // Resend: a new code; the old one stops working.
    await rowMenu(page, row, 'Noura Aldossari', /^Resend invitation/);
    await expect(toasts(page)).toContainText('Invitation resent with a new code.');
    await rowMenu(page, row, 'Noura Aldossari', /^Copy code/);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe(code);

    // Revoke after the red confirmation; the invitation leaves the list
    await rowMenu(page, row, 'Noura Aldossari', /^Revoke invitation/);
    const revoke = page.getByTestId('revoke-dialog');
    await expect(revoke).toContainText('The invitation link stops working immediately.');
    await revoke.getByRole('button', { name: 'Revoke invitation', exact: true }).click();
    await expect(toasts(page)).toContainText('Invitation revoked');
    await expect(rowsOf(page).filter({ hasText: invitee })).toHaveCount(0);
  });

  test('Arabic: right-to-left form, e-mail already invited, revoke', async ({ page }) => {
    const invitee = `invitee-ar-${run}@sovereign.example`;
    await signIn(page);
    await page.goto('/ar/suite/admin/users/invite');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.getByTestId('invite-panel').getByRole('heading', { name: 'دعوة مستخدم' }),
    ).toBeVisible();
    const form = page.getByTestId('invite-user');
    await expect(form.getByTestId('invite-notice')).toContainText('تبقى الدعوة صالحة 7 أيام');
    await expect(form.locator('#invite-role-hint')).toContainText('لكل شخص دور واحد');
    await expectNoSeriousA11yViolations(page);

    const invite = async () => {
      await form.locator('#invite-email').fill(invitee);
      // The English names are required (the organization's default language); the Arabic ones are
      // added with «إضافة الاسم بالعربية (اختياري)» and shown on the Arabic pages.
      await form.locator('#invite-firstNameEn').fill('Ahmed');
      await form.locator('#invite-familyNameEn').fill('Mansour');
      await form.getByRole('button', { name: 'إضافة الاسم بالعربية (اختياري)' }).click();
      await expect(form.locator('#invite-firstNameAr')).toBeFocused();
      await form.locator('#invite-firstNameAr').fill('أحمد');
      await form.locator('#invite-familyNameAr').fill('منصور');
      await form.getByRole('combobox', { name: /^الدور/ }).selectOption({ label: 'موظف' });
      await sendInvitation(page, 'ar').click();
    };
    await invite();
    const panel = page.getByTestId('invitation-created-panel');
    await expect(panel.getByRole('heading', { name: 'أُنشئت الدعوة' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'نسخ الرابط' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'نسخ الرمز' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('invite-to-list').click();
    await expect(page).toHaveURL(/\/ar\/suite\/admin\/users\?tab=invited$/);
    const row = rowsOf(page).filter({ hasText: invitee });
    await expect(row).toContainText('أحمد منصور');
    await expect(row).toContainText('مدعو');
    await expect(page.getByRole('link', { name: /الدعوات المعلّقة/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectNoSeriousA11yViolations(page);

    // The same e-mail again: refused next to the field
    await page.goto('/ar/suite/admin/users/invite');
    await invite();
    await expect(form.locator('#invite-email-error')).toContainText(
      'هذا البريد مسجّل لشخص آخر في المنشأة',
    );
    await expect(page).toHaveURL(/\/ar\/suite\/admin\/users\/invite$/);

    // Revoke (clean-up) in Arabic
    await page.goto('/ar/suite/admin/users?tab=invited');
    await row.getByRole('button', { name: 'إجراءات أخرى لـأحمد منصور' }).click();
    await page.getByRole('menuitem', { name: /^إلغاء الدعوة/ }).click();
    await page
      .getByTestId('revoke-dialog')
      .getByRole('button', { name: 'إلغاء الدعوة', exact: true })
      .click();
    await expect(toasts(page)).toContainText('أُلغيت الدعوة');
    await expect(rowsOf(page).filter({ hasText: invitee })).toHaveCount(0);
  });

  test('English: copy the link, open it in a fresh browser, sign up, signed in', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const code = await inviteLearner(page, `joiner-en-${run}@sovereign.example`, 'en');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page
      .getByTestId('invitation-created-panel')
      .getByRole('button', { name: 'Copy invite link' })
      .click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link.endsWith(`/en/sign-up#code=${linkCode(code)}`)).toBe(true);
    await signUpInFreshBrowser(browser, 'en', async (fresh) => {
      await fresh.goto(link);
      // The code came with the link: filled in, locked, gone from the address bar.
      await expect(fresh.getByTestId('sign-up-code')).toHaveValue(code);
      await expect(fresh.getByTestId('sign-up-code')).toHaveAttribute('readonly', '');
      expect(new URL(fresh.url()).hash).toBe('');
      await expect(fresh.getByRole('heading', { level: 1 })).toContainText('Join ');
      await expect(fresh.getByLabel('Sign-in email')).toHaveValue(
        `joiner-en-${run}@sovereign.example`,
      );
      await expectNoSeriousA11yViolations(fresh);
    });
  });

  test('Arabic: the code typed by hand (any case) on the sign-up page, signed in', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const code = await inviteLearner(page, `joiner-ar-${run}@sovereign.example`, 'ar');
    await signUpInFreshBrowser(browser, 'ar', async (fresh) => {
      await fresh.goto('/ar/suite');
      await expect(fresh).toHaveURL(/\/ar\/sign-in$/);
      await fresh.getByRole('link', { name: 'انضم بالرمز' }).click();
      await expect(fresh).toHaveURL(/\/ar\/sign-up$/);
      await fresh.getByTestId('sign-up-code').fill(code.toLowerCase());
      await expect(fresh.getByTestId('sign-up-code')).toHaveValue(code);
      await expect(fresh.locator('html')).toHaveAttribute('dir', 'rtl');
      await expectNoSeriousA11yViolations(fresh);
    });
  });

  test('resend: the new code opens the sign-up page, the old one no longer does', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const invitee = `joiner-resend-${run}@sovereign.example`;
    const first = await inviteLearner(page, invitee, 'en');
    await page.goto('/en/suite/admin/users?tab=invited');
    const row = rowsOf(page).filter({ hasText: invitee });
    await rowMenu(page, row, 'Salma Alharbi', /^Resend invitation/);
    await expect(toasts(page)).toContainText('new code');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await rowMenu(page, row, 'Salma Alharbi', /^Copy code/);
    await expect(toasts(page)).toContainText('Invitation code copied.');
    const second = await page.evaluate(() => navigator.clipboard.readText());
    expect(second).not.toBe(first);
    expect(second).toMatch(CODE);

    const context = await browser.newContext();
    const fresh = await context.newPage();
    // The old code (grouped as shown: the page accepts both forms) no longer opens anything.
    await fresh.goto(`/en/sign-up#code=${first}`);
    await expect(fresh.locator('#sign-up-code-error')).toHaveText(
      "This code isn't valid. Check it and try again.",
    );
    await fresh.goto(`/en/sign-up#code=${linkCode(second)}`);
    await expect(fresh.getByTestId('sign-up-code-valid')).toBeVisible();
    await context.close();
  });
});

/**
 * Organization → Structure built by an HR Manager (FR-ADM-05, T-M3-02; business flow EP-ORG; Kawadir's
 * Departments page): the Organization Admin invites an HR Manager, who signs up through the copied link and
 * maintains the structure — the levels set (people are placed: renamed only, WP-HR-01); a cost centre; a unit
 * at the top with it as default, one under it through the row menu («Add <next level>»), expand / collapse, a
 * delete refused while a unit sits under it, «Move to…» with its preview, «Move up», deactivate and delete; the
 * unit import; a branch with its address, location and own week. Everything it creates is removed again (the
 * seeded structure stays as it was).
 */
test.describe('organization structure (HR Manager)', () => {
  test.skip(!email || !password, 'SIGNED_IN_E2E_* not set');

  test('an HR Manager signs up and builds the levels and the tree', async ({ page, browser }) => {
    const hr = `hr-structure-${run}@sovereign.example`;
    await signIn(page);
    await page.goto('/en/suite/admin/users/invite');
    const form = page.getByTestId('invite-user');
    await form.locator('#invite-email').fill(hr);
    await form.locator('#invite-firstNameEn').fill('Hala');
    await form.locator('#invite-familyNameEn').fill('Resources');
    await form.getByRole('combobox', { name: /^Role/ }).selectOption({ label: 'HR Manager' });
    await form.getByRole('radio', { name: 'English' }).check();
    await sendInvitation(page).click();
    const panel = page.getByTestId('invitation-created-panel');
    await expect(panel).toBeVisible();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await panel.getByRole('button', { name: 'Copy invite link' }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());

    const context = await browser.newContext();
    const hrPage = await context.newPage();
    await hrPage.goto(link);
    await expect(hrPage.getByTestId('sign-up-code-valid')).toBeVisible();
    const secret = `Structure-${randomUUID()}`;
    await hrPage.locator('#invite-password').fill(secret);
    await hrPage.locator('#invite-password-confirm').fill(secret);
    await hrPage.getByTestId('invite-privacy').check();
    await hrPage.getByRole('button', { name: /^Join / }).click();
    await expect(hrPage).toHaveURL(/\/en\/(suite|select-organization|mfa)$/, afterSignIn);

    // The menu's Organization group offers Structure and Branches to the HR Manager.
    await hrPage.goto('/en/suite');
    await expect(
      hrPage
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Departments' }),
    ).toBeVisible();

    // Levels: the seeded Department and Section. People are placed in units, so the levels are set
    // (WP-HR-01, BR-ORG-b): no level is added or removed, a level is still renamed.
    await hrPage.goto('/en/suite/admin/structure?view=levels');
    await expect(hrPage.getByTestId('level-row-1')).toContainText('Department');
    await expect(hrPage.getByTestId('level-row-2')).toContainText('Section');
    await expect(hrPage.getByTestId('levels-locked')).toContainText('Levels are set');
    await expect(hrPage.getByTestId('level-add')).toHaveCount(0);
    await expect(hrPage.getByTestId('level-remove')).toHaveCount(0);
    const levelDialog = hrPage.getByTestId('level-dialog');
    await hrPage.getByTestId('level-row-2').getByTestId('level-rename').click();
    await levelDialog.locator('#level-nameEn').fill(`Section ${run}`);
    await levelDialog.getByTestId('level-dialog-submit').click();
    await expect(levelDialog).toBeHidden();
    await expect(hrPage.getByTestId('level-row-2')).toContainText(`Section ${run}`);
    await hrPage.getByTestId('level-row-2').getByTestId('level-rename').click();
    await levelDialog.locator('#level-nameEn').fill('Section');
    await levelDialog.getByTestId('level-dialog-submit').click();
    await expect(levelDialog).toBeHidden();
    await expect(hrPage.getByTestId('level-row-2').getByTestId('level-name')).toHaveText('Section');
    await expectNoSeriousA11yViolations(hrPage);

    // Cost centres (WP-HR-01, design screen 2): one added, used as a unit's default below, then deleted.
    const costCentre = `CC-${run}`.slice(0, 32);
    await hrPage.goto('/en/suite/admin/structure?view=costCentres');
    await hrPage.getByTestId('cost-centre-add').first().click();
    const costPanel = hrPage.getByTestId('cost-centre-dialog');
    await costPanel.locator('#cost-centre-code').fill(costCentre);
    await costPanel.locator('#cost-centre-nameEn').fill(`Sales ${run}`);
    await costPanel.getByTestId('cost-centre-dialog-submit').click();
    await expect(costPanel).toBeHidden();
    const costRow = hrPage.getByTestId(`cost-centre-row-${costCentre}`);
    await expect(costRow).toContainText('Active');
    await expectNoSeriousA11yViolations(hrPage);

    // Tree: the seeded Academy sits under Training and development.
    await hrPage.goto('/en/suite/admin/structure');
    const training = hrPage.getByTestId('unit-TRN');
    await expect(training.getByTestId('unit-ACD')).toContainText('Section');
    // «Add Department» at the top, with the new cost centre as its default.
    const top = `TOP${run}`;
    await hrPage.getByTestId('unit-add-top').click();
    const unitDialog = hrPage.getByTestId('unit-dialog');
    await expect(unitDialog.getByRole('heading', { level: 2 })).toHaveText('Add Department');
    await unitDialog.locator('#unit-nameEn').fill(`Sales ${run}`);
    await unitDialog.locator('#unit-nameAr').fill(`المبيعات ${run}`);
    // The code, head and cost centre wait under «More options» (Kawadir form, WP-FIX-02 #12).
    await unitDialog.getByTestId('unit-more').click();
    await unitDialog.locator('#unit-code').fill(top);
    await unitDialog.locator('#unit-head').selectOption({ index: 1 });
    await unitDialog
      .getByTestId('unit-cost-centre')
      .selectOption({ label: `${costCentre} · Sales ${run}` });
    await unitDialog.getByTestId('unit-dialog-submit').click();
    await unitDialog.getByTestId('unit-dialog-done').click();
    await expect(unitDialog).toBeHidden();
    const sales = hrPage.getByTestId(`unit-${top}`);
    await expect(sales.getByTestId('unit-level').first()).toHaveText('Department');
    await expect(sales).toContainText('Head:');
    // The row menu adds the next level under it.
    const child = `SUB${run}`;
    await sales.getByTestId('unit-menu').first().click();
    await hrPage.getByTestId('unit-menu-add').click();
    await expect(unitDialog.getByRole('heading', { level: 2 })).toHaveText('Add Section');
    await unitDialog.locator('#unit-nameEn').fill(`Sales team ${run}`);
    await unitDialog.locator('#unit-nameAr').fill(`فريق المبيعات ${run}`);
    await unitDialog.getByTestId('unit-more').click();
    await unitDialog.locator('#unit-code').fill(child);
    await unitDialog.getByTestId('unit-dialog-submit').click();
    await unitDialog.getByTestId('unit-dialog-done').click();
    await expect(unitDialog).toBeHidden();
    const team = sales.getByTestId(`unit-${child}`);
    await expect(team.getByTestId('unit-level')).toHaveText('Section');
    // Collapse and expand the units under Sales.
    const toggle = sales.getByTestId('unit-toggle').first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(team).toHaveCount(0);
    await toggle.click();
    await expect(team).toBeVisible();
    await expectNoSeriousA11yViolations(hrPage);

    // A unit with a unit under it is not deleted: the dialog says what is left.
    await sales.getByTestId('unit-menu').first().click();
    await hrPage.getByTestId('unit-menu-delete').click();
    const deleteDialog = hrPage.getByTestId('unit-delete-dialog');
    await expect(deleteDialog.getByTestId('unit-in-use')).toContainText('Departments under it: 1');
    await expect(deleteDialog.getByTestId('confirm-dialog-confirm')).toHaveCount(0);
    await deleteDialog.getByRole('button', { name: 'Keep the unit' }).click();
    await expect(deleteDialog).toBeHidden();

    // «Move to…» (WP-HR-01, design screens 4–5): the team moves under Training and development — only
    // units at its parent's level are offered; the preview comes first, nothing changes until «Move».
    await team.getByTestId('unit-menu').click();
    await hrPage.getByTestId('unit-menu-move').click();
    const moveDialog = hrPage.getByTestId('move-unit-dialog');
    await expect(moveDialog).toContainText('Step 1 of 2');
    await expect(moveDialog.getByTestId('move-unit-option-ACD')).toHaveCount(0);
    await moveDialog.getByTestId('move-unit-option-TRN').check();
    await moveDialog.getByTestId('move-unit-review').click();
    const preview = moveDialog.getByTestId('move-unit-preview');
    await expect(preview).toBeVisible();
    await expect(moveDialog).toContainText('Step 2 of 2');
    await expectNoSeriousA11yViolations(hrPage);
    await moveDialog.getByTestId('move-unit-confirm').click();
    await expect(moveDialog).toBeHidden();
    const moved = training.getByTestId(`unit-${child}`);
    await expect(moved).toBeVisible();
    await expect(sales.getByTestId(`unit-${child}`)).toHaveCount(0);
    // «Move up» among the units at the top: the order is everyone's.
    await sales.getByTestId('unit-menu').first().click();
    await hrPage.getByTestId('unit-menu-up').click();
    await expect(hrPage.getByText(`Sales ${run} moved.`)).toBeVisible();

    // Deactivate the team, then delete it and Sales.
    await moved.getByTestId('unit-menu').click();
    await hrPage.getByTestId('unit-menu-status').click();
    await expect(hrPage.getByTestId('unit-status-dialog')).toHaveCount(0);
    await expect(hrPage.getByTestId('toast-action')).toHaveText('Undo');
    await expect(moved.getByTestId('unit-inactive')).toHaveText('Inactive');
    await moved.getByTestId('unit-menu').click();
    await hrPage.getByTestId('unit-menu-delete').click();
    await deleteDialog.getByTestId('confirm-dialog-confirm').click();
    await expect(moved).toHaveCount(0);
    await sales.getByTestId('unit-menu').first().click();
    await hrPage.getByTestId('unit-menu-delete').click();
    await deleteDialog.getByTestId('confirm-dialog-confirm').click();
    await expect(sales).toHaveCount(0);

    // Import units (WP-HR-01, design screen 7): a file with one good row and one problem row; the check
    // writes nothing, «Import» writes the good row only.
    const imported = `IMP${run}`.slice(0, 32);
    await hrPage.goto('/en/suite/admin/structure');
    await hrPage.getByTestId('unit-import-link').click();
    await expect(hrPage).toHaveURL(/\/en\/suite\/admin\/structure\/import$/);
    await hrPage.getByTestId('unit-import-file').setInputFiles({
      name: 'units.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        `Level,Code,Name (English),Name (Arabic),Parent code,Default cost centre code\n` +
          `Department,${imported},Imported ${run},مستورد ${run},,${costCentre}\n` +
          `Section,BAD${run},Orphan,يتيم,NOPE${run},\n`,
      ),
    });
    await hrPage.getByTestId('unit-import-check').click();
    const results = hrPage.getByTestId('unit-import-results');
    await expect(results).toContainText('New: 1');
    await expect(results).toContainText('Problems: 1');
    await expect(hrPage.getByTestId('unit-import-row-3')).toContainText('Problem');
    await expectNoSeriousA11yViolations(hrPage);
    await hrPage.getByTestId('unit-import-apply').click();
    await expect(hrPage).toHaveURL(/\/en\/suite\/admin\/structure$/);
    const importedUnit = hrPage.getByTestId(`unit-${imported}`);
    await expect(importedUnit).toBeVisible();
    await importedUnit.getByTestId('unit-menu').click();
    await hrPage.getByTestId('unit-menu-delete').click();
    await deleteDialog.getByTestId('confirm-dialog-confirm').click();
    await expect(importedUnit).toHaveCount(0);
    // The cost centre is unused again: deleted.
    await hrPage.goto('/en/suite/admin/structure?view=costCentres');
    await costRow.getByTestId('cost-centre-menu').click();
    await hrPage.getByTestId('cost-centre-delete').click();
    await hrPage
      .getByTestId('cost-centre-delete-dialog')
      .getByTestId('confirm-dialog-confirm')
      .click();
    await expect(costRow).toHaveCount(0);

    // Branches (redesign package 2; WP-HR-01 screen 8): add one with its address, typed location and own
    // week (Thursday a half-day), deactivate it, Undo (Q2-9), delete it.
    const branchCode = `BR${run}`.slice(0, 32);
    await hrPage.goto('/en/suite/admin/branches');
    await hrPage.getByTestId('branch-add').click();
    const branchPanel = hrPage.getByTestId('branch-dialog');
    await branchPanel.locator('#branch-nameEn').fill(`Smoke branch ${run}`);
    await branchPanel.locator('#branch-nameAr').fill(`فرع تجريبي ${run}`);
    await branchPanel.locator('#branch-code').fill(branchCode);
    await branchPanel.locator('#branch-addressEn').fill('King Fahd Road');
    await branchPanel.locator('#branch-latitude').fill('24.7136');
    await branchPanel.locator('#branch-longitude').fill('46.6753');
    await branchPanel.getByTestId('branch-week-same').uncheck();
    await branchPanel.getByTestId('branch-day-4-endsAt').selectOption('12:00');
    await expect(branchPanel.getByTestId('branch-day-4-half')).toHaveText('Half day');
    await expectNoSeriousA11yViolations(hrPage);
    await branchPanel.getByTestId('branch-dialog-submit').click();
    await expect(branchPanel).toBeHidden();
    const branchRow = hrPage.getByTestId(`branch-row-${branchCode}`);
    await expect(branchRow).toContainText('Active');
    // Saved: the edit panel shows the location and the branch's own week.
    await branchRow.getByTestId('branch-menu').click();
    await hrPage.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(branchPanel.locator('#branch-latitude')).toHaveValue('24.7136');
    await expect(branchPanel.getByTestId('branch-week-same')).not.toBeChecked();
    await expect(branchPanel.getByTestId('branch-day-4-endsAt')).toHaveValue('12:00');
    await branchPanel.getByRole('button', { name: 'Cancel' }).click();
    await expect(branchPanel).toBeHidden();
    await branchRow.getByTestId('branch-menu').click();
    await hrPage.getByTestId('branch-status').click();
    await expect(branchRow).toContainText('Inactive');
    await hrPage.getByTestId('toast-action').filter({ hasText: 'Undo' }).click();
    await expect(branchRow).toContainText('Active');
    await expect(branchRow).not.toContainText('Inactive');
    await expect(
      hrPage.getByText('Someone changed this branch meanwhile', { exact: false }),
    ).toHaveCount(0);
    await branchRow.getByTestId('branch-menu').click();
    await hrPage.getByTestId('branch-delete').click();
    await hrPage.getByTestId('branch-delete-dialog').getByTestId('confirm-dialog-confirm').click();
    await expect(branchRow).toHaveCount(0);

    // Arabic, right to left: the levels are set; the cost centres view.
    await hrPage.goto('/ar/suite/admin/structure?view=levels');
    await expect(hrPage.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(hrPage.getByTestId('level-row-1')).toContainText('المستوى 1');
    await expect(hrPage.getByTestId('levels-locked')).toContainText('المستويات مثبتة');
    await expectNoSeriousA11yViolations(hrPage);
    await hrPage.goto('/ar/suite/admin/structure?view=costCentres');
    await expect(hrPage.getByTestId('cost-centres')).toContainText('مراكز التكلفة');
    await expectNoSeriousA11yViolations(hrPage);
    await context.close();
  });
});

/**
 * Invitations left pending for the acceptance E2E (invite-accept.spec.ts): smoke.sh passes fresh
 * addresses, then reads each e-mailed link from Mailpit (the token exists only in the e-mail). Arabic
 * invitation with the Employee role (one role per person, EP-ROLES).
 */
const pendingInvitees = (process.env.INVITE_E2E_PENDING_EMAILS ?? '').split(',').filter(Boolean);

test.describe('invitations left pending (for the acceptance E2E)', () => {
  test.skip(
    !email || !password || pendingInvitees.length === 0,
    'INVITE_E2E_PENDING_EMAILS not set',
  );

  test('invites each address through the form', async ({ page }) => {
    await signIn(page);
    for (const invitee of pendingInvitees) {
      await page.goto('/en/suite/admin/users/invite');
      const form = page.getByTestId('invite-user');
      await form.locator('#invite-email').fill(invitee);
      await form.locator('#invite-firstNameEn').fill('Reem');
      await form.locator('#invite-familyNameEn').fill('Alotaibi');
      await form.getByRole('combobox', { name: /^Role/ }).selectOption({ label: 'Employee' });
      await form.getByRole('radio', { name: 'العربية' }).check();
      await sendInvitation(page).click();
      await expect(page.getByTestId('invitation-created-panel')).toBeVisible();
      await page.goto('/en/suite/admin/users?tab=invited');
      const row = rowsOf(page).filter({ hasText: invitee });
      await expect(row).toContainText('Invited');
    }
  });
});
