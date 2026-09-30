import { ok } from '@jadarat/platform-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({
  getVerifiedClaims: vi.fn(() => Promise.resolve({ ok: true, value: 'normal' })),
  getVerifiedClaimsStrict: vi.fn(() => Promise.resolve({ ok: true, value: 'strict' })),
}));
const db = vi.hoisted(() => ({
  withUserTx: vi.fn((_claims: unknown, fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
  schema: { auditEvents: { name: 'audit_events' } },
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

  it('denies by default until role assignments and resource resolvers exist (M2)', async () => {
    const tx = 'tx' as never;
    const claims = { sub: 'u', tenant_id: 't' } as never;
    expect(await defaultActionRuntime.loadGrants(tx, claims)).toEqual([]);
    expect(
      await defaultActionRuntime.resolveResource(tx, { type: 'x', id: '1' }, claims),
    ).toBeNull();
  });

  it('writes audit events with the actor from verified claims (no impersonator forging)', async () => {
    const values = vi.fn(() => Promise.resolve());
    const insert = vi.fn(() => ({ values }));
    const actor = {
      userId: 'u1',
      personId: 'p1',
      tenantId: 't1',
      aal: 'aal1',
      impersonatorUserId: null,
    } as never;
    await defaultActionRuntime.writeAudit({ insert } as never, actor, {
      action: 'tms.session.draft_created',
    });
    expect(insert).toHaveBeenCalledWith(db.schema.auditEvents);
    expect(values).toHaveBeenCalledWith({
      tenantId: 't1',
      actorUserId: 'u1',
      actorPersonId: 'p1',
      impersonatorUserId: null,
      action: 'tms.session.draft_created',
      entityType: null,
      entityId: null,
      data: {},
    });
  });

  it('logs unexpected errors without messages or personal data, with the correlation id', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    defaultActionRuntime.logError(new TypeError('secret: user@example.com'), {
      permission: 'tms.session.create',
      correlationId: 'c-1',
    });
    defaultActionRuntime.logError('boom', {
      permission: 'tms.session.create',
      correlationId: 'c-2',
    });
    expect(spy).toHaveBeenNthCalledWith(1, '[defineAction] unexpected error', {
      permission: 'tms.session.create',
      correlationId: 'c-1',
      error: 'TypeError',
    });
    expect(spy).toHaveBeenNthCalledWith(2, '[defineAction] unexpected error', {
      permission: 'tms.session.create',
      correlationId: 'c-2',
      error: 'string',
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('example.com');
    spy.mockRestore();
  });
});
