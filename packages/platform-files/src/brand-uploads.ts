import 'server-only';
import { DomainError, assertNoDatabaseTransaction } from '@jadarat/platform-db';
import type { UserFileStorage } from '@jadarat/platform-db/supabase-server';
import { type BrandImageSlot, brandImageMaxBytes } from './brand-images';
import { type PreparedBrandUploadResult, prepareBrandUpload } from './brand-prepare';

export type { PreparedBrandUpload, PreparedBrandUploadResult } from './brand-prepare';
export { prepareBrandUpload } from './brand-prepare';

/**
 * Branding images without a malware scan (PO decision 20 Oct 2026 — like Kawadir ATS; WP-ADM-02, FR-ADM-07;
 * docs/engineering/branding.md §2): the bytes of an upload, read ONCE, become what the public copy is made
 * of. The web app reads the upload with the uploader's own Storage session at save time (readBrandUpload),
 * the worker with its key when the web app could not (its fallback task); both prepare it the same way
 * (prepareBrandUpload, brand-prepare.ts).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Where an upload for an organization's Branding is stored: bucket `images`, key
 * <tenant>/platform/tenant_branding/<tenant>/<file> (platform.files files_key_check, owner entity
 * platform/tenant_branding/<tenant>). Null for ids that are not UUIDs (nothing else reaches Storage).
 */
export function brandUploadObject(
  tenantId: string,
  fileId: string,
): { readonly bucket: 'images'; readonly objectKey: string } | null {
  if (!UUID.test(tenantId) || !UUID.test(fileId)) return null;
  return {
    bucket: 'images',
    objectKey: `${tenantId}/platform/tenant_branding/${tenantId}/${fileId}`,
  };
}

/**
 * Web app, BEFORE the save's transaction (no database transaction open — else it throws): reads the
 * caller's own branding upload with their Storage session (the read policy admits exactly that, while it
 * waits to be accepted) and prepares it. `missing`: Storage does not let this user read it — the image the
 * Branding already shows, someone else's upload, another organization's, an older one — nothing to publish
 * now. Throws DomainError STORAGE_UNAVAILABLE when Storage cannot answer (fileResult: FILE_STORAGE_UNAVAILABLE).
 */
export async function readBrandUpload(
  storage: UserFileStorage,
  request: { readonly tenantId: string; readonly slot: BrandImageSlot; readonly fileId: string },
): Promise<PreparedBrandUploadResult | { readonly missing: true }> {
  assertNoDatabaseTransaction('readBrandUpload');
  const object = brandUploadObject(request.tenantId, request.fileId);
  if (!object) return { missing: true };
  let bytes: Uint8Array | 'too_large' | null;
  try {
    bytes = await storage.readObject(
      object.bucket,
      object.objectKey,
      brandImageMaxBytes(request.slot),
    );
  } catch (error) {
    // Storage unavailable: worth another try (fileResult → FILE_STORAGE_UNAVAILABLE); anything else is a bug.
    if ((error as { temporary?: unknown } | null)?.temporary === true) {
      throw new DomainError('STORAGE_UNAVAILABLE', { cause: error });
    }
    throw error;
  }
  if (bytes === null) return { missing: true };
  if (bytes === 'too_large') return { refused: 'TOO_LARGE' };
  return prepareBrandUpload(request.slot, request.fileId, bytes);
}
