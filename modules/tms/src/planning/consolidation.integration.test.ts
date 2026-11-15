/**
 * The training plan end to end against PostgreSQL (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06, FR-IAM-08): the real
 * definitions, the production runtime's parts (grants from role assignments — a custom role limited to a unit
 * included —, audit events) and withUserTx as app_server, so the repositories' SQL, row-level security, the
 * guards and private.training_plan_units all run. Two organizations. The heads submit; the L&D Manager closes the
 * needs early and builds the plan; lines are costed, merged, left out; a department-limited L&D Manager changes
 * its own line and never the shared one; a department returned during consolidation resubmits and its new need
 * is added — and a need whose topic changed moves to a line of its own, out of a merged line (M2); the Training
 * Coordinator reads; the other organization sees nothing. «Close needs now» and a head's recall at the same moment
 * never leave a closed cycle with a department that is not submitted (M3, two connections).
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
import * as plan from './consolidation-definitions';
import * as cycles from './definitions';
import * as needs from './needs-definitions';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)('the training plan against PostgreSQL', () => {
  const ownerDb = createDatabase(ownerUrl ?? '', { max: 1 });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  // A second connection, for a transaction kept open while another runs (M3).
  const secondDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const withSecondTx = createWithUserTx(() => secondDb);
  const id = () => randomUUID();
  const tenant = id();
  const other = id();
  const dept = { sales: id(), hr: id() };
  const customRole = { id: id(), code: `custom_${randomUUID().replace(/-/g, '').slice(0, 12)}` };
  const member = (role: string | null, tenantId = tenant, scopeUnitId: string | null = null) => ({
    person: id(),
    user: id(),
    session: id(),
    role,
    tenantId,
    scopeUnitId,
  });
  const people = {
    lnd: member('training_manager'),
    coordinator: member('training_coordinator'),
    salesHead: member('department_head'),
    hrHead: member('department_head'),
    salesPlanner: member(customRole.code, tenant, dept.sales),
    employee: member('learner'),
    otherLnd: member('training_manager', other),
  };

  /** Errors defineAction logged as internal (none expected). */
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
      getClaims: () => {
        const claims = brandVerifiedClaims({
          sub: m.user,
          role: 'authenticated',
          aal: 'aal1',
          session_id: m.session,
          tenant_id: m.tenantId,
          person_id: m.person,
        });
        if (!claims.ok) throw new Error('bad fixture');
        return Promise.resolve(ok(claims.value));
      },
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
      (${tenant}, ${`tp-a-${tenant.slice(0, 8)}`}, 'أ', 'active'),
      (${other}, ${`tp-b-${other.slice(0, 8)}`}, 'ب', 'active')`);
    await run(sql`insert into platform.departments (id, tenant_id, code, name_ar, name_en) values
      (${dept.sales}, ${tenant}, 'SAL', 'المبيعات', 'Sales'),
      (${dept.hr}, ${tenant}, 'HR', 'الموارد البشرية', 'Human resources')`);
    await run(sql`insert into platform.custom_roles (id, tenant_id, code, name_en, name_ar, data_scope)
      values (${customRole.id}, ${tenant}, ${customRole.code}, 'L&D – Sales', 'التعلم – المبيعات', 'departments')`);
    await run(sql`insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code) values
      (${tenant}, ${customRole.id}, 'tms.training_plan.read'),
      (${tenant}, ${customRole.id}, 'tms.training_plan.manage')`);
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
        await run(sql`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary, scope_unit_id)
          select tenant_id, id, ${m.role}, true, ${m.scopeUnitId}::uuid
          from platform.tenant_memberships where user_id = ${m.user}`);
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

  it('builds the plan from the submitted needs and keeps every planner within its scope', async () => {
    const lnd = as(people.lnd);
    const list = await lnd.query(cycles.planCyclesListQueryDefinition())({});
    if (!list.ok || !list.value.setup) throw new Error('the L&D Manager gets the set-up choices');
    const defaults = list.value.setup.defaults;
    const created = await lnd.action(cycles.createPlanCycleActionDefinition())({
      nameAr: null,
      nameEn: 'Plan 2027',
      ...defaults,
      departmentIds: [dept.sales, dept.hr],
    });
    if (!created.ok) throw new Error(created.error.code);
    const cycleId = created.value.id;
    const launched = await lnd.action(cycles.launchPlanCycleActionDefinition())({
      id: cycleId,
      version: created.value.version,
    });
    if (!launched.ok) throw new Error(launched.error.code);

    // Before the needs close: the plan cannot be built, not even early.
    const early = await lnd.action(plan.openConsolidationActionDefinition())({ cycleId });
    expect(!early.ok && early.error.code).toBe('TRAINING_PLAN_NOT_READY');

    // The heads enter their needs (the default form's «Preferred quarter»: Q2) and submit.
    const enter = async (
      head: ReturnType<typeof member>,
      departmentId: string,
      entries: readonly [string, number][],
    ) => {
      const actor = as(head);
      const view = await actor.query(needs.departmentNeedsQueryDefinition())({
        cycleId,
        departmentId,
      });
      if (!view.ok) throw new Error(view.error.code);
      const quarter = view.value.form?.moreFields.find((f) =>
        f.options.some((o) => o.value === 'q2'),
      );
      if (!quarter) throw new Error('the default form asks for the quarter');
      for (const [topic, peopleCount] of entries) {
        const added = await actor.action(needs.addNeedActionDefinition())({
          cycleId,
          departmentId,
          topic,
          courseId: null,
          peopleCount,
          personIds: [],
          estimatedCost: '',
          answers: { [quarter.id]: 'q2' },
        });
        if (!added.ok) throw new Error(added.error.code);
      }
      const fresh = await actor.query(needs.departmentNeedsQueryDefinition())({
        cycleId,
        departmentId,
      });
      if (!fresh.ok) throw new Error(fresh.error.code);
      const submitted = await actor.action(needs.submitNeedsActionDefinition())({
        cycleId,
        departmentId,
        version: fresh.value.department.version,
      });
      if (!submitted.ok) throw new Error(submitted.error.code);
    };
    await enter(people.salesHead, dept.sales, [
      ['Excel – advanced formulas', 20],
      ['Leadership', 5],
    ]);
    await enter(people.hrHead, dept.hr, [['excel advanced formulas!', 15]]);

    // Only the organization-wide L&D Manager closes the needs and builds the plan.
    for (const who of [people.coordinator, people.salesPlanner, people.employee]) {
      const refused = await as(who).action(plan.openConsolidationActionDefinition())({ cycleId });
      expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    }
    const before = await lnd.query(plan.planQueryDefinition())({ cycleId });
    expect(before.ok && before.value.readiness).toEqual({ ready: true, closeEarly: true });
    expect(before.ok && before.value.can.open).toBe(true);
    const opened = await lnd.action(plan.openConsolidationActionDefinition())({ cycleId });
    if (!opened.ok) throw new Error(opened.error.code);
    expect(opened.value).toMatchObject({ lines: 2, needs: 3, closedEarly: true });
    const planId = opened.value.planId;
    const again = await lnd.action(plan.openConsolidationActionDefinition())({ cycleId });
    expect(!again.ok && again.error.code).toBe('TRAINING_PLAN_ALREADY_OPEN');

    const view = await lnd.query(plan.planQueryDefinition())({ cycleId });
    if (!view.ok) throw new Error(view.error.code);
    const excel = view.value.lines.find((l) => l.title === 'Excel – advanced formulas');
    const leadership = view.value.lines.find((l) => l.title === 'Leadership');
    if (!excel || !leadership) throw new Error('two lines');
    expect(excel).toMatchObject({ people: 35, quarter: 2, cost: null, canEdit: true });
    expect(view.value.attention.uncostedLineIds).toHaveLength(2);

    // Costing the shared line: 35 people, 8–20 → 2 sessions of 18 and 17; SAR 10,000 split by seats.
    const costed = await lnd.action(plan.updatePlanLineActionDefinition())({
      lineId: excel.id,
      version: excel.version,
      minPerSession: 8,
      maxPerSession: 20,
      costPerSession: '5000',
    });
    if (!costed.ok) throw new Error(costed.error.code);
    const afterCost = await lnd.query(plan.planQueryDefinition())({ cycleId });
    if (!afterCost.ok) throw new Error(afterCost.error.code);
    expect(afterCost.value.lines.find((l) => l.id === excel.id)).toMatchObject({
      sessions: { sessions: 2, sizes: [18, 17] },
      cost: '10000',
      departments: [
        { departmentId: dept.sales, seats: 20, share: '5714.29' },
        { departmentId: dept.hr, seats: 15, share: '4285.71' },
      ],
    });

    // The department-limited L&D Manager for Sales: both lines (they hold Sales needs), Sales' budget only; it
    // changes its own line and never the one shared with HR.
    const salesPlanner = as(people.salesPlanner);
    const limited = await salesPlanner.query(plan.planQueryDefinition())({ cycleId });
    if (!limited.ok) throw new Error(limited.error.code);
    expect(limited.value.scope).toBe('departments');
    expect(limited.value.budget.departments.map((d) => d.departmentId)).toEqual([dept.sales]);
    expect(limited.value.lines.map((l) => [l.title, l.canEdit])).toEqual([
      ['Excel – advanced formulas', false],
      ['Leadership', true],
    ]);
    expect(limited.value.lines[0]?.needs.map((n) => n.departmentId)).toEqual([dept.sales]);
    const shared = await salesPlanner.action(plan.updatePlanLineActionDefinition())({
      lineId: excel.id,
      version: costed.value.version,
      quarter: 4,
    });
    expect(!shared.ok && shared.error.code).toBe('TRAINING_PLAN_LINE_OUTSIDE_SCOPE');
    const own = await salesPlanner.action(plan.updatePlanLineActionDefinition())({
      lineId: leadership.id,
      version: leadership.version,
      maxPerSession: 10,
      costPerSession: '1200',
    });
    if (!own.ok) throw new Error(own.error.code);
    const hrReason = await salesPlanner.action(plan.setBudgetReasonActionDefinition())({
      planId,
      departmentId: dept.hr,
      reason: 'Not mine',
    });
    expect(!hrReason.ok && hrReason.error.code).toBe('FORBIDDEN');
    const salesReason = await salesPlanner.action(plan.setBudgetReasonActionDefinition())({
      planId,
      departmentId: dept.sales,
      reason: 'New branch opening',
    });
    if (!salesReason.ok) throw new Error(salesReason.error.code);

    // The coordinator reads, changes nothing; another organization sees nothing.
    const coordinator = as(people.coordinator);
    const read = await coordinator.query(plan.planQueryDefinition())({ cycleId });
    expect(read.ok && read.value.can.manage).toBe(false);
    const refused = await coordinator.action(plan.updatePlanLineActionDefinition())({
      lineId: excel.id,
      version: costed.value.version,
      quarter: 4,
    });
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    const foreign = await as(people.otherLnd).query(plan.planQueryDefinition())({ cycleId });
    expect(!foreign.ok && foreign.error.code).toBe('NOT_FOUND');
    const foreignChange = await as(people.otherLnd).action(plan.updatePlanLineActionDefinition())({
      lineId: excel.id,
      version: costed.value.version,
      quarter: 4,
    });
    expect(!foreignChange.ok && foreignChange.error.code).toBe('NOT_FOUND');

    // «Return for changes» during consolidation: Sales reopens until today, adds a need and resubmits.
    const salesRow = afterCost.value.departments.find((d) => d.id === dept.sales);
    const returned = await lnd.action(needs.returnNeedsActionDefinition())({
      cycleId,
      departmentId: dept.sales,
      version: salesRow?.version ?? 0,
      note: 'Add the coaching you mentioned',
      deadline: afterCost.value.today,
    });
    if (!returned.ok) throw new Error(returned.error.code);
    await enter(people.salesHead, dept.sales, [['Coaching', 3]]);
    const pending = await lnd.query(plan.planQueryDefinition())({ cycleId });
    expect(pending.ok && pending.value.attention.pending).toMatchObject({
      needs: 1,
      departmentIds: [dept.sales],
    });
    const synced = await lnd.action(plan.syncPlanNeedsActionDefinition())({ planId });
    expect(synced.ok && synced.value).toMatchObject({ added: 1, newLines: 1 });

    // Merge Leadership into Excel; leave Coaching out with a reason.
    const current = await lnd.query(plan.planQueryDefinition())({ cycleId });
    if (!current.ok) throw new Error(current.error.code);
    const line = (title: string) => {
      const found = current.value.lines.find((l) => l.title === title);
      if (!found) throw new Error(title);
      return found;
    };
    const merged = await lnd.action(plan.mergePlanLinesActionDefinition())({
      lines: [
        {
          id: line('Excel – advanced formulas').id,
          version: line('Excel – advanced formulas').version,
        },
        { id: line('Leadership').id, version: line('Leadership').version },
      ],
      intoLineId: line('Excel – advanced formulas').id,
      title: 'Excel and leadership',
    });
    if (!merged.ok) throw new Error(merged.error.code);
    const leftOut = await lnd.action(plan.leaveOutPlanLineActionDefinition())({
      lineId: line('Coaching').id,
      version: line('Coaching').version,
      reason: 'Covered by the mentoring programme',
    });
    if (!leftOut.ok) throw new Error(leftOut.error.code);
    const final = await lnd.query(plan.planQueryDefinition())({ cycleId });
    if (!final.ok) throw new Error(final.error.code);
    expect(final.value.lines.map((l) => [l.title, l.people, l.status])).toEqual([
      ['Excel and leadership', 40, 'in_plan'],
      ['Coaching', 3, 'left_out'],
    ]);
    expect(final.value.budget.departments.find((d) => d.departmentId === dept.sales)?.reason).toBe(
      'New branch opening',
    );

    // M2: HR is returned and changes its Excel need to «Negotiation»; once it resubmits, «Add them» moves that
    // need out of the merged line into a line of its own — the merged line keeps Sales' Excel and Leadership.
    const hrRow = final.value.departments.find((d) => d.id === dept.hr);
    const hrReturned = await lnd.action(needs.returnNeedsActionDefinition())({
      cycleId,
      departmentId: dept.hr,
      version: hrRow?.version ?? 0,
      note: 'Excel is covered — what else?',
      deadline: final.value.today,
    });
    if (!hrReturned.ok) throw new Error(hrReturned.error.code);
    const hrHead = as(people.hrHead);
    const hrView = await hrHead.query(needs.departmentNeedsQueryDefinition())({
      cycleId,
      departmentId: dept.hr,
    });
    if (!hrView.ok) throw new Error(hrView.error.code);
    expect(hrView.value.entryOpen).toBe(true);
    const hrNeed = hrView.value.needs[0];
    if (!hrNeed) throw new Error('HR has its need');
    const renamed = await hrHead.action(needs.updateNeedActionDefinition())({
      cycleId,
      departmentId: dept.hr,
      needId: hrNeed.id,
      version: hrNeed.version,
      topic: 'Negotiation',
      courseId: null,
      peopleCount: hrNeed.peopleCount,
      personIds: [],
      estimatedCost: '',
      answers: hrNeed.answers,
    });
    if (!renamed.ok) throw new Error(renamed.error.code);
    const hrFresh = await hrHead.query(needs.departmentNeedsQueryDefinition())({
      cycleId,
      departmentId: dept.hr,
    });
    if (!hrFresh.ok) throw new Error(hrFresh.error.code);
    const resubmitted = await hrHead.action(needs.submitNeedsActionDefinition())({
      cycleId,
      departmentId: dept.hr,
      version: hrFresh.value.department.version,
    });
    if (!resubmitted.ok) throw new Error(resubmitted.error.code);
    // Resubmitted during consolidation: the head's entry is closed again, whatever its deadline (L7).
    const hrAfter = await hrHead.query(needs.departmentNeedsQueryDefinition())({
      cycleId,
      departmentId: dept.hr,
    });
    expect(hrAfter.ok && hrAfter.value.entryOpen).toBe(false);
    const changed = await lnd.query(plan.planQueryDefinition())({ cycleId });
    expect(changed.ok && changed.value.attention.pending).toEqual({
      needs: 0,
      changed: 1,
      departmentIds: [dept.hr],
    });
    const regrouped = await lnd.action(plan.syncPlanNeedsActionDefinition())({ planId });
    expect(regrouped.ok && regrouped.value).toMatchObject({
      added: 0,
      regrouped: 1,
      newLines: 1,
      removedLines: 0,
    });
    const afterRegroup = await lnd.query(plan.planQueryDefinition())({ cycleId });
    if (!afterRegroup.ok) throw new Error(afterRegroup.error.code);
    expect(afterRegroup.value.lines.map((l) => [l.title, l.people, l.status])).toEqual([
      ['Excel and leadership', 25, 'in_plan'],
      ['Coaching', 3, 'left_out'],
      ['Negotiation', 15, 'in_plan'],
    ]);
    expect(afterRegroup.value.attention.pending).toEqual({
      needs: 0,
      changed: 0,
      departmentIds: [],
    });

    const audited = await ownerDb.execute<{ action: string }>(sql`
      select action from platform.audit_events
      where tenant_id = ${tenant} and action like 'tms.training_plan.%' order by occurred_at, id`);
    expect(audited.map((a) => a.action)).toEqual([
      'tms.training_plan.opened',
      'tms.training_plan.line_changed',
      'tms.training_plan.line_changed',
      'tms.training_plan.budget_reason_changed',
      'tms.training_plan.needs_added',
      'tms.training_plan.lines_merged',
      'tms.training_plan.line_left_out',
      'tms.training_plan.needs_added',
    ]);
  });

  it('never closes the needs while a head recalls a submission at the same moment (M3)', async () => {
    const lnd = as(people.lnd);
    const list = await lnd.query(cycles.planCyclesListQueryDefinition())({});
    if (!list.ok || !list.value.setup) throw new Error('the L&D Manager gets the set-up choices');
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
      peopleCount: 4,
      personIds: [],
      estimatedCost: '',
      answers: {},
    });
    if (!added.ok) throw new Error(added.error.code);
    const submit = async () => {
      const view = await head.query(needs.departmentNeedsQueryDefinition())({
        cycleId,
        departmentId: dept.sales,
      });
      if (!view.ok) throw new Error(view.error.code);
      const submitted = await head.action(needs.submitNeedsActionDefinition())({
        cycleId,
        departmentId: dept.sales,
        version: view.value.department.version,
      });
      if (!submitted.ok) throw new Error(submitted.error.code);
    };
    await submit();
    const state = async () => {
      const [row] = await ownerDb.execute<{ cycle: string; department: string }>(sql`
        select c.status as cycle, d.status as department
        from tms.plan_cycles c join tms.plan_cycle_departments d on d.tenant_id = c.tenant_id and d.cycle_id = c.id
        where c.id = ${cycleId}::uuid`);
      return row;
    };
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });

    // 1. The head's recall is in flight (not committed) when the L&D Manager presses «Close needs now»: the close
    //    waits for it, then sees the department is no longer submitted and refuses.
    const recall = withSecondTx(claimsOf(people.salesHead), async (tx) => {
      await tx.execute(sql`
        update tms.plan_cycle_departments set status = 'draft'
        where cycle_id = ${cycleId}::uuid and department_id = ${dept.sales}::uuid`);
      started();
      await held;
    });
    await ready;
    let closeDone = false;
    const close = lnd
      .action(plan.openConsolidationActionDefinition())({ cycleId })
      .then((r) => {
        closeDone = true;
        return r;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(closeDone).toBe(false);
    release();
    await recall;
    const closed = await close;
    expect(!closed.ok && closed.error.code).toBe('TRAINING_PLAN_NOT_READY');
    expect(await state()).toEqual({ cycle: 'open', department: 'draft' });

    // 2. The other way round: the close is in flight when the head recalls — the recall waits, then finds the
    //    needs closed and changes nothing.
    await submit();
    let releaseClose: () => void = () => undefined;
    const holdClose = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    let closing: () => void = () => undefined;
    const closingStarted = new Promise<void>((resolve) => {
      closing = resolve;
    });
    const closeNow = withSecondTx(claimsOf(people.lnd), async (tx) => {
      await tx.execute(
        sql`update tms.plan_cycles set status = 'closed' where id = ${cycleId}::uuid`,
      );
      closing();
      await holdClose;
    });
    await closingStarted;
    const view = await head.query(needs.departmentNeedsQueryDefinition())({
      cycleId,
      departmentId: dept.sales,
    });
    if (!view.ok) throw new Error(view.error.code);
    let recallDone = false;
    const late = head
      .action(needs.recallNeedsActionDefinition())({
        cycleId,
        departmentId: dept.sales,
        version: view.value.department.version,
      })
      .then((r) => {
        recallDone = true;
        return r;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(recallDone).toBe(false);
    releaseClose();
    await closeNow;
    const refused = await late;
    expect(refused.ok).toBe(false);
    expect(await state()).toEqual({ cycle: 'closed', department: 'submitted' });
  });
});
