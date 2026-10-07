import 'server-only';
import {
  type ErrorTrackingConfig,
  MAX_ENVELOPE_BYTES,
  buildForwardEnvelope,
  createKeyedRateLimiter,
  createRateLimiter,
  forwardTargetFor,
  log,
  readBrowserErrorTrackingConfig,
  readEnvelopeEvents,
} from '@jadarat/platform-observability';
import { clientAddress, clientRateKey } from './client-ip';

/**
 * Browser error reports (`POST /api/monitoring/errors`, see lib/browser-error-tracking.ts). Public and
 * unauthenticated, so it is bounded:
 *  - cross-site browser requests are refused (`Sec-Fetch-Site`); scripts without fetch-metadata
 *    headers are accepted, which is why the limits below exist;
 *  - 64 KiB per envelope, one error event, rebuilt from an allow-list and scrubbed again here;
 *  - at most 10 forwarded reports per client and 60 in total per minute per instance (the client key —
 *    the platform's client-IP header — stays in memory only and is never logged);
 *  - 5-second upstream timeout; the answer never says what happened upstream.
 * Reports go to `SENTRY_BROWSER_DSN` (a separate project) when set, else `SENTRY_DSN` (ADR 0009 §4).
 */
export interface TunnelDeps {
  readonly config: () => ErrorTrackingConfig | null;
  readonly allow: () => boolean;
  readonly allowClient: (key: string) => boolean;
  readonly send: (url: string, init: RequestInit) => Promise<Response>;
}

const defaultDeps: TunnelDeps = {
  config: readBrowserErrorTrackingConfig,
  allow: createRateLimiter(60, 60_000),
  allowClient: createKeyedRateLimiter(10, 60_000),
  send: (url, init) => fetch(url, init),
};

/**
 * The client key (lib/client-ip.ts): a platform-overwritten client-IP header (IPv6 by its /64), else
 * one shared key.
 */
function clientKey(request: Request): string {
  return clientRateKey(clientAddress((name) => request.headers.get(name)));
}

const ACCEPTED = 202;

async function readLimited(request: Request, limit: number): Promise<Buffer | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function handleErrorTunnel(
  request: Request,
  deps: TunnelDeps = defaultDeps,
): Promise<Response> {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return new Response(null, { status: 403 });

  let body: Buffer | null;
  try {
    body = await readLimited(request, MAX_ENVELOPE_BYTES);
  } catch {
    // Client aborted or the stream broke: nothing to forward, nothing worth reporting.
    return new Response(null, { status: 400 });
  }
  if (body === null) return new Response(null, { status: 413 });

  const config = deps.config();
  const target = config ? forwardTargetFor(config.dsn) : null;
  if (!config || !target) return new Response(null, { status: 204 });

  const events = readEnvelopeEvents(body);
  if (events === null) return new Response(null, { status: 400 });
  if (events.length === 0) return new Response(null, { status: 204 });
  if (!deps.allowClient(clientKey(request)) || !deps.allow()) {
    return new Response(null, { status: 429 });
  }

  try {
    const upstream = await deps.send(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': target.auth },
      body: buildForwardEnvelope(events, target, {
        environment: config.environment,
        ...(config.release ? { release: config.release } : {}),
      }),
      signal: AbortSignal.timeout(5_000),
    });
    // Release the connection: the upstream answer is never needed.
    await upstream.body?.cancel().catch(() => undefined);
    if (!upstream.ok) {
      log.warn('browser error report not accepted upstream', {
        action: 'platform.observability.browser_error',
        status: upstream.status,
      });
    }
  } catch {
    log.warn('browser error report not forwarded', {
      action: 'platform.observability.browser_error',
    });
  }
  return new Response(null, { status: ACCEPTED });
}
