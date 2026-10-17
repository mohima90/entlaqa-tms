import { toClientError } from '@jadarat/platform-core';
import type { AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import type { CyclesListView } from '@jadarat/tms';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Icon,
  StatCard,
  StatGrid,
  TabNav,
  buttonClasses,
  tableClasses,
} from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PlanningHeader } from '../../../../../components/planning/planning-header';
import { SuiteShell } from '../../../../../components/suite-shell';
import { dayFormatter } from '../../../../../lib/planning-format';
import { planCyclesListQuery } from '../../../../../lib/planning-queries';
import {
  CYCLE_TABS,
  CYCLE_TONE,
  PLANNING_PATHS,
  cycleHref,
  cycleTab,
  filterCycles,
  localName,
} from '../../../../../lib/planning-view';
import { getSuiteContext } from '../../../../../lib/suite-context';

const PATH = PLANNING_PATHS.cycles;

/**
 * Planning → Cycles (EP-PLN screen 3; Kawadir Requisitions layout): summary cards, status tabs with counts
 * and the cycles in a table inside a card. The L&D Manager starts new cycles and continues the set-up of
 * drafts; the Training Coordinator follows them (read only). Everyone else is refused (deny by default).
 */
export default async function PlanningCyclesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const query = await searchParams;
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'planning.list' });

  let content: ReactNode;
  let canManage = false;
  if (!context.live) {
    content = (
      <>
        <Alert tone="info" data-testid="planning-not-configured">
          {t('notConfigured')}
        </Alert>
        <CyclesList
          locale={locale}
          view={{
            today: '',
            cycles: [],
            counts: { all: 0, draft: 0, open: 0, closed: 0 },
            canManage: false,
          }}
          tab="all"
          display={context.regional.dateDisplay}
        />
      </>
    );
  } else {
    const result = await planCyclesListQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'FORBIDDEN') {
        const errors = await getTranslations({ locale, namespace: 'errors' });
        content = (
          <Alert tone="warning" data-testid="planning-forbidden">
            {errors('forbidden')}
          </Alert>
        );
      } else {
        content = (
          <Alert tone="danger">
            {t('loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
      }
    } else {
      canManage = result.value.canManage;
      content = (
        <>
          {query.deleted === '1' ? (
            <Alert tone="success" data-testid="cycle-deleted">
              {t('deleted')}
            </Alert>
          ) : null}
          <CyclesList
            locale={locale}
            view={result.value}
            tab={cycleTab(query.tab)}
            display={context.regional.dateDisplay}
          />
        </>
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="planningCycles" path={PATH}>
      <PlanningHeader
        locale={locale}
        title={t('title')}
        description={t('intro')}
        withCycles={false}
        actions={
          canManage ? (
            <a
              href={`/${locale}${PLANNING_PATHS.newCycle}`}
              className={buttonClasses({ variant: 'primary', size: 'md' })}
              data-testid="new-cycle-link"
            >
              <Icon name="plus" />
              {t('newCycle')}
            </a>
          ) : null
        }
      />
      <div className="flex flex-col gap-6">{content}</div>
    </SuiteShell>
  );
}

async function CyclesList({
  locale,
  view,
  tab,
  display,
}: {
  locale: AppLocale;
  view: CyclesListView;
  tab: (typeof CYCLE_TABS)[number];
  display: Parameters<typeof dayFormatter>[1];
}) {
  const t = await getTranslations({ locale, namespace: 'planning' });
  const format = await getFormatter({ locale });
  const day = dayFormatter(locale, display);
  const number = (n: number) => format.number(n, 'integer');
  const cycles = filterCycles(view.cycles, tab);
  const tabHref = (key: string) => `/${locale}${PATH}${key === 'all' ? '' : `?tab=${key}`}`;

  return (
    <>
      <StatGrid label={t('list.statsLabel')} data-testid="cycles-stats">
        <StatCard
          variant="gradient"
          label={t('list.stats.total')}
          value={number(view.counts.all)}
          icon="plan"
        />
        <StatCard
          variant="gradient"
          label={t('list.stats.draft')}
          value={number(view.counts.draft)}
          icon="pencil"
        />
        <StatCard
          variant="gradient"
          label={t('list.stats.open')}
          value={number(view.counts.open)}
          icon="flag"
        />
        <StatCard
          variant="gradient"
          label={t('list.stats.closed')}
          value={number(view.counts.closed)}
          icon="lock"
        />
      </StatGrid>

      <TabNav
        label={t('list.tabsLabel')}
        current={tab}
        items={CYCLE_TABS.map((key) => ({
          key,
          href: tabHref(key),
          label: t(`list.tabs.${key}`),
          count: number(view.counts[key]),
        }))}
        data-testid="cycles-tabs"
      />

      <Card
        flush
        title={t('list.cardTitle')}
        description={t('list.cardDescription')}
        data-testid="cycles-card"
      >
        {cycles.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon="plan"
              title={view.cycles.length === 0 ? t('list.emptyTitle') : t('list.emptyTabTitle')}
              description={
                view.cycles.length === 0
                  ? view.canManage
                    ? t('list.emptyBody')
                    : t('list.emptyReadBody')
                  : undefined
              }
              action={
                view.canManage && view.cycles.length === 0 ? (
                  <a
                    href={`/${locale}${PLANNING_PATHS.newCycle}`}
                    className={buttonClasses({ variant: 'primary', size: 'md' })}
                  >
                    <Icon name="plus" />
                    {t('list.newCycle')}
                  </a>
                ) : undefined
              }
              data-testid="cycles-empty"
            />
          </div>
        ) : (
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table} data-testid="cycles-table">
              <caption className="sr-only">{t('list.tableCaption')}</caption>
              <thead className={tableClasses.header}>
                <tr>
                  {(['name', 'period', 'deadline', 'status', 'departments'] as const).map((key) => (
                    <th key={key} scope="col" className={tableClasses.head}>
                      {t(`list.columns.${key}`)}
                    </th>
                  ))}
                  <th scope="col" className={`${tableClasses.head} text-end`}>
                    {t('list.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((cycle) => {
                  const name = localName(locale, cycle.name);
                  const draft = cycle.status === 'draft';
                  return (
                    <tr key={cycle.id} className={tableClasses.row} data-testid="cycle-row">
                      <th scope="row" className={`${tableClasses.cell} text-start font-medium`}>
                        <a href={cycleHref(locale, cycle.id)}>{name}</a>
                      </th>
                      <td className={tableClasses.cell}>
                        {day(cycle.periodStart)} – {day(cycle.periodEnd)}
                      </td>
                      <td className={tableClasses.cell}>{day(cycle.deadline)}</td>
                      <td className={tableClasses.cell}>
                        <Badge tone={CYCLE_TONE[cycle.status]} data-testid="cycle-status">
                          {t(`status.${cycle.status}`)}
                        </Badge>
                      </td>
                      <td className={tableClasses.cell}>
                        {draft
                          ? t('list.departmentCount', { count: cycle.departmentCount })
                          : t('list.submitted', {
                              submitted: number(cycle.submittedCount),
                              count: number(cycle.departmentCount),
                            })}
                      </td>
                      <td className={`${tableClasses.cell} text-end`}>
                        <a
                          href={cycleHref(locale, cycle.id)}
                          className="inline-grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
                          aria-label={
                            draft && view.canManage
                              ? t('list.continueSetup', { name })
                              : t('list.openCycle', { name })
                          }
                        >
                          <Icon name={draft && view.canManage ? 'pencil' : 'chevron-end'} />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
