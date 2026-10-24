import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, Icon, PageHeader, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PlanOverview } from '../../../../../components/plan/plan-overview';
import { SuiteShell } from '../../../../../components/suite-shell';
import { organizationPlanQuery } from '../../../../../lib/plan-queries';
import { getSuiteContext } from '../../../../../lib/suite-context';
import { SUITE_PATHS } from '../../../../../lib/suite-navigation';

const PATH = SUITE_PATHS.subscription;

/**
 * Subscription «الاشتراك» (WP-ADM-06; FR-ADM-13, FR-SUB-01; design approved by the PO 24 Oct 2026 — the menu
 * item keeps the name «Subscription»): the organization's plan, its status (days left of a trial), people and
 * storage used of their limits and the features it includes — read-only for the Organization Admin; to change
 * the plan, contact ENTLAQA. Everyone else is refused.
 */
export default async function SubscriptionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'plans' });

  let content: ReactNode;
  if (!context.live) {
    content = <Alert tone="info">{t('page.notConfigured')}</Alert>;
  } else {
    const result = await organizationPlanQuery({});
    if (result.ok) {
      content = <PlanOverview locale={locale} plan={result.value} />;
    } else {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      const errors = await getTranslations({ locale, namespace: 'errors' });
      content =
        error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND' ? (
          <Alert tone="warning" data-testid="subscription-forbidden">
            {errors('forbidden')}
          </Alert>
        ) : (
          <Alert
            tone="danger"
            data-testid="subscription-load-failed"
            action={
              <a
                href={`/${locale}${PATH}`}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                <Icon name="sync" />
                {(await getTranslations({ locale, namespace: 'common' }))('tryAgain')}
              </a>
            }
          >
            {errors('internalError', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="subscription" path={PATH}>
      <PageHeader title={t('page.title')} description={t('page.intro')} />
      {content}
    </SuiteShell>
  );
}
