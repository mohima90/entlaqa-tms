import { describe, expect, it } from 'vitest';
import {
  characterCount,
  minFromParams,
  passwordRuleState,
  utf8Length,
  withMin,
} from './password-rules';

describe('live password rules (FR-IAM-13, T-M2-10)', () => {
  it("12 characters by default; the organization's longer minimum when given", () => {
    expect(passwordRuleState('a'.repeat(12), '')).toMatchObject({ min: 12, minLength: true });
    expect(passwordRuleState('a'.repeat(12), '', 16)).toMatchObject({ min: 16, minLength: false });
    expect(passwordRuleState('a'.repeat(16), 'a'.repeat(16), 16)).toEqual({
      min: 16,
      minLength: true,
      maxBytes: true,
      matches: true,
    });
  });

  it('counts characters, not bytes or UTF-16 units; the byte limit still applies', () => {
    const smile = String.fromCodePoint(0x1f600);
    expect(characterCount(smile.repeat(12))).toBe(12);
    expect(passwordRuleState(smile.repeat(12), '').minLength).toBe(true);
    // 36 Arabic letters fill the 72 bytes exactly; 37 are too many.
    expect(utf8Length('ك'.repeat(36))).toBe(72);
    expect(passwordRuleState('ك'.repeat(36), '', 36)).toMatchObject({
      minLength: true,
      maxBytes: true,
    });
    expect(passwordRuleState('ك'.repeat(37), '').maxBytes).toBe(false);
  });

  it('matches only when both are filled in and equal', () => {
    expect(passwordRuleState('', '').matches).toBe(false);
    expect(passwordRuleState('x', 'y').matches).toBe(false);
  });

  it('fills the minimum into a text, from the error when it says one', () => {
    expect(withMin('At least {min} characters', 16)).toBe('At least 16 characters');
    expect(withMin('{min} حرفًا على الأقل', 20)).toBe('20 حرفًا على الأقل');
    expect(minFromParams({ min: 20 }, 12)).toBe(20);
    expect(minFromParams(undefined, 12)).toBe(12);
    expect(minFromParams({ min: '20' }, 14)).toBe(14);
  });
});
