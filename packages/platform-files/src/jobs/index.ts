/**
 * RESTRICTED ENTRY POINT — job code and the worker app only (dependency-cruiser rules
 * `admin-jobs-folders-are-private`, `no-admin-or-jobs-reachable-from-suite`; ADR 0005, ADR 0006).
 */
export {
  CLAMD_MAX_SCAN_TIME_MS,
  CLAMD_VERDICT_TIMEOUT_MS,
  type ClamdOptions,
  type Scanner,
  ScannerError,
  ScannerUnavailableError,
  type ScanSession,
  type ScannerVersion,
  type ScanVerdict,
  createClamdScanner,
  parseClamDate,
  parseVerdict,
  parseVersion,
} from './clamd';
export {
  FILE_SCAN_BATCH,
  FILE_SCAN_TASK,
  FileScanFailedError,
  type FileScanTaskOptions,
  SIGNATURE_HARD_MAX_AGE_DAYS,
  SIGNATURE_MAX_AGE_HOURS,
  ScannerCrashSuspectedError,
  type SignatureAge,
  StorageStreamError,
  createFileScanTask,
  signatureAge,
} from './scan';
export {
  FILE_HOUSEKEEPING_BATCH,
  FILE_HOUSEKEEPING_TASK,
  type FileHousekeepingTaskOptions,
  type HousekeepingWork,
  ORPHAN_SWEEP_BATCH,
  ORPHAN_SWEEP_INTERVAL_MS,
  createFileHousekeepingTask,
  performHousekeeping,
} from './housekeeping';
export {
  FileIntegrityError,
  type GeneratedFile,
  type WorkerFiles,
  createWorkerFiles,
} from './worker-files';
export { type FileObjectStore, codeOf, isTemporary } from './store';
