import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
import { type Download, type Page, expect, test } from '@playwright/test';

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

async function signIn(page: Page) {
  await page.goto('/en/sign-in');
  await page.getByLabel('Email').fill(email ?? '');
  await page.getByLabel('Password').fill(password ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/suite$/);
}

async function expectNoSeriousA11yViolations(page: Page) {
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

  test('English: template, upload, mapping, review with problems, options, run, report, undo', async ({
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
    expect(templateText.startsWith('\uFEFFWork email,First name (Arabic),')).toBe(true);

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
      ['sample.sara@sovereign.example', 'سارة', 'القحطاني', '', '', '', '', ''],
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
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import users from a file');
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

    // Step 4: options (existing people skipped, invitations sent), step 5: confirmation.
    await page.getByTestId('review-next').click();
    await expect(page.getByTestId('options-form')).toBeVisible();
    await expect(page.getByTestId('existing-skip')).toBeChecked();
    await expect(page.getByTestId('invitations-send')).toBeChecked();
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('options-next').click();
    await expect(page.getByTestId('confirm')).toBeVisible();
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
    const row = page.getByTestId('invitations-table').getByRole('row').filter({ hasText: added });
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
    await form.locator('#invite-firstNameAr').fill('سلمان');
    await form.locator('#invite-familyNameAr').fill('العتيبي');
    await form.getByRole('radio', { name: /^Learner/ }).check();
    await form.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page).toHaveURL(/\/en\/suite\/admin\/users\?tab=invited&invited=1$/);
    await expect(
      page.getByTestId('invitations-table').getByRole('row').filter({ hasText: added }),
    ).toHaveCount(1);
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
        'الاسم الأول',
        'اسم الأب',
        'اسم العائلة',
        'الدور الأساسي',
        'اللغة المفضلة',
      ],
      [first, 'لمى', 'سعد', 'المطيري', 'متدرب', 'العربية'],
      [second, 'نواف', 'علي', 'الدوسري', '', ''],
    ]);
    await upload(page, `موظفو-${run}.csv`, file);
    await expect(page.getByTestId('mapping-table')).toContainText('البريد الإلكتروني للعمل');
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('mapping-next').click();

    await expect(page.getByTestId('review')).toBeVisible({ timeout: WORKER_WAIT });
    await expect(page.getByTestId('review-count-new')).toHaveText('2');
    await expect(page.getByTestId('review-count-errors')).toHaveText('0');
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('review-next').click();

    // Add the people without sending invitations now.
    await page.getByTestId('invitations-hold').check();
    await page.getByTestId('options-next').click();
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
    await expect(page.getByTestId('import-held-banner')).toContainText('دون إرسال');
    await expect(page.getByTestId('users-summary')).toContainText('لم تُرسل');
    const firstRow = page
      .getByTestId('invitations-table')
      .getByRole('row')
      .filter({ hasText: first });
    await expect(firstRow).toContainText('لم تُرسل الدعوة');
    await expect(firstRow).toContainText('من استيراد في');
    await expectNoSeriousA11yViolations(page);

    // One invitation from its row, then the rest from the banner.
    await firstRow.getByRole('button', { name: /^إرسال الدعوة \(/ }).click();
    await expect(page.getByTestId('invitations-message')).toContainText('نرسل الدعوة الآن');
    await expect(firstRow).toContainText(/تُرسل قريبًا|مدعو/);
    await expect(page.getByTestId('import-send-held')).toContainText('(1)');
    await page.getByTestId('import-send-held').click();
    await expect(page.getByTestId('import-held-banner')).toHaveCount(0, { timeout: 30_000 });
    const secondRow = page
      .getByTestId('invitations-table')
      .getByRole('row')
      .filter({ hasText: second });
    await expect(secondRow).toContainText(/تُرسل قريبًا|مدعو/);
  });
});
