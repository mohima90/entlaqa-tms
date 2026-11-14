import {
  type AppError,
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
  getOrganizationProfile,
  getTenantDefaultLocale,
  listOrgStructure,
  listStructureLevelLabels,
} from '@jadarat/platform-db';
import {
  type ActionDefinition,
  type AuditRecord,
  type QueryDefinition,
  tmsPlanningPermissions,
} from '@jadarat/platform-rbac';
import {
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
  type ScopeSelection,
  type StructureUnit,
  UpdateCycleBasicsInput,
  UpdateCycleInput,
  basicsIssues,
  nameIssues,
  canExtendDeadline,
  canonicalAmount,
  defaultDeadline,
  defaultPeriod,
  departmentDeadline,
  departmentsInScope,
  effectiveCycleStatus,
  effectiveHead,
  formStatus,
  launchProblems,
  structureName,
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
 *   write  tms.plan_cycle.manage  (L&D Manager) — create, cycle settings, launch, extend, delete, settings
 *
 * The approval chain left the cycle (EP-PLN §13 e; PO, 12 Nov 2026 — WP-UX-01 a, T-M3-20): no view carries
 * it, no action edits it and the launch does not ask for it. Stored chains stay in the database.
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

/**
 * A cycle's name: the organization's default language's name is there, the other one
 * may be missing (never both; WP-FIX-03, PO 12 Nov 2026). Readers show the other language when one is missing.
 */
export interface CycleName {
  readonly ar: string | null;
  readonly en: string | null;
}

export interface CycleListItem {
  readonly id: string;
  readonly name: CycleName;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly deadline: string;
  /** As shown: an open cycle past its deadline is Closed. */
  readonly status: CycleStatus;
  readonly departmentCount: number;
  readonly submittedCount: number;
  /**
   * A draft the member may change (WP-UX-01 a, T-M3-20): what «Edit» (the popup, pre-filled), «Launch cycle»
   * and «Delete draft» of its row need. Null for launched cycles and for members who only read.
   */
  readonly draft: CycleDraft | null;
}

export interface CycleDraft {
  readonly version: number;
  readonly needsFormId: string | null;
  /** The cycle's own form when it was switched off since (it is not among `setup.needsForms`; C-6). */
  readonly needsFormOff: NeedsFormOption | null;
  readonly scope: ScopeSelection;
  /** What stops the launch today, with the departments the scope covers NOW (as the launch counts them). */
  readonly problems: readonly LaunchProblem[];
}

/** Who receives a unit's needs form: its own head, or the nearest head above (`via`: that unit's name). */
export interface UnitHead {
  readonly name: PersonName;
  readonly via: LocalizedName | null;
}

/**
 * What the «New cycle» / «Edit» popup offers (the L&D Manager only): the suggested period and deadline, the
 * structure with each unit's head, the branches and the active needs forms.
 */
export interface CycleSetupOptions {
  readonly defaults: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly deadline: string;
  };
  /**
   * The language whose name is required (the organization's default language; WP-FIX-03, PO 12 Nov 2026):
   * the forms ask for it first and mark the other language optional.
   */
  readonly nameLanguage: 'ar' | 'en';
  readonly units: readonly ScopeUnitOption[];
  readonly branches: readonly BranchOption[];
  /** The organization's own level names (FR-ADM-05). */
  readonly levels: readonly StructureLevelLabel[];
  readonly needsForms: readonly NeedsFormOption[];
}

export interface BranchOption {
  readonly id: string;
  readonly name: LocalizedName;
  readonly active: boolean;
}

export interface CyclesListView {
  readonly today: string;
  readonly cycles: readonly CycleListItem[];
  readonly counts: Readonly<Record<'all' | 'draft' | 'open' | 'closed', number>>;
  readonly canManage: boolean;
  /** For members who manage cycles: what the popup offers. Null for readers. */
  readonly setup: CycleSetupOptions | null;
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
  readonly head: UnitHead | null;
}

/** One unit of the structure for the departments picker (depth for indentation; tree order). */
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
  /** Who receives the unit's form (own head or nearest above); null: nobody. */
  readonly head: UnitHead | null;
}

export interface CycleView {
  readonly today: string;
  readonly cycle: Omit<repo.CycleRecord, 'departments' | 'launchedBy'>;
  readonly status: CycleStatus;
  readonly canManage: boolean;
  /** A draft and the member manages cycles: its settings are editable. */
  readonly editable: boolean;
  readonly canExtend: boolean;
  /**
   * The language whose name is required (the organization's default language; WP-FIX-03, PO 12 Nov 2026):
   * the forms ask for it first and mark the other language optional.
   */
  readonly nameLanguage: 'ar' | 'en';
  readonly departments: readonly CycleDepartmentView[];
  /** The organization's own level names (FR-ADM-05): the pages say them instead of «Department». */
  readonly levels: readonly StructureLevelLabel[];
  readonly problems: readonly LaunchProblem[];
  /** Departments in scope whose form reaches nobody (no head up the tree) — a warning, not a block. */
  readonly withoutHead: number;
  /** Editable drafts only: the structure for the departments picker and the needs forms to choose from. */
  readonly setup: {
    readonly units: readonly ScopeUnitOption[];
    readonly branches: readonly BranchOption[];
    /** The active needs forms, plus the cycle's own form if it was switched off since (C-6). */
    readonly needsForms: readonly NeedsFormOption[];
  } | null;
}

export interface SettingsView {
  /** The default reminders every new cycle starts from. */
  readonly reminderDays: readonly number[];
  readonly canManage: boolean;
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
    nameAr: structureName(d).ar,
    headPersonId: d.head?.personId ?? null,
  }));
}

/** Who receives a unit's form: its own head, else the nearest head above (EP-ORG); null: nobody. */
function unitHead(
  structure: OrgStructure,
  tree: readonly StructureUnit[],
  departmentId: string,
): UnitHead | null {
  const head = effectiveHead(tree, departmentId);
  const headUnit = head
    ? structure.departments.find((d) => d.id === head.fromDepartmentId)
    : undefined;
  const person = headUnit?.head;
  if (!head || !headUnit || !person) return null;
  return {
    name: { ar: person.nameAr, en: person.nameEn },
    via: head.fromDepartmentId === departmentId ? null : structureName(headUnit),
  };
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
            name: structureName(d),
            levelOrdinal: d.levelOrdinal,
            depth,
            active: d.active,
            hasHead: effectiveHead(all, id) !== null,
            head: unitHead(structure, all, id),
          },
        ]
      : [];
  });
}

const branchOptions = (structure: OrgStructure): BranchOption[] =>
  structure.branches.map((b) => ({
    id: b.id,
    name: structureName(b),
    active: b.active,
  }));

/** Ids of a scope that are not in the structure (any more), as field errors by path. */
function unknownScopeIds(
  structure: OrgStructure,
  scope: ScopeSelection,
): { path: string; code: string }[] {
  const knownDepartments = new Set(structure.departments.map((d) => d.id));
  const knownBranches = new Set(structure.branches.map((b) => b.id));
  return [
    ...scope.departmentIds.flatMap((id, i) =>
      knownDepartments.has(id) ? [] : [{ path: `departmentIds.${String(i)}`, code: 'UNKNOWN' }],
    ),
    ...scope.branchIds.flatMap((id, i) =>
      knownBranches.has(id) ? [] : [{ path: `branchIds.${String(i)}`, code: 'UNKNOWN' }],
    ),
  ];
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

/**
 * Does another open cycle stand in the way of a launch today? Until its latest deadline — its own or any
 * department's extension — has passed; after that the launch closes it first (`repo.closeDueCycles`). The
 * pages ask the same question as the launch, so they never offer a launch the server then refuses.
 */
const blocksLaunch = (open: { readonly latestDeadline: string } | null, today: string) =>
  open !== null && open.latestDeadline >= today;

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
      const canManage = ctx.can(MANAGE, 'tenant');
      // Members who manage cycles: the popup's choices, and each draft's own data for its row menu.
      const structure = canManage ? await listOrgStructure(ctx.tx) : null;
      const tree = structure ? units(structure) : [];
      const activeForms = canManage ? await listNeedsFormOptions(ctx.tx) : [];
      const drafts = new Map<string, CycleDraft>();
      if (canManage) {
        // Asked once for the list, with the rule the launch applies: an open cycle blocks until its
        // latest deadline (a department's extension included) has passed. A draft is never the open one.
        const anotherOpen = rows.some(
          (r) => r.status === 'open' && blocksLaunch({ latestDeadline: r.latestDeadline }, today),
        );
        const details = await repo.listDraftDetails(ctx.tx);
        // A draft's own form that was switched off since: looked up once per form, not per draft.
        const offForms = new Map<string, NeedsFormOption | null>();
        for (const draft of details) {
          const formId = draft.needsFormId;
          if (formId === null || offForms.has(formId)) continue;
          if (activeForms.some((f) => f.id === formId)) continue;
          const found = (await listNeedsFormOptions(ctx.tx, formId)).find((f) => f.id === formId);
          offForms.set(formId, found ?? null);
        }
        const deadlines = new Map(rows.map((r) => [r.id, r.deadline]));
        for (const draft of details) {
          drafts.set(draft.id, {
            version: draft.version,
            needsFormId: draft.needsFormId,
            needsFormOff:
              draft.needsFormId === null ? null : (offForms.get(draft.needsFormId) ?? null),
            scope: draft.scope,
            problems: launchProblems({
              status: 'draft',
              deadline: deadlines.get(draft.id) ?? today,
              today,
              needsFormId: draft.needsFormId,
              // One form per department in scope NOW, as the launch counts them.
              departmentCount: departmentsInScope(tree, draft.scope).length,
              anotherOpen,
            }),
          });
        }
      }
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
        draft: drafts.get(r.id) ?? null,
      }));
      const count = (status: CycleStatus) => cycles.filter((c) => c.status === status).length;
      let setup: CycleSetupOptions | null = null;
      if (structure) {
        const profile = await getOrganizationProfile(ctx.tx);
        const period = defaultPeriod(today, profile?.fiscalYearStartMonth ?? 1);
        setup = {
          defaults: {
            periodStart: period.start,
            periodEnd: period.end,
            deadline: defaultDeadline(today, period.end),
          },
          nameLanguage: await getTenantDefaultLocale(ctx.tx),
          units: scopeUnitOptions(structure),
          branches: branchOptions(structure),
          levels: await listStructureLevelLabels(ctx.tx),
          needsForms: activeForms,
        };
      }
      return ok({
        today,
        cycles,
        counts: {
          all: cycles.length,
          draft: count('draft'),
          open: count('open'),
          // Everything that is neither a draft nor open (closed, consolidated, archived).
          closed: cycles.length - count('draft') - count('open'),
        },
        canManage,
        setup,
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
        const figures = progress.get(row.departmentId);
        const deadline = departmentDeadline(record.deadline, row.deadline);
        return {
          departmentId: row.departmentId,
          name: department ? structureName(department) : { ar: '—', en: '—' },
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
          head: unitHead(structure, tree, row.departmentId),
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
              anotherOpen: blocksLaunch(open, today),
            })
          : [];
      const { departments: _d, launchedBy: _l, ...cycle } = record;
      return ok({
        today,
        cycle,
        status: effectiveCycleStatus(record.status, record.latestDeadline, today),
        canManage,
        editable,
        canExtend: canManage && canExtendDeadline(record.status),
        nameLanguage: await getTenantDefaultLocale(ctx.tx),
        departments,
        levels: await listStructureLevelLabels(ctx.tx),
        problems,
        withoutHead: departments.filter((d) => d.head === null).length,
        setup: editable
          ? {
              units: scopeUnitOptions(structure),
              branches: branchOptions(structure),
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
      return ok({ reminderDays: settings.reminderDays, canManage: ctx.can(MANAGE, 'tenant') });
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

/**
 * A new draft: the needs form it stores (the organization's default when none was chosen) and how many
 * departments its scope covers.
 */
export interface CycleCreated extends Saved {
  readonly needsFormId: string | null;
  readonly departmentCount: number;
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
      // The popup creates the cycle with its departments (WP-UX-01 a, T-M3-20): the scope is checked as
      // the scope action checks it, and saved in the same transaction.
      const structure = await listOrgStructure(ctx.tx);
      const { departmentIds: pickedDepartments, branchIds, ...basics } = input;
      const scope = { departmentIds: pickedDepartments, branchIds };
      const issues = [
        // The name in the organization's default language is required (PO, 12 Nov 2026).
        ...toFieldErrors(nameIssues(await getTenantDefaultLocale(ctx.tx), input)),
        ...toFieldErrors(basicsIssues(input)),
        ...(await needsFormProblems(ctx.tx, input.needsFormId)),
        ...unknownScopeIds(structure, scope),
      ];
      if (issues.length > 0) return validation(issues);
      const created = await repo.insertCycle(ctx.tx, basics);
      const departmentIds = departmentsInScope(units(structure), scope);
      if (scope.departmentIds.length > 0 || scope.branchIds.length > 0) {
        await repo.replaceScope(ctx.tx, created.id, scope, departmentIds);
      }
      return ok({ ...created, departmentCount: departmentIds.length });
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
          // The scope picked in the popup, as «scope_changed» records it.
          departmentIds: input.departmentIds,
          branchIds: input.branchIds,
          departments: output.departmentCount,
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
        ...toFieldErrors(nameIssues(await getTenantDefaultLocale(ctx.tx), input)),
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

export interface CycleSaved extends Saved {
  /** What changed: basics keys, and `scope` when the departments or branches did. Empty: nothing. */
  readonly changed: readonly string[];
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
  readonly departmentCount: number;
}

const EDIT_KEYS = [
  'needsFormId',
  'nameAr',
  'nameEn',
  'periodStart',
  'periodEnd',
  'deadline',
] as const;

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * «Edit» of a draft in the popup (WP-UX-01 a, T-M3-20): the names, period, deadline, needs form AND the
 * departments in ONE transaction — one version of the cycle, one audit record. Either everything is saved
 * or nothing is: a refused part never leaves the other part saved behind a popup that is then cancelled.
 * Same permission and the same checks as the basics and the scope actions; the instructions stay as stored.
 */
export function updatePlanCycleActionDefinition(): ActionDefinition<
  typeof UpdateCycleInput,
  CycleSaved,
  UserTx
> {
  return {
    permission: MANAGE,
    input: UpdateCycleInput,
    handler: async ({ ctx, input }) => {
      const before = await repo.getCycle(ctx.tx, input.id);
      if (!before) return err(appError('NOT_FOUND'));
      const structure = await listOrgStructure(ctx.tx);
      const scope = { departmentIds: input.departmentIds, branchIds: input.branchIds };
      const issues = [
        ...toFieldErrors(nameIssues(await getTenantDefaultLocale(ctx.tx), input)),
        ...toFieldErrors(basicsIssues(input)),
        ...(await needsFormProblems(ctx.tx, input.needsFormId, before.needsFormId)),
        ...unknownScopeIds(structure, scope),
      ];
      if (issues.length > 0) return validation(issues);
      const touched = await touch(ctx.tx, input.id, input.version);
      if (!touched.ok) return touched;
      const basics = {
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        deadline: input.deadline,
        needsFormId: input.needsFormId,
        // Edited on the Settings page: they go back as they are stored.
        instructionsAr: before.instructionsAr,
        instructionsEn: before.instructionsEn,
      };
      const version = await repo.updateBasics(ctx.tx, input.id, basics);
      const departmentIds = departmentsInScope(units(structure), scope);
      const scopeChanged =
        !sameIds(before.scope.departmentIds, scope.departmentIds) ||
        !sameIds(before.scope.branchIds, scope.branchIds);
      // Also when only the structure changed underneath: one form per department in scope NOW.
      await repo.replaceScope(ctx.tx, input.id, scope, departmentIds);
      const changedKeys = EDIT_KEYS.filter((key) => before[key] !== basics[key]);
      const shown = (source: Pick<repo.CycleRecord, (typeof EDIT_KEYS)[number]>) =>
        Object.fromEntries(changedKeys.map((key) => [key, source[key]]));
      return ok({
        id: input.id,
        version,
        changed: [...changedKeys, ...(scopeChanged ? ['scope'] : [])],
        before: { ...shown(before), ...(scopeChanged ? { scope: before.scope } : {}) },
        after: { ...shown(basics), ...(scopeChanged ? { scope } : {}) },
        departmentCount: departmentIds.length,
      });
    },
    audit: (_input, output) =>
      output.changed.length === 0
        ? null
        : audit('changed', output.id, {
            changed: output.changed,
            before: output.before,
            after: output.after,
            departments: output.departmentCount,
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
      const unknown = unknownScopeIds(structure, input);
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
      // No approval chain is asked for (EP-PLN §13 e): one stored by an earlier cycle is ignored.
      const problems = launchProblems({
        status: record.status,
        deadline: record.deadline,
        today,
        needsFormId: record.needsFormId,
        departmentCount: departmentIds.length,
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
        closedCycleIds,
      });
    },
    audit: (_input, output) =>
      audit('launched', output.id, {
        deadline: output.deadline,
        departments: output.departmentCount,
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
  readonly name: CycleName;
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
  readonly before: { readonly reminderDays: readonly number[] };
}

/**
 * Planning settings: the default reminders. The default approval chain is no longer set here (EP-PLN §13;
 * PO, 12 Nov 2026): approval is by role and the same for every cycle. A stored default chain stays.
 */
export function savePlanningSettingsActionDefinition(): ActionDefinition<
  typeof SaveSettingsInput,
  SettingsSaved,
  UserTx
> {
  return {
    permission: MANAGE,
    input: SaveSettingsInput,
    handler: async ({ ctx, input }) => {
      const before = await repo.getSettings(ctx.tx);
      const version = await repo.saveSettings(ctx.tx, input.reminderDays);
      return ok({ version, before: { reminderDays: before.reminderDays } });
    },
    audit: (input, output) => ({
      action: 'tms.planning_settings.changed',
      entityType: 'planning_settings',
      data: {
        before: { reminderDays: output.before.reminderDays },
        after: { reminderDays: input.reminderDays },
      },
    }),
  };
}
