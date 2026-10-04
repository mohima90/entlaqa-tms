import type { ErrorEvent } from '@sentry/core';
import { scrubErrorEvent } from './scrub';

/**
 * Browser error reports reach the error tracker only through our own server (a "tunnel", ADR 0009 §4):
 * the browser never learns the DSN, the destination is chosen at runtime (Sentry EU or in-country
 * GlitchTip), and every event is scrubbed again on the server — the browser is not trusted to have
 * done it. Only error events pass; sessions, replays, transactions, attachments, client reports and
 * anything unparseable are dropped. Each event is REBUILT from an allow-list of fields
 * (`sanitizeBrowserEvent`) — a forged event cannot smuggle extra fields through.
 */

/** Largest envelope accepted from a browser. */
export const MAX_ENVELOPE_BYTES = 64 * 1024;
/** Most events forwarded from one envelope (the SDK sends one per envelope). */
const MAX_EVENTS = 1;
const MAX_EXCEPTIONS = 10;
const MAX_FRAMES = 100;
const MAX_TAGS = 50;
const LEVELS: ReadonlySet<string> = new Set(['fatal', 'error', 'warning']);

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

function text(value: unknown, max = 200): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Copies only the defined entries (exactOptionalPropertyTypes-friendly). */
function defined<T extends Record<string, unknown>>(object: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) if (value !== undefined) result[key] = value;
  return result as Partial<T>;
}

function sanitizeFrame(frame: Record<string, unknown>) {
  return defined({
    filename: text(frame.filename, 500),
    abs_path: text(frame.abs_path, 500),
    function: text(frame.function),
    module: text(frame.module),
    lineno: finite(frame.lineno),
    colno: finite(frame.colno),
    in_app: typeof frame.in_app === 'boolean' ? frame.in_app : undefined,
  });
}

function sanitizeException(exception: Record<string, unknown>) {
  const mechanism = isRecord(exception.mechanism) ? exception.mechanism : undefined;
  const stacktrace = isRecord(exception.stacktrace) ? exception.stacktrace : undefined;
  const frames = Array.isArray(stacktrace?.frames) ? stacktrace.frames : undefined;
  return defined({
    type: text(exception.type),
    value: text(exception.value, 2_000),
    mechanism: mechanism
      ? defined({
          type: text(mechanism.type) ?? 'generic',
          handled: typeof mechanism.handled === 'boolean' ? mechanism.handled : undefined,
        })
      : undefined,
    stacktrace: frames
      ? { frames: frames.slice(-MAX_FRAMES).filter(isRecord).map(sanitizeFrame) }
      : undefined,
  });
}

/**
 * Rebuilds a browser event from the fields we accept — exception types/values/frames (location only),
 * level, timestamp, page URL and a bounded set of scalar tags — and nothing else (no user, request
 * headers, contexts, extra, breadcrumbs, debug metadata, client fingerprint or SDK settings). Returns
 * null when there is no usable exception.
 */
export function sanitizeBrowserEvent(raw: Record<string, unknown>): ErrorEvent | null {
  const exception = isRecord(raw.exception) ? raw.exception : undefined;
  const values = Array.isArray(exception?.values)
    ? exception.values.slice(0, MAX_EXCEPTIONS).filter(isRecord).map(sanitizeException)
    : [];
  if (values.length === 0) return null;
  const tags: Record<string, string | number | boolean> = {};
  if (isRecord(raw.tags)) {
    for (const [key, value] of Object.entries(raw.tags).slice(0, MAX_TAGS)) {
      if (!/^[\w.-]{1,32}$/.test(key)) continue;
      if (typeof value === 'string') tags[key] = value.slice(0, 200);
      else if (typeof value === 'number' || typeof value === 'boolean') tags[key] = value;
    }
  }
  const request = isRecord(raw.request) ? text(raw.request.url, 2_000) : undefined;
  const sdk = isRecord(raw.sdk) ? raw.sdk : undefined;
  const level = text(raw.level);
  const eventId = text(raw.event_id);
  return {
    type: undefined,
    platform: 'javascript',
    ...defined({
      event_id: eventId !== undefined && /^[0-9a-f]{32}$/.test(eventId) ? eventId : undefined,
      timestamp: finite(raw.timestamp),
      level: level !== undefined && LEVELS.has(level) ? (level as ErrorEvent['level']) : undefined,
      request: request === undefined ? undefined : { url: request },
    }),
    exception: { values },
    tags,
    sdk: {
      name: text(sdk?.name, 100) ?? 'unknown',
      version: text(sdk?.version, 50) ?? 'unknown',
      settings: { infer_ip: 'never' },
    },
  } as ErrorEvent;
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
      const event = isRecord(payload) ? sanitizeBrowserEvent(payload) : null;
      if (event) events.push(event);
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

/**
 * Per-client fixed-window limiter: at most `limit` calls per key per window, tracking at most `maxKeys`
 * keys per window (new keys beyond that are refused). Keys stay in memory only and are never logged.
 */
export function createKeyedRateLimiter(
  limit: number,
  windowMs: number,
  maxKeys = 10_000,
  now: () => number = Date.now,
) {
  let windowStart = now();
  const used = new Map<string, number>();
  return (key: string): boolean => {
    const time = now();
    if (time - windowStart >= windowMs) {
      windowStart = time;
      used.clear();
    }
    const count = used.get(key);
    if (count === undefined && used.size >= maxKeys) return false;
    if ((count ?? 0) >= limit) return false;
    used.set(key, (count ?? 0) + 1);
    return true;
  };
}
