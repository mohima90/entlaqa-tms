/**
 * The training plan's approval end to end against PostgreSQL (WP-LD-03, T-M3-07; FR-PLN-08, FR-WFL-01/02 R1 part,
 * FR-IAM-07, FR-MGR-05): the real definitions, the production runtime's parts (grants from role assignments, audit
 * events) and withUserTx as app_server, so the repositories' SQL, row-level security, the plan's guard and the
 * approval trigger all run. Two organizations. The plan is built and costed; refused while a line has no cost;
 * submitted; sent back by an HR Manager with a comment; submitted again with «Finance confirms the plan» on;
 * approved by one HR Manager while a second one's decision is refused (the first settles the step); confirmed by
 * Finance; each head reads their department's result; the L&D Manager revises it into version 2. Nobody else
 * decides; the other organization sees nothing; every step is audited without the comment's words.
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
import * as approval from './approval-definitions';
import * as plan from './consolidation-definitions';
import * as cycles from './definitions';
import * as needs from './needs-definitions';
import { dbError } from './repository';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)('the training plan approval against PostgreSQL', () => {
  const ownerDb = createDatabase(ownerUrl ?? '', { max: 1 });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  // A second connection, for a transaction kept open while another runs (review H1).
  const secondDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const withSecondTx = createWithUserTx(() => secondDb);
  const id = () => randomUUID();
  const tenant = id();
  const other = id();
  const dept = { sales: id(), hr: id() };
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
    salesHead: member('department_head'),
    hrHead: member('department_head'),
    hrOne: member('hr_manager'),
    hrTwo: member('hr_manager'),
    finance: member('finance'),
    employee: member('learner'),
    otherHr: member('hr_manager', other),
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
      (${tenant}, ${`pa-a-${tenant.slice(0, 8)}`}, 'أ', 'active'),
      (${other}, ${`pa-b-${other.slice(0, 8)}`}, 'ب', 'active')`);
    await run(sql`insert into platform.departments (id, tenant_id, code, name_ar, name_en) values
      (${dept.sales}, ${tenant}, 'SAL', 'المبيعات', 'Sales'),
      (${dept.hr}, ${tenant}, 'HR', 'الموارد البشرية', 'Human resources')`);
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
        await run(sql`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
          select tenant_id, id, ${m.role}, true from platform.tenant_memberships where user_id = ${m.user}`);
      }
    }
    await run(
      sql`update platform.departments set head_person_id = ${people.salesHead.person} where id = ${dept.sales}`,
    );
    await run(
      sql`update platform.departments set head_person_id = ${people.hrHead.person} where id = ${dept.hr}`,
    );
  });

  afterAll(async () => {
    expect(unexpected).toEqual([]);
    await ownerDb.$client.end();
    await serverDb.$client.end();
    await secondDb.$client.end();
  });

  it('submits, sends back, approves by role, confirms for Finance, locks version 1 and revises', async () => {
    const lnd = as(people.lnd);
    const list = await lnd.query(cycles.planCyclesListQueryDefinition())({});
    if (!list.ok || !list.value.setup) throw new Error('set-up choices');
    const created = await lnd.action(cycles.createPlanCycleActionDefinition())({
      nameAr: null,
      nameEn: 'Plan 2027',
      ...list.value.setup.defaults,
      departmentIds: [dept.sales, dept.hr],
    });
    if (!created.ok) throw new Error(created.error.code);
    const cycleId = created.value.id;
    const launched = await lnd.action(cycles.launchPlanCycleActionDefinition())({
      id: cycleId,
      version: created.value.version,
    });
    if (!launched.ok) throw new Error(launched.error.code);
    for (const [head, departmentId, topic, count] of [
      [people.salesHead, dept.sales, 'Excel', 20],
      [people.hrHead, dept.hr, 'Excel', 10],
      [people.salesHead, dept.sales, 'Public speaking', 8],
    ] as const) {
      const added = await as(head).action(needs.addNeedActionDefinition())({
        cycleId,
        departmentId,
        topic,
        courseId: null,
        peopleCount: count,
        personIds: [],
        estimatedCost: '',
        answers: {},
      });
      if (!added.ok) throw new Error(added.error.code);
    }
    for (const [head, departmentId] of [
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

    // Not ready: no line has a cost yet.
    const state = async () => {
      const view = await lnd.query(approval.planApprovalQueryDefinition())({ cycleId });
      if (!view.ok || !view.value) throw new Error('approval view');
      return view.value;
    };
    expect((await state()).submitProblem).toBe('uncosted');
    const early = await lnd.action(approval.submitPlanActionDefinition())({
      planId,
      version: (await state()).plan.version,
    });
    expect(!early.ok && early.error.code).toBe('TRAINING_PLAN_NOT_SUBMITTABLE');
    expect(!early.ok && early.error.params).toEqual({ problem: 'uncosted' });

    // Cost Excel (30 people, max 15, SAR 3,000 a session → SAR 6,000), leave Public speaking out.
    const lines = await lnd.query(plan.planQueryDefinition())({ cycleId });
    if (!lines.ok) throw new Error(lines.error.code);
    const excel = lines.value.lines.find((l) => l.title === 'Excel');
    const speaking = lines.value.lines.find((l) => l.title === 'Public speaking');
    if (!excel || !speaking) throw new Error('two lines');
    const costed = await lnd.action(plan.updatePlanLineActionDefinition())({
      lineId: excel.id,
      version: excel.version,
      maxPerSession: 15,
      costPerSession: '3000',
    });
    if (!costed.ok) throw new Error(costed.error.code);
    const out = await lnd.action(plan.leaveOutPlanLineActionDefinition())({
      lineId: speaking.id,
      version: speaking.version,
      reason: 'Not a priority this year',
    });
    if (!out.ok) throw new Error(out.error.code);

    const ready = await state();
    expect(ready.submitProblem).toBeNull();
    expect(ready.can).toEqual({ submit: true, decide: null, revise: false });
    expect(ready.steps.hr.deciders.map((d) => d.personId).sort()).toEqual(
      [people.hrOne.person, people.hrTwo.person].sort(),
    );
    expect(ready.steps.finance).toMatchObject({
      state: 'off',
      deciders: [{ personId: people.finance.person }],
    });

    // Nobody but the organization-wide L&D Manager submits.
    for (const who of [people.coordinator, people.hrOne, people.finance, people.employee]) {
      const refused = await as(who).action(approval.submitPlanActionDefinition())({
        planId,
        version: ready.plan.version,
      });
      expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    }
    const submitted = await lnd.action(approval.submitPlanActionDefinition())({
      planId,
      version: ready.plan.version,
    });
    if (!submitted.ok) throw new Error(submitted.error.code);
    expect(submitted.value.financeStep).toBe(false);

    // Frozen: the line does not change.
    const frozen = await lnd.action(plan.updatePlanLineActionDefinition())({
      lineId: excel.id,
      version: costed.value.version,
      quarter: 4,
    });
    expect(!frozen.ok && frozen.error.code).toBe('TRAINING_PLAN_FROZEN');

    // The HR Manager's Approvals page and review; Finance, the coordinator and the head decide nothing.
    const hrOne = as(people.hrOne);
    const waiting = await hrOne.query(approval.approvalsQueryDefinition())({});
    if (!waiting.ok) throw new Error(waiting.error.code);
    expect(waiting.value.waiting).toBe(1);
    expect(waiting.value.items[0]?.summary).toMatchObject({
      lines: 1,
      leftOut: 1,
      people: 30,
      cost: '6000',
    });
    const review = await hrOne.query(approval.planApprovalQueryDefinition())({ cycleId });
    if (!review.ok || !review.value) throw new Error('review');
    expect(review.value.can.decide).toBe('hr');
    const reviewPlan = await hrOne.query(plan.planQueryDefinition())({ cycleId });
    expect(reviewPlan.ok && reviewPlan.value.lines.map((l) => l.title).sort()).toEqual([
      'Excel',
      'Public speaking',
    ]);
    expect(reviewPlan.ok && reviewPlan.value.can.manage).toBe(false);
    // Review M1: the plan with each department's seats, share and envelope — never the raw needs.
    if (!reviewPlan.ok) throw new Error(reviewPlan.error.code);
    expect(reviewPlan.value.budget.departments.map((d) => d.departmentId).sort()).toEqual(
      [dept.sales, dept.hr].sort(),
    );
    expect(reviewPlan.value.lines.find((l) => l.title === 'Excel')?.departments).toMatchObject([
      { departmentId: dept.sales, seats: 20, share: '4000' },
      { departmentId: dept.hr, seats: 10, share: '2000' },
    ]);
    expect(reviewPlan.value.lines.flatMap((l) => l.needs)).toEqual([]);
    const lndPlan = await lnd.query(plan.planQueryDefinition())({ cycleId });
    expect(lndPlan.ok && lndPlan.value.lines.flatMap((l) => l.needs).length).toBe(3);
    for (const who of [
      people.finance,
      people.coordinator,
      people.salesHead,
      people.employee,
      people.lnd,
    ]) {
      const refused = await as(who).action(approval.decidePlanActionDefinition())({
        planId,
        version: review.value.plan.version,
        step: 'hr',
        decision: 'approve',
      });
      expect(!refused.ok && refused.error.code).toMatch(/FORBIDDEN|TRAINING_PLAN_OWN_SUBMISSION/);
    }

    // Sent back with a comment; the L&D Manager reads it and submits again with Finance on.
    const back = await hrOne.action(approval.decidePlanActionDefinition())({
      planId,
      version: review.value.plan.version,
      step: 'hr',
      decision: 'send_back',
      comment: 'Please add the quarter for Excel.',
    });
    if (!back.ok) throw new Error(back.error.code);
    const afterBack = await state();
    expect(afterBack.plan).toMatchObject({
      status: 'sent_back',
      sendBackComment: 'Please add the quarter for Excel.',
      decidedBy: { personId: people.hrOne.person },
    });
    const settings = await lnd.action(cycles.savePlanningSettingsActionDefinition())({
      reminderDays: [7, 2],
      financeConfirms: true,
    });
    if (!settings.ok) throw new Error(settings.error.code);
    expect((await state()).steps.finance.state).toBe('not_started');
    const again = await lnd.action(approval.submitPlanActionDefinition())({
      planId,
      version: afterBack.plan.version,
    });
    if (!again.ok) throw new Error(again.error.code);
    expect(again.value.financeStep).toBe(true);

    // Two HR Managers decide on the same version: the first settles the step.
    const seen = await state();
    const first = await hrOne.action(approval.decidePlanActionDefinition())({
      planId,
      version: seen.plan.version,
      step: 'hr',
      decision: 'approve',
    });
    if (!first.ok) throw new Error(first.error.code);
    expect(first.value).toMatchObject({ status: 'in_approval', approvalStep: 'finance' });
    const second = await as(people.hrTwo).action(approval.decidePlanActionDefinition())({
      planId,
      version: seen.plan.version,
      step: 'hr',
      decision: 'send_back',
      comment: 'Too late',
    });
    expect(!second.ok && second.error.code).toBe('TRAINING_PLAN_ALREADY_DECIDED');

    // Finance confirms: approved, version 1 locked.
    const finance = as(people.finance);
    const financeReview = await finance.query(approval.planApprovalQueryDefinition())({ cycleId });
    if (!financeReview.ok || !financeReview.value) throw new Error('finance review');
    expect(financeReview.value.can.decide).toBe('finance');
    expect(financeReview.value.steps.hr).toMatchObject({
      state: 'done',
      decidedBy: { personId: people.hrOne.person },
    });
    const confirmed = await finance.action(approval.decidePlanActionDefinition())({
      planId,
      version: financeReview.value.plan.version,
      step: 'finance',
      decision: 'approve',
    });
    if (!confirmed.ok) throw new Error(confirmed.error.code);
    expect(confirmed.value.status).toBe('approved');
    const approved = await state();
    expect(approved.plan).toMatchObject({
      status: 'approved',
      planVersion: 1,
      approvedBy: { personId: people.finance.person },
    });
    expect(approved.versions.map((v) => v.planVersion)).toEqual([1]);
    expect(approved.events.map((e) => e.kind)).toEqual([
      'confirmed',
      'approved',
      'submitted',
      'sent_back',
      'submitted',
    ]);
    expect(approved.can).toEqual({ submit: false, decide: null, revise: true });
    const version = await lnd.query(approval.planVersionQueryDefinition())({
      cycleId,
      planVersion: 1,
    });
    expect(version.ok && version.value.total).toMatchObject({ people: 30, cost: '6000' });

    // Each head reads their department's result; the employee and the other organization read nothing.
    const sales = await as(people.salesHead).query(approval.departmentPlanResultQueryDefinition())({
      cycleId,
      departmentId: dept.sales,
    });
    if (!sales.ok || !sales.value) throw new Error('sales result');
    expect(sales.value.result.approved).toMatchObject([
      { seats: 20, share: '4000', sharedWith: [dept.hr] },
    ]);
    expect(sales.value.result.leftOut).toMatchObject([
      { seats: 8, line: { title: 'Public speaking', leftOutReason: 'Not a priority this year' } },
    ]);
    const salesOnHr = await as(people.salesHead).query(
      approval.departmentPlanResultQueryDefinition(),
    )({
      cycleId,
      departmentId: dept.hr,
    });
    expect(salesOnHr.ok && salesOnHr.value).toBeNull();
    const home = await as(people.hrHead).query(approval.myPlanResultsQueryDefinition())({});
    expect(home.ok && home.value.results).toMatchObject([
      { departmentId: dept.hr, approvedLines: 1, leftOutLines: 0 },
    ]);
    const employee = await as(people.employee).query(approval.approvalsQueryDefinition())({});
    expect(!employee.ok && employee.error.code).toBe('FORBIDDEN');
    const foreign = await as(people.otherHr).query(approval.approvalsQueryDefinition())({});
    expect(foreign.ok && foreign.value.items).toEqual([]);
    const foreignDecision = await as(people.otherHr).action(approval.decidePlanActionDefinition())({
      planId,
      version: 1,
      step: 'hr',
      decision: 'approve',
    });
    expect(!foreignDecision.ok && foreignDecision.error.code).toBe('NOT_FOUND');

    // Revise: version 2 is a draft; version 1 stays as approved.
    const revised = await lnd.action(approval.revisePlanActionDefinition())({
      planId,
      version: approved.plan.version,
    });
    if (!revised.ok) throw new Error(revised.error.code);
    expect(revised.value.planVersion).toBe(2);
    const draft = await state();
    expect(draft.plan).toMatchObject({ status: 'draft', planVersion: 2 });
    expect(draft.versions.map((v) => v.planVersion)).toEqual([1]);

    // Every step audited; the comment's words never.
    const audits = await ownerDb.execute<{ action: string; data: unknown }>(sql`
      select action, data from platform.audit_events
      where tenant_id = ${tenant} and action like 'tms.training_plan.%'
        and action in ('tms.training_plan.submitted', 'tms.training_plan.sent_back', 'tms.training_plan.approved',
                       'tms.training_plan.confirmed', 'tms.training_plan.revised')
      order by occurred_at, id`);
    expect(audits.map((a) => a.action)).toEqual([
      'tms.training_plan.submitted',
      'tms.training_plan.sent_back',
      'tms.training_plan.submitted',
      'tms.training_plan.approved',
      'tms.training_plan.confirmed',
      'tms.training_plan.revised',
    ]);
    expect(JSON.stringify(audits)).not.toContain('quarter for Excel');
    expect(audits[1]?.data).toMatchObject({ commentLength: 33 });
  });

  it('never lets a change of the plan slip past its submission at the same moment (review H1)', async () => {
    const lnd = as(people.lnd);
    const list = await lnd.query(cycles.planCyclesListQueryDefinition())({});
    if (!list.ok || !list.value.setup) throw new Error('set-up choices');
    const created = await lnd.action(cycles.createPlanCycleActionDefinition())({
      nameAr: null,
      nameEn: 'Plan 2028',
      ...list.value.setup.defaults,
      departmentIds: [dept.sales],
    });
    if (!created.ok) throw new Error(created.error.code);
    const cycleId = created.value.id;
    const launched = await lnd.action(cycles.launchPlanCycleActionDefinition())({
      id: cycleId,
      version: created.value.version,
    });
    if (!launched.ok) throw new Error(launched.error.code);
    const head = as(people.salesHead);
    const added = await head.action(needs.addNeedActionDefinition())({
      cycleId,
      departmentId: dept.sales,
      topic: 'Excel',
      courseId: null,
      peopleCount: 12,
      personIds: [],
      estimatedCost: '',
      answers: {},
    });
    if (!added.ok) throw new Error(added.error.code);
    const needsView = await head.query(needs.departmentNeedsQueryDefinition())({
      cycleId,
      departmentId: dept.sales,
    });
    if (!needsView.ok) throw new Error(needsView.error.code);
    const sent = await head.action(needs.submitNeedsActionDefinition())({
      cycleId,
      departmentId: dept.sales,
      version: needsView.value.department.version,
    });
    if (!sent.ok) throw new Error(sent.error.code);
    const opened = await lnd.action(plan.openConsolidationActionDefinition())({ cycleId });
    if (!opened.ok) throw new Error(opened.error.code);
    const planId = opened.value.planId;
    const lines = await lnd.query(plan.planQueryDefinition())({ cycleId });
    const excel = lines.ok ? lines.value.lines[0] : undefined;
    if (!excel) throw new Error('one line');
    const costed = await lnd.action(plan.updatePlanLineActionDefinition())({
      lineId: excel.id,
      version: excel.version,
      maxPerSession: 15,
      costPerSession: '2000',
    });
    if (!costed.ok) throw new Error(costed.error.code);
    const approvalOf = async () => {
      const view = await lnd.query(approval.planApprovalQueryDefinition())({ cycleId });
      if (!view.ok || !view.value) throw new Error('approval view');
      return view.value;
    };
    expect((await approvalOf()).submitProblem).toBeNull();
    const uncostedLine = sql`insert into tms.plan_lines (plan_id, cycle_id, group_key, title, quarter)
      values (${planId}::uuid, ${cycleId}::uuid, 'topic:late', 'Late', 1) returning id`;
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

    // 1. A line without a cost is being added (not committed yet) when the L&D Manager submits: the submit waits for
    //    it, then sees the line and refuses — the plan is never frozen with a line its checks did not see.
    const inserted = gate();
    const release = gate();
    const insert = withSecondTx(claimsOf(people.lnd), async (tx) => {
      const [row] = await tx.execute(uncostedLine);
      inserted.open();
      await release.passed;
      return String(row?.id);
    });
    await inserted.passed;
    const submit = settled(
      lnd.action(approval.submitPlanActionDefinition())({
        planId,
        version: (await approvalOf()).plan.version,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(submit.state.done).toBe(false);
    release.open();
    const lateLine = await insert;
    const refused = await submit.promise;
    expect(!refused.ok && refused.error.code).toBe('TRAINING_PLAN_NOT_SUBMITTABLE');
    expect(!refused.ok && refused.error.params).toEqual({ problem: 'uncosted' });
    expect((await approvalOf()).plan.status).toBe('draft');
    await withSecondTx(claimsOf(people.lnd), (tx) =>
      tx.execute(sql`delete from tms.plan_lines where id = ${lateLine}::uuid`),
    );

    // 2. The other way round: the submit is in flight (not committed) when a line without a cost is added — the
    //    insert waits for it, then finds the plan frozen (JK008) and adds nothing.
    const submitting = gate();
    const releaseSubmit = gate();
    const version = (await approvalOf()).plan.version;
    const submitNow = withSecondTx(claimsOf(people.lnd), async (tx) => {
      const rows = await tx.execute(sql`update tms.training_plans set status = 'in_approval'
        where id = ${planId}::uuid and version = ${version} returning id`);
      submitting.open();
      await releaseSubmit.passed;
      return rows.length;
    });
    await submitting.passed;
    const late = settled(
      withUserTx(claimsOf(people.lnd), (tx) => tx.execute(uncostedLine)).then(
        () => null,
        (error: unknown) => dbError(error)?.code ?? 'unknown',
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(late.state.done).toBe(false);
    releaseSubmit.open();
    expect(await submitNow).toBe(1);
    expect(await late.promise).toBe('JK008');
    const frozen = await approvalOf();
    expect(frozen.plan.status).toBe('in_approval');
    const [count] = await ownerDb.execute<{ n: number }>(
      sql`select count(*)::int as n from tms.plan_lines where plan_id = ${planId}::uuid`,
    );
    expect(count?.n).toBe(1);
  });
});
