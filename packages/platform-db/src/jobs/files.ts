import 'server-only';
import { sql } from 'drizzle-orm';
import type { ClaimsTx } from '../claims-tx';
import { fileErrorOf } from '../files';

/**
 * Files, worker side (T-M2-18, ADR 0006 §3.4, §7; migration 20261015090000). The scan task leases a file
 * in a platform transaction (system claims without a tenant: claimFileScan), reads and scans the object
 * with the worker's Storage access, and records the outcome in the file's own tenant transaction
 * (finishFileScan). Housekeeping leases what is due (claimFileHousekeeping), does the Storage work and
 * records it (finishFileHousekeeping). Only file_guard's functions reach the tables.
 */

export interface ScanLease {
  readonly fileId: string;
  readonly tenantId: string;
  readonly bucket: string;
  readonly objectKey: string;
  readonly purpose: string;
  readonly declaredType: string;
  /** Storage's reported size at confirmation (may be unknown); the scan counts the bytes itself. */
  readonly reportedSize: number | null;
  readonly maxBytes: number;
  /** Types the purpose accepts, as detected by content. */
  readonly allowedTypes: readonly string[];
  /** This attempt's number (1-based). */
  readonly attempt: number;
}

/** Leases the next file to scan (15 minutes), or null when none waits. */
export async function claimFileScan(tx: ClaimsTx): Promise<ScanLease | null> {
  const [row] = await tx.execute<{
    id: string;
    tenant_id: string;
    bucket: string;
    object_key: string;
    purpose: string;
    declared_mime: string;
    size_bytes: string | number | null;
    max_bytes: string | number;
    allowed_types: string[];
    attempts: number;
  }>(sql`select * from private.claim_file_scan()`);
  if (!row) return null;
  return {
    fileId: row.id,
    tenantId: row.tenant_id,
    bucket: row.bucket,
    objectKey: row.object_key,
    purpose: row.purpose,
    declaredType: row.declared_mime,
    reportedSize: row.size_bytes === null ? null : Number(row.size_bytes),
    maxBytes: Number(row.max_bytes),
    allowedTypes: row.allowed_types,
    attempt: row.attempts,
  };
}

export type ScanOutcome =
  | {
      readonly outcome: 'clean';
      readonly detectedType: string;
      readonly size: number;
      readonly sha256: string;
      readonly engine: string;
      readonly signatures: string;
    }
  | {
      readonly outcome: 'infected';
      readonly detectedType: string | null;
      readonly size: number;
      readonly sha256: string;
      readonly engine: string;
      readonly signatures: string;
      /** The scanner's finding, e.g. `Eicar-Test-Signature` (no personal data). */
      readonly finding: string;
    }
  | {
      readonly outcome: 'rejected' | 'error';
      /** `type_not_allowed`, `too_large`, `empty`, `object_missing`, … */
      readonly reason: string;
      readonly detectedType?: string | null;
      readonly size?: number | null;
      readonly sha256?: string | null;
      readonly engine?: string | null;
      readonly signatures?: string | null;
    };

/**
 * Records the outcome, in the file's tenant transaction (withSystemTx for the lease's tenant). False when
 * the file is no longer being scanned (finished by another attempt, or not in this tenant).
 */
export async function finishFileScan(
  tx: ClaimsTx,
  fileId: string,
  result: ScanOutcome,
): Promise<boolean> {
  const detected = 'detectedType' in result ? (result.detectedType ?? null) : null;
  const size = 'size' in result ? (result.size ?? null) : null;
  const sha256 = 'sha256' in result ? (result.sha256 ?? null) : null;
  const engine = 'engine' in result ? (result.engine ?? null) : null;
  const signatures = 'signatures' in result ? (result.signatures ?? null) : null;
  const finding = result.outcome === 'infected' ? result.finding : null;
  const reason = result.outcome === 'rejected' || result.outcome === 'error' ? result.reason : null;
  const [row] = await tx.execute<{ finished: boolean }>(sql`
    select private.finish_file_scan(${fileId}::uuid, ${result.outcome}, ${detected}, ${size}::bigint,
      ${sha256}, ${engine}, ${signatures}, ${finding}, ${reason}) as finished`);
  return row?.finished === true;
}

/**
 * The scan could not finish: `scanner` (scanner or Storage unavailable — the file stays scanning and
 * waits, however long: fail closed) or `processing` (this file failed; `error` after 5 attempts).
 */
export async function retryFileScan(
  tx: ClaimsTx,
  fileId: string,
  kind: 'scanner' | 'processing',
): Promise<'waiting' | 'error' | 'gone'> {
  const [row] = await tx.execute<{ state: 'waiting' | 'error' | 'gone' }>(
    sql`select private.retry_file_scan(${fileId}::uuid, ${kind}) as state`,
  );
  if (!row) throw new Error('retryFileScan: no answer');
  return row.state;
}

export type HousekeepingAction = 'quarantine' | 'remove_object' | 'purge';

export interface HousekeepingItem {
  readonly fileId: string;
  readonly tenantId: string;
  readonly bucket: string;
  readonly objectKey: string;
  readonly action: HousekeepingAction;
}

const ACTIONS: ReadonlySet<string> = new Set<HousekeepingAction>([
  'quarantine',
  'remove_object',
  'purge',
]);

/** Removes expired download grants and leases up to `limit` files due for Storage work (10 minutes). */
export async function claimFileHousekeeping(
  tx: ClaimsTx,
  limit: number,
): Promise<readonly HousekeepingItem[]> {
  const rows = await tx.execute<{
    id: string;
    tenant_id: string;
    bucket: string;
    object_key: string;
    action: string;
  }>(sql`select * from private.claim_file_housekeeping(${limit}::integer)`);
  return rows.map((row) => {
    if (!ACTIONS.has(row.action)) throw new Error('claimFileHousekeeping: unknown action');
    return {
      fileId: row.id,
      tenantId: row.tenant_id,
      bucket: row.bucket,
      objectKey: row.object_key,
      action: row.action as HousekeepingAction,
    };
  });
}

/** Records the Storage work of a housekeeping action (false when nothing was left to record). */
export async function finishFileHousekeeping(
  tx: ClaimsTx,
  fileId: string,
  action: HousekeepingAction,
): Promise<boolean> {
  const [row] = await tx.execute<{ done: boolean }>(
    sql`select private.finish_file_housekeeping(${fileId}::uuid, ${action}) as done`,
  );
  return row?.done === true;
}

/** A clean file a job may read (RLS: a job of the file's tenant), or null. */
export async function loadCleanFile(
  tx: ClaimsTx,
  fileId: string,
): Promise<{
  readonly bucket: string;
  readonly objectKey: string;
  readonly size: number;
  readonly sha256: string;
} | null> {
  const [row] = await tx.execute<{
    bucket: string;
    object_key: string;
    size_bytes: string | number;
    sha256: string;
  }>(sql`
    select bucket, object_key, size_bytes, sha256 from platform.files
    where id = ${fileId}::uuid and status = 'clean' and deleted_at is null and purged_at is null`);
  if (!row) return null;
  return {
    bucket: row.bucket,
    objectKey: row.object_key,
    size: Number(row.size_bytes),
    sha256: row.sha256,
  };
}

export interface GeneratedFileInput {
  readonly purpose: string;
  readonly owner: {
    readonly module: string;
    readonly entityType: string;
    readonly entityId: string;
  };
  readonly name: string;
  readonly type: string;
  readonly size: number;
  /** The user it is made for (sees it as their own); an active member of the job's tenant. */
  readonly forUserId: string | null;
}

/** Reserves a generated file's key in the job's tenant. Throws DomainError on refusals. */
export async function createGeneratedFile(
  tx: ClaimsTx,
  input: GeneratedFileInput,
): Promise<{ readonly fileId: string; readonly bucket: string; readonly objectKey: string }> {
  let rows: { id: string; bucket: string; object_key: string }[];
  try {
    rows = await tx.execute<{ id: string; bucket: string; object_key: string }>(sql`
      select * from private.create_generated_file(${input.purpose}, ${input.owner.module},
        ${input.owner.entityType}, ${input.owner.entityId}::uuid, ${input.name}, ${input.type},
        ${input.size}::bigint, ${input.forUserId}::uuid)`);
  } catch (error) {
    throw fileErrorOf(error);
  }
  const row = rows[0];
  if (!row) throw new Error('createGeneratedFile: no row returned');
  return { fileId: row.id, bucket: row.bucket, objectKey: row.object_key };
}

/** The generated file's bytes are stored: clean, with its size and hash. False if the object is missing. */
export async function finishGeneratedFile(
  tx: ClaimsTx,
  fileId: string,
  size: number,
  sha256: string,
): Promise<boolean> {
  const [row] = await tx.execute<{ done: boolean }>(
    sql`select private.finish_generated_file(${fileId}::uuid, ${size}::bigint, ${sha256}) as done`,
  );
  return row?.done === true;
}

/**
 * An audit event written by a job (actor: none — the database's policy requires the actor of system
 * claims to be empty; the job is identified by the claims' job id in `data.job`).
 */
export async function insertSystemAuditEvent(
  tx: ClaimsTx,
  event: {
    readonly action: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly data?: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into platform.audit_events (action, entity_type, entity_id, data)
    values (${event.action}, ${event.entityType}, ${event.entityId},
            ${JSON.stringify({ ...event.data, job: null })}::jsonb
              || jsonb_build_object('job', private.request_claims() ->> 'job_id'))`);
}
