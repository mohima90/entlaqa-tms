import type { EmailRouteRow, SystemTx } from '@jadarat/platform-db/jobs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialsContext, sealCredentials } from '../credentials-seal';
import { deriveCredentialsKeyPair } from '../sending/credentials';
import { createProviderTransport } from '../sending/factory';
import { brandName, createEmailRouter } from './router';
import { isPublicAddress } from '../sending/smtp';
import type { EmailTransport } from '../sending/transport';

const db = vi.hoisted(() => ({ loadEmailRoute: vi.fn() }));
vi.mock('@jadarat/platform-db/jobs', () => db);

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const keys = deriveCredentialsKeyPair(
  'a-generated-64-character-secret-for-the-router-tests-0123456789',
);
const tx = { transaction: (fn: (t: unknown) => unknown) => fn(tx) } as unknown as SystemTx;
const tenantSealed = sealCredentials(
  keys.publicKey,
  credentialsContext({ kind: 'tenant', tenantId: TENANT }, 'sendgrid'),
  {
    apiKey: 'SG.xxxxxxxx.xxxxxxxx',
  },
);
const platformSealed = sealCredentials(
  keys.publicKey,
  credentialsContext({ kind: 'platform' }, 'resend'),
  {
    apiKey: 're_platform_key_1',
  },
);

function row(over: Partial<EmailRouteRow> = {}): EmailRouteRow {
  return {
    tenant: null,
    platform: {
      provider: 'resend',
      options: {},
      credentialsSealed: platformSealed,
      fromAddress: 'no-reply@jadarat.example',
      verified: true,
      version: 1,
    },
    brandNameAr: 'الراية',
    brandNameEn: 'Al Raya',
    defaultLocale: 'en',
    ...over,
  };
}

const ownProvider = {
  provider: 'sendgrid',
  options: {},
  credentialsSealed: tenantSealed,
  fromName: 'Al Raya Training',
  fromAddress: 'training@raya.example',
  replyTo: 'hr@raya.example',
  enabled: true,
  version: 3,
};

afterEach(() => {
  vi.resetAllMocks();
});

describe('the sender rule (WP-ADM-01, Kawadir)', () => {
  it("1. the organization's own provider when enabled — its sender, reply-to and secrets", async () => {
    db.loadEmailRoute.mockResolvedValue(row({ tenant: ownProvider }));
    const transportFor = vi.fn(createProviderTransport);
    const router = createEmailRouter({ keys, installation: null, log: vi.fn(), transportFor });
    const route = await router.resolve(tx, TENANT);
    expect(route).toMatchObject({
      kind: 'send',
      sender: 'organization',
      from: { name: 'Al Raya Training', address: 'training@raya.example' },
      replyTo: 'hr@raya.example',
    });
    expect(transportFor).toHaveBeenCalledWith(
      'sendgrid',
      {},
      { apiKey: 'SG.xxxxxxxx.xxxxxxxx' },
      expect.objectContaining({ organization: true }),
    );
  });

  it('2. else the verified platform sender, with the organization brand name as display name', async () => {
    db.loadEmailRoute.mockResolvedValue(row({ tenant: { ...ownProvider, enabled: false } }));
    const router = createEmailRouter({ keys, installation: null, log: vi.fn() });
    expect(await router.resolve(tx, TENANT)).toMatchObject({
      kind: 'send',
      sender: 'platform',
      from: { name: 'Al Raya', address: 'no-reply@jadarat.example' },
    });
    db.loadEmailRoute.mockResolvedValue(row({ defaultLocale: 'ar' }));
    expect(await router.resolve(tx, TENANT)).toMatchObject({ from: { name: 'الراية' } });
  });

  it("platformOnly (the sign-in code of an account of several organizations) skips the organization's own provider", async () => {
    db.loadEmailRoute.mockResolvedValue(row({ tenant: ownProvider }));
    const router = createEmailRouter({ keys, installation: null, log: vi.fn() });
    expect(await router.resolve(tx, TENANT, { platformOnly: true })).toMatchObject({
      kind: 'send',
      sender: 'platform',
      from: { name: 'Al Raya', address: 'no-reply@jadarat.example' },
    });
    // The organization's provider is still first for everything else.
    expect(await router.resolve(tx, TENANT)).toMatchObject({ sender: 'organization' });
    // No platform sender ready: the message waits - it never falls back to the organization's provider.
    db.loadEmailRoute.mockResolvedValue(row({ tenant: ownProvider, platform: null }));
    expect(await router.resolve(tx, TENANT, { platformOnly: true })).toEqual({
      kind: 'wait',
      code: 'NO_SENDER',
    });
  });

  it('a platform sender not verified yet: messages wait (nothing lost) — never the installation sender', async () => {
    const installation = {
      transport: { provider: 'smtp' as const, send: vi.fn() },
      address: 'relay@x.example',
      name: 'X',
    };
    db.loadEmailRoute.mockResolvedValue(row({ platform: { ...row().platform!, verified: false } }));
    const router = createEmailRouter({ keys, installation, log: vi.fn() });
    expect(await router.resolve(tx, TENANT)).toEqual({ kind: 'wait', code: 'NO_SENDER' });
  });

  it('3. the installation sender only while no platform sender was ever saved; 4. else wait', async () => {
    const installation = {
      transport: { provider: 'smtp' as const, send: vi.fn() } as EmailTransport,
      address: 'relay@x.example',
      name: 'X',
    };
    db.loadEmailRoute.mockResolvedValue(row({ platform: null }));
    expect(
      await createEmailRouter({ keys, installation, log: vi.fn() }).resolve(tx, TENANT),
    ).toMatchObject({
      kind: 'send',
      sender: 'installation',
      from: { name: 'Al Raya', address: 'relay@x.example' },
    });
    expect(
      await createEmailRouter({ keys: null, installation: null, log: vi.fn() }).resolve(tx, TENANT),
    ).toEqual({
      kind: 'wait',
      code: 'NO_SENDER',
    });
  });

  it('no automatic fallback: an enabled organization provider that cannot be used makes ITS messages wait', async () => {
    db.loadEmailRoute.mockResolvedValue(row({ tenant: ownProvider }));
    const log = vi.fn();
    const rotated = deriveCredentialsKeyPair(
      'another-64-character-secret-after-a-rotation-0123456789abcdefgh',
    );
    const route = await createEmailRouter({ keys: rotated, installation: null, log }).resolve(
      tx,
      TENANT,
    );
    expect(route).toEqual({ kind: 'wait', code: 'CREDENTIALS_UNAVAILABLE' });
    expect(log).toHaveBeenCalledWith(
      'error',
      "the organization's e-mail settings cannot be used (CREDENTIALS_KEY_CHANGED); messages wait",
    );
    // Without the worker's key: the same, with its code; the secrets never reach the log.
    const noKey = await createEmailRouter({ keys: null, installation: null, log }).resolve(
      tx,
      TENANT,
    );
    expect(noKey).toEqual({ kind: 'wait', code: 'CREDENTIALS_UNAVAILABLE' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('SG.');
  });

  it("another organization's sealed secrets never open for this one", async () => {
    db.loadEmailRoute.mockResolvedValue(row({ tenant: ownProvider }));
    const route = await createEmailRouter({ keys, installation: null, log: vi.fn() }).resolve(
      tx,
      'b0000000-0000-4000-8000-000000000001',
    );
    expect(route).toEqual({ kind: 'wait', code: 'CREDENTIALS_UNAVAILABLE' });
  });

  it('reuses a transport for a minute, and builds a new one when the settings change', async () => {
    let now = 0;
    const transportFor = vi.fn(createProviderTransport);
    const router = createEmailRouter({
      keys,
      installation: null,
      log: vi.fn(),
      transportFor,
      now: () => now,
    });
    db.loadEmailRoute.mockResolvedValue(row());
    await router.resolve(tx, TENANT);
    await router.resolve(tx, TENANT);
    expect(transportFor).toHaveBeenCalledTimes(1);
    db.loadEmailRoute.mockResolvedValue(row({ platform: { ...row().platform!, version: 2 } }));
    await router.resolve(tx, TENANT);
    expect(transportFor).toHaveBeenCalledTimes(2);
    now = 61_000;
    await router.resolve(tx, TENANT);
    expect(transportFor).toHaveBeenCalledTimes(3);
    await router.close();
  });

  it('expired transports are closed and removed (settings that changed leave nothing behind)', async () => {
    let now = 0;
    const closes: string[] = [];
    let n = 0;
    const transportFor = vi.fn(() => {
      const id = `t${String((n += 1))}`;
      return {
        provider: 'resend' as const,
        send: vi.fn(),
        close: () => {
          closes.push(id);
          return Promise.resolve();
        },
      };
    }) as unknown as typeof createProviderTransport;
    const router = createEmailRouter({
      keys,
      installation: null,
      log: vi.fn(),
      transportFor,
      now: () => now,
    });
    db.loadEmailRoute.mockResolvedValue(row());
    await router.resolve(tx, TENANT); // t1 (version 1)
    db.loadEmailRoute.mockResolvedValue(row({ platform: { ...row().platform!, version: 2 } }));
    await router.resolve(tx, TENANT); // t2 (version 2); t1 still within its minute
    expect(closes).toEqual([]);
    now = 61_000;
    await router.resolve(tx, TENANT); // both expired: closed, t3 built
    expect(closes).toEqual(['t1', 't2']);
    await router.close();
    expect(closes).toEqual(['t1', 't2', 't3']);
  });

  it('before the migration (expand-first): the installation sender as before, else wait', async () => {
    db.loadEmailRoute.mockRejectedValue(
      Object.assign(new Error('function does not exist'), { code: '42883' }),
    );
    const installation = {
      transport: { provider: 'smtp' as const, send: vi.fn() } as EmailTransport,
      address: 'relay@x.example',
      name: 'Jadarat',
    };
    expect(
      await createEmailRouter({ keys, installation, log: vi.fn() }).resolve(tx, TENANT),
    ).toMatchObject({
      kind: 'send',
      sender: 'installation',
      from: { name: 'Jadarat', address: 'relay@x.example' },
    });
    expect(
      await createEmailRouter({ keys, installation: null, log: vi.fn() }).resolve(tx, TENANT),
    ).toEqual({
      kind: 'wait',
      code: 'NO_SENDER',
    });
    db.loadEmailRoute.mockRejectedValue(new Error('connection lost'));
    await expect(
      createEmailRouter({ keys, installation, log: vi.fn() }).resolve(tx, TENANT),
    ).rejects.toThrow('connection lost');
  });

  it('brand names are one line of at most 100 characters', () => {
    expect(brandName({ brandNameAr: 'أ', brandNameEn: null, defaultLocale: 'en' })).toBe('أ');
    expect(
      brandName({ brandNameAr: 'x', brandNameEn: `A\nB${'c'.repeat(200)}`, defaultLocale: 'en' }),
    ).toHaveLength(100);
  });
});

describe('provider settings and SSRF protection', () => {
  it('invalid stored settings are PROVIDER_SETTINGS_INVALID (never a crash with the value)', () => {
    expect(() => createProviderTransport('postmark', {}, {}, { organization: true })).toThrow(
      /PROVIDER_SETTINGS_INVALID/,
    );
    expect(() =>
      createProviderTransport('resend', {}, { apiKey: 'nope' }, { organization: true }),
    ).toThrow(/PROVIDER_SETTINGS_INVALID/);
    expect(() =>
      createProviderTransport(
        'smtp',
        { host: 'smtp.x.example', port: 587, security: 'none', username: '' },
        { password: '' },
        { organization: true },
      ),
    ).toThrow(/PROVIDER_SETTINGS_INVALID/);
    expect(
      createProviderTransport(
        'mailgun',
        { domain: 'mg.x.example', region: 'eu' },
        { apiKey: 'key-xxxxxxxx' },
        { organization: true },
      ).provider,
    ).toBe('mailgun');
    expect(
      createProviderTransport(
        'microsoft_graph',
        {
          tenantId: '11111111-2222-3333-4444-555555555555',
          clientId: '11111111-2222-3333-4444-555555555555',
        },
        { clientSecret: 'secret-1234' },
        { organization: true },
      ).provider,
    ).toBe('microsoft_graph');
  });

  it("an organization's relay must be on the public internet, on a submission port", async () => {
    const email = {
      from: { name: 'A', address: 'a@x.example' },
      to: 'b@y.example',
      subject: 's',
      html: 'h',
      text: 't',
      idempotencyKey: 'k',
    };
    const relay = (
      host: string,
      port: number,
      lookup: (h: string) => Promise<{ address: string }[]>,
    ) =>
      createProviderTransport(
        'smtp',
        { host, port, security: 'starttls', username: 'u' },
        { password: 'p' },
        { organization: true, lookup },
      ).send(email);
    await expect(
      relay('db.internal', 587, () => Promise.resolve([{ address: '10.1.2.3' }])),
    ).rejects.toMatchObject({
      code: 'SMTP_HOST_NOT_ALLOWED',
    });
    await expect(
      relay('evil.example', 587, () =>
        Promise.resolve([{ address: '93.184.216.34' }, { address: '127.0.0.1' }]),
      ),
    ).rejects.toMatchObject({
      code: 'SMTP_HOST_NOT_ALLOWED',
    });
    await expect(
      relay('smtp.x.example', 5432, () => Promise.resolve([{ address: '93.184.216.34' }])),
    ).rejects.toMatchObject({
      code: 'SMTP_HOST_NOT_ALLOWED',
    });
    // Port 25 is server-to-server relaying, not submission: refused too.
    await expect(
      relay('smtp.x.example', 25, () => Promise.resolve([{ address: '93.184.216.34' }])),
    ).rejects.toMatchObject({
      code: 'SMTP_HOST_NOT_ALLOWED',
    });
    await expect(
      relay('nowhere.example', 587, () => Promise.reject(new Error('ENOTFOUND'))),
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.5.4',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      // IPv4-compatible, NAT64 (well-known and local-use) and 6to4 addresses embed an IPv4 address.
      '::10.0.0.1',
      '::a00:1',
      '64:ff9b::a00:1',
      '64:ff9b:1::a00:1',
      '2002:a00:1::1',
      '0.0.0.0',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of [
      '93.184.216.34',
      '2606:2800:220:1:248:1893:25c8:1946',
      '::ffff:93.184.216.34',
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("the platform sender's relay: the same rule, unless the operator allows internal relays", async () => {
    const email = {
      from: { name: 'A', address: 'a@x.example' },
      to: 'b@y.example',
      subject: 's',
      html: 'h',
      text: 't',
      idempotencyKey: 'k',
    };
    const lookup = vi.fn(() => Promise.resolve([{ address: '127.0.0.1' }]));
    const platformRelay = (allowPrivatePlatformSmtp: boolean, port: number) =>
      createProviderTransport(
        'smtp',
        { host: 'relay.internal', port, security: 'starttls', username: '' },
        { password: '' },
        { organization: false, allowPrivatePlatformSmtp, lookup },
      ).send(email);
    await expect(platformRelay(false, 587)).rejects.toMatchObject({
      code: 'SMTP_HOST_NOT_ALLOWED',
    });
    await expect(platformRelay(false, 25)).rejects.toMatchObject({ code: 'SMTP_HOST_NOT_ALLOWED' });
    // Allowed by the operator: no check (the connection itself fails here: nothing listens on 127.0.0.1:1).
    lookup.mockClear();
    const allowed = createProviderTransport(
      'smtp',
      { host: '127.0.0.1', port: 1, security: 'starttls', username: '' },
      { password: '' },
      { organization: false, allowPrivatePlatformSmtp: true, lookup },
    );
    await expect(allowed.send(email)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(lookup).not.toHaveBeenCalled();
  });
});
