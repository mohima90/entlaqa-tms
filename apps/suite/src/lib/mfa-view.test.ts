import { describe, expect, it } from 'vitest';
import { mfaPageMode, safeNextPath, stepUpHref } from './mfa-view';
import { describeUserAgent } from './user-agent';

describe('mfaPageMode (T-M2-10)', () => {
  const facts = { usesApp: false, sessionVerified: false, stepUp: false };

  it('the organization refuses the session: a code, or an app first', () => {
    expect(mfaPageMode({ ...facts, state: 'mfa_challenge', usesApp: true })).toBe('challenge');
    // (An app removed meanwhile: set one up.)
    expect(mfaPageMode({ ...facts, state: 'mfa_challenge' })).toBe('enrol');
    expect(mfaPageMode({ ...facts, state: 'mfa_enrol' })).toBe('enrol');
  });

  it('prompts while access is allowed; a sensitive action turns them into set-up', () => {
    expect(mfaPageMode({ ...facts, state: 'prompt_grace' })).toBe('prompt-grace');
    expect(mfaPageMode({ ...facts, state: 'prompt_admin' })).toBe('prompt-admin');
    expect(mfaPageMode({ ...facts, state: 'prompt_admin', stepUp: true })).toBe('enrol');
    expect(mfaPageMode({ ...facts, state: 'prompt_grace', stepUp: true })).toBe('enrol');
  });

  it('step-up for a sensitive action: a code with an app, set-up without; done when verified', () => {
    expect(mfaPageMode({ ...facts, state: 'ok' })).toBe('done');
    expect(mfaPageMode({ ...facts, state: 'ok', stepUp: true, usesApp: true })).toBe('challenge');
    expect(mfaPageMode({ ...facts, state: 'ok', stepUp: true })).toBe('enrol');
    expect(
      mfaPageMode({ ...facts, state: 'ok', stepUp: true, usesApp: true, sessionVerified: true }),
    ).toBe('done');
    expect(mfaPageMode({ ...facts, state: 'invalid', stepUp: true })).toBe('done');
    expect(mfaPageMode({ ...facts, state: 'ended' })).toBe('done');
  });
});

describe('safeNextPath', () => {
  it('only suite pages in a known language', () => {
    expect(safeNextPath('/ar/suite/admin/security')).toBe('/ar/suite/admin/security');
    expect(safeNextPath('/en/suite')).toBe('/en/suite');
    expect(
      safeNextPath('/en/suite/admin/users/a0000000-0000-4000-8000-000000000001/roles'),
    ).not.toBeNull();
    for (const bad of [
      'https://evil.example/ar/suite',
      '//evil.example',
      '/ar/suite/../../x',
      '/fr/suite',
      '/ar/sign-in',
      '/ar/suite?x=1',
      '/ar/suite/a b',
      undefined,
      ['/ar/suite'],
    ]) {
      expect(safeNextPath(bad), String(bad)).toBeNull();
    }
    expect(stepUpHref('ar', '/ar/suite/admin/security')).toBe(
      '/ar/mfa?next=%2Far%2Fsuite%2Fadmin%2Fsecurity',
    );
  });
});

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
