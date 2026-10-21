import { crc32 } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { afterSignIn, fillSignIn } from './sign-in';

/**
 * Organization → Branding (WP-ADM-02, FR-ADM-07; business flow EP-BRAND; Kawadir /org/branding), in English
 * and Arabic, on the data-less preview (no database: nothing is uploaded or saved, the page says so):
 *  - opened from the menu (no longer «Coming soon»);
 *  - a colour typed in the hex field changes the live preview (the menu's current item, the main button),
 *    an unreadable colour raises the WCAG 2.2 AA warning with its ratio, a preset clears it;
 *  - «Use gradient» off: one colour (no secondary field, the gradient's end is its start);
 *  - «Reset to the Jadarat look» puts the Jadarat colours back;
 *  - a small PNG shows in the previews at once; an SVG and a browser icon over 512 × 512 pixels are refused
 *    with the reason;
 *  - no serious accessibility violation.
 * With credentials (BRANDING_E2E_*, the self-hosted stack): the Organization Admin saves a colour and the
 * shell applies it at once; an HR Manager is refused.
 */
const TEXTS = {
  en: {
    nav: 'Main navigation',
    menu: 'Menu',
    link: 'Branding',
    title: 'Branding',
    preview: "isn't available in this environment",
    contrastTitle: 'Some text may be hard to read',
    contrastLine: 'White text on the primary colour: 1.42 : 1',
    contrastOk: 'All text on these colours meets WCAG 2.2 AA',
    reset: 'Reset to the Jadarat look',
    gradient: 'Use gradient',
    navy: 'Use the Navy colours',
    svgError: 'Choose a PNG, JPG or WebP image',
    tooBig: 'at most 512 × 512 pixels',
    previewOnly: 'Shown in the preview only',
  },
  ar: {
    nav: 'التنقل الرئيسي',
    menu: 'القائمة',
    link: 'الهوية البصرية',
    title: 'الهوية البصرية',
    preview: 'غير متاحة في هذه البيئة',
    contrastTitle: 'قد يصعب قراءة بعض النصوص',
    contrastLine: 'النص الأبيض على اللون الأساسي: 1.42 : 1',
    contrastOk: 'كل النصوص على هذه الألوان تحقق معيار WCAG 2.2 AA',
    reset: 'العودة إلى هوية جدارات',
    gradient: 'استخدام التدرّج',
    navy: 'استخدام ألوان الكحلي',
    svgError: 'اختر صورة PNG أو JPG أو WebP',
    tooBig: 'الحد الأقصى 512 × 512 بكسل',
    previewOnly: 'تظهر في المعاينة فقط',
  },
} as const;

/**
 * A well-formed 1 × 1 PNG (signature, IHDR, IDAT, IEND, correct lengths and CRCs), built in memory: no
 * binary sample in the repository. The page reads its size from the header, so it must parse.
 */
const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082',
  'hex',
);
/** The same PNG declaring another size in pixels (its IHDR rewritten, CRC included). */
function pngOfSize(width: number, height: number): Buffer {
  const png = Buffer.from(PNG_1X1);
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)) >>> 0, 29);
  return png;
}
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  'utf8',
);

async function expectNoSeriousViolations(page: Page) {
  // From the top of the page: after an image is removed the form gets shorter, and the scroll position
  // can leave a control half behind the sticky top bar, which axe then measures as obscured (2.5.8:
  // in CI the browser-icon Upload button under the language switch). Axe still checks every element.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  // Where each failing element is and what sits on top of it, so a failure in CI names its cause.
  const details = await Promise.all(
    serious.flatMap((v) =>
      v.nodes.map(async (n) => {
        const selector = n.target.join(' ');
        const where = await page.evaluate((sel) => {
          const element = document.querySelector(sel);
          if (!element) return 'not found';
          const r = element.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return `rect ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)} · scrollY ${Math.round(window.scrollY)} · on top: ${top?.tagName ?? '-'}[${top?.getAttribute('data-testid') ?? ''}]`;
        }, selector);
        return `${v.id}: ${v.help} — ${selector} — ${n.failureSummary ?? ''} — ${where}`;
      }),
    ),
  );
  expect(details).toEqual([]);
}

/** A colour role as the live preview has it (its own custom properties, set from the unsaved values). */
async function previewRole(page: Page, role: string): Promise<string> {
  return page
    .getByTestId('brand-preview')
    .evaluate((el, name) => getComputedStyle(el).getPropertyValue(name).trim(), `--color-${role}`);
}

for (const locale of ['en', 'ar'] as const) {
  const t = TEXTS[locale];

  test(`${locale}: Branding — colours, gradient, presets, contrast, reset and images in the live preview`, async ({
    page,
    isMobile,
  }) => {
    await page.goto(`/${locale}/suite`);
    if (isMobile) await page.getByRole('button', { name: t.menu, exact: true }).click();
    await page
      .getByRole('navigation', { name: t.nav })
      .getByRole('link', { name: t.link, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/suite/admin/branding$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    await expect(page.getByTestId('branding-not-configured')).toContainText(t.preview);
    await expect(page.getByTestId('brand-contrast-ok')).toContainText(t.contrastOk);
    await expect.poll(() => previewRole(page, 'brand')).toBe('#2F4858');
    await expectNoSeriousViolations(page);

    // A colour typed in the hex field: the preview follows at once (unsaved).
    await page.getByTestId('brand-primaryColor').fill('#1E3A5F');
    await expect.poll(() => previewRole(page, 'brand')).toBe('#1E3A5F');
    // An unreadable colour: the WCAG warning with the real ratio; the preview stays readable.
    await page.getByTestId('brand-primaryColor').fill('#FFD500');
    const warning = page.getByTestId('brand-contrast-warning');
    await expect(warning).toContainText(t.contrastTitle);
    await expect(page.getByTestId('brand-contrast-textOnPrimary')).toHaveText(t.contrastLine);
    await expect.poll(() => previewRole(page, 'brand')).not.toBe('#FFD500');
    await expectNoSeriousViolations(page);
    // A preset: both colours, readable.
    await page.getByRole('button', { name: t.navy }).click();
    await expect(page.getByRole('button', { name: t.navy })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('brand-primaryColor')).toHaveValue('#1E3A5F');
    await expect(page.getByTestId('brand-secondaryColor')).toHaveValue('#2C5282');
    await expect(warning).toHaveCount(0);

    // Gradient off: one colour.
    const gradient = page.getByRole('switch', { name: t.gradient });
    await expect(gradient).toHaveAttribute('aria-checked', 'true');
    expect(await previewRole(page, 'brand-end')).not.toBe(await previewRole(page, 'brand'));
    await gradient.click();
    await expect(gradient).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('brand-secondaryColor')).toHaveCount(0);
    await expect.poll(() => previewRole(page, 'brand-end')).toBe(await previewRole(page, 'brand'));

    // Reset to the Jadarat look.
    await page.getByTestId('brand-reset').click();
    await expect(page.getByTestId('brand-primaryColor')).toHaveValue('#2F4858');
    await expect(page.getByTestId('brand-secondaryColor')).toHaveValue('#33658A');
    await expect(gradient).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => previewRole(page, 'brand')).toBe('#2F4858');

    // Images: a PNG shows in the previews at once; an SVG is refused by its type.
    await page.getByTestId('brand-image-logo-input').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    await expect(page.getByTestId('brand-image-logo-preview')).toHaveAttribute('src', /^blob:/);
    await expect(page.getByTestId('brand-preview-logo')).toHaveAttribute('src', /^blob:/);
    await expect(page.getByTestId('brand-slot-logo')).toContainText(t.previewOnly);
    await page.getByTestId('brand-image-favicon-input').setInputFiles({
      name: 'icon.svg',
      mimeType: 'image/svg+xml',
      buffer: SVG,
    });
    await expect(page.getByTestId('brand-image-favicon-error')).toContainText(t.svgError);
    // A renamed SVG is refused by its first bytes.
    await page.getByTestId('brand-image-favicon-input').setInputFiles({
      name: 'icon.png',
      mimeType: 'image/png',
      buffer: SVG,
    });
    await expect(page.getByTestId('brand-image-favicon-error')).toContainText(t.svgError);
    // A browser icon over 512 × 512 pixels is refused by its header (security review L8).
    await page.getByTestId('brand-image-favicon-input').setInputFiles({
      name: 'icon.png',
      mimeType: 'image/png',
      buffer: pngOfSize(1024, 1024),
    });
    await expect(page.getByTestId('brand-image-favicon-error')).toContainText(t.tooBig);
    await expect(page.getByTestId('brand-image-favicon-preview')).toHaveCount(0);
    await page.getByTestId('brand-image-logo-remove').click();
    await expect(page.getByTestId('brand-image-logo-preview')).toHaveCount(0);
    await expectNoSeriousViolations(page);
  });
}

/**
 * The real response headers of the public image path (security review L4): whatever the answer (here a 404:
 * no such copy, or no database), the image policy — not the page CSP set by the proxy — and nosniff.
 */
test('public branding images answer with the sandboxing policy and nosniff', async ({
  request,
}) => {
  for (const path of ['/api/brand/3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d', '/api/brand/not-an-id']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    const headers = response.headers();
    expect(headers['content-security-policy'], path).toBe("default-src 'none'; sandbox");
    expect(headers['x-content-type-options'], path).toBe('nosniff');
    expect(headers['cross-origin-resource-policy'], path).toBe('cross-origin');
    expect(headers['cache-control'], path).toBe('no-store');
  }
});

/** With a database and accounts (the self-hosted stack): save, and the shell applies the colour. */
const adminEmail = process.env.BRANDING_E2E_EMAIL ?? '';
const adminPassword = process.env.BRANDING_E2E_PASSWORD ?? '';
const hrEmail = process.env.BRANDING_E2E_HR_EMAIL ?? '';
const hrPassword = process.env.BRANDING_E2E_HR_PASSWORD ?? '';

test.describe('branding saved', () => {
  test.skip(!adminEmail || !adminPassword, 'BRANDING_E2E_* not set');
  test.describe.configure({ mode: 'serial' });

  test('the Organization Admin saves a colour; the shell applies it at once', async ({ page }) => {
    await page.goto('/en/sign-in');
    await fillSignIn(page, 'en', adminEmail, adminPassword);
    await expect(page).toHaveURL(/\/en\/(suite|mfa)$/, afterSignIn);
    await page.goto('/en/suite/admin/branding');
    await page.getByRole('button', { name: 'Use the Burgundy colours' }).click();
    await page.getByTestId('save-bar-save').click();
    await expect(page.getByText('Branding saved', { exact: false })).toBeVisible();
    await page.reload();
    const current = await page
      .locator('html')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--color-brand').trim());
    expect(current).toBe('#7A1F2B');
    // Back to the Jadarat look for the next run.
    await page.getByTestId('brand-reset').click();
    await page.getByTestId('save-bar-save').click();
    await expect(page.getByText('Branding saved', { exact: false })).toBeVisible();
  });

  test('an HR Manager is refused', async ({ page }) => {
    test.skip(!hrEmail || !hrPassword, 'BRANDING_E2E_HR_* not set');
    await page.goto('/en/sign-in');
    await fillSignIn(page, 'en', hrEmail, hrPassword);
    await expect(page).toHaveURL(/\/en\/suite$/, afterSignIn);
    await page.goto('/en/suite/admin/branding');
    await expect(page.getByTestId('branding-forbidden')).toBeVisible();
  });
});
