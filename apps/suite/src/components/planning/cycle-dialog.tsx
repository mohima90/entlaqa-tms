'use client';
import { createPlanCycleAction, updatePlanCycleAction } from '@jadarat/tms/actions/planning';
import type { DateDisplay } from '@jadarat/platform-i18n';
import { type ScopeSelection, basicsIssues, toFieldErrors } from '@jadarat/tms/planning-rules';
import { Alert, Button, Dialog, Icon, TextField } from '@jadarat/ui';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { dayFormatter } from '../../lib/planning-format';
import { PLANNING_PATHS, type PickerUnit, fieldErrorKey, sameScope } from '../../lib/planning-view';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { LoadLatestVersion, useFormBase } from '../latest-version';
import { SelectField } from '../select-field';
import { ScopePicker } from './scope-picker';
import { useFocusInvalid } from './use-focus-invalid';
import { usePlanningTexts } from './use-planning-texts';

/** What the popup edits. */
export interface CycleDialogValues {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly deadline: string;
  readonly needsFormId: string;
  readonly scope: ScopeSelection;
}

export interface CycleDialogProps {
  readonly locale: 'ar' | 'en';
  readonly open: boolean;
  readonly onClose: () => void;
  /** Edit a draft (its id, version and name), or create one. */
  readonly editing: {
    readonly id: string;
    readonly version: number;
    readonly name: string;
  } | null;
  readonly initial: CycleDialogValues;
  readonly units: readonly PickerUnit[];
  /** The organization's branches: a branch brings every department in it. */
  readonly branches: readonly {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
  }[];
  /** Active forms, plus the cycle's own form if it was switched off since (`active: false`, C-6). */
  readonly needsForms: readonly {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
  }[];
  /** The language whose name is required: the organization's default language (PO, 12 Nov 2026). */
  readonly nameLanguage: 'ar' | 'en';
  /** How the organization shows dates (the «Shown as» lines for Hijri or both calendars). */
  readonly display: DateDisplay;
  /** «Needs forms» (the menu entry): linked when there is no form to choose. */
  readonly needsFormsLabel: string;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** Saved: the list shows the draft (and says so). */
  readonly onSaved: (saved: { readonly created: boolean; readonly name: string }) => void;
}

/**
 * «New cycle» / «Edit» — one centred popup, 672 px (forms standard rule 9; the approved pilot of WP-UX-01 a,
 * T-M3-20; FR-PLN-02): the cycle's name in the organization's default language (the other language
 * optional), the plan period, the needs deadline, the departments (all of them by default) and the needs
 * form (the default one). Budgets, instructions and reminders wait on the cycle's Settings page. «Cancel»,
 * then «Create cycle» at the end. Creating and editing are each ONE save: the names, the dates, the form
 * and the departments are written together or not at all. A refused save moves the focus to the first
 * field with a message. The fields are mounted when the popup opens, so every opening starts from the
 * values given.
 */
export function CycleDialog(props: CycleDialogProps) {
  const { t } = usePlanningTexts(props.texts, props.errors, props.locale);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      canClose={() => !busy}
      size="rich"
      title={
        props.editing ? t('dialog.editTitle', { name: props.editing.name }) : t('dialog.newTitle')
      }
      description={props.editing ? t('dialog.editIntro') : t('dialog.newIntro')}
      closeLabel={t('setup.close')}
      data-testid="cycle-dialog"
    >
      {props.open ? (
        <CycleForm key={props.editing?.id ?? 'new'} {...props} onBusy={setBusy} />
      ) : null}
    </Dialog>
  );
}

type Field = 'nameAr' | 'nameEn' | 'periodStart' | 'periodEnd' | 'deadline' | 'needsFormId';
type Errors = Partial<Record<Field | 'departments', string | undefined>>;

const BASICS: readonly Field[] = [
  'nameAr',
  'nameEn',
  'periodStart',
  'periodEnd',
  'deadline',
  'needsFormId',
];

function CycleForm(props: CycleDialogProps & { readonly onBusy: (busy: boolean) => void }) {
  const { t, formMessage, fieldErrors } = usePlanningTexts(props.texts, props.errors, props.locale);
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<CycleDialogValues>(props.initial);
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const { form, focusInvalid } = useFocusInvalid(pending);
  const day = dayFormatter(props.locale, props.display);
  const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  const basicsChanged = (from: CycleDialogValues) =>
    BASICS.some((field) => values[field] !== from[field]);
  // The fields and the version they were read at stay together (review H1); a new cycle has no version.
  const base = useFormBase(
    { version: props.editing?.version ?? 0, initial: props.initial },
    (initial) =>
      props.editing !== null && (basicsChanged(initial) || !sameScope(values.scope, initial.scope)),
    (initial) => {
      setValues(initial);
      setErrors({});
    },
  );
  const working = pending;

  function update(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function refuse(error: Parameters<typeof formMessage>[0]) {
    if (sessionRefused(error)) return;
    const byPath = fieldErrors(error);
    const departments = Object.entries(byPath).find(
      ([path]) => path.startsWith('departmentIds') || path.startsWith('branchIds'),
    )?.[1];
    setErrors({ ...(byPath as Errors), ...(departments ? { departments } : {}) });
    setNotice(formMessage(error));
    focusInvalid();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const found: Errors = {};
    const requiredName = props.nameLanguage === 'ar' ? 'nameAr' : 'nameEn';
    for (const field of [requiredName, 'periodStart', 'periodEnd', 'deadline'] as const) {
      if (values[field].trim() === '') found[field] = t('setup.fieldErrors.required');
    }
    for (const issue of toFieldErrors(basicsIssues(values))) {
      found[issue.path as Field] ??= t(fieldErrorKey(issue.code));
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      focusInvalid();
      return;
    }
    const basics = {
      nameAr: values.nameAr,
      nameEn: values.nameEn,
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      deadline: values.deadline,
      needsFormId: values.needsFormId === '' ? null : values.needsFormId,
      departmentIds: [...values.scope.departmentIds],
      branchIds: [...values.scope.branchIds],
    };
    const name = (props.locale === 'ar' ? values.nameAr : values.nameEn).trim();
    const shownName = name || (values.nameAr.trim() ? values.nameAr.trim() : values.nameEn.trim());
    const editing = props.editing;
    props.onBusy(true);
    startTransition(async () => {
      try {
        // One save either way (review of T-M3-20): nothing is written when a part of it is refused.
        const result = editing
          ? base.dirty
            ? await updatePlanCycleAction({ ...basics, id: editing.id, version: base.version })
            : null
          : await createPlanCycleAction(basics);
        if (result && !result.ok) {
          refuse(result.error);
          return;
        }
        props.onSaved({ created: !editing, name: shownName });
      } finally {
        props.onBusy(false);
      }
    });
  }

  const shownAs = (text: string, testId: string) => (
    <p
      className="m-0 inline-flex w-fit items-center gap-2 rounded-[10px] bg-primary-subtle px-3 py-1.5 text-[13px] font-semibold text-primary-text"
      data-testid={testId}
    >
      <Icon name="calendar" className="size-3.5" />
      {t('setup.basics.shownAs', { date: text })}
    </p>
  );
  // The native date fields show the Gregorian calendar: an organization that shows Hijri dates (or both)
  // reads the day as it will be shown.
  const otherCalendar = props.display !== 'gregorian';

  return (
    <form
      ref={form}
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
      data-testid="cycle-form"
    >
      {notice ? (
        <Alert tone="danger" data-testid="cycle-form-error">
          {notice}
          <LoadLatestVersion message={notice} />
        </Alert>
      ) : null}
      {/* The name in the organization's default language first and required; the other language is
          optional (PO, 12 Nov 2026). Side by side on a desktop, one per row on a phone. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(props.nameLanguage === 'ar' ? (['ar', 'en'] as const) : (['en', 'ar'] as const)).map(
          (language) => {
            const field = language === 'ar' ? 'nameAr' : 'nameEn';
            const required = language === props.nameLanguage;
            return (
              <TextField
                key={field}
                id={`cycle-name-${language}`}
                label={t(`dialog.${field}`)}
                marker={required ? t('setup.required') : undefined}
                value={values[field]}
                onChange={(event) => {
                  update(field, event.target.value);
                }}
                maxLength={120}
                required={required}
                dir={language === 'ar' ? 'rtl' : 'ltr'}
                lang={language}
                autoComplete="off"
                error={errors[field]}
                disabled={working}
              />
            );
          },
        )}
      </div>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
        <TextField
          id="cycle-period-start"
          type="date"
          label={t('dialog.periodStart')}
          marker={t('setup.required')}
          value={values.periodStart}
          onChange={(event) => {
            update('periodStart', event.target.value);
          }}
          required
          error={errors.periodStart}
          disabled={working}
        />
        <TextField
          id="cycle-period-end"
          type="date"
          label={t('dialog.periodEnd')}
          marker={t('setup.required')}
          value={values.periodEnd}
          onChange={(event) => {
            update('periodEnd', event.target.value);
          }}
          required
          error={errors.periodEnd}
          disabled={working}
        />
        <TextField
          id="cycle-deadline"
          type="date"
          label={t('dialog.deadline')}
          marker={t('setup.required')}
          value={values.deadline}
          onChange={(event) => {
            update('deadline', event.target.value);
          }}
          required
          error={errors.deadline}
          disabled={working}
        />
      </div>
      {otherCalendar ? (
        <div className="flex flex-wrap gap-2">
          {isDay(values.periodStart) && isDay(values.periodEnd) && !errors.periodEnd
            ? shownAs(`${day(values.periodStart)} – ${day(values.periodEnd)}`, 'cycle-period-shown')
            : null}
          {isDay(values.deadline) && !errors.deadline
            ? shownAs(day(values.deadline), 'cycle-deadline-shown')
            : null}
        </div>
      ) : null}
      <hr className="m-0 border-0 border-t border-border" />
      {props.units.length === 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-sm font-semibold">{t('dialog.departments')}</p>
          <p className="m-0 text-sm text-text-muted" data-testid="scope-no-structure">
            {t('setup.scope.noStructure')}
          </p>
        </div>
      ) : (
        <ScopePicker
          units={props.units}
          branches={props.branches}
          value={values.scope}
          onChange={(scope) => {
            setValues((current) => ({ ...current, scope }));
            setErrors((current) => ({ ...current, departments: undefined }));
          }}
          disabled={working}
          error={errors.departments}
          t={t}
        />
      )}
      <SelectField
        id="cycle-needs-form"
        label={t('setup.basics.needsForm')}
        hint={
          props.needsForms.length === 0 ? (
            <>
              {t('setup.basics.needsFormHint')}{' '}
              <a href={`/${props.locale}${PLANNING_PATHS.needsForms}`}>{props.needsFormsLabel}</a>
            </>
          ) : undefined
        }
        value={values.needsFormId}
        onChange={(event) => {
          update('needsFormId', event.target.value);
        }}
        error={errors.needsFormId}
        disabled={working}
        data-testid="cycle-needs-form"
      >
        {/* No «none» choice (C-6): a cycle always uses a form (the default preselected). */}
        {values.needsFormId === '' ? (
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
      <p
        className="m-0 rounded-xl bg-surface-sunken px-3.5 py-3 text-[13px] leading-relaxed text-text-muted"
        data-testid="cycle-dialog-note"
      >
        {t('dialog.note')}
      </p>
      {/* «Cancel», then the primary button at the end. The footer stays in view while a long popup
          scrolls (a short screen, many departments), so the way out and the way on are always there. */}
      <div className="sticky bottom-0 -mx-6 -mb-6 mt-1.5 flex flex-col-reverse gap-2.5 border-t border-border bg-surface-raised px-6 py-4 sm:-mx-6.5 sm:-mb-6.5 sm:flex-row sm:flex-wrap sm:justify-end sm:px-6.5">
        <Button
          variant="secondary"
          onClick={props.onClose}
          disabled={working}
          data-testid="cycle-form-cancel"
        >
          {t('setup.cancel')}
        </Button>
        <Button type="submit" disabled={working} busy={working} data-testid="cycle-form-save">
          {working ? t('setup.working') : props.editing ? t('dialog.save') : t('dialog.create')}
        </Button>
      </div>
    </form>
  );
}
