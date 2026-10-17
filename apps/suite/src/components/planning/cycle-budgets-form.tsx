'use client';
import { savePlanCycleBudgetsAction } from '@jadarat/tms/actions/planning';
import { budgetAmountText } from '@jadarat/tms/planning-rules';
import { Alert, Button, Card, EmptyState, buttonClasses, tableClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { cycleHref, sumAmounts } from '../../lib/planning-view';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { usePlanningTexts } from './use-planning-texts';

export interface BudgetRow {
  readonly departmentId: string;
  readonly name: string;
  readonly head: string;
  readonly amount: string | null;
}

export interface CycleBudgetsFormProps {
  readonly locale: 'ar' | 'en';
  readonly cycle: { readonly id: string; readonly version: number };
  readonly currency: string;
  readonly rows: readonly BudgetRow[];
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly backHref: string;
}

/**
 * Step 3 — Budget (EP-PLN B4; Q2: optional): a budget envelope per department in scope, in the
 * organization's currency (BR-PLN-i). Empty = no envelope.
 */
export function CycleBudgetsForm(props: CycleBudgetsFormProps) {
  const { t, message, fieldErrors } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(props.rows.map((row) => [row.departmentId, row.amount ?? ''])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const total = sumAmounts(Object.values(amounts));
  const totalText = new Intl.NumberFormat(`${props.locale}-u-nu-latn`, {
    style: 'currency',
    currency: props.currency,
    maximumFractionDigits: 3,
  }).format(total);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const found: Record<string, string> = {};
    for (const row of props.rows) {
      if (budgetAmountText(amounts[row.departmentId] ?? '') === undefined) {
        found[row.departmentId] = t('setup.fieldErrors.invalidAmount');
      }
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    startTransition(async () => {
      const result = await savePlanCycleBudgetsAction({
        id: props.cycle.id,
        version: props.cycle.version,
        budgets: props.rows.map((row) => ({
          departmentId: row.departmentId,
          amount: amounts[row.departmentId] ?? '',
        })),
      });
      if (result.ok) {
        router.push(cycleHref(props.locale, props.cycle.id, 'approvals'));
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      const byPath = fieldErrors(result.error);
      const mapped: Record<string, string> = {};
      props.rows.forEach((row, index) => {
        const text = byPath[`budgets.${String(index)}.amount`];
        if (text) mapped[row.departmentId] = text;
      });
      setErrors(mapped);
      setNotice(message(result.error));
    });
  }

  if (props.rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="billing"
          title={t('setup.budget.title')}
          description={t('setup.budget.noDepartments')}
        />
        <div className="mt-4 flex justify-end">
          <a href={props.backHref} className={buttonClasses({ variant: 'secondary', size: 'md' })}>
            {t('setup.back')}
          </a>
        </div>
      </Card>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-6"
      data-testid="cycle-budgets"
    >
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
      <Card flush title={t('setup.budget.title')} description={t('setup.budget.intro')}>
        <div className={tableClasses.wrapper}>
          <table className={tableClasses.table}>
            <caption className="sr-only">{t('setup.budget.title')}</caption>
            <thead className={tableClasses.header}>
              <tr>
                <th scope="col" className={tableClasses.head}>
                  {t('setup.budget.columns.department')}
                </th>
                <th scope="col" className={tableClasses.head}>
                  {t('setup.budget.columns.head')}
                </th>
                <th scope="col" className={tableClasses.head}>
                  {t('setup.budget.columns.envelope', { currency: props.currency })}
                </th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row) => {
                const id = `budget-${row.departmentId}`;
                const error = errors[row.departmentId];
                return (
                  <tr key={row.departmentId} className={tableClasses.row}>
                    <th scope="row" className={`${tableClasses.cell} text-start font-medium`}>
                      {row.name}
                    </th>
                    <td className={`${tableClasses.cell} text-text-muted`}>{row.head}</td>
                    <td className={tableClasses.cell}>
                      <label htmlFor={id} className="sr-only">
                        {t('setup.budget.amountLabel', { name: row.name })}
                      </label>
                      <input
                        id={id}
                        inputMode="decimal"
                        dir="ltr"
                        value={amounts[row.departmentId] ?? ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          setAmounts((current) => ({ ...current, [row.departmentId]: value }));
                          setErrors((current) => ({ ...current, [row.departmentId]: '' }));
                        }}
                        maxLength={20}
                        placeholder="0"
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${id}-error` : 'budget-hint'}
                        disabled={pending}
                        className={`min-h-9 w-40 rounded-full border bg-surface px-4 text-end text-sm shadow-1 pointer-coarse:min-h-11 ${
                          error ? 'border-danger' : 'border-border-strong'
                        }`}
                        data-testid="budget-amount"
                      />
                      {error ? (
                        <p id={`${id}-error`} className="m-0 mt-1 text-sm font-medium text-danger">
                          {error}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
          <p id="budget-hint" className="m-0 text-text-muted">
            {t('setup.budget.amountHint')}
          </p>
          <p className="m-0 font-semibold" aria-live="polite" data-testid="budget-total">
            {t('setup.budget.total', { amount: totalText })}
          </p>
        </div>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <a href={props.backHref} className={buttonClasses({ variant: 'secondary', size: 'md' })}>
          {t('setup.back')}
        </a>
        <Button type="submit" disabled={pending} data-testid="cycle-budgets-save">
          {pending ? t('setup.working') : t('setup.saveAndContinue')}
        </Button>
      </div>
    </form>
  );
}
