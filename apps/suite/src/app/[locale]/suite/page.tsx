import { routing } from '@jadarat/platform-i18n/routing';
import { Card, Icon, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { SuiteShell } from '../../../components/suite-shell';
import { getSuiteContext } from '../../../lib/suite-context';
import { suiteHome } from '../../../lib/suite-navigation';

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
  // The Organization Admin has no training features: until the admin home (FR-ADM-14) exists, a short
  // set-up card with the pages that are built today (T-M2-21). Decided on the server from the grants.
  const home = suiteHome(context.navigation);

  return (
    <SuiteShell locale={locale} context={context} current="home" path="/suite">
      <h1 className="mb-6 mt-0 text-2xl font-bold">{t('pageTitle')}</h1>
      {home.kind === 'setup' ? (
        <Card title={t('setupTitle')} data-testid="setup-home">
          <p className="mb-4 mt-0 text-text-muted">{t('setupBody')}</p>
          <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
            {home.links.map((entry) => (
              <li key={entry.key}>
                <a
                  href={`/${locale}${entry.link?.href ?? ''}`}
                  className={buttonClasses({ variant: 'secondary', size: 'md' })}
                >
                  <Icon name={entry.icon} />
                  {t(entry.key)}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card title={t('emptyTitle')}>
          <p className="m-0 text-text-muted">{t('emptyBody')}</p>
        </Card>
      )}
    </SuiteShell>
  );
}
