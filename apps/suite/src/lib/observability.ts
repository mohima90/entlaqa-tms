import 'server-only';
import {
  type ErrorContext,
  errorName,
  errorTrackingOptions,
  installConsoleScrubbing,
  isErrorTrackingDsnSet,
  log,
  readErrorTrackingConfig,
  setErrorReporter,
} from '@jadarat/platform-observability';
import * as Sentry from '@sentry/nextjs';

type Integration = ReturnType<typeof Sentry.onUnhandledRejectionIntegration>;

/** The parts of the Sentry SDK the app uses (Sentry SaaS EU or GlitchTip; injectable for tests). */
export interface ErrorTrackingSdk {
  init(
    options: Omit<ReturnType<typeof errorTrackingOptions>, 'integrations'> & {
      integrations: (defaults: Integration[]) => Integration[];
    },
  ): unknown;
  captureException(error: unknown, hint: { readonly tags: Record<string, string> }): unknown;
  captureRequestError: typeof Sentry.captureRequestError;
  flush(timeoutMs: number): PromiseLike<boolean>;
  onUnhandledRejectionIntegration: typeof Sentry.onUnhandledRejectionIntegration;
}

/** Keeps a serverless function alive until the task ends; injectable for tests. */
export type KeepAlive = (task: Promise<unknown>) => void;

/** How long a report may hold the function open after the response (Sentry's own default). */
const FLUSH_TIMEOUT_MS = 2_000;

interface WaitUntilContext {
  readonly waitUntil?: (task: Promise<unknown>) => void;
}
type RequestContextStore = { readonly get?: () => WaitUntilContext | undefined } | undefined;

/**
 * Vercel's per-request `waitUntil` (what `@vercel/functions` reads), so the function is not frozen
 * before a report is sent. A no-op where it does not exist (containers keep running anyway).
 */
export const vercelKeepAlive: KeepAlive = (task) => {
  const store = (globalThis as Record<symbol, RequestContextStore>)[
    Symbol.for('@vercel/request-context')
  ];
  store?.get?.()?.waitUntil?.(task);
};

function tagsFor(context: ErrorContext): Record<string, string> {
  const tags: Record<string, string> = {};
  if (context.action) tags.action = context.action;
  if (context.permission) tags.permission = context.permission;
  if (context.correlationId) tags.correlation_id = context.correlationId;
  if (context.tenantId) tags.tenant_id = context.tenantId;
  if (context.errorCode) tags.error_code = context.errorCode;
  return tags;
}

/**
 * Server start-up (instrumentation `register`, Node.js runtime): console output (Next.js, SDKs) is
 * scrubbed like our own logs, and the error tracker starts when a valid `SENTRY_DSN` is set at runtime.
 * Without one, errors are only logged.
 */
export function startObservability(
  sdk: ErrorTrackingSdk = Sentry,
  keepAlive: KeepAlive = vercelKeepAlive,
): boolean {
  installConsoleScrubbing();
  const config = readErrorTrackingConfig();
  if (!config) {
    if (isErrorTrackingDsnSet()) log.warn('SENTRY_DSN is set but invalid; error tracking is off');
    else log.info('error tracking off (no SENTRY_DSN)');
    return false;
  }
  const options = errorTrackingOptions(config);
  sdk.init({
    ...options,
    integrations: (defaults) => [
      // Unhandled rejections are still reported, but the SDK must not print their stack and message.
      ...options
        .integrations(defaults)
        .filter((integration) => integration.name !== 'OnUnhandledRejection'),
      sdk.onUnhandledRejectionIntegration({ mode: 'none' }),
    ],
  });
  setErrorReporter((error, context) => {
    sdk.captureException(error, { tags: tagsFor(context) });
    // Errors handled inside server actions do not reach onRequestError (which flushes by itself):
    // send now, so a serverless function frozen after the response does not lose the report.
    keepAlive(Promise.resolve(sdk.flush(FLUSH_TIMEOUT_MS)).catch(() => false));
  });
  log.info('error tracking on');
  return true;
}

type RequestErrorArgs = Parameters<typeof Sentry.captureRequestError>;

/**
 * Next.js `onRequestError`: errors thrown while rendering or in route handlers. Logged (class name and
 * route pattern only) and reported WITHOUT request headers (cookies, tokens) or query string. A no-op
 * for the tracker when it was not started.
 */
export function handleRequestError(
  error: unknown,
  request: RequestErrorArgs[1],
  context: RequestErrorArgs[2],
  sdk: Pick<ErrorTrackingSdk, 'captureRequestError'> = Sentry,
): void {
  log.error('request failed', { errorName: errorName(error), route: context.routePath });
  const path = request.path.split(/[?#]/, 1)[0] ?? '/';
  try {
    sdk.captureRequestError(error, { path, method: request.method, headers: {} }, context);
  } catch {
    // Reporting must never turn into a second failure.
  }
}
