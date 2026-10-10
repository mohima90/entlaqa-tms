import { describe, expect, it } from 'vitest';
import { mayContinueWithoutApp, mfaPageMode, safeNextPath, stepUpHref } from './mfa-view';

describe('mfaPageMode (T-M2-10)', () => {
  const facts = {
    usesApp: false,
    pendingHere: false,
    pendingElsewhere: false,
    verified: false,
    stepUp: false,
  };

  it('the organization refuses the session: a code, or an app first', () => {
    expect(mfaPageMode({ ...facts, state: 'mfa_challenge', usesApp: true })).toBe('challenge');
    // (An app removed meanwhile: set one up.)
    expect(mfaPageMode({ ...facts, state: 'mfa_challenge' })).toBe('enrol');
    expect(mfaPageMode({ ...facts, state: 'mfa_enrol' })).toBe('enrol');
  });

  it("this window's app waiting for the e-mailed code (re-review N1): the code page, never a new set-up", () => {
    const here = { ...facts, pendingHere: true };
    for (const state of ['mfa_enrol', 'mfa_challenge', 'prompt_grace', 'prompt_admin'] as const) {
      expect(mfaPageMode({ ...here, state }), state).toBe('pending');
      expect(mfaPageMode({ ...here, state, stepUp: true }), state).toBe('pending');
    }
    // Also when nothing requires an app: the code makes it count.
    expect(mfaPageMode({ ...here, state: 'ok' })).toBe('pending');
    expect(mfaPageMode({ ...here, state: 'ok', stepUp: true })).toBe('pending');
  });

  it('an app added from another sign-in comes first, wherever the session stands (re-review N1)', () => {
    const elsewhere = { ...facts, pendingElsewhere: true };
    for (const state of [
      'mfa_enrol',
      'mfa_challenge',
      'prompt_grace',
      'prompt_admin',
      'ok',
    ] as const) {
      expect(mfaPageMode({ ...elsewhere, state }), state).toBe('pending-elsewhere');
      expect(mfaPageMode({ ...elsewhere, state, pendingHere: true }), state).toBe(
        'pending-elsewhere',
      );
    }
    // A confirmed app answers the organization's challenge and sensitive actions as before.
    expect(mfaPageMode({ ...elsewhere, state: 'mfa_challenge', usesApp: true })).toBe('challenge');
  });

  it('may continue without the app only where nothing requires one', () => {
    expect(mayContinueWithoutApp('prompt_grace', false)).toBe(true);
    expect(mayContinueWithoutApp('prompt_admin', false)).toBe(true);
    expect(mayContinueWithoutApp('ok', false)).toBe(true);
    expect(mayContinueWithoutApp('prompt_admin', true)).toBe(false);
    expect(mayContinueWithoutApp('ok', true)).toBe(false);
    expect(mayContinueWithoutApp('mfa_enrol', false)).toBe(false);
    expect(mayContinueWithoutApp('mfa_challenge', false)).toBe(false);
  });

  it('prompts while access is allowed; a sensitive action turns them into set-up', () => {
    expect(mfaPageMode({ ...facts, state: 'prompt_grace' })).toBe('prompt-grace');
    expect(mfaPageMode({ ...facts, state: 'prompt_admin' })).toBe('prompt-admin');
    expect(mfaPageMode({ ...facts, state: 'prompt_admin', stepUp: true })).toBe('enrol');
    expect(mfaPageMode({ ...facts, state: 'prompt_grace', stepUp: true })).toBe('enrol');
  });

  it('step-up for a sensitive action: a code with an app (again when older than 15 minutes), set-up without', () => {
    expect(mfaPageMode({ ...facts, state: 'ok' })).toBe('done');
    expect(mfaPageMode({ ...facts, state: 'ok', usesApp: true })).toBe('done');
    expect(mfaPageMode({ ...facts, state: 'ok', stepUp: true, usesApp: true })).toBe('challenge');
    expect(mfaPageMode({ ...facts, state: 'ok', stepUp: true })).toBe('enrol');
    expect(
      mfaPageMode({ ...facts, state: 'ok', stepUp: true, usesApp: true, verified: true }),
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
