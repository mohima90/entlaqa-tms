import { toClientError } from '@jadarat/platform-core';
import type { AppLocale, DateDisplay } from '@jadarat/platform-i18n';
import { formatDisplayDate } from '@jadarat/platform-i18n/dates';
import { routing } from '@jadarat/platform-i18n/routing';
import type { CycleView } from '@jadarat/tms';
import { earliestExtension } from '@jadarat/tms/planning-rules';
import { Alert, Badge, Card, Icon, ProgressBar } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { FlagToast } from '../../../../../../components/flag-toast';
import { ExtendDeadlineButton } from '../../../../../../components/planning/cycle-action-buttons';
import { PlanningHeader } from '../../../../../../components/planning/planning-header';
import { ProgressTable } from '../../../../../../components/planning/progress-table';
import { RefreshOnReturn } from '../../../../../../components/latest-version';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { cycleDepartmentHref } from '../../../../../../lib/needs-view';
import { dayFormatter, formatAmount } from '../../../../../../lib/planning-format';
import {
  planCycleQuery,
  planningErrorTexts,
  planningTexts,
} from '../../../../../../lib/planning-queries';
import {
  CYCLE_TONE,
  FORM_TONE,
  PLANNING_PATHS,
  STATUS_FILTERS,
  daysLeft,
  legacyStepHref,
  localName,
  statusCounts,
} from '../../../../../../lib/planning-view';
import {
  showsUnitLevels,
  unitNameWithLevel,
  unitsLabel,
} from '../../../../../../lib/structure-view';
import { getSuiteContext } from '../../../../../../lib/suite-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One planning cycle (EP-PLN screen 5): its progress with status chips that filter the departments, and
 * the deadline extension while it is open. A draft has no page of its own any more (the Kawadir pattern,
 * WP-UX-01 a / T-M3-20): the member who may change it is sent to its Settings — or, from an address of the
 * old six-step set-up, to the place that replaced that step; readers see the departments it will cover.
 */
export default async function PlanCyclePage({
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
  const t = await getTranslations({ locale, namespace: 'planning' });
  const path = `${PLANNING_PATHS.cycles}/${cycleId}`;

  let title = t('list.title');
  let description: ReactNode;
  let content: ReactNode;
  let actions: ReactNode = null;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="planning-not-configured">
        {t('list.notConfigured')}
      </Alert>
    );
  } else {
    const result = await planCycleQuery({ id: cycleId });
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'NOT_FOUND') notFound();
      const errors = await getTranslations({ locale, namespace: 'errors' });
      content =
        error.code === 'FORBIDDEN' ? (
          <Alert tone="warning" data-testid="planning-forbidden">
            {errors('forbidden')}
          </Alert>
        ) : (
          <Alert tone="danger">
            {t('list.loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
    } else {
      const view = result.value;
      const day = dayFormatter(locale, context.regional.dateDisplay);
      title = localName(locale, { ar: view.cycle.nameAr, en: view.cycle.nameEn });
      // A draft the member may change: its Settings (old set-up addresses go where their step went).
      if (view.editable) redirect(legacyStepHref(locale, cycleId, query.step));
      const left = daysLeft(view.today, view.cycle.deadline);
      description = (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14.5px]">
          <Badge tone={CYCLE_TONE[view.status]} dot data-testid="cycle-status">
            {t(`status.${view.status}`)}
          </Badge>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="calendar" className="size-4" />
            {t('cycle.deadline')}:{' '}
            <b className="text-text" data-testid="cycle-deadline">
              {day(view.cycle.deadline)}
            </b>
          </span>
          {view.status === 'open' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-subtle px-2.5 py-0.5 text-[13.5px] font-semibold text-primary-text">
              <Icon name="clock" className="size-3.5" />
              {t('list.daysLeft', { count: Math.max(left, 0) })}
            </span>
          ) : null}
          {view.cycle.launchedAt ? (
            <span>
              {t('cycle.launchedOn', {
                date: formatDisplayDate(view.cycle.launchedAt, {
                  locale,
                  display: context.regional.dateDisplay,
                  timeZone: context.regional.timeZone,
                  style: 'date',
                }),
              })}
            </span>
          ) : null}
        </div>
      );
      if (view.canExtend) {
        actions = (
          <ExtendDeadlineButton
            locale={locale}
            cycle={{ id: view.cycle.id, version: view.cycle.version }}
            texts={planningTexts(locale)}
            errors={await planningErrorTexts(locale)}
            deadline={view.cycle.deadline}
            earliest={earliestExtension(view.cycle.deadline, view.today)}
            periodEnd={view.cycle.periodEnd}
            hint={t('cycle.extendHint', { end: day(view.cycle.periodEnd) })}
            display={context.regional.dateDisplay}
          />
        );
      }
      content = await Overview({
        locale,
        view,
        launched: query.launched === '1',
        display: context.regional.dateDisplay,
      });
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="planningCycles" path={path}>
      <PlanningHeader locale={locale} title={title} description={description} actions={actions} />
      <div className="flex flex-col gap-6">{content}</div>
      <RefreshOnReturn />
    </SuiteShell>
  );
}

async function Overview({
  locale,
  view,
  launched,
  display,
}: {
  locale: AppLocale;
  view: CycleView;
  launched: boolean;
  display: DateDisplay;
}) {
  const t = await getTranslations({ locale, namespace: 'planning' });
  const day = dayFormatter(locale, display);
  const format = await getFormatter({ locale });
  const number = (n: number) => format.number(n, 'integer');
  const counts = statusCounts(view.departments.map((d) => d.status));
  // The organization's own level names (guided-test feedback #3).
  const ordinals = view.departments.map((d) => d.levelOrdinal);
  const withLevels = showsUnitLevels(view.levels, ordinals);
  const instructions =
    locale === 'ar'
      ? (view.cycle.instructionsAr ?? view.cycle.instructionsEn)
      : (view.cycle.instructionsEn ?? view.cycle.instructionsAr);
  const submitted = t('list.submitted', {
    submitted: number(counts.submitted),
    count: number(counts.all),
  });

  return (
    <>
      {launched ? <FlagToast message={t('setup.launch.launched')} param="launched" /> : null}
      {view.status === 'closed' ? <Alert tone="info">{t('cycle.closedNote')}</Alert> : null}
      <Card
        title={t('cycle.progressTitle')}
        description={`${t('cycle.progressIntroNeeds')} ${t('cycle.remindSoon')}`}
        data-testid="progress-card"
      >
        {/* TODO(BACKLOG T-M3-04 follow-up): «Send reminder» per department with in-app notifications (FR-NTF-01). */}
        <div className="flex flex-col gap-2.5" data-testid="progress-summary">
          <span className="text-[34px] font-bold leading-[1.1] tabular-nums">
            {number(counts.submitted)}
            <small className="ms-1.5 text-[15px] font-medium text-text-muted">
              / {number(counts.all)}
            </small>
          </span>
          <ProgressBar value={counts.submitted} max={counts.all} label={submitted} />
          <span className="text-text-muted">{submitted}</span>
        </div>
        <div className="mt-5">
          <ProgressTable
            rows={view.departments.map((row) => ({
              id: row.departmentId,
              name: unitNameWithLevel(
                localName(locale, row.name),
                row.levelOrdinal,
                view.levels,
                locale,
                withLevels,
              ),
              head: row.head
                ? row.head.via
                  ? t('cycle.headVia', {
                      name: localName(locale, row.head.name),
                      unit: localName(locale, row.head.via),
                    })
                  : localName(locale, row.head.name)
                : null,
              envelope:
                row.budgetAmount === null
                  ? t('cycle.noEnvelope')
                  : formatAmount(locale, row.budgetAmount, view.cycle.currency),
              status: row.status,
              statusLabel: t(`cycle.formStatus.${row.status}`),
              tone: FORM_TONE[row.status],
              needs:
                row.needs.count === 0
                  ? t('cycle.noEnvelope')
                  : t('cycle.needsCell', { needs: row.needs.count, seats: row.needs.seats }),
              note:
                row.deadline !== view.cycle.deadline
                  ? t('cycle.extendedTo', { date: day(row.deadline) })
                  : null,
              href:
                view.cycle.status === 'draft'
                  ? null
                  : cycleDepartmentHref(locale, view.cycle.id, row.departmentId),
              viewLabel: t('cycle.viewNeeds', { name: localName(locale, row.name) }),
            }))}
            counts={
              Object.fromEntries(STATUS_FILTERS.map((key) => [key, number(counts[key])])) as Record<
                (typeof STATUS_FILTERS)[number],
                string
              >
            }
            texts={{
              filterLabel: t('cycle.filterLabel'),
              caption: t('cycle.tableCaption'),
              noHead: t('cycle.noHead'),
              envelope: t('cycle.columns.envelope'),
              chips: {
                all: t('cycle.filterAll'),
                not_started: t('cycle.formStatus.not_started'),
                draft: t('cycle.formStatus.draft'),
                submitted: t('cycle.formStatus.submitted'),
                returned: t('cycle.formStatus.returned'),
                late: t('cycle.formStatus.late'),
              },
              columns: {
                department: unitsLabel(
                  view.levels,
                  ordinals,
                  locale,
                  t('cycle.columns.department'),
                ),
                head: t('cycle.columns.head'),
                envelope: t('cycle.columns.envelope'),
                needs: t('cycle.columns.needs'),
                status: t('cycle.columns.status'),
                actions: t('cycle.columns.actions'),
              },
              view: t('cycle.view'),
              emptyFilter: t('cycle.emptyFilter'),
              showAll: t('cycle.showAllForms'),
            }}
          />
        </div>
      </Card>

      {/* The approval chain is no longer part of a cycle (EP-PLN §13 e): a stored one is not shown. */}
      {instructions ? (
        <Card title={t('cycle.instructions')}>
          <p className="m-0 whitespace-pre-line">{instructions}</p>
        </Card>
      ) : null}
    </>
  );
}
