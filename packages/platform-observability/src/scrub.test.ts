import type { ErrorEvent } from '@sentry/core';
import { describe, expect, it } from 'vitest';
import { scrubErrorEvent, scrubText, scrubUrl, scrubValue } from './scrub';

describe('scrubText', () => {
  it.each([
    ['contact sara.ali+hr@example.com.sa now', 'contact [email] now'],
    ['token eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl end', 'token [token] end'],
    ['Authorization: Bearer abcDEF123456789xyz', 'Authorization: Bearer [token]'],
    ['key sb_secret_AbCdEf123', 'key sb_secret_[token]'],
    ['postgres://app_server:S3cret!@db:5432/postgres', 'postgres://[credentials]@db:5432/postgres'],
    ['Saudi ID 1023456789 and Iqama 2123456789', 'Saudi ID [national-id] and Iqama [national-id]'],
    ['Emirates ID 784-1990-1234567-1', 'Emirates ID [national-id]'],
    ['Egypt ID 29001011234567', 'Egypt ID [national-id]'],
    ['call +966 50 123 4567 or 00971501234567', 'call [phone] or [phone]'],
    ['mobile 0501234567 / 01012345678', 'mobile [phone] / [phone]'],
    ['from 192.168.10.20', 'from [ip]'],
    ['from 2001:db8:85a3:0:0:8a2e:370:7334', 'from [ip]'],
    ['from 2001:db8::1 and ::1', 'from [ip] and [ip]'],
  ])('%s', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it('keeps UUIDs, times, codes and ordinary numbers', () => {
    const text =
      'tenant 550e8400-e29b-41d4-a716-446655440000 abcd1234-0012-3456-7890-123456789012 at 11:30:45 ' +
      'status 503 took 1200 ms code AUTH_INVALID_CREDENTIALS route /[locale]/suite';
    expect(scrubText(text)).toBe(text);
  });
});

describe('scrubUrl', () => {
  it('drops query string and fragment, scrubs the path', () => {
    expect(scrubUrl('https://app.example/ar/x/a@b.co?email=a@b.co#frag')).toBe(
      'https://app.example/ar/x/[email]',
    );
  });
});

describe('scrubValue', () => {
  it('scrubs strings at any depth and keeps other values', () => {
    expect(scrubValue({ a: ['x@y.com', 1, null], b: { c: true, d: '0501234567' } })).toEqual({
      a: ['[email]', 1, null],
      b: { c: true, d: '[phone]' },
    });
  });
});

describe('scrubErrorEvent', () => {
  it('removes everything that can carry personal data and scrubs the rest', () => {
    const event: ErrorEvent = {
      type: undefined,
      message: 'failed for a@b.co',
      user: { id: '1', email: 'a@b.co', ip_address: '1.2.3.4' },
      server_name: 'host-1',
      breadcrumbs: [{ message: 'a@b.co' }],
      extra: { body: { password: 'x' } },
      request: {
        method: 'POST',
        url: 'https://app/ar/sign-in?next=/x',
        headers: { cookie: 'sb=secret', authorization: 'Bearer abcdefghijkl' },
        cookies: { sb: 'secret' },
        data: { email: 'a@b.co', password: 'x' },
        query_string: 'email=a@b.co',
      },
      exception: {
        values: [
          {
            type: 'PostgresError',
            value: 'duplicate key for a@b.co',
            stacktrace: { frames: [{ filename: 'a.ts', lineno: 1, vars: { password: 'x' } }] },
          },
        ],
      },
      tags: { correlation_id: '550e8400-e29b-41d4-a716-446655440000', who: 'a@b.co' },
      contexts: { nextjs: { request_path: '/ar/u/a@b.co' } },
      transaction: 'POST /ar/sign-in?x=a@b.co',
    };
    const scrubbed = scrubErrorEvent(event);
    expect(scrubbed).not.toHaveProperty('user');
    expect(scrubbed).not.toHaveProperty('server_name');
    expect(scrubbed).not.toHaveProperty('breadcrumbs');
    expect(scrubbed).not.toHaveProperty('extra');
    expect(scrubbed.request).toEqual({ method: 'POST', url: 'https://app/ar/sign-in' });
    expect(scrubbed.message).toBe('failed for [email]');
    expect(scrubbed.exception?.values?.[0]?.value).toBe('duplicate key for [email]');
    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      filename: 'a.ts',
      lineno: 1,
    });
    expect(scrubbed.tags).toEqual({
      correlation_id: '550e8400-e29b-41d4-a716-446655440000',
      who: '[email]',
    });
    expect(scrubbed.contexts).toEqual({ nextjs: { request_path: '/ar/u/[email]' } });
    expect(scrubbed.transaction).toBe('POST /ar/sign-in');
    expect(JSON.stringify(scrubbed)).not.toMatch(/a@b\.co|secret|password/);
  });

  it('leaves a minimal event valid', () => {
    expect(scrubErrorEvent({ type: undefined })).toEqual({ type: undefined });
  });
});
