import type { AppLocale } from '@jadarat/platform-i18n';
import type { DepartmentPlanResultView } from '@jadarat/tms';
import { Alert, Badge, Icon, StatCard, StatGrid, cn, tableClasses } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import { localName } from '../../lib/planning-view';
import { planAmount, planNumber } from '../../lib/training-plan-view';

/**
 * A department's result once its training plan is approved (WP-LD-03; FR-MGR-05; approved design 6b; Q4 = A —
 * the head learns it when the plan is approved): the trainings approved, the places for the team, the lines left
 * out, the department's share of the cost against its budget, then «Your approved trainings» (people, quarter,
 * share, the departments a line is shared with) and «Not in the plan» with each reason. Read only.
 */
export async function DepartmentResult({
  locale,
  view,
  approvedOn,
}: {
  locale: AppLocale;
  view: DepartmentPlanResultView;
  approvedOn: string;
}) {
  const t = await getTranslations({ locale, namespace: 'planApproval.result' });
  const plans = await getTranslations({ locale, namespace: 'trainingPlan' });
  const courses = await getTranslations({ locale, namespace: 'courses' });
  const amount = (value: string) => planAmount(locale, value, view.currency, view.fractionDigits);
  const result = view.result;
  const plan = localName(locale, view.cycleName);
  const department = localName(locale, view.departmentName);
  const nameOf = (id: string) => {
    const name = view.departmentNames[id];
    return name ? localName(locale, name) : plans('lines.otherDepartment');
  };
  const state = result.state;
  const over = state.kind === 'over';

  return (
    <section
      aria-labelledby="department-result-title"
      className="flex flex-col gap-5"
      data-testid="department-result"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="department-result-title" className="m-0 text-[22px] font-bold">
          {t('title')}
        </h2>
        <Badge tone="success" dot>
          <Icon name="lock" className="size-3.5" />
          {t('badge', { version: view.planVersion })}
        </Badge>
        <span className="text-text-muted">{t('approvedOn', { date: approvedOn })}</span>
        <span className="inline-flex items-center gap-1 text-text-muted">
          <Icon name="info" className="size-4" />
          {t('readOnly')}
        </span>
      </div>
      <Alert tone="success" data-testid="department-result-banner">
        {t('banner', { plan })}
      </Alert>
      <StatGrid label={t('summaryLabel')}>
        <StatCard
          variant="gradient"
          icon="plan"
          label={t('trainings')}
          value={planNumber(locale, result.approved.length)}
          hint={t('trainingsHint', { count: result.approved.length + result.leftOut.length })}
        />
        <StatCard
          variant="gradient"
          icon="people"
          label={t('places')}
          value={planNumber(locale, result.seats)}
          hint={t('placesHint')}
        />
        <StatCard
          variant="gradient"
          icon="ban"
          label={t('leftOut')}
          value={planNumber(locale, result.leftOut.length)}
          hint={t('leftOutHint')}
        />
        <div
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-6 shadow-1"
          data-testid="department-result-share"
        >
          <dt className="flex items-center gap-2 text-sm font-medium text-text-muted">
            <Icon name="wallet" className="size-[18px]" />
            {t('share')}
          </dt>
          <dd className="m-0 text-2xl font-bold tabular-nums">{amount(result.cost)}</dd>
          <dd className="m-0 text-sm text-text-muted">
            {result.envelope === null
              ? t('noBudget')
              : t('ofBudget', { amount: amount(result.envelope) })}
          </dd>
          {state.kind === 'over' ? (
            <dd
              className={cn(
                'm-0 text-sm font-semibold',
                state.severity === 'red' ? 'text-danger' : 'text-warning-strong',
              )}
            >
              {t('overApproved', { amount: amount(state.overBy) })}
            </dd>
          ) : state.kind === 'within' ? (
            <dd className="m-0 text-sm font-semibold text-success">
              {t('within', { amount: amount(state.left) })}
            </dd>
          ) : null}
        </div>
      </StatGrid>
      {over && view.reason ? <p className="m-0 text-text-muted">«{view.reason}»</p> : null}

      <section
        aria-labelledby="department-result-approved"
        className="overflow-hidden rounded-xl border border-border bg-surface shadow-2"
      >
        <h3
          id="department-result-approved"
          className="m-0 border-b border-border px-5 py-4 text-lg font-bold"
        >
          {t('approvedTitle')}
        </h3>
        {result.approved.length === 0 ? (
          <p className="m-0 px-5 py-4 text-text-muted">{t('approvedEmpty')}</p>
        ) : (
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table} data-testid="department-result-approved">
              <thead className={tableClasses.header}>
                <tr>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.training')}
                  </th>
                  <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                    {t('columns.people')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.when')}
                  </th>
                  <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                    {t('columns.share')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.sharedWith')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.status')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.approved.map((a) => (
                  <tr
                    key={a.line.id}
                    className={tableClasses.row}
                    data-testid="department-result-line"
                  >
                    <td className={tableClasses.cell}>
                      <span className="flex flex-col">
                        <b>{a.line.title}</b>
                        {a.line.deliveryType ? (
                          <span className="text-sm text-text-muted">
                            {courses(`deliveryTypes.${a.line.deliveryType}`)}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                      {planNumber(locale, a.seats)}
                    </td>
                    <td className={tableClasses.cell}>
                      {plans(`quarter.q${String(a.line.quarter)}`)}
                    </td>
                    <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                      {a.share === null ? '—' : amount(a.share)}
                    </td>
                    <td className={tableClasses.cell}>
                      {a.sharedWith.length === 0
                        ? t('onlyYou', { department })
                        : a.sharedWith.map(nameOf).join(plans('listSeparator'))}
                    </td>
                    <td className={tableClasses.cell}>
                      <Badge tone="success" dot>
                        {t('approved')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {result.leftOut.length > 0 ? (
        <section
          aria-labelledby="department-result-left-out"
          className="overflow-hidden rounded-xl border border-border bg-surface shadow-2"
        >
          <h3
            id="department-result-left-out"
            className="m-0 border-b border-border px-5 py-4 text-lg font-bold"
          >
            {t('notInPlanTitle')}
          </h3>
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table} data-testid="department-result-left-out">
              <thead className={tableClasses.header}>
                <tr>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.training')}
                  </th>
                  <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                    {t('columns.people')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.reason')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.status')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.leftOut.map((l) => (
                  <tr key={l.line.id} className={tableClasses.row}>
                    <td className={cn(tableClasses.cell, 'text-text-muted line-through')}>
                      {l.line.title}
                    </td>
                    <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                      {planNumber(locale, l.seats)}
                    </td>
                    <td className={tableClasses.cell}>
                      {l.line.leftOutReason ? `«${l.line.leftOutReason}»` : '—'}
                    </td>
                    <td className={tableClasses.cell}>
                      <Badge tone="neutral" className="border-dashed">
                        <Icon name="ban" className="size-3.5" />
                        {t('leftOutStatus')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </section>
  );
}
