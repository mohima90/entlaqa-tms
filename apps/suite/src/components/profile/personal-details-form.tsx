'use client';
import { Alert, FormSection, SaveBar, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, type SyntheticEvent, useRef, useState, useTransition } from 'react';
import { updateMyProfileAction } from '../../actions/profile';
import { fillText } from '../../lib/fill-text';
import {
  NAME_PARTS,
  type NamePart,
  type PersonalDetailsFormState,
  composedLength,
} from '../../lib/profile-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';
import { LeaveGuard } from '../settings/leave-guard';
import type { SettingsCommonTexts } from '../settings/settings-texts';
import { OtherNameToggle } from '../users/other-name-toggle';
import { fieldErrorCodes } from './field-errors';

export interface PersonalDetailsFormProps {
  readonly locale: 'ar' | 'en';
  readonly initial: PersonalDetailsFormState;
  /**
   * The organization's default language: its first and family names are required and shown first; the other
   * language's are optional, behind «Add the name in …» unless already given (PO 17 Oct 2026).
   */
  readonly nameLanguage: 'ar' | 'en';
  readonly labels: {
    readonly personal: string;
    readonly personalIntro: string;
    readonly arabicName: string;
    readonly englishName: string;
    readonly addArabicName: string;
    readonly addEnglishName: string;
    readonly parts: Readonly<Record<NamePart, string>>;
    readonly mobile: string;
    readonly mobileHint: string;
    readonly language: string;
    readonly languages: { readonly ar: string; readonly en: string };
    readonly required: string;
    readonly optional: string;
    readonly save: string;
    readonly saving: string;
    readonly saved: string;
    readonly cancel: string;
    readonly noChanges: string;
    readonly prefilledName: string;
    readonly currentName: string;
    readonly currentNameKept: string;
  };
  readonly fieldTexts: {
    readonly required: string;
    readonly name: string;
    readonly mobile: string;
    readonly nameTooLong: string;
  };
  readonly errors: ErrorTexts;
  /** The save bar's and the leave guard's shared texts (namespace `common`, `errors.validationFailed`). */
  readonly common: SettingsCommonTexts;
  /** What follows the form on the tab (the read-only work details), before the floating save bar. */
  readonly children?: ReactNode;
}

const FORM_ID = 'profile-details-form';

/** The fields the member can change, as strings (a field not on screen is empty). */
const FIELD_NAMES = [
  ...NAME_PARTS.map((part) => `${part}Ar`),
  ...NAME_PARTS.map((part) => `${part}En`),
  'mobile',
  'preferredLocale',
] as const;
type Snapshot = Readonly<Record<string, string>>;

function snapshotOfForm(form: HTMLFormElement): Snapshot {
  const data = new FormData(form);
  return Object.fromEntries(
    FIELD_NAMES.map((name) => {
      const value = data.get(name);
      return [name, typeof value === 'string' ? value : ''];
    }),
  );
}

function snapshotOfInitial(initial: PersonalDetailsFormState): Snapshot {
  const v = initial.values;
  return {
    firstNameAr: v.firstNameAr ?? '',
    fatherNameAr: v.fatherNameAr ?? '',
    grandfatherNameAr: v.grandfatherNameAr ?? '',
    familyNameAr: v.familyNameAr ?? '',
    firstNameEn: v.firstNameEn ?? '',
    fatherNameEn: v.fatherNameEn ?? '',
    grandfatherNameEn: v.grandfatherNameEn ?? '',
    familyNameEn: v.familyNameEn ?? '',
    mobile: v.mobileE164 ?? '',
    preferredLocale: v.preferredLocale,
  };
}

const sameSnapshot = (a: Snapshot, b: Snapshot) =>
  FIELD_NAMES.every((name) => (a[name] ?? '') === (b[name] ?? ''));

/** The member already has a name (or a stored one to split) in that language. */
function hasNames(initial: PersonalDetailsFormState, script: 'Ar' | 'En'): boolean {
  const key = script === 'Ar' ? 'ar' : 'en';
  return (
    initial.unsplit[key] !== null ||
    NAME_PARTS.some((part) => (initial.values[`${part}${script}`] ?? '').trim() !== '')
  );
}

/**
 * My profile → personal details (FR-IAM-16), in direction C (redesign package 6, PO 21 Oct 2026): a
 * two-column section like Settings → General — names (the organization's default language first and
 * required, the other optional; PO 17 Oct 2026), mobile, interface language — and the floating save bar
 * («You have unsaved changes.» · Cancel · Save changes; after a refused Save, «Go to …»). Saved → a toast
 * «Changes saved.»; an unsaved page asks before a link inside the site is followed (LeaveGuard). Same
 * action, checks and audit as before.
 */
export function PersonalDetailsForm({
  locale,
  initial,
  nameLanguage,
  labels,
  fieldTexts,
  errors,
  common,
  children,
}: PersonalDetailsFormProps) {
  const router = useRouter();
  const requiredScript = nameLanguage === 'ar' ? 'Ar' : 'En';
  const otherScript = nameLanguage === 'ar' ? 'En' : 'Ar';
  // The default language's first and family names — unless a long name stored without parts is kept.
  const required = new Set(
    initial.unsplit[nameLanguage] === null
      ? [`firstName${requiredScript}`, `familyName${requiredScript}`]
      : [],
  );
  const [showOther, setShowOther] = useState(() => hasNames(initial, otherScript));
  const fieldText = (path: string, values: Record<string, string>): string => {
    if (path === 'mobile') return fieldTexts.mobile;
    if (required.has(path) && (values[path] ?? '').trim() === '') return fieldTexts.required;
    const script = path.endsWith('Ar') ? 'Ar' : 'En';
    const parts = NAME_PARTS.map((part) => values[`${part}${script}`] ?? '');
    return composedLength(parts) > 200 ? fieldTexts.nameTooLong : fieldTexts.name;
  };
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [baseline, setBaseline] = useState<Snapshot>(() => snapshotOfInitial(initial));
  const [dirty, setDirty] = useState(false);
  const [refused, setRefused] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const invalidPaths = Object.keys(fieldErrors);
  const firstInvalid = invalidPaths[0] ?? null;
  const barState = pending ? 'saving' : refused ? 'invalid' : dirty ? 'unsaved' : 'idle';

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const snapshot = snapshotOfForm(event.currentTarget);
    const at = (name: string) => snapshot[name] ?? '';
    const values = {
      firstNameAr: at('firstNameAr'),
      fatherNameAr: at('fatherNameAr'),
      grandfatherNameAr: at('grandfatherNameAr'),
      familyNameAr: at('familyNameAr'),
      firstNameEn: at('firstNameEn'),
      fatherNameEn: at('fatherNameEn'),
      grandfatherNameEn: at('grandfatherNameEn'),
      familyNameEn: at('familyNameEn'),
      mobile: at('mobile'),
      preferredLocale: at('preferredLocale') === 'en' ? ('en' as const) : ('ar' as const),
    };
    setProblem(null);
    setFieldErrors({});
    setRefused(false);
    startTransition(async () => {
      const result = await updateMyProfileAction(values);
      if (!result.ok) {
        if (sessionRefused(result.error)) return;
        if (result.error.code === 'VALIDATION_FAILED') {
          const codes = fieldErrorCodes(result.error);
          const next = Object.fromEntries(
            Object.keys(codes).map((path) => [path, fieldText(path, values)]),
          );
          setFieldErrors(next);
          setRefused(true);
          if (Object.keys(codes).some((path) => path.endsWith(otherScript))) setShowOther(true);
        }
        setProblem(errorText(result.error, errors));
        return;
      }
      setBaseline(snapshot);
      setDirty(false);
      if (result.value.changed.length > 0) toast.success(labels.saved);
      else toast.info(labels.noChanges);
      if (result.value.preferredLocale !== locale) {
        router.replace(`/${result.value.preferredLocale}/suite/profile`);
      }
      router.refresh();
    });
  }

  const nameField = (part: NamePart, script: 'Ar' | 'En') => {
    const name = `${part}${script}`;
    const value = initial.values[name as keyof typeof initial.values];
    return (
      <TextField
        key={name}
        id={`profile-${name}`}
        name={name}
        label={labels.parts[part]}
        marker={required.has(name) ? labels.required : labels.optional}
        required={required.has(name)}
        maxLength={60}
        defaultValue={value ?? ''}
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
      <fieldset className="m-0 grid grid-cols-1 gap-4.5 border-0 p-0">
        <legend className="mb-3 p-0 font-bold">
          {script === 'Ar' ? labels.arabicName : labels.englishName}
        </legend>
        {initial.prefilled[key] ? (
          <p className="m-0 text-sm text-text-muted">{labels.prefilledName}</p>
        ) : null}
        {initial.unsplit[key] ? (
          <p className="m-0 text-sm text-text-muted">
            {labels.currentName} <bdi>{initial.unsplit[key]}</bdi> {labels.currentNameKept}
          </p>
        ) : null}
        {NAME_PARTS.map((part) => nameField(part, script))}
      </fieldset>
    );
  };

  /** The label of an invalid field for «Go to …». */
  const labelOf = (path: string) =>
    path === 'mobile'
      ? labels.mobile
      : labels.parts[NAME_PARTS.find((part) => path.startsWith(part)) ?? 'firstName'];

  return (
    <>
      <form
        id={FORM_ID}
        ref={formRef}
        className="flex flex-col gap-5.5"
        onSubmit={onSubmit}
        onChange={(event) => {
          setDirty(!sameSnapshot(snapshotOfForm(event.currentTarget), baseline));
          setRefused(false);
        }}
        onReset={() => {
          setDirty(false);
          setRefused(false);
          setFieldErrors({});
          setProblem(null);
        }}
        noValidate
      >
        <FormSection title={labels.personal} description={labels.personalIntro}>
          {nameSet(requiredScript)}
          {showOther ? (
            nameSet(otherScript)
          ) : (
            <div className="">
              <OtherNameToggle
                label={otherScript === 'Ar' ? labels.addArabicName : labels.addEnglishName}
                focusId={`profile-firstName${otherScript}`}
                disabled={pending}
                onOpen={() => {
                  setShowOther(true);
                }}
              />
            </div>
          )}
          <TextField
            id="profile-mobile"
            name="mobile"
            type="tel"
            label={labels.mobile}
            marker={labels.optional}
            hint={
              <>
                {labels.mobileHint} <bdi dir="ltr">+966 55 123 4567</bdi>
              </>
            }
            defaultValue={initial.values.mobileE164 ?? ''}
            dir="ltr"
            autoComplete="tel"
            maxLength={32}
            error={fieldErrors.mobile}
            disabled={pending}
          />
          <SelectField
            id="profile-language"
            name="preferredLocale"
            label={labels.language}
            defaultValue={initial.values.preferredLocale}
            disabled={pending}
          >
            <option value="ar">{labels.languages.ar}</option>
            <option value="en">{labels.languages.en}</option>
          </SelectField>
          {problem ? (
            <div className="">
              <Alert tone="danger" data-testid="profile-message">
                {problem}
              </Alert>
            </div>
          ) : null}
        </FormSection>
      </form>
      {children}
      {barState === 'idle' ? null : (
        <SaveBar
          state={barState}
          form={FORM_ID}
          texts={{
            unsaved: common.unsavedChanges,
            saving: labels.saving,
            saved: '',
            save: labels.save,
            cancel: labels.cancel,
            invalid: common.invalid,
          }}
          fix={
            firstInvalid
              ? {
                  label: fillText(common.goToField, { field: labelOf(firstInvalid) }),
                  onClick: () => {
                    document.getElementById(`profile-${firstInvalid}`)?.focus();
                  },
                }
              : undefined
          }
        />
      )}
      <LeaveGuard active={dirty && !pending} texts={common} />
    </>
  );
}
