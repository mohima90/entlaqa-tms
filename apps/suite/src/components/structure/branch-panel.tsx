'use client';
import { Alert, Badge, Button, Dialog, Icon, TextField, cn, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useCallback, useMemo, useState, useTransition } from 'react';
import { createBranchAction, updateBranchAction } from '../../actions/branches';
import {
  type OrganizationWeekView,
  type WeekDayRow,
  hoursValid,
  isHalfDay,
  weekRows,
  workingDaysOf,
} from '../../lib/branch-week';
import { fillText } from '../../lib/fill-text';
import { clockChoices } from '../../lib/organization-profile-form';
import { branchFieldText, nameOrder } from '../../lib/structure-form';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';
import type { Failure } from './failure';
import { LoadLatestVersion } from '../latest-version';
import { useFailure } from './use-failure';
import type { Choice } from './unit-panel';

/** A branch as the page shows it (names in the page's language, prepared on the server). */
export interface BranchView {
  readonly id: string;
  readonly code: string;
  /** One of the two names may be missing, never both (the default language's name is required). */
  readonly nameAr: string | null;
  readonly nameEn: string | null;
  /** In the page's language, else the name that exists. */
  readonly name: string;
  readonly parentBranchId: string | null;
  readonly countryCode: string | null;
  readonly cityAr: string | null;
  readonly cityEn: string | null;
  /** City and country in the page's language («Riyadh, Saudi Arabia»), or null. */
  readonly location: string | null;
  readonly timezone: string;
  readonly timezoneLabel: string;
  readonly isHeadquarters: boolean;
  /** WP-HR-01: the address, the typed location (decimal degrees) and the branch's own week (null = the
   * organization's). */
  readonly addressEn: string | null;
  readonly addressAr: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly workingDays:
    readonly { readonly day: number; readonly startsAt: string; readonly endsAt: string }[] | null;
  readonly active: boolean;
  readonly version: number;
  readonly childCount: number;
  readonly unitCount: number;
  readonly peopleCount: number;
}

export interface BranchPanelProps {
  /** null: a new branch. */
  readonly branch: BranchView | null;
  /** Other branches as parent choices. */
  readonly parents: readonly Choice[];
  readonly countries: readonly Choice[];
  readonly timeZones: readonly Choice[];
  /** The organization's time zone (a new branch starts with it). */
  readonly defaultTimeZone: string;
  /**
   * The organization's default language: its name is required and asked first; the other language's name
   * is optional (PO, 12 Nov 2026).
   */
  readonly nameLanguage: 'ar' | 'en';
  /** The current headquarters' name, when another branch is it (the «moves» note). */
  readonly headquartersName: string | null;
  /** The organization's week (what «Same as the organization» means), or null without a profile. */
  readonly organizationWeek: OrganizationWeekView | null;
  /** Sunday … Saturday in the page's language. */
  readonly weekdays: readonly {
    readonly value: number;
    readonly short: string;
    readonly long: string;
  }[];
  /** Address, location and own week exist in the database (hidden before the WP-HR-01 migration). */
  readonly detailsAvailable: boolean;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly locale: 'ar' | 'en';
  readonly onClose: () => void;
  /** After a save: the branch's id (its row is highlighted). */
  readonly onSaved: (id: string) => void;
}

const FORM_ID = 'branch-form';

/** The fields behind «More», in the order they appear, with the element that shows each one's refusal. */
const MORE_FIELD_IDS = {
  parentBranchId: 'branch-parent',
  countryCode: 'branch-country',
  cityEn: 'branch-cityEn',
  cityAr: 'branch-cityAr',
  addressEn: 'branch-addressEn',
  addressAr: 'branch-addressAr',
  latitude: 'branch-latitude',
  longitude: 'branch-longitude',
  workingDays: 'branch-week-same',
} as const;
const MORE_FIELDS = Object.keys(MORE_FIELD_IDS) as (keyof typeof MORE_FIELD_IDS)[];

/**
 * Add or edit a branch (FR-ADM-04) in one centred popup (672 px; forms standard rule 9 — the Kawadir pattern,
 * PO 12 Nov 2026; before: a side panel). The popup asks what a branch needs now: its names (the
 * organization's default language first and required, the other one optional), its code and its time zone.
 * Everything else waits behind «More» in the same popup — the parent branch, country and city, the address
 * in both languages, the location typed as latitude / longitude (no map), the working week («Same as the
 * organization», or the branch's own days with hours per day; a short day shows as a half-day — WP-HR-01,
 * design screen 8) and the headquarters flag (one per organization: ticking it shows «Headquarters moves
 * from … to … when you save»). «More» starts open when editing; a field refused under it opens it.
 */
export function BranchPanel(props: BranchPanelProps) {
  const { branch, texts, locale } = props;
  const text = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string | number>) =>
    fillText(text(key), values, locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const { formFailure } = useFailure();
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Failure>({ fields: {}, message: null });
  // Escape, ✕ and the backdrop wait while the branch is being saved.
  const canClose = useCallback(() => !pending, [pending]);
  // «More» starts closed for a new branch (the popup asks the few fields needed now) and open when editing
  // (nothing a branch already has is hidden).
  const [more, setMore] = useState(branch !== null);
  const [nameEn, setNameEn] = useState(branch?.nameEn ?? '');
  const [nameAr, setNameAr] = useState(branch?.nameAr ?? '');
  const [parentBranchId, setParentBranchId] = useState(branch?.parentBranchId ?? '');
  const [countryCode, setCountryCode] = useState(branch?.countryCode ?? '');
  const [timezone, setTimezone] = useState(branch?.timezone ?? props.defaultTimeZone);
  const [isHeadquarters, setIsHeadquarters] = useState(branch?.isHeadquarters ?? false);
  const [ownWeek, setOwnWeek] = useState(branch?.workingDays != null);
  const [week, setWeek] = useState<WeekDayRow[]>(() =>
    weekRows(branch?.workingDays ?? null, props.organizationWeek),
  );
  const [weekError, setWeekError] = useState<string | null>(null);
  const hours = useMemo(
    () => clockChoices(week.flatMap((row) => [row.startsAt, row.endsAt])),
    [week],
  );
  const setDay = (day: number, change: Partial<WeekDayRow>) => {
    setWeek((rows) => rows.map((row) => (row.day === day ? { ...row, ...change } : row)));
  };
  const typedName = (locale === 'en' ? nameEn || nameAr : nameAr || nameEn).trim();
  const movesFrom =
    isHeadquarters && !branch?.isHeadquarters && props.headquartersName
      ? props.headquartersName
      : null;

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const fields = {
      code: field('code'),
      nameEn,
      nameAr,
      parentBranchId,
      countryCode,
      cityEn: field('cityEn'),
      cityAr: field('cityAr'),
      timezone,
      isHeadquarters,
      addressEn: field('addressEn'),
      addressAr: field('addressAr'),
      latitude: field('latitude').trim(),
      longitude: field('longitude').trim(),
      workingDays: ownWeek && props.detailsAvailable ? workingDaysOf(week) : null,
    };
    setFailure({ fields: {}, message: null });
    // The week is checked here first (the action and the database repeat it).
    if (fields.workingDays !== null && fields.workingDays.length === 0) {
      setWeekError(text('form.weekEmpty'));
      setMore(true);
      return;
    }
    if (fields.workingDays !== null && !week.every(hoursValid)) {
      setWeekError(text('fieldErrors.hours'));
      setMore(true);
      return;
    }
    setWeekError(null);
    startTransition(async () => {
      const result = branch
        ? await updateBranchAction({ ...fields, id: branch.id, version: branch.version })
        : await createBranchAction(fields);
      if (result.ok) {
        // In the page's language, else the name that was given.
        const name = (
          locale === 'en'
            ? fields.nameEn.trim() || fields.nameAr
            : fields.nameAr.trim() || fields.nameEn
        ).trim();
        toast.success(branch ? text('toasts.saved') : fill('toasts.created', { name }));
        props.onSaved(result.value.id);
        setOpen(false);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      const next = formFailure(result.error, text, props.errors, branchFieldText);
      setFailure(next);
      // A refused field under «More» is shown, not hidden: open it and move to the field.
      const hidden = MORE_FIELDS.find((name) => next.fields[name] !== undefined);
      if (hidden) {
        setMore(true);
        requestAnimationFrame(() => document.getElementById(MORE_FIELD_IDS[hidden])?.focus());
      }
    });
  }

  const nameField = (language: 'ar' | 'en') => {
    const key = language === 'ar' ? 'nameAr' : 'nameEn';
    const required = language === props.nameLanguage;
    return (
      <TextField
        key={key}
        id={`branch-${key}`}
        name={key}
        label={text(`form.${key}`)}
        marker={text(required ? 'required' : 'optional')}
        required={required}
        dir={language === 'ar' ? 'rtl' : 'ltr'}
        lang={language}
        maxLength={200}
        autoComplete="off"
        value={language === 'ar' ? nameAr : nameEn}
        onChange={(event) => {
          (language === 'ar' ? setNameAr : setNameEn)(event.target.value);
        }}
        error={failure.fields[key]}
        disabled={pending}
      />
    );
  };

  return (
    <Dialog
      open={open}
      onClose={props.onClose}
      canClose={canClose}
      size="rich"
      title={branch ? fill('form.editTitle', { name: branch.name }) : text('form.addTitle')}
      description={text('form.description')}
      closeLabel={text('form.close')}
      data-testid="branch-dialog"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
            }}
            disabled={pending}
          >
            {text('form.cancel')}
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            disabled={pending}
            aria-busy={pending || undefined}
            data-testid="branch-dialog-submit"
          >
            {pending ? text('form.saving') : branch ? text('form.save') : text('form.create')}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {/* The two names side by side on a desktop (a natural pair), one per row on phones: the
            organization's default language first (required), then the other one (optional). */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {nameOrder(props.nameLanguage).map(nameField)}
        </div>
        <TextField
          id="branch-code"
          name="code"
          label={text('form.code')}
          marker={text('required')}
          hint={text('form.codeHint')}
          required
          dir="ltr"
          maxLength={32}
          autoComplete="off"
          defaultValue={branch?.code ?? ''}
          error={failure.fields.code}
          disabled={pending}
        />
        <SelectField
          id="branch-timezone"
          label={text('form.timezone')}
          marker={text('required')}
          value={timezone}
          onChange={(event) => {
            setTimezone(event.target.value);
          }}
          error={failure.fields.timezone}
          disabled={pending}
          required
        >
          {props.timeZones.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </SelectField>
        {/* Everything optional waits behind «More» (forms standard rule 9): the parent branch, where the
            branch is, its own working week and the headquarters flag. Hidden, never unmounted: what was
            typed there is still sent. */}
        <button
          type="button"
          className="flex min-h-10 flex-wrap items-center gap-1.5 self-start rounded-full px-2 text-start text-sm font-semibold text-primary-text hover:bg-primary-subtle pointer-coarse:min-h-11"
          aria-expanded={more}
          aria-controls="branch-more"
          onClick={() => {
            setMore((current) => !current);
          }}
          data-testid="branch-more"
        >
          <Icon name={more ? 'chevron-down' : 'chevron-end'} />
          {text('form.more')}
          <span className="font-normal text-text-muted">
            {' · '}
            {text('form.moreSummary')}
          </span>
        </button>
        <div id="branch-more" className={more ? 'flex flex-col gap-4' : 'hidden'}>
          <SelectField
            id="branch-parent"
            label={text('form.parent')}
            marker={text('optional')}
            value={parentBranchId}
            onChange={(event) => {
              setParentBranchId(event.target.value);
            }}
            error={failure.fields.parentBranchId}
            disabled={pending}
          >
            <option value="">{text('form.noParent')}</option>
            {props.parents.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="branch-country"
            label={text('form.country')}
            marker={text('optional')}
            value={countryCode}
            onChange={(event) => {
              setCountryCode(event.target.value);
            }}
            error={failure.fields.countryCode}
            disabled={pending}
          >
            <option value="">{text('form.noCountry')}</option>
            {props.countries.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {nameOrder(props.nameLanguage).map((language) => {
              const key = language === 'ar' ? 'cityAr' : 'cityEn';
              return (
                <TextField
                  key={key}
                  id={`branch-${key}`}
                  name={key}
                  label={text(`form.${key}`)}
                  marker={text('optional')}
                  dir={language === 'ar' ? 'rtl' : 'ltr'}
                  lang={language}
                  maxLength={120}
                  autoComplete="off"
                  defaultValue={(language === 'ar' ? branch?.cityAr : branch?.cityEn) ?? ''}
                  error={failure.fields[key]}
                  disabled={pending}
                />
              );
            })}
          </div>
          {props.detailsAvailable ? (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {nameOrder(props.nameLanguage).map((language) => {
                  const key = language === 'ar' ? 'addressAr' : 'addressEn';
                  return (
                    <TextField
                      key={key}
                      id={`branch-${key}`}
                      name={key}
                      label={text(`form.${key}`)}
                      marker={text('optional')}
                      dir={language === 'ar' ? 'rtl' : 'ltr'}
                      lang={language}
                      maxLength={300}
                      autoComplete="off"
                      defaultValue={
                        (language === 'ar' ? branch?.addressAr : branch?.addressEn) ?? ''
                      }
                      error={failure.fields[key]}
                      disabled={pending}
                    />
                  );
                })}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TextField
                  id="branch-latitude"
                  name="latitude"
                  label={text('form.latitude')}
                  marker={text('optional')}
                  hint={text('form.latitudeHint')}
                  dir="ltr"
                  inputMode="decimal"
                  maxLength={12}
                  autoComplete="off"
                  defaultValue={branch?.latitude?.toString() ?? ''}
                  error={failure.fields.latitude}
                  disabled={pending}
                />
                <TextField
                  id="branch-longitude"
                  name="longitude"
                  label={text('form.longitude')}
                  marker={text('optional')}
                  hint={text('form.longitudeHint')}
                  dir="ltr"
                  inputMode="decimal"
                  maxLength={12}
                  autoComplete="off"
                  defaultValue={branch?.longitude?.toString() ?? ''}
                  error={failure.fields.longitude}
                  disabled={pending}
                />
              </div>
              <fieldset
                className="m-0 flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4"
                data-testid="branch-week"
              >
                <legend className="px-1 text-sm font-semibold">{text('form.week')}</legend>
                <div className="flex items-start gap-3">
                  <input
                    id="branch-week-same"
                    type="checkbox"
                    aria-describedby="branch-week-same-hint"
                    checked={!ownWeek}
                    onChange={(event) => {
                      setOwnWeek(!event.target.checked);
                      setWeekError(null);
                    }}
                    disabled={pending}
                    className="mt-0.5 size-5 shrink-0 accent-primary"
                    data-testid="branch-week-same"
                  />
                  <span className="flex flex-col gap-0.5">
                    <label htmlFor="branch-week-same" className="cursor-pointer font-semibold">
                      {text('form.weekSame')}
                    </label>
                    <span id="branch-week-same-hint" className="text-sm text-text-muted">
                      {text('form.weekSameHint')}
                    </span>
                  </span>
                </div>
                {ownWeek ? (
                  // eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari/VoiceOver drops the list semantics of a `list-none` list.
                  <ul role="list" className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {week.map((row) => {
                      const day = props.weekdays.find((d) => d.value === row.day);
                      const bad = !hoursValid(row);
                      return (
                        <li
                          key={row.day}
                          className={cn(
                            'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md px-2 py-1.5',
                            bad && 'bg-danger-subtle',
                          )}
                          data-testid={`branch-day-${String(row.day)}`}
                        >
                          <label className="flex min-h-11 min-w-32 cursor-pointer items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={row.works}
                              onChange={(event) => {
                                setDay(row.day, { works: event.target.checked });
                              }}
                              disabled={pending}
                              className="size-5 accent-primary"
                              data-testid={`branch-day-${String(row.day)}-works`}
                            />
                            <span className="font-medium">{day?.long ?? row.day}</span>
                          </label>
                          {row.works ? (
                            <span className="flex items-center gap-2" dir="ltr">
                              {(['startsAt', 'endsAt'] as const).map((key) => (
                                <select
                                  key={key}
                                  aria-label={fill(
                                    key === 'startsAt' ? 'form.dayStart' : 'form.dayEnd',
                                    {
                                      day: day?.long ?? '',
                                    },
                                  )}
                                  value={row[key]}
                                  onChange={(event) => {
                                    setDay(row.day, { [key]: event.target.value });
                                  }}
                                  disabled={pending}
                                  aria-invalid={bad || undefined}
                                  className="min-h-10 rounded-md border border-border-strong bg-surface px-2 text-sm tabular-nums pointer-coarse:min-h-11"
                                  data-testid={`branch-day-${String(row.day)}-${key}`}
                                >
                                  {hours.map((time) => (
                                    <option key={time} value={time}>
                                      {time}
                                    </option>
                                  ))}
                                </select>
                              ))}
                            </span>
                          ) : (
                            <span className="text-sm text-text-muted">{text('form.dayOff')}</span>
                          )}
                          {isHalfDay(row, props.organizationWeek) ? (
                            <Badge tone="info" data-testid={`branch-day-${String(row.day)}-half`}>
                              {text('form.halfDay')}
                            </Badge>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {weekError || failure.fields.workingDays ? (
                  <Alert tone="danger" role="none" data-testid="branch-week-error">
                    {weekError ?? failure.fields.workingDays}
                  </Alert>
                ) : null}
              </fieldset>
            </>
          ) : null}

          <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-sunken p-4">
            <input
              id="branch-headquarters"
              type="checkbox"
              checked={isHeadquarters}
              onChange={(event) => {
                setIsHeadquarters(event.target.checked);
              }}
              disabled={pending}
              aria-describedby="branch-headquarters-hint"
              className="mt-0.5 size-5 shrink-0 accent-primary"
              data-testid="branch-headquarters"
            />
            <span className="flex flex-col gap-0.5">
              <label htmlFor="branch-headquarters" className="cursor-pointer font-semibold">
                {text('form.headquarters')}
              </label>
              <span id="branch-headquarters-hint" className="text-sm text-text-muted">
                {text('form.headquartersHint')}
              </span>
            </span>
          </div>
          {/* Polite: the consequence appears as the box is ticked. */}
          <div aria-live="polite">
            {movesFrom ? (
              <Alert tone="warning" role="none" data-testid="branch-hq-moves">
                {fill('form.hqMoves', {
                  from: movesFrom,
                  to: typedName || text('form.addTitle'),
                })}
              </Alert>
            ) : null}
          </div>
        </div>
        {failure.message ? (
          <Alert tone="danger" data-testid="branch-dialog-message">
            {failure.message}
            <LoadLatestVersion message={failure.message} />
          </Alert>
        ) : null}
        <p className="m-0 flex items-start gap-2 text-[13px] text-text-muted">
          <Icon name="shield-outline" className="mt-0.5 shrink-0" />
          {text('form.audited')}
        </p>
      </form>
    </Dialog>
  );
}
