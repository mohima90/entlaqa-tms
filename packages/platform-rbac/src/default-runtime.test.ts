import { ok } from '@jadarat/platform-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({
  getVerifiedClaims: vi.fn(() => Promise.resolve({ ok: true, value: 'normal' })),
  getVerifiedClaimsStrict: vi.fn(() => Promise.resolve({ ok: true, value: 'strict' })),
}));
const db = vi.hoisted(() => ({
  withUserTx: vi.fn((_claims: unknown, fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
  queuedWorkIn: vi.fn((tx: unknown) => tx === 'tx-with-event'),
  isPassiveRead: vi.fn((name: string) => name === 'platform.user_import.status'),
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
      // One role per person (EP-ROLES): a custom «Line Manager» role (their team), ending in 2027.
      roles: [
        {
          roleCode: 'custom_000000000001',
          validFrom: null,
          validUntil: new Date('2027-01-01T00:00:00Z'),
        },
      ],
      headedDepartmentIds: ['d1'],
      customRoles: [
        {
          code: 'custom_000000000001',
          dataScope: 'team',
          permissions: ['platform.org.read', 'platform.role.read', 'platform.user.read'],
        },
      ],
    }),
  ),
}));

vi.mock('@jadarat/platform-identity/next', () => identity);
const kick = vi.hoisted(() => ({ kickWorkerAfterResponse: vi.fn() }));

vi.mock('@jadarat/platform-db', () => db);
vi.mock('@jadarat/platform-jobs/kick/next', () => kick);

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

  it('runs units of work through platform-db withUserTx, with the retry choice of the action', async () => {
    const claims = { sub: 'u' } as never;
    const options = { retryOnConflict: true };
    expect(
      await defaultActionRuntime.withUserTx(claims, (tx) => Promise.resolve(tx), options),
    ).toBe('tx');
    expect(db.withUserTx).toHaveBeenCalledWith(claims, expect.any(Function), options);
  });

  it('passes a passive read on only when platform-db lists it (integration review L1)', async () => {
    const claims = { sub: 'u' } as never;
    const passive = { retryOnConflict: true, passiveRead: 'platform.user_import.status' };
    await defaultActionRuntime.withUserTx(claims, (tx) => Promise.resolve(tx), passive);
    expect(db.withUserTx).toHaveBeenCalledWith(claims, expect.any(Function), passive);
    await expect(
      defaultActionRuntime.withUserTx(claims, (tx) => Promise.resolve(tx), {
        passiveRead: 'platform.users.list',
      }),
    ).rejects.toThrow('not an allow-listed passive read');
    expect(db.withUserTx).toHaveBeenCalledTimes(1);
  });

  it('asks the database whether the session may act and counts as AAL2 (T-M2-10, review L1/H1)', async () => {
    expect(await defaultActionRuntime.loadSessionFacts('tx' as never)).toEqual({
      active: true,
      aal2: false,
    });
    expect(db.loadSessionFacts).toHaveBeenCalledWith('tx');
  });

  it("loads grants from the member's role, custom roles included (EP-ROLES), and resolves no resources yet", async () => {
    const tx = 'tx' as never;
    const claims = { sub: 'u', tenant_id: 't' } as never;
    expect(await defaultActionRuntime.loadGrants(tx, claims)).toEqual([
      // The custom role's permissions with its scope (the structure is organization-wide by nature).
      {
        permission: 'platform.org.read',
        scope: { type: 'tenant' },
        validUntil: new Date('2027-01-01T00:00:00Z'),
      },
      {
        permission: 'platform.role.read',
        scope: { type: 'direct_reports' },
        validUntil: new Date('2027-01-01T00:00:00Z'),
      },
      {
        permission: 'platform.user.read',
        scope: { type: 'direct_reports' },
        validUntil: new Date('2027-01-01T00:00:00Z'),
      },
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

  it('warns about a transaction retried after a conflict: permission and SQLSTATE only', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    defaultActionRuntime.logTransactionRetry?.({
      permission: 'platform.user.deactivate',
      sqlState: '40P01',
    });
    const [line] = spy.mock.calls.map(
      ([written]) => JSON.parse(String(written)) as Record<string, unknown>,
    );
    expect(line).toMatchObject({
      level: 'warn',
      msg: 'transaction retried after a conflict',
      permission: 'platform.user.deactivate',
      reason: 'transaction_conflict',
      error_code: '40P01',
    });
    spy.mockRestore();
  });

  it('warns about a refusal after the commit: permission and code only (integration review L-b)', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    defaultActionRuntime.logAfterCommitRefusal?.({
      permission: 'platform.user.import',
      code: 'FILE_STORAGE_UNAVAILABLE',
    });
    const [line] = spy.mock.calls.map(
      ([written]) => JSON.parse(String(written)) as Record<string, unknown>,
    );
    expect(line).toMatchObject({
      level: 'warn',
      msg: 'action refused after its commit',
      permission: 'platform.user.import',
      reason: 'after_commit_refused',
      error_code: 'FILE_STORAGE_UNAVAILABLE',
    });
    spy.mockRestore();
  });
  it('detects emitted events and asks for a worker pass after the response (ADR 0005 §1 amendment)', async () => {
    expect(await defaultActionRuntime.queuedWork?.('tx-with-event' as never)).toBe(true);
    expect(await defaultActionRuntime.queuedWork?.('tx' as never)).toBe(false);
    await defaultActionRuntime.requestWorkerPass?.({ permission: 'platform.user.invite' });
    expect(kick.kickWorkerAfterResponse).toHaveBeenCalledWith('action:platform.user.invite');
  });
});
