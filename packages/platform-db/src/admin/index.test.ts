import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthAdminError,
  assertAdminOperation,
  createRecoveryLinkIssuer,
  createServiceRoleSupabaseClient,
  withAdminTx,
} from './index';

const op = { reason: 'Provision tenant for signed contract', actor: 'job:tenant-provisioning' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('admin entry point', () => {
  it('requires a meaningful reason and an actor for every operation', () => {
    expect(() => {
      assertAdminOperation({ reason: 'x', actor: 'a' });
    }).toThrow('meaningful reason');
    expect(() => {
      assertAdminOperation({ reason: 'long enough reason', actor: ' ' });
    }).toThrow('actor');
    expect(() => {
      assertAdminOperation(op);
    }).not.toThrow();
  });

  it('fails closed when admin database access is not configured', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    await expect(withAdminTx(op, () => Promise.resolve(1))).rejects.toThrow('not configured');
  });

  it('fails closed when the Supabase secret key is not configured', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    expect(() => createServiceRoleSupabaseClient(op)).toThrow('not configured');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_test');
    expect(createServiceRoleSupabaseClient(op).auth).toBeDefined();
  });
});

describe('recovery links through the Auth admin API (T-M2-17, worker only)', () => {
  const settings = { url: 'https://auth.example.test', secretKey: 'sb_secret_sample_only' };
  const HASH = 'sample0token0hash'.padEnd(56, '0'); // shape only
  const linkOp = { reason: 'Recovery links for password-reset e-mails', actor: 'job:test' };

  function answer(status: number, body: unknown) {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('asks generate_link for a recovery link and keeps only the token hash', async () => {
    const fetchMock = answer(200, {
      id: 'u1',
      email: 'sara@example.test',
      action_link: 'https://auth.example.test/auth/v1/verify?token=x&type=recovery',
      email_otp: '0000000000',
      hashed_token: HASH,
      verification_type: 'recovery',
      redirect_to: 'https://tms.example.test',
    });
    const result = await createRecoveryLinkIssuer(settings, linkOp).issue('sara@example.test');
    expect(result).toEqual({ status: 'issued', hashedToken: HASH });
    // Nothing else of Auth's answer (the one-time code, Auth's own /verify link) leaves the function.
    expect(Object.keys(result)).toEqual(['status', 'hashedToken']);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://auth.example.test/auth/v1/admin/generate_link');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      type: 'recovery',
      email: 'sara@example.test',
    });
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${settings.secretKey}`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('an unknown address is an answer, not an error (GoTrue: 404 user_not_found)', async () => {
    answer(404, { code: 'user_not_found', msg: 'User with this email not found' });
    expect(await createRecoveryLinkIssuer(settings, linkOp).issue('nobody@example.test')).toEqual({
      status: 'unknown_account',
    });
  });

  it('classifies failures: temporary (retry later) or refused; codes only, never Auth text', async () => {
    // GoTrue's error body: { code: <HTTP status>, error_code, msg }.
    const cases: [number, unknown, string, boolean][] = [
      [
        500,
        { code: 500, error_code: 'unexpected_failure', msg: 'db down: sara@example.test' },
        'AUTH_HTTP_500',
        true,
      ],
      [
        429,
        { code: 429, error_code: 'over_request_rate_limit', msg: 'slow down' },
        'over_request_rate_limit',
        true,
      ],
      [401, { code: 401, msg: 'invalid JWT' }, 'AUTH_ADMIN_KEY', true],
      [403, { code: 403, error_code: 'not_admin', msg: 'no' }, 'AUTH_ADMIN_KEY', true],
      [
        400,
        { code: 400, error_code: 'email_address_invalid', msg: 'x' },
        'email_address_invalid',
        false,
      ],
      [422, { code: 422, msg: 'Unable to validate email address' }, 'AUTH_HTTP_422', false],
    ];
    for (const [status, body, code, temporary] of cases) {
      answer(status, body);
      const error = await createRecoveryLinkIssuer(settings, linkOp)
        .issue('sara@example.test')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AuthAdminError);
      expect(error).toMatchObject({ code, temporary });
      expect((error as Error).message).not.toContain('example.test');
    }
  });

  it('a network failure or an answer without a usable token hash is temporary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );
    await expect(
      createRecoveryLinkIssuer(settings, linkOp).issue('a@example.test'),
    ).rejects.toMatchObject({ temporary: true });
    answer(200, { id: 'u1', hashed_token: 'bad hash with spaces' });
    await expect(
      createRecoveryLinkIssuer(settings, linkOp).issue('a@example.test'),
    ).rejects.toMatchObject({ code: 'AUTH_UNEXPECTED_ANSWER', temporary: true });
  });

  it('requires a meaningful reason and an actor', () => {
    expect(() => createRecoveryLinkIssuer(settings, { reason: 'x', actor: 'job' })).toThrow(
      'meaningful reason',
    );
  });
});
