import 'server-only';
import type { ActorContext } from '@jadarat/platform-core';
import {
  DomainError,
  type FileErrorCode,
  type FileOwner,
  type FileStatus,
  type FileStatusView,
  type UserTx,
  confirmFileUpload,
  deleteFileRecord,
  getFileStatus as loadFileStatus,
  grantFileDownload,
  insertAuditEvent,
  markFileUsed as recordFileUse,
  reserveUpload,
} from '@jadarat/platform-db';
import type { UserFileStorage } from '@jadarat/platform-db/supabase-server';
import { sanitizeFileName } from './names';
import {
  FILE_PURPOSES,
  type UploadPurpose,
  isFilePurpose,
  normalizeDeclaredType,
  purposeOf,
} from './purposes';

/**
 * The files service for modules, request path (T-M2-18, ADR 0006 §3–§5; docs/engineering/files.md).
 * The owning MODULE authorizes first (may this user attach a file to / read a file of that entity?), then
 * calls these functions. The web app holds no Storage key: Storage checks our storage.objects policies
 * with the user's own session.
 *
 * Upload: createUploadIntent → the browser PUTs the bytes to `url` (with `contentType`) → confirmUpload →
 * the worker scans → getFileStatus shows `clean` (or infected / rejected). Download: createDownloadGrant
 * → a signed URL valid for the purpose's TTL (60 s documents, 300 s media). Nothing is readable before
 * `clean`.
 */

export {
  FILE_PURPOSES,
  type FilePurpose,
  type GeneratedPurpose,
  type PurposeDefinition,
  type RetentionClass,
  type UploadPurpose,
  XLSX,
  isFilePurpose,
  normalizeDeclaredType,
  purposeOf,
} from './purposes';
export { MAX_NAME_LENGTH, sanitizeFileName } from './names';
export { DETECTION_HEAD_BYTES, detectType, sniffText } from './detect';
export type { FileErrorCode, FileOwner, FileStatus, FileStatusView } from '@jadarat/platform-db';

/**
 * What a request needs beside its own transaction. Storage sees only COMMITTED rows (it has its own
 * database connection), so the upload reservation and the download grant are written in a transaction of
 * their own, committed before Storage is asked — `ownTx` runs one for the signed-in user (e.g.
 * `(fn) => withUserTx(ctx.claims, fn)`; @jadarat/platform-files/next builds the whole context).
 */
export interface FileRequestContext {
  readonly ownTx: <T>(fn: (tx: UserTx) => Promise<T>) => Promise<T>;
  /** Supabase Storage with the user's session (createUserFileStorage). */
  readonly storage: UserFileStorage;
}

export interface UploadIntentInput {
  readonly purpose: UploadPurpose;
  /** The entity the file belongs to; the module checked the user may attach it. */
  readonly owner: FileOwner;
  /** The name the browser reports (sanitized here). */
  readonly declaredName: string;
  /** The type the browser reports (advisory; the scan detects the real type). */
  readonly declaredType: string | null | undefined;
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
 * Reserves the upload (pending, 15 minutes, in its own committed transaction) and asks Storage — with the
 * user's session — for a signed upload URL for exactly that key. Throws DomainError UNKNOWN_PURPOSE,
 * TYPE_NOT_ALLOWED, TOO_LARGE, TOO_MANY_PENDING_UPLOADS, INVALID_FILE_DATA, STORAGE_REFUSED or
 * STORAGE_UNAVAILABLE. A reservation without upload is purged after 24 hours.
 */
export async function createUploadIntent(
  context: FileRequestContext,
  input: UploadIntentInput,
): Promise<UploadIntent> {
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
  const contentType = normalizeDeclaredType(input.purpose, name, input.declaredType);
  if (contentType === null) refuse('TYPE_NOT_ALLOWED');
  const reserved = await context.ownTx((tx) =>
    reserveUpload(tx, {
      purpose: input.purpose,
      owner: input.owner,
      name,
      declaredType: contentType,
      size: input.size,
    }),
  );
  let signed: { url: string };
  try {
    signed = await context.storage.createSignedUploadUrl(reserved.bucket, reserved.objectKey);
  } catch (error) {
    storageRefusal(error);
  }
  return {
    fileId: reserved.fileId,
    url: signed.url,
    method: 'PUT',
    contentType,
    maxBytes: reserved.maxBytes,
    expiresAt: reserved.uploadExpiresAt,
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
  readonly name: string;
}

/**
 * A short-lived download link for a clean file — only after the owning module authorized THIS user for
 * THIS file. Writes the download grant (and, for purposes with audited downloads, the audit event
 * `platform.file.download_granted`) in its own committed transaction, then asks Storage, with the user's
 * session, for a signed URL of the same lifetime that downloads as an attachment named like the original.
 * Throws DomainError FILE_NOT_FOUND, FILE_NOT_CLEAN, STORAGE_REFUSED or STORAGE_UNAVAILABLE.
 */
export async function createDownloadGrant(
  context: FileRequestContext,
  actor: ActorContext,
  fileId: string,
): Promise<DownloadLink> {
  if (!UUID.test(fileId)) refuse('FILE_NOT_FOUND');
  const grant = await context.ownTx(async (tx) => {
    const granted = await grantFileDownload(tx, fileId);
    if (granted.auditDownloads) {
      await insertAuditEvent(tx, actor, {
        action: 'platform.file.download_granted',
        entityType: 'file',
        entityId: fileId,
        data: { ttlSeconds: granted.ttlSeconds },
      });
    }
    return granted;
  });
  let url: string;
  try {
    url = await context.storage.createSignedDownloadUrl(
      grant.bucket,
      grant.objectKey,
      grant.ttlSeconds,
      grant.name,
    );
  } catch (error) {
    storageRefusal(error);
  }
  return { url, expiresAt: new Date(Date.now() + grant.ttlSeconds * 1000), name: grant.name };
}

/**
 * Deletes a file of the signed-in user (soft: the object is removed by housekeeping per retention class).
 * False when already deleted. Throws DomainError FILE_NOT_FOUND or FILE_BUSY (being scanned, or infected).
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
