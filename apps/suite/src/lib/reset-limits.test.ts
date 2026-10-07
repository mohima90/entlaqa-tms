import { describe, expect, it, vi } from 'vitest';
import { UNKNOWN_CLIENT, clientAddress, clientRateKey } from './client-ip';
import {
  RESET_LIMITS,
  RESET_LIMIT_WINDOW_MS,
  createEvictingLimiter,
  createResetLimiter,
} from './reset-limits';

vi.mock('server-only', () => ({}));

const headersOf = (values: Record<string, string>) => (name: string) => values[name] ?? null;

describe('clientAddress (TM-0003 T-IAM-03: only a platform-overwritten header)', () => {
  it('uses x-real-ip on Vercel and the configured header elsewhere', () => {
    expect(clientAddress(headersOf({ 'x-real-ip': '203.0.113.7' }), { VERCEL: '1' })).toBe(
      '203.0.113.7',
    );
    expect(
      clientAddress(headersOf({ 'x-client-ip': '2001:db8::1', 'x-real-ip': '203.0.113.7' }), {
        JADARAT_CLIENT_IP_HEADER: 'x-client-ip',
        VERCEL: '1',
      }),
    ).toBe('2001:db8::1');
  });

  it('never trusts a header the platform does not overwrite, nor anything but one address', () => {
    expect(clientAddress(headersOf({ 'x-real-ip': '203.0.113.7' }), {})).toBe(UNKNOWN_CLIENT);
    expect(
      clientAddress(headersOf({ 'x-forwarded-for': '203.0.113.7' }), {
        JADARAT_CLIENT_IP_HEADER: ' ',
      }),
    ).toBe(UNKNOWN_CLIENT);
    for (const value of ['203.0.113.7, 198.51.100.1', 'evil', '']) {
      expect(clientAddress(headersOf({ 'x-real-ip': value }), { VERCEL: '1' }), value).toBe(
        UNKNOWN_CLIENT,
      );
    }
  });
});

describe('clientRateKey (IPv6 by its /64)', () => {
  it('keys every address of one /64 alike, whatever the notation', () => {
    const key = '2001:db8:85a3:42::/64';
    for (const address of [
      '2001:db8:85a3:42::1',
      '2001:db8:85a3:42:ffff:ffff:ffff:ffff',
      '2001:0db8:85a3:0042:0000:0000:0000:0002',
      '2001:DB8:85A3:42:1:2:3:4',
      '2001:db8:85a3:42::1%eth0',
      '2001:db8:85a3:42::192.0.2.1',
    ]) {
      expect(clientRateKey(address), address).toBe(key);
    }
    expect(clientRateKey('2001:db8:85a3:43::1')).toBe('2001:db8:85a3:43::/64');
    expect(clientRateKey('::1')).toBe('0:0:0:0::/64');
    expect(clientRateKey('fe80::')).toBe('fe80:0:0:0::/64');
  });

  it('keeps IPv4 as is (also when mapped into IPv6) and anything else unchanged', () => {
    expect(clientRateKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientRateKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientRateKey('::ffff:cb00:7107')).toBe('203.0.113.7');
    expect(clientRateKey(UNKNOWN_CLIENT)).toBe(UNKNOWN_CLIENT);
  });
});

describe('createEvictingLimiter (a full table never locks anyone out)', () => {
  it('counts per key in windows that start at the first attempt', () => {
    let time = 0;
    const allow = createEvictingLimiter(2, 1000, 10, () => time);
    expect([allow('a'), allow('a'), allow('a')]).toEqual([true, true, false]);
    time = 500;
    expect(allow('b')).toBe(true);
    time = 1000;
    // a's window is over; b's is not.
    expect([allow('a'), allow('b'), allow('b')]).toEqual([true, true, false]);
  });

  it('makes room by dropping the oldest entry when none has expired', () => {
    let time = 0;
    const allow = createEvictingLimiter(1, 1000, 2, () => time);
    expect([allow('a'), allow('a')]).toEqual([true, false]);
    time = 100;
    expect(allow('b')).toBe(true);
    time = 200;
    // Full and nothing expired: the oldest (a) goes, the new key is allowed, b keeps its count.
    expect(allow('c')).toBe(true);
    expect(allow('b')).toBe(false);
    // a starts again (its counter was dropped).
    expect(allow('a')).toBe(true);
  });

  it('drops expired entries before any live one', () => {
    let time = 0;
    const allow = createEvictingLimiter(1, 1000, 2, () => time);
    allow('x');
    time = 600;
    allow('y');
    time = 1100; // x has expired, y has not
    expect(allow('z')).toBe(true);
    expect(allow('y')).toBe(false); // y was kept with its count
  });

  it('never refuses a new key because the table is full', () => {
    const allow = createEvictingLimiter(1, 60_000, 100);
    for (let i = 0; i < 1000; i += 1) expect(allow(`flood-${String(i)}`)).toBe(true);
    expect(allow('legitimate')).toBe(true);
  });
});

describe('createResetLimiter (FR-IAM-13, T-M2-08)', () => {
  it('limits reset e-mails per account across clients, whatever the spelling of the address', () => {
    const limiter = createResetLimiter();
    for (let i = 0; i < RESET_LIMITS.requestsPerAccount; i += 1) {
      expect(limiter.allowRequest(' Target@Example.test ', `198.51.100.${String(i)}`)).toBe(true);
    }
    expect(limiter.allowRequest('target@example.test', '198.51.100.99')).toBe(false);
    // Another account from the same client is not affected.
    expect(limiter.allowRequest('other@example.test', '198.51.100.99')).toBe(true);
  });

  it('limits reset e-mails per client across accounts, and IPv6 clients per /64', () => {
    const limiter = createResetLimiter();
    for (let i = 0; i < RESET_LIMITS.requestsPerClient; i += 1) {
      expect(limiter.allowRequest(`user${String(i)}@example.test`, `2001:db8::${String(i)}`)).toBe(
        true,
      );
    }
    expect(limiter.allowRequest('fresh@example.test', '2001:db8::ffff')).toBe(false);
    expect(limiter.allowRequest('fresh@example.test', '2001:db8:0:1::1')).toBe(true);
  });

  it('counts the account only for an allowed client (a refused client cannot use it up)', () => {
    const limiter = createResetLimiter();
    for (let i = 0; i < RESET_LIMITS.requestsPerClient; i += 1) {
      limiter.allowRequest(`warm-up${String(i)}@example.test`, '203.0.113.66');
    }
    // The attacker's client is limited now: its further attempts against the victim count nowhere.
    for (let i = 0; i < 20; i += 1) {
      expect(limiter.allowRequest('victim@example.test', '203.0.113.66')).toBe(false);
    }
    expect(limiter.allowRequest('victim@example.test', '198.51.100.1')).toBe(true);
  });

  it('keys accounts with a per-process secret (two limiters do not share keys)', () => {
    const first = createResetLimiter();
    const second = createResetLimiter();
    for (let i = 0; i < RESET_LIMITS.requestsPerAccount; i += 1) {
      first.allowRequest('target@example.test', `198.51.100.${String(i)}`);
    }
    expect(first.allowRequest('target@example.test', '198.51.100.50')).toBe(false);
    expect(second.allowRequest('target@example.test', '198.51.100.50')).toBe(true);
  });

  it('keeps working when its tables are full (flood of accounts and clients)', () => {
    const limiter = createResetLimiter(Date.now, 50);
    for (let i = 0; i < 500; i += 1) {
      limiter.allowRequest(
        `flood${String(i)}@example.test`,
        `198.18.${String(i >> 8)}.${String(i & 255)}`,
      );
    }
    expect(limiter.allowRequest('real@example.test', '203.0.113.9')).toBe(true);
    expect(limiter.allowCompletion('203.0.113.9')).toBe(true);
  });

  it('gives every client without a trusted address one shared, larger budget', () => {
    const limiter = createResetLimiter();
    for (let i = 0; i < RESET_LIMITS.unknownClients; i += 1) {
      expect(limiter.allowRequest(`user${String(i)}@example.test`, UNKNOWN_CLIENT)).toBe(true);
    }
    expect(limiter.allowRequest('fresh@example.test', UNKNOWN_CLIENT)).toBe(false);
    for (let i = 0; i < RESET_LIMITS.unknownClients; i += 1) {
      expect(limiter.allowCompletion(UNKNOWN_CLIENT)).toBe(true);
    }
    expect(limiter.allowCompletion(UNKNOWN_CLIENT)).toBe(false);
  });

  it('limits new-password submissions to 5 per client and starts again after the window', () => {
    let time = 0;
    const limiter = createResetLimiter(() => time);
    expect(RESET_LIMITS.completionsPerClient).toBe(5);
    for (let i = 0; i < RESET_LIMITS.completionsPerClient; i += 1) {
      expect(limiter.allowCompletion('2001:db8::1')).toBe(true);
    }
    expect(limiter.allowCompletion('2001:db8::2')).toBe(false); // same /64
    expect(limiter.allowCompletion('203.0.113.8')).toBe(true);
    time += RESET_LIMIT_WINDOW_MS;
    expect(limiter.allowCompletion('2001:db8::1')).toBe(true);
  });
});
