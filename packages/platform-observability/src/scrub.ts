import type { ErrorEvent } from '@sentry/core';

/**
 * Personal-data patterns removed from every log line and error report (ADR 0009 §2: no names, e-mails,
 * phone numbers, national IDs, IP addresses, tokens). A backstop: the typed logger and the error
 * reporter never receive free-form objects or error messages in the first place. UUIDs survive.
 * Every quantifier is bounded and input is truncated first (MAX_TEXT), so attacker-controlled strings
 * cannot make scrubbing slow.
 */
const PATTERNS: readonly (readonly [RegExp, string])[] = [
  // Credentials in connection strings / URLs (scheme://user[:password]@host) — up to the LAST "@" of
  // the authority, before the e-mail pattern can take part of a password.
  [/\b([a-z][\w+.-]{0,31}:\/\/)[^\s/?#]{1,512}@/gi, '$1[credentials]@'],
  // Tokens, so their parts are not mistaken for other identifiers.
  [/\beyJ[\w-]{4,4096}\.[\w-]{4,4096}\.[\w-]{0,4096}/g, '[token]'],
  // …and a token fragment (e.g. cut by truncation).
  [/\beyJ[\w-]{8,4096}/g, '[token]'],
  [/\b(bearer|basic)\s{1,8}[\w.~+/=-]{8,4096}/gi, '$1 [token]'],
  [/\b(sb_(?:secret|publishable)_)[\w-]{1,256}/g, '$1[token]'],
  // E-mail addresses, including Arabic / internationalized ones (the last label has letters only, so
  // `pkg@1.2.3` is not one).
  [
    /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,7}\.\p{L}{2,63}/gu,
    '[email]',
  ],
  // Emirates ID (784-YYYY-NNNNNNN-N, with dashes, spaces or nothing between the groups)
  [/\b784[\s-]?\d{4}[\s-]?\d{7}[\s-]?\d\b/g, '[national-id]'],
  // Egyptian national ID (14 digits, century digit 2 or 3)
  [/\b[23]\d{13}\b/g, '[national-id]'],
  // Saudi national ID / Iqama (10 digits starting with 1 or 2). Also hides 10-digit epoch seconds.
  [/\b[12]\d{9}\b/g, '[national-id]'],
  // Phone numbers: international (+ / 00 prefix, or KSA/UAE/Egypt country code without it) and local
  // KSA/UAE (05x…) and Egypt (01x…) mobiles, with or without spaces/dashes.
  [/(?:\+|\b00)\d[\d\s-]{7,15}\d\b/g, '[phone]'],
  [/\b(?:9665\d{8}|9715\d{8}|201[0125]\d{8})\b/g, '[phone]'],
  [/\b05\d[\s-]?\d{3}[\s-]?\d{4}\b/g, '[phone]'],
  [/\b01[0125][\s-]?\d{4}[\s-]?\d{4}\b/g, '[phone]'],
  // IPv4 and IPv6 (full or compressed with at least one hex group; "11:30:45" and "Foo::bar" are not
  // addresses, but a hex-only "A::b" is)
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
  [/\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi, '[ip]'],
  [
    /(?:\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6}::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6}\b)?|(?<![\w:])::[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6}\b)/gi,
    '[ip]',
  ],
];

/** Longest string kept in a log line or error report; the rest is cut before scrubbing. */
export const MAX_TEXT = 2_000;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Private-use characters: never produced by the patterns, so placeholders cannot collide with them.
const PLACEHOLDER = /\uE000(\d+)\uE001/g;

/** Replaces personal data and secrets in free text with placeholders. UUIDs are kept intact. */
export function scrubText(text: string): string {
  const bounded = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…[truncated]` : text;
  // Set UUIDs aside first: their digit groups must not be mistaken for phone or ID numbers.
  const uuids: string[] = [];
  let result = bounded.replace(UUID, (uuid) => `\uE000${String(uuids.push(uuid) - 1)}\uE001`);
  for (const [pattern, replacement] of PATTERNS) result = result.replace(pattern, replacement);
  return result.replace(PLACEHOLDER, (_match, index: string) => uuids[Number(index)] ?? '');
}

/** Deep copy of a JSON-like value with every string scrubbed (depth-limited). */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return '[depth]';
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
 * Error classes whose messages are built only from constants (no input values), so they may be sent.
 * Every other exception message is replaced: messages routinely embed input — a failed query with its
 * parameters, a rejected value — which no pattern can reliably recognise (names, free text).
 */
export const SAFE_MESSAGE_ERRORS: ReadonlySet<string> = new Set(['AuthServiceError']);
export const REDACTED = '[redacted]';

/** Context keys holding a URL or path: their query string and fragment are removed. */
const URL_KEYS = /(?:^|_)(?:url|path|href|referr?er)$/i;

function scrubContexts(
  contexts: NonNullable<ErrorEvent['contexts']>,
): NonNullable<ErrorEvent['contexts']> {
  const result: Record<string, unknown> = {};
  for (const [name, context] of Object.entries(contexts) as [string, unknown][]) {
    if (context === null || typeof context !== 'object' || Array.isArray(context)) {
      result[name] = scrubValue(context);
      continue;
    }
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      fields[key] =
        typeof value === 'string' && URL_KEYS.test(key) ? scrubUrl(value) : scrubValue(value, 1);
    }
    result[name] = fields;
  }
  return result as NonNullable<ErrorEvent['contexts']>;
}

type ExceptionValue = NonNullable<NonNullable<ErrorEvent['exception']>['values']>[number];

function scrubException(exception: ExceptionValue): ExceptionValue {
  const { stacktrace, value, type, mechanism, ...rest } = exception;
  const scrubbed: ExceptionValue = { ...rest };
  // Mechanism kind only; its free-form `data` is dropped.
  if (mechanism) {
    scrubbed.mechanism = {
      type: mechanism.type,
      ...(mechanism.handled === undefined ? {} : { handled: mechanism.handled }),
    };
  }
  if (type !== undefined) scrubbed.type = scrubText(type);
  if (value !== undefined) {
    scrubbed.value =
      type !== undefined && SAFE_MESSAGE_ERRORS.has(type) ? scrubText(value) : REDACTED;
  }
  if (stacktrace) {
    scrubbed.stacktrace = {
      ...stacktrace,
      // Location only: no local variables, no source lines.
      ...(stacktrace.frames
        ? {
            frames: stacktrace.frames.map((frame) => {
              const {
                vars: _vars,
                pre_context: _pre,
                context_line: _line,
                post_context: _post,
                ...location
              } = frame;
              // A multi-line message can be parsed into fake frames: scrub the text fields too.
              for (const key of ['function', 'filename', 'abs_path', 'module'] as const) {
                const text = location[key];
                if (text !== undefined) location[key] = scrubText(text);
              }
              return location;
            }),
          }
        : {}),
    };
  }
  return scrubbed;
}

/**
 * `beforeSend` for the Sentry SDK (Sentry SaaS EU and self-hosted GlitchTip): keeps what is needed
 * to diagnose an error — exception type, stack locations, route, release, tags such as the correlation
 * id and error code — and drops everything that can carry personal data: user, request headers,
 * cookies, body and query string, exception messages (unless allow-listed), breadcrumbs, extra data,
 * threads, local variables, source lines and the server name. Remaining strings are scrubbed.
 */
export function scrubErrorEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event };
  delete scrubbed.user;
  delete scrubbed.breadcrumbs;
  delete scrubbed.extra;
  delete scrubbed.server_name;
  delete scrubbed.threads;

  if (event.request) {
    scrubbed.request = {
      ...(event.request.method ? { method: event.request.method } : {}),
      ...(event.request.url ? { url: scrubUrl(event.request.url) } : {}),
    };
  }
  if (event.message !== undefined) scrubbed.message = REDACTED;
  if (event.logentry) scrubbed.logentry = { message: REDACTED };
  if (event.exception?.values) {
    scrubbed.exception = { ...event.exception, values: event.exception.values.map(scrubException) };
  }
  if (event.tags) scrubbed.tags = scrubValue(event.tags) as NonNullable<ErrorEvent['tags']>;
  if (event.contexts) scrubbed.contexts = scrubContexts(event.contexts);
  if (event.fingerprint) scrubbed.fingerprint = event.fingerprint.map((part) => scrubText(part));
  if (event.transaction !== undefined) scrubbed.transaction = scrubUrl(event.transaction);
  return scrubbed;
}
