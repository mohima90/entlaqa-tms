import type { AppLocale } from '@jadarat/platform-i18n';
import type { CycleListItem, CycleStatus, FormStatus } from '@jadarat/tms';
import type { BadgeTone } from '@jadarat/ui';

/** Planning pages helpers (EP-PLN, T-M3-04): pure, unit-tested. */

/** The set-up steps of a draft cycle (business flow B4), in order; the `?step=` of the set-up page. */
export const SETUP_STEPS = ['basics', 'scope', 'budget', 'approvals', 'reminders'] as const;
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
} as const;

export function cycleHref(locale: AppLocale, id: string, step?: SetupStep): string {
  return `/${locale}${PLANNING_PATHS.cycles}/${id}${step ? `?step=${step}` : ''}`;
}

/** A name in the page's language, else the other one. */
export function localName(
  locale: AppLocale,
  name: { readonly ar: string; readonly en: string | null },
): string {
  if (locale === 'en') return name.en !== null && name.en !== '' ? name.en : name.ar;
  return name.ar !== '' ? name.ar : (name.en ?? '');
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

/** Tabs of the cycles list (Kawadir Requisitions: status tabs with counts). */
export const CYCLE_TABS = ['all', 'draft', 'open', 'closed'] as const;
export type CycleTab = (typeof CYCLE_TABS)[number];

export function cycleTab(value: unknown): CycleTab {
  return (CYCLE_TABS as readonly unknown[]).includes(value) ? (value as CycleTab) : 'all';
}

export function filterCycles(
  cycles: readonly CycleListItem[],
  tab: CycleTab,
): readonly CycleListItem[] {
  return tab === 'all' ? cycles : cycles.filter((cycle) => cycle.status === tab);
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
