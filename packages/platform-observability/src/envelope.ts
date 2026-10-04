import type { ErrorEvent } from '@sentry/core';
import { scrubErrorEvent } from './scrub';

/**
 * Browser error reports reach the error tracker only through our own server (a "tunnel", ADR 0009 §4):
 * the browser never learns the DSN, the destination is chosen at runtime (Sentry EU or in-country
 * GlitchTip), and every event is scrubbed again on the server — the browser is not trusted to have
 * done it. Only error events pass; sessions, replays, transactions, attachments, client reports and
 * anything unparseable are dropped.
 */

/** Largest envelope accepted from a browser. */
export const MAX_ENVELOPE_BYTES = 64 * 1024;
/** Most events forwarded from one envelope. */
const MAX_EVENTS = 5;

export interface ForwardTarget {
  readonly url: string;
  readonly auth: string;
  readonly dsn: string;
}

/** Where to send envelopes for a DSN (`https://<key>@<host>[/<prefix>]/<project>`); null if invalid. */
export function forwardTargetFor(dsn: string): ForwardTarget | null {
  try {
    const parsed = new URL(dsn);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const project = segments.pop();
    if (!parsed.username || !project || !/^\d{1,20}$/.test(project)) return null;
    const prefix = segments.length > 0 ? `/${segments.join('/')}` : '';
    return {
      url: `${parsed.protocol}//${parsed.host}${prefix}/api/${project}/envelope/`,
      auth: `Sentry sentry_version=7, sentry_key=${parsed.username}, sentry_client=jadarat-tunnel/1`,
      dsn,
    };
  } catch {
    return null;
  }
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Error events in a Sentry envelope (other item types skipped); null when the envelope is malformed. */
export function readEnvelopeEvents(body: Buffer): ErrorEvent[] | null {
  if (body.length === 0 || body.length > MAX_ENVELOPE_BYTES) return null;
  let position = body.indexOf(0x0a);
  if (position === -1 || !isRecord(parseJson(body.subarray(0, position)))) return null;
  const events: ErrorEvent[] = [];
  position += 1;
  while (position < body.length && events.length < MAX_EVENTS) {
    const headerEnd = body.indexOf(0x0a, position);
    if (headerEnd === -1) break;
    const header = parseJson(body.subarray(position, headerEnd));
    if (!isRecord(header) || typeof header.type !== 'string') return null;
    let payloadEnd: number;
    if (header.length !== undefined) {
      if (
        typeof header.length !== 'number' ||
        !Number.isInteger(header.length) ||
        header.length < 0
      ) {
        return null;
      }
      payloadEnd = headerEnd + 1 + header.length;
      if (payloadEnd > body.length) return null;
    } else {
      const newline = body.indexOf(0x0a, headerEnd + 1);
      payloadEnd = newline === -1 ? body.length : newline;
    }
    if (header.type === 'event') {
      const payload = parseJson(body.subarray(headerEnd + 1, payloadEnd));
      // An error event has no `type`; one claiming another type (e.g. transaction) is normalised.
      if (isRecord(payload) && isRecord(payload.exception)) {
        events.push({ ...payload, type: undefined });
      }
    }
    position = payloadEnd + 1;
  }
  return events;
}

/**
 * The envelope we forward: scrubbed events, stamped with the server's own environment and release and
 * a `source: browser` tag; the browser's own DSN, release and environment are ignored.
 */
export function buildForwardEnvelope(
  events: readonly ErrorEvent[],
  target: ForwardTarget,
  stamp: { readonly environment: string; readonly release?: string },
  now: Date = new Date(),
): string {
  const lines = [JSON.stringify({ dsn: target.dsn, sent_at: now.toISOString() })];
  for (const event of events) {
    const scrubbed = scrubErrorEvent({
      ...event,
      environment: stamp.environment,
      tags: { ...event.tags, source: 'browser' },
    });
    delete scrubbed.release;
    if (stamp.release) scrubbed.release = stamp.release;
    lines.push(JSON.stringify({ type: 'event' }), JSON.stringify(scrubbed));
  }
  return `${lines.join('\n')}\n`;
}

/** A small fixed-window limiter: at most `limit` accepted calls per `windowMs` (per instance). */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  let windowStart = now();
  let used = 0;
  return (): boolean => {
    const time = now();
    if (time - windowStart >= windowMs) {
      windowStart = time;
      used = 0;
    }
    if (used >= limit) return false;
    used += 1;
    return true;
  };
}
