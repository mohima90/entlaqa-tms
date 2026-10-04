import type { Breadcrumb, ErrorEvent, Integration } from '@sentry/core';
import { NO_DATA_COLLECTION, scrubErrorEvent } from './scrub';

/** Error-tracker settings read at RUNTIME, so one build serves every deployment (ADR 0010). */
export interface ErrorTrackingConfig {
  readonly dsn: string;
  readonly environment: string;
  readonly release?: string;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === '' ? undefined : value;
}

/**
 * A DSN must use HTTPS — except plain HTTP to a host on the deployment's own private network (a
 * single-label name such as `glitchtip`, or localhost), used by sovereign installations.
 */
export function isAllowedDsn(dsn: string): boolean {
  try {
    const url = new URL(dsn);
    if (!url.username || url.pathname.length <= 1) return false;
    if (url.protocol === 'https:') return true;
    return (
      url.protocol === 'http:' &&
      (/^[a-z0-9-]{1,63}$/i.test(url.hostname) || url.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

/** True when a DSN is configured, valid or not (to warn about an invalid one). */
export function isErrorTrackingDsnSet(): boolean {
  return readEnv('SENTRY_DSN') !== undefined;
}

/** `null` = error tracking off (no DSN, or an invalid one): errors are still logged. */
export function readErrorTrackingConfig(): ErrorTrackingConfig | null {
  const dsn = readEnv('SENTRY_DSN');
  if (!dsn || !isAllowedDsn(dsn)) return null;
  const release = readEnv('JADARAT_RELEASE') ?? readEnv('VERCEL_GIT_COMMIT_SHA');
  return {
    dsn,
    environment:
      readEnv('JADARAT_ENVIRONMENT') ?? readEnv('VERCEL_ENV') ?? readEnv('NODE_ENV') ?? 'unknown',
    ...(release ? { release } : {}),
  };
}

/**
 * Destination for BROWSER reports: `SENTRY_BROWSER_DSN` (a separate project, so floods of forged
 * browser reports cannot use up the quota server errors depend on), else `SENTRY_DSN`.
 */
export function readBrowserErrorTrackingConfig(): ErrorTrackingConfig | null {
  const server = readErrorTrackingConfig();
  const browserDsn = readEnv('SENTRY_BROWSER_DSN');
  if (browserDsn === undefined) return server;
  if (!isAllowedDsn(browserDsn)) return null;
  const release = readEnv('JADARAT_RELEASE') ?? readEnv('VERCEL_GIT_COMMIT_SHA');
  return {
    dsn: browserDsn,
    environment:
      readEnv('JADARAT_ENVIRONMENT') ?? readEnv('VERCEL_ENV') ?? readEnv('NODE_ENV') ?? 'unknown',
    ...(release ? { release } : {}),
  };
}

const DISABLED_INTEGRATIONS: ReadonlySet<string> = new Set(['ContextLines']);

/**
 * Options for the Sentry SDK (`Sentry.init`), identical for Sentry SaaS (EU region) and GlitchTip
 * (ADR 0009 §4): errors only — no tracing (no sample rate is set), no session replay, no breadcrumbs,
 * and the SDK's data collection fully off (`NO_DATA_COLLECTION`: no user info, cookies, headers,
 * bodies, query strings, local variables or source lines) — and every event passes through
 * `scrubErrorEvent`. The SDK does
 * not take over OpenTelemetry or patch modules at load time: traces get their own vendor-neutral
 * OpenTelemetry pipeline later (ADR 0009 §1). Source code lines around each stack frame are not read
 * from disk or sent (`ContextLines` off).
 */
export function errorTrackingOptions(config: ErrorTrackingConfig) {
  return {
    dsn: config.dsn,
    environment: config.environment,
    ...(config.release ? { release: config.release } : {}),
    dataCollection: NO_DATA_COLLECTION,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: (_breadcrumb: Breadcrumb): Breadcrumb | null => null,
    beforeSend: (event: ErrorEvent): ErrorEvent => scrubErrorEvent(event),
    enableOpenTelemetrySetup: false,
    enableRuntimeChannelInjection: false,
    integrations: (defaults: Integration[]): Integration[] =>
      defaults.filter((integration) => !DISABLED_INTEGRATIONS.has(integration.name)),
  };
}
