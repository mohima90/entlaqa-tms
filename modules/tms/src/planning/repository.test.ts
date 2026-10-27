/**
 * The planning repository with a fake transaction: row mapping, the statements it sends (parameters, never
 * values spliced into SQL) and how database refusals become outcomes. planning.integration.test.ts runs
 * the same functions against PostgreSQL.
 */
import type { UserTx } from '@jadarat/platform-db';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAIN } from './rules';
import * as repo from './repository';

const dialect = new PgDialect();

/** Answers each statement with the next result (an Error is thrown instead). */
function fakeTx(...results: (Record<string, unknown>[] | Error)[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: (query: SQL) => {
      executed.push(dialect.sqlToQuery(query));
      const next = results.shift() ?? [];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  } as unknown as UserTx;
  return { tx, executed };
}

const pgError = (code: string, message = '', constraint?: string) =>
  Object.assign(new Error('wrapped'), {
    cause: Object.assign(new Error(message), {
      code,
      message,
      ...(constraint ? { constraint_name: constraint } : {}),
    }),
  });

const ID = '55555555-5555-4555-8555-555555555555';

describe('reads', () => {
  it('maps the cycles list', async () => {
    const { tx } = fakeTx([
      {
        id: ID,
        name_ar: 'خطة',
        name_en: 'Plan',
        period_start_on: new Date('2027-01-01T00:00:00Z'),
        period_end_on: '2027-12-31',
        deadline_on: '2026-11-30',
        status: 'open',
        launched_at: '2026-10-17T08:00:00Z',
        created_at: '2026-10-16T08:00:00Z',
        department_count: '3',
        submitted_count: 1,
      },
    ]);
    const [row] = await repo.listCycles(tx);
    expect(row).toMatchObject({
      id: ID,
      periodStart: '2027-01-01',
      periodEnd: '2027-12-31',
      status: 'open',
      departmentCount: 3,
      submittedCount: 1,
    });
    expect(row?.launchedAt).toBeInstanceOf(Date);
  });

  it('reads a cycle with its scope, departments and steps; null when invisible', async () => {
    expect(await repo.getCycle(fakeTx([]).tx, ID)).toBeNull();
    const { tx, executed } = fakeTx(
      [
        {
          id: ID,
          name_ar: 'خطة',
          name_en: 'Plan',
          period_start_on: '2027-01-01',
          period_end_on: '2027-12-31',
          deadline_on: '2026-11-30',
          instructions_ar: null,
          instructions_en: 'Hi',
          needs_form_id: null,
          reminder_days: '{7,2}',
          currency: 'AED',
          status: 'draft',
          launched_at: null,
          launched_by: null,
          closed_at: null,
          version: '4',
        },
      ],
      [
        { department_id: 'd1', branch_id: null },
        { department_id: null, branch_id: 'b1' },
      ],
      [{ department_id: 'd1', budget_amount: '50000.0000', status: 'not_started' }],
      [
        { kind: 'department_heads', name_ar: 'ر', name_en: 'H', approver_person_id: null },
        { kind: 'person', name_ar: 'م', name_en: 'F', approver_person_id: 'p1' },
      ],
    );
    const cycle = await repo.getCycle(tx, ID);
    expect(cycle).toMatchObject({
      reminderDays: [7, 2],
      currency: 'AED',
      version: 4,
      instructionsEn: 'Hi',
      scope: { departmentIds: ['d1'], branchIds: ['b1'] },
      departments: [{ departmentId: 'd1', budgetAmount: '50000', status: 'not_started' }],
      steps: [
        { kind: 'department_heads', approverPersonId: null },
        { kind: 'person', approverPersonId: 'p1' },
      ],
    });
    expect(executed[0]?.params).toEqual([ID]);
  });

  it('finds another open cycle and the organization’s today', async () => {
    expect(await repo.openCycle(fakeTx([]).tx, ID)).toBeNull();
    expect(await repo.openCycle(fakeTx([{ id: 'o', deadline_on: '2026-12-01' }]).tx, null)).toEqual(
      { id: 'o', deadline: '2026-12-01' },
    );
    expect(await repo.organizationToday(fakeTx([{ today: '2026-10-17' }]).tx)).toBe('2026-10-17');
  });

  it('falls back to the built-in settings until the organization saves its own', async () => {
    expect(await repo.getSettings(fakeTx([], []).tx)).toEqual({
      version: null,
      reminderDays: [7, 2],
      steps: DEFAULT_CHAIN,
    });
    const saved = await repo.getSettings(
      fakeTx(
        [{ reminder_days: [10], version: 2 }],
        [{ kind: 'person', name_ar: 'م', name_en: 'F', approver_person_id: 'p1' }],
      ).tx,
    );
    expect(saved).toEqual({
      version: 2,
      reminderDays: [10],
      steps: [{ kind: 'person', nameAr: 'م', nameEn: 'F', approverPersonId: 'p1' }],
    });
  });
});

describe('writes', () => {
  const basics = {
    nameAr: 'خطة',
    nameEn: 'Plan',
    periodStart: '2027-01-01',
    periodEnd: '2027-12-31',
    deadline: '2026-11-30',
    instructionsAr: null,
    instructionsEn: null,
    needsFormId: null,
  };

  it('creates a draft with the default reminders and chain', async () => {
    const FORM = '99999999-9999-4999-8999-999999999991';
    const { tx, executed } = fakeTx(
      [],
      [],
      [{ id: ID }],
      [],
      [],
      [],
      [{ version: 1, needs_form_id: FORM }],
    );
    // C-10: the stored needs form is read back (the database set the default one).
    expect(await repo.insertCycle(tx, basics)).toEqual({ id: ID, version: 1, needsFormId: FORM });
    expect(executed[2]?.params).toContain('{7,2}');
    expect(executed.filter((q) => q.sql.includes('plan_cycle_steps'))).toHaveLength(3);
  });

  it('checks the cycle before a change: missing, stale, launched, or locked and bumped', async () => {
    expect(await repo.touchCycle(fakeTx([]).tx, ID, 1)).toEqual({ outcome: 'not_found' });
    expect(await repo.touchCycle(fakeTx([{ status: 'draft', version: 2 }]).tx, ID, 1)).toEqual({
      outcome: 'conflict',
    });
    expect(await repo.touchCycle(fakeTx([{ status: 'open', version: 1 }]).tx, ID, 1)).toEqual({
      outcome: 'not_draft',
    });
    expect(
      await repo.touchCycle(fakeTx([{ status: 'open', version: 1 }], [{ version: 2 }]).tx, ID, 1, {
        draftOnly: false,
      }),
    ).toEqual({ outcome: 'ok', version: 2 });
    expect(await repo.touchCycle(fakeTx([{ status: 'draft', version: 1 }], []).tx, ID, 1)).toEqual({
      outcome: 'not_found',
    });
  });

  it('saves basics, scope, departments, envelopes, steps and reminders', async () => {
    expect(await repo.updateBasics(fakeTx([{ version: 5 }]).tx, ID, basics)).toBe(5);
    const scope = fakeTx();
    await repo.replaceScope(scope.tx, ID, { departmentIds: ['d1'], branchIds: ['b1'] }, [
      'd1',
      'd2',
    ]);
    expect(scope.executed.map((q) => q.sql.split(' ').slice(0, 3).join(' '))).toHaveLength(5);
    expect(scope.executed[3]?.params).toContain('{d1,d2}');
    const budgets = fakeTx([{ id: 'x' }], []);
    expect(
      await repo.updateBudgets(budgets.tx, ID, [
        { departmentId: 'd1', amount: '10' },
        { departmentId: 'd2', amount: null },
      ]),
    ).toBe(1);
    const steps = fakeTx();
    await repo.replaceSteps(steps.tx, ID, DEFAULT_CHAIN);
    expect(steps.executed).toHaveLength(4);
    const reminders = fakeTx([{ version: 6 }]);
    expect(await repo.updateReminders(reminders.tx, ID, [14, 2])).toBe(6);
    expect(reminders.executed[0]?.params).toContain('{14,2}');
    expect(await repo.closeDueCycles(fakeTx([{ id: 'old' }]).tx)).toEqual(['old']);
    expect(await repo.deleteDraft(fakeTx([{ id: ID }]).tx, ID)).toBe(true);
    expect(await repo.deleteDraft(fakeTx([]).tx, ID)).toBe(false);
    const settings = fakeTx([{ version: 3 }]);
    expect(await repo.saveSettings(settings.tx, [7], DEFAULT_CHAIN)).toBe(3);
    expect(settings.executed).toHaveLength(5);
  });

  it('turns the guard’s launch refusals into outcomes; anything else is thrown', async () => {
    expect(await repo.launch(fakeTx([{ version: 7 }]).tx, ID)).toEqual({
      outcome: 'launched',
      version: 7,
    });
    expect(await repo.launch(fakeTx(pgError('JK002')).tx, ID)).toEqual({ outcome: 'another_open' });
    expect(
      await repo.launch(fakeTx(pgError('23505', 'dup', 'plan_cycles_one_open_uq')).tx, ID),
    ).toEqual({ outcome: 'another_open' });
    expect(
      await repo.launch(
        fakeTx(pgError('JK003', 'planning cycle not ready to launch: approver_missing')).tx,
        ID,
      ),
    ).toEqual({ outcome: 'not_ready', reason: 'approver_missing' });
    expect(await repo.launch(fakeTx(pgError('JK003', 'odd')).tx, ID)).toEqual({
      outcome: 'not_ready',
      reason: 'unknown',
    });
    await expect(repo.launch(fakeTx(pgError('XX000')).tx, ID)).rejects.toThrow('wrapped');
    await expect(repo.launch(fakeTx(new Error('plain')).tx, ID)).rejects.toThrow('plain');
  });

  it('extends a deadline or reports the refusal', async () => {
    expect(await repo.extendDeadline(fakeTx([{ version: 8 }]).tx, ID, '2026-12-01')).toEqual({
      outcome: 'extended',
      version: 8,
    });
    for (const code of ['JK004', 'JK001', '23514']) {
      expect(await repo.extendDeadline(fakeTx(pgError(code)).tx, ID, '2026-12-01')).toEqual({
        outcome: 'refused',
      });
    }
    await expect(
      repo.extendDeadline(fakeTx(pgError('40001')).tx, ID, '2026-12-01'),
    ).rejects.toThrow();
  });

  it('reads SQLSTATEs through wrapped errors only', () => {
    expect(repo.dbError(pgError('JK001', 'm', 'c'))).toEqual({
      code: 'JK001',
      constraint: 'c',
      message: 'm',
    });
    expect(repo.dbError(new Error('x'))).toBeNull();
    expect(repo.dbError('x')).toBeNull();
  });
});

describe('department needs (WP-LD-01)', () => {
  it('maps a department row, its needs with their named people, and the head’s tasks', async () => {
    const dept = fakeTx([
      {
        cycle_id: ID,
        department_id: 'd1',
        budget_amount: '50000.0000',
        status: 'returned',
        deadline_on: '2026-12-05',
        submitted_at: null,
        submitted_by: null,
        returned_at: '2026-10-26T09:00:00Z',
        returned_by: 'p9',
        return_note: 'More detail',
        answers: '{"s1":[{"f1":"x"}]}',
        version: 3,
      },
    ]);
    expect(await repo.getDepartment(dept.tx, ID, 'd1')).toMatchObject({
      budgetAmount: '50000',
      status: 'returned',
      deadline: '2026-12-05',
      returnNote: 'More detail',
      answers: { s1: [{ f1: 'x' }] },
      version: 3,
    });
    expect(await repo.getDepartment(fakeTx([]).tx, ID, 'd1')).toBeNull();
    const needs = fakeTx([
      {
        id: 'n1',
        topic: 'Excel',
        course_id: null,
        people_count: '5',
        estimated_cost: '1200.5000',
        answers: {},
        version: 1,
        updated_at: '2026-10-25T10:00:00Z',
        person_ids: '{p1,p2}',
      },
    ]);
    const [need] = await repo.listNeeds(needs.tx, ID, 'd1');
    expect(need).toMatchObject({
      id: 'n1',
      peopleCount: 5,
      estimatedCost: '1200.5',
      personIds: ['p1', 'p2'],
    });
    expect(needs.executed[0]?.params).toEqual([ID, 'd1']);
    const mine = fakeTx([
      {
        cycle_id: ID,
        name_ar: 'خطة',
        name_en: 'Plan',
        cycle_deadline: '2026-11-30',
        period_start_on: '2027-01-01',
        period_end_on: '2027-12-31',
        currency: 'SAR',
        department_id: 'd1',
        status: 'draft',
        deadline_on: null,
        budget_amount: null,
        return_note: null,
        needs_count: '2',
        seats: '8',
        cost: null,
      },
    ]);
    expect(await repo.listMyDepartments(mine.tx)).toEqual([
      expect.objectContaining({
        cycleId: ID,
        departmentId: 'd1',
        needsCount: 2,
        seats: 8,
        cost: null,
      }),
    ]);
  });

  it('writes a need with its people and turns the guards’ refusals into outcomes', async () => {
    const values = {
      topic: 'Excel',
      courseId: null,
      peopleCount: 5,
      estimatedCost: null,
      answers: {},
    };
    const inserted = fakeTx([{ id: 'n1', version: 1 }], [], []);
    expect(await repo.insertNeed(inserted.tx, ID, 'd1', values, ['p1'])).toEqual({
      outcome: 'ok',
      id: 'n1',
      version: 1,
    });
    // insert, delete the names, insert the names
    expect(inserted.executed).toHaveLength(3);
    expect(inserted.executed[2]?.params).toContain('{p1}');
    const stale = fakeTx([], [{ '?column?': 1 }]);
    const ref = { cycleId: ID, departmentId: 'd1', needId: 'n1' };
    expect(await repo.updateNeed(stale.tx, ref, 1, values, [])).toEqual({
      outcome: 'conflict',
    });
    const gone = fakeTx([], []);
    expect(await repo.deleteNeed(gone.tx, ref, 1)).toEqual({ outcome: 'not_found' });
    expect(
      await repo.insertNeed(
        fakeTx(pgError('JK005', 'needs entry is closed')).tx,
        ID,
        'd1',
        values,
        [],
      ),
    ).toEqual({ outcome: 'closed' });
    expect(
      await repo.insertNeed(
        fakeTx(pgError('JK005', 'the needs are submitted')).tx,
        ID,
        'd1',
        values,
        [],
      ),
    ).toEqual({ outcome: 'submitted' });
    expect(await repo.insertNeed(fakeTx(pgError('JK007')).tx, ID, 'd1', values, [])).toEqual({
      outcome: 'limit',
    });
    expect(await repo.insertNeed(fakeTx(pgError('42501')).tx, ID, 'd1', values, [])).toEqual({
      outcome: 'not_allowed',
    });
    await expect(
      repo.insertNeed(fakeTx(new Error('network')).tx, ID, 'd1', values, []),
    ).rejects.toThrow('network');
  });

  it('moves a department’s status and deadline, reporting conflicts and refusals', async () => {
    const submitted = fakeTx([{ version: 4 }]);
    expect(await repo.setDepartmentStatus(submitted.tx, ID, 'd1', 3, 'submitted')).toEqual({
      outcome: 'ok',
      version: 4,
    });
    expect(submitted.executed[0]?.params).toEqual(['submitted', ID, 'd1', 3]);
    const returned = fakeTx([{ version: 5 }]);
    await repo.setDepartmentStatus(returned.tx, ID, 'd1', 4, 'returned', 'Please add X');
    expect(returned.executed[0]?.params).toEqual(['returned', 'Please add X', ID, 'd1', 4]);
    const conflict = fakeTx(
      [],
      [{ cycle_id: ID, department_id: 'd1', status: 'draft', version: 9, answers: {} }],
    );
    expect(await repo.setDepartmentStatus(conflict.tx, ID, 'd1', 3, 'submitted')).toEqual({
      outcome: 'conflict',
    });
    expect(
      await repo.setDepartmentStatus(
        fakeTx(pgError('JK006', 'nothing to submit')).tx,
        ID,
        'd1',
        3,
        'submitted',
      ),
    ).toEqual({ outcome: 'empty' });
    expect(
      await repo.extendDepartmentDeadline(fakeTx(pgError('JK004')).tx, ID, 'd1', 3, '2026-12-05'),
    ).toEqual({ outcome: 'refused' });
    expect(
      await repo.extendDepartmentDeadline(fakeTx([{ version: 6 }]).tx, ID, 'd1', 3, '2026-12-05'),
    ).toEqual({ outcome: 'ok', version: 6 });
  });
});
