import { createHash } from 'node:crypto';
import {
  type BrandImageRefusal,
  type BrandImageSlot,
  brandImageMaxBytes,
  prepareBrandImage,
} from './brand-images';

/**
 * Preparing a branding image's bytes for publishing (PO decision 20 Oct 2026: branding images are not
 * virus-scanned; WP-ADM-02, FR-ADM-07; docs/engineering/branding.md §2) — the same for the web app (at save
 * time, brand-uploads.ts) and the worker's fallback task: size within the purpose's limit, type by content
 * (PNG, JPEG or WebP — never SVG, GIF or HTML), size in pixels from the header (4096 px, the favicon 512 px),
 * metadata removed (no pixel is decoded: no decompression bomb can expand), and the SHA-256 and size of
 * exactly the bytes read, which the database compares with the stored object before it publishes
 * (private.publish_brand_image). Node only (no Storage client here: the worker imports it too).
 */

/** A branding image ready to publish: what was read, and the copy without metadata. */
export interface PreparedBrandUpload {
  readonly fileId: string;
  readonly slot: BrandImageSlot;
  /** SHA-256 (hex) and size of the bytes read (the stored upload). */
  readonly sourceSha256: string;
  readonly sourceSize: number;
  /** The type detected by content. */
  readonly contentType: string;
  /** The copy the sign-in page, the browser tab and e-mails receive (no EXIF/GPS, XMP, comments …). */
  readonly content: Uint8Array;
}

export type PreparedBrandUploadResult =
  { readonly prepared: PreparedBrandUpload } | { readonly refused: BrandImageRefusal };

/** Prepares the bytes read from an upload for publishing (see the module comment). */
export async function prepareBrandUpload(
  slot: BrandImageSlot,
  fileId: string,
  bytes: Uint8Array,
): Promise<PreparedBrandUploadResult> {
  if (bytes.length > brandImageMaxBytes(slot)) return { refused: 'TOO_LARGE' };
  const prepared = await prepareBrandImage(slot, bytes);
  if ('refused' in prepared) return prepared;
  return {
    prepared: {
      fileId,
      slot,
      sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      sourceSize: bytes.length,
      contentType: prepared.type,
      content: prepared.content,
    },
  };
}
