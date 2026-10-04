import type { ErrorEvent } from '@sentry/core';
import { describe, expect, it } from 'vitest';
import { MAX_TEXT, scrubErrorEvent, scrubText, scrubUrl, scrubValue } from './scrub';

describe('scrubText', () => {
  it.each([
    ['contact sara.ali+hr@example.com.sa now', 'contact [email] now'],
    ['token eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl end', 'token [token] end'],
    ['Authorization: Bearer abcDEF123456789xyz', 'Authorization: Bearer [token]'],
    ['key sb_secret_AbCdEf123', 'key sb_secret_[token]'],
    ['postgres://app_server:S3cret!@db:5432/postgres', 'postgres://[credentials]@db:5432/postgres'],
    ['postgres://app:p!ss.word@db.example.com/x', 'postgres://[credentials]@db.example.com/x'],
    ['postgres://app:p@ss@db/x', 'postgres://[credentials]@db/x'],
    ['mail محمد@شركة.السعودية now', 'mail [email] now'],
    ['ksa 966501234567 uae 971501234567 eg 201012345678', 'ksa [phone] uae [phone] eg [phone]'],
    ['050 123 4567 or 050-123-4567 or 010 1234 5678', '[phone] or [phone] or [phone]'],
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

  it('keeps UUIDs, times, codes, versions, scope operators and ordinary numbers', () => {
    const text =
      'tenant 550e8400-e29b-41d4-a716-446655440000 abcd1234-0012-3456-7890-123456789012 at 11:30:45 ' +
      'status 503 took 1200 ms code AUTH_INVALID_CREDENTIALS route /[locale]/suite pkg@1.2.3 Foo::bar';
    expect(scrubText(text)).toBe(text);
  });

  it('truncates very long input and stays fast on adversarial strings', () => {
    for (const input of [
      'a'.repeat(100_000),
      `a@${'b-'.repeat(50_000)}`,
      `x://${'a'.repeat(100_000)}`,
      `eyJ${'a'.repeat(100_000)}`,
      '1'.repeat(100_000),
    ]) {
      const started = performance.now();
      const output = scrubText(input);
      expect(performance.now() - started).toBeLessThan(100);
      expect(output.length).toBeLessThanOrEqual(MAX_TEXT + 20);
      expect(output.endsWith('…[truncated]')).toBe(true);
    }
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

  it('replaces objects nested too deeply instead of passing them through', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { email: 'x@y.com' } } } } } } } };
    expect(JSON.stringify(scrubValue(deep))).not.toContain('x@y.com');
    expect(JSON.stringify(scrubValue(deep))).toContain('[depth]');
  });
});

describe('scrubErrorEvent', () => {
  it('removes everything that can carry personal data, redacts messages and scrubs the rest', () => {
    const event: ErrorEvent = {
      type: undefined,
      message: 'failed for a@b.co',
      user: { id: '1', email: 'a@b.co', ip_address: '1.2.3.4' },
      server_name: 'host-1',
      breadcrumbs: [{ message: 'a@b.co' }],
      threads: { values: [{ id: 1, name: 'a@b.co' }] },
      fingerprint: ['{{ default }}', 'a@b.co'],
      logentry: { message: 'hello %s', params: ['a@b.co'] },
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
            value: 'Failed query: insert\nparams: Sara,secret',
            stacktrace: {
              frames: [
                {
                  filename: 'a.ts',
                  lineno: 1,
                  vars: { password: 'x' },
                  pre_context: ['const password = 1'],
                  context_line: 'throw x',
                  post_context: ['}'],
                },
              ],
            },
          },
          { type: 'AuthServiceError', value: 'Supabase Auth request failed (status 0) a@b.co' },
          { type: 'Error' },
        ],
      },
      tags: { correlation_id: '550e8400-e29b-41d4-a716-446655440000', who: 'a@b.co' },
      contexts: {
        nextjs: {
          request_path: '/ar/u/a@b.co?code=550e8400-e29b-41d4-a716-446655440000',
          kind: 'x',
        },
        response: { url: 'https://app/x?token=abc#f' },
        runtime: 'node' as never,
      },
      transaction: 'POST /ar/sign-in?x=a@b.co',
    };
    const scrubbed = scrubErrorEvent(event);
    expect(scrubbed).not.toHaveProperty('user');
    expect(scrubbed).not.toHaveProperty('server_name');
    expect(scrubbed).not.toHaveProperty('breadcrumbs');
    expect(scrubbed).not.toHaveProperty('extra');
    expect(scrubbed).not.toHaveProperty('threads');
    expect(scrubbed.logentry).toEqual({ message: '[redacted]' });
    expect(scrubbed.fingerprint).toEqual(['{{ default }}', '[email]']);
    expect(scrubbed.request).toEqual({ method: 'POST', url: 'https://app/ar/sign-in' });
    expect(scrubbed.message).toBe('[redacted]');
    expect(scrubbed.exception?.values?.[0]?.value).toBe('[redacted]');
    expect(scrubbed.exception?.values?.[1]?.value).toBe(
      'Supabase Auth request failed (status 0) [email]',
    );
    expect(scrubbed.exception?.values?.[2]).toEqual({ type: 'Error' });
    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      filename: 'a.ts',
      lineno: 1,
    });
    expect(scrubbed.tags).toEqual({
      correlation_id: '550e8400-e29b-41d4-a716-446655440000',
      who: '[email]',
    });
    expect(scrubbed.contexts).toEqual({
      nextjs: { request_path: '/ar/u/[email]', kind: 'x' },
      response: { url: 'https://app/x' },
      runtime: 'node',
    });
    expect(scrubbed.transaction).toBe('POST /ar/sign-in');
    expect(JSON.stringify(scrubbed)).not.toMatch(/a@b\.co|secret|password|Sara|code=|token=/);
  });

  it('leaves a minimal event valid', () => {
    expect(scrubErrorEvent({ type: undefined })).toEqual({ type: undefined });
  });
});
