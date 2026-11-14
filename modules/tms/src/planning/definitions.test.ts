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
  getOrganizationProfile: vi.fn(),
  // The organization's default language (WP-FIX-03): English unless a test says otherwise.
  getTenantDefaultLocale: vi.fn((): Promise<'ar' | 'en'> => Promise.resolve('en')),
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
  listDraftDetails: vi.fn(),
  getSettings: vi.fn(),
  insertCycle: vi.fn(),
  touchCycle: vi.fn(),
  updateBasics: vi.fn(),
  replaceScope: vi.fn(),
  syncDepartments: vi.fn(),
  updateBudgets: vi.fn(),
  updateReminders: vi.fn(),
  closeDueCycles: vi.fn(),
  listDepartmentProgress: vi.fn(),
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

const record = (over: Record<string, unknown> = {}) => ({
  id: CYCLE,
  nameAr: 'خطة',
  nameEn: 'Plan',
  periodStart: '2027-01-01',
  periodEnd: '2027-12-31',
  deadline: '2026-11-30',
  latestDeadline: '2026-11-30',
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
    { departmentId: SALES, budgetAmount: '50000', status: 'not_started', deadline: null },
    { departmentId: EAST, budgetAmount: null, status: 'not_started', deadline: null },
  ],
  ...over,
});

beforeEach(() => {
  repo.organizationToday.mockResolvedValue('2026-10-17');
  repo.getCycle.mockResolvedValue(record());
  repo.openCycle.mockResolvedValue(null);
  repo.listDraftDetails.mockResolvedValue([]);
  repo.touchCycle.mockResolvedValue({ outcome: 'ok', version: 4 });
  repo.closeDueCycles.mockResolvedValue([]);
  repo.listDepartmentProgress.mockResolvedValue([]);
  db.listOrgStructure.mockResolvedValue(structure);
  db.listStructureLevelLabels.mockResolvedValue(LEVELS);
  db.getOrganizationProfile.mockResolvedValue({ fiscalYearStartMonth: 7, currencyCode: 'AED' });
  db.getTenantDefaultLocale.mockResolvedValue('en');
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
        { reminderDays: [7] },
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
    repo.getSettings.mockResolvedValue({ version: null, reminderDays: [7, 2] });
    const { query } = runtime('training_coordinator');
    const list = await query(defs.planCyclesListQueryDefinition())({});
    expect(list.ok && list.value.canManage).toBe(false);
    const one = await query(defs.planCycleQueryDefinition())({ id: CYCLE });
    expect(one.ok && one.value.editable).toBe(false);
    expect(one.ok && one.value.setup).toBeNull();
    expect(list.ok && list.value.setup).toBeNull();
    const settings = await query(defs.planningSettingsQueryDefinition())({});
    // The default reminders only: the default approval chain is not part of the view (EP-PLN §13).
    expect(settings.ok && settings.value).toEqual({ reminderDays: [7, 2], canManage: false });
  });

  it('a reader gets no draft data for the row menus (Edit, Launch and Delete are the manager’s)', async () => {
    repo.listCycles.mockResolvedValue([
      {
        id: CYCLE,
        nameAr: 'خطة',
        nameEn: 'Plan',
        periodStart: '2027-01-01',
        periodEnd: '2027-12-31',
        deadline: '2026-11-30',
        latestDeadline: '2026-11-30',
        status: 'draft',
        departmentCount: 2,
        submittedCount: 0,
      },
    ]);
    const { query } = runtime('training_coordinator');
    const list = await query(defs.planCyclesListQueryDefinition())({});
    expect(list.ok && list.value.cycles.map((c) => c.draft)).toEqual([null]);
    expect(repo.listDraftDetails).not.toHaveBeenCalled();
    expect(repo.getCycle).not.toHaveBeenCalled();
    expect(db.listOrgStructure).not.toHaveBeenCalled();
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
      latestDeadline: '2026-10-01',
      status: 'open',
      departmentCount: 4,
      submittedCount: 0,
      launchedAt: new Date(),
      createdAt: new Date(),
    };
    repo.listCycles.mockResolvedValue([
      row,
      { ...row, id: 'd', status: 'draft' },
      { ...row, id: 'a', status: 'archived' },
    ]);
    const { query } = runtime('training_manager');
    const result = await query(defs.planCyclesListQueryDefinition())({});
    expect(result.ok && result.value.cycles.map((c) => c.status)).toEqual([
      'closed',
      'draft',
      'archived',
    ]);
    // «Closed» counts everything that is neither a draft nor open, as the Closed filter lists it.
    expect(result.ok && result.value.counts).toEqual({ all: 3, draft: 1, open: 0, closed: 2 });
    expect(result.ok && result.value.canManage).toBe(true);
  });

  it('gives the popup its choices: the next fiscal year, a deadline, the structure with heads, the forms', async () => {
    repo.listCycles.mockResolvedValue([]);
    const form = { id: FORM, name: { ar: 'نموذج', en: 'Form' }, isDefault: true, active: true };
    forms.listNeedsFormOptions.mockResolvedValue([form]);
    const { query } = runtime('training_manager');
    const result = await query(defs.planCyclesListQueryDefinition())({});
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.setup).toEqual({
      defaults: { periodStart: '2027-07-01', periodEnd: '2028-06-30', deadline: '2026-11-16' },
      // The language whose name the form requires (WP-FIX-03): the organization's default language.
      nameLanguage: 'en',
      units: [
        expect.objectContaining({
          id: SALES,
          depth: 0,
          hasHead: true,
          head: { name: { ar: 'رئيس', en: 'Head' }, via: null },
        }),
        // No head of its own: the form goes to the nearest head above.
        expect.objectContaining({
          id: EAST,
          depth: 1,
          hasHead: true,
          head: { name: { ar: 'رئيس', en: 'Head' }, via: { ar: 'المبيعات', en: 'Sales' } },
        }),
      ],
      branches: [{ id: JED, name: { ar: 'جدة', en: 'Jeddah' }, active: true }],
      levels: LEVELS,
      needsForms: [form],
    });
  });

  it('gives each draft what its row menu needs: version, scope, form, and what stops the launch', async () => {
    const row = {
      id: CYCLE,
      nameAr: 'خطة',
      nameEn: 'Plan',
      periodStart: '2027-01-01',
      periodEnd: '2027-12-31',
      deadline: '2026-11-30',
      latestDeadline: '2026-11-30',
      status: 'draft',
      departmentCount: 2,
      submittedCount: 0,
    };
    const draft = {
      id: CYCLE,
      version: 3,
      needsFormId: FORM,
      scope: { departmentIds: [SALES], branchIds: [] },
    };
    // The open cycle's deadline has passed and no department has an extension: it is shown as Closed
    // and the launch would close it first, so it stands in nobody's way.
    const passed = {
      ...row,
      id: 'open',
      status: 'open',
      deadline: '2026-10-10',
      latestDeadline: '2026-10-10',
    };
    repo.listCycles.mockResolvedValue([row, { ...row, id: 'd2' }, passed]);
    repo.listDraftDetails.mockResolvedValue([draft, { ...draft, id: 'd2' }]);
    const off = {
      id: FORM,
      name: { ar: 'نموذج', en: 'Old form' },
      isDefault: false,
      active: false,
    };
    // The cycles' own form was switched off since: it is not among the active forms (C-6).
    forms.listNeedsFormOptions.mockImplementation((_tx: unknown, current?: string | null) =>
      Promise.resolve(current ? [off] : []),
    );
    const { query } = runtime('training_manager');
    const ready = await query(defs.planCyclesListQueryDefinition())({});
    if (!ready.ok) throw new Error(ready.error.code);
    const expected = {
      version: 3,
      needsFormId: FORM,
      needsFormOff: off,
      scope: { departmentIds: [SALES], branchIds: [] },
      // No approval chain is asked for: nothing stops the launch (EP-PLN §13 e).
      problems: [],
    };
    expect(ready.value.cycles.map((c) => c.draft)).toEqual([expected, expected, null]);
    // Asked once for the whole list — not once per draft: the drafts in one read, the open cycle from
    // the list itself, and a switched-off form looked up once however many drafts use it.
    expect(repo.listDraftDetails).toHaveBeenCalledTimes(1);
    expect(repo.getCycle).not.toHaveBeenCalled();
    expect(repo.openCycle).not.toHaveBeenCalled();
    expect(forms.listNeedsFormOptions).toHaveBeenCalledTimes(2);

    // Launch problems count the departments the scope covers NOW and see the other open cycle — which
    // stays in the way while ONE department's extension runs, although its own deadline has passed:
    // the same rule the launch applies (it closes an open cycle only once every deadline has passed).
    repo.listCycles.mockResolvedValue([
      { ...row, deadline: '2026-10-01', latestDeadline: '2026-10-01' },
      { ...passed, latestDeadline: '2026-10-20' },
    ]);
    repo.listDraftDetails.mockResolvedValue([
      { ...draft, scope: { departmentIds: [], branchIds: [] } },
    ]);
    const blocked = await query(defs.planCyclesListQueryDefinition())({});
    expect(blocked.ok && blocked.value.cycles[0]?.draft?.problems).toEqual([
      'deadline_past',
      'no_departments',
      'another_open',
    ]);
    // The extension ends today: still open today.
    repo.listCycles.mockResolvedValue([row, { ...passed, latestDeadline: '2026-10-17' }]);
    repo.listDraftDetails.mockResolvedValue([draft]);
    const lastDay = await query(defs.planCyclesListQueryDefinition())({});
    expect(lastDay.ok && lastDay.value.cycles[0]?.draft?.problems).toEqual(['another_open']);
  });

  it('shows a draft with its departments, heads (own or from above) and readiness — no chain', async () => {
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
    // The approval chain is not part of the view any more (EP-PLN §13 e): the stored one is not shown.
    expect(view).not.toHaveProperty('steps');
    expect(view.departments.map((d) => d.head?.name.en ?? null)).toEqual(['Head', 'Head']);
    expect(view.setup?.units.map((u) => [u.id, u.depth, u.levelOrdinal])).toEqual([
      [SALES, 0, 1],
      [EAST, 1, 2],
    ]);
    // The level of each row and the organization's level names, for the tables' labels.
    expect(view.departments.map((d) => d.levelOrdinal)).toEqual([1, 2]);
    expect(view.levels).toEqual(LEVELS);
    expect(view.setup?.needsForms).toEqual([]);
  });

  it('shows the progress of an open cycle; Late after the deadline; not-ready problems of a draft', async () => {
    repo.getCycle.mockResolvedValue(
      record({ status: 'open', deadline: '2026-10-10', latestDeadline: '2026-10-10' }),
    );
    const { query } = runtime('training_manager');
    const open = await query(defs.planCycleQueryDefinition())({ id: CYCLE });
    expect(open.ok && open.value.status).toBe('closed');
    expect(open.ok && open.value.departments.map((d) => d.status)).toEqual(['late', 'late']);
    // C-7: shown as Closed by date, still open in the database — the L&D Manager can extend it.
    expect(open.ok && open.value.canExtend).toBe(true);
    expect(open.ok && open.value.setup).toBeNull();

    repo.getCycle.mockResolvedValue(
      record({ departments: [], deadline: '2026-10-01', needsFormId: null }),
    );
    repo.openCycle.mockResolvedValue({ id: 'other', latestDeadline: '2026-12-01' });
    const draft = await query(defs.planCycleQueryDefinition())({ id: CYCLE });
    expect(draft.ok && draft.value.problems).toEqual([
      'deadline_past',
      'no_needs_form',
      'no_departments',
      'another_open',
    ]);
    // The other cycle's every deadline has passed (its own and its departments' extensions): the launch
    // closes it first, so the page does not hold the draft back — the rule the launch applies.
    repo.getCycle.mockResolvedValue(record());
    repo.openCycle.mockResolvedValue({ id: 'other', latestDeadline: '2026-10-16' });
    const free = await query(defs.planCycleQueryDefinition())({ id: CYCLE });
    expect(free.ok && free.value.problems).toEqual([]);
    // One day of a department's extension left: still in the way.
    repo.openCycle.mockResolvedValue({ id: 'other', latestDeadline: '2026-10-17' });
    const held = await query(defs.planCycleQueryDefinition())({ id: CYCLE });
    expect(held.ok && held.value.problems).toEqual(['another_open']);
  });

  it('answers 404 for a cycle it cannot see (another organization: RLS returns nothing)', async () => {
    repo.getCycle.mockResolvedValue(null);
    const { query } = runtime('training_manager');
    const result = await query(defs.planCycleQueryDefinition())({ id: CYCLE });
    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
  });
});

describe('L&D Manager: create and cycle settings', () => {
  it('creates a draft and audits it', async () => {
    // No form chosen: the database stores the default one, and the audit records it (C-10).
    repo.insertCycle.mockResolvedValue({ id: CYCLE, version: 1, needsFormId: FORM });
    const { action, audits } = runtime('training_manager');
    const result = await action(defs.createPlanCycleActionDefinition())({
      ...basics,
      needsFormId: null,
    });
    expect(result.ok && result.value).toEqual({
      id: CYCLE,
      version: 1,
      needsFormId: FORM,
      departmentCount: 0,
    });
    // No scope picked: nothing is written for it.
    expect(repo.replaceScope).not.toHaveBeenCalled();
    expect(audits).toEqual([
      {
        action: 'tms.plan_cycle.created',
        entityType: 'plan_cycle',
        entityId: CYCLE,
        data: {
          after: { ...basics, needsFormId: FORM, departmentIds: [], branchIds: [], departments: 0 },
        },
      },
    ]);
  });

  it('creates a draft with its departments in the same transaction (the popup); unknown units refused', async () => {
    repo.insertCycle.mockResolvedValue({ id: CYCLE, version: 1, needsFormId: FORM });
    const { action, audits } = runtime('training_manager');
    const create = action(defs.createPlanCycleActionDefinition());
    const result = await create({ ...basics, needsFormId: null, departmentIds: [SALES] });
    // A unit includes its sub-units: two forms.
    expect(result.ok && result.value.departmentCount).toBe(2);
    // The cycle itself is inserted with the basics only…
    expect(repo.insertCycle).toHaveBeenCalledWith(
      {},
      { ...basics, instructionsAr: null, instructionsEn: null, needsFormId: null },
    );
    // …then its scope, as the scope action writes it.
    expect(repo.replaceScope).toHaveBeenCalledWith(
      {},
      CYCLE,
      { departmentIds: [SALES], branchIds: [] },
      [SALES, EAST],
    );
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'tms.plan_cycle.created',
        data: {
          after: {
            ...basics,
            needsFormId: FORM,
            departmentIds: [SALES],
            branchIds: [],
            departments: 2,
          },
        },
      }),
    ]);
    // A branch covers its departments.
    const byBranch = await create({ ...basics, needsFormId: null, branchIds: [JED] });
    expect(byBranch.ok && byBranch.value.departmentCount).toBe(1);
    // A unit or branch that is not in the structure (any more): refused before anything is written.
    repo.insertCycle.mockClear();
    const unknown = await create({
      ...basics,
      needsFormId: null,
      departmentIds: [SALES, CFO],
      branchIds: [GM],
    });
    expect(!unknown.ok && unknown.error.fieldErrors).toEqual([
      { path: 'departmentIds.1', code: 'UNKNOWN' },
      { path: 'branchIds.0', code: 'UNKNOWN' },
    ]);
    expect(repo.insertCycle).not.toHaveBeenCalled();
  });

  it('asks for the name in the default language only; the other language is optional (PO, 12 Nov 2026)', async () => {
    repo.insertCycle.mockResolvedValue({ id: CYCLE, version: 1, needsFormId: FORM });
    const { action, audits } = runtime('training_manager');
    const create = action(defs.createPlanCycleActionDefinition());
    // English is the default language: an English name alone is enough…
    const englishOnly = await create({ ...basics, nameAr: '', needsFormId: null });
    expect(englishOnly.ok).toBe(true);
    expect(repo.insertCycle).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ nameAr: null, nameEn: basics.nameEn }),
    );
    expect(audits[0]).toMatchObject({
      data: { after: { nameAr: null, nameEn: basics.nameEn } },
    });
    // …and an Arabic name alone is refused, on the English field.
    const arabicOnly = await create({ ...basics, nameEn: '', needsFormId: null });
    expect(!arabicOnly.ok && arabicOnly.error.fieldErrors).toEqual([
      { path: 'nameEn', code: 'REQUIRED' },
    ]);
    // With Arabic as the default language it is the other way round.
    db.getTenantDefaultLocale.mockResolvedValue('ar');
    const arabicDefault = await create({ ...basics, nameEn: '', needsFormId: null });
    expect(arabicDefault.ok).toBe(true);
    const noArabic = await create({ ...basics, nameAr: '   ', needsFormId: null });
    expect(!noArabic.ok && noArabic.error.fieldErrors).toEqual([
      { path: 'nameAr', code: 'REQUIRED' },
    ]);
    // The basics of an existing cycle follow the same rule.
    const basicsSaved = await action(defs.updatePlanCycleBasicsActionDefinition())({
      ...basics,
      nameAr: null,
      id: CYCLE,
      version: 3,
      needsFormId: null,
    });
    expect(!basicsSaved.ok && basicsSaved.error.fieldErrors).toEqual([
      { path: 'nameAr', code: 'REQUIRED' },
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

  describe('«Edit» in the popup: names, dates, form and departments in one transaction', () => {
    const edit = { ...basics, needsFormId: FORM, id: CYCLE, version: 3 };
    beforeEach(() => {
      forms.listNeedsFormOptions.mockResolvedValue([
        { id: FORM, name: { ar: 'نموذج', en: 'Form' }, isDefault: true, active: true },
      ]);
      repo.updateBasics.mockResolvedValue(5);
    });

    it('saves both parts with one version and one audit record', async () => {
      const { action, audits } = runtime('training_manager');
      const result = await action(defs.updatePlanCycleActionDefinition())({
        ...edit,
        departmentIds: [],
        branchIds: [JED],
      });
      expect(result.ok && result.value).toMatchObject({
        id: CYCLE,
        version: 5,
        departmentCount: 1,
      });
      // One version check and bump for the whole edit.
      expect(repo.touchCycle).toHaveBeenCalledExactlyOnceWith({}, CYCLE, 3, { draftOnly: true });
      // The instructions are not part of the popup: they are written back as they are stored.
      expect(repo.updateBasics).toHaveBeenCalledExactlyOnceWith({}, CYCLE, {
        ...basics,
        needsFormId: FORM,
        instructionsAr: null,
        instructionsEn: 'Old words',
      });
      expect(repo.replaceScope).toHaveBeenCalledExactlyOnceWith(
        {},
        CYCLE,
        { departmentIds: [], branchIds: [JED] },
        [EAST],
      );
      expect(audits).toEqual([
        {
          action: 'tms.plan_cycle.changed',
          entityType: 'plan_cycle',
          entityId: CYCLE,
          data: {
            changed: ['nameAr', 'nameEn', 'scope'],
            before: {
              nameAr: 'خطة',
              nameEn: 'Plan',
              scope: { departmentIds: [SALES], branchIds: [] },
            },
            after: {
              nameAr: 'خطة ٢٠٢٧',
              nameEn: 'Plan 2027',
              scope: { departmentIds: [], branchIds: [JED] },
            },
            departments: 1,
          },
        },
      ]);
    });

    it('a refused part saves nothing: neither the names nor the departments', async () => {
      const { action, audits } = runtime('training_manager');
      const update = action(defs.updatePlanCycleActionDefinition());
      // A department that is no longer in the structure: the names are not saved either.
      const unknown = await update({ ...edit, departmentIds: [SALES, CFO], branchIds: [] });
      expect(!unknown.ok && unknown.error.fieldErrors).toEqual([
        { path: 'departmentIds.1', code: 'UNKNOWN' },
      ]);
      // A wrong date with good departments: the departments are not saved either.
      const dates = await update({
        ...edit,
        periodEnd: '2026-12-01',
        departmentIds: [SALES],
        branchIds: [],
      });
      expect(!dates.ok && dates.error.fieldErrors).toEqual([
        { path: 'periodEnd', code: 'BEFORE_START' },
      ]);
      // An older copy of the cycle: refused as a whole.
      repo.touchCycle.mockResolvedValue({ outcome: 'conflict' });
      const stale = await update({ ...edit, departmentIds: [SALES], branchIds: [] });
      expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');
      // A launched cycle: refused as a whole.
      repo.touchCycle.mockResolvedValue({ outcome: 'not_draft' });
      const launched = await update({ ...edit, departmentIds: [SALES], branchIds: [] });
      expect(!launched.ok && launched.error.code).toBe('PLAN_CYCLE_NOT_DRAFT');
      expect(repo.updateBasics).not.toHaveBeenCalled();
      expect(repo.replaceScope).not.toHaveBeenCalled();
      expect(audits).toEqual([]);
    });

    it('follows the same rules as the separate actions; nothing changed leaves no audit record', async () => {
      repo.getCycle.mockResolvedValue(record({ nameAr: basics.nameAr, nameEn: basics.nameEn }));
      const { action, audits } = runtime('training_manager');
      const update = action(defs.updatePlanCycleActionDefinition());
      const same = await update({ ...edit, departmentIds: [SALES], branchIds: [] });
      expect(same.ok && same.value.changed).toEqual([]);
      expect(audits).toEqual([]);
      // The name of the default language is required; an unknown needs form is refused.
      const noName = await update({ ...edit, nameEn: '', departmentIds: [SALES], branchIds: [] });
      expect(!noName.ok && noName.error.fieldErrors).toEqual([
        { path: 'nameEn', code: 'REQUIRED' },
      ]);
      const otherForm = await update({
        ...edit,
        needsFormId: CFO,
        departmentIds: [SALES],
        branchIds: [],
      });
      expect(!otherForm.ok && otherForm.error.fieldErrors).toEqual([
        { path: 'needsFormId', code: 'UNKNOWN' },
      ]);
      // A cycle of another organization is not found (row-level security returns nothing).
      repo.getCycle.mockResolvedValue(null);
      const gone = await update({ ...edit, departmentIds: [SALES], branchIds: [] });
      expect(!gone.ok && gone.error.code).toBe('NOT_FOUND');
    });

    it.each(['training_coordinator', 'tenant_admin', 'hr_manager', 'department_head', 'learner'])(
      '%s cannot edit a cycle (403)',
      async (role) => {
        const { action, audits } = runtime(role, role === 'department_head' ? [SALES] : []);
        const result = await action(defs.updatePlanCycleActionDefinition())({
          ...edit,
          departmentIds: [SALES],
          branchIds: [],
        });
        expect(!result.ok && result.error.code).toBe('FORBIDDEN');
        expect(repo.getCycle).not.toHaveBeenCalled();
        expect(audits).toEqual([]);
      },
    );
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
  it('launches: departments re-synced, due cycles closed first, audited — without an approval chain', async () => {
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
          // No `approvalChain`: a cycle has none (EP-PLN §13 e), and person ids stay out of the record.
          closedCycleIds: ['old'],
        },
      },
    ]);
  });

  it('refuses a launch while another cycle is open (Q1) or when not ready; nothing launched', async () => {
    const { action, audits } = runtime('training_manager');
    repo.openCycle.mockResolvedValue({ id: 'other', latestDeadline: '2026-12-01' });
    const busy = await action(defs.launchPlanCycleActionDefinition())({ id: CYCLE, version: 3 });
    expect(!busy.ok && busy.error.code).toBe('PLAN_CYCLE_OPEN_EXISTS');
    repo.openCycle.mockResolvedValue(null);
    // Not ready: the deadline has passed and no needs form is chosen.
    repo.getCycle.mockResolvedValue(record({ deadline: '2026-10-16', needsFormId: null }));
    const notReady = await action(defs.launchPlanCycleActionDefinition())({
      id: CYCLE,
      version: 3,
    });
    expect(!notReady.ok && notReady.error).toMatchObject({
      code: 'PLAN_CYCLE_NOT_READY',
      params: { reasons: 'deadline_past,no_needs_form' },
    });
    // Not ready: the scope covers no department any more.
    repo.getCycle.mockResolvedValue(record({ scope: { departmentIds: [], branchIds: [] } }));
    const empty = await action(defs.launchPlanCycleActionDefinition())({ id: CYCLE, version: 3 });
    expect(!empty.ok && empty.error.params).toEqual({ reasons: 'no_departments' });
    expect(repo.launch).not.toHaveBeenCalled();
    repo.getCycle.mockResolvedValue(record());
    repo.launch.mockResolvedValue({ outcome: 'another_open' });
    const race = await action(defs.launchPlanCycleActionDefinition())({ id: CYCLE, version: 3 });
    expect(!race.ok && race.error.code).toBe('PLAN_CYCLE_OPEN_EXISTS');
    // The database has the last word (it checks again): its reason is passed on.
    repo.launch.mockResolvedValue({ outcome: 'not_ready', reason: 'no_needs_form' });
    const late = await action(defs.launchPlanCycleActionDefinition())({ id: CYCLE, version: 3 });
    expect(!late.ok && late.error.params).toEqual({ reasons: 'no_needs_form' });
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
    repo.getCycle.mockResolvedValue(
      record({ status: 'open', deadline: '2026-10-10', latestDeadline: '2026-10-10' }),
    );
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

  it('saves the planning settings (the default reminders), audited; the stored chain is left alone', async () => {
    repo.getSettings.mockResolvedValue({ version: null, reminderDays: [7, 2] });
    repo.saveSettings.mockResolvedValue(1);
    const { action, audits } = runtime('training_manager');
    const result = await action(defs.savePlanningSettingsActionDefinition())({
      reminderDays: [10, 3],
    });
    expect(result.ok && result.value.version).toBe(1);
    expect(repo.saveSettings).toHaveBeenCalledWith({}, [10, 3]);
    expect(audits).toEqual([
      {
        action: 'tms.planning_settings.changed',
        entityType: 'planning_settings',
        data: { before: { reminderDays: [7, 2] }, after: { reminderDays: [10, 3] } },
      },
    ]);
    // A chain is not part of the settings any more: sending one is refused as unknown input.
    const withChain = await action(defs.savePlanningSettingsActionDefinition())({
      reminderDays: [10],
      steps: [{ kind: 'person', nameAr: 'مالية', nameEn: 'Finance', approverPersonId: CFO }],
    } as never);
    expect(!withChain.ok && withChain.error.code).toBe('VALIDATION_FAILED');
  });
});
