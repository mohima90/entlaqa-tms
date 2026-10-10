import { createRecoveryLinkIssuer, createStorageAdmin } from '@jadarat/platform-db/admin';
import type { WithPlatformTx, WithSystemTx } from '@jadarat/platform-db/jobs';
import {
  type FileObjectStore,
  type OrphanSweepSettings,
  type Scanner,
  createClamdScanner,
  createFileHousekeepingTask,
  createFileScanTask,
} from '@jadarat/platform-files/jobs';
import {
  type RecoveryLinks,
  createAccountMailer,
  createSessionPurger,
} from '@jadarat/platform-identity/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';

export interface PlatformTaskDependencies {
  /** Public origin of the web app (APP_BASE_URL); absent while e-mail is switched off. */
  readonly appBaseUrl: string | undefined;
  /** SUPABASE_URL + SUPABASE_SECRET_KEY (worker only); absent: no reset links, no file tasks. */
  readonly authAdmin: { readonly url: string; readonly secretKey: string } | undefined;
  /**
   * CLAMD_HOST + CLAMD_PORT (+ the signatures' hard age limit, default 7 days); absent: uploaded files are
   * not scanned (they wait, never clean).
   */
  readonly scanner?:
    | { readonly host: string; readonly port: number; readonly maxSignatureAgeDays?: number }
    | undefined;
  /** The orphan sweep's switch and brake (FILE_ORPHAN_SWEEP…); absent: on, with the default brake. */
  readonly orphanSweep?: OrphanSweepSettings | undefined;
  readonly withPlatformTx: WithPlatformTx;
  readonly withSystemTx: WithSystemTx;
  readonly log: (level: WorkerLogLevel, message: string) => void;
  /** Injectable for tests: the Auth admin API's recovery links. */
  readonly recoveryLinksFor?: (settings: { url: string; secretKey: string }) => RecoveryLinks;
  /** Injectable for tests: Storage with the worker's key. */
  readonly storeFor?: (settings: { url: string; secretKey: string }) => FileObjectStore;
  /** Injectable for tests: the malware scanner. */
  readonly scannerFor?: (settings: { host: string; port: number }) => Scanner;
  /**
   * The Auth admin token's expiry check (adminKeyExpiryCheck): run before every account-mail pass; it
   * warns at most once a day per process, so a long-running daemon keeps reminding until renewal.
   */
  readonly adminKeyCheck?: (() => void) | undefined;
}

/**
 * The Auth admin API — one of the two uses of the Supabase secret key, both in the worker only (ADR 0002
 * §7 notes T-M2-17, T-M2-18): recovery links for the password-reset e-mail. Created only here, through
 * the restricted admin entry point (dependency-cruiser `admin-client-only-in-jobs-or-admin`).
 */
function authAdminRecoveryLinks(settings: { url: string; secretKey: string }): RecoveryLinks {
  return createRecoveryLinkIssuer(settings, {
    reason: 'Recovery links for password-reset e-mails (T-M2-17)',
    actor: 'job:platform.account_mail',
  });
}

/**
 * The other use of the secret key (T-M2-18, ADR 0006 §3.4, §7): Storage for the file tasks — reading
 * uploads to scan them, quarantine moves, retention removals, generated files.
 */
function workerStore(settings: { url: string; secretKey: string }): FileObjectStore {
  return createStorageAdmin(settings);
}

/**
 * Work without a tenant (ADR 0005 §4), run on every wake-up and every minute: account e-mails (reset
 * links, lock notices), ended sessions removed from Auth (T-M2-10, at most once a minute), and — with
 * Storage configured — file housekeeping and, with a scanner, the malware scan (T-M2-18).
 */
export function platformTasks(deps: PlatformTaskDependencies): readonly PlatformTask[] {
  const recoveryLinksFor = deps.recoveryLinksFor ?? authAdminRecoveryLinks;
  const mailer = createAccountMailer({
    appBaseUrl: deps.appBaseUrl,
    recoveryLinks: deps.authAdmin ? recoveryLinksFor(deps.authAdmin) : null,
    withPlatformTx: deps.withPlatformTx,
    withSystemTx: deps.withSystemTx,
    log: deps.log,
  });
  const purger = createSessionPurger({ withPlatformTx: deps.withPlatformTx, log: deps.log });
  const adminKeyCheck = deps.adminKeyCheck;
  const tasks: PlatformTask[] = [
    adminKeyCheck
      ? {
          name: mailer.name,
          run: (context) => {
            adminKeyCheck();
            return mailer.run(context);
          },
        }
      : mailer,
    purger,
  ];
  if (deps.authAdmin) {
    const store = (deps.storeFor ?? workerStore)(deps.authAdmin);
    tasks.push(
      createFileHousekeepingTask({
        withPlatformTx: deps.withPlatformTx,
        store,
        log: deps.log,
        ...(deps.orphanSweep ? { orphanSweep: deps.orphanSweep } : {}),
      }),
    );
    if (deps.scanner) {
      const { host, port, maxSignatureAgeDays } = deps.scanner;
      tasks.push(
        createFileScanTask({
          withPlatformTx: deps.withPlatformTx,
          withSystemTx: deps.withSystemTx,
          store,
          scanner: (deps.scannerFor ?? createClamdScanner)({ host, port }),
          log: deps.log,
          ...(maxSignatureAgeDays === undefined ? {} : { maxSignatureAgeDays }),
        }),
      );
    }
  }
  return tasks;
}
