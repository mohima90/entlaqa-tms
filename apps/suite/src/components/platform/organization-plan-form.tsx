'use client';
import type { AppError } from '@jadarat/platform-core';
import { Alert, Button, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useId, useState, useTransition } from 'react';
import { setOrganizationPlanAction } from '../../auth/platform-plans';
import { TENANT_STATUS_CODES } from '../../lib/platform-plans-input';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';
import { SelectField } from '../select-field';

type Status = (typeof TENANT_STATUS_CODES)[number];

/** A plan to choose (its limits are shown next to the special ones). */
export interface PlanChoice {
  readonly planId: string;
  readonly name: string;
  readonly maxPeople: number | null;
  readonly maxStorageGb: number | null;
}

/** The organization's current plan and status, as the form opens. */
export interface OrganizationPlanValue {
  readonly tenantId: string;
  readonly planId: string | null;
  readonly status: Status;
  /** YYYY-MM-DD (Riyadh) during a trial. */
  readonly trialEndsOn: string | null;
  readonly maxPeopleOverride: number | null;
  readonly maxStorageGbOverride: number | null;
  readonly peopleUsed: number;
  /** Already formatted («3.2 GB»). */
  readonly storageUsed: string;
}

const FIELDS = [
  'planId',
  'status',
  'trialEndsOn',
  'maxPeopleOverride',
  'maxStorageGbOverride',
] as const;
type Field = (typeof FIELDS)[number] | 'form';

/** YYYY-MM-DD of `days` from today in Riyadh. */
function riyadhDate(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(date);
}

/**
 * «الخطة والحالة» / Plan and status of one organization (WP-ADM-06; FR-ADM-17; design approved by the PO 24 Oct
 * 2026): its plan (or none: every feature, no limits), its status (a trial ends on a date — 30 days by
 * default), and a people or storage limit special to it («Special limit», wins over the plan's), each with
 * the plan's limit and what is used. Suspending says what it means for the organization's people. The
 * database validates again and audits the change.
 */
export function OrganizationPlanForm({
  value,
  plans,
  texts,
  errors: errorTexts,
  numbersLocale,
}: {
  readonly value: OrganizationPlanValue;
  readonly plans: readonly PlanChoice[];
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly numbersLocale: string;
}) {
  const text = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string>) =>
    Object.entries(values).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, v), text(key));
  const numbers = new Intl.NumberFormat(numbersLocale);
  const router = useRouter();
  const formId = useId();
  const [planId, setPlanId] = useState(value.planId ?? '');
  const [status, setStatus] = useState<Status>(value.status);
  const [trialEndsOn, setTrialEndsOn] = useState(value.trialEndsOn ?? riyadhDate(30));
  const [specialPeople, setSpecialPeople] = useState(value.maxPeopleOverride !== null);
  const [specialStorage, setSpecialStorage] = useState(value.maxStorageGbOverride !== null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [pending, startTransition] = useTransition();
  const plan = plans.find((p) => p.planId === planId) ?? null;
  const planLimit = (n: number | null | undefined, unit: 'people' | 'storage') =>
    plan === null || n === null || n === undefined
      ? text('organizationPlan.noLimit')
      : unit === 'people'
        ? numbers.format(n)
        : fill('plans.storageGb', { count: numbers.format(n) });

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const number = (name: string): number | null => {
      const raw = data.get(name);
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      return /^\d{1,7}$/.test(trimmed) && Number(trimmed) > 0 ? Number(trimmed) : Number.NaN;
    };
    const input = {
      tenantId: value.tenantId,
      planId: planId === '' ? null : planId,
      status,
      trialEndsOn: status === 'trial' ? trialEndsOn : null,
      maxPeopleOverride: specialPeople ? number('maxPeopleOverride') : null,
      maxStorageGbOverride: specialStorage ? number('maxStorageGbOverride') : null,
    };
    const local: Partial<Record<Field, string>> = {};
    if (status === 'trial' && !(trialEndsOn > riyadhDate(0) && trialEndsOn <= riyadhDate(364)))
      local.trialEndsOn = text('organizationPlan.errors.trialEndsOn');
    if (Number.isNaN(input.maxPeopleOverride))
      local.maxPeopleOverride = text('organizationPlan.errors.limit');
    if (Number.isNaN(input.maxStorageGbOverride))
      local.maxStorageGbOverride = text('organizationPlan.errors.limit');
    setErrors(local);
    const first = FIELDS.find((f) => local[f]);
    if (first) {
      document.getElementById(`${formId}-${first}`)?.focus();
      return;
    }
    startTransition(async () => {
      const answer = await setOrganizationPlanAction(input);
      if (answer.ok) {
        toast.success(text('organizationPlan.saved'));
        router.refresh();
        return;
      }
      showError(answer.error);
    });
  };

  const showError = (error: AppError) => {
    const codes = fieldErrorCodes(error);
    if (error.code === 'VALIDATION_FAILED' && Object.keys(codes).length > 0) {
      const next: Partial<Record<Field, string>> = {};
      for (const field of Object.keys(codes)) {
        const key: Field = (FIELDS as readonly string[]).includes(field)
          ? (field as Field)
          : 'form';
        next[key] =
          key === 'maxPeopleOverride' || key === 'maxStorageGbOverride'
            ? text('organizationPlan.errors.limit')
            : text(`organizationPlan.errors.${key}`);
      }
      setErrors(next);
      return;
    }
    setErrors({ form: errorText(error, errorTexts) });
  };

  const limitRow = (
    kind: 'people' | 'storage',
    special: boolean,
    setSpecial: (on: boolean) => void,
    current: number | null,
  ) => {
    const name = kind === 'people' ? 'maxPeopleOverride' : 'maxStorageGbOverride';
    return (
      <div
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:flex-row md:items-center md:justify-between"
        data-testid={`organization-plan-${kind}`}
      >
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold">{text(`organizationPlan.${kind}`)}</span>
          <span className="text-sm text-text-muted">
            {fill(`organizationPlan.${kind}Detail`, {
              limit: planLimit(kind === 'people' ? plan?.maxPeople : plan?.maxStorageGb, kind),
              used: kind === 'people' ? numbers.format(value.peopleUsed) : value.storageUsed,
            })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={special}
              onChange={(event) => {
                setSpecial(event.target.checked);
              }}
              disabled={pending}
              className="size-5 accent-primary"
              data-testid={`organization-plan-${kind}-special`}
            />
            {text('organizationPlan.special')}
          </label>
          {special ? (
            <TextField
              id={`${formId}-${name}`}
              name={name}
              label={text(`organizationPlan.${kind}Special`)}
              inputMode="numeric"
              dir="ltr"
              autoComplete="off"
              defaultValue={current === null ? '' : String(current)}
              disabled={pending}
              error={errors[name]}
              className="w-40"
              data-testid={`organization-plan-${name}`}
            />
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-5 md:p-6"
      data-testid="organization-plan-form"
      aria-labelledby={`${formId}-title`}
    >
      <h2 id={`${formId}-title`} className="m-0 text-xl font-bold">
        {text('organizationPlan.title')}
      </h2>
      <div className="grid gap-4">
        <SelectField
          id={`${formId}-planId`}
          name="planId"
          label={text('organizationPlan.plan')}
          value={planId}
          onChange={(event) => {
            setPlanId(event.target.value);
          }}
          disabled={pending}
          error={errors.planId}
          hint={plans.length === 0 ? text('organizationPlan.noPlansYet') : undefined}
          data-testid="organization-plan-plan"
        >
          <option value="">{text('organizationPlan.noPlan')}</option>
          {plans.map((p) => (
            <option key={p.planId} value={p.planId}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          id={`${formId}-status`}
          name="status"
          label={text('organizationPlan.status')}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as Status);
          }}
          disabled={pending}
          error={errors.status}
          data-testid="organization-plan-status"
        >
          {TENANT_STATUS_CODES.map((s) => (
            <option key={s} value={s}>
              {text(`statuses.${s}`)}
            </option>
          ))}
        </SelectField>
      </div>
      {status === 'trial' ? (
        <TextField
          id={`${formId}-trialEndsOn`}
          name="trialEndsOn"
          type="date"
          label={text('organizationPlan.trialEndsOn')}
          value={trialEndsOn}
          onChange={(event) => {
            setTrialEndsOn(event.target.value);
          }}
          min={riyadhDate(1)}
          max={riyadhDate(364)}
          disabled={pending}
          error={errors.trialEndsOn}
          hint={text('organizationPlan.trialHint')}
          className="md:max-w-xs"
          data-testid="organization-plan-trial-ends"
        />
      ) : null}
      {status === 'suspended' || status === 'cancelled' ? (
        <Alert tone="warning" data-testid="organization-plan-status-warning">
          {text(`organizationPlan.${status}Warning`)}
        </Alert>
      ) : null}
      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1 font-semibold">{text('organizationPlan.limits')}</legend>
        {limitRow('people', specialPeople, setSpecialPeople, value.maxPeopleOverride)}
        {limitRow('storage', specialStorage, setSpecialStorage, value.maxStorageGbOverride)}
      </fieldset>
      {errors.form ? (
        <Alert tone="danger" data-testid="organization-plan-error">
          {errors.form}
        </Alert>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="submit"
          busy={pending}
          disabled={pending}
          data-testid="organization-plan-save"
        >
          {pending ? text('organizationPlan.saving') : text('organizationPlan.save')}
        </Button>
      </div>
    </form>
  );
}
