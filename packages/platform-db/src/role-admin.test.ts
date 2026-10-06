import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  type AssignedRole,
  getEditableRoles,
  keepPrimaryDays,
  replaceMemberRoles,
  rolesRefusalOf,
  touchesRoles,
} from './role-admin';

const dialect = new PgDialect();

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

const person = {
  id: 'p1',
  membership_id: 'm1',
  status: 'active',
  is_self: false,
  may_manage: true,
  time_zone: 'Asia/Riyadh',
  today: '2026-10-06',
};
const rows = [
  {
    role_code: 'training_coordinator',
    is_primary: true,
    valid_from: null,
    valid_until: null,
    id: 'r2',
    version: 2,
  },
  {
    role_code: 'learner',
    is_primary: false,
    valid_from: null,
    valid_until: '2026-12-31',
    id: 'r1',
    version: 1,
  },
];
const role = (roleCode: string, over: Partial<AssignedRole> = {}): AssignedRole => ({
  roleCode,
  isPrimary: false,
  validFrom: null,
  validUntil: null,
  ...over,
});
const VERSION = 'learner:r1:1,training_coordinator:r2:2';
const pgError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('db'), { cause: { code, message: '', ...extra } });

describe('getEditableRoles', () => {
  it('maps roles and a version token sorted by role; no account → no roles; null when absent', async () => {
    expect(await getEditableRoles(fakeTx([person], rows).tx, 'p1')).toEqual({
      personId: 'p1',
      membershipId: 'm1',
      membershipStatus: 'active',
      isSelf: false,
      mayManage: true,
      roles: [
        role('training_coordinator', { isPrimary: true }),
        role('learner', { validUntil: '2026-12-31' }),
      ],
      version: VERSION,
      timeZone: 'Asia/Riyadh',
      today: '2026-10-06',
    });
    const noAccount = fakeTx([{ ...person, membership_id: null, status: null }]);
    expect(await getEditableRoles(noAccount.tx, 'p1')).toMatchObject({ roles: [], version: '' });
    expect(noAccount.executed).toHaveLength(1);
    expect(await getEditableRoles(fakeTx([]).tx, 'p1')).toBeNull();
  });
});

describe('replaceMemberRoles', () => {
  it('locks first, then refuses what it must before writing anything', async () => {
    const cases: [unknown[], string, string][] = [
      [[], VERSION, 'not_found'],
      [[{ ...person, membership_id: null }], '', 'no_account'],
      [[{ ...person, is_self: true }], VERSION, 'own_roles'],
      [[{ ...person, may_manage: false }], VERSION, 'not_allowed'],
      [[{ ...person, status: 'revoked' }], VERSION, 'membership_revoked'],
      [[person], 'learner:0', 'version_conflict'],
    ];
    for (const [personRows, version, refusal] of cases) {
      const fake = fakeTx([], personRows, rows);
      expect(await replaceMemberRoles(fake.tx, 'p1', version, [])).toEqual({ ok: false, refusal });
      expect(fake.executed[0]?.sql).toContain('private.lock_tenant_roles');
      expect(fake.executed.some((q) => /^\s*(insert|update|delete)\b/.test(q.sql))).toBe(false);
    }
  });

  it('nothing to change → no writes', async () => {
    const fake = fakeTx([], [person], rows);
    const desired = [
      role('training_coordinator', { isPrimary: true }),
      role('learner', { validUntil: '2026-12-31' }),
    ];
    expect(await replaceMemberRoles(fake.tx, 'p1', VERSION, desired)).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(fake.executed).toHaveLength(3);
  });

  it('deletes, then gives up the primary slot, then takes it; days in the organization zone', async () => {
    const fake = fakeTx([], [person], rows, [], [], [], [person], []);
    const outcome = await replaceMemberRoles(fake.tx, 'p1', VERSION, [
      role('training_coordinator'),
      role('mentor', { isPrimary: true, validFrom: '2026-01-01' }),
    ]);
    expect(outcome).toMatchObject({ ok: true, changed: true });
    const writes = fake.executed.slice(3, 6).map((q) => q.sql.trim().split(/\s+/)[0]);
    expect(writes).toEqual(['delete', 'update', 'insert']);
    expect(fake.executed[3]?.params).toContain('learner');
    expect(fake.executed[4]?.params).toContain('training_coordinator');
    expect(fake.executed[5]?.sql).toContain('::date::timestamp at time zone');
    expect(fake.executed[5]?.params).toEqual(
      expect.arrayContaining(['mentor', true, '2026-01-01', 'Asia/Riyadh']),
    );
  });

  it('an end day is stored as the start of the next day', async () => {
    const fake = fakeTx([], [person], rows, [], [person], []);
    await replaceMemberRoles(fake.tx, 'p1', VERSION, [
      role('training_coordinator', { isPrimary: true }),
      role('learner', { validUntil: '2027-01-31' }),
    ]);
    expect(fake.executed[3]?.sql).toContain('::date + 1)::timestamp at time zone');
  });

  it('turns database refusals into reasons and rethrows anything else', async () => {
    const fake = fakeTx([], [person], rows, pgError('42501'));
    expect(await replaceMemberRoles(fake.tx, 'p1', VERSION, [role('auditor')])).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    expect(
      rolesRefusalOf(
        pgError('23514', { message: 'must keep at least one active Organization Admin' }),
      ),
    ).toBe('last_admin');
    expect(
      rolesRefusalOf(
        pgError('23514', { message: 'roles cannot be given to a revoked membership' }),
      ),
    ).toBe('membership_revoked');
    expect(
      rolesRefusalOf(pgError('23514', { constraint_name: 'role_assignments_validity_check' })),
    ).toBe('dates_invalid');
    expect(rolesRefusalOf(pgError('23505'))).toBe('version_conflict');
    expect(() => rolesRefusalOf(pgError('23514', { message: 'other' }))).toThrow();
    expect(() => rolesRefusalOf(new Error('boom'))).toThrow('boom');
  });
});

describe('primary days and locked roles', () => {
  it('a primary role that stays primary keeps its days', () => {
    const before = [role('learner', { isPrimary: true, validUntil: '2026-01-31' })];
    expect(keepPrimaryDays(before, [role('learner', { isPrimary: true })])).toEqual(before);
    // Another primary, or a role that was additional, takes no days from elsewhere.
    expect(keepPrimaryDays(before, [role('mentor', { isPrimary: true })])).toEqual([
      role('mentor', { isPrimary: true }),
    ]);
  });

  it('touchesRoles: given, removed, primary flag or days of a locked role', () => {
    const locked = new Set(['auditor', 'tenant_admin']);
    const current = [role('learner', { isPrimary: true }), role('auditor')];
    expect(touchesRoles(current, current, locked)).toBe(false);
    expect(touchesRoles(current, [role('learner', { isPrimary: true })], locked)).toBe(true);
    expect(touchesRoles(current, [...current, role('tenant_admin')], locked)).toBe(true);
    expect(
      touchesRoles(
        current,
        [role('learner', { isPrimary: true }), role('auditor', { validUntil: '2027-01-01' })],
        locked,
      ),
    ).toBe(true);
    expect(
      touchesRoles(
        current,
        [role('learner', { isPrimary: true }), role('auditor'), role('mentor')],
        locked,
      ),
    ).toBe(false);
  });

  it('refuses a locked change after the lock, before writing; keeps the primary days on save', async () => {
    const locked = fakeTx([], [person], rows);
    expect(
      await replaceMemberRoles(locked.tx, 'p1', VERSION, [role('auditor', { isPrimary: true })], {
        lockedCodes: new Set(['auditor']),
      }),
    ).toEqual({ ok: false, refusal: 'privileged_change' });
    expect(locked.executed).toHaveLength(3);

    const dated = [{ ...rows[0], valid_until: '2026-01-31' }, rows[1]];
    const kept = fakeTx([], [person], dated);
    expect(
      await replaceMemberRoles(kept.tx, 'p1', VERSION, [
        role('training_coordinator', { isPrimary: true }),
        role('learner', { validUntil: '2026-12-31' }),
      ]),
    ).toMatchObject({ ok: true, changed: false });
  });
});
