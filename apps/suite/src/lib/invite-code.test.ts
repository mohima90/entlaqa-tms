import { describe, expect, it } from 'vitest';
import { displayInviteCode, isCompleteInviteCode, typedInviteCode } from './invite-code';

describe('invitation code field', () => {
  it('upper-cases what is typed, drops spaces and dashes, keeps 12 characters', () => {
    expect(typedInviteCode('k7m2-pq9x-ht4w')).toBe('K7M2PQ9XHT4W');
    expect(typedInviteCode(' k7m2 pq9x ht4w zz')).toBe('K7M2PQ9XHT4W');
    expect(typedInviteCode('K7M2–PQ9X')).toBe('K7M2PQ9X');
    expect(typedInviteCode('ab')).toBe('AB');
  });

  it('shows codes grouped XXXX-XXXX-XXXX (partial codes as far as they go)', () => {
    expect(displayInviteCode('K7M2PQ9XHT4W')).toBe('K7M2-PQ9X-HT4W');
    expect(displayInviteCode('K7M2PQ')).toBe('K7M2-PQ');
    expect(displayInviteCode('')).toBe('');
    expect(displayInviteCode('A'.repeat(43))).toBe('A'.repeat(43));
  });

  it('looks up complete codes only (and older link tokens)', () => {
    expect(isCompleteInviteCode('K7M2PQ9XHT4W')).toBe(true);
    expect(isCompleteInviteCode('K7M2PQ9X')).toBe(false);
    expect(isCompleteInviteCode('K7M2PQ9XHT4')).toBe(false);
    expect(isCompleteInviteCode('K7M2PQ9XHT4O')).toBe(false);
    expect(isCompleteInviteCode('k7m2pq9xht4w')).toBe(false);
    expect(isCompleteInviteCode('K7M2-PQ9X-HT4W')).toBe(false);
    expect(isCompleteInviteCode('A'.repeat(43))).toBe(true);
  });
});
