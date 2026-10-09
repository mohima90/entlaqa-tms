import { describe, expect, it, vi } from 'vitest';
import { UNKNOWN_CLIENT, clientAddress, clientRateKey } from './client-ip';
import { requestClientFrom } from './request-client';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn() }));

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

describe("requestClientFrom (the shared limiter's client key, T-M2-11)", () => {
  it('keys a trusted address (IPv6 by its /64), and gives no key without one', () => {
    expect(requestClientFrom(headersOf({ 'x-real-ip': '203.0.113.7' }), { VERCEL: '1' })).toEqual({
      key: '203.0.113.7',
    });
    expect(
      requestClientFrom(headersOf({ 'x-real-ip': '2001:db8:1:2::99' }), { VERCEL: '1' }),
    ).toEqual({ key: '2001:db8:1:2::/64' });
    // A header the platform does not overwrite (spoofable) mints no key: the shared one applies.
    expect(requestClientFrom(headersOf({ 'x-real-ip': '203.0.113.7' }), {})).toEqual({ key: null });
    expect(
      requestClientFrom(headersOf({ 'x-forwarded-for': '198.51.100.1' }), { VERCEL: '1' }),
    ).toEqual({ key: null });
  });
});
