import { appError, err, ok } from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { EmailSettingsError, type PlatformEmailView } from '@jadarat/platform-db';
import { credentialsContext, sealedKeyId } from '@jadarat/platform-notifications';
// Test only: the worker's side, to prove what the console sealed opens there (and nowhere else).
import { deriveCredentialsKeyPair } from '@jadarat/platform-notifications/jobs';
import { describe, expect, it, vi } from 'vitest';
import {
  type PlatformEmailConsoleDeps,
  type PlatformEmailInput,
  loadPlatformEmailSettings,
  savePlatformEmailSettingsFromConsole,
} from './platform-email-console';

vi.mock('server-only', () => ({}));

const claims = brandVerifiedClaims({
  sub: '00000000-0000-4000-8000-0000000000f1',
  role: 'authenticated',
  aal: 'aal1',
  session_id: '10000000-0000-4000-8000-00000000fa01',
});
if (!claims.ok) throw new Error('fixture');
const CLAIMS = claims.value;
const KEYS = deriveCredentialsKeyPair(
  'a-generated-64-character-secret-for-the-console-tests-012345678',
);
const VIEW: PlatformEmailView = {
  available: true,
  keyReady: true,
  sender: null,
  waitingCount: 3,
  oldestWaitingAt: null,
  platformFailed24h: 0,
};
const INPUT: PlatformEmailInput = {
  version: null,
  provider: { provider: 'resend', options: {}, secrets: { apiKey: 're_platform_key_1' } },
  fromName: 'ENTLAQA',
  fromAddress: 'no-reply@jadarat.example',
  testTo: 'ops@entlaqa.example',
};

function setup(
  options: { admin?: boolean; signedOut?: boolean; refuse?: unknown; key?: boolean } = {},
) {
  const strict: boolean[] = [];
  const deps: PlatformEmailConsoleDeps = {
    getClaims: vi.fn(({ strict: s }: { readonly strict: boolean }) => {
      strict.push(s);
      return Promise.resolve(options.signedOut ? err(appError('UNAUTHENTICATED')) : ok(CLAIMS));
    }),
    withUserTx: ((_c: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn('tx')) as PlatformEmailConsoleDeps['withUserTx'],
    isPlatformAdmin: vi.fn(() => Promise.resolve(options.admin ?? true)),
    getPlatformEmailSettings: vi.fn(() =>
      options.refuse ? Promise.reject(options.refuse as Error) : Promise.resolve(VIEW),
    ),
    savePlatformEmailSettings: vi.fn(() =>
      options.refuse ? Promise.reject(options.refuse as Error) : Promise.resolve(1),
    ),
    getEmailCredentialsPublicKey: vi.fn(() =>
      Promise.resolve(options.key === false ? null : KEYS.publicKey),
    ),
  };
  return { deps, strict };
}
const parse = (raw: unknown) => ok(raw as PlatformEmailInput);
const notFound = { ok: false, error: expect.objectContaining({ code: 'NOT_FOUND' }) };

describe('Platform settings → Email (Super Admin console, WP-ADM-01)', () => {
  it('deny by default: signed out, not a Super Admin, or refused by the database → 404, nothing saved', async () => {
    for (const options of [{ signedOut: true }, { admin: false }]) {
      const { deps } = setup(options);
      expect(await loadPlatformEmailSettings(deps)).toEqual(notFound);
      expect(await savePlatformEmailSettingsFromConsole(deps, INPUT, parse)).toEqual(notFound);
      expect(deps.savePlatformEmailSettings).not.toHaveBeenCalled();
      expect(deps.getEmailCredentialsPublicKey).not.toHaveBeenCalled();
    }
    const refused = setup({ refuse: new EmailSettingsError('EMAIL_SETTINGS_FORBIDDEN') });
    expect(await loadPlatformEmailSettings(refused.deps)).toEqual(notFound);
    expect(await savePlatformEmailSettingsFromConsole(refused.deps, INPUT, parse)).toEqual(
      notFound,
    );
  });

  it('the input is parsed only after the access check (review L6)', async () => {
    const parser = vi.fn(() => err(appError('VALIDATION_FAILED')));
    await savePlatformEmailSettingsFromConsole(
      setup({ admin: false }).deps,
      { junk: true },
      parser,
    );
    expect(parser).not.toHaveBeenCalled();
    expect(
      await savePlatformEmailSettingsFromConsole(setup().deps, { junk: true }, parser),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('loads the sender and the waiting count; saves with a confirmed session, the secrets sealed for the worker', async () => {
    const { deps, strict } = setup();
    expect(await loadPlatformEmailSettings(deps)).toEqual({ ok: true, value: VIEW });
    expect(await savePlatformEmailSettingsFromConsole(deps, INPUT, parse)).toEqual({
      ok: true,
      value: { version: 1 },
    });
    expect(strict).toEqual([false, true]);
    const sent = vi.mocked(deps.savePlatformEmailSettings).mock.calls[0]?.[1];
    expect(sent).toMatchObject({
      provider: 'resend',
      fromName: 'ENTLAQA',
      testTo: 'ops@entlaqa.example',
      version: null,
    });
    expect(sealedKeyId(sent?.credentialsSealed ?? '')).toBe(KEYS.publicKey.keyId);
    expect(sent?.credentialsSealed).not.toContain('re_platform_key_1');
    expect(
      KEYS.open(sent?.credentialsSealed ?? '', credentialsContext({ kind: 'platform' }, 'resend')),
    ).toEqual({
      apiKey: 're_platform_key_1',
    });
  });

  it('keeps the saved secrets when left empty; not set up without the worker key; refusals mapped', async () => {
    const keep = setup();
    await savePlatformEmailSettingsFromConsole(
      keep.deps,
      { ...INPUT, version: 2, provider: { ...INPUT.provider, secrets: null } },
      parse,
    );
    expect(vi.mocked(keep.deps.savePlatformEmailSettings).mock.calls[0]?.[1]).toMatchObject({
      credentialsSealed: null,
      version: 2,
    });
    expect(keep.deps.getEmailCredentialsPublicKey).not.toHaveBeenCalled();
    expect(
      await savePlatformEmailSettingsFromConsole(setup({ key: false }).deps, INPUT, parse),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: [{ path: 'form', code: 'NOT_SET_UP' }] },
    });
    for (const [error, expected] of [
      [new EmailSettingsError('EMAIL_SETTINGS_CONFLICT'), { code: 'CONFLICT_VERSION' }],
      [
        new EmailSettingsError('EMAIL_SETTINGS_KEY_CHANGED'),
        { fieldErrors: [{ path: 'form', code: 'KEY_CHANGED' }] },
      ],
      [
        new EmailSettingsError('EMAIL_SETTINGS_INVALID', { field: 'test_to' }),
        { fieldErrors: [{ path: 'testTo', code: 'INVALID' }] },
      ],
    ] as const) {
      expect(
        await savePlatformEmailSettingsFromConsole(setup({ refuse: error }).deps, INPUT, parse),
      ).toMatchObject({
        ok: false,
        error: expected,
      });
    }
    await expect(
      savePlatformEmailSettingsFromConsole(
        setup({ refuse: new Error('db down') }).deps,
        INPUT,
        parse,
      ),
    ).rejects.toThrow('db down');
  });
});
