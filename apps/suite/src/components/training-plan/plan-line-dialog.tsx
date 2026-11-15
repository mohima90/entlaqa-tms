'use client';
import { normalizeDigits } from '@jadarat/platform-i18n/text';
import { moveNeedOutAction, updatePlanLineAction } from '@jadarat/tms/actions/consolidation';
import {
  PLAN_DELIVERY_TYPES,
  type PlanDeliveryType,
  QUARTERS,
  type Quarter,
} from '@jadarat/tms/consolidation-rules';
import {
  Alert,
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FieldError,
  FieldMarker,
  Icon,
  TextField,
  cn,
  fieldInputClasses,
  tableClasses,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  type PlanLine,
  linePreview,
  quarterAsked,
  typedAmount,
  typedCount,
} from '../../lib/training-plan-view';
import { LoadLatestVersion } from '../latest-version';
import { SelectField } from '../select-field';
import { LineStatusBadge, type PlanModel } from './plan-shared';

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

interface LineForm {
  min: string;
  max: string;
  costPerSession: string;
  costPerPerson: string;
  durationHours: string;
  deliveryType: PlanDeliveryType | '';
  quarter: Quarter;
}

const text = (value: number | string | null) => (value === null ? '' : String(value));

function formOf(line: PlanLine): LineForm {
  return {
    min: text(line.minPerSession),
    max: text(line.maxPerSession),
    costPerSession: text(line.costPerSession),
    costPerPerson: text(line.costPerPerson),
    durationHours: text(line.durationHours),
    deliveryType: line.deliveryType ?? '',
    quarter: line.quarter,
  };
}

/** A duration in hours as typed: up to two decimals; null when empty, undefined when invalid. */
function typedHours(value: string): number | null | undefined {
  const plain = normalizeDigits(value).trim();
  if (plain === '') return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(plain)) return undefined;
  const n = Number(plain);
  return n > 0 ? n : undefined;
}

/**
 * A plan line opened (design screen 2; Kawadir's rich 672 px popup, forms standard rule 9): the needs in the
 * line per department with their share of the cost, the session size and cost per session (required), the
 * sessions and cost worked out while L&D types (`@jadarat/tms/consolidation-rules`, the server's own rules),
 * When (the quarter, preselected from what most departments asked) and «More» (cost per person, duration,
 * delivery type). «Move out of this line» gives one need a line of its own; «Leave out of the plan» opens the
 * reason popup. Read-only for a viewer who may not change the line.
 */
export function PlanLineDialog({
  line,
  model,
  onClose,
  onLeaveOut,
  onBringBack,
}: {
  readonly line: PlanLine;
  readonly model: PlanModel;
  readonly onClose: () => void;
  readonly onLeaveOut: (line: PlanLine) => void;
  readonly onBringBack: (line: PlanLine) => void;
}) {
  const { t } = model.texts;
  const router = useRouter();
  const editable = model.editable(line);
  const [form, setForm] = useState<LineForm>(() => formOf(line));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<LineForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !(key in patch))),
    );
  };

  const preview = linePreview(line, form, model.view.fractionDigits);
  const asked = quarterAsked(line);
  const delivery = model.deliveryLabel(line.deliveryType);
  const subtitle = [
    line.category
      ? (model.view.categories.find((c) => c.value === line.category)?.label[model.locale] ?? null)
      : null,
    delivery,
    line.courseId ? t('lines.fromLibrary') : null,
  ].filter(Boolean);

  // One row per department of the line: its needs, people, priority, the quarters asked and its share.
  const rows = line.departments.map((d) => {
    const needs = line.needs.filter((n) => n.departmentId === d.departmentId);
    const priority = PRIORITY_ORDER.find((p) => needs.some((n) => n.priority === p)) ?? null;
    const quarters = [...new Set(needs.flatMap((n) => (n.quarter === null ? [] : [n.quarter])))];
    return {
      ...d,
      needs,
      priority,
      quarters: quarters.sort(),
      share: preview.shares.get(d.departmentId) ?? null,
    };
  });

  function validate(): Record<string, string> | null {
    const out: Record<string, string> = {};
    const min = typedCount(form.min);
    const max = typedCount(form.max);
    if (max === null) out.max = t('fieldErrors.required');
    else if (max === undefined) out.max = t('fieldErrors.count');
    if (min === undefined) out.min = t('fieldErrors.count');
    else if (min !== null && typeof max === 'number' && min > max) {
      out.min = t('fieldErrors.minAboveMax');
    }
    const cost = typedAmount(form.costPerSession);
    if (cost === null) out.costPerSession = t('fieldErrors.required');
    else if (cost === undefined) out.costPerSession = t('fieldErrors.invalidAmount');
    if (typedAmount(form.costPerPerson) === undefined) {
      out.costPerPerson = t('fieldErrors.invalidAmount');
    }
    if (typedHours(form.durationHours) === undefined) out.durationHours = t('fieldErrors.hours');
    if (Object.keys(out).length === 0) return null;
    if (out.costPerPerson || out.durationHours) setMore(true);
    return out;
  }

  function save() {
    const problems = validate();
    if (problems) {
      setErrors(problems);
      return;
    }
    const initial = formOf(line);
    const patch: Record<string, unknown> = {};
    const min = typedCount(form.min) ?? null;
    const max = typedCount(form.max) ?? null;
    if (min !== line.minPerSession) patch.minPerSession = min;
    if (max !== line.maxPerSession) patch.maxPerSession = max;
    const costPerSession = typedAmount(form.costPerSession) ?? null;
    if (form.costPerSession !== initial.costPerSession) patch.costPerSession = costPerSession;
    if (form.costPerPerson !== initial.costPerPerson) {
      patch.costPerPerson = typedAmount(form.costPerPerson) ?? null;
    }
    if (form.durationHours !== initial.durationHours) {
      patch.durationHours = typedHours(form.durationHours) ?? null;
    }
    if (form.deliveryType !== initial.deliveryType) {
      patch.deliveryType = form.deliveryType === '' ? null : form.deliveryType;
    }
    if (form.quarter !== line.quarter) patch.quarter = form.quarter;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setNotice(null);
    startTransition(async () => {
      const result = await updatePlanLineAction({
        lineId: line.id,
        version: line.version,
        ...patch,
      });
      if (result.ok) {
        onClose();
        toast.success(t('line.saved', { title: line.title }));
        router.refresh();
        return;
      }
      if (model.texts.sessionRefused(result.error)) return;
      const fields = model.texts.fieldErrors(result.error);
      setErrors({
        ...(fields.minPerSession ? { min: fields.minPerSession } : {}),
        ...(fields.maxPerSession ? { max: fields.maxPerSession } : {}),
        ...(fields.costPerSession ? { costPerSession: fields.costPerSession } : {}),
        ...(fields.costPerPerson ? { costPerPerson: fields.costPerPerson } : {}),
        ...(fields.durationHours ? { durationHours: fields.durationHours } : {}),
      });
      setNotice(model.texts.formMessage(result.error));
    });
  }

  function moveOut(needId: string) {
    setNotice(null);
    startTransition(async () => {
      const result = await moveNeedOutAction({ lineId: line.id, version: line.version, needId });
      if (result.ok) {
        onClose();
        toast.success(t('line.movedOut'));
        router.refresh();
        return;
      }
      if (model.texts.sessionRefused(result.error)) return;
      setNotice(model.texts.formMessage(result.error));
    });
  }

  const sessions = preview.plan;
  const sizes = sessions?.sizes ?? [];
  const resultText =
    sessions === null
      ? t('line.previewNoSize')
      : preview.cost === null
        ? t('line.previewNoCost', {
            count: sessions.sessions,
            sizes: sizes.map((n) => model.number(n)).join(t('line.sizeSeparator')),
          })
        : t('line.preview', {
            count: sessions.sessions,
            sizes: sizes.map((n) => model.number(n)).join(t('line.sizeSeparator')),
            cost: model.amount(preview.cost),
          });
  const split =
    preview.cost === null || rows.length < 2
      ? null
      : t('line.split', {
          shares: rows
            .map((r) => `${model.departmentName(r.departmentId)} ${model.amount(r.share ?? 0)}`)
            .join(' · '),
        });

  const totalSeats = rows.reduce((n, r) => n + r.seats, 0);

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      canClose={() => !pending}
      size="rich"
      title={line.title}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <LineStatusBadge line={line} model={model} />
          {subtitle.length > 0 ? <span>{subtitle.join(' · ')}</span> : null}
        </span>
      }
      closeLabel={t('close')}
      data-testid="plan-line-dialog"
      footer={
        editable ? (
          <div className="flex w-full flex-wrap items-center gap-3">
            {line.status === 'in_plan' ? (
              <Button
                variant="ghost"
                className="text-danger hover:bg-danger-subtle sm:me-auto"
                disabled={pending}
                onClick={() => {
                  onLeaveOut(line);
                }}
                data-testid="plan-line-leave-out"
              >
                <Icon name="ban" className="size-4" />
                {t('line.leaveOut')}
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="sm:me-auto"
                disabled={pending}
                onClick={() => {
                  onBringBack(line);
                }}
                data-testid="plan-line-bring-back"
              >
                <Icon name="undo" className="size-4" />
                {t('line.bringBack')}
              </Button>
            )}
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              {t('cancel')}
            </Button>
            <Button busy={pending} disabled={pending} onClick={save} data-testid="plan-line-save">
              {t('save')}
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            {t('close')}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {notice ? (
          <Alert tone="danger">
            {notice}
            <LoadLatestVersion message={notice} />
          </Alert>
        ) : null}
        {line.status === 'left_out' && line.leftOutReason ? (
          <Alert tone="info">{t('line.leftOutReason', { reason: line.leftOutReason })}</Alert>
        ) : null}

        <section aria-labelledby="plan-line-needs-title" className="flex flex-col gap-2">
          <h3
            id="plan-line-needs-title"
            className="m-0 text-xs font-bold uppercase tracking-[var(--letter-spacing-caps)] text-text-muted"
          >
            {t('line.needsTitle')}
          </h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className={tableClasses.table} data-testid="plan-line-needs">
              <caption className="sr-only">{t('line.needsCaption', { title: line.title })}</caption>
              <thead className={tableClasses.header}>
                <tr>
                  <th scope="col" className={tableClasses.head}>
                    {t('line.columns.department')}
                  </th>
                  <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                    {t('line.columns.people')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('line.columns.priority')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('line.columns.askedFor')}
                  </th>
                  <th scope="col" className={cn(tableClasses.head, 'text-end')}>
                    {t('line.columns.share')}
                  </th>
                  {editable && line.needs.length > 1 ? (
                    <th scope="col" className={tableClasses.head}>
                      <span className="sr-only">{t('line.columns.actions')}</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const name = model.departmentName(row.departmentId);
                  const head = model.departmentHead(row.departmentId);
                  return (
                    <tr key={row.departmentId} className={tableClasses.row}>
                      <th scope="row" className={cn(tableClasses.cell, 'text-start font-normal')}>
                        <span className="block font-semibold">{name}</span>
                        {head ? <span className="text-sm text-text-muted">{head}</span> : null}
                      </th>
                      <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                        <span className="block">{model.number(row.seats)}</span>
                        <span className="text-sm text-text-muted">
                          {row.named > 0
                            ? t('lines.named', { count: row.named })
                            : t('lines.namesLater')}
                        </span>
                      </td>
                      <td className={tableClasses.cell}>
                        {row.priority ? t(`priority.${row.priority}`) : '—'}
                      </td>
                      <td className={tableClasses.cell}>
                        {row.quarters.length > 0
                          ? row.quarters.map((q) => model.quarter(q)).join(' · ')
                          : '—'}
                      </td>
                      <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                        {row.share === null ? '—' : model.amount(row.share)}
                      </td>
                      {editable && line.needs.length > 1 ? (
                        <td className={cn(tableClasses.cell, 'text-end')}>
                          {row.needs.length > 0 ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                className="grid size-9 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
                                aria-label={t('line.needMenu', { department: name })}
                                disabled={pending}
                                data-testid="plan-need-menu"
                              >
                                <Icon name="more" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                {row.needs.map((need) => (
                                  <DropdownMenuItem
                                    key={need.needId}
                                    onSelect={() => {
                                      moveOut(need.needId);
                                    }}
                                    data-testid="plan-need-move-out"
                                  >
                                    <Icon name="arrow-end" />
                                    {row.needs.length > 1
                                      ? t('line.moveOutNamed', { topic: need.topic })
                                      : t('line.moveOut')}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
                <tr className="bg-surface-sunken font-semibold">
                  <th scope="row" className={cn(tableClasses.cell, 'text-start')}>
                    {t('line.total')}
                  </th>
                  <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                    {model.number(totalSeats)}
                  </td>
                  <td className={tableClasses.cell} />
                  <td className={tableClasses.cell} />
                  <td className={cn(tableClasses.cell, 'text-end tabular-nums')}>
                    {preview.cost === null ? '—' : model.amount(preview.cost)}
                  </td>
                  {editable && line.needs.length > 1 ? <td className={tableClasses.cell} /> : null}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <fieldset
          disabled={!editable || pending}
          className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0"
        >
          <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 p-0 text-sm font-semibold">
              {t('line.peoplePerSession')}
              <FieldMarker required marker={t('required')} />
            </legend>
            <div className="flex flex-wrap items-center gap-2.5">
              <label htmlFor="plan-line-min" className="text-[15px]">
                {t('line.from')}
              </label>
              <input
                id="plan-line-min"
                inputMode="numeric"
                value={form.min}
                onChange={(event) => {
                  set({ min: event.target.value });
                }}
                aria-invalid={errors.min ? true : undefined}
                aria-describedby={errors.min ? 'plan-line-min-error' : 'plan-line-size-hint'}
                className={cn(fieldInputClasses, 'w-24 text-center', errors.min && 'border-danger')}
                data-testid="plan-line-min"
              />
              <label htmlFor="plan-line-max" className="text-[15px]">
                {t('line.to')}
              </label>
              <input
                id="plan-line-max"
                inputMode="numeric"
                aria-required="true"
                value={form.max}
                onChange={(event) => {
                  set({ max: event.target.value });
                }}
                aria-invalid={errors.max ? true : undefined}
                aria-describedby={errors.max ? 'plan-line-max-error' : 'plan-line-size-hint'}
                className={cn(fieldInputClasses, 'w-24 text-center', errors.max && 'border-danger')}
                data-testid="plan-line-max"
              />
              <span className="text-[15px]">{t('line.people')}</span>
            </div>
            <p id="plan-line-size-hint" className="m-0 text-[13.5px] text-text-muted">
              {t('line.sizeHint')}
            </p>
            {errors.min ? <FieldError id="plan-line-min-error">{errors.min}</FieldError> : null}
            {errors.max ? <FieldError id="plan-line-max-error">{errors.max}</FieldError> : null}
          </fieldset>

          <TextField
            id="plan-line-cost"
            label={t('line.costPerSession', { currency: model.view.currency })}
            required
            marker={t('required')}
            inputMode="decimal"
            value={form.costPerSession}
            onChange={(event) => {
              set({ costPerSession: event.target.value });
            }}
            hint={line.courseId ? t('line.costFromCourse') : t('line.costHint')}
            error={errors.costPerSession}
            className="max-w-xs"
            data-testid="plan-line-cost"
          />

          <div
            className="flex gap-3 rounded-lg bg-primary-subtle px-4 py-3.5 text-primary-text"
            role="status"
            data-testid="plan-line-preview"
          >
            <Icon name="star" className="mt-0.5 size-4 shrink-0" />
            <div className="flex flex-col gap-1">
              <p className="m-0 font-semibold">{resultText}</p>
              {split ? <p className="m-0 text-sm">{split}</p> : null}
              {sessions?.belowMinimum ? (
                <p className="m-0 text-sm font-semibold text-warning">{t('line.belowMinimum')}</p>
              ) : null}
            </div>
          </div>

          <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 p-0 text-sm font-semibold">
              {t('line.when')}
              <FieldMarker required marker={t('required')} />
            </legend>
            <div
              className="inline-flex w-fit gap-1 rounded-full bg-surface-hover p-1"
              data-testid="plan-line-quarter"
            >
              {QUARTERS.map((q) => (
                <label
                  key={q}
                  className={cn(
                    'relative inline-flex min-h-9 min-w-12 cursor-pointer items-center justify-center rounded-full px-3.5 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring pointer-coarse:min-h-11',
                    form.quarter === q
                      ? 'bg-surface font-semibold text-text shadow-1'
                      : 'text-text-muted hover:text-text',
                  )}
                >
                  <input
                    type="radio"
                    name="plan-line-quarter"
                    value={q}
                    checked={form.quarter === q}
                    onChange={() => {
                      set({ quarter: q });
                    }}
                    className="sr-only"
                    aria-describedby="plan-line-quarter-hint"
                  />
                  {model.quarter(q)}
                </label>
              ))}
            </div>
            <p id="plan-line-quarter-hint" className="m-0 text-[13.5px] text-text-muted">
              {asked.quarter === null
                ? t('line.quarterHintNone')
                : t('line.quarterHint', {
                    asked: asked.asked,
                    count: asked.departments,
                    quarter: model.quarter(asked.quarter),
                  })}
            </p>
          </fieldset>

          <div className="flex flex-col gap-4">
            <button
              type="button"
              aria-expanded={more}
              aria-controls="plan-line-more"
              onClick={() => {
                setMore((open) => !open);
              }}
              className="inline-flex w-fit items-center gap-1.5 rounded-sm text-[15px] font-semibold text-primary-text"
              data-testid="plan-line-more"
            >
              {t('line.more')}
              <Icon name={more ? 'chevron-up' : 'chevron-down'} className="size-4" />
              <span className="font-normal text-text-muted">· {t('line.moreHint')}</span>
            </button>
            {more ? (
              <div id="plan-line-more" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField
                  id="plan-line-cost-person"
                  label={t('line.costPerPerson', { currency: model.view.currency })}
                  marker={t('optional')}
                  inputMode="decimal"
                  value={form.costPerPerson}
                  onChange={(event) => {
                    set({ costPerPerson: event.target.value });
                  }}
                  hint={t('line.costPerPersonHint')}
                  error={errors.costPerPerson}
                />
                <TextField
                  id="plan-line-duration"
                  label={t('line.duration')}
                  marker={t('optional')}
                  inputMode="decimal"
                  value={form.durationHours}
                  onChange={(event) => {
                    set({ durationHours: event.target.value });
                  }}
                  error={errors.durationHours}
                />
                <SelectField
                  id="plan-line-delivery"
                  label={t('line.deliveryType')}
                  marker={t('optional')}
                  value={form.deliveryType}
                  onChange={(event) => {
                    set({ deliveryType: event.target.value as PlanDeliveryType | '' });
                  }}
                >
                  <option value="">{t('line.notSet')}</option>
                  {PLAN_DELIVERY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`deliveryTypes.${type}`)}
                    </option>
                  ))}
                </SelectField>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold">{t('line.course')}</span>
                  <span className="min-h-12 content-center text-[15px] text-text-muted">
                    {line.courseId ? t('line.courseLinked') : t('line.courseNone')}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}
