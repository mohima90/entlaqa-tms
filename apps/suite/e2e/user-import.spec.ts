import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
import { type Download, type Page, expect, test } from '@playwright/test';
import { signInToSuite } from './sign-in';

/**
 * Bulk user import (T-M2-12, FR-IAM-04; approved import screens 1–13) against a configured deployment:
 * runs in the self-hosted smoke (infra/docker/smoke.sh, import step) after infra/docker/seed-users.sql,
 * signed in as the provisioned Organization Admin, with the workers and the malware scanner running.
 * The browser uploads straight to Storage (the gateway's self-signed certificate: ignoreHTTPSErrors) and
 * downloads the review's list of problems and the error report from there. Skipped in the default CI run
 * (no Auth server, no data). smoke.sh then checks the database, the audit trail and the e-mails.
 */
const email = process.env.SIGNED_IN_E2E_EMAIL;
const password = process.env.SIGNED_IN_E2E_PASSWORD;
const run = Date.now().toString(36);
/** Scanning, reading and the dry run are background jobs: generous waits, still bounded. */
const WORKER_WAIT = 150_000;

test.use({ ignoreHTTPSErrors: true });

/** The shared sign-in of the smoke journeys (its longer wait for the page after a sign-in, T-M2-11). */
function signIn(page: Page) {
  return signInToSuite(page, email, password);
}

async function expectNoSeriousA11yViolations(page: Page) {
  // After an in-app navigation (router.replace + refresh) the framework swaps the page's <title> while the
  // new tree streams in: check the page once it has its title again (and fail if it never gets one).
  await expect(page).toHaveTitle(/\S/);
  // From the top of the page: the sticky bars may overlap content at other scroll positions.
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

/** A CSV as spreadsheet programs save it: UTF-8 with a BOM, CRLF line ends, quotes where needed. */
function csv(rows: readonly (readonly string[])[]): Buffer {
  const cell = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return Buffer.from(
    `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`,
    'utf8',
  );
}

/**
 * The name a download is saved under, from its link's `download` parameter (Storage turns it into the
 * Content-Disposition). Not `suggestedFilename()`: headless Chromium in a container without a UTF-8
 * locale names every non-ASCII download "download".
 */
function savedName(download: Download): string {
  return new URL(download.url()).searchParams.get('download') ?? '';
}

async function downloadedText(download: Download): Promise<string> {
  const path = await download.path();
  return readFile(path, 'utf8');
}

/**
 * The worksheet XML of a downloaded report (XLSX, security review L2): the ZIP's local entries, as our
 * writer stores them (sizes in the local headers, stored or deflated).
 */
async function reportSheet(download: Download): Promise<string> {
  const zip = await readFile(await download.path());
  for (let at = 0; at + 30 <= zip.length && zip.readUInt32LE(at) === 0x04034b50;) {
    const method = zip.readUInt16LE(at + 8);
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const extraLength = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength + extraLength;
    const data = zip.subarray(start, start + size);
    if (name === 'xl/worksheets/sheet1.xml') {
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    at = start + size;
  }
  throw new Error('no worksheet in the report');
}

/** The Pending invites rows: table rows on wider screens, one card each on phones (redesign package 3). */
const invitationRows = (page: Page) =>
  page
    .locator('[data-testid="invitation-row"], [data-testid="invitations-cards"] > li')
    .filter({ visible: true });

/** Upload on step 1, then wait (the page refreshes itself) for the mapping of step 2. */
async function upload(page: Page, name: string, content: Buffer) {
  // The page's Content-Security-Policy, as the app serves it to this browser.
  const csp = (await page.request.get(page.url())).headers()['content-security-policy'] ?? '';
  const put = page.waitForRequest((request) => request.method() === 'PUT');
  await page.getByTestId('import-file-input').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: content,
  });
  // The browser PUTs the file straight to Storage's public origin (STORAGE_PUBLIC_URL): connect-src
  // allows exactly that origin, never a wildcard (T-M2-12 × T-M2-18).
  const storageOrigin = new URL((await put).url()).origin;
  const connectSrc = csp
    .split(';')
    .map((directive) => directive.trim().split(/\s+/))
    .find(([name]) => name === 'connect-src');
  expect(connectSrc).toContain(storageOrigin);
  expect(connectSrc?.some((source) => source.includes('*'))).toBe(false);
  await expect(page).toHaveURL(/\/suite\/admin\/users\/import\/[0-9a-f-]{36}$/, {
    timeout: 60_000,
  });
  await expect(page.getByTestId('mapping-form')).toBeVisible({ timeout: WORKER_WAIT });
}

test.describe('bulk user import', () => {
  test.skip(!email || !password, 'SIGNED_IN_E2E_* not set');
  // One import at a time per organization: the journeys run one after the other.
  test.describe.configure({ mode: 'serial' });

  test('English: template, upload, mapping, review with problems, confirmation with options, run, report, undo', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await signIn(page);
    await page.goto('/en/suite/admin/users');
    await page.getByTestId('import-users-link').click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/users\/import$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import users from a file');
    await expectNoSeriousA11yViolations(page);

    // The template (English headers, CSV): an attachment with the column headers.
    await page.getByTestId('import-template').getByRole('radio', { name: 'English' }).check();
    const templateDownload = page.waitForEvent('download');
    await page.getByTestId('template-csv').click();
    const template = await templateDownload;
    expect(template.suggestedFilename()).toBe('user-import-template.csv');
    const templateText = await downloadedText(template);
    // English is the organization's default language: its name columns come first (PO 17 Oct 2026).
    expect(templateText.startsWith('\uFEFFWork email,First name (English),')).toBe(true);

    // The file: one new person, one existing member, and rows the review refuses — an incomplete
    // e-mail (with a cell a spreadsheet would run as a formula), a privileged role, an e-mail twice.
    const added = `import-en-new-${run}@sovereign.example`;
    const twice = `import-en-twice-${run}@sovereign.example`;
    const file = csv([
      [
        'Work email',
        'First name (Arabic)',
        'Family name (Arabic)',
        'First name (English)',
        'Family name (English)',
        'Department',
        'Primary role',
        'Preferred language',
      ],
      [added, 'سلمان', 'العتيبي', 'Salman', 'Alotaibi', 'ACD', 'Learner', 'English'],
      ['not-an-email', '=1+2', 'الحربي', '', '', '', 'Learner', ''],
      ['sample.sara@sovereign.example', 'سارة', 'القحطاني', 'Sara', 'Alqahtani', '', '', ''],
      [
        `import-en-admin-${run}@sovereign.example`,
        'فهد',
        'الغامدي',
        '',
        '',
        '',
        'Organization Admin',
        '',
      ],
      [twice, 'ريم', 'السبيعي', '', '', '', '', ''],
      [twice, 'ريما', 'السبيعي', '', '', '', '', ''],
    ]);
    await upload(page, `staff-en-${run}.csv`, file);
    // Redesign package 3: a focused frame — the step bar on top, the step's own heading.
    await expect(page.getByTestId('import-stepper')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Column mapping');
    await expect(page.getByTestId('mapping-table')).toContainText('Work email');
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('mapping-next').click();

    // Step 3: the review (dry run) with counts, grouped reasons and the list of problems.
    await expect(page.getByTestId('review')).toBeVisible({ timeout: WORKER_WAIT });
    await expect(page.getByTestId('review-count-new')).toHaveText('1');
    await expect(page.getByTestId('review-count-existing')).toHaveText('1');
    await expect(page.getByTestId('review-count-errors')).toHaveText('4');
    await expect(page.getByTestId('review-table')).toContainText(
      'The email address is incomplete.',
    );
    await expectNoSeriousA11yViolations(page);
    const problemsDownload = page.waitForEvent('download');
    await page.getByTestId('download-review').click();
    const problemsFile = await problemsDownload;
    expect(savedName(problemsFile)).toMatch(/^(problems|قائمة-المشكلات)-staff-en-.*\.xlsx$/);
    const problems = await reportSheet(problemsFile);
    // Formula injection (TM-0003 T-IAM-19, security review L2): the value as it was, as an inline
    // string — never a formula cell.
    expect(problems).toContain('t="inlineStr"');
    expect(problems).toContain('<t xml:space="preserve">=1+2</t>');
    expect(problems).not.toMatch(/<f[ >]/);
    expect(problems).toContain('The email address is incomplete.');

    // The count tiles filter the rows (they replace the tabs).
    await page
      .getByTestId('review-counts')
      .getByRole('link', { name: /Errors/ })
      .click();
    await expect(page).toHaveURL(/view=errors/);
    await expect(
      page.getByTestId('review-counts').getByRole('link', { name: /Errors/ }),
    ).toHaveAttribute('aria-current', 'page');

    // Step 4: the confirmation with the options inside it (existing people skipped, invitations sent).
    await page.getByTestId('review-next').click();
    await expect(page.getByTestId('confirm')).toBeVisible();
    await expect(page.locator('#existing-skip')).toBeChecked();
    await expect(page.locator('#invitations-send')).toBeChecked();
    await expect(page.getByTestId('confirm-statements')).toContainText('1 new person');
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('start-import').click();

    // The run, then the result with the error report.
    await expect(page.getByTestId('import-result')).toBeVisible({ timeout: WORKER_WAIT });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The import finished');
    await expect(page.getByTestId('result-added')).toHaveText('1');
    await expect(page.getByTestId('result-failed')).toHaveText('4');
    await expectNoSeriousA11yViolations(page);
    const reportDownload = page.waitForEvent('download');
    await page.getByTestId('download-report').click();
    const report = await reportDownload;
    expect(savedName(report)).toMatch(/^(error-report|تقرير-الأخطاء)-staff-en-.*\.xlsx$/);
    const reportText = await reportSheet(report);
    expect(reportText).toContain('<t xml:space="preserve">=1+2</t>');
    expect(reportText).not.toMatch(/<f[ >]/);
    // Headers in the importer's preferred language; every reason in Arabic and English.
    expect(reportText).toContain('The email address is incomplete.');
    expect(reportText).toContain('البريد الإلكتروني غير مكتمل.');

    // The new person is on the invited tab, invited by this import.
    await page.goto('/en/suite/admin/users?tab=invited');
    const row = invitationRows(page).filter({ hasText: added });
    await expect(row).toContainText('From an import on');

    // Undo: the dialog says what happens; the person and the invitation are removed.
    await page.goBack();
    await page.getByTestId('undo-import').click();
    await expect(page.getByTestId('undo-dialog')).toContainText('1 person this import added');
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeFocused();
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('undo-confirm').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The import was undone', {
      timeout: WORKER_WAIT,
    });
    // As if never added: no tab, search or count shows the person…
    for (const tab of ['all', 'invited', 'deactivated']) {
      await page.goto(`/en/suite/admin/users?tab=${tab}&q=${encodeURIComponent(added)}`);
      await expect(page.getByTestId('users-empty')).toBeVisible();
    }
    // …and the address can be invited again by hand (a new record).
    await page.goto('/en/suite/admin/users/invite');
    const form = page.getByTestId('invite-user');
    await form.locator('#invite-email').fill(added);
    await form.locator('#invite-firstNameEn').fill('Salman');
    await form.locator('#invite-familyNameEn').fill('Alotaibi');
    await form.getByRole('combobox', { name: /^Role/ }).selectOption({ label: 'Employee' });
    await page.getByTestId('invite-submit').click();
    // Kawadir: the code right away; then the invited tab.
    await expect(page.getByTestId('invitation-created-panel')).toBeVisible();
    await page.goto('/en/suite/admin/users?tab=invited');
    await expect(invitationRows(page).filter({ hasText: added })).toHaveCount(1);
  });

  test('Arabic: right to left, add people without invitations, then send them', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await signIn(page);
    await page.goto('/ar/suite/admin/users/import');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('استيراد المستخدمين من ملف');
    await expectNoSeriousA11yViolations(page);

    const first = `import-ar-1-${run}@sovereign.example`;
    const second = `import-ar-2-${run}@sovereign.example`;
    const file = csv([
      [
        'البريد الإلكتروني للعمل',
        'الاسم الأول بالإنجليزية',
        'اسم العائلة بالإنجليزية',
        'الاسم الأول',
        'اسم الأب',
        'اسم العائلة',
        'الدور الأساسي',
        'اللغة المفضلة',
      ],
      [first, 'Lama', 'Almutairi', 'لمى', 'سعد', 'المطيري', 'متدرب', 'العربية'],
      [second, 'Nawaf', 'Aldossari', 'نواف', 'علي', 'الدوسري', '', ''],
    ]);

    // A cut upload (integration review M1): Storage never gets the file. The import is cancelled at once,
    // so it neither waits for its window nor counts toward the imports not yet run.
    const cutName = `مقطوع-${run}.csv`;
    await page.route('**/*', (route, request) =>
      request.method() === 'PUT' ? route.abort() : route.fallback(),
    );
    await page.getByTestId('import-file-input').setInputFiles({
      name: cutName,
      mimeType: 'text/csv',
      buffer: file,
    });
    await expect(page.getByTestId('upload-cut')).toContainText('لم يكتمل رفع الملف', {
      timeout: 60_000,
    });
    await expectNoSeriousA11yViolations(page);
    await page.unroute('**/*');
    const cutRow = page.getByTestId('recent-imports').getByRole('row').filter({ hasText: cutName });
    await expect(async () => {
      await page.reload();
      await expect(cutRow).toContainText('أُلغي', { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(cutRow.getByTestId('recent-cancel')).toHaveCount(0);

    await upload(page, `موظفو-${run}.csv`, file);
    await expect(page.getByTestId('mapping-table')).toContainText('البريد الإلكتروني للعمل');
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('mapping-next').click();

    await expect(page.getByTestId('review')).toBeVisible({ timeout: WORKER_WAIT });
    await expect(page.getByTestId('review-count-new')).toHaveText('2');
    await expect(page.getByTestId('review-count-errors')).toHaveText('0');
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('review-next').click();

    // Add the people without sending invitations now: the choice applies at once, the counts follow.
    await page.locator('#invitations-hold').check();
    await expect(page).toHaveURL(/invitations=hold/);
    await expect(page.getByTestId('confirm-statements')).toContainText('دون إرسال');
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('start-import').click();
    await expect(page.getByTestId('import-result')).toBeVisible({ timeout: WORKER_WAIT });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('انتهى الاستيراد');
    await expect(page.getByTestId('result-added')).toHaveText('2');
    await expect(page.getByTestId('result-invitations')).toContainText('لم تُرسل الدعوات');
    await expectNoSeriousA11yViolations(page);

    // The users list: a banner, and «لم تُرسل الدعوة» on the invited tab.
    await page.goto('/ar/suite/admin/users?tab=invited');
    // One «Needs your attention» line (it replaces the banners and the summary sentence).
    await expect(page.getByTestId('import-held-banner')).toContainText('دون إرسال');
    const firstRow = invitationRows(page).filter({ hasText: first });
    await expect(firstRow).toContainText('لم تُرسل الدعوة');
    await expect(firstRow).toContainText('من استيراد في');
    await expectNoSeriousA11yViolations(page);

    // One invitation from its row, then the rest from the banner.
    await firstRow.getByRole('button', { name: /^إرسال الدعوة \(/ }).click();
    await expect(page.getByRole('region', { name: 'رسائل الحالة' })).toContainText(
      'نرسل الدعوة الآن',
    );
    await expect(firstRow).toContainText(/تُرسل قريبًا|مدعو/);
    await expect(page.getByTestId('import-send-held')).toContainText('(1)');
    await page.getByTestId('import-send-held').click();
    await expect(page.getByTestId('import-held-banner')).toHaveCount(0, { timeout: 30_000 });
    const secondRow = invitationRows(page).filter({ hasText: second });
    await expect(secondRow).toContainText(/تُرسل قريبًا|مدعو/);
  });
});
