import type { UserTx } from '@jadarat/platform-db';
import { type SQL, sql } from 'drizzle-orm';
import { canonicalAmount } from '../planning/rules';
import { dbError } from '../planning/repository';

/**
 * Data access for draft sessions and the course of an approved plan line (WP-LD-04, T-M3-08; migration
 * 20261117100200). Runs inside the action's withUserTx transaction: row-level security limits every row to the
 * claims' organization and to the caller's session scope (tms.session.manage organization-wide, or the lines of its
 * units for a department-limited planner — private.session_units), and the guards enforce the rules (JK013 not
 * ready, JK014 all drafted, JK015 outside the planning period, JK016 seats, JK017 the line has drafts, JK008 the
 * approved plan is locked).
 */

type Row = Record<string, unknown>;

const text = (value: unknown): string | null =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;
const day = (value: unknown): string | null => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === 'string' ? value.slice(0, 10) : null;
};
const timestamp = (value: unknown): Date | null =>
  value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
const pgArray = (values: readonly string[]) => `{${values.join(',')}}`;

/** Why the database refused a change of a draft or of an approved line's course. */
export type SessionRefusal =
  | 'not_ready'
  | 'all_drafted'
  | 'outside_period'
  | 'seats'
  | 'frozen'
  | 'not_allowed'
  | 'person_taken'
  | 'has_drafts'
  | 'refused';

export function sessionRefusalOf(error: unknown): SessionRefusal | null {
  switch (dbError(error)?.code) {
    case 'JK013':
      return 'not_ready';
    case 'JK014':
      return 'all_drafted';
    case 'JK015':
      return 'outside_period';
    case 'JK016':
      return 'seats';
    case 'JK017':
      return 'has_drafts';
    case 'JK008':
      return 'frozen';
    case '42501':
      return 'not_allowed';
    case '23505':
      return 'person_taken';
    case 'JK001':
    case '23503':
    case '23514':
      return 'refused';
    default:
      return null;
  }
}

class Refused extends Error {
  constructor(readonly refusal: SessionRefusal) {
    super(refusal);
  }
}

export type Guarded<T> = { ok: true; value: T } | { ok: false; refusal: SessionRefusal };

/** Runs `fn` in a savepoint so a refused statement leaves the transaction usable; refusals become outcomes. */
async function guarded<T>(tx: UserTx, fn: () => Promise<T>): Promise<Guarded<T>> {
  try {
    return { ok: true, value: await tx.transaction(async () => fn()) };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, refusal: error.refusal };
    const refusal = sessionRefusalOf(error);
    if (refusal) return { ok: false, refusal };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------
// The course of an approved line
// ---------------------------------------------------------------------------------------------------

export interface LineCourseRecord {
  readonly lineId: string;
  readonly courseOrigin: 'created' | 'linked' | null;
  readonly courseSetAt: Date | null;
}

/** How each line of a plan got its course (the columns WP-LD-04 added), for the lines the caller reads. */
export async function listLineCourses(tx: UserTx, planId: string): Promise<LineCourseRecord[]> {
  const rows = await tx.execute(sql`
    select id, course_origin, course_set_at from tms.plan_lines where plan_id = ${planId}::uuid`);
  return rows.map((r: Row) => ({
    lineId: String(r.id),
    courseOrigin: (text(r.course_origin) as 'created' | 'linked' | null) ?? null,
    courseSetAt: timestamp(r.course_set_at),
  }));
}

/**
 * Does the line have draft sessions — whether or not the caller reads them (private.plan_line_has_sessions, SECURITY
 * DEFINER: the L&D Manager may hold no tms.session.manage; review M1)?
 */
export async function lineHasSessions(tx: UserTx, lineId: string): Promise<boolean> {
  const [row] = await tx.execute(
    sql`select private.plan_line_has_sessions(${lineId}::uuid) as has`,
  );
  return row?.has === true;
}

/**
 * Gives a line of an approved plan its course, at `version` (optimistic concurrency). The guard lets exactly this
 * through, for the organization-wide L&D Manager. Null: the line is not at that version (or not visible).
 */
export async function setLineCourse(
  tx: UserTx,
  lineId: string,
  version: number,
  courseId: string,
  origin: 'created' | 'linked',
): Promise<Guarded<number | null>> {
  return guarded(tx, async () => {
    const [row] = await tx.execute(sql`
      update tms.plan_lines set course_id = ${courseId}::uuid, course_origin = ${origin}
      where id = ${lineId}::uuid and version = ${version} returning version`);
    return row ? Number(row.version) : null;
  });
}

// ---------------------------------------------------------------------------------------------------
// Named people of lines
// ---------------------------------------------------------------------------------------------------

export interface NamedPersonRecord {
  readonly lineId: string;
  readonly needId: string;
  readonly departmentId: string;
  readonly personId: string;
}

/** The people named for the needs of these lines (as the caller reads them), in the order they were named. */
export async function listNamedPeople(
  tx: UserTx,
  lineIds: readonly string[],
): Promise<NamedPersonRecord[]> {
  if (lineIds.length === 0) return [];
  const rows = await tx.execute(sql`
    select x.line_id, p.need_id, p.department_id, p.person_id
    from tms.plan_need_people p
    join tms.plan_line_needs x on x.tenant_id = p.tenant_id and x.need_id = p.need_id
    where x.line_id = any (${pgArray(lineIds)}::uuid[])
    order by x.line_id, x.created_at, p.created_at, p.person_id`);
  return rows.map((r: Row) => ({
    lineId: String(r.line_id),
    needId: String(r.need_id),
    departmentId: String(r.department_id),
    personId: String(r.person_id),
  }));
}

// ---------------------------------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------------------------------

export interface SessionRecord {
  readonly id: string;
  readonly status: 'draft';
  readonly planId: string;
  readonly cycleId: string;
  readonly lineId: string;
  readonly planVersion: number;
  readonly courseId: string;
  readonly deliveryType: string;
  /** `YYYY-MM-DD`, the first day of the month (null only after scheduling, WP-LD-08). */
  readonly month: string | null;
  readonly branchId: string | null;
  readonly seats: number;
  readonly estimatedCost: string | null;
  readonly costCurrency: string | null;
  /** Planned participants the caller reads. */
  readonly participants: number;
  readonly createdAt: Date;
  readonly version: number;
}

const SESSION_COLUMNS = sql`s.id, s.status, s.plan_id, s.cycle_id, s.plan_line_id, s.plan_version, s.course_id,
  s.delivery_type, s.month::text as month, s.branch_id, s.seats, s.estimated_cost::text as estimated_cost, s.cost_currency,
  s.created_at, s.version,
  (select count(*) from tms.session_participants p where p.tenant_id = s.tenant_id and p.session_id = s.id)
    as participants`;

const sessionRecord = (r: Row): SessionRecord => ({
  id: String(r.id),
  status: 'draft',
  planId: String(r.plan_id),
  cycleId: String(r.cycle_id),
  lineId: String(r.plan_line_id),
  planVersion: Number(r.plan_version),
  courseId: String(r.course_id),
  deliveryType: String(r.delivery_type),
  month: day(r.month),
  branchId: text(r.branch_id),
  seats: Number(r.seats),
  estimatedCost: canonicalAmount(text(r.estimated_cost)),
  costCurrency: text(r.cost_currency)?.trim() ?? null,
  participants: Number(r.participants),
  createdAt: timestamp(r.created_at) ?? new Date(0),
  version: Number(r.version),
});

async function listWhere(tx: UserTx, where: SQL): Promise<SessionRecord[]> {
  const rows = await tx.execute(sql`
    select ${SESSION_COLUMNS} from tms.sessions s where ${where}
    order by s.plan_line_id, s.month nulls last, s.created_at, s.id`);
  return rows.map((r: Row) => sessionRecord(r));
}

/** The drafts of a plan the caller reads. */
export function listPlanSessions(tx: UserTx, planId: string): Promise<SessionRecord[]> {
  return listWhere(tx, sql`s.plan_id = ${planId}::uuid`);
}

/** The drafts of several lines the caller reads (the siblings a draft is counted among: «1 of 3»). */
export function listLineSessions(tx: UserTx, lineIds: readonly string[]): Promise<SessionRecord[]> {
  if (lineIds.length === 0) return Promise.resolve([]);
  return listWhere(tx, sql`s.plan_line_id = any (${pgArray(lineIds)}::uuid[])`);
}

/** The drafts planned in [from, to) (first days of months), the calendar's year. */
export function listSessionsBetween(
  tx: UserTx,
  from: string,
  to: string,
): Promise<SessionRecord[]> {
  return listWhere(tx, sql`s.month >= ${from}::date and s.month < ${to}::date`);
}

export async function getSession(tx: UserTx, sessionId: string): Promise<SessionRecord | null> {
  const [row] = await listWhere(tx, sql`s.id = ${sessionId}::uuid`);
  return row ?? null;
}

export interface ParticipantRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly lineId: string;
  readonly needId: string;
  readonly departmentId: string;
  readonly personId: string;
}

const participantRecord = (r: Row): ParticipantRecord => ({
  id: String(r.id),
  sessionId: String(r.session_id),
  lineId: String(r.plan_line_id),
  needId: String(r.need_id),
  departmentId: String(r.department_id),
  personId: String(r.person_id),
});

/** The planned participants of the drafts of these lines the caller reads. */
export async function listLineParticipants(
  tx: UserTx,
  lineIds: readonly string[],
): Promise<ParticipantRecord[]> {
  if (lineIds.length === 0) return [];
  const rows = await tx.execute(sql`
    select id, session_id, plan_line_id, need_id, department_id, person_id from tms.session_participants
    where plan_line_id = any (${pgArray(lineIds)}::uuid[]) order by created_at, id`);
  return rows.map((r: Row) => participantRecord(r));
}

export interface NewSession {
  readonly planId: string;
  readonly cycleId: string;
  readonly lineId: string;
  readonly courseId: string;
  readonly deliveryType: string;
  /** `YYYY-MM-DD` (first day of the month). */
  readonly month: string;
  readonly branchId: string | null;
  readonly seats: number;
  readonly people: readonly { readonly personId: string; readonly needId: string }[];
}

/** Drafts and their planned participants, all or none (the guards decide; a refusal undoes every one). */
export async function insertSessions(
  tx: UserTx,
  sessions: readonly NewSession[],
): Promise<Guarded<string[]>> {
  return guarded(tx, async () => {
    const ids: string[] = [];
    for (const s of sessions) {
      const [row] = await tx.execute(sql`
        insert into tms.sessions (plan_id, cycle_id, plan_line_id, course_id, delivery_type, month, branch_id, seats)
        values (${s.planId}::uuid, ${s.cycleId}::uuid, ${s.lineId}::uuid, ${s.courseId}::uuid, ${s.deliveryType},
                ${s.month}::date, ${s.branchId}::uuid, ${s.seats})
        returning id`);
      if (!row) throw new Refused('not_allowed');
      const id = String(row.id);
      ids.push(id);
      await insertParticipantRows(tx, id, s.lineId, s.people);
    }
    return ids;
  });
}

async function insertParticipantRows(
  tx: UserTx,
  sessionId: string,
  lineId: string,
  people: readonly { readonly personId: string; readonly needId: string }[],
): Promise<void> {
  if (people.length === 0) return;
  const rows = await tx.execute(sql`
    insert into tms.session_participants (session_id, plan_line_id, need_id, person_id)
    select ${sessionId}::uuid, ${lineId}::uuid, x.need_id, x.person_id
    from unnest(${pgArray(people.map((p) => p.needId))}::uuid[], ${pgArray(people.map((p) => p.personId))}::uuid[])
      as x (need_id, person_id)
    returning id`);
  if (rows.length !== people.length) throw new Refused('not_allowed');
}

export interface SessionPatch {
  /** `YYYY-MM-DD`. */
  readonly month?: string;
  readonly branchId?: string | null;
  readonly seats?: number;
}

/**
 * Changes a draft at `version` and, with `people`, sets its planned participants: the people listed stay or come
 * (from another draft of the line: moved), the others leave. Seats grow before people come and shrink after they
 * leave, so the seats check (JK016) holds at every step. Null: the draft is not at that version.
 */
export async function updateSession(
  tx: UserTx,
  session: { readonly id: string; readonly lineId: string; readonly version: number },
  patch: SessionPatch,
  people: readonly { readonly personId: string; readonly needId: string }[] | null,
): Promise<Guarded<{ version: number; movedFrom: string[] } | null>> {
  return guarded(tx, async () => {
    const set: SQL[] = [];
    if (patch.month !== undefined) set.push(sql`month = ${patch.month}::date`);
    if (patch.branchId !== undefined) set.push(sql`branch_id = ${patch.branchId}::uuid`);
    if (patch.seats !== undefined) set.push(sql`seats = greatest(seats, ${patch.seats})`);
    // Always a write at the version seen: the draft's version moves even when only its people change.
    if (set.length === 0) set.push(sql`seats = seats`);
    const [row] = await tx.execute(sql`
      update tms.sessions set ${sql.join(set, sql`, `)}
      where id = ${session.id}::uuid and version = ${session.version} returning version`);
    if (!row) return null;
    let movedFrom: string[] = [];
    if (people !== null) {
      const keep = people.map((p) => p.personId);
      await tx.execute(sql`
        delete from tms.session_participants
        where session_id = ${session.id}::uuid and not (person_id = any (${pgArray(keep)}::uuid[]))`);
      if (keep.length > 0) {
        // Moved from another draft of the line: that draft changes too (a new version, review L6).
        const moved = await tx.execute(sql`
          with moved as (
            update tms.session_participants p set session_id = ${session.id}::uuid
            from tms.session_participants o
            where o.id = p.id and p.plan_line_id = ${session.lineId}::uuid and p.session_id <> ${session.id}::uuid
              and p.person_id = any (${pgArray(keep)}::uuid[])
            returning o.session_id)
          select distinct session_id from moved`);
        movedFrom = moved.map((r: Row) => String(r.session_id)).sort();
        if (movedFrom.length > 0) await touchSessions(tx, movedFrom);
        const [present] = await tx.execute(sql`
          select coalesce(array_agg(person_id::text), '{}') as ids from tms.session_participants
          where session_id = ${session.id}::uuid`);
        const have = new Set(
          Array.isArray(present?.ids) ? (present.ids as unknown[]).map(String) : [],
        );
        await insertParticipantRows(
          tx,
          session.id,
          session.lineId,
          people.filter((p) => !have.has(p.personId)),
        );
      }
    }
    let version = Number(row.version);
    if (patch.seats !== undefined) {
      const [shrunk] = await tx.execute(sql`
        update tms.sessions set seats = ${patch.seats}
        where id = ${session.id}::uuid and seats <> ${patch.seats} returning version`);
      if (shrunk) version = Number(shrunk.version);
    }
    return { version, movedFrom };
  });
}

/** A new version of drafts whose planned participants changed through another draft (people moved away). */
async function touchSessions(tx: UserTx, sessionIds: readonly string[]): Promise<void> {
  const rows = await tx.execute(sql`
    update tms.sessions set seats = seats where id = any (${pgArray(sessionIds)}::uuid[]) returning id`);
  if (rows.length !== sessionIds.length) throw new Refused('not_allowed');
}

/**
 * Moves one planned participant from a draft (at `version`) to another draft of the same line (review L6): both
 * drafts get a new version; the guards check the other draft's seats (JK016). Null: the draft is not at that
 * version, or the person is not planned in it.
 */
export async function moveParticipant(
  tx: UserTx,
  from: { readonly id: string; readonly version: number },
  toSessionId: string,
  personId: string,
): Promise<Guarded<{ fromVersion: number; toVersion: number } | null>> {
  return guarded(tx, async () => {
    const [source] = await tx.execute(sql`
      update tms.sessions set seats = seats where id = ${from.id}::uuid and version = ${from.version}
      returning version`);
    if (!source) return null;
    const moved = await tx.execute(sql`
      update tms.session_participants set session_id = ${toSessionId}::uuid
      where session_id = ${from.id}::uuid and person_id = ${personId}::uuid returning id`);
    if (moved.length !== 1) throw new Refused('refused');
    const [target] = await tx.execute(sql`
      update tms.sessions set seats = seats where id = ${toSessionId}::uuid returning version`);
    if (!target) throw new Refused('not_allowed');
    return { fromVersion: Number(source.version), toVersion: Number(target.version) };
  });
}

/** Deletes a draft at `version` (its participants go with it). Null: not at that version. */
export async function deleteSession(
  tx: UserTx,
  sessionId: string,
  version: number,
): Promise<Guarded<boolean | null>> {
  return guarded(tx, async () => {
    const rows = await tx.execute(sql`
      delete from tms.sessions where id = ${sessionId}::uuid and version = ${version} returning id`);
    return rows.length > 0 ? true : null;
  });
}

// ---------------------------------------------------------------------------------------------------
// Courses (the module's own library: names, codes, delivery type)
// ---------------------------------------------------------------------------------------------------

export interface CourseBrief {
  readonly id: string;
  readonly code: string;
  readonly titleEn: string | null;
  readonly titleAr: string | null;
  readonly deliveryType: string;
  readonly durationHours: number;
  readonly status: 'active' | 'archived';
}

export async function listCourseBriefs(tx: UserTx, ids: readonly string[]): Promise<CourseBrief[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await tx.execute(sql`
    select id, code, title_en, title_ar, delivery_type, duration_hours, status from tms.courses
    where id = any (${pgArray(unique)}::uuid[])`);
  return rows.map((r: Row) => ({
    id: String(r.id),
    code: String(r.code),
    titleEn: text(r.title_en),
    titleAr: text(r.title_ar),
    deliveryType: String(r.delivery_type),
    durationHours: Number(r.duration_hours),
    status: r.status === 'archived' ? 'archived' : 'active',
  }));
}

/** The approved plans the caller reads, with their cycle's period (the calendar's sources). */
export interface PlanSourceRecord {
  readonly planId: string;
  readonly cycleId: string;
  readonly status: string;
  readonly planVersion: number;
  readonly nameAr: string | null;
  readonly nameEn: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
}

/** Plans whose planning period overlaps [from, to] (`YYYY-MM-DD`), any state. */
export async function listPlansOverlapping(
  tx: UserTx,
  from: string,
  to: string,
): Promise<PlanSourceRecord[]> {
  const rows = await tx.execute(sql`
    select p.id, p.cycle_id, p.status, p.plan_version, c.name_ar, c.name_en, c.period_start_on::text as period_start_on,
           c.period_end_on::text as period_end_on, c.currency
    from tms.training_plans p
    join tms.plan_cycles c on c.tenant_id = p.tenant_id and c.id = p.cycle_id
    where c.period_start_on <= ${to}::date and c.period_end_on >= ${from}::date
    order by c.period_start_on, p.id`);
  return rows.map((r: Row) => ({
    planId: String(r.id),
    cycleId: String(r.cycle_id),
    status: String(r.status),
    planVersion: Number(r.plan_version),
    nameAr: text(r.name_ar),
    nameEn: text(r.name_en),
    periodStart: day(r.period_start_on) ?? '',
    periodEnd: day(r.period_end_on) ?? '',
    currency: text(r.currency)?.trim() ?? '',
  }));
}

/**
 * The year the planning period of the latest approved plan with drafts (the caller reads) starts in — the year the
 * training calendar opens on (review L7). Null: no such plan.
 */
export async function latestDraftedPlanYear(tx: UserTx): Promise<number | null> {
  const [row] = await tx.execute(sql`
    select extract(year from c.period_start_on)::int as year
    from tms.training_plans p
    join tms.plan_cycles c on c.tenant_id = p.tenant_id and c.id = p.cycle_id
    where p.status = 'approved'
      and exists (select 1 from tms.sessions s where s.tenant_id = p.tenant_id and s.plan_id = p.id)
    order by c.period_start_on desc, p.id
    limit 1`);
  return row ? Number(row.year) : null;
}

export async function getPlanSource(tx: UserTx, planId: string): Promise<PlanSourceRecord | null> {
  const rows = await tx.execute(sql`
    select p.id, p.cycle_id, p.status, p.plan_version, c.name_ar, c.name_en, c.period_start_on::text as period_start_on,
           c.period_end_on::text as period_end_on, c.currency
    from tms.training_plans p
    join tms.plan_cycles c on c.tenant_id = p.tenant_id and c.id = p.cycle_id
    where p.id = ${planId}::uuid`);
  const r = rows[0];
  if (!r) return null;
  return {
    planId: String(r.id),
    cycleId: String(r.cycle_id),
    status: String(r.status),
    planVersion: Number(r.plan_version),
    nameAr: text(r.name_ar),
    nameEn: text(r.name_en),
    periodStart: day(r.period_start_on) ?? '',
    periodEnd: day(r.period_end_on) ?? '',
    currency: text(r.currency)?.trim() ?? '',
  };
}
