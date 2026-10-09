import { createAccountBans, createRecoveryLinkIssuer } from '@jadarat/platform-db/admin';
import type { WithPlatformTx, WithSystemTx } from '@jadarat/platform-db/jobs';
import {
  type AccountBanApi,
  type RecoveryLinks,
  createAccountAccessTask,
  createAccountMailer,
} from '@jadarat/platform-identity/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';

export interface PlatformTaskDependencies {
  /** Public origin of the web app (APP_BASE_URL); absent while e-mail is switched off. */
  readonly appBaseUrl: string | undefined;
  /** SUPABASE_URL + SUPABASE_SECRET_KEY (worker only); absent: no reset links, no account bans. */
  readonly authAdmin: { readonly url: string; readonly secretKey: string } | undefined;
  readonly withPlatformTx: WithPlatformTx;
  readonly withSystemTx: WithSystemTx;
  readonly log: (level: WorkerLogLevel, message: string) => void;
  /** Injectable for tests: the Auth admin API's recovery links. */
  readonly recoveryLinksFor?: (settings: { url: string; secretKey: string }) => RecoveryLinks;
  /** Injectable for tests: the Auth admin API's account bans. */
  readonly accountBansFor?: (settings: { url: string; secretKey: string }) => AccountBanApi;
  /**
   * The Auth admin token's expiry check (adminKeyExpiryCheck): run before every pass of a task that uses
   * the key; it warns at most once a day per process, so a long-running daemon keeps reminding until
   * renewal.
   */
  readonly adminKeyCheck?: (() => void) | undefined;
}

/**
 * The Auth admin API — the one use of the Supabase secret key in the whole system (ADR 0002 §7 notes
 * T-M2-17 and T-M2-09): recovery links for the password-reset e-mail, and bans of accounts that sign in
 * nowhere. Created only here, in the worker, through the restricted admin entry point
 * (dependency-cruiser `admin-client-only-in-jobs-or-admin`).
 */
function authAdminRecoveryLinks(settings: { url: string; secretKey: string }): RecoveryLinks {
  return createRecoveryLinkIssuer(settings, {
    reason: 'Recovery links for password-reset e-mails (T-M2-17)',
    actor: 'job:platform.account_mail',
  });
}

function authAdminAccountBans(settings: { url: string; secretKey: string }): AccountBanApi {
  return createAccountBans(settings, {
    reason: 'Ban Auth accounts that sign in nowhere, lift the ban when they may again (T-M2-09)',
    actor: 'job:platform.account_access',
  });
}

/**
 * Work without a tenant (ADR 0005 §4), run on every wake-up and every minute: account e-mails, and — only
 * when the Auth admin API is configured — the Auth bans of deactivated accounts (T-M2-09; without it the
 * checks wait in their queue, and the database alone keeps deactivated members out).
 */
export function platformTasks(deps: PlatformTaskDependencies): readonly PlatformTask[] {
  const recoveryLinksFor = deps.recoveryLinksFor ?? authAdminRecoveryLinks;
  const accountBansFor = deps.accountBansFor ?? authAdminAccountBans;
  const tasks: PlatformTask[] = [
    createAccountMailer({
      appBaseUrl: deps.appBaseUrl,
      recoveryLinks: deps.authAdmin ? recoveryLinksFor(deps.authAdmin) : null,
      withPlatformTx: deps.withPlatformTx,
      withSystemTx: deps.withSystemTx,
      log: deps.log,
    }),
  ];
  if (deps.authAdmin) {
    tasks.push(
      createAccountAccessTask({
        bans: accountBansFor(deps.authAdmin),
        withPlatformTx: deps.withPlatformTx,
        log: deps.log,
      }),
    );
  }
  const adminKeyCheck = deps.adminKeyCheck;
  if (!adminKeyCheck) return tasks;
  return tasks.map((task) => ({
    name: task.name,
    run: (context) => {
      adminKeyCheck();
      return task.run(context);
    },
  }));
}
