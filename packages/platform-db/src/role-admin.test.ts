import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { getEditableRole, replaceMemberRole, roleRefusalOf } from './role-admin';

const dialect = new PgDialect();

function fakeTx(...results: (unknown[] | Error)[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        const q = dialect.sqlToQuery(query);
        // Catalog checks of the deploy window (roleScopeUnitsExist): answered here, not recorded.
        if (q.sql.includes('to_regclass(')) return Promise.resolve([{ present: true }]);
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
  role_code: 'training_coordinator',
  scope_unit_id: null,
  row_id: 'r2',
  row_version: 2,
};
const VERSION = 'training_coordinator:r2:2';
const pgError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('db'), { cause: { code, message: '', ...extra } });
const isWrite = (q: { sql: string }) => /^\s*(insert|update|delete)\b/.test(q.sql);

describe('getEditableRole (one role per person, EP-ROLES)', () => {
  it('maps the role and a version token; no role → empty token; null when absent', async () => {
    expect(await getEditableRole(fakeTx([person]).tx, 'p1')).toEqual({
      personId: 'p1',
      membershipId: 'm1',
      membershipStatus: 'active',
      isSelf: false,
      mayManage: true,
      roleCode: 'training_coordinator',
      scopeUnitId: null,
      version: VERSION,
    });
    expect(
      await getEditableRole(
        fakeTx([{ ...person, role_code: null, row_id: null, row_version: null }]).tx,
        'p1',
      ),
    ).toMatchObject({ roleCode: null, version: '' });
    expect(await getEditableRole(fakeTx([]).tx, 'p1')).toBeNull();
  });
});

describe('replaceMemberRole', () => {
  it('locks first, then refuses what it must before writing anything', async () => {
    const cases: [unknown[], string, string][] = [
      [[], VERSION, 'not_found'],
      [[{ ...person, membership_id: null }], '', 'no_account'],
      [[{ ...person, is_self: true }], VERSION, 'own_role'],
      [[{ ...person, may_manage: false }], VERSION, 'not_allowed'],
      [[{ ...person, status: 'revoked' }], VERSION, 'membership_revoked'],
      [[person], 'learner:r1:1', 'version_conflict'],
    ];
    for (const [personRows, version, refusal] of cases) {
      const fake = fakeTx([], personRows);
      expect(await replaceMemberRole(fake.tx, 'p1', version, 'learner')).toEqual({
        ok: false,
        refusal,
      });
      expect(fake.executed[0]?.sql).toContain('private.lock_tenant_roles');
      expect(fake.executed.some(isWrite)).toBe(false);
    }
  });

  it('the same role → nothing written', async () => {
    const fake = fakeTx([], [person]);
    expect(await replaceMemberRole(fake.tx, 'p1', VERSION, 'training_coordinator')).toEqual({
      ok: true,
      before: 'training_coordinator',
      after: 'training_coordinator',
      beforeUnit: null,
      afterUnit: null,
      changed: false,
    });
    expect(fake.executed.some(isWrite)).toBe(false);
  });

  it('refuses a locked (privileged) role, old or new, on the ordinary path', async () => {
    const locked = (code: string) => code === 'hr_manager' || code.startsWith('custom_');
    expect(
      await replaceMemberRole(fakeTx([], [person]).tx, 'p1', VERSION, 'hr_manager', {
        isLocked: locked,
      }),
    ).toEqual({ ok: false, refusal: 'privileged_change' });
    const fromLocked = fakeTx([], [{ ...person, role_code: 'custom_a00000000001' }]);
    expect(
      await replaceMemberRole(fromLocked.tx, 'p1', 'custom_a00000000001:r2:2', 'learner', {
        isLocked: locked,
      }),
    ).toEqual({ ok: false, refusal: 'privileged_change' });
    expect(fromLocked.executed.some(isWrite)).toBe(false);
  });

  it('replaces the row: remove, then give (one role per person)', async () => {
    const fake = fakeTx([], [person], [], []);
    expect(await replaceMemberRole(fake.tx, 'p1', VERSION, 'custom_a00000000001')).toEqual({
      ok: true,
      before: 'training_coordinator',
      after: 'custom_a00000000001',
      beforeUnit: null,
      afterUnit: null,
      changed: true,
    });
    const writes = fake.executed.filter(isWrite);
    expect(writes.map((q) => q.sql.trim().split(/\s+/)[0])).toEqual(['delete', 'insert']);
    expect(writes[1]?.params).toEqual(['m1', 'custom_a00000000001']);
    // Without a unit the insert never names the unit column (an older database has none: expand-first).
    expect(writes[1]?.sql).not.toContain('scope_unit_id');
    // A member without a role: the remove deletes nothing, the role is given.
    const none = fakeTx([], [{ ...person, role_code: null, row_id: null, row_version: null }]);
    expect(await replaceMemberRole(none.tx, 'p1', '', 'learner')).toMatchObject({
      ok: true,
      before: null,
      changed: true,
    });
  });

  it('gives a department-limited role with its unit; a new unit alone replaces the row (EP-ORG, T-M3-09)', async () => {
    const custom = { ...person, role_code: 'custom_a00000000001', scope_unit_id: 'u1' };
    const version = 'custom_a00000000001:r2:2';
    const same = fakeTx([], [custom]);
    expect(
      await replaceMemberRole(same.tx, 'p1', version, 'custom_a00000000001', {}, 'u1'),
    ).toMatchObject({ ok: true, changed: false, beforeUnit: 'u1', afterUnit: 'u1' });
    expect(same.executed.some(isWrite)).toBe(false);

    const moved = fakeTx([], [custom], [], []);
    expect(
      await replaceMemberRole(moved.tx, 'p1', version, 'custom_a00000000001', {}, 'u2'),
    ).toEqual({
      ok: true,
      before: 'custom_a00000000001',
      after: 'custom_a00000000001',
      beforeUnit: 'u1',
      afterUnit: 'u2',
      changed: true,
    });
    const writes = moved.executed.filter(isWrite);
    expect(writes.map((q) => q.sql.trim().split(/\s+/)[0])).toEqual(['delete', 'insert']);
    expect(writes[1]?.sql).toContain('scope_unit_id');
    expect(writes[1]?.params).toEqual(['m1', 'custom_a00000000001', 'u2']);

    const refused = fakeTx(
      [],
      [custom],
      [],
      pgError('23514', { message: 'the unit must be an active unit of the organization' }),
    );
    expect(
      await replaceMemberRole(refused.tx, 'p1', version, 'custom_a00000000001', {}, 'u3'),
    ).toEqual({ ok: false, refusal: 'unit_not_allowed' });
  });

  it('maps database refusals', async () => {
    const fake = fakeTx([], [person], pgError('42501'));
    expect(await replaceMemberRole(fake.tx, 'p1', VERSION, 'learner')).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
  });
});

describe('roleRefusalOf', () => {
  it('maps the guard, last-admin, revoked, unknown-role and concurrency errors; rethrows others', () => {
    expect(roleRefusalOf(pgError('42501'))).toBe('not_allowed');
    expect(
      roleRefusalOf(
        pgError('23514', {
          message: 'the organization must keep at least one active Organization Admin',
        }),
      ),
    ).toBe('last_admin');
    expect(
      roleRefusalOf(pgError('23514', { message: 'roles cannot be given to a revoked membership' })),
    ).toBe('membership_revoked');
    expect(roleRefusalOf(pgError('23503'))).toBe('unknown_role');
    expect(
      roleRefusalOf(
        pgError('23514', { message: 'only a role limited to a department takes a unit' }),
      ),
    ).toBe('unit_not_allowed');
    expect(
      roleRefusalOf(pgError('23503', { constraint_name: 'role_assignments_scope_unit_fkey' })),
    ).toBe('unit_not_allowed');
    expect(roleRefusalOf(pgError('23505'))).toBe('version_conflict');
    expect(roleRefusalOf(pgError('JR001'))).toBe('version_conflict');
    const other = new Error('boom');
    expect(() => roleRefusalOf(other)).toThrow(other);
    expect(() => roleRefusalOf(pgError('23514', { message: 'something else' }))).toThrow();
  });
});
