import { toClientError } from '@jadarat/platform-core';
import { displayDateFormatter } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, EmptyState, PageHeader, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { RefreshOnReturn } from '../../../../components/latest-version';
import { ApprovalCard } from '../../../../components/plan-approval/approval-card';
import { SuiteShell } from '../../../../components/suite-shell';
import {
  APPROVAL_PATHS,
  approvalReviewHref,
  personLabel,
} from '../../../../lib/plan-approval-view';
import { localName } from '../../../../lib/planning-view';
import { getSuiteContext } from '../../../../lib/suite-context';
import { approvalsQuery } from '../../../../lib/training-plan-queries';

/**
 * Approvals (WP-LD-03, T-M3-07; FR-PLN-08; approved design 5a — the Kawadir Requisitions layout): a «pending»
 * banner, the training plans waiting for the HR Manager's (or Finance's) decision first, then every other plan
 * and where it stands. Every HR Manager is asked; the first decision settles the step. Organization-wide readers
 * of the training plan open it; the menu shows it to those who decide.
 */
export default async function ApprovalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'planApproval' });
  const errors = await getTranslations({ locale, namespace: 'errors' });

  let content: ReactNode;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="approvals-not-configured">
        {t('page.notConfigured')}
      </Alert>
    );
  } else {
    const result = await approvalsQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      content =
        error.code === 'FORBIDDEN' ? (
          <Alert tone="warning" data-testid="approvals-forbidden">
            {errors('forbidden')}
          </Alert>
        ) : (
          <Alert tone="danger">
            {t('page.loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
    } else {
      const format = displayDateFormatter(
        locale,
        context.regional.dateDisplay,
        context.regional.timeZone,
      );
      const moment = (iso: string) => format.dateTime(iso);
      const waiting = result.value.items.filter((i) => i.waitingForMe);
      const others = result.value.items.filter((i) => !i.waitingForMe);
      const first = waiting[0];
      content = (
        <div className="flex flex-col gap-6">
          {first ? (
            <Alert
              tone="warning"
              data-testid="approvals-pending"
              action={
                <a
                  href={approvalReviewHref(locale, first.cycleId)}
                  className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                >
                  {t('page.review')}
                </a>
              }
            >
              {t('page.pendingBanner', {
                plan: localName(locale, first.cycleName),
                name: personLabel(locale, first.submittedBy, t('history.someone')),
                date: first.submittedAt ? moment(first.submittedAt) : '',
              })}
            </Alert>
          ) : null}
          <section
            aria-labelledby="approvals-waiting"
            className="flex flex-col gap-3"
            data-testid="approvals-waiting"
          >
            <h2
              id="approvals-waiting"
              className="m-0 flex items-center gap-2 text-[22px] font-bold"
            >
              {t('page.waitingTitle')}
              <span className="rounded-full bg-warning-subtle px-2 text-base text-warning-strong tabular-nums">
                {waiting.length}
              </span>
            </h2>
            {waiting.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-strong bg-surface-sunken">
                <EmptyState
                  icon="inbox"
                  title={t('page.emptyWaitingTitle')}
                  description={t('page.emptyWaitingBody')}
                  headingLevel={3}
                />
              </div>
            ) : (
              waiting.map((item) => (
                <ApprovalCard key={item.planId} locale={locale} item={item} moment={moment} />
              ))
            )}
          </section>
          <section
            aria-labelledby="approvals-all"
            className="flex flex-col gap-3"
            data-testid="approvals-all"
          >
            <h2 id="approvals-all" className="m-0 text-[22px] font-bold">
              {t('page.allTitle')}
            </h2>
            {others.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-strong bg-surface-sunken">
                <EmptyState
                  icon="plan"
                  title={t('page.emptyAllTitle')}
                  description={t('page.emptyAllBody')}
                  headingLevel={3}
                />
              </div>
            ) : (
              others.map((item) => (
                <ApprovalCard key={item.planId} locale={locale} item={item} moment={moment} />
              ))
            )}
          </section>
        </div>
      );
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="approvals"
      path={APPROVAL_PATHS.approvals}
    >
      <PageHeader title={t('page.title')} description={t('page.intro')} />
      {content}
      <RefreshOnReturn />
    </SuiteShell>
  );
}
