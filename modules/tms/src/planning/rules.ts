/**
 * Planning cycle rules (EP-PLN, BACKLOG T-M3-04; FR-PLN-02, FR-WFL-01/02 R1 part): pure, no I/O and no
 * validation library — shared by the server (model.ts, definitions) and the browser forms (the
 * `@jadarat/tms/planning-rules` entry keeps the client bundle small).
 */

/**
 * Planning cycle domain model (EP-PLN, BACKLOG T-M3-04; FR-PLN-02, FR-WFL-01/02 R1 part). Pure: no I/O.
 * Business flow docs/business-flows/EP-PLN-planning-cycle.md (agreed by the PO, 17 Oct 2026), steps A3,
 * B4–B5 and C9, rules BR-PLN-a/g/i/j, answers Q1 (one open cycle at a time), Q2 (optional envelopes).
 * The database repeats every rule (migrations 20261020150100–150200); the limits below match its checks.
 */

export const PLAN_LIMITS = {
  nameMax: 120,
  instructionsMax: 4000,
  stepNameMax: 80,
  maxSteps: 10,
  maxReminders: 5,
  reminderMinDays: 1,
  reminderMaxDays: 90,
  /** A planning period of at most two years (731 days after its start). */
  periodMaxDays: 731,
  /** Budget envelope: up to 12 digits before the decimal point. */
  budgetMax: 999_999_999_999,
  maxScopeUnits: 1000,
} as const;

/** BRD Appendix C "TNA campaign". Only draft → open → closed are reachable in T-M3-04. */
export const CYCLE_STATUSES = ['draft', 'open', 'closed', 'consolidated', 'archived'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

/** A department's needs form in the cycle (business flow C9); `late` is derived from the deadline. */
export const FORM_STATUSES = ['not_started', 'draft', 'submitted', 'returned', 'late'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];
export type StoredFormStatus = Exclude<FormStatus, 'late'>;

export const STEP_KINDS = ['department_heads', 'person'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const DEFAULT_REMINDER_DAYS: readonly number[] = [7, 2];

export interface ApprovalStep {
  readonly kind: StepKind;
  readonly nameAr: string;
  readonly nameEn: string;
  /** Named person steps only (null: not named yet). */
  readonly approverPersonId: string | null;
}

/** The built-in default chain (business flow A3): Department Heads → Finance → Management. */
export const DEFAULT_CHAIN: readonly ApprovalStep[] = [
  {
    kind: 'department_heads',
    nameAr: 'رؤساء الأقسام',
    nameEn: 'Department Heads',
    approverPersonId: null,
  },
  { kind: 'person', nameAr: 'اعتماد المالية', nameEn: 'Finance approval', approverPersonId: null },
  {
    kind: 'person',
    nameAr: 'اعتماد الإدارة',
    nameEn: 'Management approval',
    approverPersonId: null,
  },
];

// ---------------------------------------------------------------------------------------------------
// Calendar days ('YYYY-MM-DD', no time zone)
// ---------------------------------------------------------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day written YYYY-MM-DD. */
export function isCalendarDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The calendar day of `now` in `timeZone` (the organization's "today"). */
export function dayInZone(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Default planning period (business flow B4): the NEXT fiscal year of the organization (General settings,
 * fiscal year start month) — the first fiscal year that starts after today.
 */
export function defaultPeriod(
  today: string,
  fiscalYearStartMonth: number,
): { readonly start: string; readonly end: string } {
  const month = Math.min(12, Math.max(1, Math.trunc(fiscalYearStartMonth)));
  const year = Number(today.slice(0, 4));
  const thisYear = `${String(year)}-${String(month).padStart(2, '0')}-01`;
  const start =
    thisYear > today ? thisYear : `${String(year + 1)}-${String(month).padStart(2, '0')}-01`;
  const next = `${String(Number(start.slice(0, 4)) + 1)}${start.slice(4)}`;
  return { start, end: addDays(next, -1) };
}

/** Default deadline for department forms: 30 days from today, within the period. */
export function defaultDeadline(today: string, periodEnd: string): string {
  const deadline = addDays(today, 30);
  return deadline > periodEnd ? periodEnd : deadline;
}

// ---------------------------------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------------------------------

/**
 * The status shown: an open cycle whose deadline has passed is Closed (business flow D10) even before the
 * database row is closed (the next launch, or an action on it, closes it).
 */
export function effectiveCycleStatus(
  status: CycleStatus,
  deadline: string,
  today: string,
): CycleStatus {
  return status === 'open' && deadline < today ? 'closed' : status;
}

/** A department's form status (business flow C9): Late once the deadline has passed without a submission. */
export function formStatus(stored: StoredFormStatus, deadline: string, today: string): FormStatus {
  return stored !== 'submitted' && deadline < today ? 'late' : stored;
}

/** May the deadline still be extended (open, deadline not passed)? */
export function canExtendDeadline(status: CycleStatus, deadline: string, today: string): boolean {
  return status === 'open' && deadline >= today;
}

// ---------------------------------------------------------------------------------------------------
// Scope → departments (one form per department in scope, BR-PLN-a)
// ---------------------------------------------------------------------------------------------------

export interface StructureUnit {
  readonly id: string;
  readonly parentId: string | null;
  readonly branchId: string | null;
  readonly active: boolean;
  readonly sortOrder: number;
  readonly nameAr: string;
  readonly headPersonId: string | null;
}

export interface ScopeSelection {
  readonly departmentIds: readonly string[];
  readonly branchIds: readonly string[];
}

/**
 * The departments of a scope, in tree order: each picked department and everything under it, and every
 * department of a picked branch with everything under it (a unit includes its sub-units — PO, 17 Oct 2026).
 * Inactive units get no form; their active sub-units do. Unknown ids are ignored.
 */
export function departmentsInScope(
  units: readonly StructureUnit[],
  selection: ScopeSelection,
): string[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const children = new Map<string | null, StructureUnit[]>();
  for (const unit of units) {
    const parent = unit.parentId !== null && byId.has(unit.parentId) ? unit.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(unit);
    children.set(parent, list);
  }
  const ordered = (list: readonly StructureUnit[]) =>
    [...list].sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.nameAr.localeCompare(b.nameAr, 'ar') ||
        (a.id < b.id ? -1 : 1),
    );
  const branches = new Set(selection.branchIds);
  const picked = new Set(selection.departmentIds);
  const result: string[] = [];
  const visit = (unit: StructureUnit, covered: boolean, depth: number) => {
    if (depth > 20) return; // the database keeps the tree acyclic and at most 10 levels deep
    const inScope =
      covered || picked.has(unit.id) || (unit.branchId !== null && branches.has(unit.branchId));
    if (inScope && unit.active) result.push(unit.id);
    for (const child of ordered(children.get(unit.id) ?? [])) visit(child, inScope, depth + 1);
  };
  for (const root of ordered(children.get(null) ?? [])) visit(root, false, 0);
  return result;
}

/** Every unit in tree order (siblings by sort order and Arabic name) with its depth (0 = top level). */
export function treeOrder(units: readonly StructureUnit[]): { id: string; depth: number }[] {
  const byId = new Set(units.map((u) => u.id));
  const children = new Map<string | null, StructureUnit[]>();
  for (const unit of units) {
    const parent = unit.parentId !== null && byId.has(unit.parentId) ? unit.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), unit]);
  }
  const ordered = (list: readonly StructureUnit[]) =>
    [...list].sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.nameAr.localeCompare(b.nameAr, 'ar') ||
        (a.id < b.id ? -1 : 1),
    );
  const result: { id: string; depth: number }[] = [];
  const visit = (unit: StructureUnit, depth: number) => {
    if (depth > 20) return;
    result.push({ id: unit.id, depth });
    for (const child of ordered(children.get(unit.id) ?? [])) visit(child, depth + 1);
  };
  for (const root of ordered(children.get(null) ?? [])) visit(root, 0);
  return result;
}

/** An amount in its canonical form: "0012.500" → "12.5", "50000.0000" → "50000" (null stays null). */
export function canonicalAmount(value: string | null): string | null {
  if (value === null) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const decimals = fraction.replace(/0+$/, '');
  return decimals ? `${integer}.${decimals}` : integer;
}

/**
 * The head who receives a department's form: its own head, else the nearest head above (EP-ORG: units
 * without their own head belong to the nearest head above). null: nobody — warned before launch.
 */
export function effectiveHead(
  units: readonly StructureUnit[],
  departmentId: string,
): { readonly personId: string; readonly fromDepartmentId: string } | null {
  const byId = new Map(units.map((u) => [u.id, u]));
  let current = byId.get(departmentId);
  for (let depth = 0; current && depth <= 20; depth += 1) {
    if (current.headPersonId)
      return { personId: current.headPersonId, fromDepartmentId: current.id };
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Launch readiness (business flow B5)
// ---------------------------------------------------------------------------------------------------

export const LAUNCH_PROBLEMS = [
  'deadline_past',
  'no_departments',
  'no_approver_step',
  'approver_missing',
  'approver_inactive',
  'another_open',
] as const;
export type LaunchProblem = (typeof LAUNCH_PROBLEMS)[number];

export interface LaunchFacts {
  readonly status: CycleStatus;
  readonly deadline: string;
  readonly today: string;
  readonly departmentCount: number;
  readonly steps: readonly ApprovalStep[];
  /** Persons who are active members now. */
  readonly activeMemberIds: ReadonlySet<string>;
  /** Another cycle of the organization is open with its deadline not passed (a passed one is closed first). */
  readonly anotherOpen: boolean;
}

/** What stops the launch, in the order the set-up page shows it (same checks as the database guard). */
export function launchProblems(facts: LaunchFacts): LaunchProblem[] {
  const problems: LaunchProblem[] = [];
  if (facts.deadline < facts.today) problems.push('deadline_past');
  if (facts.departmentCount === 0) problems.push('no_departments');
  const people = facts.steps.filter((s) => s.kind === 'person');
  if (people.length === 0) problems.push('no_approver_step');
  if (people.some((s) => s.approverPersonId === null)) problems.push('approver_missing');
  if (
    people.some(
      (s) => s.approverPersonId !== null && !facts.activeMemberIds.has(s.approverPersonId),
    )
  ) {
    problems.push('approver_inactive');
  }
  if (facts.anotherOpen) problems.push('another_open');
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// Field rules (the handlers return them as field errors; the forms check them first)
// ---------------------------------------------------------------------------------------------------

export interface BasicsShape {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly deadline: string;
}

/** Period and deadline rules (database checks plan_cycles_period_check / _deadline_check). */
export function basicsIssues(value: BasicsShape): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (!isCalendarDay(value.periodStart) || !isCalendarDay(value.periodEnd)) return issues;
  if (value.periodEnd <= value.periodStart) {
    issues.push({ path: 'periodEnd', message: 'before_start' });
  } else if (daysBetween(value.periodStart, value.periodEnd) > PLAN_LIMITS.periodMaxDays) {
    issues.push({ path: 'periodEnd', message: 'too_long' });
  }
  if (isCalendarDay(value.deadline) && value.deadline > value.periodEnd) {
    issues.push({ path: 'deadline', message: 'after_period' });
  }
  return issues;
}

/** Rule problems as field errors (SCREAMING_SNAKE codes, ADR 0011 §3) — checked by the handlers. */
export function toFieldErrors(
  issues: readonly {
    readonly path: string | readonly (string | number)[];
    readonly message: string;
  }[],
): { path: string; code: string }[] {
  return issues.map((issue) => ({
    path: typeof issue.path === 'string' ? issue.path : issue.path.map(String).join('.'),
    code: issue.message.toUpperCase(),
  }));
}

/** Chain rules (BR-PLN-g and the database's unique indexes); `requireNamed`: every person step named. */
export function chainIssues(
  steps: readonly ApprovalStep[],
  requireNamed: boolean,
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  let heads = 0;
  const seen = new Map<string, number>();
  steps.forEach((step, index) => {
    if (step.kind === 'department_heads') {
      heads += 1;
      if (heads > 1) issues.push({ path: ['steps', index, 'kind'], message: 'second_heads_step' });
      if (step.approverPersonId !== null) {
        issues.push({ path: ['steps', index, 'approverPersonId'], message: 'heads_step_named' });
      }
      return;
    }
    if (step.approverPersonId === null) {
      if (requireNamed) {
        issues.push({ path: ['steps', index, 'approverPersonId'], message: 'required' });
      }
      return;
    }
    if (seen.has(step.approverPersonId)) {
      // BR-PLN-g: one person cannot be the approver of two steps in the same chain.
      issues.push({ path: ['steps', index, 'approverPersonId'], message: 'duplicate_approver' });
    } else {
      seen.set(step.approverPersonId, index);
    }
  });
  return issues;
}

/** An amount as typed: digits with up to 3 decimals, separators ignored; '' = no envelope (Q2). */
export function budgetAmountText(value: string): string | null | undefined {
  const plain = value.trim().replace(/[,\s\u066C]/gu, '');
  if (plain === '') return null;
  return /^\d{1,12}(\.\d{1,3})?$/.test(plain) ? plain : undefined;
}
