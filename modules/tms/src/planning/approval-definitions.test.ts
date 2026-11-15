/**
 * Plan approval definitions with a fake runtime (WP-LD-03, T-M3-07; FR-PLN-08, FR-WFL-01/02 R1 part, FR-MGR-05):
 * who submits (the organization-wide L&D Manager), who decides each step (every HR Manager, then Finance — never
 * the submitter, never the same person twice; the first decision settles the step), who revises, what each one
 * reads, the department head's result and the audit records. The repositories and platform services are replaced;
 * the database tests (99_planning_g_approval_1_owner.sql) cover the same rules in SQL.
 */
import { ok } from '@jadarat/platform-core';
import type { UserTx } from '@jadarat/platform-db';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  listOrgStructure: vi.fn(),
  listStructureLevelLabels: vi.fn(),
  getMemberOptionsByIds: vi.fn(),
  listRoleHolders: vi.fn(),
  listDepartmentTeam: vi.fn(),
  getOrganizationProfile: vi.fn(),
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

const approvals = vi.hoisted(() => ({
  getApproval: vi.fn(),
  getApprovalByCycle: vi.fn(),
  listPlans: vi.fn(),
  submitPlan: vi.fn(),
  decidePlan: vi.fn(),
  revisePlan: vi.fn(),
  listEvents: vi.fn(),
  listVersions: vi.fn(),
  getVersion: vi.fn(),
  listDepartmentResults: vi.fn(),
  financeConfirms: vi.fn(),
  submitProblem: vi.fn(),
  listEnvelopes: vi.fn(),
}));
vi.mock('./approval-repository', () => approvals);

const consolidation = vi.hoisted(() => ({
  listLinesOfPlans: vi.fn(),
  listLinksOfPlans: vi.fn(),
}));
vi.mock('./consolidation-repository', () => consolidation);

const { createDefineAction, createDefineQuery, grantsForAssignments } =
  await import('@jadarat/platform-rbac');
const defs = await import('./approval-definitions');

const TENANT = '22222222-2222-4222-8222-222222222222';
const CYCLE = '55555555-5555-4555-8555-555555555555';
const PLAN = '77777777-7777-4777-8777-777777777777';
const SALES = '66666666-6666-4666-8666-666666666661';
const HR = '66666666-6666-4666-8666-666666666663';
const ME = '44444444-4444-4444-8444-444444444444';
const LND = '44444444-4444-4444-8444-444444444401';
const HR_ONE = '44444444-4444-4444-8444-444444444402';

function runtime(role: string, personId: string = ME, headed: readonly string[] = []) {
  const claims = brandVerifiedClaims({
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'authenticated',
    aal: 'aal1',
    session_id: '33333333-3333-4333-8333-333333333333',
    tenant_id: TENANT,
    person_id: personId,
  });
  if (!claims.ok) throw new Error('fixture');
  const audits: unknown[] = [];
  const rt = {
    getClaims: () => Promise.resolve(ok(claims.value)),
    withUserTx: <T>(_c: unknown, fn: (tx: object) => Promise<T>) => fn({}),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: false }),
    loadGrants: () =>
      Promise.resolve(
        grantsForAssignments([{ roleCode: role }], {
          headedDepartmentIds: [...headed],
          customRoles: [],
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

const approval = (over: Record<string, unknown> = {}) => ({
  id: PLAN,
  cycleId: CYCLE,
  status: 'in_approval',
  planVersion: 1,
  approvalStep: 'hr',
  financeStep: false,
  submittedAt: new Date('2026-11-15T08:00:00Z'),
  submittedBy: LND,
  hrDecidedAt: null,
  hrDecidedBy: null,
  decidedAt: null,
  decidedBy: null,
  sendBackComment: null,
  approvedAt: null,
  approvedBy: null,
  version: 4,
  ...over,
});

const unit = (id: string, over: Record<string, unknown> = {}) => ({
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

const structure = {
  departments: [
    unit(SALES, { nameEn: 'Sales', head: { personId: ME, nameAr: 'رئيس', nameEn: 'Head' } }),
    unit(HR, { nameEn: 'HR' }),
  ],
  branches: [],
};

/** Excel: Sales 20 + HR 10 at 6,000 (2 sessions of 15 at 3,000); Public speaking: Sales 8, left out. */
const lines = [
  {
    id: 'l1',
    title: 'Excel',
    courseId: null,
    deliveryType: 'classroom',
    category: null,
    quarter: 1,
    minPerSession: 8,
    maxPerSession: 15,
    costPerSession: '3000',
    costPerPerson: null,
    durationHours: null,
    status: 'in_plan',
    leftOutReason: null,
    sortOrder: 0,
    departments: [
      { departmentId: SALES, seats: 20, named: 2 },
      { departmentId: HR, seats: 10, named: 0 },
    ],
  },
  {
    id: 'l2',
    title: 'Public speaking',
    courseId: null,
    deliveryType: null,
    category: null,
    quarter: 3,
    minPerSession: null,
    maxPerSession: null,
    costPerSession: null,
    costPerPerson: null,
    durationHours: null,
    status: 'left_out',
    leftOutReason: 'Not this year',
    sortOrder: 1,
    departments: [{ departmentId: SALES, seats: 8, named: 0 }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  db.listOrgStructure.mockResolvedValue(structure);
  db.getMemberOptionsByIds.mockImplementation((_tx: unknown, ids: string[]) =>
    Promise.resolve(
      ids.map((id) => ({ personId: id, nameAr: null, nameEn: `P ${id.slice(-2)}`, active: true })),
    ),
  );
  db.listRoleHolders.mockResolvedValue([
    { roleCode: 'hr_manager', personId: HR_ONE, nameAr: 'خالد', nameEn: 'Khalid' },
    {
      roleCode: 'finance',
      personId: '44444444-4444-4444-8444-444444444403',
      nameAr: null,
      nameEn: 'Fatima',
    },
  ]);
  approvals.getApprovalByCycle.mockResolvedValue(approval());
  approvals.getApproval.mockResolvedValue(approval());
  approvals.listEvents.mockResolvedValue([
    {
      kind: 'submitted',
      step: null,
      planVersion: 1,
      actorPersonId: LND,
      comment: null,
      occurredAt: new Date('2026-11-15T08:00:00Z'),
    },
  ]);
  approvals.listVersions.mockResolvedValue([]);
  approvals.financeConfirms.mockResolvedValue(false);
  approvals.submitProblem.mockResolvedValue(null);
  // Two lines of PLAN (review L7: the list's figures from three queries for every plan): Excel in the plan, shared
  // by Sales (20) and HR (10) — 30 people, max 15 a session, SAR 3,000 a session: 2 sessions, SAR 6,000, Sales'
  // share 4,000 over its envelope of 3,000 — and Speaking left out.
  const line = (id: string, status: string, over: Record<string, unknown> = {}) => ({
    id,
    planId: PLAN,
    status,
    minPerSession: null,
    maxPerSession: 15,
    costPerSession: '3000',
    costPerPerson: null,
    ...over,
  });
  consolidation.listLinesOfPlans.mockResolvedValue([
    line('l1', 'in_plan'),
    line('l2', 'left_out', { maxPerSession: null, costPerSession: null }),
  ]);
  consolidation.listLinksOfPlans.mockResolvedValue([
    { planId: PLAN, lineId: 'l1', departmentId: SALES, seats: 20, named: 0 },
    { planId: PLAN, lineId: 'l1', departmentId: HR, seats: 10, named: 0 },
    { planId: PLAN, lineId: 'l2', departmentId: SALES, seats: 8, named: 0 },
  ]);
  approvals.listEnvelopes.mockResolvedValue([
    { cycleId: CYCLE, departmentId: SALES, envelope: '3000' },
    { cycleId: CYCLE, departmentId: HR, envelope: '5000' },
  ]);
});

describe('the approval as each one sees it', () => {
  it('an HR Manager decides the HR step; the steps and the history name the people', async () => {
    const view = await runtime('hr_manager', HR_ONE).query(defs.planApprovalQueryDefinition())({
      cycleId: CYCLE,
    });
    if (!view.ok || !view.value) throw new Error('view');
    expect(view.value.can).toEqual({ submit: false, decide: 'hr', revise: false });
    expect(view.value.steps.hr.state).toBe('waiting');
    expect(view.value.steps.finance.state).toBe('off');
    expect(view.value.steps.hr.deciders.map((d) => d.name.en)).toEqual(['Khalid']);
    expect(view.value.plan.submittedBy?.name.en).toBe('P 01');
    expect(view.value.events[0]?.actor?.personId).toBe(LND);
    // Only the L&D Manager is told the Finance switch and why it cannot submit.
    expect(view.value.financeSwitch).toBe(false);
    expect(approvals.financeConfirms).not.toHaveBeenCalled();
    expect(approvals.submitProblem).not.toHaveBeenCalled();
  });

  it('the submitter never decides their own plan; Finance waits for its step', async () => {
    const lnd = await runtime('training_manager', LND).query(defs.planApprovalQueryDefinition())({
      cycleId: CYCLE,
    });
    expect(lnd.ok && lnd.value?.can).toEqual({ submit: false, decide: null, revise: false });
    expect(lnd.ok && lnd.value?.viewer.submitted).toBe(true);
    const finance = await runtime('finance').query(defs.planApprovalQueryDefinition())({
      cycleId: CYCLE,
    });
    expect(finance.ok && finance.value?.can.decide).toBeNull();
    approvals.getApprovalByCycle.mockResolvedValue(
      approval({ approvalStep: 'finance', financeStep: true, hrDecidedBy: HR_ONE }),
    );
    const now = await runtime('finance').query(defs.planApprovalQueryDefinition())({
      cycleId: CYCLE,
    });
    expect(now.ok && now.value?.can.decide).toBe('finance');
    expect(now.ok && now.value?.steps).toMatchObject({
      hr: { state: 'done' },
      finance: { state: 'waiting' },
    });
  });

  it('the L&D Manager submits a draft, is told the Finance switch and what stops the submission', async () => {
    approvals.getApprovalByCycle.mockResolvedValue(
      approval({ status: 'draft', approvalStep: null, submittedBy: null }),
    );
    approvals.financeConfirms.mockResolvedValue(true);
    approvals.submitProblem.mockResolvedValue('uncosted');
    const view = await runtime('training_manager', LND).query(defs.planApprovalQueryDefinition())({
      cycleId: CYCLE,
    });
    if (!view.ok || !view.value) throw new Error('view');
    expect(view.value.can.submit).toBe(true);
    expect(view.value.financeSwitch).toBe(true);
    expect(view.value.submitProblem).toBe('uncosted');
    expect(view.value.steps).toMatchObject({
      hr: { state: 'not_started' },
      finance: { state: 'not_started' },
    });
  });

  it('nobody reads it without the plan; before the plan exists there is nothing', async () => {
    const employee = await runtime('learner').query(defs.planApprovalQueryDefinition())({
      cycleId: CYCLE,
    });
    expect(!employee.ok && employee.error.code).toBe('FORBIDDEN');
    const head = await runtime('department_head', ME, [SALES]).query(
      defs.planApprovalQueryDefinition(),
    )({
      cycleId: CYCLE,
    });
    expect(!head.ok && head.error.code).toBe('FORBIDDEN');
    approvals.getApprovalByCycle.mockResolvedValue(null);
    const none = await runtime('hr_manager').query(defs.planApprovalQueryDefinition())({
      cycleId: CYCLE,
    });
    expect(none.ok && none.value).toBeNull();
  });
});

describe('the Approvals page', () => {
  it('lists what waits for the HR Manager first, with the plan’s figures', async () => {
    approvals.listPlans.mockResolvedValue([
      {
        ...approval({ id: 'p2', status: 'approved', approvalStep: null }),
        cycleNameAr: null,
        cycleNameEn: '2026',
        currency: 'SAR',
      },
      { ...approval(), cycleNameAr: 'خطة', cycleNameEn: 'Plan 2027', currency: 'SAR' },
      {
        ...approval({ id: 'p3', status: 'draft', submittedAt: null, approvalStep: null }),
        cycleNameAr: null,
        cycleNameEn: 'x',
        currency: 'SAR',
      },
    ]);
    const result = await runtime('hr_manager', HR_ONE).query(defs.approvalsQueryDefinition())({});
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.items.map((i) => i.planId)).toEqual([PLAN, 'p2']);
    expect(result.value.waiting).toBe(1);
    expect(result.value.items[0]?.summary).toEqual({
      lines: 1,
      leftOut: 1,
      people: 30,
      sessions: 2,
      cost: '6000',
      envelope: '8000',
      overBudget: 1,
      currency: 'SAR',
      fractionDigits: 2,
    });
    // p2 has no line of its own: zero figures, not another plan's.
    expect(result.value.items[1]?.summary).toMatchObject({ lines: 0, people: 0, cost: '0' });
    // One query each for every plan listed (review L7), never one per plan.
    expect(consolidation.listLinesOfPlans).toHaveBeenCalledTimes(1);
    expect(consolidation.listLinesOfPlans.mock.calls[0]?.[1]).toEqual(['p2', PLAN]);
    expect(approvals.listEnvelopes).toHaveBeenCalledTimes(1);
    const count = await runtime('hr_manager', HR_ONE).query(
      defs.approvalsQueryDefinition({ figures: false }),
    )({});
    expect(count.ok && count.value.items[0]?.summary).toBeNull();
    expect(consolidation.listLinesOfPlans).toHaveBeenCalledTimes(1);
    const employee = await runtime('learner').query(defs.approvalsQueryDefinition())({});
    expect(!employee.ok && employee.error.code).toBe('FORBIDDEN');
  });
});

describe('submitting, deciding, revising', () => {
  it('the L&D Manager submits; audited', async () => {
    approvals.submitPlan.mockResolvedValue({ ok: true, value: approval({ financeStep: true }) });
    const { action, audits } = runtime('training_manager', LND);
    const result = await action(defs.submitPlanActionDefinition())({ planId: PLAN, version: 3 });
    expect(result.ok && result.value).toEqual({
      planId: PLAN,
      cycleId: CYCLE,
      planVersion: 1,
      financeStep: true,
    });
    expect(approvals.submitPlan).toHaveBeenCalledWith({}, PLAN, 3);
    expect(audits).toEqual([
      {
        action: 'tms.training_plan.submitted',
        entityType: 'training_plan',
        entityId: PLAN,
        data: { cycleId: CYCLE, planVersion: 1, financeStep: true },
      },
    ]);
  });

  it('a submission refused says why; a stale one asks for the latest copy', async () => {
    approvals.submitPlan.mockResolvedValue({
      ok: false,
      refusal: { kind: 'not_ready', problem: 'over_budget' },
    });
    const refused = await runtime('training_manager', LND).action(
      defs.submitPlanActionDefinition(),
    )({
      planId: PLAN,
      version: 3,
    });
    expect(!refused.ok && refused.error.code).toBe('TRAINING_PLAN_NOT_SUBMITTABLE');
    expect(!refused.ok && refused.error.params).toEqual({ problem: 'over_budget' });
    approvals.submitPlan.mockResolvedValue({ ok: true, value: null });
    approvals.getApproval.mockResolvedValue(approval({ status: 'draft' }));
    const stale = await runtime('training_manager', LND).action(defs.submitPlanActionDefinition())({
      planId: PLAN,
      version: 3,
    });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');
    approvals.getApproval.mockResolvedValue(approval());
    const already = await runtime('training_manager', LND).action(
      defs.submitPlanActionDefinition(),
    )({
      planId: PLAN,
      version: 3,
    });
    expect(!already.ok && already.error.code).toBe('PRECONDITION_FAILED');
  });

  it('nobody else submits: the Coordinator, the HR Manager, an Employee', async () => {
    for (const role of ['training_coordinator', 'hr_manager', 'learner', 'finance']) {
      const result = await runtime(role).action(defs.submitPlanActionDefinition())({
        planId: PLAN,
        version: 3,
      });
      expect(!result.ok && result.error.code, role).toBe('FORBIDDEN');
    }
    expect(approvals.submitPlan).not.toHaveBeenCalled();
  });

  it('an HR Manager approves (Finance next) or sends back with a comment; audited with its length', async () => {
    approvals.decidePlan.mockResolvedValue({
      ok: true,
      value: approval({ approvalStep: 'finance', hrDecidedBy: HR_ONE }),
    });
    const { action, audits } = runtime('hr_manager', HR_ONE);
    const approved = await action(defs.decidePlanActionDefinition())({
      planId: PLAN,
      version: 4,
      step: 'hr',
      decision: 'approve',
      comment: 'ignored',
    });
    expect(approved.ok && approved.value).toMatchObject({
      status: 'in_approval',
      approvalStep: 'finance',
    });
    expect(approvals.decidePlan).toHaveBeenCalledWith({}, PLAN, 4, 'hr', 'approve', null);
    approvals.decidePlan.mockResolvedValue({
      ok: true,
      value: approval({ status: 'sent_back', approvalStep: null }),
    });
    const back = await action(defs.decidePlanActionDefinition())({
      planId: PLAN,
      version: 4,
      step: 'hr',
      decision: 'send_back',
      comment: '  Please bring Sales under its budget.  ',
    });
    expect(back.ok && back.value.status).toBe('sent_back');
    expect(approvals.decidePlan).toHaveBeenLastCalledWith(
      {},
      PLAN,
      4,
      'hr',
      'send_back',
      'Please bring Sales under its budget.',
    );
    expect(audits).toEqual([
      {
        action: 'tms.training_plan.approved',
        entityType: 'training_plan',
        entityId: PLAN,
        data: { cycleId: CYCLE, planVersion: 1, step: 'hr', status: 'in_approval' },
      },
      {
        action: 'tms.training_plan.sent_back',
        entityType: 'training_plan',
        entityId: PLAN,
        data: {
          cycleId: CYCLE,
          planVersion: 1,
          step: 'hr',
          status: 'sent_back',
          commentLength: 36,
        },
      },
    ]);
    // The comment's words are never audited.
    expect(JSON.stringify(audits)).not.toContain('Sales');
  });

  it('sending back needs a comment', async () => {
    const result = await runtime('hr_manager', HR_ONE).action(defs.decidePlanActionDefinition())({
      planId: PLAN,
      version: 4,
      step: 'hr',
      decision: 'send_back',
      comment: '   ',
    });
    expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
    approvals.decidePlan.mockResolvedValue({ ok: false, refusal: { kind: 'comment_required' } });
    const db = await runtime('hr_manager', HR_ONE).action(defs.decidePlanActionDefinition())({
      planId: PLAN,
      version: 4,
      step: 'hr',
      decision: 'send_back',
      comment: 'x',
    });
    expect(!db.ok && db.error.fieldErrors).toEqual([{ path: 'comment', code: 'REQUIRED' }]);
  });

  it('only the step’s role decides; never the submitter, never Finance after approving for HR', async () => {
    const steps: [string, 'hr' | 'finance'][] = [
      ['finance', 'hr'],
      ['training_manager', 'hr'],
      ['training_coordinator', 'hr'],
      ['department_head', 'hr'],
      ['learner', 'hr'],
      ['hr_manager', 'finance'],
    ];
    for (const [role, step] of steps) {
      const result = await runtime(role, HR_ONE).action(defs.decidePlanActionDefinition())({
        planId: PLAN,
        version: 4,
        step,
        decision: 'approve',
      });
      expect(!result.ok && result.error.code, `${role} at ${step}`).toBe('FORBIDDEN');
    }
    const own = await runtime('hr_manager', LND).action(defs.decidePlanActionDefinition())({
      planId: PLAN,
      version: 4,
      step: 'hr',
      decision: 'approve',
    });
    expect(!own.ok && own.error.code).toBe('TRAINING_PLAN_OWN_SUBMISSION');
    approvals.getApproval.mockResolvedValue(approval({ approvalStep: 'finance', hrDecidedBy: ME }));
    const twice = await runtime('finance', ME).action(defs.decidePlanActionDefinition())({
      planId: PLAN,
      version: 4,
      step: 'finance',
      decision: 'approve',
    });
    expect(!twice.ok && twice.error.code).toBe('TRAINING_PLAN_OWN_SUBMISSION');
    approvals.getApproval.mockResolvedValue(null);
    const gone = await runtime('hr_manager', HR_ONE).action(defs.decidePlanActionDefinition())({
      planId: PLAN,
      version: 4,
      step: 'hr',
      decision: 'approve',
    });
    expect(!gone.ok && gone.error.code).toBe('NOT_FOUND');
    expect(approvals.decidePlan).not.toHaveBeenCalled();
  });

  it('the first decision settles the step: a second one is refused', async () => {
    approvals.decidePlan.mockResolvedValue({ ok: true, value: null });
    approvals.getApproval
      .mockResolvedValueOnce(approval())
      .mockResolvedValueOnce(approval({ status: 'sent_back', approvalStep: null }));
    const second = await runtime('hr_manager', HR_ONE).action(defs.decidePlanActionDefinition())({
      planId: PLAN,
      version: 4,
      step: 'hr',
      decision: 'approve',
    });
    expect(!second.ok && second.error.code).toBe('TRAINING_PLAN_ALREADY_DECIDED');
    approvals.getApproval.mockResolvedValue(approval({ version: 5 }));
    const stale = await runtime('hr_manager', HR_ONE).action(defs.decidePlanActionDefinition())({
      planId: PLAN,
      version: 4,
      step: 'hr',
      decision: 'approve',
    });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');
    approvals.decidePlan.mockResolvedValue({ ok: false, refusal: { kind: 'own_submission' } });
    const db = await runtime('hr_manager', HR_ONE).action(defs.decidePlanActionDefinition())({
      planId: PLAN,
      version: 4,
      step: 'hr',
      decision: 'approve',
    });
    expect(!db.ok && db.error.code).toBe('TRAINING_PLAN_OWN_SUBMISSION');
    approvals.decidePlan.mockResolvedValue({ ok: false, refusal: { kind: 'not_allowed' } });
    const denied = await runtime('hr_manager', HR_ONE).action(defs.decidePlanActionDefinition())({
      planId: PLAN,
      version: 4,
      step: 'hr',
      decision: 'approve',
    });
    expect(!denied.ok && denied.error.code).toBe('FORBIDDEN');
  });

  it('Finance confirms: audited as confirmed', async () => {
    approvals.getApproval.mockResolvedValue(
      approval({ approvalStep: 'finance', hrDecidedBy: HR_ONE }),
    );
    approvals.decidePlan.mockResolvedValue({
      ok: true,
      value: approval({ status: 'approved', approvalStep: null }),
    });
    const { action, audits } = runtime('finance', ME);
    const result = await action(defs.decidePlanActionDefinition())({
      planId: PLAN,
      version: 4,
      step: 'finance',
      decision: 'approve',
    });
    expect(result.ok && result.value.status).toBe('approved');
    expect((audits[0] as { action: string }).action).toBe('tms.training_plan.confirmed');
  });

  it('the L&D Manager revises an approved plan into the next version; others do not', async () => {
    approvals.revisePlan.mockResolvedValue({
      ok: true,
      value: approval({ status: 'draft', planVersion: 2 }),
    });
    const { action, audits } = runtime('training_manager', LND);
    const result = await action(defs.revisePlanActionDefinition())({ planId: PLAN, version: 9 });
    expect(result.ok && result.value.planVersion).toBe(2);
    expect(audits).toEqual([
      {
        action: 'tms.training_plan.revised',
        entityType: 'training_plan',
        entityId: PLAN,
        data: { cycleId: CYCLE, planVersion: 2, fromVersion: 1 },
      },
    ]);
    approvals.revisePlan.mockResolvedValue({ ok: true, value: null });
    approvals.getApproval.mockResolvedValue(approval({ status: 'approved' }));
    const stale = await action(defs.revisePlanActionDefinition())({ planId: PLAN, version: 9 });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');
    approvals.getApproval.mockResolvedValue(null);
    const gone = await action(defs.revisePlanActionDefinition())({ planId: PLAN, version: 9 });
    expect(!gone.ok && gone.error.code).toBe('NOT_FOUND');
    approvals.revisePlan.mockResolvedValue({ ok: false, refusal: { kind: 'refused' } });
    const refused = await action(defs.revisePlanActionDefinition())({ planId: PLAN, version: 9 });
    expect(!refused.ok && refused.error.code).toBe('PRECONDITION_FAILED');
    for (const role of ['hr_manager', 'finance', 'training_coordinator']) {
      const denied = await runtime(role).action(defs.revisePlanActionDefinition())({
        planId: PLAN,
        version: 9,
      });
      expect(!denied.ok && denied.error.code, role).toBe('FORBIDDEN');
    }
  });
});

describe('versions and results', () => {
  const version = {
    planVersion: 1,
    approvedAt: new Date('2026-11-15T10:00:00Z'),
    approvedBy: HR_ONE,
    currency: 'SAR',
    lines,
    departments: [
      { departmentId: SALES, envelope: '3000', reason: 'Two new branches' },
      { departmentId: HR, envelope: null, reason: null },
    ],
  };

  it('an approved version reads back with its figures (organization-wide readers)', async () => {
    approvals.getVersion.mockResolvedValue(version);
    approvals.listPlans.mockResolvedValue([
      { ...approval(), cycleNameAr: null, cycleNameEn: 'Plan 2027' },
    ]);
    const result = await runtime('training_coordinator').query(defs.planVersionQueryDefinition())({
      cycleId: CYCLE,
      planVersion: 1,
    });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.lines[0]).toMatchObject({
      people: 30,
      cost: '6000',
      sessions: { sessions: 2 },
    });
    expect(result.value.departments[0]).toMatchObject({
      name: { en: 'Sales' },
      people: 20,
      cost: '4000',
      reason: 'Two new branches',
      state: { kind: 'over', overBy: '1000' },
    });
    expect(result.value.total).toEqual({ people: 30, cost: '6000', envelope: '3000' });
    expect(result.value.cycleName.en).toBe('Plan 2027');
    approvals.getVersion.mockResolvedValue(null);
    const missing = await runtime('hr_manager').query(defs.planVersionQueryDefinition())({
      cycleId: CYCLE,
      planVersion: 9,
    });
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
    approvals.getApprovalByCycle.mockResolvedValue(null);
    const none = await runtime('hr_manager').query(defs.planVersionQueryDefinition())({
      cycleId: CYCLE,
      planVersion: 1,
    });
    expect(!none.ok && none.error.code).toBe('NOT_FOUND');
    const head = await runtime('department_head', ME, [SALES]).query(
      defs.planVersionQueryDefinition(),
    )({
      cycleId: CYCLE,
      planVersion: 1,
    });
    expect(!head.ok && head.error.code).toBe('FORBIDDEN');
  });

  const resultRecord = {
    cycleId: CYCLE,
    departmentId: SALES,
    planVersion: 1,
    approvedAt: new Date('2026-11-15T10:00:00Z'),
    cycleNameAr: null,
    cycleNameEn: 'Plan 2027',
    currency: 'SAR',
    envelope: '3000',
    reason: 'Two new branches',
    lines,
  };

  it('the head sees their department’s result once approved: approved lines with their share, left-out lines', async () => {
    approvals.listDepartmentResults.mockResolvedValue([resultRecord]);
    const result = await runtime('department_head', ME, [SALES]).query(
      defs.departmentPlanResultQueryDefinition(),
    )({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    if (!result.ok || !result.value) throw new Error('result');
    expect(result.value.result.approved).toMatchObject([
      { seats: 20, share: '4000', sharedWith: [HR] },
    ]);
    expect(result.value.result.leftOut).toMatchObject([
      { seats: 8, line: { leftOutReason: 'Not this year' } },
    ]);
    expect(result.value.result.state).toMatchObject({ kind: 'over', overBy: '1000' });
    expect(result.value.departmentNames[HR]).toEqual({ ar: 'وحدة', en: 'HR' });
    expect(approvals.listDepartmentResults).toHaveBeenCalledWith(
      {},
      { cycleId: CYCLE, departmentId: SALES },
    );
    // Another department: nothing (deny by default), whatever the rows say.
    const other = await runtime('department_head', ME, [SALES]).query(
      defs.departmentPlanResultQueryDefinition(),
    )({
      cycleId: CYCLE,
      departmentId: HR,
    });
    expect(other.ok && other.value).toBeNull();
    approvals.listDepartmentResults.mockResolvedValue([]);
    const before = await runtime('department_head', ME, [SALES]).query(
      defs.departmentPlanResultQueryDefinition(),
    )({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    expect(before.ok && before.value).toBeNull();
    const employee = await runtime('learner').query(defs.departmentPlanResultQueryDefinition())({
      cycleId: CYCLE,
      departmentId: SALES,
    });
    expect(!employee.ok && employee.error.code).toBe('FORBIDDEN');
  });

  it('the head’s Home lists the results of the departments they head', async () => {
    approvals.listDepartmentResults.mockResolvedValue([
      resultRecord,
      { ...resultRecord, departmentId: HR },
    ]);
    const result = await runtime('department_head', ME, [SALES]).query(
      defs.myPlanResultsQueryDefinition(),
    )({});
    expect(result.ok && result.value.results).toEqual([
      expect.objectContaining({
        departmentId: SALES,
        approvedLines: 1,
        leftOutLines: 1,
        seats: 20,
      }),
    ]);
  });
});
