'use client';
import { Alert, Button, Dialog, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { createBranchAction, updateBranchAction } from '../../actions/branches';
import { fillText } from '../../lib/fill-text';
import { branchFieldText } from '../../lib/structure-form';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';
import { type Failure, failureOf } from './failure';
import type { Choice } from './unit-dialog';

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

export interface BranchDialogProps {
  /** null: a new branch. */
  readonly branch: BranchView | null;
  /** Other branches as parent choices. */
  readonly parents: readonly Choice[];
  readonly countries: readonly Choice[];
  readonly timeZones: readonly Choice[];
  /** The organization's time zone (a new branch starts with it). */
  readonly defaultTimeZone: string;
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly locale: 'ar' | 'en';
  readonly onClose: () => void;
}

/**
 * Add or edit a branch (FR-ADM-04 core fields): code, names, parent branch, country, city (English, Arabic),
 * time zone and the headquarters flag (one per organization: choosing it here moves it from the current one).
 */
export function BranchDialog(props: BranchDialogProps) {
  const { branch, texts, locale } = props;
  const text = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string | number>) =>
    fillText(text(key), values, locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Failure>({ fields: {}, message: null });
  const [parentBranchId, setParentBranchId] = useState(branch?.parentBranchId ?? '');
  const [countryCode, setCountryCode] = useState(branch?.countryCode ?? '');
  const [timezone, setTimezone] = useState(branch?.timezone ?? props.defaultTimeZone);
  const [isHeadquarters, setIsHeadquarters] = useState(branch?.isHeadquarters ?? false);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const fields = {
      code: field('code'),
      nameEn: field('nameEn'),
      nameAr: field('nameAr'),
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
        setOpen(false);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setFailure(failureOf(result.error, text, props.errors, branchFieldText));
    });
  }

  return (
    <Dialog
      open={open}
      onClose={props.onClose}
      title={branch ? fill('form.editTitle', { name: branch.name }) : text('form.addTitle')}
      description={text('form.description')}
      closeLabel={text('form.close')}
      size="lg"
      data-testid="branch-dialog"
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
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
            defaultValue={branch?.nameEn ?? ''}
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
            defaultValue={branch?.nameAr ?? ''}
            error={failure.fields.nameAr}
            disabled={pending}
          />
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
        <div className="flex flex-col gap-1">
          <label className="inline-flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={isHeadquarters}
              onChange={(event) => {
                setIsHeadquarters(event.target.checked);
              }}
              disabled={pending}
              aria-describedby="branch-headquarters-hint"
              className="size-5"
              data-testid="branch-headquarters"
            />
            <span className="text-sm font-medium">{text('form.headquarters')}</span>
          </label>
          <p id="branch-headquarters-hint" className="m-0 text-sm text-text-muted">
            {text('form.headquartersHint')}
          </p>
        </div>
        <p className="m-0 text-sm text-text-muted">{text('form.audited')}</p>
        {failure.message ? (
          <Alert tone="danger" data-testid="branch-dialog-message">
            {failure.message}
          </Alert>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
            }}
            disabled={pending}
          >
            {text('form.cancel')}
          </Button>
          <Button type="submit" disabled={pending} data-testid="branch-dialog-submit">
            {pending ? text('form.saving') : branch ? text('form.save') : text('form.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
