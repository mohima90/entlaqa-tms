/** SQLSTATE, constraint and message of a postgres.js error (also wrapped by Drizzle). */
export function pgError(
  error: unknown,
): { code?: string; constraint?: string; message: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const e = current as {
      code?: unknown;
      constraint_name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      return {
        code: e.code,
        ...(typeof e.constraint_name === 'string' ? { constraint: e.constraint_name } : {}),
        message: typeof e.message === 'string' ? e.message : '',
      };
    }
    current = e.cause;
  }
  return null;
}

/**
 * SQLSTATEs after which PostgreSQL has rolled the whole transaction back and running it again is the
 * documented remedy: 40P01 deadlock_detected, 40001 serialization_failure.
 */
export const TRANSACTION_CONFLICT_CODES: readonly string[] = ['40P01', '40001'];

/** True when `error` is a deadlock or serialization failure (see TRANSACTION_CONFLICT_CODES). */
export function isTransactionConflict(error: unknown): boolean {
  const code = pgError(error)?.code;
  return code !== undefined && TRANSACTION_CONFLICT_CODES.includes(code);
}
