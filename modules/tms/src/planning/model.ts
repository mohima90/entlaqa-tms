import { z } from 'zod';
import { PLAN_LIMITS, STEP_KINDS, budgetAmountText, isCalendarDay } from './rules';

export * from './rules';

// ---------------------------------------------------------------------------------------------------
// Input schemas (untrusted input; the server actions validate with them)
// ---------------------------------------------------------------------------------------------------

/** Bidirectional embedding/override/isolate marks: never in names (they reorder how text is shown). */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/u;

const visible = (value: string) => /[^\s\u200B-\u200F\u00A0\uFEFF]/u.test(value);

const name = (max: number) =>
  z
    .string()
    .normalize('NFC')
    .trim()
    .min(1)
    .max(max)
    .refine((v) => visible(v) && !/\p{Cc}/u.test(v) && !BIDI_CONTROLS.test(v), {
      message: 'invalid',
    });

const optionalText = (max: number) =>
  z
    .string()
    .normalize('NFC')
    .trim()
    .max(max)
    .refine((v) => !BIDI_CONTROLS.test(v), { message: 'invalid' })
    .transform((v) => (v === '' || !visible(v) ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const CalendarDay = z.string().refine(isCalendarDay, { message: 'invalid_date' });
export const Id = z.uuid();
export const Version = z.int().min(1);

export const CycleBasicsFields = z.strictObject({
  nameAr: name(PLAN_LIMITS.nameMax),
  nameEn: name(PLAN_LIMITS.nameMax),
  periodStart: CalendarDay,
  periodEnd: CalendarDay,
  deadline: CalendarDay,
  instructionsAr: optionalText(PLAN_LIMITS.instructionsMax),
  instructionsEn: optionalText(PLAN_LIMITS.instructionsMax),
  /** The needs form department heads fill in (forms library; none until it merges). */
  needsFormId: Id.nullable()
    .optional()
    .transform((v) => v ?? null),
});

export const CreateCycleInput = CycleBasicsFields;
export type CreateCycleInput = z.output<typeof CreateCycleInput>;

export const UpdateCycleBasicsInput = CycleBasicsFields.extend({ id: Id, version: Version });
export type UpdateCycleBasicsInput = z.output<typeof UpdateCycleBasicsInput>;

export const CycleRef = z.strictObject({ id: Id });
export const CycleVersionRef = z.strictObject({ id: Id, version: Version });

export const SaveScopeInput = z.strictObject({
  id: Id,
  version: Version,
  departmentIds: z
    .array(Id)
    .max(PLAN_LIMITS.maxScopeUnits)
    .transform((ids) => [...new Set(ids)]),
  branchIds: z
    .array(Id)
    .max(PLAN_LIMITS.maxScopeUnits)
    .transform((ids) => [...new Set(ids)]),
});
export type SaveScopeInput = z.output<typeof SaveScopeInput>;

/** An amount as typed: digits with up to 3 decimals ('' = no envelope, Q2). */
export const BudgetAmount = z
  .string()
  .refine((v) => budgetAmountText(v) !== undefined, { message: 'invalid_amount' })
  .transform((v) => budgetAmountText(v) ?? null);

export const SaveBudgetsInput = z.strictObject({
  id: Id,
  version: Version,
  budgets: z
    .array(z.strictObject({ departmentId: Id, amount: BudgetAmount }))
    .max(PLAN_LIMITS.maxScopeUnits),
});
export type SaveBudgetsInput = z.output<typeof SaveBudgetsInput>;

export const StepInput = z.strictObject({
  kind: z.enum(STEP_KINDS),
  nameAr: name(PLAN_LIMITS.stepNameMax),
  nameEn: name(PLAN_LIMITS.stepNameMax),
  approverPersonId: Id.nullable(),
});

/** The chain as sent (its rules — chainIssues — are checked by the handler, with precise field errors). */
const steps = z.array(StepInput).min(1).max(PLAN_LIMITS.maxSteps);

export const SaveStepsInput = z.strictObject({ id: Id, version: Version, steps });
export type SaveStepsInput = z.output<typeof SaveStepsInput>;

export const ReminderDays = z
  .array(z.int().min(PLAN_LIMITS.reminderMinDays).max(PLAN_LIMITS.reminderMaxDays))
  .max(PLAN_LIMITS.maxReminders)
  .refine((days) => new Set(days).size === days.length, { message: 'duplicate' })
  .transform((days) => [...days].sort((a, b) => b - a));

export const SaveRemindersInput = z.strictObject({
  id: Id,
  version: Version,
  reminderDays: ReminderDays,
});
export type SaveRemindersInput = z.output<typeof SaveRemindersInput>;

export const ExtendDeadlineInput = z.strictObject({
  id: Id,
  version: Version,
  deadline: CalendarDay,
});
export type ExtendDeadlineInput = z.output<typeof ExtendDeadlineInput>;

export const SaveSettingsInput = z.strictObject({ reminderDays: ReminderDays, steps });
export type SaveSettingsInput = z.output<typeof SaveSettingsInput>;

export const CyclesListInput = z.strictObject({});
