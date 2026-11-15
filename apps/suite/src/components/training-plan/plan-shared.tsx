'use client';
import type { PlanView } from '@jadarat/tms';
import { Badge, type BadgeTone, cn } from '@jadarat/ui';
import type { BudgetState, PlanDeliveryType, Quarter } from '@jadarat/tms/consolidation-rules';
import {
  type BudgetTone,
  type PlanLine,
  budgetMeter,
  budgetTone,
  planAmount,
  planNumber,
} from '../../lib/training-plan-view';
import type { PlanTexts } from './use-plan-texts';

/** What every part of the Plan tab reads: the view, the texts and the formatters. */
export interface PlanModel {
  readonly locale: 'ar' | 'en';
  readonly view: PlanView;
  readonly texts: PlanTexts;
  readonly amount: (value: string | number) => string;
  readonly number: (value: number) => string;
  readonly departmentName: (id: string) => string;
  readonly departmentHead: (id: string) => string | null;
  readonly quarter: (quarter: number) => string;
  readonly deliveryLabel: (type: PlanDeliveryType | null) => string | null;
  /** L&D may change this line now (the plan is a draft, the line is within their scope). */
  readonly editable: (line: PlanLine) => boolean;
}

export function planModel(locale: 'ar' | 'en', view: PlanView, texts: PlanTexts): PlanModel {
  const names = new Map(view.departments.map((d) => [d.id, d]));
  const local = (name: { readonly ar: string | null; readonly en: string | null } | null) =>
    name === null ? null : locale === 'ar' ? (name.ar ?? name.en) : (name.en ?? name.ar);
  return {
    locale,
    view,
    texts,
    amount: (value) => planAmount(locale, value, view.currency, view.fractionDigits),
    number: (value) => planNumber(locale, value),
    departmentName: (id) => local(names.get(id)?.name ?? null) ?? texts.t('lines.otherDepartment'),
    departmentHead: (id) => local(names.get(id)?.head ?? null),
    quarter: (quarter) => texts.t(`quarter.q${String(quarter)}`),
    deliveryLabel: (type) => (type === null ? null : texts.t(`deliveryTypes.${type}`)),
    editable: (line) => view.can.manage && line.canEdit,
  };
}

export type LineState = 'inPlan' | 'needsCost' | 'leftOut' | 'approved';

/** A line's state; in an approved plan (WP-LD-03, design 6a) the lines in the plan read «Approved». */
export function lineState(
  line: Pick<PlanLine, 'status' | 'cost'>,
  planStatus: string | null = null,
): LineState {
  if (line.status === 'left_out') return 'leftOut';
  if (planStatus === 'approved') return 'approved';
  return line.cost === null ? 'needsCost' : 'inPlan';
}

const STATE_TONE: Record<LineState, BadgeTone> = {
  inPlan: 'brand',
  needsCost: 'warning',
  leftOut: 'neutral',
  approved: 'success',
};

/** «In the plan» · «Needs a cost» · «Left out» (screen 1). */
export function LineStatusBadge({
  line,
  model,
}: {
  readonly line: Pick<PlanLine, 'status' | 'cost'>;
  readonly model: PlanModel;
}) {
  const state = lineState(line, model.view.plan?.status ?? null);
  return (
    <Badge
      tone={STATE_TONE[state]}
      dot={state !== 'leftOut'}
      className={state === 'leftOut' ? 'border-dashed' : undefined}
      data-testid="plan-line-status"
    >
      {model.texts.t(`lineStatus.${state}`)}
    </Badge>
  );
}

/** The quarter of a line: a small chip («Q1»). */
export function QuarterChip({ quarter, model }: { quarter: Quarter; model: PlanModel }) {
  return (
    <span className="inline-flex min-w-9 justify-center rounded-md bg-primary-subtle px-2 py-0.5 text-[13px] font-semibold text-primary-text">
      {model.quarter(quarter)}
    </span>
  );
}

const METER_TONE: Record<BudgetTone, string> = {
  none: '[&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary',
  within: '[&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary',
  amber: '[&::-webkit-progress-value]:bg-warning [&::-moz-progress-bar]:bg-warning',
  red: '[&::-webkit-progress-value]:bg-danger [&::-moz-progress-bar]:bg-danger',
};

/**
 * A budget meter (screen 3): the estimated cost of the envelope, full once over — amber under 10 % over, red
 * from 10 %. A native `<progress>` (no inline style: the CSP allows none), named by the words next to it.
 */
export function BudgetMeter({
  cost,
  envelope,
  state,
  label,
  className,
}: {
  readonly cost: string;
  readonly envelope: string | null;
  readonly state: BudgetState;
  readonly label: string;
  readonly className?: string | undefined;
}) {
  const { value, max } = budgetMeter(cost, envelope);
  return (
    <progress
      aria-label={label}
      value={value}
      max={max}
      className={cn(
        'block h-2 w-full appearance-none overflow-hidden rounded-full border-0 bg-surface-hover [&::-moz-progress-bar]:rounded-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-surface-hover [&::-webkit-progress-value]:rounded-full',
        METER_TONE[budgetTone(state)],
        className,
      )}
    />
  );
}

/** «Within · SAR X left» / «Over by SAR X» with «n % over» (screen 3), in the budget's colour. */
export function BudgetStateText({
  state,
  model,
  compact = false,
}: {
  readonly state: BudgetState;
  readonly model: PlanModel;
  readonly compact?: boolean;
}) {
  const { t } = model.texts;
  if (state.kind === 'none') {
    return <span className="text-sm text-text-muted">{t('budget.noEnvelope')}</span>;
  }
  if (state.kind === 'within') {
    return (
      <span className="flex flex-col">
        <span className="font-semibold text-success">{t('budget.within')}</span>
        <span className="text-sm text-text-muted">
          {t('budget.left', { amount: model.amount(state.left) })}
        </span>
      </span>
    );
  }
  const tone = state.severity === 'red' ? 'text-danger' : 'text-warning';
  return (
    <span className="flex flex-col" data-tone={state.severity}>
      <span className={cn('font-semibold', tone)}>
        {t('budget.overBy', { amount: model.amount(state.overBy) })}
      </span>
      {state.percentOver !== null && !compact ? (
        <span className="text-sm text-text-muted">
          {t('budget.percentOver', { percent: model.number(state.percentOver) })}
        </span>
      ) : null}
    </span>
  );
}
