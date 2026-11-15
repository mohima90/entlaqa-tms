import {
  type AppError,
  type FieldError,
  type Result,
  appError,
  defineErrorCodes,
  err,
  ok,
} from '@jadarat/platform-core';
import {
  type OrgStructure,
  type UserTx,
  getMemberOptionsByIds,
  getTenantCurrencyCode,
  getTenantDefaultLocale,
  listOrgStructure,
} from '@jadarat/platform-db';
import {
  type ActionContext,
  type ActionDefinition,
  type AuditRecord,
  type QueryDefinition,
  coursePermissions,
  tmsPlanningPermissions,
} from '@jadarat/platform-rbac';
import { courseAuditShape } from '../courses/actions';
import { getCourse } from '../courses/db';
import {
  COURSE_DEFAULTS,
  COURSE_LIMITS,
  type CourseRow,
  type DeliveryType,
} from '../courses/model';
import { createCourse } from '../courses/service';
import type { PersonName } from '../planning/definitions';
import { planScope } from '../planning/consolidation-definitions';
import {
  type LineStatus,
  type PlanStatus,
  type Quarter,
  amountMilli,
  fromMilli,
  lineFigures,
} from '../planning/consolidation-rules';
import * as plans from '../planning/consolidation-repository';
import { structureName } from '../planning/rules';
import {
  CreateCourseFromLineInput,
  CreateDraftSessionsInput,
  DeleteDraftSessionInput,
  DraftSessionRef,
  type LineSessionState,
  LinkLineCourseInput,
  PlanDeliveryInput,
  PlanLineRef,
  type ProposalDepartment,
  TrainingCalendarInput,
  UpdateDraftSessionInput,
  addMonths,
  draftCost,
  lineSessionState,
  monthInPeriod,
  monthOf,
  monthStart,
  outsideQuarter,
  proposeSessions,
  quarterMonths,
  remainingProposal,
} from './model';
import * as repo from './repository';

/**
 * From the approved plan to courses and draft sessions (WP-LD-04, T-M3-08; FR-PLN-09, FR-CAT-01 «course from a plan
 * line», FR-SCH-01 core, FR-IAM-08 R1 note; business flow EP-PLN §3 F step 21; proposal
 * docs/product/proposals/wp-ld-04-plan-to-courses-and-draft-sessions.md, Q1–Q3 = A; approved screens
 * docs/design/screens/m3-plan-to-sessions/README.md). Bound to defineAction in `actions/sessions.ts` and to
 * defineQuery in the app; unit-tested with a fake runtime. The database repeats every rule (migration
 * 20261117100200).
 *
 *   course of an approved line   tms.training_plan.manage organization-wide (the L&D Manager) — and tms.course.manage
 *                                to create the course («Create course»), tms.course.read to link one («Link course»)
 *   draft sessions               tms.session.manage — organization-wide (L&D Manager, Training Coordinator), or a
 *                                custom role limited to «A department»: reads the drafts of lines holding a need of
 *                                its units, changes those whose every department is in them (it also needs to read
 *                                the plan: tms.training_plan.read for the same units)
 * Nobody else sees a draft (proposal §3). Every change is audited; planned participants are counted in the audit
 * log, never listed (personal data is minimised).
 */

const pln = tmsPlanningPermissions;
const c = coursePermissions;
const SESSION_MANAGE = pln['tms.session.manage'];
const PLAN_MANAGE = pln['tms.training_plan.manage'];

/** Module error codes (ADR 0011 §3); messages under `errors.*` in the catalogs. */
export const DraftSessionErrors = defineErrorCodes({
  /** Courses and drafts come from an APPROVED plan (a draft or revised plan is not the year's to-do list yet). */
  SESSION_PLAN_NOT_APPROVED: { status: 409, messageKey: 'errors.sessionPlanNotApproved' },
  /** A line left out of the plan gets no course and no session. */
  SESSION_LINE_LEFT_OUT: { status: 409, messageKey: 'errors.sessionLineLeftOut' },
  /** «Create sessions» comes after the course. */
  SESSION_LINE_NEEDS_COURSE: { status: 409, messageKey: 'errors.sessionLineNeedsCourse' },
  /** The line has no session size (only after a revision). */
  SESSION_LINE_NEEDS_SIZE: { status: 409, messageKey: 'errors.sessionLineNeedsSize' },
  /** The line already has every session the plan works out (params: planned, drafted). */
  SESSION_LINE_ALL_DRAFTED: { status: 409, messageKey: 'errors.sessionLineAllDrafted' },
  /** A line with drafts keeps its course (delete its drafts first). */
  SESSION_LINE_HAS_DRAFTS: { status: 409, messageKey: 'errors.sessionLineHasDrafts' },
  /** A department-limited planner and a line shared with a unit outside its own. */
  SESSION_LINE_OUTSIDE_SCOPE: { status: 403, messageKey: 'errors.sessionLineOutsideScope' },
});

type Ctx = ActionContext<UserTx>;

// ---------------------------------------------------------------------------------------------------
// Shared views
// ---------------------------------------------------------------------------------------------------

export interface LocalName {
  readonly ar: string | null;
  readonly en: string | null;
}

/** How a line got its course (design screen 1): created from the line, named in the needs, linked from the library. */
export type LineCourseOrigin = 'created' | 'needs' | 'linked';

export interface CourseBriefView {
  readonly id: string;
  readonly code: string;
  readonly titleEn: string | null;
  readonly titleAr: string | null;
  readonly deliveryType: string;
  readonly durationHours: number;
  readonly status: 'active' | 'archived';
}

export interface LineCourseView extends CourseBriefView {
  readonly origin: LineCourseOrigin;
}

/** What «Create course» is filled with (design screen 2, «From the plan»): the course popup's values. */
export interface CourseFromLineDraft {
  /** The line's one title, in the organization's default language's field (the other stays empty, optional). */
  readonly titleEn: string | null;
  readonly titleAr: string | null;
  /** Null: the line said none; the popup asks. */
  readonly deliveryType: DeliveryType | null;
  readonly durationHours: number | null;
  readonly minParticipants: number;
  readonly maxParticipants: number;
  /** The plan's costs — only when the cycle's currency is the organization's and the viewer sees costs. */
  readonly estCostPerSession: number | null;
  readonly estCostPerParticipant: number | null;
  readonly currency: string;
}

export interface LineDraftsSummary {
  readonly count: number;
  /** `YYYY-MM`, in order (design: «3 draft sessions · Jan · Feb · Mar»). */
  readonly months: readonly string[];
  /** Drafts planned outside the line's quarter (Q3 = A: marked «outside the planned quarter»). */
  readonly outsideQuarter: number;
  readonly seats: number;
}

export interface PlanLineDeliveryView {
  readonly lineId: string;
  /** The line's version (what «Create / Link course» names). */
  readonly version: number;
  readonly title: string;
  readonly status: LineStatus;
  readonly quarter: Quarter;
  readonly quarterMonths: readonly [string, string, string];
  readonly deliveryType: string | null;
  readonly durationHours: number | null;
  readonly minPerSession: number | null;
  readonly maxPerSession: number | null;
  readonly costPerSession: string | null;
  readonly costPerPerson: string | null;
  readonly people: number;
  readonly named: number;
  /** The plan's session count for the line now (null: no size); sizes as the plan spreads its people. */
  readonly plannedSessions: number | null;
  readonly sizes: readonly number[];
  readonly course: LineCourseView | null;
  readonly drafts: LineDraftsSummary;
  readonly state: LineSessionState;
  /** «Create course» pre-filled (a line in the plan without a course; null otherwise). */
  readonly courseDraft: CourseFromLineDraft | null;
  readonly can: {
    readonly createCourse: boolean;
    readonly linkCourse: boolean;
    readonly createSessions: boolean;
  };
}

export interface PlanDeliveryView {
  readonly plan: {
    readonly id: string;
    readonly status: PlanStatus;
    readonly planVersion: number;
  };
  readonly cycle: {
    readonly id: string;
    readonly name: LocalName;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly currency: string;
  };
  readonly scope: 'organization' | 'departments';
  readonly lines: readonly PlanLineDeliveryView[];
  /** The «From the plan to sessions» card (design screen 1). */
  readonly summary: {
    readonly linesInPlan: number;
    readonly leftOut: number;
    readonly linesWithCourse: number;
    /** Lines whose drafts are all made (drafted or more). */
    readonly linesWithSessions: number;
    readonly sessionsPlanned: number;
    readonly sessionsDrafted: number;
  };
  /** The filter pills: «Needs a course · Needs sessions · Sessions created». */
  readonly counts: {
    readonly needsCourse: number;
    readonly needsSessions: number;
    readonly sessionsCreated: number;
  };
}

// ---------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------

interface Scope {
  readonly organization: boolean;
  readonly units: ReadonlySet<string>;
}

function sessionScope(ctx: Ctx, structure: OrgStructure): Scope {
  return planScope(ctx.grantsFor(SESSION_MANAGE), structure);
}

/** The viewer reads the drafts of a line holding a need of its units (organization-wide: all). */
const seesLine = (scope: Scope, departmentIds: readonly string[]) =>
  scope.organization || departmentIds.some((d) => scope.units.has(d));

/** The viewer changes the drafts of a line whose every department is in its units. */
const draftsLine = (scope: Scope, departmentIds: readonly string[]) =>
  scope.organization ||
  (departmentIds.length > 0 && departmentIds.every((d) => scope.units.has(d)));

const validation = (fieldErrors: readonly FieldError[]) =>
  err(appError('VALIDATION_FAILED', { fieldErrors }));

function refusalError(refusal: repo.SessionRefusal): AppError {
  switch (refusal) {
    case 'not_ready':
      return appError(DraftSessionErrors.SESSION_LINE_NEEDS_COURSE);
    case 'all_drafted':
      return appError(DraftSessionErrors.SESSION_LINE_ALL_DRAFTED);
    case 'outside_period':
      return appError('VALIDATION_FAILED', {
        fieldErrors: [{ path: 'month', code: 'OUTSIDE_PERIOD' }],
      });
    case 'seats':
      return appError('VALIDATION_FAILED', {
        fieldErrors: [{ path: 'seats', code: 'FEWER_THAN_PEOPLE' }],
      });
    case 'frozen':
      return appError(DraftSessionErrors.SESSION_PLAN_NOT_APPROVED);
    case 'not_allowed':
      return appError(DraftSessionErrors.SESSION_LINE_OUTSIDE_SCOPE);
    case 'person_taken':
      return appError('CONFLICT_VERSION');
    case 'refused':
      return appError('PRECONDITION_FAILED');
  }
}

function courseOrigin(
  line: { readonly groupKey: string; readonly courseId: string | null },
  stored: 'created' | 'linked' | null,
): LineCourseOrigin {
  if (stored !== null) return stored;
  return line.courseId !== null && line.groupKey === `course:${line.courseId}` ? 'needs' : 'linked';
}

const courseView = (course: repo.CourseBrief): CourseBriefView => ({
  id: course.id,
  code: course.code,
  titleEn: course.titleEn,
  titleAr: course.titleAr,
  deliveryType: course.deliveryType,
  durationHours: course.durationHours,
  status: course.status,
});

const draftMonth = (s: repo.SessionRecord) => (s.month ? monthOf(s.month) : null);

/** Drafts of a line in the order «1 of 3» counts them: by month, then as they were made. */
function inLineOrder(sessions: readonly repo.SessionRecord[]): repo.SessionRecord[] {
  return [...sessions].sort(
    (a, b) =>
      (a.month ?? '9999').localeCompare(b.month ?? '9999') ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
}

/** Everything about one line that its drafts need: its plan, cycle, departments, named people and drafts. */
interface LineContext {
  readonly line: plans.LineRecord;
  readonly plan: repo.PlanSourceRecord;
  readonly structure: OrgStructure;
  readonly scope: Scope;
  readonly departments: readonly {
    readonly departmentId: string;
    readonly seats: number;
    readonly named: number;
  }[];
  readonly departmentIds: readonly string[];
  readonly named: readonly repo.NamedPersonRecord[];
  readonly sessions: readonly repo.SessionRecord[];
  readonly participants: readonly repo.ParticipantRecord[];
  readonly figures: ReturnType<typeof lineFigures>;
  readonly quarterMonths: [string, string, string];
}

async function lineContext(ctx: Ctx, lineId: string): Promise<LineContext | null> {
  const [line] = await plans.getLines(ctx.tx, [lineId]);
  if (!line) return null;
  const plan = await repo.getPlanSource(ctx.tx, line.planId);
  if (!plan) return null;
  const structure = await listOrgStructure(ctx.tx);
  const scope = sessionScope(ctx, structure);
  const links = (await plans.listLinks(ctx.tx, line.planId)).filter((l) => l.lineId === line.id);
  const byDepartment = new Map<string, { seats: number; named: number }>();
  for (const link of links) {
    const entry = byDepartment.get(link.departmentId) ?? { seats: 0, named: 0 };
    entry.seats += link.seats;
    entry.named += link.named;
    byDepartment.set(link.departmentId, entry);
  }
  const departments = [...byDepartment.entries()].map(([departmentId, v]) => ({
    departmentId,
    ...v,
  }));
  const departmentIds = departments.map((d) => d.departmentId);
  // Deny by default: a line outside the viewer's units is not known to it.
  if (!seesLine(scope, departmentIds)) return null;
  return {
    line,
    plan,
    structure,
    scope,
    departments,
    departmentIds,
    named: await repo.listNamedPeople(ctx.tx, [line.id]),
    sessions: inLineOrder(await repo.listLineSessions(ctx.tx, [line.id])),
    participants: await repo.listLineParticipants(ctx.tx, [line.id]),
    figures: lineFigures({
      minPerSession: line.minPerSession,
      maxPerSession: line.maxPerSession,
      costPerSession: line.costPerSession,
      costPerPerson: line.costPerPerson,
      departments,
    }),
    quarterMonths: quarterMonths(plan.periodStart, line.quarter),
  };
}

/** Why a line cannot get drafts now (null: it can). */
function draftProblem(context: LineContext): AppError | null {
  const { line, plan, figures, sessions } = context;
  if (plan.status !== 'approved') return appError(DraftSessionErrors.SESSION_PLAN_NOT_APPROVED);
  if (line.status !== 'in_plan') return appError(DraftSessionErrors.SESSION_LINE_LEFT_OUT);
  if (line.courseId === null) return appError(DraftSessionErrors.SESSION_LINE_NEEDS_COURSE);
  if (figures.plan === null) return appError(DraftSessionErrors.SESSION_LINE_NEEDS_SIZE);
  if (sessions.length >= figures.plan.sessions) {
    return appError(DraftSessionErrors.SESSION_LINE_ALL_DRAFTED, {
      params: { planned: figures.plan.sessions, drafted: sessions.length },
    });
  }
  return null;
}

/** Names of people (the organization's members the caller reads). */
async function namesOf(tx: UserTx, personIds: readonly string[]): Promise<Map<string, PersonName>> {
  const members = await getMemberOptionsByIds(tx, personIds);
  return new Map(members.map((m) => [m.personId, { ar: m.nameAr, en: m.nameEn }]));
}

const branchesOf = (structure: OrgStructure) =>
  structure.branches
    .filter((b) => b.active)
    .map((b) => ({ id: b.id, name: { ar: b.nameAr, en: b.nameEn } }));

const audit = (
  action: string,
  entityType: string,
  entityId: string,
  data: Record<string, unknown>,
): AuditRecord => ({ action, entityType, entityId, data });

// ---------------------------------------------------------------------------------------------------
// The approved plan's Course and Draft sessions columns (design screen 1)
// ---------------------------------------------------------------------------------------------------

function courseFromLine(
  line: plans.LineRecord,
  locale: 'ar' | 'en',
  costs: { readonly currency: string; readonly sameCurrency: boolean; readonly visible: boolean },
): CourseFromLineDraft {
  const title = Array.from(line.title).slice(0, COURSE_LIMITS.titleLength).join('').trim();
  const money = (amount: string | null): number | null => {
    if (!costs.sameCurrency || !costs.visible || amount === null) return null;
    const value = Number(amount);
    // The library keeps two decimals and at most 9,999,999,999.99 (courses_*_check).
    return value <= COURSE_LIMITS.maxCost ? Math.round(value * 100) / 100 : null;
  };
  const max = line.maxPerSession ?? COURSE_DEFAULTS.maxParticipants;
  const min = Math.min(line.minPerSession ?? COURSE_DEFAULTS.minParticipants, max);
  return {
    titleEn: locale === 'en' ? title : null,
    titleAr: locale === 'ar' ? title : null,
    deliveryType: line.deliveryType,
    durationHours:
      line.durationHours !== null && line.durationHours <= COURSE_LIMITS.maxHours
        ? line.durationHours
        : null,
    minParticipants: Math.min(min, COURSE_LIMITS.maxParticipants),
    maxParticipants: Math.min(max, COURSE_LIMITS.maxParticipants),
    estCostPerSession: money(line.costPerSession),
    estCostPerParticipant: money(line.costPerPerson),
    currency: costs.currency,
  };
}

/**
 * The approved plan of a cycle with each line's course and drafts (design screen 1: the Course and Draft sessions
 * columns, the «From the plan to sessions» card, the filter pills). For holders of tms.session.manage, in their scope:
 * the UI joins it to the Plan tab's lines (trainingPlanQuery) by `lineId`. NOT_FOUND without a plan the viewer reads.
 */
export function planDeliveryQueryDefinition(): QueryDefinition<
  typeof PlanDeliveryInput,
  PlanDeliveryView,
  UserTx
> {
  return {
    permission: SESSION_MANAGE,
    input: PlanDeliveryInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const record = await plans.getPlanByCycle(ctx.tx, input.cycleId);
      if (!record) return err(appError('NOT_FOUND'));
      const plan = await repo.getPlanSource(ctx.tx, record.id);
      if (!plan) return err(appError('NOT_FOUND'));
      const structure = await listOrgStructure(ctx.tx);
      const scope = sessionScope(ctx, structure);
      const lines = await plans.listLines(ctx.tx, plan.planId);
      const links = await plans.listLinks(ctx.tx, plan.planId);
      const origins = new Map(
        (await repo.listLineCourses(ctx.tx, plan.planId)).map((r) => [r.lineId, r.courseOrigin]),
      );
      const sessions = await repo.listPlanSessions(ctx.tx, plan.planId);
      const courses = new Map(
        (
          await repo.listCourseBriefs(
            ctx.tx,
            lines.flatMap((l) => (l.courseId ? [l.courseId] : [])),
          )
        ).map((course) => [course.id, course]),
      );
      const approved = plan.status === 'approved';
      const lineCourses = approved && ctx.can(PLAN_MANAGE, 'tenant');
      const canCreateCourse = lineCourses && ctx.can(c['tms.course.manage'], 'tenant');
      const canLinkCourse = lineCourses && ctx.can(c['tms.course.read'], 'tenant');
      const locale = await getTenantDefaultLocale(ctx.tx);
      const costs = {
        currency: plan.currency,
        sameCurrency: (await getTenantCurrencyCode(ctx.tx)) === plan.currency,
        visible: ctx.can(c['tms.course_cost.read'], 'tenant'),
      };

      const views: PlanLineDeliveryView[] = [];
      for (const line of lines) {
        const own = links.filter((l) => l.lineId === line.id);
        const departmentIds = [...new Set(own.map((l) => l.departmentId))];
        if (!seesLine(scope, departmentIds)) continue;
        const perDepartment = departmentIds.map((departmentId) => ({
          departmentId,
          seats: own
            .filter((l) => l.departmentId === departmentId)
            .reduce((n, l) => n + l.seats, 0),
          named: own
            .filter((l) => l.departmentId === departmentId)
            .reduce((n, l) => n + l.named, 0),
        }));
        const figures = lineFigures({
          minPerSession: line.minPerSession,
          maxPerSession: line.maxPerSession,
          costPerSession: line.costPerSession,
          costPerPerson: line.costPerPerson,
          departments: perDepartment,
        });
        const drafts = inLineOrder(sessions.filter((s) => s.lineId === line.id));
        const months = drafts.flatMap((s) => {
          const month = draftMonth(s);
          return month ? [month] : [];
        });
        const course = line.courseId ? courses.get(line.courseId) : undefined;
        const planned = figures.plan?.sessions ?? null;
        const state = lineSessionState({
          status: line.status,
          hasCourse: line.courseId !== null,
          planned,
          drafted: drafts.length,
        });
        const inPlan = line.status === 'in_plan';
        views.push({
          lineId: line.id,
          version: line.version,
          title: line.title,
          status: line.status,
          quarter: line.quarter,
          quarterMonths: quarterMonths(plan.periodStart, line.quarter),
          deliveryType: line.deliveryType,
          durationHours: line.durationHours,
          minPerSession: line.minPerSession,
          maxPerSession: line.maxPerSession,
          costPerSession: line.costPerSession,
          costPerPerson: line.costPerPerson,
          people: figures.people,
          named: figures.named,
          plannedSessions: planned,
          sizes: figures.plan?.sizes ?? [],
          course: course
            ? { ...courseView(course), origin: courseOrigin(line, origins.get(line.id) ?? null) }
            : null,
          drafts: {
            count: drafts.length,
            months,
            outsideQuarter: months.filter((m) => outsideQuarter(m, plan.periodStart, line.quarter))
              .length,
            seats: drafts.reduce((n, s) => n + s.seats, 0),
          },
          state,
          courseDraft:
            inPlan && line.courseId === null ? courseFromLine(line, locale, costs) : null,
          can: {
            createCourse: canCreateCourse && inPlan && drafts.length === 0,
            linkCourse: canLinkCourse && inPlan && drafts.length === 0,
            createSessions:
              approved &&
              inPlan &&
              line.courseId !== null &&
              planned !== null &&
              drafts.length < planned &&
              draftsLine(scope, departmentIds),
          },
        });
      }
      const inPlan = views.filter((v) => v.status === 'in_plan');
      const done = (v: PlanLineDeliveryView) => v.state === 'drafted' || v.state === 'over_drafted';
      return ok({
        plan: { id: plan.planId, status: record.status, planVersion: plan.planVersion },
        cycle: {
          id: plan.cycleId,
          name: { ar: plan.nameAr, en: plan.nameEn },
          periodStart: plan.periodStart,
          periodEnd: plan.periodEnd,
          currency: plan.currency,
        },
        scope: scope.organization ? 'organization' : 'departments',
        lines: views,
        summary: {
          linesInPlan: inPlan.length,
          leftOut: views.length - inPlan.length,
          linesWithCourse: inPlan.filter((v) => v.course !== null).length,
          linesWithSessions: inPlan.filter(done).length,
          sessionsPlanned: inPlan.reduce((n, v) => n + (v.plannedSessions ?? 0), 0),
          sessionsDrafted: views.reduce((n, v) => n + v.drafts.count, 0),
        },
        counts: {
          needsCourse: inPlan.filter((v) => v.course === null).length,
          needsSessions: inPlan.filter(
            (v) => v.state === 'needs_sessions' || v.state === 'partly_drafted',
          ).length,
          sessionsCreated: inPlan.filter(done).length,
        },
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The course of an approved line (design screen 2)
// ---------------------------------------------------------------------------------------------------

export interface LineCourseSet {
  readonly lineId: string;
  readonly planId: string;
  /** The line's version now. */
  readonly lineVersion: number;
  readonly course: CourseRow;
  readonly origin: 'created' | 'linked';
  readonly previousCourseId: string | null;
}

/** May the line get (another) course now? The approved plan, a line in it, no drafts yet. */
async function courseProblem(
  ctx: Ctx,
  lineId: string,
  lineVersion: number,
): Promise<Result<{ line: plans.LineRecord; plan: repo.PlanSourceRecord }, AppError>> {
  const [line] = await plans.getLines(ctx.tx, [lineId]);
  if (!line) return err(appError('NOT_FOUND'));
  const plan = await repo.getPlanSource(ctx.tx, line.planId);
  if (!plan) return err(appError('NOT_FOUND'));
  if (plan.status !== 'approved')
    return err(appError(DraftSessionErrors.SESSION_PLAN_NOT_APPROVED));
  if (line.status !== 'in_plan') return err(appError(DraftSessionErrors.SESSION_LINE_LEFT_OUT));
  if (line.version !== lineVersion) return err(appError('CONFLICT_VERSION'));
  if ((await repo.listLineSessions(ctx.tx, [line.id])).length > 0) {
    return err(appError(DraftSessionErrors.SESSION_LINE_HAS_DRAFTS));
  }
  return ok({ line, plan });
}

async function setCourse(
  ctx: Ctx,
  line: plans.LineRecord,
  lineVersion: number,
  course: CourseRow,
  origin: 'created' | 'linked',
): Promise<Result<LineCourseSet, AppError>> {
  const written = await repo.setLineCourse(ctx.tx, line.id, lineVersion, course.id, origin);
  if (!written.ok) {
    return err(
      written.refusal === 'refused'
        ? appError(DraftSessionErrors.SESSION_LINE_HAS_DRAFTS)
        : written.refusal === 'not_allowed'
          ? appError('FORBIDDEN')
          : refusalError(written.refusal),
    );
  }
  if (written.value === null) return err(appError('CONFLICT_VERSION'));
  return ok({
    lineId: line.id,
    planId: line.planId,
    lineVersion: written.value,
    course,
    origin,
    previousCourseId: line.courseId,
  });
}

/** What the caller gets back: the course without its costs for a viewer who may not see them. */
export function lineCourseResponse(output: LineCourseSet, costsVisible: boolean): LineCourseSet {
  if (costsVisible) return output;
  return {
    ...output,
    course: {
      ...output.course,
      estCostPerSession: null,
      estCostPerParticipant: null,
      costCurrency: null,
    },
  };
}

/**
 * «Create course» from an approved line (FR-CAT-01 «from plan line», design screen 2): the course popup's values —
 * pre-filled from the line by planDeliveryQuery (`courseDraft`), as L&D edited them — go through the library's own
 * service (createCourse: same checks, the next free code when none is sent), then the line gets it. One transaction:
 * a refused line leaves no course behind.
 */
export function createCourseFromLineActionDefinition(): ActionDefinition<
  typeof CreateCourseFromLineInput,
  LineCourseSet & { readonly costsVisible: boolean },
  UserTx,
  LineCourseSet
> {
  return {
    permission: PLAN_MANAGE,
    input: CreateCourseFromLineInput,
    handler: async ({ ctx, input }) => {
      if (!ctx.can(c['tms.course.manage'], 'tenant')) return err(appError('FORBIDDEN'));
      const ready = await courseProblem(ctx, input.lineId, input.lineVersion);
      if (!ready.ok) return ready;
      const costsVisible = ctx.can(c['tms.course_cost.read'], 'tenant');
      const created = await createCourse(ctx.tx, input.course, { withoutCosts: !costsVisible });
      if (!created.ok) return created;
      const set = await setCourse(
        ctx,
        ready.value.line,
        input.lineVersion,
        created.value.after,
        'created',
      );
      return set.ok ? ok({ ...set.value, costsVisible }) : set;
    },
    afterCommit: ({ result }) => {
      const { costsVisible, ...set } = result;
      return Promise.resolve(ok(lineCourseResponse(set, costsVisible)));
    },
    audit: (_input, output) =>
      audit('tms.training_plan.line_course_created', 'plan_line', output.lineId, {
        planId: output.planId,
        courseId: output.course.id,
        previousCourseId: output.previousCourseId,
        course: courseAuditShape(output.course),
      }),
  };
}

/** «Link course»: an active course of the library for an approved line (design screen 2, the switch). */
export function linkLineCourseActionDefinition(): ActionDefinition<
  typeof LinkLineCourseInput,
  LineCourseSet & { readonly costsVisible: boolean },
  UserTx,
  LineCourseSet
> {
  return {
    permission: PLAN_MANAGE,
    input: LinkLineCourseInput,
    handler: async ({ ctx, input }) => {
      if (!ctx.can(c['tms.course.read'], 'tenant')) return err(appError('FORBIDDEN'));
      const ready = await courseProblem(ctx, input.lineId, input.lineVersion);
      if (!ready.ok) return ready;
      const course = await getCourse(ctx.tx, input.courseId);
      if (!course) return validation([{ path: 'courseId', code: 'NOT_FOUND' }]);
      if (course.status !== 'active') return validation([{ path: 'courseId', code: 'ARCHIVED' }]);
      const set = await setCourse(ctx, ready.value.line, input.lineVersion, course, 'linked');
      return set.ok
        ? ok({ ...set.value, costsVisible: ctx.can(c['tms.course_cost.read'], 'tenant') })
        : set;
    },
    afterCommit: ({ result }) => {
      const { costsVisible, ...set } = result;
      return Promise.resolve(ok(lineCourseResponse(set, costsVisible)));
    },
    audit: (_input, output) =>
      audit('tms.training_plan.line_course_linked', 'plan_line', output.lineId, {
        planId: output.planId,
        courseId: output.course.id,
        previousCourseId: output.previousCourseId,
      }),
  };
}

// ---------------------------------------------------------------------------------------------------
// «Create draft sessions» (design screen 3)
// ---------------------------------------------------------------------------------------------------

export interface LinePersonView {
  readonly personId: string;
  readonly name: PersonName;
  readonly departmentId: string;
  readonly needId: string;
  /** The draft of the line they are planned in, or null. */
  readonly sessionId: string | null;
}

export interface ProposedSessionView {
  readonly month: string;
  readonly branchId: string | null;
  readonly seats: number;
  readonly departments: readonly {
    readonly departmentId: string;
    readonly seats: number;
    readonly named: number;
  }[];
  readonly personIds: readonly string[];
  readonly estimatedCost: string | null;
  readonly outsideQuarter: boolean;
}

export interface DraftProposalView {
  readonly line: {
    readonly id: string;
    readonly title: string;
    readonly status: LineStatus;
    readonly quarter: Quarter;
    readonly quarterMonths: readonly [string, string, string];
    readonly deliveryType: string | null;
    readonly minPerSession: number | null;
    readonly maxPerSession: number | null;
    readonly costPerSession: string | null;
    readonly costPerPerson: string | null;
    readonly people: number;
    readonly named: number;
    readonly plannedSessions: number | null;
    readonly sizes: readonly number[];
    /** The plan's cost of the line (sessions × cost per session + people × cost per person). */
    readonly cost: string | null;
    readonly course: CourseBriefView | null;
  };
  readonly plan: { readonly id: string; readonly status: string; readonly planVersion: number };
  readonly cycle: {
    readonly id: string;
    readonly name: LocalName;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly currency: string;
  };
  readonly departments: readonly {
    readonly departmentId: string;
    readonly name: LocalName;
    readonly branchId: string | null;
    readonly seats: number;
    readonly named: number;
  }[];
  /** Active branches of the organization (the Branch picker). */
  readonly branches: readonly { readonly id: string; readonly name: LocalName }[];
  /** Every person named for the line (the people the popup moves between sessions). */
  readonly people: readonly LinePersonView[];
  readonly existing: { readonly count: number; readonly months: readonly string[] };
  /** Sessions still to draft: the plan's count less the drafts. */
  readonly remaining: number;
  readonly proposal: {
    readonly sessions: readonly ProposedSessionView[];
    /** People in more branches than the sessions keep apart: L&D checks each session's branch. */
    readonly branchToCheck: boolean;
    /** Seats by branch (design: «two branches (Riyadh 32, Jeddah 15)»). */
    readonly branchSeats: readonly { readonly branchId: string | null; readonly seats: number }[];
  };
  /** The proposal's totals against the plan (design: «All 47 people have a place», «matches the approved plan»). */
  readonly check: {
    readonly seats: number;
    readonly people: number;
    readonly allPlaced: boolean;
    readonly cost: string | null;
    readonly matchesPlan: boolean;
  };
  /** Why no draft can be made now (null: «Create» is offered). */
  readonly problem: AppError['code'] | null;
  readonly canCreate: boolean;
}

/**
 * The «Create draft sessions» popup (design screen 3): the line, its people and the editable proposal — the plan's
 * session count and sizes, months over the quarter (Q1 = A), branches (Q2 = A) and the named people split by
 * department. Pure read: nothing is written. When drafts exist, the proposal is what is left to draft.
 */
export function draftProposalQueryDefinition(): QueryDefinition<
  typeof PlanLineRef,
  DraftProposalView,
  UserTx
> {
  return {
    permission: SESSION_MANAGE,
    input: PlanLineRef,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const context = await lineContext(ctx, input.lineId);
      if (!context) return err(appError('NOT_FOUND'));
      const { line, plan, structure, figures, sessions, participants, named } = context;
      const branchOf = new Map(structure.departments.map((d) => [d.id, d.branchId]));
      const nameOf = new Map(structure.departments.map((d) => [d.id, structureName(d)]));
      const departments: ProposalDepartment[] = context.departments.map((d) => ({
        departmentId: d.departmentId,
        branchId: branchOf.get(d.departmentId) ?? null,
        seats: d.seats,
        people: uniquePeople(named.filter((n) => n.departmentId === d.departmentId)),
      }));
      const planned = figures.plan?.sessions ?? 0;
      const full = proposeSessions({
        count: planned,
        maxPerSession: line.maxPerSession ?? 1,
        deliveryType: line.deliveryType,
        quarterMonths: context.quarterMonths,
        departments,
      });
      const placed = new Set(participants.map((p) => p.personId));
      const left =
        sessions.length === 0
          ? [...full.sessions]
          : remainingProposal(
              full,
              sessions.map((s) => ({ month: draftMonth(s) ?? '', branchId: s.branchId })),
              placed,
            );
      const proposed: ProposedSessionView[] = left.map((s) => ({
        month: s.month,
        branchId: s.branchId,
        seats: s.seats,
        departments: s.departments,
        personIds: s.people.map((p) => p.personId),
        estimatedCost: draftCost(s.seats, line.costPerSession, line.costPerPerson),
        outsideQuarter: outsideQuarter(s.month, plan.periodStart, line.quarter),
      }));
      const seats =
        proposed.reduce((n, s) => n + s.seats, 0) + sessions.reduce((n, s) => n + s.seats, 0);
      const cost = sumAmounts([
        ...proposed.map((s) => s.estimatedCost),
        ...sessions.map((s) => s.estimatedCost),
      ]);
      const names = await namesOf(
        ctx.tx,
        named.map((n) => n.personId),
      );
      const sessionOf = new Map(participants.map((p) => [p.personId, p.sessionId]));
      const problem = draftProblem(context);
      const course = line.courseId
        ? (await repo.listCourseBriefs(ctx.tx, [line.courseId]))[0]
        : undefined;
      return ok({
        line: {
          id: line.id,
          title: line.title,
          status: line.status,
          quarter: line.quarter,
          quarterMonths: context.quarterMonths,
          deliveryType: line.deliveryType,
          minPerSession: line.minPerSession,
          maxPerSession: line.maxPerSession,
          costPerSession: line.costPerSession,
          costPerPerson: line.costPerPerson,
          people: figures.people,
          named: figures.named,
          plannedSessions: figures.plan?.sessions ?? null,
          sizes: figures.plan?.sizes ?? [],
          cost: figures.cost,
          course: course ? courseView(course) : null,
        },
        plan: { id: plan.planId, status: plan.status, planVersion: plan.planVersion },
        cycle: {
          id: plan.cycleId,
          name: { ar: plan.nameAr, en: plan.nameEn },
          periodStart: plan.periodStart,
          periodEnd: plan.periodEnd,
          currency: plan.currency,
        },
        departments: departments.map((d) => ({
          departmentId: d.departmentId,
          name: nameOf.get(d.departmentId) ?? { ar: null, en: null },
          branchId: d.branchId,
          seats: d.seats,
          named: d.people.length,
        })),
        branches: branchesOf(structure),
        people: uniquePeople(named).map((n) => ({
          personId: n.personId,
          name: names.get(n.personId) ?? { ar: null, en: null },
          departmentId: departmentOfNeed(named, n),
          needId: n.needId,
          sessionId: sessionOf.get(n.personId) ?? null,
        })),
        existing: {
          count: sessions.length,
          months: sessions.flatMap((s) => {
            const m = draftMonth(s);
            return m ? [m] : [];
          }),
        },
        remaining: Math.max(0, planned - sessions.length),
        proposal: {
          sessions: proposed,
          branchToCheck: full.branchToCheck,
          branchSeats: full.branches,
        },
        check: {
          seats,
          people: figures.people,
          allPlaced: seats >= figures.people,
          cost,
          matchesPlan: cost !== null && figures.cost !== null && cost === figures.cost,
        },
        problem: problem?.code ?? null,
        canCreate: problem === null && draftsLine(context.scope, context.departmentIds),
      });
    },
  };
}

function uniquePeople(
  named: readonly repo.NamedPersonRecord[],
): { personId: string; needId: string }[] {
  const seen = new Set<string>();
  const people: { personId: string; needId: string }[] = [];
  for (const n of named) {
    if (seen.has(n.personId)) continue;
    seen.add(n.personId);
    people.push({ personId: n.personId, needId: n.needId });
  }
  return people;
}

function departmentOfNeed(
  named: readonly repo.NamedPersonRecord[],
  person: { readonly personId: string; readonly needId: string },
): string {
  return (
    named.find((n) => n.personId === person.personId && n.needId === person.needId)?.departmentId ??
    ''
  );
}

function sumAmounts(amounts: readonly (string | null)[]): string | null {
  if (amounts.some((a) => a === null)) return null;
  return fromMilli(amounts.reduce((n, a) => n + (amountMilli(a) ?? 0n), 0n));
}

/**
 * The planned participants a call names, checked against the line: each one named for the line's needs, once in
 * the call; `taken`: people already in another draft of the line (refused when creating; moved when editing).
 */
function peopleProblems(
  named: readonly repo.NamedPersonRecord[],
  groups: readonly {
    readonly path: string;
    readonly personIds: readonly string[];
    readonly seats: number;
  }[],
  taken: ReadonlySet<string>,
): { problems: FieldError[]; needOf: Map<string, string> } {
  const needOf = new Map<string, string>();
  for (const n of uniquePeople(named)) needOf.set(n.personId, n.needId);
  const problems: FieldError[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    group.personIds.forEach((raw, index) => {
      const personId = raw.toLowerCase();
      const path = `${group.path}.personIds.${String(index)}`;
      if (!needOf.has(personId)) problems.push({ path, code: 'NOT_NAMED' });
      else if (seen.has(personId)) problems.push({ path, code: 'DUPLICATE' });
      else if (taken.has(personId)) problems.push({ path, code: 'ALREADY_PLANNED' });
      seen.add(personId);
    });
    if (group.personIds.length > group.seats) {
      problems.push({ path: `${group.path}.personIds`, code: 'MORE_THAN_SEATS' });
    }
  }
  return { problems, needOf };
}

function monthProblems(
  plan: repo.PlanSourceRecord,
  months: readonly { readonly path: string; readonly month: string }[],
): FieldError[] {
  return months
    .filter((m) => !monthInPeriod(m.month, plan.periodStart, plan.periodEnd))
    .map((m) => ({ path: m.path, code: 'OUTSIDE_PERIOD' }));
}

function branchProblems(
  structure: OrgStructure,
  branches: readonly { readonly path: string; readonly branchId: string | null }[],
): FieldError[] {
  const active = new Set(structure.branches.filter((b) => b.active).map((b) => b.id));
  return branches
    .filter((b) => b.branchId !== null && !active.has(b.branchId.toLowerCase()))
    .map((b) => ({ path: b.path, code: 'NOT_FOUND' }));
}

export interface DraftsCreated {
  readonly lineId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly courseId: string;
  readonly sessions: readonly {
    readonly id: string;
    readonly month: string;
    readonly branchId: string | null;
    readonly seats: number;
    readonly participants: number;
  }[];
}

/**
 * «Create N draft sessions» (design screen 3): the sessions L&D confirmed — month, branch, seats, planned
 * participants — for a line in the approved plan with its course, at most the sessions still to draft (adding more
 * than the plan works out needs a revised plan). All or none.
 */
export function createDraftSessionsActionDefinition(): ActionDefinition<
  typeof CreateDraftSessionsInput,
  DraftsCreated,
  UserTx
> {
  return {
    permission: SESSION_MANAGE,
    input: CreateDraftSessionsInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const context = await lineContext(ctx, input.lineId);
      if (!context) return err(appError('NOT_FOUND'));
      if (!draftsLine(context.scope, context.departmentIds)) {
        return err(appError(DraftSessionErrors.SESSION_LINE_OUTSIDE_SCOPE));
      }
      const problem = draftProblem(context);
      if (problem) return err(problem);
      const { line, plan, figures, sessions, participants } = context;
      const remaining = (figures.plan?.sessions ?? 0) - sessions.length;
      if (input.sessions.length > remaining) {
        return err(
          appError(DraftSessionErrors.SESSION_LINE_ALL_DRAFTED, {
            params: { planned: figures.plan?.sessions ?? 0, drafted: sessions.length },
          }),
        );
      }
      const people = peopleProblems(
        context.named,
        input.sessions.map((s, i) => ({
          path: `sessions.${String(i)}`,
          personIds: s.personIds,
          seats: s.seats,
        })),
        new Set(participants.map((p) => p.personId)),
      );
      const problems = [
        ...monthProblems(
          plan,
          input.sessions.map((s, i) => ({ path: `sessions.${String(i)}.month`, month: s.month })),
        ),
        ...branchProblems(
          context.structure,
          input.sessions.map((s, i) => ({
            path: `sessions.${String(i)}.branchId`,
            branchId: s.branchId,
          })),
        ),
        ...people.problems,
      ];
      if (problems.length > 0) return validation(problems);
      const courseId = line.courseId ?? '';
      const [course] = await repo.listCourseBriefs(ctx.tx, [courseId]);
      if (!course) return err(appError(DraftSessionErrors.SESSION_LINE_NEEDS_COURSE));
      const inserted = await repo.insertSessions(
        ctx.tx,
        input.sessions.map((s) => ({
          planId: plan.planId,
          cycleId: plan.cycleId,
          lineId: line.id,
          courseId,
          deliveryType: course.deliveryType,
          month: monthStart(s.month),
          branchId: s.branchId,
          seats: s.seats,
          people: s.personIds.map((id) => ({
            personId: id.toLowerCase(),
            needId: people.needOf.get(id.toLowerCase()) ?? '',
          })),
        })),
      );
      if (!inserted.ok) return err(refusalError(inserted.refusal));
      return ok({
        lineId: line.id,
        planId: plan.planId,
        planVersion: plan.planVersion,
        courseId,
        sessions: inserted.value.map((id, i) => {
          const s = input.sessions[i];
          return {
            id,
            month: s?.month ?? '',
            branchId: s?.branchId ?? null,
            seats: s?.seats ?? 0,
            participants: s?.personIds.length ?? 0,
          };
        }),
      });
    },
    audit: (_input, output) =>
      audit('tms.session.drafts_created', 'plan_line', output.lineId, {
        planId: output.planId,
        planVersion: output.planVersion,
        courseId: output.courseId,
        // Planned participants are counted, never listed (personal data minimised).
        sessions: output.sessions,
      }),
  };
}

// ---------------------------------------------------------------------------------------------------
// A draft (design screen 5)
// ---------------------------------------------------------------------------------------------------

export interface DraftSessionDetailView {
  readonly session: {
    readonly id: string;
    readonly version: number;
    readonly status: 'draft';
    /** `YYYY-MM`. */
    readonly month: string | null;
    readonly branchId: string | null;
    readonly seats: number;
    readonly deliveryType: string;
    readonly estimatedCost: string | null;
    readonly currency: string | null;
    /** «session 1 of 3»: its place among the line's drafts and the plan's session count now. */
    readonly ordinal: number;
    readonly planned: number | null;
    readonly drafted: number;
    readonly outsideQuarter: boolean;
    readonly planVersion: number;
  };
  readonly course: CourseBriefView | null;
  readonly line: {
    readonly id: string;
    readonly title: string;
    readonly quarter: Quarter;
    readonly quarterMonths: readonly [string, string, string];
    readonly status: LineStatus;
  };
  readonly plan: {
    readonly id: string;
    readonly cycleId: string;
    readonly cycleName: LocalName;
    readonly status: string;
    readonly planVersion: number;
    readonly periodStart: string;
    readonly periodEnd: string;
  };
  readonly participants: readonly {
    readonly personId: string;
    readonly name: PersonName;
    readonly departmentId: string;
    readonly departmentName: LocalName;
    readonly branchId: string | null;
    readonly needId: string;
  }[];
  /** The line's other named people («Add or move people»): in another draft (`sessionId`) or in none. */
  readonly candidates: readonly LinePersonView[];
  /** Seats a department asked for without naming people (design: «+ 11 more from Finance»). */
  readonly unnamedSeats: readonly { readonly departmentId: string; readonly seats: number }[];
  readonly branches: readonly { readonly id: string; readonly name: LocalName }[];
  readonly canEdit: boolean;
}

/** A draft opened from the calendar (design screen 5). */
export function draftSessionQueryDefinition(): QueryDefinition<
  typeof DraftSessionRef,
  DraftSessionDetailView,
  UserTx
> {
  return {
    permission: SESSION_MANAGE,
    input: DraftSessionRef,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const session = await repo.getSession(ctx.tx, input.sessionId);
      if (!session) return err(appError('NOT_FOUND'));
      const context = await lineContext(ctx, session.lineId);
      if (!context) return err(appError('NOT_FOUND'));
      const { line, plan, structure, figures, sessions, participants, named } = context;
      const byDepartment = new Map(structure.departments.map((d) => [d.id, d]));
      const names = await namesOf(
        ctx.tx,
        named.map((n) => n.personId),
      );
      const own = participants.filter((p) => p.sessionId === session.id);
      const ownIds = new Set(own.map((p) => p.personId));
      const sessionOf = new Map(participants.map((p) => [p.personId, p.sessionId]));
      const [course] = await repo.listCourseBriefs(ctx.tx, [session.courseId]);
      const month = draftMonth(session);
      const namedByDepartment = new Map<string, number>();
      for (const person of uniquePeople(named)) {
        const department = departmentOfNeed(named, person);
        namedByDepartment.set(department, (namedByDepartment.get(department) ?? 0) + 1);
      }
      return ok({
        session: {
          id: session.id,
          version: session.version,
          status: 'draft',
          month,
          branchId: session.branchId,
          seats: session.seats,
          deliveryType: session.deliveryType,
          estimatedCost: session.estimatedCost,
          currency: session.costCurrency,
          ordinal: sessions.findIndex((s) => s.id === session.id) + 1,
          planned: figures.plan?.sessions ?? null,
          drafted: sessions.length,
          outsideQuarter: month !== null && outsideQuarter(month, plan.periodStart, line.quarter),
          planVersion: session.planVersion,
        },
        course: course ? courseView(course) : null,
        line: {
          id: line.id,
          title: line.title,
          quarter: line.quarter,
          quarterMonths: context.quarterMonths,
          status: line.status,
        },
        plan: {
          id: plan.planId,
          cycleId: plan.cycleId,
          cycleName: { ar: plan.nameAr, en: plan.nameEn },
          status: plan.status,
          planVersion: plan.planVersion,
          periodStart: plan.periodStart,
          periodEnd: plan.periodEnd,
        },
        participants: own.map((p) => {
          const unit = byDepartment.get(p.departmentId);
          return {
            personId: p.personId,
            name: names.get(p.personId) ?? { ar: null, en: null },
            departmentId: p.departmentId,
            departmentName: unit ? structureName(unit) : { ar: null, en: null },
            branchId: unit?.branchId ?? null,
            needId: p.needId,
          };
        }),
        candidates: uniquePeople(named)
          .filter((n) => !ownIds.has(n.personId))
          .map((n) => ({
            personId: n.personId,
            name: names.get(n.personId) ?? { ar: null, en: null },
            departmentId: departmentOfNeed(named, n),
            needId: n.needId,
            sessionId: sessionOf.get(n.personId) ?? null,
          })),
        unnamedSeats: context.departments
          .map((d) => ({
            departmentId: d.departmentId,
            seats: Math.max(0, d.seats - (namedByDepartment.get(d.departmentId) ?? 0)),
          }))
          .filter((d) => d.seats > 0),
        branches: branchesOf(structure),
        canEdit: draftsLine(context.scope, context.departmentIds),
      });
    },
  };
}

export interface DraftValues {
  readonly month: string | null;
  readonly branchId: string | null;
  readonly seats: number;
  readonly participants: number;
}

export interface DraftUpdated {
  readonly sessionId: string;
  readonly lineId: string;
  readonly version: number;
  readonly before: DraftValues;
  readonly after: DraftValues;
  /** People added, moved here from another draft of the line, and removed (counts only). */
  readonly people: { readonly added: number; readonly moved: number; readonly removed: number };
}

/**
 * Changes a draft (design screen 5): its month (another month — even outside the quarter, then marked — within the
 * planning period), branch, seats and planned participants (`personIds`: the full list; people from another draft
 * of the line move here). Whatever the plan's state: a revised plan keeps its drafts.
 */
export function updateDraftSessionActionDefinition(): ActionDefinition<
  typeof UpdateDraftSessionInput,
  DraftUpdated,
  UserTx
> {
  return {
    permission: SESSION_MANAGE,
    input: UpdateDraftSessionInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const session = await repo.getSession(ctx.tx, input.sessionId);
      if (!session) return err(appError('NOT_FOUND'));
      const context = await lineContext(ctx, session.lineId);
      if (!context) return err(appError('NOT_FOUND'));
      if (!draftsLine(context.scope, context.departmentIds)) {
        return err(appError(DraftSessionErrors.SESSION_LINE_OUTSIDE_SCOPE));
      }
      if (session.version !== input.version) return err(appError('CONFLICT_VERSION'));
      const own = context.participants.filter((p) => p.sessionId === session.id);
      const seats = input.seats ?? session.seats;
      const people =
        input.personIds === undefined
          ? null
          : peopleProblems(
              context.named,
              [{ path: '', personIds: input.personIds, seats }],
              new Set<string>(),
            );
      const problems = [
        ...(input.month === undefined
          ? []
          : monthProblems(context.plan, [{ path: 'month', month: input.month }])),
        ...(input.branchId === undefined
          ? []
          : branchProblems(context.structure, [{ path: 'branchId', branchId: input.branchId }])),
        ...(people?.problems.map((p) => ({ ...p, path: p.path.replace(/^\./, '') })) ?? []),
      ];
      if (input.personIds === undefined && own.length > seats) {
        problems.push({ path: 'seats', code: 'FEWER_THAN_PEOPLE' });
      }
      if (problems.length > 0) return validation(problems);
      const list =
        input.personIds?.map((id) => ({
          personId: id.toLowerCase(),
          needId: people?.needOf.get(id.toLowerCase()) ?? '',
        })) ?? null;
      const written = await repo.updateSession(
        ctx.tx,
        { id: session.id, lineId: session.lineId, version: input.version },
        {
          ...(input.month === undefined ? {} : { month: monthStart(input.month) }),
          ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
          ...(input.seats === undefined ? {} : { seats: input.seats }),
        },
        list,
      );
      if (!written.ok) return err(refusalError(written.refusal));
      if (written.value === null) return err(appError('CONFLICT_VERSION'));
      const ownIds = new Set(own.map((p) => p.personId));
      const listed = new Set(list?.map((p) => p.personId) ?? ownIds);
      const elsewhere = new Set(
        context.participants.filter((p) => p.sessionId !== session.id).map((p) => p.personId),
      );
      const arriving = [...listed].filter((id) => !ownIds.has(id));
      return ok({
        sessionId: session.id,
        lineId: session.lineId,
        version: written.value,
        before: {
          month: draftMonth(session),
          branchId: session.branchId,
          seats: session.seats,
          participants: own.length,
        },
        after: {
          month: input.month ?? draftMonth(session),
          branchId: input.branchId === undefined ? session.branchId : input.branchId,
          seats,
          participants: listed.size,
        },
        people: {
          added: arriving.filter((id) => !elsewhere.has(id)).length,
          moved: arriving.filter((id) => elsewhere.has(id)).length,
          removed: [...ownIds].filter((id) => !listed.has(id)).length,
        },
      });
    },
    audit: (_input, output) =>
      audit('tms.session.draft_updated', 'session', output.sessionId, {
        lineId: output.lineId,
        before: output.before,
        after: output.after,
        people: output.people,
      }),
  };
}

export interface DraftDeleted {
  readonly sessionId: string;
  readonly lineId: string;
  readonly planId: string;
  readonly values: DraftValues;
}

/** «Delete draft» (design screen 5): free — a draft promises nothing — and audited. */
export function deleteDraftSessionActionDefinition(): ActionDefinition<
  typeof DeleteDraftSessionInput,
  DraftDeleted,
  UserTx
> {
  return {
    permission: SESSION_MANAGE,
    input: DeleteDraftSessionInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const session = await repo.getSession(ctx.tx, input.sessionId);
      if (!session) return err(appError('NOT_FOUND'));
      const context = await lineContext(ctx, session.lineId);
      if (!context) return err(appError('NOT_FOUND'));
      if (!draftsLine(context.scope, context.departmentIds)) {
        return err(appError(DraftSessionErrors.SESSION_LINE_OUTSIDE_SCOPE));
      }
      const deleted = await repo.deleteSession(ctx.tx, session.id, input.version);
      if (!deleted.ok) return err(refusalError(deleted.refusal));
      if (deleted.value === null) return err(appError('CONFLICT_VERSION'));
      return ok({
        sessionId: session.id,
        lineId: session.lineId,
        planId: session.planId,
        values: {
          month: draftMonth(session),
          branchId: session.branchId,
          seats: session.seats,
          participants: session.participants,
        },
      });
    },
    audit: (_input, output) =>
      audit('tms.session.draft_deleted', 'session', output.sessionId, {
        lineId: output.lineId,
        planId: output.planId,
        values: output.values,
      }),
  };
}

// ---------------------------------------------------------------------------------------------------
// The training calendar (design screens 4, 4p)
// ---------------------------------------------------------------------------------------------------

export interface CalendarDraftView {
  readonly id: string;
  readonly version: number;
  readonly status: 'draft';
  readonly month: string;
  readonly course: CourseBriefView | null;
  readonly lineId: string;
  readonly lineTitle: string;
  readonly planId: string;
  readonly seats: number;
  readonly participants: number;
  readonly branchId: string | null;
  readonly deliveryType: string;
  readonly estimatedCost: string | null;
  readonly currency: string | null;
  /** «1 of 3»: its place among the line's drafts and the plan's session count now. */
  readonly ordinal: number;
  readonly planned: number | null;
  readonly outsideQuarter: boolean;
  readonly canEdit: boolean;
}

export interface CalendarNotDraftedView {
  readonly lineId: string;
  readonly planId: string;
  readonly cycleId: string;
  readonly title: string;
  readonly state: LineSessionState;
  readonly course: CourseBriefView | null;
  /** Sessions still to draft (the plan's count less the drafts). */
  readonly missing: number;
}

export interface CalendarMonthView {
  readonly month: string;
  readonly sessions: number;
  readonly seats: number;
  readonly drafts: readonly CalendarDraftView[];
}

export interface TrainingCalendarView {
  readonly year: number;
  /** The plans the year's lines and drafts come from («From Training plan 2027 · Approved · v1»). */
  readonly plans: readonly {
    readonly planId: string;
    readonly cycleId: string;
    readonly name: LocalName;
    readonly status: string;
    readonly planVersion: number;
    readonly periodStart: string;
    readonly periodEnd: string;
  }[];
  /** The summary cards (of the drafts and lines the filters keep). */
  readonly summary: {
    readonly drafts: number;
    /** Sessions the approved plans work out for the lines of this year. */
    readonly planned: number;
    readonly seats: number;
    readonly estimatedCost: readonly { readonly currency: string; readonly amount: string }[];
    readonly linesInPlan: number;
    readonly linesWithSessions: number;
  };
  /** Calendar quarters (Jan–Mar …), three months each; with a quarter filter, that quarter only. */
  readonly quarters: readonly {
    readonly quarter: number;
    readonly months: readonly CalendarMonthView[];
    /** «Not drafted yet in Qn»: lines of approved plans planned in the quarter that still need a course or drafts. */
    readonly notDrafted: readonly CalendarNotDraftedView[];
  }[];
  readonly filters: {
    readonly branches: readonly { readonly id: string; readonly name: LocalName }[];
    readonly courses: readonly CourseBriefView[];
  };
}

/**
 * The training calendar of a year (design screens 4 and 4p): the drafts month by month in calendar quarters, the
 * lines still to draft under each quarter, the summary cards, the filters (quarter, branch — `none`: no branch —,
 * course). For holders of tms.session.manage, in their scope; nobody else sees a draft.
 */
export function trainingCalendarQueryDefinition(): QueryDefinition<
  typeof TrainingCalendarInput,
  TrainingCalendarView,
  UserTx
> {
  return {
    permission: SESSION_MANAGE,
    input: TrainingCalendarInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const from = `${String(input.year)}-01-01`;
      const to = `${String(input.year + 1)}-01-01`;
      const structure = await listOrgStructure(ctx.tx);
      const scope = sessionScope(ctx, structure);
      const sources = await repo.listPlansOverlapping(ctx.tx, from, `${String(input.year)}-12-31`);
      const yearSessions = await repo.listSessionsBetween(ctx.tx, from, to);
      // Plans of drafts planned in this year but made from a plan of another period (moved out of it).
      const sourceIds = new Set(sources.map((s) => s.planId));
      for (const planId of new Set(yearSessions.map((s) => s.planId))) {
        if (sourceIds.has(planId)) continue;
        const extra = await repo.getPlanSource(ctx.tx, planId);
        if (extra) {
          sources.push(extra);
          sourceIds.add(planId);
        }
      }
      const planIds = sources.map((s) => s.planId);
      const lines = await plans.listLinesOfPlans(ctx.tx, planIds);
      const links = await plans.listLinksOfPlans(ctx.tx, planIds);
      const lineIds = lines.map((l) => l.id);
      const allDrafts = await repo.listLineSessions(ctx.tx, lineIds);
      const sourceOf = new Map(sources.map((s) => [s.planId, s]));

      interface LineInfo {
        readonly line: plans.LineRecord;
        readonly source: repo.PlanSourceRecord;
        readonly departmentIds: readonly string[];
        readonly planned: number | null;
        readonly drafts: readonly repo.SessionRecord[];
      }
      const info = new Map<string, LineInfo>();
      for (const line of lines) {
        const source = sourceOf.get(line.planId);
        if (!source) continue;
        const own = links.filter((l) => l.lineId === line.id);
        const departmentIds = [...new Set(own.map((l) => l.departmentId))];
        if (!seesLine(scope, departmentIds)) continue;
        const figures = lineFigures({
          minPerSession: line.minPerSession,
          maxPerSession: line.maxPerSession,
          costPerSession: line.costPerSession,
          costPerPerson: line.costPerPerson,
          departments: departmentIds.map((departmentId) => ({
            departmentId,
            seats: own
              .filter((l) => l.departmentId === departmentId)
              .reduce((n, l) => n + l.seats, 0),
            named: 0,
          })),
        });
        info.set(line.id, {
          line,
          source,
          departmentIds,
          planned: figures.plan?.sessions ?? null,
          drafts: inLineOrder(allDrafts.filter((s) => s.lineId === line.id)),
        });
      }
      const courseIds = [
        ...yearSessions.map((s) => s.courseId),
        ...lines.flatMap((l) => (l.courseId ? [l.courseId] : [])),
      ];
      const courses = new Map(
        (await repo.listCourseBriefs(ctx.tx, courseIds)).map((course) => [course.id, course]),
      );
      const courseOf = (id: string | null) => {
        const course = id ? courses.get(id) : undefined;
        return course ? courseView(course) : null;
      };

      const keepBranch = (branchId: string | null) =>
        input.branchId === undefined ||
        (input.branchId === 'none' ? branchId === null : branchId === input.branchId.toLowerCase());
      const keepCourse = (courseId: string | null) =>
        input.courseId === undefined || courseId === input.courseId.toLowerCase();

      const drafts: CalendarDraftView[] = [];
      for (const s of yearSessions) {
        const line = info.get(s.lineId);
        const month = draftMonth(s);
        if (!line || !month || !keepBranch(s.branchId) || !keepCourse(s.courseId)) continue;
        drafts.push({
          id: s.id,
          version: s.version,
          status: 'draft',
          month,
          course: courseOf(s.courseId),
          lineId: s.lineId,
          lineTitle: line.line.title,
          planId: s.planId,
          seats: s.seats,
          participants: s.participants,
          branchId: s.branchId,
          deliveryType: s.deliveryType,
          estimatedCost: s.estimatedCost,
          currency: s.costCurrency,
          ordinal: line.drafts.findIndex((d) => d.id === s.id) + 1,
          planned: line.planned,
          outsideQuarter: outsideQuarter(month, line.source.periodStart, line.line.quarter),
          canEdit: draftsLine(scope, line.departmentIds),
        });
      }

      // Lines of approved plans planned in this year (the first month of their quarter).
      const yearLines = [...info.values()].filter(
        (l) =>
          l.source.status === 'approved' &&
          l.line.status === 'in_plan' &&
          quarterMonths(l.source.periodStart, l.line.quarter)[0].startsWith(String(input.year)) &&
          keepCourse(l.line.courseId),
      );
      const stateOf = (l: LineInfo) =>
        lineSessionState({
          status: l.line.status,
          hasCourse: l.line.courseId !== null,
          planned: l.planned,
          drafted: l.drafts.length,
        });

      const quarters = [1, 2, 3, 4]
        .filter((q) => input.quarter === undefined || q === input.quarter)
        .map((quarter) => {
          const first = `${String(input.year)}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}`;
          const months = [first, addMonths(first, 1), addMonths(first, 2)].map((month) => {
            const inMonth = drafts
              .filter((d) => d.month === month)
              .sort(
                (a, b) =>
                  (a.course?.code ?? '').localeCompare(b.course?.code ?? '') ||
                  a.ordinal - b.ordinal,
              );
            return {
              month,
              sessions: inMonth.length,
              seats: inMonth.reduce((n, d) => n + d.seats, 0),
              drafts: inMonth,
            };
          });
          const monthKeys = months.map((m) => m.month);
          const notDrafted = yearLines
            .filter((l) =>
              monthKeys.includes(quarterMonths(l.source.periodStart, l.line.quarter)[0]),
            )
            .filter((l) => {
              const state = stateOf(l);
              return (
                state === 'needs_course' || state === 'needs_sessions' || state === 'partly_drafted'
              );
            })
            .map((l) => ({
              lineId: l.line.id,
              planId: l.source.planId,
              cycleId: l.source.cycleId,
              title: l.line.title,
              state: stateOf(l),
              course: courseOf(l.line.courseId),
              missing: Math.max(0, (l.planned ?? 0) - l.drafts.length),
            }));
          return { quarter, months, notDrafted };
        });

      const shown = quarters.flatMap((q) => q.months.flatMap((m) => m.drafts));
      const costs = new Map<string, bigint>();
      for (const d of shown) {
        if (d.estimatedCost === null || d.currency === null) continue;
        costs.set(d.currency, (costs.get(d.currency) ?? 0n) + (amountMilli(d.estimatedCost) ?? 0n));
      }
      const shownLines = yearLines.filter((l) =>
        quarters.some((q) =>
          q.months.some((m) => m.month === quarterMonths(l.source.periodStart, l.line.quarter)[0]),
        ),
      );
      return ok({
        year: input.year,
        plans: sources.map((s) => ({
          planId: s.planId,
          cycleId: s.cycleId,
          name: { ar: s.nameAr, en: s.nameEn },
          status: s.status,
          planVersion: s.planVersion,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
        })),
        summary: {
          drafts: shown.length,
          planned: shownLines.reduce((n, l) => n + (l.planned ?? 0), 0),
          seats: shown.reduce((n, d) => n + d.seats, 0),
          estimatedCost: [...costs.entries()].map(([currency, milli]) => ({
            currency,
            amount: fromMilli(milli),
          })),
          linesInPlan: shownLines.length,
          linesWithSessions: shownLines.filter((l) => {
            const state = stateOf(l);
            return state === 'drafted' || state === 'over_drafted';
          }).length,
        },
        quarters,
        filters: {
          branches: branchesOf(structure),
          courses: [...new Set(courseIds)].flatMap((id) => {
            const course = courseOf(id);
            return course ? [course] : [];
          }),
        },
      });
    },
  };
}
