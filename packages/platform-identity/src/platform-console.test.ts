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
const CODE = { inviteCode: 'K7M2PQ9X', locale: 'en' as const, expiresAt: new Date('2026-10-23') };
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
        : Promise.resolve({ tenantId: TENANT, invitationId: 'inv', inviteCode: 'K7M2PQ9X' }),
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

    it(`${name}: the database's own refusal (42501) is a 404 too`, async () => {
      const { deps } = setup({ refuse: new PlatformConsoleError('NOT_PLATFORM_ADMIN') });
      const result = await call(deps);
      if (name !== 'access') expect(result).toEqual(notFound);
    });
  }

  it('isPlatformAdminSession is false unless the database says yes', async () => {
    expect(await isPlatformAdminSession(setup({ admin: false }).deps)).toBe(false);
    expect(await isPlatformAdminSession(setup({ claims: 'signed-out' }).deps)).toBe(false);
    expect(await isPlatformAdminSession(setup().deps)).toBe(true);
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
      value: { tenantId: TENANT, inviteCode: 'K7M2PQ9X', locale: 'ar' },
    });
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
