import { toClientError } from '@jadarat/platform-core';
import { displayDateFormatter } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, Badge, Icon, PageHeader } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { RefreshOnReturn } from '../../../../../components/latest-version';
import { approvalStatus } from '../../../../../components/plan-approval/approval-card';
import { ApprovalSide, ReviewActions } from '../../../../../components/plan-approval/plan-review';
import { SuiteShell } from '../../../../../components/suite-shell';
import { PlanTab } from '../../../../../components/training-plan/plan-tab';
import {
  APPROVAL_PATHS,
  approvalMoments,
  personLabel,
} from '../../../../../lib/plan-approval-view';
import { localName } from '../../../../../lib/planning-view';
import { getSuiteContext } from '../../../../../lib/suite-context';
import {
  planApprovalQuery,
  planApprovalTexts,
  trainingPlanErrorTexts,
  trainingPlanQuery,
  trainingPlanTexts,
} from '../../../../../lib/training-plan-queries';
import { planGrouping } from '../../../../../lib/training-plan-view';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The plan review (WP-LD-03, T-M3-07; FR-PLN-08; approved designs 5b and 5c — Kawadir Requisitions details): the
 * status, the version and who submitted it, «Send back» and «Approve» (or «Confirm» for Finance) for whoever
 * decides the step now; the summary, the budget by department with the reasons and the lines, read only; and a
 * side column with the approval steps, the lines left out with their reasons and the history.
 */
export default async function PlanReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; cycleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, cycleId } = await params;
  if (!hasLocale(routing.locales, locale) || !UUID_RE.test(cycleId)) notFound();
  const query = await searchParams;
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'planApproval' });
  const errors = await getTranslations({ locale, namespace: 'errors' });
  const path = `${APPROVAL_PATHS.approvals}/${cycleId}`;

  let title = t('page.title');
  let description: ReactNode = null;
  let actions: ReactNode = null;
  let content: ReactNode;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="approvals-not-configured">
        {t('page.notConfigured')}
      </Alert>
    );
  } else {
    const [planResult, approvalResult] = await Promise.all([
      trainingPlanQuery({ cycleId }),
      planApprovalQuery({ cycleId }),
    ]);
    const failure = !planResult.ok
      ? planResult.error
      : !approvalResult.ok
        ? approvalResult.error
        : null;
    if (failure !== null || !planResult.ok || !approvalResult.ok) {
      const error = failure ? toClientError(failure) : null;
      if (error?.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error?.code === 'NOT_FOUND') notFound();
      content =
        error?.code === 'FORBIDDEN' ? (
          <Alert tone="warning" data-testid="approvals-forbidden">
            {errors('forbidden')}
          </Alert>
        ) : (
          <Alert tone="danger">
            {t('page.loadFailed', { correlationId: error?.correlationId ?? '' })}
          </Alert>
        );
    } else if (!approvalResult.value || !planResult.value.plan) {
      notFound();
    } else {
      const view = planResult.value;
      const approval = approvalResult.value;
      const moments = approvalMoments(
        approval,
        displayDateFormatter(locale, context.regional.dateDisplay, context.regional.timeZone),
      );
      const viewerPersonId = approval.viewer.personId;
      const planName = localName(locale, view.cycle.name);
      const status = approvalStatus({
        status: approval.plan.status,
        approvalStep: approval.plan.approvalStep,
        waitingForMe: approval.can.decide !== null,
      });
      const submitter = personLabel(locale, approval.plan.submittedBy, t('history.someone'));
      title = planName;
      description = (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14.5px]">
          <Badge tone={status.tone} dot data-testid="review-status">
            {t(`status.${status.key}`)}
          </Badge>
          <Badge tone="neutral">{t('version', { version: approval.plan.planVersion })}</Badge>
          {approval.plan.submittedAt ? (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="send" className="size-4" />
              {t('submittedBy', {
                name: submitter,
                date: moments[approval.plan.submittedAt] ?? '',
              })}
            </span>
          ) : null}
        </div>
      );
      const props = {
        locale,
        view,
        approval,
        planName,
        viewerPersonId,
        moments,
        texts: planApprovalTexts(locale),
        errors: await trainingPlanErrorTexts(locale),
      } as const;
      actions = <ReviewActions {...props} />;
      const info =
        approval.can.decide !== null ? (
          <Alert tone="info" data-testid="review-info">
            {t('review.frozenInfo', {
              name: submitter,
              role:
                approval.can.decide === 'finance' ? t('review.roleFinance') : t('review.roleHr'),
            })}
          </Alert>
        ) : approval.viewer.submitted ? (
          <Alert tone="warning" data-testid="review-own">
            {t('review.ownSubmission')}
          </Alert>
        ) : (
          <Alert tone="info" data-testid="review-decided">
            {t('review.decided')}
          </Alert>
        );
      content = (
        <div className="flex flex-col gap-6">
          {info}
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <PlanTab
              locale={locale}
              view={view}
              texts={trainingPlanTexts(locale)}
              errors={props.errors}
              initialSubview={query.view === 'lines' ? 'lines' : 'budget'}
              initialGrouping={planGrouping(query.group)}
              review
            />
            <ApprovalSide {...props} />
          </div>
        </div>
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="approvals" path={path}>
      <PageHeader
        breadcrumbsLabel={t('page.breadcrumb')}
        breadcrumbs={[
          { label: t('page.breadcrumb'), href: `/${locale}${APPROVAL_PATHS.approvals}` },
          { label: title },
        ]}
        title={title}
        description={description}
        actions={actions}
      />
      {content}
      <RefreshOnReturn />
    </SuiteShell>
  );
}
