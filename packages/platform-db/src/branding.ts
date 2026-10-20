import 'server-only';
import { sql } from 'drizzle-orm';
import { type ClaimsTx, runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';
import { DomainError } from './domain-error';
import { pgError } from './pg-error';
import type { UserTx } from './with-user-tx';

/**
 * The organization's look (WP-ADM-02, FR-ADM-07; migrations 20261023100000–100300;
 * docs/engineering/branding.md): platform.tenant_branding (colours, gradient, website, image references),
 * the display names on platform.tenants, and the published copies of its images (platform.brand_assets,
 * served at /api/brand/<id>). The database decides who may change it (the Organization Admin) and every
 * rule; these are its request-path calls, plus the claim-less reads of the public delivery path.
 *
 * Expand-first (the app deploys in parallel with the database): every read first asks whether the tables
 * exist — a catalog lookup, never a failing query — and answers «the Jadarat look» until they do.
 */

export const BRAND_IMAGE_KINDS = ['logo', 'favicon', 'sign_in_image'] as const;
export type BrandImageKind = (typeof BRAND_IMAGE_KINDS)[number];

/** What every page needs: the colours and the published images (null colours: the Jadarat look). */
export interface TenantBrand {
  /** The organization's slug (the sign-in page finds its look by it). */
  readonly slug: string;
  readonly primaryColor: string | null;
  readonly secondaryColor: string | null;
  readonly useGradient: boolean;
  readonly websiteUrl: string | null;
  /** Ids of the published copies (/api/brand/<id>); null: not set, or not published yet. */
  readonly logoAssetId: string | null;
  readonly faviconAssetId: string | null;
  readonly signInImageAssetId: string | null;
}

/** The look as saved (the Branding page; audited before → after). */
export interface BrandingSettings {
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly primaryColor: string | null;
  readonly secondaryColor: string | null;
  readonly useGradient: boolean;
  readonly websiteUrl: string | null;
  readonly logoFileId: string | null;
  readonly faviconFileId: string | null;
  readonly signInImageFileId: string | null;
}

/** An image slot as the Branding page shows it. */
export interface BrandImageState {
  readonly fileId: string;
  /** The published copy (published when saved; older, scanned images once the worker copied them). */
  readonly assetId: string | null;
  /** The file's status — only for the admin who uploaded it (files are visible to their uploader). */
  readonly status: string | null;
  /** Its sanitized name (uploader only). */
  readonly name: string | null;
  /** The worker gave up publishing it (5 failures: not a usable image) — the page asks for another. */
  readonly failed: boolean;
}

export interface BrandingRecord extends BrandingSettings {
  readonly images: Readonly<Record<BrandImageKind, BrandImageState | null>>;
  /** Null: never saved (the Jadarat look). */
  readonly updatedAt: Date | null;
  readonly updatedBy: { readonly nameAr: string; readonly nameEn: string | null } | null;
  /** Concurrency token; 0 while no branding row exists. */
  readonly version: number;
}

let brandingSeen = false;

/** Do the branding tables exist yet (migration 20261023100300)? Cached once true (expand-first). */
export async function brandingExists(tx: ClaimsTx): Promise<boolean> {
  if (brandingSeen) return true;
  const [row] = await tx.execute<{ present: boolean }>(
    sql`select to_regclass('platform.tenant_branding') is not null
               and to_regprocedure('private.public_tenant_brand(text)') is not null as present`,
  );
  brandingSeen = row?.present === true;
  return brandingSeen;
}

/** Tests only: forget what was seen. */
export function forgetBrandingPresenceForTests(): void {
  brandingSeen = false;
}

type Row = Record<string, unknown>;
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;
const idOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The claims' organization's look for the shell (RLS), or null without a visible organization. */
export async function getTenantBrand(tx: ClaimsTx): Promise<TenantBrand | null> {
  if (!(await brandingExists(tx))) {
    const [tenant] = await tx.execute<{ slug: string }>(
      sql`select slug from platform.tenants where id = (select private.current_tenant_id())`,
    );
    return tenant ? jadaratLook(tenant.slug) : null;
  }
  const [row] = await tx.execute(sql`
    select t.slug, b.primary_color, b.secondary_color, coalesce(b.use_gradient, true) as use_gradient,
           b.website_url,
           (select a.id from platform.brand_assets a where a.tenant_id = t.id and a.file_id = b.logo_file_id) as logo_asset_id,
           (select a.id from platform.brand_assets a where a.tenant_id = t.id and a.file_id = b.favicon_file_id) as favicon_asset_id,
           (select a.id from platform.brand_assets a where a.tenant_id = t.id and a.file_id = b.sign_in_image_file_id) as sign_in_image_asset_id
    from platform.tenants t
    left join platform.tenant_branding b on b.tenant_id = t.id
    where t.id = (select private.current_tenant_id())`);
  return row ? brandOf(row) : null;
}

function jadaratLook(slug: string): TenantBrand {
  return {
    slug,
    primaryColor: null,
    secondaryColor: null,
    useGradient: true,
    websiteUrl: null,
    logoAssetId: null,
    faviconAssetId: null,
    signInImageAssetId: null,
  };
}

function brandOf(row: Row): TenantBrand {
  return {
    slug: typeof row.slug === 'string' ? row.slug : '',
    primaryColor: text(row.primary_color),
    secondaryColor: text(row.secondary_color),
    useGradient: row.use_gradient !== false,
    websiteUrl: text(row.website_url),
    logoAssetId: idOf(row.logo_asset_id),
    faviconAssetId: idOf(row.favicon_asset_id),
    signInImageAssetId: idOf(row.sign_in_image_asset_id),
  };
}

const SETTINGS_COLUMNS = sql`t.name_ar, t.name_en, b.primary_color, b.secondary_color,
  coalesce(b.use_gradient, true) as use_gradient, b.website_url, b.logo_file_id, b.favicon_file_id,
  b.sign_in_image_file_id, b.version`;

function settingsOf(row: Row): BrandingSettings {
  return {
    nameAr: String(row.name_ar),
    nameEn: text(row.name_en),
    primaryColor: text(row.primary_color),
    secondaryColor: text(row.secondary_color),
    useGradient: row.use_gradient !== false,
    websiteUrl: text(row.website_url),
    logoFileId: idOf(row.logo_file_id),
    faviconFileId: idOf(row.favicon_file_id),
    signInImageFileId: idOf(row.sign_in_image_file_id),
  };
}

const FILE_COLUMN: Readonly<
  Record<BrandImageKind, 'logoFileId' | 'faviconFileId' | 'signInImageFileId'>
> = { logo: 'logoFileId', favicon: 'faviconFileId', sign_in_image: 'signInImageFileId' };

/** The Branding page's record (RLS: the claims' organization), or null without the tables or a tenant. */
export async function getBranding(tx: UserTx): Promise<BrandingRecord | null> {
  if (!(await brandingExists(tx))) return null;
  const [row] = await tx.execute(sql`
    select ${SETTINGS_COLUMNS}, b.updated_at,
           coalesce(e.display_name_ar, e.display_name_en) as editor_name_ar, e.display_name_en as editor_name_en
    from platform.tenants t
    left join platform.tenant_branding b on b.tenant_id = t.id
    left join platform.persons e on e.tenant_id = b.tenant_id and e.id = b.updated_by
    where t.id = (select private.current_tenant_id())`);
  if (!row) return null;
  const settings = settingsOf(row);
  const ids = BRAND_IMAGE_KINDS.map((kind) => settings[FILE_COLUMN[kind]]).filter(
    (id): id is string => id !== null,
  );
  const states = new Map<string, BrandImageState>();
  if (ids.length > 0) {
    const list = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    // Files: only the uploader sees status and name (RLS); copies: every member.
    const rows = await tx.execute<{
      id: string;
      asset_id: string | null;
      status: string | null;
      original_name: string | null;
      given_up: boolean | null;
    }>(sql`
      select v.id, a.id as asset_id, f.status, f.original_name,
             x.next_try_at = 'infinity'::timestamptz as given_up
      from (select unnest(array[${list}]) as id) v
      left join platform.brand_assets a on a.file_id = v.id
      left join platform.brand_asset_attempts x on x.file_id = v.id
      left join platform.files f on f.id = v.id`);
    for (const r of rows) {
      states.set(r.id, {
        fileId: r.id,
        assetId: r.asset_id,
        status: r.status,
        name: r.original_name,
        failed: r.given_up === true && r.asset_id === null,
      });
    }
  }
  const image = (kind: BrandImageKind): BrandImageState | null => {
    const id = settings[FILE_COLUMN[kind]];
    return id === null
      ? null
      : (states.get(id) ?? { fileId: id, assetId: null, status: null, name: null, failed: false });
  };
  const editor = text(row.editor_name_ar);
  return {
    ...settings,
    images: {
      logo: image('logo'),
      favicon: image('favicon'),
      sign_in_image: image('sign_in_image'),
    },
    updatedAt: row.updated_at ? new Date(row.updated_at as string | Date) : null,
    updatedBy: editor ? { nameAr: editor, nameEn: text(row.editor_name_en) } : null,
    version: row.version === null || row.version === undefined ? 0 : Number(row.version),
  };
}

export interface BrandingSave extends BrandingSettings {
  /** Derived from the primary colour by the app (packages/ui emailBrandColors); null with the colours. */
  readonly emailActionColor: string | null;
  readonly emailLinkColor: string | null;
}

export type BrandingField = keyof BrandingSettings;

export type BrandingUpdate =
  | {
      readonly outcome: 'updated';
      readonly before: BrandingSettings;
      readonly after: BrandingSettings;
      readonly version: number;
      /** Sanitized names of the images before and after, by file id (the audit record; BR-BRD-a). */
      readonly imageNames: Readonly<Record<string, string>>;
    }
  | { readonly outcome: 'unchanged'; readonly version: number }
  /** An image that is not the saver's usable upload, or a value the database refuses. */
  | { readonly outcome: 'invalid'; readonly field: BrandingField }
  | { readonly outcome: 'conflict' | 'refused' | 'unavailable' };

/** The fields whose values differ (audit: before/after of these only). */
export function changedBrandingFields(
  before: BrandingSettings,
  after: BrandingSettings,
): BrandingField[] {
  return (Object.keys(after) as BrandingField[]).filter((key) => before[key] !== after[key]);
}

const CONSTRAINT_FIELDS: Readonly<Record<string, BrandingField>> = {
  tenant_branding_colors_check: 'primaryColor',
  tenant_branding_email_colors_check: 'primaryColor',
  tenant_branding_website_check: 'websiteUrl',
  tenants_name_en_check: 'nameEn',
  tenants_name_ar_check: 'nameAr',
  tenants_name_ar_length_check: 'nameAr',
  tenants_names_bidi_check: 'nameAr',
};

const IMAGE_FIELDS = ['logoFileId', 'faviconFileId', 'signInImageFileId'] as const;

/**
 * The sanitized names of the organization's branding images among `ids` (private.branding_image_names: any
 * admin's upload of this organization's Branding, never another organization's file).
 */
async function brandingImageNames(
  tx: UserTx,
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await tx.execute<{ id: string; name: string | null }>(
    sql`select id, name from private.branding_image_names(array[${list}])`,
  );
  return Object.fromEntries(
    rows.flatMap((r) => (typeof r.name === 'string' ? [[r.id, r.name] as const] : [])),
  );
}

/** Which image the JB001 refusal names ("branding image logo is not usable"). */
function refusedImage(message: string): BrandingField {
  if (message.includes('favicon')) return 'faviconFileId';
  if (message.includes('sign_in_image')) return 'signInImageFileId';
  return 'logoFileId';
}

/**
 * Saves the look when it is still at `version` (0: no row yet) and differs from what is stored: the branding
 * row (inserted on the first save; stamped with the saver and moved to a new version by the database) and the
 * display names when they changed. The database lets only an Organization Admin write either (policies
 * tenant_branding_insert/update and tenants_update) and checks every image (trigger tenant_branding_files:
 * the saver's own confirmed upload of that purpose; a replaced, removed or unused one is released). Any
 * refusal changes nothing — the caller's transaction is rolled back.
 */
export async function saveBranding(
  tx: UserTx,
  input: BrandingSave,
  version: number,
): Promise<BrandingUpdate> {
  if (!(await brandingExists(tx))) return { outcome: 'unavailable' };
  const [current] = await tx.execute(sql`
    select ${SETTINGS_COLUMNS}
    from platform.tenants t
    left join platform.tenant_branding b on b.tenant_id = t.id
    where t.id = (select private.current_tenant_id())
    for no key update of t`);
  if (!current) return { outcome: 'refused' };
  const stored =
    current.version === null || current.version === undefined ? 0 : Number(current.version);
  if (stored !== version) return { outcome: 'conflict' };
  const before = settingsOf(current);
  const { emailActionColor, emailLinkColor, ...after } = input;
  const changed = changedBrandingFields(before, after);
  if (changed.length === 0) return { outcome: 'unchanged', version };
  // Read before the update: a replaced or removed image is released by the save.
  const imageIds = new Set<string>();
  for (const field of IMAGE_FIELDS) {
    if (!changed.includes(field)) continue;
    for (const id of [before[field], after[field]]) if (id !== null) imageIds.add(id);
  }
  const imageNames = await brandingImageNames(tx, [...imageIds]);
  try {
    const values = sql`${after.primaryColor}, ${after.secondaryColor}, ${after.useGradient},
      ${after.websiteUrl}, ${after.logoFileId}::uuid, ${after.faviconFileId}::uuid,
      ${after.signInImageFileId}::uuid, ${emailActionColor}, ${emailLinkColor}`;
    const [saved] =
      stored === 0
        ? await tx.execute<{ version: number }>(sql`
            insert into platform.tenant_branding (primary_color, secondary_color, use_gradient, website_url,
              logo_file_id, favicon_file_id, sign_in_image_file_id, email_action_color, email_link_color)
            values (${values})
            returning version`)
        : await tx.execute<{ version: number }>(sql`
            update platform.tenant_branding
            set (primary_color, secondary_color, use_gradient, website_url, logo_file_id, favicon_file_id,
                 sign_in_image_file_id, email_action_color, email_link_color) = (${values})
            where tenant_id = (select private.current_tenant_id()) and version = ${version}
            returning version`);
    if (!saved) return { outcome: 'refused' };
    if (after.nameAr !== before.nameAr || after.nameEn !== before.nameEn) {
      const [names] = await tx.execute(sql`
        update platform.tenants set name_ar = ${after.nameAr}, name_en = ${after.nameEn}
        where id = (select private.current_tenant_id())
        returning id`);
      if (!names) return { outcome: 'refused' };
    }
    return { outcome: 'updated', before, after, version: saved.version, imageNames };
  } catch (error) {
    const pg = pgError(error);
    if (pg?.code === 'JB001') return { outcome: 'invalid', field: refusedImage(pg.message) };
    const field =
      pg?.code === '23514' && pg.constraint ? CONSTRAINT_FIELDS[pg.constraint] : undefined;
    if (field) return { outcome: 'invalid', field };
    // RLS (42501): not an Organization Admin any more.
    if (pg?.code === '42501') return { outcome: 'refused' };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------
// Publishing an image at save time (PO, 20 Oct 2026: branding images are not virus-scanned)
// ---------------------------------------------------------------------------------------------------

/**
 * A branding image as the web app read it from Storage with the uploader's session, checked by content
 * and without its metadata (platform-files prepareBrandUpload).
 */
export interface BrandImagePublication {
  readonly fileId: string;
  readonly kind: BrandImageKind;
  /** SHA-256 (hex) and size of the bytes read from Storage (the stored upload). */
  readonly sourceSha256: string;
  readonly sourceSize: number;
  /** The type detected by content: image/png, image/jpeg or image/webp. */
  readonly contentType: string;
  /** The copy without metadata (what /api/brand/<id> serves). */
  readonly content: Uint8Array;
}

let publishingSeen = false;

/** Does the database publish at save time yet (migration 20261023100600)? Cached once true. */
async function publishingDeployed(tx: ClaimsTx): Promise<boolean> {
  if (publishingSeen) return true;
  const [row] = await tx.execute<{ present: boolean }>(
    sql`select to_regprocedure('private.publish_brand_image(uuid,text,text,bigint,text,bytea)') is not null as present`,
  );
  publishingSeen = row?.present === true;
  return publishingSeen;
}

/** Tests only: forget what was seen. */
export function forgetBrandPublishingPresenceForTests(): void {
  publishingSeen = false;
}

/**
 * Stores the public copy of a branding image of a purpose without a malware scan (private.publish_brand_image;
 * the file becomes `accepted`): in the Branding save's transaction (user claims: an Organization Admin's OWN
 * upload), or in a job of the image's tenant (the worker's fallback). Only an image the Branding still uses
 * for that kind, with the bytes of the stored file. The copy's public id, or null when
 * the database does not publish it (not this kind's image any more, someone else's upload, a scanned image —
 * the worker publishes those —, or the database before the migration). Throws DomainError
 * BRAND_IMAGE_MISMATCH when the bytes are not the stored file's or not an allowed image.
 */
export async function publishBrandImage(
  tx: ClaimsTx,
  image: BrandImagePublication,
): Promise<string | null> {
  if (!(await publishingDeployed(tx))) return null;
  try {
    const [row] = await tx.execute<{ id: string | null }>(sql`
      select private.publish_brand_image(${image.fileId}::uuid, ${image.kind}, ${image.sourceSha256},
        ${image.sourceSize}::bigint, ${image.contentType}, ${Buffer.from(image.content)}::bytea) as id`);
    return row?.id ?? null;
  } catch (error) {
    const code = pgError(error)?.code;
    if (code === 'JB002' || code === 'JB003') {
      throw new DomainError('BRAND_IMAGE_MISMATCH', { cause: error });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------
// Public delivery path (no session): claim-less app_server transactions
// ---------------------------------------------------------------------------------------------------

/** The sign-in page's look of an organization in service (null: unknown, not in service, or not yet built). */
export interface PublicTenantBrand {
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly primaryColor: string | null;
  readonly secondaryColor: string | null;
  readonly useGradient: boolean;
  readonly logoAssetId: string | null;
  readonly faviconAssetId: string | null;
  readonly signInImageAssetId: string | null;
}

/** A published copy without its bytes: enough to answer a revalidation (If-None-Match) with 304. */
export interface PublicBrandAssetMeta {
  readonly contentType: string;
  readonly sha256: string;
  readonly byteSize: number;
}

export interface PublicBrandAsset {
  readonly contentType: string;
  readonly content: Uint8Array;
  readonly sha256: string;
}

export interface PublicBrandApi {
  tenantBrandBySlug(slug: string): Promise<PublicTenantBrand | null>;
  brandAsset(id: string): Promise<PublicBrandAsset | null>;
  /** The same answer as brandAsset without loading the bytes (security review M1). */
  brandAssetMeta(id: string): Promise<PublicBrandAssetMeta | null>;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** True for the "function does not exist yet" of a database before the migration (expand-first). */
function notDeployed(error: unknown): boolean {
  const code = pgError(error)?.code;
  return code === '42883' || code === '3F000' || code === '42P01';
}

/**
 * The public reads over a database connected as `app_server`, in a transaction WITHOUT claims (`set local
 * role authenticated`, empty request.jwt.claims): the definer functions answer only that connection role and
 * return the minimum. Inputs are checked for their shape first (nothing else reaches the database).
 */
export function createPublicBrandApi(getDb: () => AppDatabase): PublicBrandApi {
  const withoutClaims = <T>(fn: (tx: ClaimsTx) => Promise<T>) =>
    runWithClaims(getDb(), '', fn, { readOnly: true });
  return {
    async tenantBrandBySlug(slug) {
      if (!SLUG.test(slug)) return null;
      try {
        const [row] = await withoutClaims((tx) =>
          tx.execute(sql`select * from private.public_tenant_brand(${slug})`),
        );
        if (!row) return null;
        return {
          nameAr: String(row.name_ar),
          nameEn: text(row.name_en),
          primaryColor: text(row.primary_color),
          secondaryColor: text(row.secondary_color),
          useGradient: row.use_gradient !== false,
          logoAssetId: idOf(row.logo_asset_id),
          faviconAssetId: idOf(row.favicon_asset_id),
          signInImageAssetId: idOf(row.sign_in_image_asset_id),
        };
      } catch (error) {
        if (notDeployed(error)) return null;
        throw error;
      }
    },
    async brandAsset(id) {
      if (!UUID.test(id)) return null;
      try {
        const [row] = await withoutClaims((tx) =>
          tx.execute<{ content_type: string; content: Uint8Array; sha256: string }>(
            sql`select * from private.public_brand_asset(${id}::uuid)`,
          ),
        );
        if (!row) return null;
        return { contentType: row.content_type, content: row.content, sha256: row.sha256 };
      } catch (error) {
        if (notDeployed(error)) return null;
        throw error;
      }
    },
    async brandAssetMeta(id) {
      if (!UUID.test(id)) return null;
      try {
        const [row] = await withoutClaims((tx) =>
          tx.execute<{ content_type: string; sha256: string; byte_size: number | string }>(
            sql`select * from private.public_brand_asset_meta(${id}::uuid)`,
          ),
        );
        if (!row) return null;
        return {
          contentType: row.content_type,
          sha256: row.sha256,
          byteSize: Number(row.byte_size),
        };
      } catch (error) {
        if (notDeployed(error)) return null;
        throw error;
      }
    },
  };
}

const defaultPublicApi = createPublicBrandApi(() => getDatabase('app_server'));

/** The sign-in page's look of the organization with this slug (public). */
export function publicTenantBrand(slug: string): Promise<PublicTenantBrand | null> {
  return defaultPublicApi.tenantBrandBySlug(slug);
}

/** A published branding image by its public id (public; /api/brand/<id>). */
export function publicBrandAsset(id: string): Promise<PublicBrandAsset | null> {
  return defaultPublicApi.brandAsset(id);
}

/** A published branding image's type, hash and size, without its bytes (public; revalidation). */
export function publicBrandAssetMeta(id: string): Promise<PublicBrandAssetMeta | null> {
  return defaultPublicApi.brandAssetMeta(id);
}
