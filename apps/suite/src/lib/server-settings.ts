import 'server-only';
import {
  readAuthClientHeader,
  readAuthLimitWindowOverride,
  readPasswordResetDelivery,
} from '@jadarat/platform-identity';
import { log } from '@jadarat/platform-observability';
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
 * Client address (security review T-M2-11 L4): a SELF-HOSTED production server (JADARAT_ENVIRONMENT=
 * self-hosted, NODE_ENV=production) refuses to start without JADARAT_CLIENT_IP_HEADER — every visitor would
 * share one client key, so one abuser could use up the per-client budgets for all — unless it is set to
 * `none` explicitly (then, and for any other production server without one but Vercel, an ERROR is logged
 * at every start: `client_ip_header_missing`). Local and test production builds (`next start`, the E2E
 * server) set no JADARAT_ENVIRONMENT and keep starting.
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
    env.JADARAT_ENVIRONMENT?.trim() === 'self-hosted' &&
    clientIp.kind === 'unset'
  ) {
    throw new Error(
      `${CLIENT_IP_HEADER_ENV} is required on a self-hosted production server: name the header your proxy overwrites with the visitor's address (e.g. x-real-ip), or set it to none to run knowingly with one shared budget`,
    );
  }
  const clientIpHeader = clientIp.kind === 'header' ? clientIp.name : null;
  if (env.NODE_ENV === 'production' && env.VERCEL !== '1' && clientIpHeader === null) {
    log.error(
      'no trusted client address header (JADARAT_CLIENT_IP_HEADER): every visitor shares one sign-in budget',
      { action: 'app.start', reason: 'client_ip_header_missing' },
    );
  }
  return { passwordResetDelivery: delivery, limitWindowSeconds, authClientHeader, clientIpHeader };
}
