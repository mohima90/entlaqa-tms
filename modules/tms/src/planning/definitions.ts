import {
  type AppError,
  type Result,
  appError,
  defineErrorCodes,
  err,
  ok,
} from '@jadarat/platform-core';
import {
  type MemberOption,
  type OrgStructure,
  type StructureLevelLabel,
  type UserTx,
  MEMBER_SEARCH,
  getMemberOptionsByIds,
  getOrganizationProfile,
  listOrgStructure,
  listStructureLevelLabels,
  searchMemberOptions,
} from '@jadarat/platform-db';
import {
  type ActionDefinition,
  type AuditRecord,
  type QueryDefinition,
  tmsPlanningPermissions,
} from '@jadarat/platform-rbac';
import { z } from 'zod';
import {
  type ApprovalStep,
  CreateCycleInput,
  CycleRef,
  CycleVersionRef,
  type CycleStatus,
  CyclesListInput,
  ExtendDeadlineInput,
  type FormStatus,
  type LaunchProblem,
  SaveBudgetsInput,
  SaveRemindersInput,
  SaveScopeInput,
  SaveSettingsInput,
  SaveStepsInput,
  type StructureUnit,
  UpdateCycleBasicsInput,
  basicsIssues,
  canExtendDeadline,
  canonicalAmount,
  chainIssues,
  defaultDeadline,
  defaultPeriod,
  departmentDeadline,
  departmentsInScope,
  effectiveCycleStatus,
  effectiveHead,
  formStatus,
  launchProblems,
  toFieldErrors,
  treeOrder,
} from './model';
import { type NeedsFormOption, listNeedsFormOptions } from './needs-forms';
import * as repo from './repository';

/**
 * Planning cycle queries and server-action definitions (EP-PLN, T-M3-04; FR-PLN-02, FR-WFL-01/02 R1
 * part). Bound to the production defineAction in `actions/planning.ts` (and to defineQuery in the app);
 * unit-tested with a fake runtime. Every change is audited (BR-PLN-j); the database repeats the rules.
 *
 *   read   tms.plan_cycle.read    (L&D Manager, Training Coordinator) — list, cycle, progress, settings
 *   write  tms.plan_cycle.manage  (L&D Manager) — create, set-up steps, launch, extend, delete, settings
 */

const p = tmsPlanningPermissions;
const READ = p['tms.plan_cycle.read'];
const MANAGE = p['tms.plan_cycle.manage'];

/** Module error codes (ADR 0011 §3); messages under `errors.*` in the catalogs. */
export const PlanningErrors = defineErrorCodes({
  PLAN_CYCLE_NOT_DRAFT: { status: 409, messageKey: 'errors.planCycleNotDraft' },
  PLAN_CYCLE_OPEN_EXISTS: { status: 409, messageKey: 'errors.planCycleOpenExists' },
  PLAN_CYCLE_NOT_READY: { status: 422, messageKey: 'errors.planCycleNotReady' },
  PLAN_CYCLE_DEADLINE_REFUSED: { status: 422, messageKey: 'errors.planCycleDeadlineRefused' },
});

// ---------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------

export interface LocalizedName {
  readonly ar: string;
  readonly en: string | null;
}

/** A person's name: the Arabic or the English one may be missing (never both; PO 17 Oct 2026). */
export interface PersonName {
  readonly ar: string | null;
  readonly en: string | null;
}

export interface CycleListItem {
  readonly id: string;
  readonly name: { readonly ar: string; readonly en: string };
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly deadline: string;
  /** As shown: an open cycle past its deadline is Closed. */
  readonly status: CycleStatus;
  readonly departmentCount: number;
  readonly submittedCount: number;
}

export interface CyclesListView {
  readonly today: string;
  readonly cycles: readonly CycleListItem[];
  readonly counts: Readonly<Record<'all' | 'draft' | 'open' | 'closed', number>>;
  readonly canManage: boolean;
}

export interface CycleDepartmentView {
  readonly departmentId: string;
  readonly name: LocalizedName;
  /**
   * The unit's level (ordinal of `CycleView.levels`): the tables name the column after the first level, or
   * «Unit» with each row's level when levels mix (guided-test feedback #3, PO 17 Oct 2026). Null: unknown.
   */
  readonly levelOrdinal: number | null;
  /** The department is still in the structure and active. */
  readonly active: boolean;
  readonly budgetAmount: string | null;
  readonly status: FormStatus;
  /** The department's effective deadline (its own extension when later than the cycle's; WP-LD-01). */
  readonly deadline: string;
  /** The needs entered so far (WP-LD-01; design screen 5): count, seats, named seats, estimated cost. */
  readonly needs: {
    readonly count: number;
    readonly seats: number;
    readonly named: number;
    readonly cost: string | null;
  };
  /** The last change of a need or the submission (ISO), or null. */
  readonly lastActivityAt: string | null;
  /** For the manager's actions on the row (return, extend): the department row's version. */
  readonly version: number;
  /** Who receives the form (own head or nearest above); null: nobody — warned. */
  readonly head: {
    readonly name: PersonName;
    /** The head comes from a unit above (its name), or null when it is the unit's own head. */
    readonly via: LocalizedName | null;
  } | null;
}

export interface StepView extends ApprovalStep {
  readonly approverName: PersonName | null;
  readonly approverActive: boolean;
}

/** One unit of the structure for the scope step (depth for indentation; tree order). */
export interface ScopeUnitOption {
  readonly id: string;
  readonly parentId: string | null;
  readonly branchId: string | null;
  readonly name: LocalizedName;
  /** The unit's level (ordinal of `CycleView.levels`). */
  readonly levelOrdinal: number | null;
  readonly depth: number;
  readonly active: boolean;
  readonly hasHead: boolean;
}

export interface CycleView {
  readonly today: string;
  readonly cycle: Omit<repo.CycleRecord, 'departments' | 'steps' | 'launchedBy'>;
  readonly status: CycleStatus;
  readonly canManage: boolean;
  /** A draft and the member manages cycles: the set-up steps are editable. */
  readonly editable: boolean;
  readonly canExtend: boolean;
  readonly departments: readonly CycleDepartmentView[];
  /** The organization's own level names (FR-ADM-05): the pages say them instead of «Department». */
  readonly levels: readonly StructureLevelLabel[];
  readonly steps: readonly StepView[];
  readonly problems: readonly LaunchProblem[];
  /** Departments in scope whose form reaches nobody (no head up the tree) — a warning, not a block. */
  readonly withoutHead: number;
  /** Set-up only (editable): the structure for the scope step and the people for named approvers. */
  readonly setup: {
    readonly units: readonly ScopeUnitOption[];
    readonly branches: readonly {
      readonly id: string;
      readonly name: LocalizedName;
      readonly active: boolean;
    }[];
    /** Needs forms of the forms library (stub: none until it merges — needs-forms.ts). */
    readonly needsForms: readonly NeedsFormOption[];
  } | null;
}

export interface SettingsView {
  readonly settings: repo.PlanningSettingsRecord;
  readonly steps: readonly StepView[];
  readonly canManage: boolean;
}

export interface NewCycleView {
  readonly today: string;
  readonly defaults: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly deadline: string;
  };
  readonly currency: string;
  /** Needs forms of the forms library (stub: none until it merges — needs-forms.ts). */
  readonly needsForms: readonly NeedsFormOption[];
}

// ---------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------

function units(structure: OrgStructure): StructureUnit[] {
  return structure.departments.map((d) => ({
    id: d.id,
    parentId: d.parentId,
    branchId: d.branchId,
    active: d.active,
    sortOrder: d.sortOrder,
    nameAr: d.nameAr,
    headPersonId: d.head?.personId ?? null,
  }));
}

function scopeUnitOptions(structure: OrgStructure): ScopeUnitOption[] {
  const all = units(structure);
  const byId = new Map(structure.departments.map((d) => [d.id, d]));
  return treeOrder(all).flatMap(({ id, depth }) => {
    const d = byId.get(id);
    return d
      ? [
          {
            id,
            parentId: d.parentId,
            branchId: d.branchId,
            name: { ar: d.nameAr, en: d.nameEn },
            levelOrdinal: d.levelOrdinal,
            depth,
            active: d.active,
            hasHead: effectiveHead(all, id) !== null,
          },
        ]
      : [];
  });
}

function memberMap(members: readonly (MemberOption & { readonly active: boolean })[]) {
  return new Map(members.map((m) => [m.personId, m]));
}

function stepViews(
  steps: readonly ApprovalStep[],
  members: ReadonlyMap<string, MemberOption & { readonly active: boolean }>,
): StepView[] {
  return steps.map((step) => {
    const person = step.approverPersonId ? members.get(step.approverPersonId) : undefined;
    return {
      ...step,
      approverName: person ? { ar: person.nameAr, en: person.nameEn } : null,
      approverActive: person?.active ?? false,
    };
  });
}

/** Maps a failed "touch" of the cycle to the action's error. */
function touchError(outcome: Exclude<repo.TouchOutcome['outcome'], 'ok'>): AppError {
  switch (outcome) {
    case 'not_found':
      return appError('NOT_FOUND');
    case 'conflict':
      return appError('CONFLICT_VERSION');
    case 'not_draft':
      return appError(PlanningErrors.PLAN_CYCLE_NOT_DRAFT);
  }
}

async function touch(
  tx: UserTx,
  id: string,
  version: number,
  draftOnly = true,
): Promise<Result<number, AppError>> {
  const touched = await repo.touchCycle(tx, id, version, { draftOnly });
  return touched.outcome === 'ok' ? ok(touched.version) : err(touchError(touched.outcome));
}

/** Named approvers must be active members of the organization (business flow B4). */
async function approverProblems(
  tx: UserTx,
  steps: readonly ApprovalStep[],
): Promise<{ path: string; code: string }[]> {
  const named = steps.flatMap((s) => (s.approverPersonId ? [s.approverPersonId] : []));
  if (named.length === 0) return [];
  const members = memberMap(await getMemberOptionsByIds(tx, named));
  return steps.flatMap((step, index) =>
    step.approverPersonId && !members.get(step.approverPersonId)?.active
      ? [{ path: `steps.${String(index)}.approverPersonId`, code: 'NOT_A_MEMBER' }]
      : [],
  );
}

/** The chosen needs form must be one of the organization's (forms library adapter). */
async function needsFormProblems(
  tx: UserTx,
  needsFormId: string | null,
  current: string | null = null,
): Promise<{ path: string; code: string }[]> {
  if (needsFormId === null) return [];
  // An active form, or the cycle's own form even if it was switched off since (C-6: it stays).
  const forms = await listNeedsFormOptions(tx, current);
  return forms.some((f) => f.id === needsFormId) ? [] : [{ path: 'needsFormId', code: 'UNKNOWN' }];
}

const validation = (fieldErrors: readonly { path: string; code: string }[]) =>
  err(appError('VALIDATION_FAILED', { fieldErrors }));

const stepsForAudit = (steps: readonly ApprovalStep[]) =>
  steps.map((s) => ({ kind: s.kind, approverPersonId: s.approverPersonId }));

// ---------------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------------

export function planCyclesListQueryDefinition(): QueryDefinition<
  typeof CyclesListInput,
  CyclesListView,
  UserTx
> {
  return {
    permission: READ,
    input: CyclesListInput,
    handler: async ({ ctx }) => {
      const today = await repo.organizationToday(ctx.tx);
      const rows = await repo.listCycles(ctx.tx);
      const cycles = rows.map((r) => ({
        id: r.id,
        name: { ar: r.nameAr, en: r.nameEn },
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        deadline: r.deadline,
        // An extension for one department keeps the cycle open until it passes (WP-LD-01, Q3).
        status: effectiveCycleStatus(r.status, r.latestDeadline, today),
        departmentCount: r.departmentCount,
        submittedCount: r.submittedCount,
      }));
      const count = (status: CycleStatus) => cycles.filter((c) => c.status === status).length;
      return ok({
        today,
        cycles,
        counts: {
          all: cycles.length,
          draft: count('draft'),
          open: count('open'),
          closed: count('closed'),
        },
        canManage: ctx.can(MANAGE, 'tenant'),
      });
    },
  };
}

export function newPlanCycleQueryDefinition(): QueryDefinition<
  typeof CyclesListInput,
  NewCycleView,
  UserTx
> {
  return {
    permission: MANAGE,
    input: CyclesListInput,
    handler: async ({ ctx }) => {
      const today = await repo.organizationToday(ctx.tx);
      const profile = await getOrganizationProfile(ctx.tx);
      const period = defaultPeriod(today, profile?.fiscalYearStartMonth ?? 1);
      return ok({
        today,
        defaults: {
          periodStart: period.start,
          periodEnd: period.end,
          deadline: defaultDeadline(today, period.end),
        },
        currency: profile?.currencyCode ?? 'SAR',
        needsForms: await listNeedsFormOptions(ctx.tx),
      });
    },
  };
}

export function planCycleQueryDefinition(): QueryDefinition<typeof CycleRef, CycleView, UserTx> {
  return {
    permission: READ,
    input: CycleRef,
    handler: async ({ ctx, input }) => {
      const record = await repo.getCycle(ctx.tx, input.id);
      if (!record) return err(appError('NOT_FOUND'));
      const today = await repo.organizationToday(ctx.tx);
      const canManage = ctx.can(MANAGE, 'tenant');
      const editable = canManage && record.status === 'draft';
      const structure = await listOrgStructure(ctx.tx);
      const tree = units(structure);
      const byId = new Map(structure.departments.map((d) => [d.id, d]));
      const named = record.steps.flatMap((s) => (s.approverPersonId ? [s.approverPersonId] : []));
      const members = await getMemberOptionsByIds(ctx.tx, named);
      const people = memberMap(members);
      // Tree order (rows are written in one statement; their own order says nothing).
      const position = new Map(treeOrder(tree).map((entry, index) => [entry.id, index]));
      const rows = [...record.departments].sort(
        (a, b) =>
          (position.get(a.departmentId) ?? Number.MAX_SAFE_INTEGER) -
          (position.get(b.departmentId) ?? Number.MAX_SAFE_INTEGER),
      );
      // The needs entered so far, per department (WP-LD-01); nothing before the launch.
      const progress = new Map(
        record.status === 'draft'
          ? []
          : (await repo.listDepartmentProgress(ctx.tx, record.id)).map((p) => [p.departmentId, p]),
      );
      const departments: CycleDepartmentView[] = rows.map((row) => {
        const department = byId.get(row.departmentId);
        const head = effectiveHead(tree, row.departmentId);
        const headUnit = head ? byId.get(head.fromDepartmentId) : undefined;
        const headDepartment = headUnit?.head;
        const figures = progress.get(row.departmentId);
        const deadline = departmentDeadline(record.deadline, row.deadline);
        return {
          departmentId: row.departmentId,
          name: department
            ? { ar: department.nameAr, en: department.nameEn }
            : { ar: '—', en: '—' },
          levelOrdinal: department?.levelOrdinal ?? null,
          active: department?.active ?? false,
          budgetAmount: row.budgetAmount,
          status:
            record.status === 'draft' ? 'not_started' : formStatus(row.status, deadline, today),
          deadline,
          needs: {
            count: figures?.needsCount ?? 0,
            seats: figures?.seats ?? 0,
            named: figures?.named ?? 0,
            cost: figures?.cost ?? null,
          },
          lastActivityAt: figures?.lastActivityAt?.toISOString() ?? null,
          version: figures?.version ?? 1,
          head:
            head && headDepartment
              ? {
                  name: { ar: headDepartment.nameAr, en: headDepartment.nameEn },
                  via:
                    head.fromDepartmentId === row.departmentId
                      ? null
                      : { ar: headUnit.nameAr, en: headUnit.nameEn },
                }
              : null,
        };
      });
      const open = await repo.openCycle(ctx.tx, record.id);
      const problems =
        record.status === 'draft'
          ? launchProblems({
              status: record.status,
              deadline: record.deadline,
              today,
              needsFormId: record.needsFormId,
              departmentCount: record.departments.length,
              steps: record.steps,
              activeMemberIds: new Set(members.filter((m) => m.active).map((m) => m.personId)),
              anotherOpen: open !== null && open.deadline >= today,
            })
          : [];
      const { departments: _d, steps: _s, launchedBy: _l, ...cycle } = record;
      return ok({
        today,
        cycle,
        status: effectiveCycleStatus(record.status, record.latestDeadline, today),
        canManage,
        editable,
        canExtend: canManage && canExtendDeadline(record.status),
        departments,
        levels: await listStructureLevelLabels(ctx.tx),
        steps: stepViews(record.steps, people),
        problems,
        withoutHead: departments.filter((d) => d.head === null).length,
        setup: editable
          ? {
              units: scopeUnitOptions(structure),
              branches: structure.branches.map((b) => ({
                id: b.id,
                name: { ar: b.nameAr, en: b.nameEn },
                active: b.active,
              })),
              needsForms: await listNeedsFormOptions(ctx.tx, record.needsFormId),
            }
          : null,
      });
    },
  };
}

export function planningSettingsQueryDefinition(): QueryDefinition<
  typeof CyclesListInput,
  SettingsView,
  UserTx
> {
  return {
    permission: READ,
    input: CyclesListInput,
    handler: async ({ ctx }) => {
      const settings = await repo.getSettings(ctx.tx);
      const named = settings.steps.flatMap((s) => (s.approverPersonId ? [s.approverPersonId] : []));
      const members = await getMemberOptionsByIds(ctx.tx, named);
      return ok({
        settings,
        steps: stepViews(settings.steps, memberMap(members)),
        canManage: ctx.can(MANAGE, 'tenant'),
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------

const audit = (action: string, id: string, data: Record<string, unknown>): AuditRecord => ({
  action: `tms.plan_cycle.${action}`,
  entityType: 'plan_cycle',
  entityId: id,
  data,
});

export interface Saved {
  readonly id: string;
  readonly version: number;
}

/** A new draft: the needs form it stores (the organization's default when none was chosen). */
export interface CycleCreated extends Saved {
  readonly needsFormId: string | null;
}

export function createPlanCycleActionDefinition(): ActionDefinition<
  typeof CreateCycleInput,
  CycleCreated,
  UserTx
> {
  return {
    permission: MANAGE,
    input: CreateCycleInput,
    handler: async ({ ctx, input }) => {
      const issues = [
        ...toFieldErrors(basicsIssues(input)),
        ...(await needsFormProblems(ctx.tx, input.needsFormId)),
      ];
      if (issues.length > 0) return validation(issues);
      return ok(await repo.insertCycle(ctx.tx, input));
    },
    audit: (input, output) =>
      audit('created', output.id, {
        after: {
          nameAr: input.nameAr,
          nameEn: input.nameEn,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          deadline: input.deadline,
          // C-10: what the cycle stores (read back), not what was sent.
          needsFormId: output.needsFormId,
        },
      }),
  };
}

export interface BasicsSaved extends Saved {
  readonly changed: readonly string[];
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
}

const BASICS_KEYS = [
  'needsFormId',
  'nameAr',
  'nameEn',
  'periodStart',
  'periodEnd',
  'deadline',
  'instructionsAr',
  'instructionsEn',
] as const;

export function updatePlanCycleBasicsActionDefinition(): ActionDefinition<
  typeof UpdateCycleBasicsInput,
  BasicsSaved,
  UserTx
> {
  return {
    permission: MANAGE,
    input: UpdateCycleBasicsInput,
    handler: async ({ ctx, input }) => {
      const before = await repo.getCycle(ctx.tx, input.id);
      if (!before) return err(appError('NOT_FOUND'));
      const issues = [
        ...toFieldErrors(basicsIssues(input)),
        ...(await needsFormProblems(ctx.tx, input.needsFormId, before.needsFormId)),
      ];
      if (issues.length > 0) return validation(issues);
      const touched = await touch(ctx.tx, input.id, input.version);
      if (!touched.ok) return touched;
      const { id, version: _v, ...basics } = input;
      const version = await repo.updateBasics(ctx.tx, id, basics);
      // Instructions are free text: the audit records that they changed, not their words.
      const changed = BASICS_KEYS.filter((key) => before[key] !== basics[key]);
      const shown = (source: Pick<repo.CycleRecord, (typeof BASICS_KEYS)[number]>) =>
        Object.fromEntries(
          changed.filter((key) => !key.startsWith('instructions')).map((key) => [key, source[key]]),
        );
      return ok({ id, version, changed, before: shown(before), after: shown(basics) });
    },
    audit: (_input, output) =>
      output.changed.length === 0
        ? null
        : audit('basics_changed', output.id, {
            changed: output.changed,
            before: output.before,
            after: output.after,
          }),
  };
}

export interface ScopeSaved extends Saved {
  readonly departmentCount: number;
  readonly before: {
    readonly departmentIds: readonly string[];
    readonly branchIds: readonly string[];
  };
}

export function savePlanCycleScopeActionDefinition(): ActionDefinition<
  typeof SaveScopeInput,
  ScopeSaved,
  UserTx
> {
  return {
    permission: MANAGE,
    input: SaveScopeInput,
    handler: async ({ ctx, input }) => {
      const before = await repo.getCycle(ctx.tx, input.id);
      if (!before) return err(appError('NOT_FOUND'));
      const structure = await listOrgStructure(ctx.tx);
      const knownDepartments = new Set(structure.departments.map((d) => d.id));
      const knownBranches = new Set(structure.branches.map((b) => b.id));
      const unknown = [
        ...input.departmentIds.flatMap((id, i) =>
          knownDepartments.has(id) ? [] : [{ path: `departmentIds.${String(i)}`, code: 'UNKNOWN' }],
        ),
        ...input.branchIds.flatMap((id, i) =>
          knownBranches.has(id) ? [] : [{ path: `branchIds.${String(i)}`, code: 'UNKNOWN' }],
        ),
      ];
      if (unknown.length > 0) return validation(unknown);
      const touched = await touch(ctx.tx, input.id, input.version);
      if (!touched.ok) return touched;
      const departmentIds = departmentsInScope(units(structure), input);
      await repo.replaceScope(ctx.tx, input.id, input, departmentIds);
      return ok({
        id: input.id,
        version: touched.value,
        departmentCount: departmentIds.length,
        before: before.scope,
      });
    },
    audit: (input, output) =>
      audit('scope_changed', output.id, {
        before: output.before,
        after: { departmentIds: input.departmentIds, branchIds: input.branchIds },
        departments: output.departmentCount,
      }),
  };
}

export interface BudgetsSaved extends Saved {
  readonly changes: readonly {
    readonly departmentId: string;
    readonly before: string | null;
    readonly after: string | null;
  }[];
}

export function savePlanCycleBudgetsActionDefinition(): ActionDefinition<
  typeof SaveBudgetsInput,
  BudgetsSaved,
  UserTx
> {
  return {
    permission: MANAGE,
    input: SaveBudgetsInput,
    handler: async ({ ctx, input }) => {
      const before = await repo.getCycle(ctx.tx, input.id);
      if (!before) return err(appError('NOT_FOUND'));
      const inCycle = new Map(before.departments.map((d) => [d.departmentId, d.budgetAmount]));
      const outside = input.budgets.flatMap((b, i) =>
        inCycle.has(b.departmentId)
          ? []
          : [{ path: `budgets.${String(i)}.departmentId`, code: 'NOT_IN_SCOPE' }],
      );
      if (outside.length > 0) return validation(outside);
      const touched = await touch(ctx.tx, input.id, input.version);
      if (!touched.ok) return touched;
      await repo.updateBudgets(ctx.tx, input.id, input.budgets);
      const changes = input.budgets.flatMap((b) => {
        const was = inCycle.get(b.departmentId) ?? null;
        const now = canonicalAmount(b.amount);
        return was === now ? [] : [{ departmentId: b.departmentId, before: was, after: now }];
      });
      return ok({ id: input.id, version: touched.value, changes });
    },
    audit: (_input, output) =>
      output.changes.length === 0
        ? null
        : audit('budgets_changed', output.id, { changes: output.changes }),
  };
}

export interface StepsSaved extends Saved {
  readonly before: readonly ApprovalStep[];
}

export function savePlanCycleStepsActionDefinition(): ActionDefinition<
  typeof SaveStepsInput,
  StepsSaved,
  UserTx
> {
  return {
    permission: MANAGE,
    input: SaveStepsInput,
    handler: async ({ ctx, input }) => {
      const issues = chainIssues(input.steps, false);
      if (issues.length > 0) return validation(toFieldErrors(issues));
      const before = await repo.getCycle(ctx.tx, input.id);
      if (!before) return err(appError('NOT_FOUND'));
      const notMembers = await approverProblems(ctx.tx, input.steps);
      if (notMembers.length > 0) return validation(notMembers);
      const touched = await touch(ctx.tx, input.id, input.version);
      if (!touched.ok) return touched;
      await repo.replaceSteps(ctx.tx, input.id, input.steps);
      return ok({ id: input.id, version: touched.value, before: before.steps });
    },
    // Approver changes are audited with person ids (BR-PLN-j), never names.
    audit: (input, output) =>
      audit('approval_chain_changed', output.id, {
        before: stepsForAudit(output.before),
        after: stepsForAudit(input.steps),
      }),
  };
}

export interface RemindersSaved extends Saved {
  readonly before: readonly number[];
}

export function savePlanCycleRemindersActionDefinition(): ActionDefinition<
  typeof SaveRemindersInput,
  RemindersSaved,
  UserTx
> {
  return {
    permission: MANAGE,
    input: SaveRemindersInput,
    handler: async ({ ctx, input }) => {
      const before = await repo.getCycle(ctx.tx, input.id);
      if (!before) return err(appError('NOT_FOUND'));
      const touched = await touch(ctx.tx, input.id, input.version);
      if (!touched.ok) return touched;
      const version = await repo.updateReminders(ctx.tx, input.id, input.reminderDays);
      return ok({ id: input.id, version, before: before.reminderDays });
    },
    audit: (input, output) =>
      audit('reminders_changed', output.id, { before: output.before, after: input.reminderDays }),
  };
}

export interface Launched extends Saved {
  readonly deadline: string;
  readonly departmentCount: number;
  readonly steps: readonly ApprovalStep[];
  readonly closedCycleIds: readonly string[];
}

export function launchPlanCycleActionDefinition(): ActionDefinition<
  typeof CycleVersionRef,
  Launched,
  UserTx
> {
  return {
    permission: MANAGE,
    input: CycleVersionRef,
    handler: async ({ ctx, input }) => {
      const touched = await touch(ctx.tx, input.id, input.version);
      if (!touched.ok) return touched;
      const record = await repo.getCycle(ctx.tx, input.id);
      if (!record) return err(appError('NOT_FOUND'));
      // The structure may have changed since the scope was saved: one form per department in scope NOW.
      const structure = await listOrgStructure(ctx.tx);
      const departmentIds = departmentsInScope(units(structure), record.scope);
      await repo.syncDepartments(ctx.tx, input.id, departmentIds);
      // An open cycle past its deadline is closed first (Q1: one open cycle at a time).
      const closedCycleIds = await repo.closeDueCycles(ctx.tx);
      const today = await repo.organizationToday(ctx.tx);
      const named = record.steps.flatMap((s) => (s.approverPersonId ? [s.approverPersonId] : []));
      const members = await getMemberOptionsByIds(ctx.tx, named);
      const problems = launchProblems({
        status: record.status,
        deadline: record.deadline,
        today,
        needsFormId: record.needsFormId,
        departmentCount: departmentIds.length,
        steps: record.steps,
        activeMemberIds: new Set(members.filter((m) => m.active).map((m) => m.personId)),
        anotherOpen: (await repo.openCycle(ctx.tx, input.id)) !== null,
      });
      if (problems.includes('another_open'))
        return err(appError(PlanningErrors.PLAN_CYCLE_OPEN_EXISTS));
      if (problems.length > 0) {
        return err(
          appError(PlanningErrors.PLAN_CYCLE_NOT_READY, {
            params: { reasons: problems.join(',') },
          }),
        );
      }
      const launched = await repo.launch(ctx.tx, input.id);
      if (launched.outcome === 'another_open')
        return err(appError(PlanningErrors.PLAN_CYCLE_OPEN_EXISTS));
      if (launched.outcome === 'not_ready') {
        return err(
          appError(PlanningErrors.PLAN_CYCLE_NOT_READY, { params: { reasons: launched.reason } }),
        );
      }
      return ok({
        id: input.id,
        version: launched.version,
        deadline: record.deadline,
        departmentCount: departmentIds.length,
        steps: record.steps,
        closedCycleIds,
      });
    },
    audit: (_input, output) =>
      audit('launched', output.id, {
        deadline: output.deadline,
        departments: output.departmentCount,
        approvalChain: stepsForAudit(output.steps),
        ...(output.closedCycleIds.length > 0 ? { closedCycleIds: output.closedCycleIds } : {}),
      }),
  };
}

export interface DeadlineExtended extends Saved {
  readonly before: string;
  readonly after: string;
}

export function extendPlanCycleDeadlineActionDefinition(): ActionDefinition<
  typeof ExtendDeadlineInput,
  DeadlineExtended,
  UserTx
> {
  return {
    permission: MANAGE,
    input: ExtendDeadlineInput,
    handler: async ({ ctx, input }) => {
      const record = await repo.getCycle(ctx.tx, input.id);
      if (!record) return err(appError('NOT_FOUND'));
      const today = await repo.organizationToday(ctx.tx);
      if (!canExtendDeadline(record.status)) {
        return err(appError(PlanningErrors.PLAN_CYCLE_DEADLINE_REFUSED));
      }
      if (input.deadline <= record.deadline)
        return validation([{ path: 'deadline', code: 'NOT_LATER' }]);
      // Also after the deadline has passed (C-7): the new one is today or later, so the cycle is open again.
      if (input.deadline < today) return validation([{ path: 'deadline', code: 'IN_PAST' }]);
      if (input.deadline > record.periodEnd)
        return validation([{ path: 'deadline', code: 'AFTER_PERIOD' }]);
      const touched = await touch(ctx.tx, input.id, input.version, false);
      if (!touched.ok) return touched;
      const extended = await repo.extendDeadline(ctx.tx, input.id, input.deadline);
      if (extended.outcome === 'refused')
        return err(appError(PlanningErrors.PLAN_CYCLE_DEADLINE_REFUSED));
      return ok({
        id: input.id,
        version: extended.version,
        before: record.deadline,
        after: input.deadline,
      });
    },
    audit: (_input, output) =>
      audit('deadline_extended', output.id, { before: output.before, after: output.after }),
  };
}

export interface Deleted {
  readonly id: string;
  readonly name: { readonly ar: string; readonly en: string };
}

export function deletePlanCycleActionDefinition(): ActionDefinition<
  typeof CycleVersionRef,
  Deleted,
  UserTx
> {
  return {
    permission: MANAGE,
    input: CycleVersionRef,
    handler: async ({ ctx, input }) => {
      const record = await repo.getCycle(ctx.tx, input.id);
      if (!record) return err(appError('NOT_FOUND'));
      const touched = await touch(ctx.tx, input.id, input.version);
      if (!touched.ok) return touched;
      if (!(await repo.deleteDraft(ctx.tx, input.id)))
        return err(appError(PlanningErrors.PLAN_CYCLE_NOT_DRAFT));
      return ok({ id: input.id, name: { ar: record.nameAr, en: record.nameEn } });
    },
    audit: (_input, output) => audit('deleted', output.id, { before: { name: output.name } }),
  };
}

export interface SettingsSaved {
  readonly version: number;
  readonly before: {
    readonly reminderDays: readonly number[];
    readonly steps: readonly ApprovalStep[];
  };
}

export function savePlanningSettingsActionDefinition(): ActionDefinition<
  typeof SaveSettingsInput,
  SettingsSaved,
  UserTx
> {
  return {
    permission: MANAGE,
    input: SaveSettingsInput,
    handler: async ({ ctx, input }) => {
      const issues = chainIssues(input.steps, false);
      if (issues.length > 0) return validation(toFieldErrors(issues));
      const notMembers = await approverProblems(ctx.tx, input.steps);
      if (notMembers.length > 0) return validation(notMembers);
      const before = await repo.getSettings(ctx.tx);
      const version = await repo.saveSettings(ctx.tx, input.reminderDays, input.steps);
      return ok({ version, before: { reminderDays: before.reminderDays, steps: before.steps } });
    },
    audit: (input, output) => ({
      action: 'tms.planning_settings.changed',
      entityType: 'planning_settings',
      data: {
        before: {
          reminderDays: output.before.reminderDays,
          steps: stepsForAudit(output.before.steps),
        },
        after: { reminderDays: input.reminderDays, steps: stepsForAudit(input.steps) },
      },
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Approver search (C-M3)
// ---------------------------------------------------------------------------------------------------

export const ApproverSearchInput = z.strictObject({
  q: z.string().trim().min(MEMBER_SEARCH.minLength).max(MEMBER_SEARCH.maxLength),
});

export interface ApproverSearchResult {
  readonly members: readonly { readonly personId: string; readonly name: PersonName }[];
}

/**
 * The person picker of the approval chain (cycle step 4, planning settings): active members whose name
 * contains the text, at most MEMBER_SEARCH.limit (code review C-M3: a capped list of every member left
 * people of a large organization out). A read for those who set chains up (tms.plan_cycle.manage); names
 * only. Not audited (nothing changes).
 */
export function searchPlanApproversActionDefinition(): ActionDefinition<
  typeof ApproverSearchInput,
  ApproverSearchResult,
  UserTx
> {
  return {
    permission: MANAGE,
    input: ApproverSearchInput,
    handler: async ({ ctx, input }) =>
      ok({
        members: (await searchMemberOptions(ctx.tx, input.q)).map((m) => ({
          personId: m.personId,
          name: { ar: m.nameAr, en: m.nameEn },
        })),
      }),
  };
}
