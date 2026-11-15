/**
 * Planning keys that client components need on their own (the cycle page's progress table and the planning
 * forms' error texts), kept apart from `planning-view.ts` so that those components do not load the rest of
 * it (bundle budget, CI gate 9). `planning-view.ts` re-exports them.
 */

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

/** Field error codes (ADR 0011) → text keys under `setup.fieldErrors`. */
const FIELD_ERROR_KEYS: Readonly<Record<string, string>> = {
  REQUIRED: 'required',
  TOO_SMALL: 'required',
  INVALID_DATE: 'invalidDate',
  BEFORE_START: 'beforeStart',
  TOO_LONG: 'tooLong',
  AFTER_PERIOD: 'afterPeriod',
  INVALID_AMOUNT: 'invalidAmount',
  NOT_LATER: 'notLater',
  IN_PAST: 'inPast',
  UNKNOWN: 'unknown',
  NOT_IN_SCOPE: 'unknown',
};

export function fieldErrorKey(code: string): string {
  return `setup.fieldErrors.${FIELD_ERROR_KEYS[code] ?? 'invalid'}`;
}
