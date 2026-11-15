import type { AppLocale, DateDisplay } from '@jadarat/platform-i18n';
import type { CalendarDraftView, CalendarNotDraftedView, TrainingCalendarView } from '@jadarat/tms';
import { Icon, cn } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import { formatMonth } from '../../lib/month-format';
import { type CalendarParams, calendarPath } from '../../lib/plan-delivery-view';
import { localName } from '../../lib/planning-view';
import { CalendarFilters } from './calendar-filters';

type Quarter = TrainingCalendarView['quarters'][number];

const ONLINE = new Set(['virtual', 'elearning']);

/**
 * The training calendar's body (WP-LD-04, design screens 4 and 4p): the filters (quarter pills, branch, course) with
 * the legend, then the year — one row per quarter, three month columns, a dashed card per draft and «Not drafted yet
 * in Qn: …» with the next action under each quarter, so the calendar is also the to-do list — or the list (months
 * with their cards), which a phone opens by default. Server-rendered: a card and an action are links that open
 * their popup by the address.
 */
export async function CalendarView({
  locale,
  view,
  params,
  display,
}: {
  readonly locale: AppLocale;
  readonly view: TrainingCalendarView;
  readonly params: CalendarParams;
  readonly display: DateDisplay;
}) {
  const t = await getTranslations({ locale, namespace: 'planDelivery' });
  const month = (value: string, style: 'long' | 'name' | 'short') =>
    formatMonth(value, locale, display, style);
  const branchName = new Map(view.filters.branches.map((b) => [b.id, localName(locale, b.name)]));
  const courseTitle = (draft: CalendarDraftView) =>
    draft.course
      ? localName(locale, { ar: draft.course.titleAr, en: draft.course.titleEn })
      : draft.lineTitle;
  const here = (open: Parameters<typeof calendarPath>[1] = {}) =>
    `/${locale}${calendarPath(params, open)}`;
  const quarterName = (quarter: number) => t(`quarter.q${String(quarter)}`);
  const range = (q: Quarter) =>
    `${month(q.months[0]?.month ?? '', 'short')} – ${month(q.months[2]?.month ?? '', 'short')}`;
  const summaryOf = (sessions: number, seats: number) =>
    t('calendar.monthSummary', { sessions, seats });

  const place = (draft: CalendarDraftView) => {
    if (draft.branchId) {
      return {
        icon: 'building' as const,
        text: branchName.get(draft.branchId) ?? t('calendar.noBranch'),
      };
    }
    return ONLINE.has(draft.deliveryType)
      ? { icon: 'monitor' as const, text: t('calendar.online') }
      : { icon: 'building' as const, text: t('calendar.noBranch') };
  };

  const card = (draft: CalendarDraftView, full: boolean) => {
    const where = place(draft);
    const title = courseTitle(draft);
    const ordinal =
      draft.planned !== null
        ? t('calendar.ordinal', {
            number: draft.ordinal,
            count: Math.max(draft.planned, draft.ordinal),
          })
        : null;
    return (
      <li key={draft.id}>
        <a
          href={here({ draft: draft.id })}
          className="flex flex-col gap-1.5 rounded-lg border-[1.5px] border-dashed border-border-strong bg-surface px-3.5 py-3 no-underline text-text hover:border-primary hover:bg-surface-hover"
          data-testid="calendar-draft"
          data-draft-id={draft.id}
        >
          <span className="flex items-start justify-between gap-2">
            <span className={cn('min-w-0 font-semibold', !full && 'truncate')}>{title}</span>
            <span className="shrink-0 rounded-full border border-dashed border-border-strong px-2 py-px text-[12px] font-semibold text-text-muted">
              {t('calendar.draft')}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13.5px] text-text-muted">
            <Icon name="people" className="size-3.5" />
            {t('calendar.seats', { count: draft.seats })}
            <span aria-hidden="true">·</span>
            <Icon name={where.icon} className="size-3.5" />
            {where.text}
            {ordinal ? (
              <>
                <span aria-hidden="true">·</span>
                {ordinal}
              </>
            ) : null}
          </span>
          {draft.outsideQuarter ? (
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-warning">
              <Icon name="warning" className="size-3.5" />
              {t('calendar.outside')}
            </span>
          ) : null}
        </a>
      </li>
    );
  };

  const stateText = (line: CalendarNotDraftedView) =>
    line.state === 'needs_course'
      ? t('calendar.state.needsCourse')
      : line.state === 'partly_drafted'
        ? t('calendar.state.partly', { count: line.missing })
        : t('calendar.state.courseLinked');
  const action = (line: CalendarNotDraftedView) =>
    line.state === 'needs_course' ? (
      <a
        href={here({ popup: { kind: 'course', lineId: line.lineId, mode: 'create' } })}
        className="font-semibold text-primary-text underline underline-offset-2"
        aria-label={t('calendar.createCourseFor', { title: line.title })}
        data-testid="calendar-create-course"
      >
        {t('calendar.createCourse')}
      </a>
    ) : (
      <a
        href={here({ popup: { kind: 'sessions', lineId: line.lineId } })}
        className="font-semibold text-primary-text underline underline-offset-2"
        aria-label={t('calendar.createSessionsFor', { title: line.title })}
        data-testid="calendar-create-sessions"
      >
        {t('calendar.createSessions')}
      </a>
    );
  const notDrafted = (q: Quarter) =>
    q.notDrafted.length === 0 ? null : (
      <div
        className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 border-t border-border bg-surface-sunken px-5 py-3 text-[14.5px]"
        data-testid="calendar-not-drafted"
      >
        <span className="inline-flex items-center gap-1.5 text-text-muted">
          <Icon name="clock" className="size-4" />
          {t('calendar.notDrafted', { quarter: quarterName(q.quarter) })}
        </span>
        {q.notDrafted.map((line) => (
          <span key={line.lineId} className="inline-flex flex-wrap items-baseline gap-x-1.5">
            <b>{line.title}</b>
            <span className="text-text-muted">· {stateText(line)} ·</span>
            {action(line)}
          </span>
        ))}
      </div>
    );

  const quarterTotals = (q: Quarter) => ({
    sessions: q.months.reduce((n, m) => n + m.sessions, 0),
    seats: q.months.reduce((n, m) => n + m.seats, 0),
  });

  const year = (
    <div data-testid="calendar-year">
      {view.quarters.map((q) => {
        const totals = quarterTotals(q);
        return (
          <section
            key={q.quarter}
            aria-labelledby={`calendar-q${String(q.quarter)}`}
            className="border-t border-border first:border-t-0"
            data-testid="calendar-quarter"
          >
            <div className="grid grid-cols-1 lg:grid-cols-[11rem_repeat(3,minmax(0,1fr))]">
              <div className="flex flex-col gap-1 border-border px-5 py-4 lg:border-e">
                <h2 id={`calendar-q${String(q.quarter)}`} className="m-0 text-2xl font-bold">
                  {quarterName(q.quarter)}
                </h2>
                <span className="text-sm text-text-muted">{range(q)}</span>
                <span className="mt-2 text-[14.5px] font-semibold">
                  {totals.sessions > 0
                    ? summaryOf(totals.sessions, totals.seats)
                    : t('calendar.quarterEmpty')}
                </span>
              </div>
              {q.months.map((m) => (
                <section
                  key={m.month}
                  aria-label={month(m.month, 'long')}
                  className="flex min-w-0 flex-col gap-2.5 border-t border-border px-4 py-4 lg:border-e lg:border-t-0 lg:last:border-e-0"
                  data-testid="calendar-month"
                >
                  <h3 className="m-0 flex flex-wrap items-baseline justify-between gap-x-2 text-base font-semibold">
                    {month(m.month, 'name')}
                    {m.sessions > 0 ? (
                      <span className="text-[13.5px] font-normal text-text-muted">
                        {summaryOf(m.sessions, m.seats)}
                      </span>
                    ) : null}
                  </h3>
                  {m.drafts.length === 0 ? (
                    <p className="m-0 text-[14.5px] text-text-muted">{t('calendar.noSessions')}</p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                      {m.drafts.map((d) => card(d, false))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
            {notDrafted(q)}
          </section>
        );
      })}
    </div>
  );

  const list = (
    <div className="flex flex-col gap-2 px-4 py-4" data-testid="calendar-list">
      {view.quarters.map((q) => {
        const totals = quarterTotals(q);
        return (
          <section
            key={q.quarter}
            aria-labelledby={`calendar-list-q${String(q.quarter)}`}
            className="flex flex-col gap-3"
          >
            <h2
              id={`calendar-list-q${String(q.quarter)}`}
              className="m-0 border-b border-border pb-2 pt-3 text-[13px] font-semibold uppercase tracking-wide text-text-muted"
            >
              {quarterName(q.quarter)} · {range(q)}
            </h2>
            {totals.sessions === 0 ? (
              <p className="m-0 text-[15px]">{t('calendar.quarterEmptyList')}</p>
            ) : (
              q.months
                .filter((m) => m.sessions > 0)
                .map((m) => (
                  <section
                    key={m.month}
                    aria-label={month(m.month, 'long')}
                    className="flex flex-col gap-2.5"
                  >
                    <h3 className="m-0 flex flex-wrap items-baseline justify-between gap-x-2 text-lg font-semibold">
                      {month(m.month, 'long')}
                      <span className="text-[13.5px] font-normal text-text-muted">
                        {summaryOf(m.sessions, m.seats)}
                      </span>
                    </h3>
                    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                      {m.drafts.map((d) => card(d, true))}
                    </ul>
                  </section>
                ))
            )}
            {q.notDrafted.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-border">{notDrafted(q)}</div>
            ) : null}
          </section>
        );
      })}
    </div>
  );

  const quarterHref = (quarter: 1 | 2 | 3 | 4 | null) =>
    `/${locale}${calendarPath({ ...params, quarter, draft: null })}`;
  const filterTemplate = (key: 'branch' | 'course') =>
    `/${locale}${calendarPath({ ...params, [key]: `__${key}__`, draft: null })}`;

  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-surface text-text shadow-2"
      aria-label={t('calendar.label', { year: params.year })}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <nav aria-label={t('calendar.filters.quarter')} className="flex items-center gap-2">
          <span className="hidden text-sm text-text-muted lg:inline">
            {t('calendar.filters.quarter')}
          </span>
          <ul className="m-0 flex list-none flex-wrap items-center gap-1 rounded-full bg-surface-hover p-1">
            {([null, 1, 2, 3, 4] as const).map((quarter) => {
              const current = params.quarter === quarter;
              return (
                <li key={quarter ?? 'all'}>
                  <a
                    href={quarterHref(quarter)}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-medium no-underline pointer-coarse:min-h-11',
                      current ? 'bg-surface text-text shadow-1' : 'text-text-muted hover:text-text',
                    )}
                    data-testid={`calendar-quarter-${quarter === null ? 'all' : String(quarter)}`}
                  >
                    {quarter === null ? t('calendar.filters.all') : quarterName(quarter)}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="hidden flex-wrap items-center gap-2.5 md:flex">
          <CalendarFilters
            hrefs={{ branch: filterTemplate('branch'), course: filterTemplate('course') }}
            branch={{
              value: params.branch,
              options: [
                ...view.filters.branches.map((b) => ({
                  value: b.id,
                  label: localName(locale, b.name),
                })),
                { value: 'none', label: t('calendar.noBranch') },
              ],
            }}
            course={{
              value: params.course,
              options: view.filters.courses.map((c) => ({
                value: c.id,
                label: `${localName(locale, { ar: c.titleAr, en: c.titleEn })} · ${c.code}`,
              })),
            }}
            texts={{
              branch: t('calendar.filters.branch'),
              allBranches: t('calendar.filters.allBranches'),
              removeBranch: t('calendar.filters.remove', { filter: t('calendar.filters.branch') }),
              course: t('calendar.filters.course'),
              allCourses: t('calendar.filters.allCourses'),
              removeCourse: t('calendar.filters.remove', { filter: t('calendar.filters.course') }),
              search: t('calendar.filters.search'),
              noMatches: t('calendar.filters.noMatches'),
            }}
          />
        </div>
        <details className="md:hidden">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border-[1.5px] border-border-strong px-3.5 text-sm font-medium">
            <Icon name="filter" className="size-4" />
            {t('calendar.filters.button')}
          </summary>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <CalendarFilters
              hrefs={{ branch: filterTemplate('branch'), course: filterTemplate('course') }}
              branch={{
                value: params.branch,
                options: [
                  ...view.filters.branches.map((b) => ({
                    value: b.id,
                    label: localName(locale, b.name),
                  })),
                  { value: 'none', label: t('calendar.noBranch') },
                ],
              }}
              course={{
                value: params.course,
                options: view.filters.courses.map((c) => ({
                  value: c.id,
                  label: `${localName(locale, { ar: c.titleAr, en: c.titleEn })} · ${c.code}`,
                })),
              }}
              texts={{
                branch: t('calendar.filters.branch'),
                allBranches: t('calendar.filters.allBranches'),
                removeBranch: t('calendar.filters.remove', {
                  filter: t('calendar.filters.branch'),
                }),
                course: t('calendar.filters.course'),
                allCourses: t('calendar.filters.allCourses'),
                removeCourse: t('calendar.filters.remove', {
                  filter: t('calendar.filters.course'),
                }),
                search: t('calendar.filters.search'),
                noMatches: t('calendar.filters.noMatches'),
              }}
            />
          </div>
        </details>
        <ul
          aria-label={t('calendar.legend.label')}
          className="m-0 flex list-none flex-wrap items-center gap-4 p-0 text-sm text-text-muted lg:ms-auto"
        >
          <li className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3.5 w-5 rounded border-[1.5px] border-dashed border-border-strong"
            />
            {t('calendar.legend.draft')}
          </li>
          <li className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-3.5 w-5 rounded border-[1.5px] border-primary" />
            {t('calendar.legend.scheduled')}
          </li>
        </ul>
      </div>
      {params.view === 'list' ? (
        list
      ) : params.view === 'year' ? (
        year
      ) : (
        <>
          <div className="hidden lg:block">{year}</div>
          <div className="lg:hidden">{list}</div>
        </>
      )}
    </section>
  );
}
