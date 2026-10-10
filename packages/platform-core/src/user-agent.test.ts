import { describe, expect, it } from 'vitest';
import { describeUserAgent } from './user-agent';

describe('describeUserAgent', () => {
  it('names well-known browsers and systems only', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      ),
    ).toEqual({ browser: 'Chrome', system: 'Windows', mobile: false });
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ browser: 'Safari', system: 'iOS', mobile: true });
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0',
      ).browser,
    ).toBe('Edge');
    expect(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Firefox/131.0')).toEqual({
      browser: 'Firefox',
      system: 'Linux',
      mobile: false,
    });
    expect(describeUserAgent(null)).toEqual({ browser: null, system: null, mobile: false });
    expect(describeUserAgent('curl/8.0').browser).toBeNull();
    expect(describeUserAgent(`Chrome/1 ${'x'.repeat(600)}`).browser).toBeNull();
  });
});
