import { describe, expect, it } from 'vitest';
import { type SupabaseAuthLike, verifyClaims, verifyClaimsStrict } from './verify-claims';

const sub = '11111111-1111-4111-8111-111111111111';

function fakeSupabase(options: {
  claims?: unknown;
  claimsError?: unknown;
  userId?: string | null;
  throwOn?: 'claims' | 'user';
}): SupabaseAuthLike {
  return {
    auth: {
      getClaims: () =>
        options.throwOn === 'claims'
          ? Promise.reject(new Error('network'))
          : Promise.resolve(
              options.claimsError
                ? { data: null, error: options.claimsError }
                : { data: { claims: options.claims }, error: null },
            ),
      getUser: () =>
        options.throwOn === 'user'
          ? Promise.reject(new Error('network'))
          : Promise.resolve({
              data: { user: options.userId ? { id: options.userId } : null },
              error: null,
            }),
    },
  };
}

describe('verifyClaims', () => {
  it('reports not_configured when Supabase is absent', async () => {
    const result = await verifyClaims(null);
    expect(!result.ok && result.error.code).toBe('NOT_CONFIGURED');
  });

  it('returns branded claims for a verified token', async () => {
    const result = await verifyClaims(fakeSupabase({ claims: { sub, role: 'authenticated' } }));
    expect(result.ok && result.value.sub).toBe(sub);
  });

  it('fails closed on verification errors, exceptions and malformed payloads', async () => {
    for (const supabase of [
      fakeSupabase({ claimsError: new Error('invalid signature') }),
      fakeSupabase({ throwOn: 'claims' }),
      fakeSupabase({ claims: { role: 'authenticated' } }),
    ]) {
      const result = await verifyClaims(supabase);
      expect(!result.ok && result.error.code).toBe('UNAUTHENTICATED');
    }
  });
});

describe('verifyClaimsStrict', () => {
  it('requires the Auth server to confirm the same user', async () => {
    const good = await verifyClaimsStrict(
      fakeSupabase({ claims: { sub, role: 'authenticated' }, userId: sub }),
    );
    expect(good.ok).toBe(true);

    const revoked = await verifyClaimsStrict(
      fakeSupabase({ claims: { sub, role: 'authenticated' }, userId: null }),
    );
    expect(!revoked.ok && revoked.error.code).toBe('UNAUTHENTICATED');

    const failing = await verifyClaimsStrict(
      fakeSupabase({ claims: { sub, role: 'authenticated' }, throwOn: 'user' }),
    );
    expect(failing.ok).toBe(false);
  });

  it('short-circuits when claims are invalid or Supabase is absent', async () => {
    expect((await verifyClaimsStrict(null)).ok).toBe(false);
  });
});
