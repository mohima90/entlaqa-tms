import { ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from '../define-action';
import { createDefineQuery } from '../define-query';
import type { Grant } from '../authorize';
import { grantsForAssignments } from '../role-grants';
import type { SystemRoleCode } from '../system-roles';
import { rolesPageQueryDefinition } from './roles-page';

const db = vi.hoisted(() => ({ countMembersByRole: vi.fn() }));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;

function runtime(grants: readonly Grant[]) {
  const rt: ActionRuntime<UserTx> = {
    getClaims: () => {
      const r = brandVerifiedClaims({
        sub: '11111111-1111-4111-8111-111111111111',
        role: 'authenticated',
        aal: 'aal1',
        tenant_id: '22222222-2222-4222-8222-222222222222',
        person_id: '33333333-3333-4333-8333-333333333333',
      });
      if (!r.ok) throw new Error('fixture');
      return Promise.resolve(ok(r.value));
    },
    withUserTx: (_c, fn) => fn(TX),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: true }),
    loadGrants: () => Promise.resolve(grants),
    resolveResource: () => Promise.resolve(null),
    writeAudit: vi.fn(() => Promise.resolve()),
    logError: vi.fn(),
  };
  return rt;
}
const forRoles = (roles: SystemRoleCode[]) =>
  grantsForAssignments(
    roles.map((roleCode) => ({ roleCode })),
    { headedDepartmentIds: [] },
  );

beforeEach(() => {
  vi.clearAllMocks();
  db.countMembersByRole.mockResolvedValue({ learner: 3 });
});

describe('roles page query', () => {
  it('tenant-wide role.read: the page, with member counts when users are readable too', async () => {
    const query = createDefineQuery(runtime(forRoles(['training_coordinator'])))(
      rolesPageQueryDefinition(),
    );
    expect(await query({})).toEqual(ok({ memberCounts: { learner: 3 } }));
    expect(db.countMembersByRole).toHaveBeenCalledWith(TX);
  });

  it('without user.read tenant-wide: no counts; scoped or no role.read: FORBIDDEN', async () => {
    const roleReadOnly: Grant[] = [{ permission: 'platform.role.read', scope: { type: 'tenant' } }];
    expect(await createDefineQuery(runtime(roleReadOnly))(rolesPageQueryDefinition())({})).toEqual(
      ok({ memberCounts: null }),
    );
    for (const roles of [
      ['line_manager'],
      ['department_head'],
      ['learner'],
    ] as SystemRoleCode[][]) {
      const result = await createDefineQuery(runtime(forRoles(roles)))(rolesPageQueryDefinition())(
        {},
      );
      expect(!result.ok && result.error.code, roles[0]).toBe('FORBIDDEN');
    }
  });
});
