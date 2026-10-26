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

/** The SQLSTATE when `error` is a deadlock or serialization failure (TRANSACTION_CONFLICT_CODES), else null. */
export function transactionConflictCode(error: unknown): string | null {
  const code = pgError(error)?.code;
  return code !== undefined && TRANSACTION_CONFLICT_CODES.includes(code) ? code : null;
}

/**
 * A short, technical description of a database refusal for the platform operator: the SQLSTATE, the
 * message and the PL/pgSQL functions it went through (PostgreSQL's context lines). Our functions raise fixed
 * texts and PostgreSQL's own privilege and row-level-security messages name objects only, so it carries no
 * values — use it for 42501 refusals, never for constraint errors (their detail can quote values). Null when
 * `error` is not a database error.
 */
export function pgRefusalDetail(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const e = current as { code?: unknown; message?: unknown; where?: unknown; cause?: unknown };
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      const message = typeof e.message === 'string' ? e.message : '';
      const functions =
        typeof e.where === 'string'
          ? e.where
              .split('\n')
              .map((line) => /^PL\/pgSQL function ([^\s(]+)\(.*\) line (\d+)/.exec(line.trim()))
              .filter((m): m is RegExpExecArray => m !== null)
              .map((m) => `${m[1] ?? ''}:${m[2] ?? ''}`)
          : [];
      const text = [
        `${e.code} ${message}`,
        ...(functions.length > 0 ? [functions.join(' < ')] : []),
      ];
      return text.join(' @ ').slice(0, 400);
    }
    current = e.cause;
  }
  return null;
}
