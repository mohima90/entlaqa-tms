import 'server-only';
import {
  type ErrorContext,
  errorName,
  errorTrackingOptions,
  log,
  readErrorTrackingConfig,
  setErrorReporter,
} from '@jadarat/platform-observability';
import { vercelWaitUntil } from '@sentry/core/server';
import * as Sentry from '@sentry/nextjs';

/** The parts of the Sentry SDK the app uses (Sentry SaaS EU or GlitchTip; injectable for tests). */
export interface ErrorTrackingSdk {
  init(options: ReturnType<typeof errorTrackingOptions>): unknown;
  captureException(error: unknown, hint: { readonly tags: Record<string, string> }): unknown;
  captureRequestError: typeof Sentry.captureRequestError;
  flush(timeoutMs: number): PromiseLike<boolean>;
}

/** Keeps a serverless function alive until the task ends (no-op outside Vercel); injectable for tests. */
export type KeepAlive = (task: Promise<unknown>) => void;

/** How long a report may hold the function open after the response (Sentry's own default). */
const FLUSH_TIMEOUT_MS = 2_000;

type RequestErrorArgs = Parameters<typeof Sentry.captureRequestError>;

function tagsFor(context: ErrorContext): Record<string, string> {
  const tags: Record<string, string> = {};
  if (context.action) tags.action = context.action;
  if (context.permission) tags.permission = context.permission;
  if (context.correlationId) tags.correlation_id = context.correlationId;
  if (context.tenantId) tags.tenant_id = context.tenantId;
  return tags;
}

/**
 * Server start-up (instrumentation `register`, Node.js runtime): starts the error tracker when a valid
 * `SENTRY_DSN` is set at runtime. Without one, errors are only logged.
 */
export function startObservability(
  sdk: ErrorTrackingSdk = Sentry,
  keepAlive: KeepAlive = vercelWaitUntil,
): boolean {
  const config = readErrorTrackingConfig();
  if (!config) {
    log.info('error tracking off (no valid SENTRY_DSN)');
    return false;
  }
  sdk.init(errorTrackingOptions(config));
  setErrorReporter((error, context) => {
    sdk.captureException(error, { tags: tagsFor(context) });
    // Errors handled inside server actions do not reach onRequestError (which flushes by itself):
    // send now, so a serverless function frozen after the response does not lose the report.
    keepAlive(Promise.resolve(sdk.flush(FLUSH_TIMEOUT_MS)).catch(() => false));
  });
  log.info('error tracking on');
  return true;
}

/**
 * Next.js `onRequestError`: errors thrown while rendering or in route handlers. Logged (class name and
 * route pattern only) and reported WITHOUT the request headers (cookies, tokens). A no-op for the
 * tracker when it was not started.
 */
export function handleRequestError(
  error: unknown,
  request: RequestErrorArgs[1],
  context: RequestErrorArgs[2],
  sdk: Pick<ErrorTrackingSdk, 'captureRequestError'> = Sentry,
): void {
  log.error('request failed', { errorName: errorName(error), route: context.routePath });
  try {
    sdk.captureRequestError(
      error,
      { path: request.path, method: request.method, headers: {} },
      context,
    );
  } catch {
    // Reporting must never turn into a second failure.
  }
}
