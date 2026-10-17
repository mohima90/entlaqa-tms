import 'server-only';
import type { UserTx } from '@jadarat/platform-db';
import { type SQL, sql } from 'drizzle-orm';
import {
  type CourseCategoryRow,
  type CourseCounts,
  type CourseFilter,
  type CourseRow,
  type CourseStatus,
  type CourseValues,
  type DeliveryType,
  courseSearchKey,
} from './model';

/**
 * Request-path SQL of the course library (tables tms.courses, tms.course_categories; migration
 * 20261020120100). The calling actions authorize and audit; the database guards have the final word (who
 * may add, edit, archive — by permission) and row-level security keeps every statement in the claims'
 * organization. Errors are thrown as they come (the service maps the expected refusals).
 */

/** The longest list the page shows at once (a library this size is searched, not scrolled). */
export const COURSE_LIST_LIMIT = 500;

interface RawCourse extends Record<string, unknown> {
  id: string;
  code: string;
  title_en: string;
  title_ar: string;
  description_en: string | null;
  description_ar: string | null;
  category_id: string | null;
  delivery_type: DeliveryType;
  duration_hours: string | number;
  duration_days: string | number | null;
  min_participants: number;
  max_participants: number;
  est_cost_per_session: string | number | null;
  est_cost_per_participant: string | number | null;
  cost_currency: string | null;
  status: CourseStatus;
  version: number;
}

const num = (value: string | number | null): number | null =>
  value === null ? null : Number(value);

function toCourse(r: RawCourse, withCosts: boolean): CourseRow {
  return {
    id: r.id,
    code: r.code,
    titleEn: r.title_en,
    titleAr: r.title_ar,
    descriptionEn: r.description_en,
    descriptionAr: r.description_ar,
    categoryId: r.category_id,
    deliveryType: r.delivery_type,
    durationHours: Number(r.duration_hours),
    durationDays: num(r.duration_days),
    minParticipants: r.min_participants,
    maxParticipants: r.max_participants,
    estCostPerSession: withCosts ? num(r.est_cost_per_session) : null,
    estCostPerParticipant: withCosts ? num(r.est_cost_per_participant) : null,
    costCurrency: withCosts ? r.cost_currency : null,
    status: r.status,
    version: r.version,
  };
}

/** Costs are selected only for readers allowed to see them (never sent otherwise). */
function columns(withCosts: boolean): SQL {
  const costs = withCosts
    ? sql`c.est_cost_per_session, c.est_cost_per_participant, c.cost_currency`
    : sql`null::numeric as est_cost_per_session, null::numeric as est_cost_per_participant,
          null::text as cost_currency`;
  return sql`c.id, c.code, c.title_en, c.title_ar, c.description_en, c.description_ar, c.category_id,
    c.delivery_type, c.duration_hours, c.duration_days, c.min_participants, c.max_participants, ${costs},
    c.status, c.version`;
}

/** `like` pattern for user text: % _ and \ are matched literally. */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function filterPredicate(filter: CourseFilter): SQL {
  const parts: SQL[] = [sql`true`];
  const q = filter.q ? courseSearchKey(filter.q) : '';
  if (q !== '') {
    const pattern = containsPattern(q);
    // Arabic letter variants, diacritics and case ignored on both sides (private.search_key).
    parts.push(sql`(private.search_key(c.code) like private.search_key(${pattern})
      or private.search_key(c.title_en) like private.search_key(${pattern})
      or private.search_key(c.title_ar) like private.search_key(${pattern}))`);
  }
  if (filter.category === 'none') parts.push(sql`c.category_id is null`);
  else if (filter.category) parts.push(sql`c.category_id = ${filter.category}::uuid`);
  if (filter.type) parts.push(sql`c.delivery_type = ${filter.type}`);
  if (filter.status) parts.push(sql`c.status = ${filter.status}`);
  return sql.join(parts, sql` and `);
}

/** The organization's courses matching `filter` (by code), at most COURSE_LIST_LIMIT + 1. */
export async function listCourses(
  tx: UserTx,
  filter: CourseFilter,
  options: { readonly withCosts: boolean },
): Promise<CourseRow[]> {
  const rows = await tx.execute<RawCourse>(sql`
    select ${columns(options.withCosts)} from tms.courses c
    where ${filterPredicate(filter)}
    order by lower(c.code), c.id
    limit ${COURSE_LIST_LIMIT + 1}`);
  return rows.map((r) => toCourse(r, options.withCosts));
}

/** The summary cards: every course of the organization, whatever the filters. */
export async function countCourseStatuses(tx: UserTx): Promise<CourseCounts> {
  const [row] = await tx.execute<{ total: string | number; active: string | number }>(sql`
    select count(*) as total, count(*) filter (where c.status = 'active') as active from tms.courses c`);
  const total = Number(row?.total ?? 0);
  const active = Number(row?.active ?? 0);
  return { total, active, archived: total - active };
}

/** One course (with its costs), or null — unknown or another organization's. */
export async function getCourse(tx: UserTx, id: string): Promise<CourseRow | null> {
  const [row] = await tx.execute<RawCourse>(
    sql`select ${columns(true)} from tms.courses c where c.id = ${id}::uuid`,
  );
  return row ? toCourse(row, true) : null;
}

export async function listCourseCategories(tx: UserTx): Promise<CourseCategoryRow[]> {
  const rows = await tx.execute<{ id: string; name_en: string; name_ar: string }>(sql`
    select k.id, k.name_en, k.name_ar from tms.course_categories k order by lower(k.name_en), k.id`);
  return rows.map((r) => ({ id: r.id, nameEn: r.name_en, nameAr: r.name_ar }));
}

export async function insertCourseCategory(
  tx: UserTx,
  names: { readonly nameEn: string; readonly nameAr: string },
): Promise<CourseCategoryRow> {
  const [row] = await tx.execute<{ id: string; name_en: string; name_ar: string }>(sql`
    insert into tms.course_categories (name_en, name_ar) values (${names.nameEn}, ${names.nameAr})
    returning id, name_en, name_ar`);
  if (!row) throw new Error('insertCourseCategory: no row returned');
  return { id: row.id, nameEn: row.name_en, nameAr: row.name_ar };
}

/** The stored columns of a course's values (the category already resolved to an id or null). */
type StoredValues = Omit<CourseValues, 'category'> & { readonly categoryId: string | null };

export async function insertCourse(tx: UserTx, values: StoredValues): Promise<string> {
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into tms.courses (code, title_en, title_ar, description_en, description_ar, category_id, delivery_type,
                             duration_hours, duration_days, min_participants, max_participants,
                             est_cost_per_session, est_cost_per_participant)
    values (${values.code}, ${values.titleEn}, ${values.titleAr}, ${values.descriptionEn}, ${values.descriptionAr},
            ${values.categoryId}::uuid, ${values.deliveryType}, ${values.durationHours}, ${values.durationDays},
            ${values.minParticipants}, ${values.maxParticipants}, ${values.estCostPerSession},
            ${values.estCostPerParticipant})
    returning id`);
  if (!row) throw new Error('insertCourse: no row returned');
  return row.id;
}

/** Updates a course still at `expectedVersion`; false when it is not (or not visible). */
export async function updateCourseRow(
  tx: UserTx,
  id: string,
  expectedVersion: number,
  values: StoredValues,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    update tms.courses
    set code = ${values.code}, title_en = ${values.titleEn}, title_ar = ${values.titleAr},
        description_en = ${values.descriptionEn}, description_ar = ${values.descriptionAr},
        category_id = ${values.categoryId}::uuid, delivery_type = ${values.deliveryType},
        duration_hours = ${values.durationHours}, duration_days = ${values.durationDays},
        min_participants = ${values.minParticipants}, max_participants = ${values.maxParticipants},
        est_cost_per_session = ${values.estCostPerSession},
        est_cost_per_participant = ${values.estCostPerParticipant}
    where id = ${id}::uuid and version = ${expectedVersion}
    returning id`);
  return rows.length > 0;
}

/** Archives or restores a course still at `expectedVersion`; false when it is not (or not visible). */
export async function updateCourseStatus(
  tx: UserTx,
  id: string,
  expectedVersion: number,
  status: CourseStatus,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    update tms.courses set status = ${status}
    where id = ${id}::uuid and version = ${expectedVersion}
    returning id`);
  return rows.length > 0;
}
