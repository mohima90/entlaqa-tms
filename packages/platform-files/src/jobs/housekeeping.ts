import {
  type WithPlatformTx,
  claimFileHousekeeping,
  finishFileHousekeeping,
} from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { type FileObjectStore, codeOf } from './store';

/** graphile-worker task of the file housekeeping (a platform task: every organization). */
export const FILE_HOUSEKEEPING_TASK = 'platform.files.housekeeping';
/** Files handled per pass; a full pass queues the next one at once. */
export const FILE_HOUSEKEEPING_BATCH = 50;

export interface FileHousekeepingTaskOptions {
  readonly withPlatformTx: WithPlatformTx;
  readonly store: FileObjectStore;
  readonly log: (level: WorkerLogLevel, message: string) => void;
}

/**
 * Retention and quarantine (ADR 0006 §7; T-M2-18; the rules are the database's,
 * private.claim_file_housekeeping): expired download grants are removed; infected objects still in their
 * upload bucket move to `quarantine`; rejected objects are removed; files past their retention are purged
 * — the object first, then the record (a tombstone without the name while a business row references it).
 * Never a file on legal hold. A file whose Storage work fails is tried again when its 10-minute lease ends.
 * Deleting objects never depends on the request path: only the worker holds the Storage key.
 */
export function createFileHousekeepingTask(options: FileHousekeepingTaskOptions): PlatformTask {
  return {
    name: FILE_HOUSEKEEPING_TASK,
    async run({ jobId }) {
      const items = await options.withPlatformTx({ jobId }, (tx) =>
        claimFileHousekeeping(tx, FILE_HOUSEKEEPING_BATCH),
      );
      let done = 0;
      for (const item of items) {
        try {
          if (item.action === 'quarantine') {
            // `missing`: an earlier attempt moved it already (its record was not updated); recorded now.
            await options.store.move(item.bucket, item.objectKey, 'quarantine');
          } else {
            await options.store.remove(item.bucket, item.objectKey);
          }
          await options.withPlatformTx({ jobId }, (tx) =>
            finishFileHousekeeping(tx, item.fileId, item.action),
          );
          done += 1;
        } catch (error) {
          options.log(
            'warning',
            `file ${item.fileId}: ${item.action} postponed (${codeOf(error)}); tried again later`,
          );
        }
      }
      if (done > 0) options.log('info', `file housekeeping: ${String(done)} done`);
      return items.length === FILE_HOUSEKEEPING_BATCH;
    },
  };
}
