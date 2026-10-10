import 'server-only';
import { sql } from 'drizzle-orm';
import type { ClaimsTx } from './claims-tx';
import { DomainError } from './domain-error';
import { emitEvent } from './events';
import { pgError } from './user-admin';

/**
 * Files (T-M2-18, ADR 0006; migration 20261015090000; docs/engineering/files.md). Database side of the
 * request path: every write goes through file_guard's SECURITY DEFINER functions, which check the login
 * role and the verified claims themselves (the uploader under app_server; a job of the file's tenant under
 * app_worker for delete/markUsed/status). Business rules (purposes, names, types) live in
 * @jadarat/platform-files, which composes these helpers with the user's Storage session.
 */

export const FILE_EVENTS = {
  /** Upload confirmed; the scan follows (subject: the file id). */
  uploaded: 'com.entlaqa.platform.file.uploaded',
  /** Scan finished: clean, infected, rejected or error (written by the worker). */
  scanned: 'com.entlaqa.platform.file.scanned',
} as const;

export type FileStatus =
  | 'pending_upload'
  | 'uploaded'
  | 'scanning'
  | 'clean'
  | 'infected'
  | 'rejected'
  | 'error'
  | 'deleted';

/** Codes of the DomainErrors thrown by the file helpers (SQLSTATE JF001…JF009 of the migration). */
export type FileErrorCode =
  | 'TYPE_NOT_ALLOWED'
  | 'TOO_LARGE'
  | 'UNKNOWN_PURPOSE'
  | 'FILE_NOT_FOUND'
  | 'OBJECT_NOT_UPLOADED'
  | 'UPLOAD_EXPIRED'
  | 'TOO_MANY_PENDING_UPLOADS'
  | 'FILE_NOT_CLEAN'
  | 'FILE_BUSY'
  | 'INVALID_FILE_DATA';

const SQLSTATE_CODES: Readonly<Record<string, FileErrorCode>> = {
  JF001: 'TYPE_NOT_ALLOWED',
  JF002: 'TOO_LARGE',
  JF003: 'UNKNOWN_PURPOSE',
  JF004: 'FILE_NOT_FOUND',
  JF005: 'OBJECT_NOT_UPLOADED',
  JF006: 'UPLOAD_EXPIRED',
  JF007: 'TOO_MANY_PENDING_UPLOADS',
  JF008: 'FILE_NOT_CLEAN',
  JF009: 'FILE_BUSY',
  // CHECK constraints: a name, owner or type the table refuses.
  '23514': 'INVALID_FILE_DATA',
};

/** Maps the database refusals of a file function to DomainErrors; anything else is returned as is. */
export function fileErrorOf(error: unknown): unknown {
  const code = pgError(error)?.code;
  const mapped = code === undefined ? undefined : SQLSTATE_CODES[code];
  return mapped ? new DomainError<FileErrorCode>(mapped, { cause: error }) : error;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw fileErrorOf(error);
  }
}

export interface FileOwner {
  /** The owning module's key segment, e.g. `platform`, `tms`. */
  readonly module: string;
  /** The owning entity type, e.g. `user_import`, `person`. */
  readonly entityType: string;
  readonly entityId: string;
}

export interface ReserveUploadInput {
  readonly purpose: string;
  readonly owner: FileOwner;
  /** Sanitized original name (platform-files `sanitizeFileName`). */
  readonly name: string;
  /** Canonical declared type (platform-files `declaredTypeFor`: from the name's extension). */
  readonly declaredType: string;
  readonly size: number;
}

export interface ReservedUpload {
  readonly fileId: string;
  readonly bucket: string;
  readonly objectKey: string;
  readonly uploadExpiresAt: Date;
  readonly maxBytes: number;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

/**
 * A pending upload for the signed-in user (private.create_file_upload): the key the signed upload URL is
 * then created for, valid 15 minutes. Throws DomainError UNKNOWN_PURPOSE, TYPE_NOT_ALLOWED, TOO_LARGE,
 * TOO_MANY_PENDING_UPLOADS or INVALID_FILE_DATA.
 */
export async function reserveUpload(
  tx: ClaimsTx,
  input: ReserveUploadInput,
): Promise<ReservedUpload> {
  const rows = await guarded(() =>
    tx.execute<{
      id: string;
      bucket: string;
      object_key: string;
      upload_expires_at: Date | string;
      max_bytes: string | number;
    }>(sql`
      select * from private.create_file_upload(${input.purpose}, ${input.owner.module},
        ${input.owner.entityType}, ${input.owner.entityId}::uuid, ${input.name}, ${input.declaredType},
        ${input.size}::bigint)`),
  );
  const row = rows[0];
  if (!row) throw new Error('reserveUpload: no row returned');
  return {
    fileId: row.id,
    bucket: row.bucket,
    objectKey: row.object_key,
    uploadExpiresAt: toDate(row.upload_expires_at),
    maxBytes: Number(row.max_bytes),
  };
}

export interface FileStatusView {
  readonly fileId: string;
  readonly status: FileStatus;
  /** Why a file was rejected or failed (`type_not_allowed`, `too_large`, `empty`, `malware`, …). */
  readonly reason: string | null;
  readonly purpose: string;
  readonly owner: FileOwner;
  readonly name: string;
  readonly declaredType: string;
  /** The type found by content (set by the scan). */
  readonly detectedType: string | null;
  readonly size: number | null;
  readonly sha256: string | null;
  readonly createdAt: Date;
  readonly scannedAt: Date | null;
  readonly usedAt: Date | null;
}

interface FileRow extends Record<string, unknown> {
  id: string;
  status: FileStatus;
  status_reason: string | null;
  purpose: string;
  owner_module: string;
  owner_entity_type: string;
  owner_entity_id: string;
  original_name: string;
  declared_mime: string;
  detected_mime: string | null;
  size_bytes: string | number | null;
  sha256: string | null;
  created_at: Date | string;
  scanned_at: Date | string | null;
  used_at: Date | string | null;
}

function toView(row: FileRow): FileStatusView {
  return {
    fileId: row.id,
    status: row.status,
    reason: row.status_reason,
    purpose: row.purpose,
    owner: {
      module: row.owner_module,
      entityType: row.owner_entity_type,
      entityId: row.owner_entity_id,
    },
    name: row.original_name,
    declaredType: row.declared_mime,
    detectedType: row.detected_mime,
    size: row.size_bytes === null ? null : Number(row.size_bytes),
    sha256: row.sha256,
    createdAt: toDate(row.created_at),
    scannedAt: row.scanned_at === null ? null : toDate(row.scanned_at),
    usedAt: row.used_at === null ? null : toDate(row.used_at),
  };
}

/**
 * The status of a file the caller may see (RLS: its uploader, or a job of its tenant); null otherwise or
 * once purged.
 */
export async function getFileStatus(tx: ClaimsTx, fileId: string): Promise<FileStatusView | null> {
  const rows = await tx.execute<FileRow>(sql`
    select id, status, status_reason, purpose, owner_module, owner_entity_type, owner_entity_id,
           original_name, declared_mime, detected_mime, size_bytes, sha256, created_at, scanned_at, used_at
    from platform.files where id = ${fileId}::uuid and purged_at is null`);
  const row = rows[0];
  return row ? toView(row) : null;
}

/**
 * The uploader confirms the upload (private.confirm_file_upload): `uploaded` (queued for the scan; the
 * `file.uploaded` event is emitted the first time), or `rejected` at once (empty or over the limit by
 * Storage's size). Repeating returns the current status. Throws DomainError FILE_NOT_FOUND,
 * OBJECT_NOT_UPLOADED or UPLOAD_EXPIRED.
 */
export async function confirmFileUpload(tx: ClaimsTx, fileId: string): Promise<FileStatus> {
  const before = await getFileStatus(tx, fileId);
  const rows = await guarded(() =>
    tx.execute<{ status: FileStatus }>(
      sql`select private.confirm_file_upload(${fileId}::uuid) as status`,
    ),
  );
  const status = rows[0]?.status;
  if (!status) throw new Error('confirmFileUpload: no status returned');
  if (before?.status === 'pending_upload' && status === 'uploaded') {
    await emitEvent(tx, {
      type: FILE_EVENTS.uploaded,
      subject: fileId,
      data: {
        purpose: before.purpose,
        ownerModule: before.owner.module,
        ownerEntityType: before.owner.entityType,
        ownerEntityId: before.owner.entityId,
      },
    });
  }
  return status;
}

export interface DownloadGrant {
  readonly bucket: string;
  readonly objectKey: string;
  readonly name: string;
  readonly detectedType: string | null;
  readonly ttlSeconds: number;
  readonly auditDownloads: boolean;
}

/** What the owning module authorized: this file, of this owner entity, for this purpose. */
export interface DownloadGrantRequest {
  readonly fileId: string;
  /** The file's purpose (e.g. `platform.user_import`). */
  readonly purpose: string;
  /** The entity whose files the module authorized the user to read. */
  readonly owner: FileOwner;
}

/**
 * A download grant for the signed-in user (private.grant_file_download) — only after the owning module
 * authorized THIS user to read files of THIS owner entity: the database grants the file only when it is
 * clean and belongs to exactly that owner and purpose (else FILE_NOT_FOUND, as if it did not exist), so a
 * module that checked access to one entity can never hand out a file of another. Throws DomainError
 * FILE_NOT_FOUND or FILE_NOT_CLEAN.
 */
export async function grantFileDownload(
  tx: ClaimsTx,
  request: DownloadGrantRequest,
): Promise<DownloadGrant> {
  const rows = await guarded(() =>
    tx.execute<{
      bucket: string;
      object_key: string;
      original_name: string;
      detected_mime: string | null;
      ttl_seconds: number;
      audit_downloads: boolean;
    }>(sql`select * from private.grant_file_download(${request.fileId}::uuid, ${request.purpose},
      ${request.owner.module}, ${request.owner.entityType}, ${request.owner.entityId}::uuid)`),
  );
  const row = rows[0];
  if (!row) throw new Error('grantFileDownload: no row returned');
  return {
    bucket: row.bucket,
    objectKey: row.object_key,
    name: row.original_name,
    detectedType: row.detected_mime,
    ttlSeconds: row.ttl_seconds,
    auditDownloads: row.audit_downloads,
  };
}

/**
 * Deletes a file (soft; housekeeping removes the object per retention class): its uploader, or a job of
 * its tenant — also a file still waiting for the scanner, or failed. False when it was already deleted.
 * Throws DomainError FILE_NOT_FOUND or FILE_BUSY (a worker is scanning it right now, or it is infected
 * and kept in quarantine).
 */
export async function deleteFileRecord(tx: ClaimsTx, fileId: string): Promise<boolean> {
  const rows = await guarded(() =>
    tx.execute<{ deleted: boolean }>(sql`select private.delete_file(${fileId}::uuid) as deleted`),
  );
  return rows[0]?.deleted === true;
}

/**
 * Records the first use of a clean file (imports: kept 7 days from then). False when already recorded.
 * Throws DomainError FILE_NOT_FOUND or FILE_NOT_CLEAN.
 */
export async function markFileUsed(tx: ClaimsTx, fileId: string): Promise<boolean> {
  const rows = await guarded(() =>
    tx.execute<{ marked: boolean }>(sql`select private.mark_file_used(${fileId}::uuid) as marked`),
  );
  return rows[0]?.marked === true;
}
