import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ClaimsTx } from '../claims-tx';
import {
  claimBrandAssetWork,
  forgetBrandingDeployedForTests,
  getEmailBrand,
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
    expect(await claimBrandAssetWork(tx, 20)).toEqual([{ tenantId: TENANT, fileId: FILE, kind: 'logo' }]);
    expect(executed[1]?.sql).toContain('private.claim_brand_asset_work');
    expect(executed[1]?.params).toContain(20);
  });

  it('publishes the bytes; a mismatch is a DomainError', async () => {
    const { tx, executed } = fakeTx([{ id: ASSET }]);
    expect(await publishBrandAsset(tx, { fileId: FILE, kind: 'favicon' }, new Uint8Array([1, 2]))).toBe(
      ASSET,
    );
    expect(executed[0]?.sql).toContain('private.publish_brand_asset');
    expect(await publishBrandAsset(fakeTx([{ id: null }]).tx, { fileId: FILE, kind: 'logo' }, new Uint8Array([1]))).toBeNull();
    const mismatch = Object.assign(new Error('differs'), { code: 'JB002' });
    await expect(
      publishBrandAsset(fakeTx(mismatch).tx, { fileId: FILE, kind: 'logo' }, new Uint8Array([1])),
    ).rejects.toMatchObject({ code: 'BRAND_IMAGE_MISMATCH' });
    const other = Object.assign(new Error('other'), { code: 'XX000' });
    await expect(
      publishBrandAsset(fakeTx(other).tx, { fileId: FILE, kind: 'logo' }, new Uint8Array([1])),
    ).rejects.toThrow('other');
  });

  it("reads the organization's e-mail look; checked colours only", async () => {
    expect(await getEmailBrand(fakeTx([{ present: false }]).tx)).toBeNull();
    forgetBrandingDeployedForTests();
    expect(await getEmailBrand(fakeTx(deployed, []).tx)).toBeNull();
    forgetBrandingDeployedForTests();
    expect(
      await getEmailBrand(
        fakeTx(deployed, [{ email_action_color: '#0F5E4E', email_link_color: '#0C4B3E', logo_asset_id: ASSET }]).tx,
      ),
    ).toEqual({ actionColor: '#0F5E4E', linkColor: '#0C4B3E', logoAssetId: ASSET });
    forgetBrandingDeployedForTests();
    expect(
      await getEmailBrand(
        fakeTx(deployed, [{ email_action_color: 'red', email_link_color: '#0C4B3E', logo_asset_id: ASSET }]).tx,
      ),
    ).toEqual({ actionColor: null, linkColor: null, logoAssetId: ASSET });
    forgetBrandingDeployedForTests();
    expect(
      await getEmailBrand(
        fakeTx(deployed, [{ email_action_color: null, email_link_color: null, logo_asset_id: null }]).tx,
      ),
    ).toBeNull();
  });
});
