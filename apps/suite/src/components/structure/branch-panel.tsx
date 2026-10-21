'use client';
import { Alert, Button, Icon, SidePanel, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { createBranchAction, updateBranchAction } from '../../actions/branches';
import { fillText } from '../../lib/fill-text';
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
 * panel's footer.
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
    };
    setFailure({ fields: {}, message: null });
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
