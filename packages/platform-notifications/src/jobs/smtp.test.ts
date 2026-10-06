import { type AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifySmtpError, createSmtpTransport, parseSmtpUrl } from './smtp';

const DELIVERY_ID = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';

describe('SMTP settings', () => {
  it('reads smtp and smtps URLs; STARTTLS is required for any server that is not local', () => {
    expect(parseSmtpUrl('smtp://relay.example.com')).toEqual({
      host: 'relay.example.com',
      port: 587,
      secure: false,
      requireTls: true,
      user: undefined,
      password: undefined,
    });
    expect(parseSmtpUrl('smtps://u%40x:p%3Aw@relay.example.com')).toMatchObject({
      port: 465,
      secure: true,
      requireTls: false,
      user: 'u@x',
      password: 'p:w',
    });
    expect(parseSmtpUrl('smtp://localhost:1025')).toMatchObject({ port: 1025, requireTls: false });
  });

  it('refuses other schemes, paths and parameters', () => {
    for (const bad of ['http://x', 'smtp://x/path', 'smtp://x?tls=false', 'not a url', 'smtp://']) {
      expect(() => parseSmtpUrl(bad)).toThrow(/SMTP_URL/);
    }
  });

  it('classifies SMTP failures', () => {
    expect(classifySmtpError({ responseCode: 550 })).toMatchObject({
      code: 'ADDRESS_REJECTED',
      permanent: true,
    });
    expect(classifySmtpError({ responseCode: 554 })).toMatchObject({
      code: 'PROVIDER_REJECTED',
      permanent: true,
    });
    expect(classifySmtpError({ responseCode: 535 })).toMatchObject({
      code: 'PROVIDER_AUTH',
      permanent: false,
    });
    expect(classifySmtpError({ responseCode: 451 })).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      permanent: false,
    });
    expect(classifySmtpError({ code: 'EAUTH' })).toMatchObject({
      code: 'PROVIDER_AUTH',
      permanent: false,
    });
    expect(classifySmtpError({ code: 'ETLS' })).toMatchObject({
      code: 'TLS_FAILED',
      permanent: false,
    });
    expect(classifySmtpError({ code: 'ETLS', responseCode: 502 })).toMatchObject({
      code: 'TLS_FAILED',
      permanent: false,
    });
    expect(classifySmtpError({ code: 'EAUTH', responseCode: 535 })).toMatchObject({
      code: 'PROVIDER_AUTH',
    });
    expect(classifySmtpError({ code: 'EMESSAGE' })).toMatchObject({ permanent: true });
    expect(classifySmtpError({ code: 'ECONNECTION' })).toMatchObject({ code: 'NETWORK_ERROR' });
    expect(classifySmtpError(new Error('x'))).toMatchObject({
      code: 'SEND_FAILED',
      permanent: false,
    });
    expect(classifySmtpError(null)).toMatchObject({ code: 'SEND_FAILED' });
  });
});

describe('SMTP transport against a local server', () => {
  const received: { from: string; to: string[]; raw: string; user: string | undefined }[] = [];
  const logins: string[] = [];
  let rejectNext = false;
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    onAuth(auth, _session, callback) {
      logins.push(auth.username ?? '');
      callback(null, { user: auth.username });
    },
    onRcptTo(address, _session, callback) {
      if (rejectNext) {
        rejectNext = false;
        const error = Object.assign(new Error('mailbox unavailable'), { responseCode: 550 });
        callback(error);
        return;
      }
      callback();
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          raw: Buffer.concat(chunks).toString('utf8'),
          user: typeof session.user === 'string' ? session.user : undefined,
        });
        callback();
      });
    },
  });
  let port = 0;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  const email = {
    from: { name: 'ENTLAQA LMS', address: 'noreply@lms.entlaqa.com' },
    to: 'sara@example.com',
    subject: 'دعوة للانضمام',
    html: '<p dir="rtl">مرحبًا</p>',
    text: 'مرحبًا',
    idempotencyKey: DELIVERY_ID,
  };

  it('sends both parts with the delivery id in the Message-ID', async () => {
    const transport = createSmtpTransport(
      parseSmtpUrl(`smtp://worker:secret@127.0.0.1:${String(port)}`),
    );
    const result = await transport.send(email);
    expect(result.providerMessageId).toBe('<5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11@lms.entlaqa.com>');
    const message = received.at(-1);
    expect(message).toMatchObject({
      from: 'noreply@lms.entlaqa.com',
      to: ['sara@example.com'],
      user: 'worker',
    });
    expect(message?.raw).toContain(
      'Message-ID: <5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11@lms.entlaqa.com>',
    );
    expect(message?.raw).toContain('text/html');
    expect(message?.raw).toContain('text/plain');
    await transport.close?.();
  });

  it('a server that is not local must offer STARTTLS: nothing is sent, not even the login', async () => {
    const before = { logins: logins.length, received: received.length };
    const transport = createSmtpTransport({
      ...parseSmtpUrl(`smtp://worker:secret@127.0.0.1:${String(port)}`),
      requireTls: true, // as parseSmtpUrl sets it for any host but localhost
    });
    await expect(transport.send(email)).rejects.toMatchObject({
      code: 'TLS_FAILED',
      permanent: false,
    });
    expect({ logins: logins.length, received: received.length }).toEqual(before);
    await transport.close?.();
  });

  it('turns a refused recipient into a final failure', async () => {
    const transport = createSmtpTransport(parseSmtpUrl(`smtp://127.0.0.1:${String(port)}`));
    rejectNext = true;
    await expect(transport.send(email)).rejects.toMatchObject({
      code: 'ADDRESS_REJECTED',
      permanent: true,
    });
    await transport.close?.();
  });
});

describe('SMTP transport, STARTTLS with an untrusted certificate', () => {
  const logins: string[] = [];
  let received = 0;
  // smtp-server's built-in self-signed certificate: trusted by neither the system roots nor any CA.
  const server = new SMTPServer({
    authOptional: true,
    onAuth(auth, _session, callback) {
      logins.push(auth.username ?? '');
      callback(null, { user: auth.username });
    },
    onData(stream, _session, callback) {
      stream.resume();
      stream.on('end', () => {
        received += 1;
        callback();
      });
    },
  });
  let port = 0;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it('refuses the server: no login, no message', async () => {
    const transport = createSmtpTransport({
      ...parseSmtpUrl(`smtp://worker:secret@127.0.0.1:${String(port)}`),
      requireTls: true,
    });
    await expect(
      transport.send({
        from: { name: 'ENTLAQA LMS', address: 'noreply@lms.entlaqa.com' },
        to: 'sara@example.com',
        subject: 's',
        html: '<p>h</p>',
        text: 't',
        idempotencyKey: DELIVERY_ID,
      }),
    ).rejects.toMatchObject({ permanent: false });
    expect({ logins, received }).toEqual({ logins: [], received: 0 });
    await transport.close?.();
  });
});
