'use client';
import {
  leaveOutPlanLineAction,
  mergePlanLinesAction,
  setPlanLinesQuarterAction,
} from '@jadarat/tms/actions/consolidation';
import { CONSOLIDATION_LIMITS, QUARTERS, type Quarter } from '@jadarat/tms/consolidation-rules';
import {
  Alert,
  Button,
  Dialog,
  FieldError,
  FieldMarker,
  Icon,
  TextField,
  cn,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { type PlanLine, defaultKeptLine, mergePreview } from '../../lib/training-plan-view';
import { LoadLatestVersion } from '../latest-version';
import type { PlanModel } from './plan-shared';

/**
 * «Merge N lines into one?» (design screen 1b; Kawadir's 560 px popup): the lines, one required field — the
 * merged line's name, one of theirs or a new one — and what merging saves. The line whose name is picked is
 * the one kept (its session size and costs); typing a new name keeps the line chosen before.
 */
export function MergeDialog({
  lines,
  model,
  onClose,
  onMerged,
}: {
  readonly lines: readonly PlanLine[];
  readonly model: PlanModel;
  readonly onClose: () => void;
  readonly onMerged: () => void;
}) {
  const { t } = model.texts;
  const router = useRouter();
  const [keepId, setKeepId] = useState(() => defaultKeptLine(lines));
  const [title, setTitle] = useState(() => lines.find((l) => l.id === keepId)?.title ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const preview = mergePreview(lines, keepId, model.view.fractionDigits);
  const kept = lines.find((l) => l.id === keepId);
  const sessions = preview.figures.plan?.sessions ?? null;

  function merge() {
    const name = title.trim();
    if (name === '') {
      setError(t('fieldErrors.required'));
      return;
    }
    setNotice(null);
    startTransition(async () => {
      const result = await mergePlanLinesAction({
        lines: lines.map((l) => ({ id: l.id, version: l.version })),
        intoLineId: keepId,
        title: name,
      });
      if (result.ok) {
        onMerged();
        onClose();
        toast.success(t('merge.done', { title: name }));
        router.refresh();
        return;
      }
      if (model.texts.sessionRefused(result.error)) return;
      setError(model.texts.fieldErrors(result.error).title);
      setNotice(model.texts.formMessage(result.error));
    });
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      canClose={() => !pending}
      size="md"
      title={t('merge.title', { count: lines.length })}
      description={t('merge.body')}
      closeLabel={t('close')}
      data-testid="plan-merge-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button
            busy={pending}
            disabled={pending}
            onClick={merge}
            data-testid="plan-merge-confirm"
          >
            <Icon name="collapse-all" className="size-4" />
            {t('merge.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {notice ? (
          <Alert tone="danger">
            {notice}
            <LoadLatestVersion message={notice} />
          </Alert>
        ) : null}
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-lg border border-border p-0">
          {lines.map((line) => (
            <li
              key={line.id}
              className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block font-semibold">{line.title}</span>
                <span className="text-sm text-text-muted">
                  {[
                    line.departments
                      .map((d) => model.departmentName(d.departmentId))
                      .join(t('listSeparator')),
                    model.deliveryLabel(line.deliveryType),
                    model.quarter(line.quarter),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-end text-sm">
                <span className="block font-semibold">
                  {t('merge.people', { count: line.people })}
                </span>
                <span className="text-text-muted">
                  {line.sessions === null
                    ? t('lines.noSize')
                    : t('merge.sessions', { count: line.sessions.sessions })}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2">
          <TextField
            id="plan-merge-title"
            label={t('merge.name')}
            required
            marker={t('required')}
            value={title}
            maxLength={CONSOLIDATION_LIMITS.titleMax}
            onChange={(event) => {
              setTitle(event.target.value);
              setError(undefined);
            }}
            hint={t('merge.nameHint')}
            error={error}
            data-testid="plan-merge-title"
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('merge.useName')}>
            {lines.map((line) => (
              <Button
                key={line.id}
                variant="secondary"
                size="sm"
                aria-pressed={keepId === line.id && title === line.title}
                onClick={() => {
                  setKeepId(line.id);
                  setTitle(line.title);
                  setError(undefined);
                }}
                className={cn(keepId === line.id && title === line.title && 'border-primary')}
              >
                {line.title}
              </Button>
            ))}
          </div>
        </div>

        <div
          className="flex gap-3 rounded-lg bg-primary-subtle px-4 py-3.5 text-primary-text"
          role="status"
        >
          <Icon name="star" className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-1">
            <p className="m-0 font-semibold" data-testid="plan-merge-preview">
              {[
                t('merge.people', { count: preview.people }),
                t('merge.departments', { count: preview.departments }),
                sessions === null
                  ? t('lines.noSize')
                  : t('merge.sessionsInstead', { count: sessions, before: preview.sessionsBefore }),
              ].join(' · ')}
            </p>
            {kept ? (
              <p className="m-0 text-sm">
                {kept.maxPerSession !== null &&
                kept.costPerSession !== null &&
                preview.figures.cost !== null
                  ? t('merge.keeps', {
                      title: kept.title,
                      min: kept.minPerSession ?? 1,
                      max: kept.maxPerSession,
                      cost: model.amount(kept.costPerSession),
                    }) +
                    ' ' +
                    (preview.costBefore === null
                      ? t('merge.costAfter', { cost: model.amount(preview.figures.cost) })
                      : t('merge.costInstead', {
                          cost: model.amount(preview.figures.cost),
                          before: model.amount(preview.costBefore),
                        }))
                  : t('merge.keepsUncosted', { title: kept.title })}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * «Leave «X» out of the plan?» (design screen 2b; 448 px, warning tone — it can be undone until the plan is
 * submitted): one required reason, which the department's head reads once the plan is approved.
 */
export function LeaveOutDialog({
  line,
  model,
  onClose,
}: {
  readonly line: PlanLine;
  readonly model: PlanModel;
  readonly onClose: () => void;
}) {
  const { t } = model.texts;
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const who =
    line.departments.length === 1 && line.departments[0]
      ? t('leaveOut.oneDepartment', {
          department: model.departmentName(line.departments[0].departmentId),
          count: line.people,
        })
      : t('leaveOut.departments', { departments: line.departments.length, count: line.people });

  function leaveOut() {
    if (reason.trim() === '') {
      setError(t('fieldErrors.required'));
      return;
    }
    setNotice(null);
    startTransition(async () => {
      const result = await leaveOutPlanLineAction({
        lineId: line.id,
        version: line.version,
        reason: reason.trim(),
      });
      if (result.ok) {
        onClose();
        toast.success(t('leaveOut.done', { title: line.title }));
        router.refresh();
        return;
      }
      if (model.texts.sessionRefused(result.error)) return;
      setError(model.texts.fieldErrors(result.error).reason);
      setNotice(model.texts.formMessage(result.error));
    });
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      canClose={() => !pending}
      size="sm"
      tone="warning"
      title={t('leaveOut.title', { title: line.title })}
      description={`${who} ${t('leaveOut.body')}`}
      closeLabel={t('close')}
      data-testid="plan-leave-out-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button
            busy={pending}
            disabled={pending}
            onClick={leaveOut}
            data-testid="plan-leave-out-confirm"
          >
            <Icon name="ban" className="size-4" />
            {t('leaveOut.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {notice ? (
          <Alert tone="danger">
            {notice}
            <LoadLatestVersion message={notice} />
          </Alert>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="plan-leave-out-reason" className="text-sm font-semibold">
            {t('leaveOut.reason')}
            <FieldMarker required marker={t('required')} />
          </label>
          <textarea
            id="plan-leave-out-reason"
            rows={3}
            aria-required="true"
            maxLength={CONSOLIDATION_LIMITS.leftOutReasonMax}
            value={reason}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'plan-leave-out-reason-error' : 'plan-leave-out-reason-hint'}
            onChange={(event) => {
              setReason(event.target.value);
              setError(undefined);
            }}
            disabled={pending}
            className={cn(
              'w-full rounded-md border-[1.5px] border-border-strong bg-surface px-3.5 py-2 text-[15px] text-text focus:border-primary',
              error && 'border-danger',
            )}
            data-testid="plan-leave-out-reason"
          />
          <p id="plan-leave-out-reason-hint" className="m-0 text-[13.5px] text-text-muted">
            {t('leaveOut.hint')}
          </p>
          {error ? <FieldError id="plan-leave-out-reason-error">{error}</FieldError> : null}
        </div>
      </div>
    </Dialog>
  );
}

/** «Change quarter» of the ticked lines, or «Move quarter» of one line (row ⋯ menu): Q1–Q4. */
export function QuarterDialog({
  lines,
  model,
  onClose,
  onDone,
}: {
  readonly lines: readonly PlanLine[];
  readonly model: PlanModel;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const { t } = model.texts;
  const router = useRouter();
  const first = lines[0];
  const same = lines.every((l) => l.quarter === first?.quarter);
  const [quarter, setQuarter] = useState<Quarter | null>(same && first ? first.quarter : null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (quarter === null) {
      setError(t('fieldErrors.required'));
      return;
    }
    setNotice(null);
    startTransition(async () => {
      const result = await setPlanLinesQuarterAction({
        lines: lines.map((l) => ({ id: l.id, version: l.version })),
        quarter,
      });
      if (result.ok) {
        onDone();
        onClose();
        toast.success(
          t('quarterDialog.done', { count: lines.length, quarter: model.quarter(quarter) }),
        );
        router.refresh();
        return;
      }
      if (model.texts.sessionRefused(result.error)) return;
      setNotice(model.texts.formMessage(result.error));
    });
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      canClose={() => !pending}
      size="sm"
      title={
        lines.length === 1 && first
          ? t('quarterDialog.titleOne', { title: first.title })
          : t('quarterDialog.title', { count: lines.length })
      }
      description={t('quarterDialog.body')}
      closeLabel={t('close')}
      data-testid="plan-quarter-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button
            busy={pending}
            disabled={pending}
            onClick={save}
            data-testid="plan-quarter-confirm"
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {notice ? (
          <Alert tone="danger">
            {notice}
            <LoadLatestVersion message={notice} />
          </Alert>
        ) : null}
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 p-0 text-sm font-semibold">
            {t('line.when')}
            <FieldMarker required marker={t('required')} />
          </legend>
          <div className="inline-flex w-fit gap-1 rounded-full bg-surface-hover p-1">
            {QUARTERS.map((q) => (
              <label
                key={q}
                className={cn(
                  'relative inline-flex min-h-9 min-w-12 cursor-pointer items-center justify-center rounded-full px-3.5 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring pointer-coarse:min-h-11',
                  quarter === q
                    ? 'bg-surface font-semibold text-text shadow-1'
                    : 'text-text-muted hover:text-text',
                )}
              >
                <input
                  type="radio"
                  name="plan-quarter"
                  value={q}
                  checked={quarter === q}
                  onChange={() => {
                    setQuarter(q);
                    setError(undefined);
                  }}
                  className="sr-only"
                  data-testid={`plan-quarter-${String(q)}`}
                />
                {model.quarter(q)}
              </label>
            ))}
          </div>
          {error ? <FieldError id="plan-quarter-error">{error}</FieldError> : null}
        </fieldset>
      </div>
    </Dialog>
  );
}
