import 'server-only';
import {
  type ErrorTrackingConfig,
  MAX_ENVELOPE_BYTES,
  buildForwardEnvelope,
  createRateLimiter,
  forwardTargetFor,
  log,
  readEnvelopeEvents,
  readErrorTrackingConfig,
} from '@jadarat/platform-observability';

/**
 * Browser error reports (`POST /api/monitoring/errors`, see lib/browser-error-tracking.ts). Public, so
 * it is bounded: same-origin requests only, 64 KiB per envelope, error events only, at most 60
 * forwarded envelopes per minute per instance, and a 5-second upstream timeout. Every event is
 * scrubbed again here before it leaves (ADR 0009 §4). The answer never says what happened upstream.
 */
export interface TunnelDeps {
  readonly config: () => ErrorTrackingConfig | null;
  readonly allow: () => boolean;
  readonly send: (url: string, init: RequestInit) => Promise<Response>;
}

const defaultDeps: TunnelDeps = {
  config: readErrorTrackingConfig,
  allow: createRateLimiter(60, 60_000),
  send: (url, init) => fetch(url, init),
};

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

  const body = await readLimited(request, MAX_ENVELOPE_BYTES);
  if (body === null) return new Response(null, { status: 413 });

  const config = deps.config();
  const target = config ? forwardTargetFor(config.dsn) : null;
  if (!config || !target) return new Response(null, { status: 204 });

  const events = readEnvelopeEvents(body);
  if (events === null) return new Response(null, { status: 400 });
  if (events.length === 0) return new Response(null, { status: 204 });
  if (!deps.allow()) return new Response(null, { status: 429 });

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
