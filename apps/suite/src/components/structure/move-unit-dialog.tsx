'use client';
import type { UnitMovePreview } from '@jadarat/platform-db';
import { Alert, Badge, Button, Dialog, Icon, TextField, cn, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { moveStructureUnitAction, previewStructureUnitMoveAction } from '../../actions/structure';
import { fillText } from '../../lib/fill-text';
import { unitFieldText } from '../../lib/structure-form';
import type { ErrorTexts } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { failureOf } from './failure';
import type { UnitView } from './unit-panel';

export interface MoveUnitDialogProps {
  readonly unit: UnitView;
  readonly units: readonly UnitView[];
  /** Texts of the `structure` namespace (raw, flattened). */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  readonly locale: 'ar' | 'en';
  readonly onClose: () => void;
}

/**
 * «Move to…» (WP-HR-01; business flow EP-ORG-structure-completion.md §3 B; design «Structure Completion Design»
 * screens 4–6, approved by the PO 24 Oct 2026; Mobbin refs Proton Drive, Loom, Gumloop, Square). Step 1: the new
 * parent — only units at the level of the current parent can be picked (a unit keeps its level, BR-ORG-i); the
 * levels above are shown to find the way. Step 2: the preview — what moves, who will see more or less, and an
 * open planning cycle; nothing changes until «Move».
 */
export function MoveUnitDialog({
  unit,
  units,
  texts,
  errors,
  locale,
  onClose,
}: MoveUnitDialogProps) {
  const text = (key: string) => texts[key] ?? key;
  const fill = (key: string, values: Record<string, string | number>) =>
    fillText(text(key), values, locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [preview, setPreview] = useState<UnitMovePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const parent = unit.parentId === null ? null : (byId.get(unit.parentId) ?? null);
  const path = (target: UnitView | null): string => {
    const names: string[] = [];
    for (
      let at = target;
      at && names.length < 12;
      at = at.parentId ? (byId.get(at.parentId) ?? null) : null
    ) {
      names.unshift(at.name);
    }
    return names.join(' › ');
  };
  // Candidates: live, active units at the old parent's level, other than the old parent.
  const candidates = units.filter(
    (u) =>
      parent !== null &&
      u.levelOrdinal === parent.levelOrdinal &&
      u.id !== parent.id &&
      u.active &&
      path(u).toLowerCase().includes(search.trim().toLowerCase()),
  );
  const target = picked ? (byId.get(picked) ?? null) : null;

  function refusal(error: Parameters<typeof sessionRefused>[0]): string | null {
    if (sessionRefused(error)) return null;
    const failure = failureOf(error, text, errors, unitFieldText);
    return failure.message ?? Object.values(failure.fields)[0] ?? null;
  }

  function review() {
    if (!picked) return;
    setMessage(null);
    startTransition(async () => {
      const result = await previewStructureUnitMoveAction({ id: unit.id, parentId: picked });
      if (result.ok) setPreview(result.value);
      else setMessage(refusal(result.error));
    });
  }

  function move() {
    if (!preview) return;
    setMessage(null);
    startTransition(async () => {
      const result = await moveStructureUnitAction({
        id: unit.id,
        version: unit.version,
        parentId: preview.toParentId ?? '',
      });
      if (result.ok) {
        toast.success(fill('move.done', { name: unit.name }));
        setOpen(false);
        router.refresh();
        return;
      }
      setMessage(refusal(result.error));
    });
  }

  const personName = (change: UnitMovePreview['changes'][number]) =>
    (locale === 'ar' ? (change.nameAr ?? change.nameEn) : (change.nameEn ?? change.nameAr)) ?? '';
  const roleLabel = (change: UnitMovePreview['changes'][number]) => {
    const where = byId.get(change.unitId)?.name ?? '';
    if (change.kind === 'head') return fill('move.headOf', { unit: where });
    const role =
      (locale === 'ar'
        ? (change.roleNameAr ?? change.roleNameEn)
        : (change.roleNameEn ?? change.roleNameAr)) ?? '';
    return fill('move.roleFor', { role, unit: where });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={preview ? text('move.reviewTitle') : fill('move.title', { name: unit.name })}
      description={preview ? undefined : fill('move.description', { level: unit.levelName })}
      closeLabel={text('form.close')}
      size="md"
      canClose={() => !pending}
      data-testid="move-unit-dialog"
      footer={
        preview ? (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setPreview(null);
              }}
              disabled={pending}
              className="me-auto"
            >
              <Icon name="chevron-start" aria-hidden="true" />
              {text('move.back')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
              disabled={pending}
            >
              {text('form.cancel')}
            </Button>
            <Button onClick={move} disabled={pending} data-testid="move-unit-confirm">
              {pending ? text('move.moving') : text('move.confirm')}
            </Button>
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
            <Button onClick={review} disabled={pending || !picked} data-testid="move-unit-review">
              {pending ? text('move.checking') : text('move.review')}
            </Button>
          </>
        )
      }
    >
      <p className="m-0 text-[13px] font-semibold text-text-muted">
        {fill('move.step', { step: preview ? 2 : 1, of: 2 })}
      </p>
      {preview ? (
        <div className="flex flex-col gap-4" data-testid="move-unit-preview">
          <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="neutral">{path(parent)}</Badge>
            <Icon name="arrow-end" aria-hidden="true" />
            <Badge tone="info">{path(target)}</Badge>
          </p>
          <dl className="m-0 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3">
              <dd className="m-0 text-2xl font-bold tabular-nums">{preview.unitIds.length}</dd>
              <dt className="text-[13px] text-text-muted">{text('move.unitsMove')}</dt>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dd className="m-0 text-2xl font-bold tabular-nums">{preview.peopleCount}</dd>
              <dt className="text-[13px] text-text-muted">{text('move.peopleMove')}</dt>
            </div>
          </dl>
          <section aria-labelledby="move-changes-title" className="flex flex-col gap-2">
            <h3 id="move-changes-title" className="m-0 text-sm font-bold">
              {text('move.changesTitle')}
            </h3>
            {preview.changes.length === 0 ? (
              <p className="m-0 text-sm text-text-muted" data-testid="move-unit-no-changes">
                {text('move.noChanges')}
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-lg border border-border p-0">
                {preview.changes.map((change) => (
                  <li
                    key={`${change.kind}-${change.personId}-${change.unitId}`}
                    className="flex flex-wrap items-center gap-3 px-3 py-2.5"
                    data-testid="move-unit-change"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold">{personName(change)}</span>
                      <span className="text-[13px] text-text-muted">{roleLabel(change)}</span>
                    </div>
                    <Badge tone={change.change === 'loses' ? 'danger' : 'success'}>
                      {fill(change.change === 'loses' ? 'move.loses' : 'move.gains', {
                        name: unit.name,
                      })}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {preview.openCycles.length > 0 ? (
            <Alert tone="warning" data-testid="move-unit-cycle">
              {fill('move.openCycle', {
                name: unit.name,
                cycles: preview.openCycles
                  .map((c) => (locale === 'ar' ? c.nameAr : c.nameEn))
                  .join('، '),
                parent: target?.name ?? '',
              })}
            </Alert>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <TextField
            id="move-unit-search"
            label={text('move.search')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            autoComplete="off"
          />
          <fieldset className="m-0 border-0 p-0">
            <legend className="sr-only">{text('move.pickLegend')}</legend>
            {candidates.length === 0 ? (
              <p className="m-0 text-sm text-text-muted" data-testid="move-unit-none">
                {text('move.none')}
              </p>
            ) : (
              <ul className="m-0 flex max-h-80 list-none flex-col gap-1 overflow-y-auto rounded-lg border border-border p-1.5">
                {candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <div
                      className={cn(
                        'flex min-h-11 items-center gap-3 rounded-md px-3 py-2',
                        picked === candidate.id ? 'bg-primary-subtle' : 'hover:bg-surface-hover',
                      )}
                    >
                      <input
                        id={`move-unit-option-${candidate.id}`}
                        type="radio"
                        aria-describedby={`move-unit-path-${candidate.id}`}
                        name="move-unit-parent"
                        value={candidate.id}
                        checked={picked === candidate.id}
                        onChange={() => {
                          setPicked(candidate.id);
                        }}
                        className="size-5 accent-primary"
                        data-testid={`move-unit-option-${candidate.code}`}
                      />
                      <span className="flex min-w-0 flex-col">
                        <label
                          htmlFor={`move-unit-option-${candidate.id}`}
                          className="cursor-pointer font-semibold"
                        >
                          {candidate.name}
                        </label>
                        <span
                          id={`move-unit-path-${candidate.id}`}
                          className="text-[13px] text-text-muted"
                        >
                          {path(candidate)}
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <p className="m-0 text-[13px] text-text-muted">
            {fill('move.levelNote', {
              level: unit.levelName,
              parentLevel: parent?.levelName ?? '',
            })}
          </p>
        </div>
      )}
      {message ? (
        <Alert tone="danger" data-testid="move-unit-message">
          {message}
        </Alert>
      ) : null}
    </Dialog>
  );
}
