/**
 * Planning cycles end to end against PostgreSQL (EP-PLN, T-M3-04): the real definitions, the production
 * runtime (grants from role assignments, audit events) and withUserTx as app_server — so the repository's
 * SQL, row-level security, the manage-permission policies and the state guard all run. Two organizations;
 * the L&D Manager sets up and launches a cycle, the Training Coordinator reads, nobody crosses tenants.
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
import * as defs from './definitions';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)('planning cycles against PostgreSQL', () => {
  const ownerDb = createDatabase(ownerUrl ?? '', { max: 1 });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const id = () => randomUUID();
  const tenant = id();
  const other = id();
  const dept = { sales: id(), east: id(), ops: id(), foreign: id() };
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
    hr: member('hr_manager'),
    cfo: member('learner'),
    gm: member('learner'),
    head: member('department_head'),
    otherLnd: member('training_manager', other),
  };

  /** Errors defineAction logged as internal (none expected). */
  const unexpected: unknown[] = [];
  const as = (m: ReturnType<typeof member>) => {
    // The production runtime's parts (default-runtime.ts): grants from role assignments, real audit events.
    const runtime: ActionRuntime<UserTx> = {
      loadSessionFacts: (tx) => loadSessionFacts(tx),
      loadGrants: async (tx) => {
        const facts = await loadMemberAuthorizationFacts(tx);
        return grantsForAssignments(
          facts.roles.map((role) => ({ roleCode: role.roleCode })),
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
      (${tenant}, ${`pln-a-${tenant.slice(0, 8)}`}, 'أ', 'active'),
      (${other}, ${`pln-b-${other.slice(0, 8)}`}, 'ب', 'active')`);
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
    // Two levels of structure (EP-ORG: a new organization starts with one; no unit below the last level).
    await run(sql`insert into platform.structure_levels (tenant_id, ordinal, name_en, name_ar)
      values (${tenant}, 2, 'Section', 'قسم')`);
    await run(sql`insert into platform.departments (id, tenant_id, code, name_ar, name_en, head_person_id) values
      (${dept.sales}, ${tenant}, 'SAL', 'المبيعات', 'Sales', ${people.head.person}),
      (${dept.ops}, ${tenant}, 'OPS', 'العمليات', 'Operations', null),
      (${dept.foreign}, ${other}, 'X', 'خارجي', 'Foreign', null)`);
    await run(sql`insert into platform.departments (id, tenant_id, code, name_ar, parent_id)
      values (${dept.east}, ${tenant}, 'SAL-E', 'الشرق', ${dept.sales})`);
  });

  afterAll(async () => {
    expect(unexpected).toEqual([]);
    await ownerDb.$client.end();
    await serverDb.$client.end();
  });

  it('the L&D Manager sets up, launches and extends a cycle; the coordinator follows its progress', async () => {
    const lnd = as(people.lnd);
    const fresh = await lnd.query(defs.newPlanCycleQueryDefinition())({});
    if (!fresh.ok) throw new Error(fresh.error.code);
    const { today } = fresh.value;
    const created = await lnd.action(defs.createPlanCycleActionDefinition())({
      nameAr: 'خطة السنة القادمة',
      nameEn: 'Next year plan',
      periodStart: fresh.value.defaults.periodStart,
      periodEnd: fresh.value.defaults.periodEnd,
      deadline: fresh.value.defaults.deadline,
      instructionsEn: 'Tell us what your team needs.',
    });
    if (!created.ok) throw new Error(created.error.code);
    const cycleId = created.value.id;
    let version = created.value.version;

    const scope = await lnd.action(defs.savePlanCycleScopeActionDefinition())({
      id: cycleId,
      version,
      departmentIds: [dept.sales, dept.ops],
      branchIds: [],
    });
    if (!scope.ok) throw new Error(scope.error.code);
    expect(scope.value.departmentCount).toBe(3);
    version = scope.value.version;

    const stale = await lnd.action(defs.savePlanCycleRemindersActionDefinition())({
      id: cycleId,
      version: version - 1,
      reminderDays: [3],
    });
    expect(!stale.ok && stale.error.code).toBe('CONFLICT_VERSION');

    const budgets = await lnd.action(defs.savePlanCycleBudgetsActionDefinition())({
      id: cycleId,
      version,
      budgets: [
        { departmentId: dept.sales, amount: '120000' },
        { departmentId: dept.east, amount: '' },
      ],
    });
    if (!budgets.ok) throw new Error(budgets.error.code);
    version = budgets.value.version;

    // The default chain has no named people yet: not ready.
    const early = await lnd.action(defs.launchPlanCycleActionDefinition())({
      id: cycleId,
      version,
    });
    expect(!early.ok && early.error.code).toBe('PLAN_CYCLE_NOT_READY');

    const steps = await lnd.action(defs.savePlanCycleStepsActionDefinition())({
      id: cycleId,
      version,
      steps: [
        {
          kind: 'department_heads',
          nameAr: 'رؤساء الأقسام',
          nameEn: 'Department Heads',
          approverPersonId: null,
        },
        {
          kind: 'person',
          nameAr: 'اعتماد المالية',
          nameEn: 'Finance approval',
          approverPersonId: people.cfo.person,
        },
        {
          kind: 'person',
          nameAr: 'اعتماد الإدارة',
          nameEn: 'Management approval',
          approverPersonId: people.gm.person,
        },
      ],
    });
    if (!steps.ok) throw new Error(steps.error.code);
    version = steps.value.version;

    const foreignApprover = await lnd.action(defs.savePlanCycleStepsActionDefinition())({
      id: cycleId,
      version,
      steps: [
        { kind: 'person', nameAr: 'م', nameEn: 'F', approverPersonId: people.otherLnd.person },
      ],
    });
    expect(!foreignApprover.ok && foreignApprover.error.fieldErrors).toEqual([
      { path: 'steps.0.approverPersonId', code: 'NOT_A_MEMBER' },
    ]);

    const reminders = await lnd.action(defs.savePlanCycleRemindersActionDefinition())({
      id: cycleId,
      version,
      reminderDays: [2, 10],
    });
    if (!reminders.ok) throw new Error(reminders.error.code);
    version = reminders.value.version;

    const draft = await lnd.query(defs.planCycleQueryDefinition())({ id: cycleId });
    if (!draft.ok) throw new Error(draft.error.code);
    expect(draft.value.problems).toEqual([]);
    expect(draft.value.cycle.reminderDays).toEqual([10, 2]);
    expect(draft.value.cycle.currency).toBe('SAR');
    expect(
      draft.value.departments.map((d) => [d.name.en, d.budgetAmount, d.head?.via?.en ?? null]),
    ).toEqual([
      // Tree order: siblings by Arabic name (العمليات before المبيعات), sub-units under their parent.
      ['Operations', null, null],
      ['Sales', '120000', null],
      [null, null, 'Sales'],
    ]);
    expect(draft.value.withoutHead).toBe(1);

    // Coordinator: reads, never writes (403 by permission before the database is asked).
    const coordinator = as(people.coordinator);
    const tryLaunch = await coordinator.action(defs.launchPlanCycleActionDefinition())({
      id: cycleId,
      version,
    });
    expect(!tryLaunch.ok && tryLaunch.error.code).toBe('FORBIDDEN');

    const launched = await lnd.action(defs.launchPlanCycleActionDefinition())({
      id: cycleId,
      version,
    });
    if (!launched.ok) throw new Error(launched.error.code);
    version = launched.value.version;

    const progress = await coordinator.query(defs.planCycleQueryDefinition())({ id: cycleId });
    if (!progress.ok) throw new Error(progress.error.code);
    expect(progress.value.status).toBe('open');
    expect(progress.value.editable).toBe(false);
    expect(progress.value.departments.map((d) => d.status)).toEqual([
      'not_started',
      'not_started',
      'not_started',
    ]);

    // Launched: the set-up is fixed; only a later deadline.
    const rename = await lnd.action(defs.updatePlanCycleBasicsActionDefinition())({
      id: cycleId,
      version,
      nameAr: 'اسم آخر',
      nameEn: 'Other',
      periodStart: fresh.value.defaults.periodStart,
      periodEnd: fresh.value.defaults.periodEnd,
      deadline: fresh.value.defaults.deadline,
    });
    expect(!rename.ok && rename.error.code).toBe('PLAN_CYCLE_NOT_DRAFT');
    const extended = await lnd.action(defs.extendPlanCycleDeadlineActionDefinition())({
      id: cycleId,
      version,
      deadline: fresh.value.defaults.periodEnd,
    });
    if (!extended.ok) throw new Error(extended.error.code);
    expect(extended.value.before).toBe(fresh.value.defaults.deadline);

    // Q1: a second cycle cannot open while this one is open.
    const second = await lnd.action(defs.createPlanCycleActionDefinition())({
      nameAr: 'خطة ثانية',
      nameEn: 'Second plan',
      periodStart: fresh.value.defaults.periodStart,
      periodEnd: fresh.value.defaults.periodEnd,
      deadline: today,
    });
    if (!second.ok) throw new Error(second.error.code);
    const secondScope = await lnd.action(defs.savePlanCycleScopeActionDefinition())({
      id: second.value.id,
      version: second.value.version,
      departmentIds: [dept.ops],
      branchIds: [],
    });
    if (!secondScope.ok) throw new Error(secondScope.error.code);
    const blocked = await lnd.action(defs.launchPlanCycleActionDefinition())({
      id: second.value.id,
      version: secondScope.value.version,
    });
    expect(!blocked.ok && blocked.error.code).toBe('PLAN_CYCLE_OPEN_EXISTS');
    const removed = await lnd.action(defs.deletePlanCycleActionDefinition())({
      id: second.value.id,
      version: secondScope.value.version,
    });
    expect(removed.ok).toBe(true);
    const deleteLaunched = await lnd.action(defs.deletePlanCycleActionDefinition())({
      id: cycleId,
      version: extended.value.version,
    });
    expect(!deleteLaunched.ok && deleteLaunched.error.code).toBe('PLAN_CYCLE_NOT_DRAFT');

    const list = await coordinator.query(defs.planCyclesListQueryDefinition())({});
    if (!list.ok) throw new Error(list.error.code);
    expect(list.value.cycles.map((c) => [c.id, c.status, c.departmentCount])).toEqual([
      [cycleId, 'open', 3],
    ]);
    expect(list.value.canManage).toBe(false);

    // Every change was audited (BR-PLN-j).
    const audited = await ownerDb.execute<{ action: string }>(sql`
      select action from platform.audit_events where tenant_id = ${tenant} and entity_id = ${cycleId}
      order by occurred_at, action`);
    expect(new Set(audited.map((a) => a.action))).toEqual(
      new Set([
        'tms.plan_cycle.created',
        'tms.plan_cycle.scope_changed',
        'tms.plan_cycle.budgets_changed',
        'tms.plan_cycle.approval_chain_changed',
        'tms.plan_cycle.reminders_changed',
        'tms.plan_cycle.launched',
        'tms.plan_cycle.deadline_extended',
      ]),
    );

    // Another organization's L&D Manager never sees it; HR Manager and Department Head cannot read.
    const outsider = await as(people.otherLnd).query(defs.planCycleQueryDefinition())({
      id: cycleId,
    });
    expect(!outsider.ok && outsider.error.code).toBe('NOT_FOUND');
    const outsiderList = await as(people.otherLnd).query(defs.planCyclesListQueryDefinition())({});
    expect(outsiderList.ok && outsiderList.value.cycles).toEqual([]);
    const otherScope = await as(people.otherLnd).action(defs.savePlanCycleScopeActionDefinition())({
      id: cycleId,
      version: extended.value.version,
      departmentIds: [dept.foreign],
      branchIds: [],
    });
    expect(!otherScope.ok && otherScope.error.code).toBe('NOT_FOUND');
    for (const reader of [people.hr, people.head]) {
      const refused = await as(reader).query(defs.planCyclesListQueryDefinition())({});
      expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
    }
  });

  it('saves the planning settings; a new cycle copies them', async () => {
    const lnd = as(people.lnd);
    const saved = await lnd.action(defs.savePlanningSettingsActionDefinition())({
      reminderDays: [14, 3],
      steps: [
        {
          kind: 'person',
          nameAr: 'اعتماد المالية',
          nameEn: 'Finance approval',
          approverPersonId: people.cfo.person,
        },
      ],
    });
    if (!saved.ok) throw new Error(saved.error.code);
    const view = await lnd.query(defs.planningSettingsQueryDefinition())({});
    expect(view.ok && view.value.steps.map((s) => s.approverName?.en)).toEqual(['Person 3']);
    const fresh = await lnd.query(defs.newPlanCycleQueryDefinition())({});
    if (!fresh.ok) throw new Error(fresh.error.code);
    const created = await lnd.action(defs.createPlanCycleActionDefinition())({
      nameAr: 'خطة',
      nameEn: 'Plan',
      ...fresh.value.defaults,
    });
    if (!created.ok) throw new Error(created.error.code);
    const cycle = await lnd.query(defs.planCycleQueryDefinition())({ id: created.value.id });
    expect(cycle.ok && cycle.value.cycle.reminderDays).toEqual([14, 3]);
    expect(cycle.ok && cycle.value.steps.map((s) => s.approverPersonId)).toEqual([
      people.cfo.person,
    ]);
    const coordinator = await as(people.coordinator).action(
      defs.savePlanningSettingsActionDefinition(),
    )({
      reminderDays: [1],
      steps: [{ kind: 'department_heads', nameAr: 'ر', nameEn: 'H', approverPersonId: null }],
    });
    expect(!coordinator.ok && coordinator.error.code).toBe('FORBIDDEN');
  });
});
