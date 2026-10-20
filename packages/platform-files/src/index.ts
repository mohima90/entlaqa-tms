import 'server-only';
import type { ActorContext } from '@jadarat/platform-core';
import {
  DomainError,
  type FileErrorCode,
  type FileOwner,
  type FileStatus,
  type FileStatusView,
  type UserTx,
  assertNoDatabaseTransaction,
  confirmFileUpload,
  deleteFileRecord,
  getFileStatus as loadFileStatus,
  grantFileDownload,
  insertAuditEvent,
  markFileUsed as recordFileUse,
  reserveUpload,
} from '@jadarat/platform-db';
import type { UserFileStorage } from '@jadarat/platform-db/supabase-server';
import { downloadName, sanitizeFileName } from './names';
import {
  FILE_PURPOSES,
  type FilePurpose,
  type UploadPurpose,
  declaredTypeFor,
  isFilePurpose,
  purposeOf,
} from './purposes';

/**
 * The files service for modules, request path (T-M2-18, ADR 0006 §3–§5; docs/engineering/files.md).
 * The owning MODULE authorizes first (may this user attach a file to / read a file of that entity?), then
 * calls these functions. The web app holds no Storage key: Storage checks our storage.objects policies
 * with the user's own session.
 *
 * Every step that writes runs in the CALLER's transaction (defineAction's handler: one pooled connection,
 * retried as a whole after a conflict); Storage signs only AFTER the commit (defineAction `afterCommit`,
 * no connection held), because it sees committed rows only, on its own connection (integration review M1):
 *
 *   handler:     reserveUploadIntent(tx, …)      → afterCommit: signUploadIntent(storage, reservation)
 *   handler:     grantDownload(tx, actor, …)     → afterCommit: signDownload(storage, granted)
 *
 * Wrap each call in `fileResult(…)` (errors.ts): expected refusals — too large, Storage unavailable, … —
 * become error results with the codes of FileErrors instead of internal errors (integration review L-b).
 *
 * Upload: the browser PUTs the bytes to the intent's `url` (with `contentType`) → confirmUpload → the
 * worker scans → getFileStatus shows `clean` (or infected / rejected). Download: a signed URL valid for
 * the purpose's TTL (60 s documents, 300 s media), saved under the original name with the extension of
 * the type found by content. Nothing is readable before `clean`.
 */

export {
  FILE_PURPOSES,
  type FilePurpose,
  type GeneratedPurpose,
  type PurposeDefinition,
  type RetentionClass,
  type UploadPurpose,
  DOWNLOAD_EXTENSIONS,
  EXTENSION_BY_TYPE,
  XLSX,
  declaredTypeFor,
  extensionOf,
  isFilePurpose,
  purposeOf,
  typeOfExtension,
} from './purposes';
export { MAX_NAME_LENGTH, downloadName, sanitizeFileName } from './names';
export {
  BRAND_IMAGE_MAX_SIDE,
  BRAND_IMAGE_PURPOSES,
  BRAND_IMAGE_SLOTS,
  type BrandImagePurpose,
  type BrandImageRefusal,
  type BrandImageSlot,
  brandImageMaxBytes,
  checkBrandImageContent,
  checkBrandImageDimensions,
  checkBrandImageUpload,
  isBrandImageSlot,
  prepareBrandImage,
} from './brand-images';
export { DETECTION_HEAD_BYTES, detectType, sniffText } from './detect';
export { FileErrors, fileAppError, fileResult } from './errors';
export type { FileErrorCode, FileOwner, FileStatus, FileStatusView } from '@jadarat/platform-db';

export interface UploadIntentInput {
  readonly purpose: UploadPurpose;
  /** The entity the file belongs to; the module checked the user may attach it. */
  readonly owner: FileOwner;
  /**
   * The name the browser reports (sanitized here). Its extension decides the declared type: it must name
   * a type the purpose accepts (`.csv`, `.xlsx`, `.png`, …); the browser's own type is not used.
   */
  readonly declaredName: string;
  /** The size the browser reports, in bytes. */
  readonly size: number;
}

export interface UploadIntent {
  readonly fileId: string;
  /** Signed upload URL for exactly this file's key (the browser PUTs the bytes there). */
  readonly url: string;
  readonly method: 'PUT';
  /** The Content-Type to send with the bytes (Storage checks it against the bucket's list). */
  readonly contentType: string;
  readonly maxBytes: number;
  /** The signed URL can be requested until then; confirm the upload once the PUT succeeded. */
  readonly expiresAt: Date;
}

/**
 * An upload reservation, written in the caller's transaction by reserveUploadIntent: pending, 15 minutes,
 * for exactly one object key. Hand it to signUploadIntent after the commit.
 */
export interface UploadReservation {
  readonly fileId: string;
  readonly bucket: string;
  readonly objectKey: string;
  /** The Content-Type the browser must send (the type the name's extension declares). */
  readonly contentType: string;
  readonly maxBytes: number;
  readonly expiresAt: Date;
}

/** File refusals: the database codes plus Storage's (unavailable: worth another try). */
export type FileServiceErrorCode = FileErrorCode | 'STORAGE_REFUSED' | 'STORAGE_UNAVAILABLE';

const MODULE = /^[a-z][a-z0-9_]{0,30}$/;
const ENTITY = /^[a-z][a-z0-9_]{0,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function refuse(code: FileServiceErrorCode, cause?: unknown): never {
  throw new DomainError<FileServiceErrorCode>(code, cause === undefined ? undefined : { cause });
}

function storageRefusal(error: unknown): never {
  const temporary = (error as { temporary?: unknown } | null)?.temporary === true;
  refuse(temporary ? 'STORAGE_UNAVAILABLE' : 'STORAGE_REFUSED', error);
}

/**
 * Transaction step (the action's handler): validates purpose, owner, size and the name's extension, then
 * reserves the upload in `tx` (pending, 15 minutes) — committed with the action, retried with it. Throws
 * DomainError UNKNOWN_PURPOSE, TYPE_NOT_ALLOWED (the name's extension is missing or names no type the
 * purpose accepts), TOO_LARGE, TOO_MANY_PENDING_UPLOADS or INVALID_FILE_DATA. A reservation that is never
 * signed or used expires and is purged after 24 hours.
 */
export async function reserveUploadIntent(
  tx: UserTx,
  input: UploadIntentInput,
): Promise<UploadReservation> {
  // Checked at run time too: callers outside TypeScript may pass any string.
  if (!isFilePurpose(input.purpose) || purposeOf(input.purpose).uploadBy !== 'user') {
    refuse('UNKNOWN_PURPOSE');
  }
  const purpose = FILE_PURPOSES[input.purpose];
  if (
    !MODULE.test(input.owner.module) ||
    !ENTITY.test(input.owner.entityType) ||
    !UUID.test(input.owner.entityId)
  ) {
    refuse('INVALID_FILE_DATA');
  }
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > purpose.maxBytes) {
    refuse('TOO_LARGE');
  }
  const name = sanitizeFileName(input.declaredName);
  const contentType = declaredTypeFor(input.purpose, name);
  if (contentType === null) refuse('TYPE_NOT_ALLOWED');
  const reserved = await reserveUpload(tx, {
    purpose: input.purpose,
    owner: input.owner,
    name,
    declaredType: contentType,
    size: input.size,
  });
  return {
    fileId: reserved.fileId,
    bucket: reserved.bucket,
    objectKey: reserved.objectKey,
    contentType,
    maxBytes: reserved.maxBytes,
    expiresAt: reserved.uploadExpiresAt,
  };
}

/**
 * After the commit (the action's `afterCommit`, no transaction open — else it throws): asks Storage, with
 * the user's session, for a signed upload URL for exactly the reserved key. Throws DomainError
 * STORAGE_REFUSED or STORAGE_UNAVAILABLE (the reservation stays; it expires unused).
 */
export async function signUploadIntent(
  storage: UserFileStorage,
  reservation: UploadReservation,
): Promise<UploadIntent> {
  assertNoDatabaseTransaction('signUploadIntent');
  let signed: { url: string };
  try {
    signed = await storage.createSignedUploadUrl(reservation.bucket, reservation.objectKey);
  } catch (error) {
    storageRefusal(error);
  }
  return {
    fileId: reservation.fileId,
    url: signed.url,
    method: 'PUT',
    contentType: reservation.contentType,
    maxBytes: reservation.maxBytes,
    expiresAt: reservation.expiresAt,
  };
}

/**
 * After the browser's PUT: `uploaded` (queued for the scan), or `rejected` at once (empty, or over the
 * limit). Only the uploader confirms. Throws DomainError FILE_NOT_FOUND, OBJECT_NOT_UPLOADED (no PUT yet)
 * or UPLOAD_EXPIRED (older than 24 hours).
 */
export async function confirmUpload(tx: UserTx, fileId: string): Promise<FileStatusView> {
  await confirmFileUpload(tx, fileId);
  const view = await loadFileStatus(tx, fileId);
  if (!view) refuse('FILE_NOT_FOUND');
  return view;
}

/** The file's status for its uploader (or a job of its tenant); null when not visible or purged. */
export function getFileStatus(tx: UserTx, fileId: string): Promise<FileStatusView | null> {
  return loadFileStatus(tx, fileId);
}

export interface DownloadLink {
  readonly url: string;
  readonly expiresAt: Date;
  /** The name the file is saved under (original name, extension of the type found by content). */
  readonly name: string;
}

/**
 * What the owning module authorized: THIS file, which must belong to THIS owner entity (the one whose
 * access the module checked) and purpose. The database grants nothing else.
 */
export interface DownloadRequest {
  readonly fileId: string;
  readonly purpose: FilePurpose;
  readonly owner: FileOwner;
}

/**
 * A download grant, written in the caller's transaction by grantDownload. Hand it to signDownload after the
 * commit.
 */
export interface GrantedDownload {
  readonly bucket: string;
  readonly objectKey: string;
  /** The name the file is saved under (original name, extension of the type found by content). */
  readonly name: string;
  readonly ttlSeconds: number;
}

/**
 * Transaction step (the action's handler) — only after the owning module authorized THIS user for files
 * of THIS owner entity: writes the download grant for a clean file of exactly `request.owner` and
 * `request.purpose` (else FILE_NOT_FOUND, as if it did not exist) and, for purposes with audited
 * downloads, the audit event `platform.file.download_granted` — both in `tx`, committed and retried with
 * the action. Throws DomainError FILE_NOT_FOUND or FILE_NOT_CLEAN.
 */
export async function grantDownload(
  tx: UserTx,
  actor: ActorContext,
  request: DownloadRequest,
): Promise<GrantedDownload> {
  const { fileId, purpose, owner } = request;
  if (
    !UUID.test(fileId) ||
    !isFilePurpose(purpose) ||
    !MODULE.test(owner.module) ||
    !ENTITY.test(owner.entityType) ||
    !UUID.test(owner.entityId)
  ) {
    refuse('FILE_NOT_FOUND');
  }
  const granted = await grantFileDownload(tx, { fileId, purpose, owner });
  if (granted.auditDownloads) {
    await insertAuditEvent(tx, actor, {
      action: 'platform.file.download_granted',
      entityType: 'file',
      entityId: fileId,
      data: { purpose, ttlSeconds: granted.ttlSeconds },
    });
  }
  return {
    bucket: granted.bucket,
    objectKey: granted.objectKey,
    name: downloadName(granted.name, granted.detectedType),
    ttlSeconds: granted.ttlSeconds,
  };
}

/**
 * After the commit (the action's `afterCommit`, no transaction open — else it throws): asks Storage, with
 * the user's session, for a signed URL of the grant's lifetime that downloads as an attachment named
 * `granted.name`. Throws DomainError STORAGE_REFUSED or STORAGE_UNAVAILABLE (the grant expires unused).
 */
export async function signDownload(
  storage: UserFileStorage,
  granted: GrantedDownload,
): Promise<DownloadLink> {
  assertNoDatabaseTransaction('signDownload');
  let url: string;
  try {
    url = await storage.createSignedDownloadUrl(
      granted.bucket,
      granted.objectKey,
      granted.ttlSeconds,
      granted.name,
    );
  } catch (error) {
    storageRefusal(error);
  }
  return { url, expiresAt: new Date(Date.now() + granted.ttlSeconds * 1000), name: granted.name };
}

/**
 * Deletes a file of the signed-in user (soft: the object is removed by housekeeping per retention class) —
 * also one still waiting for the scanner, or failed. False when already deleted. Throws DomainError
 * FILE_NOT_FOUND or FILE_BUSY (a worker is scanning it right now — try again shortly —, or infected).
 */
export function deleteFile(tx: UserTx, fileId: string): Promise<boolean> {
  return deleteFileRecord(tx, fileId);
}

/** Records the first use of a clean file (imports are kept 7 days from then). */
export function markFileUsed(tx: UserTx, fileId: string): Promise<boolean> {
  return recordFileUse(tx, fileId);
}

/** Statuses after which nothing changes any more for the user (the UI stops polling). */
export const FINAL_STATUSES: readonly FileStatus[] = [
  'clean',
  'infected',
  'rejected',
  'error',
  'deleted',
];
