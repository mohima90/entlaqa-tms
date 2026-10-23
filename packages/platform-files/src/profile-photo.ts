import 'server-only';
import { createHash } from 'node:crypto';
import {
  DomainError,
  type ProfilePhotoPublication,
  assertNoDatabaseTransaction,
} from '@jadarat/platform-db';
import type { UserFileStorage } from '@jadarat/platform-db/supabase-server';
import { detectType } from './detect';
import { imageSize, imageTypeOf, stripImageMetadata } from './image-info';
import { FILE_PURPOSES, declaredTypeFor } from './purposes';

/**
 * Profile photos (WP-ADM-04, FR-IAM-16; business flow EP-PEOPLE-photo-hr-fields, PO 21 and 23 Oct 2026) —
 * the branding images' path (brand-uploads.ts) for a person's OWN photo: not virus-scanned (PO answer 6),
 * so the web app reads the person's own upload back with their Storage session, checks it and removes its
 * hidden details, and the database publishes the copy (private.publish_profile_photo):
 *
 *   type by CONTENT      PNG, JPEG or WebP (never SVG, GIF or HTML), whatever the name or the browser says
 *   size                 at most 2 MB (the browser shrinks big phone photos first; this is the server's rule)
 *   pixels               at most 4096 px on a side, read from the header (no pixel is decoded: no
 *                        decompression bomb)
 *   hidden details       EXIF (GPS position, camera), XMP, comments … removed from the copy
 *   what was read        its SHA-256 and size, which the database compares with the stored object
 */

export const PROFILE_PHOTO_PURPOSE = 'platform.profile_photo' as const;

/** The largest photo, in bytes (2 MB; mirror of platform.file_purposes). */
export const PROFILE_PHOTO_MAX_BYTES = FILE_PURPOSES[PROFILE_PHOTO_PURPOSE].maxBytes;

/** The largest side in pixels. */
export const PROFILE_PHOTO_MAX_SIDE = 4096;

export type ProfilePhotoRefusal =
  'TYPE_NOT_ALLOWED' | 'TOO_LARGE' | 'EMPTY' | 'DIMENSIONS_TOO_LARGE' | 'MALFORMED';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Before an upload: the name's extension must name PNG, JPEG or WebP, and the size fit (the server reserves only then). */
export function checkProfilePhotoUpload(name: string, size: number): ProfilePhotoRefusal | null {
  if (declaredTypeFor(PROFILE_PHOTO_PURPOSE, name) === null) return 'TYPE_NOT_ALLOWED';
  if (!Number.isSafeInteger(size) || size < 1) return 'EMPTY';
  if (size > PROFILE_PHOTO_MAX_BYTES) return 'TOO_LARGE';
  return null;
}

export type PreparedProfilePhotoResult =
  | { readonly prepared: Omit<ProfilePhotoPublication, 'fileId'> }
  | { readonly refused: ProfilePhotoRefusal };

/** Checks the bytes read from an upload and prepares the copy (see the module comment). */
export async function prepareProfilePhoto(bytes: Uint8Array): Promise<PreparedProfilePhotoResult> {
  if (bytes.length === 0) return { refused: 'EMPTY' };
  if (bytes.length > PROFILE_PHOTO_MAX_BYTES) return { refused: 'TOO_LARGE' };
  const type = await detectType(bytes, true);
  const allowed: readonly string[] = FILE_PURPOSES[PROFILE_PHOTO_PURPOSE].types;
  if (type === null || !allowed.includes(type)) return { refused: 'TYPE_NOT_ALLOWED' };
  if (imageTypeOf(bytes) !== type) return { refused: 'MALFORMED' };
  const size = imageSize(bytes);
  if (size === null) return { refused: 'MALFORMED' };
  if (size.width > PROFILE_PHOTO_MAX_SIDE || size.height > PROFILE_PHOTO_MAX_SIDE) {
    return { refused: 'DIMENSIONS_TOO_LARGE' };
  }
  const content = stripImageMetadata(bytes);
  if (content === null) return { refused: 'MALFORMED' };
  return {
    prepared: {
      sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      sourceSize: bytes.length,
      contentType: type,
      content,
    },
  };
}

/**
 * Where a person's upload is stored: bucket `images`, key <tenant>/platform/person/<person>/<file>
 * (platform.files files_key_check, owner entity platform/person/<person>). Null for ids that are not UUIDs.
 */
export function profilePhotoObject(
  tenantId: string,
  personId: string,
  fileId: string,
): { readonly bucket: 'images'; readonly objectKey: string } | null {
  if (!UUID.test(tenantId) || !UUID.test(personId) || !UUID.test(fileId)) return null;
  return { bucket: 'images', objectKey: `${tenantId}/platform/person/${personId}/${fileId}` };
}

/**
 * Web app, BEFORE the save's transaction (no database transaction open — else it throws): reads the
 * caller's own photo upload with their Storage session (the read policy admits exactly that, while it waits to
 * be accepted) and prepares it. `missing`: Storage does not let this user read it (the photo already shown,
 * someone else's upload, another organization's, an older one). Throws DomainError STORAGE_UNAVAILABLE when
 * Storage cannot answer (fileResult: FILE_STORAGE_UNAVAILABLE).
 */
export async function readProfilePhotoUpload(
  storage: UserFileStorage,
  request: { readonly tenantId: string; readonly personId: string; readonly fileId: string },
): Promise<
  | { readonly prepared: ProfilePhotoPublication }
  | { readonly refused: ProfilePhotoRefusal }
  | { readonly missing: true }
> {
  assertNoDatabaseTransaction('readProfilePhotoUpload');
  const object = profilePhotoObject(request.tenantId, request.personId, request.fileId);
  if (!object) return { missing: true };
  let bytes: Uint8Array | 'too_large' | null;
  try {
    bytes = await storage.readObject(object.bucket, object.objectKey, PROFILE_PHOTO_MAX_BYTES);
  } catch (error) {
    if ((error as { temporary?: unknown } | null)?.temporary === true) {
      throw new DomainError('STORAGE_UNAVAILABLE', { cause: error });
    }
    throw error;
  }
  if (bytes === null) return { missing: true };
  if (bytes === 'too_large') return { refused: 'TOO_LARGE' };
  const result = await prepareProfilePhoto(bytes);
  if ('refused' in result) return result;
  return { prepared: { fileId: request.fileId, ...result.prepared } };
}
