import 'server-only';
import { type AppError, type Result, appError, err, ok } from '@jadarat/platform-core';
import { type UserTx, pgError } from '@jadarat/platform-db';
import {
  getCourse,
  insertCourse,
  insertCourseCategory,
  updateCourseRow,
  updateCourseStatus,
} from './db';
import {
  type CourseCategoryRow,
  type CourseRow,
  type CourseStatus,
  type CourseValues,
  courseFieldProblems,
} from './model';

/**
 * Course library service (T-M3-03): plain functions on the caller's transaction, returning Result. The
 * server actions call them after authorizing; a later caller (e.g. "create a course from an approved plan
 * line", EP-PLN F21 / T-M3-08) calls `createCourse` the same way with values pre-filled from its own
 * source — the service knows nothing about plans. The database guards still decide who may write.
 */

export interface CourseSaved {
  readonly before: CourseRow | null;
  readonly after: CourseRow;
  /** A category created together with the course (category choice `new`). */
  readonly categoryCreated: CourseCategoryRow | null;
}

function validation(path: string, code: string): AppError {
  return appError('VALIDATION_FAILED', { fieldErrors: [{ path, code }] });
}

/**
 * The expected refusals of the database, as field errors; anything else is rethrown (an internal error
 * with a correlation id). After any of them the transaction is aborted: callers return at once.
 */
export function courseRefusalOf(error: unknown): AppError {
  const pg = pgError(error);
  if (pg?.code === '42501') return appError('FORBIDDEN');
  if (pg?.code === '23505' && pg.constraint === 'courses_tenant_code_uq') {
    return validation('code', 'CODE_TAKEN');
  }
  if (pg?.code === '23505' && pg.constraint === 'course_categories_tenant_name_en_uq') {
    return validation('category.nameEn', 'NAME_TAKEN');
  }
  if (pg?.code === '23505' && pg.constraint === 'course_categories_tenant_name_ar_uq') {
    return validation('category.nameAr', 'NAME_TAKEN');
  }
  if (pg?.code === '23503') return validation('category.id', 'NOT_FOUND');
  throw error;
}

function crossFieldError(values: CourseValues): AppError | null {
  const problems = courseFieldProblems(values);
  return problems.length > 0 ? appError('VALIDATION_FAILED', { fieldErrors: problems }) : null;
}

async function resolveCategory(
  tx: UserTx,
  values: CourseValues,
): Promise<{ readonly id: string | null; readonly created: CourseCategoryRow | null }> {
  switch (values.category.kind) {
    case 'none':
      return { id: null, created: null };
    case 'existing':
      return { id: values.category.id, created: null };
    case 'new': {
      const created = await insertCourseCategory(tx, values.category);
      return { id: created.id, created };
    }
  }
}

function stored(values: CourseValues, categoryId: string | null) {
  const { category: _category, ...rest } = values;
  return { ...rest, categoryId };
}

/**
 * Adds a course (and its new category, if one is asked for) to the organization's library. `withoutCosts`:
 * the author does not see the estimated costs (no tms.course_cost.read), so none are stored.
 */
export async function createCourse(
  tx: UserTx,
  input: CourseValues,
  options: { readonly withoutCosts?: boolean } = {},
): Promise<Result<CourseSaved, AppError>> {
  const values: CourseValues = options.withoutCosts
    ? { ...input, estCostPerSession: null, estCostPerParticipant: null }
    : input;
  const problem = crossFieldError(values);
  if (problem) return err(problem);
  let id: string;
  let created: CourseCategoryRow | null;
  try {
    const category = await resolveCategory(tx, values);
    created = category.created;
    id = await insertCourse(tx, stored(values, category.id));
  } catch (error) {
    return err(courseRefusalOf(error));
  }
  const after = await getCourse(tx, id);
  if (!after) throw new Error('createCourse: the new course is not visible');
  return ok({ before: null, after, categoryCreated: created });
}

/**
 * Changes a course's values when it is still at `expectedVersion`. `keepCosts`: the editor does not see the
 * estimated costs (no tms.course_cost.read), so the stored ones stay as they are whatever was sent.
 */
export async function updateCourse(
  tx: UserTx,
  id: string,
  expectedVersion: number,
  input: CourseValues,
  options: { readonly keepCosts?: boolean } = {},
): Promise<Result<CourseSaved, AppError>> {
  const problem = crossFieldError(input);
  if (problem) return err(problem);
  const before = await getCourse(tx, id);
  if (!before) return err(appError('NOT_FOUND'));
  if (before.version !== expectedVersion) return err(appError('CONFLICT_VERSION'));
  const values: CourseValues = options.keepCosts
    ? {
        ...input,
        estCostPerSession: before.estCostPerSession,
        estCostPerParticipant: before.estCostPerParticipant,
      }
    : input;
  let created: CourseCategoryRow | null;
  try {
    const category = await resolveCategory(tx, values);
    created = category.created;
    if (!(await updateCourseRow(tx, id, expectedVersion, stored(values, category.id)))) {
      return err(appError('CONFLICT_VERSION'));
    }
  } catch (error) {
    return err(courseRefusalOf(error));
  }
  const after = await getCourse(tx, id);
  if (!after) throw new Error('updateCourse: the course is no longer visible');
  return ok({ before, after, categoryCreated: created });
}

/** Archives (`archived`) or restores (`active`) a course still at `expectedVersion`. */
export async function setCourseStatus(
  tx: UserTx,
  id: string,
  expectedVersion: number,
  status: CourseStatus,
): Promise<Result<CourseSaved, AppError>> {
  const before = await getCourse(tx, id);
  if (!before) return err(appError('NOT_FOUND'));
  if (before.version !== expectedVersion) return err(appError('CONFLICT_VERSION'));
  if (before.status === status) {
    return err(validation('status', status === 'archived' ? 'ALREADY_ARCHIVED' : 'ALREADY_ACTIVE'));
  }
  try {
    if (!(await updateCourseStatus(tx, id, expectedVersion, status))) {
      return err(appError('CONFLICT_VERSION'));
    }
  } catch (error) {
    return err(courseRefusalOf(error));
  }
  const after = await getCourse(tx, id);
  if (!after) throw new Error('setCourseStatus: the course is no longer visible');
  return ok({ before, after, categoryCreated: null });
}
