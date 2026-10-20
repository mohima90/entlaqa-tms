import 'server-only';
import { ok } from '@jadarat/platform-core';
import {
  BRAND_IMAGE_PURPOSES,
  type UploadReservation,
  confirmUpload,
  fileResult,
  getFileStatus,
  reserveUploadIntent,
  signUploadIntent,
} from '@jadarat/platform-files';
import { requestFileStorage } from '@jadarat/platform-files/next';
import type { BrandingFileService } from '@jadarat/platform-rbac';

/** What the browser needs for its PUT (WP-ADM-02 Branding images). */
export interface BrandUploadTarget {
  readonly fileId: string;
  readonly url: string;
  readonly method: 'PUT';
  readonly contentType: string;
  readonly maxBytes: number;
  readonly expiresAt: string;
}

/**
 * The Branding page's file service (WP-ADM-02): platform-files with the branding purposes (PNG/JPEG/WebP;
 * 2 MB / 500 KB / 5 MB; scanned), the reservation in the action's transaction and the signed upload URL
 * after the commit with the user's own Storage session (T-M2-18 integration review M1).
 */
export const brandingFiles: BrandingFileService<UploadReservation, BrandUploadTarget> = {
  reserve: (tx, request) =>
    fileResult(
      reserveUploadIntent(tx, {
        purpose: BRAND_IMAGE_PURPOSES[request.slot],
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
  purposeOf: (slot) => BRAND_IMAGE_PURPOSES[slot],
};
