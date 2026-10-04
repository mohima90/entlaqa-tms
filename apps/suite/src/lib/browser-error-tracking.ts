import { NO_DATA_COLLECTION, scrubErrorEvent } from '@jadarat/platform-observability/scrub';
import type { BrowserOptions } from '@sentry/browser';

/** Same-origin endpoint that scrubs and forwards browser error reports (lib/error-tunnel.ts). */
export const ERROR_TUNNEL_PATH = '/api/monitoring/errors';

/**
 * The browser never sees the real DSN: the server chooses the destination at runtime (Sentry EU or
 * in-country GlitchTip) and rewrites the envelope. This placeholder only satisfies the SDK.
 */
const PLACEHOLDER_DSN = 'https://browser@errors.invalid/1';

/** Sessions, tracing, breadcrumbs and console capture are never collected in the browser. */
const DISABLED_INTEGRATIONS: ReadonlySet<string> = new Set([
  'Breadcrumbs',
  'Console',
  'BrowserSession',
  'BrowserTracing',
]);

/**
 * Browser error reporting (ADR 0009 §4, T-M1-D06): uncaught errors and unhandled rejections only, no
 * PII, scrubbed in the browser and again on the server. Bound by the CSP (`connect-src 'self'`).
 */
export function browserErrorTrackingOptions(): BrowserOptions {
  return {
    dsn: PLACEHOLDER_DSN,
    tunnel: ERROR_TUNNEL_PATH,
    dataCollection: NO_DATA_COLLECTION,
    sendClientReports: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: (event) => scrubErrorEvent(event),
    integrations: (defaults) =>
      defaults.filter((integration) => !DISABLED_INTEGRATIONS.has(integration.name)),
  };
}
