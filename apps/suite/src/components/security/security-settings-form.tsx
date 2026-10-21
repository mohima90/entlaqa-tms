'use client';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  FieldError,
  Icon,
  type IconName,
  SaveBar,
  cn,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, type SyntheticEvent, useEffect, useState, useTransition } from 'react';
import { updateSecurityPolicyAction } from '../../actions/security';
import { fillText } from '../../lib/fill-text';
import { SECURITY_FORM_LIMITS, type SecurityNumberField } from '../../lib/security-limits';
import {
  type MfaMode,
  type SecurityFormValues,
  mfaBecomesStricter,
  parseWhole,
  sameSecurity,
} from '../../lib/security-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { fieldErrorCodes } from '../profile/field-errors';
import { LeaveGuard } from '../settings/leave-guard';
import type { SettingsCommonTexts } from '../settings/settings-texts';
import { StepUpBanner } from '../settings/step-up-banner';

export type { MfaMode, SecurityFormValues } from '../../lib/security-form';

/**
 * Security settings (approved screen 6 «الأمان»; FR-IAM-12/13, T-M2-10), in direction C (redesign
 * package 2, PO 21 Oct 2026): a summary strip (MFA · Password · Lockout · Sessions, each a link to its
 * section, marked «Changed» while unsaved), one card per policy with setting rows (label and hint | the
 * value and its unit), the four «Coming soon» items grouped in one row at the end (Q2-7), the floating
 * save bar, and a confirmation when MFA becomes stricter (who must set up an app, and the grace days).
 * The Organization Admin changes them; everyone else who may open the page reads them (as text). When
 * saving needs a fresh authenticator code the page asks first (Q2-1). Limits mirror the database's
 * floors; the lockout settings are enforced by the sign-in limiter (T-M2-11) for the organization's
 * members on its own host — the platform default on the shared sign-in host (TM-0003 D-IAM-04) — as the
 * section says. Passwords never expire (PO decision).
 */

/** The settings typed as numbers (every key of SecurityFormValues but the MFA mode, roles and prompt). */
type NumberField = SecurityNumberField;

export const NUMBER_LIMITS: Readonly<Record<NumberField, { min: number; max: number }>> =
  SECURITY_FORM_LIMITS;

const MODES: readonly MfaMode[] = ['off', 'optional', 'required_all', 'required_roles'];
const FORM_ID = 'security-form';

/** The page's fields in order (the first one with an error gets the focus). */
const FIELD_ORDER = [
  'mfaRequiredRoles',
  'mfaGraceDays',
  'passwordMinLength',
  'lockoutThreshold',
  'lockoutMinutes',
  'sessionIdleMinutes',
  'sessionMaxHours',
  'sessionMaxDevices',
] as const;

export interface SecurityFormProps {
  readonly initial: SecurityFormValues;
  readonly version: number;
  readonly editable: boolean;
  readonly roles: readonly { readonly code: string; readonly name: string }[];
  /** Translated texts by key (security namespace, flattened). */
  readonly texts: Readonly<Record<string, string>>;
  readonly common: SettingsCommonTexts;
  /** The confirmation's grace sentence for 0…30 days (plural forms, formatted on the server). */
  readonly graceTexts: readonly string[];
  readonly organization: string;
  readonly locale: 'ar' | 'en';
  readonly lastChanged: string;
  readonly errors: ErrorTexts;
  /** The /mfa link back here, and whether saving needs a fresh authenticator code first (Q2-1). */
  readonly stepUp: { readonly href: string; readonly needed: boolean };
}

const numbersOf = (values: SecurityFormValues) =>
  Object.fromEntries(
    (Object.keys(NUMBER_LIMITS) as NumberField[]).map((key) => [key, String(values[key])]),
  ) as Record<NumberField, string>;

function Row({
  title,
  hint,
  titleId,
  children,
}: {
  readonly title: ReactNode;
  readonly hint?: ReactNode;
  readonly titleId?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 border-b border-border py-4 last:border-b-0 last:pb-0">
      <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-0.5">
        <span id={titleId} className="font-semibold">
          {title}
        </span>
        {hint ? <span className="text-sm text-text-muted">{hint}</span> : null}
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2 md:justify-end">{children}</div>
      ) : null}
    </div>
  );
}

function Section({
  id,
  title,
  intro,
  note,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly intro: string;
  /** Under the intro: where or how the section's settings apply. */
  readonly note?: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 rounded-xl border border-border bg-surface px-5 py-5 sm:px-6.5 sm:py-6"
      data-testid={id}
    >
      <h2 id={`${id}-title`} className="m-0 text-lg font-bold">
        {title}
      </h2>
      <p className="m-0 mt-1 text-sm text-text-muted">{intro}</p>
      {note ? (
        <p
          className="m-0 mt-4 rounded-md border border-border bg-surface-sunken px-3.5 py-3 text-sm text-text-muted"
          data-testid={`${id}-note`}
        >
          {note}
        </p>
      ) : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function SecuritySettingsForm(props: SecurityFormProps) {
  const { initial, version, editable: mayEdit, roles, texts, common, errors, locale } = props;
  const t = (key: string) => texts[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<SecurityFormValues>(initial);
  const [numbers, setNumbers] = useState<Readonly<Record<NumberField, string>>>(() =>
    numbersOf(initial),
  );
  const [baseline, setBaseline] = useState<SecurityFormValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [refused, setRefused] = useState(false);
  const [problem, setProblem] = useState<{ conflict: boolean; text: string } | null>(null);
  const [stepUp, setStepUp] = useState(props.stepUp.needed);
  const [confirming, setConfirming] = useState<SecurityFormValues | null>(null);
  const [focusField, setFocusField] = useState<{ field: string } | null>(null);
  const editable = mayEdit && !stepUp;
  const disabled = !editable || pending;

  // What is typed now, as numbers where they parse (the summary and «unsaved» follow it).
  // (A number still being typed stays text: it shows as typed and counts as a change.)
  const current: SecurityFormValues = {
    ...values,
    ...Object.fromEntries(
      (Object.keys(NUMBER_LIMITS) as NumberField[]).map((field) => [
        field,
        parseWhole(numbers[field]) ?? numbers[field],
      ]),
    ),
  };
  const dirty = !sameSecurity(current, baseline);

  useEffect(() => {
    if (!focusField) return;
    const id =
      focusField.field === 'mfaRequiredRoles'
        ? `security-role-${roles[0]?.code ?? ''}`
        : `security-${focusField.field}`;
    document.getElementById(id)?.focus();
  }, [focusField, roles]);

  function showErrors(found: Record<string, string>) {
    setFieldErrors(found);
    const first = FIELD_ORDER.find((field) => found[field] !== undefined) ?? null;
    setRefused(first !== null);
    if (first) setFocusField({ field: first });
  }

  function change(next: SecurityFormValues) {
    setValues(next);
    setRefused(false);
  }

  function numberInput(field: NumberField, label: string, unit: string) {
    const id = `security-${field}`;
    const error = fieldErrors[field];
    if (!editable && !stepUp) {
      return (
        <span className="font-semibold" data-testid={id}>
          <bdi dir="ltr">{numbers[field]}</bdi> {unit}
        </span>
      );
    }
    return (
      <div className="flex flex-col items-start gap-1.5 md:items-end">
        <div className="flex items-center gap-2.5">
          <input
            id={id}
            name={field}
            inputMode="numeric"
            dir="ltr"
            aria-label={label}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            value={numbers[field]}
            onChange={(event) => {
              setNumbers({ ...numbers, [field]: event.target.value });
              setRefused(false);
            }}
            disabled={disabled}
            className={cn(
              'min-h-11 w-19 scroll-mb-40 rounded-md border-[1.5px] bg-surface px-3 text-center text-text disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-muted',
              error ? 'border-danger' : 'border-border-strong',
            )}
            data-testid={id}
          />
          <span className="text-text-muted">{unit}</span>
        </div>
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      </div>
    );
  }

  function collect(): SecurityFormValues | null {
    const errorsFound: Record<string, string> = {};
    const parsed: Partial<Record<NumberField, number>> = {};
    for (const field of Object.keys(NUMBER_LIMITS) as NumberField[]) {
      const { min, max } = NUMBER_LIMITS[field];
      const value = parseWhole(numbers[field]);
      if (value === null || value < min || value > max) {
        errorsFound[field] = t('fieldErrors.range')
          .replace('{min}', String(min))
          .replace('{max}', String(max));
      } else parsed[field] = value;
    }
    if (values.mfaMode === 'required_roles' && values.mfaRequiredRoles.length === 0) {
      errorsFound.mfaRequiredRoles = t('fieldErrors.rolesRequired');
    }
    if (
      parsed.sessionIdleMinutes !== undefined &&
      parsed.sessionMaxHours !== undefined &&
      parsed.sessionIdleMinutes > parsed.sessionMaxHours * 60
    ) {
      // Both fields carry it: either one can be changed to fix it.
      errorsFound.sessionIdleMinutes = t('fieldErrors.idleAboveMax');
      errorsFound.sessionMaxHours = t('fieldErrors.idleAboveMax');
    }
    showErrors(errorsFound);
    if (Object.keys(errorsFound).length > 0) return null;
    return { ...values, ...(parsed as Record<NumberField, number>) };
  }

  function save(settings: SecurityFormValues) {
    setConfirming(null);
    startTransition(async () => {
      const result = await updateSecurityPolicyAction({
        ...settings,
        mfaRequiredRoles: [...settings.mfaRequiredRoles],
        version,
      } as Parameters<typeof updateSecurityPolicyAction>[0]);
      if (result.ok) {
        setBaseline(settings);
        if (result.value.changed.length === 0) toast.info(t('noChanges'));
        else toast.success(t('saved'));
        router.refresh();
        return;
      }
      // The session ended meanwhile: the page sends the member on (review L1).
      if (sessionRefused(result.error)) return;
      if (result.error.code === 'STEP_UP_REQUIRED') {
        setStepUp(true);
        return;
      }
      if (result.error.code === 'VALIDATION_FAILED') {
        const codes = fieldErrorCodes(result.error);
        const found = Object.fromEntries(
          Object.keys(codes).map((field) => [
            field,
            field === 'mfaRequiredRoles'
              ? t('fieldErrors.rolesRequired')
              : t('fieldErrors.invalid'),
          ]),
        );
        showErrors(found);
        if (Object.keys(found).length > 0) return;
      }
      setProblem({
        conflict: result.error.code === 'CONFLICT_VERSION',
        text: errorText(result.error, errors),
      });
    });
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable) return;
    setProblem(null);
    const settings = collect();
    if (!settings) return;
    // Stricter MFA (Off / Optional → Required…): say who is affected before saving (Q2-6: no head-count).
    if (mfaBecomesStricter(baseline.mfaMode, settings.mfaMode)) {
      setConfirming(settings);
      return;
    }
    save(settings);
  }

  function discard() {
    setValues(baseline);
    setNumbers(numbersOf(baseline));
    setFieldErrors({});
    setRefused(false);
    setProblem(null);
  }

  // The summary strip: each policy at a glance, «Changed» while it differs from what is saved.
  const changed = (fields: readonly (keyof SecurityFormValues)[]) =>
    fields.some((field) => !sameSecurity({ ...baseline, [field]: current[field] }, baseline));
  const unit = (value: number | string, key: string) => `${String(value)} ${t(key)}`;
  const tiles: readonly {
    id: string;
    icon: IconName;
    label: string;
    value: string;
    changed: boolean;
  }[] = [
    {
      id: 'security-mfa',
      icon: 'shield',
      label: t('mfa.title'),
      value: t(`mfa.modes.${current.mfaMode}`),
      changed: changed(['mfaMode', 'mfaRequiredRoles', 'mfaGraceDays', 'mfaPromptAdmins']),
    },
    {
      id: 'security-password',
      icon: 'key',
      label: t('password.title'),
      value: fillText(t('summary.minChars'), { n: String(current.passwordMinLength) }, locale),
      changed: changed(['passwordMinLength']),
    },
    {
      id: 'security-lockout',
      icon: 'lock',
      label: t('lockout.title'),
      value: `${unit(current.lockoutThreshold, 'lockout.thresholdUnit')} · ${unit(current.lockoutMinutes, 'lockout.minutesUnit')}`,
      changed: changed(['lockoutThreshold', 'lockoutMinutes']),
    },
    {
      id: 'security-sessions',
      icon: 'clock',
      label: t('sessions.title'),
      value: [
        unit(current.sessionIdleMinutes, 'sessions.idleUnit'),
        unit(current.sessionMaxHours, 'sessions.maxHoursUnit'),
        unit(current.sessionMaxDevices, 'sessions.devicesUnit'),
      ].join(' · '),
      changed: changed(['sessionIdleMinutes', 'sessionMaxHours', 'sessionMaxDevices']),
    },
  ];

  const roleNames = (codes: readonly string[]) =>
    roles
      .filter((role) => codes.includes(role.code))
      .map((role) => role.name)
      .join(locale === 'ar' ? '، ' : ', ');
  const firstInvalid = FIELD_ORDER.find((field) => fieldErrors[field] !== undefined) ?? null;
  const fieldLabels: Record<(typeof FIELD_ORDER)[number], string> = {
    mfaRequiredRoles: t('mfa.roles'),
    mfaGraceDays: t('mfa.grace'),
    passwordMinLength: t('password.minLength'),
    lockoutThreshold: t('lockout.threshold'),
    lockoutMinutes: t('lockout.minutes'),
    sessionIdleMinutes: t('sessions.idle'),
    sessionMaxHours: t('sessions.maxHours'),
    sessionMaxDevices: t('sessions.devices'),
  };
  const comingSoon = [
    t('mfa.methodEmail'),
    t('mfa.methodSms'),
    t('mfa.trusted'),
    t('password.history'),
  ];

  return (
    <>
      {stepUp ? <StepUpBanner href={props.stepUp.href} texts={common} /> : null}
      <nav aria-label={t('summaryLabel')} data-testid="security-summary">
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 xl:grid-cols-4">
          {tiles.map((tile) => (
            <li key={tile.id} className="min-w-0">
              <a
                href={`#${tile.id}`}
                className="flex h-full items-start gap-3 rounded-lg border border-border bg-surface p-3.5 text-text no-underline hover:border-border-strong sm:p-4"
                data-testid={`security-summary-${tile.id.replace('security-', '')}`}
              >
                <span
                  aria-hidden="true"
                  className="hidden size-9 shrink-0 place-items-center rounded-md bg-primary-subtle text-primary-text md:grid"
                >
                  <Icon name={tile.icon} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] text-text-muted">{tile.label}</span>
                  <span className="font-bold [overflow-wrap:anywhere]">{tile.value}</span>
                  {tile.changed ? (
                    <Badge tone="brand" className="mt-1 w-fit">
                      {t('summary.changed')}
                    </Badge>
                  ) : null}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {problem ? (
        <Alert
          tone={problem.conflict ? 'warning' : 'danger'}
          role="alert"
          data-testid="security-message"
          action={
            problem.conflict ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  window.location.reload();
                }}
              >
                <Icon name="sync" />
                {common.reload}
              </Button>
            ) : null
          }
        >
          {problem.text}
        </Alert>
      ) : null}
      <form
        id={FORM_ID}
        className="flex flex-col gap-5"
        onSubmit={onSubmit}
        onReset={(event) => {
          event.preventDefault();
          discard();
        }}
        noValidate
        data-testid="security-form"
      >
        <Section id="security-mfa" title={t('mfa.title')} intro={t('mfa.intro')}>
          <fieldset className="m-0 border-0 p-0 pt-3">
            <legend className="mb-3 p-0 font-semibold">{t('mfa.modeLegend')}</legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {MODES.map((mode) => {
                const checked = values.mfaMode === mode;
                return (
                  <div
                    key={mode}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border-[1.5px] p-3.5',
                      checked ? 'border-primary bg-surface-selected' : 'border-border',
                      disabled ? 'cursor-default' : 'cursor-pointer',
                    )}
                  >
                    <input
                      id={`security-mode-${mode}`}
                      type="radio"
                      name="mfaMode"
                      value={mode}
                      checked={checked}
                      onChange={() => {
                        change({ ...values, mfaMode: mode });
                      }}
                      disabled={disabled}
                      aria-describedby={`security-mode-${mode}-hint`}
                      className="mt-0.5 size-5 shrink-0 accent-primary"
                      data-testid={`security-mode-${mode}`}
                    />
                    <span className="flex flex-col gap-0.5">
                      <label
                        htmlFor={`security-mode-${mode}`}
                        className={cn('font-semibold', !disabled && 'cursor-pointer')}
                      >
                        {t(`mfa.modes.${mode}`)}
                      </label>
                      <span id={`security-mode-${mode}-hint`} className="text-sm text-text-muted">
                        {t(`mfa.modes.${mode}Hint`)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </fieldset>
          {values.mfaMode === 'required_roles' ? (
            <fieldset
              className="m-0 mt-4 rounded-lg border border-border bg-surface-sunken p-4"
              aria-describedby={`security-roles-hint${fieldErrors.mfaRequiredRoles ? ' security-mfaRequiredRoles-error' : ''}`}
              data-testid="security-roles"
            >
              <legend className="float-start mb-1 w-full p-0 font-semibold">
                {t('mfa.roles')}
              </legend>
              <p id="security-roles-hint" className="m-0 mb-3 text-sm text-text-muted">
                {t('mfa.rolesHint')}
              </p>
              <div className="flex flex-wrap gap-2">
                {roles.map((role) => {
                  const on = values.mfaRequiredRoles.includes(role.code);
                  return (
                    <label
                      key={role.code}
                      className={cn(
                        'flex min-h-11 items-center gap-2 rounded-full border-[1.5px] bg-surface px-3.5 text-sm font-medium',
                        on ? 'border-primary text-primary-text' : 'border-border-strong',
                        fieldErrors.mfaRequiredRoles && 'border-danger',
                        disabled ? 'cursor-default' : 'cursor-pointer',
                      )}
                    >
                      <input
                        id={`security-role-${role.code}`}
                        type="checkbox"
                        checked={on}
                        onChange={(event) => {
                          change({
                            ...values,
                            mfaRequiredRoles: event.target.checked
                              ? [...values.mfaRequiredRoles, role.code]
                              : values.mfaRequiredRoles.filter((code) => code !== role.code),
                          });
                        }}
                        disabled={disabled}
                        className="size-4.5 accent-primary"
                      />
                      {role.name}
                    </label>
                  );
                })}
              </div>
              {fieldErrors.mfaRequiredRoles ? (
                <div className="mt-2">
                  <FieldError id="security-mfaRequiredRoles-error">
                    {fieldErrors.mfaRequiredRoles}
                  </FieldError>
                </div>
              ) : null}
            </fieldset>
          ) : null}
          <div className="mt-2">
            <Row title={t('mfa.methods')}>
              <Badge
                tone="brand"
                className="min-h-9 px-3.5 text-sm"
                data-testid="security-method-totp"
              >
                <Icon name="check" />
                {t('mfa.methodTotp')}
              </Badge>
            </Row>
            <Row title={t('mfa.grace')} hint={t('mfa.graceHint')}>
              {numberInput('mfaGraceDays', t('mfa.grace'), t('mfa.graceUnit'))}
            </Row>
            <Row
              title={t('mfa.promptAdmins')}
              hint={t('mfa.promptAdminsHint')}
              titleId="security-prompt-label"
            >
              <button
                type="button"
                role="switch"
                aria-checked={values.mfaPromptAdmins}
                aria-labelledby="security-prompt-label"
                disabled={disabled}
                onClick={() => {
                  change({ ...values, mfaPromptAdmins: !values.mfaPromptAdmins });
                }}
                className={cn(
                  'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-70',
                  values.mfaPromptAdmins ? 'bg-primary' : 'bg-border-strong',
                )}
                data-testid="security-mfaPromptAdmins"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-block size-6 rounded-full bg-surface shadow-1 transition-transform motion-reduce:transition-none',
                    values.mfaPromptAdmins ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0',
                  )}
                />
              </button>
            </Row>
          </div>
        </Section>

        <Section id="security-password" title={t('password.title')} intro={t('password.intro')}>
          <Row title={t('password.minLength')} hint={t('password.minLengthHint')}>
            {numberInput('passwordMinLength', t('password.minLength'), t('password.minLengthUnit'))}
          </Row>
          <Row title={t('password.breached')} hint={t('password.breachedHint')} />
          <Row title={t('password.expiry')} hint={t('password.expiryHint')}>
            <span className="font-semibold">{t('password.expiryNever')}</span>
          </Row>
        </Section>

        {/* Enforced by the sign-in limiter (T-M2-11): the organization's members on its own host; the
            platform default on the shared sign-in host (TM-0003 D-IAM-04) — the note says so. */}
        <Section
          id="security-lockout"
          title={t('lockout.title')}
          intro={t('lockout.intro')}
          note={t('lockout.scope')}
        >
          <Row title={t('lockout.threshold')} hint={t('lockout.thresholdHint')}>
            {numberInput('lockoutThreshold', t('lockout.threshold'), t('lockout.thresholdUnit'))}
          </Row>
          <Row title={t('lockout.minutes')} hint={t('lockout.minutesHint')}>
            {numberInput('lockoutMinutes', t('lockout.minutes'), t('lockout.minutesUnit'))}
          </Row>
        </Section>

        <Section id="security-sessions" title={t('sessions.title')} intro={t('sessions.intro')}>
          <Row title={t('sessions.idle')} hint={t('sessions.idleHint')}>
            {numberInput('sessionIdleMinutes', t('sessions.idle'), t('sessions.idleUnit'))}
          </Row>
          <Row title={t('sessions.maxHours')} hint={t('sessions.maxHoursHint')}>
            {numberInput('sessionMaxHours', t('sessions.maxHours'), t('sessions.maxHoursUnit'))}
          </Row>
          <Row title={t('sessions.devices')} hint={t('sessions.devicesHint')}>
            {numberInput('sessionMaxDevices', t('sessions.devices'), t('sessions.devicesUnit'))}
          </Row>
        </Section>

        {/* Not built yet (Q2-7): grouped in one row at the end instead of four rows in the sections. */}
        <details
          className="group rounded-xl border-[1.5px] border-dashed border-border-strong bg-surface px-5 py-1"
          data-testid="security-coming-soon"
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 font-semibold [&::-webkit-details-marker]:hidden">
            <Icon name="clock" className="text-text-muted" />
            {t('comingSoon')} · {comingSoon.length}
            <Icon
              name="chevron-down"
              className="ms-auto text-text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <ul className="m-0 mb-3 flex list-disc flex-col gap-1.5 ps-10 text-text-muted">
            {comingSoon.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      </form>

      {editable ? (
        <SaveBar
          state={pending ? 'saving' : refused ? 'invalid' : dirty ? 'unsaved' : 'idle'}
          form={FORM_ID}
          texts={{
            unsaved: common.unsavedChanges,
            saving: t('saving'),
            saved: <span data-testid="security-last-changed">{props.lastChanged}</span>,
            save: t('save'),
            cancel: t('discard'),
            invalid: common.invalid,
          }}
          fix={
            firstInvalid
              ? {
                  label: fillText(common.goToField, { field: fieldLabels[firstInvalid] }),
                  onClick: () => {
                    setFocusField({ field: firstInvalid });
                  },
                }
              : undefined
          }
        />
      ) : (
        <p
          className="m-0 flex items-center gap-2 text-sm text-text-muted"
          data-testid="security-last-changed"
        >
          <Icon name="clock" />
          {props.lastChanged}
        </p>
      )}

      <Dialog
        open={confirming !== null}
        onClose={() => {
          setConfirming(null);
        }}
        title={t('confirm.title')}
        closeLabel={common.close}
        data-testid="security-confirm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(null);
              }}
            >
              {t('confirm.goBack')}
            </Button>
            <Button
              onClick={() => {
                if (confirming) save(confirming);
              }}
              data-testid="security-confirm-save"
            >
              {t('confirm.go')}
            </Button>
          </>
        }
      >
        {confirming ? (
          <div className="flex flex-col gap-2 text-text-muted">
            <p className="m-0">
              {confirming.mfaMode === 'required_roles'
                ? fillText(t('confirm.roles'), { roles: roleNames(confirming.mfaRequiredRoles) })
                : fillText(t('confirm.all'), { organization: props.organization })}
            </p>
            <p className="m-0">{props.graceTexts[confirming.mfaGraceDays] ?? ''}</p>
          </div>
        ) : null}
      </Dialog>
      <LeaveGuard active={editable && dirty && !pending} texts={common} />
    </>
  );
}
