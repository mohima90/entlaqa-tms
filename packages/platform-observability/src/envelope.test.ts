import { describe, expect, it } from 'vitest';
import {
  MAX_ENVELOPE_BYTES,
  buildForwardEnvelope,
  createKeyedRateLimiter,
  createRateLimiter,
  forwardTargetFor,
  readEnvelopeEvents,
  sanitizeBrowserEvent,
} from './envelope';

const DSN = 'https://0123abcd@o1.ingest.de.sentry.io/4512197765103696';

function envelope(...parts: string[]): Buffer {
  return Buffer.from(parts.join('\n'));
}

const browserEvent = {
  type: undefined,
  event_id: 'abc',
  exception: { values: [{ type: 'TypeError', value: 'x is undefined for a@b.co' }] },
  request: { url: 'https://app/ar/suite?email=a@b.co', headers: { 'User-Agent': 'UA' } },
  user: { ip_address: '1.2.3.4' },
  release: 'browser-claimed',
  environment: 'browser-claimed',
  tags: { page: 'suite' },
};

describe('forwardTargetFor', () => {
  it('derives the envelope URL and auth header from a DSN', () => {
    expect(forwardTargetFor(DSN)).toEqual({
      url: 'https://o1.ingest.de.sentry.io/api/4512197765103696/envelope/',
      auth: 'Sentry sentry_version=7, sentry_key=0123abcd, sentry_client=jadarat-tunnel/1',
      dsn: DSN,
    });
    expect(forwardTargetFor('http://key@glitchtip:8000/errors/3')?.url).toBe(
      'http://glitchtip:8000/errors/api/3/envelope/',
    );
  });

  it.each(['not a url', 'https://host/1', 'https://key@host/', 'https://key@host/abc'])(
    'rejects %s',
    (dsn) => {
      expect(forwardTargetFor(dsn)).toBeNull();
    },
  );
});

describe('readEnvelopeEvents', () => {
  it('keeps error events and skips other item types', () => {
    const body = envelope(
      JSON.stringify({ event_id: 'abc', dsn: 'https://browser@x.invalid/1' }),
      JSON.stringify({ type: 'session' }),
      JSON.stringify({ sid: 's' }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(browserEvent),
      JSON.stringify({ type: 'attachment', length: 3 }),
      'abc',
      JSON.stringify({ type: 'event' }),
      JSON.stringify({ message: 'no exception' }),
    );
    expect(readEnvelopeEvents(body)).toEqual([
      {
        type: undefined,
        platform: 'javascript',
        request: { url: 'https://app/ar/suite?email=a@b.co' },
        exception: { values: [{ type: 'TypeError', value: 'x is undefined for a@b.co' }] },
        sdk: { name: 'unknown', version: 'unknown', settings: { infer_ip: 'never' } },
      },
    ]);
  });

  it('honours explicit item lengths (bytes, not characters)', () => {
    const payload = JSON.stringify({ exception: { values: [{ type: 'Error', value: 'عربي' }] } });
    const body = envelope(
      '{}',
      JSON.stringify({ type: 'event', length: Buffer.byteLength(payload) }),
      payload,
    );
    expect(readEnvelopeEvents(body)).toHaveLength(1);
  });

  it('rejects malformed or oversized envelopes', () => {
    expect(readEnvelopeEvents(Buffer.alloc(0))).toBeNull();
    expect(readEnvelopeEvents(Buffer.alloc(MAX_ENVELOPE_BYTES + 1, 0x7b))).toBeNull();
    expect(readEnvelopeEvents(envelope('not json', '{}'))).toBeNull();
    expect(readEnvelopeEvents(Buffer.from('{}'))).toBeNull();
    expect(readEnvelopeEvents(envelope('{}', '{"no":"type"}', '{}'))).toBeNull();
    expect(readEnvelopeEvents(envelope('{}', '{"type":"event","length":-1}', '{}'))).toBeNull();
    expect(readEnvelopeEvents(envelope('{}', '{"type":"event","length":999}', '{}'))).toBeNull();
    expect(readEnvelopeEvents(envelope('{}', '{"type":"event"}', 'not json'))).toEqual([]);
  });

  it('forwards one event per envelope (as the SDK sends)', () => {
    const items = Array.from({ length: 8 }, () => [
      JSON.stringify({ type: 'event' }),
      JSON.stringify(browserEvent),
    ]).flat();
    expect(readEnvelopeEvents(envelope('{}', ...items))).toHaveLength(1);
  });
});

describe('sanitizeBrowserEvent', () => {
  it('keeps only allow-listed fields of a forged event (no client tags)', () => {
    const forged = {
      event_id: '0123456789abcdef0123456789abcdef',
      timestamp: 1791114922.3,
      level: 'error',
      platform: 'node',
      exception: {
        values: [
          {
            type: 'Error',
            value: 'v',
            mechanism: { type: 'onerror', handled: false, data: { secret: 'x' } },
            stacktrace: {
              frames: [
                {
                  filename: 'https://app/ar/learners?name=Ahmed',
                  abs_path: 'https://app/x#frag',
                  function: 'f',
                  module: 'm',
                  lineno: 1,
                  colno: 2,
                  in_app: true,
                  vars: { password: 'x' },
                  data: { secret: 'x' },
                  pre_context: ['x'],
                },
                'not a frame',
              ],
            },
          },
          null,
        ],
      },
      request: { url: 'https://app/ar', headers: { cookie: 'sb=x' } },
      user: { email: 'a@b.co' },
      contexts: { browser: { name: 'x' } },
      extra: { a: 1 },
      debug_meta: { images: [{ code_file: 'https://app/?token=x' }] },
      sdkProcessingMetadata: { cookies: 'x' },
      fingerprint: ['a@b.co'],
      sdk: { name: 'sentry.javascript.browser', version: '11.4.0', settings: { infer_ip: 'auto' } },
      tags: { ok: 'v', n: 1, b: true, nested: { x: 1 }, 'bad key!': 'x' },
      __proto__: { polluted: true },
      level_extra: 'x',
    };
    const event = sanitizeBrowserEvent(forged);
    expect(event).toEqual({
      type: undefined,
      platform: 'javascript',
      event_id: '0123456789abcdef0123456789abcdef',
      timestamp: 1791114922.3,
      level: 'error',
      request: { url: 'https://app/ar' },
      exception: {
        values: [
          {
            type: 'Error',
            value: 'v',
            mechanism: { type: 'onerror', handled: false },
            stacktrace: {
              frames: [
                {
                  filename: 'https://app/ar/learners?name=Ahmed',
                  abs_path: 'https://app/x#frag',
                  function: 'f',
                  module: 'm',
                  lineno: 1,
                  colno: 2,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
      sdk: {
        name: 'sentry.javascript.browser',
        version: '11.4.0',
        settings: { infer_ip: 'never' },
      },
    });
  });

  it('rejects events without a usable exception and normalises odd values', () => {
    expect(sanitizeBrowserEvent({ message: 'x' })).toBeNull();
    expect(sanitizeBrowserEvent({ exception: { values: 'x' } })).toBeNull();
    expect(sanitizeBrowserEvent({ exception: { values: [null, 3] } })).toBeNull();
    expect(
      sanitizeBrowserEvent({
        event_id: 'not-hex',
        level: 'debug',
        timestamp: 'x',
        request: { url: 5 },
        exception: { values: [{ mechanism: {}, stacktrace: { frames: 'x' } }] },
      }),
    ).toEqual({
      type: undefined,
      platform: 'javascript',
      exception: { values: [{ mechanism: { type: 'generic' } }] },
      sdk: { name: 'unknown', version: 'unknown', settings: { infer_ip: 'never' } },
    });
  });
});

describe('buildForwardEnvelope', () => {
  it('scrubs each event and stamps the server environment and release', () => {
    const target = forwardTargetFor(DSN);
    if (!target) throw new Error('target');
    const text = buildForwardEnvelope(
      [browserEvent],
      target,
      { environment: 'staging', release: 'abc123' },
      new Date('2026-10-04T10:00:00Z'),
    );
    const [header, itemHeader, payload] = text.trimEnd().split('\n');
    expect(JSON.parse(header ?? '')).toEqual({ dsn: DSN, sent_at: '2026-10-04T10:00:00.000Z' });
    expect(JSON.parse(itemHeader ?? '')).toEqual({ type: 'event' });
    const event = JSON.parse(payload ?? '') as Record<string, unknown>;
    expect(event).toMatchObject({
      environment: 'staging',
      release: 'abc123',
      tags: { source: 'browser' },
      request: { url: 'https://app/ar/suite' },
      exception: { values: [{ type: 'TypeError', value: '[redacted]' }] },
    });
    expect(event).not.toHaveProperty('user');
    expect(text).not.toMatch(/a@b\.co|1\.2\.3\.4|browser-claimed|User-Agent/);
  });

  it('drops the browser-claimed release when the server has none', () => {
    const target = forwardTargetFor(DSN);
    if (!target) throw new Error('target');
    const text = buildForwardEnvelope([browserEvent], target, { environment: 'x' });
    expect(text).not.toContain('release');
  });
});

describe('createKeyedRateLimiter', () => {
  it('limits each key separately and caps the number of keys per window', () => {
    let time = 0;
    const allow = createKeyedRateLimiter(2, 1000, 2, () => time);
    expect([allow('a'), allow('a'), allow('a'), allow('b')]).toEqual([true, true, false, true]);
    expect(allow('c')).toBe(false);
    time = 1000;
    expect([allow('a'), allow('c')]).toEqual([true, true]);
  });
});

describe('createRateLimiter', () => {
  it('accepts up to the limit per window', () => {
    let time = 0;
    const allow = createRateLimiter(2, 1000, () => time);
    expect([allow(), allow(), allow()]).toEqual([true, true, false]);
    time = 1000;
    expect(allow()).toBe(true);
  });
});
