import { describe, expect, it, vi } from 'vitest';
import { RESEND_API_URL, createResendTransport, formatFrom } from './resend';
import { type EmailSendError } from './transport';

const DELIVERY_ID = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';
const email = {
  from: { name: 'ENTLAQA LMS', address: 'noreply@lms.entlaqa.com' },
  to: 'sara@example.com',
  subject: 'دعوة',
  html: '<p>x</p>',
  text: 'x',
  idempotencyKey: DELIVERY_ID,
};

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const respond = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(() => Promise.resolve(reply(status, body)));

const noWait = () => Promise.resolve();

const failure = async (fetchImpl: typeof fetch) =>
  createResendTransport({ apiKey: 're_test_key', fetch: fetchImpl, sleep: noWait })
    .send(email)
    .then(
      () => {
        throw new Error('expected a failure');
      },
      (e: unknown) => e as EmailSendError,
    );

describe('Resend transport', () => {
  it('posts the message with the delivery id as idempotency key', async () => {
    const fetchImpl = respond(200, { id: 'msg_123' });
    const transport = createResendTransport({ apiKey: 're_test_key', fetch: fetchImpl });
    expect(transport.provider).toBe('resend');
    expect(await transport.send(email)).toEqual({ providerMessageId: 'msg_123' });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(RESEND_API_URL);
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer re_test_key',
      'idempotency-key': email.idempotencyKey,
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      from: '"ENTLAQA LMS" <noreply@lms.entlaqa.com>',
      to: ['sara@example.com'],
      subject: 'دعوة',
      html: '<p>x</p>',
      text: 'x',
    });
    const noId = createResendTransport({ apiKey: 'k', fetch: respond(200, {}) });
    expect(await noId.send(email)).toEqual({ providerMessageId: null });
  });

  it('classifies refusals: retry what a retry can fix, never keep provider text', async () => {
    expect(
      await failure(
        respond(422, { name: 'validation_error', message: 'sara@example.com is invalid' }),
      ),
    ).toMatchObject({
      code: 'VALIDATION_ERROR',
      permanent: true,
    });
    expect(
      String(
        await failure(respond(422, { name: 'validation_error', message: 'sara@example.com' })),
      ),
    ).not.toContain('sara');
    expect(await failure(respond(401, { name: 'invalid_api_key' }))).toMatchObject({
      code: 'PROVIDER_AUTH',
      permanent: false,
    });
    expect(await failure(respond(429, { name: 'rate_limit_exceeded' }))).toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
      permanent: false,
    });
    expect(await failure(respond(409, { name: 'concurrent_idempotent_requests' }))).toMatchObject({
      permanent: false,
    });
    expect(await failure(respond(409, { name: 'invalid_idempotent_request' }))).toMatchObject({
      code: 'INVALID_IDEMPOTENT_REQUEST',
      permanent: true,
    });
    expect(await failure(respond(403, { name: 'validation_error' }))).toMatchObject({
      code: 'PROVIDER_AUTH',
      permanent: false,
    });
    expect(await failure(respond(503, 'not json'))).toMatchObject({
      code: 'HTTP_503',
      permanent: false,
    });
    expect(await failure(respond(400, { name: 'Weird Name!' }))).toMatchObject({
      code: 'HTTP_400',
      permanent: true,
    });
    expect(
      await failure(vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed')))),
    ).toMatchObject({
      code: 'NETWORK_ERROR',
      permanent: false,
    });
  });

  it('waits out a rate limit in place (Retry-After, capped, jittered) before giving the attempt up', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(429, { name: 'rate_limit_exceeded' }, { 'retry-after': '3' }))
      .mockResolvedValueOnce(reply(429, {}, { 'retry-after': '60' }))
      .mockResolvedValueOnce(reply(200, { id: 'msg_9' }));
    const transport = createResendTransport({
      apiKey: 'k',
      fetch: fetchImpl,
      sleep,
      random: () => 0.5,
    });
    expect(await transport.send(email)).toEqual({ providerMessageId: 'msg_9' });
    expect(sleep.mock.calls).toEqual([[3250], [10_250]]);
    // The same idempotency key every time.
    expect(
      new Set(fetchImpl.mock.calls.map(([, init]) => JSON.stringify(init?.headers))),
    ).toHaveProperty('size', 1);

    // Still limited after two waits: the attempt ends (temporary); quotas are not waited for.
    const limited = respond(429, { name: 'rate_limit_exceeded' });
    expect(await failure(limited)).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', permanent: false });
    expect(limited).toHaveBeenCalledTimes(3);
    const quota = respond(429, { name: 'daily_quota_exceeded' });
    expect(await failure(quota)).toMatchObject({ code: 'DAILY_QUOTA_EXCEEDED', permanent: false });
    expect(quota).toHaveBeenCalledTimes(1);

    // Without Retry-After: about a second.
    const waits: number[] = [];
    await createResendTransport({
      apiKey: 'k',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(reply(429, {}))
        .mockResolvedValueOnce(reply(200, {})),
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      random: () => 0,
    }).send(email);
    expect(waits).toEqual([1000]);
  });

  it('quotes the display name and drops characters that would break the header', () => {
    expect(formatFrom({ name: 'A "B" <C>\r\n', address: 'a@b.co' })).toBe('"A B C" <a@b.co>');
    expect(formatFrom({ name: '  ', address: 'a@b.co' })).toBe('a@b.co');
  });
});
