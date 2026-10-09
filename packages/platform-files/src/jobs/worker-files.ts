import { createHash } from 'node:crypto';
import { DomainError } from '@jadarat/platform-db';
import {
  type SystemTx,
  createGeneratedFile,
  finishGeneratedFile,
  loadCleanFile,
} from '@jadarat/platform-db/jobs';
import { sanitizeFileName } from '../names';
import { type GeneratedPurpose, purposeOf } from '../purposes';
import type { FileObjectStore } from './store';

/** The stored bytes differ from what the scan recorded (size or SHA-256): the stream fails at its end. */
export class FileIntegrityError extends Error {
  override readonly name = 'FileIntegrityError';
  readonly code = 'FILE_INTEGRITY';
}

export interface GeneratedFile {
  readonly purpose: GeneratedPurpose;
  readonly owner: {
    readonly module: string;
    readonly entityType: string;
    readonly entityId: string;
  };
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** The user the file is made for (sees it as their own); an active member of the job's tenant. */
  readonly forUserId: string | null;
}

/**
 * Files for module JOBS (T-M2-18; e.g. the user import T-M2-12), with the worker's Storage access bound
 * by apps/worker. Status, use and deletion are plain database calls in the job's transaction:
 * `getFileStatus`, `markFileUsed` and `deleteFileRecord` from @jadarat/platform-db.
 */
export interface WorkerFiles {
  /**
   * The bytes of a CLEAN file of the job's tenant (throws DomainError FILE_NOT_CLEAN otherwise — also
   * while it is still being scanned). The stream checks the size and SHA-256 the scan recorded and fails
   * with FileIntegrityError at the end if they differ (treat everything read as void then).
   */
  openScannedFile(tx: SystemTx, fileId: string): Promise<ReadableStream<Uint8Array>>;
  /** Stores bytes a job produced (e.g. an error report) as a clean file; returns its id. */
  storeGeneratedFile(tx: SystemTx, file: GeneratedFile): Promise<string>;
}

export function createWorkerFiles(options: { readonly store: FileObjectStore }): WorkerFiles {
  return {
    async openScannedFile(tx, fileId) {
      const file = await loadCleanFile(tx, fileId);
      if (!file) throw new DomainError('FILE_NOT_CLEAN');
      const object = await options.store.read(file.bucket, file.objectKey);
      if (!object) throw new DomainError('FILE_NOT_FOUND');
      const hash = createHash('sha256');
      let size = 0;
      return object.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            size += chunk.length;
            hash.update(chunk);
            controller.enqueue(chunk);
          },
          flush(controller) {
            if (size !== file.size || hash.digest('hex') !== file.sha256) {
              controller.error(new FileIntegrityError('stored bytes differ from the scanned file'));
            }
          },
        }),
      );
    },
    async storeGeneratedFile(tx, file) {
      const purpose = purposeOf(file.purpose);
      if (purpose.uploadBy !== 'worker' || !purpose.types.includes(file.type)) {
        throw new DomainError('TYPE_NOT_ALLOWED');
      }
      const reserved = await createGeneratedFile(tx, {
        purpose: file.purpose,
        owner: file.owner,
        name: sanitizeFileName(file.name),
        type: file.type,
        size: file.bytes.length,
        forUserId: file.forUserId,
      });
      await options.store.write(reserved.bucket, reserved.objectKey, file.bytes, file.type);
      const sha256 = createHash('sha256').update(file.bytes).digest('hex');
      if (!(await finishGeneratedFile(tx, reserved.fileId, file.bytes.length, sha256))) {
        throw new Error('storeGeneratedFile: the stored object was not found');
      }
      return reserved.fileId;
    },
  };
}
