import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BrandingSettings,
  brandingExists,
  changedBrandingFields,
  createPublicBrandApi,
  forgetBrandingPresenceForTests,
  getBranding,
  getTenantBrand,
  saveBranding,
} from './branding';
import type { AppDatabase } from './client';
import type { UserTx } from './with-user-tx';

const dialect = new PgDialect();

/** A transaction answering each statement with the next prepared result (an Error is thrown). */
function fakeTx(...results: (Record<string, unknown>[] | Error)[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: (query: SQL) => {
      executed.push(dialect.sqlToQuery(query));
      const next = results.shift() ?? [];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  } as unknown as UserTx;
  return { tx, executed };
}

const present = [{ present: true }];
const LOGO = '66666666-6666-4666-8666-666666666666';
const ASSET = '77777777-7777-4777-8777-777777777777';

const stored = {
  name_ar: 'شركة الراية',
  name_en: 'Al Raya',
  primary_color: '#0F5E4E',
  secondary_color: '#13806A',
  use_gradient: true,
  website_url: 'https://raya.example',
  logo_file_id: LOGO,
  favicon_file_id: null,
  sign_in_image_file_id: null,
  version: 2,
};
const settings: BrandingSettings = {
  nameAr: 'شركة الراية',
  nameEn: 'Al Raya',
  primaryColor: '#0F5E4E',
  secondaryColor: '#13806A',
  useGradient: true,
  websiteUrl: 'https://raya.example',
  logoFileId: LOGO,
  faviconFileId: null,
  signInImageFileId: null,
};

beforeEach(() => {
  forgetBrandingPresenceForTests();
});

describe('expand-first presence (WP-ADM-02)', () => {
  it('asks the catalog once, then remembers', async () => {
    const { tx, executed } = fakeTx(present);
    expect(await brandingExists(tx)).toBe(true);
    expect(await brandingExists(tx)).toBe(true);
    expect(executed).toHaveLength(1);
    expect(executed[0]?.sql).toContain("to_regclass('platform.tenant_branding')");
  });

  it('before the migration the shell shows the Jadarat look, the page and saving wait', async () => {
    const { tx } = fakeTx(
      [{ present: false }],
      [{ slug: 'raya' }],
      [{ present: false }],
      [{ present: false }],
    );
    expect(await getTenantBrand(tx)).toEqual({
      slug: 'raya',
      primaryColor: null,
      secondaryColor: null,
      useGradient: true,
      websiteUrl: null,
      logoAssetId: null,
      faviconAssetId: null,
      signInImageAssetId: null,
    });
    expect(await getBranding(tx)).toBeNull();
    expect(
      await saveBranding(tx, { ...settings, emailActionColor: null, emailLinkColor: null }, 0),
    ).toEqual({ outcome: 'unavailable' });
  });
});

describe('getTenantBrand', () => {
  it("reads the claims' organization with its published images", async () => {
    const { tx, executed } = fakeTx(present, [
      {
        slug: 'raya',
        primary_color: '#0F5E4E',
        secondary_color: '#13806A',
        use_gradient: false,
        website_url: null,
        logo_asset_id: ASSET,
        favicon_asset_id: null,
        sign_in_image_asset_id: null,
      },
    ]);
    expect(await getTenantBrand(tx)).toMatchObject({
      slug: 'raya',
      primaryColor: '#0F5E4E',
      useGradient: false,
      logoAssetId: ASSET,
      faviconAssetId: null,
    });
    expect(executed[1]?.sql).toContain('private.current_tenant_id()');
  });

  it('null without a visible organization', async () => {
    const { tx } = fakeTx(present, []);
    expect(await getTenantBrand(tx)).toBeNull();
  });
});

describe('getBranding (the page)', () => {
  it('the saved look, its images (copy and, for the uploader, status and name) and its editor', async () => {
    const { tx } = fakeTx(
      present,
      [
        {
          ...stored,
          updated_at: '2026-10-20T10:00:00Z',
          editor_name_ar: 'سارة',
          editor_name_en: 'Sara',
        },
      ],
      [{ id: LOGO, asset_id: ASSET, status: 'clean', original_name: 'logo.png' }],
    );
    const record = await getBranding(tx);
    expect(record).toMatchObject({
      ...settings,
      version: 2,
      updatedBy: { nameAr: 'سارة', nameEn: 'Sara' },
      images: {
        logo: { fileId: LOGO, assetId: ASSET, status: 'clean', name: 'logo.png' },
        favicon: null,
        sign_in_image: null,
      },
    });
    expect(record?.updatedAt?.toISOString()).toBe('2026-10-20T10:00:00.000Z');
  });

  it('never saved: version 0, the Jadarat look, no editor', async () => {
    const { tx, executed } = fakeTx(present, [
      {
        name_ar: 'شركة الراية',
        name_en: null,
        primary_color: null,
        secondary_color: null,
        use_gradient: true,
        website_url: null,
        logo_file_id: null,
        favicon_file_id: null,
        sign_in_image_file_id: null,
        version: null,
        updated_at: null,
        editor_name_ar: null,
        editor_name_en: null,
      },
    ]);
    expect(await getBranding(tx)).toMatchObject({
      version: 0,
      primaryColor: null,
      updatedBy: null,
      updatedAt: null,
    });
    expect(executed).toHaveLength(2);
  });

  it('an image another admin uploaded: its copy only', async () => {
    const { tx } = fakeTx(present, [{ ...stored, updated_at: null, editor_name_ar: null }], []);
    expect((await getBranding(tx))?.images.logo).toEqual({
      fileId: LOGO,
      assetId: null,
      status: null,
      name: null,
    });
  });

  it('null without an organization', async () => {
    const { tx } = fakeTx(present, []);
    expect(await getBranding(tx)).toBeNull();
  });
});

describe('saveBranding', () => {
  const save = { ...settings, emailActionColor: '#0F5E4E', emailLinkColor: '#0C4B3E' };

  it('inserts on the first save (version 0) and renames when the names changed', async () => {
    const { tx, executed } = fakeTx(
      present,
      [
        {
          ...stored,
          primary_color: null,
          secondary_color: null,
          logo_file_id: null,
          version: null,
          name_en: 'Old',
        },
      ],
      [{ version: 1 }],
      [{ id: 't' }],
    );
    const result = await saveBranding(tx, save, 0);
    expect(result).toMatchObject({ outcome: 'updated', version: 1 });
    expect(executed[1]?.sql).toContain('for no key update of t');
    expect(executed[2]?.sql).toContain('insert into platform.tenant_branding');
    expect(executed[3]?.sql).toContain('update platform.tenants set name_ar');
  });

  it('updates at the loaded version only', async () => {
    const { tx, executed } = fakeTx(present, [{ ...stored, website_url: null }], [{ version: 3 }]);
    expect(await saveBranding(tx, save, 2)).toMatchObject({ outcome: 'updated', version: 3 });
    expect(executed[2]?.sql).toContain('update platform.tenant_branding');
    expect(executed).toHaveLength(3);
    forgetBrandingPresenceForTests();
    const conflict = fakeTx(present, [stored]);
    expect(await saveBranding(conflict.tx, save, 1)).toEqual({ outcome: 'conflict' });
  });

  it('unchanged: no write', async () => {
    const { tx, executed } = fakeTx(present, [stored]);
    expect(await saveBranding(tx, save, 2)).toEqual({ outcome: 'unchanged', version: 2 });
    expect(executed).toHaveLength(2);
  });

  it("maps the database's refusals to fields", async () => {
    const refusal = (code: string, extra: Record<string, unknown> = {}) =>
      Object.assign(new Error('refused'), { code, ...extra });
    const cases: [Error, unknown][] = [
      [
        refusal('JB001', { message: 'branding image favicon is not usable' }),
        { outcome: 'invalid', field: 'faviconFileId' },
      ],
      [
        refusal('JB001', { message: 'branding image sign_in_image is not usable' }),
        { outcome: 'invalid', field: 'signInImageFileId' },
      ],
      [
        refusal('JB001', { message: 'branding image logo is not usable' }),
        { outcome: 'invalid', field: 'logoFileId' },
      ],
      [
        refusal('23514', { constraint_name: 'tenant_branding_website_check' }),
        { outcome: 'invalid', field: 'websiteUrl' },
      ],
      [refusal('42501'), { outcome: 'refused' }],
    ];
    for (const [error, expected] of cases) {
      forgetBrandingPresenceForTests();
      const { tx } = fakeTx(present, [{ ...stored, website_url: null }], error);
      expect(await saveBranding(tx, save, 2)).toEqual(expected);
    }
    forgetBrandingPresenceForTests();
    const { tx } = fakeTx(present, [{ ...stored, website_url: null }], refusal('XX000'));
    await expect(saveBranding(tx, save, 2)).rejects.toThrow('refused');
  });

  it('refused without an organization or a row returned', async () => {
    expect(await saveBranding(fakeTx(present, []).tx, save, 0)).toEqual({ outcome: 'refused' });
    forgetBrandingPresenceForTests();
    expect(
      await saveBranding(fakeTx(present, [{ ...stored, website_url: null }], []).tx, save, 2),
    ).toEqual({
      outcome: 'refused',
    });
  });

  it('lists the changed fields', () => {
    expect(
      changedBrandingFields(settings, { ...settings, useGradient: false, nameEn: null }),
    ).toEqual(['nameEn', 'useGradient']);
  });
});

describe('public delivery path (claim-less)', () => {
  function database(rows: Record<string, unknown>[] | Error) {
    const queries: string[] = [];
    const tx = {
      execute: (query: SQL) => {
        queries.push(dialect.sqlToQuery(query).sql);
        if (rows instanceof Error && queries.at(-1)?.includes('private.public'))
          return Promise.reject(rows);
        return Promise.resolve(
          rows instanceof Error ? [] : queries.at(-1)?.includes('private.public') ? rows : [],
        );
      },
    };
    const db = {
      transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as AppDatabase;
    return { api: createPublicBrandApi(() => db), queries };
  }

  it('checks the shape first: nothing else reaches the database', async () => {
    const { api, queries } = database([]);
    expect(await api.tenantBrandBySlug("raya' or '1'='1")).toBeNull();
    expect(await api.brandAsset('../../x')).toBeNull();
    expect(await api.brandAssetMeta('ABC')).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it("answers an organization's look and a copy", async () => {
    const look = database([
      {
        name_ar: 'شركة الراية',
        name_en: 'Al Raya',
        primary_color: '#0F5E4E',
        secondary_color: '#13806A',
        use_gradient: true,
        logo_asset_id: ASSET,
        favicon_asset_id: null,
        sign_in_image_asset_id: null,
      },
    ]);
    expect(await look.api.tenantBrandBySlug('raya')).toMatchObject({
      nameEn: 'Al Raya',
      logoAssetId: ASSET,
    });
    expect(look.queries.some((q) => q.includes('set transaction read only'))).toBe(true);
    const copy = database([
      { content_type: 'image/png', content: new Uint8Array([1]), sha256: 'a'.repeat(64) },
    ]);
    expect(await copy.api.brandAsset(ASSET)).toMatchObject({ contentType: 'image/png' });
    expect(await database([]).api.brandAsset(ASSET)).toBeNull();
    expect(await database([]).api.tenantBrandBySlug('raya')).toBeNull();
    // Revalidation: type, hash and size only — the bytes are not read.
    const meta = database([{ content_type: 'image/png', sha256: 'a'.repeat(64), byte_size: '12' }]);
    expect(await meta.api.brandAssetMeta(ASSET)).toEqual({
      contentType: 'image/png',
      sha256: 'a'.repeat(64),
      byteSize: 12,
    });
    expect(meta.queries.some((q) => q.includes('private.public_brand_asset_meta'))).toBe(true);
    expect(await database([]).api.brandAssetMeta(ASSET)).toBeNull();
  });

  it('a database before the migration answers nothing; other errors are thrown', async () => {
    const missing = Object.assign(new Error('function does not exist'), { code: '42883' });
    expect(await database(missing).api.tenantBrandBySlug('raya')).toBeNull();
    expect(await database(missing).api.brandAsset(ASSET)).toBeNull();
    expect(await database(missing).api.brandAssetMeta(ASSET)).toBeNull();
    const broken = Object.assign(new Error('boom'), { code: 'XX000' });
    await expect(database(broken).api.brandAsset(ASSET)).rejects.toThrow('boom');
    await expect(database(broken).api.brandAssetMeta(ASSET)).rejects.toThrow('boom');
    await expect(database(broken).api.tenantBrandBySlug('raya')).rejects.toThrow('boom');
  });
});

vi.mock('./client', () => ({ getDatabase: vi.fn() }));
