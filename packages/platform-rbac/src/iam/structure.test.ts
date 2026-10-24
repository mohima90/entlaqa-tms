import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { type TestRoleCode, testRoleGrants } from '../testing/former-roles';
import {
  BranchInput,
  branchesPageQueryDefinition,
  createBranchActionDefinition,
  deleteBranchActionDefinition,
  updateBranchActionDefinition,
} from './branches';
import {
  CreateUnitInput,
  LevelInput,
  addStructureLevelActionDefinition,
  createStructureUnitActionDefinition,
  deleteStructureUnitActionDefinition,
  removeStructureLevelActionDefinition,
  renameStructureLevelActionDefinition,
  setStructureUnitStatusActionDefinition,
  structurePageQueryDefinition,
  updateStructureUnitActionDefinition,
} from './structure';

const db = vi.hoisted(() => ({
  listStructureLevels: vi.fn(),
  listStructureUnits: vi.fn(),
  listOrgUnitOptions: vi.fn(),
  listActivePersonOptions: vi.fn(),
  listCostCentreOptions: vi.fn(),
  structureLevelsLocked: vi.fn(),
  moveStructureUnit: vi.fn(),
  reorderStructureUnit: vi.fn(),
  previewStructureUnitMove: vi.fn(),
  addStructureLevel: vi.fn(),
  renameStructureLevel: vi.fn(),
  removeStructureLevel: vi.fn(),
  createStructureUnit: vi.fn(),
  updateStructureUnit: vi.fn(),
  setStructureUnitStatus: vi.fn(),
  deleteStructureUnit: vi.fn(),
  listBranches: vi.fn(),
  createBranch: vi.fn(),
  updateBranch: vi.fn(),
  setBranchStatus: vi.fn(),
  deleteBranch: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const UNIT = '44444444-4444-4444-8444-444444444444';
const LEVEL = '55555555-5555-4555-8555-555555555555';
const HEAD = '66666666-6666-4666-8666-666666666666';
const BRANCH = '77777777-7777-4777-8777-777777777777';

function runtime(roles: TestRoleCode[]) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const getClaims = vi.fn((_options: { strict: boolean }) => {
    const r = brandVerifiedClaims({
      sub: '11111111-1111-4111-8111-111111111111',
      role: 'authenticated',
      aal: 'aal1',
      tenant_id: TENANT,
      person_id: ME,
    });
    if (!r.ok) throw new Error('fixture');
    return Promise.resolve(ok(r.value));
  });
  const rt: ActionRuntime<UserTx> = {
    getClaims,
    withUserTx: (_c, fn) => fn(TX),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: false }),
    loadGrants: () => Promise.resolve(testRoleGrants(roles)),
    resolveResource: () => Promise.resolve(null),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit, getClaims };
}

const level = (over: Record<string, unknown> = {}) => ({
  id: LEVEL,
  ordinal: 2,
  nameEn: 'Section',
  nameAr: 'قسم',
  version: 1,
  unitCount: 0,
  ...over,
});
const unit = (over: Record<string, unknown> = {}) => ({
  id: UNIT,
  code: 'SAL',
  nameAr: 'المبيعات',
  nameEn: 'Sales',
  parentId: null,
  levelOrdinal: 1,
  branchId: null,
  headPersonId: HEAD,
  headNameAr: 'منى',
  headNameEn: 'Mona',
  status: 'active',
  sortOrder: 0,
  version: 1,
  childCount: 0,
  peopleCount: 0,
  roleScopeCount: 0,
  ...over,
});
const unitForm = {
  parentId: '',
  code: ' SAL ',
  nameEn: ' Sales ',
  nameAr: 'المبيعات',
  branchId: '',
  headPersonId: HEAD,
  defaultCostCentreId: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.listStructureLevels.mockResolvedValue([level({ ordinal: 1, nameEn: 'Department' })]);
  db.listStructureUnits.mockResolvedValue([unit()]);
  db.listOrgUnitOptions.mockResolvedValue({ departments: [], branches: [{ id: BRANCH }] });
  db.listActivePersonOptions.mockResolvedValue([{ id: HEAD, nameAr: 'منى' }]);
  db.listCostCentreOptions.mockResolvedValue([]);
  db.structureLevelsLocked.mockResolvedValue(true);
});

describe('inputs', () => {
  it('trims names and codes; empty references become null; unknown fields are refused', () => {
    expect(CreateUnitInput.parse(unitForm)).toEqual({
      parentId: null,
      code: 'SAL',
      nameEn: 'Sales',
      nameAr: 'المبيعات',
      branchId: null,
      headPersonId: HEAD,
      defaultCostCentreId: null,
    });
    for (const code of ['', 'with space', '-start', 'x'.repeat(33)]) {
      expect(CreateUnitInput.safeParse({ ...unitForm, code }).success, code).toBe(false);
    }
    expect(CreateUnitInput.safeParse({ ...unitForm, levelOrdinal: 3 }).success).toBe(false);
    expect(LevelInput.safeParse({ nameEn: 'Team', nameAr: chr(8203) }).success).toBe(false);
    expect(LevelInput.safeParse({ nameEn: 'T'.repeat(61), nameAr: 'فريق' }).success).toBe(false);
    expect(BranchInput.safeParse({ ...branchForm, countryCode: 'sa' }).success).toBe(false);
    expect(BranchInput.safeParse({ ...branchForm, timezone: '../etc' }).success).toBe(false);
  });
});

function chr(code: number): string {
  return String.fromCodePoint(code);
}

describe('structure page (platform.org.read)', () => {
  it('HR Manager: the levels, the tree and the form choices; changes allowed', async () => {
    const query = createDefineQuery(runtime(['hr_manager']).rt)(structurePageQueryDefinition());
    const result = await query({});
    expect(result).toEqual(
      ok({
        levels: [level({ ordinal: 1, nameEn: 'Department' })],
        units: [unit()],
        branches: [{ id: BRANCH }],
        people: [{ id: HEAD, nameAr: 'منى' }],
        costCentres: [],
        levelsLocked: true,
        canManage: true,
      }),
    );
  });

  it('others who read the structure see it without the forms; learners are refused', async () => {
    for (const roles of [['tenant_admin'], ['training_manager'], ['department_head']] as const) {
      const result = await createDefineQuery(runtime([...roles]).rt)(
        structurePageQueryDefinition(),
      )({});
      expect(result.ok && result.value, roles[0]).toMatchObject({
        canManage: false,
        people: [],
        branches: [],
      });
    }
    expect(db.listActivePersonOptions).not.toHaveBeenCalled();
    const learner = await createDefineQuery(runtime(['learner']).rt)(
      structurePageQueryDefinition(),
    )({});
    expect(!learner.ok && learner.error.code).toBe('FORBIDDEN');
  });
});

describe('structure changes (platform.org.manage)', () => {
  const actions = [
    [addStructureLevelActionDefinition(), { nameEn: 'Team', nameAr: 'فريق' }],
    [renameStructureLevelActionDefinition(), { id: LEVEL, version: 1, nameEn: 'T', nameAr: 'ف' }],
    [removeStructureLevelActionDefinition(), { id: LEVEL, version: 1 }],
    [createStructureUnitActionDefinition(), unitForm],
    [
      updateStructureUnitActionDefinition(),
      { ...unitForm, parentId: undefined, id: UNIT, version: 1 },
    ],
    [setStructureUnitStatusActionDefinition(), { id: UNIT, version: 1, status: 'inactive' }],
    [deleteStructureUnitActionDefinition(), { id: UNIT, version: 1 }],
  ] as const;

  it('only the HR Manager changes the structure: the Organization Admin, L&D and learners are refused', async () => {
    for (const roles of [
      ['tenant_admin'],
      ['training_manager'],
      ['learner'],
      ['auditor'],
    ] as const) {
      for (const [definition, input] of actions) {
        const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
        const run = createDefineAction(runtime([...roles]).rt)(definition as never) as (
          input: unknown,
        ) => Promise<{ ok: boolean; error?: { code: string } }>;
        const result = await run(clean);
        expect(!result.ok && result.error?.code, roles[0]).toBe('FORBIDDEN');
      }
    }
    for (const fn of [
      db.addStructureLevel,
      db.renameStructureLevel,
      db.removeStructureLevel,
      db.createStructureUnit,
      db.updateStructureUnit,
      db.setStructureUnitStatus,
      db.deleteStructureUnit,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('adds a level, audited with its names (no strict session check: medium risk, no step-up)', async () => {
    const { rt, writeAudit, getClaims } = runtime(['hr_manager']);
    db.addStructureLevel.mockResolvedValue({ ok: true, before: null, after: level() });
    const result = await createDefineAction(rt)(addStructureLevelActionDefinition())({
      nameEn: ' Section ',
      nameAr: 'قسم',
    });
    expect(result.ok).toBe(true);
    expect(db.addStructureLevel).toHaveBeenCalledWith(TX, { nameEn: 'Section', nameAr: 'قسم' });
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.org.level_added',
      entityType: 'structure_level',
      entityId: LEVEL,
      data: { before: null, after: { ordinal: 2, nameEn: 'Section', nameAr: 'قسم' } },
    });
    expect(getClaims).toHaveBeenCalledWith({ strict: false });
  });

  it('maps level refusals to field errors with counts', async () => {
    const { rt, writeAudit } = runtime(['hr_manager']);
    const remove = createDefineAction(rt)(removeStructureLevelActionDefinition());
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ refusal: 'not_found' }, { code: 'NOT_FOUND' }],
      [{ refusal: 'version_conflict' }, { code: 'CONFLICT_VERSION' }],
      [{ refusal: 'not_last_level' }, { fieldErrors: [{ path: 'level', code: 'NOT_LAST_LEVEL' }] }],
      [{ refusal: 'only_level' }, { fieldErrors: [{ path: 'level', code: 'ONLY_LEVEL' }] }],
      [
        { refusal: 'level_in_use', usage: { units: 3, people: 0, roles: 0 } },
        { fieldErrors: [{ path: 'level', code: 'LEVEL_IN_USE' }], params: { units: 3 } },
      ],
    ];
    for (const [outcome, error] of cases) {
      db.removeStructureLevel.mockResolvedValueOnce({ ok: false, ...outcome });
      const result = await remove({ id: LEVEL, version: 1 });
      expect(!result.ok && result.error).toMatchObject(error);
    }
    const add = createDefineAction(rt)(addStructureLevelActionDefinition());
    for (const [refusal, path, code] of [
      ['too_many_levels', 'level', 'TOO_MANY_LEVELS'],
      ['name_en_taken', 'nameEn', 'NAME_TAKEN'],
      ['name_ar_taken', 'nameAr', 'NAME_TAKEN'],
    ] as const) {
      db.addStructureLevel.mockResolvedValueOnce({ ok: false, refusal });
      const result = await add({ nameEn: 'Team', nameAr: 'فريق' });
      expect(!result.ok && result.error.fieldErrors).toEqual([{ path, code }]);
    }
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('creates a unit under a parent and edits its head, audited before/after (head as an id)', async () => {
    const { rt, writeAudit } = runtime(['hr_manager']);
    db.createStructureUnit.mockResolvedValue({ ok: true, before: null, after: unit() });
    const created = await createDefineAction(rt)(createStructureUnitActionDefinition())({
      ...unitForm,
      parentId: LEVEL,
    });
    expect(created.ok).toBe(true);
    expect(db.createStructureUnit).toHaveBeenCalledWith(TX, LEVEL, {
      code: 'SAL',
      nameEn: 'Sales',
      nameAr: 'المبيعات',
      branchId: null,
      headPersonId: HEAD,
      defaultCostCentreId: null,
    });
    db.updateStructureUnit.mockResolvedValue({
      ok: true,
      before: unit(),
      after: unit({ headPersonId: null, version: 2 }),
    });
    const { parentId: _parent, ...fields } = unitForm;
    await createDefineAction(rt)(updateStructureUnitActionDefinition())({
      ...fields,
      headPersonId: '',
      id: UNIT,
      version: 1,
    });
    expect(writeAudit).toHaveBeenLastCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({
        action: 'platform.org.unit_updated',
        entityId: UNIT,
        data: {
          before: expect.objectContaining({ headPersonId: HEAD }),
          after: expect.objectContaining({ headPersonId: null }),
        },
      }),
    );
    const audited = JSON.stringify(writeAudit.mock.calls);
    expect(audited).not.toContain('منى');
    expect(audited).not.toContain('Mona');
  });

  it('refuses to delete a unit still in use, with what is left; below the last level on create', async () => {
    const { rt, writeAudit } = runtime(['hr_manager']);
    db.deleteStructureUnit.mockResolvedValue({
      ok: false,
      refusal: 'unit_in_use',
      usage: { units: 2, people: 5, roles: 1 },
    });
    const deleted = await createDefineAction(rt)(deleteStructureUnitActionDefinition())({
      id: UNIT,
      version: 1,
    });
    expect(!deleted.ok && deleted.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ path: 'unit', code: 'UNIT_IN_USE' }],
      params: { units: 2, people: 5, roles: 1 },
    });
    db.createStructureUnit.mockResolvedValue({ ok: false, refusal: 'below_last_level' });
    const below = await createDefineAction(rt)(createStructureUnitActionDefinition())({
      ...unitForm,
      parentId: UNIT,
    });
    expect(!below.ok && below.error.fieldErrors).toEqual([
      { path: 'parentId', code: 'BELOW_LAST_LEVEL' },
    ]);
    for (const [refusal, path, code] of [
      ['code_taken', 'code', 'CODE_TAKEN'],
      ['head_not_active', 'headPersonId', 'HEAD_NOT_ACTIVE'],
      ['branch_not_found', 'branchId', 'BRANCH_NOT_FOUND'],
      ['parent_not_found', 'parentId', 'PARENT_NOT_FOUND'],
    ] as const) {
      db.createStructureUnit.mockResolvedValueOnce({ ok: false, refusal });
      const result = await createDefineAction(rt)(createStructureUnitActionDefinition())(unitForm);
      expect(!result.ok && result.error.fieldErrors).toEqual([{ path, code }]);
    }
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('deactivating is audited with the status before and after', async () => {
    const { rt, writeAudit } = runtime(['hr_manager']);
    db.setStructureUnitStatus.mockResolvedValue({
      ok: true,
      before: unit(),
      after: unit({ status: 'inactive', version: 2 }),
    });
    await createDefineAction(rt)(setStructureUnitStatusActionDefinition())({
      id: UNIT,
      version: 1,
      status: 'inactive',
    });
    expect(writeAudit).toHaveBeenCalledWith(TX, expect.anything(), {
      action: 'platform.org.unit_status_changed',
      entityType: 'structure_unit',
      entityId: UNIT,
      data: { before: 'active', after: 'inactive' },
    });
  });
});

const branchForm = {
  code: 'RUH',
  nameEn: 'Riyadh',
  nameAr: 'الرياض',
  parentBranchId: '',
  countryCode: 'SA',
  cityAr: '',
  cityEn: 'Riyadh',
  timezone: 'Asia/Riyadh',
  isHeadquarters: true,
  addressEn: '',
  addressAr: '',
  latitude: '',
  longitude: '',
  workingDays: null,
};
const branch = (over: Record<string, unknown> = {}) => ({
  id: BRANCH,
  code: 'RUH',
  nameAr: 'الرياض',
  nameEn: 'Riyadh',
  parentBranchId: null,
  countryCode: 'SA',
  cityAr: null,
  cityEn: 'Riyadh',
  timezone: 'Asia/Riyadh',
  isHeadquarters: true,
  status: 'active',
  version: 1,
  childCount: 0,
  unitCount: 0,
  peopleCount: 0,
  ...over,
});

describe('branches (FR-ADM-04)', () => {
  it('everyone who reads the structure sees the branches; only the HR Manager changes them', async () => {
    db.listBranches.mockResolvedValue([branch()]);
    const hr = await createDefineQuery(runtime(['hr_manager']).rt)(branchesPageQueryDefinition())(
      {},
    );
    expect(hr).toEqual(ok({ branches: [branch()], canManage: true }));
    const admin = await createDefineQuery(runtime(['tenant_admin']).rt)(
      branchesPageQueryDefinition(),
    )({});
    expect(admin.ok && admin.value.canManage).toBe(false);
    const learner = await createDefineQuery(runtime(['learner']).rt)(branchesPageQueryDefinition())(
      {},
    );
    expect(!learner.ok && learner.error.code).toBe('FORBIDDEN');
    for (const roles of [['tenant_admin'], ['learner']] as const) {
      const result = await createDefineAction(runtime([...roles]).rt)(
        createBranchActionDefinition(),
      )(branchForm);
      expect(!result.ok && result.error.code).toBe('FORBIDDEN');
    }
    expect(db.createBranch).not.toHaveBeenCalled();
  });

  it('creates a branch (empty optional fields become null), audited; maps refusals', async () => {
    const { rt, writeAudit } = runtime(['hr_manager']);
    db.createBranch.mockResolvedValue({ ok: true, before: null, after: branch() });
    expect((await createDefineAction(rt)(createBranchActionDefinition())(branchForm)).ok).toBe(
      true,
    );
    expect(db.createBranch).toHaveBeenCalledWith(TX, {
      ...branchForm,
      parentBranchId: null,
      cityAr: null,
      addressEn: null,
      addressAr: null,
      latitude: null,
      longitude: null,
    });
    expect(writeAudit).toHaveBeenCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({ action: 'platform.org.branch_created', entityId: BRANCH }),
    );
    // C-9: a new headquarters records the previous one's flag change.
    const OLD_HQ = '99999999-9999-4999-8999-999999999999';
    db.createBranch.mockResolvedValueOnce({
      ok: true,
      before: null,
      after: branch(),
      headquartersMovedFrom: OLD_HQ,
    });
    await createDefineAction(rt)(createBranchActionDefinition())({
      ...branchForm,
      isHeadquarters: true,
    });
    expect(writeAudit).toHaveBeenLastCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({
        action: 'platform.org.branch_created',
        data: expect.objectContaining({
          headquartersMovedFrom: {
            branchId: OLD_HQ,
            before: { isHeadquarters: true },
            after: { isHeadquarters: false },
          },
        }),
      }),
    );
    const update = createDefineAction(rt)(updateBranchActionDefinition());
    const self = await update({ ...branchForm, parentBranchId: BRANCH, id: BRANCH, version: 1 });
    expect(!self.ok && self.error.fieldErrors).toEqual([
      { path: 'parentBranchId', code: 'BRANCH_TREE' },
    ]);
    expect(db.updateBranch).not.toHaveBeenCalled();
    db.deleteBranch.mockResolvedValue({
      ok: false,
      refusal: 'branch_in_use',
      usage: { branches: 1, units: 2, people: 3 },
    });
    const deleted = await createDefineAction(rt)(deleteBranchActionDefinition())({
      id: BRANCH,
      version: 1,
    });
    expect(!deleted.ok && deleted.error).toMatchObject({
      fieldErrors: [{ path: 'branch', code: 'BRANCH_IN_USE' }],
      params: { branches: 1, units: 2, people: 3 },
    });
    db.createBranch.mockResolvedValueOnce({ ok: false, refusal: 'timezone_unknown' });
    const zone = await createDefineAction(rt)(createBranchActionDefinition())(branchForm);
    expect(!zone.ok && zone.error.fieldErrors).toEqual([
      { path: 'timezone', code: 'TIMEZONE_UNKNOWN' },
    ]);
  });
});
