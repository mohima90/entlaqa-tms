import { describe, expect, it } from 'vitest';
import {
  MAX_ENVELOPE_BYTES,
  buildForwardEnvelope,
  createRateLimiter,
  forwardTargetFor,
  readEnvelopeEvents,
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
    expect(readEnvelopeEvents(body)).toEqual([browserEvent]);
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

  it('forwards at most five events per envelope', () => {
    const items = Array.from({ length: 8 }, () => [
      JSON.stringify({ type: 'event' }),
      JSON.stringify(browserEvent),
    ]).flat();
    expect(readEnvelopeEvents(envelope('{}', ...items))).toHaveLength(5);
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
      tags: { page: 'suite', source: 'browser' },
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

describe('createRateLimiter', () => {
  it('accepts up to the limit per window', () => {
    let time = 0;
    const allow = createRateLimiter(2, 1000, () => time);
    expect([allow(), allow(), allow()]).toEqual([true, true, false]);
    time = 1000;
    expect(allow()).toBe(true);
  });
});
