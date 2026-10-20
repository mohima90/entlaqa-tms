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
 * call is refused (401, fail closed). The compare is constant-time over SHA-256 digests (no length leak).
 * Abuse: a caller without the secret gets 401 and causes nothing; with it, at most one dispatch a minute per
 * server instance (the dispatcher's throttle). The answer carries the outcome code only.
 */
export const MIN_CRON_SECRET_LENGTH = 16;

type Env = Readonly<Record<string, string | undefined>>;

export interface CronJobsDeps {
  readonly env?: Env;
  readonly requestWorkerPass: (reason: string) => Promise<string>;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant-time check of the request's bearer token against CRON_SECRET. */
export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (secret === undefined || secret.length < MIN_CRON_SECRET_LENGTH) return false;
  if (authorization === null) return false;
  const expected = digest(`Bearer ${secret}`);
  return timingSafeEqual(digest(authorization), expected);
}

const NO_STORE = { 'cache-control': 'no-store' } as const;

let warnedMissingSecret = false;

export async function handleCronJobsRequest(
  request: Request,
  deps: CronJobsDeps,
): Promise<Response> {
  const env = deps.env ?? process.env;
  const secret = env.CRON_SECRET?.trim();
  if (secret === undefined || secret.length < MIN_CRON_SECRET_LENGTH) {
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
  if (!cronAuthorized(request.headers.get('authorization'), secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  // Never throws (no-op `off` without JOBS_DISPATCH_TOKEN).
  const outcome = await deps.requestWorkerPass('cron');
  return Response.json({ outcome }, { status: 200, headers: NO_STORE });
}
