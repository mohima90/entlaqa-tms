/**
 * The plan approval repository with a fake transaction (WP-LD-03): row mapping, the statements it sends (the state
 * the user saw is part of every WHERE — the first decision settles the step), and how the guard's refusals become
 * outcomes. approval.integration.test.ts runs the same functions against PostgreSQL.
 */
import type { UserTx } from '@jadarat/platform-db';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as repo from './approval-repository';

const dialect = new PgDialect();

function fakeTx(...results: (Record<string, unknown>[] | Error)[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: (query: SQL) => {
      executed.push(dialect.sqlToQuery(query));
      const next = results.shift() ?? [];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    transaction: <T>(fn: () => Promise<T>) => fn(),
  } as unknown as UserTx;
  return { tx, executed };
}

const pgError = (code: string, message = '') =>
  Object.assign(new Error('wrapped'), {
    cause: Object.assign(new Error(message), { code, message }),
  });

const PLAN = '77777777-7777-4777-8777-777777777777';
const CYCLE = '55555555-5555-4555-8555-555555555555';
const ME = '44444444-4444-4444-8444-444444444444';

const row = (over: Record<string, unknown> = {}) => ({
  id: PLAN,
  cycle_id: CYCLE,
  status: 'in_approval',
  plan_version: 1,
  approval_step: 'hr',
  finance_step: true,
  submitted_at: '2026-11-15T08:00:00Z',
  submitted_by: ME,
  hr_decided_at: null,
  hr_decided_by: null,
  decided_at: null,
  decided_by: null,
  send_back_comment: null,
  approved_at: null,
  approved_by: null,
  version: 4,
  ...over,
});

describe('reads', () => {
  it('maps where the approval stands', async () => {
    const { tx, executed } = fakeTx([row()]);
    expect(await repo.getApproval(tx, PLAN)).toMatchObject({
      id: PLAN,
      status: 'in_approval',
      approvalStep: 'hr',
      financeStep: true,
      submittedAt: new Date('2026-11-15T08:00:00Z'),
      submittedBy: ME,
      version: 4,
    });
    expect(executed[0]?.params).toEqual([PLAN]);
    expect(await repo.getApproval(fakeTx([]).tx, PLAN)).toBeNull();
    expect(await repo.getApprovalByCycle(fakeTx([row()]).tx, CYCLE)).toMatchObject({ id: PLAN });
    expect(await repo.getApprovalByCycle(fakeTx([]).tx, CYCLE)).toBeNull();
  });

  it('lists the plans with their cycle names', async () => {
    const { tx } = fakeTx([row({ cycle_name_ar: 'خطة', cycle_name_en: 'Plan 2027' })]);
    expect(await repo.listPlans(tx)).toMatchObject([
      { id: PLAN, cycleNameAr: 'خطة', cycleNameEn: 'Plan 2027' },
    ]);
  });

  it('maps the history, the versions and a version as approved', async () => {
    const at = '2026-11-15T09:00:00Z';
    expect(
      await repo.listEvents(
        fakeTx([
          {
            kind: 'sent_back',
            step: 'hr',
            plan_version: 1,
            actor_person_id: ME,
            comment: 'Why?',
            occurred_at: at,
          },
        ]).tx,
        PLAN,
      ),
    ).toEqual([
      {
        kind: 'sent_back',
        step: 'hr',
        planVersion: 1,
        actorPersonId: ME,
        comment: 'Why?',
        occurredAt: new Date(at),
      },
    ]);
    expect(
      await repo.listVersions(
        fakeTx([{ plan_version: 1, approved_at: at, approved_by: ME }]).tx,
        PLAN,
      ),
    ).toEqual([{ planVersion: 1, approvedAt: new Date(at), approvedBy: ME }]);
    const snapshot = {
      currency: 'SAR',
      lines: [
        {
          id: 'l1',
          title: 'Excel',
          courseId: null,
          deliveryType: 'classroom',
          category: null,
          quarter: 1,
          minPerSession: 8,
          maxPerSession: 20,
          costPerSession: '5000.0000',
          costPerPerson: null,
          durationHours: '6.50',
          status: 'in_plan',
          leftOutReason: null,
          sortOrder: 0,
          departments: [{ departmentId: 'd1', seats: 20, named: 2 }],
        },
        {
          id: 'l2',
          title: 'Odd',
          quarter: 2,
          status: 'left_out',
          leftOutReason: 'Not now',
          departments: 'x',
        },
      ],
      departments: [{ departmentId: 'd1', envelope: '7000.0000', reason: null }],
    };
    const version = await repo.getVersion(
      fakeTx([{ plan_version: 1, approved_at: at, approved_by: ME, snapshot }]).tx,
      PLAN,
      1,
    );
    expect(version?.currency).toBe('SAR');
    expect(version?.lines[0]).toMatchObject({
      durationHours: 6.5,
      departments: [{ seats: 20, named: 2 }],
    });
    expect(version?.lines[1]).toMatchObject({
      status: 'left_out',
      departments: [],
      minPerSession: null,
    });
    expect(version?.departments).toEqual([
      { departmentId: 'd1', envelope: '7000.0000', reason: null },
    ]);
    expect(await repo.getVersion(fakeTx([]).tx, PLAN, 9)).toBeNull();
    expect(repo.versionLines('nope')).toEqual([]);
  });

  it('reads the departments’ results, narrowed by cycle and department', async () => {
    const { tx, executed } = fakeTx([
      {
        cycle_id: CYCLE,
        department_id: 'd1',
        plan_version: 2,
        approved_at: '2026-11-16T09:00:00Z',
        cycle_name_ar: 'خطة',
        cycle_name_en: null,
        result: { currency: 'SAR', envelope: '7000', reason: 'Growth', lines: [] },
      },
    ]);
    expect(
      await repo.listDepartmentResults(tx, { cycleId: CYCLE, departmentId: 'd1' }),
    ).toMatchObject([
      {
        departmentId: 'd1',
        planVersion: 2,
        envelope: '7000',
        reason: 'Growth',
        currency: 'SAR',
        lines: [],
      },
    ]);
    expect(executed[0]?.params).toContain(CYCLE);
    expect(executed[0]?.sql).toContain('distinct on');
    expect(await repo.listDepartmentResults(fakeTx([]).tx)).toEqual([]);
  });

  it('reads the Finance switch and the submit problem', async () => {
    expect(await repo.financeConfirms(fakeTx([{ finance_confirms: true }]).tx)).toBe(true);
    expect(await repo.financeConfirms(fakeTx([]).tx)).toBe(false);
    expect(await repo.submitProblem(fakeTx([{ problem: 'uncosted' }]).tx, PLAN, CYCLE)).toBe(
      'uncosted',
    );
    expect(await repo.submitProblem(fakeTx([{ problem: null }]).tx, PLAN, CYCLE)).toBeNull();
  });
});

describe('moving the state', () => {
  it('names the state and version the user saw', async () => {
    const submit = fakeTx([row()]);
    expect(await repo.submitPlan(submit.tx, PLAN, 3)).toMatchObject({
      ok: true,
      value: { status: 'in_approval' },
    });
    expect(submit.executed[0]?.sql).toContain("status in ('draft', 'sent_back')");
    expect(submit.executed[0]?.params).toEqual([PLAN, 3]);

    const decide = fakeTx([row({ status: 'sent_back', approval_step: null })]);
    await repo.decidePlan(decide.tx, PLAN, 4, 'hr', 'send_back', 'Please');
    expect(decide.executed[0]?.sql).toContain("status = 'in_approval'");
    expect(decide.executed[0]?.sql).toContain('approval_step = $');
    expect(decide.executed[0]?.params).toEqual(['sent_back', 'Please', PLAN, 4, 'hr']);
    const approve = fakeTx([]);
    expect(await repo.decidePlan(approve.tx, PLAN, 4, 'finance', 'approve', 'ignored')).toEqual({
      ok: true,
      value: null,
    });
    expect(approve.executed[0]?.params).toEqual(['approved', null, PLAN, 4, 'finance']);

    const revise = fakeTx([row({ status: 'draft', plan_version: 2, approval_step: null })]);
    expect(await repo.revisePlan(revise.tx, PLAN, 7)).toMatchObject({
      ok: true,
      value: { planVersion: 2 },
    });
    expect(revise.executed[0]?.sql).toContain("status = 'approved'");
  });

  it('turns the guard’s refusals into outcomes', async () => {
    const cases: [Error, repo.ApprovalRefusal][] = [
      [
        pgError('JK010', 'the training plan cannot be submitted: over_budget'),
        { kind: 'not_ready', problem: 'over_budget' },
      ],
      [pgError('JK010', 'something else'), { kind: 'not_ready', problem: null }],
      [pgError('JK011'), { kind: 'own_submission' }],
      [pgError('JK012'), { kind: 'comment_required' }],
      [pgError('42501'), { kind: 'not_allowed' }],
      [pgError('JK001'), { kind: 'refused' }],
      [pgError('JK008'), { kind: 'refused' }],
    ];
    for (const [error, refusal] of cases) {
      expect(await repo.submitPlan(fakeTx(error).tx, PLAN, 1)).toEqual({ ok: false, refusal });
    }
    await expect(repo.revisePlan(fakeTx(pgError('XX000')).tx, PLAN, 1)).rejects.toThrow();
  });
});
