import 'server-only';
import { type AppError, type Result, ok } from '@jadarat/platform-core';
import { type UserTx, getTenantCurrencyCode } from '@jadarat/platform-db';
import {
  type ActionDefinition,
  type QueryDefinition,
  coursePermissions,
} from '@jadarat/platform-rbac';
import { z } from 'zod';
import { COURSE_LIST_LIMIT, countCourseStatuses, listCourseCategories, listCourses } from './db';
import {
  COURSE_STATUSES,
  type CourseCategoryRow,
  type CourseCounts,
  type CourseRow,
  CourseValuesInput,
  DELIVERY_TYPES,
} from './model';
import { type CourseSaved, createCourse, setCourseStatus, updateCourse } from './service';

/**
 * The course library's page query and actions (T-M3-03; FR-CAT-01, FR-CAT-10). Permissions
 * (course-permissions.ts, BRD Appendix B): `tms.course.read` to see the library, `tms.course_cost.read`
 * for its estimated costs, `tms.course.manage` to add and edit (L&D Manager, Training Coordinator),
 * `tms.course.archive` to archive and restore (L&D Manager). All organization-wide: a member without a
 * `tenant`-scope grant is refused (403) — the Organization Admin holds none of them (BR-IAM-4). The
 * database guards check the same permissions again. Every change is audited with before and after (course
 * values — no personal data).
 */
const c = coursePermissions;

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema.optional());

/** The list's filters from the query string (untrusted). */
export const CoursesPageInput = z.strictObject({
  q: optional(z.string().trim().max(100)),
  category: optional(z.union([z.literal('none'), z.uuid()])),
  type: optional(z.enum(DELIVERY_TYPES)),
  status: optional(z.enum(COURSE_STATUSES)),
});

export interface CoursesPageView {
  readonly courses: readonly CourseRow[];
  /** More courses match than the page shows (COURSE_LIST_LIMIT): narrow the search. */
  readonly truncated: boolean;
  readonly categories: readonly CourseCategoryRow[];
  /** Summary cards (the whole library, whatever the filters). */
  readonly counts: CourseCounts;
  /** The organization's default currency (General settings) — the currency new costs are entered in. */
  readonly currency: string;
  readonly canManage: boolean;
  readonly canArchive: boolean;
  /** Costs are sent only to holders of tms.course_cost.read. */
  readonly canSeeCosts: boolean;
}

export function coursesPageQueryDefinition(): QueryDefinition<
  typeof CoursesPageInput,
  CoursesPageView,
  UserTx
> {
  return {
    permission: c['tms.course.read'],
    input: CoursesPageInput,
    handler: async ({ ctx, input }) => {
      const canSeeCosts = ctx.can(c['tms.course_cost.read'], 'tenant');
      const rows = await listCourses(ctx.tx, input, { withCosts: canSeeCosts });
      return ok({
        courses: rows.slice(0, COURSE_LIST_LIMIT),
        truncated: rows.length > COURSE_LIST_LIMIT,
        categories: await listCourseCategories(ctx.tx),
        counts: await countCourseStatuses(ctx.tx),
        currency: await getTenantCurrencyCode(ctx.tx),
        canManage: ctx.can(c['tms.course.manage'], 'tenant'),
        canArchive: ctx.can(c['tms.course.archive'], 'tenant'),
        canSeeCosts,
      });
    },
  };
}

export const UpdateCourseInput = CourseValuesInput.extend({
  id: z.uuid(),
  version: z.number().int().min(1),
});

export const CourseStatusInput = z.strictObject({
  id: z.uuid(),
  version: z.number().int().min(1),
  status: z.enum(COURSE_STATUSES),
});

/** What the audit log keeps of a course: its values (no personal data). */
export function courseAuditShape(row: CourseRow | null) {
  return row
    ? {
        code: row.code,
        titleEn: row.titleEn,
        titleAr: row.titleAr,
        categoryId: row.categoryId,
        deliveryType: row.deliveryType,
        durationHours: row.durationHours,
        durationDays: row.durationDays,
        minParticipants: row.minParticipants,
        maxParticipants: row.maxParticipants,
        estCostPerSession: row.estCostPerSession,
        estCostPerParticipant: row.estCostPerParticipant,
        costCurrency: row.costCurrency,
        status: row.status,
      }
    : null;
}

/**
 * What a course action's handler returns: the full rows (kept whole for the audit log) and whether the actor
 * may see the estimated costs (tms.course_cost.read). The caller gets `courseResponse` of it (code review
 * C-M2): without the permission the cost fields are blanked, as in the list.
 */
export interface CourseActionOutput extends CourseSaved {
  readonly costsVisible: boolean;
}

function withoutCosts(row: CourseRow): CourseRow {
  return { ...row, estCostPerSession: null, estCostPerParticipant: null, costCurrency: null };
}

/** The action's answer to the caller: costs only for holders of tms.course_cost.read. */
export function courseResponse(output: CourseActionOutput): CourseSaved {
  const { costsVisible, ...saved } = output;
  if (costsVisible) return saved;
  return {
    ...saved,
    before: saved.before ? withoutCosts(saved.before) : null,
    after: withoutCosts(saved.after),
  };
}

const respond = ({ result }: { readonly result: CourseActionOutput }) =>
  Promise.resolve(ok(courseResponse(result)));

async function withCostVisibility(
  costsVisible: boolean,
  saved: Promise<Result<CourseSaved, AppError>>,
): Promise<Result<CourseActionOutput, AppError>> {
  const result = await saved;
  return result.ok ? ok({ ...result.value, costsVisible }) : result;
}

function auditData(output: CourseSaved) {
  return {
    before: courseAuditShape(output.before),
    after: courseAuditShape(output.after),
    ...(output.categoryCreated ? { categoryCreated: output.categoryCreated } : {}),
  };
}

export function createCourseActionDefinition(): ActionDefinition<
  typeof CourseValuesInput,
  CourseActionOutput,
  UserTx,
  CourseSaved
> {
  return {
    permission: c['tms.course.manage'],
    input: CourseValuesInput,
    handler: ({ ctx, input }) => {
      const costsVisible = ctx.can(c['tms.course_cost.read'], 'tenant');
      return withCostVisibility(
        costsVisible,
        createCourse(ctx.tx, input, { withoutCosts: !costsVisible }),
      );
    },
    afterCommit: respond,
    audit: (_input, output) => ({
      action: 'tms.course.created',
      entityType: 'course',
      entityId: output.after.id,
      data: auditData(output),
    }),
  };
}

export function updateCourseActionDefinition(): ActionDefinition<
  typeof UpdateCourseInput,
  CourseActionOutput,
  UserTx,
  CourseSaved
> {
  return {
    permission: c['tms.course.manage'],
    input: UpdateCourseInput,
    handler: ({ ctx, input }) => {
      const { id, version, ...values } = input;
      const costsVisible = ctx.can(c['tms.course_cost.read'], 'tenant');
      return withCostVisibility(
        costsVisible,
        updateCourse(ctx.tx, id, version, values, { keepCosts: !costsVisible }),
      );
    },
    afterCommit: respond,
    audit: (_input, output) => ({
      action: 'tms.course.updated',
      entityType: 'course',
      entityId: output.after.id,
      data: auditData(output),
    }),
  };
}

export function setCourseStatusActionDefinition(): ActionDefinition<
  typeof CourseStatusInput,
  CourseActionOutput,
  UserTx,
  CourseSaved
> {
  return {
    permission: c['tms.course.archive'],
    input: CourseStatusInput,
    handler: ({ ctx, input }) =>
      withCostVisibility(
        ctx.can(c['tms.course_cost.read'], 'tenant'),
        setCourseStatus(ctx.tx, input.id, input.version, input.status),
      ),
    afterCommit: respond,
    audit: (input, output) => ({
      action: input.status === 'archived' ? 'tms.course.archived' : 'tms.course.restored',
      entityType: 'course',
      entityId: output.after.id,
      data: auditData(output),
    }),
  };
}
