/**
 * The draft-session repository with a fake transaction (WP-LD-04): row mapping, the statements it sends (the version
 * seen is part of every WHERE; seats grow before people come and shrink after they leave) and how the guards'
 * refusals become outcomes. sessions.integration.test.ts runs the same functions against PostgreSQL.
 */
import type { UserTx } from '@jadarat/platform-db';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as repo from './repository';

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

const pgError = (code: string) =>
  Object.assign(new Error('wrapped'), { cause: Object.assign(new Error('x'), { code }) });

const SESSION = '11111111-1111-4111-8111-111111111111';
const LINE = '88888888-8888-4888-8888-888888888881';
const PLAN = '77777777-7777-4777-8777-777777777777';
const CYCLE = '55555555-5555-4555-8555-555555555555';
const COURSE = '99999999-9999-4999-8999-999999999991';
const P1 = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';

const sessionRow = (over: Record<string, unknown> = {}) => ({
  id: SESSION,
  status: 'draft',
  plan_id: PLAN,
  cycle_id: CYCLE,
  plan_line_id: LINE,
  plan_version: 1,
  course_id: COURSE,
  delivery_type: 'classroom',
  month: '2027-02-01',
  branch_id: null,
  seats: 16,
  estimated_cost: '9000.0000',
  cost_currency: 'SAR',
  created_at: '2026-11-17T08:00:00Z',
  version: 2,
  participants: '3',
  ...over,
});

describe('refusals', () => {
  it('maps the guards’ SQLSTATEs (also wrapped as a cause); anything else is not a refusal', () => {
    expect(
      [
        'JK013',
        'JK014',
        'JK015',
        'JK016',
        'JK008',
        '42501',
        '23505',
        'JK001',
        '23503',
        '23514',
      ].map((code) => repo.sessionRefusalOf(pgError(code))),
    ).toEqual([
      'not_ready',
      'all_drafted',
      'outside_period',
      'seats',
      'frozen',
      'not_allowed',
      'person_taken',
      'refused',
      'refused',
      'refused',
    ]);
    expect(repo.sessionRefusalOf(pgError('40001'))).toBeNull();
    expect(repo.sessionRefusalOf(new Error('x'))).toBeNull();
  });
});

describe('reads', () => {
  it('maps a draft', async () => {
    const { tx, executed } = fakeTx([sessionRow()]);
    expect(await repo.getSession(tx, SESSION)).toEqual({
      id: SESSION,
      status: 'draft',
      planId: PLAN,
      cycleId: CYCLE,
      lineId: LINE,
      planVersion: 1,
      courseId: COURSE,
      deliveryType: 'classroom',
      month: '2027-02-01',
      branchId: null,
      seats: 16,
      estimatedCost: '9000',
      costCurrency: 'SAR',
      participants: 3,
      createdAt: new Date('2026-11-17T08:00:00Z'),
      version: 2,
    });
    expect(executed[0]?.params).toEqual([SESSION]);
    expect(await repo.getSession(fakeTx([]).tx, SESSION)).toBeNull();
    const dated = await repo.getSession(
      fakeTx([sessionRow({ month: new Date('2027-03-01T00:00:00Z'), estimated_cost: null })]).tx,
      SESSION,
    );
    expect(dated).toMatchObject({ month: '2027-03-01', estimatedCost: null });
  });

  it('lists drafts by plan, by lines and by months', async () => {
    const plan = fakeTx([sessionRow()]);
    expect(await repo.listPlanSessions(plan.tx, PLAN)).toHaveLength(1);
    expect(plan.executed[0]?.params).toEqual([PLAN]);
    expect(await repo.listLineSessions(fakeTx().tx, [])).toEqual([]);
    const lines = fakeTx([sessionRow()]);
    await repo.listLineSessions(lines.tx, [LINE]);
    expect(lines.executed[0]?.params).toEqual([`{${LINE}}`]);
    const between = fakeTx([]);
    await repo.listSessionsBetween(between.tx, '2027-01-01', '2028-01-01');
    expect(between.executed[0]?.params).toEqual(['2027-01-01', '2028-01-01']);
  });

  it('maps participants, named people, line courses, courses and plan sources', async () => {
    expect(await repo.listLineParticipants(fakeTx().tx, [])).toEqual([]);
    expect(
      await repo.listLineParticipants(
        fakeTx([
          {
            id: 'p',
            session_id: SESSION,
            plan_line_id: LINE,
            need_id: 'n',
            department_id: 'd',
            person_id: P1,
          },
        ]).tx,
        [LINE],
      ),
    ).toEqual([
      { id: 'p', sessionId: SESSION, lineId: LINE, needId: 'n', departmentId: 'd', personId: P1 },
    ]);
    expect(await repo.listNamedPeople(fakeTx().tx, [])).toEqual([]);
    expect(
      await repo.listNamedPeople(
        fakeTx([{ line_id: LINE, need_id: 'n', department_id: 'd', person_id: P1 }]).tx,
        [LINE],
      ),
    ).toEqual([{ lineId: LINE, needId: 'n', departmentId: 'd', personId: P1 }]);
    expect(
      await repo.listLineCourses(
        fakeTx([
          { id: LINE, course_origin: 'created', course_set_at: '2026-11-17T08:00:00Z' },
          { id: 'other', course_origin: null, course_set_at: null },
        ]).tx,
        PLAN,
      ),
    ).toEqual([
      { lineId: LINE, courseOrigin: 'created', courseSetAt: new Date('2026-11-17T08:00:00Z') },
      { lineId: 'other', courseOrigin: null, courseSetAt: null },
    ]);
    expect(await repo.listCourseBriefs(fakeTx().tx, [])).toEqual([]);
    const courses = fakeTx([
      {
        id: COURSE,
        code: 'CRS-0001',
        title_en: 'Excel',
        title_ar: null,
        delivery_type: 'virtual',
        duration_hours: '12.00',
        status: 'archived',
      },
    ]);
    expect(await repo.listCourseBriefs(courses.tx, [COURSE, COURSE])).toEqual([
      {
        id: COURSE,
        code: 'CRS-0001',
        titleEn: 'Excel',
        titleAr: null,
        deliveryType: 'virtual',
        durationHours: 12,
        status: 'archived',
      },
    ]);
    expect(courses.executed[0]?.params).toEqual([`{${COURSE}}`]);
    const source = {
      id: PLAN,
      cycle_id: CYCLE,
      status: 'approved',
      plan_version: 2,
      name_ar: null,
      name_en: 'Plan 2027',
      period_start_on: '2027-01-01',
      period_end_on: '2027-12-31',
      currency: 'SAR',
    };
    const expected = {
      planId: PLAN,
      cycleId: CYCLE,
      status: 'approved',
      planVersion: 2,
      nameAr: null,
      nameEn: 'Plan 2027',
      periodStart: '2027-01-01',
      periodEnd: '2027-12-31',
      currency: 'SAR',
    };
    expect(await repo.getPlanSource(fakeTx([source]).tx, PLAN)).toEqual(expected);
    expect(await repo.getPlanSource(fakeTx([]).tx, PLAN)).toBeNull();
    expect(
      await repo.listPlansOverlapping(fakeTx([source]).tx, '2027-01-01', '2027-12-31'),
    ).toEqual([expected]);
  });
});

describe('writes', () => {
  it('gives a line its course at the version seen', async () => {
    const { tx, executed } = fakeTx([{ version: 5 }]);
    expect(await repo.setLineCourse(tx, LINE, 4, COURSE, 'linked')).toEqual({ ok: true, value: 5 });
    expect(executed[0]?.params).toEqual([COURSE, 'linked', LINE, 4]);
    expect(await repo.setLineCourse(fakeTx([]).tx, LINE, 4, COURSE, 'linked')).toEqual({
      ok: true,
      value: null,
    });
    expect(
      await repo.setLineCourse(fakeTx(pgError('JK001')).tx, LINE, 4, COURSE, 'created'),
    ).toEqual({ ok: false, refusal: 'refused' });
    await expect(
      repo.setLineCourse(fakeTx(new Error('boom')).tx, LINE, 4, COURSE, 'created'),
    ).rejects.toThrow('boom');
  });

  it('inserts drafts and their people, all or none', async () => {
    const { tx, executed } = fakeTx([{ id: SESSION }], [{ id: 'a' }, { id: 'b' }], [{ id: 'S2' }]);
    const draft = {
      planId: PLAN,
      cycleId: CYCLE,
      lineId: LINE,
      courseId: COURSE,
      deliveryType: 'classroom',
      month: '2027-01-01',
      branchId: null,
      seats: 16,
      people: [
        { personId: P1, needId: 'n1' },
        { personId: P2, needId: 'n2' },
      ],
    };
    expect(await repo.insertSessions(tx, [draft, { ...draft, people: [] }])).toEqual({
      ok: true,
      value: [SESSION, 'S2'],
    });
    expect(executed).toHaveLength(3);
    expect(executed[1]?.params).toEqual([SESSION, LINE, '{n1,n2}', `{${P1},${P2}}`]);
    // A person the policies refused (fewer rows than asked) undoes everything.
    expect(await repo.insertSessions(fakeTx([{ id: SESSION }], [{ id: 'a' }]).tx, [draft])).toEqual(
      {
        ok: false,
        refusal: 'not_allowed',
      },
    );
    expect(await repo.insertSessions(fakeTx([]).tx, [draft])).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    expect(await repo.insertSessions(fakeTx(pgError('JK014')).tx, [draft])).toEqual({
      ok: false,
      refusal: 'all_drafted',
    });
  });

  it('changes a draft: seats up first, people, then seats down', async () => {
    const { tx, executed } = fakeTx(
      [{ version: 3 }],
      [],
      [],
      [{ ids: [P1] }],
      [{ id: 'x' }],
      [{ version: 4 }],
    );
    const result = await repo.updateSession(
      tx,
      { id: SESSION, lineId: LINE, version: 2 },
      { month: '2027-04-01', branchId: null, seats: 2 },
      [
        { personId: P1, needId: 'n1' },
        { personId: P2, needId: 'n2' },
      ],
    );
    expect(result).toEqual({ ok: true, value: 4 });
    expect(executed.map((e) => e.sql.split(/\s+/).slice(0, 4).join(' ').trim())).toEqual([
      'update tms.sessions set',
      'delete from tms.session_participants',
      'update tms.session_participants set',
      "select coalesce(array_agg(person_id::text), '{}')",
      'insert into tms.session_participants',
      'update tms.sessions set',
    ]);
    expect(executed[0]?.sql).toContain('greatest(seats');
    expect(executed[4]?.params).toEqual([SESSION, LINE, '{n2}', `{${P2}}`]);
    // Only the version moves when nothing else is asked; a stale version changes nothing.
    const touch = fakeTx([{ version: 3 }]);
    expect(
      await repo.updateSession(touch.tx, { id: SESSION, lineId: LINE, version: 2 }, {}, null),
    ).toEqual({ ok: true, value: 3 });
    expect(touch.executed[0]?.sql).toContain('seats = seats');
    expect(
      await repo.updateSession(fakeTx([]).tx, { id: SESSION, lineId: LINE, version: 2 }, {}, null),
    ).toEqual({ ok: true, value: null });
    // Everybody leaves: no move, no insert; seats unchanged.
    const empty = fakeTx([{ version: 3 }], []);
    expect(
      await repo.updateSession(
        empty.tx,
        { id: SESSION, lineId: LINE, version: 2 },
        { seats: 4 },
        [],
      ),
    ).toEqual({ ok: true, value: 3 });
    expect(empty.executed).toHaveLength(3);
    expect(
      await repo.updateSession(
        fakeTx(pgError('JK016')).tx,
        { id: SESSION, lineId: LINE, version: 2 },
        { seats: 1 },
        null,
      ),
    ).toEqual({ ok: false, refusal: 'seats' });
  });

  it('deletes a draft at the version seen', async () => {
    expect(await repo.deleteSession(fakeTx([{ id: SESSION }]).tx, SESSION, 2)).toEqual({
      ok: true,
      value: true,
    });
    expect(await repo.deleteSession(fakeTx([]).tx, SESSION, 2)).toEqual({ ok: true, value: null });
    expect(await repo.deleteSession(fakeTx(pgError('42501')).tx, SESSION, 2)).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
  });
});
