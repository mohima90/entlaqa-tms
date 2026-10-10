import { createHash } from 'node:crypto';
import { FILE_EVENTS, emitEvent } from '@jadarat/platform-db';
import {
  type ScanLease,
  type ScanOutcome,
  type WithPlatformTx,
  type WithSystemTx,
  claimFileScan,
  finishFileScan,
  insertSystemAuditEvent,
  retryFileScan,
} from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { DETECTION_HEAD_BYTES, detectType } from '../detect';
import { type Scanner, ScannerUnavailableError, type ScannerVersion } from './clamd';
import { performHousekeeping } from './housekeeping';
import { type FileObjectStore, codeOf, isTemporary } from './store';

/** graphile-worker task of the scan (a platform task: files of every organization, taking turns). */
export const FILE_SCAN_TASK = 'platform.files.scan';
/** Files scanned per pass; a full pass queues the next one at once. */
export const FILE_SCAN_BATCH = 5;
/** Signatures older than this are reported (ADR 0006 §8: alert if > 24 h old). */
export const SIGNATURE_MAX_AGE_HOURS = 24;
/**
 * Signatures older than this — or of an unknown date — and NOTHING is scanned (fail closed: uploads wait,
 * never clean), with an error logged hourly. FILE_SCAN_SIGNATURES_MAX_AGE_DAYS may raise it for test
 * installations with pinned signatures only (the worker warns at start-up).
 */
export const SIGNATURE_HARD_MAX_AGE_DAYS = 7;
const ALERT_INTERVAL_MS = 60 * 60_000;
const VERSION_CACHE_MS = 10 * 60_000;
/** How long clamd may take to answer a PING after a failed scan before it counts as unavailable. */
const PING_TIMEOUT_MS = 10_000;
const MIME = /^[a-z0-9][a-z0-9.+-]{0,62}\/[a-z0-9][a-z0-9.+-]{0,62}$/;
/** clamd's finding for a file over its limits (clamd.conf: AlertExceedsMax). */
const LIMITS_FINDING = 'Heuristics.Limits.Exceeded';
/** clamd's finding for an encrypted archive it cannot look into (clamd.conf: AlertEncryptedArchive). */
const ENCRYPTED_FINDING = 'Heuristics.Encrypted.';

export interface FileScanTaskOptions {
  readonly withPlatformTx: WithPlatformTx;
  readonly withSystemTx: WithSystemTx;
  readonly store: FileObjectStore;
  readonly scanner: Scanner;
  readonly log: (level: WorkerLogLevel, message: string) => void;
  /** Hard limit on the signatures' age (default SIGNATURE_HARD_MAX_AGE_DAYS). */
  readonly maxSignatureAgeDays?: number;
  readonly now?: () => number;
}

/** The scanner answers, but could not scan THIS file (it dropped the stream): counted against the file. */
export class FileScanFailedError extends Error {
  override readonly name = 'FileScanFailedError';
  readonly code = 'SCAN_FAILED';
}

/** How old the signatures may be, and are: `fresh`, `stale` (warn), `too_old` / `unknown` (refuse). */
export type SignatureAge = 'fresh' | 'stale' | 'too_old' | 'unknown';

export function signatureAge(
  version: ScannerVersion,
  now: number,
  maxAgeDays: number = SIGNATURE_HARD_MAX_AGE_DAYS,
): { readonly age: SignatureAge; readonly hours: number | null } {
  if (version.signaturesDate === null) return { age: 'unknown', hours: null };
  const hours = Math.floor((now - version.signaturesDate.getTime()) / 3_600_000);
  if (hours > maxAgeDays * 24) return { age: 'too_old', hours };
  if (hours > SIGNATURE_MAX_AGE_HOURS) return { age: 'stale', hours };
  return { age: 'fresh', hours };
}

/** Storage's stream broke off (network, Storage restarting): unavailable, not the file's fault. */
export class StorageStreamError extends Error {
  override readonly name = 'StorageStreamError';
  readonly code = 'STORAGE_STREAM';
  readonly temporary = true;
}

async function readFrom(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']> {
  try {
    return await reader.read();
  } catch {
    throw new StorageStreamError('the object could not be read to its end');
  }
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
 * (INSTREAM). Outcome, in the file's tenant transaction: `infected` (a malware finding — blocked at once;
 * the object moves to quarantine; audit event `platform.file.infected`), `rejected` (empty, too large, a
 * type the purpose does not accept by content, an encrypted archive clamd cannot look into — `encrypted`
 * —, or over clamd's scan limits — `unscannable`; the object is removed; the last two with a
 * low-severity audit event `platform.file.unscannable`), else `clean`. The event
 * `com.entlaqa.platform.file.scanned` tells the owning module. Organizations take turns (claim_file_scan).
 *
 * Fail closed: signatures older than the hard limit (or undated) — nothing is scanned. Scanner or Storage
 * unavailable — the file stays `scanning`, is tried again (15 s, 30 s, … every 15 minutes at most) and the
 * pass ends; still without a verdict 24 hours after its upload, it becomes `error` (logged as an error).
 * A failure of the file itself — also when clamd drops its stream but still answers a PING right after —
 * counts against the file: `error` after 5. Nothing is ever `clean` without a verdict.
 */
export function createFileScanTask(options: FileScanTaskOptions): PlatformTask {
  const now = options.now ?? Date.now;
  const maxAgeDays = options.maxSignatureAgeDays ?? SIGNATURE_HARD_MAX_AGE_DAYS;
  let versionCache: { readonly value: ScannerVersion; readonly at: number } | null = null;
  let lastWarning = -Infinity;
  let lastAlert = -Infinity;

  async function scannerVersion(): Promise<ScannerVersion> {
    if (versionCache && now() - versionCache.at < VERSION_CACHE_MS) return versionCache.value;
    const value = await options.scanner.version();
    versionCache = { value, at: now() };
    return value;
  }

  /**
   * Before every pass (ADR 0006 §8): are the signatures recent enough to scan? Too old or undated: false —
   * nothing is claimed — and an error at most hourly (the alert). Stale: a warning at most hourly. When
   * clamd does not answer, the pass goes on: its first file fails as `scanner` unavailable (back-off, and
   * the 24-hour limit per file).
   */
  async function readyToScan(): Promise<boolean> {
    let version: ScannerVersion;
    try {
      version = await scannerVersion();
    } catch (error) {
      if (now() - lastWarning >= ALERT_INTERVAL_MS) {
        lastWarning = now();
        options.log('warning', `malware scanner not available (${codeOf(error)})`);
      }
      return true;
    }
    const { age, hours } = signatureAge(version, now(), maxAgeDays);
    if (age === 'too_old' || age === 'unknown') {
      if (now() - lastAlert >= ALERT_INTERVAL_MS) {
        lastAlert = now();
        options.log(
          'error',
          `malware signatures are ${hours === null ? 'of an unknown date' : `${String(hours)} hours old`} (${version.engine}; limit ${String(maxAgeDays)} days): NOTHING is scanned, uploads wait — fix the signature updates (freshclam)`,
        );
      }
      return false;
    }
    if (age === 'stale' && now() - lastWarning >= ALERT_INTERVAL_MS) {
      lastWarning = now();
      options.log(
        'warning',
        `malware signatures are ${String(hours)} hours old (${version.engine}): check the signature updates (freshclam)`,
      );
    }
    return true;
  }

  /** Does clamd answer a PING (soon)? Then a stream it dropped was dropped because of the file. */
  async function scannerAnswers(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        options.scanner.ping().then(
          () => true,
          () => false,
        ),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => {
            resolve(false);
          }, PING_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** A step talking to clamd once the stream has started: a lost connection is the file's fault if clamd still answers. */
  async function scannerStep<T>(step: () => Promise<T>): Promise<T> {
    try {
      return await step();
    } catch (error) {
      if (error instanceof ScannerUnavailableError && (await scannerAnswers())) {
        throw new FileScanFailedError('clamd dropped the stream of this file but answers');
      }
      throw error;
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
        const { done, value } = await readFrom(reader);
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
        const scanning = session;
        await scannerStep(() => scanning.write(value));
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
    const finished = session;
    const verdict = await scannerStep(() => finished.finish());
    const version = await scannerVersion();
    const sha256 = hash.digest('hex');
    const found = await detectType(concat(head, headLength), size <= DETECTION_HEAD_BYTES);
    const detectedType = found !== null && MIME.test(found) ? found : null;
    const scan = { size, sha256, engine: version.engine, signatures: version.signatures };
    if (!verdict.clean) {
      // clamd could not look inside (an encrypted archive; archive depth, file count, scanned bytes or
      // time over its limits — AlertExceedsMax): never clean, but no malware finding either. Rejected
      // (object removed) with a low-severity audit event; every other finding is malware.
      if (verdict.finding.startsWith(ENCRYPTED_FINDING)) {
        return {
          outcome: 'rejected',
          reason: 'encrypted',
          finding: verdict.finding,
          detectedType,
          ...scan,
        };
      }
      if (verdict.finding.startsWith(LIMITS_FINDING)) {
        return {
          outcome: 'rejected',
          reason: 'unscannable',
          finding: verdict.finding,
          detectedType,
          ...scan,
        };
      }
      return { outcome: 'infected', detectedType, finding: verdict.finding, ...scan };
    }
    if (detectedType === null || !lease.allowedTypes.includes(detectedType)) {
      return { outcome: 'rejected', reason: 'type_not_allowed', detectedType, ...scan };
    }
    return { outcome: 'clean', detectedType, ...scan };
  }

  /** The Storage side of an outcome right away, checked like housekeeping's (which repeats it if this fails). */
  async function storageFollowUp(lease: ScanLease, outcome: ScanOutcome, jobId: string) {
    const action =
      outcome.outcome === 'infected'
        ? 'quarantine'
        : outcome.outcome === 'rejected'
          ? 'remove_object'
          : null;
    if (action === null) return;
    try {
      await options.withPlatformTx({ jobId }, (tx) =>
        performHousekeeping(tx, options.store, {
          fileId: lease.fileId,
          bucket: lease.bucket,
          objectKey: lease.objectKey,
          action,
        }),
      );
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
      if (state === 'error') {
        // The file gave up: 5 failures of its own, or no verdict 24 hours after its upload (scanner or
        // Storage unavailable all that time) — an error for the operators.
        options.log(
          'error',
          `file ${lease.fileId}: no scan verdict (${codeOf(error)}); error (${kind === 'scanner' ? 'scanner_unavailable' : 'processing_failed'})`,
        );
      } else {
        options.log(
          kind === 'scanner' ? 'warning' : 'error',
          `file ${lease.fileId}: scan not finished (${codeOf(error)}); ${state}`,
        );
      }
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
            data: {
              purpose: lease.purpose,
              finding: outcome.finding,
              engine: outcome.engine,
              severity: 'high',
            },
          });
        } else if (
          outcome.outcome === 'rejected' &&
          (outcome.reason === 'encrypted' || outcome.reason === 'unscannable')
        ) {
          // Not malware, but nothing was checked inside: a low-severity security event.
          await insertSystemAuditEvent(tx, {
            action: 'platform.file.unscannable',
            entityType: 'file',
            entityId: lease.fileId,
            data: {
              purpose: lease.purpose,
              reason: outcome.reason,
              finding: outcome.finding ?? null,
              engine: outcome.engine ?? null,
              severity: 'low',
            },
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
      if (!(await readyToScan())) return false;
      for (let i = 0; i < FILE_SCAN_BATCH; i += 1) {
        const lease = await options.withPlatformTx({ jobId }, claimFileScan);
        if (!lease) return false;
        if (!(await processLease(lease, jobId))) return false;
      }
      return true;
    },
  };
}
