'use client';
import { createPlanCycleAction, updatePlanCycleBasicsAction } from '@jadarat/tms/actions/planning';
import { basicsIssues, toFieldErrors } from '@jadarat/tms/planning-rules';
import { Alert, Button, Card, TextField, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { cycleHref, fieldErrorKey } from '../../lib/planning-view';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';
import { usePlanningTexts } from './use-planning-texts';

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
  readonly needsForms: readonly { readonly id: string; readonly name: string }[];
  readonly currency: string;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly cancelHref: string;
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
          <SelectField
            id="cycle-needs-form"
            label={t('setup.basics.needsForm')}
            marker={t('setup.optional')}
            hint={t('setup.basics.needsFormHint')}
            value={values.needsFormId}
            onChange={(event) => {
              update('needsFormId', event.target.value);
            }}
            error={errors.needsFormId}
            disabled={pending}
            data-testid="cycle-needs-form"
          >
            <option value="">{t('setup.basics.needsFormNone')}</option>
            {props.needsForms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.name}
              </option>
            ))}
          </SelectField>
          {textarea('instructionsEn', 'ltr')}
          {textarea('instructionsAr', 'rtl')}
        </div>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <a href={props.cancelHref} className={buttonClasses({ variant: 'secondary', size: 'md' })}>
          {t('setup.cancel')}
        </a>
        <Button type="submit" disabled={pending} data-testid="cycle-basics-save">
          {pending
            ? t('setup.working')
            : props.editing
              ? t('setup.saveAndContinue')
              : t('setup.create')}
        </Button>
      </div>
    </form>
  );
}
