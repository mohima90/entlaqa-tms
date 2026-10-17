'use client';
import { Alert, Button, Dialog, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { createStructureUnitAction, updateStructureUnitAction } from '../../actions/structure';
import { fillText } from '../../lib/fill-text';
import { unitFieldText } from '../../lib/structure-form';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';
import { type Failure, failureOf } from './failure';

/** A unit of the tree as the page shows it (names in the page's language, prepared on the server). */
export interface UnitView {
  readonly id: string;
  readonly parentId: string | null;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  /** In the page's language (Arabic when no English name was given). */
  readonly name: string;
  readonly levelName: string;
  /** The level below (what «Add <next level>» adds), or null at the last level. */
  readonly nextLevelName: string | null;
  readonly branchId: string | null;
  readonly headPersonId: string | null;
  readonly headName: string | null;
  readonly active: boolean;
  readonly version: number;
  readonly childCount: number;
  /** «3 units under it» (formatted on the server), or null without children. */
  readonly childCountLabel: string | null;
  readonly peopleCount: number;
  readonly roleScopeCount: number;
}

export interface Choice {
  readonly value: string;
  readonly label: string;
}

export type UnitDialogMode =
  | { readonly kind: 'create'; readonly parent: UnitView | null; readonly levelName: string }
  | { readonly kind: 'edit'; readonly unit: UnitView };

export interface UnitDialogProps {
  readonly mode: UnitDialogMode;
  readonly branches: readonly Choice[];
  readonly people: readonly Choice[];
  /** Texts of the `structure` namespace (raw, flattened) plus `required` / `optional`. */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly locale: 'ar' | 'en';
  readonly onClose: () => void;
}

/**
 * Add or edit a unit (Kawadir's department dialog; FR-ADM-05, EP-ORG): names in English and Arabic, code,
 * branch and head (any active person). Its level follows from where it sits: at the top, or one level
 * below its parent (the database decides and refuses a unit below the last level).
 */
export function UnitDialog({
  mode,
  branches,
  people,
  texts,
  errors,
  locale,
  onClose,
}: UnitDialogProps) {
  const text = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string | number>) =>
    fillText(text(key), values, locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Failure>({ fields: {}, message: null });
  // Closing goes through the native dialog (focus returns to the menu button that opened it).
  const [open, setOpen] = useState(true);
  const unit = mode.kind === 'edit' ? mode.unit : null;
  const [branchId, setBranchId] = useState(unit?.branchId ?? '');
  const [headPersonId, setHeadPersonId] = useState(unit?.headPersonId ?? '');
  // A current branch or head that is no longer offered (e.g. a person who left) stays selectable.
  const branchChoices =
    unit?.branchId && !branches.some((b) => b.value === unit.branchId)
      ? [{ value: unit.branchId, label: unit.branchId }, ...branches]
      : branches;
  const peopleChoices =
    unit?.headPersonId && !people.some((p) => p.value === unit.headPersonId)
      ? [{ value: unit.headPersonId, label: unit.headName ?? unit.headPersonId }, ...people]
      : people;

  const title =
    mode.kind === 'create'
      ? fill('form.addTitle', { level: mode.levelName })
      : fill('form.editTitle', { name: mode.unit.name });
  const description =
    mode.kind === 'edit'
      ? text('form.editDescription')
      : mode.parent
        ? fill('form.underDescription', { level: mode.levelName, parent: mode.parent.name })
        : text('form.topDescription');

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
      branchId,
      headPersonId,
    };
    setFailure({ fields: {}, message: null });
    startTransition(async () => {
      const result =
        mode.kind === 'create'
          ? await createStructureUnitAction({ ...fields, parentId: mode.parent?.id ?? '' })
          : await updateStructureUnitAction({
              ...fields,
              id: mode.unit.id,
              version: mode.unit.version,
            });
      if (result.ok) {
        const name = locale === 'en' ? fields.nameEn.trim() : fields.nameAr.trim();
        toast.success(
          mode.kind === 'create' ? fill('toasts.created', { name }) : text('toasts.saved'),
        );
        setOpen(false);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      setFailure(failureOf(result.error, text, errors, unitFieldText));
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      closeLabel={text('form.close')}
      size="lg"
      data-testid="unit-dialog"
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            id="unit-nameEn"
            name="nameEn"
            label={text('form.nameEn')}
            marker={text('required')}
            required
            dir="ltr"
            lang="en"
            maxLength={200}
            autoComplete="off"
            defaultValue={unit?.nameEn ?? ''}
            error={failure.fields.nameEn}
            disabled={pending}
          />
          <TextField
            id="unit-nameAr"
            name="nameAr"
            label={text('form.nameAr')}
            marker={text('required')}
            required
            dir="rtl"
            lang="ar"
            maxLength={200}
            autoComplete="off"
            defaultValue={unit?.nameAr ?? ''}
            error={failure.fields.nameAr}
            disabled={pending}
          />
          <TextField
            id="unit-code"
            name="code"
            label={text('form.code')}
            marker={text('required')}
            hint={text('form.codeHint')}
            required
            dir="ltr"
            maxLength={32}
            autoComplete="off"
            defaultValue={unit?.code ?? ''}
            error={failure.fields.code}
            disabled={pending}
          />
          <SelectField
            id="unit-branch"
            label={text('form.branch')}
            marker={text('optional')}
            value={branchId}
            onChange={(event) => {
              setBranchId(event.target.value);
            }}
            error={failure.fields.branchId}
            disabled={pending}
          >
            <option value="">{text('form.noBranch')}</option>
            {branchChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </SelectField>
          <div className="sm:col-span-2">
            <SelectField
              id="unit-head"
              label={text('form.head')}
              marker={text('optional')}
              hint={text('form.headHint')}
              value={headPersonId}
              onChange={(event) => {
                setHeadPersonId(event.target.value);
              }}
              error={failure.fields.headPersonId}
              disabled={pending}
            >
              <option value="">{text('form.noHead')}</option>
              {peopleChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </SelectField>
          </div>
        </div>
        <p className="m-0 text-sm text-text-muted">{text('form.audited')}</p>
        {failure.message ? (
          <Alert tone="danger" data-testid="unit-dialog-message">
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
          <Button type="submit" disabled={pending} data-testid="unit-dialog-submit">
            {pending
              ? text('form.saving')
              : mode.kind === 'create'
                ? text('form.create')
                : text('form.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
