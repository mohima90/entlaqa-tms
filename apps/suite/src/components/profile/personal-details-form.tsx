'use client';
import { Alert, Button, TextField } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { updateMyProfileAction } from '../../actions/profile';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import {
  NAME_PARTS,
  type NamePart,
  type PersonalDetailsFormState,
  composedLength,
} from '../../lib/profile-form';
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
}

/** The member already has a name (or a stored one to split) in that language. */
function hasNames(initial: PersonalDetailsFormState, script: 'Ar' | 'En'): boolean {
  const key = script === 'Ar' ? 'ar' : 'en';
  return (
    initial.unsplit[key] !== null ||
    NAME_PARTS.some((part) => (initial.values[`${part}${script}`] ?? '').trim() !== '')
  );
}

/**
 * My profile → personal details (FR-IAM-16): names (the organization's default language first and required,
 * the other optional; PO 17 Oct 2026), mobile, interface language.
 */
export function PersonalDetailsForm({
  locale,
  initial,
  nameLanguage,
  labels,
  fieldTexts,
  errors,
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
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const values = {
      firstNameAr: field('firstNameAr'),
      fatherNameAr: field('fatherNameAr'),
      grandfatherNameAr: field('grandfatherNameAr'),
      familyNameAr: field('familyNameAr'),
      firstNameEn: field('firstNameEn'),
      fatherNameEn: field('fatherNameEn'),
      grandfatherNameEn: field('grandfatherNameEn'),
      familyNameEn: field('familyNameEn'),
      mobile: field('mobile'),
      preferredLocale: field('preferredLocale') === 'en' ? ('en' as const) : ('ar' as const),
    };
    setMessage(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await updateMyProfileAction(values);
      if (!result.ok) {
        if (sessionRefused(result.error)) return;
        if (result.error.code === 'VALIDATION_FAILED') {
          const codes = fieldErrorCodes(result.error);
          setFieldErrors(
            Object.fromEntries(Object.keys(codes).map((path) => [path, fieldText(path, values)])),
          );
          if (Object.keys(codes).some((path) => path.endsWith(otherScript))) setShowOther(true);
        }
        setMessage({ tone: 'danger', text: errorText(result.error, errors) });
        return;
      }
      setMessage({
        tone: 'success',
        text: result.value.changed.length > 0 ? labels.saved : labels.noChanges,
      });
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
      <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">
          {script === 'Ar' ? labels.arabicName : labels.englishName}
        </legend>
        {initial.prefilled[key] ? (
          <p className="m-0 text-sm text-text-muted sm:col-span-2">{labels.prefilledName}</p>
        ) : null}
        {initial.unsplit[key] ? (
          <p className="m-0 text-sm text-text-muted sm:col-span-2">
            {labels.currentName} <bdi>{initial.unsplit[key]}</bdi> {labels.currentNameKept}
          </p>
        ) : null}
        {NAME_PARTS.map((part) => nameField(part, script))}
      </fieldset>
    );
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit} noValidate>
      {nameSet(requiredScript)}
      {showOther ? (
        nameSet(otherScript)
      ) : (
        <OtherNameToggle
          label={otherScript === 'Ar' ? labels.addArabicName : labels.addEnglishName}
          focusId={`profile-firstName${otherScript}`}
          disabled={pending}
          onOpen={() => {
            setShowOther(true);
          }}
        />
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <div className="flex flex-col gap-1">
          <label htmlFor="profile-language" className="font-medium">
            {labels.language}
          </label>
          <select
            id="profile-language"
            name="preferredLocale"
            defaultValue={initial.values.preferredLocale}
            disabled={pending}
            className="select-chevron min-h-11 w-full rounded-full border border-border-strong bg-surface ps-4 pe-10 text-sm text-text shadow-1"
          >
            <option value="ar">{labels.languages.ar}</option>
            <option value="en">{labels.languages.en}</option>
          </select>
        </div>
      </div>
      {message ? (
        <Alert tone={message.tone} data-testid="profile-message">
          {message.text}
        </Alert>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? labels.saving : labels.save}
        </Button>
      </div>
    </form>
  );
}
