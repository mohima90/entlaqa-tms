import 'server-only';
import {
  readAuthClientHeader,
  readAuthLimitWindowOverride,
  readPasswordResetDelivery,
} from '@jadarat/platform-identity';
import { log } from '@jadarat/platform-observability';

/**
 * Server settings checked once at start-up (instrumentation `register`), so a wrong value stops the
 * deployment instead of failing the first visitor: PASSWORD_RESET_DELIVERY (`auth` | `worker`, T-M2-17,
 * docs/engineering/password-reset.md) and AUTH_RATE_LIMIT_WINDOW_SECONDS (T-M2-11, tests only: shortens
 * every sign-in, reset and invitation limit window) and JADARAT_AUTH_CLIENT_HEADER (T-M2-11, self-hosted
 * only: the header carrying the visitor's key to Auth's own limits) — docs/engineering/sign-in-protection.md.
 * Read again on use; never sent to the browser.
 */
export function checkServerSettings(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
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
      'sign-in and reset limit windows shortened for testing (AUTH_RATE_LIMIT_WINDOW_SECONDS)',
      {
        action: 'app.start',
        reason: 'auth_limit_window_override',
        retryAfterS: limitWindowSeconds,
      },
    );
  }
  const authClientHeader = readAuthClientHeader(env);
  return { passwordResetDelivery: delivery, limitWindowSeconds, authClientHeader };
}
