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
      /** `type_not_allowed`, `too_large`, `empty`, `encrypted`, `unscannable`, `object_missing`, … */
      readonly reason: string;
      /** The scanner's finding behind a rejection (`Heuristics.Encrypted.Zip`, `Heuristics.Limits.…`). */
      readonly finding?: string | null;
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
  const finding = 'finding' in result ? (result.finding ?? null) : null;
  const reason = result.outcome === 'rejected' || result.outcome === 'error' ? result.reason : null;
  const [row] = await tx.execute<{ finished: boolean }>(sql`
    select private.finish_file_scan(${fileId}::uuid, ${result.outcome}, ${detected}, ${size}::bigint,
      ${sha256}, ${engine}, ${signatures}, ${finding}, ${reason}) as finished`);
  return row?.finished === true;
}

/**
 * The scan could not finish (fail closed: the file stays scanning, never clean): `scanner` — the scanner
 * or Storage is unavailable, not counted against the file, but `error` (scanner_unavailable) once the file
 * has waited 24 hours since its upload; `processing` — this file failed although the scanner answered,
 * `error` (processing_failed) after 5 such failures; `crash` — clamd lost this file's stream and did not
 * answer a PING right after (it probably crashed on the file): counted for the file, and at the third the
 * answer is `crashed` (error, scanner_crashed); below that it waits like `scanner`.
 */
export async function retryFileScan(
  tx: ClaimsTx,
  fileId: string,
  kind: 'scanner' | 'processing' | 'crash',
): Promise<'waiting' | 'error' | 'crashed' | 'gone'> {
  const [row] = await tx.execute<{ state: 'waiting' | 'error' | 'crashed' | 'gone' }>(
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

/**
 * Just before the Storage work of a leased action, IN THE SAME TRANSACTION as that work's
 * finishFileHousekeeping: locks the file's row and answers whether the action is still due (a legal hold
 * set, a use recorded or a scan lease taken since the lease stops it). Whoever changes the file meanwhile
 * waits for this transaction.
 */
export async function lockFileHousekeeping(
  tx: ClaimsTx,
  fileId: string,
  action: HousekeepingAction,
): Promise<boolean> {
  const [row] = await tx.execute<{ due: boolean }>(
    sql`select private.lock_file_housekeeping(${fileId}::uuid, ${action}) as due`,
  );
  return row?.due === true;
}

/** An object in our buckets that no live file record owns (claimOrphanObjects). */
export interface OrphanObject {
  readonly bucket: string;
  readonly objectKey: string;
}

/** One batch of orphan objects, with the totals the sweep's brake needs. */
export interface OrphanBatch {
  readonly orphans: readonly OrphanObject[];
  /** How many orphan objects there are in all (the batch is at most `limit` of them). */
  readonly totalOrphans: number;
  /** How many objects our buckets hold in all. */
  readonly totalObjects: number;
}

/**
 * Objects in our buckets older than 3 hours (the longest signed upload URL lifetime plus a margin) that no
 * live file record owns: a generated file whose job rolled back after writing it, or an object a
 * still-valid upload URL created again after quarantine, removal or purge — up to `limit` of them, with
 * the totals. The caller removes them, unless the totals trip its brake.
 */
export async function claimOrphanObjects(tx: ClaimsTx, limit: number): Promise<OrphanBatch> {
  const rows = await tx.execute<{
    bucket: string;
    object_key: string;
    orphans: string | number;
    objects: string | number;
  }>(sql`select * from private.claim_orphan_objects(${limit}::integer)`);
  return {
    orphans: rows.map((row) => ({ bucket: row.bucket, objectKey: row.object_key })),
    totalOrphans: rows.length === 0 ? 0 : Number(rows[0]?.orphans),
    totalObjects: rows.length === 0 ? 0 : Number(rows[0]?.objects),
  };
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
