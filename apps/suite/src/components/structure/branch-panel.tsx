'use client';
import { Alert, Badge, Button, Icon, SidePanel, TextField, cn, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useMemo, useState, useTransition } from 'react';
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
import { branchFieldText } from '../../lib/structure-form';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';
import { type Failure, failureOf } from './failure';
import type { Choice } from './unit-panel';

/** A branch as the page shows it (names in the page's language, prepared on the server). */
export interface BranchView {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
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

/**
 * Add or edit a branch (FR-ADM-04 core fields) in a side panel, with the list still in view (redesign
 * package 2, PO answer Q2-8, 21 Oct 2026; replaces the dialog): code, names, parent branch, country,
 * city (English, Arabic), time zone and the headquarters flag (one per organization: ticking it here
 * shows «Headquarters moves from … to … when you save»). Cancel / Save and the audit note stay in the
 * panel's footer. WP-HR-01 (design screen 8, approved 24 Oct 2026): the address in both languages, the
 * location typed as latitude / longitude (no map) and the working week — «Same as the organization», or the
 * branch's own days with hours per day (a short day shows as a half-day).
 */
export function BranchPanel(props: BranchPanelProps) {
  const { branch, texts, locale } = props;
  const text = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string | number>) =>
    fillText(text(key), values, locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Failure>({ fields: {}, message: null });
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
      return;
    }
    if (fields.workingDays !== null && !week.every(hoursValid)) {
      setWeekError(text('fieldErrors.hours'));
      return;
    }
    setWeekError(null);
    startTransition(async () => {
      const result = branch
        ? await updateBranchAction({ ...fields, id: branch.id, version: branch.version })
        : await createBranchAction(fields);
      if (result.ok) {
        const name = locale === 'en' ? fields.nameEn.trim() : fields.nameAr.trim();
        toast.success(branch ? text('toasts.saved') : fill('toasts.created', { name }));
        props.onSaved(result.value.id);
        setOpen(false);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setFailure(failureOf(result.error, text, props.errors, branchFieldText));
    });
  }

  return (
    <SidePanel
      open={open}
      onClose={props.onClose}
      title={branch ? fill('form.editTitle', { name: branch.name }) : text('form.addTitle')}
      description={text('form.description')}
      closeLabel={text('form.close')}
      data-testid="branch-dialog"
      footer={
        <>
          <p className="m-0 flex w-full items-center gap-2 text-[13px] text-text-muted">
            <Icon name="shield-outline" />
            {text('form.audited')}
          </p>
          <div className="ms-auto flex gap-2.5">
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
          </div>
        </>
      }
    >
      <form id={FORM_ID} className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <div className="grid grid-cols-1 gap-4">
          <TextField
            id="branch-nameEn"
            name="nameEn"
            label={text('form.nameEn')}
            marker={text('required')}
            required
            dir="ltr"
            lang="en"
            maxLength={200}
            autoComplete="off"
            value={nameEn}
            onChange={(event) => {
              setNameEn(event.target.value);
            }}
            error={failure.fields.nameEn}
            disabled={pending}
          />
          <TextField
            id="branch-nameAr"
            name="nameAr"
            label={text('form.nameAr')}
            marker={text('required')}
            required
            dir="rtl"
            lang="ar"
            maxLength={200}
            autoComplete="off"
            value={nameAr}
            onChange={(event) => {
              setNameAr(event.target.value);
            }}
            error={failure.fields.nameAr}
            disabled={pending}
          />
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
        <div className="grid grid-cols-1 gap-4">
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
          <TextField
            id="branch-cityEn"
            name="cityEn"
            label={text('form.cityEn')}
            marker={text('optional')}
            dir="ltr"
            lang="en"
            maxLength={120}
            autoComplete="off"
            defaultValue={branch?.cityEn ?? ''}
            error={failure.fields.cityEn}
            disabled={pending}
          />
          <TextField
            id="branch-cityAr"
            name="cityAr"
            label={text('form.cityAr')}
            marker={text('optional')}
            dir="rtl"
            lang="ar"
            maxLength={120}
            autoComplete="off"
            defaultValue={branch?.cityAr ?? ''}
            error={failure.fields.cityAr}
            disabled={pending}
          />
        </div>
        {props.detailsAvailable ? (
          <>
            <div className="grid grid-cols-1 gap-4">
              <TextField
                id="branch-addressEn"
                name="addressEn"
                label={text('form.addressEn')}
                marker={text('optional')}
                dir="ltr"
                lang="en"
                maxLength={300}
                autoComplete="off"
                defaultValue={branch?.addressEn ?? ''}
                error={failure.fields.addressEn}
                disabled={pending}
              />
              <TextField
                id="branch-addressAr"
                name="addressAr"
                label={text('form.addressAr')}
                marker={text('optional')}
                dir="rtl"
                lang="ar"
                maxLength={300}
                autoComplete="off"
                defaultValue={branch?.addressAr ?? ''}
                error={failure.fields.addressAr}
                disabled={pending}
              />
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
                        <label className="flex min-w-32 cursor-pointer items-center gap-2.5">
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
                                className="min-h-10 rounded-md border border-border-strong bg-surface px-2 text-sm tabular-nums"
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
        {failure.message ? (
          <Alert tone="danger" data-testid="branch-dialog-message">
            {failure.message}
          </Alert>
        ) : null}
      </form>
    </SidePanel>
  );
}
