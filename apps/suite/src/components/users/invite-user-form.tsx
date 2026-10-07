'use client';
import { Alert, Badge, Button, TextField, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { invitePrivilegedUserAction, inviteUserAction } from '../../actions/invitations';
import { type ManagerChoice, managersFor } from '../../lib/edit-user-form';
import {
  COMMON_ROLE_CODES,
  type RoleChoice,
  choosesPrivileged,
  inviteFieldError,
  lockedRoleCodes,
  rolesShown,
} from '../../lib/invite-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';
import { SelectField, type UnitChoice } from './edit-user-form';

export interface InviteUserFormProps {
  readonly departments: readonly UnitChoice[];
  readonly branches: readonly UnitChoice[];
  readonly managers: readonly ManagerChoice[];
  readonly catalogue: readonly RoleChoice[];
  /** Privileged roles may be given in this session (Organization Admin with an authenticator code). */
  readonly privilegedAllowed: boolean;
  /** Texts by key (translated on the server). */
  readonly labels: Readonly<Record<string, string>>;
  readonly fieldTexts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** The users list (back link) and where to go after inviting (invited tab + confirmation). */
  readonly usersHref: string;
  readonly successHref: string;
  readonly rolesHref: string;
}

const EN_FIELDS = ['firstNameEn', 'familyNameEn'];

/**
 * Invite a user (T-M2-07, FR-IAM-03, BR-IAM-1; approved screen 2): work e-mail, Arabic name (English
 * optional), placement, one primary role and optional additional roles, invitation language. Privileged
 * roles stay locked unless the session may give them (PO decision D-IAM-01).
 */
export function InviteUserForm(props: InviteUserFormProps) {
  const { labels, fieldTexts, catalogue } = props;
  const text = (key: string) => labels[key] ?? key;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [showEnglish, setShowEnglish] = useState(false);
  const [departmentId, setDepartmentId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [allManagers, setAllManagers] = useState(false);
  const [allRoles, setAllRoles] = useState(false);
  const [primary, setPrimary] = useState('');
  const [additional, setAdditional] = useState<readonly string[]>([]);
  const [invitationLocale, setInvitationLocale] = useState<'ar' | 'en'>('ar');
  const locked = lockedRoleCodes(catalogue, props.privilegedAllowed);
  const managers = managersFor(props.managers, departmentId, allManagers, managerId);
  // A chosen role stays visible when the list goes back to the common roles.
  const shown = rolesShown(
    catalogue,
    allRoles || (primary !== '' && !COMMON_ROLE_CODES.includes(primary)),
  );

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const input = {
      email: field('email'),
      firstNameAr: field('firstNameAr'),
      familyNameAr: field('familyNameAr'),
      firstNameEn: showEnglish ? field('firstNameEn') : '',
      familyNameEn: showEnglish ? field('familyNameEn') : '',
      departmentId,
      branchId,
      managerPersonId: managerId,
      employeeNumber: field('employeeNumber'),
      // Validated on the server (an empty choice comes back as a field error).
      primaryRole: primary as never,
      additionalRoles: additional as never[],
      locale: invitationLocale,
    };
    const action = choosesPrivileged(catalogue, primary, additional)
      ? invitePrivilegedUserAction
      : inviteUserAction;
    setMessage(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await action(input);
      if (result.ok) {
        router.push(props.successHref);
        return;
      }
      if (result.error.code === 'VALIDATION_FAILED') {
        const errors: Record<string, string> = {};
        for (const [path, code] of Object.entries(fieldErrorCodes(result.error))) {
          const { field: name, key } = inviteFieldError(path, code);
          errors[name] ??= fieldTexts[key] ?? fieldTexts.name ?? '';
        }
        if (EN_FIELDS.some((name) => errors[name])) setShowEnglish(true);
        setFieldErrors(errors);
      }
      setMessage(errorText(result.error, props.errors));
    });
  }

  const roleText = (choice: RoleChoice, nameId: string) => (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2 font-medium">
        <span id={nameId}>{choice.name}</span>
        {choice.privileged ? <Badge tone="warning">{text('privileged')}</Badge> : null}
      </span>
      <span className="text-sm text-text-muted">{choice.description}</span>
    </span>
  );

  const describedBy = (...ids: (string | false)[]) => ids.filter(Boolean).join(' ') || undefined;

  return (
    <form className="flex flex-col gap-8" onSubmit={onSubmit} noValidate data-testid="invite-user">
      <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0 sm:grid-cols-2">
        <legend className="mb-2 text-lg font-semibold">{text('person')}</legend>
        <TextField
          id="invite-email"
          name="email"
          type="email"
          label={text('email')}
          marker={text('required')}
          hint={text('emailHint')}
          required
          dir="ltr"
          autoComplete="off"
          maxLength={254}
          error={fieldErrors.email}
          disabled={pending}
          className="sm:col-span-2"
        />
        <TextField
          id="invite-firstNameAr"
          name="firstNameAr"
          label={text('firstNameAr')}
          marker={text('required')}
          required
          maxLength={60}
          dir="rtl"
          lang="ar"
          autoComplete="off"
          error={fieldErrors.firstNameAr}
          disabled={pending}
        />
        <TextField
          id="invite-familyNameAr"
          name="familyNameAr"
          label={text('familyNameAr')}
          marker={text('required')}
          required
          maxLength={60}
          dir="rtl"
          lang="ar"
          autoComplete="off"
          error={fieldErrors.familyNameAr}
          disabled={pending}
        />
        {showEnglish ? (
          <>
            <TextField
              id="invite-firstNameEn"
              name="firstNameEn"
              label={text('firstNameEn')}
              marker={text('optional')}
              maxLength={60}
              dir="ltr"
              lang="en"
              autoComplete="off"
              error={fieldErrors.firstNameEn}
              disabled={pending}
            />
            <TextField
              id="invite-familyNameEn"
              name="familyNameEn"
              label={text('familyNameEn')}
              marker={text('optional')}
              maxLength={60}
              dir="ltr"
              lang="en"
              autoComplete="off"
              error={fieldErrors.familyNameEn}
              disabled={pending}
            />
          </>
        ) : (
          <div className="sm:col-span-2">
            <Button
              variant="ghost"
              onClick={() => {
                setShowEnglish(true);
              }}
              disabled={pending}
            >
              {text('addEnglishName')}
            </Button>
          </div>
        )}
        <SelectField
          id="invite-department"
          label={text('department')}
          marker={text('optional')}
          value={departmentId}
          onChange={(event) => {
            setDepartmentId(event.target.value);
          }}
          error={fieldErrors.departmentId}
          disabled={pending}
        >
          <option value="">{text('noDepartment')}</option>
          {props.departments.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="invite-branch"
          label={text('branch')}
          marker={text('optional')}
          value={branchId}
          onChange={(event) => {
            setBranchId(event.target.value);
          }}
          error={fieldErrors.branchId}
          disabled={pending}
        >
          <option value="">{text('noBranch')}</option>
          {props.branches.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </SelectField>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <SelectField
            id="invite-manager"
            label={text('manager')}
            marker={text('optional')}
            hint={allManagers || departmentId === '' ? text('managerHintAll') : text('managerHint')}
            value={managerId}
            onChange={(event) => {
              setManagerId(event.target.value);
            }}
            error={fieldErrors.managerPersonId}
            disabled={pending}
          >
            <option value="">{text('noManager')}</option>
            {managers.map((manager) => (
              <option key={manager.personId} value={manager.personId}>
                {manager.name}
              </option>
            ))}
          </SelectField>
          {departmentId !== '' ? (
            <div>
              <Button
                variant="secondary"
                aria-controls="invite-manager"
                aria-pressed={allManagers}
                onClick={() => {
                  setAllManagers((all) => !all);
                }}
                disabled={pending}
              >
                {allManagers ? text('departmentManagersOnly') : text('allDepartmentsManagers')}
              </Button>
            </div>
          ) : null}
        </div>
        <TextField
          id="invite-employeeNumber"
          name="employeeNumber"
          label={text('employeeNumber')}
          marker={text('optional')}
          hint={text('employeeNumberHint')}
          dir="ltr"
          autoComplete="off"
          maxLength={40}
          error={fieldErrors.employeeNumber}
          disabled={pending}
        />
      </fieldset>

      {locked.size > 0 && props.labels.privilegedLocked ? (
        <Alert tone="info" data-testid="privileged-locked">
          {text('privilegedLocked')}
        </Alert>
      ) : null}

      <fieldset
        className="m-0 flex flex-col gap-3 border-0 p-0"
        aria-describedby={describedBy(
          'invite-primary-hint',
          Boolean(fieldErrors.primaryRole) && 'invite-primary-error',
        )}
      >
        <legend className="mb-1 text-lg font-semibold">
          {text('primaryRole')}{' '}
          <span className="text-base font-normal text-text-muted">{text('required')}</span>
        </legend>
        <p id="invite-primary-hint" className="m-0 text-sm text-text-muted">
          {text('primaryRoleHint')}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {shown.map((choice) => (
            <label
              key={choice.code}
              className={`flex min-h-11 items-start gap-3 rounded-md border p-3 ${
                primary === choice.code ? 'border-primary bg-primary-subtle' : 'border-border'
              }`}
            >
              <input
                type="radio"
                name="primaryRole"
                value={choice.code}
                checked={primary === choice.code}
                disabled={pending || locked.has(choice.code)}
                onChange={() => {
                  setPrimary(choice.code);
                  setAdditional((list) => list.filter((code) => code !== choice.code));
                }}
                className="mt-1 size-5 shrink-0"
              />
              {roleText(choice, `invite-primary-${choice.code}-name`)}
            </label>
          ))}
        </div>
        {fieldErrors.primaryRole ? (
          <p id="invite-primary-error" className="m-0 text-sm font-medium text-danger">
            {fieldErrors.primaryRole}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-4">
          <Button
            variant="ghost"
            aria-pressed={allRoles}
            onClick={() => {
              setAllRoles((all) => !all);
            }}
            disabled={pending}
          >
            {allRoles ? text('showCommonRoles') : text('showAllRoles')}
          </Button>
          <a href={props.rolesHref} className="text-sm">
            {text('rolesHelp')}
          </a>
        </div>
      </fieldset>

      <fieldset
        className="m-0 flex flex-col gap-3 border-0 p-0"
        aria-describedby={describedBy(
          'invite-additional-hint',
          Boolean(fieldErrors.additionalRoles) && 'invite-additional-error',
        )}
      >
        <legend className="mb-1 text-lg font-semibold">
          {text('additionalRoles')}{' '}
          <span className="text-base font-normal text-text-muted">{text('optional')}</span>
        </legend>
        <p id="invite-additional-hint" className="m-0 text-sm text-text-muted">
          {text('additionalRolesHint')}
        </p>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {catalogue
            .filter((choice) => choice.code !== primary)
            .map((choice) => {
              const on = additional.includes(choice.code);
              return (
                <li key={choice.code}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={pending || locked.has(choice.code)}
                    onClick={() => {
                      setAdditional((list) =>
                        on ? list.filter((code) => code !== choice.code) : [...list, choice.code],
                      );
                    }}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 disabled:cursor-not-allowed disabled:opacity-60 ${
                      on
                        ? 'border-primary bg-primary text-on-primary'
                        : 'border-border-strong bg-surface text-text hover:bg-surface-hover'
                    }`}
                  >
                    {on ? (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        aria-hidden="true"
                      >
                        <path d="M5 12l5 5 9-10" />
                      </svg>
                    ) : null}
                    {choice.name}
                    {choice.privileged ? (
                      <span className="sr-only">{` (${text('privileged')})`}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
        </ul>
        {fieldErrors.additionalRoles ? (
          <p id="invite-additional-error" className="m-0 text-sm font-medium text-danger">
            {fieldErrors.additionalRoles}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-lg font-semibold">{text('language')}</legend>
        <div className="flex flex-wrap gap-6">
          {(['ar', 'en'] as const).map((value) => (
            <label key={value} className="inline-flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="invitationLocale"
                value={value}
                checked={invitationLocale === value}
                disabled={pending}
                onChange={() => {
                  setInvitationLocale(value);
                }}
                className="size-5"
              />
              <span lang={value}>{text(`language.${value}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Alert tone="info" data-testid="invite-notice">
        {text('expiryNotice')}
      </Alert>

      {message ? (
        <Alert tone="danger" data-testid="invite-message">
          {message}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? text('submitting') : text('submit')}
        </Button>
        <a href={props.usersHref} className={buttonClasses({ variant: 'secondary', size: 'md' })}>
          {text('back')}
        </a>
      </div>
    </form>
  );
}
