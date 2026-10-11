import {
  type HousekeepingAction,
  type SystemTx,
  type WithPlatformTx,
  claimFileHousekeeping,
  claimOrphanObjects,
  finishFileHousekeeping,
  lockFileHousekeeping,
} from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { type FileObjectStore, codeOf } from './store';

/** graphile-worker task of the file housekeeping (a platform task: every organization). */
export const FILE_HOUSEKEEPING_TASK = 'platform.files.housekeeping';
/** Files handled per pass; a full pass queues the next one at once. */
export const FILE_HOUSEKEEPING_BATCH = 50;
/** Orphan objects removed per sweep. */
export const ORPHAN_SWEEP_BATCH = 100;
/** The orphan sweep reads every object row of Storage: at most once an hour per worker process. */
export const ORPHAN_SWEEP_INTERVAL_MS = 60 * 60_000;
/** The share brake applies only above this many orphans (a small installation's few are no signal). */
export const ORPHAN_SHARE_FLOOR = 50;

/**
 * The orphan sweep's switch and brake (worker settings FILE_ORPHAN_SWEEP, FILE_ORPHAN_SWEEP_MAX,
 * FILE_ORPHAN_SWEEP_MAX_SHARE). Mass orphans mean a restore or a fault that lost file records, not
 * leftovers: above the brake nothing is removed and an error is logged.
 */
export interface OrphanSweepSettings {
  /** Off pauses the sweep (e.g. while a database or Storage restore is being reconciled). */
  readonly enabled: boolean;
  /** More orphans than this in all: none removed. */
  readonly maxOrphans: number;
  /** More than this share of all objects, in percent (above ORPHAN_SHARE_FLOOR orphans): none removed. */
  readonly maxSharePercent: number;
}

export const DEFAULT_ORPHAN_SWEEP: OrphanSweepSettings = {
  enabled: true,
  maxOrphans: 500,
  maxSharePercent: 10,
};

export interface FileHousekeepingTaskOptions {
  readonly withPlatformTx: WithPlatformTx;
  readonly store: FileObjectStore;
  readonly log: (level: WorkerLogLevel, message: string) => void;
  readonly orphanSweep?: OrphanSweepSettings;
  readonly now?: () => number;
}

/** A file's Storage work: which object, and what to do with it. */
export interface HousekeepingWork {
  readonly fileId: string;
  readonly bucket: string;
  readonly objectKey: string;
  readonly action: HousekeepingAction;
}

/**
 * One file's Storage work, in ONE transaction (`tx`): lock the file's row and check the action is still due
 * (a legal hold set, a use recorded or a scan lease taken since it was leased stops it — and whoever
 * changes the file now waits for us), do the Storage work, record it. False when it was no longer due.
 * A failure after the Storage work leaves the record unchanged: the next lease repeats it (moving a moved
 * object answers `missing`, removing a removed one succeeds).
 */
export async function performHousekeeping(
  tx: SystemTx,
  store: FileObjectStore,
  work: HousekeepingWork,
): Promise<boolean> {
  if (!(await lockFileHousekeeping(tx, work.fileId, work.action))) return false;
  if (work.action === 'quarantine') {
    await store.move(work.bucket, work.objectKey, 'quarantine');
  } else {
    await store.remove(work.bucket, work.objectKey);
  }
  await finishFileHousekeeping(tx, work.fileId, work.action);
  return true;
}

/**
 * Retention and quarantine (ADR 0006 §7; T-M2-18; the rules are the database's,
 * private.file_housekeeping_action): expired download grants are removed; infected objects still in their
 * upload bucket move to `quarantine`; rejected objects are removed; files past their retention are purged
 * — the object first, then the record (a tombstone without the name while a business row references it).
 * Never a file on legal hold, re-checked under the row lock just before the Storage work. A file whose
 * Storage work fails is tried again when its 10-minute lease ends. At most hourly, ORPHAN objects are
 * removed too: objects in our buckets, older than 3 hours, that no live file record owns (a generated file
 * whose job rolled back, or an object a still-valid upload URL created again after quarantine, removal or
 * purge) — unless switched off, and never above its brake (OrphanSweepSettings). Deleting objects never
 * depends on the request path: only the worker holds the Storage key.
 */
export function createFileHousekeepingTask(options: FileHousekeepingTaskOptions): PlatformTask {
  const now = options.now ?? Date.now;
  const sweep = options.orphanSweep ?? DEFAULT_ORPHAN_SWEEP;
  let lastOrphanSweep = -Infinity;

  /** Orphan objects, at most hourly; true when a full batch was removed (more may wait). */
  async function sweepOrphans(jobId: string): Promise<boolean> {
    if (!sweep.enabled || now() - lastOrphanSweep < ORPHAN_SWEEP_INTERVAL_MS) return false;
    lastOrphanSweep = now();
    let batch;
    try {
      batch = await options.withPlatformTx({ jobId }, (tx) =>
        claimOrphanObjects(tx, ORPHAN_SWEEP_BATCH),
      );
    } catch (error) {
      options.log('warning', `file housekeeping: orphan sweep postponed (${codeOf(error)})`);
      return false;
    }
    const { orphans, totalOrphans, totalObjects } = batch;
    const share = totalObjects === 0 ? 0 : (totalOrphans * 100) / totalObjects;
    if (
      totalOrphans > sweep.maxOrphans ||
      (totalOrphans > ORPHAN_SHARE_FLOOR && share > sweep.maxSharePercent)
    ) {
      options.log(
        'error',
        `file housekeeping: ${String(totalOrphans)} orphan objects (${share.toFixed(1)}% of ${String(totalObjects)}) exceed the sweep's brake (${String(sweep.maxOrphans)} objects, ${String(sweep.maxSharePercent)}%): none removed — check for a restore or lost file records (FILE_ORPHAN_SWEEP, docs/engineering/files.md §4)`,
      );
      return false;
    }
    let removed = 0;
    for (const orphan of orphans) {
      try {
        await options.store.remove(orphan.bucket, orphan.objectKey);
        removed += 1;
      } catch (error) {
        options.log(
          'warning',
          `file housekeeping: an orphan object in ${orphan.bucket} was not removed (${codeOf(error)})`,
        );
      }
    }
    if (removed > 0) {
      options.log('info', `file housekeeping: ${String(removed)} orphan objects removed`);
    }
    if (orphans.length === ORPHAN_SWEEP_BATCH && removed > 0) {
      lastOrphanSweep = -Infinity;
      return true;
    }
    return false;
  }

  return {
    name: FILE_HOUSEKEEPING_TASK,
    async run({ jobId }) {
      const items = await options.withPlatformTx({ jobId }, (tx) =>
        claimFileHousekeeping(tx, FILE_HOUSEKEEPING_BATCH),
      );
      let done = 0;
      for (const item of items) {
        try {
          if (
            await options.withPlatformTx({ jobId }, (tx) =>
              performHousekeeping(tx, options.store, item),
            )
          ) {
            done += 1;
          }
        } catch (error) {
          options.log(
            'warning',
            `file ${item.fileId}: ${item.action} postponed (${codeOf(error)}); tried again later`,
          );
        }
      }
      if (done > 0) options.log('info', `file housekeeping: ${String(done)} done`);
      const moreOrphans = await sweepOrphans(jobId);
      return items.length === FILE_HOUSEKEEPING_BATCH || moreOrphans;
    },
  };
}
