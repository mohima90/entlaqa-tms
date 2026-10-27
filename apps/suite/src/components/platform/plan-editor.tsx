'use client';
import type { AppError } from '@jadarat/platform-core';
import { Alert, Button, Icon, SidePanel, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useId, useState, useTransition } from 'react';
import { savePlanAction } from '../../auth/platform-plans';
import { PLAN_FEATURE_CODES } from '../../lib/platform-plans-input';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';

/** Raw texts by dotted key (formatted on the server, filled here). */
export type PlanTexts = Readonly<Record<string, string>>;

/** A plan as the editor opens it (null: a new plan). */
export interface EditablePlan {
  readonly planId: string;
  readonly name: string;
  readonly description: string | null;
  readonly maxPeople: number | null;
  readonly maxStorageGb: number | null;
  readonly features: readonly string[];
  readonly version: number;
  readonly tenantCount: number;
}

const FIELDS = ['name', 'description', 'maxPeople', 'maxStorageGb', 'features'] as const;
type Field = (typeof FIELDS)[number] | 'form';

/** "" → null (no limit); a whole number ≥ 1; anything else → NaN (refused). */
function limitOf(raw: string): number | null {
  const value = raw.trim();
  if (value === '') return null;
  return /^\d{1,7}$/.test(value) ? Number(value) : Number.NaN;
}

/**
 * «خطة جديدة» / New plan and «تعديل» / Edit in a side panel (WP-ADM-06, design approved by the PO 24 Oct
 * 2026): name, short description, the people and storage limits (empty: no limit) and the features the plan
 * includes, each with what it means. Editing a plan an organization is on says first that the change applies
 * to those organizations at once (except a limit set specially for one). Saved → a toast, the list refreshes.
 */
export function PlanEditor({
  plan,
  texts,
  planTexts,
  errors: errorTexts,
  closeLabel,
}: {
  readonly plan: EditablePlan | null;
  readonly texts: PlanTexts;
  readonly planTexts: PlanTexts;
  readonly errors: ErrorTexts;
  readonly closeLabel: string;
}) {
  const text = (key: string) => texts[key] ?? key;
  const feature = (key: string) => planTexts[key] ?? key;
  const fill = (key: string, values: Record<string, string>) =>
    Object.entries(values).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, v), text(key));
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [pending, startTransition] = useTransition();

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => {
      const raw = data.get(name);
      return typeof raw === 'string' ? raw : '';
    };
    const input = {
      planId: plan?.planId ?? null,
      name: value('name').trim(),
      description: value('description').trim(),
      maxPeople: limitOf(value('maxPeople')),
      maxStorageGb: limitOf(value('maxStorageGb')),
      features: PLAN_FEATURE_CODES.filter((code) => data.get(`feature-${code}`) === 'on'),
      version: plan?.version ?? null,
    };
    const local: Partial<Record<Field, string>> = {};
    if (input.name === '' || input.name.length > 80) local.name = text('plans.errors.name');
    if (input.description.length > 200) local.description = text('plans.errors.description');
    if (Number.isNaN(input.maxPeople) || input.maxPeople === 0)
      local.maxPeople = text('plans.errors.maxPeople');
    if (Number.isNaN(input.maxStorageGb) || input.maxStorageGb === 0)
      local.maxStorageGb = text('plans.errors.maxStorageGb');
    setErrors(local);
    const first = FIELDS.find((f) => local[f]);
    if (first) {
      document.getElementById(`${formId}-${first}`)?.focus();
      return;
    }
    startTransition(async () => {
      const answer = await savePlanAction(input);
      if (answer.ok) {
        toast.success(
          fill(plan ? 'plans.toasts.saved' : 'plans.toasts.created', { name: input.name }),
        );
        setOpen(false);
        router.refresh();
        return;
      }
      showError(answer.error);
    });
  };

  const showError = (error: AppError) => {
    if (error.code === 'CONFLICT_VERSION') {
      setErrors({ form: text('plans.errors.stale') });
      return;
    }
    const codes = fieldErrorCodes(error);
    if (error.code === 'VALIDATION_FAILED' && Object.keys(codes).length > 0) {
      const next: Partial<Record<Field, string>> = {};
      for (const [field, code] of Object.entries(codes)) {
        const key: Field = (FIELDS as readonly string[]).includes(field)
          ? (field as Field)
          : 'form';
        next[key] =
          key === 'name' && code === 'TAKEN'
            ? text('plans.errors.nameTaken')
            : text(`plans.errors.${key}`);
      }
      setErrors(next);
      return;
    }
    setErrors({ form: errorText(error, errorTexts) });
  };

  const limitField = (name: 'maxPeople' | 'maxStorageGb', initial: number | null) => (
    <TextField
      id={`${formId}-${name}`}
      name={name}
      label={text(`plans.${name}`)}
      inputMode="numeric"
      dir="ltr"
      autoComplete="off"
      defaultValue={initial === null ? '' : String(initial)}
      hint={text('plans.noLimitHint')}
      disabled={pending}
      error={errors[name]}
      data-testid={`plan-${name}`}
    />
  );

  return (
    <>
      {plan ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setErrors({});
            setOpen(true);
          }}
          aria-label={fill('plans.editLabel', { name: plan.name })}
          data-testid="plan-edit"
        >
          {text('plans.edit')}
        </Button>
      ) : (
        <Button
          onClick={() => {
            setErrors({});
            setOpen(true);
          }}
          data-testid="plan-new"
        >
          <Icon name="plus" />
          {text('plans.new')}
        </Button>
      )}
      <SidePanel
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        canClose={() => !pending}
        size="lg"
        title={plan ? text('plans.editTitle') : text('plans.newTitle')}
        closeLabel={closeLabel}
        data-testid="plan-panel"
        footer={
          <div className="ms-auto flex flex-wrap gap-2.5">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setOpen(false);
              }}
            >
              {text('plans.cancel')}
            </Button>
            <Button
              type="submit"
              form={`${formId}-form`}
              busy={pending}
              disabled={pending}
              data-testid="plan-save"
            >
              {pending ? text('plans.saving') : text('plans.save')}
            </Button>
          </div>
        }
      >
        <form id={`${formId}-form`} noValidate onSubmit={submit} className="flex flex-col gap-4">
          {plan && plan.tenantCount > 0 ? (
            <Alert tone="info" data-testid="plan-applies">
              {fill('plans.appliesTo', { count: String(plan.tenantCount) })}
            </Alert>
          ) : null}
          <TextField
            id={`${formId}-name`}
            name="name"
            label={text('plans.name')}
            marker={text('plans.required')}
            required
            autoComplete="off"
            maxLength={80}
            defaultValue={plan?.name ?? ''}
            disabled={pending}
            error={errors.name}
            data-testid="plan-name"
          />
          <TextField
            id={`${formId}-description`}
            name="description"
            label={text('plans.description')}
            marker={text('plans.optional')}
            autoComplete="off"
            maxLength={200}
            defaultValue={plan?.description ?? ''}
            disabled={pending}
            error={errors.description}
            data-testid="plan-description"
          />
          <div className="grid gap-4">
            {limitField('maxPeople', plan?.maxPeople ?? null)}
            {limitField('maxStorageGb', plan?.maxStorageGb ?? null)}
          </div>
          <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0" data-testid="plan-features">
            <legend className="mb-1 font-semibold">{text('plans.features')}</legend>
            <p className="m-0 text-sm text-text-muted">{feature('alwaysIncluded')}</p>
            {PLAN_FEATURE_CODES.map((code) => (
              <div
                key={code}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3.5 has-[:checked]:border-primary"
              >
                <input
                  id={`${formId}-feature-${code}`}
                  type="checkbox"
                  name={`feature-${code}`}
                  defaultChecked={plan ? plan.features.includes(code) : true}
                  disabled={pending}
                  aria-describedby={`${formId}-feature-${code}-hint`}
                  className="mt-0.5 size-5 shrink-0 accent-primary"
                  data-testid={`plan-feature-${code}`}
                />
                <span className="flex min-w-0 flex-col">
                  <label
                    htmlFor={`${formId}-feature-${code}`}
                    className="cursor-pointer font-semibold"
                  >
                    {feature(`features.${code}.name`)}
                  </label>
                  <span id={`${formId}-feature-${code}-hint`} className="text-sm text-text-muted">
                    {feature(`features.${code}.description`)}
                  </span>
                </span>
              </div>
            ))}
          </fieldset>
          {errors.form ? (
            <Alert tone="danger" data-testid="plan-error">
              {errors.form}
            </Alert>
          ) : null}
        </form>
      </SidePanel>
    </>
  );
}
