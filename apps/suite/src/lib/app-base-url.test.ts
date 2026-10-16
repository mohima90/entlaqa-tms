import { describe, expect, it } from 'vitest';
import { originFromHost, parseAppBaseUrl } from './app-base-url';

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

describe('originFromHost', () => {
  it('builds the origin of the request host', () => {
    expect(originFromHost('tms.example.com')).toBe('https://tms.example.com');
    expect(originFromHost('localhost:3000')).toBe('http://localhost:3000');
    expect(originFromHost('127.0.0.1:3200')).toBe('http://127.0.0.1:3200');
  });

  it('refuses a malformed host', () => {
    for (const bad of [null, '', 'evil.test/path', 'a b', 'evil.test@x', 'x.test:99999999']) {
      expect(originFromHost(bad)).toBeNull();
    }
  });
});
