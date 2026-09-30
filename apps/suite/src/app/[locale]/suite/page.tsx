import { routing } from '@jadarat/platform-i18n/routing';
import { tmsNavigation } from '@jadarat/tms';
import { AppShell, Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { LanguageToggle } from '../../../components/language-toggle';
import { HOST_KIND_HEADER, HOST_REF_HEADER } from '../../../lib/host-tenant';

/**
 * Suite shell (walking skeleton). No sign-in yet: T-M1-D03 adds MFA sign-in, the tenant check
 * (host tenant == claim tenant, ADR 0002 §4) and the first audit event.
 */
export default async function SuiteHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'shell' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const requestHeaders = await headers();
  const hostKind = requestHeaders.get(HOST_KIND_HEADER);
  const hostRef = requestHeaders.get(HOST_REF_HEADER);

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
            {t('tenantContext')}:{' '}
            {hostRef && hostKind !== 'platform' ? hostRef : t('tenantUnresolved')}
          </span>
          <LanguageToggle locale={locale} path="/suite" />
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
