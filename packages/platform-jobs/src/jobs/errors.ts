import { formatErrorForLog } from '@jadarat/platform-observability';

/**
 * The error a failed task hands to graphile-worker, which logs its message and stack and stores the
 * message in `jobs.last_error`. Messages of the original error routinely carry data (names in a handler's
 * message, values quoted by PostgreSQL), so only the class name, a stable code and the stack locations
 * survive (ADR 0009 §2).
 */
export class JobError extends Error {
  override readonly name = 'JobError';
}

const CODE = /^[0-9A-Z_]{2,64}$/;

/** A stable code (SQLSTATE, application error code) on the error or its causes. */
function codeOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && CODE.test(code)) return code;
    current = cause;
  }
  return undefined;
}

export function toJobError(error: unknown, what: string): JobError {
  const name = error instanceof Error ? error.name : typeof error;
  const code = codeOf(error);
  const safe = new JobError(`${what} failed: ${name}${code ? ` [${code}]` : ''}`);
  if (error instanceof Error) {
    // Stack locations of the original error, its message redacted.
    const frames = formatErrorForLog(error).split('\n').slice(1);
    safe.stack = [`JobError: ${safe.message}`, ...frames].join('\n');
  }
  return safe;
}
