import { appError, ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { Grant } from './authorize';
import { type ActionRuntime, DEFINE_ACTION_MARKER } from './define-action';
import { createDefineQuery } from './define-query';
import { platformPermissions } from './platform-permissions';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = '11111111-1111-4111-8111-111111111111';
const PERSON = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const read = platformPermissions['platform.user.read'];

function claims() {
  const r = brandVerifiedClaims({
    sub: USER,
    role: 'authenticated',
    aal: 'aal1',
    tenant_id: TENANT,
    person_id: PERSON,
  });
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

function runtime(grants: Grant[]) {
  const writeAudit = vi.fn(() => Promise.resolve());
  const rt: ActionRuntime<string> = {
    getClaims: () => Promise.resolve(ok(claims())),
    withUserTx: (_c, fn) => fn('tx'),
    loadGrants: () => Promise.resolve(grants),
    resolveResource: (_tx, ref) =>
      Promise.resolve(
        ref.id === OTHER
          ? {
              type: 'person',
              id: OTHER,
              tenantId: TENANT,
              subjectPersonId: OTHER,
              subjectManagerPersonId: PERSON,
            }
          : null,
      ),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit };
}

describe('defineQuery (authorized reads, ADR 0003 §4)', () => {
  it('runs a scoped list with all grants for the permission and writes no audit event', async () => {
    const grants: Grant[] = [
      { permission: read.code, scope: { type: 'direct_reports' } },
      { permission: read.code, scope: { type: 'own' } },
      { permission: 'platform.org.read', scope: { type: 'tenant' } },
    ];
    const { rt, writeAudit } = runtime(grants);
    const query = createDefineQuery(rt)({
      permission: read,
      input: z.object({}),
      scoped: true,
      handler: ({ ctx }) => Promise.resolve(ok(ctx.grants.map((g) => g.scope.type))),
    });
    expect(await query({})).toEqual(ok(['direct_reports', 'own']));
    expect(writeAudit).not.toHaveBeenCalled();
    expect(DEFINE_ACTION_MARKER in query).toBe(false);
  });

  it('authorizes a single resource: covered → handler; not covered → 404; no permission → 403', async () => {
    const { rt } = runtime([{ permission: read.code, scope: { type: 'direct_reports' } }]);
    const query = createDefineQuery(rt)({
      permission: read,
      input: z.object({ personId: z.uuid() }),
      resource: (input) => ({ type: 'person', id: input.personId }),
      handler: ({ input }) => Promise.resolve(ok(input.personId)),
    });
    expect(await query({ personId: OTHER })).toEqual(ok(OTHER));
    const missing = await query({ personId: PERSON });
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
    const invalid = await query({ personId: 'not-a-uuid' });
    expect(!invalid.ok && invalid.error.code).toBe('VALIDATION_FAILED');

    const { rt: none } = runtime([]);
    const denied = await createDefineQuery(none)({
      permission: read,
      input: z.object({}),
      scoped: true,
      handler: () => Promise.resolve(ok('x')),
    })({});
    expect(!denied.ok && denied.error).toMatchObject(appError('FORBIDDEN'));
  });

  it('ctx.can checks other permissions on the same resource or in any scope (deny by default)', async () => {
    const p = platformPermissions;
    const { rt } = runtime([
      { permission: read.code, scope: { type: 'direct_reports' } },
      { permission: p['platform.role.read'].code, scope: { type: 'direct_reports' } },
      { permission: p['platform.org.read'].code, scope: { type: 'own' } },
      { permission: p['platform.role.assign_privileged'].code, scope: { type: 'tenant' } },
    ]);
    const query = createDefineQuery(rt)({
      permission: read,
      input: z.object({ personId: z.uuid() }),
      resource: (input) => ({ type: 'person', id: input.personId }),
      handler: ({ ctx }) =>
        Promise.resolve(
          ok({
            rolesOfThisPerson: ctx.can(p['platform.role.read'], ctx.resource ?? 'tenant'),
            auditOfThisPerson: ctx.can(p['platform.audit.read'], ctx.resource ?? 'tenant'),
            orgAnyScope: ctx.can(p['platform.org.read'], 'any'),
            orgTenantWide: ctx.can(p['platform.org.read'], 'tenant'),
            otherTenant: ctx.can(p['platform.role.read'], {
              type: 'person',
              id: OTHER,
              tenantId: OTHER,
              subjectManagerPersonId: PERSON,
            }),
            needsAal2: ctx.can(p['platform.role.assign_privileged'], 'tenant'),
            roleReadGrants: ctx.grantsFor(p['platform.role.read']).map((g) => g.scope.type),
            aal2Grants: ctx.grantsFor(p['platform.role.assign_privileged']).length,
          }),
        ),
    });
    expect(await query({ personId: OTHER })).toEqual(
      ok({
        rolesOfThisPerson: true,
        auditOfThisPerson: false,
        orgAnyScope: true,
        orgTenantWide: false,
        otherTenant: false,
        needsAal2: false,
        roleReadGrants: ['direct_reports'],
        aal2Grants: 0,
      }),
    );
  });

  it('keeps `resource` and `scoped` mutually exclusive at compile time', () => {
    const { rt } = runtime([]);
    const defineQuery = createDefineQuery(rt);
    expect(() =>
      // @ts-expect-error — a query is either scoped or about one resource, not both
      defineQuery({
        permission: read,
        input: z.object({}),
        scoped: true,
        resource: () => ({ type: 'person', id: OTHER }),
        handler: () => Promise.resolve(ok(null)),
      }),
    ).not.toThrow();
  });
});
