import type { AppLocale } from '@jadarat/platform-i18n';
import type { PlanDeliveryView, PlanLineDeliveryView, PlanView } from '@jadarat/tms';
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  ListSearch,
  buttonClasses,
  cn,
  tableClasses,
} from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { courseSettingsHref } from '../../lib/courses-view';
import {
  DELIVERY_FILTERS,
  type DeliveryParams,
  calendarPath,
  deliveryPath,
  lineFilter,
  periodYear,
} from '../../lib/plan-delivery-view';
import { localName } from '../../lib/planning-view';
import { planAmount, planNumber } from '../../lib/training-plan-view';

type Line = PlanLineDeliveryView;

export interface DeliveryLinesProps {
  readonly locale: AppLocale;
  readonly cycleId: string;
  readonly delivery: PlanDeliveryView;
  /** The Plan tab's view of the same plan: department names, the lines' costs and departments. */
  readonly plan: PlanView;
  readonly params: DeliveryParams;
  /** `YYYY-MM` → «Jan». */
  readonly month: (month: string) => string;
}

/**
 * The approved plan's lines with their **Course** and **Draft sessions** (WP-LD-04, design screen 1): grouped by
 * quarter — each quarter saying how many of its lines have their sessions —, the filter pills (All · Needs a
 * course · Needs sessions · Sessions created) and the search as addresses, a table on wide screens and one card per
 * line on a phone with the actions as buttons. Every action is a link that opens its popup by its address: the
 * page renders on the server and ships no code of its own but the popups.
 */
export async function DeliveryLines({
  locale,
  cycleId,
  delivery,
  plan,
  params,
  month,
}: DeliveryLinesProps) {
  const t = await getTranslations({ locale, namespace: 'planDelivery' });
  const courses = await getTranslations({ locale, namespace: 'courses' });
  const amount = (value: string) =>
    planAmount(locale, value, delivery.cycle.currency, plan.fractionDigits);
  const number = (value: number) => planNumber(locale, value);
  const planLines = new Map(plan.lines.map((l) => [l.id, l]));
  const departmentName = new Map(plan.departments.map((d) => [d.id, localName(locale, d.name)]));
  const filterOf = (line: Line) =>
    lineFilter({ status: line.status, hasCourse: line.course !== null, state: line.state });
  const needle = params.q.toLocaleLowerCase();
  const shown = delivery.lines.filter(
    (line) =>
      (params.show === 'all' || filterOf(line) === params.show) &&
      (needle === '' ||
        line.title.toLocaleLowerCase().includes(needle) ||
        (line.course?.code.toLocaleLowerCase().includes(needle) ?? false)),
  );
  const counts: Record<(typeof DELIVERY_FILTERS)[number], number> = {
    all: delivery.lines.length,
    needs_course: delivery.counts.needsCourse,
    needs_sessions: delivery.counts.needsSessions,
    sessions_created: delivery.counts.sessionsCreated,
  };
  const href = (popup: Parameters<typeof deliveryPath>[2]) =>
    `/${locale}${deliveryPath(cycleId, params, popup)}`;
  const quarterName = (quarter: number) => t(`quarter.q${String(quarter)}`);
  const courseTitle = (course: NonNullable<Line['course']>) =>
    localName(locale, { ar: course.titleAr, en: course.titleEn });

  const detail = (line: Line) => {
    const departments = (planLines.get(line.lineId)?.departments ?? []).map(
      (d) => departmentName.get(d.departmentId) ?? t('otherDepartment'),
    );
    const names =
      departments.length > 2
        ? `${departments.slice(0, 2).join(t('listSeparator'))} ${t('moreDepartments', { count: departments.length - 2 })}`
        : departments.join(t('listSeparator'));
    return [line.deliveryType ? courses(`deliveryTypes.${line.deliveryType}`) : null, names]
      .filter(Boolean)
      .join(' · ');
  };

  const courseCell = (line: Line): ReactNode => {
    if (line.status === 'left_out') {
      return (
        <Badge tone="neutral" className="border-dashed" data-testid="delivery-left-out">
          <Icon name="ban" className="size-3.5" />
          {t('course.leftOut')}
        </Badge>
      );
    }
    if (line.course) {
      return (
        <span className="flex min-w-0 flex-col" data-testid="delivery-course">
          <a
            href={courseSettingsHref(locale, line.course.id)}
            className="w-fit font-semibold text-primary-text underline underline-offset-2"
          >
            {courseTitle(line.course)}
          </a>
          <span className="text-sm text-text-muted">
            {line.course.code} · {t(`course.origin.${line.course.origin}`)}
            {line.course.status === 'archived' ? ` · ${t('course.archived')}` : ''}
          </span>
        </span>
      );
    }
    if (!line.can.createCourse && !line.can.linkCourse) {
      return <span className="text-sm text-text-muted">{t('course.none')}</span>;
    }
    return (
      <span className="flex flex-wrap items-center gap-2">
        {line.can.createCourse ? (
          <a
            href={href({ kind: 'course', lineId: line.lineId, mode: 'create' })}
            className={cn(
              buttonClasses({ variant: 'secondary', size: 'sm' }),
              'gap-1.5 whitespace-nowrap',
            )}
            aria-label={t('course.createLabel', { title: line.title })}
            data-testid="delivery-create-course"
          >
            <Icon name="plus" className="size-4" />
            {t('course.create')}
          </a>
        ) : null}
        {line.can.linkCourse ? (
          <a
            href={href({ kind: 'course', lineId: line.lineId, mode: 'link' })}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-primary-text hover:underline pointer-coarse:min-h-11"
            aria-label={t('course.linkLabel', { title: line.title })}
            data-testid="delivery-link-course"
          >
            <Icon name="copy" className="size-4" />
            {t('course.link')}
          </a>
        ) : null}
      </span>
    );
  };

  const draftsCell = (line: Line): ReactNode => {
    const planned = line.plannedSessions ?? 0;
    const months = line.drafts.months.map(month).join(t('monthsSeparator'));
    const create = line.can.createSessions ? (
      <a
        href={href({ kind: 'sessions', lineId: line.lineId })}
        className={cn(
          buttonClasses({ variant: 'primary', size: 'sm' }),
          'gap-1.5 whitespace-nowrap',
        )}
        aria-label={t('drafts.createLabel', { title: line.title })}
        data-testid="delivery-create-sessions"
      >
        <Icon name="calendar" className="size-4" />
        {t('drafts.create')}
      </a>
    ) : null;
    const outside =
      line.drafts.outsideQuarter > 0 ? (
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-warning">
          <Icon name="warning" className="size-3.5" />
          {t('drafts.outside', { count: line.drafts.outsideQuarter })}
        </span>
      ) : null;
    switch (line.state) {
      case 'left_out':
        return <span className="text-text-muted">—</span>;
      case 'needs_course':
        return (
          <span className="flex flex-col text-sm text-text-muted">
            <span>{t('drafts.afterCourse')}</span>
            <span>{t('drafts.of', { count: 0, planned })}</span>
          </span>
        );
      case 'needs_size':
        return <span className="text-sm text-text-muted">{t('drafts.noSize')}</span>;
      case 'needs_sessions':
        return (
          <span className="flex flex-col items-start gap-1">
            {create}
            <span className="text-sm text-text-muted">{t('drafts.of', { count: 0, planned })}</span>
          </span>
        );
      case 'partly_drafted':
        return (
          <span className="flex flex-col items-start gap-1" data-testid="delivery-drafts">
            {create}
            <span className="text-sm text-text-muted">
              {t('drafts.of', { count: line.drafts.count, planned })} · {months}
            </span>
            {outside}
          </span>
        );
      case 'drafted':
        return (
          <span className="flex flex-col" data-testid="delivery-drafts">
            <span className="inline-flex items-center gap-1.5 font-semibold text-success">
              <Icon name="success" className="size-4" />
              {t('drafts.count', { count: line.drafts.count })}
            </span>
            <span className="text-sm text-text-muted">{months}</span>
            {outside}
          </span>
        );
      case 'over_drafted':
        return (
          <span className="flex flex-col" data-testid="delivery-drafts">
            <span className="inline-flex items-center gap-1.5 font-semibold text-warning">
              <Icon name="warning" className="size-4" />
              {t('drafts.over', { count: line.drafts.count, planned })}
            </span>
            <span className="text-sm text-text-muted">{months}</span>
            {outside}
          </span>
        );
    }
  };

  const menu = (line: Line) => {
    const items: {
      key: string;
      label: string;
      href: string;
      icon: 'copy' | 'calendar' | 'plan';
    }[] = [];
    if (line.course && line.can.linkCourse) {
      items.push({
        key: 'change',
        label: t('menu.changeCourse'),
        href: href({ kind: 'course', lineId: line.lineId, mode: 'link' }),
        icon: 'copy',
      });
    }
    if (line.drafts.count > 0 && line.course) {
      items.push({
        key: 'calendar',
        label: t('menu.showCalendar'),
        href: `/${locale}${calendarPath({ year: periodYear(delivery.cycle.periodStart), course: line.course.id })}`,
        icon: 'calendar',
      });
    }
    items.push({
      key: 'plan',
      label: t('menu.openPlan'),
      href: `/${locale}/suite/planning/cycles/${cycleId}?tab=plan`,
      icon: 'plan',
    });
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="grid size-9 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
          aria-label={t('menu.label', { title: line.title })}
          data-testid="delivery-line-menu"
        >
          <Icon name="more" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {items.map((item) => (
            <DropdownMenuItem key={item.key} asChild>
              <a href={item.href} data-testid={`delivery-menu-${item.key}`}>
                <Icon name={item.icon} />
                {item.label}
              </a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const trainingCell = (line: Line) => (
    <span className="flex min-w-0 flex-col">
      <span
        className={cn(
          'font-semibold',
          line.status === 'left_out' && 'text-text-muted line-through',
        )}
        data-testid="delivery-line-title"
      >
        {line.title}
      </span>
      <span className="text-sm text-text-muted">{detail(line)}</span>
    </span>
  );
  const peopleCell = (line: Line) => (
    <span className="flex flex-col items-end">
      <span>{number(line.people)}</span>
      <span className="whitespace-nowrap text-sm text-text-muted">
        {line.named > 0 ? t('named', { count: line.named }) : t('namesLater')}
      </span>
    </span>
  );
  const sessionsCell = (line: Line) =>
    line.status === 'left_out' || line.plannedSessions === null ? (
      <span className="text-text-muted">—</span>
    ) : (
      <span className="flex flex-col items-end">
        <span>{number(line.plannedSessions)}</span>
        <span className="text-sm text-text-muted">
          {line.sizes.map((n) => number(n)).join(' · ')}
        </span>
      </span>
    );
  const costOf = (line: Line) => {
    const cost = planLines.get(line.lineId)?.cost ?? null;
    return line.status === 'left_out' || cost === null ? null : cost;
  };
  const quarterChip = (quarter: number) => (
    <span className="inline-flex min-w-9 justify-center rounded-md bg-primary-subtle px-2 py-0.5 text-[13px] font-semibold text-primary-text">
      {quarterName(quarter)}
    </span>
  );

  const groups = [1, 2, 3, 4]
    .map((quarter) => {
      const lines = shown.filter((l) => l.quarter === quarter);
      const inPlan = lines.filter((l) => l.status === 'in_plan');
      return {
        quarter,
        lines,
        people: inPlan.reduce((n, l) => n + l.people, 0),
        sessions: inPlan.reduce((n, l) => n + (l.plannedSessions ?? 0), 0),
        cost: inPlan.reduce((n, l) => n + Number(costOf(l) ?? 0), 0),
        costed: inPlan.some((l) => costOf(l) !== null),
        inPlan: inPlan.length,
        done: inPlan.filter((l) => l.state === 'drafted' || l.state === 'over_drafted').length,
      };
    })
    .filter((g) => g.lines.length > 0);

  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-surface text-text shadow-2"
      aria-label={t('lines.label')}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <nav aria-label={t('filters.label')} className="min-w-0">
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="delivery-filters">
            {DELIVERY_FILTERS.map((key) => {
              const current = params.show === key;
              return (
                <li key={key}>
                  <a
                    href={`/${locale}${deliveryPath(cycleId, { show: key, q: params.q })}`}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-10 items-center gap-2 rounded-full border-[1.5px] px-3.5 text-[14.5px] font-medium no-underline pointer-coarse:min-h-11',
                      current
                        ? 'border-primary bg-primary-subtle text-primary-text'
                        : 'border-border-strong bg-surface text-text hover:bg-surface-hover',
                    )}
                    data-testid={`delivery-filter-${key}`}
                  >
                    {t(`filters.${key}`)}
                    <span className="rounded-full bg-surface-hover px-2 text-[13px] font-semibold tabular-nums text-text-muted">
                      {number(counts[key])}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <form method="get" role="search" className="md:ms-auto" aria-label={t('lines.search')}>
          {params.show !== 'all' ? <input type="hidden" name="show" value={params.show} /> : null}
          <ListSearch
            id="delivery-search"
            name="q"
            label={t('lines.search')}
            placeholder={t('lines.search')}
            defaultValue={params.q}
          />
        </form>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon="search"
          title={t('lines.noMatchTitle')}
          description={t('lines.noMatchBody')}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <div
              className={`${tableClasses.wrapper} focus-visible:outline-2 focus-visible:outline-offset-2`}
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus
              tabIndex={0}
              role="region"
              aria-label={t('lines.caption')}
            >
              <table className={tableClasses.table} data-testid="delivery-table">
                <caption className="sr-only">{t('lines.caption')}</caption>
                <thead className={tableClasses.header}>
                  <tr>
                    <th scope="col" className={tableClasses.head}>
                      {t('columns.training')}
                    </th>
                    <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                      {t('columns.people')}
                    </th>
                    <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                      {t('columns.sessions')}
                    </th>
                    <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                      {t('columns.cost')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {t('columns.when')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {t('columns.course')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {t('columns.drafts')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      <span className="sr-only">{t('columns.actions')}</span>
                    </th>
                  </tr>
                </thead>
                {groups.map((group) => (
                  <tbody key={group.quarter} data-testid="delivery-group">
                    <tr className="border-b border-border bg-surface-sunken">
                      <th scope="colgroup" className={cn(tableClasses.cell, 'text-start')}>
                        <span className="font-semibold">{quarterName(group.quarter)}</span>
                        <span className="font-normal text-text-muted">
                          {' · '}
                          {t('lines.count', { count: group.lines.length })}
                        </span>
                      </th>
                      <td className={cn(tableClasses.cell, 'text-end font-semibold tabular-nums')}>
                        {number(group.people)}
                      </td>
                      <td className={cn(tableClasses.cell, 'text-end font-semibold tabular-nums')}>
                        {number(group.sessions)}
                      </td>
                      <td className={cn(tableClasses.cell, 'text-end font-semibold tabular-nums')}>
                        {group.costed ? amount(String(group.cost)) : '—'}
                      </td>
                      <td className={tableClasses.cell} />
                      <td
                        className={cn(tableClasses.cell, 'text-sm text-text-muted')}
                        colSpan={3}
                        data-testid="delivery-group-done"
                      >
                        {group.inPlan > 0
                          ? t('quarterDone', { done: group.done, count: group.inPlan })
                          : null}
                      </td>
                    </tr>
                    {group.lines.map((line) => {
                      const cost = costOf(line);
                      return (
                        <tr
                          key={line.lineId}
                          className={tableClasses.row}
                          data-testid="delivery-line-row"
                          data-line-id={line.lineId}
                        >
                          <td className={cn(tableClasses.cell, 'min-w-52')}>
                            {trainingCell(line)}
                          </td>
                          <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                            {peopleCell(line)}
                          </td>
                          <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                            {sessionsCell(line)}
                          </td>
                          <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                            {cost === null ? (
                              <span className="text-text-muted">—</span>
                            ) : (
                              amount(cost)
                            )}
                          </td>
                          <td className={tableClasses.cell}>{quarterChip(line.quarter)}</td>
                          <td className={cn(tableClasses.cell, 'min-w-48')}>{courseCell(line)}</td>
                          <td className={cn(tableClasses.cell, 'min-w-44')}>{draftsCell(line)}</td>
                          <td className={cn(tableClasses.cell, 'text-end')}>{menu(line)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-5 p-4 md:hidden" data-testid="delivery-cards">
            {groups.map((group) => (
              <section key={group.quarter} aria-labelledby={`delivery-q${String(group.quarter)}`}>
                <h3
                  id={`delivery-q${String(group.quarter)}`}
                  className="m-0 mb-2 flex flex-wrap items-baseline gap-x-2 text-base font-semibold"
                >
                  {quarterName(group.quarter)}
                  {group.inPlan > 0 ? (
                    <span className="text-sm font-normal text-text-muted">
                      {t('quarterDone', { done: group.done, count: group.inPlan })}
                    </span>
                  ) : null}
                </h3>
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {group.lines.map((line) => {
                    const cost = costOf(line);
                    return (
                      <li
                        key={line.lineId}
                        className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
                        data-testid="delivery-line-card"
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">{trainingCell(line)}</div>
                          {menu(line)}
                        </div>
                        <dl className="m-0 grid grid-cols-3 gap-2">
                          <div>
                            <dt className="text-xs font-semibold uppercase text-text-muted">
                              {t('columns.people')}
                            </dt>
                            <dd className="m-0 font-semibold tabular-nums">
                              {number(line.people)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase text-text-muted">
                              {t('columns.sessions')}
                            </dt>
                            <dd className="m-0 font-semibold tabular-nums">
                              {line.plannedSessions === null || line.status === 'left_out'
                                ? '—'
                                : number(line.plannedSessions)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase text-text-muted">
                              {t('columns.cost')}
                            </dt>
                            <dd className="m-0 font-semibold tabular-nums">
                              {cost === null ? '—' : amount(cost)}
                            </dd>
                          </div>
                        </dl>
                        <div className="flex flex-col gap-2 border-t border-border pt-3">
                          <div>
                            <p className="m-0 text-xs font-semibold uppercase text-text-muted">
                              {t('columns.course')}
                            </p>
                            {courseCell(line)}
                          </div>
                          <div>
                            <p className="m-0 text-xs font-semibold uppercase text-text-muted">
                              {t('columns.drafts')}
                            </p>
                            {draftsCell(line)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
      <p className="m-0 flex items-start gap-2.5 border-t border-border px-5.5 py-4 text-sm text-text-muted">
        <Icon name="info" className="mt-0.5 size-4 shrink-0" />
        {t('lines.footnote')}
      </p>
    </section>
  );
}
