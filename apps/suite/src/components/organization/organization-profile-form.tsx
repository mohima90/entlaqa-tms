'use client';
import { formatDisplayDate } from '@jadarat/platform-i18n/dates';
import { type RegionalPreset, applyPreset } from '@jadarat/platform-i18n/regional-presets';
import { Alert, Button, Card, Icon, TextField } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import { updateOrganizationProfileAction } from '../../actions/organization';
import type { Choice, OrganizationChoices } from '../../lib/organization-options';
import {
  type ProfileField,
  type ProfileFieldError,
  type ProfileFormValues,
  firstInvalidField,
  profileInput,
  serverFieldError,
  toggleDay,
  validateProfile,
} from '../../lib/organization-profile-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';

/**
 * Organization profile and regional settings (approved screen «بيانات المنشأة» / "Organization profile",
 * PO 14 Oct 2026; FR-ADM-02, FR-SCH-07; T-M2-22). Three cards — the organization, its defaults, calendar
 * and working week — two notes, and a sticky footer with who changed it last, Cancel and Save. Choosing a
 * country suggests its currency, time zone, working week and date display (never on load; everything stays
 * editable). The Organization Admin saves with an authenticator code (AAL2, like the security policy); at
 * AAL1 the page asks for the code first and the form is read-only.
 */
export interface OrganizationProfileFormProps {
  readonly locale: 'ar' | 'en';
  readonly initial: ProfileFormValues;
  readonly version: number;
  readonly editable: boolean;
  readonly choices: OrganizationChoices;
  readonly industries: readonly Choice[];
  /** Translated texts by key (organizationProfile namespace, flattened). */
  readonly texts: Readonly<Record<string, string>>;
  readonly lastChanged: string;
  readonly errors: ErrorTexts;
}

/** No subscription: whether this renders in the browser never changes after hydration. */
const subscribeNothing = () => () => undefined;

interface Message {
  readonly tone: 'success' | 'warning' | 'danger' | 'info';
  readonly text: string;
}

function Radio({
  name,
  value,
  checked,
  disabled,
  onChange,
  lang,
  testId,
  children,
}: {
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: () => void;
  readonly lang?: string;
  readonly testId: string;
  readonly children: ReactNode;
}) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 ${
        checked
          ? 'border-primary bg-primary-subtle font-medium text-primary-text'
          : 'border-border-strong bg-surface'
      }`}
      lang={lang}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="size-4 accent-primary"
        data-testid={testId}
      />
      {children}
    </label>
  );
}

export function OrganizationProfileForm(props: OrganizationProfileFormProps) {
  const { texts, choices, editable } = props;
  const t = (key: string) => texts[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<ProfileFormValues>(props.initial);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProfileField, ProfileFieldError>>>(
    {},
  );
  const [message, setMessage] = useState<Message | null>(null);
  // A polite announcement when the country fills in suggestions (the fields change without a page load).
  const [presetNote, setPresetNote] = useState('');
  // The concurrency token: the saved version comes back with each save (review L8), so a quick second
  // save does not conflict with the first; a refreshed page brings it too (versions only grow).
  const [savedVersion, setSavedVersion] = useState(props.version);
  const version = Math.max(props.version, savedVersion);
  // After a refused save, the first field with an error gets the focus (review L4).
  const [focusField, setFocusField] = useState<{ field: ProfileField } | null>(null);
  // In the browser the preview follows the chosen display AND time zone for today (review L6); on the
  // server (and while hydrating) it is the server's preview for the saved zone.
  const inBrowser = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const disabled = !editable || pending;

  useEffect(() => {
    if (!focusField) return;
    const id =
      focusField.field === 'workingDays'
        ? 'org-day-0'
        : focusField.field === 'defaultLocale' || focusField.field === 'dateDisplay'
          ? null
          : `org-${focusField.field}`;
    if (id) document.getElementById(id)?.focus();
  }, [focusField]);

  const preview = useMemo(() => {
    if (!inBrowser) return choices.previews[values.dateDisplay];
    try {
      return formatDisplayDate(choices.now, {
        locale: props.locale,
        display: values.dateDisplay,
        timeZone: values.timeZone,
        style: 'full',
      });
    } catch {
      return choices.previews[values.dateDisplay];
    }
  }, [inBrowser, values.dateDisplay, values.timeZone, props.locale, choices.previews, choices.now]);

  function showErrors(found: Partial<Record<ProfileField, ProfileFieldError>>) {
    setFieldErrors(found);
    const field = firstInvalidField(found);
    if (field) setFocusField({ field });
  }

  const set = <K extends ProfileField>(field: K, value: ProfileFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
  };
  const errorOf = (field: ProfileField) => {
    const code = fieldErrors[field];
    return code ? t(`fieldErrors.${code}`) : undefined;
  };

  function changeCountry(code: string) {
    const preset: RegionalPreset | undefined = props.choices.suggestions[code];
    setValues((current) => ({
      ...(preset ? applyPreset(current, preset) : current),
      countryCode: code,
    }));
    const name = choices.countries.find((c) => c.value === code)?.label;
    setPresetNote(preset && name ? (texts.presetApplied ?? '').replace('{country}', name) : '');
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const found = validateProfile(values);
    showErrors(found);
    if (Object.keys(found).length > 0) {
      setMessage({ tone: 'danger', text: props.errors['errors.validationFailed'] ?? '' });
      return;
    }
    startTransition(async () => {
      const result = await updateOrganizationProfileAction({
        ...profileInput(values),
        version,
      } as Parameters<typeof updateOrganizationProfileAction>[0]);
      if (result.ok) {
        setSavedVersion(result.value.version);
        setMessage({
          tone: 'success',
          text: result.value.changed.length === 0 ? t('noChanges') : t('saved'),
        });
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      if (result.error.code === 'VALIDATION_FAILED') {
        const fromServer: Partial<Record<ProfileField, ProfileFieldError>> = {};
        for (const fieldError of result.error.fieldErrors ?? []) {
          const field = fieldError.path.split('.')[0] as ProfileField;
          fromServer[field] ??= serverFieldError(fieldError.path, values);
        }
        showErrors(fromServer);
      }
      setMessage({ tone: 'danger', text: errorText(result.error, props.errors) });
    });
  }

  function cancel() {
    setValues(props.initial);
    setFieldErrors({});
    setMessage(null);
    setPresetNote('');
  }

  const select = (
    field: 'industry' | 'countryCode' | 'currencyCode' | 'timeZone' | 'fiscalYearStartMonth',
    label: string,
    options: readonly Choice[],
    extra: { hint?: string; choose?: string; onChange?: (value: string) => void } = {},
  ) => (
    <SelectField
      id={`org-${field}`}
      name={field}
      label={label}
      hint={extra.hint}
      error={errorOf(field)}
      value={String(values[field])}
      disabled={disabled}
      onChange={(event) => {
        const value = event.target.value;
        if (extra.onChange) extra.onChange(value);
        else if (field === 'fiscalYearStartMonth') set(field, Number(value));
        else set(field, value);
      }}
      data-testid={`org-${field}`}
    >
      {extra.choose ? (
        <option value="" disabled>
          {extra.choose}
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </SelectField>
  );

  const fieldsetError = (field: ProfileField) => {
    const error = errorOf(field);
    return error ? (
      <p id={`org-${field}-error`} className="m-0 text-sm font-medium text-danger">
        {error}
      </p>
    ) : null;
  };

  return (
    <form
      // A focused field never hides behind the sticky footer (WCAG 2.4.11; review L4).
      className="flex flex-col gap-6 [&_button]:scroll-mb-40 [&_input]:scroll-mb-40 [&_select]:scroll-mb-40"
      onSubmit={onSubmit}
      noValidate
      data-testid="organization-profile-form"
    >
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_34rem] flex-col gap-6">
          <Card
            aria-labelledby="org-card-organization"
            titleId="org-card-organization"
            title={t('organization.title')}
            description={t('organization.intro')}
            icon="building"
            className="flex flex-col gap-5 *:first:mb-0"
          >
            {/* The display names moved to Branding (WP-ADM-02, FR-ADM-02; Kawadir). */}
            <p className="m-0 text-sm text-text-muted" data-testid="org-names-moved">
              {t('organization.namesMoved')}{' '}
              <a
                href={`/${props.locale}/suite/admin/branding`}
                className="font-semibold text-primary-text underline"
              >
                {t('organization.namesMovedLink')}
              </a>
            </p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-5">
              {select('industry', t('organization.industry'), props.industries, {
                choose: t('organization.industryChoose'),
              })}
              {select('countryCode', t('organization.country'), choices.countries, {
                choose: t('organization.countryChoose'),
                hint: t('organization.countryHint'),
                onChange: changeCountry,
              })}
            </div>
          </Card>

          <Card
            aria-labelledby="org-card-defaults"
            titleId="org-card-defaults"
            title={t('defaults.title')}
            description={t('defaults.intro')}
            icon="globe"
            className="flex flex-col gap-5 *:first:mb-0"
          >
            <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-5">
              {select('currencyCode', t('defaults.currency'), choices.currencies)}
              {select('timeZone', t('defaults.timeZone'), choices.timeZones)}
              {select('fiscalYearStartMonth', t('defaults.fiscalYear'), choices.months, {
                hint: t('defaults.fiscalYearHint'),
              })}
            </div>
            <fieldset
              className="m-0 flex flex-col gap-2 border-0 p-0"
              aria-describedby="org-language-hint"
            >
              <legend className="mb-1 p-0 font-medium">{t('defaults.language')}</legend>
              <div className="flex flex-wrap gap-2">
                {(['en', 'ar'] as const).map((language) => (
                  <Radio
                    key={language}
                    name="defaultLocale"
                    value={language}
                    lang={language}
                    checked={values.defaultLocale === language}
                    disabled={disabled}
                    onChange={() => {
                      set('defaultLocale', language);
                    }}
                    testId={`org-language-${language}`}
                  >
                    {language === 'en' ? 'English' : 'العربية'}
                  </Radio>
                ))}
              </div>
              <p id="org-language-hint" className="m-0 text-sm text-text-muted">
                {t('defaults.languageHint')}
              </p>
            </fieldset>
          </Card>

          <Card
            aria-labelledby="org-card-calendar"
            titleId="org-card-calendar"
            title={t('calendar.title')}
            description={t('calendar.intro')}
            icon="calendar"
            className="flex flex-col gap-5 *:first:mb-0"
          >
            <fieldset
              className="m-0 flex flex-col gap-2 border-0 p-0"
              aria-describedby="org-date-preview"
            >
              <legend className="mb-1 p-0 font-medium">{t('calendar.dateDisplay')}</legend>
              <div className="flex flex-wrap gap-2">
                {(['gregorian', 'hijri', 'dual'] as const).map((display) => (
                  <Radio
                    key={display}
                    name="dateDisplay"
                    value={display}
                    checked={values.dateDisplay === display}
                    disabled={disabled}
                    onChange={() => {
                      set('dateDisplay', display);
                    }}
                    testId={`org-display-${display}`}
                  >
                    {t(`calendar.displays.${display}`)}
                  </Radio>
                ))}
              </div>
              <p
                id="org-date-preview"
                className="m-0 flex items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2 text-sm text-text-muted"
                aria-live="polite"
                data-testid="org-date-preview"
              >
                <Icon name="calendar" />
                <span className="sr-only">{t('calendar.preview')}: </span>
                <span>{preview}</span>
              </p>
            </fieldset>
            <fieldset
              className="m-0 flex flex-col gap-2 border-0 p-0"
              aria-describedby={`org-days-hint${fieldErrors.workingDays ? ' org-workingDays-error' : ''}`}
            >
              <legend className="mb-1 p-0 font-medium">{t('calendar.workingDays')}</legend>
              <div className="flex flex-wrap gap-1.5" data-testid="org-working-days">
                {choices.weekdays.map((day) => {
                  const on = values.workingDays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      id={`org-day-${String(day.value)}`}
                      aria-pressed={on}
                      aria-label={day.long}
                      disabled={disabled}
                      onClick={() => {
                        set('workingDays', toggleDay(values.workingDays, day.value));
                      }}
                      className={`min-h-11 min-w-14 rounded-xl border px-2 text-sm font-medium disabled:cursor-not-allowed ${
                        on
                          ? 'border-primary bg-primary text-on-primary'
                          : 'border-border-strong bg-surface text-text'
                      }`}
                      data-testid={`org-day-${String(day.value)}`}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
              <p id="org-days-hint" className="m-0 text-sm text-text-muted">
                {t('calendar.workingDaysHint')}
              </p>
              {fieldsetError('workingDays')}
            </fieldset>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-5">
              {(['workStartsAt', 'workEndsAt'] as const).map((field) => (
                <TextField
                  key={field}
                  id={`org-${field}`}
                  name={field}
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="08:00"
                  label={t(field === 'workStartsAt' ? 'calendar.hoursStart' : 'calendar.hoursEnd')}
                  hint={t('calendar.hoursHint')}
                  error={errorOf(field)}
                  value={values[field]}
                  onChange={(event) => {
                    set(field, event.target.value);
                  }}
                  disabled={disabled}
                  data-testid={`org-${field}`}
                />
              ))}
            </div>
            <p className="m-0 text-sm text-text-muted">{t('calendar.branchesNote')}</p>
          </Card>
        </div>

        <aside
          aria-label={t('notes.label')}
          className="flex min-w-0 flex-[1_1_16rem] flex-col gap-4 lg:max-w-80"
        >
          <div className="flex gap-3 rounded-xl border border-info/30 bg-info-subtle p-4 text-sm">
            <Icon name="info" className="mt-0.5 shrink-0 text-info" />
            <div>
              <p className="m-0 mb-1 font-semibold text-text">{t('notes.countryTitle')}</p>
              <p className="m-0 text-text-muted">{t('notes.countryBody')}</p>
            </div>
          </div>
          <div className="flex gap-3 rounded-xl border border-border bg-surface p-4 text-sm shadow-1">
            <Icon name="info" className="mt-0.5 shrink-0 text-text-muted" />
            <div>
              <p className="m-0 mb-1 font-semibold text-text">{t('notes.notCollectedTitle')}</p>
              <p className="m-0 text-text-muted">{t('notes.notCollectedBody')}</p>
            </div>
          </div>
        </aside>
      </div>

      {/* Polite status: suggestions filled in after a country change (kept rendered, text changes). */}
      <p className="sr-only" role="status" data-testid="org-preset-note">
        {presetNote}
      </p>
      {/* Success and warnings: a polite live region that stays mounted, so a message that appears after
          a save is announced (Alert's contract; review L4). Errors: an assertive alert, read on mount. */}
      <div role="status" data-testid="organization-status">
        {message && message.tone !== 'danger' ? (
          <Alert tone={message.tone} role="none" data-testid="organization-message">
            {message.text}
          </Alert>
        ) : null}
      </div>
      {message?.tone === 'danger' ? (
        <Alert tone="danger" data-testid="organization-message">
          {message.text}
        </Alert>
      ) : null}
      {editable ? (
        <div
          className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-2 sm:px-5"
          data-testid="organization-footer"
        >
          <span
            className="flex-[1_1_16rem] text-sm text-text-muted"
            data-testid="organization-last-changed"
          >
            {props.lastChanged}
          </span>
          <Button type="button" variant="secondary" onClick={cancel} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={pending} data-testid="organization-save">
            {pending ? t('saving') : t('save')}
          </Button>
        </div>
      ) : (
        // Read only (the Auditor): no Save / Cancel, only who changed it last.
        <p className="m-0 text-sm text-text-muted" data-testid="organization-last-changed">
          {props.lastChanged}
        </p>
      )}
    </form>
  );
}
