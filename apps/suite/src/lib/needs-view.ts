import type { AppLocale } from '@jadarat/platform-i18n';
import type { FormStatus } from '@jadarat/tms';
import type { BadgeTone } from '@jadarat/ui';
import { PLANNING_PATHS } from './planning-view';

/** Department needs pages helpers (WP-LD-01, T-M3-05): pure, unit-tested. */

export const NEEDS_PATHS = {
  /** The Department Head's list: one task per department they head in the open cycle. */
  mine: '/suite/my-team/needs',
} as const;

/** The head's needs page of one department in a cycle. */
export function myNeedsHref(locale: AppLocale, cycleId: string, departmentId: string): string {
  return `/${locale}${NEEDS_PATHS.mine}/${cycleId}/${departmentId}`;
}

/** The L&D Manager's read-only view of a department's needs («View» on the cycle's progress). */
export function cycleDepartmentHref(
  locale: AppLocale,
  cycleId: string,
  departmentId: string,
): string {
  return `/${locale}${PLANNING_PATHS.cycles}/${cycleId}/departments/${departmentId}`;
}

export const NEEDS_TONE: Readonly<Record<FormStatus, BadgeTone>> = {
  not_started: 'neutral',
  draft: 'info',
  submitted: 'success',
  returned: 'warning',
  late: 'danger',
};

const FIELD_ERROR_KEYS: Readonly<Record<string, string>> = {
  REQUIRED: 'required',
  INVALID: 'invalid',
  PERSON_NOT_ALLOWED: 'personNotAllowed',
  FEWER_THAN_NAMED: 'fewerThanNamed',
  UNKNOWN: 'unknownCourse',
  INVALID_AMOUNT: 'invalidAmount',
  TOO_BIG: 'tooLong',
  TOO_LONG: 'tooLong',
  NOT_LATER: 'notLater',
  IN_PAST: 'inPast',
  AFTER_PERIOD: 'afterPeriod',
};

/** The message key (namespace `needsEntry`) of a field error code; unknown codes get the general one. */
export function needsFieldErrorKey(code: string): string {
  return `fieldErrors.${FIELD_ERROR_KEYS[code] ?? 'invalid'}`;
}

/** The task's call to action by status: start, continue, or look. */
export function taskAction(status: FormStatus, entryOpen: boolean): 'enter' | 'continue' | 'view' {
  if (!entryOpen || status === 'submitted') return 'view';
  return status === 'not_started' ? 'enter' : 'continue';
}
