import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type * as PlatformDb from '@jadarat/platform-db';
import type { UserTx } from '@jadarat/platform-db';
import {
  type ActionRuntime,
  type Grant,
  type SystemRoleCode,
  createDefineAction,
  createDefineQuery,
  grantsForAssignments,
} from '@jadarat/platform-rbac';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coursesPageQueryDefinition,
  createCourseActionDefinition,
  setCourseStatusActionDefinition,
  updateCourseActionDefinition,
} from './actions';
import type { CourseRow } from './model';

const db = vi.hoisted(() => ({
  listCourses: vi.fn(),
  countCourseStatuses: vi.fn(),
  listCourseCategories: vi.fn(),
  getCourse: vi.fn(),
  insertCourse: vi.fn(),
  insertCourseCategory: vi.fn(),
  updateCourseRow: vi.fn(),
  updateCourseStatus: vi.fn(),
  COURSE_LIST_LIMIT: 2,
}));
vi.mock('./db', () => db);
vi.mock('@jadarat/platform-db', async (importOriginal) => ({
  ...(await importOriginal<typeof PlatformDb>()),
  getTenantCurrencyCode: vi.fn(() => Promise.resolve('SAR')),
}));

const TX = 'tx' as unknown as UserTx;
const ID = '55555555-5555-4555-8555-555555555555';
const CATEGORY = '66666666-6666-4666-8666-666666666666';

function runtime(
  role: SystemRoleCode,
  headedDepartmentIds: readonly string[] = [],
  grants: readonly Grant[] = grantsForAssignments([{ roleCode: role }], { headedDepartmentIds }),
) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const rt: ActionRuntime<UserTx> = {
    getClaims: vi.fn(() => {
      const r = brandVerifiedClaims({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'authenticated',
        aal: 'aal1',
        tenant_id: '22222222-2222-4222-8222-222222222222',
        person_id: '33333333-3333-4333-8333-333333333333',
      });
      if (!r.ok) throw new Error('fixture');
      return Promise.resolve(ok(r.value));
    }),
    withUserTx: (_c, fn) => fn(TX),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: false }),
    loadGrants: () => Promise.resolve([...grants]),
    resolveResource: () => Promise.resolve(null),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit };
}

const values = {
  code: 'LEAD-101',
  titleEn: 'Strategic management',
  titleAr: 'الإدارة الاستراتيجية',
  descriptionEn: '',
  descriptionAr: '',
  category: { kind: 'none' as const },
  deliveryType: 'classroom' as const,
  durationHours: 12,
  durationDays: 2,
  minParticipants: 8,
  maxParticipants: 20,
  estCostPerSession: 15000,
  estCostPerParticipant: 250,
};

const row = (over: Partial<CourseRow> = {}): CourseRow => ({
  id: ID,
  code: 'LEAD-101',
  titleEn: 'Strategic management',
  titleAr: 'الإدارة الاستراتيجية',
  descriptionEn: null,
  descriptionAr: null,
  categoryId: null,
  deliveryType: 'classroom',
  durationHours: 12,
  durationDays: 2,
  minParticipants: 8,
  maxParticipants: 20,
  estCostPerSession: 15000,
  estCostPerParticipant: 250,
  costCurrency: 'SAR',
  status: 'active',
  version: 1,
  ...over,
});

const pgFailure = (code: string, constraint?: string) =>
  Object.assign(new Error('db'), { code, ...(constraint ? { constraint_name: constraint } : {}) });

beforeEach(() => {
  vi.clearAllMocks();
  db.listCourses.mockResolvedValue([row()]);
  db.countCourseStatuses.mockResolvedValue({ total: 1, active: 1, archived: 0 });
  db.listCourseCategories.mockResolvedValue([]);
  db.insertCourse.mockResolvedValue(ID);
  db.insertCourseCategory.mockResolvedValue({ id: CATEGORY, nameEn: 'Safety', nameAr: 'السلامة' });
  db.getCourse.mockResolvedValue(row());
  db.updateCourseRow.mockResolvedValue(true);
  db.updateCourseStatus.mockResolvedValue(true);
});

describe('authorization (BRD Appendix B «Course library & programs»; deny by default)', () => {
  const create = (role: SystemRoleCode) =>
    createDefineAction(runtime(role).rt)(createCourseActionDefinition())(values);
  const archive = (role: SystemRoleCode) =>
    createDefineAction(runtime(role).rt)(setCourseStatusActionDefinition())({
      id: ID,
      version: 1,
      status: 'archived',
    });
  const page = (role: SystemRoleCode, heads: string[] = []) =>
    createDefineQuery(runtime(role, heads).rt)(coursesPageQueryDefinition())({});

  it('refuses every course action to the Organization Admin, a setup role (BR-IAM-4)', async () => {
    for (const result of [
      await page('tenant_admin'),
      await create('tenant_admin'),
      await archive('tenant_admin'),
    ]) {
      expect(!result.ok && result.error.code).toBe('FORBIDDEN');
    }
    expect(db.insertCourse).not.toHaveBeenCalled();
    expect(db.updateCourseStatus).not.toHaveBeenCalled();
  });

  it('refuses the Employee the library for now (their catalogue comes with M4)', async () => {
    for (const result of [
      await page('learner'),
      await create('learner'),
      await archive('learner'),
    ]) {
      expect(!result.ok && result.error.code).toBe('FORBIDDEN');
    }
  });

  it('lets the HR Manager and the Department Head read, not change', async () => {
    for (const [role, heads] of [
      ['hr_manager', []],
      ['department_head', ['77777777-7777-4777-8777-777777777777']],
    ] as const) {
      const view = await page(role, [...heads]);
      expect(view.ok && view.value).toMatchObject({
        canManage: false,
        canArchive: false,
        canSeeCosts: true,
      });
      expect(!(await create(role)).ok).toBe(true);
      expect(!(await archive(role)).ok).toBe(true);
    }
    expect(db.insertCourse).not.toHaveBeenCalled();
  });

  it('lets the Training Coordinator add and edit, not archive', async () => {
    const view = await page('training_coordinator');
    expect(view.ok && view.value).toMatchObject({ canManage: true, canArchive: false });
    expect((await create('training_coordinator')).ok).toBe(true);
    const archived = await archive('training_coordinator');
    expect(!archived.ok && archived.error.code).toBe('FORBIDDEN');
  });

  it('lets the L&D Manager do everything', async () => {
    const view = await page('training_manager');
    expect(view.ok && view.value).toMatchObject({
      canManage: true,
      canArchive: true,
      canSeeCosts: true,
      currency: 'SAR',
    });
    expect((await create('training_manager')).ok).toBe(true);
    db.getCourse.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ status: 'archived' }));
    expect((await archive('training_manager')).ok).toBe(true);
  });
});

describe('coursesPageQueryDefinition', () => {
  it('validates the query string and reports more matches than shown', async () => {
    db.listCourses.mockResolvedValue([row(), row(), row()]);
    const query = createDefineQuery(runtime('training_manager').rt)(coursesPageQueryDefinition());
    const result = await query({ q: ' إدارة ', category: 'none', type: '', status: 'active' });
    expect(result.ok && result.value.courses).toHaveLength(2);
    expect(result.ok && result.value.truncated).toBe(true);
    expect(db.listCourses).toHaveBeenCalledWith(
      TX,
      { q: 'إدارة', category: 'none', status: 'active' },
      { withCosts: true },
    );
    for (const bad of [
      { category: "x' or 1=1" },
      { type: 'webinar' },
      { q: 'x'.repeat(101) },
      { page: 2 },
    ]) {
      const refused = await query(bad);
      expect(!refused.ok && refused.error.code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('createCourseActionDefinition (audited; a reusable service underneath)', () => {
  it('adds a course, with a new category, and audits before/after', async () => {
    const { rt, writeAudit } = runtime('training_manager');
    db.getCourse.mockResolvedValue(row({ categoryId: CATEGORY }));
    const result = await createDefineAction(rt)(createCourseActionDefinition())({
      ...values,
      category: { kind: 'new', nameEn: 'Safety', nameAr: 'السلامة' },
    });
    expect(result.ok).toBe(true);
    expect(db.insertCourseCategory).toHaveBeenCalledWith(TX, {
      kind: 'new',
      nameEn: 'Safety',
      nameAr: 'السلامة',
    });
    expect(db.insertCourse).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ code: 'LEAD-101', categoryId: CATEGORY, descriptionEn: null }),
    );
    expect(writeAudit).toHaveBeenCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({
        action: 'tms.course.created',
        entityType: 'course',
        entityId: ID,
        data: expect.objectContaining({
          before: null,
          after: expect.objectContaining({ code: 'LEAD-101', estCostPerSession: 15000 }),
          categoryCreated: { id: CATEGORY, nameEn: 'Safety', nameAr: 'السلامة' },
        }),
      }),
    );
  });

  it('checks the rules across fields before writing', async () => {
    const result = await createDefineAction(runtime('training_manager').rt)(
      createCourseActionDefinition(),
    )({ ...values, minParticipants: 30, durationHours: 50 });
    expect(!result.ok && result.error.fieldErrors).toEqual([
      { path: 'minParticipants', code: 'MIN_ABOVE_MAX' },
      { path: 'durationDays', code: 'HOURS_ABOVE_DAYS' },
    ]);
    expect(db.insertCourse).not.toHaveBeenCalled();
  });

  it.each([
    [pgFailure('23505', 'courses_tenant_code_uq'), 'VALIDATION_FAILED', 'code', 'CODE_TAKEN'],
    [
      pgFailure('23505', 'course_categories_tenant_name_en_uq'),
      'VALIDATION_FAILED',
      'category.nameEn',
      'NAME_TAKEN',
    ],
    [
      pgFailure('23505', 'course_categories_tenant_name_ar_uq'),
      'VALIDATION_FAILED',
      'category.nameAr',
      'NAME_TAKEN',
    ],
    [pgFailure('23503'), 'VALIDATION_FAILED', 'category.id', 'NOT_FOUND'],
  ])('maps the database refusal %#', async (failure, code, path, fieldCode) => {
    db.insertCourse.mockRejectedValue(failure);
    const result = await createDefineAction(runtime('training_coordinator').rt)(
      createCourseActionDefinition(),
    )({ ...values, category: { kind: 'existing', id: CATEGORY } });
    expect(!result.ok && result.error.code).toBe(code);
    expect(!result.ok && result.error.fieldErrors).toEqual([{ path, code: fieldCode }]);
  });

  it('turns a refusal of the database guard into 403 and anything else into an internal error', async () => {
    db.insertCourse.mockRejectedValueOnce(pgFailure('42501'));
    const define = createDefineAction(runtime('training_coordinator').rt);
    const refused = await define(createCourseActionDefinition())(values);
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    db.insertCourse.mockRejectedValueOnce(pgFailure('XX000'));
    const broken = await define(createCourseActionDefinition())(values);
    expect(!broken.ok && broken.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('an editor who does not see the costs (custom role: tms.course.read + manage)', () => {
  const editor: Grant[] = [
    { permission: 'tms.course.read', scope: { type: 'tenant' } },
    { permission: 'tms.course.manage', scope: { type: 'tenant' } },
  ];

  it('gets no costs in the list', async () => {
    const view = await createDefineQuery(runtime('learner', [], editor).rt)(
      coursesPageQueryDefinition(),
    )({});
    expect(view.ok && view.value.canSeeCosts).toBe(false);
    expect(db.listCourses).toHaveBeenCalledWith(TX, {}, { withCosts: false });
  });

  it('never stores or wipes costs', async () => {
    const define = createDefineAction(runtime('learner', [], editor).rt);
    expect((await define(createCourseActionDefinition())(values)).ok).toBe(true);
    expect(db.insertCourse).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ estCostPerSession: null, estCostPerParticipant: null }),
    );
    db.getCourse.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ version: 2 }));
    const updated = await define(updateCourseActionDefinition())({
      ...values,
      estCostPerSession: null,
      estCostPerParticipant: null,
      id: ID,
      version: 1,
    });
    expect(updated.ok).toBe(true);
    expect(db.updateCourseRow).toHaveBeenCalledWith(
      TX,
      ID,
      1,
      expect.objectContaining({ estCostPerSession: 15000, estCostPerParticipant: 250 }),
    );
  });
});

describe('updateCourseActionDefinition', () => {
  it('changes a course at its version and audits before/after', async () => {
    const { rt, writeAudit } = runtime('training_coordinator');
    db.getCourse
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ version: 2, titleEn: 'New' }));
    const result = await createDefineAction(rt)(updateCourseActionDefinition())({
      ...values,
      titleEn: 'New',
      id: ID,
      version: 1,
    });
    expect(result.ok).toBe(true);
    expect(db.updateCourseRow).toHaveBeenCalledWith(
      TX,
      ID,
      1,
      expect.objectContaining({ titleEn: 'New' }),
    );
    expect(writeAudit).toHaveBeenCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({
        action: 'tms.course.updated',
        data: expect.objectContaining({
          before: expect.objectContaining({ titleEn: 'Strategic management' }),
          after: expect.objectContaining({ titleEn: 'New' }),
        }),
      }),
    );
  });

  it('refuses an unknown course (404) and a stale version (409)', async () => {
    const update = createDefineAction(runtime('training_manager').rt)(
      updateCourseActionDefinition(),
    );
    db.getCourse.mockResolvedValueOnce(null);
    const missing = await update({ ...values, id: ID, version: 1 });
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
    db.getCourse.mockResolvedValueOnce(row({ version: 3 }));
    const stale = await update({ ...values, id: ID, version: 1 });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');
    db.updateCourseRow.mockResolvedValueOnce(false);
    const raced = await update({ ...values, id: ID, version: 1 });
    expect(!raced.ok && raced.error.code).toBe('CONFLICT_VERSION');
  });
});

describe('setCourseStatusActionDefinition', () => {
  it('archives and restores with their own audit actions', async () => {
    const { rt, writeAudit } = runtime('training_manager');
    const status = createDefineAction(rt)(setCourseStatusActionDefinition());
    db.getCourse
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ status: 'archived', version: 2 }));
    expect((await status({ id: ID, version: 1, status: 'archived' })).ok).toBe(true);
    db.getCourse
      .mockResolvedValueOnce(row({ status: 'archived', version: 2 }))
      .mockResolvedValueOnce(row({ version: 3 }));
    expect((await status({ id: ID, version: 2, status: 'active' })).ok).toBe(true);
    expect(
      writeAudit.mock.calls.map((call) => ((call as unknown[])[2] as { action: string }).action),
    ).toEqual(['tms.course.archived', 'tms.course.restored']);
  });

  it('refuses archiving an archived course, a stale version and an unknown course', async () => {
    const status = createDefineAction(runtime('training_manager').rt)(
      setCourseStatusActionDefinition(),
    );
    db.getCourse.mockResolvedValueOnce(row({ status: 'archived' }));
    const twice = await status({ id: ID, version: 1, status: 'archived' });
    expect(!twice.ok && twice.error.fieldErrors).toEqual([
      { path: 'status', code: 'ALREADY_ARCHIVED' },
    ]);
    db.getCourse.mockResolvedValueOnce(row({ version: 2 }));
    const stale = await status({ id: ID, version: 1, status: 'archived' });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');
    db.getCourse.mockResolvedValueOnce(null);
    const missing = await status({ id: ID, version: 1, status: 'archived' });
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
    db.getCourse.mockResolvedValueOnce(row());
    db.updateCourseStatus.mockRejectedValueOnce(pgFailure('42501'));
    const guarded = await status({ id: ID, version: 1, status: 'archived' });
    expect(!guarded.ok && guarded.error.code).toBe('FORBIDDEN');
  });
});
