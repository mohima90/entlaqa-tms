/**
 * From the approved plan to courses and draft sessions end to end against PostgreSQL (WP-LD-04, T-M3-08; FR-PLN-09,
 * FR-CAT-01, FR-SCH-01 core, FR-IAM-08): the real definitions, the production runtime's parts (grants from role
 * assignments, audit events) and withUserTx as app_server, so the repositories' SQL, row-level security and the
 * guards of migration 20261117100200 all run. Two organizations. The design's example: «Advanced Excel», Q1, Finance
 * 20 + Human Resources 12 in Riyadh and Sales 15 in Jeddah, at most 20 a session → 3 sessions; «Negotiation», Sales
 * only. The plan is approved; the L&D Manager creates the Excel course from its line and links a library course to
 * Negotiation; the Training Coordinator drafts Excel's sessions from the proposal (by branch, with the named people),
 * changes one, deletes one and drafts it again; a department-limited planner for Sales drafts Negotiation but not a
 * line shared with Finance; nobody else — an Employee, a head, the HR Manager, the other organization — sees a draft.
 * Every change is audited without the people's ids. Review fixes (15 Nov 2026): the Training Coordinator links a
 * course (M4); an organization-wide planner without tms.session.manage is refused a drafted line's course (M1); a
 * course linked and a draft added at the same moment never disagree (M2, two connections); a person moves to another
 * draft (L6); the calendar opens on the plan's year (L7); a revised plan keeps its drafts and their lines (M3).
 */
import { randomUUID } from 'node:crypto';
import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import {
  type UserTx,
  createDatabase,
  createWithUserTx,
  insertAuditEvent,
  loadMemberAuthorizationFacts,
  loadSessionFacts,
} from '@jadarat/platform-db';
import {
  type ActionRuntime,
  createDefineAction,
  createDefineQuery,
  grantsForAssignments,
} from '@jadarat/platform-rbac';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCourseActionDefinition } from '../courses/actions';
import { dbError } from '../planning/repository';
import * as approval from '../planning/approval-definitions';
import * as plan from '../planning/consolidation-definitions';
import * as cycles from '../planning/definitions';
import * as needs from '../planning/needs-definitions';
import * as defs from './definitions';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)('draft sessions from the approved plan against PostgreSQL', () => {
  const ownerDb = createDatabase(ownerUrl ?? '', { max: 1 });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const secondDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const withSecondTx = createWithUserTx(() => secondDb);
  const id = () => randomUUID();
  const tenant = id();
  const other = id();
  const branch = { riyadh: id(), jeddah: id() };
  const dept = { finance: id(), sales: id(), hr: id() };
  const customRole = id();
  const customCode = `custom_${tenant.replace(/-/g, '').slice(0, 12)}`;
  // An organization-wide custom role that builds the plan and reads the library, without tms.session.manage (M1).
  const builderRole = id();
  const builderCode = `custom_${tenant.replace(/-/g, '').slice(12, 24)}`;
  const member = (role: string | null, tenantId = tenant) => ({
    person: id(),
    user: id(),
    session: id(),
    role,
    tenantId,
  });
  const people = {
    lnd: member('training_manager'),
    coordinator: member('training_coordinator'),
    hrManager: member('hr_manager'),
    financeHead: member('department_head'),
    salesHead: member('department_head'),
    hrHead: member('department_head'),
    fin1: member('learner'),
    fin2: member('learner'),
    hr1: member('learner'),
    salesPlanner: member(customCode),
    planBuilder: member(builderCode),
    otherLnd: member('training_manager', other),
    // Heads Quality and its sub-department Audit (smoke bug: one person named in both departments' needs).
    qualityHead: member('department_head'),
    auditor: member('learner'),
  };

  const unexpected: unknown[] = [];
  const claimsOf = (m: ReturnType<typeof member>) => {
    const claims = brandVerifiedClaims({
      sub: m.user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: m.session,
      tenant_id: m.tenantId,
      person_id: m.person,
    });
    if (!claims.ok) throw new Error('bad fixture');
    return claims.value;
  };
  const as = (m: ReturnType<typeof member>) => {
    const runtime: ActionRuntime<UserTx> = {
      loadSessionFacts: (tx) => loadSessionFacts(tx),
      loadGrants: async (tx) => {
        const facts = await loadMemberAuthorizationFacts(tx);
        return grantsForAssignments(
          facts.roles.map((role) => ({ roleCode: role.roleCode, scopeUnitId: role.scopeUnitId })),
          { headedDepartmentIds: facts.headedDepartmentIds, customRoles: facts.customRoles },
        );
      },
      resolveResource: () => Promise.resolve(null),
      writeAudit: (tx, actor, record) => insertAuditEvent(tx, actor, record),
      logError: (error) => {
        unexpected.push(error);
      },
      getClaims: () => Promise.resolve(ok(claimsOf(m))),
      withUserTx: (claims, fn) => withUserTx(claims, fn),
    };
    return {
      action: createDefineAction<UserTx>(runtime),
      query: createDefineQuery<UserTx>(runtime),
    };
  };

  beforeAll(async () => {
    const run = (query: ReturnType<typeof sql>) => ownerDb.execute(query);
    await run(sql`insert into platform.tenants (id, slug, name_ar, status) values
      (${tenant}, ${`ds-a-${tenant.slice(0, 8)}`}, 'أ', 'active'),
      (${other}, ${`ds-b-${other.slice(0, 8)}`}, 'ب', 'active')`);
    await run(sql`insert into platform.branches (id, tenant_id, code, name_ar, name_en, is_headquarters) values
      (${branch.riyadh}, ${tenant}, 'RUH', 'الرياض', 'Riyadh', true),
      (${branch.jeddah}, ${tenant}, 'JED', 'جدة', 'Jeddah', false)`);
    await run(sql`insert into platform.departments (id, tenant_id, code, name_ar, name_en, branch_id) values
      (${dept.finance}, ${tenant}, 'FIN', 'المالية', 'Finance', ${branch.riyadh}),
      (${dept.sales}, ${tenant}, 'SAL', 'المبيعات', 'Sales', ${branch.jeddah}),
      (${dept.hr}, ${tenant}, 'HR', 'الموارد البشرية', 'Human resources', ${branch.riyadh})`);
    await run(sql`insert into platform.custom_roles (id, tenant_id, code, name_en, name_ar, description, data_scope)
      values (${customRole}, ${tenant}, ${customCode}, 'Sessions – Sales', 'الجلسات – المبيعات', null, 'departments')`);
    await run(sql`insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code) values
      (${tenant}, ${customRole}, 'tms.training_plan.read'),
      (${tenant}, ${customRole}, 'tms.course.read'),
      (${tenant}, ${customRole}, 'tms.session.manage')`);
    await run(sql`insert into platform.custom_roles (id, tenant_id, code, name_en, name_ar, description, data_scope)
      values (${builderRole}, ${tenant}, ${builderCode}, 'Plan builder', 'معد الخطة', null, 'organization')`);
    await run(sql`insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code) values
      (${tenant}, ${builderRole}, 'tms.training_plan.read'),
      (${tenant}, ${builderRole}, 'tms.training_plan.manage'),
      (${tenant}, ${builderRole}, 'tms.course.read')`);
    for (const [index, m] of Object.values(people).entries()) {
      await run(
        sql`insert into auth.users (id, email) values (${m.user}, ${`${m.user}@example.test`})`,
      );
      await run(sql`insert into auth.sessions (id, user_id) values (${m.session}, ${m.user})`);
      await run(sql`insert into platform.persons (id, tenant_id, display_name_ar, display_name_en)
        values (${m.person}, ${m.tenantId}, ${`شخص ${String(index)}`}, ${`Person ${String(index)}`})`);
      await run(sql`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
        values (${m.tenantId}, ${m.user}, ${m.person}, 'active')`);
      await run(sql`insert into platform.session_context (session_id, user_id, active_tenant_id)
        values (${m.session}, ${m.user}, ${m.tenantId})`);
      if (m.role) {
        await run(sql`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary,
                                                            scope_unit_id)
          select tenant_id, id, ${m.role}, true, ${m.role === customCode ? dept.sales : null}::uuid
          from platform.tenant_memberships where user_id = ${m.user}`);
      }
    }
    for (const [head, unit] of [
      [people.financeHead, dept.finance],
      [people.salesHead, dept.sales],
      [people.hrHead, dept.hr],
    ] as const) {
      await run(
        sql`update platform.departments set head_person_id = ${head.person} where id = ${unit}`,
      );
    }
    for (const [m, unit, home] of [
      [people.fin1, dept.finance, branch.riyadh],
      [people.fin2, dept.finance, branch.riyadh],
      [people.hr1, dept.hr, branch.riyadh],
    ] as const) {
      await run(sql`insert into platform.person_employment (tenant_id, person_id, branch_id, department_id)
        values (${tenant}, ${m.person}, ${home}, ${unit})`);
    }
  });

  afterAll(async () => {
    expect(unexpected).toEqual([]);
    await ownerDb.$client.end();
    await serverDb.$client.end();
    await secondDb.$client.end();
  });

  it('turns the approved plan into courses and draft sessions for the L&D team only', async () => {
    const lnd = as(people.lnd);
    const coordinator = as(people.coordinator);

    // ---- An approved plan: Advanced Excel (Finance 20, Sales 15, HR 12; at most 20) and Negotiation (Sales 6).
    const list = await lnd.query(cycles.planCyclesListQueryDefinition())({});
    if (!list.ok || !list.value.setup) throw new Error('set-up choices');
    const created = await lnd.action(cycles.createPlanCycleActionDefinition())({
      nameAr: null,
      nameEn: 'Training plan 2027',
      ...list.value.setup.defaults,
      departmentIds: [dept.finance, dept.sales, dept.hr],
    });
    if (!created.ok) throw new Error(created.error.code);
    const cycleId = created.value.id;
    const launched = await lnd.action(cycles.launchPlanCycleActionDefinition())({
      id: cycleId,
      version: created.value.version,
    });
    if (!launched.ok) throw new Error(launched.error.code);
    for (const [head, departmentId, topic, count, named] of [
      [
        people.financeHead,
        dept.finance,
        'Advanced Excel',
        20,
        [people.fin1.person, people.fin2.person],
      ],
      [people.salesHead, dept.sales, 'Advanced Excel', 15, []],
      [people.hrHead, dept.hr, 'Advanced Excel', 12, [people.hr1.person]],
      [people.salesHead, dept.sales, 'Negotiation', 6, []],
    ] as const) {
      const added = await as(head).action(needs.addNeedActionDefinition())({
        cycleId,
        departmentId,
        topic,
        courseId: null,
        peopleCount: count,
        personIds: [...named],
        estimatedCost: '',
        answers: {},
      });
      if (!added.ok) throw new Error(`${topic}: ${added.error.code}`);
    }
    for (const [head, departmentId] of [
      [people.financeHead, dept.finance],
      [people.salesHead, dept.sales],
      [people.hrHead, dept.hr],
    ] as const) {
      const view = await as(head).query(needs.departmentNeedsQueryDefinition())({
        cycleId,
        departmentId,
      });
      if (!view.ok) throw new Error(view.error.code);
      const submitted = await as(head).action(needs.submitNeedsActionDefinition())({
        cycleId,
        departmentId,
        version: view.value.department.version,
      });
      if (!submitted.ok) throw new Error(submitted.error.code);
    }
    const opened = await lnd.action(plan.openConsolidationActionDefinition())({ cycleId });
    if (!opened.ok) throw new Error(opened.error.code);
    const planId = opened.value.planId;
    const lines = await lnd.query(plan.planQueryDefinition())({ cycleId });
    if (!lines.ok) throw new Error(lines.error.code);
    const excelLine = lines.value.lines.find((l) => l.title === 'Advanced Excel');
    const negotiationLine = lines.value.lines.find((l) => l.title === 'Negotiation');
    if (!excelLine || !negotiationLine) throw new Error('two lines');
    for (const [l, max, cost] of [
      [excelLine, 20, '9000'],
      [negotiationLine, 10, '2000'],
    ] as const) {
      const costed = await lnd.action(plan.updatePlanLineActionDefinition())({
        lineId: l.id,
        version: l.version,
        quarter: 1,
        minPerSession: 2,
        maxPerSession: max,
        costPerSession: cost,
        deliveryType: 'classroom',
        durationHours: 12,
      });
      if (!costed.ok) throw new Error(costed.error.code);
    }

    // Before approval: no course for a line, no draft.
    const early = await lnd.query(defs.planDeliveryQueryDefinition())({ cycleId });
    expect(early.ok && early.value.lines.every((l) => !l.can.createCourse)).toBe(true);
    const state = await lnd.query(approval.planApprovalQueryDefinition())({ cycleId });
    if (!state.ok || !state.value) throw new Error('approval view');
    const submitted = await lnd.action(approval.submitPlanActionDefinition())({
      planId,
      version: state.value.plan.version,
    });
    if (!submitted.ok) throw new Error(submitted.error.code);
    const review = await as(people.hrManager).query(approval.planApprovalQueryDefinition())({
      cycleId,
    });
    if (!review.ok || !review.value) throw new Error('review');
    const approved = await as(people.hrManager).action(approval.decidePlanActionDefinition())({
      planId,
      version: review.value.plan.version,
      step: 'hr',
      decision: 'approve',
    });
    if (!approved.ok) throw new Error(approved.error.code);
    expect(approved.value.status).toBe('approved');

    // ---- The Plan tab's Course and Draft sessions columns.
    const delivery = async (who = lnd) => {
      const view = await who.query(defs.planDeliveryQueryDefinition())({ cycleId });
      if (!view.ok) throw new Error(view.error.code);
      return view.value;
    };
    const before = await delivery();
    const excel = before.lines.find((l) => l.lineId === excelLine.id);
    if (!excel?.courseDraft) throw new Error('course draft');
    expect(excel).toMatchObject({
      state: 'needs_course',
      plannedSessions: 3,
      sizes: [16, 16, 15],
      people: 47,
      named: 3,
      can: { createCourse: true, linkCourse: true, createSessions: false },
    });
    expect(excel.courseDraft).toMatchObject({
      deliveryType: 'classroom',
      durationHours: 12,
      minParticipants: 2,
      maxParticipants: 20,
    });
    expect([excel.courseDraft.titleEn, excel.courseDraft.titleAr]).toContain('Advanced Excel');
    expect(before.counts).toEqual({ needsCourse: 2, needsSessions: 0, sessionsCreated: 0 });

    // «Create course» from the line: the L&D Manager; a department-limited planner gives no line a course (M4).
    const courseValues = {
      titleEn: excel.courseDraft.titleEn,
      titleAr: excel.courseDraft.titleAr,
      descriptionEn: '',
      descriptionAr: '',
      category: { kind: 'none' as const },
      deliveryType: excel.courseDraft.deliveryType ?? 'classroom',
      durationHours: excel.courseDraft.durationHours ?? 12,
      durationDays: null,
      minParticipants: excel.courseDraft.minParticipants,
      maxParticipants: excel.courseDraft.maxParticipants,
      estCostPerSession: excel.courseDraft.estCostPerSession,
      estCostPerParticipant: excel.courseDraft.estCostPerParticipant,
    };
    const byPlanner = await as(people.salesPlanner).action(
      defs.createCourseFromLineActionDefinition(),
    )({ lineId: excel.lineId, lineVersion: excel.version, course: courseValues });
    expect(!byPlanner.ok && byPlanner.error.code).toBe('FORBIDDEN');
    const excelCourse = await lnd.action(defs.createCourseFromLineActionDefinition())({
      lineId: excel.lineId,
      lineVersion: excel.version,
      course: courseValues,
    });
    if (!excelCourse.ok) throw new Error(JSON.stringify(excelCourse.error));
    expect(excelCourse.value).toMatchObject({ origin: 'created', previousCourseId: null });
    expect(excelCourse.value.course.code).toMatch(/^CRS-\d{4}$/);
    const stale = await lnd.action(defs.createCourseFromLineActionDefinition())({
      lineId: excel.lineId,
      lineVersion: excel.version,
      course: courseValues,
    });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');

    // «Link course» for Negotiation: a course of the library, by the Training Coordinator (tms.course.manage, M4).
    const library = await lnd.action(createCourseActionDefinition())({
      ...courseValues,
      titleEn: 'Negotiation skills',
      titleAr: 'مهارات التفاوض',
      code: null,
    });
    if (!library.ok) throw new Error(library.error.code);
    const negotiation = (await delivery()).lines.find((l) => l.lineId === negotiationLine.id);
    if (!negotiation) throw new Error('negotiation');
    const byPlannerLink = await as(people.salesPlanner).action(
      defs.linkLineCourseActionDefinition(),
    )({
      lineId: negotiation.lineId,
      lineVersion: negotiation.version,
      courseId: library.value.after.id,
    });
    expect(!byPlannerLink.ok && byPlannerLink.error.code).toBe('FORBIDDEN');
    const linked = await coordinator.action(defs.linkLineCourseActionDefinition())({
      lineId: negotiation.lineId,
      lineVersion: negotiation.version,
      courseId: library.value.after.id,
    });
    if (!linked.ok) throw new Error(linked.error.code);
    const withCourses = await delivery();
    expect(withCourses.lines.map((l) => [l.title, l.course?.origin, l.state]).sort()).toEqual([
      ['Advanced Excel', 'created', 'needs_sessions'],
      ['Negotiation', 'linked', 'needs_sessions'],
    ]);
    // ---- Review M2: a course linked and a draft added at the same moment, on two connections — never a draft of a
    //      course the line no longer has.
    const another = await lnd.action(createCourseActionDefinition())({
      ...courseValues,
      titleEn: 'Negotiation lab',
      titleAr: 'مختبر التفاوض',
      code: null,
    });
    if (!another.ok) throw new Error(another.error.code);
    const gate = () => {
      let open: () => void = () => undefined;
      const passed = new Promise<void>((resolve) => {
        open = resolve;
      });
      return {
        passed,
        open: () => {
          open();
        },
      };
    };
    const settled = <T>(promise: Promise<T>) => {
      const state = { done: false };
      return {
        state,
        promise: promise.finally(() => {
          state.done = true;
        }),
      };
    };
    const firstMonth = `${before.cycle.periodStart.slice(0, 7)}-01`;
    const rawDraft = (courseId: string) => sql`
      insert into tms.sessions (plan_id, cycle_id, plan_line_id, course_id, delivery_type, month, seats)
      values (${planId}::uuid, ${cycleId}::uuid, ${negotiation.lineId}::uuid, ${courseId}::uuid, 'classroom',
              ${firstMonth}::date, 6) returning id`;
    const relink = (courseId: string) => sql`
      update tms.plan_lines set course_id = ${courseId}::uuid where id = ${negotiation.lineId}::uuid returning id`;
    // 1. The course is being changed (not committed) when a draft of the old course comes: the draft waits for the
    //    line, then sees the new course and is refused (JK013).
    const relinked = gate();
    const releaseLink = gate();
    const linking = withSecondTx(claimsOf(people.lnd), async (tx) => {
      const rows = await tx.execute(relink(another.value.after.id));
      relinked.open();
      await releaseLink.passed;
      return rows.length;
    });
    await relinked.passed;
    const lateDraft = settled(
      withUserTx(claimsOf(people.coordinator), (tx) =>
        tx.execute(rawDraft(library.value.after.id)),
      ).then(
        () => null,
        (error: unknown) => dbError(error)?.code ?? 'unknown',
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(lateDraft.state.done).toBe(false);
    releaseLink.open();
    expect(await linking).toBe(1);
    expect(await lateDraft.promise).toBe('JK013');
    // 2. The other way round: a draft is being added (not committed) when the course changes — the change waits for
    //    the line, then sees the draft and is refused (JK017).
    const drafting = gate();
    const releaseDraft = gate();
    const inserting = withSecondTx(claimsOf(people.coordinator), async (tx) => {
      const [row] = await tx.execute(rawDraft(another.value.after.id));
      drafting.open();
      await releaseDraft.passed;
      return String(row?.id);
    });
    await drafting.passed;
    const lateLink = settled(
      withUserTx(claimsOf(people.lnd), (tx) => tx.execute(relink(library.value.after.id))).then(
        () => null,
        (error: unknown) => dbError(error)?.code ?? 'unknown',
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(lateLink.state.done).toBe(false);
    releaseDraft.open();
    const rawId = await inserting;
    expect(await lateLink.promise).toBe('JK017');
    const [kept] = (await ownerDb.execute(sql`
      select l.course_id::text as line_course, s.course_id::text as draft_course
      from tms.sessions s join tms.plan_lines l on l.id = s.plan_line_id where s.id = ${rawId}::uuid`)) as unknown as {
      line_course: string;
      draft_course: string;
    }[];
    expect(kept).toEqual({
      line_course: another.value.after.id,
      draft_course: another.value.after.id,
    });
    await ownerDb.execute(sql`delete from tms.sessions where id = ${rawId}::uuid`);

    // The approved plan did not change: version 1 as approved, the line's other values as they were.
    const version = await lnd.query(approval.planVersionQueryDefinition())({
      cycleId,
      planVersion: 1,
    });
    expect(version.ok).toBe(true);
    const frozen = await lnd.action(plan.updatePlanLineActionDefinition())({
      lineId: excel.lineId,
      version: excelCourse.value.lineVersion,
      quarter: 2,
    });
    expect(!frozen.ok && frozen.error.code).toBe('TRAINING_PLAN_FROZEN');

    // ---- «Create draft sessions»: the Training Coordinator, from the proposal.
    const proposalOf = async (lineId: string, who = coordinator) => {
      const view = await who.query(defs.draftProposalQueryDefinition())({ lineId });
      if (!view.ok) throw new Error(view.error.code);
      return view.value;
    };
    const proposal = await proposalOf(excel.lineId);
    const q1 = proposal.line.quarterMonths;
    expect(proposal.proposal.sessions.map((s) => [s.month, s.branchId, s.seats])).toEqual([
      [q1[0], branch.riyadh, 16],
      [q1[1], branch.riyadh, 16],
      [q1[2], branch.jeddah, 15],
    ]);
    expect(proposal.proposal.sessions.map((s) => [...s.personIds].sort())).toEqual([
      [people.fin1.person, people.fin2.person].sort(),
      [people.hr1.person],
      [],
    ]);
    expect(proposal.check).toMatchObject({
      seats: 47,
      people: 47,
      allPlaced: true,
      matchesPlan: true,
    });
    const drafts = await coordinator.action(defs.createDraftSessionsActionDefinition())({
      lineId: excel.lineId,
      sessions: proposal.proposal.sessions.map((s) => ({
        month: s.month,
        branchId: s.branchId,
        seats: s.seats,
        personIds: [...s.personIds],
      })),
    });
    if (!drafts.ok) throw new Error(JSON.stringify(drafts.error));
    expect(drafts.value.sessions).toHaveLength(3);
    const again = await coordinator.action(defs.createDraftSessionsActionDefinition())({
      lineId: excel.lineId,
      sessions: [{ month: q1[0], branchId: null, seats: 1, personIds: [] }],
    });
    expect(!again.ok && again.error.code).toBe('SESSION_LINE_ALL_DRAFTED');
    const drafted = (await delivery()).lines.find((l) => l.lineId === excel.lineId);
    expect(drafted).toMatchObject({
      state: 'drafted',
      drafts: { count: 3, months: [...q1], outsideQuarter: 0, seats: 47 },
      can: { createCourse: false, linkCourse: false, createSessions: false },
    });

    // ---- The training calendar of the plan's first year.
    const year = Number(q1[0].slice(0, 4));
    const calendar = await coordinator.query(defs.trainingCalendarQueryDefinition())({ year });
    if (!calendar.ok) throw new Error(calendar.error.code);
    const calendarDrafts = calendar.value.quarters.flatMap((q) =>
      q.months.flatMap((m) => m.drafts),
    );
    const inYear = q1.filter((m) => m.startsWith(String(year)));
    expect(
      calendarDrafts
        .filter((d) => d.lineId === excel.lineId)
        .map((d) => [d.month, d.ordinal, d.planned, d.outsideQuarter]),
    ).toEqual(inYear.map((m) => [m, q1.indexOf(m) + 1, 3, false]));
    expect(
      calendar.value.quarters.flatMap((q) =>
        q.notDrafted.map((n) => [n.title, n.state, n.missing]),
      ),
    ).toContainEqual(['Negotiation', 'needs_sessions', 1]);
    expect(calendar.value.plans.map((p) => p.planId)).toContain(planId);
    const sales = await coordinator.query(defs.trainingCalendarQueryDefinition())({
      year,
      branchId: branch.jeddah,
    });
    expect(
      sales.ok && sales.value.quarters.flatMap((q) => q.months.flatMap((m) => m.drafts)).length,
    ).toBe(q1[2].startsWith(String(year)) ? 1 : 0);

    // ---- A draft opened: move HR's person to session 1, a month outside the quarter, more seats.
    const [first, second, third] = drafts.value.sessions;
    if (!first || !second || !third) throw new Error('three drafts');
    const detail = await coordinator.query(defs.draftSessionQueryDefinition())({
      sessionId: first.id,
    });
    if (!detail.ok) throw new Error(detail.error.code);
    expect(detail.value.session).toMatchObject({ ordinal: 1, planned: 3, drafted: 3, seats: 16 });
    expect(detail.value.participants.map((p) => p.personId).sort()).toEqual(
      [people.fin1.person, people.fin2.person].sort(),
    );
    expect(detail.value.candidates).toEqual([
      expect.objectContaining({ personId: people.hr1.person, sessionId: second.id }),
    ]);
    expect(detail.value.unnamedSeats).toEqual(
      expect.arrayContaining([
        { departmentId: dept.finance, seats: 18 },
        { departmentId: dept.sales, seats: 15 },
        { departmentId: dept.hr, seats: 11 },
      ]),
    );
    const updated = await coordinator.action(defs.updateDraftSessionActionDefinition())({
      sessionId: first.id,
      version: detail.value.session.version,
      month: addMonth(q1[2]),
      seats: 17,
      personIds: [people.fin1.person, people.fin2.person, people.hr1.person],
    });
    if (!updated.ok) throw new Error(JSON.stringify(updated.error));
    expect(updated.value.people).toEqual({ added: 0, moved: 1, removed: 0 });
    const moved = await coordinator.query(defs.draftSessionQueryDefinition())({
      sessionId: first.id,
    });
    expect(moved.ok && moved.value.session).toMatchObject({
      seats: 17,
      outsideQuarter: true,
      estimatedCost: '9000',
    });
    const tooFew = await coordinator.action(defs.updateDraftSessionActionDefinition())({
      sessionId: first.id,
      version: updated.value.version,
      seats: 2,
    });
    expect(!tooFew.ok && tooFew.error.fieldErrors).toEqual([
      { path: 'seats', code: 'FEWER_THAN_PEOPLE' },
    ]);
    // HR's person came from session 2: that draft has a new version too (L6).
    const secondAfter = await coordinator.query(defs.draftSessionQueryDefinition())({
      sessionId: second.id,
    });
    expect(secondAfter.ok && secondAfter.value.session.version).toBe(2);
    expect(updated.value.movedFrom).toEqual([second.id]);
    // «Move to another session» from the ⋯ menu: HR's person back to session 2; both drafts move on (L6).
    expect(moved.ok && moved.value.otherSessions.map((o) => [o.id, o.participants])).toEqual([
      [second.id, 0],
      [third.id, 0],
    ]);
    const movedBack = await coordinator.action(defs.moveDraftParticipantActionDefinition())({
      sessionId: first.id,
      version: updated.value.version,
      personId: people.hr1.person,
      toSessionId: second.id,
    });
    if (!movedBack.ok) throw new Error(JSON.stringify(movedBack.error));
    expect(movedBack.value).toMatchObject({
      version: updated.value.version + 1,
      toVersion: 3,
      from: { before: 3, after: 2 },
      to: { before: 0, after: 1 },
    });
    const backHere = await coordinator.query(defs.draftSessionQueryDefinition())({
      sessionId: second.id,
    });
    expect(backHere.ok && backHere.value.participants.map((p) => p.personId)).toEqual([
      people.hr1.person,
    ]);
    const staleMove = await coordinator.action(defs.moveDraftParticipantActionDefinition())({
      sessionId: first.id,
      version: updated.value.version,
      personId: people.fin1.person,
      toSessionId: second.id,
    });
    expect(!staleMove.ok && staleMove.error.code).toBe('CONFLICT_VERSION');

    // Delete the Jeddah draft; «Create sessions» proposes it again.
    const deleted = await lnd.action(defs.deleteDraftSessionActionDefinition())({
      sessionId: third.id,
      version: 1,
    });
    if (!deleted.ok) throw new Error(deleted.error.code);
    const partly = (await delivery()).lines.find((l) => l.lineId === excel.lineId);
    expect(partly?.state).toBe('partly_drafted');
    const left = await proposalOf(excel.lineId);
    expect(left.remaining).toBe(1);
    expect(left.proposal.sessions.map((s) => [s.month, s.branchId, s.seats, s.personIds])).toEqual([
      [q1[2], branch.jeddah, 15, []],
    ]);

    // ---- A department-limited planner for Sales: Negotiation is Sales-only; Excel is shared with Finance and HR.
    const planner = as(people.salesPlanner);
    const plannerView = await delivery(planner);
    expect(plannerView.scope).toBe('departments');
    expect(plannerView.lines.map((l) => [l.title, l.can.createSessions]).sort()).toEqual([
      ['Advanced Excel', false],
      ['Negotiation', true],
    ]);
    const shared = await planner.action(defs.updateDraftSessionActionDefinition())({
      sessionId: second.id,
      version: 1,
      seats: 15,
    });
    expect(!shared.ok && shared.error.code).toMatch(/SESSION_LINE_OUTSIDE_SCOPE|CONFLICT_VERSION/);
    const negotiationProposal = await proposalOf(negotiation.lineId, planner);
    const salesDraft = await planner.action(defs.createDraftSessionsActionDefinition())({
      lineId: negotiation.lineId,
      sessions: negotiationProposal.proposal.sessions.map((s) => ({
        month: s.month,
        branchId: s.branchId,
        seats: s.seats,
        personIds: [...s.personIds],
      })),
    });
    if (!salesDraft.ok) throw new Error(JSON.stringify(salesDraft.error));
    expect(salesDraft.value.sessions.map((s) => s.branchId)).toEqual([branch.jeddah]);

    // ---- Nobody else sees a draft.
    for (const who of [people.fin1, people.salesHead, people.hrManager]) {
      const refused = await as(who).query(defs.trainingCalendarQueryDefinition())({ year });
      expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
      const detailRefused = await as(who).query(defs.draftSessionQueryDefinition())({
        sessionId: first.id,
      });
      expect(!detailRefused.ok && detailRefused.error.code).toBe('FORBIDDEN');
    }
    const otherOrg = as(people.otherLnd);
    const foreignCalendar = await otherOrg.query(defs.trainingCalendarQueryDefinition())({ year });
    expect(
      foreignCalendar.ok &&
        foreignCalendar.value.quarters.flatMap((q) => q.months.flatMap((m) => m.drafts)),
    ).toEqual([]);
    const foreignDetail = await otherOrg.query(defs.draftSessionQueryDefinition())({
      sessionId: first.id,
    });
    expect(!foreignDetail.ok && foreignDetail.error.code).toBe('NOT_FOUND');
    const foreignDelete = await otherOrg.action(defs.deleteDraftSessionActionDefinition())({
      sessionId: first.id,
      version: movedBack.value.version,
    });
    expect(!foreignDelete.ok && foreignDelete.error.code).toBe('NOT_FOUND');
    const foreignDraft = await otherOrg.action(defs.createDraftSessionsActionDefinition())({
      lineId: excel.lineId,
      sessions: [{ month: q1[0], branchId: null, seats: 1, personIds: [] }],
    });
    expect(!foreignDraft.ok && foreignDraft.error.code).toBe('NOT_FOUND');
    const counted = (await ownerDb.execute(
      sql`select count(*)::int as n from tms.sessions where tenant_id = ${tenant}`,
    )) as unknown as { n: number }[];
    const count = counted[0]?.n;
    expect(count).toBe(3);

    // ---- Every change is audited, the people counted, never named.
    const audits = (await ownerDb.execute(sql`
      select action, data::text as data from platform.audit_events
      where tenant_id = ${tenant} and (action like 'tms.session.%' or action like 'tms.training_plan.line_course%')
      order by occurred_at, id`)) as unknown as { action: string; data: string }[];
    expect(audits.map((a) => a.action)).toEqual([
      'tms.training_plan.line_course_created',
      'tms.training_plan.line_course_linked',
      'tms.session.drafts_created',
      'tms.session.draft_updated',
      'tms.session.draft_participant_moved',
      'tms.session.draft_deleted',
      'tms.session.drafts_created',
    ]);
    for (const p of [people.fin1, people.fin2, people.hr1]) {
      expect(audits.some((a) => a.data.includes(p.person))).toBe(false);
    }

    // ---- The calendar opens on the plan's year when no year is asked (L7).
    const openedOn = await coordinator.query(defs.trainingCalendarQueryDefinition())({});
    expect(openedOn.ok && openedOn.value.year).toBe(year);

    // ---- Review M1: an organization-wide planner without tms.session.manage reads no draft — and is still refused
    //      a drafted line's course, by the application and by the database.
    const builder = as(people.planBuilder);
    const drafts1 = await builder.query(defs.trainingCalendarQueryDefinition())({ year });
    expect(!drafts1.ok && drafts1.error.code).toBe('FORBIDDEN');
    const excelNow = (await ownerDb.execute(
      sql`select version from tms.plan_lines where id = ${excel.lineId}::uuid`,
    )) as unknown as { version: number }[];
    const builderLink = await builder.action(defs.linkLineCourseActionDefinition())({
      lineId: excel.lineId,
      lineVersion: Number(excelNow[0]?.version),
      courseId: another.value.after.id,
    });
    expect(!builderLink.ok && builderLink.error.code).toBe('SESSION_LINE_HAS_DRAFTS');
    const builderSql = await withUserTx(claimsOf(people.planBuilder), (tx) =>
      tx.execute(sql`update tms.plan_lines set course_id = ${another.value.after.id}::uuid
                     where id = ${excel.lineId}::uuid`),
    ).then(
      () => null,
      (error: unknown) => dbError(error)?.code ?? 'unknown',
    );
    expect(builderSql).toBe('JK017');

    // ---- Review M3: a revised plan keeps its drafts — and the line with drafts keeps its place: leaving it out or
    //      moving a need whose people are planned is refused («delete its draft sessions first»); sizes still change.
    const approvedState = await lnd.query(approval.planApprovalQueryDefinition())({ cycleId });
    if (!approvedState.ok || !approvedState.value) throw new Error('approval view');
    const revised = await lnd.action(approval.revisePlanActionDefinition())({
      planId,
      version: approvedState.value.plan.version,
    });
    if (!revised.ok) throw new Error(revised.error.code);
    const revisedDelivery = await delivery();
    expect(revisedDelivery.plan.status).toBe('draft');
    expect(revisedDelivery.summary.sessionsDrafted).toBe(3);
    const revisedLines = await lnd.query(plan.planQueryDefinition())({ cycleId });
    const excelRevised = revisedLines.ok
      ? revisedLines.value.lines.find((l) => l.id === excel.lineId)
      : undefined;
    if (!excelRevised) throw new Error('excel line');
    const leftOut = await lnd.action(plan.leaveOutPlanLineActionDefinition())({
      lineId: excel.lineId,
      version: excelRevised.version,
      reason: 'Merged into another programme',
    });
    expect(!leftOut.ok && leftOut.error.code).toBe('TRAINING_PLAN_LINE_HAS_DRAFTS');
    const [financeNeed] = (await ownerDb.execute(sql`
      select need_id::text as need_id from tms.plan_line_needs
      where line_id = ${excel.lineId}::uuid and department_id = ${dept.finance}::uuid`)) as unknown as {
      need_id: string;
    }[];
    const movedOut = await lnd.action(plan.moveNeedOutActionDefinition())({
      lineId: excel.lineId,
      version: excelRevised.version,
      needId: financeNeed?.need_id ?? '',
    });
    expect(!movedOut.ok && movedOut.error.code).toBe('TRAINING_PLAN_LINE_HAS_DRAFTS');
    const resized = await lnd.action(plan.updatePlanLineActionDefinition())({
      lineId: excel.lineId,
      version: excelRevised.version,
      maxPerSession: 25,
    });
    expect(resized.ok).toBe(true);
    const stillThere = (await ownerDb.execute(sql`
      select l.status, (select count(*)::int from tms.sessions s where s.plan_line_id = l.id) as drafts
      from tms.plan_lines l where l.id = ${excel.lineId}::uuid`)) as unknown as {
      status: string;
      drafts: number;
    }[];
    expect(stillThere).toEqual([{ status: 'in_plan', drafts: 2 }]);
  });

  it('plans a person named in two departments’ needs of a line once (smoke bug)', async () => {
    const lnd = as(people.lnd);
    const coordinator = as(people.coordinator);
    const head = as(people.qualityHead);
    // Quality and its sub-department Audit, both headed by the same manager, who works in Audit: the manager is in
    // both teams and names themself in both departments' «Data literacy» needs.
    const quality = id();
    const auditUnit = id();
    // A second level of structure (a new organization starts with one; no unit below the last level).
    await ownerDb.execute(sql`insert into platform.structure_levels (tenant_id, ordinal, name_en, name_ar)
      values (${tenant}, 2, 'Section', 'قسم')`);
    await ownerDb.execute(sql`insert into platform.departments (id, tenant_id, code, name_ar, name_en, branch_id,
                                                              head_person_id) values
      (${quality}, ${tenant}, 'QLT', 'الجودة', 'Quality', ${branch.riyadh}, ${people.qualityHead.person})`);
    await ownerDb.execute(sql`insert into platform.departments (id, tenant_id, code, name_ar, name_en, branch_id,
                                                              parent_id, head_person_id) values
      (${auditUnit}, ${tenant}, 'AUD', 'التدقيق', 'Audit', ${branch.riyadh}, ${quality},
       ${people.qualityHead.person})`);
    for (const m of [people.qualityHead, people.auditor]) {
      await ownerDb.execute(sql`insert into platform.person_employment (tenant_id, person_id, branch_id, department_id)
        values (${tenant}, ${m.person}, ${branch.riyadh}, ${auditUnit})`);
    }

    const list = await lnd.query(cycles.planCyclesListQueryDefinition())({});
    if (!list.ok || !list.value.setup) throw new Error('set-up choices');
    const created = await lnd.action(cycles.createPlanCycleActionDefinition())({
      nameAr: null,
      nameEn: 'Quality plan',
      ...list.value.setup.defaults,
      departmentIds: [quality, auditUnit],
    });
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    const cycleId = created.value.id;
    const launched = await lnd.action(cycles.launchPlanCycleActionDefinition())({
      id: cycleId,
      version: created.value.version,
    });
    if (!launched.ok) throw new Error(launched.error.code);
    for (const [departmentId, named] of [
      [quality, [people.qualityHead.person]],
      [auditUnit, [people.qualityHead.person, people.auditor.person]],
    ] as const) {
      const added = await head.action(needs.addNeedActionDefinition())({
        cycleId,
        departmentId,
        topic: 'Data literacy',
        courseId: null,
        peopleCount: 3,
        personIds: [...named],
        estimatedCost: '',
        answers: {},
      });
      if (!added.ok) throw new Error(JSON.stringify(added.error));
      const view = await head.query(needs.departmentNeedsQueryDefinition())({
        cycleId,
        departmentId,
      });
      if (!view.ok) throw new Error(view.error.code);
      const submitted = await head.action(needs.submitNeedsActionDefinition())({
        cycleId,
        departmentId,
        version: view.value.department.version,
      });
      if (!submitted.ok) throw new Error(submitted.error.code);
    }
    const opened = await lnd.action(plan.openConsolidationActionDefinition())({ cycleId });
    if (!opened.ok) throw new Error(opened.error.code);
    const planId = opened.value.planId;
    const lines = await lnd.query(plan.planQueryDefinition())({ cycleId });
    if (!lines.ok) throw new Error(lines.error.code);
    const line = lines.value.lines.find((l) => l.title === 'Data literacy');
    if (!line) throw new Error('one line');
    const costed = await lnd.action(plan.updatePlanLineActionDefinition())({
      lineId: line.id,
      version: line.version,
      quarter: 1,
      minPerSession: 1,
      maxPerSession: 3,
      costPerSession: '1000',
      deliveryType: 'classroom',
      durationHours: 6,
    });
    if (!costed.ok) throw new Error(costed.error.code);
    const state = await lnd.query(approval.planApprovalQueryDefinition())({ cycleId });
    if (!state.ok || !state.value) throw new Error('approval view');
    const submitted = await lnd.action(approval.submitPlanActionDefinition())({
      planId,
      version: state.value.plan.version,
    });
    if (!submitted.ok) throw new Error(submitted.error.code);
    const review = await as(people.hrManager).query(approval.planApprovalQueryDefinition())({
      cycleId,
    });
    if (!review.ok || !review.value) throw new Error('review');
    const approved = await as(people.hrManager).action(approval.decidePlanActionDefinition())({
      planId,
      version: review.value.plan.version,
      step: 'hr',
      decision: 'approve',
    });
    if (!approved.ok) throw new Error(approved.error.code);
    const delivery = await lnd.query(defs.planDeliveryQueryDefinition())({ cycleId });
    if (!delivery.ok) throw new Error(delivery.error.code);
    const row = delivery.value.lines.find((l) => l.lineId === line.id);
    if (!row?.courseDraft) throw new Error('course draft');
    const course = await lnd.action(defs.createCourseFromLineActionDefinition())({
      lineId: row.lineId,
      lineVersion: row.version,
      course: {
        titleEn: row.courseDraft.titleEn,
        titleAr: row.courseDraft.titleAr,
        descriptionEn: '',
        descriptionAr: '',
        category: { kind: 'none' as const },
        deliveryType: row.courseDraft.deliveryType ?? 'classroom',
        durationHours: row.courseDraft.durationHours ?? 6,
        durationDays: null,
        minParticipants: row.courseDraft.minParticipants,
        maxParticipants: row.courseDraft.maxParticipants,
        estCostPerSession: row.courseDraft.estCostPerSession,
        estCostPerParticipant: row.courseDraft.estCostPerParticipant,
      },
    });
    if (!course.ok) throw new Error(JSON.stringify(course.error));

    // The proposal places the manager once — with Quality, whose need named them first; Audit counts its auditor
    // only and keeps the manager's seat for a name to come.
    const proposal = await coordinator.query(defs.draftProposalQueryDefinition())({
      lineId: line.id,
    });
    if (!proposal.ok) throw new Error(proposal.error.code);
    // One session a department (3 seats each, in the order of the plan's links).
    const byDepartment = Object.fromEntries(
      proposal.value.proposal.sessions.map((s) => [
        s.departments.map((d) => `${d.departmentId}:${String(d.named)}`).join(','),
        [...s.personIds],
      ]),
    );
    expect(byDepartment).toEqual({
      [`${quality}:1`]: [people.qualityHead.person],
      [`${auditUnit}:1`]: [people.auditor.person],
    });
    expect(
      proposal.value.departments.map((d) => [d.departmentId, d.seats, d.named]).sort(),
    ).toEqual(
      [
        [quality, 3, 1],
        [auditUnit, 3, 1],
      ].sort(),
    );
    expect(proposal.value.line.named).toBe(2);
    expect(proposal.value.people.map((p) => [p.personId, p.departmentId])).toEqual([
      [people.qualityHead.person, quality],
      [people.auditor.person, auditUnit],
    ]);
    const drafts = await coordinator.action(defs.createDraftSessionsActionDefinition())({
      lineId: line.id,
      sessions: proposal.value.proposal.sessions.map((s) => ({
        month: s.month,
        branchId: s.branchId,
        seats: s.seats,
        personIds: [...s.personIds],
      })),
    });
    if (!drafts.ok) throw new Error(JSON.stringify(drafts.error));
    expect(drafts.value.sessions.map((s) => s.participants)).toEqual([1, 1]);
    const planned = (await ownerDb.execute(sql`
      select person_id::text as person, department_id::text as department from tms.session_participants
      where plan_line_id = ${line.id}::uuid order by person_id`)) as unknown as {
      person: string;
      department: string;
    }[];
    expect(planned).toEqual(
      [
        { person: people.qualityHead.person, department: quality },
        { person: people.auditor.person, department: auditUnit },
      ].sort((a, b) => a.person.localeCompare(b.person)),
    );

    // A draft offers the line's people once each.
    const [first] = drafts.value.sessions;
    if (!first) throw new Error('a draft');
    const detail = await coordinator.query(defs.draftSessionQueryDefinition())({
      sessionId: first.id,
    });
    if (!detail.ok) throw new Error(detail.error.code);
    expect(detail.value.candidates).toHaveLength(1);
    expect(detail.value.unnamedSeats).toEqual(
      expect.arrayContaining([
        { departmentId: quality, seats: 2 },
        { departmentId: auditUnit, seats: 2 },
      ]),
    );
    expect(detail.value.unnamedSeats).toHaveLength(2);
  });
});

function addMonth(month: string): string {
  const [y = 0, m = 1] = month.split('-').map(Number);
  const next = m === 12 ? [y + 1, 1] : [y, m + 1];
  return `${String(next[0]).padStart(4, '0')}-${String(next[1]).padStart(2, '0')}`;
}
