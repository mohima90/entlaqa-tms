import { describe, expect, it } from 'vitest';
import { trialDaysLeft } from './trial-days';

describe('trialDaysLeft (WP-ADM-06)', () => {
  const now = new Date('2026-10-24T09:00:00Z');
  it('counts the whole days after today; 0 on the last day; never negative', () => {
    expect(trialDaysLeft(null, now)).toBeNull();
    expect(trialDaysLeft(new Date('2026-11-05T20:59:59Z'), now)).toBe(12);
    expect(trialDaysLeft(new Date('2026-10-24T20:59:59Z'), now)).toBe(0);
    expect(trialDaysLeft(new Date('2026-10-20T20:59:59Z'), now)).toBe(0);
  });
});
