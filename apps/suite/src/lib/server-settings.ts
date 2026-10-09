import 'server-only';
import { readPasswordResetDelivery } from '@jadarat/platform-identity';
import { log } from '@jadarat/platform-observability';

/**
 * Server settings checked once at start-up (instrumentation `register`), so a wrong value stops the
 * deployment instead of failing the first visitor: PASSWORD_RESET_DELIVERY (`auth` | `worker`, T-M2-17,
 * docs/engineering/password-reset.md). Read again on use; never sent to the browser.
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
  return { passwordResetDelivery: delivery };
}
