import {
  type AppError,
  type Result,
  appError,
  defineErrorCodes,
  err,
  ok,
} from '@jadarat/platform-core';
import { isDomainError } from '@jadarat/platform-db';

/**
 * The files service's refusals as application errors (ADR 0011 §3; T-M2-18 integration review L-b), for the
 * owning module's actions: routine outcomes — a file too large, Storage briefly unavailable — are answers,
 * not internal errors (no error-tracker event; an `afterCommit` refusal is logged as a warning).
 */
export const FileErrors = defineErrorCodes({
  FILE_TYPE_NOT_ALLOWED: { status: 422, messageKey: 'files.errors.typeNotAllowed' },
  FILE_TOO_LARGE: { status: 422, messageKey: 'files.errors.tooLarge' },
  FILE_TOO_MANY_UPLOADS: { status: 429, messageKey: 'files.errors.tooManyUploads' },
  FILE_NOT_READY: { status: 409, messageKey: 'files.errors.notReady' },
  FILE_NOT_UPLOADED: { status: 409, messageKey: 'files.errors.notUploaded' },
  FILE_UPLOAD_EXPIRED: { status: 409, messageKey: 'files.errors.uploadExpired' },
  FILE_BUSY: { status: 409, messageKey: 'files.errors.busy' },
  FILE_STORAGE_UNAVAILABLE: {
    status: 503,
    messageKey: 'files.errors.storageUnavailable',
    expose: true,
  },
});

/**
 * DomainError codes of the files service (platform-db FileErrorCode and the Storage outcomes) and the
 * application error each becomes. Not here, on purpose: UNKNOWN_PURPOSE and INVALID_FILE_DATA — the
 * calling module passed a purpose or owner it must never pass (a bug: an internal error, reported).
 */
const APP_ERRORS: Readonly<Record<string, () => AppError>> = {
  TYPE_NOT_ALLOWED: () => appError(FileErrors.FILE_TYPE_NOT_ALLOWED),
  TOO_LARGE: () => appError(FileErrors.FILE_TOO_LARGE),
  TOO_MANY_PENDING_UPLOADS: () => appError(FileErrors.FILE_TOO_MANY_UPLOADS),
  FILE_NOT_CLEAN: () => appError(FileErrors.FILE_NOT_READY),
  OBJECT_NOT_UPLOADED: () => appError(FileErrors.FILE_NOT_UPLOADED),
  UPLOAD_EXPIRED: () => appError(FileErrors.FILE_UPLOAD_EXPIRED),
  FILE_BUSY: () => appError(FileErrors.FILE_BUSY),
  // As if the file did not exist (another owner entity, another tenant, purged): no existence leak.
  FILE_NOT_FOUND: () => appError('NOT_FOUND'),
  // Storage's policies refused (the session may no longer act, or the reservation/grant is gone).
  STORAGE_REFUSED: () => appError('FORBIDDEN'),
  STORAGE_UNAVAILABLE: () => appError(FileErrors.FILE_STORAGE_UNAVAILABLE),
};

/** The application error for an expected files-service refusal, else null (a bug or an outage: rethrow). */
export function fileAppError(error: unknown): AppError | null {
  if (!isDomainError(error)) return null;
  const make = APP_ERRORS[error.code];
  return make ? make() : null;
}

/**
 * Runs a files-service call and returns its expected refusals as error results — in an action's handler
 * (the transaction rolls back) and in its `afterCommit` (the answer; the commit stays). Anything else is
 * thrown as is (an internal error with a correlation id).
 *
 *   afterCommit: ({ result }) => fileResult(signUploadIntent(storage, result))
 */
export async function fileResult<T>(call: Promise<T>): Promise<Result<T, AppError>> {
  try {
    return ok(await call);
  } catch (error) {
    const mapped = fileAppError(error);
    if (mapped) return err(mapped);
    throw error;
  }
}
