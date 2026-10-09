/**
 * RESTRICTED ENTRY POINT — job code and the worker app only (dependency-cruiser rules
 * `admin-jobs-folders-are-private`, `no-admin-or-jobs-reachable-from-suite`; ADR 0005, ADR 0006).
 */
export {
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
  type FileScanTaskOptions,
  SIGNATURE_MAX_AGE_HOURS,
  createFileScanTask,
} from './scan';
export {
  FILE_HOUSEKEEPING_BATCH,
  FILE_HOUSEKEEPING_TASK,
  type FileHousekeepingTaskOptions,
  createFileHousekeepingTask,
} from './housekeeping';
export {
  FileIntegrityError,
  type GeneratedFile,
  type WorkerFiles,
  createWorkerFiles,
} from './worker-files';
export { type FileObjectStore, codeOf, isTemporary } from './store';
