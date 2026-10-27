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
  type MemberOption,
  type OrgDepartment,
  type OrgStructure,
  type StructureLevelLabel,
  type UserTx,
  getMemberOptionsByIds,
  listDepartmentTeam,
  listOrgStructure,
  listStructureLevelLabels,
} from '@jadarat/platform-db';
import {
  type ActionContext,
  type ActionDefinition,
  type AuditRecord,
  type QueryDefinition,
  coursePermissions,
  scopeCovers,
  tmsPlanningPermissions,
  tmsRolePermissions,
} from '@jadarat/platform-rbac';
import { getCourse, listCourses } from '../courses/db';
import { getNeedsForm } from '../db/needs-forms';
import {
  type NeedsFormField,
  type NeedsFormSection,
  systemFieldsOf,
  validateEntry,
  validateNeedsAnswers,
} from '../needs-forms';
import type { LocalizedName, PersonName } from './definitions';
import {
  AddNeedInput,
  DepartmentRef,
  DepartmentVersionRef,
  type EnvelopeState,
  ExtendDepartmentDeadlineInput,
  type FormStatus,
  MyNeedsInput,
  NEEDS_LIMITS,
  NeedRef,
  type NeedsTotals,
  ReturnNeedsInput,
  SaveDepartmentAnswersInput,
  type StructureUnit,
  UpdateNeedInput,
  daysUntil,
  departmentDeadline,
  effectiveCycleStatus,
  effectiveHead,
  entryOpen,
  envelopeState,
  formStatus,
  needsTotals,
} from './model';
import * as repo from './repository';

/**
 * Department needs: the Department Head enters, submits and recalls the training needs of the departments
 * they head; the L&D Manager follows, returns for changes and extends one department (WP-LD-01, T-M3-05;
 * FR-PLN-03, FR-MGR-05, FR-PLN-06; business flow EP-PLN §3 C6–C9 as amended by the PO's decisions of
 * 27 Oct 2026: seats are the unit (Q1), the envelope is shown and never blocks (Q2), a late department stays
 * with L&D (Q3)). Bound to defineAction in `actions/needs.ts` and to defineQuery in the app; unit-tested
 * with a fake runtime. The database repeats every rule (migration 20261105100100).
 *
 *   head     tms.plan_needs.submit  (Department Head, scope: the departments they head) — AND the member
 *            must be the department's effective head (own head, else the nearest head above; the grant
 *            also covers sub-units with their own heads, which belong to those heads)
 *   manager  tms.plan_cycle.read    — the department's needs, read-only
 *            tms.plan_cycle.manage  — return for changes, extend one department
 */

const SUBMIT = tmsRolePermissions['tms.plan_needs.submit'];
const READ = tmsPlanningPermissions['tms.plan_cycle.read'];
const MANAGE = tmsPlanningPermissions['tms.plan_cycle.manage'];
const COURSE_READ = coursePermissions['tms.course.read'];

/** Module error codes (ADR 0011 §3); messages under `errors.*` in the catalogs. */
export const NeedsErrors = defineErrorCodes({
  /** Entry is closed: the cycle is not open or the department's deadline has passed (Q3). */
  PLAN_NEEDS_CLOSED: { status: 422, messageKey: 'errors.planNeedsClosed' },
  /** The department's needs are submitted: recall first. */
  PLAN_NEEDS_SUBMITTED: { status: 409, messageKey: 'errors.planNeedsSubmitted' },
  /** Nothing to submit yet. */
  PLAN_NEEDS_EMPTY: { status: 422, messageKey: 'errors.planNeedsEmpty' },
  /** 200 needs per department, 500 names per need. */
  PLAN_NEEDS_LIMIT: { status: 422, messageKey: 'errors.planNeedsLimit' },
  /** Return or recall of a department that is not submitted. */
  PLAN_NEEDS_NOT_SUBMITTED: { status: 409, messageKey: 'errors.planNeedsNotSubmitted' },
});

type Ctx = ActionContext<UserTx>;

// ---------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------

export interface NeedView {
  readonly id: string;
  readonly version: number;
  readonly topic: string;
  readonly courseId: string | null;
  /** Seats (Q1). */
  readonly peopleCount: number;
  /** Named candidates (never more than the seats). */
  readonly people: readonly { readonly personId: string; readonly name: PersonName }[];
  readonly estimatedCost: string | null;
  /** The needs section's other answers `{ fieldId: answer }` («More»). */
  readonly answers: Readonly<Record<string, unknown>>;
  readonly updatedAt: string;
}

export interface CourseOption {
  readonly id: string;
  readonly title: { readonly ar: string; readonly en: string };
}

export interface DepartmentNeedsView {
  readonly today: string;
  readonly role: 'head' | 'manager';
  readonly cycle: {
    readonly id: string;
    readonly name: { readonly ar: string; readonly en: string };
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly deadline: string;
    readonly instructions: { readonly ar: string | null; readonly en: string | null };
    readonly currency: string;
    /** As shown (Closed once every deadline has passed). */
    readonly status: 'open' | 'closed' | 'consolidated' | 'archived';
  };
  readonly department: {
    readonly id: string;
    readonly name: LocalizedName;
    readonly levelOrdinal: number | null;
    /** The effective head (own or from above), or null. */
    readonly head: PersonName | null;
    readonly version: number;
  };
  /** The department's effective deadline (the cycle's, or its own extension when later). */
  readonly deadline: string;
  /** Days until the effective deadline (negative once passed). */
  readonly daysLeft: number;
  /** The head may still enter and change needs. */
  readonly entryOpen: boolean;
  readonly status: FormStatus;
  readonly budgetAmount: string | null;
  readonly totals: NeedsTotals;
  readonly envelope: EnvelopeState;
  readonly needs: readonly NeedView[];
  readonly submittedAt: string | null;
  readonly submittedBy: PersonName | null;
  readonly returnedAt: string | null;
  readonly returnNote: string | null;
  /** The cycle's needs form: the fields under «More» and the sections answered once per department. */
  readonly form: {
    readonly id: string;
    readonly needsSectionId: string;
    readonly moreFields: readonly NeedsFormField[];
    readonly otherSections: readonly NeedsFormSection[];
  } | null;
  /** Department-level answers `{ sectionId: [{ fieldId: answer }] }`. */
  readonly answers: Readonly<Record<string, unknown>>;
  readonly can: {
    readonly edit: boolean;
    readonly submit: boolean;
    readonly recall: boolean;
    readonly return: boolean;
    readonly extend: boolean;
  };
  /** The head's team to name people from (empty for the manager, or once entry is closed). */
  readonly team: readonly MemberOption[];
  /** The library's active courses to pick a topic from (empty when not offered). */
  readonly courses: readonly CourseOption[];
  readonly levels: readonly StructureLevelLabel[];
}

export interface MyNeedsTask {
  readonly cycleId: string;
  readonly cycleName: { readonly ar: string; readonly en: string };
  readonly departmentId: string;
  readonly departmentName: LocalizedName;
  readonly levelOrdinal: number | null;
  readonly status: FormStatus;
  readonly deadline: string;
  readonly daysLeft: number;
  readonly entryOpen: boolean;
  readonly needsCount: number;
  readonly seats: number;
  readonly cost: string | null;
  readonly budgetAmount: string | null;
  readonly currency: string;
  readonly returnNote: string | null;
}

export interface MyNeedsView {
  readonly today: string;
  /** The departments whose needs the member enters in the open cycle, by deadline. */
  readonly tasks: readonly MyNeedsTask[];
  readonly levels: readonly StructureLevelLabel[];
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

/** The ids of the units above a department, nearest first. */
function ancestorsOf(tree: readonly StructureUnit[], departmentId: string): string[] {
  const byId = new Map(tree.map((u) => [u.id, u]));
  const result: string[] = [];
  let current = byId.get(departmentId);
  for (let depth = 0; current?.parentId && depth <= 20; depth += 1) {
    result.push(current.parentId);
    current = byId.get(current.parentId);
  }
  return result;
}

interface DepartmentAccess {
  readonly structure: OrgStructure;
  readonly department: OrgDepartment;
  readonly head: { readonly personId: string; readonly fromDepartmentId: string } | null;
}

/**
 * The department as the signed-in HEAD may act on it: it exists, its effective head is the member (own head,
 * else the nearest head above) and a grant covers it. Anything else is 404 — deny by default, and no hint
 * whether the department exists.
 */
async function headAccess(
  ctx: Ctx,
  departmentId: string,
): Promise<Result<DepartmentAccess, AppError>> {
  const structure = await listOrgStructure(ctx.tx);
  const department = structure.departments.find((d) => d.id === departmentId);
  if (!department) return err(appError('NOT_FOUND'));
  const tree = units(structure);
  const head = effectiveHead(tree, departmentId);
  const personId = ctx.actor.personId;
  const covered = ctx.grants.some((grant) =>
    scopeCovers(grant.scope, personId, {
      type: 'department',
      id: departmentId,
      tenantId: ctx.actor.tenantId,
      orgUnitId: departmentId,
      orgUnitAncestorIds: ancestorsOf(tree, departmentId),
    }),
  );
  if (personId === null || head?.personId !== personId || !covered) {
    return err(appError('NOT_FOUND'));
  }
  return ok({ structure, department, head });
}

/** The department as the cycle MANAGER sees it (the whole organization's structure is theirs to read). */
async function managerAccess(
  ctx: Ctx,
  departmentId: string,
): Promise<Result<DepartmentAccess, AppError>> {
  const structure = await listOrgStructure(ctx.tx);
  const department = structure.departments.find((d) => d.id === departmentId);
  if (!department) return err(appError('NOT_FOUND'));
  return ok({ structure, department, head: effectiveHead(units(structure), departmentId) });
}

interface DepartmentState {
  readonly cycle: repo.CycleRecord;
  readonly department: repo.DepartmentRecord;
  readonly today: string;
  readonly deadline: string;
  readonly open: boolean;
}

/** The cycle and the department row; a draft cycle has no needs entry yet (404). */
async function departmentState(
  ctx: Ctx,
  ref: { readonly cycleId: string; readonly departmentId: string },
): Promise<Result<DepartmentState, AppError>> {
  const cycle = await repo.getCycle(ctx.tx, ref.cycleId);
  if (!cycle || cycle.status === 'draft') return err(appError('NOT_FOUND'));
  const department = await repo.getDepartment(ctx.tx, ref.cycleId, ref.departmentId);
  if (!department) return err(appError('NOT_FOUND'));
  const today = await repo.organizationToday(ctx.tx);
  const deadline = departmentDeadline(cycle.deadline, department.deadline);
  return ok({
    cycle,
    department,
    today,
    deadline,
    open: entryOpen(cycle.status, deadline, today),
  });
}

/** Entry must be open and the department not submitted for the head to change anything. */
function editable(state: DepartmentState): AppError | null {
  if (!state.open) return appError(NeedsErrors.PLAN_NEEDS_CLOSED);
  if (state.department.status === 'submitted') return appError(NeedsErrors.PLAN_NEEDS_SUBMITTED);
  return null;
}

interface FormParts {
  readonly id: string;
  readonly needsSection: NeedsFormSection | null;
  readonly moreFields: readonly NeedsFormField[];
  readonly otherSections: readonly NeedsFormSection[];
}

/** The cycle's form split into the needs section («More» fields) and the department-level sections. */
async function formParts(tx: UserTx, needsFormId: string | null): Promise<FormParts | null> {
  if (needsFormId === null) return null;
  const form = await getNeedsForm(tx, needsFormId);
  if (!form) return null;
  const topic = systemFieldsOf(form).topic;
  const needsSection = form.sections.find((s) => s.fields.some((f) => f.id === topic?.id)) ?? null;
  return {
    id: form.id,
    needsSection,
    moreFields: needsSection
      ? needsSection.fields.filter((f) => f.visible && f.systemKey === null)
      : [],
    otherSections: form.sections.filter((s) => s.visible && s.id !== needsSection?.id),
  };
}

const validation = (fieldErrors: readonly FieldError[]) =>
  err(appError('VALIDATION_FAILED', { fieldErrors }));

const personName = (member: MemberOption | undefined): PersonName | null =>
  member ? { ar: member.nameAr, en: member.nameEn } : null;

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

async function buildView(
  ctx: Ctx,
  role: 'head' | 'manager',
  access: DepartmentAccess,
  state: DepartmentState,
): Promise<DepartmentNeedsView> {
  const { cycle, department, today, deadline, open } = state;
  const needs = await repo.listNeeds(ctx.tx, cycle.id, department.departmentId);
  const personIds = [
    ...needs.flatMap((n) => n.personIds),
    ...(department.submittedBy ? [department.submittedBy] : []),
  ];
  const members = new Map(
    (await getMemberOptionsByIds(ctx.tx, personIds)).map((m) => [m.personId, m]),
  );
  const totals = needsTotals(
    needs.map((n) => ({
      peopleCount: n.peopleCount,
      namedCount: n.personIds.length,
      estimatedCost: n.estimatedCost,
    })),
  );
  const form = await formParts(ctx.tx, cycle.needsFormId);
  const canManage = role === 'manager' && ctx.can(MANAGE, 'tenant');
  const edit = role === 'head' && open && department.status !== 'submitted';
  const headUnit = access.head
    ? access.structure.departments.find((d) => d.id === access.head?.fromDepartmentId)
    : undefined;
  return {
    today,
    role,
    cycle: {
      id: cycle.id,
      name: { ar: cycle.nameAr, en: cycle.nameEn },
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      deadline: cycle.deadline,
      instructions: { ar: cycle.instructionsAr, en: cycle.instructionsEn },
      currency: cycle.currency,
      status:
        cycle.status === 'open'
          ? effectiveCycleStatus('open', cycle.latestDeadline, today) === 'open'
            ? 'open'
            : 'closed'
          : cycle.status === 'draft'
            ? 'closed'
            : cycle.status,
    },
    department: {
      id: department.departmentId,
      name: { ar: access.department.nameAr, en: access.department.nameEn },
      levelOrdinal: access.department.levelOrdinal,
      head: headUnit?.head ? { ar: headUnit.head.nameAr, en: headUnit.head.nameEn } : null,
      version: department.version,
    },
    deadline,
    daysLeft: daysUntil(today, deadline),
    entryOpen: open,
    status: formStatus(department.status, deadline, today),
    budgetAmount: department.budgetAmount,
    totals,
    envelope: envelopeState(totals.cost, department.budgetAmount),
    needs: needs.map((n) => ({
      id: n.id,
      version: n.version,
      topic: n.topic,
      courseId: n.courseId,
      peopleCount: n.peopleCount,
      people: n.personIds.map((personId) => ({
        personId,
        name: personName(members.get(personId)) ?? { ar: null, en: null },
      })),
      estimatedCost: n.estimatedCost,
      answers: n.answers,
      updatedAt: n.updatedAt.toISOString(),
    })),
    submittedAt: iso(department.submittedAt),
    submittedBy: department.submittedBy ? personName(members.get(department.submittedBy)) : null,
    returnedAt: iso(department.returnedAt),
    returnNote: department.returnNote,
    form: form?.needsSection
      ? {
          id: form.id,
          needsSectionId: form.needsSection.id,
          moreFields: form.moreFields,
          otherSections: form.otherSections,
        }
      : null,
    answers: department.answers,
    can: {
      edit,
      submit: edit && needs.length > 0,
      recall: role === 'head' && open && department.status === 'submitted',
      return: canManage && cycle.status === 'open' && department.status === 'submitted',
      extend: canManage && cycle.status === 'open',
    },
    team: edit ? await listDepartmentTeam(ctx.tx, department.departmentId) : [],
    courses:
      edit && ctx.can(COURSE_READ, 'any')
        ? (await listCourses(ctx.tx, { status: 'active' }, { withCosts: false })).map((c) => ({
            id: c.id,
            title: { ar: c.titleAr, en: c.titleEn },
          }))
        : [],
    levels: await listStructureLevelLabels(ctx.tx),
  };
}

// ---------------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------------

/** The Home task card and the «My team's needs» list of a Department Head. */
export function myNeedsQueryDefinition(): QueryDefinition<
  typeof MyNeedsInput,
  MyNeedsView,
  UserTx
> {
  return {
    permission: SUBMIT,
    input: MyNeedsInput,
    scoped: true,
    handler: async ({ ctx }) => {
      const rows = await repo.listMyDepartments(ctx.tx);
      const today = await repo.organizationToday(ctx.tx);
      const structure = await listOrgStructure(ctx.tx);
      const tree = units(structure);
      const byId = new Map(structure.departments.map((d) => [d.id, d]));
      const personId = ctx.actor.personId;
      const tasks = rows.flatMap((row): MyNeedsTask[] => {
        const department = byId.get(row.departmentId);
        // The database already limited the rows to the effective head; the rule is repeated here.
        if (!department || effectiveHead(tree, row.departmentId)?.personId !== personId) return [];
        const deadline = departmentDeadline(row.cycleDeadline, row.deadline);
        return [
          {
            cycleId: row.cycleId,
            cycleName: { ar: row.cycleNameAr, en: row.cycleNameEn },
            departmentId: row.departmentId,
            departmentName: { ar: department.nameAr, en: department.nameEn },
            levelOrdinal: department.levelOrdinal,
            status: formStatus(row.status, deadline, today),
            deadline,
            daysLeft: daysUntil(today, deadline),
            entryOpen: entryOpen('open', deadline, today),
            needsCount: row.needsCount,
            seats: row.seats,
            cost: row.cost,
            budgetAmount: row.budgetAmount,
            currency: row.currency,
            returnNote: row.returnNote,
          },
        ];
      });
      return ok({ today, tasks, levels: await listStructureLevelLabels(ctx.tx) });
    },
  };
}

/** The needs page of a Department Head (design screens 2–4). */
export function departmentNeedsQueryDefinition(): QueryDefinition<
  typeof DepartmentRef,
  DepartmentNeedsView,
  UserTx
> {
  return {
    permission: SUBMIT,
    input: DepartmentRef,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const access = await headAccess(ctx, input.departmentId);
      if (!access.ok) return access;
      const state = await departmentState(ctx, input);
      if (!state.ok) return state;
      return ok(await buildView(ctx, 'head', access.value, state.value));
    },
  };
}

/** A department's needs as the L&D Manager or Training Coordinator sees them («View», screen 5). */
export function cycleDepartmentNeedsQueryDefinition(): QueryDefinition<
  typeof DepartmentRef,
  DepartmentNeedsView,
  UserTx
> {
  return {
    permission: READ,
    input: DepartmentRef,
    handler: async ({ ctx, input }) => {
      const access = await managerAccess(ctx, input.departmentId);
      if (!access.ok) return access;
      const state = await departmentState(ctx, input);
      if (!state.ok) return state;
      return ok(await buildView(ctx, 'manager', access.value, state.value));
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Actions — the head
// ---------------------------------------------------------------------------------------------------

const audit = (
  action: string,
  ref: { readonly cycleId: string; readonly departmentId: string },
  data: Record<string, unknown> = {},
): AuditRecord => ({
  action: `tms.plan_needs.${action}`,
  entityType: 'plan_cycle_department',
  entityId: ref.cycleId,
  data: { cycleId: ref.cycleId, departmentId: ref.departmentId, ...data },
});

export interface NeedSaved {
  readonly cycleId: string;
  readonly departmentId: string;
  readonly needId: string;
  readonly version: number;
  readonly peopleCount: number;
  readonly named: number;
  readonly estimatedCost: string | null;
  readonly courseId: string | null;
}

interface NeedDraft {
  readonly values: repo.NeedValues;
  readonly personIds: readonly string[];
}

/**
 * The need's rules (the form checks them first; the handler is the authority): named people from the team
 * and never more than the seats, a course of the library, the «More» answers as the cycle's form defines.
 */
async function checkNeed(
  ctx: Ctx,
  input: AddNeedInput,
  state: DepartmentState,
): Promise<Result<NeedDraft, AppError>> {
  const issues: FieldError[] = [];
  const team = new Set(
    (await listDepartmentTeam(ctx.tx, input.departmentId)).map((m) => m.personId),
  );
  const personIds = [...new Set(input.personIds.map((id) => id.toLowerCase()))];
  personIds.forEach((id, index) => {
    if (!team.has(id))
      issues.push({ path: `personIds.${String(index)}`, code: 'PERSON_NOT_ALLOWED' });
  });
  if (personIds.length > input.peopleCount) {
    issues.push({ path: 'peopleCount', code: 'FEWER_THAN_NAMED' });
  }
  if (input.courseId !== null) {
    const course = await getCourse(ctx.tx, input.courseId);
    if (course?.status !== 'active') issues.push({ path: 'courseId', code: 'UNKNOWN' });
  }
  const form = await formParts(ctx.tx, state.cycle.needsFormId);
  let answers: Record<string, unknown> = {};
  if (form?.needsSection) {
    const checked = validateEntry(
      { ...form.needsSection, fields: form.moreFields },
      input.answers,
      'answers',
      { allowedPersonIds: team },
    );
    issues.push(...checked.errors);
    answers = checked.value;
  } else if (Object.keys(input.answers).length > 0) {
    issues.push({ path: 'answers', code: 'UNKNOWN_FIELD' });
  }
  if (issues.length > 0) return validation(issues);
  return ok({
    values: {
      topic: input.topic,
      courseId: input.courseId,
      peopleCount: input.peopleCount,
      estimatedCost: input.estimatedCost,
      answers,
    },
    personIds,
  });
}

function needOutcomeError(outcome: Exclude<repo.NeedWriteOutcome['outcome'], 'ok'>): AppError {
  switch (outcome) {
    case 'not_found':
      return appError('NOT_FOUND');
    case 'conflict':
      return appError('CONFLICT_VERSION');
    case 'closed':
      return appError(NeedsErrors.PLAN_NEEDS_CLOSED);
    case 'submitted':
      return appError(NeedsErrors.PLAN_NEEDS_SUBMITTED);
    case 'limit':
      return appError(NeedsErrors.PLAN_NEEDS_LIMIT);
    case 'not_allowed':
      return appError('FORBIDDEN');
    case 'refused':
      return appError('PRECONDITION_FAILED');
  }
}

const needAudit = (saved: NeedSaved) => ({
  needId: saved.needId,
  peopleCount: saved.peopleCount,
  named: saved.named,
  estimatedCost: saved.estimatedCost,
  courseId: saved.courseId,
});

export function addNeedActionDefinition(): ActionDefinition<
  typeof AddNeedInput,
  NeedSaved,
  UserTx
> {
  return {
    permission: SUBMIT,
    input: AddNeedInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const access = await headAccess(ctx, input.departmentId);
      if (!access.ok) return access;
      const state = await departmentState(ctx, input);
      if (!state.ok) return state;
      const blocked = editable(state.value);
      if (blocked) return err(blocked);
      const existing = await repo.listNeeds(ctx.tx, input.cycleId, input.departmentId);
      if (existing.length >= NEEDS_LIMITS.maxNeeds)
        return err(appError(NeedsErrors.PLAN_NEEDS_LIMIT));
      const draft = await checkNeed(ctx, input, state.value);
      if (!draft.ok) return draft;
      const written = await repo.insertNeed(
        ctx.tx,
        input.cycleId,
        input.departmentId,
        draft.value.values,
        draft.value.personIds,
      );
      if (written.outcome !== 'ok') return err(needOutcomeError(written.outcome));
      return ok({
        cycleId: input.cycleId,
        departmentId: input.departmentId,
        needId: written.id,
        version: written.version,
        peopleCount: input.peopleCount,
        named: draft.value.personIds.length,
        estimatedCost: input.estimatedCost,
        courseId: input.courseId,
      });
    },
    audit: (_input, output) => audit('added', output, needAudit(output)),
  };
}

export function updateNeedActionDefinition(): ActionDefinition<
  typeof UpdateNeedInput,
  NeedSaved,
  UserTx
> {
  return {
    permission: SUBMIT,
    input: UpdateNeedInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const access = await headAccess(ctx, input.departmentId);
      if (!access.ok) return access;
      const state = await departmentState(ctx, input);
      if (!state.ok) return state;
      const blocked = editable(state.value);
      if (blocked) return err(blocked);
      const draft = await checkNeed(ctx, input, state.value);
      if (!draft.ok) return draft;
      const written = await repo.updateNeed(
        ctx.tx,
        input.needId,
        input.departmentId,
        input.version,
        draft.value.values,
        draft.value.personIds,
      );
      if (written.outcome !== 'ok') return err(needOutcomeError(written.outcome));
      return ok({
        cycleId: input.cycleId,
        departmentId: input.departmentId,
        needId: input.needId,
        version: written.version,
        peopleCount: input.peopleCount,
        named: draft.value.personIds.length,
        estimatedCost: input.estimatedCost,
        courseId: input.courseId,
      });
    },
    audit: (_input, output) => audit('changed', output, needAudit(output)),
  };
}

export interface NeedRemoved {
  readonly cycleId: string;
  readonly departmentId: string;
  readonly needId: string;
}

export function deleteNeedActionDefinition(): ActionDefinition<
  typeof NeedRef,
  NeedRemoved,
  UserTx
> {
  return {
    permission: SUBMIT,
    input: NeedRef,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const access = await headAccess(ctx, input.departmentId);
      if (!access.ok) return access;
      const state = await departmentState(ctx, input);
      if (!state.ok) return state;
      const blocked = editable(state.value);
      if (blocked) return err(blocked);
      const removed = await repo.deleteNeed(
        ctx.tx,
        input.needId,
        input.departmentId,
        input.version,
      );
      if (removed.outcome !== 'ok') return err(needOutcomeError(removed.outcome));
      return ok({ cycleId: input.cycleId, departmentId: input.departmentId, needId: input.needId });
    },
    audit: (_input, output) => audit('removed', output, { needId: output.needId }),
  };
}

export interface DepartmentChanged {
  readonly cycleId: string;
  readonly departmentId: string;
  readonly version: number;
}

export interface NeedsSubmitted extends DepartmentChanged {
  readonly totals: NeedsTotals;
  readonly envelope: EnvelopeState;
}

function departmentOutcomeError(
  outcome: Exclude<repo.DepartmentOutcome['outcome'], 'ok'>,
): AppError {
  switch (outcome) {
    case 'not_found':
      return appError('NOT_FOUND');
    case 'conflict':
      return appError('CONFLICT_VERSION');
    case 'closed':
      return appError(NeedsErrors.PLAN_NEEDS_CLOSED);
    case 'submitted':
      return appError(NeedsErrors.PLAN_NEEDS_SUBMITTED);
    case 'empty':
      return appError(NeedsErrors.PLAN_NEEDS_EMPTY);
    case 'refused':
      return appError('PRECONDITION_FAILED');
  }
}

/** «Submit» (business flow C7): locks the set; the summary is audited (BR-PLN-j). */
export function submitNeedsActionDefinition(): ActionDefinition<
  typeof DepartmentVersionRef,
  NeedsSubmitted,
  UserTx
> {
  return {
    permission: SUBMIT,
    input: DepartmentVersionRef,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const access = await headAccess(ctx, input.departmentId);
      if (!access.ok) return access;
      const state = await departmentState(ctx, input);
      if (!state.ok) return state;
      const blocked = editable(state.value);
      if (blocked) return err(blocked);
      const needs = await repo.listNeeds(ctx.tx, input.cycleId, input.departmentId);
      if (needs.length === 0) return err(appError(NeedsErrors.PLAN_NEEDS_EMPTY));
      const changed = await repo.setDepartmentStatus(
        ctx.tx,
        input.cycleId,
        input.departmentId,
        input.version,
        'submitted',
      );
      if (changed.outcome !== 'ok') return err(departmentOutcomeError(changed.outcome));
      const totals = needsTotals(
        needs.map((n) => ({
          peopleCount: n.peopleCount,
          namedCount: n.personIds.length,
          estimatedCost: n.estimatedCost,
        })),
      );
      return ok({
        cycleId: input.cycleId,
        departmentId: input.departmentId,
        version: changed.version,
        totals,
        envelope: envelopeState(totals.cost, state.value.department.budgetAmount),
      });
    },
    audit: (_input, output) =>
      audit('submitted', output, {
        needs: output.totals.needs,
        seats: output.totals.seats,
        named: output.totals.named,
        cost: output.totals.cost,
        envelope: output.envelope.kind,
      }),
  };
}

/** «Recall» (business flow C8): back to a draft, until the deadline. */
export function recallNeedsActionDefinition(): ActionDefinition<
  typeof DepartmentVersionRef,
  DepartmentChanged,
  UserTx
> {
  return {
    permission: SUBMIT,
    input: DepartmentVersionRef,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const access = await headAccess(ctx, input.departmentId);
      if (!access.ok) return access;
      const state = await departmentState(ctx, input);
      if (!state.ok) return state;
      if (!state.value.open) return err(appError(NeedsErrors.PLAN_NEEDS_CLOSED));
      if (state.value.department.status !== 'submitted')
        return err(appError(NeedsErrors.PLAN_NEEDS_NOT_SUBMITTED));
      const changed = await repo.setDepartmentStatus(
        ctx.tx,
        input.cycleId,
        input.departmentId,
        input.version,
        'draft',
      );
      if (changed.outcome !== 'ok') return err(departmentOutcomeError(changed.outcome));
      return ok({
        cycleId: input.cycleId,
        departmentId: input.departmentId,
        version: changed.version,
      });
    },
    audit: (_input, output) => audit('recalled', output),
  };
}

/** The sections answered once per department (the cycle's form beyond the needs section). */
export function saveDepartmentAnswersActionDefinition(): ActionDefinition<
  typeof SaveDepartmentAnswersInput,
  DepartmentChanged,
  UserTx
> {
  return {
    permission: SUBMIT,
    input: SaveDepartmentAnswersInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const access = await headAccess(ctx, input.departmentId);
      if (!access.ok) return access;
      const state = await departmentState(ctx, input);
      if (!state.ok) return state;
      const blocked = editable(state.value);
      if (blocked) return err(blocked);
      const form = await formParts(ctx.tx, state.value.cycle.needsFormId);
      if (!form?.otherSections.length) {
        return validation([{ path: 'answers', code: 'UNKNOWN_SECTION' }]);
      }
      const team = new Set(
        (await listDepartmentTeam(ctx.tx, input.departmentId)).map((m) => m.personId),
      );
      const checked = validateNeedsAnswers({ sections: form.otherSections }, input.answers, {
        allowedPersonIds: team,
      });
      if (!checked.ok) return checked;
      const changed = await repo.updateDepartmentAnswers(
        ctx.tx,
        input.cycleId,
        input.departmentId,
        checked.value,
      );
      if (changed.outcome !== 'ok') return err(departmentOutcomeError(changed.outcome));
      return ok({
        cycleId: input.cycleId,
        departmentId: input.departmentId,
        version: changed.version,
      });
    },
    // Answers are the department's words: the audit records that they changed, not their content.
    audit: (_input, output) => audit('answers_changed', output),
  };
}

// ---------------------------------------------------------------------------------------------------
// Actions — the L&D Manager
// ---------------------------------------------------------------------------------------------------

/** «Return for changes» (business flow D14): the head reads the note on their needs page. */
export function returnNeedsActionDefinition(): ActionDefinition<
  typeof ReturnNeedsInput,
  DepartmentChanged,
  UserTx
> {
  return {
    permission: MANAGE,
    input: ReturnNeedsInput,
    handler: async ({ ctx, input }) => {
      const state = await departmentState(ctx, input);
      if (!state.ok) return state;
      if (state.value.cycle.status !== 'open') return err(appError(NeedsErrors.PLAN_NEEDS_CLOSED));
      if (state.value.department.status !== 'submitted')
        return err(appError(NeedsErrors.PLAN_NEEDS_NOT_SUBMITTED));
      const changed = await repo.setDepartmentStatus(
        ctx.tx,
        input.cycleId,
        input.departmentId,
        input.version,
        'returned',
        input.note,
      );
      if (changed.outcome !== 'ok') return err(departmentOutcomeError(changed.outcome));
      return ok({
        cycleId: input.cycleId,
        departmentId: input.departmentId,
        version: changed.version,
      });
    },
    // The note is free text for the head: audited as present, not quoted.
    audit: (input, output) => audit('returned', output, { noteLength: input.note.length }),
  };
}

export interface DepartmentDeadlineExtended extends DepartmentChanged {
  readonly before: string;
  readonly after: string;
}

/** An extension for one department (Q3): later than its effective deadline, today or later, within the period. */
export function extendDepartmentDeadlineActionDefinition(): ActionDefinition<
  typeof ExtendDepartmentDeadlineInput,
  DepartmentDeadlineExtended,
  UserTx
> {
  return {
    permission: MANAGE,
    input: ExtendDepartmentDeadlineInput,
    handler: async ({ ctx, input }) => {
      const state = await departmentState(ctx, input);
      if (!state.ok) return state;
      const { cycle, deadline, today } = state.value;
      if (cycle.status !== 'open') return err(appError(NeedsErrors.PLAN_NEEDS_CLOSED));
      if (input.deadline <= deadline) return validation([{ path: 'deadline', code: 'NOT_LATER' }]);
      if (input.deadline < today) return validation([{ path: 'deadline', code: 'IN_PAST' }]);
      if (input.deadline > cycle.periodEnd)
        return validation([{ path: 'deadline', code: 'AFTER_PERIOD' }]);
      const changed = await repo.extendDepartmentDeadline(
        ctx.tx,
        input.cycleId,
        input.departmentId,
        input.version,
        input.deadline,
      );
      if (changed.outcome !== 'ok') return err(departmentOutcomeError(changed.outcome));
      return ok({
        cycleId: input.cycleId,
        departmentId: input.departmentId,
        version: changed.version,
        before: deadline,
        after: input.deadline,
      });
    },
    audit: (_input, output) => ({
      action: 'tms.plan_cycle.department_deadline_extended',
      entityType: 'plan_cycle',
      entityId: output.cycleId,
      data: { departmentId: output.departmentId, before: output.before, after: output.after },
    }),
  };
}
