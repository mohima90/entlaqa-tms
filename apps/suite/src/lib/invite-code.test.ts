import { describe, expect, it } from 'vitest';
import { isCompleteInviteCode, typedInviteCode } from './invite-code';

describe('invitation code field', () => {
  it('upper-cases what is typed, drops spaces and dashes, keeps 8 characters', () => {
    expect(typedInviteCode('k7m2-pq9x')).toBe('K7M2PQ9X');
    expect(typedInviteCode(' k7m2 pq9x zz')).toBe('K7M2PQ9X');
    expect(typedInviteCode('ab')).toBe('AB');
  });

  it('looks up complete codes only (and older link tokens)', () => {
    expect(isCompleteInviteCode('K7M2PQ9X')).toBe(true);
    expect(isCompleteInviteCode('K7M2PQ9')).toBe(false);
    expect(isCompleteInviteCode('K7M2PQ9O')).toBe(false);
    expect(isCompleteInviteCode('k7m2pq9x')).toBe(false);
    expect(isCompleteInviteCode('A'.repeat(43))).toBe(true);
  });
});
