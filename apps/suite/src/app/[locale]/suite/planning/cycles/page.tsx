import { toClientError } from '@jadarat/platform-core';
import type { AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import type { CycleListItem, CyclesListView } from '@jadarat/tms';
import {
  Alert,
  Badge,
  EmptyState,
  Icon,
  ListCard,
  ListCards,
  ProgressBar,
  buttonClasses,
  tableClasses,
} from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { FlagToast } from '../../../../../components/flag-toast';
import { PlanningHeader } from '../../../../../components/planning/planning-header';
import { SuiteShell } from '../../../../../components/suite-shell';
import { dayFormatter } from '../../../../../lib/planning-format';
import { planCyclesListQuery } from '../../../../../lib/planning-queries';
import {
  CYCLE_TONE,
  PLANNING_PATHS,
  cycleHref,
  daysLeft,
  groupCycles,
  localName,
} from '../../../../../lib/planning-view';
import { getSuiteContext } from '../../../../../lib/suite-context';

const PATH = PLANNING_PATHS.cycles;

/**
 * Planning → Cycles (EP-PLN screen 3; redesign package 4): the cycles grouped by status — the open cycle as
 * a card with its progress and the days left, the drafts as cards to continue their set-up, the closed ones
 * in a short table (cards on phones); a first-use empty state explains how a cycle works. The L&D Manager
 * starts new cycles and continues drafts; the Training Coordinator follows them (read only). Everyone else
 * is refused (deny by default).
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
          {/* «Draft deleted» comes back as a toast (redesign package 4). */}
          {query.deleted === '1' ? <FlagToast message={t('deleted')} param="deleted" /> : null}
          <CyclesList locale={locale} view={result.value} display={context.regional.dateDisplay} />
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

/** A group's heading with its count next to it (the counts replace the summary cards). */
function GroupHeading({
  id,
  title,
  count,
  note,
}: {
  id: string;
  title: string;
  count?: string;
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <h2 id={id} className="m-0 text-[22px] font-bold">
        {title}
      </h2>
      {count !== undefined ? (
        <span className="grid min-w-6 place-items-center rounded-full bg-surface-hover px-2 text-[13px] font-semibold text-text-muted">
          {count}
        </span>
      ) : null}
      {note ? <p className="m-0 ms-auto text-sm text-text-muted">{note}</p> : null}
    </div>
  );
}

async function CyclesList({
  locale,
  view,
  display,
}: {
  locale: AppLocale;
  view: CyclesListView;
  display: Parameters<typeof dayFormatter>[1];
}) {
  const t = await getTranslations({ locale, namespace: 'planning' });
  const format = await getFormatter({ locale });
  const day = dayFormatter(locale, display);
  const number = (n: number) => format.number(n, 'integer');
  const groups = groupCycles(view.cycles);
  const units = (cycle: CycleListItem) =>
    cycle.status === 'draft'
      ? t('list.departmentCount', { count: cycle.departmentCount })
      : t('list.submitted', {
          submitted: number(cycle.submittedCount),
          count: number(cycle.departmentCount),
        });
  const newCycle = (
    <a
      href={`/${locale}${PLANNING_PATHS.newCycle}`}
      className={buttonClasses({ variant: 'primary', size: 'md' })}
    >
      <Icon name="plus" />
      {t('list.newCycle')}
    </a>
  );

  if (view.cycles.length === 0) {
    return (
      <section
        className="rounded-xl border border-border bg-surface shadow-2"
        data-testid="cycles-empty"
      >
        <EmptyState
          icon="flag"
          title={t('list.emptyTitle')}
          description={view.canManage ? t('list.emptyBody') : t('list.emptyReadBody')}
          steps={
            view.canManage
              ? (['how1', 'how2', 'how3'] as const).map((key) => ({ title: t(`list.${key}`) }))
              : undefined
          }
          stepsTitle={t('list.howTitle')}
        />
        {view.canManage ? <div className="-mt-5 flex justify-center pb-10">{newCycle}</div> : null}
      </section>
    );
  }

  return (
    <>
      {groups.open.length > 0 ? (
        <section
          aria-labelledby="cycles-open"
          className="flex flex-col gap-3.5"
          data-testid="cycles-open"
        >
          <GroupHeading id="cycles-open" title={t('list.tabs.open')} />
          {groups.open.map((cycle) => {
            const name = localName(locale, cycle.name);
            const submitted = t('list.submitted', {
              submitted: number(cycle.submittedCount),
              count: number(cycle.departmentCount),
            });
            return (
              <article
                key={cycle.id}
                aria-labelledby={`cycle-${cycle.id}`}
                className="relative grid grid-cols-1 gap-5 overflow-hidden rounded-[26px] bg-stat-gradient px-4.5 py-5.5 text-on-brand md:px-7.5 md:py-7 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] xl:gap-7"
                data-testid="cycle-hero"
              >
                <div className="relative z-[1] min-w-0">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-on-brand/15 px-2.5 py-0.5 text-[13px] font-semibold">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                    <span data-testid="cycle-status">{t(`status.${cycle.status}`)}</span>
                  </span>
                  <h3
                    id={`cycle-${cycle.id}`}
                    className="m-0 mt-2.5 text-2xl font-bold leading-tight tracking-[-0.015em] md:text-[30px]"
                  >
                    {name}
                  </h3>
                  <dl className="m-0 mt-4 flex flex-wrap gap-x-5.5 gap-y-2.5 text-[14.5px]">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-[13px] opacity-90">{t('list.columns.period')}</dt>
                      <dd className="m-0 font-semibold">
                        {day(cycle.periodStart)} – {day(cycle.periodEnd)}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-[13px] opacity-90">{t('list.columns.deadline')}</dt>
                      <dd className="m-0 font-semibold">{day(cycle.deadline)}</dd>
                    </div>
                  </dl>
                </div>
                <div className="relative z-[1] flex flex-col justify-center gap-3 rounded-[20px] border border-on-brand/25 bg-on-brand/10 px-5.5 py-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[34px] font-bold leading-[1.1] tabular-nums">
                      {number(cycle.submittedCount)}
                      <small className="ms-1.5 text-[15px] font-medium">
                        / {number(cycle.departmentCount)}
                      </small>
                    </span>
                    {view.today ? (
                      <span
                        className="inline-flex items-center gap-1.5 font-semibold"
                        data-testid="cycle-days-left"
                      >
                        <Icon name="clock" className="size-4" />
                        {t('list.daysLeft', {
                          count: Math.max(daysLeft(view.today, cycle.deadline), 0),
                        })}
                      </span>
                    ) : null}
                  </div>
                  <ProgressBar
                    tone="on-brand"
                    value={cycle.submittedCount}
                    max={cycle.departmentCount}
                    label={submitted}
                  />
                  <span>{submitted}</span>
                  <a
                    href={cycleHref(locale, cycle.id)}
                    aria-label={t('list.openCycle', { name })}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-on-brand px-5 font-semibold text-brand no-underline focus-visible:outline-on-brand"
                    data-testid="cycle-open-link"
                  >
                    {t('list.viewProgress')}
                    <Icon name="arrow-end" className="size-4" />
                  </a>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {groups.drafts.length > 0 ? (
        <section
          aria-labelledby="cycles-drafts"
          className="flex flex-col gap-3.5"
          data-testid="cycles-drafts"
        >
          <GroupHeading
            id="cycles-drafts"
            title={t('list.tabs.draft')}
            count={number(groups.drafts.length)}
            note={t('list.cardDescription')}
          />
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
            {groups.drafts.map((cycle) => {
              const name = localName(locale, cycle.name);
              return (
                <li key={cycle.id} data-testid="cycle-draft">
                  <article
                    aria-labelledby={`cycle-${cycle.id}`}
                    className="flex h-full flex-col gap-3.5 rounded-[22px] border border-border bg-surface px-5.5 py-5 hover:border-border-strong"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="grid size-[42px] shrink-0 place-items-center rounded-[14px] bg-primary-subtle text-primary-text"
                      >
                        <Icon name="pencil" className="size-4" />
                      </span>
                      <h3
                        id={`cycle-${cycle.id}`}
                        className="m-0 min-w-0 flex-1 text-[17px] font-bold leading-snug"
                      >
                        {view.canManage ? name : <a href={cycleHref(locale, cycle.id)}>{name}</a>}
                      </h3>
                      <Badge tone={CYCLE_TONE[cycle.status]} dot data-testid="cycle-status">
                        {t(`status.${cycle.status}`)}
                      </Badge>
                    </div>
                    <dl className="m-0 grid gap-1.5 text-sm">
                      {(
                        [
                          ['period', `${day(cycle.periodStart)} – ${day(cycle.periodEnd)}`],
                          ['deadline', day(cycle.deadline)],
                          ['departments', units(cycle)],
                        ] as const
                      ).map(([key, value]) => (
                        <div key={key} className="flex gap-2">
                          <dt className="min-w-24 text-text-muted md:min-w-30">
                            {t(`list.columns.${key}`)}
                          </dt>
                          <dd className="m-0 font-medium">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {view.canManage ? (
                      <div className="mt-auto flex">
                        <a
                          href={cycleHref(locale, cycle.id)}
                          aria-label={t('list.continueSetup', { name })}
                          className={buttonClasses({
                            variant: 'secondary',
                            size: 'sm',
                            className: 'w-full md:w-auto',
                          })}
                          data-testid="cycle-continue"
                        >
                          {t('list.continue')}
                          <Icon name="arrow-end" className="size-4" />
                        </a>
                      </div>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {groups.closed.length > 0 ? (
        <section
          aria-labelledby="cycles-closed"
          className="flex flex-col gap-3.5"
          data-testid="cycles-closed"
        >
          <GroupHeading
            id="cycles-closed"
            title={t('list.tabs.closed')}
            count={number(groups.closed.length)}
          />
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-2">
            <div className={`${tableClasses.wrapper} hidden md:block`}>
              <table className={tableClasses.table} data-testid="cycles-table">
                <caption className="sr-only">{t('list.tableCaption')}</caption>
                <thead className={tableClasses.header}>
                  <tr>
                    {(['name', 'period', 'deadline', 'departments', 'status'] as const).map(
                      (key) => (
                        <th key={key} scope="col" className={tableClasses.head}>
                          {t(`list.columns.${key}`)}
                        </th>
                      ),
                    )}
                    <th scope="col" className={tableClasses.head}>
                      <span className="sr-only">{t('list.columns.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups.closed.map((cycle) => {
                    const name = localName(locale, cycle.name);
                    return (
                      <tr key={cycle.id} className={tableClasses.row} data-testid="cycle-row">
                        <th scope="row" className={`${tableClasses.cell} text-start font-medium`}>
                          <a href={cycleHref(locale, cycle.id)}>{name}</a>
                        </th>
                        <td className={`${tableClasses.cell} text-sm`}>
                          <span className="block">{day(cycle.periodStart)}</span>
                          <span className="block">
                            <span aria-hidden="true" className="text-text-subtle">
                              {locale === 'ar' ? '← ' : '→ '}
                            </span>
                            {day(cycle.periodEnd)}
                          </span>
                        </td>
                        <td className={`${tableClasses.cell} text-sm`}>{day(cycle.deadline)}</td>
                        <td className={tableClasses.cell}>{units(cycle)}</td>
                        <td className={tableClasses.cell}>
                          <Badge tone={CYCLE_TONE[cycle.status]} dot data-testid="cycle-status">
                            {t(`status.${cycle.status}`)}
                          </Badge>
                        </td>
                        <td className={`${tableClasses.cell} text-end`}>
                          <a
                            href={cycleHref(locale, cycle.id)}
                            className="inline-grid size-9 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
                            aria-label={t('list.openCycle', { name })}
                          >
                            <Icon name="chevron-end" />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ListCards aria-label={t('list.tableCaption')}>
              {groups.closed.map((cycle) => (
                <ListCard
                  key={cycle.id}
                  title={<a href={cycleHref(locale, cycle.id)}>{localName(locale, cycle.name)}</a>}
                  detail={
                    <>
                      <span className="block">
                        {day(cycle.periodStart)} – {day(cycle.periodEnd)}
                      </span>
                      <span className="block">{units(cycle)}</span>
                    </>
                  }
                  status={
                    <Badge tone={CYCLE_TONE[cycle.status]} dot>
                      {t(`status.${cycle.status}`)}
                    </Badge>
                  }
                  action={<Icon name="chevron-end" className="size-4 text-text-muted" />}
                />
              ))}
            </ListCards>
          </div>
        </section>
      ) : null}
    </>
  );
}
