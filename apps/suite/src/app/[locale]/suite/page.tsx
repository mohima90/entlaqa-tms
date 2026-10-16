import { routing } from '@jadarat/platform-i18n/routing';
import { Card, EmptyState, Icon, PageHeader } from '@jadarat/ui';
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
      <PageHeader title={t('pageTitle')} />
      {home.kind === 'setup' ? (
        <Card title={t('setupTitle')} description={t('setupBody')} data-testid="setup-home">
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-4">
            {home.links.map((entry) => (
              <li key={entry.key}>
                <a
                  href={`/${locale}${entry.link?.href ?? ''}`}
                  className="group flex min-h-16 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 font-medium text-text no-underline shadow-1 transition-colors hover:border-border-strong hover:bg-surface-hover"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-subtle text-primary-text"
                  >
                    <Icon name={entry.icon} className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">{t(entry.key)}</span>
                  <Icon name="chevron-end" className="text-text-muted" />
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <EmptyState icon="calendar" title={t('emptyTitle')} description={t('emptyBody')} />
        </Card>
      )}
    </SuiteShell>
  );
}
