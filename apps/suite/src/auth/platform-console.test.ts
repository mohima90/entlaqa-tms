import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The console's actions (FR-ADM-17) validate input and hand over to platform-identity, which decides who
 * may use them (deny by default: NOT_FOUND for everyone but a Super Admin — platform-console.test.ts there,
 * pgTAP 95/96 in the database). Here: invalid input never reaches the flow, and the flow's refusals reach
 * the client as they are.
 */
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

afterEach(() => {
  vi.clearAllMocks();
});

describe('createOrganizationAction', () => {
  it('passes the normalized input to the flow', async () => {
    flow.createOrganizationFromConsoleForRequest.mockResolvedValue({
      ok: true,
      value: { tenantId: TENANT, inviteCode: 'K7M2PQ9X', locale: 'ar' },
    });
    await expect(createOrganizationAction(valid)).resolves.toEqual({
      ok: true,
      value: { tenantId: TENANT, inviteCode: 'K7M2PQ9X', locale: 'ar' },
    });
    expect(flow.createOrganizationFromConsoleForRequest).toHaveBeenCalledWith({
      slug: 'entlaqa',
      nameAr: 'إنطلاقة',
      nameEn: 'ENTLAQA',
      adminEmail: 'admin@entlaqa.com',
      adminFirstNameAr: 'سارة',
      locale: 'ar',
    });
  });

  it('defaults the invitation language to English', async () => {
    flow.createOrganizationFromConsoleForRequest.mockResolvedValue({ ok: true, value: {} });
    const { locale: _locale, ...withoutLocale } = valid;
    await createOrganizationAction(withoutLocale);
    expect(flow.createOrganizationFromConsoleForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en' }),
    );
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
    it(`refuses ${what} before the flow`, async () => {
      const result = await createOrganizationAction({ ...valid, ...change });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
      expect(!result.ok && result.error.fieldErrors?.map((e) => e.path)).toContain(path);
      expect(flow.createOrganizationFromConsoleForRequest).not.toHaveBeenCalled();
    });
  }

  it('answers NOT_FOUND to anyone who is not a Super Admin (the flow decides)', async () => {
    flow.createOrganizationFromConsoleForRequest.mockResolvedValue(notFound);
    await expect(createOrganizationAction(valid)).resolves.toEqual(notFound);
  });

  it('turns an unexpected failure into the generic internal error', async () => {
    flow.createOrganizationFromConsoleForRequest.mockRejectedValue(new Error('db down'));
    const result = await createOrganizationAction(valid);
    expect(!result.ok && result.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(result)).not.toContain('db down');
  });
});

describe('the Organization Admin code actions', () => {
  it('take an organization id only', async () => {
    flow.viewOrganizationAdminCodeForRequest.mockResolvedValue(notFound);
    flow.reissueOrganizationAdminCodeForRequest.mockResolvedValue(notFound);
    await expect(viewOrganizationAdminCodeAction({ tenantId: TENANT })).resolves.toEqual(notFound);
    await expect(reissueOrganizationAdminCodeAction({ tenantId: TENANT })).resolves.toEqual(
      notFound,
    );
    expect(flow.viewOrganizationAdminCodeForRequest).toHaveBeenCalledWith(TENANT);
    expect(flow.reissueOrganizationAdminCodeForRequest).toHaveBeenCalledWith(TENANT);
  });

  it('refuse anything else before the flow', async () => {
    for (const input of [{ tenantId: 'tenant-a' }, { tenantId: TENANT, code: 'X' }, {}]) {
      expect((await viewOrganizationAdminCodeAction(input as never)).ok).toBe(false);
      expect((await reissueOrganizationAdminCodeAction(input as never)).ok).toBe(false);
    }
    expect(flow.viewOrganizationAdminCodeForRequest).not.toHaveBeenCalled();
    expect(flow.reissueOrganizationAdminCodeForRequest).not.toHaveBeenCalled();
  });
});
