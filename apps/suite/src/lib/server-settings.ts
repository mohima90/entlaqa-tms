import 'server-only';
import {
  readAuthClientHeader,
  readAuthLimitWindowOverride,
  readPasswordResetDelivery,
} from '@jadarat/platform-identity';
import { log } from '@jadarat/platform-observability';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The header a self-hosted installation's gateway OVERWRITES with the visitor's address (lib/client-ip.ts;
 * TM-0003 T-IAM-03), or null. On Vercel the platform's own `x-real-ip` is used without it.
 */
export function readClientIpHeader(env: Env): string | null {
  const value = env.JADARAT_CLIENT_IP_HEADER?.trim() ?? '';
  return value === '' ? null : value;
}

/**
 * Server settings checked once at start-up (instrumentation `register`), so a wrong value stops the
 * deployment instead of failing the first visitor: PASSWORD_RESET_DELIVERY (`auth` | `worker`, T-M2-17,
 * docs/engineering/password-reset.md), AUTH_RATE_LIMIT_WINDOW_SECONDS (T-M2-11, the self-hosted smoke
 * test only: shortens every sign-in, reset and invitation limit window; refused in production without
 * AUTH_RATE_LIMIT_WINDOW_SMOKE_ONLY=1, and on a Vercel production deployment always) and
 * JADARAT_AUTH_CLIENT_HEADER (T-M2-11, self-hosted only: the header carrying the visitor's key to Auth's
 * own limits) — docs/engineering/sign-in-protection.md. Read again on use; never sent to the browser.
 *
 * A self-hosted production server without JADARAT_CLIENT_IP_HEADER is logged as an ERROR (security review
 * T-M2-11) but still starts: every visitor then shares one client key, so the per-client sign-in budgets
 * become installation-wide — a denial-of-service risk, not a way around a limit (the account lock and
 * every other check still apply). Refusing to start would also stop installations whose proxy sets the
 * header under another name until reconfigured, and local production builds (`next start`) used by tests;
 * the runbook makes the header a deployment requirement and the reference stack sets it.
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
  const clientIpHeader = readClientIpHeader(env);
  if (env.NODE_ENV === 'production' && env.VERCEL !== '1' && clientIpHeader === null) {
    log.error(
      'no trusted client address header (JADARAT_CLIENT_IP_HEADER): every visitor shares one sign-in budget',
      { action: 'app.start', reason: 'client_ip_header_missing' },
    );
  }
  return { passwordResetDelivery: delivery, limitWindowSeconds, authClientHeader, clientIpHeader };
}
