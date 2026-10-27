/**
 * Department needs definitions with a fake runtime (WP-LD-01, T-M3-05; FR-PLN-03, FR-MGR-05): who may enter,
 * read, return and extend (deny by default, the effective-head rule), the needs page's figures, the
 * validation of a need, the submission state and the audit records. The repository, the forms, the courses
 * and the platform services are replaced; the database tests (99_planning_d_*) cover the same rules in SQL.
 */
import { ok } from '@jadarat/platform-core';
import type { UserTx } from '@jadarat/platform-db';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  listOrgStructure: vi.fn(),
  getMemberOptionsByIds: vi.fn(),
  listDepartmentTeam: vi.fn(),
  listStructureLevelLabels: vi.fn(),
  searchMemberOptions: vi.fn(),
  getOrganizationProfile: vi.fn(),
  MEMBER_SEARCH: { minLength: 2, maxLength: 100, limit: 50 },
  // Read when @jadarat/platform-rbac loads (its security settings schema, T-M2-10).
  MFA_MODES: ['off', 'optional', 'required_all', 'required_roles'],
  BRAND_IMAGE_KINDS: ['logo', 'favicon', 'sign_in_image'],
  SECURITY_LIMITS: {
    mfaGraceDays: { min: 0, max: 30 },
    passwordMinLength: { min: 12, max: 36 },
    lockoutThreshold: { min: 3, max: 5 },
    lockoutMinutes: { min: 15, max: 60 },
    sessionIdleMinutes: { min: 5, max: 480 },
    sessionMaxHours: { min: 1, max: 24 },
    sessionMaxDevices: { min: 1, max: 10 },
  },
}));
vi.mock('@jadarat/platform-db', () => db);

const repo = vi.hoisted(() => ({
  organizationToday: vi.fn(),
  getCycle: vi.fn(),
  getDepartment: vi.fn(),
  listNeeds: vi.fn(),
  insertNeed: vi.fn(),
  updateNeed: vi.fn(),
  deleteNeed: vi.fn(),
  setDepartmentStatus: vi.fn(),
  updateDepartmentAnswers: vi.fn(),
  extendDepartmentDeadline: vi.fn(),
  listMyDepartments: vi.fn(),
}));
vi.mock('./repository', () => repo);

const forms = vi.hoisted(() => ({ getNeedsForm: vi.fn() }));
vi.mock('../db/needs-forms', () => forms);

const courses = vi.hoisted(() => ({ getCourse: vi.fn(), listCourses: vi.fn() }));
vi.mock('../courses/db', () => courses);

const { createDefineAction, createDefineQuery, grantsForAssignments } =
  await import('@jadarat/platform-rbac');
const defs = await import('./needs-definitions');

const TENANT = '22222222-2222-4222-8222-222222222222';
const CYCLE = '55555555-5555-4555-8555-555555555555';
const SALES = '66666666-6666-4666-8666-666666666661';
const EAST = '66666666-6666-4666-8666-666666666662';
const OPS = '66666666-6666-4666-8666-666666666663';
const ME = '44444444-4444-4444-8444-444444444444';
const OTHER = '88888888-8888-4888-8888-888888888883';
const EMP1 = '99999999-9999-4999-8999-999999999901';
const EMP2 = '99999999-9999-4999-8999-999999999902';
const OUTSIDER = '99999999-9999-4999-8999-999999999909';
const NEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const COURSE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const FORM = '99999999-9999-4999-8999-999999999991';
const SECTION = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const TOPIC_FIELD = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const PEOPLE_FIELD = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const PRIORITY_FIELD = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3';

const claims = brandVerifiedClaims({
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'authenticated',
  aal: 'aal1',
  session_id: '33333333-3333-4333-8333-333333333333',
  tenant_id: TENANT,
  person_id: ME,
});

function runtime(role: string, headed: readonly string[] = []) {
  if (!claims.ok) throw new Error('fixture');
  const audits: unknown[] = [];
  const rt = {
    getClaims: () => Promise.resolve(ok(claims.value)),
    withUserTx: <T>(_c: unknown, fn: (tx: object) => Promise<T>) => fn({}),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: false }),
    loadGrants: () =>
      Promise.resolve(grantsForAssignments([{ roleCode: role }], { headedDepartmentIds: headed })),
    resolveResource: () => Promise.resolve(null),
    writeAudit: (_tx: unknown, _actor: unknown, record: unknown) => {
      audits.push(record);
      return Promise.resolve();
    },
    logError: () => undefined,
  };
  return {
    action: createDefineAction<UserTx>(rt as never),
    query: createDefineQuery<UserTx>(rt as never),
    audits,
  };
}

const unit = (id: string, over: Record<string, unknown>) => ({
  id,
  parentId: null,
  branchId: null,
  code: id.slice(-2),
  nameAr: 'وحدة',
  nameEn: 'Unit',
  active: true,
  sortOrder: 0,
  levelOrdinal: 1,
  head: null,
  ...over,
});

/** ME heads Sales; East (under Sales) has no head of its own; Ops is headed by someone else. */
const structure = {
  departments: [
    unit(SALES, {
      nameAr: 'المبيعات',
      nameEn: 'Sales',
      head: { personId: ME, nameAr: 'أنا', nameEn: 'Me' },
    }),
    unit(EAST, { parentId: SALES, nameAr: 'الشرق', nameEn: 'East', levelOrdinal: 2 }),
    unit(OPS, {
      nameAr: 'العمليات',
      nameEn: 'Ops',
      head: { personId: OTHER, nameAr: 'آخر', nameEn: 'Other' },
    }),
  ],
  branches: [],
};

const cycle = (over: Record<string, unknown> = {}) => ({
  id: CYCLE,
  nameAr: 'خطة',
  nameEn: 'Plan',
  periodStart: '2027-01-01',
  periodEnd: '2027-12-31',
  deadline: '2026-11-30',
  latestDeadline: '2026-11-30',
  instructionsAr: null,
  instructionsEn: 'Think of next year',
  needsFormId: FORM,
  reminderDays: [7, 2],
  currency: 'SAR',
  status: 'open',
  launchedAt: new Date('2026-10-20T08:00:00Z'),
  launchedBy: null,
  closedAt: null,
  version: 4,
  scope: { departmentIds: [SALES], branchIds: [] },
  departments: [],
  steps: [],
  ...over,
});

const department = (over: Record<string, unknown> = {}) => ({
  cycleId: CYCLE,
  departmentId: SALES,
  budgetAmount: '50000',
  status: 'draft',
  deadline: null,
  submittedAt: null,
  submittedBy: null,
  returnedAt: null,
  returnedBy: null,
  returnNote: null,
  answers: {},
  version: 2,
  ...over,
});

const need = (over: Record<string, unknown> = {}) => ({
  id: NEED,
  topic: 'Excel',
  courseId: null,
  peopleCount: 5,
  estimatedCost: '1200.5',
  answers: {},
  personIds: [EMP1],
  version: 1,
  updatedAt: new Date('2026-10-25T10:00:00Z'),
  ...over,
});

const field = (id: string, over: Record<string, unknown>) => ({
  id,
  systemKey: null,
  type: 'text',
  label: { ar: 'حقل', en: 'Field' },
  placeholder: {},
  required: false,
  visible: true,
  options: [],
  peopleMode: null,
  condition: null,
  ...over,
});

const form = {
  id: FORM,
  name: { ar: 'نموذج', en: 'Form' },
  isDefault: true,
  isActive: true,
  lockedAt: null,
  version: 1,
  sectionCount: 1,
  fieldCount: 3,
  sections: [
    {
      id: SECTION,
      name: { ar: 'الاحتياجات', en: 'Needs' },
      description: {},
      repeatable: true,
      minEntries: 1,
      maxEntries: 200,
      visible: true,
      fields: [
        field(TOPIC_FIELD, { systemKey: 'training_topic', required: true }),
        field(PEOPLE_FIELD, {
          systemKey: 'people',
          type: 'people',
          peopleMode: 'count_or_employees',
          required: true,
        }),
        field(PRIORITY_FIELD, {
          type: 'select',
          label: { ar: 'الأولوية', en: 'Priority' },
          options: [
            { value: 'high', label: { ar: 'عالية', en: 'High' } },
            { value: 'low', label: { ar: 'منخفضة', en: 'Low' } },
          ],
        }),
      ],
    },
  ],
};

const team = [
  { personId: EMP1, nameAr: 'موظف ١', nameEn: 'Emp 1' },
  { personId: EMP2, nameAr: 'موظف ٢', nameEn: 'Emp 2' },
];

const baseNeed = {
  cycleId: CYCLE,
  departmentId: SALES,
  topic: 'Excel',
  courseId: null,
  peopleCount: 5,
  personIds: [EMP1],
  estimatedCost: '1200.5',
  answers: {},
};

beforeEach(() => {
  repo.organizationToday.mockResolvedValue('2026-10-27');
  repo.getCycle.mockResolvedValue(cycle());
  repo.getDepartment.mockResolvedValue(department());
  repo.listNeeds.mockResolvedValue([
    need(),
    need({ id: 'n2', peopleCount: 3, personIds: [], estimatedCost: null }),
  ]);
  repo.insertNeed.mockResolvedValue({ outcome: 'ok', id: NEED, version: 1 });
  repo.updateNeed.mockResolvedValue({ outcome: 'ok', id: NEED, version: 2 });
  repo.deleteNeed.mockResolvedValue({ outcome: 'ok', id: NEED, version: 1 });
  repo.setDepartmentStatus.mockResolvedValue({ outcome: 'ok', version: 3 });
  repo.updateDepartmentAnswers.mockResolvedValue({ outcome: 'ok', version: 3 });
  repo.extendDepartmentDeadline.mockResolvedValue({ outcome: 'ok', version: 3 });
  repo.listMyDepartments.mockResolvedValue([]);
  db.listOrgStructure.mockResolvedValue(structure);
  db.getMemberOptionsByIds.mockResolvedValue(team.map((m) => ({ ...m, active: true })));
  db.listDepartmentTeam.mockResolvedValue(team);
  db.listStructureLevelLabels.mockResolvedValue([]);
  forms.getNeedsForm.mockResolvedValue(form);
  courses.getCourse.mockResolvedValue({
    id: COURSE,
    status: 'active',
    titleAr: 'إكسل',
    titleEn: 'Excel',
  });
  courses.listCourses.mockResolvedValue([{ id: COURSE, titleAr: 'إكسل', titleEn: 'Excel' }]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('who may do what (deny by default; the effective head)', () => {
  it.each(['learner', 'hr_manager', 'training_manager', 'training_coordinator', 'tenant_admin'])(
    '%s enters no needs (403)',
    async (role) => {
      const { query, action, audits } = runtime(role);
      const view = await query(defs.departmentNeedsQueryDefinition())({
        cycleId: CYCLE,
        departmentId: SALES,
      });
      expect(!view.ok && view.error.code).toBe('FORBIDDEN');
      const added = await action(defs.addNeedActionDefinition())(baseNeed);
      expect(!added.ok && added.error.code).toBe('FORBIDDEN');
      const mine = await query(defs.myNeedsQueryDefinition())({});
      expect(!mine.ok && mine.error.code).toBe('FORBIDDEN');
      expect(repo.insertNeed).not.toHaveBeenCalled();
      expect(audits).toEqual([]);
    },
  );

  it('a Department Head who heads nothing holds no grant (403)', async () => {
    const { query } = runtime('department_head', []);
    const view = await query(defs.departmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    expect(!view.ok && view.error.code).toBe('FORBIDDEN');
  });

  it('the head of Sales enters Sales and East (no head of its own), never Ops (another head): 404', async () => {
    const { query, action } = runtime('department_head', [SALES]);
    const sales = await query(defs.departmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    expect(sales.ok && sales.value.role).toBe('head');
    repo.getDepartment.mockResolvedValue(department({ departmentId: EAST }));
    const east = await query(defs.departmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: EAST,
    });
    expect(east.ok && east.value.department.head).toEqual({ ar: 'أنا', en: 'Me' });
    const ops = await query(defs.departmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: OPS,
    });
    expect(!ops.ok && ops.error.code).toBe('NOT_FOUND');
    const opsNeed = await action(defs.addNeedActionDefinition())({
      ...baseNeed,
      departmentId: OPS,
    });
    expect(!opsNeed.ok && opsNeed.error.code).toBe('NOT_FOUND');
    expect(repo.insertNeed).not.toHaveBeenCalled();
  });

  it('a head whose grant covers a sub-unit with its own head still cannot enter for it (404)', async () => {
    // Ops moved under Sales: the grant (headed departments and everything under them) covers it, but its own
    // head receives its form — the effective-head rule wins.
    db.listOrgStructure.mockResolvedValue({
      ...structure,
      departments: structure.departments.map((d) => (d.id === OPS ? { ...d, parentId: SALES } : d)),
    });
    const { query } = runtime('department_head', [SALES]);
    const ops = await query(defs.departmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: OPS,
    });
    expect(!ops.ok && ops.error.code).toBe('NOT_FOUND');
  });

  it('the department head neither reads the manager view nor returns or extends (403)', async () => {
    const { query, action } = runtime('department_head', [SALES]);
    const view = await query(defs.cycleDepartmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    expect(!view.ok && view.error.code).toBe('FORBIDDEN');
    const returned = await action(defs.returnNeedsActionDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
      version: 2,
      note: 'More detail please',
    });
    expect(!returned.ok && returned.error.code).toBe('FORBIDDEN');
    const extended = await action(defs.extendDepartmentDeadlineActionDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
      version: 2,
      deadline: '2026-12-10',
    });
    expect(!extended.ok && extended.error.code).toBe('FORBIDDEN');
  });

  it('the Training Coordinator reads a department, without returning or extending', async () => {
    const { query, action } = runtime('training_coordinator');
    const view = await query(defs.cycleDepartmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    expect(view.ok && view.value.role).toBe('manager');
    expect(view.ok && view.value.can).toEqual({
      edit: false,
      submit: false,
      recall: false,
      return: false,
      extend: false,
    });
    expect(view.ok && view.value.team).toEqual([]);
    const returned = await action(defs.returnNeedsActionDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
      version: 2,
      note: 'x',
    });
    expect(!returned.ok && returned.error.code).toBe('FORBIDDEN');
  });

  it('validates untrusted input before any database work (422)', async () => {
    const { action } = runtime('department_head', [SALES]);
    const result = await action(defs.addNeedActionDefinition())({ ...baseNeed, peopleCount: 0 });
    expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
    expect(repo.getCycle).not.toHaveBeenCalled();
  });
});

describe('the needs page of a head', () => {
  it('shows the figures: seats, named, cost against the envelope, the form parts, team and courses', async () => {
    const { query } = runtime('department_head', [SALES]);
    const result = await query(defs.departmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = result.value;
    expect(view.status).toBe('draft');
    expect(view.entryOpen).toBe(true);
    expect(view.deadline).toBe('2026-11-30');
    expect(view.daysLeft).toBe(34);
    expect(view.totals).toEqual({
      needs: 2,
      seats: 8,
      named: 1,
      unnamed: 7,
      cost: '1200.5',
      costed: 1,
    });
    expect(view.envelope).toEqual({ kind: 'within', left: '48799.5' });
    expect(view.needs[0]?.people).toEqual([
      { personId: EMP1, name: { ar: 'موظف ١', en: 'Emp 1' } },
    ]);
    expect(view.form?.needsSectionId).toBe(SECTION);
    expect(view.form?.moreFields.map((f) => f.id)).toEqual([PRIORITY_FIELD]);
    expect(view.form?.otherSections).toEqual([]);
    expect(view.can).toEqual({
      edit: true,
      submit: true,
      recall: false,
      return: false,
      extend: false,
    });
    expect(view.team).toEqual(team);
    expect(view.courses).toEqual([{ id: COURSE, title: { ar: 'إكسل', en: 'Excel' } }]);
    expect(view.cycle.status).toBe('open');
  });

  it('after the deadline: Late, entry closed, nothing to edit (Q3) — until an extension for the department', async () => {
    repo.organizationToday.mockResolvedValue('2026-12-02');
    const { query } = runtime('department_head', [SALES]);
    const late = await query(defs.departmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    expect(late.ok && late.value.status).toBe('late');
    expect(late.ok && late.value.entryOpen).toBe(false);
    expect(late.ok && late.value.can.edit).toBe(false);
    expect(late.ok && late.value.team).toEqual([]);
    expect(late.ok && late.value.cycle.status).toBe('closed');

    repo.getDepartment.mockResolvedValue(department({ deadline: '2026-12-05' }));
    repo.getCycle.mockResolvedValue(cycle({ latestDeadline: '2026-12-05' }));
    const extended = await query(defs.departmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    expect(extended.ok && extended.value.status).toBe('draft');
    expect(extended.ok && extended.value.deadline).toBe('2026-12-05');
    expect(extended.ok && extended.value.can.edit).toBe(true);
    expect(extended.ok && extended.value.cycle.status).toBe('open');
  });

  it('a submitted department: recall offered, nothing to edit; the manager may return it', async () => {
    repo.getDepartment.mockResolvedValue(
      department({
        status: 'submitted',
        submittedAt: new Date('2026-10-26T09:00:00Z'),
        submittedBy: ME,
      }),
    );
    db.getMemberOptionsByIds.mockResolvedValue([
      ...team.map((m) => ({ ...m, active: true })),
      { personId: ME, nameAr: 'أنا', nameEn: 'Me', active: true },
    ]);
    const head = runtime('department_head', [SALES]);
    const mine = await head.query(defs.departmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    expect(mine.ok && mine.value.status).toBe('submitted');
    expect(mine.ok && mine.value.can).toEqual({
      edit: false,
      submit: false,
      recall: true,
      return: false,
      extend: false,
    });
    expect(mine.ok && mine.value.submittedBy).toEqual({ ar: 'أنا', en: 'Me' });
    const manager = runtime('training_manager');
    const theirs = await manager.query(defs.cycleDepartmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    expect(theirs.ok && theirs.value.can).toEqual({
      edit: false,
      submit: false,
      recall: false,
      return: true,
      extend: true,
    });
  });

  it('answers 404 for a draft cycle or a department outside the cycle', async () => {
    const { query } = runtime('department_head', [SALES]);
    repo.getCycle.mockResolvedValue(cycle({ status: 'draft' }));
    const draft = await query(defs.departmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    expect(!draft.ok && draft.error.code).toBe('NOT_FOUND');
    repo.getCycle.mockResolvedValue(cycle());
    repo.getDepartment.mockResolvedValue(null);
    const outside = await query(defs.departmentNeedsQueryDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    expect(!outside.ok && outside.error.code).toBe('NOT_FOUND');
  });

  it('lists the head’s tasks for the Home card: the open cycle’s departments, Late once the deadline passed', async () => {
    repo.listMyDepartments.mockResolvedValue([
      {
        cycleId: CYCLE,
        cycleNameAr: 'خطة',
        cycleNameEn: 'Plan',
        cycleDeadline: '2026-10-20',
        periodStart: '2027-01-01',
        periodEnd: '2027-12-31',
        currency: 'SAR',
        departmentId: SALES,
        status: 'draft',
        deadline: null,
        budgetAmount: '50000',
        needsCount: 2,
        seats: 8,
        cost: '1200.5',
        returnNote: null,
      },
      {
        cycleId: CYCLE,
        cycleNameAr: 'خطة',
        cycleNameEn: 'Plan',
        cycleDeadline: '2026-10-20',
        periodStart: '2027-01-01',
        periodEnd: '2027-12-31',
        currency: 'SAR',
        departmentId: EAST,
        status: 'not_started',
        deadline: '2026-10-30',
        budgetAmount: null,
        needsCount: 0,
        seats: 0,
        cost: null,
        returnNote: null,
      },
      // Not this head's (a defensive repeat of the database rule).
      {
        cycleId: CYCLE,
        cycleNameAr: 'خطة',
        cycleNameEn: 'Plan',
        cycleDeadline: '2026-10-20',
        periodStart: '2027-01-01',
        periodEnd: '2027-12-31',
        currency: 'SAR',
        departmentId: OPS,
        status: 'not_started',
        deadline: null,
        budgetAmount: null,
        needsCount: 0,
        seats: 0,
        cost: null,
        returnNote: null,
      },
    ]);
    const { query } = runtime('department_head', [SALES]);
    const result = await query(defs.myNeedsQueryDefinition())({});
    expect(
      result.ok &&
        result.value.tasks.map((t) => [t.departmentId, t.status, t.deadline, t.entryOpen]),
    ).toEqual([
      [SALES, 'late', '2026-10-20', false],
      [EAST, 'not_started', '2026-10-30', true],
    ]);
  });
});

describe('the head enters, submits and recalls', () => {
  it('adds a need with named people from the team and «More» answers; audited with ids and figures', async () => {
    const { action, audits } = runtime('department_head', [SALES]);
    const result = await action(defs.addNeedActionDefinition())({
      ...baseNeed,
      personIds: [EMP1, EMP2, EMP1],
      answers: { [PRIORITY_FIELD]: 'high' },
    });
    expect(result.ok && result.value.needId).toBe(NEED);
    expect(repo.insertNeed).toHaveBeenCalledWith(
      {},
      CYCLE,
      SALES,
      {
        topic: 'Excel',
        courseId: null,
        peopleCount: 5,
        estimatedCost: '1200.5',
        answers: { [PRIORITY_FIELD]: 'high' },
      },
      [EMP1, EMP2],
    );
    expect(audits).toEqual([
      {
        action: 'tms.plan_needs.added',
        entityType: 'plan_cycle_department',
        entityId: CYCLE,
        data: {
          cycleId: CYCLE,
          departmentId: SALES,
          needId: NEED,
          peopleCount: 5,
          named: 2,
          estimatedCost: '1200.5',
          courseId: null,
        },
      },
    ]);
  });

  it('refuses people outside the team, more names than seats, an unknown course and a bad «More» answer', async () => {
    courses.getCourse.mockResolvedValue(null);
    const { action } = runtime('department_head', [SALES]);
    const result = await action(defs.addNeedActionDefinition())({
      ...baseNeed,
      peopleCount: 1,
      personIds: [EMP1, OUTSIDER],
      courseId: COURSE,
      answers: { [PRIORITY_FIELD]: 'urgent', other: 1 },
    });
    expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
    expect(!result.ok && result.error.fieldErrors?.map((e) => `${e.path}:${e.code}`)).toEqual([
      'personIds.1:PERSON_NOT_ALLOWED',
      'peopleCount:FEWER_THAN_NAMED',
      'courseId:UNKNOWN',
      'answers.other:UNKNOWN_FIELD',
      `answers.${PRIORITY_FIELD}:NOT_AN_OPTION`,
    ]);
    expect(repo.insertNeed).not.toHaveBeenCalled();
  });

  it('refuses changes once entry is closed, once submitted, and beyond 200 needs', async () => {
    const { action } = runtime('department_head', [SALES]);
    repo.organizationToday.mockResolvedValue('2026-12-02');
    const closed = await action(defs.addNeedActionDefinition())(baseNeed);
    expect(!closed.ok && closed.error.code).toBe('PLAN_NEEDS_CLOSED');
    repo.organizationToday.mockResolvedValue('2026-10-27');
    repo.getDepartment.mockResolvedValue(department({ status: 'submitted' }));
    const submitted = await action(defs.updateNeedActionDefinition())({
      ...baseNeed,
      needId: NEED,
      version: 1,
    });
    expect(!submitted.ok && submitted.error.code).toBe('PLAN_NEEDS_SUBMITTED');
    const removed = await action(defs.deleteNeedActionDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
      needId: NEED,
      version: 1,
    });
    expect(!removed.ok && removed.error.code).toBe('PLAN_NEEDS_SUBMITTED');
    repo.getDepartment.mockResolvedValue(department());
    repo.listNeeds.mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => need({ id: `n${String(i)}` })),
    );
    const full = await action(defs.addNeedActionDefinition())(baseNeed);
    expect(!full.ok && full.error.code).toBe('PLAN_NEEDS_LIMIT');
    expect(repo.insertNeed).not.toHaveBeenCalled();
  });

  it('maps the database’s refusals: stale version, closed, submitted, limit', async () => {
    const { action } = runtime('department_head', [SALES]);
    for (const [outcome, code] of [
      ['conflict', 'CONFLICT_VERSION'],
      ['not_found', 'NOT_FOUND'],
      ['closed', 'PLAN_NEEDS_CLOSED'],
      ['submitted', 'PLAN_NEEDS_SUBMITTED'],
      ['limit', 'PLAN_NEEDS_LIMIT'],
    ] as const) {
      repo.updateNeed.mockResolvedValue({ outcome });
      const result = await action(defs.updateNeedActionDefinition())({
        ...baseNeed,
        needId: NEED,
        version: 1,
      });
      expect(!result.ok && result.error.code, outcome).toBe(code);
    }
  });

  it('submits: at least one need, the summary audited; nothing to submit → 422', async () => {
    const { action, audits } = runtime('department_head', [SALES]);
    const result = await action(defs.submitNeedsActionDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
      version: 2,
    });
    expect(result.ok && result.value.totals.seats).toBe(8);
    expect(result.ok && result.value.envelope).toEqual({ kind: 'within', left: '48799.5' });
    expect(repo.setDepartmentStatus).toHaveBeenCalledWith({}, CYCLE, SALES, 2, 'submitted');
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'tms.plan_needs.submitted',
        data: {
          cycleId: CYCLE,
          departmentId: SALES,
          needs: 2,
          seats: 8,
          named: 1,
          cost: '1200.5',
          envelope: 'within',
        },
      }),
    ]);
    repo.listNeeds.mockResolvedValue([]);
    const empty = await action(defs.submitNeedsActionDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
      version: 2,
    });
    expect(!empty.ok && empty.error.code).toBe('PLAN_NEEDS_EMPTY');
  });

  it('recalls a submitted set before the deadline; not after it; not when it is not submitted', async () => {
    const { action, audits } = runtime('department_head', [SALES]);
    const notSubmitted = await action(defs.recallNeedsActionDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
      version: 2,
    });
    expect(!notSubmitted.ok && notSubmitted.error.code).toBe('PLAN_NEEDS_NOT_SUBMITTED');
    repo.getDepartment.mockResolvedValue(department({ status: 'submitted' }));
    const recalled = await action(defs.recallNeedsActionDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
      version: 2,
    });
    expect(recalled.ok && recalled.value.version).toBe(3);
    expect(repo.setDepartmentStatus).toHaveBeenCalledWith({}, CYCLE, SALES, 2, 'draft');
    expect(audits).toEqual([expect.objectContaining({ action: 'tms.plan_needs.recalled' })]);
    repo.organizationToday.mockResolvedValue('2026-12-02');
    const late = await action(defs.recallNeedsActionDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
      version: 2,
    });
    expect(!late.ok && late.error.code).toBe('PLAN_NEEDS_CLOSED');
  });

  it('saves department-level answers only when the form has such sections', async () => {
    const { action } = runtime('department_head', [SALES]);
    const none = await action(defs.saveDepartmentAnswersActionDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
      answers: {},
    });
    expect(!none.ok && none.error.code).toBe('VALIDATION_FAILED');
    const context = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
    const noteField = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
    forms.getNeedsForm.mockResolvedValue({
      ...form,
      sections: [
        ...form.sections,
        {
          id: context,
          name: { ar: 'سياق', en: 'Context' },
          description: {},
          repeatable: false,
          minEntries: 1,
          maxEntries: 1,
          visible: true,
          fields: [field(noteField, { type: 'textarea', required: true })],
        },
      ],
    });
    const saved = await action(defs.saveDepartmentAnswersActionDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
      answers: { [context]: [{ [noteField]: ' Growth year ' }] },
    });
    expect(saved.ok && saved.value.version).toBe(3);
    expect(repo.updateDepartmentAnswers).toHaveBeenCalledWith({}, CYCLE, SALES, {
      [context]: [{ [noteField]: 'Growth year' }],
    });
  });
});

describe('the L&D Manager returns and extends', () => {
  it('returns a submitted department with a note (audited as present, not quoted)', async () => {
    const { action, audits } = runtime('training_manager');
    const notSubmitted = await action(defs.returnNeedsActionDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
      version: 2,
      note: 'Please add the sales academy',
    });
    expect(!notSubmitted.ok && notSubmitted.error.code).toBe('PLAN_NEEDS_NOT_SUBMITTED');
    repo.getDepartment.mockResolvedValue(department({ status: 'submitted' }));
    const returned = await action(defs.returnNeedsActionDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
      version: 2,
      note: 'Please add the sales academy',
    });
    expect(returned.ok && returned.value.version).toBe(3);
    expect(repo.setDepartmentStatus).toHaveBeenCalledWith(
      {},
      CYCLE,
      SALES,
      2,
      'returned',
      'Please add the sales academy',
    );
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'tms.plan_needs.returned',
        data: { cycleId: CYCLE, departmentId: SALES, noteLength: 28 },
      }),
    ]);
  });

  it('extends one department: later than its deadline, today or later, within the period; audited', async () => {
    const { action, audits } = runtime('training_manager');
    const ref = { cycleId: CYCLE, departmentId: SALES, version: 2 };
    const notLater = await action(defs.extendDepartmentDeadlineActionDefinition())({
      ...ref,
      deadline: '2026-11-30',
    });
    expect(!notLater.ok && notLater.error.fieldErrors).toEqual([
      { path: 'deadline', code: 'NOT_LATER' },
    ]);
    const afterPeriod = await action(defs.extendDepartmentDeadlineActionDefinition())({
      ...ref,
      deadline: '2028-01-01',
    });
    expect(!afterPeriod.ok && afterPeriod.error.fieldErrors).toEqual([
      { path: 'deadline', code: 'AFTER_PERIOD' },
    ]);
    repo.organizationToday.mockResolvedValue('2026-12-10');
    const inPast = await action(defs.extendDepartmentDeadlineActionDefinition())({
      ...ref,
      deadline: '2026-12-05',
    });
    expect(!inPast.ok && inPast.error.fieldErrors).toEqual([{ path: 'deadline', code: 'IN_PAST' }]);
    const extended = await action(defs.extendDepartmentDeadlineActionDefinition())({
      ...ref,
      deadline: '2026-12-15',
    });
    expect(extended.ok && extended.value).toEqual({
      cycleId: CYCLE,
      departmentId: SALES,
      version: 3,
      before: '2026-11-30',
      after: '2026-12-15',
    });
    expect(audits).toEqual([
      {
        action: 'tms.plan_cycle.department_deadline_extended',
        entityType: 'plan_cycle',
        entityId: CYCLE,
        data: { departmentId: SALES, before: '2026-11-30', after: '2026-12-15' },
      },
    ]);
    repo.getCycle.mockResolvedValue(cycle({ status: 'closed' }));
    const closed = await action(defs.extendDepartmentDeadlineActionDefinition())({
      ...ref,
      deadline: '2026-12-20',
    });
    expect(!closed.ok && closed.error.code).toBe('PLAN_NEEDS_CLOSED');
  });
});
