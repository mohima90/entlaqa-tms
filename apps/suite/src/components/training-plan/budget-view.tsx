'use client';
import { setBudgetReasonAction } from '@jadarat/tms/actions/consolidation';
import { CONSOLIDATION_LIMITS } from '@jadarat/tms/consolidation-rules';
import { Button, FieldError, Icon, cn, tableClasses, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { PlanBudgetDepartment } from '../../lib/training-plan-view';
import { BudgetMeter, BudgetStateText, type PlanModel } from './plan-shared';

/**
 * Budget by department (design screen 3): per department its head, lines, people, estimated cost (its shares
 * of the costed lines in the plan), its envelope, a meter and Within / Over by X (n % over) — amber under
 * 10 % over, red from 10 %. A department that is over gets a one-line reason (saved with
 * setBudgetReasonAction; empty: «Needed before you submit»). The organization's total closes the table.
 * Being over never blocks the plan (BR-PLN-f). Phones: one card per department.
 */
export function BudgetView({ model }: { readonly model: PlanModel }) {
  const { t } = model.texts;
  const { view } = model;
  const rows = view.budget.departments;
  const total = view.budget.total;

  const stateCell = (row: PlanBudgetDepartment) => (
    <div className="flex min-w-40 flex-col gap-1.5">
      <BudgetMeter
        cost={row.cost}
        envelope={row.envelope}
        state={row.state}
        label={t('budget.meterLabel', { department: model.departmentName(row.departmentId) })}
      />
      <BudgetStateText state={row.state} model={model} />
      {row.uncostedLines > 0 ? (
        <span className="text-sm text-warning">
          {t('budget.uncosted', { count: row.uncostedLines })}
        </span>
      ) : null}
    </div>
  );

  return (
    <div data-testid="plan-budget">
      <div className="hidden md:block">
        <div
          className={`${tableClasses.wrapper} focus-visible:outline-2 focus-visible:outline-offset-2`}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus
          tabIndex={0}
          role="region"
          aria-label={t('budget.caption')}
        >
          <table className={tableClasses.table} data-testid="plan-budget-table">
            <caption className="sr-only">{t('budget.caption')}</caption>
            <thead className={tableClasses.header}>
              <tr>
                <th scope="col" className={tableClasses.head}>
                  {t('budget.columns.department')}
                </th>
                <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                  {t('budget.columns.lines')}
                </th>
                <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                  {t('budget.columns.people')}
                </th>
                <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                  {t('budget.columns.cost')}
                </th>
                <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                  {t('budget.columns.budget')}
                </th>
                <th scope="col" className={tableClasses.head}>
                  {t('budget.columns.state')}
                </th>
                <th scope="col" className={tableClasses.head}>
                  {t('budget.columns.reason')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const head = model.departmentHead(row.departmentId);
                return (
                  <tr
                    key={row.departmentId}
                    className={tableClasses.row}
                    data-testid="plan-budget-row"
                  >
                    <th scope="row" className={cn(tableClasses.cell, 'text-start font-normal')}>
                      <span className="block font-semibold">
                        {model.departmentName(row.departmentId)}
                      </span>
                      {head ? <span className="text-sm text-text-muted">{head}</span> : null}
                    </th>
                    <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                      {model.number(row.lines)}
                    </td>
                    <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                      {model.number(row.people)}
                    </td>
                    <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                      {model.amount(row.cost)}
                    </td>
                    <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                      {row.envelope === null ? '—' : model.amount(row.envelope)}
                    </td>
                    <td className={tableClasses.cell}>{stateCell(row)}</td>
                    <td className={cn(tableClasses.cell, 'min-w-64')}>
                      <ReasonField row={row} model={model} />
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-surface-sunken" data-testid="plan-budget-total">
                <th scope="row" className={cn(tableClasses.cell, 'text-start font-bold')}>
                  {view.scope === 'organization' ? t('budget.total') : t('budget.totalScoped')}
                </th>
                <td className={tableClasses.cell} />
                <td className={cn(tableClasses.cell, 'text-end font-bold tabular-nums')}>
                  {model.number(total.people)}
                </td>
                <td className={cn(tableClasses.cell, 'text-end font-bold tabular-nums')}>
                  {model.amount(total.cost)}
                </td>
                <td className={cn(tableClasses.cell, 'text-end font-bold tabular-nums')}>
                  {total.envelope === null ? '—' : model.amount(total.envelope)}
                </td>
                <td className={tableClasses.cell} colSpan={2}>
                  <BudgetStateText state={total.state} model={model} compact />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <ul className="m-0 flex list-none flex-col p-0 md:hidden" data-testid="plan-budget-cards">
        {rows.map((row) => (
          <li
            key={row.departmentId}
            className="flex flex-col gap-3 border-b border-border px-4 py-4"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block font-semibold">
                  {model.departmentName(row.departmentId)}
                </span>
                <span className="text-sm text-text-muted">
                  {t('budget.cardLine', {
                    lines: row.lines,
                    people: row.people,
                  })}
                </span>
              </span>
              <span className="shrink-0 text-end text-sm">
                <span className="block font-semibold">{model.amount(row.cost)}</span>
                <span className="text-text-muted">
                  {row.envelope === null
                    ? t('budget.noEnvelope')
                    : t('budget.ofBudget', { amount: model.amount(row.envelope) })}
                </span>
              </span>
            </div>
            {stateCell(row)}
            <ReasonField row={row} model={model} />
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 bg-surface-sunken px-4 py-4 font-bold">
          <span>{view.scope === 'organization' ? t('budget.total') : t('budget.totalScoped')}</span>
          <span className="text-end">
            <span className="block">{model.amount(total.cost)}</span>
            <BudgetStateText state={total.state} model={model} compact />
          </span>
        </li>
      </ul>

      <p className="m-0 flex items-start gap-2.5 border-t border-border px-5.5 py-4 text-sm text-text-muted">
        <Icon name="info" className="mt-0.5 size-4 shrink-0" />
        {t('budget.footnote')}
      </p>
    </div>
  );
}

/** A department's one-line reason (over its budget): typed in place, saved with its own button. */
function ReasonField({ row, model }: { row: PlanBudgetDepartment; model: PlanModel }) {
  const { t } = model.texts;
  const router = useRouter();
  const [value, setValue] = useState(row.reason ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const name = model.departmentName(row.departmentId);
  const over = row.state.kind === 'over';
  const plan = model.view.plan;
  if (!over && row.reason === null) return <span className="text-text-muted">—</span>;
  if (!model.view.can.manage || plan === null) {
    return row.reason ? (
      <p className="m-0 whitespace-pre-line">{row.reason}</p>
    ) : (
      <span className="text-sm font-semibold text-danger">{t('budget.reasonNeeded')}</span>
    );
  }
  const id = `plan-budget-reason-${row.departmentId}`;
  const changed = value.trim() !== (row.reason ?? '');

  function save() {
    if (plan === null) return;
    setError(undefined);
    startTransition(async () => {
      const result = await setBudgetReasonAction({
        planId: plan.id,
        departmentId: row.departmentId,
        reason: value.trim(),
      });
      if (result.ok) {
        toast.success(
          value.trim() === ''
            ? t('budget.reasonRemoved', { department: name })
            : t('budget.reasonSaved', { department: name }),
        );
        router.refresh();
        return;
      }
      if (model.texts.sessionRefused(result.error)) return;
      setError(model.texts.formMessage(result.error));
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="sr-only">
        {t('budget.reasonLabel', { department: name })}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          value={value}
          maxLength={CONSOLIDATION_LIMITS.budgetReasonMax}
          placeholder={t('budget.reasonPlaceholder')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : row.needsReason ? `${id}-needed` : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && changed && !pending) {
              event.preventDefault();
              save();
            }
          }}
          disabled={pending}
          className={cn(
            'min-h-11 w-full min-w-0 rounded-md border-[1.5px] border-border-strong bg-surface px-3 text-[14.5px] text-text placeholder:text-text-subtle focus:border-primary',
            (Boolean(error) || row.needsReason) && 'border-danger',
          )}
          data-testid="plan-budget-reason"
        />
        {changed ? (
          <Button
            size="sm"
            busy={pending}
            disabled={pending}
            onClick={save}
            data-testid="plan-budget-reason-save"
          >
            {t('save')}
            <span className="sr-only"> ({name})</span>
          </Button>
        ) : null}
      </div>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      {!error && row.needsReason ? (
        <p id={`${id}-needed`} className="m-0 text-[13px] font-semibold text-danger">
          {t('budget.reasonNeeded')}
        </p>
      ) : null}
    </div>
  );
}
