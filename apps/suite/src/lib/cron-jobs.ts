import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { log } from '@jadarat/platform-observability';

/**
 * GET /api/cron/jobs — Vercel Cron, every minute (apps/suite/vercel.json; ADR 0005 §1 amendment, PO
 * 20 Oct 2026): asks GitHub for a worker pass (platform-jobs ./kick) so queued e-mails, scans and imports
 * wait at most about a minute plus the pass's start-up, instead of GitHub's late 5-minute schedule.
 *
 * Authorization: `Authorization: Bearer <CRON_SECRET>` — Vercel Cron sends it when the project has a
 * CRON_SECRET environment variable. Without a CRON_SECRET of at least 16 characters on the server, every
 * call is refused (401, fail closed). Both sides are trimmed the same way (the setting, and the token after
 * `Bearer `), and the compare is constant-time over SHA-256 digests (no length leak). A request that
 * presents a bearer which does not match, while the secret is set, is logged as a warning — without any
 * value, at most once per WRONG_BEARER_LOG_INTERVAL_MS per server instance (security review L6): a rotated
 * secret not yet redeployed, or someone probing.
 * Abuse: a caller without the secret gets 401 and causes nothing; with it, at most one dispatch per
 * CRON_MIN_INTERVAL_MS per server instance (the dispatcher's cron window). The answer carries the outcome
 * code only.
 */
export const MIN_CRON_SECRET_LENGTH = 16;
/** A wrong bearer is logged at most this often per server instance. */
export const WRONG_BEARER_LOG_INTERVAL_MS = 10 * 60_000;

type Env = Readonly<Record<string, string | undefined>>;

export interface CronJobsDeps {
  readonly env?: Env;
  readonly requestWorkerPass: (reason: string) => Promise<string>;
  readonly now?: () => number;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** The configured secret, trimmed; undefined when unset or shorter than MIN_CRON_SECRET_LENGTH. */
export function cronSecret(env: Env): string | undefined {
  const secret = env.CRON_SECRET?.trim();
  return secret === undefined || secret.length < MIN_CRON_SECRET_LENGTH ? undefined : secret;
}

/** The token of an `Authorization: Bearer <token>` header, trimmed; null for anything else. */
function bearerToken(authorization: string | null): string | null {
  const match = /^Bearer (.+)$/.exec(authorization?.trim() ?? '');
  const token = match?.[1]?.trim();
  return token === undefined || token === '' ? null : token;
}

/** Constant-time check of the request's bearer token against CRON_SECRET (both trimmed). */
export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  const expected = secret?.trim();
  if (expected === undefined || expected.length < MIN_CRON_SECRET_LENGTH) return false;
  const token = bearerToken(authorization);
  if (token === null) return false;
  return timingSafeEqual(digest(token), digest(expected));
}

const NO_STORE = { 'cache-control': 'no-store' } as const;

let warnedMissingSecret = false;
let lastWrongBearerLog = -Infinity;

/** Tests only: forget what was logged. */
export function forgetCronLogStateForTests(): void {
  warnedMissingSecret = false;
  lastWrongBearerLog = -Infinity;
}

export async function handleCronJobsRequest(
  request: Request,
  deps: CronJobsDeps,
): Promise<Response> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const secret = cronSecret(env);
  if (secret === undefined) {
    // Once per server instance: anonymous calls must not flood the log.
    if (warnedMissingSecret) {
      return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
    }
    warnedMissingSecret = true;
    log.warn('cron request refused: CRON_SECRET is not set (or shorter than 16 characters)', {
      action: 'platform.jobs.cron',
      reason: 'cron_secret_missing',
      status: 401,
    });
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  const authorization = request.headers.get('authorization');
  if (!cronAuthorized(authorization, secret)) {
    if (
      bearerToken(authorization) !== null &&
      now() - lastWrongBearerLog >= WRONG_BEARER_LOG_INTERVAL_MS
    ) {
      lastWrongBearerLog = now();
      // No value of the header or the secret — only that they differ.
      log.warn('cron request refused: the bearer does not match CRON_SECRET', {
        action: 'platform.jobs.cron',
        reason: 'cron_secret_mismatch',
        status: 401,
      });
    }
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  // Never throws (no-op `off` without the dispatch App settings).
  const outcome = await deps.requestWorkerPass('cron');
  return Response.json({ outcome }, { status: 200, headers: NO_STORE });
}
