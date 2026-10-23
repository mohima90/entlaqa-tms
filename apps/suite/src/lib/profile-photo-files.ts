import 'server-only';
import { ok } from '@jadarat/platform-core';
import {
  PROFILE_PHOTO_PURPOSE,
  type UploadReservation,
  confirmUpload,
  fileResult,
  getFileStatus,
  readProfilePhotoUpload,
  reserveUploadIntent,
  signUploadIntent,
} from '@jadarat/platform-files';
import { requestFileStorage } from '@jadarat/platform-files/next';
import type { ProfilePhotoFileService, ProfilePhotoReader } from '@jadarat/platform-rbac';

/** What the browser needs for its PUT (WP-ADM-04 profile photo). */
export interface PhotoUploadTarget {
  readonly fileId: string;
  readonly url: string;
  readonly method: 'PUT';
  readonly contentType: string;
  readonly maxBytes: number;
  readonly expiresAt: string;
}

/**
 * My profile → Photo: platform-files with the profile photo purpose (PNG/JPEG/WebP, 2 MB, not virus-scanned
 * — PO, 21 Oct 2026), the reservation in the action's transaction and the signed upload URL after the commit
 * with the member's own Storage session (T-M2-18 integration review M1).
 */
export const profilePhotoFiles: ProfilePhotoFileService<UploadReservation, PhotoUploadTarget> = {
  reserve: (tx, request) =>
    fileResult(
      reserveUploadIntent(tx, {
        purpose: PROFILE_PHOTO_PURPOSE,
        owner: request.owner,
        declaredName: request.declaredName,
        size: request.size,
      }),
    ),
  sign: async (reservation) => {
    const signed = await fileResult(signUploadIntent(await requestFileStorage(), reservation));
    if (!signed.ok) return signed;
    const intent = signed.value;
    return ok({
      fileId: intent.fileId,
      url: intent.url,
      method: intent.method,
      contentType: intent.contentType,
      maxBytes: intent.maxBytes,
      expiresAt: intent.expiresAt.toISOString(),
    });
  },
  confirm: (tx, fileId) => fileResult(confirmUpload(tx, fileId)),
  status: (tx, fileId) => getFileStatus(tx, fileId),
  purpose: PROFILE_PHOTO_PURPOSE,
};

/**
 * Save, before its transaction (no virus scan, so the photo shows at once): the member's own upload read
 * back with their Storage session — never a Storage key — checked by content, size and pixels and stripped
 * of its metadata (platform-files readProfilePhotoUpload). Storage unavailable → FILE_STORAGE_UNAVAILABLE.
 */
export const readProfilePhoto: ProfilePhotoReader = async ({ tenantId, personId, fileId }) => {
  const read = await fileResult(
    readProfilePhotoUpload(await requestFileStorage(), { tenantId, personId, fileId }),
  );
  if (!read.ok) return read;
  const value = read.value;
  if ('missing' in value) return ok(value);
  if ('refused' in value) return ok({ refused: value.refused });
  return ok({ publication: value.prepared });
};
