import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  MEMBER_EVENTS,
  deactivateMembership,
  getMemberLifecycleTarget,
  listDirectReports,
  listHeadedDepartments,
  listReplacementCandidates,
  lockMemberLifecycle,
  reactivateMembership,
  reassignDirectReports,
  reassignHeadedDepartments,
  reassignRefusalOf,
  revokePendingInvitationsOf,
} from './deactivation';

const dialect = new PgDialect();

/** Answers each statement with the next result (rows, or an error to throw). */
function fakeTx(...results: (unknown[] | Error)[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        const q = dialect.sqlToQuery(query);
        executed.push({ sql: q.sql, params: q.params });
        const next = results.shift() ?? [];
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
    } as never,
  };
}

/** A postgres.js error as Drizzle wraps it. */
const pgFailure = (code: string, message = '', constraint?: string) =>
  Object.assign(new Error('query failed'), {
    cause: Object.assign(new Error(message), {
      code,
      message,
      ...(constraint ? { constraint_name: constraint } : {}),
    }),
  });

const X = '9d100000-0000-4000-8000-0000000000a1';
const Y = '9d100000-0000-4000-8000-0000000000a2';

describe('getMemberLifecycleTarget', () => {
  it('maps the person, membership and the rules the guards apply; null for an unknown person', async () => {
    const fake = fakeTx(
      [
        {
          person_id: X,
          display_name_ar: 'سارة',
          display_name_en: null,
          person_status: 'active',
          membership_id: 'm1',
          membership_status: 'active',
          is_self: false,
          may_manage: true,
          privileged: false,
          last_admin: false,
        },
      ],
      [],
    );
    expect(await getMemberLifecycleTarget(fake.tx, X)).toEqual({
      personId: X,
      displayNameAr: 'سارة',
      displayNameEn: null,
      personStatus: 'active',
      membershipId: 'm1',
      membershipStatus: 'active',
      isSelf: false,
      mayManage: true,
      privileged: false,
      lastAdmin: false,
    });
    const [query] = fake.executed;
    expect(query?.sql).toContain('private.actor_may_manage_person(p.tenant_id, p.id)');
    expect(query?.sql).toContain('private.membership_is_privileged(m.tenant_id, m.id)');
    // The last-admin rule mirrors private.tenant_has_admin: another active admin without an end date.
    expect(query?.sql).toContain('ra.valid_until is null');
    expect(query?.params).toContain(X);
    expect(await getMemberLifecycleTarget(fake.tx, X)).toBeNull();
  });
});

describe('lockMemberLifecycle', () => {
  it('takes the person_employment lock before the role lock (global lock order)', async () => {
    const fake = fakeTx();
    await lockMemberLifecycle(fake.tx);
    expect(fake.executed.map((q) => q.sql)).toEqual([
      'select private.lock_person_employment(private.current_tenant_id())',
      'select private.lock_tenant_roles(private.current_tenant_id())',
    ]);
  });
});

describe('reassignRefusalOf', () => {
  it('maps the guards and checks of a reassignment; rethrows anything else', () => {
    expect(reassignRefusalOf(pgFailure('42501', 'only user managers'))).toBe('not_allowed');
    expect(
      reassignRefusalOf(
        pgFailure('23514', 'the manager chain of person x would loop or exceed 50 levels'),
      ),
    ).toBe('owner_reports_to_person');
    expect(
      reassignRefusalOf(pgFailure('23514', 'the direct manager must be an active person')),
    ).toBe('owner_invalid');
    expect(
      reassignRefusalOf(pgFailure('23503', '', 'person_employment_tenant_id_manager_fkey')),
    ).toBe('owner_invalid');
    const other = pgFailure('40001', 'serialization');
    expect(() => reassignRefusalOf(other)).toThrow(other);
  });
});

describe('direct reports', () => {
  const reports = [
    { id: 'r1', name_ar: 'أ', name_en: null, movable: true },
    { id: Y, name_ar: 'ب', name_en: 'B', movable: true },
    { id: 'r3', name_ar: 'ج', name_en: null, movable: false },
  ];

  it('lists active reports with whether the caller may move each', async () => {
    const fake = fakeTx(reports);
    expect(await listDirectReports(fake.tx, X)).toEqual([
      { id: 'r1', nameAr: 'أ', nameEn: null, movable: true },
      { id: Y, nameAr: 'ب', nameEn: 'B', movable: true },
      { id: 'r3', nameAr: 'ج', nameEn: null, movable: false },
    ]);
    expect(fake.executed[0]?.sql).toContain("p.status = 'active'");
  });

  it("a report who takes over moves up first (to the person's own active manager), then the others", async () => {
    const fake = fakeTx(reports, [], [], []);
    expect(await reassignDirectReports(fake.tx, X, Y)).toEqual({
      ok: true,
      moved: [Y, 'r1', 'r3'],
    });
    const [, promote, first, second] = fake.executed;
    expect(promote?.sql).toContain('set manager_person_id = (');
    expect(promote?.sql).toContain("up.status = 'active'");
    expect(promote?.params).toEqual([X, Y, Y, X]);
    expect(first?.params).toEqual([Y, 'r1', X]);
    expect(second?.params).toEqual([Y, 'r3', X]);
  });

  it('someone outside the team: every report moves to them', async () => {
    const fake = fakeTx(reports.slice(0, 1), []);
    expect(await reassignDirectReports(fake.tx, X, 'z9')).toEqual({ ok: true, moved: ['r1'] });
    expect(fake.executed).toHaveLength(2);
  });

  it('refuses the person themselves, and maps a database refusal (the transaction is aborted)', async () => {
    expect(await reassignDirectReports(fakeTx().tx, X, X)).toEqual({
      ok: false,
      refusal: 'owner_invalid',
    });
    const fake = fakeTx(reports.slice(0, 1), pgFailure('42501', 'only an Organization Admin'), []);
    expect(await reassignDirectReports(fake.tx, X, 'z9')).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    expect(fake.executed).toHaveLength(2); // nothing after the refusal
  });
});

describe('departments the person heads', () => {
  it('lists the live ones and moves them all in one statement', async () => {
    const list = fakeTx([{ id: 'd1', name_ar: 'التدريب', name_en: 'Training' }]);
    expect(await listHeadedDepartments(list.tx, X)).toEqual([
      { id: 'd1', nameAr: 'التدريب', nameEn: 'Training', movable: true },
    ]);
    expect(list.executed[0]?.sql).toContain('d.deleted_at is null');
    const move = fakeTx([{ id: 'd1' }, { id: 'd2' }]);
    expect(await reassignHeadedDepartments(move.tx, X, Y)).toEqual({
      ok: true,
      moved: ['d1', 'd2'],
    });
    expect(move.executed[0]?.params).toEqual([Y, X]);
  });

  it('refuses the person themselves and an inactive new head', async () => {
    expect(await reassignHeadedDepartments(fakeTx().tx, X, X)).toEqual({
      ok: false,
      refusal: 'owner_invalid',
    });
    const fake = fakeTx(pgFailure('23514', 'the head of department d1 must be an active person'));
    expect(await reassignHeadedDepartments(fake.tx, X, Y)).toEqual({
      ok: false,
      refusal: 'owner_invalid',
    });
  });
});

describe('listReplacementCandidates', () => {
  it('offers the active managers and department heads, never the person', async () => {
    const fake = fakeTx([
      { person_id: X, name_ar: 'س', name_en: null, active: true, department_ids: [] },
      { person_id: Y, name_ar: 'ص', name_en: 'S', active: true, department_ids: ['d1'] },
      { person_id: 'old', name_ar: 'ع', name_en: null, active: false, department_ids: [] },
    ]);
    expect(await listReplacementCandidates(fake.tx, X)).toEqual([
      { personId: Y, nameAr: 'ص', nameEn: 'S' },
    ]);
  });
});

describe('revokePendingInvitationsOf', () => {
  it('revokes each pending invitation of the person (with its event)', async () => {
    const fake = fakeTx([{ id: 'i1' }, { id: 'i2' }], [{ id: 'i1' }], [], []);
    expect(await revokePendingInvitationsOf(fake.tx, X)).toEqual(['i1']);
    expect(fake.executed[0]?.sql).toContain("i.status = 'pending'");
    expect(fake.executed[1]?.sql).toContain("set status = 'revoked'");
    expect(fake.executed[2]?.sql).toContain('insert into platform.event_outbox');
    expect(fake.executed[3]?.sql).toContain("set status = 'revoked'"); // i2: no longer pending
  });
});

describe('deactivateMembership', () => {
  const target = { personId: X, membershipId: 'm1' };

  it('person inactive, membership suspended, then the event (ids only)', async () => {
    const fake = fakeTx([], [{ id: 'm1' }], []);
    expect(await deactivateMembership(fake.tx, target)).toEqual({ ok: true });
    const [person, membership, event] = fake.executed;
    expect(person?.sql).toContain("set status = 'inactive'");
    expect(membership?.sql).toContain("set status = 'suspended'");
    expect(membership?.sql).toContain("status = 'active'");
    expect(event?.params).toContain(MEMBER_EVENTS.deactivated);
    expect(event?.params).toContain(JSON.stringify({ membershipId: 'm1' }));
  });

  it('maps the guards: not this actor, the last Organization Admin, no longer active', async () => {
    expect(await deactivateMembership(fakeTx(pgFailure('42501', 'denied')).tx, target)).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    expect(
      await deactivateMembership(
        fakeTx(
          [],
          pgFailure('23514', 'the organization must keep at least one active Organization Admin'),
        ).tx,
        target,
      ),
    ).toEqual({ ok: false, refusal: 'last_admin' });
    expect(await deactivateMembership(fakeTx([], []).tx, target)).toEqual({
      ok: false,
      refusal: 'not_active',
    });
    const other = pgFailure('57014', 'canceled');
    await expect(deactivateMembership(fakeTx(other).tx, target)).rejects.toBe(other);
  });
});

describe('reactivateMembership', () => {
  it('person active, membership through the checked function, then the event', async () => {
    const fake = fakeTx([], [{ membership_id: 'm1' }], []);
    expect(await reactivateMembership(fake.tx, X)).toEqual({ ok: true, membershipId: 'm1' });
    const [person, fn, event] = fake.executed;
    expect(person?.sql).toContain("set status = 'active'");
    expect(fn?.sql).toBe('select private.reactivate_membership($1::uuid) as membership_id');
    expect(event?.params).toContain(MEMBER_EVENTS.reactivated);
  });

  it.each([
    ['JM001', 'not_found'],
    ['JM002', 'not_deactivated'],
    ['JM003', 'step_up_required'],
    ['JM004', 'not_allowed'],
    ['42501', 'not_allowed'],
  ] as const)('maps %s to %s', async (code, refusal) => {
    const fake = fakeTx([], pgFailure(code, 'refused'));
    expect(await reactivateMembership(fake.tx, X)).toEqual({ ok: false, refusal });
  });

  it('a placement in a deleted unit is its own reason; other errors are rethrown', async () => {
    const fake = fakeTx(
      pgFailure(
        '23514',
        'person x is placed in a deleted department or branch; move them before reactivating',
      ),
    );
    expect(await reactivateMembership(fake.tx, X)).toEqual({
      ok: false,
      refusal: 'placement_deleted',
    });
    const other = pgFailure('23514', 'something else');
    await expect(reactivateMembership(fakeTx(other).tx, X)).rejects.toBe(other);
    await expect(reactivateMembership(fakeTx([], []).tx, X)).rejects.toThrow(
      'no membership returned',
    );
  });
});
