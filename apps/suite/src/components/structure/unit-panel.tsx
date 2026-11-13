'use client';
import { Alert, Button, Dialog, Icon, TextField, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useCallback, useState, useTransition } from 'react';
import { createStructureUnitAction, updateStructureUnitAction } from '../../actions/structure';
import { fillText } from '../../lib/fill-text';
import { nameOrder, unitFieldText } from '../../lib/structure-form';
import { fallbackUnitCode, suggestUnitCode, unitDeleteBlockers } from '../../lib/structure-view';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { SelectField } from '../select-field';
import type { Failure } from './failure';
import { LoadLatestVersion } from '../latest-version';
import { useFailure } from './use-failure';

/** A unit of the tree as the page shows it (names in the page's language, prepared on the server). */
export interface UnitView {
  readonly id: string;
  readonly parentId: string | null;
  readonly code: string;
  /** One of the two names may be missing, never both (the default language's name is required). */
  readonly nameAr: string | null;
  readonly nameEn: string | null;
  /** In the page's language, else the name that exists. */
  readonly name: string;
  readonly levelName: string;
  /** The level below (what «Add <next level>» adds), or null at the last level. */
  readonly nextLevelName: string | null;
  readonly branchId: string | null;
  readonly headPersonId: string | null;
  readonly headName: string | null;
  /** The cost centre people placed in the unit get when HR picks none (WP-HR-01). */
  readonly defaultCostCentreId: string | null;
  /** The unit's level (= its depth; moves keep it, WP-HR-01), its order among its siblings. */
  readonly levelOrdinal: number | null;
  readonly sortOrder: number;
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

/** What the person wants next, once a unit was added (Kawadir: «enter a department, then the next level»). */
export type UnitFollowUp =
  | { readonly kind: 'child'; readonly parentId: string; readonly levelName: string }
  | { readonly kind: 'sibling' };

export interface UnitPanelProps {
  readonly mode: UnitDialogMode;
  readonly branches: readonly Choice[];
  readonly people: readonly Choice[];
  /** Active cost centres as default choices (WP-HR-01); none hides the field. */
  readonly costCentres: readonly Choice[];
  /** Every unit's code, so the suggested code is free before it is sent. */
  readonly existingCodes: readonly string[];
  /** The organization's level names from the top down (the level under the one being added). */
  readonly levelNames: readonly string[];
  /** Texts of the `structure` namespace (raw, flattened) plus `required` / `optional`. */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly locale: 'ar' | 'en';
  /**
   * The organization's default language: its name is required and asked first; the other language's name
   * is optional (PO, 12 Nov 2026).
   */
  readonly nameLanguage: 'ar' | 'en';
  readonly onClose: () => void;
  /** After adding: the next step the person chose (the tree opens the next popup). */
  readonly onFollowUp?: ((next: UnitFollowUp) => void) | undefined;
  /** Edit: deactivate or activate the unit (the tree runs it, with Undo or its confirmation). */
  readonly onStatus?: ((unit: UnitView) => void) | undefined;
  /** Edit: delete the unit (the tree's red confirmation). */
  readonly onDelete?: ((unit: UnitView) => void) | undefined;
}

const FORM_ID = 'unit-form';

/**
 * Add or edit a unit (FR-ADM-05, EP-ORG) in one centred popup (448 px; forms standard rule 9 — the Kawadir
 * pattern, PO 12 Nov 2026; before: a side panel). Adding asks for the names only, one field per row: the
 * name in the organization's default language first and required, the other language optional; the code is
 * suggested from the English name (a neutral one for a unit named in Arabic only) and the branch is the
 * parent's; code, branch, head and default cost centre wait under «More options». Once added, the popup
 * offers the next step — a unit of the level below, another of the same level — or closes. Its level
 * follows from where it sits: at the top, or one level below its parent (the database decides and refuses
 * a unit below the last level). Editing shows every field, plus Deactivate and Delete with their
 * consequences — Delete with what still depends on the unit, and only offered when nothing does.
 */
export function UnitPanel({
  mode,
  branches,
  people,
  costCentres,
  existingCodes,
  levelNames,
  texts,
  errors,
  locale,
  nameLanguage,
  onClose,
  onFollowUp,
  onStatus,
  onDelete,
}: UnitPanelProps) {
  const text = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string | number>) =>
    fillText(text(key), values, locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const { formFailure } = useFailure();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Failure>({ fields: {}, message: null });
  // Closing goes through the native dialog (focus returns to the button that opened it).
  const [open, setOpen] = useState(true);
  // Escape, ✕ and the backdrop wait while the unit is being saved.
  const canClose = useCallback(() => !pending, [pending]);
  const [after, setAfter] = useState<(() => void) | null>(null);
  const unit = mode.kind === 'edit' ? mode.unit : null;
  const parent = mode.kind === 'create' ? mode.parent : null;
  // A new unit sits in its parent's branch unless changed (role-play feedback #6).
  const [branchId, setBranchId] = useState(unit?.branchId ?? parent?.branchId ?? '');
  const [headPersonId, setHeadPersonId] = useState(unit?.headPersonId ?? '');
  const [defaultCostCentreId, setDefaultCostCentreId] = useState(unit?.defaultCostCentreId ?? '');
  // The code follows the English name until the person types one themselves (then it is theirs); a unit
  // named in Arabic only gets a neutral code («UNIT», «UNIT-2»…).
  const [code, setCode] = useState(unit?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(mode.kind === 'edit');
  const suggestedCode = (nameEn: string, nameAr: string) =>
    suggestUnitCode(nameEn, existingCodes) ||
    (nameAr.trim() === '' ? '' : fallbackUnitCode(existingCodes));
  // «More options» starts closed when adding; a refused field inside opens it.
  const [more, setMore] = useState(mode.kind === 'edit');
  // Added: the name and id of the new unit; the panel then offers the next step.
  const [added, setAdded] = useState<{ readonly id: string; readonly name: string } | null>(null);
  const levelIndex = mode.kind === 'create' ? levelNames.indexOf(mode.levelName) : -1;
  const nextLevelName = levelIndex >= 0 ? (levelNames[levelIndex + 1] ?? null) : null;

  // A default that was deactivated since stays shown (it stays on the unit until changed).
  const costCentreChoices =
    unit?.defaultCostCentreId && !costCentres.some((c) => c.value === unit.defaultCostCentreId)
      ? [
          { value: unit.defaultCostCentreId, label: text('form.inactiveCostCentre') },
          ...costCentres,
        ]
      : costCentres;
  // A current branch or head that is no longer offered (e.g. a person who left) stays selectable.
  const branchChoices =
    unit?.branchId && !branches.some((b) => b.value === unit.branchId)
      ? [{ value: unit.branchId, label: unit.branchId }, ...branches]
      : branches;
  const peopleChoices =
    unit?.headPersonId && !people.some((p) => p.value === unit.headPersonId)
      ? [{ value: unit.headPersonId, label: unit.headName ?? unit.headPersonId }, ...people]
      : people;
  const parentBranch = parent?.branchId
    ? (branches.find((b) => b.value === parent.branchId)?.label ?? null)
    : null;

  const title =
    mode.kind === 'create'
      ? fill('form.addTitle', { level: mode.levelName })
      : fill('form.editTitle', { name: mode.unit.name });
  const description =
    mode.kind === 'edit'
      ? text('form.editDescription')
      : parent
        ? fill('form.underDescription', { level: mode.levelName, parent: parent.name })
        : text('form.topDescription');

  /** Closes the panel, then runs a follow-up (a confirmation must not open under the modal panel). */
  function closeThen(next: () => void) {
    setAfter(() => next);
    setOpen(false);
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const nameEn = field('nameEn');
    const nameAr = field('nameAr');
    const fields = {
      code: codeTouched ? code : suggestedCode(nameEn, nameAr),
      nameEn,
      nameAr,
      branchId,
      headPersonId,
      defaultCostCentreId,
    };
    setFailure({ fields: {}, message: null });
    startTransition(async () => {
      const result =
        mode.kind === 'create'
          ? await createStructureUnitAction({ ...fields, parentId: parent?.id ?? '' })
          : await updateStructureUnitAction({
              ...fields,
              id: mode.unit.id,
              version: mode.unit.version,
            });
      if (result.ok) {
        // In the page's language, else the name that was given.
        const name = (
          locale === 'en'
            ? fields.nameEn.trim() || fields.nameAr
            : fields.nameAr.trim() || fields.nameEn
        ).trim();
        router.refresh();
        // The new head and the Department Head role (WP-FIX-03, «either door does both»): said at once.
        const headRole = result.value.headRole ?? null;
        if (headRole && headRole.kind !== 'already') {
          const head = peopleChoices.find((p) => p.value === headRole.personId)?.label ?? '';
          const key = {
            given: 'toasts.headRole.given',
            kept: 'toasts.headRole.kept',
            not_allowed: 'toasts.headRole.notAllowed',
            no_account: 'toasts.headRole.noAccount',
          }[headRole.kind];
          if (headRole.kind === 'given') toast.success(fill(key, { name: head }));
          else toast.info(fill(key, { name: head }));
        }
        if (mode.kind === 'edit') {
          toast.success(text('toasts.saved'));
          setOpen(false);
          return;
        }
        toast.success(fill('toasts.created', { name }));
        setAdded({ id: result.value.id, name });
        return;
      }
      if (sessionRefused(result.error)) return;
      const next = formFailure(result.error, text, errors, unitFieldText);
      setFailure(next);
      // A refused field under «More options» is shown, not hidden.
      const hidden = next.fields.code
        ? 'unit-code'
        : next.fields.branchId
          ? 'unit-branch'
          : next.fields.headPersonId
            ? 'unit-head'
            : null;
      if (hidden) {
        setMore(true);
        // Focus the refused field once «More options» has rendered it.
        requestAnimationFrame(() => document.getElementById(hidden)?.focus());
      }
      if (next.fields.code && !codeTouched) {
        setCode(fields.code);
        setCodeTouched(true);
      }
    });
  }

  const blockers = unit ? unitDeleteBlockers(unit) : [];
  const showAll = mode.kind === 'edit' || more;

  const nameField = (language: 'ar' | 'en') => {
    const key = language === 'ar' ? 'nameAr' : 'nameEn';
    const required = language === nameLanguage;
    return (
      <TextField
        key={key}
        id={`unit-${key}`}
        name={key}
        label={text(`form.${key}`)}
        marker={text(required ? 'required' : 'optional')}
        required={required}
        dir={language === 'ar' ? 'rtl' : 'ltr'}
        lang={language}
        maxLength={200}
        autoComplete="off"
        defaultValue={(language === 'ar' ? unit?.nameAr : unit?.nameEn) ?? ''}
        onChange={(event) => {
          if (codeTouched) return;
          const other = event.currentTarget.form?.elements.namedItem(
            language === 'ar' ? 'nameEn' : 'nameAr',
          );
          const otherValue = other instanceof HTMLInputElement ? other.value : '';
          setCode(
            language === 'en'
              ? suggestedCode(event.target.value, otherValue)
              : suggestedCode(otherValue, event.target.value),
          );
        }}
        error={failure.fields[key]}
        disabled={pending}
      />
    );
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        onClose();
        after?.();
      }}
      canClose={canClose}
      size="sm"
      title={added ? fill('form.addedTitle', { name: added.name }) : title}
      description={added ? text('form.addedDescription') : description}
      closeLabel={text('form.close')}
      data-testid="unit-dialog"
      footer={
        added ? (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
              data-testid="unit-dialog-done"
            >
              {text('form.done')}
            </Button>
            {onFollowUp && mode.kind === 'create' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  closeThen(() => {
                    onFollowUp({ kind: 'sibling' });
                  });
                }}
                data-testid="unit-dialog-add-another"
              >
                <Icon name="plus" />
                {fill('form.addAnother', { level: mode.levelName })}
              </Button>
            ) : null}
            {onFollowUp && nextLevelName ? (
              <Button
                onClick={() => {
                  closeThen(() => {
                    onFollowUp({ kind: 'child', parentId: added.id, levelName: nextLevelName });
                  });
                }}
                data-testid="unit-dialog-add-under"
              >
                <Icon name="plus" />
                {fill('form.addUnder', { level: nextLevelName })}
              </Button>
            ) : null}
          </>
        ) : (
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
              data-testid="unit-dialog-submit"
            >
              {pending
                ? text('form.saving')
                : mode.kind === 'create'
                  ? text('form.create')
                  : text('form.save')}
            </Button>
          </>
        )
      }
    >
      {added ? (
        <div
          className="flex flex-col items-center gap-3 py-4 text-center"
          role="status"
          data-testid="unit-dialog-added"
        >
          <span className="grid size-14 place-items-center rounded-full bg-success-subtle text-success">
            <Icon name="check" className="size-7" />
          </span>
          <p className="m-0 max-w-[36ch] text-sm text-text-muted">
            {nextLevelName
              ? fill('form.addedNext', { level: nextLevelName, name: added.name })
              : text('form.addedLast')}
          </p>
        </div>
      ) : (
        <form id={FORM_ID} className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {/* The organization's default language first (required), then the other one (optional). */}
          {nameOrder(nameLanguage).map(nameField)}
          {mode.kind === 'create' ? (
            <button
              type="button"
              className="flex min-h-10 flex-wrap items-center gap-1.5 self-start rounded-full px-2 text-start text-sm font-semibold text-primary-text hover:bg-primary-subtle pointer-coarse:min-h-11"
              aria-expanded={more}
              aria-controls="unit-more"
              onClick={() => {
                setMore((current) => !current);
              }}
              data-testid="unit-more"
            >
              <Icon name={more ? 'chevron-down' : 'chevron-end'} />
              {text('form.more')}
              {code !== '' || parentBranch ? (
                <span className="font-normal text-text-muted">
                  {' · '}
                  {parentBranch
                    ? fill('form.moreSummaryBranch', { code, branch: parentBranch })
                    : fill('form.moreSummary', { code })}
                </span>
              ) : null}
            </button>
          ) : null}
          <div id="unit-more" className={showAll ? 'flex flex-col gap-4' : 'hidden'}>
            <TextField
              id="unit-code"
              name="code"
              label={text('form.code')}
              marker={text('required')}
              hint={text(mode.kind === 'create' ? 'form.codeSuggested' : 'form.codeHint')}
              required
              dir="ltr"
              maxLength={32}
              autoComplete="off"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setCodeTouched(true);
              }}
              error={failure.fields.code}
              disabled={pending}
            />
            <SelectField
              id="unit-branch"
              label={text('form.branch')}
              marker={text('optional')}
              hint={
                parentBranch
                  ? fill('form.branchFromParent', { parent: parent?.name ?? '' })
                  : undefined
              }
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
            {costCentreChoices.length > 0 ? (
              <SelectField
                id="unit-cost-centre"
                label={text('form.defaultCostCentre')}
                marker={text('optional')}
                hint={text('form.defaultCostCentreHint')}
                value={defaultCostCentreId}
                onChange={(event) => {
                  setDefaultCostCentreId(event.target.value);
                }}
                error={failure.fields.defaultCostCentreId}
                disabled={pending}
                data-testid="unit-cost-centre"
              >
                <option value="">{text('form.noCostCentre')}</option>
                {costCentreChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </SelectField>
            ) : null}
          </div>
          {failure.message ? (
            <Alert tone="danger" data-testid="unit-dialog-message">
              {failure.message}
              <LoadLatestVersion message={failure.message} />
            </Alert>
          ) : null}
          {unit && (onStatus || onDelete) ? (
            <div className="flex flex-col gap-4 border-t border-border pt-4">
              {onStatus ? (
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-[1_1_14rem]">
                    <p className="m-0 font-semibold">
                      {unit.active ? text('deactivate') : text('activate')}
                    </p>
                    <p className="m-0 text-sm text-text-muted">
                      {unit.active ? text('status.deactivateText') : text('status.activateText')}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      closeThen(() => {
                        onStatus(unit);
                      });
                    }}
                    data-testid="unit-panel-status"
                  >
                    {unit.active ? text('deactivate') : text('activate')}
                  </Button>
                </div>
              ) : null}
              {onDelete ? (
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-[1_1_14rem]">
                    <p className="m-0 font-semibold">{text('delete')}</p>
                    <p className="m-0 text-sm text-text-muted">{text('remove.text')}</p>
                    {blockers.length > 0 ? (
                      <p
                        id="unit-delete-blockers"
                        className="m-0 mt-1 text-sm text-text-muted"
                        data-testid="unit-delete-reason"
                      >
                        {blockers.map((item) => fill(item.key, { count: item.count })).join(' · ')}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant={blockers.length > 0 ? 'secondary' : 'danger'}
                    size="sm"
                    disabled={pending || blockers.length > 0}
                    aria-describedby={blockers.length > 0 ? 'unit-delete-blockers' : undefined}
                    onClick={() => {
                      closeThen(() => {
                        onDelete(unit);
                      });
                    }}
                    data-testid="unit-panel-delete"
                  >
                    {text('delete')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          <p className="m-0 flex items-start gap-2 text-[13px] text-text-muted">
            <Icon name="shield-outline" className="mt-0.5 shrink-0" />
            {text('form.audited')}
          </p>
        </form>
      )}
    </Dialog>
  );
}
