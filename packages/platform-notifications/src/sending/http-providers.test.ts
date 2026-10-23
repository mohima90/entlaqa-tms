import { describe, expect, it, vi } from 'vitest';
import { createMailgunTransport } from './mailgun';
import { createMicrosoftGraphTransport } from './microsoft-graph';
import { SENDGRID_API_URL, createSendGridTransport } from './sendgrid';
import type { EmailSendError, OutgoingEmail } from './transport';

const DELIVERY_ID = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';

const email: OutgoingEmail = {
  from: { name: 'Al Raya Training', address: 'training@raya.example' },
  to: 'sara@example.com',
  replyTo: 'hr@raya.example',
  subject: 'دعوة',
  html: '<p>x</p>',
  text: 'x',
  idempotencyKey: DELIVERY_ID,
};
const noWait = () => Promise.resolve();
const href = (url: Parameters<typeof fetch>[0]): string =>
  typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

async function failureOf(promise: Promise<unknown>): Promise<EmailSendError> {
  return promise.then(
    () => {
      throw new Error('expected a failure');
    },
    (e: unknown) => e as EmailSendError,
  );
}

describe('SendGrid transport', () => {
  it('posts the message with tracking off (links carry invitation codes) and returns its id', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 202, headers: { 'x-message-id': 'sg_1' } })),
    );
    const transport = createSendGridTransport({ apiKey: 'SG.key.secret', fetch: fetchImpl });
    expect(await transport.send(email)).toEqual({ providerMessageId: 'sg_1' });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(SENDGRID_API_URL);
    expect(init?.headers).toMatchObject({ authorization: 'Bearer SG.key.secret' });
    expect(init?.redirect).toBe('error');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      personalizations: [{ to: [{ email: 'sara@example.com' }] }],
      from: { email: 'training@raya.example', name: 'Al Raya Training' },
      reply_to: { email: 'hr@raya.example' },
      content: [
        { type: 'text/plain', value: 'x' },
        { type: 'text/html', value: '<p>x</p>' },
      ],
      tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
    });
  });

  it('classifies refusals with our codes only', async () => {
    const send = (status: number, headers: Record<string, string> = {}) =>
      failureOf(
        createSendGridTransport({
          apiKey: 'SG.k.s',
          fetch: () =>
            Promise.resolve(
              reply(status, { errors: [{ message: 'sara@example.com bad' }] }, headers),
            ),
          sleep: noWait,
        }).send(email),
      );
    expect(await send(401)).toMatchObject({ code: 'PROVIDER_AUTH', permanent: false });
    expect(await send(403)).toMatchObject({ code: 'PROVIDER_AUTH', permanent: false });
    expect(await send(400)).toMatchObject({ code: 'PROVIDER_REJECTED', permanent: true });
    expect(await send(503)).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', permanent: false });
    expect(await send(429, { 'retry-after': '1' })).toMatchObject({
      code: 'RATE_LIMITED',
      permanent: false,
    });
    const network = await failureOf(
      createSendGridTransport({
        apiKey: 'SG.k.s',
        fetch: () => Promise.reject(new Error('reset')),
      }).send(email),
    );
    expect(network).toMatchObject({ code: 'NETWORK_ERROR', permanent: false });
    expect(network.message).not.toContain('sara');
  });

  it('waits out a short rate limit in place', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(429, {}, { 'retry-after': '2' }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const sleep = vi.fn(noWait);
    const transport = createSendGridTransport({
      apiKey: 'SG.k.s',
      fetch: fetchImpl,
      sleep,
      random: () => 0,
    });
    expect(await transport.send(email)).toEqual({ providerMessageId: null });
    expect(sleep).toHaveBeenCalledWith(2000);
  });
});

describe('Mailgun transport', () => {
  it('posts to the region and domain with basic auth, tracking off, reply-to', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(reply(200, { id: '<mg.1@mg.raya.example>' })),
    );
    const transport = createMailgunTransport({
      apiKey: 'key-123456',
      domain: 'mg.raya.example',
      region: 'eu',
      fetch: fetchImpl,
    });
    expect(await transport.send(email)).toEqual({ providerMessageId: '<mg.1@mg.raya.example>' });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.eu.mailgun.net/v3/mg.raya.example/messages');
    expect(init?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('api:key-123456').toString('base64')}`,
    });
    const form = new URLSearchParams(init?.body as string);
    expect(form.get('from')).toBe('"Al Raya Training" <training@raya.example>');
    expect(form.get('h:Reply-To')).toBe('hr@raya.example');
    expect(form.get('o:tracking')).toBe('no');
    expect(form.get('v:delivery_id')).toBe(email.idempotencyKey);
    const us = vi.fn<typeof fetch>(() => Promise.resolve(reply(200, {})));
    await createMailgunTransport({
      apiKey: 'k',
      domain: 'mg.x.example',
      region: 'us',
      fetch: us,
    }).send({
      ...email,
      replyTo: undefined,
    });
    expect(us.mock.calls[0]?.[0]).toBe('https://api.mailgun.net/v3/mg.x.example/messages');
    expect(new URLSearchParams(us.mock.calls[0]?.[1]?.body as string).has('h:Reply-To')).toBe(
      false,
    );
  });

  it('a wrong key is the configuration (retried), a refused message is final', async () => {
    const at = (status: number) =>
      failureOf(
        createMailgunTransport({
          apiKey: 'k',
          domain: 'd.example',
          region: 'us',
          fetch: () => Promise.resolve(reply(status)),
        }).send(email),
      );
    expect(await at(401)).toMatchObject({ code: 'PROVIDER_AUTH', permanent: false });
    expect(await at(400)).toMatchObject({ code: 'PROVIDER_REJECTED', permanent: true });
  });
});

describe('Microsoft 365 (Graph) transport', () => {
  const settings = {
    tenantId: 'raya.example',
    clientId: '11111111-2222-3333-4444-555555555555',
    clientSecret: 'client-secret-value',
  };

  it('gets a token with client credentials once, then sends as the sender mailbox', async () => {
    const fetchImpl = vi.fn<typeof fetch>((url) =>
      Promise.resolve(
        href(url).includes('/oauth2/')
          ? reply(200, { access_token: 'tok_1', expires_in: 3600 })
          : new Response(null, { status: 202 }),
      ),
    );
    const transport = createMicrosoftGraphTransport({
      ...settings,
      fetch: fetchImpl,
      now: () => 0,
    });
    expect(await transport.send(email)).toEqual({ providerMessageId: null });
    await transport.send(email);
    const urls = fetchImpl.mock.calls.map(([url]) => href(url));
    expect(urls).toEqual([
      'https://login.microsoftonline.com/raya.example/oauth2/v2.0/token',
      'https://graph.microsoft.com/v1.0/users/training%40raya.example/sendMail',
      'https://graph.microsoft.com/v1.0/users/training%40raya.example/sendMail',
    ]);
    const token = new URLSearchParams(fetchImpl.mock.calls[0]?.[1]?.body as string);
    expect(Object.fromEntries(token)).toEqual({
      grant_type: 'client_credentials',
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });
    const send = fetchImpl.mock.calls[1]?.[1];
    expect(send?.headers).toMatchObject({ authorization: 'Bearer tok_1' });
    expect(JSON.parse(send?.body as string)).toEqual({
      message: {
        subject: 'دعوة',
        body: { contentType: 'HTML', content: '<p>x</p>' },
        from: { emailAddress: { address: 'training@raya.example', name: 'Al Raya Training' } },
        toRecipients: [{ emailAddress: { address: 'sara@example.com' } }],
        replyTo: [{ emailAddress: { address: 'hr@raya.example' } }],
      },
      saveToSentItems: false,
    });
  });

  it('a wrong tenant, client or secret, and a sender that is no mailbox, are the configuration', async () => {
    const badToken = await failureOf(
      createMicrosoftGraphTransport({
        ...settings,
        fetch: () => Promise.resolve(reply(400, { error: 'invalid_client' })),
      }).send(email),
    );
    expect(badToken).toMatchObject({ code: 'PROVIDER_AUTH', permanent: false });
    const noToken = await failureOf(
      createMicrosoftGraphTransport({
        ...settings,
        fetch: () => Promise.resolve(reply(200, {})),
      }).send(email),
    );
    expect(noToken).toMatchObject({ code: 'PROVIDER_AUTH' });
    const notMailbox = await failureOf(
      createMicrosoftGraphTransport({
        ...settings,
        fetch: (url) =>
          Promise.resolve(
            href(url).includes('/oauth2/')
              ? reply(200, { access_token: 't', expires_in: 60 })
              : reply(404),
          ),
      }).send(email),
    );
    expect(notMailbox).toMatchObject({ code: 'SENDER_NOT_ALLOWED', permanent: false });
  });

  it('a revoked token is fetched again on the next send', async () => {
    let tokens = 0;
    const fetchImpl = vi.fn<typeof fetch>((url) => {
      if (href(url).includes('/oauth2/')) {
        tokens += 1;
        return Promise.resolve(
          reply(200, { access_token: `tok_${String(tokens)}`, expires_in: 3600 }),
        );
      }
      return Promise.resolve(tokens === 1 ? reply(401) : new Response(null, { status: 202 }));
    });
    const transport = createMicrosoftGraphTransport({
      ...settings,
      fetch: fetchImpl,
      now: () => 0,
    });
    expect(await failureOf(transport.send(email))).toMatchObject({ code: 'PROVIDER_AUTH' });
    await transport.send(email);
    expect(tokens).toBe(2);
  });
});
