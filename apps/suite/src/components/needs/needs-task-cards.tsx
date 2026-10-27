import type { AppLocale, DateDisplay } from '@jadarat/platform-i18n';
import type { MyNeedsTask } from '@jadarat/tms';
import type { StructureLevelLabel } from '@jadarat/platform-db';
import { Badge, Icon, buttonClasses } from '@jadarat/ui';
import { getFormatter, getTranslations } from 'next-intl/server';
import { NEEDS_TONE, myNeedsHref, taskAction } from '../../lib/needs-view';
import { dayFormatter, formatAmount } from '../../lib/planning-format';
import { localName } from '../../lib/planning-view';
import { showsUnitLevels, unitNameWithLevel } from '../../lib/structure-view';

/**
 * One card per department whose needs the head enters (design screen 1 — the Home task card, and the
 * «My team's needs» list): the cycle and the department, the status, the deadline in days, the needs and
 * seats so far, and the one action (Enter needs / Continue / View needs).
 */
export async function NeedsTaskCards({
  locale,
  tasks,
  levels,
  display,
  testId,
}: {
  readonly locale: AppLocale;
  readonly tasks: readonly MyNeedsTask[];
  readonly levels: readonly StructureLevelLabel[];
  readonly display: DateDisplay;
  readonly testId?: string | undefined;
}) {
  const t = await getTranslations({ locale, namespace: 'needsEntry' });
  const planning = await getTranslations({ locale, namespace: 'planning' });
  const format = await getFormatter({ locale });
  const day = dayFormatter(locale, display);
  const withLevels = showsUnitLevels(
    levels,
    tasks.map((task) => task.levelOrdinal),
  );
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 lg:grid-cols-2" data-testid={testId}>
      {tasks.map((task) => {
        const department = unitNameWithLevel(
          localName(locale, task.departmentName),
          task.levelOrdinal,
          levels,
          locale,
          withLevels,
        );
        const action = taskAction(task.status, task.entryOpen);
        const due =
          task.status === 'late'
            ? t('task.late', { count: Math.abs(task.daysLeft) })
            : task.entryOpen
              ? t('task.dueIn', { count: Math.max(task.daysLeft, 0) })
              : t('task.deadline', { date: day(task.deadline) });
        return (
          <li
            key={`${task.cycleId}-${task.departmentId}`}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-surface px-5 py-5 shadow-2"
            data-testid="needs-task"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="m-0 text-sm font-medium text-text-muted">
                  {localName(locale, task.cycleName)}
                </p>
                <h3 className="m-0 text-[20px] font-bold [overflow-wrap:anywhere]">{department}</h3>
              </div>
              <Badge tone={NEEDS_TONE[task.status]} dot data-testid="needs-task-status">
                {planning(`cycle.formStatus.${task.status}`)}
              </Badge>
            </div>
            <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Icon name="clock" className="size-4 text-text-muted" />
                <dt className="sr-only">{t('page.deadline')}</dt>
                <dd className="m-0 font-semibold" data-testid="needs-task-due">
                  {due}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <Icon name="form" className="size-4 text-text-muted" />
                <dt className="sr-only">{t('page.stats.needs')}</dt>
                <dd className="m-0">
                  {t('task.needs', { count: task.needsCount })}
                  {task.needsCount > 0 ? ` · ${t('task.seats', { count: task.seats })}` : ''}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <Icon name="calendar" className="size-4 text-text-muted" />
                <dt className="sr-only">{t('page.deadline')}</dt>
                <dd className="m-0 text-text-muted">
                  {t('task.deadline', { date: day(task.deadline) })}
                </dd>
              </div>
              {task.cost !== null || task.budgetAmount !== null ? (
                <div className="flex items-center gap-2">
                  <Icon name="wallet" className="size-4 text-text-muted" />
                  <dt className="sr-only">{t('page.stats.cost')}</dt>
                  <dd className="m-0 text-text-muted tabular-nums">
                    {task.cost === null
                      ? t('page.noCost')
                      : formatAmount(locale, task.cost, task.currency)}
                    {task.budgetAmount !== null
                      ? ` / ${formatAmount(locale, task.budgetAmount, task.currency)}`
                      : ''}
                  </dd>
                </div>
              ) : null}
            </dl>
            {task.returnNote ? (
              <p className="m-0 rounded-md bg-warning-subtle px-3 py-2 text-sm">
                <b>{t('task.returned')}:</b> {task.returnNote}
              </p>
            ) : null}
            <div className="mt-auto flex justify-end">
              <a
                href={myNeedsHref(locale, task.cycleId, task.departmentId)}
                className={buttonClasses({ variant: action === 'view' ? 'secondary' : 'primary' })}
                data-testid="needs-task-open"
              >
                {t(`task.${action}`)}
                <Icon name="arrow-end" />
              </a>
            </div>
          </li>
        );
      })}
      {tasks.length === 0 ? null : <span className="sr-only">{format.number(tasks.length)}</span>}
    </ul>
  );
}
