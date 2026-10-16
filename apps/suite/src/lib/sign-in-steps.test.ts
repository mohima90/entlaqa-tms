import { describe, expect, it, vi } from 'vitest';
import {
  SIGN_IN_METHOD_KEY,
  looksLikeEmail,
  readPreferredMethod,
  rememberMethod,
} from './sign-in-steps';

describe('sign-in steps (Kawadir two-step sign-in)', () => {
  it('lets a plausible e-mail through to the password step', () => {
    expect(looksLikeEmail(' noura@raya.example ')).toBe(true);
    for (const bad of [
      '',
      'noura',
      'noura@raya',
      'no ura@raya.example',
      `${'a'.repeat(250)}@b.cd`,
    ]) {
      expect(looksLikeEmail(bad)).toBe(false);
    }
  });

  it('remembers the last method; anything unknown or a storage error falls back to the password', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    };
    expect(readPreferredMethod(storage)).toBe('password');
    rememberMethod('password', storage);
    expect(store.get(SIGN_IN_METHOD_KEY)).toBe('password');
    store.set(SIGN_IN_METHOD_KEY, 'magic');
    expect(readPreferredMethod(storage)).toBe('password');
    const failing = {
      getItem: vi.fn(() => {
        throw new Error('denied');
      }),
      setItem: vi.fn(() => {
        throw new Error('denied');
      }),
    };
    expect(readPreferredMethod(failing)).toBe('password');
    expect(() => {
      rememberMethod('password', failing);
    }).not.toThrow();
    expect(readPreferredMethod(null)).toBe('password');
  });
});
