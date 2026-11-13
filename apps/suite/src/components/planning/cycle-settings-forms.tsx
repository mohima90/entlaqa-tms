'use client';
import {
  savePlanCycleBudgetsAction,
  savePlanCycleRemindersAction,
  savePlanCycleScopeAction,
  updatePlanCycleBasicsAction,
} from '@jadarat/tms/actions/planning';
import type { AppError } from '@jadarat/platform-core';
import { PLAN_LIMITS, type ScopeSelection, budgetAmountText } from '@jadarat/tms/planning-rules';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  FieldError,
  Icon,
  SaveBar,
  buttonClasses,
  tableClasses,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, type SyntheticEvent, useEffect, useState, useTransition } from 'react';
import {
  PLANNING_PATHS,
  type PickerUnit,
  parseReminderDays,
  sameScope,
  sumAmounts,
} from '../../lib/planning-view';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { LoadLatestVersion, useFormBase } from '../latest-version';
import { SelectField } from '../select-field';
import { LeaveGuard } from '../settings/leave-guard';
import { ReminderDaysEditor } from './reminder-days-editor';
import { ScopePicker } from './scope-picker';
import { usePlanningTexts } from './use-planning-texts';

/*
 * The sections of a draft cycle's Settings page (the Kawadir pattern — forms standard rule 9; WP-UX-01 a,
 * T-M3-20): «Departments & budgets», «Instructions to heads», «Reminders» and «Needs form». Each section
 * is its own address; the one save bar saves the section that is open, with the cycle's version (ADR 0011):
 * an older copy is refused and «Load the latest version» is offered (`useFormBase`). The forms are the
 * set-up's forms, moved: what they save and how they are checked has not changed.
 */

interface Common {
  readonly locale: 'ar' | 'en';
  readonly cycle: { readonly id: string; readonly version: number };
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

const FORM_ID = 'cycle-settings';

/**
 * The fields of a section, the copy they were read from and its version (`useFormBase`, review H1) — for a
 * form that stays on the page after saving: what the save wrote counts as saved at the version it returned,
 * until the page has loaded that version itself. Typed entries are never replaced by a newer copy.
 */
function useSectionBase<T>(
  current: { readonly version: number; readonly initial: T },
  differs: (from: T) => boolean,
  take: (latest: T) => void,
  snapshot: () => T,
) {
  const [saved, setSaved] = useState<{ readonly version: number; readonly values: T } | null>(null);
  const base = useFormBase(
    current,
    (initial) => differs(saved ? saved.values : initial),
    (latest) => {
      setSaved(null);
      take(latest);
    },
  );
  return {
    dirty: base.dirty,
    /** The version to send: the one the last save returned, else the one the fields were read at. */
    version: saved?.version ?? base.version,
    markSaved: (version: number) => {
      setSaved({ version, values: snapshot() });
    },
    /** The values to go back to with «Discard changes». */
    restore: saved ? saved.values : base.initial,
  };
}

/** The form of a section: its message, its fields, the save bar once something changed, the leave question. */
function SectionForm({
  t,
  dirty,
  pending,
  notice,
  onSubmit,
  onDiscard,
  testId,
  children,
}: {
  readonly t: (key: string) => string;
  readonly dirty: boolean;
  readonly pending: boolean;
  readonly notice: string | null;
  readonly onSubmit: () => void;
  readonly onDiscard: () => void;
  readonly testId: string;
  readonly children: ReactNode;
}) {
  // Said to the page: it does not reload itself over unsaved entries (RefreshOnReturn, WP-FIX-03).
  useEffect(() => {
    if (dirty) document.body.dataset.unsaved = 'true';
    else delete document.body.dataset.unsaved;
    return () => {
      delete document.body.dataset.unsaved;
    };
  }, [dirty]);
  return (
    <form
      id={FORM_ID}
      onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
      }}
      onReset={(event) => {
        event.preventDefault();
        onDiscard();
      }}
      noValidate
      className="flex min-w-0 flex-col gap-4"
      data-testid={testId}
    >
      {notice ? (
        <Alert tone="danger" data-testid="cycle-settings-error">
          {notice}
          <LoadLatestVersion message={notice} />
        </Alert>
      ) : null}
      {children}
      {dirty || pending ? (
        <SaveBar
          state={pending ? 'saving' : 'unsaved'}
          form={FORM_ID}
          texts={{
            unsaved: t('unsavedChanges'),
            saving: t('setup.working'),
            saved: '',
            save: t('setup.save'),
            cancel: t('discardChanges'),
          }}
        />
      ) : null}
      <LeaveGuard
        active={dirty && !pending}
        texts={{
          leaveTitle: t('leaveTitle'),
          leaveText: t('leaveText'),
          leaveStay: t('leaveStay'),
          leaveGo: t('leaveGo'),
          close: t('setup.close'),
        }}
      />
    </form>
  );
}

/** Saving a section: the message of a refusal, «Changes saved.» and the page's latest copy afterwards. */
function useSectionSave(props: Common) {
  const { t, formMessage, fieldErrors } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  return {
    t,
    fieldErrors,
    pending,
    notice,
    clearNotice: () => {
      setNotice(null);
    },
    run: (
      save: () => Promise<
        | { readonly ok: true; readonly value: { readonly version: number } }
        | { readonly ok: false; readonly error: AppError }
      >,
      onSaved: (version: number) => void,
      onRefused?: (error: AppError) => void,
    ) => {
      setNotice(null);
      startTransition(async () => {
        const result = await save();
        if (result.ok) {
          onSaved(result.value.version);
          toast.success(t('setup.saved'));
          router.refresh();
          return;
        }
        if (sessionRefused(result.error)) return;
        onRefused?.(result.error);
        setNotice(formMessage(result.error));
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Departments & budgets
// ---------------------------------------------------------------------------------------------------

export interface BudgetRow {
  readonly departmentId: string;
  readonly name: string;
  /** Who receives the department's form, as text; null: nobody yet. */
  readonly head: string | null;
  readonly amount: string | null;
}

export interface CycleDepartmentsFormProps extends Common {
  readonly currency: string;
  /**
   * The department column's label: the first level's name, or the general word when levels mix (then each
   * row's name ends with its level; guided-test feedback #3).
   */
  readonly unitColumn: string;
  readonly rows: readonly BudgetRow[];
  /** The structure and the branches, for «Add or remove departments». */
  readonly units: readonly PickerUnit[];
  readonly branches: readonly {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
  }[];
  readonly scope: ScopeSelection;
  /** The member picks heads under Organization → Departments. */
  readonly canPickHeads: boolean;
}

const amountsOf = (rows: readonly BudgetRow[]): Record<string, string> =>
  Object.fromEntries(rows.map((row) => [row.departmentId, row.amount ?? '']));

/**
 * «Departments & budgets» (EP-PLN B4; Q2: optional): the departments in the cycle with their heads and an
 * optional budget each, in the organization's currency (BR-PLN-i) — empty = no budget — and the total.
 * «Add or remove departments» opens the departments of the cycle in a popup that saves on its own.
 */
export function CycleDepartmentsForm(props: CycleDepartmentsFormProps) {
  const section = useSectionSave(props);
  const { t } = section;
  const [amounts, setAmounts] = useState<Record<string, string>>(() => amountsOf(props.rows));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState(false);
  const differs = (rows: readonly BudgetRow[]) =>
    rows.some((row) => (amounts[row.departmentId] ?? '') !== (row.amount ?? ''));
  // The amounts and the version they were read at stay together (review H1).
  const base = useSectionBase<readonly BudgetRow[]>(
    { version: props.cycle.version, initial: props.rows },
    differs,
    (rows) => {
      setAmounts(amountsOf(rows));
      setErrors({});
    },
    () => props.rows.map((row) => ({ ...row, amount: amounts[row.departmentId] ?? '' })),
  );
  const total = sumAmounts(Object.values(amounts));
  const totalText = new Intl.NumberFormat(`${props.locale}-u-nu-latn`, {
    style: 'currency',
    currency: props.currency,
    maximumFractionDigits: 3,
  }).format(total);

  function onSubmit() {
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
    section.run(
      () =>
        savePlanCycleBudgetsAction({
          id: props.cycle.id,
          version: base.version,
          budgets: props.rows.map((row) => ({
            departmentId: row.departmentId,
            amount: amounts[row.departmentId] ?? '',
          })),
        }),
      base.markSaved,
      (error) => {
        const byPath = section.fieldErrors(error);
        const mapped: Record<string, string> = {};
        props.rows.forEach((row, index) => {
          const text = byPath[`budgets.${String(index)}.amount`];
          if (text) mapped[row.departmentId] = text;
        });
        setErrors(mapped);
      },
    );
  }

  const editDepartments = (
    <div className="flex flex-col gap-1.5">
      <Button
        variant="secondary"
        onClick={() => {
          setPicking(true);
        }}
        // Saving the departments makes a new version of the cycle: typed budgets are saved first.
        disabled={base.dirty || section.pending}
        aria-describedby={base.dirty ? 'cycle-departments-first' : undefined}
        className="w-full sm:w-auto"
        data-testid="cycle-departments-edit"
      >
        <Icon name="structure" />
        {t('setup.budget.editDepartments')}
      </Button>
      {base.dirty ? (
        <p id="cycle-departments-first" className="m-0 text-[13px] text-text-muted">
          {t('setup.unsavedFirst')}
        </p>
      ) : null}
    </div>
  );
  const structureHref = `/${props.locale}${PLANNING_PATHS.structure}`;

  return (
    <>
      <SectionForm
        t={t}
        dirty={base.dirty}
        pending={section.pending}
        notice={section.notice}
        onSubmit={onSubmit}
        onDiscard={() => {
          setAmounts(amountsOf(base.restore));
          setErrors({});
          section.clearNotice();
        }}
        testId="cycle-budgets"
      >
        <Card
          title={t('cycleSettings.tabs.departments')}
          description={`${t('setup.budget.intro')} ${t('setup.basics.currency', { currency: props.currency })}`}
          headingLevel={2}
        >
          {props.rows.length === 0 ? (
            <EmptyState
              icon="structure"
              title={t('setup.launch.problems.no_departments')}
              description={t('setup.budget.empty')}
              action={editDepartments}
              headingLevel={3}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="overflow-hidden rounded-2xl border border-border">
                {/* One table; on phones each row reads as a card (no second set of inputs). */}
                <table className={`${tableClasses.table} max-md:block`}>
                  <caption className="sr-only">{t('cycleSettings.tabs.departments')}</caption>
                  <thead className={`${tableClasses.header} max-md:hidden`}>
                    <tr>
                      <th
                        scope="col"
                        className={tableClasses.head}
                        data-testid="budget-unit-column"
                      >
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
                            {row.head ??
                              (props.canPickHeads ? (
                                <a
                                  href={structureHref}
                                  aria-label={t('setup.budget.pickHeadFor', { name: row.name })}
                                  className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                                  data-testid="budget-pick-head"
                                >
                                  {t('setup.budget.pickHead')}
                                </a>
                              ) : (
                                <Badge tone="warning">{t('dialog.noHeadYet')}</Badge>
                              ))}
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
                                  setAmounts((current) => ({
                                    ...current,
                                    [row.departmentId]: value,
                                  }));
                                  setErrors((current) => ({ ...current, [row.departmentId]: '' }));
                                }}
                                maxLength={20}
                                placeholder={t('setup.budget.placeholder')}
                                aria-invalid={error ? true : undefined}
                                aria-describedby={error ? `${id}-error` : 'budget-hint'}
                                disabled={section.pending}
                                className="min-h-[42px] w-full min-w-0 border-0 bg-transparent px-3 text-end tabular-nums outline-none placeholder:text-text-subtle pointer-coarse:min-h-11"
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
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                {editDepartments}
                <p
                  className="m-0 ms-auto text-[15px]"
                  aria-live="polite"
                  data-testid="budget-total"
                >
                  {t('setup.budget.total', { amount: '' }).replace(/[:：]\s*$/, '')}:{' '}
                  <b className="tabular-nums">{totalText}</b>
                </p>
              </div>
            </div>
          )}
        </Card>
      </SectionForm>
      <ScopeDialog
        {...props}
        open={picking}
        onClose={() => {
          setPicking(false);
        }}
      />
    </>
  );
}

/**
 * «Add or remove departments»: the departments and branches of the cycle in a popup that saves on its own
 * (the set-up's Scope step, moved). A department includes everything under it; one needs form per
 * department in the cycle, and departments whose form reaches no head are counted.
 */
function ScopeDialog(
  props: CycleDepartmentsFormProps & { readonly open: boolean; readonly onClose: () => void },
) {
  const { t } = usePlanningTexts(props.texts, props.errors, props.locale);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      canClose={() => !busy}
      size="rich"
      title={t('dialog.departments')}
      description={t('setup.scope.intro')}
      closeLabel={t('setup.close')}
      data-testid="cycle-scope-dialog"
    >
      {props.open ? <ScopeForm {...props} onBusy={setBusy} /> : null}
    </Dialog>
  );
}

function ScopeForm(
  props: CycleDepartmentsFormProps & {
    readonly onClose: () => void;
    readonly onBusy: (busy: boolean) => void;
  },
) {
  const { t, formMessage, fieldErrors } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [scope, setScope] = useState<ScopeSelection>(props.scope);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  // The ticks and the version they were read at stay together (review H1).
  const base = useFormBase(
    { version: props.cycle.version, initial: props.scope },
    (initial) => !sameScope(scope, initial),
    (initial) => {
      setScope(initial);
    },
  );

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    if (!base.dirty) {
      props.onClose();
      return;
    }
    props.onBusy(true);
    startTransition(async () => {
      try {
        const result = await savePlanCycleScopeAction({
          id: props.cycle.id,
          version: base.version,
          departmentIds: [...scope.departmentIds],
          branchIds: [...scope.branchIds],
        });
        if (result.ok) {
          toast.success(t('setup.saved'));
          props.onClose();
          router.refresh();
          return;
        }
        if (sessionRefused(result.error)) return;
        setError(Object.values(fieldErrors(result.error))[0]);
        setNotice(formMessage(result.error));
      } finally {
        props.onBusy(false);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" data-testid="cycle-scope">
      {notice ? (
        <Alert tone="danger">
          {notice}
          <LoadLatestVersion message={notice} />
        </Alert>
      ) : null}
      {props.units.length === 0 ? (
        <p className="m-0 text-text-muted" data-testid="scope-no-structure">
          {t('setup.scope.noStructure')}
        </p>
      ) : (
        <ScopePicker
          units={props.units}
          branches={props.branches}
          value={scope}
          onChange={(next) => {
            setScope(next);
            setError(undefined);
          }}
          disabled={pending}
          error={error}
          t={t}
        />
      )}
      <div className="sticky bottom-0 -mx-6 -mb-6 mt-1.5 flex flex-col-reverse gap-2.5 border-t border-border bg-surface-raised px-6 py-4 sm:-mx-6.5 sm:-mb-6.5 sm:flex-row sm:flex-wrap sm:justify-end sm:px-6.5">
        <Button variant="secondary" onClick={props.onClose} disabled={pending}>
          {t('setup.cancel')}
        </Button>
        <Button type="submit" disabled={pending} busy={pending} data-testid="cycle-scope-save">
          {pending ? t('setup.working') : t('setup.save')}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------
// Instructions to heads · Needs form (both are part of the cycle's basics)
// ---------------------------------------------------------------------------------------------------

/** The cycle's basics as stored: a section changes its own fields and sends the others back as they are. */
export interface CycleBasics {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly deadline: string;
  readonly instructionsAr: string;
  readonly instructionsEn: string;
  readonly needsFormId: string;
}

const basicsInput = (basics: CycleBasics) => ({
  ...basics,
  needsFormId: basics.needsFormId === '' ? null : basics.needsFormId,
});

export interface CycleInstructionsFormProps extends Common {
  readonly basics: CycleBasics;
  /** The organization's default language: its instructions are asked first. */
  readonly nameLanguage: 'ar' | 'en';
}

/** «Instructions to heads»: shown at the top of every needs form, in Arabic and English (both optional). */
export function CycleInstructionsForm(props: CycleInstructionsFormProps) {
  const section = useSectionSave(props);
  const { t } = section;
  const initial = {
    instructionsAr: props.basics.instructionsAr,
    instructionsEn: props.basics.instructionsEn,
  };
  const [values, setValues] = useState(initial);
  const base = useSectionBase(
    { version: props.cycle.version, initial },
    (from) =>
      values.instructionsAr !== from.instructionsAr ||
      values.instructionsEn !== from.instructionsEn,
    setValues,
    () => values,
  );

  const textarea = (field: 'instructionsAr' | 'instructionsEn') => {
    const id = `cycle-${field}`;
    const arabic = field === 'instructionsAr';
    return (
      <div key={field} className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-semibold">
          {t(`setup.basics.${field}`)}
        </label>
        <textarea
          id={id}
          value={values[field]}
          onChange={(event) => {
            const value = event.target.value;
            setValues((current) => ({ ...current, [field]: value }));
          }}
          maxLength={PLAN_LIMITS.instructionsMax}
          rows={5}
          dir={arabic ? 'rtl' : 'ltr'}
          lang={arabic ? 'ar' : 'en'}
          aria-describedby="cycle-instructions-hint"
          disabled={section.pending}
          className="w-full rounded-md border-[1.5px] border-border-strong bg-surface px-3.5 py-2.5 text-[15px] text-text disabled:cursor-not-allowed disabled:bg-surface-sunken"
        />
      </div>
    );
  };

  return (
    <SectionForm
      t={t}
      dirty={base.dirty}
      pending={section.pending}
      notice={section.notice}
      onSubmit={() => {
        section.run(
          () =>
            updatePlanCycleBasicsAction({
              ...basicsInput(props.basics),
              ...values,
              id: props.cycle.id,
              version: base.version,
            }),
          base.markSaved,
        );
      }}
      onDiscard={() => {
        setValues(base.restore);
        section.clearNotice();
      }}
      testId="cycle-instructions"
    >
      <Card
        title={t('cycleSettings.tabs.instructions')}
        description={t('cycleSettings.instructionsIntro')}
        headingLevel={2}
      >
        <div className="flex flex-col gap-4">
          {(props.nameLanguage === 'ar'
            ? (['instructionsAr', 'instructionsEn'] as const)
            : (['instructionsEn', 'instructionsAr'] as const)
          ).map(textarea)}
          <p id="cycle-instructions-hint" className="m-0 text-sm text-text-muted">
            {t('setup.basics.instructionsHint')}
          </p>
        </div>
      </Card>
    </SectionForm>
  );
}

export interface CycleNeedsFormFormProps extends Common {
  readonly basics: CycleBasics;
  /** Active forms, plus the cycle's own form if it was switched off since (`active: false`, C-6). */
  readonly needsForms: readonly {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
  }[];
  /** «Needs forms» (the menu entry): where forms are designed. */
  readonly needsFormsLabel: string;
}

/** «Needs form»: the form department heads fill in; a cycle needs one to launch, and the launch locks it. */
export function CycleNeedsFormForm(props: CycleNeedsFormFormProps) {
  const section = useSectionSave(props);
  const { t } = section;
  const [needsFormId, setNeedsFormId] = useState(props.basics.needsFormId);
  const [error, setError] = useState<string | undefined>(undefined);
  const base = useSectionBase(
    { version: props.cycle.version, initial: props.basics.needsFormId },
    (from) => needsFormId !== from,
    (latest) => {
      setNeedsFormId(latest);
      setError(undefined);
    },
    () => needsFormId,
  );

  return (
    <SectionForm
      t={t}
      dirty={base.dirty}
      pending={section.pending}
      notice={section.notice}
      onSubmit={() => {
        section.run(
          () =>
            updatePlanCycleBasicsAction({
              ...basicsInput({ ...props.basics, needsFormId }),
              id: props.cycle.id,
              version: base.version,
            }),
          base.markSaved,
          (refused) => {
            setError(section.fieldErrors(refused).needsFormId);
          },
        );
      }}
      onDiscard={() => {
        setNeedsFormId(base.restore);
        setError(undefined);
        section.clearNotice();
      }}
      testId="cycle-needs-form-section"
    >
      <Card
        title={t('cycleSettings.tabs.form')}
        description={t('cycleSettings.formIntro')}
        headingLevel={2}
      >
        <SelectField
          id="cycle-needs-form"
          label={t('setup.basics.needsForm')}
          hint={
            <>
              {t('setup.basics.needsFormHint')}{' '}
              <a href={`/${props.locale}${PLANNING_PATHS.needsForms}`}>{props.needsFormsLabel}</a>
            </>
          }
          value={needsFormId}
          onChange={(event) => {
            setNeedsFormId(event.target.value);
            setError(undefined);
          }}
          error={
            error ??
            (props.needsForms.length === 0 ? t('setup.launch.problems.no_needs_form') : undefined)
          }
          disabled={section.pending}
          className="max-w-xl"
          data-testid="cycle-needs-form"
        >
          {/* No «none» choice (C-6): a cycle always uses a form (the default preselected). */}
          {needsFormId === '' ? (
            <option value="" disabled>
              {t('setup.basics.needsFormNone')}
            </option>
          ) : null}
          {props.needsForms.map((form) => (
            <option key={form.id} value={form.id}>
              {form.active ? form.name : t('setup.basics.needsFormOff', { name: form.name })}
            </option>
          ))}
        </SelectField>
      </Card>
    </SectionForm>
  );
}

// ---------------------------------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------------------------------

export interface CycleRemindersFormProps extends Common {
  readonly initial: readonly number[];
}

/** «Defaults come from Planning settings.» with the settings' name as a link. */
function DefaultsLink({ locale, t }: { locale: 'ar' | 'en'; t: (key: string) => string }) {
  const text = t('setup.defaultsLink');
  const name = t('settings.title');
  const at = text.indexOf(name);
  const link = <a href={`/${locale}${PLANNING_PATHS.settings}`}>{name}</a>;
  return (
    <p className="m-0 text-sm text-text-muted" data-testid="planning-defaults-link">
      {at === -1 ? (
        <>
          {text} {link}
        </>
      ) : (
        <>
          {text.slice(0, at)}
          {link}
          {text.slice(at + name.length)}
        </>
      )}
    </p>
  );
}

/** «Reminders» (business flow B4): days before the deadline as chips. */
export function CycleRemindersForm(props: CycleRemindersFormProps) {
  const section = useSectionSave(props);
  const { t } = section;
  const [days, setDays] = useState<string[]>(props.initial.map(String));
  const [error, setError] = useState<string | undefined>(undefined);
  // The days and the version they were read at stay together (review H1).
  const base = useSectionBase<readonly string[]>(
    { version: props.cycle.version, initial: props.initial.map(String) },
    (from) => days.join(',') !== from.join(','),
    (latest) => {
      setDays([...latest]);
      setError(undefined);
    },
    () => days,
  );

  return (
    <SectionForm
      t={t}
      dirty={base.dirty}
      pending={section.pending}
      notice={section.notice}
      onSubmit={() => {
        const parsed = parseReminderDays(days);
        if (!parsed.ok) {
          setError(t(parsed.key));
          return;
        }
        section.run(
          () =>
            savePlanCycleRemindersAction({
              id: props.cycle.id,
              version: base.version,
              reminderDays: parsed.days,
            }),
          base.markSaved,
        );
      }}
      onDiscard={() => {
        setDays([...base.restore]);
        setError(undefined);
        section.clearNotice();
      }}
      testId="cycle-reminders"
    >
      <Card
        title={t('cycleSettings.tabs.reminders')}
        description={t('setup.reminders.intro')}
        headingLevel={2}
      >
        <div className="flex flex-col gap-4">
          <ReminderDaysEditor
            locale={props.locale}
            days={days}
            onChange={setDays}
            error={error}
            onError={setError}
            disabled={section.pending}
            t={t}
            maxReminders={PLAN_LIMITS.maxReminders}
          />
          <Alert tone="info">{t('setup.reminders.notificationsNote')}</Alert>
          <DefaultsLink locale={props.locale} t={t} />
        </div>
      </Card>
    </SectionForm>
  );
}
