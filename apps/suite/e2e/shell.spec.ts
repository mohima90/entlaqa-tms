import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * The suite shell in the Kawadir layout (T-M2-43, FR-STE-08; docs/design/kawadir-alignment.md §3, §5),
 * in English and Arabic, on the data-less preview (every menu entry renders): the Organization Admin's
 * menu groups with «Coming soon» entries that are not links; the desktop collapse button (keyboard,
 * focus kept, tooltips, remembered on this device); the ⌘K / Ctrl K command palette (open, search,
 * Escape, focus return, navigation); the theme menu (light / dark / system, remembered); the
 * notification bell and the account menu (keyboard, focus return); the old Organization profile
 * address redirecting to Settings → General.
 */
const TEXTS = {
  en: {
    nav: 'Main navigation',
    menu: 'Menu',
    groups: ['Organization', 'Billing', 'Settings'],
    links: [
      'Home',
      'Team members',
      'Roles & permissions',
      'General',
      'Email integration',
      'Security',
    ],
    soon: ['Branding', 'Subscription', 'Integrations', 'Audit log'],
    comingSoon: 'Coming soon',
    collapse: 'Collapse menu',
    expand: 'Expand menu',
    search: 'Search pages',
    team: 'Team members',
    theme: 'Theme',
    dark: 'Dark',
    system: 'System',
    bell: 'Notifications',
    noNotifications: 'No notifications yet',
    account: 'My account',
    profile: 'My profile',
    poweredBy: 'Powered by Jadarat',
    general: 'General settings',
  },
  ar: {
    nav: 'التنقل الرئيسي',
    menu: 'القائمة',
    groups: ['المنشأة', 'الفوترة', 'الإعدادات'],
    links: [
      'الرئيسية',
      'أعضاء الفريق',
      'الأدوار والصلاحيات',
      'الإعدادات العامة',
      'تكامل البريد الإلكتروني',
      'الأمان',
    ],
    soon: ['الهوية البصرية', 'الاشتراك', 'التكاملات', 'سجل التدقيق'],
    comingSoon: 'قريبًا',
    collapse: 'طيّ القائمة',
    expand: 'توسيع القائمة',
    search: 'البحث في الصفحات',
    team: 'أعضاء الفريق',
    theme: 'المظهر',
    dark: 'داكن',
    system: 'حسب النظام',
    bell: 'الإشعارات',
    noNotifications: 'لا توجد إشعارات بعد',
    account: 'حسابي',
    profile: 'ملفي الشخصي',
    poweredBy: 'مدعوم من جدارات',
    general: 'الإعدادات العامة',
  },
} as const;

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.help} (${v.nodes.length})`),
  ).toEqual([]);
}

for (const locale of ['en', 'ar'] as const) {
  const t = TEXTS[locale];

  test(`${locale}: the Organization Admin menu groups, with «Coming soon» entries that are not links`, async ({
    page,
    isMobile,
  }) => {
    await page.goto(`/${locale}/suite`);
    if (isMobile) await page.getByRole('button', { name: t.menu, exact: true }).click();
    const nav = page.getByRole('navigation', { name: t.nav });
    for (const group of t.groups) {
      await expect(nav.getByRole('heading', { level: 2, name: group })).toBeVisible();
    }
    for (const name of t.links) {
      await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(1);
    }
    for (const name of t.soon) {
      await expect(nav.getByRole('link', { name })).toHaveCount(0);
      await expect(nav.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(nav.getByText(t.comingSoon).first()).toBeVisible();
    await expect(page.getByText(t.poweredBy)).toBeVisible();
    // A group heading is a disclosure button for its list.
    const heading = nav.getByRole('button', { name: t.groups[1] });
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    await heading.click();
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.getByText(t.soon[1], { exact: true })).toBeHidden();
    await heading.click();
    await expect(nav.getByText(t.soon[1], { exact: true })).toBeVisible();
  });

  test(`${locale}: the desktop menu collapses to icons with the keyboard and stays so on this device`, async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'desktop only: phones keep the drawer');
    await page.goto(`/${locale}/suite/admin/users`);
    const drawer = page.locator('#app-navigation');
    expect(Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(260);
    const collapse = page.getByRole('button', { name: t.collapse });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await collapse.focus();
    await page.keyboard.press('Enter');
    const expand = page.getByRole('button', { name: t.expand });
    await expect(expand).toBeFocused();
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(72);
    // Icons only: the labels stay for screen readers, and show as tooltips on keyboard focus.
    const team = page.getByRole('navigation', { name: t.nav }).getByRole('link', { name: t.team });
    await expect(team).toHaveAttribute('aria-current', 'page');
    await team.focus();
    await expect(page.getByRole('tooltip', { name: t.team })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(page.getByText(t.poweredBy)).toHaveCount(0);
    await expectNoSeriousViolations(page);
    // Remembered on this device.
    await page.reload();
    await expect.poll(async () => Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(72);
    await page.getByRole('button', { name: t.expand }).click();
    await expect(page.getByRole('button', { name: t.collapse })).toBeFocused();
    await expect.poll(async () => Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(260);
    await page.reload();
    await expect(page.getByRole('button', { name: t.collapse })).toBeVisible();
  });

  test(`${locale}: the command palette opens with Ctrl+K, searches the pages and returns focus`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/suite`);
    const trigger = page.getByTestId('command-palette-trigger');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: t.search });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole('combobox', { name: t.search });
    await expect(input).toBeFocused();
    await expectNoSeriousViolations(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    // Ctrl+K from anywhere; type, Enter opens the page.
    await page.keyboard.press('Control+k');
    await expect(dialog).toBeVisible();
    await input.fill(t.team.slice(0, 5));
    await expect(dialog.getByRole('option', { name: new RegExp(t.team) })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/${locale}/suite/admin/users$`));
  });

  test(`${locale}: the theme menu switches light / dark / system and remembers the choice`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/suite`);
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme', /.+/);
    const trigger = page.getByRole('button', { name: new RegExp(`^${t.theme}`) });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitemradio', { name: t.dark }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(trigger).toBeFocused();
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expectNoSeriousViolations(page);
    await page.getByRole('button', { name: new RegExp(`^${t.theme}`) }).click();
    await page.getByRole('menuitemradio', { name: t.system }).click();
    await expect(html).not.toHaveAttribute('data-theme', /.+/);
    await page.reload();
    await expect(html).not.toHaveAttribute('data-theme', /.+/);
  });

  test(`${locale}: the bell and the account menu open with the keyboard and give focus back`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/suite`);
    const bell = page.getByRole('button', { name: t.bell, exact: true });
    await bell.focus();
    await page.keyboard.press('Enter');
    await expect(bell).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(t.noNotifications)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bell).toHaveAttribute('aria-expanded', 'false');
    await expect(bell).toBeFocused();

    const account = page.getByTestId('account-menu');
    await expect(account).toContainText(t.account);
    await account.focus();
    await page.keyboard.press('Enter');
    const profile = page.getByRole('menuitem', { name: t.profile });
    await expect(profile).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(profile).toBeHidden();
    await expect(account).toBeFocused();
    await account.click();
    await page.getByRole('menuitem', { name: t.profile }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/suite/profile$`));
  });

  test(`${locale}: the former Organization profile address opens Settings → General`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/suite/admin/organization`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/suite/admin/settings$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.general);
    await expect(page.getByTestId('top-bar-title')).toHaveText(
      locale === 'en' ? 'General' : 'الإعدادات العامة',
    );
  });
}
