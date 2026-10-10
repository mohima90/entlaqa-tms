import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { BRAND_MATRIX } from '../.storybook/brands';

/**
 * Every story × {Arabic RTL, English LTR} × {light, dark} (Development Plan §5.3 gate 8, ADR 0007):
 * the decorator applied lang/dir/theme to <html>, no console errors, and axe WCAG 2.2 AA with no
 * violations (incl. colour contrast in both themes). That components really mirror in RTL is enforced
 * separately: logical properties only (`pnpm check:rtl`, unit tests banning physical classes).
 * Stories tagged `brand-matrix` (theme preview, T-M2-04c) run again under every brand of
 * BRAND_MATRIX (the Jadarat LMS slot and organization colours, FR-ADM-07).
 */
interface IndexEntry {
  readonly id: string;
  readonly type: string;
  readonly tags?: readonly string[];
}
const index = JSON.parse(
  readFileSync(new URL('../storybook-static/index.json', import.meta.url), 'utf8'),
) as {
  entries: Record<string, IndexEntry>;
};
const stories = Object.values(index.entries).filter((e) => e.type === 'story');

const MODES = [
  { locale: 'ar', dir: 'rtl', theme: 'light' },
  { locale: 'ar', dir: 'rtl', theme: 'dark' },
  { locale: 'en', dir: 'ltr', theme: 'light' },
  { locale: 'en', dir: 'ltr', theme: 'dark' },
] as const;

const SHIPPED = { brand: 'jadarat', brandColor: '' } as const;

test('the story index is not empty', () => {
  expect(stories.length).toBeGreaterThan(0);
});

for (const story of stories) {
  const brands = story.tags?.includes('brand-matrix') ? [SHIPPED, ...BRAND_MATRIX] : [SHIPPED];
  for (const brand of brands) {
    for (const mode of MODES) {
      const label = brand === SHIPPED ? '' : ` · ${brand.brand} ${brand.brandColor}`;
      test(`${story.id} · ${mode.locale} · ${mode.theme}${label}`, async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(`${m.text()} ${m.location().url}`);
        });
        page.on('pageerror', (e) => errors.push(e.message));

        const globals = [
          `locale:${mode.locale}`,
          `theme:${mode.theme}`,
          ...(brand === SHIPPED ? [] : [`brand:${brand.brand}`, `brandColor:${brand.brandColor}`]),
          // a11y.manual: the addon's own automatic axe run would race with this one ("Axe is already running").
          'a11y.manual:!true',
        ].join(';');
        await page.goto(`/iframe.html?id=${story.id}&viewMode=story&globals=${globals}`);
        const html = page.locator('html');
        await expect(html).toHaveAttribute('dir', mode.dir);
        await expect(html).toHaveAttribute('lang', mode.locale);
        await expect(html).toHaveAttribute('data-theme', mode.theme);
        await expect(html).toHaveAttribute('data-brand', brand.brand);
        await page.locator('#storybook-root > *').first().waitFor();

        const results = await new AxeBuilder({ page })
          .include('#storybook-root')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
  }
}
