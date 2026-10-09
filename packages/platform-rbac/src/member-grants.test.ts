import { appError, err, ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { describe, expect, it, vi } from 'vitest';
import type { ActionRuntime } from './define-action';
import { createLoadMemberGrants } from './member-grants';

function claims(extra: Record<string, unknown>) {
  const r = brandVerifiedClaims({
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'authenticated',
    aal: 'aal1',
    ...extra,
  });
  if (!r.ok) throw new Error('fixture');
  return r.value;
}

function runtime(over: Partial<ActionRuntime<string>>): ActionRuntime<string> {
  return {
    getClaims: () =>
      Promise.resolve(ok(claims({ tenant_id: '22222222-2222-4222-8222-222222222222' }))),
    withUserTx: (_c, fn) => fn('tx'),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: true }),
    loadGrants: () =>
      Promise.resolve([
        { permission: 'platform.user.read', scope: { type: 'tenant' } },
        {
          permission: 'platform.role.read',
          scope: { type: 'tenant' },
          validUntil: new Date('2026-01-01T00:00:00Z'),
        },
        {
          permission: 'platform.org.read',
          scope: { type: 'tenant' },
          validFrom: new Date('2027-01-01T00:00:00Z'),
        },
      ]),
    resolveResource: () => Promise.resolve(null),
    writeAudit: vi.fn(),
    logError: vi.fn(),
    ...over,
  };
}

describe('loadMemberGrants', () => {
  it('returns the grants in force now', async () => {
    const load = createLoadMemberGrants(runtime({}));
    expect(await load(new Date('2026-10-05T00:00:00Z'))).toEqual(
      ok([{ permission: 'platform.user.read', scope: { type: 'tenant' } }]),
    );
  });

  it('fails without a session or without an organization', async () => {
    const signedOut = createLoadMemberGrants(
      runtime({ getClaims: () => Promise.resolve(err(appError('UNAUTHENTICATED'))) }),
    );
    expect(await signedOut()).toEqual(err(appError('UNAUTHENTICATED')));
    const noTenant = createLoadMemberGrants(
      runtime({ getClaims: () => Promise.resolve(ok(claims({}))) }),
    );
    const result = await noTenant();
    expect(!result.ok && result.error.code).toBe('FORBIDDEN');
  });

  it('logs a database failure and returns INTERNAL_ERROR with a correlation id', async () => {
    const logError = vi.fn();
    const load = createLoadMemberGrants(
      runtime({ withUserTx: () => Promise.reject(new Error('db down')), logError }),
    );
    const result = await load();
    expect(!result.ok && result.error.code).toBe('INTERNAL_ERROR');
    expect(!result.ok && result.error.correlationId).toEqual(expect.any(String));
    expect(logError).toHaveBeenCalledWith(expect.any(Error), {
      permission: 'navigation',
      correlationId: expect.any(String),
    });
  });
});
