import type { AppLocale } from '@jadarat/platform-i18n';
import {
  AppShell,
  Icon,
  NAV_COOKIE,
  NavGroup,
  NavItem,
  THEME_COOKIE,
  ThemeMenu,
  Toaster,
  initialsOf,
  parseNavCollapsed,
  parseThemeMode,
} from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { SignOutButton } from '../auth/sign-out-button';
import { LanguageToggle } from '../language-toggle';

/**
 * The Platform Super Admin console's frame (FR-ADM-17; Kawadir ATS's (admin) layout): the suite's
 * AppShell with the platform's own navigation — «المنظمات» / Organizations and «إعدادات المنصة» / Platform
 * settings → «البريد الإلكتروني» / Email (WP-ADM-01) — and «مشرف المنصة» /
 * Platform Super Admin where an organization's name would be. No organization context, no idle warning
 * (no organization's session rules apply). Render it only after the page checked the Super Admin.
 *
 * Direction C (redesign package 5, PO 21 Oct 2026): the gradient menu in the Jadarat palette (the console
 * belongs to no organization), «Platform console» in the top bar, the light / dark / system switch (the
 * device's choice, like the product's), the labelled language pill and Sign out (an icon on phones), and
 * the toasts.
 */
export async function PlatformShell({
  locale,
  path,
  children,
}: {
  locale: AppLocale;
  path: string;
  children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'platform' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const auth = await getTranslations({ locale, namespace: 'auth' });
  const preferences = await cookies();
  return (
    <AppShell
      brand={shell('productShort')}
      organization={<span data-testid="platform-context">{t('roleName')}</span>}
      organizationInitials={initialsOf(t('roleName'))}
      organizationDetail={t('consoleName')}
      navigation={
        <>
          <NavGroup heading={t('consoleName')} id="nav-platform">
            <li>
              <NavItem
                href={`/${locale}/platform`}
                current={path === '/platform'}
                icon={<Icon name="building" />}
              >
                {t('organizationsNav')}
              </NavItem>
            </li>
          </NavGroup>
          {/* Platform settings → Email (WP-ADM-01; Kawadir's (admin)/settings/email). */}
          <NavGroup heading={t('settingsNav')} id="nav-platform-settings">
            <li>
              <NavItem
                href={`/${locale}/platform/settings/email`}
                current={path === '/platform/settings/email'}
                icon={<Icon name="mail" />}
              >
                {t('emailNav')}
              </NavItem>
            </li>
          </NavGroup>
        </>
      }
      navigationLabel={t('navigation')}
      skipToContentLabel={common('skipToContent')}
      menuLabel={shell('menu')}
      closeMenuLabel={shell('closeMenu')}
      collapseLabels={{ collapse: shell('collapseMenu'), expand: shell('expandMenu') }}
      initialCollapsed={parseNavCollapsed(preferences.get(NAV_COOKIE)?.value)}
      headerStart={
        <p className="m-0 hidden truncate text-[15px] font-semibold text-text md:block">
          {t('consoleName')}
        </p>
      }
      headerEnd={
        <>
          <ThemeMenu
            initial={parseThemeMode(preferences.get(THEME_COOKIE)?.value)}
            texts={{
              label: shell('theme'),
              light: shell('themeLight'),
              dark: shell('themeDark'),
              system: shell('themeSystem'),
            }}
          />
          <LanguageToggle locale={locale} path={path} topBar />
          <SignOutButton
            locale={locale}
            label={auth('signOut')}
            pendingLabel={auth('signingOut')}
          />
        </>
      }
    >
      {children}
      <Toaster
        label={shell('statusMessages')}
        closeLabel={shell('close')}
        actionHint={shell('toastActionHint', { action: '{action}' })}
      />
    </AppShell>
  );
}
