'use client';
import { formatHijriDate } from '@jadarat/platform-i18n/hijri';
import { Alert, Badge, Button, Card, Icon, SaveBar, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, type SyntheticEvent, useEffect, useState, useTransition } from 'react';
import { updatePersonRecordAction, updateUserDetailsAction } from '../../actions/users';
import { type ManagerChoice, editFieldErrorKey, managersFor } from '../../lib/edit-user-form';
import {
  type PersonFormState,
  type PersonSettingsTab,
  RECORD_KEYS,
  changedKeys,
  personVersionNumber,
} from '../../lib/person-settings';
import { NAME_PARTS, type NamePart, type PersonalDetailsFormState } from '../../lib/profile-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { LoadLatestVersion, useFormBase, useLatestVersion } from '../latest-version';
import { useFocusInvalid } from '../planning/use-focus-invalid';
import { fieldErrorCodes } from '../profile/field-errors';
import { SelectField } from '../select-field';
import { LeaveGuard } from '../settings/leave-guard';
import { OtherNameToggle } from './other-name-toggle';

export interface UnitChoice {
  readonly id: string;
  readonly name: string;
}

export type GenderValue = '' | 'male' | 'female';
export type CategoryValue = '' | 'management' | 'professional' | 'technical' | 'operational';

/**
 * The grade and HR-only parts of the person's settings (WP-ADM-04). `locked`: a privileged member's record
 * opened by HR — the account details stay as they are, the grade and the HR details can still be filled
 * (BR-PPL-f). The HR card exists only for a member holding «View and edit HR-only fields» (`canEditHr`): for
 * anyone else the server sends no HR value and the form renders no card.
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
  /** The section that is open (each section is its own address, `?tab=`). */
  readonly section: PersonSettingsTab;
  readonly locale: 'ar' | 'en';
  readonly personId: string;
  /** Optimistic concurrency token («person:membership»); refreshed by the page after each save. */
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
  /**
   * Texts by key (translated on the server; namespace `editUser` plus `required`, `optional`, `part.*`,
   * `language.*`, the section titles `section.personal|work`, and the save bar's and leave question's words).
   */
  readonly labels: Readonly<Record<string, string>>;
  readonly fieldTexts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** Hijri equivalent of the stored hire date, formatted on the server (no hydration mismatch). */
  readonly hireOnHijri: string | undefined;
  /** The grade and the HR-only fields (WP-ADM-04). */
  readonly record: EditRecordProps;
}

const FORM_ID = 'person-settings';

/** The person already has a name (or a stored one to split) in that language. */
function hasNames(names: PersonalDetailsFormState, script: 'Ar' | 'En'): boolean {
  const key = script === 'Ar' ? 'ar' : 'en';
  return (
    names.unsplit[key] !== null ||
    NAME_PARTS.some((part) => (names.values[`${part}${script}`] ?? '').trim() !== '')
  );
}

/** The fields as the page loaded them. */
function stateFrom(props: EditUserFormProps): PersonFormState {
  const { names, values, record } = props;
  const part = (key: `${NamePart}${'Ar' | 'En'}`) => names.values[key] ?? '';
  return {
    firstNameAr: part('firstNameAr'),
    fatherNameAr: part('fatherNameAr'),
    grandfatherNameAr: part('grandfatherNameAr'),
    familyNameAr: part('familyNameAr'),
    firstNameEn: part('firstNameEn'),
    fatherNameEn: part('fatherNameEn'),
    grandfatherNameEn: part('grandfatherNameEn'),
    familyNameEn: part('familyNameEn'),
    email: values.email,
    mobile: names.values.mobileE164 ?? '',
    preferredLocale: names.values.preferredLocale,
    employeeNumber: values.employeeNumber,
    hireOn: values.hireOn,
    jobTitleAr: values.jobTitleAr,
    jobTitleEn: values.jobTitleEn,
    departmentId: values.departmentId,
    branchId: values.branchId,
    costCentreId: values.costCentreId,
    managerPersonId: values.managerPersonId,
    gradeId: record.gradeId,
    gender: record.hr.gender,
    birthDate: record.hr.birthDate,
    category: record.hr.employmentCategory,
  };
}

/**
 * A person's settings (T-M2-13, FR-IAM-01, WP-ADM-04; the Kawadir pattern — forms standard rule 9;
 * WP-UX-01 e, T-M3-21): the former «Edit details» panel as two sections of the person's page, each its own
 * address and its own save bar — «Personal details» (names, the organization's default language first and
 * required, PO 17 Oct 2026; contact and language; the HR-only fields for who may edit them) and «Work
 * details» (employee number, hire date, job title, placement, direct manager, grade). A save sends the whole
 * record with its version: the open section's fields as typed, the others as stored (the rules, checks and
 * audit are the panel's). An older copy is refused and «Load the latest version» is offered; typed entries
 * are never replaced by a newer copy (`useFormBase`). Leaving with unsaved changes asks first; a refused
 * save moves the focus to the first field with a message. The login e-mail of a member with an account is
 * shown read-only; the direct manager is picked among the chosen department's managers, or all on request.
 */
export function EditUserForm(props: EditUserFormProps) {
  const { labels, fieldTexts, values, names, record, section } = props;
  const text = (key: string) => labels[key] ?? key;
  const rt = (key: string) => record.labels[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const latestVersion = useLatestVersion();
  const [pending, startTransition] = useTransition();
  const { form, focusInvalid } = useFocusInvalid(pending);
  const [state, setState] = useState<PersonFormState>(() => stateFrom(props));
  // What the last save wrote counts as saved until the page has loaded the new version itself.
  const [saved, setSaved] = useState<PersonFormState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [showAll, setShowAll] = useState(false);
  const nameLanguage = props.nameLanguage;
  const otherScript = nameLanguage === 'ar' ? 'En' : 'Ar';
  const [showOther, setShowOther] = useState(() => hasNames(names, otherScript));
  const base = useFormBase(
    {
      version: personVersionNumber(props.version),
      initial: { token: props.version, state: stateFrom(props) },
    },
    (initial) => changedKeys(saved ?? initial.state, state).length > 0,
    (latest) => {
      setSaved(null);
      setState(latest.state);
      setFieldErrors({});
    },
  );
  const stored = saved ?? base.initial.state;
  const dirty = base.dirty;
  const managers = managersFor(props.managers, state.departmentId, showAll, state.managerPersonId);

  // Said to the page: it does not reload itself over unsaved entries (RefreshOnReturn, WP-FIX-03).
  useEffect(() => {
    if (dirty) document.body.dataset.unsaved = 'true';
    else delete document.body.dataset.unsaved;
    return () => {
      delete document.body.dataset.unsaved;
    };
  }, [dirty]);

  const set =
    <K extends keyof PersonFormState>(key: K) =>
    (value: PersonFormState[K]) => {
      setState((current) => ({ ...current, [key]: value }));
      setFieldErrors((current) =>
        key in current
          ? Object.fromEntries(Object.entries(current).filter(([field]) => field !== key))
          : current,
      );
    };

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
    const changed = changedKeys(stored, state);
    // The account details (names, contact, placement) go through one action, with the version; the grade
    // and the HR-only fields through the other — each only when something of it differs.
    const accountChanged = !record.locked && changed.some((key) => !RECORD_KEYS.includes(key));
    const gradeChanged = section === 'work' && changed.includes('gradeId');
    const hrChanged =
      section === 'personal' &&
      record.canEditHr &&
      changed.some((key) => key === 'gender' || key === 'birthDate' || key === 'category');
    const input = {
      personId: props.personId,
      version: base.initial.token,
      firstNameAr: state.firstNameAr,
      fatherNameAr: state.fatherNameAr,
      grandfatherNameAr: state.grandfatherNameAr,
      familyNameAr: state.familyNameAr,
      firstNameEn: state.firstNameEn,
      fatherNameEn: state.fatherNameEn,
      grandfatherNameEn: state.grandfatherNameEn,
      familyNameEn: state.familyNameEn,
      // The login e-mail is not changed here (the server keeps it): not sent, not validated.
      email: values.hasLogin ? '' : state.email,
      mobile: state.mobile,
      employeeNumber: state.employeeNumber,
      preferredLocale: state.preferredLocale,
      departmentId: state.departmentId,
      branchId: state.branchId,
      // Not sent while no cost centre exists (the server keeps what the person has).
      ...(props.costCentres.length > 0 ? { costCentreId: state.costCentreId } : {}),
      managerPersonId: state.managerPersonId,
      jobTitleAr: state.jobTitleAr,
      jobTitleEn: state.jobTitleEn,
      hireOn: state.hireOn,
    };
    const snapshot = state;
    setMessage(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = accountChanged ? await updateUserDetailsAction(input) : null;
      if (result && !result.ok) {
        if (sessionRefused(result.error)) return;
        // An older copy of the person (WP-FIX-03): what was typed stays; «Load the latest version» is offered.
        const latest = latestVersion.offer(result.error, errorText(result.error, props.errors));
        if (latest !== null) {
          setMessage(latest);
          return;
        }
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
          if (Object.keys(codes).some((path) => path.endsWith(otherScript))) setShowOther(true);
        }
        setMessage(errorText(result.error, props.errors));
        focusInvalid();
        return;
      }
      const detailsChanged = result?.ok === true && result.value.changed.length > 0;
      let recordChanged = false;
      if (gradeChanged || hrChanged) {
        const savedRecord = await updatePersonRecordAction({
          personId: props.personId,
          ...(gradeChanged ? { gradeId: state.gradeId } : {}),
          ...(hrChanged
            ? {
                hr: {
                  gender: state.gender,
                  birthDate: state.birthDate,
                  employmentCategory: state.category,
                },
              }
            : {}),
        });
        if (!savedRecord.ok) {
          if (sessionRefused(savedRecord.error)) return;
          // The details are saved already: the page shows them, and a new save starts from them.
          if (detailsChanged) router.refresh();
          if (savedRecord.error.code === 'VALIDATION_FAILED') {
            const codes = fieldErrorCodes(savedRecord.error);
            setFieldErrors({
              ...(codes.gradeId ? { gradeId: rt('grade.errInvalid') } : {}),
              ...(codes.birthDate ? { birthDate: rt('hr.dobError') } : {}),
            });
          }
          setMessage(
            detailsChanged ? rt('edit.partialSaved') : errorText(savedRecord.error, props.errors),
          );
          focusInvalid();
          return;
        }
        recordChanged =
          savedRecord.value.grade?.changed === true || savedRecord.value.hrChanged.length > 0;
      }
      setSaved(snapshot);
      toast.success(detailsChanged || recordChanged ? text('saved') : text('noChanges'));
      router.refresh();
    });
  }

  const nameField = (part: NamePart, script: 'Ar' | 'En') => {
    const name = `${part}${script}` as const;
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
        value={state[name]}
        onChange={(event) => {
          set(name)(event.target.value);
        }}
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
      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
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
        {/* Paired from 768 px: first and father's name, grandfather's and family name. */}
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
          {NAME_PARTS.map((part) => nameField(part, script))}
        </div>
      </fieldset>
    );
  };

  const lockedNote = record.locked ? (
    <Alert tone="info" data-testid="edit-locked-note">
      {rt('edit.lockedNote')}
    </Alert>
  ) : null;

  let content: ReactNode;
  if (section === 'personal') {
    content = (
      <>
        {lockedNote}
        <Card title={text('section.personal')} headingLevel={2}>
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
          </fieldset>
        </Card>
        <Card title={text('contact')} headingLevel={2}>
          <fieldset
            disabled={record.locked}
            className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
          >
            <legend className="sr-only">{text('contact')}</legend>
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
                value={state.email}
                onChange={(event) => {
                  set('email')(event.target.value);
                }}
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
              value={state.mobile}
              onChange={(event) => {
                set('mobile')(event.target.value);
              }}
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
              value={state.preferredLocale}
              onChange={(event) => {
                set('preferredLocale')(event.target.value === 'en' ? 'en' : 'ar');
              }}
              disabled={pending}
            >
              <option value="ar">{text('language.ar')}</option>
              <option value="en">{text('language.en')}</option>
            </SelectField>
          </fieldset>
        </Card>
        {record.canEditHr ? (
          <Card
            title={
              <span className="flex flex-wrap items-center gap-2">
                {rt('hr.title')}
                <Badge>
                  <Icon name="lock" className="size-3.5" />
                  {rt('hr.lock')}
                </Badge>
              </span>
            }
            description={rt('hr.sectionHint')}
            headingLevel={2}
            data-testid="edit-hr-details"
          >
            <div className="flex flex-col gap-4">
              <SelectField
                id="edit-gender"
                name="gender"
                label={rt('hr.gender')}
                marker={text('optional')}
                value={state.gender}
                onChange={(event) => {
                  set('gender')(event.target.value as GenderValue);
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
                value={state.category}
                onChange={(event) => {
                  set('category')(event.target.value as CategoryValue);
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
                hint={birthHijri(state.birthDate)}
                value={state.birthDate}
                onChange={(event) => {
                  set('birthDate')(event.target.value);
                }}
                dir="ltr"
                min="1900-01-01"
                error={fieldErrors.birthDate}
                disabled={pending}
              />
              <p className="m-0 text-[13.5px] text-text-muted">{rt('hr.audit')}</p>
            </div>
          </Card>
        ) : null}
      </>
    );
  } else {
    content = (
      <>
        {lockedNote}
        <Card title={text('section.work')} headingLevel={2}>
          <fieldset
            disabled={record.locked}
            className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
            data-testid="edit-account"
          >
            <legend className="sr-only">{text('section.work')}</legend>
            <TextField
              id="edit-employeeNumber"
              name="employeeNumber"
              label={text('employeeNumber')}
              marker={text('optional')}
              hint={text('employeeNumberHint')}
              value={state.employeeNumber}
              onChange={(event) => {
                set('employeeNumber')(event.target.value);
              }}
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
              hint={hijri(state.hireOn)}
              value={state.hireOn}
              onChange={(event) => {
                set('hireOn')(event.target.value);
              }}
              dir="ltr"
              min="1900-01-01"
              max="2100-12-31"
              error={fieldErrors.hireOn}
              disabled={pending}
            />
            {/* The job title in both languages: a short natural pair, side by side from 768 px. */}
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
              {(nameLanguage === 'ar' ? (['Ar', 'En'] as const) : (['En', 'Ar'] as const)).map(
                (script) => {
                  const key = script === 'Ar' ? 'jobTitleAr' : 'jobTitleEn';
                  return (
                    <TextField
                      key={key}
                      id={`edit-${key}`}
                      name={key}
                      label={text(key)}
                      marker={text('optional')}
                      value={state[key]}
                      onChange={(event) => {
                        set(key)(event.target.value);
                      }}
                      dir={script === 'Ar' ? 'rtl' : 'ltr'}
                      lang={script === 'Ar' ? 'ar' : 'en'}
                      maxLength={150}
                      autoComplete="off"
                      error={fieldErrors[key]}
                      disabled={pending}
                    />
                  );
                },
              )}
            </div>
            <SelectField
              id="edit-department"
              name="departmentId"
              label={text('department')}
              marker={text('optional')}
              value={state.departmentId}
              onChange={(event) => {
                set('departmentId')(event.target.value);
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
              value={state.branchId}
              onChange={(event) => {
                set('branchId')(event.target.value);
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
                hint={
                  state.costCentreId === '' ? text('costCentreFromUnit') : text('costCentreHint')
                }
                value={state.costCentreId}
                onChange={(event) => {
                  set('costCentreId')(event.target.value);
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
                hint={
                  showAll || state.departmentId === ''
                    ? text('managerHintAll')
                    : text('managerHint')
                }
                value={state.managerPersonId}
                onChange={(event) => {
                  set('managerPersonId')(event.target.value);
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
              {state.departmentId !== '' ? (
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
        </Card>
        <Card title={rt('grade.label')} description={rt('grade.hint')} headingLevel={2}>
          <div className="flex flex-col gap-2">
            <SelectField
              id="edit-grade"
              name="gradeId"
              label={rt('grade.label')}
              marker={text('optional')}
              hint={record.grades.length === 0 ? rt('grade.emptyHint') : undefined}
              value={state.gradeId}
              onChange={(event) => {
                set('gradeId')(event.target.value);
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
        </Card>
      </>
    );
  }

  return (
    <form
      ref={form}
      id={FORM_ID}
      className="flex min-w-0 flex-col gap-4"
      onSubmit={onSubmit}
      onReset={(event) => {
        // The save bar's «Discard changes»: back to the stored values (not the browser's reset).
        event.preventDefault();
        setState(stored);
        setFieldErrors({});
        setMessage(null);
      }}
      noValidate
      data-testid="edit-user"
      data-section={section}
    >
      {message ? (
        <Alert tone="danger" data-testid="edit-user-message">
          {message}
          <LoadLatestVersion message={message} />
        </Alert>
      ) : null}
      {content}
      <p className="m-0 flex gap-2 text-sm text-text-muted">
        <Icon name="shield" className="mt-0.5 size-4 shrink-0" />
        {text('intro')}
      </p>
      {dirty || pending ? (
        <SaveBar
          state={pending ? 'saving' : 'unsaved'}
          form={FORM_ID}
          texts={{
            unsaved: text('unsavedChanges'),
            saving: text('saving'),
            saved: '',
            save: text('save'),
            cancel: text('discardChanges'),
          }}
        />
      ) : null}
      <LeaveGuard
        active={dirty && !pending}
        texts={{
          leaveTitle: text('leaveTitle'),
          leaveText: text('leaveText'),
          leaveStay: text('leaveStay'),
          leaveGo: text('leaveGo'),
          close: text('close'),
        }}
      />
    </form>
  );
}
