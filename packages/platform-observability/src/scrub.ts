import type { ErrorEvent } from '@sentry/core';

/**
 * Personal-data patterns removed from every log line and error report (ADR 0009 §2: no names, e-mails,
 * phone numbers, national IDs, IP addresses, tokens). A backstop: the typed logger and the error
 * reporter never receive free-form objects in the first place. UUIDs are allowed and survive.
 */
const PATTERNS: readonly (readonly [RegExp, string])[] = [
  // Tokens first, so their parts are not mistaken for other identifiers.
  [/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g, '[token]'],
  [/\b(bearer|basic)\s+[\w.~+/=-]{8,}/gi, '$1 [token]'],
  [/\b(sb_(?:secret|publishable)_)[\w-]+/g, '$1[token]'],
  [/[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  // Credentials inside connection strings / URLs: scheme://user:password@host
  [/\b([a-z][\w+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[credentials]@'],
  // Emirates ID (784-YYYY-NNNNNNN-N, with or without dashes)
  [/\b784-?\d{4}-?\d{7}-?\d\b/g, '[national-id]'],
  // Egyptian national ID (14 digits, century digit 2 or 3)
  [/\b[23]\d{13}\b/g, '[national-id]'],
  // Saudi national ID / Iqama (10 digits starting with 1 or 2)
  [/\b[12]\d{9}\b/g, '[national-id]'],
  // International phone numbers (+ or 00 prefix) and local KSA / UAE / Egypt mobile formats
  [/(?:\+|\b00)\d[\d\s-]{7,15}\d\b/g, '[phone]'],
  [/\b05\d{8}\b/g, '[phone]'],
  [/\b01[0125]\d{8}\b/g, '[phone]'],
  // IPv4 and IPv6 (full or compressed; a plain "11:30:45" time is not an address)
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
  [/\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi, '[ip]'],
  [
    /(?:\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6}\b)?/gi,
    '[ip]',
  ],
];

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Private-use characters: never produced by the patterns, so placeholders cannot collide with them.
const PLACEHOLDER = /\uE000(\d+)\uE001/g;

/** Replaces personal data and secrets in free text with placeholders. UUIDs are kept intact. */
export function scrubText(text: string): string {
  // Set UUIDs aside first: their digit groups must not be mistaken for phone or ID numbers.
  const uuids: string[] = [];
  let result = text.replace(UUID, (uuid) => `\uE000${String(uuids.push(uuid) - 1)}\uE001`);
  for (const [pattern, replacement] of PATTERNS) result = result.replace(pattern, replacement);
  return result.replace(PLACEHOLDER, (_match, index: string) => uuids[Number(index)] ?? '');
}

/** Deep copy of a JSON-like value with every string scrubbed (depth-limited). */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = scrubValue(item, depth + 1);
  return result;
}

/** A URL without its query string and fragment, path scrubbed (query strings may carry anything). */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  return scrubText(cut === -1 ? url : url.slice(0, cut));
}

/**
 * `beforeSend` for the Sentry SDK (Sentry SaaS EU and self-hosted GlitchTip): keeps what is needed
 * to diagnose an error — exception type and stack, route, release, tags such as the correlation id —
 * and drops everything that can carry personal data: user, request headers/cookies/body/query,
 * breadcrumbs, extra data, local variables and the server name. Remaining strings are scrubbed.
 */
export function scrubErrorEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event };
  delete scrubbed.user;
  delete scrubbed.breadcrumbs;
  delete scrubbed.extra;
  delete scrubbed.server_name;

  if (event.request) {
    scrubbed.request = {
      ...(event.request.method ? { method: event.request.method } : {}),
      ...(event.request.url ? { url: scrubUrl(event.request.url) } : {}),
    };
  }
  if (event.message !== undefined) scrubbed.message = scrubText(event.message);
  if (event.logentry) {
    scrubbed.logentry = {
      ...(event.logentry.message !== undefined
        ? { message: scrubText(event.logentry.message) }
        : {}),
    };
  }
  if (event.exception?.values) {
    scrubbed.exception = {
      ...event.exception,
      values: event.exception.values.map((exception) => ({
        ...exception,
        ...(exception.value !== undefined ? { value: scrubText(exception.value) } : {}),
        ...(exception.stacktrace?.frames
          ? {
              stacktrace: {
                ...exception.stacktrace,
                frames: exception.stacktrace.frames.map((frame) => {
                  const { vars: _vars, ...rest } = frame;
                  return rest;
                }),
              },
            }
          : {}),
      })),
    };
  }
  if (event.tags) scrubbed.tags = scrubValue(event.tags) as NonNullable<ErrorEvent['tags']>;
  if (event.contexts) {
    scrubbed.contexts = scrubValue(event.contexts) as NonNullable<ErrorEvent['contexts']>;
  }
  if (event.transaction !== undefined) scrubbed.transaction = scrubUrl(event.transaction);
  return scrubbed;
}
