import type { UserTx } from '@jadarat/platform-db';
import { type SQL, sql } from 'drizzle-orm';
import {
  type ApprovalStep,
  type CycleStatus,
  DEFAULT_CHAIN,
  DEFAULT_REMINDER_DAYS,
  type StoredFormStatus,
  canonicalAmount,
  latestDeadline,
} from './model';

/**
 * Data access for the planning cycle (schema `tms`, migrations 20261020150100–150200). Runs inside the
 * action's withUserTx transaction: row-level security limits every row to the claims' organization and
 * lets only tms.plan_cycle.manage holders write; the database guard enforces the state model. Platform data
 * (structure, people, General settings) comes from platform-db services, never from here.
 */

type Row = Record<string, unknown>;

const day = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const text = (value: unknown): string | null =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;
const smallints = (value: unknown): number[] => {
  if (Array.isArray(value)) return value.map(Number);
  const raw = typeof value === 'string' ? value.replace(/[{}\s]/g, '') : '';
  return raw ? raw.split(',').map(Number) : [];
};
const pgArray = (values: readonly (string | number)[]) => `{${values.join(',')}}`;

/** SQLSTATE and message of a database error (postgres.js, possibly wrapped by Drizzle). */
export function dbError(
  error: unknown,
): { code: string; constraint?: string; message: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const e = current as {
      code?: unknown;
      constraint_name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      return {
        code: e.code,
        ...(typeof e.constraint_name === 'string' ? { constraint: e.constraint_name } : {}),
        message: typeof e.message === 'string' ? e.message : '',
      };
    }
    current = e.cause;
  }
  return null;
}

/** The organization's "today" (its time zone; database function private.plan_cycle_today). */
export async function organizationToday(tx: UserTx): Promise<string> {
  const [row] = await tx.execute<{ today: unknown }>(
    sql`select private.plan_cycle_today((select private.current_tenant_id())) as today`,
  );
  return day(row?.today);
}

// ---------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------

export interface CycleSummaryRow {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly deadline: string;
  /** The latest deadline of the cycle or any department's extension (WP-LD-01): decides Open/Closed. */
  readonly latestDeadline: string;
  readonly status: CycleStatus;
  readonly departmentCount: number;
  readonly submittedCount: number;
  readonly launchedAt: Date | null;
  readonly createdAt: Date;
}

export async function listCycles(tx: UserTx): Promise<CycleSummaryRow[]> {
  const rows = await tx.execute(sql`
    select c.id, c.name_ar, c.name_en, c.period_start_on, c.period_end_on, c.deadline_on, c.status,
           c.launched_at, c.created_at,
           (select greatest(c.deadline_on, max(d.deadline_on)) from tms.plan_cycle_departments d
            where d.tenant_id = c.tenant_id and d.cycle_id = c.id) as latest_deadline,
           (select count(*) from tms.plan_cycle_departments d where d.tenant_id = c.tenant_id and d.cycle_id = c.id)
             as department_count,
           (select count(*) from tms.plan_cycle_departments d
            where d.tenant_id = c.tenant_id and d.cycle_id = c.id and d.status = 'submitted') as submitted_count
    from tms.plan_cycles c
    order by c.created_at desc, c.id
    limit 500`);
  return rows.map((r: Row) => ({
    id: String(r.id),
    nameAr: String(r.name_ar),
    nameEn: String(r.name_en),
    periodStart: day(r.period_start_on),
    periodEnd: day(r.period_end_on),
    deadline: day(r.deadline_on),
    latestDeadline: day(r.latest_deadline ?? r.deadline_on),
    status: r.status as CycleStatus,
    departmentCount: Number(r.department_count),
    submittedCount: Number(r.submitted_count),
    launchedAt: r.launched_at ? new Date(r.launched_at as string) : null,
    createdAt: new Date(r.created_at as string),
  }));
}

export interface CycleRecord {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly deadline: string;
  /** The latest deadline of the cycle or any department's extension (WP-LD-01). */
  readonly latestDeadline: string;
  readonly instructionsAr: string | null;
  readonly instructionsEn: string | null;
  readonly needsFormId: string | null;
  readonly reminderDays: readonly number[];
  readonly currency: string;
  readonly status: CycleStatus;
  readonly launchedAt: Date | null;
  readonly launchedBy: string | null;
  readonly closedAt: Date | null;
  readonly version: number;
  readonly scope: {
    readonly departmentIds: readonly string[];
    readonly branchIds: readonly string[];
  };
  readonly departments: readonly {
    readonly departmentId: string;
    readonly budgetAmount: string | null;
    readonly status: StoredFormStatus;
    /** The department's own extension (WP-LD-01), or null. */
    readonly deadline: string | null;
  }[];
  readonly steps: readonly ApprovalStep[];
}

export async function getCycle(tx: UserTx, id: string): Promise<CycleRecord | null> {
  const [row] = await tx.execute(sql`
    select id, name_ar, name_en, period_start_on, period_end_on, deadline_on, instructions_ar, instructions_en,
           needs_form_id, reminder_days, currency, status, launched_at, launched_by, closed_at, version
    from tms.plan_cycles where id = ${id}`);
  if (!row) return null;
  const scope = await tx.execute(sql`
    select department_id, branch_id from tms.plan_cycle_scope where cycle_id = ${id} order by created_at, id`);
  const departments = await tx.execute(sql`
    select department_id, budget_amount::text as budget_amount, status, deadline_on
    from tms.plan_cycle_departments where cycle_id = ${id} order by created_at, id`);
  const steps = await tx.execute(sql`
    select kind, name_ar, name_en, approver_person_id from tms.plan_cycle_steps
    where cycle_id = ${id} order by position`);
  return {
    id: String(row.id),
    nameAr: String(row.name_ar),
    nameEn: String(row.name_en),
    periodStart: day(row.period_start_on),
    periodEnd: day(row.period_end_on),
    deadline: day(row.deadline_on),
    latestDeadline: latestDeadline(
      day(row.deadline_on),
      departments.map((d: Row) => (d.deadline_on ? day(d.deadline_on) : null)),
    ),
    instructionsAr: text(row.instructions_ar),
    instructionsEn: text(row.instructions_en),
    needsFormId: text(row.needs_form_id),
    reminderDays: smallints(row.reminder_days),
    currency: String(row.currency),
    status: row.status as CycleStatus,
    launchedAt: row.launched_at ? new Date(row.launched_at as string) : null,
    launchedBy: text(row.launched_by),
    closedAt: row.closed_at ? new Date(row.closed_at as string) : null,
    version: Number(row.version),
    scope: {
      departmentIds: scope.flatMap((s: Row) =>
        typeof s.department_id === 'string' ? [s.department_id] : [],
      ),
      branchIds: scope.flatMap((s: Row) => (typeof s.branch_id === 'string' ? [s.branch_id] : [])),
    },
    departments: departments.map((d: Row) => ({
      departmentId: String(d.department_id),
      budgetAmount: normalizeAmount(text(d.budget_amount)),
      status: d.status as StoredFormStatus,
      deadline: d.deadline_on ? day(d.deadline_on) : null,
    })),
    steps: steps.map((s: Row) => ({
      kind: s.kind === 'department_heads' ? 'department_heads' : 'person',
      nameAr: String(s.name_ar),
      nameEn: String(s.name_en),
      approverPersonId: text(s.approver_person_id),
    })),
  };
}

/** "1200.5000" → "1200.5"; "50000.0000" → "50000". */
export const normalizeAmount = canonicalAmount;

/** Another cycle of the organization is open (any deadline). */
export async function openCycle(
  tx: UserTx,
  exceptId: string | null,
): Promise<{ readonly id: string; readonly deadline: string } | null> {
  const [row] = await tx.execute(sql`
    select id, deadline_on from tms.plan_cycles
    where status = 'open' and (${exceptId}::uuid is null or id <> ${exceptId}::uuid) limit 1`);
  return row ? { id: String(row.id), deadline: day(row.deadline_on) } : null;
}

export interface PlanningSettingsRecord {
  /** null: never saved (the built-in defaults apply). */
  readonly version: number | null;
  readonly reminderDays: readonly number[];
  readonly steps: readonly ApprovalStep[];
}

export async function getSettings(tx: UserTx): Promise<PlanningSettingsRecord> {
  const [row] = await tx.execute(
    sql`select reminder_days, version from tms.planning_settings limit 1`,
  );
  const steps = await tx.execute(sql`
    select kind, name_ar, name_en, approver_person_id from tms.planning_default_steps order by position`);
  return {
    version: row ? Number(row.version) : null,
    reminderDays: row ? smallints(row.reminder_days) : DEFAULT_REMINDER_DAYS,
    steps:
      steps.length > 0
        ? steps.map((s: Row) => ({
            kind: s.kind === 'department_heads' ? 'department_heads' : 'person',
            nameAr: String(s.name_ar),
            nameEn: String(s.name_en),
            approverPersonId: text(s.approver_person_id),
          }))
        : DEFAULT_CHAIN,
  };
}

// ---------------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------------

export interface CycleBasics {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly deadline: string;
  readonly instructionsAr: string | null;
  readonly instructionsEn: string | null;
  readonly needsFormId: string | null;
}

async function insertSteps(
  tx: UserTx,
  table: 'cycle' | 'defaults',
  cycleId: string | null,
  steps: readonly ApprovalStep[],
) {
  for (const [index, step] of steps.entries()) {
    const values: SQL =
      table === 'cycle'
        ? sql`insert into tms.plan_cycle_steps (cycle_id, position, kind, name_ar, name_en, approver_person_id)
              values (${cycleId}, ${index + 1}, ${step.kind}, ${step.nameAr}, ${step.nameEn}, ${step.approverPersonId})`
        : sql`insert into tms.planning_default_steps (position, kind, name_ar, name_en, approver_person_id)
              values (${index + 1}, ${step.kind}, ${step.nameAr}, ${step.nameEn}, ${step.approverPersonId})`;
    await tx.execute(values);
  }
}

/** A new draft with the organization's default reminders and approval chain (business flow B4). */
export async function insertCycle(
  tx: UserTx,
  basics: CycleBasics,
): Promise<{ id: string; version: number; needsFormId: string | null }> {
  const settings = await getSettings(tx);
  const [row] = await tx.execute(sql`
    insert into tms.plan_cycles (name_ar, name_en, period_start_on, period_end_on, deadline_on, instructions_ar,
                                 instructions_en, needs_form_id, reminder_days)
    values (${basics.nameAr}, ${basics.nameEn}, ${basics.periodStart}, ${basics.periodEnd}, ${basics.deadline},
            ${basics.instructionsAr}, ${basics.instructionsEn}, ${basics.needsFormId},
            ${pgArray(settings.reminderDays)}::smallint[])
    returning id`);
  const id = String(row?.id);
  // A default approver who is no longer an active member is left for the L&D Manager to name again.
  await insertSteps(tx, 'cycle', id, settings.steps);
  // Read back: the database sets the default needs form when none was chosen (C-10: the audit says which).
  const [touched] = await tx.execute(
    sql`select version, needs_form_id from tms.plan_cycles where id = ${id}`,
  );
  const needsFormId = touched?.needs_form_id;
  return {
    id,
    version: Number(touched?.version),
    needsFormId: typeof needsFormId === 'string' ? needsFormId : null,
  };
}

export type TouchOutcome =
  | { readonly outcome: 'ok'; readonly version: number }
  | { readonly outcome: 'not_found' | 'conflict' | 'not_draft' };

/**
 * Locks the cycle for a change and checks it: exists, still at `version` (optimistic concurrency, ADR
 * 0011) and — unless `allowOpen` — still a draft. Bumps the version on success (the change is one more
 * version of the cycle).
 */
export async function touchCycle(
  tx: UserTx,
  id: string,
  version: number,
  options: { readonly draftOnly: boolean } = { draftOnly: true },
): Promise<TouchOutcome> {
  const [row] = await tx.execute(
    sql`select status, version from tms.plan_cycles where id = ${id} for update`,
  );
  if (!row) return { outcome: 'not_found' };
  if (Number(row.version) !== version) return { outcome: 'conflict' };
  if (options.draftOnly && row.status !== 'draft') return { outcome: 'not_draft' };
  const [updated] = await tx.execute(sql`
    update tms.plan_cycles set name_ar = name_ar where id = ${id} returning version`);
  if (!updated) return { outcome: 'not_found' };
  return { outcome: 'ok', version: Number(updated.version) };
}

export async function updateBasics(tx: UserTx, id: string, basics: CycleBasics): Promise<number> {
  const [row] = await tx.execute(sql`
    update tms.plan_cycles set name_ar = ${basics.nameAr}, name_en = ${basics.nameEn},
           period_start_on = ${basics.periodStart}, period_end_on = ${basics.periodEnd},
           deadline_on = ${basics.deadline}, instructions_ar = ${basics.instructionsAr},
           instructions_en = ${basics.instructionsEn}, needs_form_id = ${basics.needsFormId}
    where id = ${id} returning version`);
  return Number(row?.version);
}

/**
 * Replaces the scope and brings the departments (one form each) in line with it: rows of departments no
 * longer in scope go (with their envelopes), new ones are added, kept ones keep their envelope.
 */
export async function replaceScope(
  tx: UserTx,
  id: string,
  selection: { readonly departmentIds: readonly string[]; readonly branchIds: readonly string[] },
  departmentIds: readonly string[],
): Promise<void> {
  await tx.execute(sql`delete from tms.plan_cycle_scope where cycle_id = ${id}`);
  for (const departmentId of selection.departmentIds) {
    await tx.execute(
      sql`insert into tms.plan_cycle_scope (cycle_id, department_id) values (${id}, ${departmentId})`,
    );
  }
  for (const branchId of selection.branchIds) {
    await tx.execute(
      sql`insert into tms.plan_cycle_scope (cycle_id, branch_id) values (${id}, ${branchId})`,
    );
  }
  await syncDepartments(tx, id, departmentIds);
}

export async function syncDepartments(
  tx: UserTx,
  id: string,
  departmentIds: readonly string[],
): Promise<void> {
  const wanted = pgArray(departmentIds);
  await tx.execute(sql`
    delete from tms.plan_cycle_departments
    where cycle_id = ${id} and not (department_id = any (${wanted}::uuid[]))`);
  await tx.execute(sql`
    insert into tms.plan_cycle_departments (cycle_id, department_id)
    select ${id}, d from unnest(${wanted}::uuid[]) with ordinality as x (d, n)
    where not exists (select 1 from tms.plan_cycle_departments p where p.cycle_id = ${id} and p.department_id = x.d)
    order by x.n`);
}

/** Sets the envelopes of departments in the cycle (others are ignored); null removes one (Q2). */
export async function updateBudgets(
  tx: UserTx,
  id: string,
  budgets: readonly { readonly departmentId: string; readonly amount: string | null }[],
): Promise<number> {
  let changed = 0;
  for (const budget of budgets) {
    const rows = await tx.execute(sql`
      update tms.plan_cycle_departments set budget_amount = ${budget.amount}::numeric
      where cycle_id = ${id} and department_id = ${budget.departmentId}
        and budget_amount is distinct from ${budget.amount}::numeric
      returning id`);
    changed += rows.length;
  }
  return changed;
}

export async function replaceSteps(
  tx: UserTx,
  id: string,
  steps: readonly ApprovalStep[],
): Promise<void> {
  await tx.execute(sql`delete from tms.plan_cycle_steps where cycle_id = ${id}`);
  await insertSteps(tx, 'cycle', id, steps);
}

export async function updateReminders(
  tx: UserTx,
  id: string,
  days: readonly number[],
): Promise<number> {
  const [row] = await tx.execute(sql`
    update tms.plan_cycles set reminder_days = ${pgArray(days)}::smallint[] where id = ${id} returning version`);
  return Number(row?.version);
}

/**
 * Closes open cycles whose every deadline has passed — the cycle's and any department's extension (WP-LD-01,
 * Q3; the guard refuses it earlier); returns their ids.
 */
export async function closeDueCycles(tx: UserTx): Promise<string[]> {
  const rows = await tx.execute(sql`
    update tms.plan_cycles c set status = 'closed'
    where c.status = 'open' and c.deadline_on < private.plan_cycle_today(c.tenant_id)
      and not exists (select 1 from tms.plan_cycle_departments d
                      where d.tenant_id = c.tenant_id and d.cycle_id = c.id
                        and d.deadline_on >= private.plan_cycle_today(c.tenant_id))
    returning c.id`);
  return rows.map((r: Row) => String(r.id));
}

export type LaunchOutcome =
  | { readonly outcome: 'launched'; readonly version: number }
  | { readonly outcome: 'another_open' }
  | { readonly outcome: 'not_ready'; readonly reason: string };

/** draft → open; the database checks readiness again (JK002 / JK003 / the one-open index). */
export async function launch(tx: UserTx, id: string): Promise<LaunchOutcome> {
  try {
    const [row] = await tx.execute(sql`
      update tms.plan_cycles set status = 'open' where id = ${id} and status = 'draft' returning version`);
    return { outcome: 'launched', version: Number(row?.version) };
  } catch (error) {
    const pg = dbError(error);
    if (
      pg?.code === 'JK002' ||
      (pg?.code === '23505' && pg.constraint === 'plan_cycles_one_open_uq')
    ) {
      return { outcome: 'another_open' };
    }
    if (pg?.code === 'JK003') {
      return { outcome: 'not_ready', reason: /: ([a-z_]+)$/.exec(pg.message)?.[1] ?? 'unknown' };
    }
    throw error;
  }
}

export type DeadlineOutcome =
  { readonly outcome: 'extended'; readonly version: number } | { readonly outcome: 'refused' };

export async function extendDeadline(
  tx: UserTx,
  id: string,
  deadline: string,
): Promise<DeadlineOutcome> {
  try {
    const [row] = await tx.execute(sql`
      update tms.plan_cycles set deadline_on = ${deadline} where id = ${id} returning version`);
    return { outcome: 'extended', version: Number(row?.version) };
  } catch (error) {
    const pg = dbError(error);
    if (pg?.code === 'JK004' || pg?.code === 'JK001' || pg?.code === '23514')
      return { outcome: 'refused' };
    throw error;
  }
}

export async function deleteDraft(tx: UserTx, id: string): Promise<boolean> {
  const rows = await tx.execute(
    sql`delete from tms.plan_cycles where id = ${id} and status = 'draft' returning id`,
  );
  return rows.length === 1;
}

export async function saveSettings(
  tx: UserTx,
  reminderDays: readonly number[],
  steps: readonly ApprovalStep[],
): Promise<number> {
  const [row] = await tx.execute(sql`
    insert into tms.planning_settings (reminder_days) values (${pgArray(reminderDays)}::smallint[])
    on conflict (tenant_id) do update set reminder_days = excluded.reminder_days
    returning version`);
  await tx.execute(sql`delete from tms.planning_default_steps`);
  await insertSteps(tx, 'defaults', null, steps);
  return Number(row?.version);
}

// ---------------------------------------------------------------------------------------------------
// Department needs (WP-LD-01, T-M3-05; migration 20261105100100). Row-level security lets the department's
// effective head (private.may_submit_plan_needs) and the cycle readers see the rows; only the head writes
// needs, only the L&D Manager returns or extends; the guards enforce the state model.
// ---------------------------------------------------------------------------------------------------

const timestamp = (value: unknown): Date | null =>
  value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
const uuids = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  const raw = typeof value === 'string' ? value.replace(/[{}\s]/g, '') : '';
  return raw ? raw.split(',') : [];
};
const jsonObject = (value: unknown): Record<string, unknown> => {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
};

export interface DepartmentRecord {
  readonly cycleId: string;
  readonly departmentId: string;
  readonly budgetAmount: string | null;
  readonly status: StoredFormStatus;
  /** The department's own extension, or null. */
  readonly deadline: string | null;
  readonly submittedAt: Date | null;
  readonly submittedBy: string | null;
  readonly returnedAt: Date | null;
  readonly returnedBy: string | null;
  readonly returnNote: string | null;
  /** Department-level answers `{ sectionId: [{ fieldId: answer }] }`. */
  readonly answers: Record<string, unknown>;
  readonly version: number;
}

const departmentRecord = (r: Row): DepartmentRecord => ({
  cycleId: String(r.cycle_id),
  departmentId: String(r.department_id),
  budgetAmount: normalizeAmount(text(r.budget_amount)),
  status: r.status as StoredFormStatus,
  deadline: r.deadline_on ? day(r.deadline_on) : null,
  submittedAt: timestamp(r.submitted_at),
  submittedBy: text(r.submitted_by),
  returnedAt: timestamp(r.returned_at),
  returnedBy: text(r.returned_by),
  returnNote: text(r.return_note),
  answers: jsonObject(r.answers),
  version: Number(r.version),
});

const DEPARTMENT_COLUMNS = sql`cycle_id, department_id, budget_amount::text as budget_amount, status, deadline_on,
  submitted_at, submitted_by, returned_at, returned_by, return_note, answers, version`;

/** One department of a cycle (null: unknown, or not visible to the caller). */
export async function getDepartment(
  tx: UserTx,
  cycleId: string,
  departmentId: string,
): Promise<DepartmentRecord | null> {
  const [row] = await tx.execute(sql`
    select ${DEPARTMENT_COLUMNS} from tms.plan_cycle_departments
    where cycle_id = ${cycleId}::uuid and department_id = ${departmentId}::uuid`);
  return row ? departmentRecord(row) : null;
}

export interface NeedRecord {
  readonly id: string;
  readonly topic: string;
  readonly courseId: string | null;
  readonly peopleCount: number;
  readonly estimatedCost: string | null;
  readonly answers: Record<string, unknown>;
  readonly personIds: readonly string[];
  readonly version: number;
  readonly updatedAt: Date;
}

const needRecord = (r: Row): NeedRecord => ({
  id: String(r.id),
  topic: String(r.topic),
  courseId: text(r.course_id),
  peopleCount: Number(r.people_count),
  estimatedCost: normalizeAmount(text(r.estimated_cost)),
  answers: jsonObject(r.answers),
  personIds: uuids(r.person_ids),
  version: Number(r.version),
  updatedAt: timestamp(r.updated_at) ?? new Date(0),
});

const NEED_COLUMNS = sql`n.id, n.topic, n.course_id, n.people_count, n.estimated_cost::text as estimated_cost, n.answers,
  n.version, n.updated_at,
  coalesce((select array_agg(p.person_id order by p.created_at, p.person_id) from tms.plan_need_people p
            where p.tenant_id = n.tenant_id and p.need_id = n.id), '{}'::uuid[]) as person_ids`;

/** The needs of a department in a cycle, in entry order. */
export async function listNeeds(
  tx: UserTx,
  cycleId: string,
  departmentId: string,
): Promise<NeedRecord[]> {
  const rows = await tx.execute(sql`
    select ${NEED_COLUMNS} from tms.plan_needs n
    where n.cycle_id = ${cycleId}::uuid and n.department_id = ${departmentId}::uuid
    order by n.sort_order, n.created_at, n.id`);
  return rows.map((r: Row) => needRecord(r));
}

export async function getNeed(tx: UserTx, needId: string): Promise<NeedRecord | null> {
  const [row] = await tx.execute(
    sql`select ${NEED_COLUMNS} from tms.plan_needs n where n.id = ${needId}::uuid`,
  );
  return row ? needRecord(row) : null;
}

export interface NeedValues {
  readonly topic: string;
  readonly courseId: string | null;
  readonly peopleCount: number;
  readonly estimatedCost: string | null;
  readonly answers: Record<string, unknown>;
}

/** Why the database refused a change of a department's needs. */
export type NeedsRefusal = 'closed' | 'submitted' | 'limit' | 'not_allowed' | 'refused';

export type NeedWriteOutcome =
  | { readonly outcome: 'ok'; readonly id: string; readonly version: number }
  | { readonly outcome: 'not_found' | 'conflict' }
  | { readonly outcome: NeedsRefusal };

/** The guards' refusals (JK005 closed / submitted, JK007 limits, JK001 / 42501 not allowed) as outcomes. */
export function needsRefusalOf(error: unknown): NeedsRefusal | null {
  const pg = dbError(error);
  switch (pg?.code) {
    case 'JK005':
      return pg.message.includes('submitted') ? 'submitted' : 'closed';
    case 'JK007':
      return 'limit';
    case '42501':
      return 'not_allowed';
    case 'JK001':
    case 'JK004':
    case 'JK006':
    case '23514':
    case '23503':
      return 'refused';
    default:
      return null;
  }
}

async function replaceNeedPeople(
  tx: UserTx,
  needId: string,
  departmentId: string,
  personIds: readonly string[],
): Promise<void> {
  await tx.execute(sql`delete from tms.plan_need_people where need_id = ${needId}::uuid`);
  if (personIds.length === 0) return;
  await tx.execute(sql`
    insert into tms.plan_need_people (need_id, department_id, person_id)
    select ${needId}::uuid, ${departmentId}::uuid, unnest(${`{${personIds.join(',')}}`}::uuid[])`);
}

/** A new need at the end of the department's list, with its named people. */
export async function insertNeed(
  tx: UserTx,
  cycleId: string,
  departmentId: string,
  values: NeedValues,
  personIds: readonly string[],
): Promise<NeedWriteOutcome> {
  try {
    const [row] = await tx.execute(sql`
      insert into tms.plan_needs (cycle_id, department_id, topic, course_id, people_count, estimated_cost, answers, sort_order)
      values (${cycleId}::uuid, ${departmentId}::uuid, ${values.topic}, ${values.courseId}::uuid, ${values.peopleCount},
              ${values.estimatedCost}::numeric, ${JSON.stringify(values.answers)}::jsonb,
              coalesce((select max(sort_order) + 1 from tms.plan_needs
                        where cycle_id = ${cycleId}::uuid and department_id = ${departmentId}::uuid), 0))
      returning id, version`);
    if (!row) return { outcome: 'not_allowed' };
    await replaceNeedPeople(tx, String(row.id), departmentId, personIds);
    return { outcome: 'ok', id: String(row.id), version: Number(row.version) };
  } catch (error) {
    const refusal = needsRefusalOf(error);
    if (refusal) return { outcome: refusal };
    throw error;
  }
}

/** Changes a need at `version` (optimistic concurrency) and replaces its named people. */
export async function updateNeed(
  tx: UserTx,
  needId: string,
  departmentId: string,
  version: number,
  values: NeedValues,
  personIds: readonly string[],
): Promise<NeedWriteOutcome> {
  try {
    const [row] = await tx.execute(sql`
      update tms.plan_needs set topic = ${values.topic}, course_id = ${values.courseId}::uuid,
             people_count = ${values.peopleCount}, estimated_cost = ${values.estimatedCost}::numeric,
             answers = ${JSON.stringify(values.answers)}::jsonb
      where id = ${needId}::uuid and department_id = ${departmentId}::uuid and version = ${version}
      returning id, version`);
    if (!row) {
      const [exists] = await tx.execute(
        sql`select 1 from tms.plan_needs where id = ${needId}::uuid and department_id = ${departmentId}::uuid`,
      );
      return { outcome: exists ? 'conflict' : 'not_found' };
    }
    await replaceNeedPeople(tx, needId, departmentId, personIds);
    return { outcome: 'ok', id: needId, version: Number(row.version) };
  } catch (error) {
    const refusal = needsRefusalOf(error);
    if (refusal) return { outcome: refusal };
    throw error;
  }
}

export async function deleteNeed(
  tx: UserTx,
  needId: string,
  departmentId: string,
  version: number,
): Promise<NeedWriteOutcome> {
  try {
    const [row] = await tx.execute(sql`
      delete from tms.plan_needs where id = ${needId}::uuid and department_id = ${departmentId}::uuid and version = ${version}
      returning id`);
    if (!row) {
      const [exists] = await tx.execute(
        sql`select 1 from tms.plan_needs where id = ${needId}::uuid and department_id = ${departmentId}::uuid`,
      );
      return { outcome: exists ? 'conflict' : 'not_found' };
    }
    return { outcome: 'ok', id: needId, version };
  } catch (error) {
    const refusal = needsRefusalOf(error);
    if (refusal) return { outcome: refusal };
    throw error;
  }
}

export type DepartmentOutcome =
  | { readonly outcome: 'ok'; readonly version: number }
  | { readonly outcome: 'not_found' | 'conflict' | 'closed' | 'submitted' | 'empty' | 'refused' };

function departmentRefusal(error: unknown): DepartmentOutcome | null {
  const pg = dbError(error);
  switch (pg?.code) {
    case 'JK005':
      return { outcome: pg.message.includes('submitted') ? 'submitted' : 'closed' };
    case 'JK006':
      return { outcome: 'empty' };
    case 'JK001':
    case 'JK004':
    case '42501':
    case '23514':
      return { outcome: 'refused' };
    default:
      return null;
  }
}

async function departmentUpdate(
  tx: UserTx,
  cycleId: string,
  departmentId: string,
  version: number,
  assignment: SQL,
): Promise<DepartmentOutcome> {
  try {
    const [row] = await tx.execute(sql`
      update tms.plan_cycle_departments set ${assignment}
      where cycle_id = ${cycleId}::uuid and department_id = ${departmentId}::uuid and version = ${version}
      returning version`);
    if (!row) {
      const current = await getDepartment(tx, cycleId, departmentId);
      return { outcome: current ? 'conflict' : 'not_found' };
    }
    return { outcome: 'ok', version: Number(row.version) };
  } catch (error) {
    const refusal = departmentRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
}

/** Submit (→ submitted), recall (submitted → draft) or return (submitted → returned, with the note). */
export async function setDepartmentStatus(
  tx: UserTx,
  cycleId: string,
  departmentId: string,
  version: number,
  status: 'submitted' | 'draft' | 'returned',
  note: string | null = null,
): Promise<DepartmentOutcome> {
  return departmentUpdate(
    tx,
    cycleId,
    departmentId,
    version,
    status === 'returned'
      ? sql`status = ${status}, return_note = ${note}`
      : sql`status = ${status}`,
  );
}

/** Department-level answers of the cycle's form (the head; the guard moves Not started to Draft). */
export async function updateDepartmentAnswers(
  tx: UserTx,
  cycleId: string,
  departmentId: string,
  answers: Record<string, unknown>,
): Promise<DepartmentOutcome> {
  try {
    const [row] = await tx.execute(sql`
      update tms.plan_cycle_departments set answers = ${JSON.stringify(answers)}::jsonb
      where cycle_id = ${cycleId}::uuid and department_id = ${departmentId}::uuid
      returning version`);
    return row ? { outcome: 'ok', version: Number(row.version) } : { outcome: 'not_found' };
  } catch (error) {
    const refusal = departmentRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
}

/** A later deadline for one department (the L&D Manager; the guard checks the day, JK004). */
export async function extendDepartmentDeadline(
  tx: UserTx,
  cycleId: string,
  departmentId: string,
  version: number,
  deadline: string,
): Promise<DepartmentOutcome> {
  return departmentUpdate(tx, cycleId, departmentId, version, sql`deadline_on = ${deadline}::date`);
}

export interface DepartmentProgressRow {
  readonly departmentId: string;
  readonly status: StoredFormStatus;
  readonly deadline: string | null;
  readonly submittedAt: Date | null;
  readonly needsCount: number;
  readonly seats: number;
  readonly named: number;
  readonly cost: string | null;
  /** The last change of a need, else the submission; null when nothing happened yet. */
  readonly lastActivityAt: Date | null;
  readonly version: number;
}

/** The progress figures of every department of a cycle (design screen 5). */
export async function listDepartmentProgress(
  tx: UserTx,
  cycleId: string,
): Promise<DepartmentProgressRow[]> {
  const rows = await tx.execute(sql`
    select d.department_id, d.status, d.deadline_on, d.submitted_at, d.version,
           coalesce(a.needs_count, 0) as needs_count, coalesce(a.seats, 0) as seats, coalesce(a.named, 0) as named,
           a.cost::text as cost, greatest(a.last_change, d.submitted_at, d.returned_at) as last_activity_at
    from tms.plan_cycle_departments d
    left join lateral (
      select count(*) as needs_count, sum(n.people_count) as seats,
             sum(least(n.people_count, (select count(*) from tms.plan_need_people p
                                        where p.tenant_id = n.tenant_id and p.need_id = n.id))) as named,
             sum(n.estimated_cost) as cost, max(n.updated_at) as last_change
      from tms.plan_needs n
      where n.tenant_id = d.tenant_id and n.cycle_id = d.cycle_id and n.department_id = d.department_id) a on true
    where d.cycle_id = ${cycleId}::uuid`);
  return rows.map((r: Row) => ({
    departmentId: String(r.department_id),
    status: r.status as StoredFormStatus,
    deadline: r.deadline_on ? day(r.deadline_on) : null,
    submittedAt: timestamp(r.submitted_at),
    needsCount: Number(r.needs_count),
    seats: Number(r.seats),
    named: Number(r.named),
    cost: normalizeAmount(text(r.cost)),
    lastActivityAt: timestamp(r.last_activity_at),
    version: Number(r.version),
  }));
}

export interface MyDepartmentRow {
  readonly cycleId: string;
  readonly cycleNameAr: string;
  readonly cycleNameEn: string;
  readonly cycleDeadline: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly departmentId: string;
  readonly status: StoredFormStatus;
  readonly deadline: string | null;
  readonly budgetAmount: string | null;
  readonly needsCount: number;
  readonly seats: number;
  readonly cost: string | null;
  readonly returnNote: string | null;
}

/**
 * The departments whose needs the signed-in head enters in the OPEN cycle (the database's
 * private.may_submit_plan_needs — the effective head, Department Head role): the Home task card and the
 * «My team's needs» list.
 */
export async function listMyDepartments(tx: UserTx): Promise<MyDepartmentRow[]> {
  const rows = await tx.execute(sql`
    select c.id as cycle_id, c.name_ar, c.name_en, c.deadline_on as cycle_deadline, c.period_start_on, c.period_end_on,
           c.currency, d.department_id, d.status, d.deadline_on, d.budget_amount::text as budget_amount, d.return_note,
           (select count(*) from tms.plan_needs n where n.tenant_id = d.tenant_id and n.cycle_id = d.cycle_id
             and n.department_id = d.department_id) as needs_count,
           (select coalesce(sum(n.people_count), 0) from tms.plan_needs n where n.tenant_id = d.tenant_id
             and n.cycle_id = d.cycle_id and n.department_id = d.department_id) as seats,
           (select sum(n.estimated_cost) from tms.plan_needs n where n.tenant_id = d.tenant_id
             and n.cycle_id = d.cycle_id and n.department_id = d.department_id)::text as cost
    from tms.plan_cycle_departments d
    join tms.plan_cycles c on c.tenant_id = d.tenant_id and c.id = d.cycle_id
    where c.status = 'open' and private.may_submit_plan_needs(d.tenant_id, d.department_id)
    order by c.deadline_on, c.id, d.created_at, d.id
    limit 100`);
  return rows.map((r: Row) => ({
    cycleId: String(r.cycle_id),
    cycleNameAr: String(r.name_ar),
    cycleNameEn: String(r.name_en),
    cycleDeadline: day(r.cycle_deadline),
    periodStart: day(r.period_start_on),
    periodEnd: day(r.period_end_on),
    currency: String(r.currency),
    departmentId: String(r.department_id),
    status: r.status as StoredFormStatus,
    deadline: r.deadline_on ? day(r.deadline_on) : null,
    budgetAmount: normalizeAmount(text(r.budget_amount)),
    needsCount: Number(r.needs_count),
    seats: Number(r.seats),
    cost: normalizeAmount(text(r.cost)),
    returnNote: text(r.return_note),
  }));
}
