import {
  DATABASE_URL_ENV,
  assertConnectionRole,
  readDatabaseCaPem,
  tlsOptionsFor,
} from '@jadarat/platform-db';
import type { InvitationSending } from '@jadarat/platform-db/jobs';
import { DEFAULT_INVITATION_SENDING } from '@jadarat/platform-import/jobs';
import { DATABASE_URL_APP_QUEUE_ENV, assertQueueRole } from '@jadarat/platform-jobs/jobs';
import { isEmailAddress } from '@jadarat/platform-notifications';
import { type EmailSettings, readEmailSettings } from '@jadarat/platform-notifications/jobs';

export type WorkerMode = 'daemon' | 'once' | 'test-email' | 'scanner-check';

/** The malware scanner (clamd, ADR 0006 §8): CLAMD_HOST and CLAMD_PORT (default 3310). */
export interface ScannerSettings {
  readonly host: string;
  readonly port: number;
  /**
   * FILE_SCAN_SIGNATURES_MAX_AGE_DAYS (default 7): older (or undated) signatures and nothing is scanned.
   * Above 7 only with FILE_SCAN_SIGNATURES_TEST_OVERRIDE=1 — test installations whose signatures are
   * pinned (the smoke test) — and never in a production environment (the worker warns at start-up).
   */
  readonly maxSignatureAgeDays: number;
}

export interface RunnerSettings {
  readonly mode: 'daemon' | 'once';
  /** Queue connection (login role app_queue). */
  readonly queueUrl: string;
  /** Tenant work of the jobs (login role app_worker, withSystemTx). */
  readonly workerUrl: string;
  readonly caPem: string | undefined;
  readonly concurrency: number;
  readonly email: EmailSettings;
  /**
   * Public origin of the web app for links in e-mails (invitation accept links), without trailing
   * slash. Required when e-mail is on; without it (e-mail off) invitations are not mailed.
   */
  readonly appBaseUrl: string | undefined;
  /**
   * The Auth admin API for password-reset links (T-M2-17): SUPABASE_URL and SUPABASE_SECRET_KEY, in the
   * worker's environment ONLY (never the web app's, ADR 0002 §7). Undefined when not set: reset requests
   * queued by the web app (PASSWORD_RESET_DELIVERY=worker) then wait and expire unanswered.
   */
  readonly authAdmin: { readonly url: string; readonly secretKey: string } | undefined;
  /**
   * The malware scanner for uploaded files (T-M2-18; CLAMD_HOST, CLAMD_PORT). The file tasks also need
   * Storage (the same SUPABASE_URL + SUPABASE_SECRET_KEY): housekeeping runs with Storage alone, the scan
   * with Storage AND the scanner. Without the scanner, uploaded files wait unscanned (never clean).
   */
  readonly scanner: ScannerSettings | undefined;
  /**
   * The file housekeeping's orphan sweep (T-M2-18): FILE_ORPHAN_SWEEP (on | off, default on — off while a
   * restore is reconciled), FILE_ORPHAN_SWEEP_MAX (default 500 orphans) and FILE_ORPHAN_SWEEP_MAX_SHARE
   * (default 10 % of all objects): above either brake nothing is removed and an error is logged.
   */
  readonly orphanSweep: OrphanSweepSettings;
  /**
   * Sending the invitations of bulk user imports (T-M2-12, security review M2): the platform-wide pace
   * (USER_IMPORT_INVITATION_INTERVAL_MS, default 1000, at least 500) and the daily numbers per organization in service
   * and on trial (USER_IMPORT_DAILY_INVITATIONS, default 5000; USER_IMPORT_TRIAL_DAILY_INVITATIONS,
   * default 200). Every worker of a deployment should use the same values.
   */
  readonly importSending: InvitationSending;
}

export interface OrphanSweepSettings {
  readonly enabled: boolean;
  readonly maxOrphans: number;
  readonly maxSharePercent: number;
}

/** Operators' check of the malware scanner: PING, VERSION and the signatures' age, no database. */
export interface ScannerCheckSettings {
  readonly mode: 'scanner-check';
  readonly scanner: ScannerSettings;
}

/** Operators' check of the e-mail settings: one sample message to EMAIL_TEST_TO, no database. */
export interface TestEmailSettings {
  readonly mode: 'test-email';
  readonly email: EmailSettings;
  readonly testTo: string;
}

export type WorkerSettings = RunnerSettings | TestEmailSettings | ScannerCheckSettings;

/** A configuration problem; its message is ours (names variables, never values) and safe to log. */
export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
}

const read = (env: NodeJS.ProcessEnv, name: string) => {
  const value = env[name]?.trim();
  return value === '' ? undefined : value;
};

function check<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new ConfigurationError(error instanceof Error ? error.message : 'invalid configuration');
  }
}

export const APP_BASE_URL_ENV = 'APP_BASE_URL';
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

/** An origin only: https (plain http for localhost), no credentials, path, query or fragment. */
function parseOrigin(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const local = url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname);
  if (url.protocol !== 'https:' && !local) return undefined;
  if (url.username || url.password || url.pathname !== '/' || /[?#]/.test(raw)) return undefined;
  return url.origin;
}

/**
 * APP_BASE_URL, the web app's public origin for links in e-mails (`https://tms.example.com`), returned
 * without trailing slash. Required when e-mail is switched on; checked whenever it is set.
 */
function readAppBaseUrl(env: NodeJS.ProcessEnv, required: boolean): string | undefined {
  const raw = read(env, APP_BASE_URL_ENV);
  if (raw === undefined) {
    if (required) {
      throw new ConfigurationError(`${APP_BASE_URL_ENV} must be set when e-mail is switched on`);
    }
    return undefined;
  }
  const origin = parseOrigin(raw);
  if (origin === undefined) {
    throw new ConfigurationError(
      `${APP_BASE_URL_ENV} must be an https origin without path or query (http only for localhost)`,
    );
  }
  return origin;
}

export const SUPABASE_URL_ENV = 'SUPABASE_URL';
export const SUPABASE_SECRET_KEY_ENV = 'SUPABASE_SECRET_KEY';

/**
 * SUPABASE_URL (the project's API origin: https, plain http only for a local Auth) and
 * SUPABASE_SECRET_KEY (Supabase secret key `sb_secret_…`, or a service_role token self-hosted): both or
 * neither. The key's value is never part of an error.
 */
function readAuthAdmin(env: NodeJS.ProcessEnv): RunnerSettings['authAdmin'] {
  const rawUrl = read(env, SUPABASE_URL_ENV);
  const secretKey = read(env, SUPABASE_SECRET_KEY_ENV);
  if (rawUrl === undefined && secretKey === undefined) return undefined;
  if (rawUrl === undefined || secretKey === undefined) {
    throw new ConfigurationError(
      `${SUPABASE_URL_ENV} and ${SUPABASE_SECRET_KEY_ENV} must be set together (password-reset links)`,
    );
  }
  const url = parseOrigin(rawUrl);
  if (url === undefined) {
    throw new ConfigurationError(
      `${SUPABASE_URL_ENV} must be an https origin without path or query (http only for localhost)`,
    );
  }
  if (secretKey.length < 20 || /\s/.test(secretKey)) {
    throw new ConfigurationError(`${SUPABASE_SECRET_KEY_ENV} is not a valid key`);
  }
  return { url, secretKey };
}

export const CLAMD_HOST_ENV = 'CLAMD_HOST';
export const CLAMD_PORT_ENV = 'CLAMD_PORT';
export const SIGNATURES_MAX_AGE_ENV = 'FILE_SCAN_SIGNATURES_MAX_AGE_DAYS';
export const SIGNATURES_TEST_OVERRIDE_ENV = 'FILE_SCAN_SIGNATURES_TEST_OVERRIDE';
/** JADARAT_ENVIRONMENT values that look like production: no test override of the signature limit there. */
const PRODUCTION_LIKE = /prod|prd|live/i;
/** The hard limit on the signatures' age (ADR 0006 §8; platform-files SIGNATURE_HARD_MAX_AGE_DAYS). */
export const DEFAULT_SIGNATURES_MAX_AGE_DAYS = 7;
const HOST_NAME = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,252})$/;

/**
 * CLAMD_HOST (a host name or IPv4 address on the internal network), CLAMD_PORT (default 3310) and
 * FILE_SCAN_SIGNATURES_MAX_AGE_DAYS (default 7, at most 365).
 */
function readScanner(env: NodeJS.ProcessEnv): ScannerSettings | undefined {
  const host = read(env, CLAMD_HOST_ENV);
  const rawPort = read(env, CLAMD_PORT_ENV);
  const rawMaxAge = read(env, SIGNATURES_MAX_AGE_ENV);
  if (host === undefined) {
    if (rawPort !== undefined) {
      throw new ConfigurationError(`${CLAMD_PORT_ENV} is set without ${CLAMD_HOST_ENV}`);
    }
    if (rawMaxAge !== undefined) {
      throw new ConfigurationError(`${SIGNATURES_MAX_AGE_ENV} is set without ${CLAMD_HOST_ENV}`);
    }
    return undefined;
  }
  const maxSignatureAgeDays = Number(rawMaxAge ?? String(DEFAULT_SIGNATURES_MAX_AGE_DAYS));
  if (
    !Number.isInteger(maxSignatureAgeDays) ||
    maxSignatureAgeDays < 1 ||
    maxSignatureAgeDays > 365
  ) {
    throw new ConfigurationError(
      `${SIGNATURES_MAX_AGE_ENV} must be a whole number of days from 1 to 365`,
    );
  }
  // Raising the hard limit lets stale signatures pass as fresh: test installations only (re-review L-D).
  if (maxSignatureAgeDays > DEFAULT_SIGNATURES_MAX_AGE_DAYS) {
    if (read(env, SIGNATURES_TEST_OVERRIDE_ENV) !== '1') {
      throw new ConfigurationError(
        `${SIGNATURES_MAX_AGE_ENV} above ${String(DEFAULT_SIGNATURES_MAX_AGE_DAYS)} needs ${SIGNATURES_TEST_OVERRIDE_ENV}=1 (test installations with pinned signatures only)`,
      );
    }
    if (PRODUCTION_LIKE.test(read(env, 'JADARAT_ENVIRONMENT') ?? '')) {
      throw new ConfigurationError(
        `${SIGNATURES_MAX_AGE_ENV} above ${String(DEFAULT_SIGNATURES_MAX_AGE_DAYS)} is refused in a production environment (JADARAT_ENVIRONMENT)`,
      );
    }
  }
  if (!HOST_NAME.test(host)) {
    throw new ConfigurationError(`${CLAMD_HOST_ENV} must be a host name or an IPv4 address`);
  }
  const port = Number(rawPort ?? '3310');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError(`${CLAMD_PORT_ENV} must be a port number`);
  }
  return { host, port, maxSignatureAgeDays };
}

export const ORPHAN_SWEEP_ENV = 'FILE_ORPHAN_SWEEP';
export const ORPHAN_SWEEP_MAX_ENV = 'FILE_ORPHAN_SWEEP_MAX';
export const ORPHAN_SWEEP_MAX_SHARE_ENV = 'FILE_ORPHAN_SWEEP_MAX_SHARE';

/** A whole number from `min` to `max`, or the default when the variable is unset. */
function readWhole(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
  unit: string,
): number {
  const raw = read(env, name);
  const value = Number(raw ?? String(fallback));
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigurationError(
      `${name} must be a whole number ${unit} from ${String(min)} to ${String(max)}`,
    );
  }
  return value;
}

/** The orphan sweep's switch and brake (see RunnerSettings.orphanSweep). */
function readOrphanSweep(env: NodeJS.ProcessEnv): OrphanSweepSettings {
  const switchValue = (read(env, ORPHAN_SWEEP_ENV) ?? 'on').toLowerCase();
  if (switchValue !== 'on' && switchValue !== 'off') {
    throw new ConfigurationError(`${ORPHAN_SWEEP_ENV} must be on or off`);
  }
  return {
    enabled: switchValue === 'on',
    maxOrphans: readWhole(env, ORPHAN_SWEEP_MAX_ENV, 500, 1, 1_000_000, 'of objects'),
    maxSharePercent: readWhole(env, ORPHAN_SWEEP_MAX_SHARE_ENV, 10, 1, 100, '(percent)'),
  };
}

export const IMPORT_INTERVAL_ENV = 'USER_IMPORT_INVITATION_INTERVAL_MS';
export const IMPORT_DAILY_ENV = 'USER_IMPORT_DAILY_INVITATIONS';
export const IMPORT_TRIAL_DAILY_ENV = 'USER_IMPORT_TRIAL_DAILY_INVITATIONS';

/**
 * The pace (500 to 60,000 milliseconds: Resend allows 2 requests a second for the whole account, and
 * import invitations must leave room for every other e-mail) and the daily numbers (1 to 100,000; the
 * trial number no higher than the other) of import invitations.
 */
function readImportSending(env: NodeJS.ProcessEnv): InvitationSending {
  const whole = (name: string, fallback: number, min: number, max: number, unit: string) => {
    const raw = read(env, name);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new ConfigurationError(
        `${name} must be a whole number of ${unit} from ${String(min)} to ${String(max)}`,
      );
    }
    return value;
  };
  const intervalMs = whole(
    IMPORT_INTERVAL_ENV,
    DEFAULT_INVITATION_SENDING.intervalMs,
    500,
    60_000,
    'milliseconds',
  );
  const dailyCap = whole(
    IMPORT_DAILY_ENV,
    DEFAULT_INVITATION_SENDING.dailyCap,
    1,
    100_000,
    'invitations',
  );
  const trialDailyCap = whole(
    IMPORT_TRIAL_DAILY_ENV,
    Math.min(DEFAULT_INVITATION_SENDING.trialDailyCap, dailyCap),
    1,
    100_000,
    'invitations',
  );
  if (trialDailyCap > dailyCap) {
    throw new ConfigurationError(
      `${IMPORT_TRIAL_DAILY_ENV} must not be higher than ${IMPORT_DAILY_ENV}`,
    );
  }
  return { intervalMs, dailyCap, trialDailyCap };
}

/** The worker warns (at start-up, then daily) once the Auth admin token has fewer days than this left. */
export const ADMIN_KEY_WARN_DAYS = 30;

/**
 * Whole days until a self-hosted Auth admin token (SUPABASE_SECRET_KEY: a service_role JWT minted by
 * infra/docker/gen-secrets.sh, valid 90 days) expires — negative once expired. Undefined for a Supabase
 * secret key (`sb_secret_…`, no expiry) or a value without a readable `exp`. The payload is only decoded,
 * never verified (Auth verifies it); nothing of the token is returned or logged.
 */
export function adminKeyDaysLeft(secretKey: string, now: number = Date.now()): number | undefined {
  const parts = secretKey.split('.');
  const body = parts[1];
  if (parts.length !== 3 || body === undefined) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof payload !== 'object' || payload === null || !('exp' in payload)) return undefined;
  const { exp } = payload;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return undefined;
  return Math.floor((exp * 1000 - now) / 86_400_000);
}

/**
 * `daemon` (default): long-running, for containers (ADR 0005 §1). `once`: runs every due job, then exits —
 * for scheduled runs in environments without a container host (staging). `test-email`: sends one sample
 * e-mail to EMAIL_TEST_TO. Everything is checked before the first connection: login roles, TLS
 * verification for remote hosts, e-mail settings, the web app's public origin (APP_BASE_URL), the Auth
 * admin API for reset links (SUPABASE_URL + SUPABASE_SECRET_KEY, optional).
 */
export function readSettings(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  readCaPem: () => string | undefined = readDatabaseCaPem,
): WorkerSettings {
  const mode = argv[0] ?? 'daemon';
  if (mode !== 'daemon' && mode !== 'once' && mode !== 'test-email' && mode !== 'scanner-check') {
    throw new ConfigurationError(
      `unknown mode "${mode}" (expected daemon, once, test-email or scanner-check)`,
    );
  }
  const scanner = readScanner(env);
  if (mode === 'scanner-check') {
    if (!scanner)
      throw new ConfigurationError(`${CLAMD_HOST_ENV} must be set to check the scanner`);
    return { mode, scanner };
  }
  const email = check(() => readEmailSettings(env));
  if (mode === 'test-email') {
    if (email.provider === 'none') {
      throw new ConfigurationError('EMAIL_PROVIDER must be set to send a test e-mail');
    }
    const testTo = read(env, 'EMAIL_TEST_TO');
    if (!testTo || !isEmailAddress(testTo)) {
      throw new ConfigurationError('EMAIL_TEST_TO must be set to an e-mail address');
    }
    return { mode, email, testTo };
  }
  const queueUrl = read(env, DATABASE_URL_APP_QUEUE_ENV);
  if (!queueUrl) throw new ConfigurationError(`${DATABASE_URL_APP_QUEUE_ENV} is not configured`);
  const workerUrl = read(env, DATABASE_URL_ENV.app_worker);
  if (!workerUrl) throw new ConfigurationError(`${DATABASE_URL_ENV.app_worker} is not configured`);
  const caPem = check(readCaPem);
  check(() => {
    assertQueueRole(queueUrl);
  });
  check(() => {
    assertConnectionRole(workerUrl, 'app_worker');
  });
  check(() => tlsOptionsFor(queueUrl, caPem));
  check(() => tlsOptionsFor(workerUrl, caPem));
  const raw = read(env, 'WORKER_CONCURRENCY') ?? (mode === 'once' ? '2' : '5');
  const concurrency = Number(raw);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
    throw new ConfigurationError('WORKER_CONCURRENCY must be a whole number from 1 to 50');
  }
  const appBaseUrl = readAppBaseUrl(env, email.provider !== 'none');
  const authAdmin = readAuthAdmin(env);
  const orphanSweep = readOrphanSweep(env);
  const importSending = readImportSending(env);
  return {
    mode,
    queueUrl,
    workerUrl,
    caPem,
    concurrency,
    email,
    appBaseUrl,
    authAdmin,
    scanner,
    orphanSweep,
    importSending,
  };
}
