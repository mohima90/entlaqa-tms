import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import type { PlanDeliveryView, PlanView } from '@jadarat/tms';
import { Alert, Badge, Icon, TabNav } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { DeliveryCard } from '../../../../../../../components/plan-delivery/delivery-card';
import { DeliveryLines } from '../../../../../../../components/plan-delivery/delivery-lines';
import { LinePopup } from '../../../../../../../components/plan-delivery/line-popups';
import { PlanningHeader } from '../../../../../../../components/planning/planning-header';
import { SuiteShell } from '../../../../../../../components/suite-shell';
import { formatMonth } from '../../../../../../../lib/month-format';
import { planDeliveryQuery } from '../../../../../../../lib/plan-delivery-queries';
import { previewDelivery } from '../../../../../../../lib/plan-delivery-preview';
import {
  calendarPath,
  deliveryParams,
  deliveryPath,
  deliveryPopup,
  periodYear,
} from '../../../../../../../lib/plan-delivery-view';
import { dayFormatter } from '../../../../../../../lib/planning-format';
import { PLANNING_PATHS, localName } from '../../../../../../../lib/planning-view';
import { getSuiteContext } from '../../../../../../../lib/suite-context';
import { trainingPlanQuery } from '../../../../../../../lib/training-plan-queries';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «Courses and sessions» of a cycle (WP-LD-04, T-M3-08; FR-PLN-09, FR-CAT-01, FR-SCH-01; approved design screen 1,
 * docs/design/screens/m3-plan-to-sessions/README.md): the approved plan's lines with their **Course** and **Draft
 * sessions**, the «From the plan to sessions» card, the filter pills and the popups «A course for …» and «Create
 * draft sessions», each opened by its address. A third view of the cycle next to Progress and Plan, on its own
 * page: the cycle page is at its client-code budget (CI gate 9), and this page renders on the server and loads only
 * its popups. For holders of tms.session.manage (the L&D Manager, the Training Coordinator); others get no tab and
 * a refusal here. Without a database: the Plan tab's example plan, approved (nothing is saved).
 */
export default async function PlanSessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; cycleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, cycleId } = await params;
  if (!hasLocale(routing.locales, locale) || !UUID_RE.test(cycleId)) notFound();
  const raw = await searchParams;
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'planDelivery' });
  const plans = await getTranslations({ locale, namespace: 'trainingPlan' });
  const approvalT = await getTranslations({ locale, namespace: 'planApproval' });
  const errors = await getTranslations({ locale, namespace: 'errors' });
  const filter = deliveryParams(raw);
  const popup = deliveryPopup(raw);
  const path = `${PLANNING_PATHS.cycles}/${cycleId}/sessions`;
  const display = context.regional.dateDisplay;

  let data: { plan: PlanView; delivery: PlanDeliveryView } | null = null;
  let failure: string | null = null;
  const preview = !context.live;
  if (preview) {
    data = previewDelivery();
  } else {
    const [planResult, deliveryResult] = await Promise.all([
      trainingPlanQuery({ cycleId }),
      planDeliveryQuery({ cycleId }),
    ]);
    const refused = !deliveryResult.ok ? deliveryResult : !planResult.ok ? planResult : null;
    if (refused) {
      const error = toClientError(refused.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'NOT_FOUND') notFound();
      failure =
        error.code === 'FORBIDDEN'
          ? errors('forbidden')
          : errors('internalError', { correlationId: error.correlationId ?? '' });
    } else if (planResult.ok && deliveryResult.ok) {
      data = { plan: planResult.value, delivery: deliveryResult.value };
    }
  }

  const cyclePath = `/${locale}${PLANNING_PATHS.cycles}/${cycleId}`;
  const title = data ? localName(locale, data.delivery.cycle.name) : t('tab');
  const day = dayFormatter(locale, display);
  const description = data ? (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14.5px]">
      <Badge
        tone={data.delivery.plan.status === 'approved' ? 'success' : 'info'}
        dot
        data-testid="plan-status"
      >
        {data.delivery.plan.status === 'approved' ? (
          <Icon name="lock" className="size-3.5" />
        ) : null}
        {data.delivery.plan.status === 'approved'
          ? approvalT('approvedBadge', { version: data.delivery.plan.planVersion })
          : plans(`planStatus.${data.delivery.plan.status}`)}
      </Badge>
      <span className="inline-flex items-center gap-1.5">
        <Icon name="calendar" className="size-4" />
        {plans('period', {
          start: day(data.delivery.cycle.periodStart),
          end: day(data.delivery.cycle.periodEnd),
        })}
      </span>
    </div>
  ) : undefined;

  let popupNode = null;
  if (data && popup) {
    const lines = data.delivery.lines;
    const line = lines.find((l) => l.lineId === popup.lineId) ?? null;
    const planLine = data.plan.lines.find((l) => l.id === popup.lineId);
    const names = new Map(data.plan.departments.map((d) => [d.id, localName(locale, d.name)]));
    // «Save and next line»: the next line in the table's order (by quarter) that still needs a course.
    const ordered = [...lines].sort((a, b) => a.quarter - b.quarter);
    const after = ordered.slice(ordered.findIndex((l) => l.lineId === popup.lineId) + 1);
    const next = after.find(
      (l) => l.can.createCourse && l.course === null && l.courseDraft !== null,
    );
    popupNode = await LinePopup({
      locale,
      popup,
      line,
      currency: data.delivery.cycle.currency,
      departments: planLine
        ? planLine.departments
            .map((d) => names.get(d.departmentId) ?? '')
            .filter(Boolean)
            .join(t('listSeparator'))
        : null,
      display,
      closeHref: `/${locale}${deliveryPath(cycleId, filter)}`,
      nextHref: next
        ? `/${locale}${deliveryPath(cycleId, filter, { kind: 'course', lineId: next.lineId, mode: 'create' })}`
        : null,
      preview,
    });
  }

  return (
    <SuiteShell locale={locale} context={context} current="planningCycles" path={path}>
      <PlanningHeader locale={locale} title={title} description={description} />
      <div className="flex flex-col gap-6">
        <TabNav
          variant="underline"
          label={plans('tabs.label')}
          current="sessions"
          data-testid="cycle-tabs"
          items={[
            { key: 'progress', href: cyclePath, label: plans('tabs.progress') },
            { key: 'plan', href: `${cyclePath}?tab=plan`, label: plans('tabs.plan') },
            { key: 'sessions', href: `/${locale}${path}`, label: t('tab') },
          ]}
        />
        {preview ? (
          <Alert tone="info" data-testid="delivery-preview">
            {t('previewNote')}
          </Alert>
        ) : null}
        {failure ? (
          <Alert tone="warning" data-testid="delivery-forbidden">
            {failure}
          </Alert>
        ) : null}
        {data ? (
          <>
            <Alert
              tone={data.delivery.plan.status === 'approved' ? 'success' : 'info'}
              data-testid="delivery-plan-note"
            >
              {data.delivery.plan.status === 'approved'
                ? t('lockedNote', { version: data.delivery.plan.planVersion })
                : t('notApproved')}
            </Alert>
            <DeliveryCard
              locale={locale}
              summary={data.delivery.summary}
              calendarHref={`/${locale}${calendarPath({ year: periodYear(data.delivery.cycle.periodStart) })}`}
            />
            <DeliveryLines
              locale={locale}
              cycleId={cycleId}
              delivery={data.delivery}
              plan={data.plan}
              params={filter}
              month={(m) => formatMonth(m, locale, display, 'short')}
            />
          </>
        ) : null}
        {popupNode}
      </div>
    </SuiteShell>
  );
}
