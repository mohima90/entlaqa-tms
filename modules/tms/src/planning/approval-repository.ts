import type { UserTx } from '@jadarat/platform-db';
import { sql } from 'drizzle-orm';
import {
  type ApprovalStep,
  type SubmitProblem,
  type VersionLine,
  submitProblemOf,
} from './approval-rules';
import type { PlanStatus } from './consolidation-rules';
import { dbError } from './repository';
import { canonicalAmount } from './rules';

/**
 * Data access for the training plan's approval (WP-LD-03, T-M3-07; migration 20261116100200). Runs inside the
 * action's withUserTx transaction: the plan's guard decides every step from the verified claims (who submits, who
 * decides, never one's own submission) and the history, versions and departments' results are written by the
 * database. A statement here names only the new state the user asked for and the state it saw.
 */

type Row = Record<string, unknown>;

const text = (value: unknown): string | null =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;
const timestamp = (value: unknown): Date | null =>
  value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;

/** Where the plan's approval stands. */
export interface ApprovalRecord {
  readonly id: string;
  readonly cycleId: string;
  readonly status: PlanStatus;
  readonly planVersion: number;
  readonly approvalStep: ApprovalStep | null;
  readonly financeStep: boolean;
  readonly submittedAt: Date | null;
  readonly submittedBy: string | null;
  readonly hrDecidedAt: Date | null;
  readonly hrDecidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly decidedBy: string | null;
  readonly sendBackComment: string | null;
  readonly approvedAt: Date | null;
  readonly approvedBy: string | null;
  readonly version: number;
}

const approvalRecord = (r: Row): ApprovalRecord => ({
  id: String(r.id),
  cycleId: String(r.cycle_id),
  status: r.status as PlanStatus,
  planVersion: Number(r.plan_version),
  approvalStep: text(r.approval_step) as ApprovalStep | null,
  financeStep: r.finance_step === true,
  submittedAt: timestamp(r.submitted_at),
  submittedBy: text(r.submitted_by),
  hrDecidedAt: timestamp(r.hr_decided_at),
  hrDecidedBy: text(r.hr_decided_by),
  decidedAt: timestamp(r.decided_at),
  decidedBy: text(r.decided_by),
  sendBackComment: text(r.send_back_comment),
  approvedAt: timestamp(r.approved_at),
  approvedBy: text(r.approved_by),
  version: Number(r.version),
});

const APPROVAL_COLUMNS = sql`id, cycle_id, status, plan_version, approval_step, finance_step, submitted_at,
  submitted_by, hr_decided_at, hr_decided_by, decided_at, decided_by, send_back_comment, approved_at, approved_by,
  version`;

export async function getApproval(tx: UserTx, planId: string): Promise<ApprovalRecord | null> {
  const [row] = await tx.execute(
    sql`select ${APPROVAL_COLUMNS} from tms.training_plans where id = ${planId}::uuid`,
  );
  return row ? approvalRecord(row) : null;
}

export async function getApprovalByCycle(
  tx: UserTx,
  cycleId: string,
): Promise<ApprovalRecord | null> {
  const [row] = await tx.execute(
    sql`select ${APPROVAL_COLUMNS} from tms.training_plans where cycle_id = ${cycleId}::uuid`,
  );
  return row ? approvalRecord(row) : null;
}

/** The plans the caller reads (with their cycle's names), newest first: for the Approvals page and Home. */
export interface PlanListRecord extends ApprovalRecord {
  readonly cycleNameAr: string | null;
  readonly cycleNameEn: string | null;
  /** The cycle's currency (its plan's amounts). */
  readonly currency: string;
}

export async function listPlans(tx: UserTx): Promise<PlanListRecord[]> {
  const rows = await tx.execute(sql`
    select p.id, p.cycle_id, p.status, p.plan_version, p.approval_step, p.finance_step, p.submitted_at,
           p.submitted_by, p.hr_decided_at, p.hr_decided_by, p.decided_at, p.decided_by, p.send_back_comment,
           p.approved_at, p.approved_by, p.version, c.name_ar as cycle_name_ar, c.name_en as cycle_name_en,
           c.currency
    from tms.training_plans p
    join tms.plan_cycles c on c.tenant_id = p.tenant_id and c.id = p.cycle_id
    order by coalesce(p.submitted_at, p.opened_at) desc, p.id
    limit 200`);
  return rows.map((r: Row) => ({
    ...approvalRecord(r),
    cycleNameAr: text(r.cycle_name_ar),
    cycleNameEn: text(r.cycle_name_en),
    currency: String(r.currency),
  }));
}

/** A department's envelope in a cycle. */
export interface EnvelopeRecord {
  readonly cycleId: string;
  readonly departmentId: string;
  readonly envelope: string | null;
}

/**
 * The envelopes of several cycles' departments, in one query (the Approvals list's figures): the rows the caller
 * reads, and — for the plan's approvers, who do not read the departments' rows (review M1) — the same columns
 * through private.training_plan_departments.
 */
export async function listEnvelopes(
  tx: UserTx,
  cycleIds: readonly string[],
): Promise<EnvelopeRecord[]> {
  if (cycleIds.length === 0) return [];
  const ids = `{${cycleIds.join(',')}}`;
  const rows = await tx.execute(sql`
    select cycle_id, department_id, budget_amount from (
      select cycle_id, department_id, budget_amount::text as budget_amount, created_at, id
      from tms.plan_cycle_departments where cycle_id = any (${ids}::uuid[])
      union
      select cycle_id, department_id, budget_amount::text, created_at, id
      from private.training_plan_departments where cycle_id = any (${ids}::uuid[])) d
    order by cycle_id, created_at, id`);
  return rows.map((r: Row) => ({
    cycleId: String(r.cycle_id),
    departmentId: String(r.department_id),
    envelope: canonicalAmount(text(r.budget_amount)),
  }));
}

// ---------------------------------------------------------------------------------------------------
// Moving the plan's state
// ---------------------------------------------------------------------------------------------------

/** Why the database refused a step. */
export type ApprovalRefusal =
  | { readonly kind: 'not_ready'; readonly problem: SubmitProblem | null }
  | { readonly kind: 'own_submission' }
  | { readonly kind: 'comment_required' }
  | { readonly kind: 'not_allowed' }
  | { readonly kind: 'refused' };

export type ApprovalOutcome =
  | { readonly ok: true; readonly value: ApprovalRecord | null }
  | { readonly ok: false; readonly refusal: ApprovalRefusal };

function refusalOf(error: unknown): ApprovalRefusal | null {
  const pg = dbError(error);
  switch (pg?.code) {
    case 'JK010':
      return { kind: 'not_ready', problem: submitProblemOf(pg.message) };
    case 'JK011':
      return { kind: 'own_submission' };
    case 'JK012':
      return { kind: 'comment_required' };
    case '42501':
      return { kind: 'not_allowed' };
    case 'JK001':
    case 'JK008':
    case '23514':
      return { kind: 'refused' };
    default:
      return null;
  }
}

/** Runs one state change in a savepoint; a refusal leaves the transaction usable. Null row: nothing matched. */
async function change(tx: UserTx, statement: ReturnType<typeof sql>): Promise<ApprovalOutcome> {
  try {
    const row = await tx.transaction(async () => {
      const [updated] = await tx.execute(statement);
      return updated;
    });
    return { ok: true, value: row ? approvalRecord(row) : null };
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal) return { ok: false, refusal };
    throw error;
  }
}

/** Submits the plan the L&D Manager saw (step 8). */
export function submitPlan(tx: UserTx, planId: string, version: number): Promise<ApprovalOutcome> {
  return change(
    tx,
    sql`update tms.training_plans set status = 'in_approval'
        where id = ${planId}::uuid and version = ${version} and status in ('draft', 'sent_back')
        returning ${APPROVAL_COLUMNS}`,
  );
}

/**
 * Decides the step the approver saw (steps 9, 10, 12): only while the plan still waits for that step at the version
 * they saw — a second decision finds nothing (the first one settled the step).
 */
export function decidePlan(
  tx: UserTx,
  planId: string,
  version: number,
  step: ApprovalStep,
  decision: 'approve' | 'send_back',
  comment: string | null,
): Promise<ApprovalOutcome> {
  return change(
    tx,
    sql`update tms.training_plans
        set status = ${decision === 'approve' ? 'approved' : 'sent_back'},
            send_back_comment = ${decision === 'send_back' ? comment : null}
        where id = ${planId}::uuid and version = ${version} and status = 'in_approval'
          and approval_step = ${step}
        returning ${APPROVAL_COLUMNS}`,
  );
}

/** Opens the next version of an approved plan as a draft (step 13). */
export function revisePlan(tx: UserTx, planId: string, version: number): Promise<ApprovalOutcome> {
  return change(
    tx,
    sql`update tms.training_plans set status = 'draft'
        where id = ${planId}::uuid and version = ${version} and status = 'approved'
        returning ${APPROVAL_COLUMNS}`,
  );
}

// ---------------------------------------------------------------------------------------------------
// History, versions, departments' results
// ---------------------------------------------------------------------------------------------------

export interface EventRecord {
  readonly kind: 'submitted' | 'approved' | 'confirmed' | 'sent_back' | 'revised';
  readonly step: ApprovalStep | null;
  readonly planVersion: number;
  readonly actorPersonId: string | null;
  readonly comment: string | null;
  readonly occurredAt: Date;
}

export async function listEvents(tx: UserTx, planId: string): Promise<EventRecord[]> {
  const rows = await tx.execute(sql`
    select kind, step, plan_version, actor_person_id, comment, occurred_at
    from tms.training_plan_events where plan_id = ${planId}::uuid
    order by occurred_at desc, id
    limit 100`);
  return rows.map((r: Row) => ({
    kind: r.kind as EventRecord['kind'],
    step: text(r.step) as ApprovalStep | null,
    planVersion: Number(r.plan_version),
    actorPersonId: text(r.actor_person_id),
    comment: text(r.comment),
    occurredAt: timestamp(r.occurred_at) ?? new Date(0),
  }));
}

export interface VersionRecord {
  readonly planVersion: number;
  readonly approvedAt: Date;
  readonly approvedBy: string | null;
}

/** The approved versions (without their contents), newest first; organization-wide readers only. */
export async function listVersions(tx: UserTx, planId: string): Promise<VersionRecord[]> {
  const rows = await tx.execute(sql`
    select plan_version, approved_at, approved_by from tms.training_plan_versions
    where plan_id = ${planId}::uuid order by plan_version desc`);
  return rows.map((r: Row) => ({
    planVersion: Number(r.plan_version),
    approvedAt: timestamp(r.approved_at) ?? new Date(0),
    approvedBy: text(r.approved_by),
  }));
}

/** What a version keeps (the snapshot), parsed defensively: the database wrote it. */
export interface VersionContent {
  readonly currency: string;
  readonly lines: readonly VersionLine[];
  readonly departments: readonly {
    readonly departmentId: string;
    readonly envelope: string | null;
    readonly reason: string | null;
  }[];
}

const num = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);

export function versionLines(value: unknown): VersionLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((l: Row) => ({
    id: String(l.id),
    title: String(l.title),
    courseId: text(l.courseId),
    deliveryType: text(l.deliveryType) as VersionLine['deliveryType'],
    category: text(l.category),
    quarter: Number(l.quarter) as VersionLine['quarter'],
    minPerSession: num(l.minPerSession),
    maxPerSession: num(l.maxPerSession),
    costPerSession: text(l.costPerSession),
    costPerPerson: text(l.costPerPerson),
    durationHours: num(l.durationHours),
    status: l.status === 'left_out' ? 'left_out' : 'in_plan',
    leftOutReason: text(l.leftOutReason),
    sortOrder: Number(l.sortOrder ?? 0),
    departments: Array.isArray(l.departments)
      ? (l.departments as Row[]).map((d) => ({
          departmentId: String(d.departmentId),
          seats: Number(d.seats),
          named: Number(d.named ?? 0),
        }))
      : [],
  }));
}

export async function getVersion(
  tx: UserTx,
  planId: string,
  planVersion: number,
): Promise<(VersionRecord & VersionContent) | null> {
  const [row] = await tx.execute(sql`
    select plan_version, approved_at, approved_by, snapshot from tms.training_plan_versions
    where plan_id = ${planId}::uuid and plan_version = ${planVersion}`);
  if (!row) return null;
  const snapshot = (row.snapshot ?? {}) as Row;
  return {
    planVersion: Number(row.plan_version),
    approvedAt: timestamp(row.approved_at) ?? new Date(0),
    approvedBy: text(row.approved_by),
    currency: text(snapshot.currency) ?? '',
    lines: versionLines(snapshot.lines),
    departments: Array.isArray(snapshot.departments)
      ? (snapshot.departments as Row[]).map((d) => ({
          departmentId: String(d.departmentId),
          envelope: text(d.envelope),
          reason: text(d.reason),
        }))
      : [],
  };
}

export interface DepartmentResultRecord {
  readonly cycleId: string;
  readonly departmentId: string;
  readonly planVersion: number;
  readonly approvedAt: Date;
  readonly cycleNameAr: string | null;
  readonly cycleNameEn: string | null;
  readonly currency: string;
  readonly envelope: string | null;
  readonly reason: string | null;
  readonly lines: readonly VersionLine[];
}

/**
 * The latest approved result of each department the caller may read (row-level security: its head, a planner of
 * its unit, the plan's readers); `cycleId` / `departmentId` narrow it.
 */
export async function listDepartmentResults(
  tx: UserTx,
  filter: { readonly cycleId?: string; readonly departmentId?: string } = {},
): Promise<DepartmentResultRecord[]> {
  const rows = await tx.execute(sql`
    select distinct on (r.cycle_id, r.department_id)
           r.cycle_id, r.department_id, r.plan_version, r.approved_at, r.result,
           c.name_ar as cycle_name_ar, c.name_en as cycle_name_en
    from tms.training_plan_department_results r
    left join tms.plan_cycles c on c.tenant_id = r.tenant_id and c.id = r.cycle_id
    where (${filter.cycleId ?? null}::uuid is null or r.cycle_id = ${filter.cycleId ?? null}::uuid)
      and (${filter.departmentId ?? null}::uuid is null or r.department_id = ${filter.departmentId ?? null}::uuid)
    order by r.cycle_id, r.department_id, r.plan_version desc
    limit 500`);
  return rows.map((r: Row) => {
    const result = (r.result ?? {}) as Row;
    return {
      cycleId: String(r.cycle_id),
      departmentId: String(r.department_id),
      planVersion: Number(r.plan_version),
      approvedAt: timestamp(r.approved_at) ?? new Date(0),
      cycleNameAr: text(r.cycle_name_ar),
      cycleNameEn: text(r.cycle_name_en),
      currency: text(result.currency) ?? '',
      envelope: text(result.envelope),
      reason: text(result.reason),
      lines: versionLines(result.lines),
    };
  });
}

/** «Finance confirms the plan» (Planning settings): off when never saved. */
export async function financeConfirms(tx: UserTx): Promise<boolean> {
  const [row] = await tx.execute(sql`select finance_confirms from tms.planning_settings limit 1`);
  return row?.finance_confirms === true;
}

/** Why the plan cannot be submitted now, as the database answers it (null: it can). */
export async function submitProblem(
  tx: UserTx,
  planId: string,
  cycleId: string,
): Promise<SubmitProblem | null> {
  const [row] = await tx.execute(sql`
    select private.training_plan_submit_problem(private.current_tenant_id(), ${planId}::uuid, ${cycleId}::uuid)
      as problem`);
  return submitProblemOf(text(row?.problem));
}
