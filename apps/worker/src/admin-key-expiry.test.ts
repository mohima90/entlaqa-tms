import { describe, expect, it, vi } from 'vitest';
import { adminKeyExpiryCheck } from './admin-key-expiry';

const START = Date.UTC(2026, 9, 8, 12);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Built at run time from a header and a payload: no token-shaped literal in the source.
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (expiresInDays: number) =>
  `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({ role: 'service_role', exp: START / 1000 + expiresInDays * 86_400 })}.${'sample0signature'.padEnd(40, '0')}`;

function clockAt(start: number) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('adminKeyExpiryCheck (T-M2-17 security review)', () => {
  it('warns at start-up, then at most once a day however often it runs, with the days left only', () => {
    const clock = clockAt(START);
    const warn = vi.fn();
    const check = adminKeyExpiryCheck(token(29.5), warn, clock.now);
    check();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenLastCalledWith(29);
    for (let minute = 0; minute < 60 * 23; minute += 1) {
      clock.advance(60_000);
      check();
    }
    expect(warn).toHaveBeenCalledTimes(1);
    clock.advance(DAY);
    check();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(27);
    // Expired: negative days, still once a day (29.5 days − 47 hours − 28 days).
    clock.advance(28 * DAY);
    check();
    expect(warn).toHaveBeenLastCalledWith(-1);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.flat().every((value) => typeof value === 'number')).toBe(true);
  });

  it('stays silent with 30 days or more left, and for a key without an expiry', () => {
    const clock = clockAt(START);
    const warn = vi.fn();
    const check = adminKeyExpiryCheck(token(90), warn, clock.now);
    check();
    clock.advance(59 * DAY); // 31 days left
    check();
    expect(warn).not.toHaveBeenCalled();
    clock.advance(DAY); // 30 days left: still fine
    check();
    expect(warn).not.toHaveBeenCalled();
    clock.advance(DAY); // 29 days left
    check();
    expect(warn).toHaveBeenCalledWith(29);

    const supabaseKey = vi.fn();
    const checkSupabase = adminKeyExpiryCheck(
      'sb_secret_sample_only_value',
      supabaseKey,
      clock.now,
    );
    checkSupabase();
    clock.advance(DAY);
    checkSupabase();
    expect(supabaseKey).not.toHaveBeenCalled();
  });
});
