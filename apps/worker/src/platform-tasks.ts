import { createRecoveryLinkIssuer } from '@jadarat/platform-db/admin';
import type { WithPlatformTx, WithSystemTx } from '@jadarat/platform-db/jobs';
import { type RecoveryLinks, createAccountMailer } from '@jadarat/platform-identity/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';

export interface PlatformTaskDependencies {
  /** Public origin of the web app (APP_BASE_URL); absent while e-mail is switched off. */
  readonly appBaseUrl: string | undefined;
  /** SUPABASE_URL + SUPABASE_SECRET_KEY (worker only); absent: no reset links. */
  readonly authAdmin: { readonly url: string; readonly secretKey: string } | undefined;
  readonly withPlatformTx: WithPlatformTx;
  readonly withSystemTx: WithSystemTx;
  readonly log: (level: WorkerLogLevel, message: string) => void;
  /** Injectable for tests: the Auth admin API's recovery links. */
  readonly recoveryLinksFor?: (settings: { url: string; secretKey: string }) => RecoveryLinks;
}

/**
 * The Auth admin API — the one use of the Supabase secret key in the whole system (ADR 0002 §7 note
 * T-M2-17): recovery links for the password-reset e-mail. Created only here, in the worker, through the
 * restricted admin entry point (dependency-cruiser `admin-client-only-in-jobs-or-admin`).
 */
function authAdminRecoveryLinks(settings: { url: string; secretKey: string }): RecoveryLinks {
  return createRecoveryLinkIssuer(settings, {
    reason: 'Recovery links for password-reset e-mails (T-M2-17)',
    actor: 'job:platform.account_mail',
  });
}

/** Work without a tenant (ADR 0005 §4), run on every wake-up and every minute: account e-mails. */
export function platformTasks(deps: PlatformTaskDependencies): readonly PlatformTask[] {
  const recoveryLinksFor = deps.recoveryLinksFor ?? authAdminRecoveryLinks;
  return [
    createAccountMailer({
      appBaseUrl: deps.appBaseUrl,
      recoveryLinks: deps.authAdmin ? recoveryLinksFor(deps.authAdmin) : null,
      withPlatformTx: deps.withPlatformTx,
      withSystemTx: deps.withSystemTx,
      log: deps.log,
    }),
  ];
}
