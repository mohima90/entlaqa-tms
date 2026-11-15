/**
 * Draft-session definitions with a fake runtime (WP-LD-04, T-M3-08; FR-PLN-09, FR-CAT-01, FR-SCH-01 core, FR-IAM-08):
 * who gives an approved line its course (the organization-wide L&D Manager with the library permission), who drafts
 * (L&D Manager, Training Coordinator, a department-limited planner for its units' lines), the checks before the
 * database (approved plan, course, remaining sessions, named people, months, branches) and the audit records (counts,
 * never people). The repositories and platform services are replaced; the database tests
 * (99_planning_h_sessions_1_owner.sql) and the integration test cover the same rules in SQL.
 */
import { ok } from '@jadarat/platform-core';
import type { UserTx } from '@jadarat/platform-db';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  listOrgStructure: vi.fn(),
  getMemberOptionsByIds: vi.fn(),
  getTenantCurrencyCode: vi.fn(),
  getTenantDefaultLocale: vi.fn(),
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

const plans = vi.hoisted(() => ({
  getLines: vi.fn(),
  getPlanByCycle: vi.fn(),
  listLines: vi.fn(),
  listLinks: vi.fn(),
  listLinesOfPlans: vi.fn(),
  listLinksOfPlans: vi.fn(),
}));
vi.mock('../planning/consolidation-repository', () => plans);

const repo = vi.hoisted(() => ({
  getPlanSource: vi.fn(),
  listLineCourses: vi.fn(),
  setLineCourse: vi.fn(),
  listNamedPeople: vi.fn(),
  listPlanSessions: vi.fn(),
  listLineSessions: vi.fn(),
  listSessionsBetween: vi.fn(),
  getSession: vi.fn(),
  listLineParticipants: vi.fn(),
  insertSessions: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  listCourseBriefs: vi.fn(),
  listPlansOverlapping: vi.fn(),
  lineHasSessions: vi.fn(),
  moveParticipant: vi.fn(),
  latestDraftedPlanYear: vi.fn(),
}));
vi.mock('./repository', () => repo);

const courses = vi.hoisted(() => ({ createCourse: vi.fn() }));
vi.mock('../courses/service', () => courses);
const courseDb = vi.hoisted(() => ({ getCourse: vi.fn() }));
vi.mock('../courses/db', () => courseDb);

const { createDefineAction, createDefineQuery, grantsForAssignments } =
  await import('@jadarat/platform-rbac');
const defs = await import('./definitions');

const TENANT = '22222222-2222-4222-8222-222222222222';
const PLAN = '77777777-7777-4777-8777-777777777777';
const CYCLE = '55555555-5555-4555-8555-555555555555';
const LINE = '88888888-8888-4888-8888-888888888881';
const COURSE = '99999999-9999-4999-8999-999999999991';
const FINANCE = '66666666-6666-4666-8666-666666666661';
const SALES = '66666666-6666-4666-8666-666666666662';
const HR = '66666666-6666-4666-8666-666666666663';
const RUH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const JED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const ME = '44444444-4444-4444-8444-444444444444';
const CUSTOM = 'custom_a00000000001';
const S1 = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const S2 = 'cccccccc-cccc-4ccc-8ccc-000000000002';
const S3 = 'cccccccc-cccc-4ccc-8ccc-000000000003';
const S9 = 'cccccccc-cccc-4ccc-8ccc-000000000009';
const personId = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;

const claims = brandVerifiedClaims({
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'authenticated',
  aal: 'aal1',
  session_id: '33333333-3333-4333-8333-333333333333',
  tenant_id: TENANT,
  person_id: ME,
});

/** A standard role, or a department-limited planner for Finance (a custom role limited to «A department»). */
function runtime(role: string) {
  if (!claims.ok) throw new Error('fixture');
  const audits: unknown[] = [];
  const custom = role === CUSTOM;
  const rt = {
    getClaims: () => Promise.resolve(ok(claims.value)),
    withUserTx: <T>(_c: unknown, fn: (tx: object) => Promise<T>) => fn({}),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: false }),
    loadGrants: () =>
      Promise.resolve(
        grantsForAssignments([{ roleCode: role, ...(custom ? { scopeUnitId: FINANCE } : {}) }], {
          headedDepartmentIds: [],
          customRoles: [
            {
              code: CUSTOM,
              dataScope: 'departments',
              permissions: ['tms.training_plan.read', 'tms.session.manage'],
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

const unit = (id: string, branchId: string, nameEn: string) => ({
  id,
  parentId: null,
  branchId,
  code: nameEn.slice(0, 3).toUpperCase(),
  nameAr: nameEn,
  nameEn,
  active: true,
  sortOrder: 0,
  levelOrdinal: 1,
  head: null,
});

const line = (over: Record<string, unknown> = {}) => ({
  id: LINE,
  planId: PLAN,
  cycleId: CYCLE,
  groupKey: 'topic:advanced excel',
  title: 'Advanced Excel',
  courseId: COURSE,
  deliveryType: 'classroom',
  category: null,
  quarter: 1,
  minPerSession: 8,
  maxPerSession: 20,
  costPerSession: '9000',
  costPerPerson: null,
  durationHours: 12,
  status: 'in_plan',
  leftOutReason: null,
  sortOrder: 0,
  editedAt: null,
  createdBy: null,
  version: 3,
  ...over,
});

const source = (over: Record<string, unknown> = {}) => ({
  planId: PLAN,
  cycleId: CYCLE,
  status: 'approved',
  planVersion: 1,
  nameAr: null,
  nameEn: 'Training plan 2027',
  periodStart: '2027-01-01',
  periodEnd: '2027-12-31',
  currency: 'SAR',
  ...over,
});

/** The design's example: Finance 20 (Riyadh, 2 named), Sales 15 (Jeddah, none), HR 12 (Riyadh, 1 named). */
function example(over: { line?: Record<string, unknown>; plan?: Record<string, unknown> } = {}) {
  plans.getLines.mockResolvedValue([line(over.line)]);
  repo.getPlanSource.mockResolvedValue(source(over.plan));
  db.listOrgStructure.mockResolvedValue({
    departments: [unit(FINANCE, RUH, 'Finance'), unit(SALES, JED, 'Sales'), unit(HR, RUH, 'HR')],
    branches: [
      { id: RUH, nameAr: 'الرياض', nameEn: 'Riyadh', active: true },
      { id: JED, nameAr: 'جدة', nameEn: 'Jeddah', active: true },
    ],
  });
  const link = (needId: string, departmentId: string, seats: number, named: number) => ({
    needId,
    lineId: LINE,
    departmentId,
    seats,
    named,
    topic: 'Advanced Excel',
    courseId: null,
  });
  plans.listLinks.mockResolvedValue([
    link('n-fin', FINANCE, 20, 2),
    link('n-sal', SALES, 15, 0),
    link('n-hr', HR, 12, 1),
  ]);
  repo.listNamedPeople.mockResolvedValue([
    { lineId: LINE, needId: 'n-fin', departmentId: FINANCE, personId: personId(1) },
    { lineId: LINE, needId: 'n-fin', departmentId: FINANCE, personId: personId(2) },
    { lineId: LINE, needId: 'n-hr', departmentId: HR, personId: personId(3) },
  ]);
  repo.listLineSessions.mockResolvedValue([]);
  repo.lineHasSessions.mockResolvedValue(false);
  repo.listLineParticipants.mockResolvedValue([]);
  repo.listCourseBriefs.mockResolvedValue([
    {
      id: COURSE,
      code: 'CRS-0014',
      titleEn: 'Advanced Excel',
      titleAr: null,
      deliveryType: 'classroom',
      durationHours: 12,
      status: 'active',
    },
  ]);
  db.getMemberOptionsByIds.mockResolvedValue([
    { personId: personId(1), nameAr: null, nameEn: 'One', active: true },
  ]);
}

const draft = (n: number, month: string, people: string[] = []) => ({
  month,
  branchId: RUH,
  seats: 16,
  personIds: people,
  ...(n > 0 ? {} : {}),
});

beforeEach(() => {
  vi.clearAllMocks();
  db.getTenantDefaultLocale.mockResolvedValue('en');
  db.getTenantCurrencyCode.mockResolvedValue('SAR');
});

describe('the «Create draft sessions» proposal (design screen 3)', () => {
  it('proposes the plan’s 3 sessions by branch with the named people, matching the approved cost', async () => {
    example();
    const view = await runtime('training_coordinator').query(defs.draftProposalQueryDefinition())({
      lineId: LINE,
    });
    if (!view.ok) throw new Error(view.error.code);
    expect(view.value.proposal.sessions.map((s) => [s.month, s.branchId, s.seats])).toEqual([
      ['2027-01', RUH, 16],
      ['2027-02', RUH, 16],
      ['2027-03', JED, 15],
    ]);
    expect(view.value.proposal.sessions.map((s) => s.personIds)).toEqual([
      [personId(1), personId(2)],
      [personId(3)],
      [],
    ]);
    expect(view.value.proposal.branchSeats).toEqual([
      { branchId: RUH, seats: 32 },
      { branchId: JED, seats: 15 },
    ]);
    expect(view.value.check).toEqual({
      seats: 47,
      people: 47,
      allPlaced: true,
      cost: '27000',
      matchesPlan: true,
    });
    expect(view.value).toMatchObject({ remaining: 3, problem: null, canCreate: true });
  });

  it('says why nothing can be drafted yet', async () => {
    example({ line: { courseId: null } });
    const view = await runtime('training_manager').query(defs.draftProposalQueryDefinition())({
      lineId: LINE,
    });
    expect(view.ok && view.value).toMatchObject({
      problem: 'SESSION_LINE_NEEDS_COURSE',
      canCreate: false,
    });
    example({ plan: { status: 'draft' } });
    const revised = await runtime('training_manager').query(defs.draftProposalQueryDefinition())({
      lineId: LINE,
    });
    expect(revised.ok && revised.value.problem).toBe('SESSION_PLAN_NOT_APPROVED');
  });

  it('hides a line of other units from a department-limited planner, and refuses everybody else', async () => {
    example();
    plans.listLinks.mockResolvedValue([
      {
        needId: 'n-sal',
        lineId: LINE,
        departmentId: SALES,
        seats: 15,
        named: 0,
        topic: 'x',
        courseId: null,
      },
    ]);
    const hidden = await runtime(CUSTOM).query(defs.draftProposalQueryDefinition())({
      lineId: LINE,
    });
    expect(!hidden.ok && hidden.error.code).toBe('NOT_FOUND');
    for (const role of ['learner', 'department_head', 'hr_manager', 'finance', 'tenant_admin']) {
      const refused = await runtime(role).query(defs.draftProposalQueryDefinition())({
        lineId: LINE,
      });
      expect(!refused.ok && refused.error.code, role).toBe('FORBIDDEN');
    }
  });
});

describe('createDraftSessionsActionDefinition', () => {
  it('creates the confirmed drafts and audits counts, never people', async () => {
    example();
    repo.insertSessions.mockResolvedValue({ ok: true, value: [S1, S2] });
    const { action, audits } = runtime('training_coordinator');
    const created = await action(defs.createDraftSessionsActionDefinition())({
      lineId: LINE,
      sessions: [
        draft(1, '2027-01', [personId(1).toUpperCase(), personId(3)]),
        { month: '2027-05', branchId: null, seats: 15, personIds: [] },
      ],
    });
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    expect(repo.insertSessions).toHaveBeenCalledWith({}, [
      {
        planId: PLAN,
        cycleId: CYCLE,
        lineId: LINE,
        courseId: COURSE,
        deliveryType: 'classroom',
        month: '2027-01-01',
        branchId: RUH,
        seats: 16,
        people: [
          { personId: personId(1), needId: 'n-fin' },
          { personId: personId(3), needId: 'n-hr' },
        ],
      },
      expect.objectContaining({ month: '2027-05-01', branchId: null, people: [] }),
    ]);
    expect(audits).toEqual([
      {
        action: 'tms.session.drafts_created',
        entityType: 'plan_line',
        entityId: LINE,
        data: {
          planId: PLAN,
          planVersion: 1,
          courseId: COURSE,
          sessions: [
            { id: S1, month: '2027-01', branchId: RUH, seats: 16, participants: 2 },
            { id: S2, month: '2027-05', branchId: null, seats: 15, participants: 0 },
          ],
        },
      },
    ]);
    expect(JSON.stringify(audits)).not.toContain(personId(1));
  });

  it('checks months, branches and people before the database', async () => {
    example();
    repo.listLineParticipants.mockResolvedValue([
      {
        id: 'p',
        sessionId: 'other',
        lineId: LINE,
        needId: 'n-hr',
        departmentId: HR,
        personId: personId(3),
      },
    ]);
    repo.listLineSessions.mockResolvedValue([
      {
        id: 'other',
        month: '2027-02-01',
        branchId: RUH,
        createdAt: new Date(0),
        seats: 16,
        lineId: LINE,
      },
    ]);
    const result = await runtime('training_manager').action(
      defs.createDraftSessionsActionDefinition(),
    )({
      lineId: LINE,
      sessions: [
        {
          month: '2028-01',
          branchId: '00000000-0000-4000-8000-000000000009',
          seats: 1,
          personIds: [personId(1), personId(9), personId(3)],
        },
      ],
    });
    expect(!result.ok && result.error.fieldErrors).toEqual([
      { path: 'sessions.0.month', code: 'OUTSIDE_PERIOD' },
      { path: 'sessions.0.branchId', code: 'NOT_FOUND' },
      { path: 'sessions.0.personIds.1', code: 'NOT_NAMED' },
      { path: 'sessions.0.personIds.2', code: 'ALREADY_PLANNED' },
      { path: 'sessions.0.personIds', code: 'MORE_THAN_SEATS' },
    ]);
    expect(repo.insertSessions).not.toHaveBeenCalled();
  });

  it('drafts at most the sessions still to draft', async () => {
    example();
    const result = await runtime('training_manager').action(
      defs.createDraftSessionsActionDefinition(),
    )({
      lineId: LINE,
      sessions: ['2027-01', '2027-02', '2027-03', '2027-03'].map((m) => draft(1, m)),
    });
    expect(!result.ok && result.error).toMatchObject({
      code: 'SESSION_LINE_ALL_DRAFTED',
      params: { planned: 3, drafted: 0 },
    });
  });

  it('lets a department-limited planner draft only lines of its own units', async () => {
    example();
    const shared = await runtime(CUSTOM).action(defs.createDraftSessionsActionDefinition())({
      lineId: LINE,
      sessions: [draft(1, '2027-01')],
    });
    expect(!shared.ok && shared.error.code).toBe('SESSION_LINE_OUTSIDE_SCOPE');
    plans.listLinks.mockResolvedValue([
      {
        needId: 'n-fin',
        lineId: LINE,
        departmentId: FINANCE,
        seats: 20,
        named: 2,
        topic: 'x',
        courseId: null,
      },
    ]);
    repo.insertSessions.mockResolvedValue({ ok: true, value: [S1] });
    const own = await runtime(CUSTOM).action(defs.createDraftSessionsActionDefinition())({
      lineId: LINE,
      sessions: [draft(1, '2027-01', [personId(1)])],
    });
    expect(own.ok).toBe(true);
  });

  it('maps the database’s refusals', async () => {
    example();
    repo.insertSessions.mockResolvedValue({ ok: false, refusal: 'all_drafted' });
    const result = await runtime('training_manager').action(
      defs.createDraftSessionsActionDefinition(),
    )({ lineId: LINE, sessions: [draft(1, '2027-01')] });
    expect(!result.ok && result.error.code).toBe('SESSION_LINE_ALL_DRAFTED');
  });
});

describe('the course of an approved line (design screen 2)', () => {
  const values = {
    titleEn: 'Advanced Excel',
    titleAr: null,
    descriptionEn: '',
    descriptionAr: '',
    category: { kind: 'none' as const },
    deliveryType: 'classroom' as const,
    durationHours: 12,
    durationDays: null,
    minParticipants: 8,
    maxParticipants: 20,
    estCostPerSession: 9000,
    estCostPerParticipant: null,
  };
  const created = {
    id: COURSE,
    code: 'CRS-0014',
    titleEn: 'Advanced Excel',
    titleAr: null,
    descriptionEn: null,
    descriptionAr: null,
    categoryId: null,
    deliveryType: 'classroom',
    durationHours: 12,
    durationDays: null,
    minParticipants: 8,
    maxParticipants: 20,
    estCostPerSession: 9000,
    estCostPerParticipant: null,
    costCurrency: 'SAR',
    status: 'active',
    version: 1,
  };

  it('creates the course through the library service and links it, audited', async () => {
    example({ line: { courseId: null } });
    courses.createCourse.mockResolvedValue(
      ok({ before: null, after: created, categoryCreated: null }),
    );
    repo.setLineCourse.mockResolvedValue({ ok: true, value: 4 });
    const { action, audits } = runtime('training_manager');
    const result = await action(defs.createCourseFromLineActionDefinition())({
      lineId: LINE,
      lineVersion: 3,
      course: values,
    });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value).toMatchObject({ lineId: LINE, lineVersion: 4, origin: 'created' });
    expect(courses.createCourse).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ titleEn: 'Advanced Excel', code: null }),
      { withoutCosts: false },
    );
    expect(repo.setLineCourse).toHaveBeenCalledWith({}, LINE, 3, COURSE, 'created');
    expect(audits).toMatchObject([
      {
        action: 'tms.training_plan.line_course_created',
        entityType: 'plan_line',
        entityId: LINE,
        data: { planId: PLAN, courseId: COURSE, previousCourseId: null },
      },
    ]);
  });

  it('is the L&D Manager’s or the Training Coordinator’s (review M4), on an approved plan, before any draft', async () => {
    example({ line: { courseId: null } });
    for (const role of [CUSTOM, 'hr_manager', 'learner', 'department_head']) {
      const refused = await runtime(role).action(defs.createCourseFromLineActionDefinition())({
        lineId: LINE,
        lineVersion: 3,
        course: values,
      });
      expect(!refused.ok && refused.error.code, role).toBe('FORBIDDEN');
      const notLinked = await runtime(role).action(defs.linkLineCourseActionDefinition())({
        lineId: LINE,
        lineVersion: 3,
        courseId: COURSE,
      });
      expect(!notLinked.ok && notLinked.error.code, role).toBe('FORBIDDEN');
    }
    example({ plan: { status: 'in_approval' } });
    const frozen = await runtime('training_manager').action(defs.linkLineCourseActionDefinition())({
      lineId: LINE,
      lineVersion: 3,
      courseId: COURSE,
    });
    expect(!frozen.ok && frozen.error.code).toBe('SESSION_PLAN_NOT_APPROVED');
    example({ line: { status: 'left_out' } });
    const out = await runtime('training_manager').action(defs.linkLineCourseActionDefinition())({
      lineId: LINE,
      lineVersion: 3,
      courseId: COURSE,
    });
    expect(!out.ok && out.error.code).toBe('SESSION_LINE_LEFT_OUT');
    // Review M1: the drafts are asked of the database (a planner may read none of them), never of the rows read.
    example();
    repo.listLineSessions.mockResolvedValue([]);
    repo.lineHasSessions.mockResolvedValue(true);
    const drafted = await runtime('training_manager').action(defs.linkLineCourseActionDefinition())(
      { lineId: LINE, lineVersion: 3, courseId: COURSE },
    );
    expect(!drafted.ok && drafted.error.code).toBe('SESSION_LINE_HAS_DRAFTS');
    expect(repo.lineHasSessions).toHaveBeenCalledWith({}, LINE);
    expect(courses.createCourse).not.toHaveBeenCalled();
    expect(repo.setLineCourse).not.toHaveBeenCalled();
  });

  it('lets the Training Coordinator create or link the course of an approved line (review M4)', async () => {
    example({ line: { courseId: null } });
    courses.createCourse.mockResolvedValue(
      ok({ before: null, after: created, categoryCreated: null }),
    );
    repo.setLineCourse.mockResolvedValue({ ok: true, value: 4 });
    const createdByCoordinator = await runtime('training_coordinator').action(
      defs.createCourseFromLineActionDefinition(),
    )({ lineId: LINE, lineVersion: 3, course: values });
    expect(createdByCoordinator.ok && createdByCoordinator.value.origin).toBe('created');
    courseDb.getCourse.mockResolvedValue(created);
    const linkedByCoordinator = await runtime('training_coordinator').action(
      defs.linkLineCourseActionDefinition(),
    )({ lineId: LINE, lineVersion: 3, courseId: COURSE });
    expect(linkedByCoordinator.ok && linkedByCoordinator.value.origin).toBe('linked');
    // The database's last word: drafts made at the same moment (JK017).
    repo.setLineCourse.mockResolvedValue({ ok: false, refusal: 'has_drafts' });
    const late = await runtime('training_coordinator').action(
      defs.linkLineCourseActionDefinition(),
    )({ lineId: LINE, lineVersion: 3, courseId: COURSE });
    expect(!late.ok && late.error.code).toBe('SESSION_LINE_HAS_DRAFTS');
  });

  it('links an active course only', async () => {
    example({ line: { courseId: null } });
    courseDb.getCourse.mockResolvedValue({ ...created, status: 'archived' });
    const archived = await runtime('training_manager').action(
      defs.linkLineCourseActionDefinition(),
    )({ lineId: LINE, lineVersion: 3, courseId: COURSE });
    expect(!archived.ok && archived.error.fieldErrors).toEqual([
      { path: 'courseId', code: 'ARCHIVED' },
    ]);
    courseDb.getCourse.mockResolvedValue(created);
    repo.setLineCourse.mockResolvedValue({ ok: true, value: null });
    const stale = await runtime('training_manager').action(defs.linkLineCourseActionDefinition())({
      lineId: LINE,
      lineVersion: 3,
      courseId: COURSE,
    });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');
  });
});

describe('planDeliveryQueryDefinition (design screen 1)', () => {
  it('gives each line its course, drafts, state and «Create course» pre-filled from the line', async () => {
    example({ line: { courseId: null } });
    plans.getPlanByCycle.mockResolvedValue({ id: PLAN, status: 'approved' });
    plans.listLines.mockResolvedValue([
      line({ courseId: null }),
      line({ id: 'line-2', courseId: COURSE, groupKey: `course:${COURSE}`, title: 'Named' }),
    ]);
    plans.listLinks.mockResolvedValue([
      ...((await plans.listLinks()) as object[]),
      {
        needId: 'n-2',
        lineId: 'line-2',
        departmentId: SALES,
        seats: 10,
        named: 0,
        topic: 'Named',
        courseId: COURSE,
      },
    ]);
    repo.listLineCourses.mockResolvedValue([]);
    repo.listPlanSessions.mockResolvedValue([]);
    const view = await runtime('training_manager').query(defs.planDeliveryQueryDefinition())({
      cycleId: CYCLE,
    });
    if (!view.ok) throw new Error(view.error.code);
    const [first, second] = view.value.lines;
    expect(first).toMatchObject({
      state: 'needs_course',
      plannedSessions: 3,
      sizes: [16, 16, 15],
      courseDraft: {
        titleEn: 'Advanced Excel',
        titleAr: null,
        deliveryType: 'classroom',
        durationHours: 12,
        minParticipants: 8,
        maxParticipants: 20,
        estCostPerSession: 9000,
        currency: 'SAR',
      },
      can: { createCourse: true, linkCourse: true, createSessions: false },
    });
    // A line whose needs named the course is linked from the start.
    expect(second?.course?.origin).toBe('needs');
    expect(second?.state).toBe('needs_sessions');
    expect(view.value.counts).toEqual({ needsCourse: 1, needsSessions: 1, sessionsCreated: 0 });
    // The Training Coordinator drafts and, holding tms.course.manage, gives lines their course (review M4).
    const coordinator = await runtime('training_coordinator').query(
      defs.planDeliveryQueryDefinition(),
    )({ cycleId: CYCLE });
    expect(coordinator.ok && coordinator.value.lines[0]?.can).toEqual({
      createCourse: true,
      linkCourse: true,
      createSessions: false,
    });
    // A department-limited planner drafts its units' lines but gives no line a course.
    const planner = await runtime(CUSTOM).query(defs.planDeliveryQueryDefinition())({
      cycleId: CYCLE,
    });
    expect(planner.ok && planner.value.lines[0]?.can).toMatchObject({
      createCourse: false,
      linkCourse: false,
    });
  });
});

const sessionRecord = (over: Record<string, unknown> = {}) => ({
  id: S1,
  status: 'draft',
  planId: PLAN,
  cycleId: CYCLE,
  lineId: LINE,
  planVersion: 1,
  courseId: COURSE,
  deliveryType: 'classroom',
  month: '2027-01-01',
  branchId: RUH,
  seats: 16,
  estimatedCost: '9000',
  costCurrency: 'SAR',
  participants: 2,
  createdAt: new Date('2026-11-17T08:00:00Z'),
  version: 2,
  ...over,
});

const participant = (
  person: number,
  sessionId: string,
  departmentId = FINANCE,
  needId = 'n-fin',
) => ({
  id: `p${String(person)}`,
  sessionId,
  lineId: LINE,
  needId,
  departmentId,
  personId: personId(person),
});

describe('a draft opened, changed and deleted (design screen 5)', () => {
  function drafted() {
    example();
    const sessions = [
      sessionRecord(),
      sessionRecord({ id: S2, month: '2027-02-01', participants: 1 }),
      sessionRecord({ id: S3, month: '2027-05-01', branchId: JED, seats: 15, participants: 0 }),
    ];
    repo.listLineSessions.mockResolvedValue(sessions);
    repo.getSession.mockImplementation((_tx: unknown, id: string) =>
      Promise.resolve(sessions.find((s) => s.id === id) ?? null),
    );
    repo.listLineParticipants.mockResolvedValue([
      participant(1, S1),
      participant(2, S1),
      participant(3, S2, HR, 'n-hr'),
    ]);
  }

  it('shows its place among the line’s drafts, its people, the others to add and the unnamed seats', async () => {
    drafted();
    const view = await runtime('training_coordinator').query(defs.draftSessionQueryDefinition())({
      sessionId: S3,
    });
    if (!view.ok) throw new Error(view.error.code);
    expect(view.value.session).toMatchObject({
      month: '2027-05',
      ordinal: 3,
      planned: 3,
      drafted: 3,
      outsideQuarter: true,
      estimatedCost: '9000',
    });
    expect(view.value.participants).toEqual([]);
    expect(view.value.candidates.map((c) => [c.personId, c.sessionId])).toEqual([
      [personId(1), S1],
      [personId(2), S1],
      [personId(3), S2],
    ]);
    expect(view.value.unnamedSeats).toEqual([
      { departmentId: FINANCE, seats: 18 },
      { departmentId: SALES, seats: 15 },
      { departmentId: HR, seats: 11 },
    ]);
    expect(view.value.otherSessions).toEqual([
      { id: S1, ordinal: 1, month: '2027-01', seats: 16, participants: 2 },
      { id: S2, ordinal: 2, month: '2027-02', seats: 16, participants: 1 },
    ]);
    expect(view.value.canEdit).toBe(true);
    const first = await runtime('training_coordinator').query(defs.draftSessionQueryDefinition())({
      sessionId: S1,
    });
    expect(first.ok && first.value.participants.map((p) => [p.personId, p.branchId])).toEqual([
      [personId(1), RUH],
      [personId(2), RUH],
    ]);
    repo.getSession.mockResolvedValue(null);
    const gone = await runtime('training_coordinator').query(defs.draftSessionQueryDefinition())({
      sessionId: S9,
    });
    expect(!gone.ok && gone.error.code).toBe('NOT_FOUND');
  });

  it('counts the seats waiting for names from the line, not from the people a limited planner reads (review L5)', async () => {
    drafted();
    // A planner for Finance reads Finance's named people only; HR named one person it cannot read.
    repo.listNamedPeople.mockResolvedValue([
      { lineId: LINE, needId: 'n-fin', departmentId: FINANCE, personId: personId(1) },
      { lineId: LINE, needId: 'n-fin', departmentId: FINANCE, personId: personId(2) },
    ]);
    repo.listLineParticipants.mockResolvedValue([participant(1, S1), participant(2, S1)]);
    const view = await runtime(CUSTOM).query(defs.draftSessionQueryDefinition())({
      sessionId: S3,
    });
    if (!view.ok) throw new Error(view.error.code);
    expect(view.value.canEdit).toBe(false);
    expect(view.value.unnamedSeats).toEqual([
      { departmentId: FINANCE, seats: 18 },
      { departmentId: SALES, seats: 15 },
      { departmentId: HR, seats: 11 },
    ]);
  });

  it('moves people, changes month and seats, and audits counts', async () => {
    drafted();
    repo.updateSession.mockResolvedValue({ ok: true, value: { version: 5, movedFrom: [S2] } });
    const { action, audits } = runtime('training_manager');
    const updated = await action(defs.updateDraftSessionActionDefinition())({
      sessionId: S1,
      version: 2,
      month: '2027-04',
      seats: 17,
      personIds: [personId(1), personId(3)],
    });
    if (!updated.ok) throw new Error(JSON.stringify(updated.error));
    expect(repo.updateSession).toHaveBeenCalledWith(
      {},
      { id: S1, lineId: LINE, version: 2 },
      { month: '2027-04-01', seats: 17 },
      [
        { personId: personId(1), needId: 'n-fin' },
        { personId: personId(3), needId: 'n-hr' },
      ],
    );
    expect(audits).toEqual([
      {
        action: 'tms.session.draft_updated',
        entityType: 'session',
        entityId: S1,
        data: {
          lineId: LINE,
          before: { month: '2027-01', branchId: RUH, seats: 16, participants: 2 },
          after: { month: '2027-04', branchId: RUH, seats: 17, participants: 2 },
          people: { added: 0, moved: 1, removed: 1 },
          // The draft the person came from (it has a new version too: review L6).
          movedFrom: [S2],
        },
      },
    ]);
    expect(updated.value.movedFrom).toEqual([S2]);
  });

  it('moves one planned participant to another draft of the line, both new versions, audited as counts (review L6)', async () => {
    drafted();
    repo.moveParticipant.mockResolvedValue({ ok: true, value: { fromVersion: 3, toVersion: 4 } });
    const { action, audits } = runtime('training_coordinator');
    const moved = await action(defs.moveDraftParticipantActionDefinition())({
      sessionId: S1,
      version: 2,
      personId: personId(2).toUpperCase(),
      toSessionId: S3,
    });
    if (!moved.ok) throw new Error(JSON.stringify(moved.error));
    expect(repo.moveParticipant).toHaveBeenCalledWith({}, { id: S1, version: 2 }, S3, personId(2));
    expect(moved.value).toMatchObject({ version: 3, toSessionId: S3, toVersion: 4 });
    expect(audits).toEqual([
      {
        action: 'tms.session.draft_participant_moved',
        entityType: 'session',
        entityId: S1,
        data: {
          lineId: LINE,
          toSessionId: S3,
          from: { before: 2, after: 1 },
          to: { before: 0, after: 1 },
        },
      },
    ]);
    expect(JSON.stringify(audits)).not.toContain(personId(2));
  });

  it('refuses a move to an unknown or full draft, of someone not in the draft, at a stale version, outside the planner’s units', async () => {
    drafted();
    const { action } = runtime('training_manager');
    const move = (over: Record<string, unknown>) =>
      action(defs.moveDraftParticipantActionDefinition())({
        sessionId: S1,
        version: 2,
        personId: personId(1),
        toSessionId: S2,
        ...over,
      });
    const unknown = await move({ toSessionId: S9 });
    expect(!unknown.ok && unknown.error.fieldErrors).toEqual([
      { path: 'toSessionId', code: 'NOT_FOUND' },
    ]);
    const itself = await move({ toSessionId: S1 });
    expect(!itself.ok && itself.error.fieldErrors).toEqual([
      { path: 'toSessionId', code: 'NOT_FOUND' },
    ]);
    const notHere = await move({ personId: personId(3) });
    expect(!notHere.ok && notHere.error.fieldErrors).toEqual([
      { path: 'personId', code: 'NOT_PLANNED' },
    ]);
    const stale = await move({ version: 1 });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');
    repo.listLineSessions.mockResolvedValue([
      sessionRecord(),
      sessionRecord({ id: S2, month: '2027-02-01', seats: 1, participants: 1 }),
    ]);
    const full = await move({});
    expect(!full.ok && full.error.fieldErrors).toEqual([
      { path: 'toSessionId', code: 'MORE_THAN_SEATS' },
    ]);
    drafted();
    repo.moveParticipant.mockResolvedValue({ ok: false, refusal: 'seats' });
    const late = await move({});
    expect(!late.ok && late.error.fieldErrors).toEqual([
      { path: 'toSessionId', code: 'MORE_THAN_SEATS' },
    ]);
    repo.moveParticipant.mockResolvedValue({ ok: true, value: null });
    const lost = await move({});
    expect(!lost.ok && lost.error.code).toBe('CONFLICT_VERSION');
    const shared = await runtime(CUSTOM).action(defs.moveDraftParticipantActionDefinition())({
      sessionId: S1,
      version: 2,
      personId: personId(1),
      toSessionId: S2,
    });
    expect(!shared.ok && shared.error.code).toBe('SESSION_LINE_OUTSIDE_SCOPE');
    const refused = await runtime('hr_manager').action(defs.moveDraftParticipantActionDefinition())(
      {
        sessionId: S1,
        version: 2,
        personId: personId(1),
        toSessionId: S2,
      },
    );
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });

  it('refuses a stale version, months outside the period, unknown branches, people not named, too few seats', async () => {
    drafted();
    const { action } = runtime('training_manager');
    const stale = await action(defs.updateDraftSessionActionDefinition())({
      sessionId: S1,
      version: 1,
      seats: 20,
    });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');
    const bad = await action(defs.updateDraftSessionActionDefinition())({
      sessionId: S1,
      version: 2,
      month: '2026-12',
      branchId: '00000000-0000-4000-8000-000000000009',
      seats: 1,
      personIds: [personId(1), personId(8)],
    });
    expect(!bad.ok && bad.error.fieldErrors).toEqual([
      { path: 'month', code: 'OUTSIDE_PERIOD' },
      { path: 'branchId', code: 'NOT_FOUND' },
      { path: 'personIds.1', code: 'NOT_NAMED' },
      { path: 'personIds', code: 'MORE_THAN_SEATS' },
    ]);
    const fewer = await action(defs.updateDraftSessionActionDefinition())({
      sessionId: S1,
      version: 2,
      seats: 1,
    });
    expect(!fewer.ok && fewer.error.fieldErrors).toEqual([
      { path: 'seats', code: 'FEWER_THAN_PEOPLE' },
    ]);
    repo.updateSession.mockResolvedValue({ ok: false, refusal: 'outside_period' });
    const refused = await action(defs.updateDraftSessionActionDefinition())({
      sessionId: S1,
      version: 2,
      branchId: null,
    });
    expect(!refused.ok && refused.error.fieldErrors).toEqual([
      { path: 'month', code: 'OUTSIDE_PERIOD' },
    ]);
    repo.updateSession.mockResolvedValue({ ok: true, value: null });
    const lost = await action(defs.updateDraftSessionActionDefinition())({
      sessionId: S1,
      version: 2,
      branchId: null,
    });
    expect(!lost.ok && lost.error.code).toBe('CONFLICT_VERSION');
    expect(repo.updateSession).toHaveBeenCalledTimes(2);
  });

  it('deletes a draft freely, audited; not a draft of a line outside the planner’s units', async () => {
    drafted();
    repo.deleteSession.mockResolvedValue({ ok: true, value: true });
    const { action, audits } = runtime('training_coordinator');
    const deleted = await action(defs.deleteDraftSessionActionDefinition())({
      sessionId: S2,
      version: 2,
    });
    expect(deleted.ok).toBe(true);
    expect(audits).toEqual([
      {
        action: 'tms.session.draft_deleted',
        entityType: 'session',
        entityId: S2,
        data: {
          lineId: LINE,
          planId: PLAN,
          values: { month: '2027-02', branchId: RUH, seats: 16, participants: 1 },
        },
      },
    ]);
    const shared = await runtime(CUSTOM).action(defs.deleteDraftSessionActionDefinition())({
      sessionId: S2,
      version: 2,
    });
    expect(!shared.ok && shared.error.code).toBe('SESSION_LINE_OUTSIDE_SCOPE');
    const sharedEdit = await runtime(CUSTOM).action(defs.updateDraftSessionActionDefinition())({
      sessionId: S2,
      version: 2,
      seats: 10,
    });
    expect(!sharedEdit.ok && sharedEdit.error.code).toBe('SESSION_LINE_OUTSIDE_SCOPE');
    repo.deleteSession.mockResolvedValue({ ok: true, value: null });
    const stale = await runtime('training_manager').action(
      defs.deleteDraftSessionActionDefinition(),
    )({ sessionId: S2, version: 1 });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');
    repo.deleteSession.mockResolvedValue({ ok: false, refusal: 'not_allowed' });
    const denied = await runtime('training_manager').action(
      defs.deleteDraftSessionActionDefinition(),
    )({ sessionId: S2, version: 2 });
    expect(!denied.ok && denied.error.code).toBe('SESSION_LINE_OUTSIDE_SCOPE');
  });
});

describe('trainingCalendarQueryDefinition (design screen 4)', () => {
  function calendar() {
    example();
    const negotiation = line({
      id: 'line-2',
      title: 'Negotiation',
      quarter: 2,
      courseId: null,
      maxPerSession: 10,
    });
    plans.listLinesOfPlans.mockResolvedValue([line(), negotiation]);
    plans.listLinksOfPlans.mockResolvedValue([
      { planId: PLAN, needId: 'n-fin', lineId: LINE, departmentId: FINANCE, seats: 20, named: 2 },
      { planId: PLAN, needId: 'n-sal', lineId: LINE, departmentId: SALES, seats: 15, named: 0 },
      { planId: PLAN, needId: 'n-hr', lineId: LINE, departmentId: HR, seats: 12, named: 1 },
      { planId: PLAN, needId: 'n-neg', lineId: 'line-2', departmentId: SALES, seats: 6, named: 0 },
    ]);
    repo.listPlansOverlapping.mockResolvedValue([source()]);
    const sessions = [
      sessionRecord(),
      sessionRecord({ id: S2, month: '2027-02-01' }),
      sessionRecord({ id: S3, month: '2027-05-01', branchId: JED, seats: 15 }),
    ];
    repo.listSessionsBetween.mockResolvedValue(sessions);
    repo.listLineSessions.mockResolvedValue(sessions);
  }

  it('shows the year by quarter and month, the lines still to draft and the summary cards', async () => {
    calendar();
    const view = await runtime('training_coordinator').query(
      defs.trainingCalendarQueryDefinition(),
    )({ year: 2027 });
    if (!view.ok) throw new Error(view.error.code);
    const q1 = view.value.quarters[0];
    expect(q1?.months.map((m) => [m.month, m.sessions, m.seats])).toEqual([
      ['2027-01', 1, 16],
      ['2027-02', 1, 16],
      ['2027-03', 0, 0],
    ]);
    expect(q1?.months[0]?.drafts[0]).toMatchObject({
      ordinal: 1,
      planned: 3,
      outsideQuarter: false,
      course: { code: 'CRS-0014' },
      canEdit: true,
    });
    expect(view.value.quarters[1]?.months[1]?.drafts[0]).toMatchObject({
      id: S3,
      ordinal: 3,
      outsideQuarter: true,
    });
    expect(view.value.quarters[1]?.notDrafted).toEqual([
      expect.objectContaining({ lineId: 'line-2', state: 'needs_course', missing: 1 }),
    ]);
    expect(view.value.summary).toEqual({
      drafts: 3,
      planned: 4,
      seats: 47,
      estimatedCost: [{ currency: 'SAR', amount: '27000' }],
      linesInPlan: 2,
      linesWithSessions: 1,
    });
    expect(view.value.plans).toEqual([
      expect.objectContaining({ planId: PLAN, status: 'approved', planVersion: 1 }),
    ]);
  });

  it('opens on the year of the latest approved plan with drafts when no year is asked (review L7)', async () => {
    calendar();
    repo.latestDraftedPlanYear.mockResolvedValue(2027);
    const q = runtime('training_coordinator').query(defs.trainingCalendarQueryDefinition());
    const latest = await q({});
    expect(latest.ok && latest.value.year).toBe(2027);
    expect(repo.listPlansOverlapping).toHaveBeenLastCalledWith({}, '2027-01-01', '2027-12-31');
    repo.latestDraftedPlanYear.mockResolvedValue(null);
    const none = await q({});
    expect(none.ok && none.value.year).toBe(new Date().getUTCFullYear());
    const asked = await q({ year: 2029 });
    expect(asked.ok && asked.value.year).toBe(2029);
    expect(repo.latestDraftedPlanYear).toHaveBeenCalledTimes(2);
  });

  it('filters by quarter, branch and course', async () => {
    calendar();
    const q = runtime('training_manager').query(defs.trainingCalendarQueryDefinition());
    const jeddah = await q({ year: 2027, branchId: JED });
    expect(
      jeddah.ok && jeddah.value.quarters.flatMap((x) => x.months.flatMap((m) => m.drafts)).length,
    ).toBe(1);
    const none = await q({ year: 2027, branchId: 'none' });
    expect(none.ok && none.value.summary.drafts).toBe(0);
    const q2 = await q({ year: 2027, quarter: 2 });
    expect(q2.ok && q2.value.quarters.map((x) => x.quarter)).toEqual([2]);
    const course = await q({ year: 2027, courseId: '00000000-0000-4000-8000-000000000001' });
    expect(course.ok && course.value.summary).toMatchObject({ drafts: 0, linesInPlan: 0 });
  });

  it('shows a department-limited planner the lines of its units only, and nobody else anything', async () => {
    calendar();
    repo.listSessionsBetween.mockResolvedValue([]);
    const planner = await runtime(CUSTOM).query(defs.trainingCalendarQueryDefinition())({
      year: 2027,
    });
    // Finance's unit: Advanced Excel (shared, read only); not Negotiation (Sales only).
    expect(planner.ok && planner.value.quarters.flatMap((q) => q.notDrafted)).toEqual([]);
    for (const role of ['learner', 'department_head', 'hr_manager']) {
      const refused = await runtime(role).query(defs.trainingCalendarQueryDefinition())({
        year: 2027,
      });
      expect(!refused.ok && refused.error.code, role).toBe('FORBIDDEN');
    }
  });
});
