'use client';
import { formatDisplayDate } from '@jadarat/platform-i18n/dates';
import { type RegionalPreset, applyPreset } from '@jadarat/platform-i18n/regional-presets';
import { Alert, Badge, FieldError, FormSection, Icon, SaveBar, cn, toast } from '@jadarat/ui';
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
import { fillText } from '../../lib/fill-text';
import type { Choice, OrganizationChoices } from '../../lib/organization-options';
import {
  type ProfileField,
  type ProfileFieldError,
  type ProfileFormValues,
  changedFields,
  clockChoices,
  firstInvalidField,
  profileInput,
  sameProfile,
  serverFieldError,
  toggleDay,
  validateProfile,
} from '../../lib/organization-profile-form';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';
import { LeaveGuard } from '../settings/leave-guard';
import { Segmented } from '../settings/segmented';
import type { SettingsCommonTexts } from '../settings/settings-texts';
import { StepUpBanner } from '../settings/step-up-banner';

/**
 * Settings → General: the organization profile and regional settings (approved screen «بيانات المنشأة»,
 * PO 14 Oct 2026; FR-ADM-02, FR-SCH-07; T-M2-22), in direction C (redesign package 2, PO 21 Oct 2026):
 * three two-column sections — the organization, its defaults, calendar and working week — with their
 * help under the section titles, and the floating save bar (at rest: who changed it last; with changes:
 * Cancel and Save; after a refused Save: the way to the first field). Choosing a country suggests its
 * currency, time zone, working week and date display (never on load; everything stays editable), with
 * an inline note, «Undo» and a «Suggested» tag on each field it filled in. A toast says it was saved.
 * The form warns before leaving with unsaved changes (Q2-2). When saving needs a fresh authenticator
 * code the page asks for it first (Q2-1) and the form stays read-only; the Auditor sees the values as
 * text.
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
  readonly common: SettingsCommonTexts;
  readonly lastChanged: string;
  readonly errors: ErrorTexts;
  /** The /mfa link back here, and whether saving needs a fresh authenticator code first (Q2-1). */
  readonly stepUp: { readonly href: string; readonly needed: boolean };
}

/** No subscription: whether this renders in the browser never changes after hydration. */
const subscribeNothing = () => () => undefined;

const FORM_ID = 'organization-profile-form';

interface Problem {
  readonly kind: 'danger' | 'conflict';
  readonly text: string;
}

interface PresetUndo {
  readonly before: ProfileFormValues;
  readonly fields: readonly ProfileField[];
  readonly note: string;
}

export function OrganizationProfileForm(props: OrganizationProfileFormProps) {
  const { texts, choices, common, locale } = props;
  const t = (key: string) => texts[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<ProfileFormValues>(props.initial);
  // What the page shows as saved (the save bar compares against it).
  const [baseline, setBaseline] = useState<ProfileFormValues>(props.initial);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProfileField, ProfileFieldError>>>(
    {},
  );
  const [refused, setRefused] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [stepUp, setStepUp] = useState(props.stepUp.needed);
  const [presetUndo, setPresetUndo] = useState<PresetUndo | null>(null);
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
  const editable = props.editable && !stepUp;
  const disabled = !editable || pending;
  const dirty = !sameProfile(values, baseline);

  useEffect(() => {
    if (!focusField) return;
    document.getElementById(fieldElementId(focusField.field))?.focus();
  }, [focusField]);

  const preview = useMemo(() => {
    if (!inBrowser) return choices.previews[values.dateDisplay];
    try {
      return formatDisplayDate(choices.now, {
        locale,
        display: values.dateDisplay,
        timeZone: values.timeZone,
        style: 'full',
      });
    } catch {
      return choices.previews[values.dateDisplay];
    }
  }, [inBrowser, values.dateDisplay, values.timeZone, locale, choices.previews, choices.now]);

  const hours = useMemo(
    () => clockChoices([props.initial.workStartsAt, props.initial.workEndsAt]),
    [props.initial.workStartsAt, props.initial.workEndsAt],
  );

  function showErrors(found: Partial<Record<ProfileField, ProfileFieldError>>) {
    setFieldErrors(found);
    const field = firstInvalidField(found);
    setRefused(field !== null);
    if (field) setFocusField({ field });
  }

  const set = <K extends ProfileField>(field: K, value: ProfileFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setRefused(false);
  };
  const errorOf = (field: ProfileField) => {
    const code = fieldErrors[field];
    return code ? t(`fieldErrors.${code}`) : undefined;
  };
  const suggested = (field: ProfileField) =>
    presetUndo?.fields.includes(field) ? (
      <Badge tone="info" data-testid={`org-suggested-${field}`}>
        {t('suggestedTag')}
      </Badge>
    ) : null;

  function changeCountry(code: string) {
    const preset: RegionalPreset | undefined = props.choices.suggestions[code];
    const before = values;
    const after = { ...(preset ? applyPreset(before, preset) : before), countryCode: code };
    setValues(after);
    setRefused(false);
    const name = choices.countries.find((c) => c.value === code)?.label;
    setPresetUndo(
      preset && name
        ? {
            before,
            fields: changedFields(before, after),
            note: fillText(t('presetApplied'), { country: name }, locale),
          }
        : null,
    );
  }

  function undoPreset() {
    if (!presetUndo) return;
    setValues(presetUndo.before);
    setPresetUndo(null);
    document.getElementById('org-countryCode')?.focus();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable) return;
    setProblem(null);
    const found = validateProfile(values);
    showErrors(found);
    if (Object.keys(found).length > 0) return;
    startTransition(async () => {
      const result = await updateOrganizationProfileAction({
        ...profileInput(values),
        version,
      } as Parameters<typeof updateOrganizationProfileAction>[0]);
      if (result.ok) {
        setSavedVersion(result.value.version);
        setBaseline(values);
        setPresetUndo(null);
        if (result.value.changed.length === 0) toast.info(t('noChanges'));
        else toast.success(t('saved'));
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      if (result.error.code === 'STEP_UP_REQUIRED') {
        setStepUp(true);
        return;
      }
      if (result.error.code === 'VALIDATION_FAILED') {
        const fromServer: Partial<Record<ProfileField, ProfileFieldError>> = {};
        for (const fieldError of result.error.fieldErrors ?? []) {
          const field = fieldError.path.split('.')[0] as ProfileField;
          fromServer[field] ??= serverFieldError(fieldError.path, values);
        }
        showErrors(fromServer);
        if (Object.keys(fromServer).length > 0) return;
      }
      setProblem({
        kind: result.error.code === 'CONFLICT_VERSION' ? 'conflict' : 'danger',
        text: errorText(result.error, props.errors),
      });
    });
  }

  function cancel() {
    setValues(baseline);
    setFieldErrors({});
    setRefused(false);
    setProblem(null);
    setPresetUndo(null);
  }

  const firstInvalid = firstInvalidField(fieldErrors);
  const barState = pending ? 'saving' : refused ? 'invalid' : dirty ? 'unsaved' : 'idle';

  const select = (
    field: 'industry' | 'countryCode' | 'currencyCode' | 'timeZone' | 'fiscalYearStartMonth',
    label: string,
    options: readonly Choice[],
    extra: {
      hint?: string;
      choose?: string;
      required?: boolean;
      onChange?: (value: string) => void;
    } = {},
  ) => (
    <SelectField
      id={`org-${field}`}
      name={field}
      label={label}
      marker={extra.required ? props.common.required : undefined}
      tag={suggested(field)}
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

  const help = (title: string | null, body: string, testId?: string) => (
    <p className="m-0 mt-3.5 flex gap-2 text-sm text-text-muted" data-testid={testId}>
      <Icon name="info" className="mt-0.5" />
      <span>
        {title ? <strong className="font-semibold text-text">{title}.</strong> : null}
        {title ? ' ' : null}
        {body}
      </span>
    </p>
  );

  if (!props.editable) {
    return <ReadOnlyProfile {...props} values={values} preview={preview} />;
  }

  return (
    <>
      {stepUp ? <StepUpBanner href={props.stepUp.href} texts={common} /> : null}
      {problem ? (
        <Alert
          tone={problem.kind === 'conflict' ? 'warning' : 'danger'}
          role="alert"
          data-testid="organization-message"
          action={
            problem.kind === 'conflict' ? (
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border-[1.5px] border-current px-3.5 text-sm font-semibold"
                onClick={() => {
                  window.location.reload();
                }}
              >
                <Icon name="sync" />
                {common.reload}
              </button>
            ) : null
          }
        >
          {problem.text}
        </Alert>
      ) : null}
      <form
        id={FORM_ID}
        // A focused field never hides behind the floating save bar (WCAG 2.4.11; review L4).
        className="flex flex-col gap-5 [&_button]:scroll-mb-40 [&_input]:scroll-mb-40 [&_select]:scroll-mb-40"
        onSubmit={onSubmit}
        onReset={(event) => {
          event.preventDefault();
          cancel();
        }}
        noValidate
        data-testid="organization-profile-form"
      >
        <FormSection
          title={t('organization.title')}
          description={
            <>
              {t('organization.intro')}
              {help(t('notes.countryTitle'), t('notes.countryBody'), 'org-note-country')}
            </>
          }
        >
          {select('industry', t('organization.industry'), props.industries, {
            choose: t('organization.industryChoose'),
            required: true,
          })}
          <div className="flex min-w-0 flex-col gap-3">
            {select('countryCode', t('organization.country'), choices.countries, {
              choose: t('organization.countryChoose'),
              hint: t('organization.countryHint'),
              required: true,
              onChange: changeCountry,
            })}
            {presetUndo ? (
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-info-subtle px-3.5 py-2.5 text-sm text-info"
                data-testid="org-preset-applied"
              >
                <Icon name="sync" />
                <span className="min-w-0 flex-1">{presetUndo.note}</span>
                <button
                  type="button"
                  onClick={undoPreset}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 font-semibold underline-offset-3 hover:underline pointer-coarse:min-h-11"
                  data-testid="org-preset-undo"
                >
                  <Icon name="undo" />
                  {common.undo}
                </button>
              </div>
            ) : null}
          </div>
          {/* The display names moved to Branding (WP-ADM-02, FR-ADM-02; Kawadir). */}
          <p
            className="m-0 flex gap-2 text-sm text-text-muted md:col-span-2"
            data-testid="org-names-moved"
          >
            <Icon name="palette" className="mt-0.5" />
            <span>
              {t('organization.namesMoved')}{' '}
              <a
                href={`/${locale}/suite/admin/branding`}
                className="font-semibold text-primary-text underline"
              >
                {t('organization.namesMovedLink')}
              </a>
            </span>
          </p>
        </FormSection>

        <FormSection title={t('defaults.title')} description={t('defaults.intro')}>
          {select('currencyCode', t('defaults.currency'), choices.currencies)}
          {select('timeZone', t('defaults.timeZone'), choices.timeZones)}
          {select('fiscalYearStartMonth', t('defaults.fiscalYear'), choices.months, {
            hint: t('defaults.fiscalYearHint'),
          })}
          <div className="flex min-w-0 flex-col gap-1.5">
            <Segmented
              name="defaultLocale"
              legend={t('defaults.language')}
              value={values.defaultLocale}
              disabled={disabled}
              describedBy="org-language-hint"
              testIdPrefix="org-language"
              options={[
                { value: 'en', label: 'English', lang: 'en' },
                { value: 'ar', label: 'العربية', lang: 'ar' },
              ]}
              onChange={(language) => {
                set('defaultLocale', language);
              }}
            />
            <p id="org-language-hint" className="m-0 text-[13.5px] text-text-muted">
              {t('defaults.languageHint')}
            </p>
          </div>
        </FormSection>

        <FormSection
          title={t('calendar.title')}
          description={
            <>
              {t('calendar.intro')}
              {help(null, t('calendar.branchesNote'))}
            </>
          }
        >
          <div className="flex min-w-0 flex-col gap-2.5 md:col-span-2">
            <Segmented
              name="dateDisplay"
              legend={t('calendar.dateDisplay')}
              legendExtra={suggested('dateDisplay')}
              value={values.dateDisplay}
              disabled={disabled}
              describedBy="org-date-preview"
              testIdPrefix="org-display"
              options={(['gregorian', 'hijri', 'dual'] as const).map((display) => ({
                value: display,
                label: t(`calendar.displays.${display}`),
              }))}
              onChange={(display) => {
                set('dateDisplay', display);
              }}
            />
            <p
              id="org-date-preview"
              className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-surface-sunken px-3.5 py-2.5 text-sm text-text-muted"
              aria-live="polite"
              data-testid="org-date-preview"
            >
              <Icon name="calendar" />
              <span>{t('calendar.preview')} ·</span>
              <span className="font-semibold text-text">{preview}</span>
            </p>
          </div>
          <fieldset
            className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0 md:col-span-2"
            aria-describedby={`org-days-hint${fieldErrors.workingDays ? ' org-workingDays-error' : ''}`}
          >
            <legend className="mb-1.5 flex flex-wrap items-center gap-1 p-0 text-sm font-semibold">
              {t('calendar.workingDays')}
              {suggested('workingDays')}
            </legend>
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
                    className={cn(
                      'min-h-11 min-w-14 rounded-md border-[1.5px] px-2 text-sm font-semibold disabled:cursor-not-allowed',
                      on
                        ? 'border-transparent bg-brand-gradient text-on-brand'
                        : fieldErrors.workingDays
                          ? 'border-danger bg-surface text-text'
                          : 'border-border-strong bg-surface text-text',
                    )}
                    data-testid={`org-day-${String(day.value)}`}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
            {fieldErrors.workingDays ? (
              <FieldError id="org-workingDays-error">{errorOf('workingDays')}</FieldError>
            ) : null}
            <p id="org-days-hint" className="m-0 text-[13.5px] text-text-muted">
              {t('calendar.workingDaysHint')}
            </p>
          </fieldset>
          {(['workStartsAt', 'workEndsAt'] as const).map((field) => (
            <SelectField
              key={field}
              id={`org-${field}`}
              name={field}
              dir="ltr"
              label={t(field === 'workStartsAt' ? 'calendar.hoursStart' : 'calendar.hoursEnd')}
              hint={t('calendar.hoursHint')}
              error={errorOf(field)}
              value={values[field]}
              onChange={(event) => {
                set(field, event.target.value);
              }}
              disabled={disabled}
              data-testid={`org-${field}`}
            >
              {hours.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </SelectField>
          ))}
        </FormSection>

        <p className="m-0 flex gap-2 px-1 text-sm text-text-muted" data-testid="org-not-collected">
          <Icon name="info" className="mt-0.5" />
          <span>
            <strong className="font-semibold text-text">{t('notes.notCollectedTitle')}.</strong>{' '}
            {t('notes.notCollectedBody')}
          </span>
        </p>
      </form>

      {/* Polite status: suggestions filled in after a country change (kept rendered, text changes). */}
      <p className="sr-only" role="status" data-testid="org-preset-note">
        {presetUndo?.note ?? ''}
      </p>
      {editable ? (
        <SaveBar
          state={barState}
          form={FORM_ID}
          texts={{
            unsaved: common.unsavedChanges,
            saving: t('saving'),
            saved: <span data-testid="organization-last-changed">{props.lastChanged}</span>,
            save: t('save'),
            cancel: t('cancel'),
            invalid: common.invalid,
          }}
          fix={
            firstInvalid
              ? {
                  label: fillText(common.goToField, { field: fieldLabel(firstInvalid, t) }),
                  onClick: () => {
                    setFocusField({ field: firstInvalid });
                  },
                }
              : undefined
          }
        />
      ) : null}
      <LeaveGuard active={dirty && !pending} texts={common} />
    </>
  );
}

/** The element that takes the focus for a field (the first day button for the working week). */
function fieldElementId(field: ProfileField): string {
  if (field === 'workingDays') return 'org-day-0';
  if (field === 'defaultLocale') return 'org-language-en';
  if (field === 'dateDisplay') return 'org-display-gregorian';
  return `org-${field}`;
}

/** The field's visible label (the save bar's «Go to …»). */
function fieldLabel(field: ProfileField, t: (key: string) => string): string {
  const keys: Record<ProfileField, string> = {
    industry: 'organization.industry',
    countryCode: 'organization.country',
    currencyCode: 'defaults.currency',
    timeZone: 'defaults.timeZone',
    fiscalYearStartMonth: 'defaults.fiscalYear',
    defaultLocale: 'defaults.language',
    dateDisplay: 'calendar.dateDisplay',
    workingDays: 'calendar.workingDays',
    workStartsAt: 'calendar.hoursStart',
    workEndsAt: 'calendar.hoursEnd',
  };
  return t(keys[field]);
}

/**
 * Read only (the Auditor): the values as text in the same sections — no disabled inputs to puzzle over —
 * and who changed them last.
 */
function ReadOnlyProfile(
  props: OrganizationProfileFormProps & {
    readonly values: ProfileFormValues;
    readonly preview: string;
  },
) {
  const { texts, choices, values } = props;
  const t = (key: string) => texts[key] ?? key;
  const labelOf = (options: readonly Choice[], value: string) =>
    options.find((option) => option.value === value)?.label ?? '—';
  const item = (label: string, value: ReactNode, testId: string) => (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm font-semibold">{label}</dt>
      <dd className="m-0 text-text-muted" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
  const days = choices.weekdays
    .filter((day) => values.workingDays.includes(day.value))
    .map((day) => day.long)
    .join(props.locale === 'ar' ? '، ' : ', ');
  return (
    <div className="flex flex-col gap-5" data-testid="organization-profile-form">
      <FormSection title={t('organization.title')} description={t('organization.intro')}>
        <dl className="m-0 contents">
          {item(
            t('organization.industry'),
            labelOf(props.industries, values.industry),
            'org-industry',
          )}
          {item(
            t('organization.country'),
            labelOf(choices.countries, values.countryCode),
            'org-countryCode',
          )}
        </dl>
      </FormSection>
      <FormSection title={t('defaults.title')} description={t('defaults.intro')}>
        <dl className="m-0 contents">
          {item(
            t('defaults.currency'),
            labelOf(choices.currencies, values.currencyCode),
            'org-currencyCode',
          )}
          {item(
            t('defaults.timeZone'),
            labelOf(choices.timeZones, values.timeZone),
            'org-timeZone',
          )}
          {item(
            t('defaults.fiscalYear'),
            labelOf(choices.months, String(values.fiscalYearStartMonth)),
            'org-fiscalYearStartMonth',
          )}
          {item(
            t('defaults.language'),
            <span lang={values.defaultLocale}>
              {values.defaultLocale === 'en' ? 'English' : 'العربية'}
            </span>,
            'org-defaultLocale',
          )}
        </dl>
      </FormSection>
      <FormSection title={t('calendar.title')} description={t('calendar.intro')}>
        <dl className="m-0 contents">
          {item(
            t('calendar.dateDisplay'),
            `${t(`calendar.displays.${values.dateDisplay}`)} · ${props.preview}`,
            'org-dateDisplay',
          )}
          {item(t('calendar.workingDays'), days || '—', 'org-workingDays')}
          {item(
            t('calendar.hoursStart'),
            <span dir="ltr">{values.workStartsAt}</span>,
            'org-workStartsAt',
          )}
          {item(
            t('calendar.hoursEnd'),
            <span dir="ltr">{values.workEndsAt}</span>,
            'org-workEndsAt',
          )}
        </dl>
      </FormSection>
      <p
        className="m-0 flex items-center gap-2 text-sm text-text-muted"
        data-testid="organization-last-changed"
      >
        <Icon name="clock" />
        {props.lastChanged}
      </p>
    </div>
  );
}
