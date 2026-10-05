import type { AppLocale } from '@jadarat/platform-i18n';
import { tmsNavigation } from '@jadarat/tms';
import { AppShell } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { getConfigStatus } from '../lib/config-status';
import { HOST_KIND_HEADER, HOST_REF_HEADER } from '../lib/host-tenant';
import type { SuiteContext } from '../lib/suite-context';
import { SignOutButton } from './auth/sign-out-button';
import { LanguageToggle } from './language-toggle';

export type SuitePage = 'home' | 'users';

const linkClass = 'block rounded-md px-3 py-2 no-underline';
const currentClass = 'bg-surface-selected font-medium text-primary-text';
const otherClass = 'text-text hover:bg-surface-hover';

function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={current ? 'page' : undefined}
      className={`${linkClass} ${current ? currentClass : otherClass}`}
    >
      {children}
    </a>
  );
}

/**
 * The suite frame (docs/design/suite-shell.md): header with the organization, language and sign-out;
 * navigation with the TMS entries and, for members who may see them, the organization admin entries.
 * `path` is the locale-less path of the page (for the language switch).
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

  const navigation = (
    <>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {tmsNavigation.map((item) =>
          item.key === 'home' ? (
            <li key={item.key}>
              <NavLink href={`/${locale}${item.href}`} current={current === 'home'}>
                {t(item.key)}
              </NavLink>
            </li>
          ) : (
            <li key={item.key}>
              <span
                aria-disabled="true"
                className="flex justify-between gap-2 px-3 py-2 text-text-muted"
              >
                <span>{t(item.key)}</span>
                <span className="text-sm">{t('comingSoon')}</span>
              </span>
            </li>
          ),
        )}
      </ul>
      {context.navigation.users ? (
        <div className="mt-6">
          <h2 id="nav-admin" className="m-0 px-3 pb-2 text-sm font-semibold text-text-muted">
            {t('admin')}
          </h2>
          <ul aria-labelledby="nav-admin" className="m-0 flex list-none flex-col gap-1 p-0">
            <li>
              <NavLink href={`/${locale}/suite/admin/users`} current={current === 'users'}>
                {t('users')}
              </NavLink>
            </li>
          </ul>
        </div>
      ) : null}
    </>
  );

  return (
    <AppShell
      brand={common('productName')}
      navigation={navigation}
      navigationLabel={t('mainNavigation')}
      skipToContentLabel={common('skipToContent')}
      headerEnd={
        <>
          <span
            className="hidden text-sm text-text-muted md:inline"
            data-testid="tenant-context"
            data-host-kind={hostKind ?? ''}
          >
            {t('tenantContext')}: {tenantLabel}
          </span>
          <LanguageToggle locale={locale} path={path} />
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
    </AppShell>
  );
}
