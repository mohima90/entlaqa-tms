import type { AppLocale } from '@jadarat/platform-i18n';
import { personDisplayName } from '@jadarat/platform-i18n/names';
import type { CycleStatus, FormStatus, ScopeUnitOption } from '@jadarat/tms';
import { type ScopeSelection, departmentsInScope } from '@jadarat/tms/planning-rules';
import type { BadgeTone } from '@jadarat/ui';
import { type LevelLabel, showsUnitLevels, unitNameWithLevel } from './structure-view';

/**
 * Planning pages helpers (EP-PLN, T-M3-04; the Kawadir pattern, WP-UX-01 a / T-M3-20): pure, unit-tested.
 * A cycle is created in one popup on the list, launched from its row menu and — optionally — completed on
 * its own Settings page (forms standard rule 9).
 */

/** The cycles list filtered by its summary cards: `?status=` of the list page (All by default). */
export const LIST_FILTERS = ['all', 'draft', 'open', 'closed'] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

export function listFilter(value: unknown): ListFilter {
  return (LIST_FILTERS as readonly unknown[]).includes(value) ? (value as ListFilter) : 'all';
}

/** The cycles of a filter, in the list's order. «Closed» is everything that is neither a draft nor open. */
export function filterCycles<T extends { readonly status: CycleStatus }>(
  cycles: readonly T[],
  filter: ListFilter,
): readonly T[] {
  switch (filter) {
    case 'all':
      return cycles;
    case 'draft':
    case 'open':
      return cycles.filter((cycle) => cycle.status === filter);
    case 'closed':
      return cycles.filter((cycle) => cycle.status !== 'draft' && cycle.status !== 'open');
  }
}

/** The sections of a draft cycle's Settings page, in order: `?tab=` of the page (the first by default). */
export const SETTINGS_TABS = ['departments', 'instructions', 'reminders', 'form'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function settingsTab(value: unknown): SettingsTab {
  return (SETTINGS_TABS as readonly unknown[]).includes(value)
    ? (value as SettingsTab)
    : 'departments';
}

export const PLANNING_PATHS = {
  cycles: '/suite/planning/cycles',
  settings: '/suite/planning/settings',
  needsForms: '/suite/planning/needs-forms',
  /** Organization → Structure, where a unit's head is picked. */
  structure: '/suite/admin/structure',
} as const;

/** A cycle's page: its progress once launched (a draft's own page is its Settings). */
export function cycleHref(locale: AppLocale, id: string): string {
  return `/${locale}${PLANNING_PATHS.cycles}/${id}`;
}

/** A draft cycle's Settings page, on one of its sections. */
export function cycleSettingsHref(locale: AppLocale, id: string, tab?: SettingsTab): string {
  return `${cycleHref(locale, id)}/settings${tab && tab !== 'departments' ? `?tab=${tab}` : ''}`;
}

/** The cycles list, filtered, or with one of its popups open (`new`, or a draft to edit or launch). */
export function cyclesHref(
  locale: AppLocale,
  options: {
    readonly filter?: ListFilter;
    readonly open?:
      { readonly kind: 'new' } | { readonly kind: 'edit' | 'launch'; readonly id: string };
  } = {},
): string {
  const query = new URLSearchParams();
  if (options.filter && options.filter !== 'all') query.set('status', options.filter);
  if (options.open?.kind === 'new') query.set('new', '1');
  else if (options.open) query.set(options.open.kind, options.open.id);
  const text = query.toString();
  return `/${locale}${PLANNING_PATHS.cycles}${text ? `?${text}` : ''}`;
}

/**
 * Where an address of the old six-step set-up (`/cycles/{id}?step=…`) leads now (old links keep working):
 * the names, period, deadline and departments are the popup on the list; the launch is its question on the
 * list; the rest is a section of the cycle's Settings. The approval chain is gone (EP-PLN §13 e).
 */
export function legacyStepHref(locale: AppLocale, id: string, step: unknown): string {
  switch (step) {
    case 'basics':
      return cyclesHref(locale, { open: { kind: 'edit', id } });
    case 'review':
      return cyclesHref(locale, { open: { kind: 'launch', id } });
    case 'reminders':
      return cycleSettingsHref(locale, id, 'reminders');
    default:
      return cycleSettingsHref(locale, id);
  }
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

/** Days from the organization's today to a deadline (negative once passed); both calendar days. */
export function daysLeft(today: string, deadline: string): number {
  return Math.round(
    (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

// ---------------------------------------------------------------------------------------------------
// Departments of a cycle (the popup's and the Settings page's picker; the launch question)
// ---------------------------------------------------------------------------------------------------

/** A unit of the structure as the pickers need it (tree order; `head`: who receives its form, as text). */
export interface PickerUnit {
  readonly id: string;
  readonly parentId: string | null;
  readonly branchId: string | null;
  readonly name: string;
  readonly depth: number;
  readonly active: boolean;
  /** The head who receives the unit's needs form, as text; null: nobody («No head yet»). */
  readonly head: string | null;
}

/**
 * The structure for the pickers, in the page's language: each unit named with its level when levels mix
 * (guided-test feedback #3) and the head who receives its form — «{name} (from {unit})» when the head
 * comes from a unit above.
 */
export function pickerUnits(
  locale: AppLocale,
  units: readonly ScopeUnitOption[],
  levels: readonly LevelLabel[],
  headVia: (name: string, unit: string) => string,
): PickerUnit[] {
  const withLevels = showsUnitLevels(
    levels,
    units.map((unit) => unit.levelOrdinal),
  );
  return units.map((unit) => ({
    id: unit.id,
    parentId: unit.parentId,
    branchId: unit.branchId,
    name: unitNameWithLevel(
      localName(locale, unit.name),
      unit.levelOrdinal,
      levels,
      locale,
      withLevels,
    ),
    depth: unit.depth,
    active: unit.active,
    head: unit.head
      ? unit.head.via
        ? headVia(localName(locale, unit.head.name), localName(locale, unit.head.via))
        : localName(locale, unit.head.name)
      : null,
  }));
}

/** The units as the scope rule reads them (the list is already in tree order). */
function asStructure(units: readonly PickerUnit[]) {
  return units.map((unit, index) => ({
    id: unit.id,
    parentId: unit.parentId,
    branchId: unit.branchId,
    active: unit.active,
    sortOrder: index,
    nameAr: unit.name,
    headPersonId: unit.head === null ? null : unit.id,
  }));
}

/**
 * The units a scope covers — one needs form each (BR-PLN-a): the picked units and everything under them,
 * and every unit of a picked branch; inactive units get no form. The same rule the server applies.
 */
export function unitsInScope(
  units: readonly PickerUnit[],
  scope: ScopeSelection,
): readonly PickerUnit[] {
  const covered = new Set(departmentsInScope(asStructure(units), scope));
  return units.filter((unit) => covered.has(unit.id));
}

/**
 * «All departments»: the top-level units, each of which includes everything under it — so the units
 * added under them later are in the cycle too.
 */
export function allUnitsScope(units: readonly PickerUnit[]): string[] {
  const ids = new Set(units.map((unit) => unit.id));
  return units
    .filter((unit) => unit.parentId === null || !ids.has(unit.parentId))
    .map((unit) => unit.id);
}

/** How a unit stands in a scope: picked itself, covered by a picked unit above or by its branch, or out. */
export type UnitPick = 'picked' | 'covered' | 'out';

export function unitPicks(
  units: readonly PickerUnit[],
  scope: ScopeSelection,
): ReadonlyMap<string, UnitPick> {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const picked = new Set(scope.departmentIds);
  const branches = new Set(scope.branchIds);
  const coveredFromAbove = (unit: PickerUnit): boolean => {
    let current: PickerUnit | undefined = unit;
    for (let depth = 0; current && depth <= 20; depth += 1) {
      if (current.branchId !== null && branches.has(current.branchId)) return true;
      if (current !== unit && picked.has(current.id)) return true;
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return false;
  };
  return new Map(
    units.map((unit) => [
      unit.id,
      coveredFromAbove(unit) ? 'covered' : picked.has(unit.id) ? 'picked' : 'out',
    ]),
  );
}

/** Two scopes pick the same units and branches (the order does not matter). */
export function sameScope(a: ScopeSelection, b: ScopeSelection): boolean {
  const same = (x: readonly string[], y: readonly string[]) =>
    x.length === y.length && new Set([...x, ...y]).size === x.length;
  return same(a.departmentIds, b.departmentIds) && same(a.branchIds, b.branchIds);
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

/** Reminder days as typed → numbers, or the text key of what is wrong. */
export function parseReminderDays(
  days: readonly string[],
): { readonly ok: true; readonly days: number[] } | { readonly ok: false; readonly key: string } {
  const values = days.map((d) => Number(d.trim() === '' ? Number.NaN : d.trim()));
  if (values.some((v) => !Number.isInteger(v) || v < 1 || v > 90)) {
    return { ok: false, key: 'setup.fieldErrors.dayRange' };
  }
  if (new Set(values).size !== values.length) {
    return { ok: false, key: 'setup.fieldErrors.duplicateDay' };
  }
  return { ok: true, days: values };
}
