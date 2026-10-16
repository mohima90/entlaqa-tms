import { describe, expect, it } from 'vitest';
import { parseAppBaseUrl } from './app-base-url';

describe('parseAppBaseUrl', () => {
  it('takes an https origin (or http for localhost)', () => {
    expect(parseAppBaseUrl('https://tms.example.com')).toBe('https://tms.example.com');
    expect(parseAppBaseUrl(' https://tms.example.com/ ')).toBe('https://tms.example.com');
    expect(parseAppBaseUrl('http://localhost:3200')).toBe('http://localhost:3200');
  });

  it('refuses anything else', () => {
    for (const bad of [
      undefined,
      '',
      'tms.example.com',
      'http://tms.example.com',
      'https://tms.example.com/app',
      'https://user:pw@tms.example.com',
      'https://tms.example.com/?x=1',
      'javascript:alert(1)',
    ]) {
      expect(parseAppBaseUrl(bad)).toBeNull();
    }
  });
});
