import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The console's actions (FR-ADM-17) hand the UNTRUSTED input, with its parser, to platform-identity, which
 * decides who may use them first (deny by default: NOT_FOUND for everyone but a Super Admin, whatever they
 * send — security review L6; platform-console.test.ts there, pgTAP 95/96 in the database) and only then
 * parses it. Here: the parsers refuse invalid input, the flow's refusals reach the client as they are, and
 * the copied link uses the canonical origin (APP_BASE_URL) or none.
 */
type Parse = (raw: unknown) => { ok: boolean; value?: unknown; error?: unknown };
const flow = vi.hoisted(() => ({
  createOrganizationFromConsoleForRequest: vi.fn(),
  viewOrganizationAdminCodeForRequest: vi.fn(),
  reissueOrganizationAdminCodeForRequest: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@jadarat/platform-identity/auth', () => flow);

const {
  createOrganizationAction,
  reissueOrganizationAdminCodeAction,
  viewOrganizationAdminCodeAction,
} = await import('./platform-console');

const TENANT = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';
const CODE = { inviteCode: 'K7M2PQ9XHT4W', locale: 'ar' as const };
const valid = {
  slug: 'entlaqa',
  nameAr: ' إنطلاقة ',
  nameEn: 'ENTLAQA',
  adminEmail: ' Admin@Entlaqa.COM ',
  adminFirstNameAr: 'سارة',
  locale: 'ar' as const,
};
const notFound = {
  ok: false as const,
  error: { code: 'NOT_FOUND', status: 404, messageKey: 'errors.notFound', expose: true },
};

/** A Super Admin's flow: parses the input (after its access check) and answers `value`. */
const asSuperAdmin = (value: unknown) => (raw: unknown, parse: Parse) => {
  const parsed = parse(raw);
  return Promise.resolve(parsed.ok ? { ok: true, value } : parsed);
};
/** The parsed input the flow received. */
const parsedBy = (fn: ReturnType<typeof vi.fn>) => {
  const [raw, parse] = fn.mock.calls[0] as [unknown, Parse];
  return parse(raw);
};

beforeEach(() => {
  flow.createOrganizationFromConsoleForRequest.mockImplementation(
    asSuperAdmin({ tenantId: TENANT, ...CODE }),
  );
  flow.viewOrganizationAdminCodeForRequest.mockImplementation(asSuperAdmin(CODE));
  flow.reissueOrganizationAdminCodeForRequest.mockImplementation(asSuperAdmin(CODE));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('createOrganizationAction', () => {
  it('normalizes the input after the access check; the link uses APP_BASE_URL', async () => {
    vi.stubEnv('APP_BASE_URL', 'https://tms.example.com');
    await expect(createOrganizationAction(valid)).resolves.toEqual({
      ok: true,
      value: {
        tenantId: TENANT,
        ...CODE,
        inviteLink: 'https://tms.example.com/ar/sign-up#code=K7M2PQ9XHT4W',
      },
    });
    expect(parsedBy(flow.createOrganizationFromConsoleForRequest)).toEqual({
      ok: true,
      value: {
        slug: 'entlaqa',
        nameAr: 'إنطلاقة',
        nameEn: 'ENTLAQA',
        adminEmail: 'admin@entlaqa.com',
        adminFirstNameAr: 'سارة',
        locale: 'ar',
      },
    });
  });

  it('without APP_BASE_URL there is no link: the browser uses its own origin', async () => {
    vi.stubEnv('APP_BASE_URL', '');
    const result = await createOrganizationAction(valid);
    expect(result.ok && result.value.inviteLink).toBeNull();
  });

  it('defaults the invitation language to English', async () => {
    const { locale: _locale, ...withoutLocale } = valid;
    await createOrganizationAction(withoutLocale);
    expect(parsedBy(flow.createOrganizationFromConsoleForRequest)).toMatchObject({
      value: { locale: 'en' },
    });
  });

  const invalid: [string, Record<string, unknown>, string][] = [
    ['a short name of 2 characters', { slug: 'ab' }, 'slug'],
    ['a short name of 41 characters', { slug: 'a'.repeat(41) }, 'slug'],
    ['upper case', { slug: 'Entlaqa' }, 'slug'],
    ['a hyphen at the start', { slug: '-entlaqa' }, 'slug'],
    ['a hyphen at the end', { slug: 'entlaqa-' }, 'slug'],
    ['an underscore', { slug: 'ent_laqa' }, 'slug'],
    ['an Arabic short name', { slug: 'إنطلاقة' }, 'slug'],
    ['no Arabic name', { nameAr: '   ' }, 'nameAr'],
    ['an Arabic name of invisible characters', { nameAr: '‏‏' }, 'nameAr'],
    ['a control character', { nameAr: 'منشأة\u0007' }, 'nameAr'],
    ['an Arabic name over 200', { nameAr: 'م'.repeat(201) }, 'nameAr'],
    ['an English name over 200', { nameEn: 'x'.repeat(201) }, 'nameEn'],
    ['an invalid e-mail', { adminEmail: 'not-an-email' }, 'adminEmail'],
    ['an e-mail over 254', { adminEmail: `${'a'.repeat(250)}@x.test` }, 'adminEmail'],
    ['a name over 100', { adminFamilyNameAr: 'م'.repeat(101) }, 'adminFamilyNameAr'],
    ['another language', { locale: 'fr' }, 'locale'],
    ['an unknown field (e.g. a tenant id)', { tenantId: TENANT }, ''],
  ];
  for (const [what, change, path] of invalid) {
    it(`a Super Admin gets a field error for ${what}`, async () => {
      const result = await createOrganizationAction({ ...valid, ...change });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
      expect(!result.ok && result.error.fieldErrors?.map((e) => e.path)).toContain(path);
    });
  }

  it('answers NOT_FOUND to anyone who is not a Super Admin, whatever they send (the flow decides first)', async () => {
    flow.createOrganizationFromConsoleForRequest.mockResolvedValue(notFound);
    await expect(createOrganizationAction(valid)).resolves.toEqual(notFound);
    await expect(createOrganizationAction({ junk: true })).resolves.toEqual(notFound);
  });

  it('turns an unexpected failure into the generic internal error', async () => {
    flow.createOrganizationFromConsoleForRequest.mockRejectedValue(new Error('db down'));
    const result = await createOrganizationAction(valid);
    expect(!result.ok && result.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(result)).not.toContain('db down');
  });
});

describe('the Organization Admin code actions', () => {
  it('take an organization id only, and add the canonical link', async () => {
    vi.stubEnv('APP_BASE_URL', 'https://tms.example.com');
    const view = await viewOrganizationAdminCodeAction({ tenantId: TENANT });
    expect(view.ok && view.value.inviteLink).toBe(
      'https://tms.example.com/ar/sign-up#code=K7M2PQ9XHT4W',
    );
    expect((await reissueOrganizationAdminCodeAction({ tenantId: TENANT })).ok).toBe(true);
    expect(parsedBy(flow.viewOrganizationAdminCodeForRequest)).toEqual({ ok: true, value: TENANT });
    expect(parsedBy(flow.reissueOrganizationAdminCodeForRequest)).toEqual({
      ok: true,
      value: TENANT,
    });
  });

  it('a Super Admin sending anything else gets a validation error; others get NOT_FOUND', async () => {
    for (const input of [{ tenantId: 'tenant-a' }, { tenantId: TENANT, code: 'X' }, {}]) {
      const view = await viewOrganizationAdminCodeAction(input);
      expect(!view.ok && view.error.code).toBe('VALIDATION_FAILED');
      const reissue = await reissueOrganizationAdminCodeAction(input);
      expect(!reissue.ok && reissue.error.code).toBe('VALIDATION_FAILED');
    }
    flow.viewOrganizationAdminCodeForRequest.mockResolvedValue(notFound);
    await expect(viewOrganizationAdminCodeAction({})).resolves.toEqual(notFound);
  });
});
