'use client';
import { formatHijriDate } from '@jadarat/platform-i18n/hijri';
import { Alert, Button, TextField } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  type SelectHTMLAttributes,
  type SyntheticEvent,
  useState,
  useTransition,
} from 'react';
import { updateUserDetailsAction } from '../../actions/users';
import { type ManagerChoice, editFieldErrorKey, managersFor } from '../../lib/edit-user-form';
import { NAME_PARTS, type NamePart, type PersonalDetailsFormState } from '../../lib/profile-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { fieldErrorCodes } from '../profile/field-errors';

export interface UnitChoice {
  readonly id: string;
  readonly name: string;
}

export interface EditUserFormProps {
  readonly locale: 'ar' | 'en';
  readonly personId: string;
  /** Optimistic concurrency token; refreshed by the page after each save. */
  readonly version: string;
  readonly names: PersonalDetailsFormState;
  readonly values: {
    readonly email: string;
    readonly hasLogin: boolean;
    readonly employeeNumber: string;
    readonly departmentId: string;
    readonly branchId: string;
    readonly managerPersonId: string;
    readonly jobTitleAr: string;
    readonly jobTitleEn: string;
    readonly hireOn: string;
  };
  readonly departments: readonly UnitChoice[];
  readonly branches: readonly UnitChoice[];
  readonly managers: readonly ManagerChoice[];
  /** Texts by key (translated on the server). */
  readonly labels: Readonly<Record<string, string>>;
  readonly fieldTexts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly profileHref: string;
}

/** Labelled native select with hint and error (same contract as TextField). */
function SelectField({
  id,
  label,
  marker,
  hint,
  error,
  children,
  ...props
}: {
  id: string;
  label: string;
  marker?: string | undefined;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
        {marker ? <span className="ms-1 font-normal text-text-muted">{marker}</span> : null}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="m-0 text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      <select
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`min-h-11 w-full rounded-md border bg-surface px-3 text-text ${
          error ? 'border-danger' : 'border-border-strong'
        }`}
      >
        {children}
      </select>
      {error ? (
        <p id={`${id}-error`} className="m-0 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Edit a user's details (T-M2-13, FR-IAM-01; fields of the approved screen 2): names, contact,
 * employee number, language and placement. The login e-mail of a member with an account is shown
 * read-only. The direct manager is picked among the chosen department's managers, or all on request.
 */
export function EditUserForm(props: EditUserFormProps) {
  const { labels, fieldTexts, values, names } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [departmentId, setDepartmentId] = useState(values.departmentId);
  const [branchId, setBranchId] = useState(values.branchId);
  const [hireOn, setHireOn] = useState(values.hireOn);
  const [managerId, setManagerId] = useState(values.managerPersonId);
  const [showAll, setShowAll] = useState(false);
  const managers = managersFor(props.managers, departmentId, showAll, managerId);
  const text = (key: string) => labels[key] ?? key;
  const hijri = (date: string): string | undefined => {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return undefined;
    try {
      return text('hireDateHijri').replace('{date}', formatHijriDate(date, props.locale));
    } catch {
      return undefined;
    }
  };

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const input = {
      personId: props.personId,
      version: props.version,
      firstNameAr: field('firstNameAr'),
      fatherNameAr: field('fatherNameAr'),
      grandfatherNameAr: field('grandfatherNameAr'),
      familyNameAr: field('familyNameAr'),
      firstNameEn: field('firstNameEn'),
      fatherNameEn: field('fatherNameEn'),
      grandfatherNameEn: field('grandfatherNameEn'),
      familyNameEn: field('familyNameEn'),
      // The login e-mail is not changed here (the server keeps it): not sent, not validated.
      email: values.hasLogin ? '' : field('email'),
      mobile: field('mobile'),
      employeeNumber: field('employeeNumber'),
      preferredLocale: field('preferredLocale') === 'en' ? ('en' as const) : ('ar' as const),
      departmentId,
      branchId,
      managerPersonId: managerId,
      jobTitleAr: field('jobTitleAr'),
      jobTitleEn: field('jobTitleEn'),
      hireOn,
    };
    setMessage(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await updateUserDetailsAction(input);
      if (!result.ok) {
        if (result.error.code === 'VALIDATION_FAILED') {
          const codes = fieldErrorCodes(result.error);
          setFieldErrors(
            Object.fromEntries(
              Object.entries(codes).map(([path, code]) => {
                const key = editFieldErrorKey(path, code);
                const required = path === 'firstNameAr' && input.firstNameAr.trim() === '';
                return [path, fieldTexts[required ? 'required' : key] ?? fieldTexts.name ?? ''];
              }),
            ),
          );
        }
        setMessage({ tone: 'danger', text: errorText(result.error, props.errors) });
        return;
      }
      setMessage({
        tone: 'success',
        text: result.value.changed.length > 0 ? text('saved') : text('noChanges'),
      });
      router.refresh();
    });
  }

  const nameField = (part: NamePart, script: 'Ar' | 'En') => {
    const name = `${part}${script}`;
    // A long Arabic name stored without parts is kept when no parts are entered.
    const required = name === 'firstNameAr' && !names.unsplit.ar;
    return (
      <TextField
        key={name}
        id={`edit-${name}`}
        name={name}
        label={text(`part.${part}`)}
        marker={required ? text('required') : text('optional')}
        required={required}
        maxLength={60}
        defaultValue={names.values[name as keyof typeof names.values] ?? ''}
        dir={script === 'Ar' ? 'rtl' : 'ltr'}
        lang={script === 'Ar' ? 'ar' : 'en'}
        autoComplete="off"
        error={fieldErrors[name]}
        disabled={pending}
      />
    );
  };

  const nameSet = (script: 'Ar' | 'En') => {
    const key = script === 'Ar' ? 'ar' : 'en';
    return (
      <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">
          {text(script === 'Ar' ? 'arabicName' : 'englishName')}
        </legend>
        {names.prefilled[key] ? (
          <p className="m-0 text-sm text-text-muted sm:col-span-2">{text('prefilledName')}</p>
        ) : null}
        {names.unsplit[key] ? (
          <p className="m-0 text-sm text-text-muted sm:col-span-2">
            {text('currentName')} <bdi>{names.unsplit[key]}</bdi>
          </p>
        ) : null}
        {NAME_PARTS.map((part) => nameField(part, script))}
      </fieldset>
    );
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit} noValidate data-testid="edit-user">
      {nameSet('Ar')}
      {nameSet('En')}

      <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">{text('contact')}</legend>
        {values.hasLogin ? (
          <TextField
            id="edit-email"
            type="email"
            label={text('email')}
            hint={text('emailIsLogin')}
            value={values.email}
            readOnly
            dir="ltr"
          />
        ) : (
          <TextField
            id="edit-email"
            name="email"
            type="email"
            label={text('email')}
            marker={text('optional')}
            hint={text('emailHint')}
            defaultValue={values.email}
            dir="ltr"
            autoComplete="off"
            maxLength={254}
            error={fieldErrors.email}
            disabled={pending}
          />
        )}
        <TextField
          id="edit-mobile"
          name="mobile"
          type="tel"
          label={text('mobile')}
          marker={text('optional')}
          hint={
            <>
              {text('mobileHint')} <bdi dir="ltr">+966 55 123 4567</bdi>
            </>
          }
          defaultValue={names.values.mobileE164 ?? ''}
          dir="ltr"
          autoComplete="off"
          maxLength={32}
          error={fieldErrors.mobile}
          disabled={pending}
        />
        <SelectField
          id="edit-language"
          name="preferredLocale"
          label={text('language')}
          defaultValue={names.values.preferredLocale}
          disabled={pending}
        >
          <option value="ar">{text('language.ar')}</option>
          <option value="en">{text('language.en')}</option>
        </SelectField>
      </fieldset>

      <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">{text('work')}</legend>
        <TextField
          id="edit-employeeNumber"
          name="employeeNumber"
          label={text('employeeNumber')}
          marker={text('optional')}
          hint={text('employeeNumberHint')}
          defaultValue={values.employeeNumber}
          dir="ltr"
          autoComplete="off"
          maxLength={40}
          error={fieldErrors.employeeNumber}
          disabled={pending}
        />
        <TextField
          id="edit-hireOn"
          name="hireOn"
          type="date"
          label={text('hireDate')}
          marker={text('optional')}
          hint={hijri(hireOn)}
          value={hireOn}
          onChange={(event) => {
            setHireOn(event.target.value);
          }}
          dir="ltr"
          min="1900-01-01"
          max="2100-12-31"
          error={fieldErrors.hireOn}
          disabled={pending}
        />
        <TextField
          id="edit-jobTitleAr"
          name="jobTitleAr"
          label={text('jobTitleAr')}
          marker={text('optional')}
          defaultValue={values.jobTitleAr}
          dir="rtl"
          lang="ar"
          maxLength={150}
          autoComplete="off"
          error={fieldErrors.jobTitleAr}
          disabled={pending}
        />
        <TextField
          id="edit-jobTitleEn"
          name="jobTitleEn"
          label={text('jobTitleEn')}
          marker={text('optional')}
          defaultValue={values.jobTitleEn}
          dir="ltr"
          lang="en"
          maxLength={150}
          autoComplete="off"
          error={fieldErrors.jobTitleEn}
          disabled={pending}
        />
        <SelectField
          id="edit-department"
          name="departmentId"
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
          id="edit-branch"
          name="branchId"
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
            id="edit-manager"
            name="managerPersonId"
            label={text('manager')}
            marker={text('optional')}
            hint={showAll || departmentId === '' ? text('managerHintAll') : text('managerHint')}
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
                {manager.active ? manager.name : `${manager.name} ${text('inactive')}`}
              </option>
            ))}
          </SelectField>
          {departmentId !== '' ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                aria-controls="edit-manager"
                aria-pressed={showAll}
                onClick={() => {
                  setShowAll((all) => !all);
                }}
                disabled={pending}
              >
                {showAll ? text('departmentManagersOnly') : text('allDepartmentsManagers')}
              </Button>
            </div>
          ) : null}
        </div>
      </fieldset>

      {message?.tone === 'danger' ? (
        <Alert tone="danger" data-testid="edit-user-message">
          {message.text}
        </Alert>
      ) : null}
      {/* Kept rendered so "Saved" is announced when its text changes (Alert docs). */}
      <div role="status" aria-live="polite">
        {message?.tone === 'success' ? (
          <Alert tone="success" role="none" data-testid="edit-user-message">
            {message.text}
          </Alert>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? text('saving') : text('save')}
        </Button>
        <a href={props.profileHref}>{text('backToProfile')}</a>
      </div>
    </form>
  );
}
