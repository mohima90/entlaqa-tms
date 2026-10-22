import { describe, expect, it } from 'vitest';
import { stepUpNeeded } from './step-up-view';

const NOW = new Date('2026-10-21T10:00:00Z');
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
const aal2 = (minutesAgo: number) => ({
  aal: 'aal2',
  amr: [{ method: 'totp', timestamp: seconds(NOW) - minutesAgo * 60 }],
});

describe('stepUpNeeded (ask for the code before editing, Q2-1)', () => {
  it('never asks for a permission that does not require AAL2 (every organization setting today)', () => {
    expect(stepUpNeeded({ requiresAal2: false }, { aal: 'aal1' }, NOW)).toBe(false);
    expect(stepUpNeeded({ requiresAal2: false }, null, NOW)).toBe(false);
  });

  it('asks at AAL1, or when the last code is older than 15 minutes', () => {
    expect(stepUpNeeded({ requiresAal2: true }, { aal: 'aal1' }, NOW)).toBe(true);
    expect(stepUpNeeded({ requiresAal2: true }, aal2(16), NOW)).toBe(true);
    expect(stepUpNeeded({ requiresAal2: true }, { aal: 'aal2', amr: [] }, NOW)).toBe(true);
  });

  it('does not ask with a fresh code, nor without claims (the preview)', () => {
    expect(stepUpNeeded({ requiresAal2: true }, aal2(5), NOW)).toBe(false);
    expect(stepUpNeeded({ requiresAal2: true }, null, NOW)).toBe(false);
  });
});
