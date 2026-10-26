import { appError, err, ok } from '@jadarat/platform-core';
import { PlatformConsoleError } from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import {
  type PlatformConsoleDeps,
  createOrganizationFromConsole,
  isPlatformAdminSession,
  loadPlatformOrganizations,
  platformConsoleAccess,
  reissueOrganizationAdminCode,
  viewOrganizationAdminCode,
} from './platform-console';
import { verifyClaims } from './verify-claims';

const TENANT = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';
// Verified the way the app verifies them (a fake Auth client's getClaims).
const verified = await verifyClaims({
  auth: {
    getClaims: () =>
      Promise.resolve({
        data: {
          claims: {
            sub: '00000000-0000-4000-8000-0000000000f1',
            role: 'authenticated',
            session_id: '10000000-0000-4000-8000-0000000000f1',
            aal: 'aal1',
            exp: 4102444800,
          },
        },
        error: null,
      }),
    getUser: () => Promise.resolve({ data: { user: null }, error: null }),
  },
});
if (!verified.ok) throw new Error('test claims did not verify');
const CLAIMS = verified.value;
const CODE = {
  inviteCode: 'K7M2PQ9XHT4W',
  locale: 'en' as const,
  expiresAt: new Date('2026-10-23'),
};
const INPUT = {
  slug: 'entlaqa',
  nameAr: 'إنطلاقة',
  nameEn: 'ENTLAQA',
  adminEmail: 'admin@entlaqa.test',
  locale: 'en' as const,
};

function setup(
  options: {
    claims?: 'ok' | 'signed-out' | 'strict-refused';
    admin?: boolean;
    refuse?: unknown;
  } = {},
) {
  const strictCalls: boolean[] = [];
  const deps: PlatformConsoleDeps = {
    getClaims: vi.fn(({ strict }: { readonly strict: boolean }) => {
      strictCalls.push(strict);
      if (options.claims === 'signed-out') return Promise.resolve(err(appError('UNAUTHENTICATED')));
      if (options.claims === 'strict-refused' && strict)
        return Promise.resolve(err(appError('UNAUTHENTICATED')));
      return Promise.resolve(ok(CLAIMS));
    }),
    withUserTx: ((_claims: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn('tx')) as PlatformConsoleDeps['withUserTx'],
    isPlatformAdmin: vi.fn(() => Promise.resolve(options.admin ?? true)),
    listPlatformTenants: vi.fn(() =>
      options.refuse ? Promise.reject(options.refuse as Error) : Promise.resolve([]),
    ),
    createPlatformTenant: vi.fn(() =>
      options.refuse
        ? Promise.reject(options.refuse as Error)
        : Promise.resolve({ tenantId: TENANT, invitationId: 'inv', inviteCode: 'K7M2PQ9XHT4W' }),
    ),
    platformAdminInvitationCode: vi.fn(() =>
      options.refuse ? Promise.reject(options.refuse as Error) : Promise.resolve(CODE),
    ),
    reissuePlatformAdminCode: vi.fn(() =>
      options.refuse ? Promise.reject(options.refuse as Error) : Promise.resolve(CODE),
    ),
  };
  return { deps, strictCalls };
}

const notFound = { ok: false, error: expect.objectContaining({ code: 'NOT_FOUND', status: 404 }) };

describe('platform console: deny by default', () => {
  const entryPoints = {
    access: (d: PlatformConsoleDeps) => platformConsoleAccess(d),
    list: (d: PlatformConsoleDeps) => loadPlatformOrganizations(d),
    create: (d: PlatformConsoleDeps) => createOrganizationFromConsole(d, INPUT),
    view: (d: PlatformConsoleDeps) => viewOrganizationAdminCode(d, TENANT),
    reissue: (d: PlatformConsoleDeps) => reissueOrganizationAdminCode(d, TENANT),
  };

  for (const [name, call] of Object.entries(entryPoints)) {
    it(`${name}: a signed-out visitor gets 404 and the database is not asked`, async () => {
      const { deps } = setup({ claims: 'signed-out' });
      expect(await call(deps)).toEqual(notFound);
      expect(deps.isPlatformAdmin).not.toHaveBeenCalled();
    });

    it(`${name}: a member of an organization or any other account (not a Super Admin) gets 404`, async () => {
      const { deps } = setup({ admin: false });
      expect(await call(deps)).toEqual(notFound);
      expect(deps.listPlatformTenants).not.toHaveBeenCalled();
      expect(deps.createPlatformTenant).not.toHaveBeenCalled();
      expect(deps.platformAdminInvitationCode).not.toHaveBeenCalled();
      expect(deps.reissuePlatformAdminCode).not.toHaveBeenCalled();
    });

    it(`${name}: the database's own refusal (42501) after the access check is reported, with its reason`, async () => {
      const cause = Object.assign(
        new Error('new row violates row-level security policy for table "x"'),
        {
          code: '42501',
          where:
            'PL/pgSQL function private.platform_create_tenant(text,text) line 58 at SQL statement',
        },
      );
      const { deps } = setup({ refuse: new PlatformConsoleError('NOT_PLATFORM_ADMIN', { cause }) });
      const result = await call(deps);
      if (name !== 'access')
        expect(result).toEqual({
          ok: false,
          error: expect.objectContaining({
            code: 'PLATFORM_DATABASE_REFUSED',
            expose: true,
            params: {
              detail:
                '42501 new row violates row-level security policy for table "x" @ private.platform_create_tenant:58',
            },
          }),
        });
    });
  }

  it('isPlatformAdminSession is false unless the database says yes', async () => {
    expect(await isPlatformAdminSession(setup({ admin: false }).deps)).toBe(false);
    expect(await isPlatformAdminSession(setup({ claims: 'signed-out' }).deps)).toBe(false);
    expect(await isPlatformAdminSession(setup().deps)).toBe(true);
  });
});

describe('platform console: authorization before input validation (review L6)', () => {
  const refuse = vi.fn(() => ({
    ok: false as const,
    error: { code: 'VALIDATION_FAILED', fieldErrors: [{ path: 'slug', code: 'INVALID' }] } as never,
  }));
  const accept = <T>(value: T) => vi.fn((_raw: unknown) => ({ ok: true as const, value }));

  it('anyone but a Super Admin gets 404 whatever they send; the parser never runs', async () => {
    const { deps } = setup({ admin: false });
    expect(await createOrganizationFromConsole(deps, { junk: true }, refuse)).toEqual(notFound);
    expect(await viewOrganizationAdminCode(deps, 'not-a-uuid', refuse)).toEqual(notFound);
    expect(await reissueOrganizationAdminCode(deps, 'not-a-uuid', refuse)).toEqual(notFound);
    expect(refuse).not.toHaveBeenCalled();
    const signedOut = setup({ claims: 'signed-out' }).deps;
    expect(await createOrganizationFromConsole(signedOut, {}, refuse)).toEqual(notFound);
    expect(refuse).not.toHaveBeenCalled();
  });

  it('a Super Admin gets the validation errors, and valid input goes on', async () => {
    const { deps } = setup();
    const invalid = await createOrganizationFromConsole(deps, { junk: true }, refuse);
    expect(!invalid.ok && invalid.error.code).toBe('VALIDATION_FAILED');
    expect(deps.createPlatformTenant).not.toHaveBeenCalled();
    const parse = accept(INPUT);
    expect((await createOrganizationFromConsole(deps, { raw: 1 }, parse)).ok).toBe(true);
    expect(parse).toHaveBeenCalledWith({ raw: 1 });
    expect((await viewOrganizationAdminCode(deps, { tenantId: TENANT }, accept(TENANT))).ok).toBe(
      true,
    );
    expect(
      (await reissueOrganizationAdminCode(deps, { tenantId: TENANT }, accept(TENANT))).ok,
    ).toBe(true);
    expect(deps.reissuePlatformAdminCode).toHaveBeenCalledWith('tx', TENANT);
  });
});

describe('platform console: sensitive operations re-verify the session (getUser)', () => {
  it('the list uses getClaims; create, copy and new code confirm the session with Auth', async () => {
    const { deps, strictCalls } = setup();
    await loadPlatformOrganizations(deps);
    await createOrganizationFromConsole(deps, INPUT);
    await viewOrganizationAdminCode(deps, TENANT);
    await reissueOrganizationAdminCode(deps, TENANT);
    expect(strictCalls).toEqual([false, true, true, true]);
  });

  it('a session Auth no longer confirms cannot create or reveal codes', async () => {
    const { deps } = setup({ claims: 'strict-refused' });
    expect(await createOrganizationFromConsole(deps, INPUT)).toEqual(notFound);
    expect(await viewOrganizationAdminCode(deps, TENANT)).toEqual(notFound);
    expect(await reissueOrganizationAdminCode(deps, TENANT)).toEqual(notFound);
    expect(deps.createPlatformTenant).not.toHaveBeenCalled();
  });
});

describe('platform console: the Super Admin', () => {
  it('creates an organization and gets its Organization Admin code in the invitation language', async () => {
    const { deps } = setup();
    expect(await createOrganizationFromConsole(deps, { ...INPUT, locale: 'ar' })).toEqual({
      ok: true,
      value: { tenantId: TENANT, inviteCode: 'K7M2PQ9XHT4W', locale: 'ar' },
    });
  });

  it('starts the organization on its plan as a 30-day trial, in the same transaction (WP-ADM-06)', async () => {
    const { deps } = setup();
    const setTenantPlan = vi.fn(() => Promise.resolve());
    const before = Date.now();
    await createOrganizationFromConsole(
      { ...deps, setTenantPlan },
      { ...INPUT, planId: '9b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11', trial: true },
    );
    expect(setTenantPlan).toHaveBeenCalledWith('tx', {
      tenantId: TENANT,
      planId: '9b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11',
      status: 'trial',
      trialEndsAt: expect.any(Date),
      maxPeopleOverride: null,
      maxStorageGbOverride: null,
    });
    const calls = setTenantPlan.mock.calls as unknown as [string, { trialEndsAt: Date }][];
    const ends = calls[0]?.[1].trialEndsAt.getTime() ?? 0;
    expect(ends - before).toBeGreaterThanOrEqual(30 * 86_400_000);
    expect(ends - Date.now()).toBeLessThanOrEqual(30 * 86_400_000);
    // No plan and no trial: nothing more than before.
    const plain = vi.fn(() => Promise.resolve());
    await createOrganizationFromConsole({ ...deps, setTenantPlan: plain }, INPUT);
    expect(plain).not.toHaveBeenCalled();
  });

  it('maps the database refusals to the form', async () => {
    const taken = await createOrganizationFromConsole(
      setup({ refuse: new PlatformConsoleError('SLUG_TAKEN') }).deps,
      INPUT,
    );
    expect(!taken.ok && taken.error.fieldErrors).toEqual([{ path: 'slug', code: 'SLUG_TAKEN' }]);
    const invalid = await createOrganizationFromConsole(
      setup({
        refuse: new PlatformConsoleError('PLATFORM_INVALID_INPUT', { field: 'admin_email' }),
      }).deps,
      INPUT,
    );
    expect(!invalid.ok && invalid.error.fieldErrors).toEqual([
      { path: 'adminEmail', code: 'INVALID' },
    ]);
    const noField = await createOrganizationFromConsole(
      setup({ refuse: new PlatformConsoleError('PLATFORM_INVALID_INPUT') }).deps,
      INPUT,
    );
    expect(!noField.ok && noField.error.fieldErrors).toEqual([{ path: 'form', code: 'INVALID' }]);
    const joined = await reissueOrganizationAdminCode(
      setup({ refuse: new PlatformConsoleError('NO_PENDING_ADMIN') }).deps,
      TENANT,
    );
    expect(!joined.ok && joined.error.code).toBe('PLATFORM_NO_PENDING_ADMIN');
  });

  it("refuses the Super Admin's own e-mail next to the field (review L7)", async () => {
    const own = await createOrganizationFromConsole(
      setup({ refuse: new PlatformConsoleError('OWN_EMAIL', { field: 'admin_email' }) }).deps,
      INPUT,
    );
    expect(!own.ok && own.error.fieldErrors).toEqual([{ path: 'adminEmail', code: 'OWN_EMAIL' }]);
  });

  it('throws unexpected errors (an internal error with a correlation id upstream)', async () => {
    await expect(
      viewOrganizationAdminCode(setup({ refuse: new Error('db down') }).deps, TENANT),
    ).rejects.toThrow('db down');
  });

  it('copies and renews the code', async () => {
    const { deps } = setup();
    expect(await viewOrganizationAdminCode(deps, TENANT)).toEqual({ ok: true, value: CODE });
    expect(await reissueOrganizationAdminCode(deps, TENANT)).toEqual({ ok: true, value: CODE });
    expect(deps.reissuePlatformAdminCode).toHaveBeenCalledWith('tx', TENANT);
  });
});
