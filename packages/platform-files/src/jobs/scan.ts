import { createHash } from 'node:crypto';
import { FILE_EVENTS, emitEvent } from '@jadarat/platform-db';
import {
  type ScanLease,
  type ScanOutcome,
  type WithPlatformTx,
  type WithSystemTx,
  claimFileScan,
  finishFileHousekeeping,
  finishFileScan,
  insertSystemAuditEvent,
  retryFileScan,
} from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { DETECTION_HEAD_BYTES, detectType } from '../detect';
import type { Scanner, ScannerVersion } from './clamd';
import { type FileObjectStore, codeOf, isTemporary } from './store';

/** graphile-worker task of the scan (a platform task: files of every organization, oldest first). */
export const FILE_SCAN_TASK = 'platform.files.scan';
/** Files scanned per pass; a full pass queues the next one at once. */
export const FILE_SCAN_BATCH = 5;
/** Signatures older than this are reported (ADR 0006 §8: alert if > 24 h old). */
export const SIGNATURE_MAX_AGE_HOURS = 24;
const SIGNATURE_CHECK_INTERVAL_MS = 60 * 60_000;
const VERSION_CACHE_MS = 10 * 60_000;
const MIME = /^[a-z0-9][a-z0-9.+-]{0,62}\/[a-z0-9][a-z0-9.+-]{0,62}$/;

export interface FileScanTaskOptions {
  readonly withPlatformTx: WithPlatformTx;
  readonly withSystemTx: WithSystemTx;
  readonly store: FileObjectStore;
  readonly scanner: Scanner;
  readonly log: (level: WorkerLogLevel, message: string) => void;
  readonly now?: () => number;
}

function concat(parts: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * The type check and malware scan (ADR 0006 §3.4, §8; NFR-SEC-08; T-M2-18). Each file is read ONCE from
 * Storage as a stream: counted (the purpose's limit — over it, the read stops: `rejected`, too_large),
 * hashed (SHA-256), its first bytes kept for the content-type detection, and every byte sent to clamd
 * (INSTREAM). Outcome, in the file's tenant transaction: `infected` (any finding — blocked at once; the
 * object moves to quarantine; audit event `platform.file.infected`), `rejected` (empty, too large, or a
 * type the purpose does not accept by content — the object is removed), else `clean`. The event
 * `com.entlaqa.platform.file.scanned` tells the owning module.
 *
 * Fail closed: when clamd or Storage cannot be reached, the file stays `scanning` and is tried again
 * (15 s, 30 s, … every 15 minutes at most), and the pass ends. An unexpected failure with one file is
 * tried 5 times, then the file is `error`. Nothing is ever `clean` without a verdict.
 */
export function createFileScanTask(options: FileScanTaskOptions): PlatformTask {
  const now = options.now ?? Date.now;
  let versionCache: { readonly value: ScannerVersion; readonly at: number } | null = null;
  let lastSignatureCheck = -Infinity;

  async function scannerVersion(): Promise<ScannerVersion> {
    if (versionCache && now() - versionCache.at < VERSION_CACHE_MS) return versionCache.value;
    const value = await options.scanner.version();
    versionCache = { value, at: now() };
    return value;
  }

  /** At most hourly: are the signatures fresh (freshclam working)? Never fails the pass. */
  async function checkSignatures(): Promise<void> {
    if (now() - lastSignatureCheck < SIGNATURE_CHECK_INTERVAL_MS) return;
    lastSignatureCheck = now();
    try {
      const version = await scannerVersion();
      if (version.signaturesDate === null) return;
      const hours = Math.floor((now() - version.signaturesDate.getTime()) / 3_600_000);
      if (hours > SIGNATURE_MAX_AGE_HOURS) {
        options.log(
          'warning',
          `malware signatures are ${String(hours)} hours old (${version.engine}): check the signature updates (freshclam)`,
        );
      }
    } catch (error) {
      options.log('warning', `malware scanner not available (${codeOf(error)})`);
    }
  }

  async function inspect(lease: ScanLease): Promise<ScanOutcome> {
    const object = await options.store.read(lease.bucket, lease.objectKey);
    if (!object) return { outcome: 'error', reason: 'object_missing' };
    const reader = object.body.getReader();
    let session;
    try {
      session = await options.scanner.start();
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
    const hash = createHash('sha256');
    const head: Uint8Array[] = [];
    let headLength = 0;
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > lease.maxBytes) {
          session.abort();
          await reader.cancel().catch(() => undefined);
          return { outcome: 'rejected', reason: 'too_large', size };
        }
        hash.update(value);
        if (headLength < DETECTION_HEAD_BYTES) {
          const part = value.subarray(0, DETECTION_HEAD_BYTES - headLength);
          head.push(part);
          headLength += part.length;
        }
        await session.write(value);
      }
    } catch (error) {
      session.abort();
      await reader.cancel().catch(() => undefined);
      throw error;
    }
    if (size === 0) {
      session.abort();
      return { outcome: 'rejected', reason: 'empty', size: 0 };
    }
    const verdict = await session.finish();
    const version = await scannerVersion();
    const sha256 = hash.digest('hex');
    const found = await detectType(concat(head, headLength), size <= DETECTION_HEAD_BYTES);
    const detectedType = found !== null && MIME.test(found) ? found : null;
    const scan = { size, sha256, engine: version.engine, signatures: version.signatures };
    if (!verdict.clean) {
      return { outcome: 'infected', detectedType, finding: verdict.finding, ...scan };
    }
    if (detectedType === null || !lease.allowedTypes.includes(detectedType)) {
      return { outcome: 'rejected', reason: 'type_not_allowed', detectedType, ...scan };
    }
    return { outcome: 'clean', detectedType, ...scan };
  }

  /** The Storage side of an outcome right away (housekeeping repeats it when this fails). */
  async function storageFollowUp(lease: ScanLease, outcome: ScanOutcome, jobId: string) {
    try {
      if (outcome.outcome === 'infected') {
        await options.store.move(lease.bucket, lease.objectKey, 'quarantine');
        await options.withPlatformTx({ jobId }, (tx) =>
          finishFileHousekeeping(tx, lease.fileId, 'quarantine'),
        );
      } else if (outcome.outcome === 'rejected') {
        await options.store.remove(lease.bucket, lease.objectKey);
        await options.withPlatformTx({ jobId }, (tx) =>
          finishFileHousekeeping(tx, lease.fileId, 'remove_object'),
        );
      }
    } catch (error) {
      options.log(
        'warning',
        `file ${lease.fileId}: storage follow-up postponed to housekeeping (${codeOf(error)})`,
      );
    }
  }

  /** One file: false when the scanner or Storage is down (the pass stops). */
  async function processLease(lease: ScanLease, jobId: string): Promise<boolean> {
    let outcome: ScanOutcome;
    try {
      outcome = await inspect(lease);
    } catch (error) {
      const kind = isTemporary(error) ? 'scanner' : 'processing';
      const state = await options.withPlatformTx({ jobId }, (tx) =>
        retryFileScan(tx, lease.fileId, kind),
      );
      options.log(
        kind === 'scanner' ? 'warning' : 'error',
        `file ${lease.fileId}: scan not finished (${codeOf(error)}); ${state}`,
      );
      return kind !== 'scanner';
    }
    let recorded: boolean;
    try {
      recorded = await options.withSystemTx({ tenantId: lease.tenantId, jobId }, async (tx) => {
        if (!(await finishFileScan(tx, lease.fileId, outcome))) return false;
        await emitEvent(tx, {
          type: FILE_EVENTS.scanned,
          subject: lease.fileId,
          data: {
            purpose: lease.purpose,
            outcome: outcome.outcome,
            ...('reason' in outcome ? { reason: outcome.reason } : {}),
          },
        });
        if (outcome.outcome === 'infected') {
          // Security event (ADR 0006 §3.4): which file, which finding — no name, no content.
          await insertSystemAuditEvent(tx, {
            action: 'platform.file.infected',
            entityType: 'file',
            entityId: lease.fileId,
            data: { purpose: lease.purpose, finding: outcome.finding, engine: outcome.engine },
          });
        }
        return true;
      });
    } catch (error) {
      // E.g. the organization was suspended meanwhile: the file waits (claims skip such organizations).
      await options.withPlatformTx({ jobId }, (tx) => retryFileScan(tx, lease.fileId, 'scanner'));
      options.log('warning', `file ${lease.fileId}: scan result not recorded (${codeOf(error)})`);
      return true;
    }
    if (!recorded) return true;
    if (outcome.outcome === 'infected') {
      options.log(
        'warning',
        `security: file ${lease.fileId} (${lease.purpose}) is infected (${outcome.finding}); quarantined`,
      );
    } else {
      options.log(
        'info',
        `file ${lease.fileId} (${lease.purpose}) scanned: ${outcome.outcome}${'reason' in outcome ? ` (${outcome.reason})` : ''}`,
      );
    }
    await storageFollowUp(lease, outcome, jobId);
    return true;
  }

  return {
    name: FILE_SCAN_TASK,
    async run({ jobId }) {
      await checkSignatures();
      for (let i = 0; i < FILE_SCAN_BATCH; i += 1) {
        const lease = await options.withPlatformTx({ jobId }, claimFileScan);
        if (!lease) return false;
        if (!(await processLease(lease, jobId))) return false;
      }
      return true;
    },
  };
}
