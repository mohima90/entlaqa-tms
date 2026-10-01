import { hasTenant } from '@jadarat/platform-core';
import { getCurrentTenant, withUserTx } from '@jadarat/platform-db';
import { routing } from '@jadarat/platform-i18n/routing';
import { getVerifiedClaims } from '@jadarat/platform-identity/next';
import { tmsNavigation } from '@jadarat/tms';
import { AppShell, Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SignOutButton } from '../../../components/auth/sign-out-button';
import { LanguageToggle } from '../../../components/language-toggle';
import { getConfigStatus } from '../../../lib/config-status';
import { HOST_KIND_HEADER, HOST_REF_HEADER } from '../../../lib/host-tenant';

/**
 * Suite shell (walking skeleton, T-M1-D03). When sign-in is configured the page requires a verified
 * session WITH an organization (tenant claim) and shows that organization; otherwise (local
 * development, CI) it renders the data-less preview. Pages fail closed: no session → sign-in.
 * TODO(M2, ADR 0002 §4): host tenant (subdomain) must equal the claim tenant once tenant domains exist.
 */
export default async function SuiteHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const status = getConfigStatus();
  let organizationName: string | null = null;
  if (status.auth) {
    const claims = await getVerifiedClaims();
    if (!claims.ok) redirect(`/${locale}/sign-in`);
    if (!hasTenant(claims.value)) redirect(`/${locale}/select-organization`);
    const tenant = status.database
      ? await withUserTx(claims.value, (tx) => getCurrentTenant(tx))
      : null;
    // The claims name a tenant the database does not accept (e.g. membership just suspended).
    if (status.database && !tenant) redirect(`/${locale}/sign-in`);
    organizationName = tenant
      ? locale === 'en'
        ? (tenant.nameEn ?? tenant.nameAr)
        : tenant.nameAr
      : null;
  }

  const t = await getTranslations({ locale, namespace: 'shell' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const auth = await getTranslations({ locale, namespace: 'auth' });
  const requestHeaders = await headers();
  const hostKind = requestHeaders.get(HOST_KIND_HEADER);
  const hostRef = requestHeaders.get(HOST_REF_HEADER);
  const tenantLabel =
    organizationName ?? (hostRef && hostKind !== 'platform' ? hostRef : t('tenantUnresolved'));

  const navigation = (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {tmsNavigation.map((item) =>
        item.key === 'home' ? (
          <li key={item.key}>
            <a
              href={`/${locale}${item.href}`}
              aria-current="page"
              className="block rounded-md bg-surface-selected px-3 py-2 font-medium text-primary-text no-underline"
            >
              {t(item.key)}
            </a>
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
          <LanguageToggle locale={locale} path="/suite" />
          {status.auth ? (
            <SignOutButton
              locale={locale}
              label={auth('signOut')}
              pendingLabel={auth('signingOut')}
            />
          ) : null}
        </>
      }
    >
      <h1 className="mb-6 mt-0 text-2xl font-bold">{t('pageTitle')}</h1>
      <Card title={t('emptyTitle')}>
        <p className="m-0 text-text-muted">{t('emptyBody')}</p>
      </Card>
    </AppShell>
  );
}
