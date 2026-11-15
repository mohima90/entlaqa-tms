import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import type { PlanLineDeliveryView, TrainingCalendarView } from '@jadarat/tms';
import {
  Alert,
  EmptyState,
  Icon,
  PageHeader,
  ProgressBar,
  StatCard,
  StatGrid,
  buttonClasses,
  cn,
} from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { CalendarView } from '../../../../components/plan-delivery/calendar-view';
import { DraftPopup, LinePopup } from '../../../../components/plan-delivery/line-popups';
import { SuiteShell } from '../../../../components/suite-shell';
import { planDeliveryQuery, trainingCalendarQuery } from '../../../../lib/plan-delivery-queries';
import { previewCalendar, previewDelivery } from '../../../../lib/plan-delivery-preview';
import {
  type CalendarParams,
  calendarParams,
  calendarPath,
  deliveryPath,
  deliveryPopup,
} from '../../../../lib/plan-delivery-view';
import { PLANNING_PATHS, localName } from '../../../../lib/planning-view';
import { getSuiteContext } from '../../../../lib/suite-context';

/** The example plan of the preview is for 2027. */
const PREVIEW_YEAR = 2027;

/**
 * The training calendar (WP-LD-04, T-M3-08; FR-PLN-09 «training calendar of drafts», FR-SCH-07; approved design
 * screens 4, 4p and 5, docs/design/screens/m3-plan-to-sessions/README.md): the year's draft sessions of the
 * approved plans, by quarter and month (or as a list — a phone's default), the summary cards, the filters (quarter,
 * branch, course) and «Not drafted yet» under each quarter with its next action. A draft opens in its popup; «Create
 * course» and «Create sessions» open theirs, here. For holders of tms.session.manage (the menu's Calendar); others
 * are refused. Without a database: the example plan's 2027.
 */
export default async function TrainingCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const raw = await searchParams;
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'planDelivery' });
  const errors = await getTranslations({ locale, namespace: 'errors' });
  const approvalT = await getTranslations({ locale, namespace: 'planApproval' });
  const plans = await getTranslations({ locale, namespace: 'trainingPlan' });
  const preview = !context.live;
  // No year in the address: the year of the latest approved plan with drafts (the query decides; review L7).
  const parsed = calendarParams(raw, 0);
  const yearAsked = parsed.year !== 0;
  let query = {
    ...parsed,
    year: yearAsked ? parsed.year : preview ? PREVIEW_YEAR : new Date().getUTCFullYear(),
  };
  const popup = deliveryPopup(raw);
  const display = context.regional.dateDisplay;

  let view: TrainingCalendarView | null = null;
  let failure: string | null = null;
  if (preview) {
    view = previewCalendar({
      year: query.year,
      quarter: query.quarter,
      branch: query.branch,
      course: query.course,
    });
  } else {
    const result = await trainingCalendarQuery({
      ...(yearAsked ? { year: query.year } : {}),
      ...(query.quarter ? { quarter: query.quarter } : {}),
      ...(query.branch ? { branchId: query.branch } : {}),
      ...(query.course ? { courseId: query.course } : {}),
    });
    if (result.ok) {
      view = result.value;
      query = { ...query, year: result.value.year };
    } else {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      failure =
        error.code === 'FORBIDDEN'
          ? errors('forbidden')
          : errors('internalError', { correlationId: error.correlationId ?? '' });
    }
  }

  const href = (next: Partial<CalendarParams>) =>
    `/${locale}${calendarPath({ ...query, draft: null, ...next })}`;
  const closeHref = href({});
  const number = (n: number) => new Intl.NumberFormat(`${locale}-u-nu-latn`).format(n);
  const money = (amount: string, currency: string) => {
    try {
      return new Intl.NumberFormat(`${locale}-u-nu-latn`, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(Number(amount));
    } catch {
      return `${amount} ${currency}`;
    }
  };

  // The popup the address opens: a draft, or «Create course» / «Create sessions» of a line not drafted yet.
  let popupNode: ReactNode = null;
  if (view && query.draft) {
    popupNode = await DraftPopup({
      locale,
      sessionId: query.draft,
      display,
      closeHref,
      preview,
    });
  } else if (view && popup) {
    const waiting = view.quarters
      .flatMap((q) => q.notDrafted)
      .find((l) => l.lineId === popup.lineId);
    let line: PlanLineDeliveryView | null = null;
    let currency = 'SAR';
    if (popup.kind === 'course' && waiting) {
      const delivery = preview
        ? { ok: true as const, value: previewDelivery().delivery }
        : await planDeliveryQuery({ cycleId: waiting.cycleId });
      if (delivery.ok) {
        line = delivery.value.lines.find((l) => l.lineId === popup.lineId) ?? null;
        currency = delivery.value.cycle.currency;
      }
    }
    popupNode = await LinePopup({
      locale,
      popup,
      line,
      currency,
      departments: null,
      display,
      closeHref,
      nextHref: null,
      preview,
    });
  }

  const summary = view?.summary;
  const left = summary ? summary.linesInPlan - summary.linesWithSessions : 0;
  const onePlan = view?.plans.length === 1 ? view.plans[0] : undefined;
  const coursesCount = view
    ? new Set(
        view.quarters.flatMap((q) =>
          q.months.flatMap((m) => m.drafts.map((d) => d.course?.id ?? d.lineId)),
        ),
      ).size
    : 0;

  const header = (
    <PageHeader
      title={t('calendar.title')}
      description={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14.5px]">
          {view?.plans.map((plan) => (
            <span key={plan.planId} className="inline-flex flex-wrap items-center gap-1.5">
              <Icon name="plan" className="size-4" />
              {t('calendar.from')}{' '}
              <a
                href={`/${locale}${PLANNING_PATHS.cycles}/${plan.cycleId}?tab=plan`}
                className="font-semibold text-primary-text underline underline-offset-2"
              >
                {localName(locale, plan.name)}
              </a>
              <span className="text-text-muted">
                ·{' '}
                {plan.status === 'approved'
                  ? approvalT('approvedBadge', { version: plan.planVersion })
                  : plans(`planStatus.${plan.status}`)}
              </span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-text-muted">
            <Icon name="eye-off" className="size-4" />
            {t('calendar.hidden')}
          </span>
        </span>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
          <nav
            aria-label={t('calendar.yearLabel')}
            className="inline-flex items-center rounded-full border-[1.5px] border-border-strong"
          >
            <a
              href={href({ year: query.year - 1, quarter: null })}
              aria-label={t('calendar.previousYear', { year: query.year - 1 })}
              className="grid size-10 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text"
              data-testid="calendar-previous-year"
            >
              <Icon name="chevron-start" className="size-4" />
            </a>
            <span className="px-2 text-lg font-bold tabular-nums" data-testid="calendar-year-label">
              {query.year}
            </span>
            <a
              href={href({ year: query.year + 1, quarter: null })}
              aria-label={t('calendar.nextYear', { year: query.year + 1 })}
              className="grid size-10 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text"
              data-testid="calendar-next-year"
            >
              <Icon name="chevron-end" className="size-4" />
            </a>
          </nav>
          {/* Without a choice the year grid shows from 900 px and the list below (design 4p): each switch says so. */}
          {(['wide', 'narrow'] as const).map((width) => (
            <nav
              key={width}
              aria-label={t('calendar.viewLabel')}
              className={width === 'wide' ? 'hidden lg:block' : 'lg:hidden'}
            >
              <ul className="m-0 flex list-none items-center gap-1 rounded-full bg-surface-hover p-1">
                {(['year', 'list'] as const).map((key) => {
                  const shown = query.view ?? (width === 'wide' ? 'year' : 'list');
                  const current = shown === key;
                  return (
                    <li key={key}>
                      <a
                        href={href({ view: key })}
                        aria-current={current ? 'page' : undefined}
                        className={cn(
                          'inline-flex min-h-9 items-center gap-2 rounded-full px-3.5 text-sm font-semibold no-underline pointer-coarse:min-h-11',
                          current
                            ? 'bg-surface text-text shadow-1'
                            : 'text-text-muted hover:text-text',
                        )}
                        data-testid={`calendar-view-${key}`}
                      >
                        <Icon name={key === 'year' ? 'calendar' : 'menu'} className="size-4" />
                        {t(`calendar.${key}`)}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ))}
        </div>
      }
    />
  );

  const hasLines = view !== null && (view.plans.length > 0 || (summary?.drafts ?? 0) > 0);
  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="calendar"
      path={calendarPath({ ...query, draft: null })}
    >
      {header}
      <div className="flex flex-col gap-6" data-testid="calendar-page">
        {preview ? (
          <Alert tone="info" data-testid="calendar-preview">
            {t('previewNote')}
          </Alert>
        ) : null}
        {failure ? (
          <Alert tone="warning" data-testid="calendar-forbidden">
            {failure}
          </Alert>
        ) : null}
        {view && summary && !hasLines ? (
          <EmptyState
            icon="calendar"
            title={t('calendar.empty.title')}
            description={t('calendar.empty.body')}
            action={
              <span className="flex flex-wrap justify-center gap-2.5">
                <a
                  href={`/${locale}${PLANNING_PATHS.cycles}`}
                  className={buttonClasses({ variant: 'secondary' })}
                >
                  {t('calendar.empty.openPlans')}
                </a>
                <a
                  href={href({ year: query.year + 1, quarter: null })}
                  className={buttonClasses({ variant: 'ghost' })}
                >
                  {t('calendar.empty.nextYear', { year: query.year + 1 })}
                </a>
              </span>
            }
            data-testid="calendar-empty"
          />
        ) : null}
        {view && summary && hasLines ? (
          <>
            <StatGrid label={t('calendar.summary.label')} data-testid="calendar-summary">
              <StatCard
                variant="gradient"
                icon="sessions"
                label={t('calendar.summary.drafts')}
                value={number(summary.drafts)}
                hint={t('calendar.summary.draftsHint', { count: summary.planned })}
              />
              <StatCard
                variant="gradient"
                icon="people"
                label={t('calendar.summary.seats')}
                value={number(summary.seats)}
                hint={t('calendar.summary.seatsHint', { count: coursesCount })}
                className="hidden md:flex"
              />
              <StatCard
                variant="gradient"
                icon="wallet"
                label={t('calendar.summary.cost')}
                value={
                  summary.estimatedCost.length === 0
                    ? '—'
                    : summary.estimatedCost.map((c) => money(c.amount, c.currency)).join(' + ')
                }
                hint={t('calendar.summary.costHint')}
                className="hidden md:flex"
              />
              <div
                className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-6 shadow-1"
                data-testid="calendar-summary-lines"
              >
                <dt className="flex items-center gap-2 text-sm font-medium text-text-muted">
                  <Icon name="plan" className="size-[18px]" />
                  {t('calendar.summary.lines')}
                </dt>
                <dd className="m-0 text-2xl font-bold tabular-nums">
                  {number(summary.linesWithSessions)}{' '}
                  <small className="text-[15px] font-medium text-text-muted">
                    {t('calendar.summary.linesOf', { count: summary.linesInPlan })}
                  </small>
                </dd>
                <dd className="m-0">
                  <ProgressBar
                    value={summary.linesWithSessions}
                    max={summary.linesInPlan}
                    label={t('calendar.summary.lines')}
                  />
                </dd>
                <dd className="m-0 text-sm">
                  {left === 0 ? (
                    <span className="text-text-muted">{t('calendar.summary.linesDone')}</span>
                  ) : onePlan ? (
                    <a
                      href={`/${locale}${deliveryPath(onePlan.cycleId, { show: 'needs_sessions' })}`}
                      className="font-semibold text-primary-text underline underline-offset-2"
                    >
                      {t('calendar.summary.linesLeft', { count: left })}
                    </a>
                  ) : (
                    <span>{t('calendar.summary.linesLeft', { count: left })}</span>
                  )}
                </dd>
              </div>
            </StatGrid>
            <CalendarView locale={locale} view={view} params={query} display={display} />
          </>
        ) : null}
        {popupNode}
      </div>
    </SuiteShell>
  );
}
