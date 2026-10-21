import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ClaimsTx } from '../claims-tx';
import {
  claimBrandAssetWork,
  forgetBrandingDeployedForTests,
  getEmailBrand,
  loadBrandImageSource,
  noteBrandAssetFailure,
  publishBrandAsset,
} from './branding';

const dialect = new PgDialect();

function fakeTx(...results: (Record<string, unknown>[] | Error)[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: (query: SQL) => {
      executed.push(dialect.sqlToQuery(query));
      const next = results.shift() ?? [];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  } as unknown as ClaimsTx;
  return { tx, executed };
}

const deployed = [{ present: true }];
const TENANT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const FILE = '2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d';
const ASSET = '3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d';

beforeEach(() => {
  forgetBrandingDeployedForTests();
});

describe('branding, worker side (WP-ADM-02)', () => {
  it('claims due images (known kinds only); nothing before the migration', async () => {
    const before = fakeTx([{ present: false }]);
    expect(await claimBrandAssetWork(before.tx, 20)).toEqual([]);
    expect(before.executed).toHaveLength(1);
    const { tx, executed } = fakeTx(deployed, [
      { tenant_id: TENANT, file_id: FILE, kind: 'logo' },
      { tenant_id: TENANT, file_id: FILE, kind: 'banner' },
    ]);
    expect(await claimBrandAssetWork(tx, 20)).toEqual([
      { tenantId: TENANT, fileId: FILE, kind: 'logo' },
    ]);
    expect(executed[1]?.sql).toContain('private.claim_brand_asset_work');
    expect(executed[1]?.params).toContain(20);
  });

  it('publishes the stripped bytes with the source hash; a mismatch is a DomainError', async () => {
    const SHA = 'a'.repeat(64);
    const { tx, executed } = fakeTx([{ id: ASSET }]);
    expect(
      await publishBrandAsset(tx, { fileId: FILE, kind: 'favicon' }, SHA, new Uint8Array([1, 2])),
    ).toBe(ASSET);
    expect(executed[0]?.sql).toContain('private.publish_brand_asset');
    expect(executed[0]?.params.slice(0, 3)).toEqual([FILE, 'favicon', SHA]);
    expect(
      await publishBrandAsset(
        fakeTx([{ id: null }]).tx,
        { fileId: FILE, kind: 'logo' },
        SHA,
        new Uint8Array([1]),
      ),
    ).toBeNull();
    const mismatch = Object.assign(new Error('differs'), { code: 'JB002' });
    await expect(
      publishBrandAsset(
        fakeTx(mismatch).tx,
        { fileId: FILE, kind: 'logo' },
        SHA,
        new Uint8Array([1]),
      ),
    ).rejects.toMatchObject({ code: 'BRAND_IMAGE_MISMATCH' });
    const other = Object.assign(new Error('other'), { code: 'XX000' });
    await expect(
      publishBrandAsset(fakeTx(other).tx, { fileId: FILE, kind: 'logo' }, SHA, new Uint8Array([1])),
    ).rejects.toThrow('other');
  });

  it('records a failure with a code (odd codes as FAILED)', async () => {
    const { tx, executed } = fakeTx([{ attempts: 2 }], [{ attempts: '1' }], []);
    expect(await noteBrandAssetFailure(tx, FILE, 'DIMENSIONS_TOO_LARGE')).toBe(2);
    expect(executed[0]?.sql).toContain('private.note_brand_asset_failure');
    expect(executed[0]?.params).toEqual([FILE, 'DIMENSIONS_TOO_LARGE']);
    expect(await noteBrandAssetFailure(tx, FILE, 'not a code; drop table')).toBe(1);
    expect(executed[1]?.params).toEqual([FILE, 'FAILED']);
    expect(await noteBrandAssetFailure(tx, FILE, 'MALFORMED')).toBe(0);
  });

  it("reads the organization's e-mail look; checked colours only", async () => {
    expect(await getEmailBrand(fakeTx([{ present: false }]).tx)).toBeNull();
    forgetBrandingDeployedForTests();
    expect(await getEmailBrand(fakeTx(deployed, []).tx)).toBeNull();
    forgetBrandingDeployedForTests();
    expect(
      await getEmailBrand(
        fakeTx(deployed, [
          { email_action_color: '#0F5E4E', email_link_color: '#0C4B3E', logo_asset_id: ASSET },
        ]).tx,
      ),
    ).toEqual({ actionColor: '#0F5E4E', linkColor: '#0C4B3E', logoAssetId: ASSET });
    forgetBrandingDeployedForTests();
    expect(
      await getEmailBrand(
        fakeTx(deployed, [
          { email_action_color: 'red', email_link_color: '#0C4B3E', logo_asset_id: ASSET },
        ]).tx,
      ),
    ).toEqual({ actionColor: null, linkColor: null, logoAssetId: ASSET });
    forgetBrandingDeployedForTests();
    expect(
      await getEmailBrand(
        fakeTx(deployed, [
          { email_action_color: null, email_link_color: null, logo_asset_id: null },
        ]).tx,
      ),
    ).toBeNull();
  });
});

describe('branding image sources, worker side (PO, 20 Oct 2026: no malware scan)', () => {
  it('reads where the image is and whether its purpose is scanned (expand-first: scanned by default)', async () => {
    const { tx, executed } = fakeTx([
      {
        bucket: 'images',
        object_key: `${TENANT}/platform/tenant_branding/${TENANT}/${FILE}`,
        status: 'uploaded',
        size_bytes: '120',
        sha256: null,
        scan_required: false,
      },
    ]);
    expect(await loadBrandImageSource(tx, FILE)).toEqual({
      bucket: 'images',
      objectKey: `${TENANT}/platform/tenant_branding/${TENANT}/${FILE}`,
      status: 'uploaded',
      scanRequired: false,
      size: 120,
      sha256: null,
    });
    expect(executed[0]?.sql).toContain("to_jsonb(p) ->> 'scan_required'");
    expect(executed[0]?.sql).toContain("f.owner_entity_type = 'tenant_branding'");
    expect(executed[0]?.params).toEqual([FILE]);
    const unknown = fakeTx([
      {
        bucket: 'images',
        object_key: 'k',
        status: 'clean',
        size_bytes: null,
        sha256: 'a',
        scan_required: null,
      },
    ]);
    expect(await loadBrandImageSource(unknown.tx, FILE)).toMatchObject({
      scanRequired: true,
      size: null,
    });
    expect(await loadBrandImageSource(fakeTx([]).tx, FILE)).toBeNull();
  });
});
