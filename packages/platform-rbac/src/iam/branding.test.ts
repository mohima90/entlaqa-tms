import { err, ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import type { UserTx } from '@jadarat/platform-db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Grant } from '../authorize';
import type { ActionRuntime } from '../define-action';
import { createDefineAction } from '../define-action';
import { createDefineQuery } from '../define-query';
import { MEMBER_GRANTS } from '../member-permissions';
import { type TestRoleCode, testRoleGrants } from '../testing/former-roles';
import {
  BrandingInput,
  type BrandingFileService,
  type BrandingImageReader,
  brandingOwner,
  brandingQueryDefinition,
  confirmBrandImageUploadActionDefinition,
  isWebsiteUrl,
  saveBrandingActionDefinition,
  startBrandImageUploadActionDefinition,
} from './branding';

const db = vi.hoisted(() => ({
  BRAND_IMAGE_KINDS: ['logo', 'favicon', 'sign_in_image'] as const,
  changedBrandingFields: (before: Record<string, unknown>, after: Record<string, unknown>) =>
    Object.keys(after).filter((k) => before[k] !== after[k]),
  isDomainError: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error && 'domain' in error,
  getBranding: vi.fn(),
  saveBranding: vi.fn(),
  publishBrandImage: vi.fn(),
  getOrganizationProfile: vi.fn(),
  updateOrganizationProfile: vi.fn(),
}));
vi.mock('@jadarat/platform-db', () => db);

const TX = 'tx' as unknown as UserTx;
const TENANT = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';
const SESSION = '55555555-5555-4555-8555-555555555555';
const LOGO = '66666666-6666-4666-8666-666666666666';

function runtime(grants: readonly Grant[], aal: 'aal1' | 'aal2' = 'aal1') {
  const writeAudit = vi.fn(() => Promise.resolve());
  const getClaims = vi.fn(() => {
    const r = brandVerifiedClaims({
      sub: '11111111-1111-4111-8111-111111111111',
      role: 'authenticated',
      aal,
      ...(aal === 'aal2'
        ? { amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] }
        : {}),
      session_id: SESSION,
      tenant_id: TENANT,
      person_id: ME,
    });
    if (!r.ok) throw new Error('fixture');
    return Promise.resolve(ok(r.value));
  });
  const rt: ActionRuntime<UserTx> = {
    getClaims,
    withUserTx: (_c, fn) => fn(TX),
    loadSessionFacts: () => Promise.resolve({ active: true, aal2: aal === 'aal2' }),
    loadGrants: () => Promise.resolve([...grants, ...MEMBER_GRANTS]),
    resolveResource: () => Promise.resolve(null),
    writeAudit,
    logError: vi.fn(),
  };
  return { rt, writeAudit, getClaims };
}

const forRoles = (...roles: TestRoleCode[]) => testRoleGrants(roles, []);

const settings = {
  nameAr: 'شركة الراية',
  nameEn: 'Al Raya',
  primaryColor: null,
  secondaryColor: null,
  useGradient: true,
  websiteUrl: null,
  logoFileId: null,
  faviconFileId: null,
  signInImageFileId: null,
};
const record = {
  ...settings,
  images: { logo: null, favicon: null, sign_in_image: null },
  updatedAt: null,
  updatedBy: null,
  version: 0,
};
const input = {
  version: 0,
  nameAr: 'شركة الراية',
  nameEn: 'Al Raya',
  primaryColor: '#0f5e4e',
  secondaryColor: '#13806A',
  useGradient: true,
  websiteUrl: 'https://raya.example',
  logoFileId: LOGO,
  faviconFileId: null,
  signInImageFileId: null,
};
const derive = vi.fn(
  (s: { primary: string | null; secondary: string | null; gradient: boolean }) =>
    s.primary === null
      ? { stored: null, email: null }
      : {
          stored: {
            primary: s.primary,
            secondary: s.gradient ? (s.secondary ?? s.primary) : s.primary,
          },
          email: { action: '#0F5E4E', link: '#0C4B3E' },
        },
);

/** The app's image reader (platform-files readBrandUpload): nothing to read unless a test says so. */
const readImage = vi.fn<BrandingImageReader>(() => Promise.resolve(ok({ missing: true as const })));
const saveDefinition = () => saveBrandingActionDefinition(derive, readImage);

beforeEach(() => {
  vi.clearAllMocks();
  readImage.mockImplementation(() => Promise.resolve(ok({ missing: true as const })));
  db.publishBrandImage.mockResolvedValue('77777777-7777-4777-8777-777777777777');
  db.getBranding.mockResolvedValue(record);
  db.saveBranding.mockImplementation((_tx: unknown, after: Record<string, unknown>) => {
    const { emailActionColor: _a, emailLinkColor: _l, ...rest } = after;
    return Promise.resolve({
      outcome: 'updated',
      before: settings,
      after: rest,
      version: 1,
      imageNames: { [LOGO]: 'raya-logo.png' },
    });
  });
});

describe('Branding page (WP-ADM-02)', () => {
  it('the Organization Admin opens and edits it', async () => {
    const query = createDefineQuery(runtime(forRoles('tenant_admin')).rt)(
      brandingQueryDefinition(),
    );
    expect(await query({})).toEqual({
      ok: true,
      value: { branding: record, editAccess: 'allowed' },
    });
  });

  it('an Auditor reads it, read only', async () => {
    const query = createDefineQuery(runtime(forRoles('auditor')).rt)(brandingQueryDefinition());
    expect(await query({})).toEqual({
      ok: true,
      value: { branding: record, editAccess: 'denied' },
    });
  });

  it.each([['hr_manager'], ['training_manager'], ['learner'], ['line_manager']] as const)(
    'refuses the %s, also at AAL2',
    async (role) => {
      for (const aal of ['aal1', 'aal2'] as const) {
        const query = createDefineQuery(runtime(forRoles(role), aal).rt)(brandingQueryDefinition());
        const result = await query({});
        expect(!result.ok && result.error.code).toBe('FORBIDDEN');
      }
      expect(db.getBranding).not.toHaveBeenCalled();
    },
  );

  it('NOT_CONFIGURED before the database has the branding tables', async () => {
    db.getBranding.mockResolvedValue(null);
    const query = createDefineQuery(runtime(forRoles('tenant_admin')).rt)(
      brandingQueryDefinition(),
    );
    const result = await query({});
    expect(!result.ok && result.error.code).toBe('NOT_CONFIGURED');
  });
});

describe('saving the branding (WP-ADM-02, BR-BRD-a)', () => {
  it('the Organization Admin saves; colours upper-cased, e-mail colours derived; audited before → after', async () => {
    const { rt, writeAudit, getClaims } = runtime(forRoles('tenant_admin'));
    const save = createDefineAction(rt)(saveDefinition());
    const result = await save(input);
    expect(result.ok).toBe(true);
    expect(db.saveBranding).toHaveBeenCalledWith(
      TX,
      {
        ...settings,
        primaryColor: '#0F5E4E',
        secondaryColor: '#13806A',
        websiteUrl: 'https://raya.example',
        logoFileId: LOGO,
        emailActionColor: '#0F5E4E',
        emailLinkColor: '#0C4B3E',
      },
      0,
    );
    // High risk: the session is confirmed with Auth.
    expect(getClaims).toHaveBeenCalledWith({ strict: true });
    expect(writeAudit).toHaveBeenCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({
        action: 'platform.tenant.branding_changed',
        entityType: 'tenant',
        entityId: TENANT,
        data: {
          changed: ['primaryColor', 'secondaryColor', 'websiteUrl', 'logoFileId'],
          before: { primaryColor: null, secondaryColor: null, websiteUrl: null, logoFileId: null },
          after: {
            primaryColor: '#0F5E4E',
            secondaryColor: '#13806A',
            websiteUrl: 'https://raya.example',
            // BR-BRD-a: an image by its file id and sanitized name.
            logoFileId: { fileId: LOGO, name: 'raya-logo.png' },
          },
        },
      }),
    );
  });

  it('an image whose name is not readable any more is audited by its id', async () => {
    db.saveBranding.mockResolvedValueOnce({
      outcome: 'updated',
      before: { ...settings, faviconFileId: LOGO },
      after: settings,
      version: 2,
      imageNames: {},
    });
    const { rt, writeAudit } = runtime(forRoles('tenant_admin'));
    await createDefineAction(rt)(saveDefinition())(input);
    expect(writeAudit).toHaveBeenCalledWith(
      TX,
      expect.anything(),
      expect.objectContaining({
        data: {
          changed: ['faviconFileId'],
          before: { faviconFileId: { fileId: LOGO, name: null } },
          after: { faviconFileId: null },
        },
      }),
    );
  });

  it('the Jadarat look stores no colours and keeps the gradient', async () => {
    const save = createDefineAction(runtime(forRoles('tenant_admin')).rt)(saveDefinition());
    await save({ ...input, primaryColor: null, secondaryColor: null, useGradient: false });
    expect(db.saveBranding).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        primaryColor: null,
        secondaryColor: null,
        useGradient: true,
        emailActionColor: null,
        emailLinkColor: null,
      }),
      0,
    );
  });

  it('nothing changed: no audit record', async () => {
    db.saveBranding.mockResolvedValue({ outcome: 'unchanged', version: 3 });
    const { rt, writeAudit } = runtime(forRoles('tenant_admin'));
    const result = await createDefineAction(rt)(saveDefinition())(input);
    expect(result).toEqual({
      ok: true,
      value: { tenantId: TENANT, version: 3, changed: [], before: {}, after: {} },
    });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it.each([['hr_manager'], ['training_manager'], ['learner'], ['auditor']] as const)(
    'refuses the %s (only the Organization Admin changes the look), also at AAL2',
    async (role) => {
      for (const aal of ['aal1', 'aal2'] as const) {
        const save = createDefineAction(runtime(forRoles(role), aal).rt)(saveDefinition());
        const result = await save(input);
        expect(!result.ok && result.error.code).toBe('FORBIDDEN');
      }
      expect(db.saveBranding).not.toHaveBeenCalled();
    },
  );

  it('maps the database answers', async () => {
    const save = createDefineAction(runtime(forRoles('tenant_admin')).rt)(saveDefinition());
    db.saveBranding.mockResolvedValueOnce({ outcome: 'invalid', field: 'logoFileId' });
    const image = await save(input);
    expect(!image.ok && image.error.fieldErrors).toEqual([
      { path: 'logoFileId', code: 'IMAGE_NOT_USABLE' },
    ]);
    db.saveBranding.mockResolvedValueOnce({ outcome: 'invalid', field: 'websiteUrl' });
    const site = await save(input);
    expect(!site.ok && site.error.fieldErrors).toEqual([{ path: 'websiteUrl', code: 'INVALID' }]);
    for (const [outcome, code] of [
      ['conflict', 'CONFLICT_VERSION'],
      ['refused', 'FORBIDDEN'],
      ['unavailable', 'NOT_CONFIGURED'],
    ] as const) {
      db.saveBranding.mockResolvedValueOnce({ outcome });
      const result = await save(input);
      expect(!result.ok && result.error.code).toBe(code);
    }
  });

  it('one colour without the other is refused', async () => {
    const save = createDefineAction(runtime(forRoles('tenant_admin')).rt)(saveDefinition());
    const result = await save({ ...input, secondaryColor: null });
    expect(!result.ok && result.error.fieldErrors).toEqual([
      { path: 'secondaryColor', code: 'INVALID' },
    ]);
    expect(db.saveBranding).not.toHaveBeenCalled();
  });
});

describe('images published at save time, without a malware scan (PO, 20 Oct 2026)', () => {
  const FAVICON = '88888888-8888-4888-8888-888888888888';
  const publication = (fileId: string, kind: 'logo' | 'favicon') => ({
    fileId,
    kind,
    sourceSha256: 'a'.repeat(64),
    sourceSize: 120,
    contentType: 'image/png',
    content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  });

  it('reads each chosen image before the transaction and publishes the new one in it', async () => {
    const order: string[] = [];
    readImage.mockImplementation(({ fileId, kind }) => {
      order.push(`read ${kind}`);
      return Promise.resolve(
        ok(
          fileId === LOGO ? { publication: publication(LOGO, 'logo') } : { missing: true as const },
        ),
      );
    });
    db.saveBranding.mockImplementationOnce(() => {
      order.push('save');
      return Promise.resolve({ outcome: 'unchanged', version: 1 });
    });
    db.publishBrandImage.mockImplementationOnce(() => {
      order.push('publish');
      return Promise.resolve('77777777-7777-4777-8777-777777777777');
    });
    const result = await createDefineAction(runtime(forRoles('tenant_admin')).rt)(saveDefinition())(
      {
        ...input,
        faviconFileId: FAVICON,
      },
    );
    expect(result.ok).toBe(true);
    expect(readImage).toHaveBeenCalledWith({ tenantId: TENANT, kind: 'logo', fileId: LOGO });
    expect(readImage).toHaveBeenCalledWith({ tenantId: TENANT, kind: 'favicon', fileId: FAVICON });
    // Read first (no transaction), then the save and the copy in the same transaction.
    expect(order).toEqual(['read logo', 'read favicon', 'save', 'publish']);
    expect(db.publishBrandImage).toHaveBeenCalledTimes(1);
    expect(db.publishBrandImage).toHaveBeenCalledWith(TX, publication(LOGO, 'logo'));
  });

  it.each([
    ['TYPE_NOT_ALLOWED', 'IMAGE_TYPE_NOT_ALLOWED'],
    ['TOO_LARGE', 'IMAGE_TOO_LARGE'],
    ['DIMENSIONS_TOO_LARGE', 'IMAGE_DIMENSIONS_TOO_LARGE'],
    ['MALFORMED', 'IMAGE_MALFORMED'],
    ['EMPTY', 'IMAGE_EMPTY'],
  ] as const)(
    'an image refused (%s) is the answer with its reason; nothing is saved',
    async (refused, code) => {
      readImage.mockResolvedValueOnce(ok({ refused }));
      const result = await createDefineAction(runtime(forRoles('tenant_admin')).rt)(
        saveDefinition(),
      )(input);
      expect(!result.ok && result.error.fieldErrors).toEqual([{ path: 'logoFileId', code }]);
      expect(db.saveBranding).not.toHaveBeenCalled();
      expect(db.publishBrandImage).not.toHaveBeenCalled();
    },
  );

  it('Storage unavailable: the answer is to try again; nothing is saved', async () => {
    readImage.mockResolvedValueOnce(
      err({ code: 'FILE_STORAGE_UNAVAILABLE', status: 503, messageKey: 'x', expose: true }),
    );
    const result = await createDefineAction(runtime(forRoles('tenant_admin')).rt)(saveDefinition())(
      input,
    );
    expect(!result.ok && result.error.code).toBe('FILE_STORAGE_UNAVAILABLE');
    expect(db.saveBranding).not.toHaveBeenCalled();
  });

  it('bytes that are not the stored file: the save is refused (rolled back)', async () => {
    readImage.mockResolvedValueOnce(ok({ publication: publication(LOGO, 'logo') }));
    db.publishBrandImage.mockRejectedValueOnce(
      Object.assign(new Error('mismatch'), { code: 'BRAND_IMAGE_MISMATCH', domain: true }),
    );
    const { rt, writeAudit } = runtime(forRoles('tenant_admin'));
    const result = await createDefineAction(rt)(saveDefinition())(input);
    expect(!result.ok && result.error.fieldErrors).toEqual([
      { path: 'logoFileId', code: 'IMAGE_NOT_USABLE' },
    ]);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('a copy read for another kind is never published for this one; a refused save publishes nothing', async () => {
    readImage.mockResolvedValueOnce(ok({ publication: publication(LOGO, 'favicon') }));
    await createDefineAction(runtime(forRoles('tenant_admin')).rt)(saveDefinition())(input);
    expect(db.publishBrandImage).not.toHaveBeenCalled();
    readImage.mockResolvedValueOnce(ok({ publication: publication(LOGO, 'logo') }));
    db.saveBranding.mockResolvedValueOnce({ outcome: 'conflict' });
    await createDefineAction(runtime(forRoles('tenant_admin')).rt)(saveDefinition())(input);
    expect(db.publishBrandImage).not.toHaveBeenCalled();
  });

  it('no image chosen: nothing is read', async () => {
    await createDefineAction(runtime(forRoles('tenant_admin')).rt)(saveDefinition())({
      ...input,
      logoFileId: null,
    });
    expect(readImage).not.toHaveBeenCalled();
  });
});

describe('BrandingInput (validation before anything runs)', () => {
  const parse = (patch: Record<string, unknown>) => BrandingInput.safeParse({ ...input, ...patch });

  it('accepts #RRGGBB in any case and upper-cases it', () => {
    const parsed = parse({ primaryColor: '#aBcDeF' });
    expect(parsed.success && parsed.data.primaryColor).toBe('#ABCDEF');
  });

  it('refuses other colour forms (no CSS injection)', () => {
    for (const color of ['#abc', 'red', '#0F5E4E;}', 'rgb(0,0,0)', '#0F5E4E ', '#GGGGGG']) {
      if (color === '#0F5E4E ') {
        // Trimmed: fine.
        expect(parse({ primaryColor: color }).success).toBe(true);
        continue;
      }
      expect(parse({ primaryColor: color }).success, color).toBe(false);
    }
  });

  it('the website: https only, empty means none', () => {
    expect(parse({ websiteUrl: '' }).success && parse({ websiteUrl: '' }).data?.websiteUrl).toBe(
      null,
    );
    for (const url of [
      'http://raya.example',
      'javascript:alert(1)',
      'https://raya.example/"><script>',
      'https://user:pass@raya.example',
      'https://localhost',
      `https://raya.example/${'a'.repeat(300)}`,
    ]) {
      expect(parse({ websiteUrl: url }).success, url).toBe(false);
    }
    expect(isWebsiteUrl('https://www.raya.example/about?x=1')).toBe(true);
  });

  it('names: required, no bidi overrides; unknown fields refused', () => {
    expect(parse({ nameEn: '' }).success).toBe(false);
    expect(parse({ nameAr: `شركة ${String.fromCodePoint(0x202e)}الراية` }).success).toBe(false);
    expect(parse({ tagline: 'x' }).success).toBe(false);
    expect(parse({ logoFileId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('branding images (platform-files bound by the app)', () => {
  const view = (purpose: string) => ({
    fileId: LOGO,
    status: 'uploaded',
    reason: null,
    purpose,
    name: 'logo.png',
    declaredType: 'image/png',
    detectedType: null,
    size: 10,
    sha256: null,
  });
  /** The file service's mocks as plain properties (not methods: no unbound `this`). */
  function files(purposeFound = 'platform.brand_logo') {
    const service = {
      reserve: vi.fn<BrandingFileService<{ fileId: string }, { url: string }>['reserve']>(() =>
        Promise.resolve(ok({ fileId: LOGO })),
      ),
      sign: vi.fn<BrandingFileService<{ fileId: string }, { url: string }>['sign']>(() =>
        Promise.resolve(ok({ url: 'https://storage.example/upload' })),
      ),
      confirm: vi.fn(() => Promise.resolve(ok(view(purposeFound) as never))),
      status: vi.fn(() => Promise.resolve(view(purposeFound) as never)),
      purposeOf: (slot: string) => `platform.brand_${slot}`,
    };
    return service;
  }

  it("reserves an upload for the organization's branding, signed after the commit", async () => {
    const service = files();
    const start = createDefineAction(runtime(forRoles('tenant_admin')).rt)(
      startBrandImageUploadActionDefinition(service),
    );
    const result = await start({ slot: 'logo', fileName: 'logo.png', size: 1200 });
    expect(result).toEqual({ ok: true, value: { url: 'https://storage.example/upload' } });
    expect(service.reserve).toHaveBeenCalledWith(TX, {
      slot: 'logo',
      owner: brandingOwner(TENANT),
      declaredName: 'logo.png',
      size: 1200,
    });
    expect(brandingOwner(TENANT)).toEqual({
      module: 'platform',
      entityType: 'tenant_branding',
      entityId: TENANT,
    });
  });

  it('a refused reservation is the answer; nothing is signed', async () => {
    const service = files();
    service.reserve.mockResolvedValueOnce(
      err({
        code: 'FILE_TYPE_NOT_ALLOWED',
        status: 422,
        messageKey: 'files.errors.typeNotAllowed',
        expose: true,
      }),
    );
    const start = createDefineAction(runtime(forRoles('tenant_admin')).rt)(
      startBrandImageUploadActionDefinition(service),
    );
    const result = await start({ slot: 'favicon', fileName: 'icon.svg', size: 100 });
    expect(!result.ok && result.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(service.sign).not.toHaveBeenCalled();
  });

  it.each([['hr_manager'], ['auditor'], ['learner']] as const)(
    'refuses uploads by the %s',
    async (role) => {
      const service = files();
      const start = createDefineAction(runtime(forRoles(role)).rt)(
        startBrandImageUploadActionDefinition(service),
      );
      const result = await start({ slot: 'logo', fileName: 'logo.png', size: 1200 });
      expect(!result.ok && result.error.code).toBe('FORBIDDEN');
      expect(service.reserve).not.toHaveBeenCalled();
    },
  );

  it('confirms and reports only a file of that slot', async () => {
    const service = files();
    const confirm = createDefineAction(runtime(forRoles('tenant_admin')).rt)(
      confirmBrandImageUploadActionDefinition(service),
    );
    expect(await confirm({ slot: 'logo', fileId: LOGO })).toEqual({
      ok: true,
      value: { fileId: LOGO, status: 'uploaded', reason: null },
    });
    const other = files('platform.user_import');
    const refused = await createDefineAction(runtime(forRoles('tenant_admin')).rt)(
      confirmBrandImageUploadActionDefinition(other),
    )({ slot: 'logo', fileId: LOGO });
    expect(!refused.ok && refused.error.code).toBe('NOT_FOUND');
  });

  it('refuses size above the largest image and unknown slots before anything runs', async () => {
    const service = files();
    const start = createDefineAction(runtime(forRoles('tenant_admin')).rt)(
      startBrandImageUploadActionDefinition(service),
    );
    const big = await start({ slot: 'logo', fileName: 'logo.png', size: 6 * 1024 * 1024 });
    expect(!big.ok && big.error.code).toBe('VALIDATION_FAILED');
    const slot = await start({ slot: 'banner' as never, fileName: 'logo.png', size: 10 });
    expect(!slot.ok && slot.error.code).toBe('VALIDATION_FAILED');
    expect(service.reserve).not.toHaveBeenCalled();
  });
});
