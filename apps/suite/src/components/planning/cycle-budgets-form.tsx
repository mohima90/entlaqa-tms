'use client';
import { savePlanCycleBudgetsAction } from '@jadarat/tms/actions/planning';
import { budgetAmountText } from '@jadarat/tms/planning-rules';
import { Alert, Card, EmptyState, FieldError, buttonClasses, tableClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { cycleHref, sumAmounts } from '../../lib/planning-view';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { StepFooter } from './cycle-chain-forms';
import { useUnsavedStep } from './setup-step-nav';
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
  /**
   * The unit column's label: the first level's name, or «Unit» when levels mix (then each row's name ends
   * with its level; guided-test feedback #3).
   */
  readonly unitColumn: string;
  readonly rows: readonly BudgetRow[];
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly backHref: string;
}

/**
 * Step 3 — Budget (EP-PLN B4; Q2: optional): a budget envelope per unit in scope, in the
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
  useUnsavedStep(
    props.rows.some((row) => (amounts[row.departmentId] ?? '') !== (row.amount ?? '')),
  );
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
      className="flex flex-col gap-4"
      data-testid="cycle-budgets"
    >
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
      <Card title={t('setup.budget.title')} description={t('setup.budget.intro')}>
        <div className="flex flex-col gap-4">
          <p
            className="m-0 flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-brand-gradient px-5 py-3.5 text-on-brand"
            aria-live="polite"
            data-testid="budget-total"
          >
            <span>{t('setup.budget.total', { amount: '' }).replace(/[:：]\s*$/, '')}</span>
            <b className="text-xl tabular-nums">{totalText}</b>
          </p>
          <div className="overflow-hidden rounded-2xl border border-border">
            {/* One table; on phones each row reads as a card (no second set of inputs). */}
            <table className={`${tableClasses.table} max-md:block`}>
              <caption className="sr-only">{t('setup.budget.title')}</caption>
              <thead className={`${tableClasses.header} max-md:hidden`}>
                <tr>
                  <th scope="col" className={tableClasses.head} data-testid="budget-unit-column">
                    {props.unitColumn}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('setup.budget.columns.head')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('setup.budget.columns.envelope', { currency: props.currency })}
                  </th>
                </tr>
              </thead>
              <tbody className="max-md:block">
                {props.rows.map((row) => {
                  const id = `budget-${row.departmentId}`;
                  const error = errors[row.departmentId];
                  return (
                    <tr
                      key={row.departmentId}
                      className={`${tableClasses.row} max-md:flex max-md:flex-col max-md:gap-2 max-md:px-4 max-md:py-3.5`}
                      data-testid="budget-row"
                    >
                      <th
                        scope="row"
                        className={`${tableClasses.cell} text-start font-medium max-md:h-auto max-md:p-0`}
                      >
                        {row.name}
                      </th>
                      <td
                        className={`${tableClasses.cell} text-text-muted max-md:h-auto max-md:p-0 max-md:text-[13px]`}
                      >
                        {row.head}
                      </td>
                      <td className={`${tableClasses.cell} py-2 max-md:h-auto max-md:p-0`}>
                        <label htmlFor={id} className="sr-only">
                          {t('setup.budget.amountLabel', { name: row.name })}
                        </label>
                        <div
                          className={`flex w-full items-stretch overflow-hidden rounded-xl border-[1.5px] bg-surface focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-primary md:w-50 ${
                            error ? 'border-danger' : 'border-border-strong'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className="grid place-items-center border-e border-border bg-surface-sunken px-3 text-[13.5px] font-semibold text-text-muted"
                          >
                            {props.currency}
                          </span>
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
                            className="min-h-[42px] w-full min-w-0 border-0 bg-transparent px-3 text-end tabular-nums outline-none pointer-coarse:min-h-11"
                            data-testid="budget-amount"
                          />
                        </div>
                        {error ? (
                          <div className="mt-1 whitespace-normal">
                            <FieldError id={`${id}-error`}>{error}</FieldError>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p id="budget-hint" className="m-0 text-sm text-text-muted">
            {t('setup.budget.amountHint')}
          </p>
        </div>
      </Card>
      <StepFooter
        backHref={props.backHref}
        backLabel={t('setup.back')}
        saveLabel={t('setup.saveAndContinue')}
        workingLabel={t('setup.working')}
        pending={pending}
        testId="cycle-budgets-save"
      />
    </form>
  );
}
