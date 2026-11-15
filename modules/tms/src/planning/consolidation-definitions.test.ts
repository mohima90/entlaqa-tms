/**
 * Training plan definitions with a fake runtime (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06, FR-IAM-08): who may read,
 * build and change the plan (deny by default; the department-limited L&D Manager of feedback #4 — its units only,
 * never a line shared with another department), the Plan tab's figures (sessions, cost, shares, budget, groups,
 * attention), opening the plan (Q1 = A), the line changes and their audit records. The repositories, the forms
 * and the platform services are replaced; the database tests (99_planning_f_*) cover the same rules in SQL.
 */
import { ok } from '@jadarat/platform-core';
import type { UserTx } from '@jadarat/platform-db';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  listOrgStructure: vi.fn(),
  listStructureLevelLabels: vi.fn(),
  getMemberOptionsByIds: vi.fn(),
  listDepartmentTeam: vi.fn(),
  getOrganizationProfile: vi.fn(),
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
  getCycle: vi.fn(),
  organizationToday: vi.fn(),
  listDepartmentProgress: vi.fn(),
}));
vi.mock('./repository', () => repo);

const plans = vi.hoisted(() => ({
  getPlanByCycle: vi.fn(),
  getPlan: vi.fn(),
  insertPlan: vi.fn(),
  closeNeeds: vi.fn(),
  listLines: vi.fn(),
  getLines: vi.fn(),
  insertLine: vi.fn(),
  insertLineWithNeeds: vi.fn(),
  updateLine: vi.fn(),
  deleteEmptyLines: vi.fn(),
  listLinks: vi.fn(),
  insertLinks: vi.fn(),
  moveLinks: vi.fn(),
  removeLinks: vi.fn(),
  refreshLinks: vi.fn(),
  listCycleNeeds: vi.fn(),
  listBudgetReasons: vi.fn(),
  saveBudgetReason: vi.fn(),
}));
vi.mock('./consolidation-repository', () => plans);

const forms = vi.hoisted(() => ({ getNeedsForm: vi.fn() }));
vi.mock('../db/needs-forms', () => forms);

const courses = vi.hoisted(() => ({ getCourse: vi.fn(), listCourses: vi.fn() }));
vi.mock('../courses/db', () => courses);

const { createDefineAction, createDefineQuery, grantsForAssignments } =
  await import('@jadarat/platform-rbac');
const defs = await import('./consolidation-definitions');

const TENANT = '22222222-2222-4222-8222-222222222222';
const CYCLE = '55555555-5555-4555-8555-555555555555';
const PLAN = '77777777-7777-4777-8777-777777777777';
const FORM = '99999999-9999-4999-8999-999999999991';
const SALES = '66666666-6666-4666-8666-666666666661';
const EAST = '66666666-6666-4666-8666-666666666662';
const HR = '66666666-6666-4666-8666-666666666663';
const EXCEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const LEAD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const N1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const N2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const N3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const N4 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const ME = '44444444-4444-4444-8444-444444444444';
const RIYADH = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const JEDDAH = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const QUARTER_FIELD = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const PRIORITY_FIELD = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const TOPIC_FIELD = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3';
const CUSTOM = 'custom_a000000f0001';

const claims = brandVerifiedClaims({
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'authenticated',
  aal: 'aal1',
  session_id: '33333333-3333-4333-8333-333333333333',
  tenant_id: TENANT,
  person_id: ME,
});

/** A standard role, or the department-limited L&D Manager for Sales (a custom role limited to «A department»). */
function runtime(
  role: string,
  customPermissions: readonly string[] = ['tms.training_plan.read', 'tms.training_plan.manage'],
) {
  if (!claims.ok) throw new Error('fixture');
  const audits: unknown[] = [];
  const custom = role === CUSTOM;
  const rt = {
    getClaims: () => Promise.resolve(ok(claims.value)),
    withUserTx: <T>(_c: unknown, fn: (tx: object) => Promise<T>) => fn({}),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: false }),
    loadGrants: () =>
      Promise.resolve(
        grantsForAssignments([{ roleCode: role, ...(custom ? { scopeUnitId: SALES } : {}) }], {
          headedDepartmentIds: [],
          customRoles: [
            {
              code: CUSTOM,
              dataScope: 'departments',
              permissions: [...customPermissions],
            },
          ],
        }),
      ),
    resolveResource: () => Promise.resolve(null),
    writeAudit: (_tx: unknown, _actor: unknown, record: unknown) => {
      audits.push(record);
      return Promise.resolve();
    },
    logError: (error: unknown) => {
      throw error;
    },
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
  branchId: RIYADH,
  code: id.slice(-2),
  nameAr: 'وحدة',
  nameEn: 'Unit',
  active: true,
  sortOrder: 0,
  levelOrdinal: 1,
  head: null,
  ...over,
});

/** Sales (Riyadh) with East below it; HR (Jeddah). */
const structure = {
  departments: [
    unit(SALES, { nameEn: 'Sales', head: { personId: 'h1', nameAr: 'رئيس', nameEn: 'Head' } }),
    unit(EAST, { parentId: SALES, nameEn: 'East', levelOrdinal: 2 }),
    unit(HR, { nameEn: 'HR', branchId: JEDDAH }),
  ],
  branches: [
    { id: RIYADH, nameAr: 'الرياض', nameEn: 'Riyadh', active: true },
    { id: JEDDAH, nameAr: 'جدة', nameEn: 'Jeddah', active: true },
  ],
};

const cycleRecord = (over: Record<string, unknown> = {}) => ({
  id: CYCLE,
  nameAr: 'خطة',
  nameEn: 'Plan 2027',
  periodStart: '2027-01-01',
  periodEnd: '2027-12-31',
  deadline: '2026-11-30',
  latestDeadline: '2026-11-30',
  instructionsAr: null,
  instructionsEn: null,
  needsFormId: FORM,
  reminderDays: [7, 2],
  currency: 'SAR',
  status: 'closed',
  launchedAt: new Date('2026-10-20T08:00:00Z'),
  launchedBy: null,
  closedAt: new Date('2026-11-14T08:00:00Z'),
  version: 6,
  scope: { departmentIds: [SALES, HR], branchIds: [] },
  departments: [
    { departmentId: SALES, budgetAmount: '10000', status: 'submitted', deadline: null },
    { departmentId: EAST, budgetAmount: null, status: 'submitted', deadline: null },
    { departmentId: HR, budgetAmount: '5000', status: 'submitted', deadline: null },
  ],
  ...over,
});

const planRecord = (over: Record<string, unknown> = {}) => ({
  id: PLAN,
  cycleId: CYCLE,
  status: 'draft',
  planVersion: 1,
  openedAt: new Date('2026-11-14T08:00:00Z'),
  openedBy: ME,
  needsClosedEarly: true,
  version: 1,
  ...over,
});

const lineRecord = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  planId: PLAN,
  cycleId: CYCLE,
  groupKey: 'topic:excel',
  title: 'Excel',
  courseId: null,
  deliveryType: null,
  category: null,
  quarter: 2,
  minPerSession: 8,
  maxPerSession: 20,
  costPerSession: '5000',
  costPerPerson: null,
  durationHours: null,
  status: 'in_plan',
  leftOutReason: null,
  sortOrder: 0,
  editedAt: null,
  createdBy: null,
  version: 3,
  ...over,
});

/** Excel: Sales 20 + HR 15 + East 12 = 47 (shared); Leadership: Sales 5 (Sales only). */
const links = [
  {
    needId: N1,
    lineId: EXCEL,
    departmentId: SALES,
    seats: 20,
    named: 2,
    topic: 'Excel',
    courseId: null,
  },
  {
    needId: N2,
    lineId: EXCEL,
    departmentId: HR,
    seats: 15,
    named: 0,
    topic: 'Excel',
    courseId: null,
  },
  {
    needId: N3,
    lineId: EXCEL,
    departmentId: EAST,
    seats: 12,
    named: 0,
    topic: 'excel',
    courseId: null,
  },
  {
    needId: N4,
    lineId: LEAD,
    departmentId: SALES,
    seats: 5,
    named: 0,
    topic: 'Leadership',
    courseId: null,
  },
];

const needRecord = (id: string, departmentId: string, topic: string, peopleCount: number) => ({
  id,
  departmentId,
  topic,
  courseId: null,
  peopleCount,
  // N1 names two of its people (as its line's snapshot says).
  named: id === N1 ? 2 : 0,
  answers: { [QUARTER_FIELD]: 'q3', [PRIORITY_FIELD]: 'high' },
  departmentStatus: 'submitted',
});

const option = (value: string) => ({ value, label: { ar: value, en: value } });
const form = {
  id: FORM,
  sections: [
    {
      id: 'section',
      fields: [
        { id: TOPIC_FIELD, systemKey: 'training_topic', type: 'text', options: [] },
        { id: 'people', systemKey: 'people', type: 'people', options: [] },
        {
          id: QUARTER_FIELD,
          systemKey: null,
          type: 'select',
          options: ['q1', 'q2', 'q3', 'q4'].map(option),
        },
        {
          id: PRIORITY_FIELD,
          systemKey: null,
          type: 'select',
          options: ['critical', 'high', 'medium', 'low'].map(option),
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.listOrgStructure.mockResolvedValue(structure);
  db.listStructureLevelLabels.mockResolvedValue([]);
  repo.getCycle.mockResolvedValue(cycleRecord());
  repo.organizationToday.mockResolvedValue('2026-11-14');
  repo.listDepartmentProgress.mockResolvedValue([
    { departmentId: SALES, version: 4 },
    { departmentId: EAST, version: 2 },
    { departmentId: HR, version: 3 },
  ]);
  forms.getNeedsForm.mockResolvedValue(form);
  plans.getPlanByCycle.mockResolvedValue(planRecord());
  plans.getPlan.mockResolvedValue(planRecord());
  plans.listLines.mockResolvedValue([
    lineRecord(EXCEL),
    lineRecord(LEAD, { title: 'Leadership', groupKey: 'topic:leadership', costPerSession: null }),
  ]);
  plans.getLines.mockImplementation((_tx: unknown, ids: string[]) =>
    Promise.resolve(
      [
        lineRecord(EXCEL),
        lineRecord(LEAD, { title: 'Leadership', groupKey: 'topic:leadership' }),
      ].filter((l) => ids.includes(l.id)),
    ),
  );
  plans.listLinks.mockResolvedValue(links);
  plans.listCycleNeeds.mockResolvedValue([
    needRecord(N1, SALES, 'Excel', 20),
    needRecord(N2, HR, 'Excel', 15),
    needRecord(N3, EAST, 'excel', 12),
    needRecord(N4, SALES, 'Leadership', 5),
  ]);
  plans.listBudgetReasons.mockResolvedValue([]);
  plans.updateLine.mockResolvedValue({ outcome: 'ok', version: 4 });
  plans.moveLinks.mockResolvedValue({ ok: true, value: 1 });
  plans.insertLinks.mockImplementation((_tx: unknown, _plan: unknown, rows: unknown[]) =>
    Promise.resolve({ ok: true, value: rows.length }),
  );
  plans.refreshLinks.mockImplementation((_tx: unknown, ids: unknown[]) =>
    Promise.resolve({ ok: true, value: ids.length }),
  );
  plans.removeLinks.mockImplementation((_tx: unknown, ids: unknown[]) =>
    Promise.resolve({ ok: true, value: ids.length }),
  );
  plans.deleteEmptyLines.mockImplementation((_tx: unknown, ids: string[]) => Promise.resolve(ids));
  plans.saveBudgetReason.mockResolvedValue({ ok: true, value: null });
  let next = 0;
  const newId = () => {
    next += 1;
    return `eeeeeeee-eeee-4eee-8eee-${String(next).padStart(12, '0')}`;
  };
  plans.insertLine.mockImplementation(() => Promise.resolve({ ok: true, value: newId() }));
  plans.insertLineWithNeeds.mockImplementation(() => Promise.resolve({ ok: true, value: newId() }));
  courses.getCourse.mockResolvedValue(null);
});

describe('who reaches the plan (deny by default)', () => {
  it('refuses the Employee, the Department Head and the Organization Admin', async () => {
    for (const role of ['learner', 'department_head', 'tenant_admin', 'hr_manager', 'finance']) {
      const { query, action } = runtime(role);
      const view = await query(defs.planQueryDefinition())({ cycleId: CYCLE });
      // WP-LD-03: the HR Manager and Finance read the plan they approve (never change it).
      if (role === 'hr_manager' || role === 'finance') {
        expect(view.ok && view.value.can, role).toMatchObject({ manage: false, open: false });
      } else {
        expect(!view.ok && view.error.code, role).toBe('FORBIDDEN');
      }
      const changed = await action(defs.updatePlanLineActionDefinition())({
        lineId: LEAD,
        version: 3,
        quarter: 4,
      });
      expect(!changed.ok && changed.error.code, role).toBe('FORBIDDEN');
    }
  });

  it('shows the plan to a role holding tms.training_plan.manage alone, through manage (L3)', async () => {
    const { query } = runtime(CUSTOM, ['tms.training_plan.manage']);
    const throughRead = await query(defs.planQueryDefinition())({ cycleId: CYCLE });
    expect(!throughRead.ok && throughRead.error.code).toBe('FORBIDDEN');
    const view = await query(defs.planQueryDefinition('manage'))({ cycleId: CYCLE });
    expect(view.ok && view.value.scope).toBe('departments');
    expect(view.ok && view.value.can.manage).toBe(true);
    expect(view.ok && view.value.lines.find((l) => l.id === LEAD)?.canEdit).toBe(true);
    // A role without either permission is refused both ways.
    const learner = runtime('learner');
    const refused = await learner.query(defs.planQueryDefinition('manage'))({ cycleId: CYCLE });
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });

  it('lets the Training Coordinator read but change nothing', async () => {
    const { query, action } = runtime('training_coordinator');
    const view = await query(defs.planQueryDefinition())({ cycleId: CYCLE });
    expect(view.ok && view.value.can).toEqual({ open: false, manage: false, addPending: false });
    expect(view.ok && view.value.lines.every((l) => !l.canEdit)).toBe(true);
    const changed = await action(defs.leaveOutPlanLineActionDefinition())({
      lineId: LEAD,
      version: 3,
      reason: 'No',
    });
    expect(!changed.ok && changed.error.code).toBe('FORBIDDEN');
    const opened = await action(defs.openConsolidationActionDefinition())({ cycleId: CYCLE });
    expect(!opened.ok && opened.error.code).toBe('FORBIDDEN');
  });
});

describe('the Plan tab (design screens 1–3)', () => {
  it('works out sessions, cost, shares, budget, groups and what needs attention', async () => {
    const { query } = runtime('training_manager');
    const view = await query(defs.planQueryDefinition())({ cycleId: CYCLE });
    if (!view.ok) throw new Error(view.error.code);
    const v = view.value;
    expect(v.scope).toBe('organization');
    const excel = v.lines.find((l) => l.id === EXCEL);
    expect(excel).toMatchObject({
      people: 47,
      named: 2,
      sessions: { sessions: 3, sizes: [16, 16, 15], belowMinimum: false },
      cost: '15000',
      canEdit: true,
      priorities: { high: 47, critical: 0, medium: 0, low: 0, none: 0 },
    });
    expect(excel?.departments).toEqual([
      { departmentId: SALES, seats: 20, named: 2, share: '6382.98' },
      { departmentId: HR, seats: 15, named: 0, share: '4787.23' },
      { departmentId: EAST, seats: 12, named: 0, share: '3829.79' },
    ]);
    expect(excel?.needs.map((n) => [n.needId, n.quarter, n.priority])).toEqual([
      [N1, 3, 'high'],
      [N2, 3, 'high'],
      [N3, 3, 'high'],
    ]);
    // Sales: 6382.98 of Excel; Leadership has no cost (not counted): within 10,000.
    expect(v.budget.departments.find((d) => d.departmentId === SALES)).toMatchObject({
      lines: 2,
      people: 25,
      cost: '6382.98',
      uncostedLines: 1,
      state: { kind: 'within', left: '3617.02' },
      needsReason: false,
    });
    expect(v.budget.departments.find((d) => d.departmentId === HR)).toMatchObject({
      cost: '4787.23',
      state: { kind: 'within', left: '212.77' },
    });
    expect(v.budget.total).toEqual({
      people: 52,
      cost: '15000',
      envelope: '15000',
      state: { kind: 'within', left: '0' },
    });
    expect(v.summary).toEqual({
      lines: 2,
      leftOut: 0,
      people: 52,
      // Excel's 3 and Leadership's 1 (sized, not costed yet).
      sessions: 4,
      cost: '15000',
      envelope: '15000',
    });
    expect(v.attention).toMatchObject({
      uncostedLineIds: [LEAD],
      lookAlikes: [],
      overBudgetWithoutReason: [],
      pending: { needs: 0, changed: 0, departmentIds: [] },
    });
    expect(v.groups.branch.map((g) => [g.key, g.people, g.cost])).toEqual([
      [RIYADH, 37, '10212.77'],
      [JEDDAH, 15, '4787.23'],
    ]);
    expect(v.groups.quarter.map((g) => [g.key, g.lineIds])).toEqual([['2', [EXCEL, LEAD]]]);
    expect(v.can).toEqual({ open: false, manage: true, addPending: false });
    expect(v.departments.map((d) => [d.id, d.version])).toEqual([
      [SALES, 4],
      [EAST, 2],
      [HR, 3],
    ]);
  });

  it('flags a department over its envelope without a reason, and pending needs of a resubmitted department', async () => {
    repo.getCycle.mockResolvedValue(
      cycleRecord({
        departments: [
          { departmentId: SALES, budgetAmount: '6000', status: 'submitted', deadline: null },
          { departmentId: EAST, budgetAmount: null, status: 'submitted', deadline: null },
          { departmentId: HR, budgetAmount: '5000', status: 'submitted', deadline: null },
        ],
      }),
    );
    plans.listCycleNeeds.mockResolvedValue([
      needRecord(N1, SALES, 'Excel', 25),
      needRecord(N2, HR, 'Excel', 15),
      needRecord(N3, EAST, 'excel', 12),
      needRecord(N4, SALES, 'Leadership', 5),
      needRecord('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9', SALES, 'Coaching', 3),
    ]);
    const { query } = runtime('training_manager');
    const view = await query(defs.planQueryDefinition())({ cycleId: CYCLE });
    if (!view.ok) throw new Error(view.error.code);
    expect(view.value.budget.departments.find((d) => d.departmentId === SALES)).toMatchObject({
      state: { kind: 'over', overBy: '382.98', percentOver: 6.4, severity: 'amber' },
      needsReason: true,
    });
    expect(view.value.attention.overBudgetWithoutReason).toEqual([SALES]);
    expect(view.value.attention.pending).toEqual({ needs: 1, changed: 1, departmentIds: [SALES] });
    expect(view.value.can.addPending).toBe(true);
  });

  it('says when the plan can be built, before it is (Q1 = A)', async () => {
    plans.getPlanByCycle.mockResolvedValue(null);
    repo.getCycle.mockResolvedValue(
      cycleRecord({
        status: 'open',
        departments: [
          { departmentId: SALES, budgetAmount: null, status: 'submitted', deadline: null },
          { departmentId: HR, budgetAmount: null, status: 'draft', deadline: null },
        ],
      }),
    );
    const { query } = runtime('training_manager');
    const view = await query(defs.planQueryDefinition())({ cycleId: CYCLE });
    expect(view.ok && view.value.readiness).toEqual({
      ready: false,
      reason: 'waiting_for_departments',
      waiting: 1,
    });
    expect(view.ok && view.value.plan).toBeNull();
    expect(view.ok && view.value.can.open).toBe(false);
  });

  it('shows a department-limited L&D Manager its units only: lines, needs, budget, total', async () => {
    const { query } = runtime(CUSTOM);
    const view = await query(defs.planQueryDefinition())({ cycleId: CYCLE });
    if (!view.ok) throw new Error(view.error.code);
    const v = view.value;
    expect(v.scope).toBe('departments');
    // Sales and East (below Sales): never HR.
    expect(v.departments.map((d) => d.id)).toEqual([SALES, EAST]);
    expect(v.budget.departments.map((d) => d.departmentId)).toEqual([SALES, EAST]);
    const excel = v.lines.find((l) => l.id === EXCEL);
    // The shared line: its seats and shares, but only Sales' and East's needs, and no edit.
    expect(excel?.people).toBe(47);
    expect(excel?.needs.map((n) => n.departmentId)).toEqual([SALES, EAST]);
    expect(excel?.canEdit).toBe(false);
    expect(v.lines.find((l) => l.id === LEAD)?.canEdit).toBe(true);
    // Its total is its departments' shares (6382.98 + 3829.79), not the plan's.
    expect(v.budget.total).toMatchObject({ people: 37, cost: '10212.77', envelope: '10000' });
    expect(v.summary.cost).toBe('10212.77');
    expect(v.can).toEqual({ open: false, manage: true, addPending: false });
  });

  it('tells a department-limited planner of none of the cycle’s departments nothing', async () => {
    repo.getCycle.mockResolvedValue(
      cycleRecord({
        departments: [
          { departmentId: HR, budgetAmount: null, status: 'submitted', deadline: null },
        ],
      }),
    );
    const { query } = runtime(CUSTOM);
    const view = await query(defs.planQueryDefinition())({ cycleId: CYCLE });
    expect(!view.ok && view.error.code).toBe('NOT_FOUND');
  });
});

describe('opening the plan (Q1 = A)', () => {
  beforeEach(() => {
    plans.getPlanByCycle.mockResolvedValue(null);
    plans.closeNeeds.mockResolvedValue({ ok: true, value: 7 });
    plans.insertPlan.mockResolvedValue({ ok: true, value: planRecord() });
  });

  it('waits for every department before the deadline', async () => {
    repo.getCycle.mockResolvedValue(
      cycleRecord({
        status: 'open',
        departments: [
          { departmentId: SALES, budgetAmount: null, status: 'submitted', deadline: null },
          { departmentId: HR, budgetAmount: null, status: 'returned', deadline: null },
        ],
      }),
    );
    const { action } = runtime('training_manager');
    const refused = await action(defs.openConsolidationActionDefinition())({ cycleId: CYCLE });
    expect(!refused.ok && refused.error.code).toBe('TRAINING_PLAN_NOT_READY');
    expect(!refused.ok && refused.error.params).toEqual({
      reason: 'waiting_for_departments',
      waiting: 1,
    });
    expect(plans.insertPlan).not.toHaveBeenCalled();
  });

  it('closes the needs now and builds the lines once, audited', async () => {
    repo.getCycle.mockResolvedValue(cycleRecord({ status: 'open' }));
    const { action, audits } = runtime('training_manager');
    const opened = await action(defs.openConsolidationActionDefinition())({ cycleId: CYCLE });
    expect(opened.ok && opened.value).toEqual({
      cycleId: CYCLE,
      planId: PLAN,
      lines: 2,
      needs: 4,
      closedEarly: true,
    });
    expect(plans.closeNeeds).toHaveBeenCalledWith({}, CYCLE);
    // Excel (Sales, HR, East: one topic whatever the case) and Leadership, in Q3 as asked.
    expect(plans.insertLine.mock.calls.map((c: unknown[]) => c[2])).toEqual([
      expect.objectContaining({ groupKey: 'topic:excel', title: 'Excel', quarter: 3 }),
      expect.objectContaining({ groupKey: 'topic:leadership', title: 'Leadership', quarter: 3 }),
    ]);
    expect(audits).toEqual([
      {
        action: 'tms.training_plan.opened',
        entityType: 'training_plan',
        entityId: PLAN,
        data: { cycleId: CYCLE, lines: 2, needs: 4, closedEarly: true },
      },
    ]);
  });

  it('pre-fills a library course’s sizes and costs (D12)', async () => {
    plans.listCycleNeeds.mockResolvedValue([
      { ...needRecord(N1, SALES, 'Leading teams', 10), courseId: 'course-1' },
    ]);
    courses.getCourse.mockResolvedValue({
      id: 'course-1',
      status: 'active',
      deliveryType: 'classroom',
      minParticipants: 6,
      maxParticipants: 18,
      estCostPerSession: 4200.5,
      estCostPerParticipant: 120,
      costCurrency: 'SAR',
      durationHours: 12,
    });
    const { action } = runtime('training_manager');
    await action(defs.openConsolidationActionDefinition())({ cycleId: CYCLE });
    expect(plans.insertLine.mock.calls[0]?.[2]).toEqual({
      groupKey: 'course:course-1',
      title: 'Leading teams',
      courseId: 'course-1',
      deliveryType: 'classroom',
      category: null,
      quarter: 3,
      minPerSession: 6,
      maxPerSession: 18,
      costPerSession: '4200.5',
      costPerPerson: '120',
      durationHours: 12,
    });
  });

  it('refuses a plan already built and a department-limited L&D Manager', async () => {
    plans.getPlanByCycle.mockResolvedValue(planRecord());
    const lnd = runtime('training_manager');
    const again = await lnd.action(defs.openConsolidationActionDefinition())({ cycleId: CYCLE });
    expect(!again.ok && again.error.code).toBe('TRAINING_PLAN_ALREADY_OPEN');
    const limited = runtime(CUSTOM);
    const refused = await limited.action(defs.openConsolidationActionDefinition())({
      cycleId: CYCLE,
    });
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });
});

describe('changing lines', () => {
  it('saves a line’s sizes and costs; audits what changed', async () => {
    const { action, audits } = runtime('training_manager');
    const saved = await action(defs.updatePlanLineActionDefinition())({
      lineId: EXCEL,
      version: 3,
      maxPerSession: 25,
      costPerSession: '5,500.50',
      quarter: 2,
    });
    expect(saved.ok && saved.value).toMatchObject({
      version: 4,
      changed: ['maxPerSession', 'costPerSession'],
    });
    // Only what changes is written, amounts as stored (canonical).
    expect(plans.updateLine).toHaveBeenCalledWith({}, EXCEL, 3, {
      maxPerSession: 25,
      costPerSession: '5500.5',
    });
    expect(audits).toEqual([
      {
        action: 'tms.training_plan.line_changed',
        entityType: 'training_plan',
        entityId: PLAN,
        data: {
          lineId: EXCEL,
          changed: ['maxPerSession', 'costPerSession'],
          before: { maxPerSession: 20, costPerSession: '5000' },
          after: { maxPerSession: 25, costPerSession: '5500.5' },
        },
      },
    ]);
  });

  it('neither writes, stamps nor audits a save that changes nothing (L5)', async () => {
    const { action, audits } = runtime('training_manager');
    // Stored: 5000 per session, max 20, quarter 2 — typed again with grouping and trailing zeros.
    const saved = await action(defs.updatePlanLineActionDefinition())({
      lineId: EXCEL,
      version: 3,
      costPerSession: '5,000.000',
      maxPerSession: 20,
      quarter: 2,
      title: 'Excel',
    });
    expect(saved.ok && saved.value).toMatchObject({ version: 3, changed: [] });
    expect(plans.updateLine).not.toHaveBeenCalled();
    expect(audits).toEqual([]);
  });

  it('refuses a minimum above the maximum, an unknown course, a stale version and a frozen plan', async () => {
    const { action } = runtime('training_manager');
    const sizes = await action(defs.updatePlanLineActionDefinition())({
      lineId: EXCEL,
      version: 3,
      minPerSession: 30,
    });
    expect(!sizes.ok && sizes.error.fieldErrors).toEqual([
      { path: 'minPerSession', code: 'ABOVE_MAXIMUM' },
    ]);
    const course = await action(defs.updatePlanLineActionDefinition())({
      lineId: EXCEL,
      version: 3,
      courseId: '12345678-1234-4234-8234-123456789012',
    });
    expect(!course.ok && course.error.fieldErrors).toEqual([{ path: 'courseId', code: 'UNKNOWN' }]);
    const stale = await action(defs.updatePlanLineActionDefinition())({
      lineId: EXCEL,
      version: 2,
      quarter: 1,
    });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');
    plans.getPlan.mockResolvedValue(planRecord({ status: 'in_approval' }));
    const frozen = await action(defs.updatePlanLineActionDefinition())({
      lineId: EXCEL,
      version: 3,
      quarter: 1,
    });
    expect(!frozen.ok && frozen.error.code).toBe('TRAINING_PLAN_FROZEN');
    expect(plans.updateLine).not.toHaveBeenCalled();
  });

  it('lets a department-limited L&D Manager change its own line, never a shared one (feedback #4)', async () => {
    const { action } = runtime(CUSTOM);
    const shared = await action(defs.updatePlanLineActionDefinition())({
      lineId: EXCEL,
      version: 3,
      quarter: 4,
    });
    expect(!shared.ok && shared.error.code).toBe('TRAINING_PLAN_LINE_OUTSIDE_SCOPE');
    const own = await action(defs.updatePlanLineActionDefinition())({
      lineId: LEAD,
      version: 3,
      quarter: 4,
    });
    expect(own.ok).toBe(true);
    const merge = await action(defs.mergePlanLinesActionDefinition())({
      lines: [
        { id: EXCEL, version: 3 },
        { id: LEAD, version: 3 },
      ],
      intoLineId: LEAD,
      title: 'Mine',
    });
    expect(!merge.ok && merge.error.code).toBe('TRAINING_PLAN_LINE_OUTSIDE_SCOPE');
    const reason = await action(defs.setBudgetReasonActionDefinition())({
      planId: PLAN,
      departmentId: HR,
      reason: 'Not mine',
    });
    expect(!reason.ok && reason.error.code).toBe('FORBIDDEN');
    const mine = await action(defs.setBudgetReasonActionDefinition())({
      planId: PLAN,
      departmentId: EAST,
      reason: 'New branch',
    });
    expect(mine.ok).toBe(true);
  });

  it('merges lines: the needs move into the line that stays, the others go; audited', async () => {
    const { action, audits } = runtime('training_manager');
    const merged = await action(defs.mergePlanLinesActionDefinition())({
      lines: [
        { id: EXCEL, version: 3 },
        { id: LEAD, version: 3 },
      ],
      intoLineId: EXCEL,
      title: 'Excel and leadership',
    });
    expect(merged.ok && merged.value).toMatchObject({
      lineId: EXCEL,
      mergedLineIds: [LEAD],
      needs: 4,
    });
    expect(plans.moveLinks).toHaveBeenCalledWith({}, [N4], EXCEL);
    expect(plans.updateLine).toHaveBeenCalledWith({}, EXCEL, 3, { title: 'Excel and leadership' });
    expect(plans.deleteEmptyLines).toHaveBeenCalledWith({}, [LEAD]);
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'tms.training_plan.lines_merged',
        data: { lineId: EXCEL, mergedLineIds: [LEAD], title: 'Excel and leadership', needs: 4 },
      }),
    ]);
  });

  it('moves a need out into a line of its own, never the only need of a line', async () => {
    const { action, audits } = runtime('training_manager');
    const only = await action(defs.moveNeedOutActionDefinition())({
      lineId: LEAD,
      version: 3,
      needId: N4,
    });
    expect(!only.ok && only.error.fieldErrors).toEqual([{ path: 'needId', code: 'ONLY_NEED' }]);
    const moved = await action(defs.moveNeedOutActionDefinition())({
      lineId: EXCEL,
      version: 3,
      needId: N3,
      title: 'Excel for East',
    });
    expect(moved.ok && moved.value).toMatchObject({ fromLineId: EXCEL, needId: N3 });
    // The new line and the move in one step: never an empty line left behind.
    expect(plans.insertLineWithNeeds).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: PLAN }),
      expect.objectContaining({
        title: 'Excel for East',
        groupKey: 'topic:excel',
        quarter: 3,
        maxPerSession: 20,
        costPerSession: '5000',
      }),
      [N3],
    );
    expect(plans.insertLine).not.toHaveBeenCalled();
    expect(plans.moveLinks).not.toHaveBeenCalled();
    expect(audits).toHaveLength(1);
    // Refused (e.g. outside a department-limited planner's cycles): an outcome, nothing half done.
    plans.insertLineWithNeeds.mockResolvedValueOnce({ ok: false, refusal: 'not_allowed' });
    const refused = await action(defs.moveNeedOutActionDefinition())({
      lineId: EXCEL,
      version: 3,
      needId: N3,
    });
    expect(!refused.ok && refused.error.code).toBe('TRAINING_PLAN_LINE_OUTSIDE_SCOPE');
  });

  it('names a moved-out line after its need: at most 500 characters, trimmed, never half a character (L6)', async () => {
    const { action } = runtime('training_manager');
    // 499 letters, a space, then an emoji (two UTF-16 units): cut at 500 code points it ends with the space.
    const topic = `${'a'.repeat(499)} 😀 more`;
    plans.listCycleNeeds.mockResolvedValue([
      needRecord(N1, SALES, 'Excel', 20),
      needRecord(N2, HR, 'Excel', 15),
      needRecord(N3, EAST, topic, 12),
      needRecord(N4, SALES, 'Leadership', 5),
    ]);
    await action(defs.moveNeedOutActionDefinition())({ lineId: EXCEL, version: 3, needId: N3 });
    const title = (plans.insertLineWithNeeds.mock.calls[0]?.[2] as { title: string }).title;
    expect(title).toBe('a'.repeat(499));
    expect(defs.lineTitle(`${'b'.repeat(499)}😀`)).toBe(`${'b'.repeat(499)}😀`);
    expect(Array.from(defs.lineTitle(`${'b'.repeat(499)}😀😀`))).toHaveLength(500);
    expect(defs.lineTitle(`  ${'c'.repeat(600)}`)).toBe('c'.repeat(500));
  });

  it('changes the quarter of several lines, all or none', async () => {
    const { action, audits } = runtime('training_manager');
    const done = await action(defs.setPlanLinesQuarterActionDefinition())({
      lines: [
        { id: EXCEL, version: 3 },
        { id: LEAD, version: 3 },
      ],
      quarter: 4,
    });
    expect(done.ok && done.value.lines.map((l) => l.version)).toEqual([4, 4]);
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'tms.training_plan.lines_quarter_changed',
        data: {
          quarter: 4,
          lines: [
            { lineId: EXCEL, before: 2 },
            { lineId: LEAD, before: 2 },
          ],
        },
      }),
    ]);
    plans.updateLine.mockResolvedValueOnce({ outcome: 'conflict' });
    const conflict = await action(defs.setPlanLinesQuarterActionDefinition())({
      lines: [{ id: EXCEL, version: 3 }],
      quarter: 1,
    });
    expect(!conflict.ok && conflict.error.code).toBe('CONFLICT_VERSION');
  });

  it('leaves a line out with a reason and brings it back; the reason is audited by its length', async () => {
    const { action, audits } = runtime('training_manager');
    const out = await action(defs.leaveOutPlanLineActionDefinition())({
      lineId: LEAD,
      version: 3,
      reason: 'Covered by e-learning',
    });
    expect(out.ok && out.value.status).toBe('left_out');
    expect(plans.updateLine).toHaveBeenLastCalledWith({}, LEAD, 3, {
      status: 'left_out',
      leftOutReason: 'Covered by e-learning',
    });
    const blank = await action(defs.leaveOutPlanLineActionDefinition())({
      lineId: LEAD,
      version: 3,
      reason: '   ',
    });
    expect(!blank.ok && blank.error.code).toBe('VALIDATION_FAILED');
    const back = await action(defs.bringBackPlanLineActionDefinition())({
      lineId: LEAD,
      version: 3,
    });
    expect(back.ok && back.value.status).toBe('in_plan');
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'tms.training_plan.line_left_out',
        data: { lineId: LEAD, reasonLength: 21 },
      }),
      expect.objectContaining({ action: 'tms.training_plan.line_brought_back' }),
    ]);
  });

  it('sets and removes a department’s over-budget reason (audited without its words)', async () => {
    const { action, audits } = runtime('training_manager');
    const set = await action(defs.setBudgetReasonActionDefinition())({
      planId: PLAN,
      departmentId: SALES,
      reason: 'Two extra sessions requested by the CEO',
    });
    expect(set.ok).toBe(true);
    plans.saveBudgetReason.mockResolvedValue({ ok: true, value: 'Two extra sessions' });
    const cleared = await action(defs.setBudgetReasonActionDefinition())({
      planId: PLAN,
      departmentId: SALES,
      reason: '',
    });
    expect(cleared.ok && cleared.value.after).toEqual({ given: false, length: null });
    expect(plans.saveBudgetReason).toHaveBeenLastCalledWith({}, expect.anything(), SALES, null);
    const outside = await action(defs.setBudgetReasonActionDefinition())({
      planId: PLAN,
      departmentId: '12345678-1234-4234-8234-123456789012',
      reason: 'x',
    });
    expect(!outside.ok && outside.error.fieldErrors).toEqual([
      { path: 'departmentId', code: 'NOT_IN_CYCLE' },
    ]);
    expect(JSON.stringify(audits)).not.toContain('CEO');
  });
});

describe('adding what resubmitted departments changed (D14)', () => {
  it('joins an untouched matching line, makes new lines for the rest, takes changed seats again', async () => {
    plans.listCycleNeeds.mockResolvedValue([
      needRecord(N1, SALES, 'Excel', 25),
      needRecord(N2, HR, 'Excel', 15),
      needRecord(N3, EAST, 'excel', 12),
      needRecord(N4, SALES, 'Leadership', 5),
      needRecord('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8', SALES, 'EXCEL!', 2),
      needRecord('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9', SALES, 'Coaching', 3),
      {
        ...needRecord('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbba', HR, 'Safety', 3),
        departmentStatus: 'returned',
      },
    ]);
    const { action, audits } = runtime('training_manager');
    const synced = await action(defs.syncPlanNeedsActionDefinition())({ planId: PLAN });
    expect(synced.ok && synced.value).toEqual({
      planId: PLAN,
      added: 2,
      regrouped: 0,
      newLines: 1,
      refreshed: 1,
      removedLines: 0,
    });
    expect(plans.insertLinks.mock.calls[0]?.[2]).toEqual([
      { lineId: EXCEL, needId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8', departmentId: SALES },
    ]);
    expect(plans.refreshLinks).toHaveBeenCalledWith({}, [N1]);
    expect(audits).toHaveLength(1);
  });

  it('moves a need whose topic changed to the line of its new topic, never a merged line’s other needs (M2)', async () => {
    const COACHING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
    // Excel was merged with Leadership by L&D (an edited line holding two topics); HR then changed its Excel need
    // to «Coaching» and resubmitted; a Coaching line built from the needs exists.
    plans.listLines.mockResolvedValue([
      lineRecord(EXCEL, { editedAt: new Date(), title: 'Excel and leadership' }),
      lineRecord(COACHING, { title: 'Coaching', groupKey: 'topic:coaching' }),
    ]);
    plans.listLinks.mockResolvedValue([
      ...links.slice(0, 3),
      { ...links[3], lineId: EXCEL },
      {
        needId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7',
        lineId: COACHING,
        departmentId: SALES,
        seats: 3,
        named: 0,
        topic: 'Coaching',
        courseId: null,
      },
    ]);
    plans.listCycleNeeds.mockResolvedValue([
      needRecord(N1, SALES, 'Excel', 20),
      needRecord(N2, HR, 'Coaching!', 15),
      needRecord(N3, EAST, 'excel', 12),
      needRecord(N4, SALES, 'Leadership', 5),
      needRecord('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7', SALES, 'Coaching', 3),
    ]);
    const { action, audits } = runtime('training_manager');
    const synced = await action(defs.syncPlanNeedsActionDefinition())({ planId: PLAN });
    expect(synced.ok && synced.value).toEqual({
      planId: PLAN,
      added: 0,
      regrouped: 1,
      newLines: 0,
      refreshed: 0,
      removedLines: 0,
    });
    // Only HR's need leaves the merged line (Leadership stays: its topic did not change).
    expect(plans.removeLinks).toHaveBeenCalledWith({}, [N2]);
    expect(plans.insertLinks.mock.calls[0]?.[2]).toEqual([
      { lineId: COACHING, needId: N2, departmentId: HR },
    ]);
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'tms.training_plan.needs_added',
        data: { added: 0, regrouped: 1, newLines: 0, refreshed: 0, removedLines: 0 },
      }),
    ]);
  });

  it('gives a changed need of an edited line a new line, and removes the line it leaves empty (M2)', async () => {
    plans.listLines.mockResolvedValue([
      lineRecord(EXCEL),
      lineRecord(LEAD, { title: 'Leadership', groupKey: 'topic:leadership', editedAt: new Date() }),
    ]);
    plans.listCycleNeeds.mockResolvedValue([
      needRecord(N1, SALES, 'Excel', 20),
      needRecord(N2, HR, 'Excel', 15),
      needRecord(N3, EAST, 'excel', 12),
      { ...needRecord(N4, SALES, 'Leading teams', 5), courseId: 'course-9' },
    ]);
    const { action } = runtime('training_manager');
    const synced = await action(defs.syncPlanNeedsActionDefinition())({ planId: PLAN });
    expect(synced.ok && synced.value).toMatchObject({ added: 0, regrouped: 1, newLines: 1 });
    expect(plans.insertLine.mock.calls[0]?.[2]).toMatchObject({
      groupKey: 'course:course-9',
      title: 'Leading teams',
    });
    expect(plans.deleteEmptyLines).toHaveBeenCalledWith({}, [LEAD]);
  });

  it('leaves a shared line’s changes to the organization-wide L&D Manager; a department-limited planner is not told of them (L4)', async () => {
    plans.listCycleNeeds.mockResolvedValue([
      needRecord(N1, SALES, 'Excel', 25),
      needRecord(N2, HR, 'Excel', 15),
      needRecord(N3, EAST, 'Negotiation', 12),
      needRecord(N4, SALES, 'Leadership', 7),
    ]);
    const limited = runtime(CUSTOM);
    const view = await limited.query(defs.planQueryDefinition())({ cycleId: CYCLE });
    // Sales' changed seats in the shared Excel line and East's changed topic there: not its to add.
    expect(view.ok && view.value.attention.pending).toEqual({
      needs: 0,
      changed: 1,
      departmentIds: [SALES],
    });
    const synced = await limited.action(defs.syncPlanNeedsActionDefinition())({ planId: PLAN });
    expect(synced.ok && synced.value).toMatchObject({ regrouped: 0, refreshed: 1 });
    expect(plans.refreshLinks).toHaveBeenCalledWith({}, [N4]);
    expect(plans.removeLinks).toHaveBeenCalledWith({}, []);
    const lnd = runtime('training_manager');
    const all = await lnd.query(defs.planQueryDefinition())({ cycleId: CYCLE });
    expect(all.ok && all.value.attention.pending).toEqual({
      needs: 0,
      changed: 3,
      departmentIds: [EAST, SALES],
    });
  });

  it('never joins a line L&D edited', async () => {
    plans.listLines.mockResolvedValue([
      lineRecord(EXCEL, { editedAt: new Date() }),
      lineRecord(LEAD, { title: 'Leadership', groupKey: 'topic:leadership' }),
    ]);
    plans.listCycleNeeds.mockResolvedValue([
      needRecord(N1, SALES, 'Excel', 20),
      needRecord(N2, HR, 'Excel', 15),
      needRecord(N3, EAST, 'excel', 12),
      needRecord(N4, SALES, 'Leadership', 5),
      needRecord('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8', SALES, 'Excel', 2),
    ]);
    const { action } = runtime('training_manager');
    const synced = await action(defs.syncPlanNeedsActionDefinition())({ planId: PLAN });
    expect(synced.ok && synced.value).toMatchObject({ added: 1, newLines: 1 });
    expect(plans.insertLinks.mock.calls[0]?.[2]).toEqual([]);
  });
});

describe('planScope', () => {
  it('is the organization, or the granted units with everything below them', () => {
    expect(defs.planScope([{ permission: 'x', scope: { type: 'tenant' } }], structure)).toEqual({
      organization: true,
      units: new Set(),
    });
    expect(
      defs.planScope(
        [
          {
            permission: 'x',
            scope: { type: 'org_units', orgUnitIds: [SALES], includeDescendants: true },
          },
        ],
        structure,
      ).units,
    ).toEqual(new Set([SALES, EAST]));
    expect(defs.planScope([{ permission: 'x', scope: { type: 'own' } }], structure)).toEqual({
      organization: false,
      units: new Set(),
    });
  });
});
