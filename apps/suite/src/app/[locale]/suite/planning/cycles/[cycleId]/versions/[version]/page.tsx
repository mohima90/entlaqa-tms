import { toClientError } from '@jadarat/platform-core';
import { displayDateFormatter } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, Badge, Icon, buttonClasses, cn, tableClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PlanningHeader } from '../../../../../../../../components/planning/planning-header';
import { SuiteShell } from '../../../../../../../../components/suite-shell';
import { personLabel } from '../../../../../../../../lib/plan-approval-view';
import { PLANNING_PATHS, localName } from '../../../../../../../../lib/planning-view';
import { getSuiteContext } from '../../../../../../../../lib/suite-context';
import { planVersionQuery } from '../../../../../../../../lib/training-plan-queries';
import { planAmount, planNumber } from '../../../../../../../../lib/training-plan-view';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An approved version of a cycle's training plan, read only (WP-LD-03, T-M3-07; FR-PLN-08 «locked and versioned»;
 * design 6a «Versions»): its lines as approved — sessions, cost, quarter, approved or left out with the reason —
 * and the budget by department with the reasons. Later versions never change it.
 */
export default async function PlanVersionPage({
  params,
}: {
  params: Promise<{ locale: string; cycleId: string; version: string }>;
}) {
  const { locale, cycleId, version } = await params;
  const planVersion = Number(version);
  if (
    !hasLocale(routing.locales, locale) ||
    !UUID_RE.test(cycleId) ||
    !Number.isInteger(planVersion) ||
    planVersion < 1 ||
    planVersion > 100_000
  ) {
    notFound();
  }
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'planApproval' });
  const plans = await getTranslations({ locale, namespace: 'trainingPlan' });
  const errors = await getTranslations({ locale, namespace: 'errors' });
  const path = `${PLANNING_PATHS.cycles}/${cycleId}/versions/${String(planVersion)}`;

  let title = t('version', { version: planVersion });
  let description: ReactNode = null;
  let content: ReactNode;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="planning-not-configured">
        {t('page.notConfigured')}
      </Alert>
    );
  } else {
    const result = await planVersionQuery({ cycleId, planVersion });
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'NOT_FOUND') notFound();
      content = (
        <Alert
          tone={error.code === 'FORBIDDEN' ? 'warning' : 'danger'}
          data-testid="plan-version-error"
        >
          {error.code === 'FORBIDDEN'
            ? errors('forbidden')
            : t('page.loadFailed', { correlationId: error.correlationId ?? '' })}
        </Alert>
      );
    } else {
      const view = result.value;
      const format = displayDateFormatter(
        locale,
        context.regional.dateDisplay,
        context.regional.timeZone,
      );
      const amount = (value: string) =>
        planAmount(locale, value, view.currency, view.fractionDigits);
      const departmentName = new Map(
        view.departments.map((d) => [d.departmentId, localName(locale, d.name)]),
      );
      title = t('versionPage.title', {
        plan: localName(locale, view.cycleName),
        version: view.planVersion,
      });
      description = (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14.5px]">
          <Badge tone="success" dot>
            <Icon name="lock" className="size-3.5" />
            {t('approvedBadge', { version: view.planVersion })}
          </Badge>
          <span>
            {t('versionPage.intro', {
              date: format.dateTime(view.approvedAt),
              name: personLabel(locale, view.approvedBy, t('history.someone')),
            })}
          </span>
        </div>
      );
      content = (
        <div className="flex flex-col gap-6" data-testid="plan-version">
          <a
            href={`/${locale}${PLANNING_PATHS.cycles}/${cycleId}?tab=plan`}
            className={cn(buttonClasses({ variant: 'secondary', size: 'sm' }), 'w-fit')}
          >
            {t('versionPage.back')}
          </a>
          <section
            aria-labelledby="version-lines"
            className="overflow-hidden rounded-xl border border-border bg-surface shadow-2"
          >
            <h2
              id="version-lines"
              className="m-0 border-b border-border px-5 py-4 text-lg font-bold"
            >
              {t('versionPage.linesTitle')}
            </h2>
            <div className={tableClasses.wrapper}>
              <table className={tableClasses.table} data-testid="plan-version-lines">
                <thead className={tableClasses.header}>
                  <tr>
                    <th scope="col" className={tableClasses.head}>
                      {plans('lines.columns.training')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {plans('lines.columns.departments')}
                    </th>
                    <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                      {plans('lines.columns.people')}
                    </th>
                    <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                      {plans('lines.columns.sessions')}
                    </th>
                    <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                      {plans('lines.columns.cost')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {plans('lines.columns.when')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {plans('lines.columns.status')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.lines.map((line) => {
                    const leftOut = line.status === 'left_out';
                    return (
                      <tr
                        key={line.id}
                        className={tableClasses.row}
                        data-testid="plan-version-line"
                      >
                        <td className={tableClasses.cell}>
                          <span className="flex flex-col">
                            <b className={cn(leftOut && 'text-text-muted line-through')}>
                              {line.title}
                            </b>
                            {leftOut && line.leftOutReason ? (
                              <span className="text-sm text-text-muted">
                                «{line.leftOutReason}»
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className={tableClasses.cell}>
                          {line.departments
                            .map(
                              (d) =>
                                departmentName.get(d.departmentId) ??
                                plans('lines.otherDepartment'),
                            )
                            .join(plans('listSeparator'))}
                        </td>
                        <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                          {planNumber(locale, line.people)}
                        </td>
                        <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                          {leftOut || line.sessions === null
                            ? '—'
                            : planNumber(locale, line.sessions.sessions)}
                        </td>
                        <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                          {leftOut || line.cost === null ? '—' : amount(line.cost)}
                        </td>
                        <td className={tableClasses.cell}>
                          {plans(`quarter.q${String(line.quarter)}`)}
                        </td>
                        <td className={tableClasses.cell}>
                          <Badge tone={leftOut ? 'neutral' : 'success'} dot={!leftOut}>
                            {plans(leftOut ? 'lineStatus.leftOut' : 'lineStatus.approved')}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section
            aria-labelledby="version-budget"
            className="overflow-hidden rounded-xl border border-border bg-surface shadow-2"
          >
            <h2
              id="version-budget"
              className="m-0 border-b border-border px-5 py-4 text-lg font-bold"
            >
              {t('versionPage.budgetTitle')}
            </h2>
            <div className={tableClasses.wrapper}>
              <table className={tableClasses.table} data-testid="plan-version-budget">
                <thead className={tableClasses.header}>
                  <tr>
                    <th scope="col" className={tableClasses.head}>
                      {plans('budget.columns.department')}
                    </th>
                    <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                      {plans('budget.columns.people')}
                    </th>
                    <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                      {plans('budget.columns.cost')}
                    </th>
                    <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                      {plans('budget.columns.budget')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {plans('budget.columns.state')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {plans('budget.columns.reason')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.departments.map((d) => (
                    <tr key={d.departmentId} className={tableClasses.row}>
                      <th scope="row" className={cn(tableClasses.cell, 'text-start font-semibold')}>
                        {localName(locale, d.name)}
                      </th>
                      <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                        {planNumber(locale, d.people)}
                      </td>
                      <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                        {amount(d.cost)}
                      </td>
                      <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                        {d.envelope === null ? '—' : amount(d.envelope)}
                      </td>
                      <td className={tableClasses.cell}>
                        {d.state.kind === 'over'
                          ? plans('budget.overBy', { amount: amount(d.state.overBy) })
                          : d.state.kind === 'within'
                            ? plans('budget.within')
                            : plans('budget.noEnvelope')}
                      </td>
                      <td className={tableClasses.cell}>{d.reason ?? '—'}</td>
                    </tr>
                  ))}
                  <tr className="bg-surface-sunken">
                    <th scope="row" className={cn(tableClasses.cell, 'text-start font-bold')}>
                      {plans('budget.total')}
                    </th>
                    <td className={cn(tableClasses.cell, 'text-end font-bold tabular-nums')}>
                      {planNumber(locale, view.total.people)}
                    </td>
                    <td className={cn(tableClasses.cell, 'text-end font-bold tabular-nums')}>
                      {amount(view.total.cost)}
                    </td>
                    <td className={cn(tableClasses.cell, 'text-end font-bold tabular-nums')}>
                      {view.total.envelope === null ? '—' : amount(view.total.envelope)}
                    </td>
                    <td className={tableClasses.cell} colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="planningCycles" path={path}>
      <PlanningHeader locale={locale} title={title} description={description} />
      {content}
    </SuiteShell>
  );
}
