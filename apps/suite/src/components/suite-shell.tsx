import type { AppLocale } from '@jadarat/platform-i18n';
import {
  AppShell,
  CommandPalette,
  FullScreenToggle,
  Icon,
  NAV_COOKIE,
  NavGroup,
  NavItem,
  NavUnavailable,
  NotificationBell,
  PoweredBy,
  THEME_COOKIE,
  ThemeMenu,
  Toaster,
  parseNavCollapsed,
  parseThemeMode,
} from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { getConfigStatus } from '../lib/config-status';
import { HOST_KIND_HEADER, HOST_REF_HEADER } from '../lib/host-tenant';
import type { SuiteContext } from '../lib/suite-context';
import {
  PAGE_TITLE_KEYS,
  SUITE_PATHS,
  type SuitePage,
  commandPaletteItems,
  suiteNavigation,
} from '../lib/suite-navigation';
import { roleName } from '../lib/users-view';
import { AccountMenu } from './account-menu';
import { IdleWarning } from './idle-warning';
import { LanguageToggle } from './language-toggle';

export type { SuitePage } from '../lib/suite-navigation';

/**
 * The suite frame in the Kawadir layout (T-M2-43; docs/design/kawadir-alignment.md §3): the white,
 * collapsible navigation with the organization on top, the member's menu (lib/suite-navigation.ts) and
 * «Powered by Jadarat»; the sticky top bar with the page title, the ⌘K / Ctrl K page search, full
 * screen, theme (light / dark / system), the language switch, the notification bell (placeholder until
 * FR-NTF-01) and the account menu (name, "Organization · Role", My profile, sign-out). The theme and the
 * collapsed menu are this device's choices (cookies, display only). `path` is the locale-less path of
 * the page (for the language switch).
 */
export async function SuiteShell({
  locale,
  context,
  current,
  path,
  children,
}: {
  locale: AppLocale;
  context: SuiteContext;
  current: SuitePage;
  path: string;
  children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'shell' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const auth = await getTranslations({ locale, namespace: 'auth' });
  const requestHeaders = await headers();
  const preferences = await cookies();
  const hostKind = requestHeaders.get(HOST_KIND_HEADER);
  const hostRef = requestHeaders.get(HOST_REF_HEADER);
  const organizationName =
    context.organizationName ?? (hostRef && hostKind !== 'platform' ? hostRef : null);
  const tenantLabel = organizationName ?? t('tenantUnresolved');

  // Menus per role (T-M2-21) in Kawadir groups (T-M2-43): from the member's grants.
  const navigation = suiteNavigation(context.navigation).map((group) => (
    <NavGroup
      key={group.key}
      id={group.key === 'main' ? undefined : `nav-${group.key}`}
      heading={group.key === 'main' ? undefined : t(group.key)}
    >
      {group.entries.map((entry) => (
        <li key={entry.key}>
          {entry.link ? (
            <NavItem
              href={`/${locale}${entry.link.href}`}
              current={current === entry.link.page}
              icon={<Icon name={entry.icon} />}
              tooltip={t(entry.key)}
            >
              {t(entry.key)}
            </NavItem>
          ) : (
            <NavUnavailable
              label={t(entry.key)}
              note={t('comingSoon')}
              icon={<Icon name={entry.icon} />}
              tooltip={`${t(entry.key)} · ${t('comingSoon')}`}
            />
          )}
        </li>
      ))}
    </NavGroup>
  ));

  const name = context.me
    ? locale === 'en'
      ? (context.me.nameEn ?? context.me.nameAr)
      : context.me.nameAr
    : t('myAccount');
  const role = context.me?.primaryRole ? roleName(locale, context.me.primaryRole) : null;
  const subtitle =
    organizationName && role
      ? t('accountSubtitle', { organization: organizationName, role })
      : (organizationName ?? role ?? '');
  const canSignOut = getConfigStatus().auth;

  return (
    <AppShell
      brand={t('productShort')}
      organization={
        <span data-testid="tenant-context" data-host-kind={hostKind ?? ''}>
          <span className="sr-only">{t('tenantContext')}: </span>
          {tenantLabel}
        </span>
      }
      title={t(PAGE_TITLE_KEYS[current])}
      navigation={navigation}
      navigationFooter={<PoweredBy title={t('poweredBy')} subtitle={common('tmsFullName')} />}
      navigationLabel={t('mainNavigation')}
      skipToContentLabel={common('skipToContent')}
      menuLabel={t('menu')}
      closeMenuLabel={t('closeMenu')}
      collapseLabels={{ collapse: t('collapseMenu'), expand: t('expandMenu') }}
      initialCollapsed={parseNavCollapsed(preferences.get(NAV_COOKIE)?.value)}
      headerStart={
        <CommandPalette
          items={commandPaletteItems(context.navigation, locale, (key) => t(key))}
          texts={{
            trigger: t('searchTrigger'),
            title: t('searchTitle'),
            placeholder: t('searchPlaceholder'),
            empty: t('searchEmpty'),
            close: t('close'),
          }}
        />
      }
      headerEnd={
        <>
          <FullScreenToggle texts={{ enter: t('fullScreen'), exit: t('exitFullScreen') }} />
          <ThemeMenu
            initial={parseThemeMode(preferences.get(THEME_COOKIE)?.value)}
            texts={{
              label: t('theme'),
              light: t('themeLight'),
              dark: t('themeDark'),
              system: t('themeSystem'),
            }}
          />
          <LanguageToggle locale={locale} path={path} topBar />
          <NotificationBell
            texts={{
              label: t('notifications'),
              emptyTitle: t('notificationsEmptyTitle'),
              emptyBody: t('notificationsEmptyBody'),
            }}
          />
          <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-border md:block lg:mx-2" />
          <AccountMenu
            locale={locale}
            name={name}
            subtitle={subtitle}
            profileHref={`/${locale}${SUITE_PATHS.profile}`}
            profileCurrent={current === 'profile'}
            canSignOut={canSignOut}
            texts={{
              profile: t('myProfile'),
              signOut: canSignOut ? auth('signOut') : undefined,
              signingOut: auth('signingOut'),
            }}
          />
        </>
      }
    >
      {children}
      <Toaster label={t('statusMessages')} closeLabel={t('close')} />
      {context.live && context.idleMinutes !== null ? (
        <IdleWarning
          locale={locale}
          idleMinutes={context.idleMinutes}
          texts={{
            title: t('idleTitle'),
            text: t('idleText'),
            stay: t('idleContinue'),
            signOut: t('idleSignOut'),
          }}
        />
      ) : null}
    </AppShell>
  );
}
