import { type LogFields, type Logger, log as defaultLog } from './logger';

/** What may accompany an error report: identifiers only, never input or user data. */
export type ErrorContext = Pick<LogFields, 'action' | 'permission' | 'correlationId' | 'tenantId'>;

/** Sends an error to the error tracker (Sentry SaaS EU or GlitchTip), registered at start-up. */
export type ErrorReporter = (error: unknown, context: ErrorContext) => void;

/**
 * Kept on `globalThis`, not in module state: Next.js bundles the instrumentation hook separately from
 * the route code, so each bundle has its own copy of this module (the Sentry SDK does the same).
 */
const REPORTER_KEY = Symbol.for('jadarat.observability.errorReporter');
const registry = globalThis as typeof globalThis & { [REPORTER_KEY]?: ErrorReporter | undefined };

/**
 * Registers the error tracker. Called once by the app's instrumentation when a DSN is configured; the
 * platform packages stay vendor-neutral and work (logging only) when none is.
 */
export function setErrorReporter(next: ErrorReporter | undefined): void {
  registry[REPORTER_KEY] = next;
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** A numeric `status` carried by the error (e.g. an upstream HTTP status), never its message. */
function errorStatus(error: unknown): number | undefined {
  return error instanceof Error && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;
}

/**
 * Records an unexpected error: one structured log line (class name and identifiers only — the message
 * may contain input values) and, when configured, an error report whose content is scrubbed by
 * `scrubErrorEvent`. Never throws.
 */
export function reportError(
  error: unknown,
  context: ErrorContext,
  logger: Logger = defaultLog,
): void {
  try {
    const status = errorStatus(error);
    logger.error('unexpected error', {
      ...context,
      errorName: errorName(error),
      // e.g. AuthServiceError: tells an outage (5xx) from a network failure (0).
      ...(status === undefined ? {} : { status }),
    });
  } catch {
    // Logging must never turn into a second failure.
  }
  try {
    registry[REPORTER_KEY]?.(error, context);
  } catch {
    // Neither must reporting.
  }
}
