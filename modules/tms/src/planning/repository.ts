import type { UserTx } from '@jadarat/platform-db';
import { type SQL, sql } from 'drizzle-orm';
import {
  type ApprovalStep,
  type CycleStatus,
  DEFAULT_CHAIN,
  DEFAULT_REMINDER_DAYS,
  type StoredFormStatus,
  canonicalAmount,
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
    select department_id, budget_amount::text as budget_amount, status
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
): Promise<{ id: string; version: number }> {
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
  const [touched] = await tx.execute(sql`select version from tms.plan_cycles where id = ${id}`);
  return { id, version: Number(touched?.version) };
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

/** Closes open cycles whose deadline has passed (allowed by the guard); returns their ids. */
export async function closeDueCycles(tx: UserTx): Promise<string[]> {
  const rows = await tx.execute(sql`
    update tms.plan_cycles set status = 'closed'
    where status = 'open' and deadline_on < private.plan_cycle_today(tenant_id)
    returning id`);
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
