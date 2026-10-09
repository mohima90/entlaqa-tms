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

  it('refuses an unknown mode, missing or wrong connections, bad e-mail settings and a bad concurrency', () => {
    fails(['tick'], env, /unknown mode/);
    fails([], { ...env, DATABASE_URL_APP_QUEUE: undefined }, /DATABASE_URL_APP_QUEUE/);
    fails([], { ...env, DATABASE_URL_APP_QUEUE: '  ' }, /DATABASE_URL_APP_QUEUE/);
    fails([], { ...env, DATABASE_URL_APP_WORKER: undefined }, /DATABASE_URL_APP_WORKER/);
    fails([], { ...env, DATABASE_URL_APP_QUEUE: WORKER }, /app_queue/);
    fails([], { ...env, DATABASE_URL_APP_WORKER: QUEUE }, /app_worker/);
    fails([], { ...env, EMAIL_PROVIDER: 'resend' }, /EMAIL_FROM_ADDRESS/);
    fails([], { ...env, EMAIL_PROVIDER: undefined }, /EMAIL_PROVIDER must be set/);
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
