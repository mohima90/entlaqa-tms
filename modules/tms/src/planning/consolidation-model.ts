import { hasVisibleText } from '@jadarat/platform-i18n/text';
import { z } from 'zod';
import { CONSOLIDATION_LIMITS, PLAN_DELIVERY_TYPES, PLAN_GROUPINGS } from './consolidation-rules';
import { BudgetAmount, Id, Version } from './model';

export * from './consolidation-rules';

/**
 * Input schemas of the training plan's queries and server actions (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06):
 * untrusted input, validated before authorization and the handler run. The same limits as the database
 * (migration 20261115100200).
 */

/** Bidirectional embedding/override/isolate marks: never in texts the approvers and heads read. */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/u;

/** A required one-line text: trimmed, visible, no control or bidirectional marks. */
const requiredText = (max: number) =>
  z
    .string()
    .normalize('NFC')
    .trim()
    .min(1)
    .max(max)
    .refine((v) => hasVisibleText(v) && !/\p{Cc}/u.test(v) && !BIDI_CONTROLS.test(v), {
      message: 'invalid',
    });

/** An optional text: '' or only invisible characters clear it (null). */
const clearableText = (max: number) =>
  z
    .string()
    .normalize('NFC')
    .trim()
    .max(max)
    .refine((v) => !/\p{Cc}/u.test(v) && !BIDI_CONTROLS.test(v), { message: 'invalid' })
    .transform((v) => (v === '' || !hasVisibleText(v) ? null : v))
    .nullable()
    .transform((v) => v ?? null);

/** An amount in the cycle's currency as typed (digits, up to 3 decimals; '' or null: none). */
const Amount = BudgetAmount.nullable().transform((v) => v ?? null);

const PeoplePerSession = z.int().min(1).max(CONSOLIDATION_LIMITS.peoplePerSessionMax).nullable();

export const QuarterInput = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const LineVersion = z.strictObject({ id: Id, version: Version });

const distinctLines = (lines: readonly { readonly id: string }[]) =>
  new Set(lines.map((l) => l.id.toLowerCase())).size === lines.length;

/** The Plan tab of a cycle (and the budget view), or the actions on a cycle. */
export const CyclePlanRef = z.strictObject({ cycleId: Id });
export type CyclePlanRef = z.output<typeof CyclePlanRef>;

/** Adds the needs of departments that resubmitted (D14) to the plan. */
export const PlanRef = z.strictObject({ planId: Id });
export type PlanRef = z.output<typeof PlanRef>;

/**
 * A line's popup (design screen 2): every field is optional — only what is sent changes; null clears a nullable
 * one. The minimum may not exceed the maximum (with the stored values for the one not sent).
 */
export const UpdatePlanLineInput = z.strictObject({
  lineId: Id,
  version: Version,
  title: requiredText(CONSOLIDATION_LIMITS.titleMax).optional(),
  courseId: Id.nullable().optional(),
  deliveryType: z.enum(PLAN_DELIVERY_TYPES).nullable().optional(),
  category: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,80}$/)
    .nullable()
    .optional(),
  quarter: QuarterInput.optional(),
  minPerSession: PeoplePerSession.optional(),
  maxPerSession: PeoplePerSession.optional(),
  costPerSession: Amount.optional(),
  costPerPerson: Amount.optional(),
  durationHours: z
    .number()
    .positive()
    .max(CONSOLIDATION_LIMITS.durationHoursMax)
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, { message: 'decimals' })
    .nullable()
    .optional(),
});
export type UpdatePlanLineInput = z.output<typeof UpdatePlanLineInput>;

/** «Merge» (design screen 1b): the lines with the versions seen, the line that stays and the merged name. */
export const MergePlanLinesInput = z
  .strictObject({
    lines: z.array(LineVersion).min(2).max(50),
    intoLineId: Id,
    title: requiredText(CONSOLIDATION_LIMITS.titleMax),
  })
  .refine((v) => distinctLines(v.lines), { message: 'duplicate', path: ['lines'] })
  .refine((v) => v.lines.some((l) => l.id.toLowerCase() === v.intoLineId.toLowerCase()), {
    message: 'not_in_lines',
    path: ['intoLineId'],
  });
export type MergePlanLinesInput = z.output<typeof MergePlanLinesInput>;

/** «Move out of this line» (design screen 2): the need gets a line of its own (named after it unless said). */
export const MoveNeedOutInput = z.strictObject({
  lineId: Id,
  version: Version,
  needId: Id,
  title: requiredText(CONSOLIDATION_LIMITS.titleMax).optional(),
});
export type MoveNeedOutInput = z.output<typeof MoveNeedOutInput>;

/** «Change quarter» on the ticked lines (bulk bar). */
export const SetLinesQuarterInput = z
  .strictObject({
    lines: z.array(LineVersion).min(1).max(CONSOLIDATION_LIMITS.bulkMax),
    quarter: QuarterInput,
  })
  .refine((v) => distinctLines(v.lines), { message: 'duplicate', path: ['lines'] });
export type SetLinesQuarterInput = z.output<typeof SetLinesQuarterInput>;

/** «Leave out of the plan» (design screen 2b): the reason is required (Q2 = A). */
export const LeaveOutLineInput = z.strictObject({
  lineId: Id,
  version: Version,
  reason: requiredText(CONSOLIDATION_LIMITS.leftOutReasonMax),
});
export type LeaveOutLineInput = z.output<typeof LeaveOutLineInput>;

/** «Bring back» a left-out line, until the plan is submitted. */
export const LineVersionRef = z.strictObject({ lineId: Id, version: Version });
export type LineVersionRef = z.output<typeof LineVersionRef>;

/** A department's over-budget reason (design screen 3): '' or null removes it. */
export const SetBudgetReasonInput = z.strictObject({
  planId: Id,
  departmentId: Id,
  reason: clearableText(CONSOLIDATION_LIMITS.budgetReasonMax),
});
export type SetBudgetReasonInput = z.output<typeof SetBudgetReasonInput>;

export const PlanGroupingInput = z.enum(PLAN_GROUPINGS);
