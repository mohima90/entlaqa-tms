'use client';
import { Alert, Button, TextField } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { updateMyProfileAction } from '../../actions/profile';
import { type ErrorTexts, errorText } from '../auth/error-text';
import {
  NAME_PARTS,
  type NamePart,
  type PersonalDetailsFormState,
  composedLength,
} from '../../lib/profile-form';
import { fieldErrorCodes } from './field-errors';

const REQUIRED_AR: ReadonlySet<string> = new Set(['firstNameAr']);

export interface PersonalDetailsFormProps {
  readonly locale: 'ar' | 'en';
  readonly initial: PersonalDetailsFormState;
  readonly labels: {
    readonly arabicName: string;
    readonly englishName: string;
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
  };
  readonly fieldTexts: {
    readonly required: string;
    readonly name: string;
    readonly mobile: string;
    readonly nameTooLong: string;
  };
  readonly errors: ErrorTexts;
}

/** My profile → personal details (FR-IAM-16): names AR/EN, mobile, interface language. */
export function PersonalDetailsForm({
  locale,
  initial,
  labels,
  fieldTexts,
  errors,
}: PersonalDetailsFormProps) {
  const router = useRouter();
  const fieldText = (path: string, values: Record<string, string>): string => {
    if (path === 'mobile') return fieldTexts.mobile;
    if (REQUIRED_AR.has(path) && (values[path] ?? '').trim() === '') return fieldTexts.required;
    const script = path.endsWith('Ar') ? 'Ar' : 'En';
    const parts = NAME_PARTS.map((part) => values[`${part}${script}`] ?? '');
    return composedLength(parts) > 200 ? fieldTexts.nameTooLong : fieldTexts.name;
  };
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
        if (result.error.code === 'VALIDATION_FAILED') {
          const codes = fieldErrorCodes(result.error);
          setFieldErrors(
            Object.fromEntries(Object.keys(codes).map((path) => [path, fieldText(path, values)])),
          );
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
        marker={REQUIRED_AR.has(name) ? labels.required : labels.optional}
        required={REQUIRED_AR.has(name)}
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

  return (
    <form className="flex flex-col gap-6" onSubmit={onSubmit} noValidate>
      <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">{labels.arabicName}</legend>
        {initial.prefilled.ar ? (
          <p className="m-0 text-sm text-text-muted sm:col-span-2">{labels.prefilledName}</p>
        ) : null}
        {NAME_PARTS.map((part) => nameField(part, 'Ar'))}
      </fieldset>
      <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">{labels.englishName}</legend>
        {initial.prefilled.en ? (
          <p className="m-0 text-sm text-text-muted sm:col-span-2">{labels.prefilledName}</p>
        ) : null}
        {NAME_PARTS.map((part) => nameField(part, 'En'))}
      </fieldset>
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
            className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-text"
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
