'use client';
import { createPlanCycleAction, updatePlanCycleBasicsAction } from '@jadarat/tms/actions/planning';
import { basicsIssues, toFieldErrors } from '@jadarat/tms/planning-rules';
import type { DateDisplay } from '@jadarat/platform-i18n';
import { Alert, Button, Card, Icon, TextField, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { dayFormatter } from '../../lib/planning-format';
import { PLANNING_PATHS, cycleHref, fieldErrorKey } from '../../lib/planning-view';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';
import { StepFooter } from './cycle-chain-forms';
import { useUnsavedStep } from './setup-step-nav';
import { usePlanningTexts } from './use-planning-texts';

/** «Shown as …»: a day as the organization shows dates (Gregorian · Hijri), under a date field. */
function ShownAs({ text, testId }: { text: string; testId?: string }) {
  return (
    <p
      className="m-0 inline-flex w-fit items-center gap-2 rounded-[10px] bg-primary-subtle px-3 py-1.5 text-[13.5px] font-semibold text-primary-text"
      data-testid={testId}
    >
      <Icon name="calendar" className="size-3.5" />
      {text}
    </p>
  );
}

export interface CycleBasicsValues {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly deadline: string;
  readonly instructionsAr: string;
  readonly instructionsEn: string;
  readonly needsFormId: string;
}

export interface CycleBasicsFormProps {
  readonly locale: 'ar' | 'en';
  /** Edit a draft (its id and version), or create one. */
  readonly editing: { readonly id: string; readonly version: number } | null;
  readonly initial: CycleBasicsValues;
  /** Active forms, plus the cycle's own form if it was switched off since (`active: false`, C-6). */
  readonly needsForms: readonly {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
  }[];
  readonly currency: string;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly cancelHref: string;
  /** How the organization shows dates (the «Shown as» lines under the dates). */
  readonly display: DateDisplay;
  /** «Needs forms» (the menu entry): linked when there is no form to choose. */
  readonly needsFormsLabel: string;
}

type Field = keyof CycleBasicsValues;

/**
 * Step 1 of the cycle set-up — Basics (EP-PLN B4; FR-PLN-02): names in Arabic and English, the planning
 * period (suggested: the next fiscal year), the deadline for department forms, instructions to department
 * heads and the needs form. Creating saves a draft and goes on to the scope.
 */
export function CycleBasicsForm(props: CycleBasicsFormProps) {
  const { t, message, fieldErrors } = usePlanningTexts(props.texts, props.errors, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<CycleBasicsValues>(props.initial);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const day = dayFormatter(props.locale, props.display);
  const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  useUnsavedStep(
    props.editing !== null &&
      (Object.keys(values) as Field[]).some((field) => values[field] !== props.initial[field]),
  );

  function update(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const found: Partial<Record<Field, string>> = {};
    for (const field of ['nameAr', 'nameEn', 'periodStart', 'periodEnd', 'deadline'] as const) {
      if (values[field].trim() === '') found[field] = t('setup.fieldErrors.required');
    }
    for (const issue of toFieldErrors(basicsIssues(values))) {
      found[issue.path as Field] ??= t(fieldErrorKey(issue.code));
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    const input = {
      nameAr: values.nameAr,
      nameEn: values.nameEn,
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      deadline: values.deadline,
      instructionsAr: values.instructionsAr,
      instructionsEn: values.instructionsEn,
      needsFormId: values.needsFormId === '' ? null : values.needsFormId,
    };
    startTransition(async () => {
      const result = props.editing
        ? await updatePlanCycleBasicsAction({
            ...input,
            id: props.editing.id,
            version: props.editing.version,
          })
        : await createPlanCycleAction(input);
      if (result.ok) {
        router.push(cycleHref(props.locale, result.value.id, 'scope'));
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setErrors(fieldErrors(result.error));
      setNotice(message(result.error));
    });
  }

  const textarea = (field: 'instructionsAr' | 'instructionsEn', dir: 'rtl' | 'ltr') => {
    const id = `cycle-${field}`;
    return (
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={id} className="text-sm font-medium">
          {t(`setup.basics.${field}`)}
          <span className="ms-1 font-normal text-text-muted">{t('setup.optional')}</span>
        </label>
        <p id={`${id}-hint`} className="m-0 text-sm text-text-muted">
          {t('setup.basics.instructionsHint')}
        </p>
        <textarea
          id={id}
          value={values[field]}
          onChange={(event) => {
            update(field, event.target.value);
          }}
          maxLength={4000}
          rows={3}
          dir={dir}
          lang={dir === 'rtl' ? 'ar' : 'en'}
          aria-describedby={`${id}-hint`}
          disabled={pending}
          className="w-full rounded-2xl border border-border-strong bg-surface px-4 py-2 text-sm text-text shadow-1 disabled:cursor-not-allowed disabled:bg-surface-sunken"
        />
      </div>
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6" data-testid="cycle-basics">
      {notice ? (
        <Alert tone="danger" data-testid="cycle-basics-error">
          {notice}
        </Alert>
      ) : null}
      <Card
        title={t('setup.basics.title')}
        description={t('setup.basics.currency', { currency: props.currency })}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            id="cycle-name-en"
            label={t('setup.basics.nameEn')}
            marker={t('setup.required')}
            hint={t('setup.basics.nameHint')}
            value={values.nameEn}
            onChange={(event) => {
              update('nameEn', event.target.value);
            }}
            maxLength={120}
            required
            dir="ltr"
            lang="en"
            autoComplete="off"
            error={errors.nameEn}
            disabled={pending}
          />
          <TextField
            id="cycle-name-ar"
            label={t('setup.basics.nameAr')}
            marker={t('setup.required')}
            hint={t('setup.basics.nameHint')}
            value={values.nameAr}
            onChange={(event) => {
              update('nameAr', event.target.value);
            }}
            maxLength={120}
            required
            dir="rtl"
            lang="ar"
            autoComplete="off"
            error={errors.nameAr}
            disabled={pending}
          />
          <TextField
            id="cycle-period-start"
            type="date"
            label={t('setup.basics.periodStart')}
            marker={t('setup.required')}
            hint={t('setup.basics.periodHint')}
            value={values.periodStart}
            onChange={(event) => {
              update('periodStart', event.target.value);
            }}
            required
            error={errors.periodStart}
            disabled={pending}
          />
          <div className="flex flex-col gap-2">
            <TextField
              id="cycle-period-end"
              type="date"
              label={t('setup.basics.periodEnd')}
              marker={t('setup.required')}
              value={values.periodEnd}
              onChange={(event) => {
                update('periodEnd', event.target.value);
              }}
              required
              error={errors.periodEnd}
              disabled={pending}
            />
            {isDay(values.periodStart) && isDay(values.periodEnd) && !errors.periodEnd ? (
              <ShownAs
                text={t('setup.basics.shownAs', {
                  date: `${day(values.periodStart)} – ${day(values.periodEnd)}`,
                })}
                testId="cycle-period-shown"
              />
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <TextField
              id="cycle-deadline"
              type="date"
              label={t('setup.basics.deadline')}
              marker={t('setup.required')}
              hint={t('setup.basics.deadlineHint')}
              value={values.deadline}
              onChange={(event) => {
                update('deadline', event.target.value);
              }}
              required
              error={errors.deadline}
              disabled={pending}
            />
            {isDay(values.deadline) && !errors.deadline ? (
              <ShownAs
                text={t('setup.basics.shownAs', { date: day(values.deadline) })}
                testId="cycle-deadline-shown"
              />
            ) : null}
          </div>
          <SelectField
            id="cycle-needs-form"
            label={t('setup.basics.needsForm')}
            marker={t('setup.optional')}
            hint={
              props.needsForms.length === 0 ? (
                <>
                  {t('setup.basics.needsFormHint')}{' '}
                  <a href={`/${props.locale}${PLANNING_PATHS.needsForms}`}>
                    {props.needsFormsLabel}
                  </a>
                </>
              ) : (
                t('setup.basics.needsFormHint')
              )
            }
            value={values.needsFormId}
            onChange={(event) => {
              update('needsFormId', event.target.value);
            }}
            error={
              errors.needsFormId ??
              (props.needsForms.length === 0 ? t('setup.launch.problems.no_needs_form') : undefined)
            }
            disabled={pending}
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
          {textarea('instructionsEn', 'ltr')}
          {textarea('instructionsAr', 'rtl')}
        </div>
      </Card>
      {props.editing ? (
        <StepFooter
          backHref={props.cancelHref}
          backLabel={t('setup.back')}
          saveLabel={t('setup.saveAndContinue')}
          workingLabel={t('setup.working')}
          pending={pending}
          testId="cycle-basics-save"
        />
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2.5 max-md:[&>*]:flex-1">
          <a
            href={props.cancelHref}
            className={buttonClasses({ variant: 'secondary', size: 'md' })}
          >
            {t('setup.cancel')}
          </a>
          <Button type="submit" disabled={pending} busy={pending} data-testid="cycle-basics-save">
            {pending ? t('setup.working') : t('setup.create')}
            {pending ? null : <Icon name="arrow-end" className="size-4" />}
          </Button>
        </div>
      )}
    </form>
  );
}
