import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Every story × {Arabic RTL, English LTR} × {light, dark} (Development Plan §5.3 gate 8, ADR 0007):
 * correct lang/dir/theme on <html>, no console errors, and axe WCAG 2.2 AA with no violations.
 */
interface IndexEntry {
  readonly id: string;
  readonly type: string;
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

test('the story index is not empty', () => {
  expect(stories.length).toBeGreaterThan(0);
});

for (const story of stories) {
  for (const mode of MODES) {
    test(`${story.id} · ${mode.locale} · ${mode.theme}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`${m.text()} ${m.location().url}`);
      });
      page.on('pageerror', (e) => errors.push(e.message));

      await page.goto(
        // a11y.manual: the addon's own automatic axe run would race with this one ("Axe is already running").
        `/iframe.html?id=${story.id}&viewMode=story&globals=locale:${mode.locale};theme:${mode.theme};a11y.manual:!true`,
      );
      const html = page.locator('html');
      await expect(html).toHaveAttribute('dir', mode.dir);
      await expect(html).toHaveAttribute('lang', mode.locale);
      await expect(html).toHaveAttribute('data-theme', mode.theme);
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
