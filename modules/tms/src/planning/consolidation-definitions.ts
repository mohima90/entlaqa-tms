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
  type StructureLevelLabel,
  type UserTx,
  listOrgStructure,
  listStructureLevelLabels,
} from '@jadarat/platform-db';
import {
  type ActionContext,
  type ActionDefinition,
  type AuditRecord,
  type Grant,
  type QueryDefinition,
  tmsPlanningPermissions,
} from '@jadarat/platform-rbac';
import { getCourse } from '../courses/db';
import { getNeedsForm } from '../db/needs-forms';
import { DEFAULT_FIELDS, systemFieldsOf } from '../needs-forms';
import type { CycleName, LocalizedName } from './definitions';
import {
  type BudgetLine,
  type BudgetState,
  type ConsolidationNeed,
  type ConsolidationReadiness,
  CyclePlanRef,
  type DepartmentBudget,
  type DraftLine,
  LeaveOutLineInput,
  type LineGroup,
  type LineStatus,
  LineVersionRef,
  MergePlanLinesInput,
  MoveNeedOutInput,
  type NeedPriority,
  type PlanDeliveryType,
  type PlanFormFields,
  type PlanGrouping,
  PLAN_GROUPINGS,
  PlanRef,
  type PlanStatus,
  type Quarter,
  type SessionPlan,
  SetBudgetReasonInput,
  SetLinesQuarterInput,
  UpdatePlanLineInput,
  attachNeeds,
  budgetCheck,
  budgetState,
  buildLines,
  consolidationReadiness,
  currencyFractionDigits,
  fromMilli,
  groupKeyOf,
  groupLines,
  lineFigures,
  lookAlikePairs,
  needAnswers,
  planFormFields,
  toMilli,
  topicKey,
} from './consolidation-model';
import * as plans from './consolidation-repository';
import { amountText, effectiveCycleStatus, structureName } from './model';
import * as repo from './repository';

/**
 * The training plan: consolidation and the budget check (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06, FR-IAM-08 R1
 * note; business flow EP-PLN §3 D10–14; proposal docs/product/proposals/wp-ld-02-03-consolidation-approval.md,
 * Q1–Q5 = A; approved screens docs/design/screens/m3-consolidation-approval/README.md). Bound to defineAction in
 * `actions/consolidation.ts` and to defineQuery in the app; unit-tested with a fake runtime. The database repeats
 * every rule (migrations 20261115100200–100400).
 *
 *   read    tms.training_plan.read / .manage — organization-wide (L&D Manager, Training Coordinator), or a custom
 *           role limited to «A department»: the lines holding a need of its units, its units' budget
 *   write   tms.training_plan.manage — organization-wide (L&D Manager), or department-limited: a line only when
 *           every need in it is of its units, the budget reason of its units only
 *   open    tms.plan_cycle.manage AND tms.training_plan.manage organization-wide: «Close needs now» / building the
 *           plan is about the cycle, which stays the organization-wide L&D Manager's (as submitting the plan,
 *           WP-LD-03)
 * Every change is audited (BR-PLN-j). Reasons are free text for the approvers and heads: the audit records that
 * they changed (and their length), not their words.
 */

const p = tmsPlanningPermissions;
const PLAN_READ = p['tms.training_plan.read'];
const PLAN_MANAGE = p['tms.training_plan.manage'];
const CYCLE_MANAGE = p['tms.plan_cycle.manage'];

/** Module error codes (ADR 0011 §3); messages under `errors.*` in the catalogs. */
export const TrainingPlanErrors = defineErrorCodes({
  /** The needs are still open: after the deadline, or once every department has submitted (Q1 = A). */
  TRAINING_PLAN_NOT_READY: { status: 422, messageKey: 'errors.trainingPlanNotReady' },
  /** The plan of this cycle is already built. */
  TRAINING_PLAN_ALREADY_OPEN: { status: 409, messageKey: 'errors.trainingPlanAlreadyOpen' },
  /** The plan waits for approval or is approved: frozen / locked (JK008). */
  TRAINING_PLAN_FROZEN: { status: 409, messageKey: 'errors.trainingPlanFrozen' },
  /** A department-limited planner and a line with needs of other departments. */
  TRAINING_PLAN_LINE_OUTSIDE_SCOPE: {
    status: 403,
    messageKey: 'errors.trainingPlanLineOutsideScope',
  },
  /** Needs of a department returned for changes enter the plan once it resubmits (JK009). */
  TRAINING_PLAN_NEEDS_NOT_SUBMITTED: {
    status: 409,
    messageKey: 'errors.trainingPlanNeedsNotSubmitted',
  },
});

type Ctx = ActionContext<UserTx>;

/** The categories of the default needs form: how consolidation recognises the form's «Category» field. */
const CATEGORY_VALUES: readonly string[] =
  DEFAULT_FIELDS.find((f) => f.label.en === 'Category')?.options.map((o) => o.value) ?? [];

// ---------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------

export interface PlanDepartmentView {
  readonly id: string;
  readonly name: LocalizedName;
  readonly levelOrdinal: number | null;
  readonly branchId: string | null;
  /** The unit's own head, or the nearest above (as the needs page shows it). */
  readonly head: { readonly ar: string | null; readonly en: string | null } | null;
  /** The department's form status (`submitted` needs are in the plan). */
  readonly formStatus: 'not_started' | 'draft' | 'submitted' | 'returned';
  /** Its own deadline (a return or reopening during consolidation), or null. */
  readonly ownDeadline: string | null;
  /** The department row's version (return / reopen). */
  readonly version: number;
}

export interface PlanLineNeedView {
  readonly needId: string;
  readonly departmentId: string;
  readonly topic: string;
  readonly courseId: string | null;
  /** What the department submitted. */
  readonly seats: number;
  readonly named: number;
  readonly priority: NeedPriority | null;
  readonly quarter: Quarter | null;
}

export interface PlanLineView {
  readonly id: string;
  readonly version: number;
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
  /** L&D changed it by hand (a resubmitted need never joins it silently). */
  readonly edited: boolean;
  readonly people: number;
  readonly named: number;
  /** Null: no session size yet. */
  readonly sessions: SessionPlan | null;
  /** Null: «Needs a cost» (not counted). */
  readonly cost: string | null;
  /** Per department: seats, named people and share of the cost (null without a cost), in seats order. */
  readonly departments: readonly {
    readonly departmentId: string;
    readonly seats: number;
    readonly named: number;
    readonly share: string | null;
  }[];
  /** The needs the viewer may read (a department-limited planner: its units' only). */
  readonly needs: readonly PlanLineNeedView[];
  /** Seats per priority asked (of the needs the viewer reads; `none`: no priority). */
  readonly priorities: Readonly<Record<NeedPriority | 'none', number>>;
  /** The viewer may change it (every need of the line within their scope). */
  readonly canEdit: boolean;
}

export interface PlanBudgetRow extends DepartmentBudget {
  readonly name: LocalizedName;
  readonly reason: string | null;
  /** Over the envelope without a reason: «Needed before you submit». */
  readonly needsReason: boolean;
}

export interface PlanAttention {
  readonly uncostedLineIds: readonly string[];
  readonly belowMinimumLineIds: readonly string[];
  readonly lookAlikes: readonly (readonly [string, string])[];
  readonly overBudgetWithoutReason: readonly string[];
  /** Needs of departments that resubmitted, not in the plan yet or changed since (syncPlanNeedsAction adds them). */
  readonly pending: {
    readonly needs: number;
    readonly changed: number;
    readonly departmentIds: readonly string[];
  };
}

export interface PlanView {
  readonly today: string;
  readonly currency: string;
  /** Digits after the decimal point of the currency (shares are split in its smallest unit). */
  readonly fractionDigits: number;
  readonly cycle: {
    readonly id: string;
    readonly name: CycleName;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly deadline: string;
    readonly latestDeadline: string;
    /** As shown: open, or closed once the needs are closed. */
    readonly status: string;
  };
  /** What the viewer sees: the whole organization, or the departments of their units. */
  readonly scope: 'organization' | 'departments';
  /** Null before the plan is built: `readiness` says when it can be. */
  readonly plan: {
    readonly id: string;
    readonly status: PlanStatus;
    readonly planVersion: number;
    readonly openedAt: string;
    readonly needsClosedEarly: boolean;
  } | null;
  readonly readiness: ConsolidationReadiness | null;
  readonly departments: readonly PlanDepartmentView[];
  readonly lines: readonly PlanLineView[];
  readonly groups: Readonly<Record<PlanGrouping, readonly LineGroup[]>>;
  readonly budget: {
    readonly departments: readonly PlanBudgetRow[];
    readonly total: {
      readonly people: number;
      readonly cost: string;
      readonly envelope: string | null;
      readonly state: BudgetState;
    };
  };
  /** The summary cards: lines in the plan, people, sessions, cost (of costed lines) vs budget. */
  readonly summary: {
    readonly lines: number;
    readonly leftOut: number;
    readonly people: number;
    readonly sessions: number;
    readonly cost: string;
    readonly envelope: string | null;
  };
  readonly attention: PlanAttention;
  readonly branches: readonly { readonly id: string; readonly name: LocalizedName }[];
  /** The needs form's category options (Group by → Topic), with their labels. */
  readonly categories: readonly {
    readonly value: string;
    readonly label: { readonly ar: string; readonly en: string };
  }[];
  readonly levels: readonly StructureLevelLabel[];
  readonly can: {
    /** «Close needs now» / build the plan (the organization-wide L&D Manager, when ready). */
    readonly open: boolean;
    /** Change lines and reasons (within `scope`). */
    readonly manage: boolean;
    /** Add what resubmitted departments changed. */
    readonly addPending: boolean;
  };
}

// ---------------------------------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------------------------------

interface PlanScope {
  readonly organization: boolean;
  /** The units the viewer plans for (with everything under them); empty when organization-wide. */
  readonly units: ReadonlySet<string>;
}

/** The units below each of `ids` (and themselves), through the structure. */
function withDescendants(structure: OrgStructure, ids: readonly string[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const d of structure.departments) {
    if (d.parentId === null) continue;
    children.set(d.parentId, [...(children.get(d.parentId) ?? []), d.id]);
  }
  const result = new Set<string>();
  const stack = [...ids];
  for (let guard = 0; stack.length > 0 && guard < 100_000; guard += 1) {
    const id = stack.pop();
    if (id === undefined || result.has(id)) continue;
    result.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return result;
}

/** The scope the grants give (deny by default: a scope other than the organization or units gives nothing). */
export function planScope(grants: readonly Grant[], structure: OrgStructure): PlanScope {
  if (grants.some((g) => g.scope.type === 'tenant')) {
    return { organization: true, units: new Set() };
  }
  const units = new Set<string>();
  for (const grant of grants) {
    if (grant.scope.type !== 'org_units') continue;
    const ids = grant.scope.includeDescendants
      ? withDescendants(structure, grant.scope.orgUnitIds)
      : grant.scope.orgUnitIds;
    for (const id of ids) units.add(id);
  }
  return { organization: false, units };
}

const inScope = (scope: PlanScope, departmentId: string) =>
  scope.organization || scope.units.has(departmentId);

/** May the scope change a line holding needs of these departments? (All of them in scope; an empty line: yes.) */
const lineInScope = (scope: PlanScope, departmentIds: readonly string[]) =>
  scope.organization || departmentIds.every((d) => scope.units.has(d));

function readScope(ctx: Ctx, structure: OrgStructure): PlanScope {
  return planScope([...ctx.grantsFor(PLAN_READ), ...ctx.grantsFor(PLAN_MANAGE)], structure);
}

function manageScope(ctx: Ctx, structure: OrgStructure): PlanScope {
  return planScope(ctx.grantsFor(PLAN_MANAGE), structure);
}

// ---------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------

const validation = (fieldErrors: readonly FieldError[]) =>
  err(appError('VALIDATION_FAILED', { fieldErrors }));

function refusalError(refusal: plans.PlanRefusal): AppError {
  switch (refusal) {
    case 'frozen':
      return appError(TrainingPlanErrors.TRAINING_PLAN_FROZEN);
    case 'not_submitted':
      return appError(TrainingPlanErrors.TRAINING_PLAN_NEEDS_NOT_SUBMITTED);
    case 'not_allowed':
      return appError(TrainingPlanErrors.TRAINING_PLAN_LINE_OUTSIDE_SCOPE);
    case 'conflict':
      return appError('CONFLICT_VERSION');
    case 'refused':
      return appError('PRECONDITION_FAILED');
  }
}

function lineOutcomeError(outcome: Exclude<plans.LineWriteOutcome['outcome'], 'ok'>): AppError {
  if (outcome === 'not_found') return appError('NOT_FOUND');
  return refusalError(outcome);
}

const editable = (status: PlanStatus) => status === 'draft' || status === 'sent_back';

/** The needs form's fields consolidation reads (quarter, priority, delivery type, category) and its categories. */
async function formFieldsOf(
  tx: UserTx,
  needsFormId: string | null,
): Promise<{
  readonly fields: PlanFormFields;
  readonly categories: PlanView['categories'];
}> {
  const none = {
    fields: { quarter: null, priority: null, deliveryType: null, category: null },
    categories: [],
  };
  if (needsFormId === null) return none;
  const form = await getNeedsForm(tx, needsFormId);
  if (!form) return none;
  const topic = systemFieldsOf(form).topic;
  const section = form.sections.find((s) => s.fields.some((f) => f.id === topic?.id));
  const fields = section?.fields ?? [];
  const map = planFormFields(fields, CATEGORY_VALUES);
  const categoryField = fields.find((f) => f.id === map.category);
  return {
    fields: map,
    categories: (categoryField?.options ?? []).map((o) => ({ value: o.value, label: o.label })),
  };
}

function consolidationNeed(
  need: plans.PlanNeedRecord,
  fields: PlanFormFields,
): ConsolidationNeed & { readonly priority: NeedPriority | null } {
  const answers = needAnswers(need.answers, fields);
  return {
    id: need.id,
    departmentId: need.departmentId,
    topic: need.topic,
    courseId: need.courseId,
    peopleCount: need.peopleCount,
    quarter: answers.quarter,
    deliveryType: answers.deliveryType,
    category: answers.category,
    priority: answers.priority,
  };
}

/** A line's starting values: the course's session sizes and costs when it is a library course (D12). */
async function newLineValues(
  tx: UserTx,
  draft: DraftLine,
  currency: string,
): Promise<plans.NewLine> {
  const course = draft.courseId ? await getCourse(tx, draft.courseId) : null;
  const sameCurrency = course !== null && (course.costCurrency ?? currency) === currency;
  const money = (value: number | null | undefined) =>
    sameCurrency && value !== null && value !== undefined ? amountText(value) : null;
  return {
    groupKey: draft.groupKey,
    title: draft.title.slice(0, 500),
    courseId: draft.courseId,
    deliveryType: draft.deliveryType ?? course?.deliveryType ?? null,
    category: draft.category,
    quarter: draft.quarter,
    minPerSession: course?.minParticipants ?? null,
    maxPerSession: course?.maxParticipants ?? null,
    costPerSession: money(course?.estCostPerSession),
    costPerPerson: money(course?.estCostPerParticipant),
    durationHours: course?.durationHours ?? null,
  };
}

/** Lines and their needs into the plan (the lines first, then every need in one statement). */
async function insertDraftLines(
  tx: UserTx,
  plan: { readonly id: string; readonly cycleId: string },
  drafts: readonly DraftLine[],
  needs: ReadonlyMap<string, { readonly departmentId: string }>,
  currency: string,
): Promise<Result<{ readonly lineIds: readonly string[]; readonly needs: number }, AppError>> {
  const links: { lineId: string; needId: string; departmentId: string }[] = [];
  const lineIds: string[] = [];
  for (const draft of drafts) {
    const lineId = await plans.insertLine(
      tx,
      plan,
      await newLineValues(tx, draft, currency),
      false,
    );
    lineIds.push(lineId);
    for (const needId of draft.needIds) {
      const need = needs.get(needId);
      if (need) links.push({ lineId, needId, departmentId: need.departmentId });
    }
  }
  const inserted = await plans.insertLinks(tx, plan, links);
  if (!inserted.ok) return err(refusalError(inserted.refusal));
  return ok({ lineIds, needs: inserted.value });
}

const audit = (action: string, planId: string, data: Record<string, unknown>): AuditRecord => ({
  action: `tms.training_plan.${action}`,
  entityType: 'training_plan',
  entityId: planId,
  data,
});

// ---------------------------------------------------------------------------------------------------
// The Plan tab
// ---------------------------------------------------------------------------------------------------

const priorityKeys = ['critical', 'high', 'medium', 'low', 'none'] as const;

/** The Plan tab and the budget view of a cycle (design screens 1–3), for the viewer's scope. */
export function planQueryDefinition(): QueryDefinition<typeof CyclePlanRef, PlanView, UserTx> {
  return {
    permission: PLAN_READ,
    input: CyclePlanRef,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const cycle = await repo.getCycle(ctx.tx, input.cycleId);
      if (!cycle || cycle.status === 'draft') return err(appError('NOT_FOUND'));
      const structure = await listOrgStructure(ctx.tx);
      const scope = readScope(ctx, structure);
      const writeScope = manageScope(ctx, structure);
      const shown = cycle.departments.filter((d) => inScope(scope, d.departmentId));
      // Deny by default: a department-limited planner of none of the cycle's departments learns nothing of it.
      if (!scope.organization && shown.length === 0) return err(appError('NOT_FOUND'));
      const today = await repo.organizationToday(ctx.tx);
      const fractionDigits = currencyFractionDigits(cycle.currency);
      const byId = new Map(structure.departments.map((d) => [d.id, d]));
      const form = await formFieldsOf(ctx.tx, cycle.needsFormId);
      const plan = await plans.getPlanByCycle(ctx.tx, cycle.id);

      const departments: PlanDepartmentView[] = shown.map((d) => {
        const unit = byId.get(d.departmentId);
        return {
          id: d.departmentId,
          name: unit ? structureName(unit) : { ar: '—', en: '—' },
          levelOrdinal: unit?.levelOrdinal ?? null,
          branchId: unit?.branchId ?? null,
          head: headOf(structure, d.departmentId),
          formStatus: d.status,
          ownDeadline: d.deadline,
          version: 0,
        };
      });
      const progress = new Map(
        (await repo.listDepartmentProgress(ctx.tx, cycle.id)).map((r) => [
          r.departmentId,
          r.version,
        ]),
      );
      const departmentViews = departments.map((d) => ({ ...d, version: progress.get(d.id) ?? 1 }));

      const reasons = plan ? await plans.listBudgetReasons(ctx.tx, plan.id) : [];
      const lines = plan ? await plans.listLines(ctx.tx, plan.id) : [];
      const links = plan ? await plans.listLinks(ctx.tx, plan.id) : [];
      const needs = await plans.listCycleNeeds(ctx.tx, cycle.id);
      const needById = new Map(needs.map((n) => [n.id, consolidationNeed(n, form.fields)]));
      const needRecord = new Map(needs.map((n) => [n.id, n]));

      const linksByLine = new Map<string, plans.LinkRecord[]>();
      for (const link of links) {
        linksByLine.set(link.lineId, [...(linksByLine.get(link.lineId) ?? []), link]);
      }
      const lineViews: PlanLineView[] = [];
      for (const line of lines) {
        const own = linksByLine.get(line.id) ?? [];
        const departmentIds = [...new Set(own.map((l) => l.departmentId))];
        // Defense in depth (the database filters the same way): a line of the viewer's units, or one they made.
        if (
          !scope.organization &&
          !departmentIds.some((d) => scope.units.has(d)) &&
          !(departmentIds.length === 0 && line.createdBy === ctx.actor.personId)
        ) {
          continue;
        }
        const perDepartment = departmentIds.map((departmentId) => ({
          departmentId,
          seats: own
            .filter((l) => l.departmentId === departmentId)
            .reduce((n, l) => n + l.seats, 0),
          named: own
            .filter((l) => l.departmentId === departmentId)
            .reduce((n, l) => n + l.named, 0),
        }));
        const figures = lineFigures(
          {
            minPerSession: line.minPerSession,
            maxPerSession: line.maxPerSession,
            costPerSession: line.costPerSession,
            costPerPerson: line.costPerPerson,
            departments: perDepartment,
          },
          fractionDigits,
        );
        const visibleNeeds = own.flatMap((l): PlanLineNeedView[] => {
          const n = needById.get(l.needId);
          if (!n || !inScope(scope, l.departmentId)) return [];
          return [
            {
              needId: n.id,
              departmentId: n.departmentId,
              topic: n.topic,
              courseId: n.courseId,
              seats: l.seats,
              named: l.named,
              priority: n.priority,
              quarter: n.quarter,
            },
          ];
        });
        const priorities = Object.fromEntries(priorityKeys.map((k) => [k, 0])) as Record<
          NeedPriority | 'none',
          number
        >;
        for (const n of visibleNeeds) priorities[n.priority ?? 'none'] += n.seats;
        lineViews.push({
          id: line.id,
          version: line.version,
          title: line.title,
          courseId: line.courseId,
          deliveryType: line.deliveryType,
          category: line.category,
          quarter: line.quarter,
          minPerSession: line.minPerSession,
          maxPerSession: line.maxPerSession,
          costPerSession: line.costPerSession,
          costPerPerson: line.costPerPerson,
          durationHours: line.durationHours,
          status: line.status,
          leftOutReason: line.leftOutReason,
          edited: line.editedAt !== null,
          people: figures.people,
          named: figures.named,
          sessions: figures.plan,
          cost: figures.cost,
          departments: [...perDepartment]
            .sort((a, b) => b.seats - a.seats)
            .map((d) => ({ ...d, share: figures.shares.get(d.departmentId) ?? null })),
          needs: visibleNeeds,
          priorities,
          canEdit: plan !== null && editable(plan.status) && lineInScope(writeScope, departmentIds),
        });
      }

      const budgetLines: BudgetLine[] = lineViews.map((l) => ({
        lineId: l.id,
        status: l.status,
        cost: l.cost,
        shares: new Map(
          l.departments.flatMap((d) => (d.share === null ? [] : [[d.departmentId, d.share]])),
        ),
        departments: l.departments,
      }));
      const check = budgetCheck(
        shown.map((d) => ({ departmentId: d.departmentId, envelope: d.budgetAmount })),
        budgetLines,
      );
      const reasonOf = new Map(reasons.map((r) => [r.departmentId, r.reason]));
      const budgetRows: PlanBudgetRow[] = check.departments.map((row) => {
        const unit = byId.get(row.departmentId);
        const reason = reasonOf.get(row.departmentId) ?? null;
        return {
          ...row,
          name: unit ? structureName(unit) : { ar: '—', en: '—' },
          reason,
          needsReason: row.state.kind === 'over' && reason === null,
        };
      });
      // A department-limited viewer's total is its departments' (their shares of shared lines), not the plan's.
      const total = scope.organization ? check.total : scopedTotal(budgetRows);

      const inPlan = lineViews.filter((l) => l.status === 'in_plan');
      const sum = (values: readonly (string | null)[]) =>
        fromMilli(values.reduce((n, v) => n + (toMilli(v) ?? 0n), 0n));
      const summaryCost = scope.organization
        ? sum(inPlan.map((l) => l.cost))
        : sum(budgetRows.map((r) => r.cost));

      // Needs of departments that resubmitted: not in a line yet, or changed since they were added.
      const linked = new Map(links.map((l) => [l.needId, l]));
      const pendingNeeds = needs.filter(
        (n) =>
          plan !== null &&
          n.departmentStatus === 'submitted' &&
          inScope(scope, n.departmentId) &&
          !linked.has(n.id),
      );
      const changedLinks = links.filter((l) => {
        const n = needRecord.get(l.needId);
        return (
          n?.departmentStatus === 'submitted' &&
          inScope(scope, l.departmentId) &&
          (n.peopleCount !== l.seats || n.named !== l.named)
        );
      });
      const pendingDepartments = [
        ...new Set([...pendingNeeds, ...changedLinks].map((x) => x.departmentId)),
      ];

      const branchOf = (departmentId: string) => byId.get(departmentId)?.branchId ?? null;
      const groupable = lineViews.map((l) => ({
        id: l.id,
        status: l.status,
        quarter: l.quarter,
        deliveryType: l.deliveryType,
        category: l.category,
        cost: l.cost,
        sessions: l.sessions?.sessions ?? null,
        shares: new Map(
          l.departments.flatMap((d) =>
            d.share === null ? [] : [[d.departmentId, d.share] as const],
          ),
        ),
        departments: l.departments,
      }));
      const groups = Object.fromEntries(
        PLAN_GROUPINGS.map((by) => [by, groupLines(groupable, by, branchOf)]),
      ) as Record<PlanGrouping, LineGroup[]>;

      const readiness = plan
        ? null
        : consolidationReadiness({
            cycleStatus: cycle.status,
            latestDeadline: cycle.latestDeadline,
            today,
            planExists: false,
            departments: cycle.departments.length,
            submitted: cycle.departments.filter((d) => d.status === 'submitted').length,
          });
      const canManage =
        plan !== null &&
        editable(plan.status) &&
        (writeScope.organization || writeScope.units.size > 0);
      return ok({
        today,
        currency: cycle.currency,
        fractionDigits,
        cycle: {
          id: cycle.id,
          name: { ar: cycle.nameAr, en: cycle.nameEn },
          periodStart: cycle.periodStart,
          periodEnd: cycle.periodEnd,
          deadline: cycle.deadline,
          latestDeadline: cycle.latestDeadline,
          status: effectiveCycleStatus(cycle.status, cycle.latestDeadline, today),
        },
        scope: scope.organization ? 'organization' : 'departments',
        plan: plan
          ? {
              id: plan.id,
              status: plan.status,
              planVersion: plan.planVersion,
              openedAt: plan.openedAt.toISOString(),
              needsClosedEarly: plan.needsClosedEarly,
            }
          : null,
        readiness,
        departments: departmentViews,
        lines: lineViews,
        groups,
        budget: { departments: budgetRows, total },
        summary: {
          lines: inPlan.length,
          leftOut: lineViews.length - inPlan.length,
          people: scope.organization
            ? inPlan.reduce((n, l) => n + l.people, 0)
            : budgetRows.reduce((n, r) => n + r.people, 0),
          sessions: inPlan.reduce((n, l) => n + (l.sessions?.sessions ?? 0), 0),
          cost: summaryCost,
          envelope: total.envelope,
        },
        attention: {
          uncostedLineIds: inPlan.filter((l) => l.cost === null).map((l) => l.id),
          belowMinimumLineIds: inPlan.filter((l) => l.sessions?.belowMinimum).map((l) => l.id),
          lookAlikes: lookAlikePairs(lineViews),
          overBudgetWithoutReason: budgetRows
            .filter((r) => r.needsReason)
            .map((r) => r.departmentId),
          pending: {
            needs: pendingNeeds.length,
            changed: changedLinks.length,
            departmentIds: pendingDepartments,
          },
        },
        branches: structure.branches.map((b) => ({ id: b.id, name: structureName(b) })),
        categories: form.categories,
        levels: await listStructureLevelLabels(ctx.tx),
        can: {
          open:
            readiness?.ready === true &&
            ctx.can(CYCLE_MANAGE, 'tenant') &&
            ctx.can(PLAN_MANAGE, 'tenant'),
          manage: canManage,
          addPending: canManage && pendingNeeds.length + changedLinks.length > 0,
        },
      });
    },
  };
}

function headOf(
  structure: OrgStructure,
  departmentId: string,
): { readonly ar: string | null; readonly en: string | null } | null {
  const byId = new Map(structure.departments.map((d) => [d.id, d]));
  let current = byId.get(departmentId);
  for (let depth = 0; current && depth <= 20; depth += 1) {
    if (current.head) return { ar: current.head.nameAr, en: current.head.nameEn };
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

function scopedTotal(rows: readonly PlanBudgetRow[]): PlanView['budget']['total'] {
  const cost = fromMilli(rows.reduce((n, r) => n + (toMilli(r.cost) ?? 0n), 0n));
  const withEnvelope = rows.filter((r) => r.envelope !== null);
  const envelope =
    withEnvelope.length === 0
      ? null
      : fromMilli(withEnvelope.reduce((n, r) => n + (toMilli(r.envelope) ?? 0n), 0n));
  return {
    people: rows.reduce((n, r) => n + r.people, 0),
    cost,
    envelope,
    state: budgetState(cost, envelope),
  };
}

// ---------------------------------------------------------------------------------------------------
// Opening the plan: «Close needs now» or after the deadline (Q1 = A)
// ---------------------------------------------------------------------------------------------------

export interface PlanOpened {
  readonly cycleId: string;
  readonly planId: string;
  readonly lines: number;
  readonly needs: number;
  /** The needs were closed before the deadline («Close needs now»). */
  readonly closedEarly: boolean;
}

/**
 * Closes the needs (if the cycle is still open) and builds the plan ONCE from the submitted needs (D10–D11): the
 * same course in one line, else the same topic; the quarter most departments asked; a library course's sizes and
 * costs. Before the deadline only once every department in scope has submitted.
 */
export function openConsolidationActionDefinition(): ActionDefinition<
  typeof CyclePlanRef,
  PlanOpened,
  UserTx
> {
  return {
    permission: CYCLE_MANAGE,
    input: CyclePlanRef,
    handler: async ({ ctx, input }) => {
      if (!ctx.can(PLAN_MANAGE, 'tenant')) return err(appError('FORBIDDEN'));
      const cycle = await repo.getCycle(ctx.tx, input.cycleId);
      if (!cycle) return err(appError('NOT_FOUND'));
      const today = await repo.organizationToday(ctx.tx);
      const readiness = consolidationReadiness({
        cycleStatus: cycle.status,
        latestDeadline: cycle.latestDeadline,
        today,
        planExists: (await plans.getPlanByCycle(ctx.tx, cycle.id)) !== null,
        departments: cycle.departments.length,
        submitted: cycle.departments.filter((d) => d.status === 'submitted').length,
      });
      if (!readiness.ready) {
        if (readiness.reason === 'already_open')
          return err(appError(TrainingPlanErrors.TRAINING_PLAN_ALREADY_OPEN));
        return err(
          appError(TrainingPlanErrors.TRAINING_PLAN_NOT_READY, {
            params: { reason: readiness.reason, waiting: readiness.waiting },
          }),
        );
      }
      if (cycle.status === 'open') {
        const closed = await plans.closeNeeds(ctx.tx, cycle.id);
        if (!closed.ok || closed.value === 0) {
          return err(appError(TrainingPlanErrors.TRAINING_PLAN_NOT_READY));
        }
      }
      const opened = await plans.insertPlan(ctx.tx, cycle.id);
      if (!opened.ok) {
        return err(
          opened.refusal === 'conflict'
            ? appError(TrainingPlanErrors.TRAINING_PLAN_ALREADY_OPEN)
            : refusalError(opened.refusal),
        );
      }
      const plan = opened.value;
      const form = await formFieldsOf(ctx.tx, cycle.needsFormId);
      const submitted = (await plans.listCycleNeeds(ctx.tx, cycle.id)).filter(
        (n) => n.departmentStatus === 'submitted',
      );
      const drafts = buildLines(submitted.map((n) => consolidationNeed(n, form.fields)));
      const inserted = await insertDraftLines(
        ctx.tx,
        plan,
        drafts,
        new Map(submitted.map((n) => [n.id, n])),
        cycle.currency,
      );
      if (!inserted.ok) return inserted;
      return ok({
        cycleId: cycle.id,
        planId: plan.id,
        lines: inserted.value.lineIds.length,
        needs: inserted.value.needs,
        closedEarly: plan.needsClosedEarly,
      });
    },
    audit: (_input, output) =>
      audit('opened', output.planId, {
        cycleId: output.cycleId,
        lines: output.lines,
        needs: output.needs,
        closedEarly: output.closedEarly,
      }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Adding what resubmitted departments changed (D14)
// ---------------------------------------------------------------------------------------------------

export interface PlanNeedsSynced {
  readonly planId: string;
  /** Needs put into a line (an existing one or a new one). */
  readonly added: number;
  readonly newLines: number;
  /** Needs whose seats or named people were taken again. */
  readonly refreshed: number;
  /** Lines left without a need and removed. */
  readonly removedLines: number;
}

interface PlanContext {
  readonly plan: plans.PlanRecord;
  readonly cycle: repo.CycleRecord;
  readonly structure: OrgStructure;
  readonly scope: PlanScope;
}

/** The plan as a change sees it: it exists, is visible and open for consolidation; the actor's manage scope. */
async function planForChange(ctx: Ctx, planId: string): Promise<Result<PlanContext, AppError>> {
  const plan = await plans.getPlan(ctx.tx, planId);
  if (!plan) return err(appError('NOT_FOUND'));
  if (!editable(plan.status)) return err(appError(TrainingPlanErrors.TRAINING_PLAN_FROZEN));
  const cycle = await repo.getCycle(ctx.tx, plan.cycleId);
  if (!cycle) return err(appError('NOT_FOUND'));
  const structure = await listOrgStructure(ctx.tx);
  return ok({ plan, cycle, structure, scope: manageScope(ctx, structure) });
}

/**
 * Adds the needs of departments that resubmitted after a return (or a reopening) during consolidation: each joins
 * the line built from the same course or topic when L&D has not changed that line by hand, else a new line; the
 * changed seats of their needs are taken again; lines left without a need are removed. A department-limited
 * planner does this for its units only.
 */
export function syncPlanNeedsActionDefinition(): ActionDefinition<
  typeof PlanRef,
  PlanNeedsSynced,
  UserTx
> {
  return {
    permission: PLAN_MANAGE,
    input: PlanRef,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const context = await planForChange(ctx, input.planId);
      if (!context.ok) return context;
      const { plan, cycle, scope } = context.value;
      const form = await formFieldsOf(ctx.tx, cycle.needsFormId);
      const needs = await plans.listCycleNeeds(ctx.tx, cycle.id);
      const links = await plans.listLinks(ctx.tx, plan.id);
      const lines = await plans.listLines(ctx.tx, plan.id);
      const linked = new Map(links.map((l) => [l.needId, l]));
      const submitted = needs.filter(
        (n) => n.departmentStatus === 'submitted' && inScope(scope, n.departmentId),
      );
      const pending = submitted.filter((n) => !linked.has(n.id));
      const stale = submitted.filter((n) => {
        const link = linked.get(n.id);
        return link !== undefined && (link.seats !== n.peopleCount || link.named !== n.named);
      });

      const departmentsOf = new Map<string, Set<string>>();
      const topicsOf = new Map<string, Set<string>>();
      const needTopic = new Map(needs.map((n) => [n.id, n.topic]));
      for (const link of links) {
        departmentsOf.set(
          link.lineId,
          (departmentsOf.get(link.lineId) ?? new Set()).add(link.departmentId),
        );
        const topic = needTopic.get(link.needId);
        if (topic !== undefined)
          topicsOf.set(link.lineId, (topicsOf.get(link.lineId) ?? new Set()).add(topicKey(topic)));
      }
      const changeable = lines.filter((l) =>
        lineInScope(scope, [...(departmentsOf.get(l.id) ?? [])]),
      );
      const result = attachNeeds(
        changeable.map((l) => ({
          id: l.id,
          groupKey: l.groupKey,
          edited: l.editedAt !== null,
          status: l.status,
          topicKeys: [...(topicsOf.get(l.id) ?? [])],
        })),
        pending.map((n) => consolidationNeed(n, form.fields)),
      );
      const joined = await plans.insertLinks(
        ctx.tx,
        plan,
        result.joins.map((j) => ({
          lineId: j.lineId,
          needId: j.needId,
          departmentId: pending.find((n) => n.id === j.needId)?.departmentId ?? '',
        })),
      );
      if (!joined.ok) return err(refusalError(joined.refusal));
      const created = await insertDraftLines(
        ctx.tx,
        plan,
        result.newLines,
        new Map(pending.map((n) => [n.id, n])),
        cycle.currency,
      );
      if (!created.ok) return created;
      const refreshed = await plans.refreshLinks(
        ctx.tx,
        stale.map((n) => n.id),
      );
      if (!refreshed.ok) return err(refusalError(refreshed.refusal));
      // Lines left without a need (a need removed while its department was returned) go.
      const empty = changeable.filter((l) => !departmentsOf.has(l.id)).map((l) => l.id);
      const removed = await plans.deleteEmptyLines(ctx.tx, empty);
      return ok({
        planId: plan.id,
        added: joined.value + created.value.needs,
        newLines: created.value.lineIds.length,
        refreshed: refreshed.value,
        removedLines: removed.length,
      });
    },
    audit: (_input, output) =>
      output.added + output.refreshed + output.removedLines === 0
        ? null
        : audit('needs_added', output.planId, {
            added: output.added,
            newLines: output.newLines,
            refreshed: output.refreshed,
            removedLines: output.removedLines,
          }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Changing lines
// ---------------------------------------------------------------------------------------------------

interface LineContext extends PlanContext {
  readonly lines: readonly plans.LineRecord[];
  readonly links: readonly plans.LinkRecord[];
}

/**
 * The lines a change touches: they exist (visible), belong to one plan open for consolidation, and every need in
 * each is within the actor's scope (a department-limited planner never changes a line shared with a department
 * it does not plan for — feedback #4). The versions the actor saw must still be current.
 */
async function linesForChange(
  ctx: Ctx,
  refs: readonly { readonly id: string; readonly version: number }[],
): Promise<Result<LineContext, AppError>> {
  const lines = await plans.getLines(
    ctx.tx,
    refs.map((r) => r.id),
  );
  if (lines.length !== new Set(refs.map((r) => r.id.toLowerCase())).size)
    return err(appError('NOT_FOUND'));
  const planIds = new Set(lines.map((l) => l.planId));
  const [planId] = [...planIds];
  if (planIds.size !== 1 || planId === undefined) return err(appError('NOT_FOUND'));
  const context = await planForChange(ctx, planId);
  if (!context.ok) return context;
  const links = await plans.listLinks(ctx.tx, planId);
  for (const line of lines) {
    const departments = [
      ...new Set(links.filter((l) => l.lineId === line.id).map((l) => l.departmentId)),
    ];
    if (!lineInScope(context.value.scope, departments)) {
      return err(appError(TrainingPlanErrors.TRAINING_PLAN_LINE_OUTSIDE_SCOPE));
    }
    const ref = refs.find((r) => r.id.toLowerCase() === line.id.toLowerCase());
    if (ref?.version !== line.version) return err(appError('CONFLICT_VERSION'));
  }
  return ok({ ...context.value, lines, links });
}

export interface LineSaved {
  readonly planId: string;
  readonly lineId: string;
  readonly version: number;
  readonly changed: readonly string[];
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
}

const LINE_KEYS = [
  'title',
  'courseId',
  'deliveryType',
  'category',
  'quarter',
  'minPerSession',
  'maxPerSession',
  'costPerSession',
  'costPerPerson',
  'durationHours',
] as const;

/** A line's popup (design screen 2): sizes, costs, quarter, title, course link, delivery type, category. */
export function updatePlanLineActionDefinition(): ActionDefinition<
  typeof UpdatePlanLineInput,
  LineSaved,
  UserTx
> {
  return {
    permission: PLAN_MANAGE,
    input: UpdatePlanLineInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const context = await linesForChange(ctx, [{ id: input.lineId, version: input.version }]);
      if (!context.ok) return context;
      const [line] = context.value.lines;
      if (!line) return err(appError('NOT_FOUND'));
      const issues: FieldError[] = [];
      const min = input.minPerSession === undefined ? line.minPerSession : input.minPerSession;
      const max = input.maxPerSession === undefined ? line.maxPerSession : input.maxPerSession;
      if (min !== null && max !== null && min > max) {
        issues.push({ path: 'minPerSession', code: 'ABOVE_MAXIMUM' });
      }
      if (input.courseId !== undefined && input.courseId !== null) {
        const course = await getCourse(ctx.tx, input.courseId);
        if (course?.status !== 'active') issues.push({ path: 'courseId', code: 'UNKNOWN' });
      }
      if (issues.length > 0) return validation(issues);
      const patch: plans.LinePatch = Object.fromEntries(
        LINE_KEYS.flatMap((key) => (input[key] === undefined ? [] : [[key, input[key]]])),
      );
      const changed = LINE_KEYS.filter(
        (key) => input[key] !== undefined && input[key] !== line[key],
      );
      if (changed.length === 0) {
        return ok({
          planId: line.planId,
          lineId: line.id,
          version: line.version,
          changed: [],
          before: {},
          after: {},
        });
      }
      const written = await plans.updateLine(ctx.tx, line.id, input.version, patch);
      if (written.outcome !== 'ok') return err(lineOutcomeError(written.outcome));
      const shown = (source: Record<string, unknown>) =>
        Object.fromEntries(changed.map((key) => [key, source[key] ?? null]));
      return ok({
        planId: line.planId,
        lineId: line.id,
        version: written.version,
        changed,
        before: shown(line as unknown as Record<string, unknown>),
        after: shown(input as unknown as Record<string, unknown>),
      });
    },
    audit: (_input, output) =>
      output.changed.length === 0
        ? null
        : audit('line_changed', output.planId, {
            lineId: output.lineId,
            changed: output.changed,
            before: output.before,
            after: output.after,
          }),
  };
}

export interface LinesMerged {
  readonly planId: string;
  readonly lineId: string;
  readonly version: number;
  readonly mergedLineIds: readonly string[];
  readonly needs: number;
}

/** «Merge» (design screen 1b): the needs of the other lines move into the one that stays, which takes the name. */
export function mergePlanLinesActionDefinition(): ActionDefinition<
  typeof MergePlanLinesInput,
  LinesMerged,
  UserTx
> {
  return {
    permission: PLAN_MANAGE,
    input: MergePlanLinesInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const context = await linesForChange(ctx, input.lines);
      if (!context.ok) return context;
      const into = context.value.lines.find(
        (l) => l.id.toLowerCase() === input.intoLineId.toLowerCase(),
      );
      if (!into) return err(appError('NOT_FOUND'));
      const others = context.value.lines.filter((l) => l.id !== into.id);
      const moving = context.value.links
        .filter((l) => others.some((o) => o.id === l.lineId))
        .map((l) => l.needId);
      const moved = await plans.moveLinks(ctx.tx, moving, into.id);
      if (!moved.ok) return err(refusalError(moved.refusal));
      const written = await plans.updateLine(ctx.tx, into.id, into.version, { title: input.title });
      if (written.outcome !== 'ok') return err(lineOutcomeError(written.outcome));
      const removed = await plans.deleteEmptyLines(
        ctx.tx,
        others.map((o) => o.id),
      );
      if (removed.length !== others.length) return err(appError('CONFLICT_VERSION'));
      return ok({
        planId: into.planId,
        lineId: into.id,
        version: written.version,
        mergedLineIds: others.map((o) => o.id),
        needs: context.value.links.filter((l) => l.lineId === into.id).length + moving.length,
      });
    },
    audit: (input, output) =>
      audit('lines_merged', output.planId, {
        lineId: output.lineId,
        mergedLineIds: output.mergedLineIds,
        title: input.title,
        needs: output.needs,
      }),
  };
}

export interface NeedMovedOut {
  readonly planId: string;
  readonly fromLineId: string;
  readonly fromVersion: number;
  readonly newLineId: string;
  readonly needId: string;
}

/**
 * «Move out of this line» (design screen 2): the need gets a line of its own — named after the need unless a
 * title is given, built from its course or topic, in the quarter it asked for (else the line's), with the line's
 * session sizes and costs (the same training) — a line L&D made (an edit). The only need of a line stays.
 */
export function moveNeedOutActionDefinition(): ActionDefinition<
  typeof MoveNeedOutInput,
  NeedMovedOut,
  UserTx
> {
  return {
    permission: PLAN_MANAGE,
    input: MoveNeedOutInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const context = await linesForChange(ctx, [{ id: input.lineId, version: input.version }]);
      if (!context.ok) return context;
      const [line] = context.value.lines;
      if (!line) return err(appError('NOT_FOUND'));
      const own = context.value.links.filter((l) => l.lineId === line.id);
      const link = own.find((l) => l.needId.toLowerCase() === input.needId.toLowerCase());
      if (!link) return err(appError('NOT_FOUND'));
      if (own.length < 2) return validation([{ path: 'needId', code: 'ONLY_NEED' }]);
      const form = await formFieldsOf(ctx.tx, context.value.cycle.needsFormId);
      const record = (await plans.listCycleNeeds(ctx.tx, context.value.cycle.id)).find(
        (n) => n.id === link.needId,
      );
      if (!record) return err(appError('NOT_FOUND'));
      const need = consolidationNeed(record, form.fields);
      const touched = await plans.updateLine(ctx.tx, line.id, input.version, {});
      if (touched.outcome !== 'ok') return err(lineOutcomeError(touched.outcome));
      const newLineId = await plans.insertLine(
        ctx.tx,
        context.value.plan,
        {
          groupKey: groupKeyOf(need),
          title: input.title ?? need.topic.slice(0, 500),
          courseId: need.courseId,
          deliveryType: need.deliveryType ?? line.deliveryType,
          category: need.category ?? line.category,
          quarter: need.quarter ?? line.quarter,
          minPerSession: line.minPerSession,
          maxPerSession: line.maxPerSession,
          costPerSession: line.costPerSession,
          costPerPerson: line.costPerPerson,
          durationHours: line.durationHours,
        },
        true,
      );
      const moved = await plans.moveLinks(ctx.tx, [link.needId], newLineId);
      if (!moved.ok) return err(refusalError(moved.refusal));
      return ok({
        planId: line.planId,
        fromLineId: line.id,
        fromVersion: touched.version,
        newLineId,
        needId: link.needId,
      });
    },
    audit: (_input, output) =>
      audit('need_moved_out', output.planId, {
        fromLineId: output.fromLineId,
        newLineId: output.newLineId,
        needId: output.needId,
      }),
  };
}

export interface LinesQuarterSet {
  readonly planId: string;
  readonly quarter: Quarter;
  readonly lines: readonly {
    readonly lineId: string;
    readonly version: number;
    readonly before: Quarter;
  }[];
}

/** «Change quarter» for the ticked lines (bulk bar): all of them or none. */
export function setPlanLinesQuarterActionDefinition(): ActionDefinition<
  typeof SetLinesQuarterInput,
  LinesQuarterSet,
  UserTx
> {
  return {
    permission: PLAN_MANAGE,
    input: SetLinesQuarterInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const context = await linesForChange(ctx, input.lines);
      if (!context.ok) return context;
      const done: { lineId: string; version: number; before: Quarter }[] = [];
      for (const line of context.value.lines) {
        if (line.quarter === input.quarter) {
          done.push({ lineId: line.id, version: line.version, before: line.quarter });
          continue;
        }
        const written = await plans.updateLine(ctx.tx, line.id, line.version, {
          quarter: input.quarter,
        });
        if (written.outcome !== 'ok') return err(lineOutcomeError(written.outcome));
        done.push({ lineId: line.id, version: written.version, before: line.quarter });
      }
      const [first] = context.value.lines;
      return ok({ planId: first?.planId ?? '', quarter: input.quarter, lines: done });
    },
    audit: (_input, output) =>
      audit('lines_quarter_changed', output.planId, {
        quarter: output.quarter,
        lines: output.lines
          .filter((l) => l.before !== output.quarter)
          .map((l) => ({ lineId: l.lineId, before: l.before })),
      }),
  };
}

export interface LineStatusChanged {
  readonly planId: string;
  readonly lineId: string;
  readonly version: number;
  readonly status: LineStatus;
  readonly reasonLength: number | null;
}

/** «Leave out of the plan» (design screen 2b): a reason is required; the head reads it once the plan is approved. */
export function leaveOutPlanLineActionDefinition(): ActionDefinition<
  typeof LeaveOutLineInput,
  LineStatusChanged,
  UserTx
> {
  return {
    permission: PLAN_MANAGE,
    input: LeaveOutLineInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const context = await linesForChange(ctx, [{ id: input.lineId, version: input.version }]);
      if (!context.ok) return context;
      const written = await plans.updateLine(ctx.tx, input.lineId, input.version, {
        status: 'left_out',
        leftOutReason: input.reason,
      });
      if (written.outcome !== 'ok') return err(lineOutcomeError(written.outcome));
      return ok({
        planId: context.value.plan.id,
        lineId: input.lineId,
        version: written.version,
        status: 'left_out',
        reasonLength: input.reason.length,
      });
    },
    audit: (_input, output) =>
      audit('line_left_out', output.planId, {
        lineId: output.lineId,
        reasonLength: output.reasonLength,
      }),
  };
}

/** «Bring back» a left-out line (until the plan is submitted). */
export function bringBackPlanLineActionDefinition(): ActionDefinition<
  typeof LineVersionRef,
  LineStatusChanged,
  UserTx
> {
  return {
    permission: PLAN_MANAGE,
    input: LineVersionRef,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const context = await linesForChange(ctx, [{ id: input.lineId, version: input.version }]);
      if (!context.ok) return context;
      const written = await plans.updateLine(ctx.tx, input.lineId, input.version, {
        status: 'in_plan',
        leftOutReason: null,
      });
      if (written.outcome !== 'ok') return err(lineOutcomeError(written.outcome));
      return ok({
        planId: context.value.plan.id,
        lineId: input.lineId,
        version: written.version,
        status: 'in_plan',
        reasonLength: null,
      });
    },
    audit: (_input, output) => audit('line_brought_back', output.planId, { lineId: output.lineId }),
  };
}

export interface BudgetReasonSaved {
  readonly planId: string;
  readonly departmentId: string;
  readonly before: { readonly given: boolean; readonly length: number | null };
  readonly after: { readonly given: boolean; readonly length: number | null };
}

/** A department's over-budget reason (design screen 3; BR-PLN-f): one line; '' removes it. */
export function setBudgetReasonActionDefinition(): ActionDefinition<
  typeof SetBudgetReasonInput,
  BudgetReasonSaved,
  UserTx
> {
  return {
    permission: PLAN_MANAGE,
    input: SetBudgetReasonInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const context = await planForChange(ctx, input.planId);
      if (!context.ok) return context;
      const { plan, cycle, scope } = context.value;
      // Its scope first: a department-limited planner learns nothing of another department.
      if (!inScope(scope, input.departmentId)) return err(appError('FORBIDDEN'));
      if (!cycle.departments.some((d) => d.departmentId === input.departmentId)) {
        return validation([{ path: 'departmentId', code: 'NOT_IN_CYCLE' }]);
      }
      const saved = await plans.saveBudgetReason(ctx.tx, plan, input.departmentId, input.reason);
      if (!saved.ok) return err(refusalError(saved.refusal));
      return ok({
        planId: plan.id,
        departmentId: input.departmentId,
        before: { given: saved.value !== null, length: saved.value?.length ?? null },
        after: { given: input.reason !== null, length: input.reason?.length ?? null },
      });
    },
    audit: (_input, output) =>
      !output.before.given && !output.after.given
        ? null
        : audit('budget_reason_changed', output.planId, {
            departmentId: output.departmentId,
            before: output.before,
            after: output.after,
          }),
  };
}
