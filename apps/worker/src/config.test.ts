import { describe, expect, it } from 'vitest';
import {
  ADMIN_KEY_WARN_DAYS,
  ConfigurationError,
  type RunnerSettings,
  adminKeyDaysLeft,
  readSettings,
} from './config';

const QUEUE = 'postgres://app_queue:pw@127.0.0.1:5432/postgres';
const WORKER = 'postgres://app_worker:pw@127.0.0.1:5432/postgres';
const env = {
  DATABASE_URL_APP_QUEUE: QUEUE,
  DATABASE_URL_APP_WORKER: WORKER,
  EMAIL_PROVIDER: 'none',
};
const RESEND = {
  EMAIL_PROVIDER: 'resend',
  EMAIL_FROM_ADDRESS: 'noreply@lms.entlaqa.com',
  EMAIL_FROM_NAME: 'ENTLAQA LMS',
  RESEND_API_KEY: 're_testtesttest', // sample, not a key
  APP_BASE_URL: 'https://tms.example.com',
};
const CA = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
const noCa = () => undefined;
const runner = (argv: string[], values: NodeJS.ProcessEnv, ca: () => string | undefined = noCa) =>
  readSettings(argv, values, ca) as RunnerSettings;

function fails(argv: string[], values: NodeJS.ProcessEnv, pattern: RegExp) {
  let error: unknown;
  try {
    readSettings(argv, values, noCa);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ConfigurationError);
  expect((error as Error).message).toMatch(pattern);
}

describe('readSettings', () => {
  it('defaults to daemon mode with five jobs at a time; e-mail switched off when chosen', () => {
    const settings = runner([], env);
    expect(settings).toMatchObject({
      mode: 'daemon',
      queueUrl: QUEUE,
      workerUrl: WORKER,
      caPem: undefined,
      concurrency: 5,
      email: { provider: 'none' },
      appBaseUrl: undefined,
    });
  });

  it('one-pass mode runs two jobs at a time unless configured; e-mail settings are read', () => {
    expect(runner(['once'], { ...env, DATABASE_URL_APP_QUEUE: ` ${QUEUE} ` })).toMatchObject({
      mode: 'once',
      queueUrl: QUEUE,
      concurrency: 2,
    });
    expect(runner(['once'], { ...env, WORKER_CONCURRENCY: '8' }).concurrency).toBe(8);
    expect(runner(['once'], { ...env, ...RESEND }).email).toMatchObject({
      provider: 'resend',
      from: { name: 'ENTLAQA LMS', address: 'noreply@lms.entlaqa.com' },
    });
  });

  it('reads the web app origin for e-mail links: required with e-mail on, checked whenever set', () => {
    expect(runner(['once'], { ...env, ...RESEND }).appBaseUrl).toBe('https://tms.example.com');
    for (const [value, origin] of [
      ['https://TMS.example.com/', 'https://tms.example.com'],
      ['https://tms.example.com:8443', 'https://tms.example.com:8443'],
      ['http://localhost:3200/', 'http://localhost:3200'],
      ['http://127.0.0.1:3200', 'http://127.0.0.1:3200'],
    ] as const) {
      expect(runner([], { ...env, APP_BASE_URL: ` ${value} ` }).appBaseUrl).toBe(origin);
    }
    fails([], { ...env, ...RESEND, APP_BASE_URL: undefined }, /APP_BASE_URL must be set/);
    fails(
      ['once'],
      {
        ...env,
        EMAIL_PROVIDER: 'smtp',
        SMTP_URL: 'smtp://127.0.0.1:1025',
        EMAIL_FROM_ADDRESS: 'noreply@jadarat.example',
      },
      /APP_BASE_URL/,
    );
    for (const bad of [
      'http://tms.example.com',
      'ftp://tms.example.com',
      'tms.example.com',
      'https://tms.example.com/ar',
      'https://tms.example.com/?x=1',
      'https://tms.example.com?',
      'https://tms.example.com/#top',
      'https://user:secret@tms.example.com',
      'https://user@tms.example.com',
    ]) {
      let error: unknown;
      try {
        readSettings([], { ...env, APP_BASE_URL: bad }, noCa);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ConfigurationError);
      // Names the variable, never repeats the value (it could carry a credential).
      expect((error as Error).message).toMatch(/^APP_BASE_URL must be an https origin/);
      expect((error as Error).message).not.toContain('secret');
    }
  });

  it('reads the Auth admin API for reset links (T-M2-17): both or neither, the key never in an error', () => {
    expect(runner([], env).authAdmin).toBeUndefined();
    const KEY = 'sb_secret_sample_only_value'; // sample, not a key
    expect(
      runner([], {
        ...env,
        SUPABASE_URL: 'https://ref.supabase.co/',
        SUPABASE_SECRET_KEY: ` ${KEY} `,
      }).authAdmin,
    ).toEqual({ url: 'https://ref.supabase.co', secretKey: KEY });
    // Self-hosted: the gateway; local Supabase: plain http on the loopback.
    expect(
      runner([], { ...env, SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SECRET_KEY: KEY })
        .authAdmin?.url,
    ).toBe('http://127.0.0.1:54321');
    fails([], { ...env, SUPABASE_URL: 'https://ref.supabase.co' }, /must be set together/);
    fails([], { ...env, SUPABASE_SECRET_KEY: KEY }, /must be set together/);
    fails(
      [],
      { ...env, SUPABASE_URL: 'http://ref.supabase.co', SUPABASE_SECRET_KEY: KEY },
      /SUPABASE_URL must be an https origin/,
    );
    for (const bad of ['short', 'sb_secret with spaces inside it']) {
      let error: unknown;
      try {
        readSettings(
          [],
          { ...env, SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SECRET_KEY: bad },
          noCa,
        );
      } catch (e) {
        error = e;
      }
      expect((error as Error).message).toBe('SUPABASE_SECRET_KEY is not a valid key');
    }
  });

  it('remote hosts need the CA', () => {
    const remote = {
      DATABASE_URL_APP_QUEUE: 'postgres://app_queue.ref:pw@pooler.example.com:5432/postgres',
      DATABASE_URL_APP_WORKER: 'postgres://app_worker.ref:pw@pooler.example.com:5432/postgres',
      EMAIL_PROVIDER: 'none',
    };
    expect(runner(['once'], remote, () => CA).caPem).toBe(CA);
    expect(() => readSettings(['once'], remote, noCa)).toThrow(/DATABASE_CA_CERT/);
  });

  it('test-email mode needs a provider and a recipient, not the database', () => {
    expect(
      readSettings(
        ['test-email'],
        { ...RESEND, APP_BASE_URL: undefined, EMAIL_TEST_TO: 'po@example.com' },
        noCa,
      ),
    ).toMatchObject({
      mode: 'test-email',
      testTo: 'po@example.com',
      email: { provider: 'resend' },
    });
    fails(['test-email'], { EMAIL_TEST_TO: 'po@example.com' }, /EMAIL_PROVIDER/);
    fails(
      ['test-email'],
      { EMAIL_PROVIDER: 'none', EMAIL_TEST_TO: 'po@example.com' },
      /EMAIL_PROVIDER must be set to send/,
    );
    fails(['test-email'], RESEND, /EMAIL_TEST_TO/);
    fails(['test-email'], { ...RESEND, EMAIL_TEST_TO: 'not-an-address' }, /EMAIL_TEST_TO/);
  });

  it('EMAIL_CREDENTIALS_KEY (secret): the key pair for settings saved in the product; checked, never echoed', () => {
    const secret = 'a-generated-64-character-secret-for-the-config-tests-0123456789';
    expect(runner([], env).emailCredentials).toBeNull();
    const settings = runner([], {
      ...env,
      EMAIL_CREDENTIALS_KEY: secret,
      APP_BASE_URL: 'https://tms.example.com',
    });
    expect(settings.emailCredentials?.publicKey.keyId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(JSON.stringify(settings)).not.toContain(secret);
    // E-mail can be sent: links need the web app's origin.
    fails(
      [],
      { ...env, EMAIL_CREDENTIALS_KEY: secret },
      /APP_BASE_URL must be set when e-mail can be sent/,
    );
    let message = '';
    try {
      readSettings([], { ...env, EMAIL_CREDENTIALS_KEY: 'short-secret-value' }, noCa);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('EMAIL_CREDENTIALS_KEY must be at least 32 characters');
    expect(runner([], { ...env, EMAIL_CREDENTIALS_KEY: '  ' }).emailCredentials).toBeNull();
  });

  it('refuses an unknown mode, missing or wrong connections, bad e-mail settings and a bad concurrency', () => {
    fails(['tick'], env, /unknown mode/);
    fails([], { ...env, DATABASE_URL_APP_QUEUE: undefined }, /DATABASE_URL_APP_QUEUE/);
    fails([], { ...env, DATABASE_URL_APP_QUEUE: '  ' }, /DATABASE_URL_APP_QUEUE/);
    fails([], { ...env, DATABASE_URL_APP_WORKER: undefined }, /DATABASE_URL_APP_WORKER/);
    fails([], { ...env, DATABASE_URL_APP_QUEUE: WORKER }, /app_queue/);
    fails([], { ...env, DATABASE_URL_APP_WORKER: QUEUE }, /app_worker/);
    fails([], { ...env, EMAIL_PROVIDER: 'resend' }, /EMAIL_FROM_ADDRESS/);
    // Unset: no installation sender (the sender is set in the product, WP-ADM-01).
    expect(runner([], { ...env, EMAIL_PROVIDER: undefined }).email.provider).toBe('none');
    for (const bad of ['0', '51', '2.5', 'many']) {
      fails([], { ...env, WORKER_CONCURRENCY: bad }, /WORKER_CONCURRENCY/);
    }
    expect(() =>
      readSettings([], env, () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- a non-Error throw is the case under test
        throw 'unreadable';
      }),
    ).toThrow('invalid configuration');
  });
});

describe('adminKeyDaysLeft (T-M2-17, security review)', () => {
  const NOW = Date.UTC(2026, 9, 8, 12);
  const DAY = 86_400;
  // Built at run time from a header and a payload: no token-shaped literal in the source.
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = (payload: unknown) =>
    `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(payload)}.${'sample0signature'.padEnd(40, '0')}`;
  const exp = (days: number) => NOW / 1000 + days * DAY;

  it('counts whole days until a self-hosted token expires (decode only), negative once expired', () => {
    expect(adminKeyDaysLeft(token({ role: 'service_role', exp: exp(90) }), NOW)).toBe(90);
    expect(adminKeyDaysLeft(token({ exp: exp(29.5) }), NOW)).toBe(29);
    expect(adminKeyDaysLeft(token({ exp: exp(29.5) }), NOW)).toBeLessThan(ADMIN_KEY_WARN_DAYS);
    expect(adminKeyDaysLeft(token({ exp: exp(30) }), NOW)).toBe(ADMIN_KEY_WARN_DAYS);
    expect(adminKeyDaysLeft(token({ exp: exp(-1) }), NOW)).toBe(-1);
  });

  it('has nothing to say about a Supabase secret key or a token without a readable expiry', () => {
    for (const key of [
      'sb_secret_sample_only_value',
      token({ role: 'service_role' }),
      token({ exp: 'soon' }),
      token(null),
      token(7),
      `${b64({ alg: 'ES256' })}.not-json.${'sample0signature'.padEnd(40, '0')}`,
      'a.b',
      'a.b.c.d',
    ]) {
      expect(adminKeyDaysLeft(key, NOW)).toBeUndefined();
    }
  });
});

describe('readSettings: malware scanner (T-M2-18)', () => {
  it('reads CLAMD_HOST and CLAMD_PORT (default 3310); absent means no scanning', () => {
    expect(runner([], env).scanner).toBeUndefined();
    expect(runner([], { ...env, CLAMD_HOST: 'clamd' }).scanner).toEqual({
      host: 'clamd',
      port: 3310,
      maxSignatureAgeDays: 7,
    });
    expect(runner([], { ...env, CLAMD_HOST: '10.0.0.5', CLAMD_PORT: '3311' }).scanner).toEqual({
      host: '10.0.0.5',
      port: 3311,
      maxSignatureAgeDays: 7,
    });
  });

  it("reads the hard limit on the signatures' age (default 7 days, at most 365)", () => {
    expect(
      runner([], { ...env, CLAMD_HOST: 'clamd', FILE_SCAN_SIGNATURES_MAX_AGE_DAYS: '3' }).scanner
        ?.maxSignatureAgeDays,
    ).toBe(3);
    expect(
      runner([], {
        ...env,
        CLAMD_HOST: 'clamd',
        FILE_SCAN_SIGNATURES_MAX_AGE_DAYS: '365',
        FILE_SCAN_SIGNATURES_TEST_OVERRIDE: '1',
        JADARAT_ENVIRONMENT: 'self-hosted',
      }).scanner?.maxSignatureAgeDays,
    ).toBe(365);
    for (const value of ['0', '366', '7.5', 'x']) {
      fails(
        [],
        { ...env, CLAMD_HOST: 'clamd', FILE_SCAN_SIGNATURES_MAX_AGE_DAYS: value },
        /FILE_SCAN_SIGNATURES_MAX_AGE_DAYS must be a whole number of days from 1 to 365/,
      );
    }
    fails(
      [],
      { ...env, FILE_SCAN_SIGNATURES_MAX_AGE_DAYS: '30' },
      /FILE_SCAN_SIGNATURES_MAX_AGE_DAYS is set without CLAMD_HOST/,
    );
  });

  it('raises it above 7 days only with the test override, never in production (re-review L-D)', () => {
    const raised = { ...env, CLAMD_HOST: 'clamd', FILE_SCAN_SIGNATURES_MAX_AGE_DAYS: '30' };
    fails([], raised, /above 7 needs FILE_SCAN_SIGNATURES_TEST_OVERRIDE=1/);
    fails(
      [],
      { ...raised, FILE_SCAN_SIGNATURES_TEST_OVERRIDE: 'yes' },
      /needs FILE_SCAN_SIGNATURES_TEST_OVERRIDE=1/,
    );
    for (const environment of ['production', 'Prod-KSA', 'prd', 'live']) {
      fails(
        [],
        { ...raised, FILE_SCAN_SIGNATURES_TEST_OVERRIDE: '1', JADARAT_ENVIRONMENT: environment },
        /refused in a production environment/,
      );
    }
    // The scanner check reads the same settings.
    fails(
      ['scanner-check'],
      { CLAMD_HOST: 'clamd', FILE_SCAN_SIGNATURES_MAX_AGE_DAYS: '30' },
      /needs FILE_SCAN_SIGNATURES_TEST_OVERRIDE=1/,
    );
    // Up to the 7-day default nothing else is needed, in any environment.
    expect(
      runner([], {
        ...env,
        CLAMD_HOST: 'clamd',
        FILE_SCAN_SIGNATURES_MAX_AGE_DAYS: '7',
        JADARAT_ENVIRONMENT: 'production',
      }).scanner?.maxSignatureAgeDays,
    ).toBe(7);
  });

  it('refuses a port without host, a bad host or port', () => {
    fails([], { ...env, CLAMD_PORT: '3310' }, /CLAMD_PORT is set without CLAMD_HOST/);
    fails([], { ...env, CLAMD_HOST: 'clamd;rm' }, /CLAMD_HOST must be/);
    fails([], { ...env, CLAMD_HOST: 'clamd', CLAMD_PORT: '70000' }, /CLAMD_PORT must be/);
    fails([], { ...env, CLAMD_HOST: 'clamd', CLAMD_PORT: 'x' }, /CLAMD_PORT must be/);
  });

  it('scanner-check needs only the scanner (no database, no e-mail)', () => {
    expect(readSettings(['scanner-check'], { CLAMD_HOST: 'clamd' }, noCa)).toEqual({
      mode: 'scanner-check',
      scanner: { host: 'clamd', port: 3310, maxSignatureAgeDays: 7 },
    });
    fails(['scanner-check'], {}, /CLAMD_HOST must be set/);
    fails(['scan'], env, /expected daemon, once, test-email or scanner-check/);
  });
});

describe('readSettings: the orphan sweep (T-M2-18, re-review L-C)', () => {
  it('is on with a brake of 500 orphans or 10 % of all objects by default', () => {
    expect(runner([], env).orphanSweep).toEqual({
      enabled: true,
      maxOrphans: 500,
      maxSharePercent: 10,
    });
  });

  it('can be paused, and its brake set', () => {
    expect(
      runner([], {
        ...env,
        FILE_ORPHAN_SWEEP: 'OFF',
        FILE_ORPHAN_SWEEP_MAX: '2000',
        FILE_ORPHAN_SWEEP_MAX_SHARE: '2',
      }).orphanSweep,
    ).toEqual({ enabled: false, maxOrphans: 2000, maxSharePercent: 2 });
  });

  it('refuses anything else', () => {
    fails([], { ...env, FILE_ORPHAN_SWEEP: 'paused' }, /FILE_ORPHAN_SWEEP must be on or off/);
    fails(
      [],
      { ...env, FILE_ORPHAN_SWEEP_MAX: '0' },
      /FILE_ORPHAN_SWEEP_MAX must be a whole number/,
    );
    fails(
      [],
      { ...env, FILE_ORPHAN_SWEEP_MAX_SHARE: '101' },
      /FILE_ORPHAN_SWEEP_MAX_SHARE must be/,
    );
    fails(
      [],
      { ...env, FILE_ORPHAN_SWEEP_MAX_SHARE: '2.5' },
      /FILE_ORPHAN_SWEEP_MAX_SHARE must be/,
    );
  });
});

describe('readSettings: import invitations (T-M2-12, security review M2)', () => {
  it('defaults to one a second platform-wide, 5000 a day per organization and 200 on trial', () => {
    expect(runner([], env).importSending).toEqual({
      intervalMs: 1000,
      dailyCap: 5000,
      trialDailyCap: 200,
    });
    expect(
      runner([], {
        ...env,
        USER_IMPORT_INVITATION_INTERVAL_MS: '500',
        USER_IMPORT_DAILY_INVITATIONS: '20000',
        USER_IMPORT_TRIAL_DAILY_INVITATIONS: '50',
      }).importSending,
    ).toEqual({ intervalMs: 500, dailyCap: 20000, trialDailyCap: 50 });
    // A daily number below the trial default lowers the trial one with it.
    expect(runner([], { ...env, USER_IMPORT_DAILY_INVITATIONS: '100' }).importSending).toEqual({
      intervalMs: 1000,
      dailyCap: 100,
      trialDailyCap: 100,
    });
  });

  it('refuses a pace or daily number out of range, and a trial number above the other', () => {
    // At least 500 ms: Resend allows 2 requests a second for the whole account.
    for (const value of ['499', '100', '60001', '1.5', 'x']) {
      fails(
        [],
        { ...env, USER_IMPORT_INVITATION_INTERVAL_MS: value },
        /USER_IMPORT_INVITATION_INTERVAL_MS must be a whole number of milliseconds from 500 to 60000/,
      );
    }
    expect(
      runner([], { ...env, USER_IMPORT_INVITATION_INTERVAL_MS: '500' }).importSending.intervalMs,
    ).toBe(500);
    for (const value of ['0', '100001', '-5']) {
      fails(
        [],
        { ...env, USER_IMPORT_DAILY_INVITATIONS: value },
        /USER_IMPORT_DAILY_INVITATIONS must be a whole number of invitations from 1 to 100000/,
      );
    }
    fails(
      [],
      { ...env, USER_IMPORT_DAILY_INVITATIONS: '100', USER_IMPORT_TRIAL_DAILY_INVITATIONS: '101' },
      /USER_IMPORT_TRIAL_DAILY_INVITATIONS must not be higher than USER_IMPORT_DAILY_INVITATIONS/,
    );
  });
});
