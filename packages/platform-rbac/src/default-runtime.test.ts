import { ok } from '@jadarat/platform-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({
  getVerifiedClaims: vi.fn(() => Promise.resolve({ ok: true, value: 'normal' })),
  getVerifiedClaimsStrict: vi.fn(() => Promise.resolve({ ok: true, value: 'strict' })),
}));
const db = vi.hoisted(() => ({
  withUserTx: vi.fn((_claims: unknown, fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
  insertAuditEvent: vi.fn(() => Promise.resolve()),
  loadSessionFacts: vi.fn(() => Promise.resolve({ active: true, aal2: false })),
  loadPersonResourceFacts: vi.fn((_tx: unknown, id: string) =>
    Promise.resolve(
      id === '55555555-5555-4555-8555-555555555555'
        ? {
            personId: id,
            tenantId: 't',
            managerPersonId: 'm1',
            managerChain: ['m1', 'm0'],
            departmentId: 'd2',
            departmentAncestorIds: ['d1'],
            branchId: 'b1',
          }
        : null,
    ),
  ),
  loadMemberAuthorizationFacts: vi.fn(() =>
    Promise.resolve({
      roles: [
        { roleCode: 'line_manager', validFrom: null, validUntil: new Date('2027-01-01T00:00:00Z') },
        { roleCode: 'department_head', validFrom: null, validUntil: null },
      ],
      headedDepartmentIds: ['d1'],
    }),
  ),
}));

vi.mock('@jadarat/platform-identity/next', () => identity);
vi.mock('@jadarat/platform-db', () => db);

const { defaultActionRuntime } = await import('./default-runtime');

afterEach(() => {
  vi.clearAllMocks();
});

describe('default defineAction runtime', () => {
  it('uses getClaims() normally and the getUser() round-trip when strict (ADR 0003 §2)', async () => {
    expect(await defaultActionRuntime.getClaims({ strict: false })).toEqual(ok('normal'));
    expect(identity.getVerifiedClaims).toHaveBeenCalledOnce();
    expect(identity.getVerifiedClaimsStrict).not.toHaveBeenCalled();

    expect(await defaultActionRuntime.getClaims({ strict: true })).toEqual(ok('strict'));
    expect(identity.getVerifiedClaimsStrict).toHaveBeenCalledOnce();
    expect(identity.getVerifiedClaims).toHaveBeenCalledOnce();
  });

  it('runs units of work through platform-db withUserTx', async () => {
    const claims = { sub: 'u' } as never;
    expect(await defaultActionRuntime.withUserTx(claims, (tx) => Promise.resolve(tx))).toBe('tx');
    expect(db.withUserTx).toHaveBeenCalledWith(claims, expect.any(Function));
  });

  it('asks the database whether the session may act and counts as AAL2 (T-M2-10, review L1/H1)', async () => {
    expect(await defaultActionRuntime.loadSessionFacts('tx' as never)).toEqual({
      active: true,
      aal2: false,
    });
    expect(db.loadSessionFacts).toHaveBeenCalledWith('tx');
  });

  it("loads grants from the member's roles (T-M2-03) and resolves no resources yet", async () => {
    const tx = 'tx' as never;
    const claims = { sub: 'u', tenant_id: 't' } as never;
    expect(await defaultActionRuntime.loadGrants(tx, claims)).toEqual([
      {
        permission: 'platform.user.read',
        scope: { type: 'direct_reports' },
        validUntil: new Date('2027-01-01T00:00:00Z'),
      },
      {
        permission: 'platform.role.read',
        scope: { type: 'direct_reports' },
        validUntil: new Date('2027-01-01T00:00:00Z'),
      },
      {
        permission: 'platform.org.read',
        scope: { type: 'tenant' },
        validUntil: new Date('2027-01-01T00:00:00Z'),
      },
      {
        permission: 'platform.user.read',
        scope: { type: 'org_units', orgUnitIds: ['d1'], includeDescendants: true },
      },
      {
        permission: 'platform.role.read',
        scope: { type: 'org_units', orgUnitIds: ['d1'], includeDescendants: true },
      },
      { permission: 'platform.org.read', scope: { type: 'tenant' } },
      // Every member: their own profile (FR-IAM-16).
      { permission: 'platform.profile.manage_own', scope: { type: 'own' } },
    ]);
    expect(db.loadMemberAuthorizationFacts).toHaveBeenCalledWith(tx);
    expect(
      await defaultActionRuntime.resolveResource(tx, { type: 'x', id: '1' }, claims),
    ).toBeNull();
  });

  it('resolves person resources with their manager chain, department ancestors and branch', async () => {
    const tx = 'tx' as never;
    const claims = { sub: 'u', tenant_id: 't' } as never;
    const id = '55555555-5555-4555-8555-555555555555';
    expect(await defaultActionRuntime.resolveResource(tx, { type: 'person', id }, claims)).toEqual({
      type: 'person',
      id,
      tenantId: 't',
      subjectPersonId: id,
      subjectManagerPersonId: 'm1',
      subjectManagerChain: ['m1', 'm0'],
      orgUnitId: 'd2',
      orgUnitAncestorIds: ['d1'],
      branchId: 'b1',
    });
    expect(
      await defaultActionRuntime.resolveResource(
        tx,
        { type: 'person', id: '66666666-6666-4666-8666-666666666666' },
        claims,
      ),
    ).toBeNull();
    expect(
      await defaultActionRuntime.resolveResource(tx, { type: 'person', id: 'nope' }, claims),
    ).toBeNull();
    expect(db.loadPersonResourceFacts).toHaveBeenCalledTimes(2);
  });

  it('writes audit events through the platform-db audit writer (actor from verified claims)', async () => {
    const actor = {
      userId: 'u1',
      personId: 'p1',
      tenantId: 't1',
      aal: 'aal1',
      impersonatorUserId: null,
    } as never;
    const record = { action: 'tms.session.draft_created' };
    await defaultActionRuntime.writeAudit('tx' as never, actor, record);
    expect(db.insertAuditEvent).toHaveBeenCalledWith('tx', actor, record);
  });

  it('reports unexpected errors without messages or personal data, with the correlation id', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    defaultActionRuntime.logError(new TypeError('secret: user@example.com'), {
      permission: 'tms.session.create',
      correlationId: 'c-1',
    });
    defaultActionRuntime.logError('boom', {
      permission: 'tms.session.create',
      correlationId: 'c-2',
    });
    const lines = spy.mock.calls.map(
      ([line]) => JSON.parse(String(line)) as Record<string, unknown>,
    );
    expect(lines[0]).toMatchObject({
      level: 'error',
      msg: 'unexpected error',
      permission: 'tms.session.create',
      correlation_id: 'c-1',
      error_name: 'TypeError',
    });
    expect(lines[1]).toMatchObject({ correlation_id: 'c-2', error_name: 'string' });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('example.com');
    spy.mockRestore();
  });
});
