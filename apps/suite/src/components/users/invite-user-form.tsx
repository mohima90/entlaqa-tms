'use client';
import { Alert, Button, TextField, buttonClasses } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from 'react';
import { invitePrivilegedUserAction, inviteUserAction } from '../../actions/invitations';
import { type ManagerChoice, managersFor } from '../../lib/edit-user-form';
import { createdName, inviteFieldError } from '../../lib/invite-form';
import {
  type RoleOption,
  needsScopeUnit,
  readsHeadedDepartments,
  roleActionPath,
} from '../../lib/role-choice';
import type { ScopeUnitChoice } from '../../lib/structure-view';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { fieldErrorCodes } from '../profile/field-errors';
import { SelectField } from '../select-field';
import type { UnitChoice } from './edit-user-form';
import { InviteCodeCopy, type InviteCodeValue, type InviteCopyTexts } from './invite-code-copy';
import { RoleSelect, type RoleSelectTexts } from './role-select';
import { ScopeUnitSelect, type ScopeUnitTexts } from './scope-unit-select';

export interface InviteUserFormProps {
  /** The organization's default language for new people (T-M2-22): the invitation language preselected. */
  readonly defaultLocale: 'ar' | 'en';
  readonly departments: readonly UnitChoice[];
  readonly branches: readonly UnitChoice[];
  readonly managers: readonly ManagerChoice[];
  /** The roles (standard, then custom), each with whether this member may give it (EP-ROLES). */
  readonly roles: readonly RoleOption[];
  readonly roleTexts: RoleSelectTexts;
  /** The unit picker (tree order) for a custom role limited to «A department» (EP-ORG, T-M3-09). */
  readonly scopeUnits: readonly ScopeUnitChoice[];
  readonly unitTexts: ScopeUnitTexts;
  /** Texts by key (translated on the server). */
  readonly labels: Readonly<Record<string, string>>;
  readonly fieldTexts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** The users list (back link) and where to go after inviting (invited tab + confirmation). */
  readonly usersHref: string;
  readonly successHref: string;
  readonly rolesHref: string;
  /** The code chip and copy buttons of the success panel (Kawadir). */
  readonly copyTexts: InviteCopyTexts;
  /** The page's language: the success panel names the invitee in it (English name when given). */
  readonly uiLocale: 'ar' | 'en';
}

/** The invitation just created: its code to copy (Kawadir, with its language and link) and the name. */
interface Created {
  readonly value: InviteCodeValue;
  readonly name: string;
}

/**
 * Right after inviting (Kawadir ATS, PO 16 Oct 2026): the invitation exists — its code and link can be
 * copied now and at any time from the users list; e-mail is optional. Focus moves to the heading so that
 * screen readers announce the outcome.
 */
function InvitationCreatedPanel({
  created,
  text,
  copyTexts,
  successHref,
  onAnother,
}: {
  readonly created: Created;
  readonly text: (key: string) => string;
  readonly copyTexts: InviteCopyTexts;
  readonly successHref: string;
  readonly onAnother: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className="flex flex-col gap-4" data-testid="invitation-created-panel">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-success-subtle text-success">
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M5 12l5 5 9-10" />
          </svg>
        </span>
        <h2 ref={heading} tabIndex={-1} className="m-0 text-xl font-semibold">
          {text('created.title')}
        </h2>
      </div>
      <p className="m-0">{text('created.text').split('{name}').join(created.name)}</p>
      <InviteCodeCopy value={created.value} texts={copyTexts} layout="panel" />
      <div className="flex flex-wrap items-center gap-3">
        <a href={successHref} className={buttonClasses({ variant: 'primary', size: 'md' })}>
          {text('created.toList')}
        </a>
        <Button variant="secondary" onClick={onAnother}>
          {text('created.inviteAnother')}
        </Button>
      </div>
    </section>
  );
}

const EN_FIELDS = ['firstNameEn', 'familyNameEn'];

/**
 * Invite a user (T-M2-07, FR-IAM-03, BR-IAM-1; approved screen 2): work e-mail, Arabic name (English
 * optional), placement, one role (EP-ROLES, PO 17 Oct 2026: standard or custom, one per person),
 * invitation language. Roles the member may not give (privileged ones unless Organization Admin; roles
 * with permissions they don't hold) are listed but disabled, with the reason.
 */
export function InviteUserForm(props: InviteUserFormProps) {
  const { labels, fieldTexts, roles } = props;
  const text = (key: string) => labels[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [showEnglish, setShowEnglish] = useState(false);
  const [departmentId, setDepartmentId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [allManagers, setAllManagers] = useState(false);
  const [role, setRole] = useState('');
  const [scopeUnitId, setScopeUnitId] = useState('');
  const withUnit = needsScopeUnit(roles, role);
  const [invitationLocale, setInvitationLocale] = useState<'ar' | 'en'>(props.defaultLocale);
  const [created, setCreated] = useState<Created | null>(null);
  const [formKey, setFormKey] = useState(0);
  const lockedSome = roles.some((r) => !r.assignable);
  const managers = managersFor(props.managers, departmentId, allManagers, managerId);

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
      role,
      // A unit goes only with a department-limited custom role (EP-ORG); the server checks it.
      scopeUnitId: withUnit ? scopeUnitId : '',
      locale: invitationLocale,
    };
    const action =
      role !== '' && roleActionPath(roles, role) === 'privileged'
        ? invitePrivilegedUserAction
        : inviteUserAction;
    setMessage(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await action(input);
      if (result.ok) {
        // Kawadir: the code and the link right away (no e-mail needed); the list keeps them too.
        setCreated({
          value: {
            inviteCode: result.value.inviteCode,
            locale: result.value.locale,
            inviteLink: result.value.inviteLink,
          },
          name: createdName(props.uiLocale, {
            ar: [input.firstNameAr, input.familyNameAr],
            en: [input.firstNameEn, input.familyNameEn],
          }),
        });
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
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

  if (created) {
    return (
      <InvitationCreatedPanel
        created={created}
        text={text}
        copyTexts={props.copyTexts}
        successHref={props.successHref}
        onAnother={() => {
          setCreated(null);
          setRole('');
          setScopeUnitId('');
          setDepartmentId('');
          setBranchId('');
          setManagerId('');
          setShowEnglish(false);
          setFormKey((k) => k + 1);
        }}
      />
    );
  }

  return (
    <form
      key={formKey}
      className="flex flex-col gap-8"
      onSubmit={onSubmit}
      noValidate
      data-testid="invite-user"
    >
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

      <section className="flex flex-col gap-3" aria-labelledby="invite-role-heading">
        <h2 id="invite-role-heading" className="m-0 text-lg font-semibold">
          {text('role')}
        </h2>
        <RoleSelect
          id="invite-role"
          value={role}
          onChange={(code) => {
            setRole(code);
            if (!needsScopeUnit(roles, code)) setScopeUnitId('');
            setFieldErrors(({ role: _cleared, scopeUnitId: _unit, ...rest }) => rest);
          }}
          options={roles}
          texts={props.roleTexts}
          marker={text('required')}
          hint={text('roleHint')}
          error={fieldErrors.role}
          disabled={pending}
        />
        {withUnit ? (
          <ScopeUnitSelect
            id="invite-unit"
            value={scopeUnitId}
            onChange={(id) => {
              setScopeUnitId(id);
              setFieldErrors(({ scopeUnitId: _cleared, ...rest }) => rest);
            }}
            choices={props.scopeUnits}
            texts={props.unitTexts}
            marker={text('required')}
            error={fieldErrors.scopeUnitId}
            disabled={pending}
          />
        ) : null}
        {readsHeadedDepartments(roles, role) ? (
          <Alert tone="info" data-testid="role-departments-hint">
            {text('departmentsHint')}
          </Alert>
        ) : null}
        {lockedSome && props.labels.privilegedLocked ? (
          <p className="m-0 text-sm text-text-muted" data-testid="privileged-locked">
            {text('privilegedLocked')}
          </p>
        ) : null}
        <a href={props.rolesHref} className="text-sm">
          {text('rolesHelp')}
        </a>
      </section>

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
