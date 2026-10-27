import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, EmptyState, PageHeader } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { NeedsTaskCards } from '../../../../../components/needs/needs-task-cards';
import { SuiteShell } from '../../../../../components/suite-shell';
import { myNeedsQuery } from '../../../../../lib/needs-queries';
import { NEEDS_PATHS } from '../../../../../lib/needs-view';
import { getSuiteContext } from '../../../../../lib/suite-context';

/**
 * My team's needs (WP-LD-01, T-M3-05; FR-PLN-03, FR-MGR-05): the Department Head's list — one task per
 * department they head in the open planning cycle (design screen 1). Without a database the page shows
 * that it needs one.
 */
export default async function MyNeedsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'needsEntry' });

  const empty = (
    <section className="rounded-2xl border border-border bg-surface px-5 py-5.5 shadow-2 md:px-7 md:py-6.5">
      <div className="rounded-xl border border-dashed border-border-strong bg-surface-sunken">
        <EmptyState
          icon="form"
          title={t('emptyTitle')}
          description={t('emptyBody')}
          headingLevel={2}
        />
      </div>
    </section>
  );

  let content: ReactNode;
  if (!context.live) {
    content = (
      <>
        <Alert tone="info" data-testid="needs-not-configured">
          {t('notConfigured')}
        </Alert>
        {empty}
      </>
    );
  } else {
    const result = await myNeedsQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      const errors = await getTranslations({ locale, namespace: 'errors' });
      content =
        error.code === 'FORBIDDEN' ? (
          <Alert tone="warning" data-testid="needs-forbidden">
            {errors('forbidden')}
          </Alert>
        ) : (
          <Alert tone="danger">
            {t('loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
    } else if (result.value.tasks.length === 0) {
      content = empty;
    } else {
      content = (
        <NeedsTaskCards
          locale={locale}
          tasks={result.value.tasks}
          levels={result.value.levels}
          display={context.regional.dateDisplay}
          testId="needs-tasks"
        />
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="myNeeds" path={NEEDS_PATHS.mine}>
      <PageHeader title={t('title')} description={t('intro')} />
      {content}
    </SuiteShell>
  );
}
