/**
 * The web app's request for a worker pass (PO decision 20 Oct 2026; ADR 0005 §1 amendment;
 * docs/engineering/background-jobs.md §1a). Hosted production has no always-on worker: GitHub Actions runs
 * one pass per run of `.github/workflows/jobs.yml`, and GitHub starts its 5-minute schedule late or not at
 * all. So, like Kawadir ATS, the web app STARTS that workflow (`workflow_dispatch`, GitHub REST API) right
 * after an action queued work, and a Vercel Cron does so every minute. The worker's keys stay on GitHub;
 * the web app holds only JOBS_DISPATCH_TOKEN, which can start workflows of this one repository and nothing
 * else (fine-grained token, "Actions: Read and write", this repository only).
 *
 * Settings (server environment, read on every call — never inlined at build time, never sent to a browser):
 *   JOBS_DISPATCH_TOKEN     SECRET. Unset → nothing is dispatched (self-hosted runs a continuous worker;
 *                           local development) — not an error.
 *   JOBS_DISPATCH_REPO      config, `owner/name` (e.g. mohima90/entlaqa-tms). Required with the token.
 *   JOBS_DISPATCH_WORKFLOW  config, the workflow FILE name (default jobs.yml).
 *   JOBS_DISPATCH_REF       config, the branch to run (default main; jobs.yml runs only on main).
 * Every request goes to https://api.github.com only — the settings choose a path segment that must match a
 * strict pattern, never an origin (no SSRF through configuration). An invalid setting turns dispatching off
 * and is logged as an error (once per server instance).
 *
 * Throttle: at most one dispatch per MIN_INTERVAL_MS per server instance (in memory). Extra dispatches would
 * be harmless — jobs.yml's `concurrency` group (cancel-in-progress: false) keeps at most one run going and
 * one waiting, and GitHub drops older waiting runs of the group — but each costs an API call and a queued
 * run. Several instances may each dispatch once a minute; that is fine for the same reason.
 *
 * `requestWorkerPass` never throws and never rejects: a failure (timeout, network, non-2xx) is logged as a
 * warning — the token is never logged, nor any response body — and the work waits for the next kick, the
 * cron or the 5-minute schedule.
 */
import 'server-only';
import { type Logger, log as defaultLog } from '@jadarat/platform-observability';

export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const DEFAULT_WORKFLOW = 'jobs.yml';
export const DEFAULT_REF = 'main';
export const MIN_INTERVAL_MS = 60_000;
export const DISPATCH_TIMEOUT_MS = 5_000;

const LOG_ACTION = 'platform.jobs.request_pass';

/** GitHub's own rules, narrowed: owner 1–39 letters/digits/hyphens; repository letters, digits, . _ - */
const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** A workflow file name in .github/workflows (no path). */
const WORKFLOW_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\.ya?ml$/;
/** A branch name (no `..`, no leading `-` or `/`; checked separately). */
const REF_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/;
/** GitHub tokens (github_pat_…, ghp_…, ghs_…): letters, digits and underscores only — never spaces. */
const TOKEN_PATTERN = /^[A-Za-z0-9_]{20,255}$/;
/** What a caller may say about why it asks (logged): a short code, e.g. `cron`, `action:platform.iam.invite`. */
const REASON_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,79}$/;

type Env = Readonly<Record<string, string | undefined>>;

export interface WorkerKickConfig {
  readonly token: string;
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

/** Reads and validates the dispatch settings. Unset token → `off`. */
export function readWorkerKickSettings(env: Env = process.env): WorkerKickSettings {
  const token = setting(env, 'JOBS_DISPATCH_TOKEN');
  if (token === undefined) return { kind: 'off' };
  if (!TOKEN_PATTERN.test(token)) return { kind: 'invalid', problem: 'JOBS_DISPATCH_TOKEN' };
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
  return { kind: 'on', config: { token, repo, workflow, ref } };
}

/** The dispatch endpoint: always on api.github.com, each segment already pattern-checked. */
export function dispatchUrl(config: Pick<WorkerKickConfig, 'repo' | 'workflow'>): string {
  const [owner, name] = config.repo.split('/') as [string, string];
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`;
  return new URL(path, GITHUB_API_ORIGIN).toString();
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
}

export interface WorkerKick {
  /** Asks GitHub for a worker pass (throttled). Never throws or rejects. */
  request(reason: string): Promise<WorkerKickOutcome>;
  /** True when a token is set (valid or not) — callers may skip scheduling work otherwise. */
  configured(): boolean;
}

function safeReason(reason: string): string {
  return REASON_PATTERN.test(reason) ? reason : 'other';
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export function createWorkerKick(deps: WorkerKickDeps = {}): WorkerKick {
  const readEnv = deps.env ?? (() => process.env);
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? Date.now;
  const logger = deps.log ?? defaultLog;
  const timeoutMs = deps.timeoutMs ?? DISPATCH_TIMEOUT_MS;
  const minIntervalMs = deps.minIntervalMs ?? MIN_INTERVAL_MS;
  let lastAttemptAt: number | null = null;
  let reportedInvalid: string | null = null;

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
      // Claimed BEFORE the call, so a burst of actions on this instance coalesces into one dispatch.
      if (lastAttemptAt !== null && started - lastAttemptAt < minIntervalMs) return 'throttled';
      lastAttemptAt = started;

      const { config } = settings;
      try {
        const response = await doFetch(dispatchUrl(config), {
          method: 'POST',
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${config.token}`,
            'content-type': 'application/json',
            'user-agent': 'jadarat-suite-worker-kick',
            'x-github-api-version': '2022-11-28',
          },
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
        logger.warn('worker pass request refused by GitHub', {
          action: LOG_ACTION,
          reason,
          status: response.status,
          outcome: 'failure',
          // 401: token expired or revoked; 403: missing "Actions: write"; 404: wrong repo/workflow or no access.
          errorCode: `github_http_${response.status}`,
          durationMs,
        });
        return 'failed';
      } catch (error) {
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
    configured: () => setting(readEnv(), 'JOBS_DISPATCH_TOKEN') !== undefined,
  };
}

const defaultKick = createWorkerKick();

/**
 * Asks GitHub to start a worker pass now (throttled per instance; no-op without JOBS_DISPATCH_TOKEN).
 * Never throws or rejects. `reason`: a short code for the log, e.g. `cron` or `action:<permission>`.
 */
export function requestWorkerPass(reason: string): Promise<WorkerKickOutcome> {
  return defaultKick.request(reason);
}

/** Is a dispatch token set on this server (no validation)? */
export function workerKickConfigured(): boolean {
  return defaultKick.configured();
}
