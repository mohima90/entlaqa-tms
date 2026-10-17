import type { AppLocale } from '@jadarat/platform-i18n';
import { AppShell, Icon, NavGroup, NavItem } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SignOutButton } from '../auth/sign-out-button';
import { LanguageToggle } from '../language-toggle';

/**
 * The Platform Super Admin console's frame (FR-ADM-17; Kawadir ATS's (admin) layout): the suite's
 * AppShell with the platform's own navigation — «المنظمات» / Organizations and «إعدادات المنصة» / Platform
 * settings → «البريد الإلكتروني» / Email (WP-ADM-01) — and «مشرف المنصة» /
 * Platform Super Admin where an organization's name would be. No organization context, no idle warning
 * (no organization's session rules apply). Render it only after the page checked the Super Admin.
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
  return (
    <AppShell
      brand={shell('productShort')}
      organization={<span data-testid="platform-context">{t('roleName')}</span>}
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
      headerEnd={
        <>
          <LanguageToggle locale={locale} path={path} />
          <SignOutButton
            locale={locale}
            label={auth('signOut')}
            pendingLabel={auth('signingOut')}
          />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
