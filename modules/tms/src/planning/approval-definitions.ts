import { type AppError, appError, defineErrorCodes, err, ok } from '@jadarat/platform-core';
import {
  type OrgStructure,
  type UserTx,
  getMemberOptionsByIds,
  listOrgStructure,
  listRoleHolders,
} from '@jadarat/platform-db';
import {
  type ActionContext,
  type ActionDefinition,
  type AuditRecord,
  type QueryDefinition,
  tmsPlanningPermissions,
  tmsRolePermissions,
} from '@jadarat/platform-rbac';
import {
  ApprovalsInput,
  type ApprovalStep,
  DecidePlanInput,
  type DepartmentResult,
  PlanVersionRef,
  PlanVersionViewInput,
  type StepState,
  type SubmitProblem,
  type VersionLineView,
  decidableStep,
  departmentResult,
  planFigures,
  stepStates,
  versionLineView,
} from './approval-model';
import * as approvals from './approval-repository';
import * as consolidation from './consolidation-repository';
import {
  type BudgetState,
  CyclePlanRef,
  amountMilli,
  budgetState,
  currencyFractionDigits,
  fromMilli,
} from './consolidation-model';
import type { CycleName, LocalizedName, PersonName } from './definitions';
import { DepartmentRef, MyNeedsInput, effectiveHead, structureName } from './model';

/**
 * The training plan's approval (WP-LD-03, T-M3-07; FR-PLN-08, FR-WFL-01/02 R1 part, FR-MGR-05; business flow
 * docs/business-flows/EP-PLN-planning-cycle.md §13 and §3 F; proposal
 * docs/product/proposals/wp-ld-02-03-consolidation-approval.md §2 B steps 8–13 and §3, its questions answered «A»;
 * approved screens docs/design/screens/m3-consolidation-approval/README.md 4–6b). Bound to defineAction in
 * `actions/approval.ts` and to defineQuery in the app; unit-tested with a fake runtime. The database decides the
 * same from the verified claims (migration 20261116100200): the application refuses early with a clear message.
 *
 *   submit   the organization-wide L&D Manager (tms.training_plan.manage organization-wide; one plan per organization)
 *   decide   the step's role: tms.training_plan.approve (every HR Manager) for the HR step, tms.training_plan.confirm
 *            (every holder of the ready-made Finance role) for the Finance step — never the submitter, never the same
 *            person for both steps; the first decision settles the step
 *   revise   the organization-wide L&D Manager, once approved: version N + 1 as a draft, version N kept
 *   read     tms.training_plan.read (organization-wide: the review, the versions, the Approvals page); a department's
 *            result: its effective head (tms.plan_needs.submit), once the plan is approved (Q4 = A)
 * Every step is audited; a send-back comment is free text for the L&D Manager — the audit records its length.
 * Notifications by e-mail and bell come with WP-PLT-01: until then the Home cards say who waits for what.
 */

const p = tmsPlanningPermissions;
const PLAN_READ = p['tms.training_plan.read'];
const PLAN_MANAGE = p['tms.training_plan.manage'];
const PLAN_APPROVE = p['tms.training_plan.approve'];
const PLAN_CONFIRM = p['tms.training_plan.confirm'];
const NEEDS_SUBMIT = tmsRolePermissions['tms.plan_needs.submit'];

/** The standard roles of each step (approval goes by role, EP-PLN §13 a, b). */
const STEP_ROLES: Readonly<Record<ApprovalStep, string>> = { hr: 'hr_manager', finance: 'finance' };

/** Module error codes (ADR 0011 §3); messages under `errors.*` in the catalogs. */
export const PlanApprovalErrors = defineErrorCodes({
  /** The plan cannot be submitted yet (params.problem: needs_open, needs_not_added, uncosted, over_budget). */
  TRAINING_PLAN_NOT_SUBMITTABLE: { status: 422, messageKey: 'errors.trainingPlanNotSubmittable' },
  /** Another approver decided first: the step is settled. */
  TRAINING_PLAN_ALREADY_DECIDED: { status: 409, messageKey: 'errors.trainingPlanAlreadyDecided' },
  /** Nobody decides on a plan they submitted (or approves it twice). */
  TRAINING_PLAN_OWN_SUBMISSION: { status: 403, messageKey: 'errors.trainingPlanOwnSubmission' },
});

type Ctx = ActionContext<UserTx>;

// ---------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------

export interface ApprovalPerson {
  readonly personId: string;
  readonly name: PersonName;
}

export interface ApprovalStepView {
  readonly state: StepState;
  /** Every holder of the step's role (anyone of them decides), at most 50. */
  readonly deciders: readonly ApprovalPerson[];
  readonly decidedBy: ApprovalPerson | null;
  readonly decidedAt: string | null;
}

export interface ApprovalEventView {
  readonly kind: approvals.EventRecord['kind'];
  readonly step: ApprovalStep | null;
  readonly planVersion: number;
  readonly actor: ApprovalPerson | null;
  readonly comment: string | null;
  readonly at: string;
}

export interface PlanApprovalView {
  readonly plan: {
    readonly id: string;
    readonly cycleId: string;
    readonly status: approvals.ApprovalRecord['status'];
    readonly planVersion: number;
    /** The row's version (what a step names as «the plan I saw»). */
    readonly version: number;
    readonly approvalStep: ApprovalStep | null;
    readonly financeStep: boolean;
    readonly submittedAt: string | null;
    readonly submittedBy: ApprovalPerson | null;
    readonly decidedAt: string | null;
    readonly decidedBy: ApprovalPerson | null;
    readonly sendBackComment: string | null;
    readonly approvedAt: string | null;
    readonly approvedBy: ApprovalPerson | null;
  };
  readonly steps: Readonly<Record<ApprovalStep, ApprovalStepView>>;
  /** «Finance confirms the plan» now (what the next submission asks); false for whoever cannot read the settings. */
  readonly financeSwitch: boolean;
  /** Why the plan cannot be submitted now (the database's own answer); null when it can, or nothing to submit. */
  readonly submitProblem: SubmitProblem | null;
  readonly events: readonly ApprovalEventView[];
  readonly versions: readonly {
    readonly planVersion: number;
    readonly approvedAt: string;
    readonly approvedBy: ApprovalPerson | null;
  }[];
  readonly viewer: {
    /** The viewer (marked «you» among the deciders). */
    readonly personId: string | null;
    /** The viewer submitted the plan now waiting: another person decides. */
    readonly submitted: boolean;
  };
  readonly can: {
    readonly submit: boolean;
    /** The step the viewer decides now, or null. */
    readonly decide: ApprovalStep | null;
    readonly revise: boolean;
  };
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

async function peopleOf(
  tx: UserTx,
  ids: readonly (string | null)[],
): Promise<(id: string | null) => ApprovalPerson | null> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  const members = new Map(
    (wanted.length > 0 ? await getMemberOptionsByIds(tx, wanted) : []).map((m) => [m.personId, m]),
  );
  return (id) => {
    if (id === null) return null;
    const member = members.get(id);
    return { personId: id, name: { ar: member?.nameAr ?? null, en: member?.nameEn ?? null } };
  };
}

async function decidersOf(tx: UserTx): Promise<Readonly<Record<ApprovalStep, ApprovalPerson[]>>> {
  const holders = await listRoleHolders(tx, Object.values(STEP_ROLES));
  const of = (step: ApprovalStep) =>
    holders
      .filter((h) => h.roleCode === STEP_ROLES[step])
      .map((h) => ({ personId: h.personId, name: { ar: h.nameAr, en: h.nameEn } }));
  return { hr: of('hr'), finance: of('finance') };
}

/** Where the plan's approval stands for the viewer: steps, history, versions and what they may do. */
async function approvalView(ctx: Ctx, plan: approvals.ApprovalRecord): Promise<PlanApprovalView> {
  const organization = ctx.can(PLAN_READ, 'tenant') || ctx.can(PLAN_MANAGE, 'tenant');
  const manage = ctx.can(PLAN_MANAGE, 'tenant');
  const events = await approvals.listEvents(ctx.tx, plan.id);
  const versions = organization ? await approvals.listVersions(ctx.tx, plan.id) : [];
  const person = await peopleOf(ctx.tx, [
    plan.submittedBy,
    plan.hrDecidedBy,
    plan.decidedBy,
    plan.approvedBy,
    ...events.map((e) => e.actorPersonId),
    ...versions.map((v) => v.approvedBy),
  ]);
  const deciders = organization ? await decidersOf(ctx.tx) : { hr: [], finance: [] };
  const financeSwitch = manage ? await approvals.financeConfirms(ctx.tx) : false;
  const states = stepStates({
    status: plan.status,
    approvalStep: plan.approvalStep,
    financeStep: plan.financeStep,
    financeSwitch,
    hrDecided: plan.hrDecidedBy !== null,
  });
  const lastDecision = (step: ApprovalStep) =>
    events.find(
      (e) =>
        e.planVersion === plan.planVersion &&
        e.step === step &&
        (e.kind === 'approved' || e.kind === 'confirmed'),
    ) ?? null;
  const stepView = (step: ApprovalStep): ApprovalStepView => {
    const decided = states[step] === 'done' ? lastDecision(step) : null;
    return {
      state: states[step],
      deciders: deciders[step],
      decidedBy: decided ? person(decided.actorPersonId) : null,
      decidedAt: decided ? decided.occurredAt.toISOString() : null,
    };
  };
  const editable = plan.status === 'draft' || plan.status === 'sent_back';
  return {
    plan: {
      id: plan.id,
      cycleId: plan.cycleId,
      status: plan.status,
      planVersion: plan.planVersion,
      version: plan.version,
      approvalStep: plan.approvalStep,
      financeStep: plan.financeStep,
      submittedAt: iso(plan.submittedAt),
      submittedBy: person(plan.submittedBy),
      decidedAt: iso(plan.decidedAt),
      decidedBy: person(plan.decidedBy),
      sendBackComment: plan.sendBackComment,
      approvedAt: iso(plan.approvedAt),
      approvedBy: person(plan.approvedBy),
    },
    steps: { hr: stepView('hr'), finance: stepView('finance') },
    financeSwitch,
    submitProblem:
      manage && editable ? await approvals.submitProblem(ctx.tx, plan.id, plan.cycleId) : null,
    events: events.map((e) => ({
      kind: e.kind,
      step: e.step,
      planVersion: e.planVersion,
      actor: person(e.actorPersonId),
      comment: e.comment,
      at: e.occurredAt.toISOString(),
    })),
    versions: versions.map((v) => ({
      planVersion: v.planVersion,
      approvedAt: v.approvedAt.toISOString(),
      approvedBy: person(v.approvedBy),
    })),
    viewer: {
      personId: ctx.actor.personId,
      submitted: plan.status === 'in_approval' && plan.submittedBy === ctx.actor.personId,
    },
    can: {
      submit: manage && editable,
      decide: decidableStep(plan, {
        personId: ctx.actor.personId,
        approve: ctx.can(PLAN_APPROVE, 'tenant'),
        confirm: ctx.can(PLAN_CONFIRM, 'tenant'),
      }),
      revise: manage && plan.status === 'approved',
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------------

/**
 * Where a cycle's plan stands (the Plan tab's banner and actions, the submit popup's steps, the review's side
 * column): null before the plan is built. Read through tms.training_plan.read or .manage, as the Plan tab.
 */
export function planApprovalQueryDefinition(
  through: 'read' | 'manage' = 'read',
): QueryDefinition<typeof CyclePlanRef, PlanApprovalView | null, UserTx> {
  return {
    permission: through === 'read' ? PLAN_READ : PLAN_MANAGE,
    input: CyclePlanRef,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const plan = await approvals.getApprovalByCycle(ctx.tx, input.cycleId);
      return ok(plan ? await approvalView(ctx, plan) : null);
    },
  };
}

/** One plan on the Approvals page and the approvers' Home card (design 5a). */
export interface ApprovalItem {
  readonly planId: string;
  readonly cycleId: string;
  readonly cycleName: CycleName;
  readonly status: approvals.ApprovalRecord['status'];
  readonly approvalStep: ApprovalStep | null;
  readonly planVersion: number;
  readonly submittedAt: string | null;
  readonly submittedBy: ApprovalPerson | null;
  readonly decidedAt: string | null;
  /** The viewer decides this step now. */
  readonly waitingForMe: boolean;
  readonly summary: {
    readonly lines: number;
    readonly leftOut: number;
    readonly people: number;
    readonly sessions: number;
    readonly cost: string;
    readonly envelope: string | null;
    readonly overBudget: number;
    readonly currency: string;
    readonly fractionDigits: number;
  } | null;
}

export interface ApprovalsView {
  readonly items: readonly ApprovalItem[];
  /** Plans waiting for the viewer's decision. */
  readonly waiting: number;
  readonly can: { readonly approve: boolean; readonly confirm: boolean };
}

/**
 * The figures of every listed plan, as the Plan tab works them out (approval-rules planFigures), from three
 * queries for all of them — the lines, their links and the envelopes (review L7: no query per plan).
 */
async function figuresOf(
  ctx: Ctx,
  plans: readonly approvals.PlanListRecord[],
): Promise<ReadonlyMap<string, NonNullable<ApprovalItem['summary']>>> {
  const ids = plans.map((plan) => plan.id);
  const [lines, links, envelopes] = await Promise.all([
    consolidation.listLinesOfPlans(ctx.tx, ids),
    consolidation.listLinksOfPlans(ctx.tx, ids),
    approvals.listEnvelopes(
      ctx.tx,
      plans.map((plan) => plan.cycleId),
    ),
  ]);
  return new Map(
    plans.map((plan) => [
      plan.id,
      planFigures(
        lines.filter((l) => l.planId === plan.id),
        links.filter((l) => l.planId === plan.id),
        envelopes.filter((e) => e.cycleId === plan.cycleId),
        plan.currency,
      ),
    ]),
  );
}

/**
 * The Approvals page (Kawadir Requisitions layout) and the approvers' Home card: every plan the organization-wide
 * reader sees, those waiting for the viewer's step first. `figures: false` (the menu's count) skips the figures.
 */
export function approvalsQueryDefinition(
  options: { readonly figures?: boolean } = {},
): QueryDefinition<typeof ApprovalsInput, ApprovalsView, UserTx> {
  return {
    permission: PLAN_READ,
    input: ApprovalsInput,
    handler: async ({ ctx }) => {
      if (!ctx.can(PLAN_READ, 'tenant')) return err(appError('FORBIDDEN'));
      const viewer = {
        personId: ctx.actor.personId,
        approve: ctx.can(PLAN_APPROVE, 'tenant'),
        confirm: ctx.can(PLAN_CONFIRM, 'tenant'),
      };
      const plans = (await approvals.listPlans(ctx.tx)).filter(
        (plan) => plan.status !== 'draft' || plan.submittedAt,
      );
      const person = await peopleOf(
        ctx.tx,
        plans.map((plan) => plan.submittedBy),
      );
      const figures = options.figures === false ? null : await figuresOf(ctx, plans);
      const items: ApprovalItem[] = [];
      for (const plan of plans) {
        items.push({
          planId: plan.id,
          cycleId: plan.cycleId,
          cycleName: { ar: plan.cycleNameAr, en: plan.cycleNameEn },
          status: plan.status,
          approvalStep: plan.approvalStep,
          planVersion: plan.planVersion,
          submittedAt: iso(plan.submittedAt),
          submittedBy: person(plan.submittedBy),
          decidedAt: iso(plan.decidedAt),
          waitingForMe: decidableStep(plan, viewer) !== null,
          summary: figures?.get(plan.id) ?? null,
        });
      }
      items.sort((a, b) => Number(b.waitingForMe) - Number(a.waitingForMe));
      return ok({
        items,
        waiting: items.filter((i) => i.waitingForMe).length,
        can: { approve: viewer.approve, confirm: viewer.confirm },
      });
    },
  };
}

export interface PlanVersionView {
  readonly cycleId: string;
  readonly cycleName: CycleName;
  readonly planVersion: number;
  readonly approvedAt: string;
  readonly approvedBy: ApprovalPerson | null;
  readonly currency: string;
  readonly fractionDigits: number;
  readonly lines: readonly VersionLineView[];
  readonly departments: readonly {
    readonly departmentId: string;
    readonly name: LocalizedName;
    readonly people: number;
    readonly cost: string;
    readonly envelope: string | null;
    readonly reason: string | null;
    readonly state: BudgetState;
  }[];
  readonly total: {
    readonly people: number;
    readonly cost: string;
    readonly envelope: string | null;
  };
}

const unknownName: LocalizedName = { ar: '—', en: '—' };

/** An approved version of a cycle's plan, read only (the «Versions» menu). Organization-wide readers. */
export function planVersionQueryDefinition(): QueryDefinition<
  typeof PlanVersionViewInput,
  PlanVersionView,
  UserTx
> {
  return {
    permission: PLAN_READ,
    input: PlanVersionViewInput,
    handler: async ({ ctx, input }) => {
      if (!ctx.can(PLAN_READ, 'tenant')) return err(appError('FORBIDDEN'));
      const plan = await approvals.getApprovalByCycle(ctx.tx, input.cycleId);
      if (!plan) return err(appError('NOT_FOUND'));
      const version = await approvals.getVersion(ctx.tx, plan.id, input.planVersion);
      if (!version) return err(appError('NOT_FOUND'));
      const fractionDigits = currencyFractionDigits(version.currency);
      const lines = version.lines.map((l) => versionLineView(l, fractionDigits));
      const structure = await listOrgStructure(ctx.tx);
      const name = nameIn(structure);
      const departments = version.departments.map((d) => {
        const own = lines.filter((l) => l.status === 'in_plan');
        let people = 0;
        let cost = 0n;
        for (const line of own) {
          const share = line.departments.find((x) => x.departmentId === d.departmentId);
          if (!share) continue;
          people += share.seats;
          cost += amountMilli(share.share) ?? 0n;
        }
        const text = fromMilli(cost);
        return {
          departmentId: d.departmentId,
          name: name(d.departmentId),
          people,
          cost: text,
          envelope: d.envelope,
          reason: d.reason,
          state: budgetState(text, d.envelope),
        };
      });
      const withEnvelope = departments.filter((d) => d.envelope !== null);
      const person = await peopleOf(ctx.tx, [version.approvedBy]);
      const cycleNames = (await approvals.listPlans(ctx.tx)).find((x) => x.id === plan.id);
      return ok({
        cycleId: plan.cycleId,
        cycleName: { ar: cycleNames?.cycleNameAr ?? null, en: cycleNames?.cycleNameEn ?? null },
        planVersion: version.planVersion,
        approvedAt: version.approvedAt.toISOString(),
        approvedBy: person(version.approvedBy),
        currency: version.currency,
        fractionDigits,
        lines,
        departments,
        total: {
          people: departments.reduce((n, d) => n + d.people, 0),
          cost: fromMilli(
            lines
              .filter((l) => l.status === 'in_plan')
              .reduce((n, l) => n + (amountMilli(l.cost) ?? 0n), 0n),
          ),
          envelope:
            withEnvelope.length === 0
              ? null
              : fromMilli(withEnvelope.reduce((n, d) => n + (amountMilli(d.envelope) ?? 0n), 0n)),
        },
      });
    },
  };
}

function nameIn(structure: OrgStructure): (id: string) => LocalizedName {
  const byId = new Map(structure.departments.map((d) => [d.id, d]));
  return (id) => {
    const unit = byId.get(id);
    return unit ? structureName(unit) : unknownName;
  };
}

/** The departments the viewer is the effective head of (units without a head of their own included). */
function headedBy(structure: OrgStructure, personId: string | null): (id: string) => boolean {
  const tree = structure.departments.map((d) => ({
    id: d.id,
    parentId: d.parentId,
    branchId: d.branchId,
    active: d.active,
    sortOrder: d.sortOrder,
    nameAr: structureName(d).ar,
    headPersonId: d.head?.personId ?? null,
  }));
  return (id) => personId !== null && effectiveHead(tree, id)?.personId === personId;
}

export interface DepartmentPlanResultView {
  readonly cycleId: string;
  readonly cycleName: CycleName;
  readonly departmentId: string;
  readonly departmentName: LocalizedName;
  readonly planVersion: number;
  readonly approvedAt: string;
  readonly currency: string;
  readonly fractionDigits: number;
  readonly reason: string | null;
  readonly result: DepartmentResult;
  /** Names of the departments the department's lines are shared with. */
  readonly departmentNames: Readonly<Record<string, LocalizedName>>;
}

function resultView(
  record: approvals.DepartmentResultRecord,
  structure: OrgStructure,
): DepartmentPlanResultView {
  const fractionDigits = currencyFractionDigits(record.currency);
  const result = departmentResult(
    record.departmentId,
    record.lines,
    record.envelope,
    fractionDigits,
  );
  const name = nameIn(structure);
  const shared = new Set(result.approved.flatMap((a) => a.sharedWith));
  return {
    cycleId: record.cycleId,
    cycleName: { ar: record.cycleNameAr, en: record.cycleNameEn },
    departmentId: record.departmentId,
    departmentName: name(record.departmentId),
    planVersion: record.planVersion,
    approvedAt: record.approvedAt.toISOString(),
    currency: record.currency,
    fractionDigits,
    reason: record.reason,
    result,
    departmentNames: Object.fromEntries([...shared].map((id) => [id, name(id)])),
  };
}

/**
 * A department's result once the plan is approved (design 6b; Q4 = A): its effective head only (deny by default —
 * anyone else, or before approval: null). Its approved lines with its seats and share of the cost against its
 * envelope, and its lines left out with their reasons.
 */
export function departmentPlanResultQueryDefinition(): QueryDefinition<
  typeof DepartmentRef,
  DepartmentPlanResultView | null,
  UserTx
> {
  return {
    permission: NEEDS_SUBMIT,
    input: DepartmentRef,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const structure = await listOrgStructure(ctx.tx);
      if (!headedBy(structure, ctx.actor.personId)(input.departmentId)) return ok(null);
      const [record] = await approvals.listDepartmentResults(ctx.tx, {
        cycleId: input.cycleId,
        departmentId: input.departmentId,
      });
      return ok(record ? resultView(record, structure) : null);
    },
  };
}

export interface MyPlanResult {
  readonly cycleId: string;
  readonly cycleName: CycleName;
  readonly departmentId: string;
  readonly departmentName: LocalizedName;
  readonly planVersion: number;
  readonly approvedAt: string;
  readonly approvedLines: number;
  readonly leftOutLines: number;
  readonly seats: number;
}

/** The Department Head's approved results (Home card «The plan is approved»): the departments they head. */
export function myPlanResultsQueryDefinition(): QueryDefinition<
  typeof MyNeedsInput,
  { readonly results: readonly MyPlanResult[] },
  UserTx
> {
  return {
    permission: NEEDS_SUBMIT,
    input: MyNeedsInput,
    scoped: true,
    handler: async ({ ctx }) => {
      const structure = await listOrgStructure(ctx.tx);
      const heads = headedBy(structure, ctx.actor.personId);
      const records = (await approvals.listDepartmentResults(ctx.tx)).filter((r) =>
        heads(r.departmentId),
      );
      return ok({
        results: records
          .map((record) => {
            const view = resultView(record, structure);
            return {
              cycleId: view.cycleId,
              cycleName: view.cycleName,
              departmentId: view.departmentId,
              departmentName: view.departmentName,
              planVersion: view.planVersion,
              approvedAt: view.approvedAt,
              approvedLines: view.result.approved.length,
              leftOutLines: view.result.leftOut.length,
              seats: view.result.seats,
            };
          })
          .sort((a, b) => b.approvedAt.localeCompare(a.approvedAt)),
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------

const audit = (action: string, planId: string, data: Record<string, unknown>): AuditRecord => ({
  action: `tms.training_plan.${action}`,
  entityType: 'training_plan',
  entityId: planId,
  data,
});

function refusalError(refusal: approvals.ApprovalRefusal): AppError {
  switch (refusal.kind) {
    case 'not_ready':
      return appError(PlanApprovalErrors.TRAINING_PLAN_NOT_SUBMITTABLE, {
        params: { problem: refusal.problem ?? 'unknown' },
      });
    case 'own_submission':
      return appError(PlanApprovalErrors.TRAINING_PLAN_OWN_SUBMISSION);
    case 'comment_required':
      return appError('VALIDATION_FAILED', {
        fieldErrors: [{ path: 'comment', code: 'REQUIRED' }],
      });
    case 'not_allowed':
      return appError('FORBIDDEN');
    case 'refused':
      return appError('PRECONDITION_FAILED');
  }
}

/** Nothing matched the plan as the user saw it: gone, already moved, or changed since. */
async function staleError(
  tx: UserTx,
  planId: string,
  expected: (plan: approvals.ApprovalRecord) => boolean,
): Promise<AppError> {
  const plan = await approvals.getApproval(tx, planId);
  if (!plan) return appError('NOT_FOUND');
  return expected(plan) ? appError('CONFLICT_VERSION') : appError('PRECONDITION_FAILED');
}

export interface PlanSubmitted {
  readonly planId: string;
  readonly cycleId: string;
  readonly planVersion: number;
  readonly financeStep: boolean;
}

/**
 * «Submit for approval» (design 4; step 8): the organization-wide L&D Manager; the plan is frozen and waits for the
 * HR Manager (then Finance when «Finance confirms the plan» is on). Refused while a department may still change its
 * needs, a resubmitted need is not in the plan, a line in the plan has no cost, or a department over its envelope
 * has no reason.
 */
export function submitPlanActionDefinition(): ActionDefinition<
  typeof PlanVersionRef,
  PlanSubmitted,
  UserTx
> {
  return {
    permission: PLAN_MANAGE,
    input: PlanVersionRef,
    handler: async ({ ctx, input }) => {
      if (!ctx.can(PLAN_MANAGE, 'tenant')) return err(appError('FORBIDDEN'));
      const outcome = await approvals.submitPlan(ctx.tx, input.planId, input.version);
      if (!outcome.ok) return err(refusalError(outcome.refusal));
      if (!outcome.value) {
        return err(
          await staleError(
            ctx.tx,
            input.planId,
            (plan) => plan.status === 'draft' || plan.status === 'sent_back',
          ),
        );
      }
      return ok({
        planId: outcome.value.id,
        cycleId: outcome.value.cycleId,
        planVersion: outcome.value.planVersion,
        financeStep: outcome.value.financeStep,
      });
    },
    audit: (_input, output) =>
      audit('submitted', output.planId, {
        cycleId: output.cycleId,
        planVersion: output.planVersion,
        financeStep: output.financeStep,
      }),
  };
}

export interface PlanDecided {
  readonly planId: string;
  readonly cycleId: string;
  readonly planVersion: number;
  readonly step: ApprovalStep;
  readonly decision: 'approve' | 'send_back';
  readonly status: approvals.ApprovalRecord['status'];
  /** The step now waiting (Finance after HR), or null. */
  readonly approvalStep: ApprovalStep | null;
  readonly commentLength: number;
}

/**
 * Approve, confirm or send back (designs 5b, 5c; steps 9, 10, 12): the step's role only — the HR Manager for the
 * HR step, Finance for the Finance step — never the submitter. The first decision settles the step: a second one,
 * or one on a plan changed since, is refused.
 */
export function decidePlanActionDefinition(): ActionDefinition<
  typeof DecidePlanInput,
  PlanDecided,
  UserTx
> {
  return {
    permission: PLAN_READ,
    input: DecidePlanInput,
    handler: async ({ ctx, input }) => {
      const holds =
        input.step === 'hr' ? ctx.can(PLAN_APPROVE, 'tenant') : ctx.can(PLAN_CONFIRM, 'tenant');
      if (!holds) return err(appError('FORBIDDEN'));
      const before = await approvals.getApproval(ctx.tx, input.planId);
      if (!before) return err(appError('NOT_FOUND'));
      if (before.status === 'in_approval' && before.approvalStep === input.step) {
        if (ctx.actor.personId === null || before.submittedBy === ctx.actor.personId) {
          return err(appError(PlanApprovalErrors.TRAINING_PLAN_OWN_SUBMISSION));
        }
        if (input.step === 'finance' && before.hrDecidedBy === ctx.actor.personId) {
          return err(appError(PlanApprovalErrors.TRAINING_PLAN_OWN_SUBMISSION));
        }
      }
      const outcome = await approvals.decidePlan(
        ctx.tx,
        input.planId,
        input.version,
        input.step,
        input.decision,
        input.decision === 'send_back' ? input.comment : null,
      );
      if (!outcome.ok) return err(refusalError(outcome.refusal));
      if (!outcome.value) {
        const now = await approvals.getApproval(ctx.tx, input.planId);
        if (!now) return err(appError('NOT_FOUND'));
        // Still waiting for this step, changed since: the user reloads. Anything else: someone decided first.
        return err(
          now.status === 'in_approval' && now.approvalStep === input.step
            ? appError('CONFLICT_VERSION')
            : appError(PlanApprovalErrors.TRAINING_PLAN_ALREADY_DECIDED),
        );
      }
      return ok({
        planId: outcome.value.id,
        cycleId: outcome.value.cycleId,
        planVersion: outcome.value.planVersion,
        step: input.step,
        decision: input.decision,
        status: outcome.value.status,
        approvalStep: outcome.value.approvalStep,
        commentLength: input.decision === 'send_back' ? (input.comment ?? '').length : 0,
      });
    },
    audit: (_input, output) =>
      audit(
        output.decision === 'send_back'
          ? 'sent_back'
          : output.step === 'hr'
            ? 'approved'
            : 'confirmed',
        output.planId,
        {
          cycleId: output.cycleId,
          planVersion: output.planVersion,
          step: output.step,
          status: output.status,
          ...(output.decision === 'send_back' ? { commentLength: output.commentLength } : {}),
        },
      ),
  };
}

export interface PlanRevised {
  readonly planId: string;
  readonly cycleId: string;
  readonly planVersion: number;
}

/**
 * «Revise plan» (design 6a; step 13): the organization-wide L&D Manager opens the next version as a draft of the
 * same lines; the approved version stays as approved (read only, in «Versions») and the new one goes through the
 * same steps.
 */
export function revisePlanActionDefinition(): ActionDefinition<
  typeof PlanVersionRef,
  PlanRevised,
  UserTx
> {
  return {
    permission: PLAN_MANAGE,
    input: PlanVersionRef,
    handler: async ({ ctx, input }) => {
      if (!ctx.can(PLAN_MANAGE, 'tenant')) return err(appError('FORBIDDEN'));
      const outcome = await approvals.revisePlan(ctx.tx, input.planId, input.version);
      if (!outcome.ok) return err(refusalError(outcome.refusal));
      if (!outcome.value) {
        return err(await staleError(ctx.tx, input.planId, (plan) => plan.status === 'approved'));
      }
      return ok({
        planId: outcome.value.id,
        cycleId: outcome.value.cycleId,
        planVersion: outcome.value.planVersion,
      });
    },
    audit: (_input, output) =>
      audit('revised', output.planId, {
        cycleId: output.cycleId,
        planVersion: output.planVersion,
        fromVersion: output.planVersion - 1,
      }),
  };
}
