/**
 * The web app's request for a worker pass (PO decision 20 Oct 2026; ADR 0005 §1 amendment;
 * docs/engineering/background-jobs.md §1a). Hosted production has no always-on worker: GitHub Actions runs
 * one pass per run of `.github/workflows/jobs.yml`, and GitHub starts its 5-minute schedule late or not at
 * all. So, like Kawadir ATS, the web app STARTS that workflow (`workflow_dispatch`, GitHub REST API) right
 * after an action queued work, and a Vercel Cron does so every minute. The worker's keys stay on GitHub.
 *
 * Identity (security review H1, 21 Oct 2026): a dedicated GitHub App — never a personal token, which would
 * act as the PO's own GitHub user and could start EVERY workflow (platform-admin, tenant-provision,
 * db-deploy …) with chosen inputs, indistinguishable from the PO. The App holds one permission, Repository →
 * Actions: Read and write, and is installed on this one repository; every other workflow with
 * `workflow_dispatch` refuses a run started by it (`github.triggering_actor` = vars.JOBS_KICK_ACTOR or any
 * `[bot]`). Per call the server:
 *   1. signs a short-lived JWT as the App (RS256 with node:crypto; `iat` now − 60 s, `exp` now + 9 min,
 *      `iss` the App id),
 *   2. exchanges it at POST /app/installations/{id}/access_tokens for an installation token NARROWED to
 *      this repository and `actions: write` (GitHub refuses more than the App has; never more than asked),
 *   3. caches that token until 5 minutes before its `expires_at` (GitHub: one hour), in memory only,
 *   4. dispatches the workflow with it.
 *
 * Settings (server environment, read on every call — never inlined at build time, never sent to a browser):
 *   JOBS_DISPATCH_APP_ID            config, the App's numeric id (App settings → General → App ID).
 *   JOBS_DISPATCH_APP_PRIVATE_KEY   SECRET, the App's private key (PEM; `\n` escapes accepted). Never logged.
 *   JOBS_DISPATCH_INSTALLATION_ID   config, the numeric id of the App's installation on this repository.
 *   JOBS_DISPATCH_REPO              config, `owner/name` (e.g. mohima90/entlaqa-tms).
 *   JOBS_DISPATCH_WORKFLOW          config, the workflow FILE name (default jobs.yml).
 *   JOBS_DISPATCH_REF               config, the branch to run (default main; jobs.yml runs only on main).
 * None of the App settings → nothing is dispatched (self-hosted runs a continuous worker; local development)
 * — not an error. Some but not all, or one malformed → dispatching stays off and ONE error per server
 * instance names the setting, never its value. Every request goes to https://api.github.com only — the
 * settings choose path segments that must match strict patterns, never an origin (no SSRF through
 * configuration); redirects are refused.
 *
 * Throttle (per server instance, in memory; claimed BEFORE the call so a burst coalesces): actions share one
 * window of MIN_INTERVAL_MS; the cron has its own, shorter window (CRON_MIN_INTERVAL_MS — only a guard
 * against a tight loop), so an action's kick never makes the minute's cron skip (security review L1). Extra
 * dispatches would be harmless — jobs.yml's `concurrency` group keeps at most one run going and one waiting —
 * but each costs API calls and a queued run.
 *
 * `requestWorkerPass` never throws and never rejects: a failure (timeout, network, non-2xx, a malformed
 * answer) is logged as a warning with the HTTP status or the error class only — never the key, the JWT, the
 * token, or any response body — and the work waits for the next kick, the cron or the 5-minute schedule.
 */
import 'server-only';
import { type KeyObject, createPrivateKey, sign } from 'node:crypto';
import { type Logger, log as defaultLog } from '@jadarat/platform-observability';

export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const DEFAULT_WORKFLOW = 'jobs.yml';
export const DEFAULT_REF = 'main';
/** Actions' shared window. */
export const MIN_INTERVAL_MS = 60_000;
/** The cron's own window: Vercel calls once a minute; this only stops a tight loop. */
export const CRON_MIN_INTERVAL_MS = 30_000;
/** Per HTTP call (at most two per request: the token exchange, then the dispatch). */
export const DISPATCH_TIMEOUT_MS = 5_000;
/** The App JWT: issued 60 s in the past (clock drift), valid 9 minutes (GitHub's limit: 10). */
export const APP_JWT_BACKDATE_S = 60;
export const APP_JWT_LIFETIME_S = 9 * 60;
/** An installation token is reused until this long before its expiry. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
/** The token answer is small; anything larger is not GitHub's answer. */
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;

const LOG_ACTION = 'platform.jobs.request_pass';

/** GitHub's own rules, narrowed: owner 1–39 letters/digits/hyphens; repository letters, digits, . _ - */
const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** A workflow file name in .github/workflows (no path). */
const WORKFLOW_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\.ya?ml$/;
/** A branch name (no `..`, no leading `-` or `/`; checked separately). */
const REF_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/;
/** App and installation ids: positive integers. */
const ID_PATTERN = /^[1-9][0-9]{0,15}$/;
/** An installation token (ghs_…): letters, digits and underscores only — never spaces or line breaks. */
const TOKEN_PATTERN = /^[A-Za-z0-9_]{20,1024}$/;
/** What a caller may say about why it asks (logged): a short code, e.g. `cron`, `action:platform.iam.invite`. */
const REASON_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,79}$/;

const APP_SETTINGS = [
  'JOBS_DISPATCH_APP_ID',
  'JOBS_DISPATCH_APP_PRIVATE_KEY',
  'JOBS_DISPATCH_INSTALLATION_ID',
] as const;

type Env = Readonly<Record<string, string | undefined>>;

export interface WorkerKickConfig {
  readonly appId: string;
  /** The parsed RSA private key (never its text). */
  readonly privateKey: KeyObject;
  readonly installationId: string;
  readonly repo: string;
  readonly workflow: string;
  readonly ref: string;
}

export type WorkerKickSettings =
  | { readonly kind: 'off' }
  /** `problem` names the setting only — never its value. */
  | { readonly kind: 'invalid'; readonly problem: string }
  | { readonly kind: 'on'; readonly config: WorkerKickConfig };

function setting(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/** The last key parsed, by its text (parsing a PEM on every call would be wasteful). */
let parsedKey: { readonly pem: string; readonly key: KeyObject | null } | null = null;

/** An RSA private key from its PEM (literal `\n` escapes, as some dashboards store them), or null. */
function parsePrivateKey(raw: string): KeyObject | null {
  const pem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  if (parsedKey?.pem === pem) return parsedKey.key;
  let key: KeyObject | null;
  try {
    const candidate = createPrivateKey({ key: pem, format: 'pem' });
    key = candidate.asymmetricKeyType === 'rsa' ? candidate : null;
  } catch {
    key = null;
  }
  parsedKey = { pem, key };
  return key;
}

/** Is any App setting present (valid or not)? */
function appConfigured(env: Env): boolean {
  return APP_SETTINGS.some((name) => setting(env, name) !== undefined);
}

/** Reads and validates the dispatch settings. No App setting → `off`. */
export function readWorkerKickSettings(env: Env = process.env): WorkerKickSettings {
  if (!appConfigured(env)) return { kind: 'off' };
  const appId = setting(env, 'JOBS_DISPATCH_APP_ID');
  if (appId === undefined || !ID_PATTERN.test(appId)) {
    return { kind: 'invalid', problem: 'JOBS_DISPATCH_APP_ID' };
  }
  const rawKey = setting(env, 'JOBS_DISPATCH_APP_PRIVATE_KEY');
  const privateKey = rawKey === undefined ? null : parsePrivateKey(rawKey);
  if (privateKey === null) return { kind: 'invalid', problem: 'JOBS_DISPATCH_APP_PRIVATE_KEY' };
  const installationId = setting(env, 'JOBS_DISPATCH_INSTALLATION_ID');
  if (installationId === undefined || !ID_PATTERN.test(installationId)) {
    return { kind: 'invalid', problem: 'JOBS_DISPATCH_INSTALLATION_ID' };
  }
  const repo = setting(env, 'JOBS_DISPATCH_REPO');
  if (repo === undefined || !REPO_PATTERN.test(repo) || /(^|\/)\.\.?$/.test(repo)) {
    return { kind: 'invalid', problem: 'JOBS_DISPATCH_REPO' };
  }
  const workflow = setting(env, 'JOBS_DISPATCH_WORKFLOW') ?? DEFAULT_WORKFLOW;
  if (!WORKFLOW_PATTERN.test(workflow)) {
    return { kind: 'invalid', problem: 'JOBS_DISPATCH_WORKFLOW' };
  }
  const ref = setting(env, 'JOBS_DISPATCH_REF') ?? DEFAULT_REF;
  if (!REF_PATTERN.test(ref) || ref.includes('..') || ref.endsWith('/')) {
    return { kind: 'invalid', problem: 'JOBS_DISPATCH_REF' };
  }
  return { kind: 'on', config: { appId, privateKey, installationId, repo, workflow, ref } };
}

/** The dispatch endpoint: always on api.github.com, each segment already pattern-checked. */
export function dispatchUrl(config: Pick<WorkerKickConfig, 'repo' | 'workflow'>): string {
  const [owner, name] = config.repo.split('/') as [string, string];
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`;
  return new URL(path, GITHUB_API_ORIGIN).toString();
}

/** The installation-token endpoint: always on api.github.com, the id already pattern-checked. */
export function installationTokenUrl(config: Pick<WorkerKickConfig, 'installationId'>): string {
  return new URL(
    `/app/installations/${encodeURIComponent(config.installationId)}/access_tokens`,
    GITHUB_API_ORIGIN,
  ).toString();
}

/** What the token request asks for: this repository only, Actions write only. */
export function installationTokenRequest(config: Pick<WorkerKickConfig, 'repo'>): {
  readonly repositories: readonly string[];
  readonly permissions: { readonly actions: 'write' };
} {
  const [, name] = config.repo.split('/') as [string, string];
  return { repositories: [name], permissions: { actions: 'write' } };
}

const base64url = (value: string | Buffer): string =>
  Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** The App's JWT (RS256): `iat` now − 60 s, `exp` now + 9 min, `iss` the App id. */
export function signAppJwt(
  config: Pick<WorkerKickConfig, 'appId' | 'privateKey'>,
  nowMs: number,
): string {
  const now = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iat: now - APP_JWT_BACKDATE_S,
      exp: now + APP_JWT_LIFETIME_S,
      iss: Number(config.appId),
    }),
  );
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), config.privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

export type WorkerKickOutcome =
  'off' | 'invalid_config' | 'throttled' | 'dispatched' | 'failed' | 'timeout';

export interface WorkerKickDeps {
  readonly env?: () => Env;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly log?: Logger;
  readonly timeoutMs?: number;
  readonly minIntervalMs?: number;
  readonly cronMinIntervalMs?: number;
}

export interface WorkerKick {
  /** Asks GitHub for a worker pass (throttled). Never throws or rejects. */
  request(reason: string): Promise<WorkerKickOutcome>;
  /** True when any App setting is set (valid or not) — callers may skip scheduling work otherwise. */
  configured(): boolean;
}

function safeReason(reason: string): string {
  return REASON_PATTERN.test(reason) ? reason : 'other';
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

const GITHUB_HEADERS = {
  accept: 'application/vnd.github+json',
  'content-type': 'application/json',
  'user-agent': 'jadarat-suite-worker-kick',
  'x-github-api-version': '2022-11-28',
} as const;

/** A failed step, logged with its code only. */
class KickFailure extends Error {
  constructor(
    readonly errorCode: string,
    readonly status: number | null,
  ) {
    super(errorCode);
    this.name = 'KickFailure';
  }
}

interface CachedToken {
  /** The settings it was issued for (a changed App, installation or repository needs a new one). */
  readonly key: string;
  readonly token: string;
  /** Reused until then (5 minutes before GitHub's expiry). */
  readonly reuseUntil: number;
}

/** Reads a small JSON body (bounded), or null. The body is never logged. */
async function readSmallJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_TOKEN_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const text = await response.text();
  if (text.length > MAX_TOKEN_RESPONSE_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function createWorkerKick(deps: WorkerKickDeps = {}): WorkerKick {
  const readEnv = deps.env ?? (() => process.env);
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? Date.now;
  const logger = deps.log ?? defaultLog;
  const timeoutMs = deps.timeoutMs ?? DISPATCH_TIMEOUT_MS;
  const windows = {
    action: deps.minIntervalMs ?? MIN_INTERVAL_MS,
    cron: deps.cronMinIntervalMs ?? CRON_MIN_INTERVAL_MS,
  };
  const lastAttemptAt: { action: number | null; cron: number | null } = {
    action: null,
    cron: null,
  };
  let reportedInvalid: string | null = null;
  let cached: CachedToken | null = null;

  /** An installation token for this configuration: the cached one, or a new one from GitHub. */
  async function installationToken(config: WorkerKickConfig): Promise<string> {
    const key = `${config.appId}|${config.installationId}|${config.repo}`;
    if (cached?.key === key && now() < cached.reuseUntil) return cached.token;
    cached = null;
    const response = await doFetch(installationTokenUrl(config), {
      method: 'POST',
      headers: { ...GITHUB_HEADERS, authorization: `Bearer ${signAppJwt(config, now())}` },
      body: JSON.stringify(installationTokenRequest(config)),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 201) {
      await response.body?.cancel().catch(() => undefined);
      // 401: wrong App id or key; 404: wrong installation id; 422: the App lacks the repository or Actions write.
      throw new KickFailure(`github_token_http_${String(response.status)}`, response.status);
    }
    const body = (await readSmallJson(response)) as {
      token?: unknown;
      expires_at?: unknown;
    } | null;
    const token = typeof body?.token === 'string' ? body.token : null;
    const expiresAt = typeof body?.expires_at === 'string' ? Date.parse(body.expires_at) : NaN;
    if (token === null || !TOKEN_PATTERN.test(token) || !Number.isFinite(expiresAt)) {
      throw new KickFailure('github_token_malformed', response.status);
    }
    const reuseUntil = expiresAt - TOKEN_REFRESH_MARGIN_MS;
    if (reuseUntil > now()) cached = { key, token, reuseUntil };
    return token;
  }

  async function request(rawReason: string): Promise<WorkerKickOutcome> {
    try {
      const reason = safeReason(rawReason);
      const settings = readWorkerKickSettings(readEnv());
      if (settings.kind === 'off') return 'off';
      if (settings.kind === 'invalid') {
        if (reportedInvalid !== settings.problem) {
          reportedInvalid = settings.problem;
          logger.error(`worker pass not requested: ${settings.problem} is invalid`, {
            action: LOG_ACTION,
            reason: 'jobs_dispatch_config_invalid',
          });
        }
        return 'invalid_config';
      }
      const started = now();
      // The cron has its own window (review L1): an action's kick never makes the minute's cron skip.
      const bucket = reason === 'cron' ? 'cron' : 'action';
      const last = lastAttemptAt[bucket];
      if (last !== null && started - last < windows[bucket]) return 'throttled';
      lastAttemptAt[bucket] = started;

      const { config } = settings;
      try {
        const token = await installationToken(config);
        const response = await doFetch(dispatchUrl(config), {
          method: 'POST',
          headers: { ...GITHUB_HEADERS, authorization: `Bearer ${token}` },
          body: JSON.stringify({ ref: config.ref }),
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
        // The body is never read or logged (it may echo request details).
        await response.body?.cancel().catch(() => undefined);
        const durationMs = now() - started;
        if (response.ok) {
          logger.info('worker pass requested', {
            action: LOG_ACTION,
            reason,
            status: response.status,
            outcome: 'success',
            durationMs,
          });
          return 'dispatched';
        }
        // A revoked or expired token: the next request asks for a new one.
        if (response.status === 401) cached = null;
        logger.warn('worker pass request refused by GitHub', {
          action: LOG_ACTION,
          reason,
          status: response.status,
          outcome: 'failure',
          // 401: token revoked; 403: the App lacks Actions write; 404: wrong repository or workflow.
          errorCode: `github_http_${String(response.status)}`,
          durationMs,
        });
        return 'failed';
      } catch (error) {
        if (error instanceof KickFailure) {
          logger.warn('worker pass request refused by GitHub', {
            action: LOG_ACTION,
            reason,
            ...(error.status === null ? {} : { status: error.status }),
            outcome: 'failure',
            errorCode: error.errorCode,
            durationMs: now() - started,
          });
          return 'failed';
        }
        const timedOut = isTimeout(error);
        logger.warn('worker pass request failed', {
          action: LOG_ACTION,
          reason,
          outcome: 'failure',
          errorCode: timedOut ? 'timeout' : 'network',
          // The class only — never the message (it could quote the request).
          errorName: error instanceof Error ? error.name : 'unknown',
          durationMs: now() - started,
        });
        return timedOut ? 'timeout' : 'failed';
      }
    } catch {
      // Never reaches the caller (a logger that throws, a clock that throws, …).
      return 'failed';
    }
  }

  return {
    request,
    configured: () => appConfigured(readEnv()),
  };
}

const defaultKick = createWorkerKick();

/**
 * Asks GitHub to start a worker pass now (throttled per instance; no-op without the App settings).
 * Never throws or rejects. `reason`: a short code for the log, e.g. `cron` or `action:<permission>`.
 */
export function requestWorkerPass(reason: string): Promise<WorkerKickOutcome> {
  return defaultKick.request(reason);
}

/** Is any of the dispatch App's settings set on this server (no validation)? */
export function workerKickConfigured(): boolean {
  return defaultKick.configured();
}
