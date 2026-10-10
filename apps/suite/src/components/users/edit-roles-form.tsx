'use client';
import { Alert, Badge, Button } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { updateMemberPrivilegedRolesAction, updateMemberRolesAction } from '../../actions/users';
import {
  type RoleChoice,
  type RoleRow,
  type RolesFormState,
  blockedBySole,
  desiredRoles,
  formStateFromRoles,
  lockedRoles,
  roleTiming,
  touchesPrivileged,
} from '../../lib/edit-roles-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { fieldErrorCodes } from '../profile/field-errors';

const withoutRole = (
  additional: RolesFormState['additional'],
  code: string,
): RolesFormState['additional'] =>
  Object.fromEntries(Object.entries(additional).filter(([key]) => key !== code));

export interface EditRolesFormProps {
  readonly personId: string;
  /** Optimistic concurrency token; refreshed by the page after each save. */
  readonly version: string;
  readonly roles: readonly RoleRow[];
  readonly catalogue: readonly RoleChoice[];
  /** Privileged roles may be changed in this session (Organization Admin with an authenticator code). */
  readonly privilegedAllowed: boolean;
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly profileHref: string;
  /** Today in the organization's time zone (YYYY-MM-DD): ended and scheduled roles are marked. */
  readonly today: string;
  /** Roles held alone (BR-IAM-4: the Organization Admin holds no other role). */
  readonly soleRoles: readonly string[];
}

/**
 * Change a member's roles (T-M2-14, FR-IAM-07, BR-IAM-1; screen 3 «تعديل الأدوار», role choice of
 * screen 2): one primary role and optional additional roles with optional first and last days.
 * Privileged roles stay locked unless the session may change them (PO decision D-IAM-01). The
 * Organization Admin holds no other role (BR-IAM-4): choosing it disables every other role and choosing
 * another role disables it, with the explanation.
 */
export function EditRolesForm(props: EditRolesFormProps) {
  const { labels, catalogue } = props;
  const text = (key: string) => labels[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<RolesFormState>(() => formStateFromRoles(props.roles));
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const locked = lockedRoles(catalogue, props.privilegedAllowed);
  const initialPrimary = props.roles.find((r) => r.isPrimary)?.roleCode ?? '';
  const primaryLocked = locked.has(initialPrimary);
  const privileged = new Set(catalogue.filter((c) => c.privileged).map((c) => c.code));
  const soleBlocked = (code: string, as: 'primary' | 'additional') =>
    blockedBySole(code, as, state, props.soleRoles, props.today);

  const setDay = (code: string, field: 'validFrom' | 'validUntil', value: string) => {
    setState((s) => {
      const current = s.additional[code] ?? { validFrom: '', validUntil: '' };
      return { ...s, additional: { ...s.additional, [code]: { ...current, [field]: value } } };
    });
  };
  const toggle = (code: string, on: boolean) => {
    setState((s) => {
      const additional = withoutRole(s.additional, code);
      // A role the member already holds comes back with its stored days (an ended role stays ended).
      const stored = props.roles.find((r) => r.roleCode === code);
      const days = { validFrom: stored?.validFrom ?? '', validUntil: stored?.validUntil ?? '' };
      return { ...s, additional: on ? { ...additional, [code]: days } : additional };
    });
  };

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const desired = desiredRoles(state, catalogue, props.roles);
    const input = {
      personId: props.personId,
      version: props.version,
      primary: state.primary as never,
      additional: desired
        .filter((r) => !r.isPrimary)
        .map((r) => ({
          roleCode: r.roleCode as never,
          validFrom: r.validFrom ?? '',
          validUntil: r.validUntil ?? '',
        })),
    };
    const action = touchesPrivileged(props.roles, desired, privileged)
      ? updateMemberPrivilegedRolesAction
      : updateMemberRolesAction;
    setMessage(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await action(input);
      if (!result.ok) {
        if (sessionRefused(result.error)) return;
        // Separation of duties (BR-IAM-4): the reason itself is the message, not "check the fields".
        let conflict = false;
        if (result.error.code === 'VALIDATION_FAILED') {
          const codes = fieldErrorCodes(result.error);
          const errors: Record<string, string> = {};
          const sent = desired.filter((r) => !r.isPrimary);
          for (const [path, code] of Object.entries(codes)) {
            const row = /^additional\.([0-9]+)\./.exec(path);
            const rowCode = row ? sent[Number(row[1])]?.roleCode : undefined;
            if (path === 'primary' && code === 'LAST_ADMIN') errors.primary = text('lastAdmin');
            else if (code === 'ROLE_CONFLICT') {
              errors.additional = text('roleConflict');
              conflict = true;
            } else if (rowCode) errors[`dates-${rowCode}`] = text('datesInvalid');
            else if (path.startsWith('additional')) errors.additional = text('datesInvalid');
          }
          setFieldErrors(errors);
        }
        setMessage({
          tone: 'danger',
          text: conflict ? text('roleConflict') : errorText(result.error, props.errors),
        });
        return;
      }
      setMessage({
        tone: 'success',
        text: result.value.changed ? text('saved') : text('noChanges'),
      });
      router.refresh();
    });
  }

  const stored = (code: string) => props.roles.find((r) => r.roleCode === code) ?? null;
  const chosenDays = stored(state.primary);
  const primaryHasDays =
    chosenDays !== null && (chosenDays.validFrom !== null || chosenDays.validUntil !== null);
  const roleLabel = (
    choice: RoleChoice,
    nameId: string,
    days: { validFrom: string | null; validUntil: string | null } | null,
  ) => {
    const timing = days ? roleTiming(days.validFrom, days.validUntil, props.today) : 'current';
    return (
      <span className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          <span id={nameId}>{choice.name}</span>
          {choice.privileged ? <Badge tone="warning">{text('privileged')}</Badge> : null}
          {timing !== 'current' ? <Badge tone="neutral">{text(timing)}</Badge> : null}
        </span>
        <span className="text-sm text-text-muted">{choice.description}</span>
      </span>
    );
  };

  return (
    <form className="flex flex-col gap-8" onSubmit={onSubmit} noValidate data-testid="edit-roles">
      {locked.size > 0 ? (
        <Alert tone="info" data-testid="privileged-locked">
          {text('privilegedLocked')}
        </Alert>
      ) : null}

      <fieldset
        className="m-0 flex flex-col gap-3 border-0 p-0"
        aria-describedby={`primary-hint${primaryHasDays ? ' primary-days' : ''}${fieldErrors.primary ? ' primary-error' : ''}`}
      >
        <legend className="mb-1 font-semibold">
          {text('primary')} <span className="font-normal text-text-muted">{text('required')}</span>
        </legend>
        <p id="primary-hint" className="m-0 text-sm text-text-muted">
          {text('primaryHint')}
        </p>
        {catalogue.map((choice) => {
          const blocked = soleBlocked(choice.code, 'primary');
          const disabled =
            pending ||
            blocked ||
            locked.has(choice.code) ||
            (primaryLocked && choice.code !== initialPrimary);
          return (
            <label
              key={choice.code}
              className="flex min-h-11 items-start gap-3 rounded-md border border-border p-3"
            >
              <input
                type="radio"
                name="primary"
                value={choice.code}
                checked={state.primary === choice.code}
                disabled={disabled}
                onChange={() => {
                  setState((s) => {
                    return {
                      primary: choice.code,
                      additional: withoutRole(s.additional, choice.code),
                    };
                  });
                }}
                aria-describedby={blocked ? 'role-conflict-hint' : undefined}
                className="mt-1 size-5 shrink-0"
              />
              {roleLabel(choice, `primary-${choice.code}-name`, stored(choice.code))}
            </label>
          );
        })}
        {primaryHasDays ? (
          <p id="primary-days" className="m-0 text-sm text-text-muted" data-testid="primary-days">
            {text('primaryDaysKept')}
          </p>
        ) : null}
        {fieldErrors.primary ? (
          <p id="primary-error" className="m-0 text-sm font-medium text-danger">
            {fieldErrors.primary}
          </p>
        ) : null}
      </fieldset>

      <fieldset
        className="m-0 flex flex-col gap-3 border-0 p-0"
        aria-describedby={`additional-hint${fieldErrors.additional ? ' additional-error' : ''}`}
      >
        <legend className="mb-1 font-semibold">
          {text('additional')}{' '}
          <span className="font-normal text-text-muted">{text('optional')}</span>
        </legend>
        <p id="additional-hint" className="m-0 text-sm text-text-muted">
          {text('additionalHint')}
        </p>
        {catalogue
          .filter((choice) => choice.code !== state.primary)
          .map((choice) => {
            const days = state.additional[choice.code];
            const blocked = soleBlocked(choice.code, 'additional');
            const disabled = pending || blocked || locked.has(choice.code);
            return (
              <div
                key={choice.code}
                className="flex flex-col gap-3 rounded-md border border-border p-3"
              >
                <label className="flex min-h-11 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={days !== undefined}
                    disabled={disabled}
                    onChange={(event) => {
                      toggle(choice.code, event.target.checked);
                    }}
                    aria-describedby={blocked ? 'role-conflict-hint' : undefined}
                    className="mt-1 size-5 shrink-0"
                  />
                  {roleLabel(
                    choice,
                    `additional-${choice.code}-name`,
                    days
                      ? {
                          validFrom: days.validFrom === '' ? null : days.validFrom,
                          validUntil: days.validUntil === '' ? null : days.validUntil,
                        }
                      : null,
                  )}
                </label>
                {days !== undefined ? (
                  <div className="grid grid-cols-1 gap-3 ps-8 sm:grid-cols-2">
                    {(['validFrom', 'validUntil'] as const).map((field) => (
                      <div key={field} className="flex flex-col gap-1">
                        <label
                          id={`role-${choice.code}-${field}-label`}
                          htmlFor={`role-${choice.code}-${field}`}
                          className="text-sm font-medium"
                        >
                          {text(field)}{' '}
                          <span className="font-normal text-text-muted">{text('optional')}</span>
                        </label>
                        <input
                          id={`role-${choice.code}-${field}`}
                          type="date"
                          dir="ltr"
                          min="2000-01-01"
                          max="2100-12-31"
                          value={days[field]}
                          disabled={disabled}
                          onChange={(event) => {
                            setDay(choice.code, field, event.target.value);
                          }}
                          aria-labelledby={`role-${choice.code}-${field}-label additional-${choice.code}-name`}
                          aria-invalid={fieldErrors[`dates-${choice.code}`] ? true : undefined}
                          aria-describedby={
                            fieldErrors[`dates-${choice.code}`]
                              ? `role-${choice.code}-dates-error`
                              : undefined
                          }
                          className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-text"
                        />
                      </div>
                    ))}
                    {fieldErrors[`dates-${choice.code}`] ? (
                      <p
                        id={`role-${choice.code}-dates-error`}
                        className="m-0 text-sm font-medium text-danger sm:col-span-2"
                      >
                        {fieldErrors[`dates-${choice.code}`]}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        <p className="m-0 text-sm text-text-muted">{text('daysHint')}</p>
        <p
          id="role-conflict-hint"
          className="m-0 text-sm text-text-muted"
          data-testid="role-conflict-hint"
        >
          {text('roleConflictHint')}
        </p>
        {fieldErrors.additional ? (
          <p id="additional-error" className="m-0 text-sm font-medium text-danger">
            {fieldErrors.additional}
          </p>
        ) : null}
      </fieldset>

      <p className="m-0 text-sm text-text-muted">{text('audited')}</p>
      {message?.tone === 'danger' ? (
        <Alert tone="danger" data-testid="edit-roles-message">
          {message.text}
        </Alert>
      ) : null}
      <div role="status" aria-live="polite">
        {message?.tone === 'success' ? (
          <Alert tone="success" role="none" data-testid="edit-roles-message">
            {message.text}
          </Alert>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending || state.primary === ''}>
          {pending ? text('saving') : text('save')}
        </Button>
        <a href={props.profileHref}>{text('backToProfile')}</a>
      </div>
    </form>
  );
}
