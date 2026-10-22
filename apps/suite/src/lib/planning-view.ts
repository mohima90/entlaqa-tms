import type { AppLocale } from '@jadarat/platform-i18n';
import { personDisplayName } from '@jadarat/platform-i18n/names';
import type { CycleListItem, CycleStatus, FormStatus } from '@jadarat/tms';
import type { LaunchProblem } from '@jadarat/tms/planning-rules';
import type { BadgeTone } from '@jadarat/ui';

/** Planning pages helpers (EP-PLN, T-M3-04): pure, unit-tested. */

/**
 * The set-up steps of a draft cycle (business flow B4), in order; the `?step=` of the set-up page. The last,
 * «Review & launch» (redesign package 4), lists the launch problems and launches.
 */
export const SETUP_STEPS = [
  'basics',
  'scope',
  'budget',
  'approvals',
  'reminders',
  'review',
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export function setupStep(value: unknown): SetupStep {
  return (SETUP_STEPS as readonly unknown[]).includes(value) ? (value as SetupStep) : 'basics';
}

export function nextStep(step: SetupStep): SetupStep | null {
  return SETUP_STEPS[SETUP_STEPS.indexOf(step) + 1] ?? null;
}

export function previousStep(step: SetupStep): SetupStep | null {
  const index = SETUP_STEPS.indexOf(step);
  return index > 0 ? (SETUP_STEPS[index - 1] ?? null) : null;
}

export const PLANNING_PATHS = {
  cycles: '/suite/planning/cycles',
  newCycle: '/suite/planning/cycles/new',
  settings: '/suite/planning/settings',
  needsForms: '/suite/planning/needs-forms',
} as const;

export function cycleHref(locale: AppLocale, id: string, step?: SetupStep): string {
  return `/${locale}${PLANNING_PATHS.cycles}/${id}${step ? `?step=${step}` : ''}`;
}

/** A name in the page's language, else the other one (a person may have an English name only). */
export function localName(
  locale: AppLocale,
  name: { readonly ar: string | null; readonly en: string | null },
): string {
  return personDisplayName(locale, name.ar, name.en);
}

export const CYCLE_TONE: Readonly<Record<CycleStatus, BadgeTone>> = {
  draft: 'neutral',
  open: 'success',
  closed: 'info',
  consolidated: 'info',
  archived: 'neutral',
};

export const FORM_TONE: Readonly<Record<FormStatus, BadgeTone>> = {
  not_started: 'neutral',
  draft: 'info',
  submitted: 'success',
  returned: 'warning',
  late: 'danger',
};

/**
 * The cycles list grouped by status (redesign package 4, PO rule «grouping lists by status»): the open
 * cycle first (a card with its progress), then the drafts, then everything closed — in the list's order.
 */
export function groupCycles(cycles: readonly CycleListItem[]): {
  readonly open: readonly CycleListItem[];
  readonly drafts: readonly CycleListItem[];
  readonly closed: readonly CycleListItem[];
} {
  return {
    open: cycles.filter((cycle) => cycle.status === 'open'),
    drafts: cycles.filter((cycle) => cycle.status === 'draft'),
    closed: cycles.filter((cycle) => cycle.status !== 'open' && cycle.status !== 'draft'),
  };
}

/** Days from the organization's today to a deadline (negative once passed); both calendar days. */
export function daysLeft(today: string, deadline: string): number {
  return Math.round(
    (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

/** Optional set-up steps (marked «optional» in the step list; no launch problem belongs to them). */
export const OPTIONAL_STEPS: readonly SetupStep[] = ['budget', 'reminders'];

/**
 * The step that fixes a launch problem (Review & launch: «Go to {step}»). `another_open` is fixed outside
 * the cycle (the open cycle), so it has none.
 */
export const PROBLEM_STEP: Readonly<Record<LaunchProblem, SetupStep | null>> = {
  deadline_past: 'basics',
  no_needs_form: 'basics',
  no_departments: 'scope',
  no_approver_step: 'approvals',
  approver_missing: 'approvals',
  approver_inactive: 'approvals',
  another_open: null,
};

export type StepMark = 'done' | 'problem' | 'todo';

/**
 * The mark of each set-up step in the step list, from today's launch problems: «!» when a problem belongs
 * to it, ✓ for the required steps without one, a plain number for the optional steps and the review.
 */
export function stepMarks(
  problems: readonly LaunchProblem[],
): Readonly<Record<SetupStep, StepMark>> {
  const flagged = new Set(problems.map((problem) => PROBLEM_STEP[problem]));
  const mark = (step: SetupStep): StepMark =>
    flagged.has(step)
      ? 'problem'
      : step === 'review' || OPTIONAL_STEPS.includes(step)
        ? 'todo'
        : 'done';
  return {
    basics: mark('basics'),
    scope: mark('scope'),
    budget: mark('budget'),
    approvals: mark('approvals'),
    reminders: mark('reminders'),
    review: mark('review'),
  };
}

/** The progress table's status chips (cycle overview): All, then every form status. */
export const STATUS_FILTERS = [
  'all',
  'not_started',
  'draft',
  'submitted',
  'returned',
  'late',
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** How many units have each form status (the chips' counts). */
export function statusCounts(
  statuses: readonly FormStatus[],
): Readonly<Record<StatusFilter, number>> {
  const count = (status: FormStatus) => statuses.filter((s) => s === status).length;
  return {
    all: statuses.length,
    not_started: count('not_started'),
    draft: count('draft'),
    submitted: count('submitted'),
    returned: count('returned'),
    late: count('late'),
  };
}

/** The sum of envelopes as typed or stored (null/empty ones count as nothing). */
export function sumAmounts(amounts: readonly (string | null)[]): number {
  return amounts.reduce((total, amount) => {
    const value = amount === null || amount.trim() === '' ? 0 : Number(amount.replace(/,/g, ''));
    return Number.isFinite(value) ? total + value : total;
  }, 0);
}

/** Field error codes (ADR 0011) → text keys under `setup.fieldErrors`. */
const FIELD_ERROR_KEYS: Readonly<Record<string, string>> = {
  REQUIRED: 'required',
  TOO_SMALL: 'required',
  INVALID_DATE: 'invalidDate',
  BEFORE_START: 'beforeStart',
  TOO_LONG: 'tooLong',
  AFTER_PERIOD: 'afterPeriod',
  INVALID_AMOUNT: 'invalidAmount',
  DUPLICATE_APPROVER: 'duplicateApprover',
  SECOND_HEADS_STEP: 'secondHeadsStep',
  HEADS_STEP_NAMED: 'headsStepNamed',
  NOT_A_MEMBER: 'notAMember',
  NOT_LATER: 'notLater',
  IN_PAST: 'inPast',
  UNKNOWN: 'unknown',
  NOT_IN_SCOPE: 'unknown',
};

export function fieldErrorKey(code: string): string {
  return `setup.fieldErrors.${FIELD_ERROR_KEYS[code] ?? 'invalid'}`;
}

/** The departments' form statuses in numbers (cycle progress, business flow C9). */
export function progressCounts(statuses: readonly FormStatus[]): {
  readonly departments: number;
  readonly notStarted: number;
  readonly submitted: number;
  readonly late: number;
} {
  return {
    departments: statuses.length,
    notStarted: statuses.filter((s) => s === 'not_started').length,
    submitted: statuses.filter((s) => s === 'submitted').length,
    late: statuses.filter((s) => s === 'late').length,
  };
}
