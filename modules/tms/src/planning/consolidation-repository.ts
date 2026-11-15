import type { UserTx } from '@jadarat/platform-db';
import { type SQL, sql } from 'drizzle-orm';
import { canonicalAmount } from './rules';
import type { LineStatus, PlanDeliveryType, PlanStatus, Quarter } from './consolidation-rules';
import { dbError } from './repository';

/**
 * Data access for the training plan (WP-LD-02, T-M3-06; migrations 20261115100200–100400). Runs inside the action's
 * withUserTx transaction: row-level security limits every row to the claims' organization and to the caller's
 * planning scope — organization-wide for the L&D Manager and the Training Coordinator, the lines holding a need of
 * its units for a department-limited L&D Manager (private.training_plan_units) — and the guards enforce the plan's
 * state (JK008 frozen, JK009 not submitted). Platform data (structure, people) comes from platform-db services.
 */

type Row = Record<string, unknown>;

const text = (value: unknown): string | null =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;
const timestamp = (value: unknown): Date | null =>
  value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
const amount = (value: unknown): string | null => canonicalAmount(text(value));
const int = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const pgArray = (values: readonly string[]) => `{${values.join(',')}}`;

/** Why the database refused a change of the plan. */
export type PlanRefusal = 'frozen' | 'not_submitted' | 'not_allowed' | 'refused' | 'conflict';

/** The guards' and policies' refusals as outcomes (null: not one of them — rethrow). */
export function planRefusalOf(error: unknown): PlanRefusal | null {
  const pg = dbError(error);
  switch (pg?.code) {
    case 'JK008':
      return 'frozen';
    case 'JK009':
      return 'not_submitted';
    case '42501':
      return 'not_allowed';
    case '23505':
      return 'conflict';
    case 'JK001':
    case '23503':
    case '23514':
      return 'refused';
    default:
      return null;
  }
}

/** Thrown inside `guarded` to undo its savepoint with an outcome (e.g. fewer rows changed than asked). */
class Refused extends Error {
  constructor(readonly refusal: PlanRefusal) {
    super(refusal);
  }
}

/** Runs `fn` in a savepoint so a refused statement leaves the transaction usable; refusals become outcomes. */
async function guarded<T>(
  tx: UserTx,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; refusal: PlanRefusal }> {
  try {
    return { ok: true, value: await tx.transaction(async () => fn()) };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, refusal: error.refusal };
    const refusal = planRefusalOf(error);
    if (refusal) return { ok: false, refusal };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------------

export interface PlanRecord {
  readonly id: string;
  readonly cycleId: string;
  readonly status: PlanStatus;
  readonly planVersion: number;
  readonly openedAt: Date;
  readonly openedBy: string | null;
  readonly needsClosedEarly: boolean;
  readonly version: number;
}

const planRecord = (r: Row): PlanRecord => ({
  id: String(r.id),
  cycleId: String(r.cycle_id),
  status: r.status as PlanStatus,
  planVersion: Number(r.plan_version),
  openedAt: timestamp(r.opened_at) ?? new Date(0),
  openedBy: text(r.opened_by),
  needsClosedEarly: r.needs_closed_early === true,
  version: Number(r.version),
});

const PLAN_COLUMNS = sql`id, cycle_id, status, plan_version, opened_at, opened_by, needs_closed_early, version`;

export async function getPlanByCycle(tx: UserTx, cycleId: string): Promise<PlanRecord | null> {
  const [row] = await tx.execute(
    sql`select ${PLAN_COLUMNS} from tms.training_plans where cycle_id = ${cycleId}::uuid`,
  );
  return row ? planRecord(row) : null;
}

export async function getPlan(tx: UserTx, planId: string): Promise<PlanRecord | null> {
  const [row] = await tx.execute(
    sql`select ${PLAN_COLUMNS} from tms.training_plans where id = ${planId}::uuid`,
  );
  return row ? planRecord(row) : null;
}

/** Opens the plan of a closed cycle (the guard stamps it and says whether the needs closed early). */
export async function insertPlan(
  tx: UserTx,
  cycleId: string,
): Promise<{ ok: true; value: PlanRecord } | { ok: false; refusal: PlanRefusal }> {
  return guarded(tx, async () => {
    const [row] = await tx.execute(
      sql`insert into tms.training_plans (cycle_id) values (${cycleId}::uuid) returning ${PLAN_COLUMNS}`,
    );
    if (!row) throw new Error('the plan was not created');
    return planRecord(row);
  });
}

/**
 * Closes the needs of an open cycle now: after every deadline has passed, or earlier («Close needs now») once
 * every department has submitted — the guard decides (JK001 otherwise).
 */
export async function closeNeeds(
  tx: UserTx,
  cycleId: string,
): Promise<{ ok: true; value: number } | { ok: false; refusal: PlanRefusal }> {
  return guarded(tx, async () => {
    const [row] = await tx.execute(sql`
      update tms.plan_cycles set status = 'closed' where id = ${cycleId}::uuid and status = 'open' returning version`);
    return Number(row?.version ?? 0);
  });
}

// ---------------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------------

export interface LineRecord {
  readonly id: string;
  readonly planId: string;
  readonly cycleId: string;
  readonly groupKey: string;
  readonly title: string;
  readonly courseId: string | null;
  readonly deliveryType: PlanDeliveryType | null;
  readonly category: string | null;
  readonly quarter: Quarter;
  readonly minPerSession: number | null;
  readonly maxPerSession: number | null;
  readonly costPerSession: string | null;
  readonly costPerPerson: string | null;
  readonly durationHours: number | null;
  readonly status: LineStatus;
  readonly leftOutReason: string | null;
  readonly sortOrder: number;
  readonly editedAt: Date | null;
  readonly createdBy: string | null;
  readonly version: number;
}

const lineRecord = (r: Row): LineRecord => ({
  id: String(r.id),
  planId: String(r.plan_id),
  cycleId: String(r.cycle_id),
  groupKey: String(r.group_key),
  title: String(r.title),
  courseId: text(r.course_id),
  deliveryType: text(r.delivery_type) as PlanDeliveryType | null,
  category: text(r.category),
  quarter: Number(r.quarter) as Quarter,
  minPerSession: int(r.min_per_session),
  maxPerSession: int(r.max_per_session),
  costPerSession: amount(r.cost_per_session),
  costPerPerson: amount(r.cost_per_person),
  durationHours: r.duration_hours === null ? null : Number(r.duration_hours),
  status: r.status as LineStatus,
  leftOutReason: text(r.left_out_reason),
  sortOrder: Number(r.sort_order),
  editedAt: timestamp(r.edited_at),
  createdBy: text(r.created_by),
  version: Number(r.version),
});

const LINE_COLUMNS = sql`id, plan_id, cycle_id, group_key, title, course_id, delivery_type, category, quarter,
  min_per_session, max_per_session, cost_per_session::text as cost_per_session, cost_per_person::text as cost_per_person,
  duration_hours, status, left_out_reason, sort_order, edited_at, created_by, version`;

/** The plan's lines the caller may read, in plan order. */
export async function listLines(tx: UserTx, planId: string): Promise<LineRecord[]> {
  const rows = await tx.execute(sql`
    select ${LINE_COLUMNS} from tms.plan_lines where plan_id = ${planId}::uuid
    order by sort_order, created_at, id`);
  return rows.map((r: Row) => lineRecord(r));
}

export async function getLines(tx: UserTx, lineIds: readonly string[]): Promise<LineRecord[]> {
  if (lineIds.length === 0) return [];
  const rows = await tx.execute(sql`
    select ${LINE_COLUMNS} from tms.plan_lines where id = any (${pgArray(lineIds)}::uuid[])
    order by sort_order, created_at, id`);
  return rows.map((r: Row) => lineRecord(r));
}

export interface NewLine {
  readonly groupKey: string;
  readonly title: string;
  readonly courseId: string | null;
  readonly deliveryType: PlanDeliveryType | null;
  readonly category: string | null;
  readonly quarter: Quarter;
  readonly minPerSession: number | null;
  readonly maxPerSession: number | null;
  readonly costPerSession: string | null;
  readonly costPerPerson: string | null;
  readonly durationHours: number | null;
}

async function insertLineRow(
  tx: UserTx,
  plan: { readonly id: string; readonly cycleId: string },
  line: NewLine,
  edited: boolean,
): Promise<string> {
  const [row] = await tx.execute(sql`
    insert into tms.plan_lines (plan_id, cycle_id, group_key, title, course_id, delivery_type, category, quarter,
                                min_per_session, max_per_session, cost_per_session, cost_per_person, duration_hours,
                                sort_order, edited_at)
    values (${plan.id}::uuid, ${plan.cycleId}::uuid, ${line.groupKey}, ${line.title}, ${line.courseId}::uuid,
            ${line.deliveryType}, ${line.category}, ${line.quarter}, ${line.minPerSession}, ${line.maxPerSession},
            ${line.costPerSession}::numeric, ${line.costPerPerson}::numeric, ${line.durationHours}::numeric,
            coalesce((select max(sort_order) + 1 from tms.plan_lines where plan_id = ${plan.id}::uuid), 0),
            ${edited ? sql`now()` : sql`null`})
    returning id`);
  if (!row) throw new Refused('not_allowed');
  return String(row.id);
}

/**
 * A new line at the end of the plan (its needs follow in the same transaction); `edited`: L&D made it, not the
 * needs. A refusal (the plan frozen, a cycle outside a department-limited planner's units, a check) is an outcome.
 */
export async function insertLine(
  tx: UserTx,
  plan: { readonly id: string; readonly cycleId: string },
  line: NewLine,
  edited: boolean,
): Promise<{ ok: true; value: string } | { ok: false; refusal: PlanRefusal }> {
  return guarded(tx, () => insertLineRow(tx, plan, line, edited));
}

/**
 * A new line L&D made, holding needs already in the plan (moved out of their line), in ONE step: the line and the
 * move are kept together or not at all — never an empty line left behind.
 */
export async function insertLineWithNeeds(
  tx: UserTx,
  plan: { readonly id: string; readonly cycleId: string },
  line: NewLine,
  needIds: readonly string[],
): Promise<{ ok: true; value: string } | { ok: false; refusal: PlanRefusal }> {
  return guarded(tx, async () => {
    const lineId = await insertLineRow(tx, plan, line, true);
    const rows = await tx.execute(sql`
      update tms.plan_line_needs set line_id = ${lineId}::uuid
      where need_id = any (${pgArray(needIds)}::uuid[]) returning id`);
    if (rows.length !== needIds.length) throw new Refused('not_allowed');
    return lineId;
  });
}

export type LineWriteOutcome =
  | { readonly outcome: 'ok'; readonly version: number }
  | { readonly outcome: 'not_found' | 'conflict' }
  | { readonly outcome: PlanRefusal };

/** The columns L&D changes on a line (undefined: unchanged). */
export interface LinePatch {
  readonly title?: string;
  readonly courseId?: string | null;
  readonly deliveryType?: PlanDeliveryType | null;
  readonly category?: string | null;
  readonly quarter?: Quarter;
  readonly minPerSession?: number | null;
  readonly maxPerSession?: number | null;
  readonly costPerSession?: string | null;
  readonly costPerPerson?: string | null;
  readonly durationHours?: number | null;
  readonly status?: LineStatus;
  readonly leftOutReason?: string | null;
}

function assignments(patch: LinePatch): SQL[] {
  const set: SQL[] = [];
  if (patch.title !== undefined) set.push(sql`title = ${patch.title}`);
  if (patch.courseId !== undefined) set.push(sql`course_id = ${patch.courseId}::uuid`);
  if (patch.deliveryType !== undefined) set.push(sql`delivery_type = ${patch.deliveryType}`);
  if (patch.category !== undefined) set.push(sql`category = ${patch.category}`);
  if (patch.quarter !== undefined) set.push(sql`quarter = ${patch.quarter}`);
  if (patch.minPerSession !== undefined) set.push(sql`min_per_session = ${patch.minPerSession}`);
  if (patch.maxPerSession !== undefined) set.push(sql`max_per_session = ${patch.maxPerSession}`);
  if (patch.costPerSession !== undefined)
    set.push(sql`cost_per_session = ${patch.costPerSession}::numeric`);
  if (patch.costPerPerson !== undefined)
    set.push(sql`cost_per_person = ${patch.costPerPerson}::numeric`);
  if (patch.durationHours !== undefined)
    set.push(sql`duration_hours = ${patch.durationHours}::numeric`);
  if (patch.status !== undefined) set.push(sql`status = ${patch.status}`);
  if (patch.leftOutReason !== undefined) set.push(sql`left_out_reason = ${patch.leftOutReason}`);
  // Nothing to change still stamps the line (merge, a need moved): a touch.
  if (set.length === 0) set.push(sql`sort_order = sort_order`);
  return set;
}

/** Changes a line at `version` (optimistic concurrency); an empty patch touches it (new version, L&D's edit). */
export async function updateLine(
  tx: UserTx,
  lineId: string,
  version: number,
  patch: LinePatch,
): Promise<LineWriteOutcome> {
  const written = await guarded(tx, async () => {
    const [row] = await tx.execute(sql`
      update tms.plan_lines set ${sql.join(assignments(patch), sql`, `)}
      where id = ${lineId}::uuid and version = ${version} returning version`);
    return row ? Number(row.version) : null;
  });
  if (!written.ok) return { outcome: written.refusal };
  if (written.value !== null) return { outcome: 'ok', version: written.value };
  const [exists] = await tx.execute(sql`select 1 from tms.plan_lines where id = ${lineId}::uuid`);
  return { outcome: exists ? 'conflict' : 'not_found' };
}

/** Removes lines that hold no need any more (after a merge or a move); refused ones stay. */
export async function deleteEmptyLines(tx: UserTx, lineIds: readonly string[]): Promise<string[]> {
  if (lineIds.length === 0) return [];
  const done = await guarded(tx, async () => {
    const rows = await tx.execute(sql`
      delete from tms.plan_lines l
      where l.id = any (${pgArray(lineIds)}::uuid[])
        and not exists (select 1 from tms.plan_line_needs x where x.tenant_id = l.tenant_id and x.line_id = l.id)
      returning l.id`);
    return rows.map((r: Row) => String(r.id));
  });
  return done.ok ? done.value : [];
}

// ---------------------------------------------------------------------------------------------------
// Needs in lines
// ---------------------------------------------------------------------------------------------------

export interface LinkRecord {
  readonly needId: string;
  readonly lineId: string;
  readonly departmentId: string;
  /** What the department submitted (snapshot). */
  readonly seats: number;
  readonly named: number;
  /** The need's topic and course when it was added (snapshot; null: not taken). */
  readonly topic: string | null;
  readonly courseId: string | null;
}

/** Which line holds which need — the rows the caller may read. */
export async function listLinks(tx: UserTx, planId: string): Promise<LinkRecord[]> {
  const rows = await tx.execute(sql`
    select need_id, line_id, department_id, seats, named, topic, course_id from tms.plan_line_needs
    where plan_id = ${planId}::uuid order by created_at, id`);
  return rows.map((r: Row) => ({
    needId: String(r.need_id),
    lineId: String(r.line_id),
    departmentId: String(r.department_id),
    seats: Number(r.seats),
    named: Number(r.named),
    topic: text(r.topic),
    courseId: text(r.course_id),
  }));
}

/** Puts needs into lines (the guard takes their seats; only submitted needs enter). */
export async function insertLinks(
  tx: UserTx,
  plan: { readonly id: string; readonly cycleId: string },
  links: readonly {
    readonly lineId: string;
    readonly needId: string;
    readonly departmentId: string;
  }[],
): Promise<{ ok: true; value: number } | { ok: false; refusal: PlanRefusal }> {
  if (links.length === 0) return { ok: true, value: 0 };
  return guarded(tx, async () => {
    const rows = await tx.execute(sql`
      insert into tms.plan_line_needs (plan_id, cycle_id, line_id, need_id, department_id)
      select ${plan.id}::uuid, ${plan.cycleId}::uuid, x.line_id, x.need_id, x.department_id
      from unnest(${pgArray(links.map((l) => l.lineId))}::uuid[], ${pgArray(links.map((l) => l.needId))}::uuid[],
                  ${pgArray(links.map((l) => l.departmentId))}::uuid[]) as x (line_id, need_id, department_id)
      returning id`);
    return rows.length;
  });
}

/** Moves needs to a line (the policies check both lines are the caller's to change). */
export async function moveLinks(
  tx: UserTx,
  needIds: readonly string[],
  lineId: string,
): Promise<{ ok: true; value: number } | { ok: false; refusal: PlanRefusal }> {
  if (needIds.length === 0) return { ok: true, value: 0 };
  return guarded(tx, async () => {
    const rows = await tx.execute(sql`
      update tms.plan_line_needs set line_id = ${lineId}::uuid
      where need_id = any (${pgArray(needIds)}::uuid[]) returning id`);
    return rows.length;
  });
}

/** Takes needs out of their lines (their topic or course changed: they are placed again). All or none. */
export async function removeLinks(
  tx: UserTx,
  needIds: readonly string[],
): Promise<{ ok: true; value: number } | { ok: false; refusal: PlanRefusal }> {
  if (needIds.length === 0) return { ok: true, value: 0 };
  return guarded(tx, async () => {
    const rows = await tx.execute(sql`
      delete from tms.plan_line_needs where need_id = any (${pgArray(needIds)}::uuid[]) returning id`);
    if (rows.length !== needIds.length) throw new Refused('not_allowed');
    return rows.length;
  });
}

/** Takes the seats, named people, topic and course again from the needs (a department that resubmitted). */
export async function refreshLinks(
  tx: UserTx,
  needIds: readonly string[],
): Promise<{ ok: true; value: number } | { ok: false; refusal: PlanRefusal }> {
  if (needIds.length === 0) return { ok: true, value: 0 };
  return guarded(tx, async () => {
    const rows = await tx.execute(sql`
      update tms.plan_line_needs set line_id = line_id
      where need_id = any (${pgArray(needIds)}::uuid[]) returning id`);
    return rows.length;
  });
}

// ---------------------------------------------------------------------------------------------------
// The needs the plan is built from
// ---------------------------------------------------------------------------------------------------

export interface PlanNeedRecord {
  readonly id: string;
  readonly departmentId: string;
  readonly topic: string;
  readonly courseId: string | null;
  readonly peopleCount: number;
  readonly named: number;
  readonly answers: Record<string, unknown>;
  /** The department's form status now (only `submitted` needs enter the plan). */
  readonly departmentStatus: string;
}

/** The needs of the cycle the caller may read (all for the organization-wide planners), in entry order. */
export async function listCycleNeeds(tx: UserTx, cycleId: string): Promise<PlanNeedRecord[]> {
  const rows = await tx.execute(sql`
    select n.id, n.department_id, n.topic, n.course_id, n.people_count, n.answers, d.status as department_status,
           (select count(*) from tms.plan_need_people p where p.tenant_id = n.tenant_id and p.need_id = n.id) as named
    from tms.plan_needs n
    join tms.plan_cycle_departments d
      on d.tenant_id = n.tenant_id and d.cycle_id = n.cycle_id and d.department_id = n.department_id
    where n.cycle_id = ${cycleId}::uuid
    order by n.created_at, n.sort_order, n.id`);
  return rows.map((r: Row) => {
    const answers: unknown = typeof r.answers === 'string' ? JSON.parse(r.answers) : r.answers;
    return {
      id: String(r.id),
      departmentId: String(r.department_id),
      topic: String(r.topic),
      courseId: text(r.course_id),
      peopleCount: Number(r.people_count),
      named: Number(r.named),
      answers:
        typeof answers === 'object' && answers !== null && !Array.isArray(answers)
          ? (answers as Record<string, unknown>)
          : {},
      departmentStatus: String(r.department_status),
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Budget reasons (BR-PLN-f)
// ---------------------------------------------------------------------------------------------------

export interface BudgetReasonRecord {
  readonly departmentId: string;
  readonly reason: string;
  readonly updatedAt: Date;
}

export async function listBudgetReasons(tx: UserTx, planId: string): Promise<BudgetReasonRecord[]> {
  const rows = await tx.execute(sql`
    select department_id, reason, updated_at from tms.plan_budget_reasons where plan_id = ${planId}::uuid`);
  return rows.map((r: Row) => ({
    departmentId: String(r.department_id),
    reason: String(r.reason),
    updatedAt: timestamp(r.updated_at) ?? new Date(0),
  }));
}

/** Sets (or, with null, removes) a department's over-budget reason; returns the reason before. */
export async function saveBudgetReason(
  tx: UserTx,
  plan: { readonly id: string; readonly cycleId: string },
  departmentId: string,
  reason: string | null,
): Promise<{ ok: true; value: string | null } | { ok: false; refusal: PlanRefusal }> {
  return guarded(tx, async () => {
    const [before] = await tx.execute(sql`
      select reason from tms.plan_budget_reasons
      where plan_id = ${plan.id}::uuid and department_id = ${departmentId}::uuid`);
    if (reason === null) {
      await tx.execute(sql`
        delete from tms.plan_budget_reasons where plan_id = ${plan.id}::uuid and department_id = ${departmentId}::uuid`);
    } else if (before) {
      await tx.execute(sql`
        update tms.plan_budget_reasons set reason = ${reason}
        where plan_id = ${plan.id}::uuid and department_id = ${departmentId}::uuid`);
    } else {
      await tx.execute(sql`
        insert into tms.plan_budget_reasons (plan_id, cycle_id, department_id, reason)
        values (${plan.id}::uuid, ${plan.cycleId}::uuid, ${departmentId}::uuid, ${reason})`);
    }
    return before ? text(before.reason) : null;
  });
}
