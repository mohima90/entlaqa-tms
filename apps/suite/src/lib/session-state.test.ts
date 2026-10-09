import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { describe, expect, it, vi } from 'vitest';
import { type SessionStateDeps, getSessionState, redirectFor } from './session-state';

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const base = {
  sub: '11111111-1111-4111-8111-111111111111',
  role: 'authenticated',
  aal: 'aal1',
  session_id: '33333333-3333-4333-8333-333333333333',
};

function deps(
  payload: Record<string, unknown> | null,
  tenantInDatabase: boolean,
  access = 'invalid',
) {
  const claims = payload ? brandVerifiedClaims(payload) : null;
  const getCurrentTenant = vi.fn(() =>
    Promise.resolve(tenantInDatabase ? { tenantId: TENANT, nameAr: 'أ', nameEn: null } : null),
  );
  const getSessionAccess = vi.fn(() => Promise.resolve({ state: access, mfaDeadline: null }));
  return {
    getVerifiedClaims: vi.fn(() =>
      Promise.resolve(
        claims ?? { ok: false, error: { code: 'UNAUTHENTICATED', status: 401, messageKey: 'x' } },
      ),
    ),
    withUserTx: vi.fn((_claims: unknown, fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    getCurrentTenant,
    getSessionAccess,
  } as unknown as SessionStateDeps & {
    getCurrentTenant: typeof getCurrentTenant;
    getSessionAccess: typeof getSessionAccess;
  };
}

const configured = { auth: true, database: true };

describe('getSessionState (no redirect loops between the auth pages)', () => {
  it('is signed out when sign-in is not configured or there is no valid token', async () => {
    const d = deps({ ...base, tenant_id: TENANT }, true);
    expect(await getSessionState({ auth: false, database: true }, d)).toEqual({
      kind: 'signed-out',
    });
    expect(d.getVerifiedClaims).not.toHaveBeenCalled();
    expect(await getSessionState(configured, deps(null, true))).toEqual({ kind: 'signed-out' });
  });

  it('has no organization while the token carries no tenant claim', async () => {
    const d = deps(base, true);
    expect(await getSessionState(configured, d)).toEqual({ kind: 'no-organization' });
    expect(d.getCurrentTenant).not.toHaveBeenCalled();
  });

  it('is in an organization only when the database accepts the tenant claim', async () => {
    const accepted = await getSessionState(configured, deps({ ...base, tenant_id: TENANT }, true));
    expect(accepted.kind === 'organization' && accepted.tenant?.tenantId).toBe(TENANT);

    // Session revoked / membership suspended: the token still verifies, the database says no.
    expect(await getSessionState(configured, deps({ ...base, tenant_id: TENANT }, false))).toEqual({
      kind: 'signed-out',
    });
  });

  it('trusts the verified tenant claim when no database is configured (preview deployments)', async () => {
    const d = deps({ ...base, tenant_id: TENANT }, false);
    const state = await getSessionState({ auth: true, database: false }, d);
    expect(state.kind === 'organization' && state.tenant).toBeNull();
    expect(d.getCurrentTenant).not.toHaveBeenCalled();
  });
});

describe('sessions the database refuses (T-M2-10)', () => {
  const tenantClaims = { ...base, tenant_id: TENANT };

  it('an MFA code or app needed; otherwise signed out', async () => {
    for (const access of ['mfa_challenge', 'mfa_enrol']) {
      expect(await getSessionState(configured, deps(tenantClaims, false, access))).toEqual({
        kind: 'mfa-required',
      });
    }
    expect(await getSessionState(configured, deps(tenantClaims, false, 'invalid'))).toEqual({
      kind: 'signed-out',
    });
  });

  it('asks why only when the tenant was refused (one read for every other request)', async () => {
    const d = deps(tenantClaims, true, 'mfa_challenge');
    expect((await getSessionState(configured, d)).kind).toBe('organization');
    expect(d.getSessionAccess).not.toHaveBeenCalled();
  });

  it('sends each state to its page, never in a loop', () => {
    const pages = ['suite', 'sign-in', 'select-organization', 'mfa'] as const;
    const states = [
      { kind: 'signed-out' },
      { kind: 'mfa-required' },
      { kind: 'no-organization' },
    ] as const;
    const targets = states.map((state) => pages.map((page) => redirectFor('ar', state, page)));
    expect(targets).toEqual([
      ['/ar/sign-in', null, '/ar/sign-in', '/ar/sign-in'],
      ['/ar/mfa', '/ar/mfa', '/ar/mfa', null],
      ['/ar/select-organization', '/ar/select-organization', null, '/ar/select-organization'],
    ]);
  });
});
