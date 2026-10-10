'use client';
import { Alert, Badge, Button, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, type SyntheticEvent, useState, useTransition } from 'react';
import { updateSecurityPolicyAction } from '../../actions/security';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SECURITY_FORM_LIMITS, type SecurityNumberField } from '../../lib/security-limits';
import { fieldErrorCodes } from '../profile/field-errors';

/**
 * Security settings (approved screen 6 «الأمان»; FR-IAM-12/13, T-M2-10). The Organization Admin changes
 * them with an authenticator code (AAL2 — the page explains and links to the code first); everyone else
 * who may open the page reads them. Methods other than the authenticator app (e-mail and SMS codes),
 * trusted devices (follow-up T-M2-10c) and password history are on the screen but not built yet (marked
 * «قريبًا»); passwords never expire (PO decision). Limits mirror the database's floors; the lockout
 * settings are stored now and applied by the sign-in limiter (T-M2-11), as the section's badge says.
 */
export type MfaMode = 'off' | 'optional' | 'required_all' | 'required_roles';

export interface SecurityFormValues {
  readonly mfaMode: MfaMode;
  readonly mfaRequiredRoles: readonly string[];
  readonly mfaGraceDays: number;
  readonly mfaPromptAdmins: boolean;
  readonly passwordMinLength: number;
  readonly lockoutThreshold: number;
  readonly lockoutMinutes: number;
  readonly sessionIdleMinutes: number;
  readonly sessionMaxHours: number;
  readonly sessionMaxDevices: number;
}

/** The settings typed as numbers (every key of SecurityFormValues but the MFA mode, roles and prompt). */
type NumberField = SecurityNumberField;

export const NUMBER_LIMITS: Readonly<Record<NumberField, { min: number; max: number }>> =
  SECURITY_FORM_LIMITS;

const MODES: readonly MfaMode[] = ['off', 'optional', 'required_all', 'required_roles'];

export interface SecurityFormProps {
  readonly initial: SecurityFormValues;
  readonly version: number;
  readonly editable: boolean;
  readonly roles: readonly { readonly code: string; readonly name: string }[];
  /** Translated texts by key (security namespace, flattened). */
  readonly texts: Readonly<Record<string, string>>;
  readonly lastChanged: string;
  readonly errors: ErrorTexts;
  /** /mfa?next=<this page>: a save refused for want of a recent code links there (review L3). */
  readonly stepUpHref: string;
}

/** Whole numbers in any script (the inputs are numeric). */
function parseWhole(value: string): number | null {
  const western = value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).trim();
  return /^\d{1,4}$/.test(western) ? Number(western) : null;
}

function Row({
  title,
  hint,
  children,
}: {
  readonly title: ReactNode;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border py-4 last:border-b-0">
      <div className="flex min-w-0 flex-[1_1_18rem] flex-col">
        <span className="font-semibold">{title}</span>
        {hint ? <span className="text-sm text-text-muted">{hint}</span> : null}
      </div>
      <div className="flex flex-[1_1_14rem] flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Section({
  id,
  title,
  intro,
  badge,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly intro: string;
  /** Next to the title, e.g. settings that take effect with a later update. */
  readonly badge?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-lg border border-border bg-surface px-5 py-4"
      data-testid={id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={id} className="m-0 text-lg font-semibold">
          {title}
        </h2>
        {badge}
      </div>
      <p className="m-0 mb-2 text-text-muted">{intro}</p>
      {children}
    </section>
  );
}

export function SecuritySettingsForm({
  initial,
  version,
  editable,
  roles,
  texts,
  lastChanged,
  errors,
  stepUpHref,
}: SecurityFormProps) {
  const t = (key: string) => texts[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<SecurityFormValues>(initial);
  const [numbers, setNumbers] = useState<Readonly<Record<NumberField, string>>>(
    () =>
      Object.fromEntries(
        (Object.keys(NUMBER_LIMITS) as NumberField[]).map((key) => [key, String(initial[key])]),
      ) as Record<NumberField, string>,
  );
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<{
    tone: 'success' | 'warning' | 'danger';
    text: string;
    stepUp?: boolean;
  } | null>(null);
  const disabled = !editable || pending;

  function numberInput(field: NumberField, label: string, unit: string) {
    const id = `security-${field}`;
    const error = fieldErrors[field];
    return (
      <>
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
          }}
          disabled={disabled}
          className={`min-h-11 w-24 rounded-md border bg-surface px-3 text-center text-text disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-disabled ${error ? 'border-danger' : 'border-border-strong'}`}
          data-testid={id}
        />
        <span>{unit}</span>
        {error ? (
          <p id={`${id}-error`} className="m-0 w-full text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </>
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
      errorsFound.sessionIdleMinutes = t('fieldErrors.idleAboveMax');
    }
    setFieldErrors(errorsFound);
    if (Object.keys(errorsFound).length > 0) return null;
    return { ...values, ...(parsed as Record<NumberField, number>) };
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const settings = collect();
    if (!settings) {
      setMessage({ tone: 'danger', text: errors['errors.validationFailed'] ?? '' });
      return;
    }
    startTransition(async () => {
      const result = await updateSecurityPolicyAction({
        ...settings,
        mfaRequiredRoles: [...settings.mfaRequiredRoles],
        version,
      } as Parameters<typeof updateSecurityPolicyAction>[0]);
      if (result.ok) {
        setMessage({
          tone: 'success',
          text: result.value.changed.length === 0 ? t('noChanges') : t('saved'),
        });
        router.refresh();
        return;
      }
      // The session ended meanwhile: the page sends the member on (review L1).
      if (sessionRefused(result.error)) return;
      // The code is older than 15 minutes (review L3): a new one first; the page comes back here.
      if (result.error.code === 'STEP_UP_REQUIRED') {
        setMessage({ tone: 'warning', text: t('stepUpAgain'), stepUp: true });
        return;
      }
      if (result.error.code === 'VALIDATION_FAILED') {
        const codes = fieldErrorCodes(result.error);
        setFieldErrors(
          Object.fromEntries(
            Object.keys(codes).map((field) => [
              field,
              field === 'mfaRequiredRoles'
                ? t('fieldErrors.rolesRequired')
                : t('fieldErrors.invalid'),
            ]),
          ),
        );
      }
      setMessage({ tone: 'danger', text: errorText(result.error, errors) });
    });
  }

  function discard() {
    setValues(initial);
    setNumbers(
      Object.fromEntries(
        (Object.keys(NUMBER_LIMITS) as NumberField[]).map((key) => [key, String(initial[key])]),
      ) as Record<NumberField, string>,
    );
    setFieldErrors({});
    setMessage(null);
  }

  const soon = <Badge tone="neutral">{t('comingSoon')}</Badge>;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={onSubmit}
      noValidate
      data-testid="security-form"
    >
      <Section id="security-mfa" title={t('mfa.title')} intro={t('mfa.intro')}>
        <fieldset className="m-0 grid grid-cols-1 gap-3 border-0 p-0 py-3 sm:grid-cols-2">
          <legend className="sr-only">{t('mfa.modeLegend')}</legend>
          {MODES.map((mode) => (
            <div
              key={mode}
              className={`flex items-start gap-3 rounded-lg border p-3 ${values.mfaMode === mode ? 'border-primary bg-surface-selected' : 'border-border'}`}
            >
              <input
                id={`security-mode-${mode}`}
                type="radio"
                name="mfaMode"
                value={mode}
                checked={values.mfaMode === mode}
                onChange={() => {
                  setValues({ ...values, mfaMode: mode });
                }}
                disabled={disabled}
                aria-describedby={`security-mode-${mode}-hint`}
                className="mt-1 size-5 shrink-0"
                data-testid={`security-mode-${mode}`}
              />
              <div className="flex flex-col">
                <label htmlFor={`security-mode-${mode}`} className="cursor-pointer font-semibold">
                  {t(`mfa.modes.${mode}`)}
                </label>
                <span id={`security-mode-${mode}-hint`} className="text-sm text-text-muted">
                  {t(`mfa.modes.${mode}Hint`)}
                </span>
              </div>
            </div>
          ))}
        </fieldset>
        {values.mfaMode === 'required_roles' ? (
          <Row title={t('mfa.roles')} hint={t('mfa.rolesHint')}>
            <fieldset
              className="m-0 flex flex-wrap gap-x-5 gap-y-1 border-0 p-0"
              aria-invalid={fieldErrors.mfaRequiredRoles ? true : undefined}
            >
              <legend className="sr-only">{t('mfa.roles')}</legend>
              {roles.map((role) => (
                <label key={role.code} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={values.mfaRequiredRoles.includes(role.code)}
                    onChange={(event) => {
                      setValues({
                        ...values,
                        mfaRequiredRoles: event.target.checked
                          ? [...values.mfaRequiredRoles, role.code]
                          : values.mfaRequiredRoles.filter((code) => code !== role.code),
                      });
                    }}
                    disabled={disabled}
                    className="size-5"
                  />
                  {role.name}
                </label>
              ))}
            </fieldset>
            {fieldErrors.mfaRequiredRoles ? (
              <p className="m-0 w-full text-sm font-medium text-danger">
                {fieldErrors.mfaRequiredRoles}
              </p>
            ) : null}
          </Row>
        ) : null}
        <Row title={t('mfa.methods')}>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked disabled className="size-5" />
            {t('mfa.methodTotp')}
          </label>
          <span className="flex items-center gap-2 text-text-muted">
            {t('mfa.methodEmail')} {soon}
          </span>
          <span className="flex items-center gap-2 text-text-muted">
            {t('mfa.methodSms')} {soon}
          </span>
        </Row>
        <Row title={t('mfa.grace')} hint={t('mfa.graceHint')}>
          {numberInput('mfaGraceDays', t('mfa.grace'), t('mfa.graceUnit'))}
        </Row>
        <Row title={t('mfa.trusted')} hint={t('mfa.trustedHint')}>
          {soon}
        </Row>
        <Row title={t('mfa.promptAdmins')} hint={t('mfa.promptAdminsHint')}>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={values.mfaPromptAdmins}
              onChange={(event) => {
                setValues({ ...values, mfaPromptAdmins: event.target.checked });
              }}
              disabled={disabled}
              className="size-5"
              aria-label={t('mfa.promptAdmins')}
            />
          </label>
        </Row>
      </Section>

      <Section id="security-password" title={t('password.title')} intro={t('password.intro')}>
        <Row title={t('password.minLength')} hint={t('password.minLengthHint')}>
          {numberInput('passwordMinLength', t('password.minLength'), t('password.minLengthUnit'))}
        </Row>
        <Row title={t('password.breached')} hint={t('password.breachedHint')}>
          {null}
        </Row>
        <Row title={t('password.history')}>{soon}</Row>
        <Row title={t('password.expiry')} hint={t('password.expiryHint')}>
          <span>{t('password.expiryNever')}</span>
        </Row>
      </Section>

      {/* Sign-in applies these with T-M2-11 (the sign-in limiter); until then the badge says so (review L5). */}
      <Section
        id="security-lockout"
        title={t('lockout.title')}
        intro={t('lockout.intro')}
        badge={
          <Badge tone="warning" data-testid="security-lockout-pending">
            {t('lockout.pending')}
          </Badge>
        }
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

      {message ? (
        <Alert tone={message.tone} data-testid="security-message">
          <span className="flex flex-wrap items-center gap-3">
            <span>{message.text}</span>
            {message.stepUp ? (
              <a
                href={stepUpHref}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                data-testid="security-message-step-up"
              >
                {t('stepUpLink')}
              </a>
            ) : null}
          </span>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-5 py-3">
        <span className="flex-[1_1_16rem] text-sm text-text-muted">{lastChanged}</span>
        {editable ? (
          <>
            <Button type="button" variant="secondary" onClick={discard} disabled={pending}>
              {t('discard')}
            </Button>
            <Button type="submit" disabled={pending} data-testid="security-save">
              {pending ? t('saving') : t('save')}
            </Button>
          </>
        ) : null}
      </div>
    </form>
  );
}
