import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  createCustomRole,
  customRoleRefusalOf,
  deleteCustomRole,
  getCustomRole,
  listCustomRoles,
  updateCustomRole,
} from './custom-roles';

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

const raw = {
  id: 'r1',
  code: 'custom_a00000000001',
  name_ar: 'مراجع الدورات',
  name_en: 'Course reviewer',
  description: null,
  data_scope: 'organization',
  permissions: ['platform.org.read', 'platform.user.read'],
  member_count: '0',
  invitation_count: 0,
  version: 3,
};
const row = {
  id: 'r1',
  code: 'custom_a00000000001',
  nameAr: 'مراجع الدورات',
  nameEn: 'Course reviewer',
  description: null,
  dataScope: 'organization',
  permissions: ['platform.org.read', 'platform.user.read'],
  memberCount: 0,
  pendingInvitationCount: 0,
  version: 3,
};
const input = {
  nameEn: 'Course reviewer',
  nameAr: 'مراجع الدورات',
  description: null,
  dataScope: 'organization' as const,
  permissions: ['platform.user.read', 'platform.role.read'],
};
const pgError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('db'), { cause: { code, message: '', ...extra } });
const writes = (executed: { sql: string }[]) =>
  executed.filter((q) => /^\s*(insert|update|delete)\b/.test(q.sql)).map((q) => q.sql.trim());

describe('custom roles (FR-IAM-07, EP-ROLES)', () => {
  it('lists and reads roles with their permissions and holders', async () => {
    expect(await listCustomRoles(fakeTx([raw]).tx)).toEqual([row]);
    expect(await getCustomRole(fakeTx([{ ...raw, permissions: null }]).tx, { id: 'r1' })).toEqual({
      ...row,
      permissions: [],
    });
    const byCode = fakeTx([]);
    expect(await getCustomRole(byCode.tx, { code: 'custom_x' })).toBeNull();
    expect(byCode.executed[0]?.params).toEqual(['custom_x']);
  });

  it('creates the role, then its permissions, under the role lock', async () => {
    const fake = fakeTx([], [{ id: 'r1' }], [], [], [raw]);
    expect(await createCustomRole(fake.tx, input)).toEqual({ ok: true, before: null, after: row });
    expect(fake.executed[0]?.sql).toContain('private.lock_tenant_roles');
    expect(writes(fake.executed)).toHaveLength(3);
    expect(fake.executed[1]?.params).toEqual([
      'Course reviewer',
      'مراجع الدورات',
      null,
      'organization',
    ]);
    const taken = fakeTx(
      [],
      pgError('23505', { constraint_name: 'custom_roles_tenant_name_ar_uq' }),
    );
    expect(await createCustomRole(taken.tx, input)).toEqual({
      ok: false,
      refusal: 'name_ar_taken',
    });
  });

  it('updates: removed permissions first, then the role, then added permissions', async () => {
    const fake = fakeTx([], [raw], [], [], [], [raw]);
    expect(await updateCustomRole(fake.tx, 'r1', 3, input)).toMatchObject({
      ok: true,
      before: row,
    });
    const w = writes(fake.executed);
    expect(w[0]).toMatch(/^delete from platform\.custom_role_permissions/);
    expect(w[1]).toMatch(/^update platform\.custom_roles/);
    expect(w[2]).toMatch(/^insert into platform\.custom_role_permissions/);
    expect(fake.executed[2]?.params).toEqual(['r1', 'platform.org.read']);
    expect(fake.executed[4]?.params).toEqual(['r1', 'platform.role.read']);
  });

  it('refuses an unknown role, a stale version and database refusals', async () => {
    expect(await updateCustomRole(fakeTx([], []).tx, 'r1', 3, input)).toEqual({
      ok: false,
      refusal: 'not_found',
    });
    expect(await updateCustomRole(fakeTx([], [raw]).tx, 'r1', 2, input)).toEqual({
      ok: false,
      refusal: 'version_conflict',
    });
    expect(
      await updateCustomRole(fakeTx([], [raw], [], pgError('JR003')).tx, 'r1', 3, {
        ...input,
        dataScope: 'team',
      }),
    ).toEqual({ ok: false, refusal: 'needs_organization_scope' });
  });

  it('deletes only a role nobody holds, with the numbers otherwise', async () => {
    const fake = fakeTx([], [raw], []);
    expect(await deleteCustomRole(fake.tx, 'r1', 3)).toEqual({
      ok: true,
      before: row,
      after: null,
    });
    expect(writes(fake.executed)).toEqual([
      expect.stringMatching(/^delete from platform\.custom_roles/),
    ]);
    const held = fakeTx([], [{ ...raw, member_count: 2, invitation_count: '1' }]);
    expect(await deleteCustomRole(held.tx, 'r1', 3)).toEqual({
      ok: false,
      refusal: 'in_use',
      holders: { members: 2, invitations: 1 },
    });
    expect(writes(held.executed)).toEqual([]);
    expect(await deleteCustomRole(fakeTx([], []).tx, 'r1', 3)).toMatchObject({
      refusal: 'not_found',
    });
    expect(await deleteCustomRole(fakeTx([], [raw]).tx, 'r1', 1)).toMatchObject({
      refusal: 'version_conflict',
    });
    expect(await deleteCustomRole(fakeTx([], [raw], pgError('JR002')).tx, 'r1', 3)).toEqual({
      ok: false,
      refusal: 'in_use',
    });
  });

  it('maps database refusals; rethrows anything else', () => {
    expect(customRoleRefusalOf(pgError('42501'))).toBe('not_allowed');
    expect(customRoleRefusalOf(pgError('JR002'))).toBe('in_use');
    expect(customRoleRefusalOf(pgError('JR003'))).toBe('needs_organization_scope');
    expect(
      customRoleRefusalOf(pgError('23505', { constraint_name: 'custom_roles_tenant_name_en_uq' })),
    ).toBe('name_en_taken');
    expect(() => customRoleRefusalOf(pgError('23505', { constraint_name: 'other' }))).toThrow();
    expect(() => customRoleRefusalOf(new Error('boom'))).toThrow('boom');
  });
});
