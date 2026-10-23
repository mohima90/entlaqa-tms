import { deflateSync } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { signInToSuite } from './sign-in';

/**
 * Profile photo, grades and HR-only fields (WP-ADM-04; FR-IAM-16, FR-IAM-01, FR-IAM-02; business flow
 * EP-PEOPLE-photo-hr-fields, PO answers 21 and 23 Oct 2026) with real data on the self-hosted stack
 * (infra/docker/smoke.sh, after users.spec), signed in as the provisioned Organization Admin: the Admin keeps
 * the Grades list and sees a person's grade, but NEVER the HR-only card; every member changes their own photo.
 * The HR Manager's side (the HR card, the privileged member's locked record) needs a second login and runs when
 * PEOPLE_E2E_HR_EMAIL / PEOPLE_E2E_HR_PASSWORD are set. Skipped in the default CI run (no Auth server, no data).
 */
const email = process.env.SIGNED_IN_E2E_EMAIL;
const password = process.env.SIGNED_IN_E2E_PASSWORD;
const hrEmail = process.env.PEOPLE_E2E_HR_EMAIL;
const hrPassword = process.env.PEOPLE_E2E_HR_PASSWORD;
const SARA = '5eed1000-0000-4000-8000-000000000001';

/** A PNG of a flat colour (valid header and checksums), made here so the spec needs no fixture file. */
function png(side: number, [red, green, blue]: readonly [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array(side).fill([red, green, blue]).flat()),
  ]);
  const pixels = deflateSync(Buffer.concat(Array(side).fill(row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function expectNoSeriousA11yViolations(page: Page) {
  await expect(page).toHaveTitle(/\S/);
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

const toasts = (page: Page) => page.getByRole('region', { name: 'Status messages' });

test.describe('Grades, photo and HR-only fields as the Organization Admin', () => {
  test.skip(!email || !password, 'signed-in E2E credentials not set');
  test.describe.configure({ mode: 'serial' });

  test('Grades: add with punctuation, the message goes on the field, rename, and a used grade cannot be deleted', async ({
    page,
  }) => {
    await signInToSuite(page, email, password);
    await page.goto('/en/suite/admin/grades');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Grades');
    await expectNoSeriousA11yViolations(page);

    // Codes may carry punctuation; each is unique in the list.
    for (const code of ['E2E-7', '#E2E', 'E2E7']) {
      await page.getByTestId('grade-add').first().click();
      const dialog = page.getByTestId('grade-dialog');
      await dialog.getByLabel('Grade code').fill(code);
      await dialog.getByTestId('grade-save').click();
      await expect(dialog).toBeHidden();
      await expect(toasts(page)).toContainText(`Grade ${code} added.`);
      await expect(page.getByTestId(`grade-rename-${code}`)).toBeVisible();
    }

    // Pressing Add with nothing, or a code that is not valid: the message is on the field and focus goes there.
    await page.getByTestId('grade-add').first().click();
    const dialog = page.getByTestId('grade-dialog');
    await dialog.getByTestId('grade-save').click();
    await expect(dialog.getByText('Enter a grade code.')).toBeVisible();
    await expect(dialog.getByLabel('Grade code')).toBeFocused();
    await dialog.getByLabel('Grade code').fill('E2E 7');
    await dialog.getByTestId('grade-save').click();
    await expect(dialog.getByLabel('Grade code')).toHaveAttribute('aria-invalid', 'true');
    // A code already in the list (any case) is refused by the server on the same field.
    await dialog.getByLabel('Grade code').fill('e2e7');
    await dialog.getByTestId('grade-save').click();
    await expect(dialog.getByText('e2e7 is already in the list.')).toBeVisible();
    await expect(dialog.getByLabel('Grade code')).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // Rename keeps its place in the list; delete asks first.
    await page.getByTestId('grade-rename-E2E7').click();
    await page.getByTestId('grade-dialog').getByLabel('Grade code').fill('E2E8');
    await page.getByTestId('grade-save').click();
    await expect(toasts(page)).toContainText('Grade renamed to E2E8.');
    await page.getByTestId('grade-delete-E2E8').click();
    await page.getByTestId('grade-delete-confirm').click();
    await expect(toasts(page)).toContainText('Grade E2E8 deleted.');
    await expect(page.getByTestId('grade-rename-E2E8')).toHaveCount(0);
  });

  test('a person’s grade: set it in the edit panel, see it on the profile; no HR-only card for the Organization Admin', async ({
    page,
  }) => {
    await signInToSuite(page, email, password);
    await page.goto(`/en/suite/admin/users/${SARA}/edit`);
    const panel = page.getByRole('dialog');
    await expect(panel.getByLabel('Grade')).toBeVisible();
    // The Organization Admin edits the grade only: the HR details never reach this page.
    await expect(panel.getByTestId('edit-hr-details')).toHaveCount(0);
    await expect(panel.getByText('Date of birth')).toHaveCount(0);
    await panel.getByLabel('Grade').selectOption({ label: 'E2E-7' });
    await panel.getByRole('button', { name: 'Save changes' }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByTestId('profile-grade')).toHaveText('E2E-7');
    await expect(page.getByTestId('hr-details')).toHaveCount(0);
    await expect(page.getByText('Employment category')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    // A grade people hold cannot be deleted: the dialog says why.
    await page.goto('/en/suite/admin/grades');
    await page.getByTestId('grade-delete-E2E-7').click();
    await expect(page.getByTestId('grade-blocked-dialog')).toContainText(
      'Can’t delete grade E2E-7',
    );
    await page.getByRole('button', { name: 'Got it' }).click();
    // Clear it again so the list can be cleaned up.
    await page.goto(`/en/suite/admin/users/${SARA}/edit`);
    await page.getByRole('dialog').getByLabel('Grade').selectOption({ label: 'No grade' });
    await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.goto('/en/suite/admin/grades');
    for (const code of ['E2E-7', '#E2E']) {
      await page.getByTestId(`grade-delete-${code}`).click();
      await page.getByTestId('grade-delete-confirm').click();
      await expect(toasts(page)).toContainText(`Grade ${code} deleted.`);
    }
  });

  test('Arabic: the Grades page is right-to-left with the codes kept left-to-right', async ({
    page,
  }) => {
    await signInToSuite(page, email, password);
    await page.goto('/ar/suite/admin/grades');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('الدرجات الوظيفية');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByTestId('grade-add').first().click();
    await expect(page.getByTestId('grade-dialog').getByLabel('رمز الدرجة')).toHaveAttribute(
      'dir',
      'ltr',
    );
    await expectNoSeriousA11yViolations(page);
  });

  test('My profile photo: refused types, framing, saved at once in the top bar, replaced, removed', async ({
    page,
  }) => {
    await signInToSuite(page, email, password);
    await page.goto('/en/suite/profile');
    await expect(page.getByTestId('profile-photo')).toBeVisible();
    await expect(
      page.getByText('You have no photo yet. Your initials show instead.'),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // SVG and GIF are refused before anything is uploaded (by content, whatever the name says).
    const input = page.getByTestId('photo-input');
    await input.setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
    });
    await expect(page.getByTestId('photo-problem')).toContainText(
      'This file can’t be used. Choose a PNG, JPG or WebP picture.',
    );
    await expect(page.getByTestId('photo-problem')).toBeFocused();

    // A real picture opens the framing dialog (keyboard: arrow keys move the picture), then saves.
    await input.setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: png(600, [40, 90, 140]),
    });
    const dialog = page.getByTestId('photo-crop-dialog');
    await expect(dialog.getByRole('heading', { name: 'Adjust your photo' })).toBeVisible();
    await expect(dialog.getByTestId('photo-shrunk')).toContainText('me.png · shrunk from');
    await dialog.getByTestId('photo-crop-area').focus();
    await page.keyboard.press('ArrowLeft');
    await dialog.getByTestId('photo-zoom').fill('1.5');
    await expectNoSeriousA11yViolations(page);
    await dialog.getByTestId('photo-save').click();
    await expect(dialog).toBeHidden();
    await expect(toasts(page)).toContainText('Photo saved.');
    // The profile header and the top bar show the photo (same-origin, signed-in only).
    const header = page.getByTestId('profile-identity').locator('img');
    await expect(header).toHaveAttribute('src', /^\/api\/photo\/[0-9a-f-]{36}\?v=[0-9a-f]{12}$/);
    await expect(page.getByTestId('account-menu').locator('img')).toHaveAttribute(
      'src',
      /^\/api\/photo\//,
    );
    const src = (await header.getAttribute('src')) ?? '';
    const served = await page.request.get(src);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/jpeg');
    expect(served.headers()['cache-control']).toContain('private');
    // Without a session the same address answers 401 and shows nothing.
    const anonymous = await page.context().browser()?.newContext({ baseURL: page.url() });
    if (anonymous) {
      const refused = await anonymous.request.get(new URL(src, page.url()).toString());
      expect([401, 404]).toContain(refused.status());
      await anonymous.close();
    }

    // Replace: a new picture, a new address.
    await page.getByTestId('photo-upload').click();
    await input.setInputFiles({
      name: 'other.png',
      mimeType: 'image/png',
      buffer: png(500, [160, 60, 60]),
    });
    await page.getByTestId('photo-crop-dialog').getByTestId('photo-save').click();
    await expect(toasts(page)).toContainText('Photo saved.');
    await expect(page.getByTestId('photo-remove')).toBeVisible();

    // Remove asks first; the initials come back.
    await page.getByTestId('photo-remove').click();
    await expect(page.getByTestId('photo-remove-dialog')).toContainText('Remove your photo?');
    await page.getByTestId('photo-remove-confirm').click();
    await expect(toasts(page)).toContainText('Photo removed.');
    await expect(page.getByTestId('photo-remove')).toHaveCount(0);
    await expect(page.getByTestId('account-menu').locator('img')).toHaveCount(0);
    expect((await page.request.get(src)).status()).toBe(404);
  });

  test('My profile shows the member’s OWN HR details read-only, with nothing to edit', async ({
    page,
  }) => {
    await signInToSuite(page, email, password);
    await page.goto('/en/suite/profile');
    // The person always sees their OWN HR details, read-only — the card exists for the Admin as a person.
    await expect(page.getByTestId('hr-details')).toContainText('Only you and HR');
    await expect(page.getByTestId('hr-details')).toContainText(
      'Something wrong? Ask HR to correct these.',
    );
    await expect(page.getByTestId('hr-details').getByRole('combobox')).toHaveCount(0);
    await expect(page.getByTestId('hr-details').getByRole('textbox')).toHaveCount(0);
  });
});

test.describe('HR details as the HR Manager', () => {
  test.skip(!hrEmail || !hrPassword, 'HR Manager E2E credentials not set');
  test.describe.configure({ mode: 'serial' });

  test('the HR details card: filled in the edit panel, shown with the Hijri date, changes audited without values', async ({
    page,
  }) => {
    await signInToSuite(page, hrEmail, hrPassword);
    await page.goto(`/en/suite/admin/users/${SARA}/edit`);
    const panel = page.getByRole('dialog');
    await expect(panel.getByTestId('edit-hr-details')).toContainText('Only HR');
    await panel.getByLabel('Gender').selectOption('female');
    await panel.getByLabel('Employment category').selectOption('technical');
    await panel.getByLabel('Date of birth').fill('2999-01-01');
    await panel.getByRole('button', { name: 'Save changes' }).click();
    // A date in the future: the message is on the field and focus goes there.
    await expect(panel.getByText('Enter a real date in the past.')).toBeVisible();
    await expect(panel.getByLabel('Date of birth')).toBeFocused();
    await panel.getByLabel('Date of birth').fill('1992-05-14');
    await expect(panel.getByText(/Hijri: /)).toBeVisible();
    await panel.getByRole('button', { name: 'Save changes' }).click();
    await expect(panel).toBeHidden();
    const card = page.getByTestId('hr-details');
    await expect(card).toContainText('Female');
    await expect(card).toContainText('14 May 1992');
    await expect(card).toContainText('Hijri:');
    await expect(card).toContainText('Technical');
    // The audit trail names the change and never the values.
    await page.goto(`/en/suite/admin/users/${SARA}?tab=activity`);
    const activity = page.getByTestId('user-activity');
    await expect(activity).toContainText('HR details changed');
    await expect(activity).not.toContainText('1992');
    await expectNoSeriousA11yViolations(page);
  });
});
