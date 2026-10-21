import 'server-only';
import {
  readAuthClientHeader,
  readAuthLimitWindowOverride,
  readPasswordResetDelivery,
} from '@jadarat/platform-identity';
import { readWorkerKickSettings } from '@jadarat/platform-jobs/kick';
import { log } from '@jadarat/platform-observability';
import { parseAppBaseUrl } from './app-base-url';
import { cronSecret } from './cron-jobs';
import { CLIENT_IP_HEADER_ENV, readClientIpHeaderSetting } from './client-ip';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The header a self-hosted installation's gateway OVERWRITES with the visitor's address (lib/client-ip.ts;
 * TM-0003 T-IAM-03), or null (unset or `none`). On Vercel the platform's own `x-real-ip` is used without
 * it. Throws for an invalid value and for X-Forwarded-For.
 */
export function readClientIpHeader(env: Env): string | null {
  const setting = readClientIpHeaderSetting(env);
  return setting.kind === 'header' ? setting.name : null;
}

/**
 * Server settings checked once at start-up (instrumentation `register`), so a wrong value stops the
 * deployment instead of failing the first visitor: PASSWORD_RESET_DELIVERY (`auth` | `worker`, T-M2-17,
 * docs/engineering/password-reset.md), AUTH_RATE_LIMIT_WINDOW_SECONDS (T-M2-11, the self-hosted smoke
 * test only: shortens every sign-in, reset and invitation limit window; refused in production without
 * AUTH_RATE_LIMIT_WINDOW_SMOKE_ONLY=1, and on a Vercel production deployment always) and
 * JADARAT_AUTH_CLIENT_HEADER (T-M2-11, self-hosted only — refused on Vercel: the header carrying the
 * visitor's key to Auth's own limits) and JADARAT_CLIENT_IP_HEADER (a header name, never X-Forwarded-For,
 * or `none`) — docs/engineering/sign-in-protection.md. Read again on use; never sent to the browser.
 *
 * Client address (security review T-M2-11 L4, re-review N2): a production server outside Vercel
 * (NODE_ENV=production, VERCEL≠1) that names its environment — JADARAT_ENVIRONMENT set to ANY value, so the
 * rule never hangs on the free-form label's spelling — refuses to start without JADARAT_CLIENT_IP_HEADER:
 * every visitor would share one client key, so one abuser could use up the per-client budgets for all.
 * `none` says so explicitly (then, and for any other production server without one but Vercel, an ERROR is
 * logged at every start: `client_ip_header_missing`). Local and test production builds (`next start`, the
 * E2E server) set no JADARAT_ENVIRONMENT and keep starting.
 *
 * APP_BASE_URL (FR-IAM-03, FR-ADM-17; configuration, not a secret): the canonical origin of copied invitation
 * links. A value that is not an https origin (http for localhost) without a path stops the start; unset,
 * the browser's own origin is used — a WARNING on a Vercel production deployment (`app_base_url_missing`).
 *
 * JOBS_DISPATCH_APP_ID / JOBS_DISPATCH_APP_PRIVATE_KEY / JOBS_DISPATCH_INSTALLATION_ID / JOBS_DISPATCH_REPO
 * (ADR 0005 §1 amendment, 20 Oct 2026, security review H1 21 Oct 2026; platform-jobs ./kick): the web app
 * starts the GitHub Jobs workflow after queued work, as a GitHub App. An incomplete or invalid set is an ERROR
 * at start naming the setting only (`jobs_dispatch_config_invalid`; dispatching stays off, the app still
 * starts — passes then come from GitHub's 5-minute schedule only); the App on a Vercel production deployment
 * without CRON_SECRET is a WARNING (`cron_secret_missing`: the per-minute cron is refused). A leftover
 * JOBS_DISPATCH_TOKEN (the personal token of the first version) is a WARNING (`jobs_dispatch_token_obsolete`):
 * it is ignored — delete it from the environment and revoke it on GitHub.
 */
export function checkServerSettings(env: Env = process.env) {
  const delivery = readPasswordResetDelivery(env);
  log.info(
    delivery === 'worker'
      ? 'password reset e-mails: worker (our notification service)'
      : 'password reset e-mails: auth (Supabase Auth mailer)',
    { action: 'app.start' },
  );
  const limitWindowSeconds = readAuthLimitWindowOverride(env);
  if (limitWindowSeconds !== null) {
    // Loud on purpose: a real deployment must never run with shortened lockouts.
    log.warn(
      'sign-in and reset limit windows shortened for the smoke test (AUTH_RATE_LIMIT_WINDOW_SECONDS)',
      {
        action: 'app.start',
        reason: 'auth_limit_window_override',
        retryAfterS: limitWindowSeconds,
      },
    );
  }
  const authClientHeader = readAuthClientHeader(env);
  const clientIp = readClientIpHeaderSetting(env);
  if (
    env.NODE_ENV === 'production' &&
    env.VERCEL !== '1' &&
    (env.JADARAT_ENVIRONMENT?.trim() ?? '') !== '' &&
    clientIp.kind === 'unset'
  ) {
    throw new Error(
      `${CLIENT_IP_HEADER_ENV} is required on a production server outside Vercel (JADARAT_ENVIRONMENT is set): name the header your proxy overwrites with the visitor's address (e.g. x-real-ip), or set it to none to run knowingly with one shared budget`,
    );
  }
  const rawBaseUrl = env.APP_BASE_URL?.trim() ?? '';
  const appBaseUrl = rawBaseUrl === '' ? null : parseAppBaseUrl(rawBaseUrl);
  if (rawBaseUrl !== '' && appBaseUrl === null) {
    throw new Error(
      "APP_BASE_URL must be the app's public https origin without a path (http only for localhost), e.g. https://tms.example.com",
    );
  }
  if (appBaseUrl === null && env.VERCEL_ENV === 'production') {
    log.warn("APP_BASE_URL is not set: copied invitation links use the browser's origin", {
      action: 'app.start',
      reason: 'app_base_url_missing',
    });
  }
  const workerKick = readWorkerKickSettings(env);
  if ((env.JOBS_DISPATCH_TOKEN?.trim() ?? '') !== '') {
    log.warn(
      'JOBS_DISPATCH_TOKEN is no longer used (the worker kick runs as a GitHub App): remove it and revoke the token',
      { action: 'app.start', reason: 'jobs_dispatch_token_obsolete' },
    );
  }
  if (workerKick.kind === 'invalid') {
    log.error(`${workerKick.problem} is invalid: the web app does not start worker passes`, {
      action: 'app.start',
      reason: 'jobs_dispatch_config_invalid',
    });
  } else if (
    workerKick.kind === 'on' &&
    env.VERCEL_ENV === 'production' &&
    cronSecret(env) === undefined
  ) {
    log.warn('CRON_SECRET is not set: the per-minute worker-pass cron is refused (401)', {
      action: 'app.start',
      reason: 'cron_secret_missing',
    });
  }
  const clientIpHeader = clientIp.kind === 'header' ? clientIp.name : null;
  if (env.NODE_ENV === 'production' && env.VERCEL !== '1' && clientIpHeader === null) {
    log.error(
      'no trusted client address header (JADARAT_CLIENT_IP_HEADER): every visitor shares one sign-in budget',
      { action: 'app.start', reason: 'client_ip_header_missing' },
    );
  }
  return {
    passwordResetDelivery: delivery,
    limitWindowSeconds,
    authClientHeader,
    clientIpHeader,
    appBaseUrl,
    workerKick: workerKick.kind,
  };
}
