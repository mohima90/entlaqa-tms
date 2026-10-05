import { routing } from '@jadarat/platform-i18n/routing';
import { Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { SuiteShell } from '../../../components/suite-shell';
import { getSuiteContext } from '../../../lib/suite-context';

/**
 * Suite home (walking skeleton, T-M1-D03). When sign-in is configured the page requires a verified
 * session WITH an organization (tenant claim) and shows that organization; otherwise (local
 * development, CI) it renders the data-less preview. Pages fail closed: no session → sign-in.
 * TODO(M2, ADR 0002 §4): host tenant (subdomain) must equal the claim tenant once tenant domains exist.
 */
export default async function SuiteHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'shell' });

  return (
    <SuiteShell locale={locale} context={context} current="home" path="/suite">
      <h1 className="mb-6 mt-0 text-2xl font-bold">{t('pageTitle')}</h1>
      <Card title={t('emptyTitle')}>
        <p className="m-0 text-text-muted">{t('emptyBody')}</p>
      </Card>
    </SuiteShell>
  );
}
