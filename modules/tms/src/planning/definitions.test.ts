/**
 * Planning cycle definitions with a fake runtime (EP-PLN, T-M3-04): authorization by the real standard
 * roles (positive and negative), validation, outcomes and audit records. The repository and the platform
 * services are replaced; planning.integration.test.ts runs the same definitions against PostgreSQL.
 */
import { ok } from '@jadarat/platform-core';
import type { UserTx } from '@jadarat/platform-db';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  listOrgStructure: vi.fn(),
  getMemberOptionsByIds: vi.fn(),
  searchMemberOptions: vi.fn(),
  MEMBER_SEARCH: { minLength: 2, maxLength: 100, limit: 50 },
  getOrganizationProfile: vi.fn(),
  listStructureLevelLabels: vi.fn(),
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
  listCycles: vi.fn(),
  getCycle: vi.fn(),
  openCycle: vi.fn(),
  getSettings: vi.fn(),
  insertCycle: vi.fn(),
  touchCycle: vi.fn(),
  updateBasics: vi.fn(),
  replaceScope: vi.fn(),
  syncDepartments: vi.fn(),
  updateBudgets: vi.fn(),
  replaceSteps: vi.fn(),
  updateReminders: vi.fn(),
  closeDueCycles: vi.fn(),
  launch: vi.fn(),
  extendDeadline: vi.fn(),
  deleteDraft: vi.fn(),
  saveSettings: vi.fn(),
  normalizeAmount: (v: string | null) => v,
}));
vi.mock('./repository', () => repo);

const forms = vi.hoisted(() => ({ listNeedsFormOptions: vi.fn() }));
vi.mock('./needs-forms', () => forms);

const { createDefineAction, createDefineQuery, grantsForAssignments } =
  await import('@jadarat/platform-rbac');
const defs = await import('./definitions');

const TENANT = '22222222-2222-4222-8222-222222222222';
const CYCLE = '55555555-5555-4555-8555-555555555555';
const SALES = '66666666-6666-4666-8666-666666666661';
const EAST = '66666666-6666-4666-8666-666666666662';
const JED = '77777777-7777-4777-8777-777777777771';
const CFO = '88888888-8888-4888-8888-888888888881';
const GM = '88888888-8888-4888-8888-888888888882';
const HEAD = '88888888-8888-4888-8888-888888888883';
const FORM = '99999999-9999-4999-8999-999999999991';

const claims = brandVerifiedClaims({
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'authenticated',
  aal: 'aal1',
  session_id: '33333333-3333-4333-8333-333333333333',
  tenant_id: TENANT,
  person_id: '44444444-4444-4444-8444-444444444444',
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

const structure = {
  departments: [
    {
      id: SALES,
      parentId: null,
      branchId: null,
      code: 'S',
      nameAr: 'المبيعات',
      nameEn: 'Sales',
      active: true,
      sortOrder: 0,
      levelOrdinal: 1,
      head: { personId: HEAD, nameAr: 'رئيس', nameEn: 'Head' },
    },
    {
      id: EAST,
      parentId: SALES,
      branchId: JED,
      code: 'SE',
      nameAr: 'الشرق',
      nameEn: null,
      active: true,
      sortOrder: 0,
      levelOrdinal: 2,
      head: null,
    },
  ],
  branches: [{ id: JED, nameAr: 'جدة', nameEn: 'Jeddah', active: true }],
};

/** The organization's own level names (guided-test feedback #3). */
const LEVELS = [
  { ordinal: 1, nameEn: 'Sector', nameAr: 'قطاع' },
  { ordinal: 2, nameEn: 'Division', nameAr: 'شعبة' },
];

const chain = [
  { kind: 'department_heads', nameAr: 'رؤساء', nameEn: 'Heads', approverPersonId: null },
  { kind: 'person', nameAr: 'مالية', nameEn: 'Finance', approverPersonId: CFO },
  { kind: 'person', nameAr: 'إدارة', nameEn: 'Management', approverPersonId: GM },
] as const;

const record = (over: Record<string, unknown> = {}) => ({
  id: CYCLE,
  nameAr: 'خطة',
  nameEn: 'Plan',
  periodStart: '2027-01-01',
  periodEnd: '2027-12-31',
  deadline: '2026-11-30',
  instructionsAr: null,
  instructionsEn: 'Old words',
  needsFormId: FORM,
  reminderDays: [7, 2],
  currency: 'SAR',
  status: 'draft',
  launchedAt: null,
  launchedBy: null,
  closedAt: null,
  version: 3,
  scope: { departmentIds: [SALES], branchIds: [] },
  departments: [
    { departmentId: SALES, budgetAmount: '50000', status: 'not_started' },
    { departmentId: EAST, budgetAmount: null, status: 'not_started' },
  ],
  steps: chain,
  ...over,
});

const members = [
  { personId: CFO, nameAr: 'المالي', nameEn: 'CFO', active: true },
  { personId: GM, nameAr: 'المدير', nameEn: 'GM', active: true },
];

beforeEach(() => {
  repo.organizationToday.mockResolvedValue('2026-10-17');
  repo.getCycle.mockResolvedValue(record());
  repo.openCycle.mockResolvedValue(null);
  repo.touchCycle.mockResolvedValue({ outcome: 'ok', version: 4 });
  repo.closeDueCycles.mockResolvedValue([]);
  db.listOrgStructure.mockResolvedValue(structure);
  db.listStructureLevelLabels.mockResolvedValue(LEVELS);
  db.getMemberOptionsByIds.mockResolvedValue(members);
  db.getOrganizationProfile.mockResolvedValue({ fiscalYearStartMonth: 7, currencyCode: 'AED' });
  forms.listNeedsFormOptions.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

const basics = {
  nameAr: 'خطة ٢٠٢٧',
  nameEn: 'Plan 2027',
  periodStart: '2027-01-01',
  periodEnd: '2027-12-31',
  deadline: '2026-11-30',
};

describe('who may do what (deny by default)', () => {
  const manageActions = () => [
    defs.createPlanCycleActionDefinition(),
    defs.launchPlanCycleActionDefinition(),
    defs.deletePlanCycleActionDefinition(),
    defs.savePlanningSettingsActionDefinition(),
  ];

  it.each(['training_coordinator', 'tenant_admin', 'hr_manager', 'department_head', 'learner'])(
    '%s cannot create, launch, delete or change the settings (403)',
    async (role) => {
      const { action, audits } = runtime(role, role === 'department_head' ? [SALES] : []);
      const inputs: unknown[] = [
        basics,
        { id: CYCLE, version: 3 },
        { id: CYCLE, version: 3 },
        { reminderDays: [7], steps: [...chain] },
      ];
      for (const [index, definition] of manageActions().entries()) {
        const result = await action(definition as never)(inputs[index]);
        expect(!result.ok && result.error.code, `${role} #${String(index)}`).toBe('FORBIDDEN');
      }
      expect(repo.insertCycle).not.toHaveBeenCalled();
      expect(repo.launch).not.toHaveBeenCalled();
      expect(audits).toEqual([]);
    },
  );

  it.each(['tenant_admin', 'hr_manager', 'department_head', 'learner'])(
    '%s cannot read planning cycles (403)',
    async (role) => {
      const { query } = runtime(role, role === 'department_head' ? [SALES] : []);
      const list = await query(defs.planCyclesListQueryDefinition())({});
      expect(!list.ok && list.error.code).toBe('FORBIDDEN');
      const one = await query(defs.planCycleQueryDefinition())({ id: CYCLE });
      expect(!one.ok && one.error.code).toBe('FORBIDDEN');
    },
  );

  it('the Training Coordinator reads the list, a cycle and the settings, without editing', async () => {
    repo.listCycles.mockResolvedValue([]);
    repo.getSettings.mockResolvedValue({ version: null, reminderDays: [7, 2], steps: chain });
    const { query } = runtime('training_coordinator');
    const list = await query(defs.planCyclesListQueryDefinition())({});
    expect(list.ok && list.value.canManage).toBe(false);
    const one = await query(defs.planCycleQueryDefinition())({ id: CYCLE });
    expect(one.ok && one.value.editable).toBe(false);
    expect(one.ok && one.value.setup).toBeNull();
    const settings = await query(defs.planningSettingsQueryDefinition())({});
    expect(settings.ok && settings.value.canManage).toBe(false);
    const fresh = await query(defs.newPlanCycleQueryDefinition())({});
    expect(!fresh.ok && fresh.error.code).toBe('FORBIDDEN');
  });

  it('validates untrusted input before any database work (422)', async () => {
    const { action } = runtime('training_manager');
    const result = await action(defs.savePlanCycleScopeActionDefinition())({
      id: '1 or 1=1',
      version: 1,
      departmentIds: [],
      branchIds: [],
    });
    expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
    expect(repo.getCycle).not.toHaveBeenCalled();
  });
});

describe('L&D Manager: list, new cycle, cycle view', () => {
  it('lists cycles with an open cycle past its deadline shown as Closed, and counts per tab', async () => {
    const row = {
      id: CYCLE,
      nameAr: 'خطة',
      nameEn: 'Plan',
      periodStart: '2027-01-01',
      periodEnd: '2027-12-31',
      deadline: '2026-10-01',
      status: 'open',
      departmentCount: 4,
      submittedCount: 0,
      launchedAt: new Date(),
      createdAt: new Date(),
    };
    repo.listCycles.mockResolvedValue([row, { ...row, id: 'd', status: 'draft' }]);
    const { query } = runtime('training_manager');
    const result = await query(defs.planCyclesListQueryDefinition())({});
    expect(result.ok && result.value.cycles.map((c) => c.status)).toEqual(['closed', 'draft']);
    expect(result.ok && result.value.counts).toEqual({ all: 2, draft: 1, open: 0, closed: 1 });
    expect(result.ok && result.value.canManage).toBe(true);
  });

  it('proposes the next fiscal year and a deadline; the currency is the organization’s', async () => {
    const { query } = runtime('training_manager');
    const result = await query(defs.newPlanCycleQueryDefinition())({});
    expect(result.ok && result.value).toEqual({
      today: '2026-10-17',
      defaults: { periodStart: '2027-07-01', periodEnd: '2028-06-30', deadline: '2026-11-16' },
      currency: 'AED',
      needsForms: [],
    });
  });

  it('shows a draft with its departments, heads (own or from above), steps and readiness', async () => {
    const { query } = runtime('training_manager');
    const result = await query(defs.planCycleQueryDefinition())({ id: CYCLE });
    if (!result.ok) throw new Error(result.error.code);
    const view = result.value;
    expect(view.editable).toBe(true);
    expect(view.problems).toEqual([]);
    expect(
      view.departments.map((d) => [d.departmentId, d.status, d.head?.via?.en ?? null]),
    ).toEqual([
      [SALES, 'not_started', null],
      [EAST, 'not_started', 'Sales'],
    ]);
    expect(view.withoutHead).toBe(0);
    expect(view.steps.map((s) => s.approverName?.en ?? null)).toEqual([null, 'CFO', 'GM']);
    expect(view.setup?.units.map((u) => [u.id, u.depth, u.levelOrdinal])).toEqual([
      [SALES, 0, 1],
      [EAST, 1, 2],
    ]);
    // The level of each row and the organization's level names, for the tables' labels.
    expect(view.departments.map((d) => d.levelOrdinal)).toEqual([1, 2]);
    expect(view.levels).toEqual(LEVELS);
    expect(db.getMemberOptionsByIds).toHaveBeenCalledWith(expect.anything(), expect.any(Array));
    expect(view.setup?.needsForms).toEqual([]);
  });

  it('shows the progress of an open cycle; Late after the deadline; not-ready problems of a draft', async () => {
    repo.getCycle.mockResolvedValue(record({ status: 'open', deadline: '2026-10-10' }));
    const { query } = runtime('training_manager');
    const open = await query(defs.planCycleQueryDefinition())({ id: CYCLE });
    expect(open.ok && open.value.status).toBe('closed');
    expect(open.ok && open.value.departments.map((d) => d.status)).toEqual(['late', 'late']);
    // C-7: shown as Closed by date, still open in the database — the L&D Manager can extend it.
    expect(open.ok && open.value.canExtend).toBe(true);
    expect(open.ok && open.value.setup).toBeNull();

    repo.getCycle.mockResolvedValue(
      record({ departments: [], steps: [chain[0]], deadline: '2026-10-01', needsFormId: null }),
    );
    repo.openCycle.mockResolvedValue({ id: 'other', deadline: '2026-12-01' });
    const draft = await query(defs.planCycleQueryDefinition())({ id: CYCLE });
    expect(draft.ok && draft.value.problems).toEqual([
      'deadline_past',
      'no_needs_form',
      'no_departments',
      'no_approver_step',
      'another_open',
    ]);
  });

  it('answers 404 for a cycle it cannot see (another organization: RLS returns nothing)', async () => {
    repo.getCycle.mockResolvedValue(null);
    const { query } = runtime('training_manager');
    const result = await query(defs.planCycleQueryDefinition())({ id: CYCLE });
    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
  });
});

describe('L&D Manager: set-up steps', () => {
  it('creates a draft and audits it', async () => {
    // No form chosen: the database stores the default one, and the audit records it (C-10).
    repo.insertCycle.mockResolvedValue({ id: CYCLE, version: 1, needsFormId: FORM });
    const { action, audits } = runtime('training_manager');
    const result = await action(defs.createPlanCycleActionDefinition())({
      ...basics,
      needsFormId: null,
    });
    expect(result.ok && result.value).toEqual({ id: CYCLE, version: 1, needsFormId: FORM });
    expect(audits).toEqual([
      {
        action: 'tms.plan_cycle.created',
        entityType: 'plan_cycle',
        entityId: CYCLE,
        data: { after: { ...basics, needsFormId: FORM } },
      },
    ]);
  });

  it('refuses a period that ends before it starts, a deadline after it, and an unknown needs form', async () => {
    const { action } = runtime('training_manager');
    const result = await action(defs.createPlanCycleActionDefinition())({
      ...basics,
      periodEnd: '2026-12-01',
      deadline: '2026-12-02',
      needsFormId: FORM,
    });
    expect(!result.ok && result.error.fieldErrors).toEqual([
      { path: 'periodEnd', code: 'BEFORE_START' },
      { path: 'deadline', code: 'AFTER_PERIOD' },
      { path: 'needsFormId', code: 'UNKNOWN' },
    ]);
    expect(repo.insertCycle).not.toHaveBeenCalled();
    forms.listNeedsFormOptions.mockResolvedValue([{ id: FORM, name: { ar: 'نموذج', en: null } }]);
    repo.insertCycle.mockResolvedValue({ id: CYCLE, version: 1 });
    const chosen = await action(defs.createPlanCycleActionDefinition())({
      ...basics,
      needsFormId: FORM,
    });
    expect(chosen.ok).toBe(true);
  });

  it("keeps the cycle's own needs form even when it was switched off since (C-6)", async () => {
    repo.getCycle.mockResolvedValue(record({ needsFormId: FORM }));
    repo.updateBasics.mockResolvedValue(5);
    forms.listNeedsFormOptions.mockResolvedValue([
      { id: FORM, name: { ar: 'نموذج', en: null }, isDefault: false, active: false },
    ]);
    const { action } = runtime('training_manager');
    const result = await action(defs.updatePlanCycleBasicsActionDefinition())({
      ...basics,
      needsFormId: FORM,
      id: CYCLE,
      version: 3,
    });
    expect(result.ok).toBe(true);
    expect(forms.listNeedsFormOptions).toHaveBeenCalledWith(expect.anything(), FORM);
  });

  it('saves the basics: version checked, audit without the instruction words', async () => {
    repo.getCycle.mockResolvedValue(record({ needsFormId: null }));
    repo.updateBasics.mockResolvedValue(5);
    const { action, audits } = runtime('training_manager');
    const result = await action(defs.updatePlanCycleBasicsActionDefinition())({
      ...basics,
      id: CYCLE,
      version: 3,
      instructionsEn: 'New words',
    });
    expect(result.ok && result.value.version).toBe(5);
    expect(audits).toEqual([
      {
        action: 'tms.plan_cycle.basics_changed',
        entityType: 'plan_cycle',
        entityId: CYCLE,
        data: {
          changed: ['nameAr', 'nameEn', 'instructionsEn'],
          before: { nameAr: 'خطة', nameEn: 'Plan' },
          after: { nameAr: 'خطة ٢٠٢٧', nameEn: 'Plan 2027' },
        },
      },
    ]);
  });

  it.each([
    ['conflict', 'CONFLICT_VERSION'],
    ['not_found', 'NOT_FOUND'],
    ['not_draft', 'PLAN_CYCLE_NOT_DRAFT'],
  ] as const)('maps a %s cycle to %s', async (outcome, code) => {
    repo.touchCycle.mockResolvedValue({ outcome });
    const { action, audits } = runtime('training_manager');
    const result = await action(defs.savePlanCycleRemindersActionDefinition())({
      id: CYCLE,
      version: 3,
      reminderDays: [7],
    });
    expect(!result.ok && result.error.code).toBe(code);
    expect(audits).toEqual([]);
  });

  it('saves the scope: a unit includes its sub-units; unknown units refused', async () => {
    const { action, audits } = runtime('training_manager');
    const result = await action(defs.savePlanCycleScopeActionDefinition())({
      id: CYCLE,
      version: 3,
      departmentIds: [SALES],
      branchIds: [],
    });
    expect(result.ok && result.value.departmentCount).toBe(2);
    expect(repo.replaceScope).toHaveBeenCalledWith(
      {},
      CYCLE,
      { id: CYCLE, version: 3, departmentIds: [SALES], branchIds: [] },
      [SALES, EAST],
    );
    expect(audits).toHaveLength(1);
    const unknown = await action(defs.savePlanCycleScopeActionDefinition())({
      id: CYCLE,
      version: 3,
      departmentIds: [],
      branchIds: [CFO],
    });
    expect(!unknown.ok && unknown.error.fieldErrors).toEqual([
      { path: 'branchIds.0', code: 'UNKNOWN' },
    ]);
  });

  it('saves envelopes of departments in scope; audits only the changes (Q2: optional)', async () => {
    const { action, audits } = runtime('training_manager');
    const result = await action(defs.savePlanCycleBudgetsActionDefinition())({
      id: CYCLE,
      version: 3,
      budgets: [
        { departmentId: SALES, amount: '50,000' },
        { departmentId: EAST, amount: '1200.50' },
      ],
    });
    expect(result.ok && result.value.changes).toEqual([
      { departmentId: EAST, before: null, after: '1200.5' },
    ]);
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'tms.plan_cycle.budgets_changed',
        data: { changes: [{ departmentId: EAST, before: null, after: '1200.5' }] },
      }),
    ]);
    const outside = await action(defs.savePlanCycleBudgetsActionDefinition())({
      id: CYCLE,
      version: 3,
      budgets: [{ departmentId: CFO, amount: '1' }],
    });
    expect(!outside.ok && outside.error.fieldErrors).toEqual([
      { path: 'budgets.0.departmentId', code: 'NOT_IN_SCOPE' },
    ]);
  });

  it('saves the approval chain: BR-PLN-g, approvers must be active members; audited with ids', async () => {
    const { action, audits } = runtime('training_manager');
    const twice = await action(defs.savePlanCycleStepsActionDefinition())({
      id: CYCLE,
      version: 3,
      steps: [chain[1], { ...chain[2], approverPersonId: CFO }],
    });
    expect(!twice.ok && twice.error.fieldErrors).toEqual([
      { path: 'steps.1.approverPersonId', code: 'DUPLICATE_APPROVER' },
    ]);
    db.getMemberOptionsByIds.mockResolvedValue([{ ...members[0], active: false }, members[1]]);
    const gone = await action(defs.savePlanCycleStepsActionDefinition())({
      id: CYCLE,
      version: 3,
      steps: [...chain],
    });
    expect(!gone.ok && gone.error.fieldErrors).toEqual([
      { path: 'steps.1.approverPersonId', code: 'NOT_A_MEMBER' },
    ]);
    db.getMemberOptionsByIds.mockResolvedValue(members);
    const saved = await action(defs.savePlanCycleStepsActionDefinition())({
      id: CYCLE,
      version: 3,
      steps: [chain[0], { ...chain[1], approverPersonId: null }],
    });
    expect(saved.ok).toBe(true);
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'tms.plan_cycle.approval_chain_changed',
        data: {
          before: [
            { kind: 'department_heads', approverPersonId: null },
            { kind: 'person', approverPersonId: CFO },
            { kind: 'person', approverPersonId: GM },
          ],
          after: [
            { kind: 'department_heads', approverPersonId: null },
            { kind: 'person', approverPersonId: null },
          ],
        },
      }),
    ]);
  });

  it('saves reminder days sorted from the earliest', async () => {
    repo.updateReminders.mockResolvedValue(4);
    const { action, audits } = runtime('training_manager');
    const result = await action(defs.savePlanCycleRemindersActionDefinition())({
      id: CYCLE,
      version: 3,
      reminderDays: [2, 14],
    });
    expect(result.ok).toBe(true);
    expect(repo.updateReminders).toHaveBeenCalledWith({}, CYCLE, [14, 2]);
    expect(audits).toEqual([expect.objectContaining({ data: { before: [7, 2], after: [14, 2] } })]);
  });
});

describe('L&D Manager: launch, extend, delete, settings', () => {
  it('launches: departments re-synced, due cycles closed first, audited', async () => {
    repo.closeDueCycles.mockResolvedValue(['old']);
    repo.launch.mockResolvedValue({ outcome: 'launched', version: 5 });
    const { action, audits } = runtime('training_manager');
    const result = await action(defs.launchPlanCycleActionDefinition())({ id: CYCLE, version: 3 });
    expect(result.ok && result.value.version).toBe(5);
    expect(repo.syncDepartments).toHaveBeenCalledWith({}, CYCLE, [SALES, EAST]);
    expect(audits).toEqual([
      {
        action: 'tms.plan_cycle.launched',
        entityType: 'plan_cycle',
        entityId: CYCLE,
        data: {
          deadline: '2026-11-30',
          departments: 2,
          approvalChain: [
            { kind: 'department_heads', approverPersonId: null },
            { kind: 'person', approverPersonId: CFO },
            { kind: 'person', approverPersonId: GM },
          ],
          closedCycleIds: ['old'],
        },
      },
    ]);
  });

  it('refuses a launch while another cycle is open (Q1) or when not ready; nothing launched', async () => {
    const { action, audits } = runtime('training_manager');
    repo.openCycle.mockResolvedValue({ id: 'other', deadline: '2026-12-01' });
    const busy = await action(defs.launchPlanCycleActionDefinition())({ id: CYCLE, version: 3 });
    expect(!busy.ok && busy.error.code).toBe('PLAN_CYCLE_OPEN_EXISTS');
    repo.openCycle.mockResolvedValue(null);
    repo.getCycle.mockResolvedValue(
      record({ steps: [chain[0], { ...chain[1], approverPersonId: null }] }),
    );
    const notReady = await action(defs.launchPlanCycleActionDefinition())({
      id: CYCLE,
      version: 3,
    });
    expect(!notReady.ok && notReady.error).toMatchObject({
      code: 'PLAN_CYCLE_NOT_READY',
      params: { reasons: 'approver_missing' },
    });
    expect(repo.launch).not.toHaveBeenCalled();
    repo.getCycle.mockResolvedValue(record());
    repo.launch.mockResolvedValue({ outcome: 'another_open' });
    const race = await action(defs.launchPlanCycleActionDefinition())({ id: CYCLE, version: 3 });
    expect(!race.ok && race.error.code).toBe('PLAN_CYCLE_OPEN_EXISTS');
    repo.launch.mockResolvedValue({ outcome: 'not_ready', reason: 'approver_inactive' });
    const late = await action(defs.launchPlanCycleActionDefinition())({ id: CYCLE, version: 3 });
    expect(!late.ok && late.error.params).toEqual({ reasons: 'approver_inactive' });
    expect(audits).toEqual([]);
  });

  it('extends the deadline of an open cycle only to a later date within the period', async () => {
    repo.getCycle.mockResolvedValue(record({ status: 'open', deadline: '2026-10-20' }));
    repo.extendDeadline.mockResolvedValue({ outcome: 'extended', version: 6 });
    const { action, audits } = runtime('training_manager');
    const earlier = await action(defs.extendPlanCycleDeadlineActionDefinition())({
      id: CYCLE,
      version: 3,
      deadline: '2026-10-19',
    });
    expect(!earlier.ok && earlier.error.fieldErrors).toEqual([
      { path: 'deadline', code: 'NOT_LATER' },
    ]);
    const after = await action(defs.extendPlanCycleDeadlineActionDefinition())({
      id: CYCLE,
      version: 3,
      deadline: '2028-01-01',
    });
    expect(!after.ok && after.error.fieldErrors).toEqual([
      { path: 'deadline', code: 'AFTER_PERIOD' },
    ]);
    const done = await action(defs.extendPlanCycleDeadlineActionDefinition())({
      id: CYCLE,
      version: 3,
      deadline: '2026-11-15',
    });
    expect(done.ok && done.value).toEqual({
      id: CYCLE,
      version: 6,
      before: '2026-10-20',
      after: '2026-11-15',
    });
    expect(repo.touchCycle).toHaveBeenLastCalledWith({}, CYCLE, 3, { draftOnly: false });
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'tms.plan_cycle.deadline_extended',
        data: { before: '2026-10-20', after: '2026-11-15' },
      }),
    ]);
    // C-7: an open cycle whose deadline has passed (shown as Closed) is extended, to today or later.
    repo.getCycle.mockResolvedValue(record({ status: 'open', deadline: '2026-10-10' }));
    const past = await action(defs.extendPlanCycleDeadlineActionDefinition())({
      id: CYCLE,
      version: 3,
      deadline: '2026-10-12',
    });
    expect(!past.ok && past.error.fieldErrors).toEqual([{ path: 'deadline', code: 'IN_PAST' }]);
    const reopened = await action(defs.extendPlanCycleDeadlineActionDefinition())({
      id: CYCLE,
      version: 3,
      deadline: '2026-11-15',
    });
    expect(reopened.ok).toBe(true);
    repo.getCycle.mockResolvedValue(record({ status: 'closed', deadline: '2026-10-10' }));
    const closed = await action(defs.extendPlanCycleDeadlineActionDefinition())({
      id: CYCLE,
      version: 3,
      deadline: '2026-11-15',
    });
    expect(!closed.ok && closed.error.code).toBe('PLAN_CYCLE_DEADLINE_REFUSED');
  });

  it('searches approvers by name for those who set chains up (C-M3)', async () => {
    db.searchMemberOptions.mockResolvedValue([{ personId: CFO, nameAr: 'المالية', nameEn: 'CFO' }]);
    const found = await runtime('training_manager').action(
      defs.searchPlanApproversActionDefinition(),
    )({ q: ' cf ' });
    expect(found.ok && found.value).toEqual({
      members: [{ personId: CFO, name: { ar: 'المالية', en: 'CFO' } }],
    });
    expect(db.searchMemberOptions).toHaveBeenLastCalledWith(expect.anything(), 'cf');
    const short = await runtime('training_manager').action(
      defs.searchPlanApproversActionDefinition(),
    )({ q: 'c' });
    expect(!short.ok && short.error.code).toBe('VALIDATION_FAILED');
    const coordinator = await runtime('training_coordinator').action(
      defs.searchPlanApproversActionDefinition(),
    )({ q: 'cf' });
    expect(!coordinator.ok && coordinator.error.code).toBe('FORBIDDEN');
  });

  it('deletes a draft (audited with its names); a launched one is refused', async () => {
    repo.deleteDraft.mockResolvedValue(true);
    const { action, audits } = runtime('training_manager');
    const done = await action(defs.deletePlanCycleActionDefinition())({ id: CYCLE, version: 3 });
    expect(done.ok).toBe(true);
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'tms.plan_cycle.deleted',
        data: { before: { name: { ar: 'خطة', en: 'Plan' } } },
      }),
    ]);
    repo.touchCycle.mockResolvedValue({ outcome: 'not_draft' });
    const refused = await action(defs.deletePlanCycleActionDefinition())({ id: CYCLE, version: 3 });
    expect(!refused.ok && refused.error.code).toBe('PLAN_CYCLE_NOT_DRAFT');
  });

  it('saves the planning settings (default reminders and chain), audited', async () => {
    repo.getSettings.mockResolvedValue({ version: null, reminderDays: [7, 2], steps: chain });
    repo.saveSettings.mockResolvedValue(1);
    const { action, audits } = runtime('training_manager');
    const result = await action(defs.savePlanningSettingsActionDefinition())({
      reminderDays: [10],
      steps: [chain[0], chain[1]],
    });
    expect(result.ok && result.value.version).toBe(1);
    expect(audits).toEqual([expect.objectContaining({ action: 'tms.planning_settings.changed' })]);
    const twice = await action(defs.savePlanningSettingsActionDefinition())({
      reminderDays: [10],
      steps: [chain[0], chain[0]],
    });
    expect(!twice.ok && twice.error.fieldErrors).toEqual([
      { path: 'steps.1.kind', code: 'SECOND_HEADS_STEP' },
    ]);
  });
});
