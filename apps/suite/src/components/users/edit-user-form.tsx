'use client';
import { formatHijriDate } from '@jadarat/platform-i18n/hijri';
import { Alert, Badge, Button, Icon, TextField } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useEffect, useState, useTransition } from 'react';
import { updatePersonRecordAction, updateUserDetailsAction } from '../../actions/users';
import { type ManagerChoice, editFieldErrorKey, managersFor } from '../../lib/edit-user-form';
import { NAME_PARTS, type NamePart, type PersonalDetailsFormState } from '../../lib/profile-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { fieldErrorCodes } from '../profile/field-errors';
import { SelectField } from '../select-field';
import { OtherNameToggle } from './other-name-toggle';

export interface UnitChoice {
  readonly id: string;
  readonly name: string;
}

export type GenderValue = '' | 'male' | 'female';
export type CategoryValue = '' | 'management' | 'professional' | 'technical' | 'operational';

/**
 * The grade and HR-only parts of the edit panel (WP-ADM-04). `locked`: a privileged member's record opened by
 * HR — the account details stay as they are, the grade and the HR details can still be filled (BR-PPL-f).
 * The HR card exists only for a member holding «View and edit HR-only fields» (`canEditHr`): for anyone else
 * the server sends no HR value and the form renders no card.
 */
export interface EditRecordProps {
  readonly locked: boolean;
  readonly gradeId: string;
  readonly grades: readonly { readonly id: string; readonly code: string }[];
  readonly gradesHref: string;
  readonly canEditHr: boolean;
  readonly hr: {
    readonly gender: GenderValue;
    readonly birthDate: string;
    readonly employmentCategory: CategoryValue;
  };
  /** Hijri equivalent of the stored date of birth, formatted on the server. */
  readonly birthDateHijri: string | undefined;
  /** Texts by key (namespace peopleRecord, flattened: `grade.label`, `hr.title` …). */
  readonly labels: Readonly<Record<string, string>>;
}

export interface EditUserFormProps {
  readonly locale: 'ar' | 'en';
  readonly personId: string;
  /** Optimistic concurrency token; refreshed by the page after each save. */
  readonly version: string;
  readonly names: PersonalDetailsFormState;
  /**
   * The organization's default language: its first and family names are required and shown first; the other
   * language's are optional, behind «Add the name in …» unless already given (PO 17 Oct 2026).
   */
  readonly nameLanguage: 'ar' | 'en';
  readonly values: {
    readonly email: string;
    readonly hasLogin: boolean;
    readonly employeeNumber: string;
    readonly departmentId: string;
    readonly branchId: string;
    /** WP-HR-01: the person's cost centre ('' = none; a unit's default fills it when saved empty). */
    readonly costCentreId: string;
    readonly managerPersonId: string;
    readonly jobTitleAr: string;
    readonly jobTitleEn: string;
    readonly hireOn: string;
  };
  readonly departments: readonly UnitChoice[];
  readonly branches: readonly UnitChoice[];
  /** Cost centres as choices (none: the field is hidden — before the migration or none defined). */
  readonly costCentres: readonly UnitChoice[];
  readonly managers: readonly ManagerChoice[];
  /** Texts by key (translated on the server). */
  readonly labels: Readonly<Record<string, string>>;
  readonly fieldTexts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly profileHref: string;
  /** Hijri equivalent of the stored hire date, formatted on the server (no hydration mismatch). */
  readonly hireOnHijri: string | undefined;
  /** The grade and the HR-only fields (WP-ADM-04). */
  readonly record: EditRecordProps;
  /**
   * In the side panel (redesign package 3): the form's id (the panel's footer submits it), and what the
   * panel needs to know — unsaved changes, busy, saved (the panel then closes with a toast).
   */
  readonly panel?: {
    readonly formId: string;
    readonly onDirty: () => void;
    readonly onPending: (pending: boolean) => void;
    readonly onSaved: (changed: boolean) => void;
  };
}

/** The person already has a name (or a stored one to split) in that language. */
function hasNames(names: PersonalDetailsFormState, script: 'Ar' | 'En'): boolean {
  const key = script === 'Ar' ? 'ar' : 'en';
  return (
    names.unsplit[key] !== null ||
    NAME_PARTS.some((part) => (names.values[`${part}${script}`] ?? '').trim() !== '')
  );
}

/**
 * Edit a user's details (T-M2-13, FR-IAM-01; fields of the approved screen 2): names (the organization's
 * default language first and required, PO 17 Oct 2026), contact,
 * employee number, language and placement. The login e-mail of a member with an account is shown
 * read-only. The direct manager is picked among the chosen department's managers, or all on request.
 */
export function EditUserForm(props: EditUserFormProps) {
  const { labels, fieldTexts, values, names } = props;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [departmentId, setDepartmentId] = useState(values.departmentId);
  const [branchId, setBranchId] = useState(values.branchId);
  const [costCentreId, setCostCentreId] = useState(values.costCentreId);
  const [hireOn, setHireOn] = useState(values.hireOn);
  const [managerId, setManagerId] = useState(values.managerPersonId);
  const [showAll, setShowAll] = useState(false);
  const record = props.record;
  const rt = (key: string) => record.labels[key] ?? key;
  const [gradeId, setGradeId] = useState(record.gradeId);
  const [gender, setGender] = useState<GenderValue>(record.hr.gender);
  const [birthDate, setBirthDate] = useState(record.hr.birthDate);
  const [category, setCategory] = useState<CategoryValue>(record.hr.employmentCategory);
  const nameLanguage = props.nameLanguage;
  const otherScript = nameLanguage === 'ar' ? 'En' : 'Ar';
  const [showOther, setShowOther] = useState(() => hasNames(names, otherScript));
  const managers = managersFor(props.managers, departmentId, showAll, managerId);
  const text = (key: string) => labels[key] ?? key;
  const panel = props.panel;
  const onPending = panel?.onPending;
  useEffect(() => {
    onPending?.(pending);
  }, [pending, onPending]);
  // The server answered with a refusal on the grade or the date of birth: focus moves to it (WCAG 3.3.1).
  useEffect(() => {
    const id = fieldErrors.gradeId ? 'edit-grade' : fieldErrors.birthDate ? 'edit-birthDate' : null;
    if (id !== null) document.getElementById(id)?.focus();
  }, [fieldErrors]);
  const birthHijri = (date: string): string | undefined => {
    if (date === record.hr.birthDate) return record.birthDateHijri;
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return undefined;
    try {
      return rt('hr.dobHijri').replace('{date}', formatHijriDate(date, props.locale));
    } catch {
      return undefined;
    }
  };
  const hijri = (date: string): string | undefined => {
    if (date === values.hireOn) return props.hireOnHijri;
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
      // Not sent while no cost centre exists (the server keeps what the person has).
      ...(props.costCentres.length > 0 ? { costCentreId } : {}),
      managerPersonId: managerId,
      jobTitleAr: field('jobTitleAr'),
      jobTitleEn: field('jobTitleEn'),
      hireOn,
    };
    setMessage(null);
    setFieldErrors({});
    startTransition(async () => {
      // A privileged member's record opened by HR: the account details are not saved (WP-ADM-04).
      const result = record.locked ? null : await updateUserDetailsAction(input);
      if (result && !result.ok) {
        if (sessionRefused(result.error)) return;
        if (result.error.code === 'VALIDATION_FAILED') {
          const codes = fieldErrorCodes(result.error);
          setFieldErrors(
            Object.fromEntries(
              Object.entries(codes).map(([path, code]) => {
                const key = editFieldErrorKey(path, code);
                const required = code === 'REQUIRED';
                return [path, fieldTexts[required ? 'required' : key] ?? fieldTexts.name ?? ''];
              }),
            ),
          );
        }
        if (
          result.error.code === 'VALIDATION_FAILED' &&
          Object.keys(fieldErrorCodes(result.error)).some((path) => path.endsWith(otherScript))
        ) {
          setShowOther(true);
        }
        setMessage({ tone: 'danger', text: errorText(result.error, props.errors) });
        return;
      }
      const detailsChanged = result?.ok === true && result.value.changed.length > 0;
      // The grade and the HR-only fields: a second action, only when something differs from what was loaded.
      let recordChanged = false;
      const hrChanged =
        record.canEditHr &&
        (gender !== record.hr.gender ||
          birthDate !== record.hr.birthDate ||
          category !== record.hr.employmentCategory);
      if (gradeId !== record.gradeId || hrChanged) {
        const saved = await updatePersonRecordAction({
          personId: props.personId,
          ...(gradeId !== record.gradeId ? { gradeId } : {}),
          ...(record.canEditHr ? { hr: { gender, birthDate, employmentCategory: category } } : {}),
        });
        if (!saved.ok) {
          if (sessionRefused(saved.error)) return;
          // The details are saved already: the page shows them, and a new save starts from them.
          if (detailsChanged) router.refresh();
          if (saved.error.code === 'VALIDATION_FAILED') {
            const codes = fieldErrorCodes(saved.error);
            setFieldErrors({
              ...(codes.gradeId ? { gradeId: rt('grade.errInvalid') } : {}),
              ...(codes.birthDate ? { birthDate: rt('hr.dobError') } : {}),
            });
          }
          setMessage({
            tone: 'danger',
            text: detailsChanged ? rt('edit.partialSaved') : errorText(saved.error, props.errors),
          });
          return;
        }
        recordChanged = saved.value.grade?.changed === true || saved.value.hrChanged.length > 0;
      }
      router.refresh();
      const anyChange = detailsChanged || recordChanged;
      if (panel) {
        panel.onSaved(anyChange);
        return;
      }
      setMessage({
        tone: 'success',
        text: anyChange ? text('saved') : text('noChanges'),
      });
    });
  }

  const nameField = (part: NamePart, script: 'Ar' | 'En') => {
    const name = `${part}${script}`;
    // The default language's first and family names — unless a long name stored without parts is kept
    // when no parts are entered.
    const key = script === 'Ar' ? 'ar' : 'en';
    const required =
      key === nameLanguage &&
      (part === 'firstName' || part === 'familyName') &&
      !names.unsplit[key];
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
      <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0">
        <legend className="mb-2 font-semibold">
          {text(script === 'Ar' ? 'arabicName' : 'englishName')}
        </legend>
        {names.prefilled[key] ? (
          <p className="m-0 text-sm text-text-muted">{text('prefilledName')}</p>
        ) : null}
        {names.unsplit[key] ? (
          <p className="m-0 text-sm text-text-muted">
            {text('currentName')} <bdi>{names.unsplit[key]}</bdi> {text('currentNameKept')}
          </p>
        ) : null}
        {NAME_PARTS.map((part) => nameField(part, script))}
      </fieldset>
    );
  };

  return (
    <form
      id={panel?.formId}
      className="flex flex-col gap-6"
      onSubmit={onSubmit}
      // Any typed or picked value is a change the panel warns about before closing.
      onChange={panel?.onDirty}
      noValidate
      data-testid="edit-user"
    >
      {record.locked ? (
        <Alert tone="info" data-testid="edit-locked-note">
          {rt('edit.lockedNote')}
        </Alert>
      ) : null}
      <fieldset
        disabled={record.locked}
        className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0"
        data-testid="edit-account"
      >
        {nameSet(nameLanguage === 'ar' ? 'Ar' : 'En')}
        {showOther ? (
          nameSet(otherScript)
        ) : (
          <OtherNameToggle
            label={text(otherScript === 'Ar' ? 'addArabicName' : 'addEnglishName')}
            focusId={`edit-firstName${otherScript}`}
            disabled={pending}
            onOpen={() => {
              setShowOther(true);
            }}
          />
        )}

        <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0">
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

        <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0">
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
          {props.costCentres.length > 0 ? (
            <SelectField
              id="edit-cost-centre"
              name="costCentreId"
              label={text('costCentre')}
              marker={text('optional')}
              hint={costCentreId === '' ? text('costCentreFromUnit') : text('costCentreHint')}
              value={costCentreId}
              onChange={(event) => {
                setCostCentreId(event.target.value);
              }}
              error={fieldErrors.costCentreId}
              disabled={pending}
              data-testid="edit-cost-centre"
            >
              <option value="">{text('noCostCentre')}</option>
              {props.costCentres.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          <div className="flex flex-col gap-2">
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
      </fieldset>

      <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0">
        <legend className="mb-2 font-semibold">{rt('grade.label')}</legend>
        <div className="flex flex-col gap-2">
          <SelectField
            id="edit-grade"
            name="gradeId"
            label={rt('grade.label')}
            marker={text('optional')}
            hint={record.grades.length === 0 ? rt('grade.emptyHint') : rt('grade.hint')}
            value={gradeId}
            onChange={(event) => {
              setGradeId(event.target.value);
            }}
            error={fieldErrors.gradeId}
            disabled={pending || record.grades.length === 0}
          >
            <option value="">{rt('grade.none')}</option>
            {record.grades.map((grade) => (
              <option key={grade.id} value={grade.id}>
                {grade.code}
              </option>
            ))}
          </SelectField>
          <p className="m-0">
            <a href={record.gradesHref} data-testid="edit-manage-grades">
              {record.grades.length === 0 ? rt('grade.addSome') : rt('grade.manage')}
            </a>
          </p>
        </div>
      </fieldset>

      {record.canEditHr ? (
        <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0" data-testid="edit-hr-details">
          <legend className="mb-2 flex flex-wrap items-center gap-2 font-semibold">
            {rt('hr.title')}
            <Badge>
              <Icon name="lock" className="size-3.5" />
              {rt('hr.lock')}
            </Badge>
          </legend>
          <p className="m-0 text-[13.5px] text-text-muted">{rt('hr.sectionHint')}</p>
          <SelectField
            id="edit-gender"
            name="gender"
            label={rt('hr.gender')}
            marker={text('optional')}
            value={gender}
            onChange={(event) => {
              setGender(event.target.value as GenderValue);
            }}
            disabled={pending}
          >
            <option value="">{rt('hr.notSet')}</option>
            <option value="male">{rt('hr.male')}</option>
            <option value="female">{rt('hr.female')}</option>
          </SelectField>
          <SelectField
            id="edit-category"
            name="employmentCategory"
            label={rt('hr.category')}
            marker={text('optional')}
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as CategoryValue);
            }}
            disabled={pending}
          >
            <option value="">{rt('hr.notSet')}</option>
            <option value="management">{rt('hr.cat.management')}</option>
            <option value="professional">{rt('hr.cat.professional')}</option>
            <option value="technical">{rt('hr.cat.technical')}</option>
            <option value="operational">{rt('hr.cat.operational')}</option>
          </SelectField>
          <TextField
            id="edit-birthDate"
            name="birthDate"
            type="date"
            label={rt('hr.dob')}
            marker={text('optional')}
            hint={birthHijri(birthDate)}
            value={birthDate}
            onChange={(event) => {
              setBirthDate(event.target.value);
            }}
            dir="ltr"
            min="1900-01-01"
            error={fieldErrors.birthDate}
            disabled={pending}
          />
          <p className="m-0 text-[13.5px] text-text-muted">{rt('hr.audit')}</p>
        </fieldset>
      ) : null}

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
      {panel ? null : (
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? text('saving') : text('save')}
          </Button>
          <a href={props.profileHref}>{text('backToProfile')}</a>
        </div>
      )}
    </form>
  );
}
