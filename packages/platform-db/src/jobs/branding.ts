import 'server-only';
import { sql } from 'drizzle-orm';
import { BRAND_IMAGE_KINDS, type BrandImageKind } from '../branding';
import type { ClaimsTx } from '../claims-tx';
import { DomainError } from '../domain-error';
import { pgError } from '../pg-error';

/**
 * Branding, worker side (WP-ADM-02; migration 20261023100300): the publishing task finds images in use that
 * the scan found clean and have no public copy yet (claimBrandAssetWork, platform transaction), reads each
 * scanned file and stores its copy in the image's tenant transaction (publishBrandAsset); e-mail jobs read the
 * organization's e-mail look (getEmailBrand). Only file_guard's functions reach the copies.
 */

export interface BrandAssetWork {
  readonly tenantId: string;
  readonly fileId: string;
  readonly kind: BrandImageKind;
}

let brandingSeen = false;

/** Do the branding functions exist yet (the worker deploys in parallel with the database)? */
async function brandingDeployed(tx: ClaimsTx): Promise<boolean> {
  if (brandingSeen) return true;
  const [row] = await tx.execute<{ present: boolean }>(
    sql`select to_regprocedure('private.claim_brand_asset_work(integer)') is not null as present`,
  );
  brandingSeen = row?.present === true;
  return brandingSeen;
}

/** Tests only: forget what was seen. */
export function forgetBrandingDeployedForTests(): void {
  brandingSeen = false;
}

const isKind = (value: unknown): value is BrandImageKind =>
  (BRAND_IMAGE_KINDS as readonly unknown[]).includes(value);

/** Images due for publishing (platform transaction, system claims without a tenant); none before the migration. */
export async function claimBrandAssetWork(tx: ClaimsTx, limit: number): Promise<BrandAssetWork[]> {
  if (!(await brandingDeployed(tx))) return [];
  const rows = await tx.execute<{ tenant_id: string; file_id: string; kind: string }>(
    sql`select * from private.claim_brand_asset_work(${limit}::integer)`,
  );
  return rows.flatMap((r) =>
    isKind(r.kind) ? [{ tenantId: r.tenant_id, fileId: r.file_id, kind: r.kind }] : [],
  );
}

/**
 * Stores the public copy (tenant transaction of the image): its id, or null when the image is no longer in
 * use or not clean any more. `sourceSha256` is the SHA-256 of the bytes read from storage (it must be the
 * scanned file's); `content` is the copy without metadata (no larger than the file; its own hash is stored).
 * Throws DomainError BRAND_IMAGE_MISMATCH when the source is not the scanned file.
 */
export async function publishBrandAsset(
  tx: ClaimsTx,
  work: { readonly fileId: string; readonly kind: BrandImageKind },
  sourceSha256: string,
  content: Uint8Array,
): Promise<string | null> {
  try {
    const [row] = await tx.execute<{ id: string | null }>(
      sql`select private.publish_brand_asset(${work.fileId}::uuid, ${work.kind}, ${sourceSha256}, ${Buffer.from(content)}::bytea) as id`,
    );
    return row?.id ?? null;
  } catch (error) {
    if (pgError(error)?.code === 'JB002') {
      throw new DomainError('BRAND_IMAGE_MISMATCH', { cause: error });
    }
    throw error;
  }
}

/** Where a branding image's bytes are, and what the database knows of them (the job's tenant). */
export interface BrandImageSource {
  readonly bucket: string;
  readonly objectKey: string;
  readonly status: string;
  /** false: a purpose without a malware scan (PO, 20 Oct 2026) — published from `uploaded` or `accepted`. */
  readonly scanRequired: boolean;
  /** Recorded size and SHA-256 (the scan's or the acceptance's; the size may be Storage's at confirmation). */
  readonly size: number | null;
  readonly sha256: string | null;
}

/**
 * A branding image of the job's tenant (system claims; RLS), or null when it is gone. Before migration
 * 20261023100400 every purpose counts as scanned (expand-first: the column is read through the row's JSON).
 */
export async function loadBrandImageSource(
  tx: ClaimsTx,
  fileId: string,
): Promise<BrandImageSource | null> {
  const [row] = await tx.execute<{
    bucket: string;
    object_key: string;
    status: string;
    size_bytes: string | number | null;
    sha256: string | null;
    scan_required: boolean | null;
  }>(sql`
    select f.bucket, f.object_key, f.status, f.size_bytes, f.sha256,
           coalesce((to_jsonb(p) ->> 'scan_required')::boolean, true) as scan_required
    from platform.files f join platform.file_purposes p on p.purpose = f.purpose
    where f.id = ${fileId}::uuid and f.owner_module = 'platform' and f.owner_entity_type = 'tenant_branding'
      and f.deleted_at is null and f.purged_at is null`);
  if (!row) return null;
  return {
    bucket: row.bucket,
    objectKey: row.object_key,
    status: row.status,
    scanRequired: row.scan_required !== false,
    size: row.size_bytes === null ? null : Number(row.size_bytes),
    sha256: row.sha256,
  };
}

/** Failure codes as recorded (upper-case words; anything else is recorded as FAILED). */
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{1,39}$/;

/**
 * Records that an image could not be published (tenant transaction of the image; security review L5): the
 * next try waits 2, 4, 8, … minutes (at most a day); after 5 failures the image is given up — the Branding
 * page then says it cannot be used. Returns the number of failures (0: not a Branding image of this tenant).
 */
export async function noteBrandAssetFailure(
  tx: ClaimsTx,
  fileId: string,
  code: string,
): Promise<number> {
  const recorded = FAILURE_CODE.test(code) ? code : 'FAILED';
  const [row] = await tx.execute<{ attempts: number | string }>(
    sql`select private.note_brand_asset_failure(${fileId}::uuid, ${recorded}) as attempts`,
  );
  return Number(row?.attempts ?? 0);
}

/** The e-mail look of the job's organization (FR-NTF-02); null: the Jadarat look (or before the migration). */
export interface EmailBrand {
  /** Button colour (white text ≥ 4.5 : 1), `#RRGGBB`; null: the layout's own. */
  readonly actionColor: string | null;
  /** Link colour (≥ 4.5 : 1 on white), `#RRGGBB`; null: the layout's own. */
  readonly linkColor: string | null;
  /** The published logo's public id (/api/brand/<id>), or null. */
  readonly logoAssetId: string | null;
}

const HEX = /^#[0-9A-F]{6}$/;

/** Read in the job's tenant transaction (system claims; RLS). Values are checked again before use. */
export async function getEmailBrand(tx: ClaimsTx): Promise<EmailBrand | null> {
  if (!(await brandingDeployed(tx))) return null;
  const [row] = await tx.execute<{
    email_action_color: string | null;
    email_link_color: string | null;
    logo_asset_id: string | null;
  }>(sql`
    select b.email_action_color, b.email_link_color,
           (select a.id from platform.brand_assets a where a.tenant_id = b.tenant_id and a.file_id = b.logo_file_id) as logo_asset_id
    from platform.tenant_branding b
    where b.tenant_id = (select private.current_tenant_id())`);
  if (!row) return null;
  const valid =
    row.email_action_color !== null &&
    row.email_link_color !== null &&
    HEX.test(row.email_action_color) &&
    HEX.test(row.email_link_color);
  if (!valid && !row.logo_asset_id) return null;
  return {
    actionColor: valid ? row.email_action_color : null,
    linkColor: valid ? row.email_link_color : null,
    logoAssetId: row.logo_asset_id,
  };
}
