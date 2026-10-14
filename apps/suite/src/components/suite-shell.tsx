import type { AppLocale } from '@jadarat/platform-i18n';
import { AppShell, Icon, NavGroup, NavItem, NavUnavailable } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { getConfigStatus } from '../lib/config-status';
import { HOST_KIND_HEADER, HOST_REF_HEADER } from '../lib/host-tenant';
import type { SuiteContext } from '../lib/suite-context';
import { type SuitePage, suiteNavigation } from '../lib/suite-navigation';
import { SignOutButton } from './auth/sign-out-button';
import { IdleWarning } from './idle-warning';
import { LanguageToggle } from './language-toggle';

export type { SuitePage } from '../lib/suite-navigation';

/**
 * The member's picture in the header (initials until photos arrive, T-M2-15b) → My profile (FR-IAM-16).
 */
function MyProfileLink({
  href,
  name,
  label,
  current,
}: {
  href: string;
  name: string;
  label: string;
  current: boolean;
}) {
  const initial = Array.from(name.trim())[0] ?? '?';
  return (
    <a
      href={href}
      aria-current={current ? 'page' : undefined}
      className="flex min-h-11 items-center gap-2 rounded-md px-1.5 text-on-header no-underline hover:bg-surface-hover"
      data-testid="my-profile-link"
    >
      <span
        aria-hidden="true"
        className="flex size-8 items-center justify-center rounded-full bg-primary-subtle text-xs font-semibold text-primary-text"
      >
        {initial}
      </span>
      <span className="sr-only">{label}: </span>
      <span className="hidden max-w-40 truncate text-sm font-medium lg:inline">{name}</span>
    </a>
  );
}

/**
 * The suite frame (docs/design/suite-shell.md; approved design, T-M2-21): the gradient navigation with
 * the product and organization names and the member's menu (lib/suite-navigation.ts), and a white top
 * bar with the language switch, My profile and sign-out — only controls that work today (no search or
 * notifications yet). `path` is the locale-less path of the page (for the language switch).
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
  const hostKind = requestHeaders.get(HOST_KIND_HEADER);
  const hostRef = requestHeaders.get(HOST_REF_HEADER);
  const tenantLabel =
    context.organizationName ??
    (hostRef && hostKind !== 'platform' ? hostRef : t('tenantUnresolved'));

  // Menus per role (T-M2-21): groups and entries from the member's grants (lib/suite-navigation.ts).
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
            >
              {t(entry.key)}
            </NavItem>
          ) : (
            <NavUnavailable
              label={t(entry.key)}
              note={t('comingSoon')}
              icon={<Icon name={entry.icon} />}
            />
          )}
        </li>
      ))}
    </NavGroup>
  ));

  return (
    <AppShell
      brand={t('productShort')}
      organization={
        <span data-testid="tenant-context" data-host-kind={hostKind ?? ''}>
          <span className="sr-only">{t('tenantContext')}: </span>
          {tenantLabel}
        </span>
      }
      navigation={navigation}
      navigationLabel={t('mainNavigation')}
      skipToContentLabel={common('skipToContent')}
      menuLabel={t('menu')}
      closeMenuLabel={t('closeMenu')}
      headerEnd={
        <>
          <LanguageToggle locale={locale} path={path} />
          {context.me ? (
            <MyProfileLink
              href={`/${locale}/suite/profile`}
              name={locale === 'en' ? (context.me.nameEn ?? context.me.nameAr) : context.me.nameAr}
              label={t('myProfile')}
              current={current === 'profile'}
            />
          ) : null}
          {getConfigStatus().auth ? (
            <SignOutButton
              locale={locale}
              label={auth('signOut')}
              pendingLabel={auth('signingOut')}
            />
          ) : null}
        </>
      }
    >
      {children}
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
