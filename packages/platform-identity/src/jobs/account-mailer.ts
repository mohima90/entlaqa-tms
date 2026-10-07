import {
  type AccountMailRequest,
  type SystemTx,
  type WithPlatformTx,
  type WithSystemTx,
  claimAccountMailRequest,
  finishAccountMailRequest,
  loadAccountMailContext,
  retryAccountMailRequest,
  tenantIsServed,
} from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { isSafeLink } from '@jadarat/platform-notifications';
import { queueEmail } from '@jadarat/platform-notifications/jobs';

/** graphile-worker task of the account e-mails (a platform task: requests have no tenant yet). */
export const ACCOUNT_MAIL_TASK = 'platform.account_mail';
/** Requests answered per pass; a full pass queues the next one at once. */
export const ACCOUNT_MAIL_BATCH = 20;
/** Auth's link lifetime (`otp_exp` = 3600 s), stated in the e-mail. */
export const RESET_LINK_VALID_MINUTES = 60;
/**
 * Per person and organization: at most this many reset e-mails, and as many "password changed" notices,
 * an hour (beyond the web app's own limits and Auth's one link a minute) — a further request is answered
 * without an e-mail.
 */
export const ACCOUNT_MAIL_HOURLY_CAP = 5;

/** The Auth admin API's recovery links (platform-db/admin `createRecoveryLinkIssuer`), worker only. */
export interface RecoveryLinks {
  issue(
    email: string,
  ): Promise<
    | { readonly status: 'issued'; readonly hashedToken: string }
    | { readonly status: 'unknown_account' }
  >;
}

export interface AccountMailerOptions {
  /**
   * Public origin of the web app (APP_BASE_URL). Absent while e-mail is switched off: requests are then
   * answered without an e-mail (nothing could be sent anyway), so none waits.
   */
  readonly appBaseUrl: string | undefined;
  /**
   * Recovery links through the Auth admin API (SUPABASE_URL + SUPABASE_SECRET_KEY, worker only). Null
   * when not configured: reset requests are put back (and expire after their attempts or 60 minutes);
   * "password changed" notices are sent regardless.
   */
  readonly recoveryLinks: RecoveryLinks | null;
  readonly withPlatformTx: WithPlatformTx;
  readonly withSystemTx: WithSystemTx;
  readonly log: (level: WorkerLogLevel, message: string) => void;
}

/** A failure worth another attempt: Auth unreachable, rate limited, misconfigured; the database. */
function isTemporary(error: unknown): boolean {
  const temporary = (error as { temporary?: unknown } | null)?.temporary;
  return typeof temporary === 'boolean' ? temporary : true;
}

/** A stable code for the logs (never a message: Auth's and PostgreSQL's may quote the address). */
function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Za-z0-9_]{2,64}$/.test(code)) return code;
  return error instanceof Error ? error.name : 'unknown';
}

type Sendable = Extract<AccountMailRequest, { outcome: 'send' }>;

/**
 * Account e-mails (FR-NTF-02 as clarified in BRD v2.5, FR-IAM-13, FR-IAM-16; T-M2-17): the
 * password-reset e-mail and the "password changed" notice, sent by our notification service in the
 * organization's language and brand instead of Supabase Auth's own mailer. Each pass leases waiting
 * requests (platform transaction: they have no tenant yet); the database says whom to write in which
 * organization and language, or why nothing is sent (unknown address, banned, a link issued less than a
 * minute ago, no active membership). A reset gets a new recovery token from the Auth admin API —
 * which sends nothing itself — and the link is built exactly as Auth's template built it:
 * `{APP_BASE_URL}/{ar|en}/reset-password#token_hash=…&type=recovery` (the reset page and its completion
 * are unchanged). The e-mail is queued in the organization's delivery log in the same transaction that
 * removes the request; the existing sender sends it (its retries apply). A temporary failure (Auth, the
 * database) puts the request back with a back-off, at most 5 attempts. Logs carry kinds and codes only,
 * never addresses, tokens or ids of people.
 */
export function createAccountMailer(options: AccountMailerOptions): PlatformTask {
  let base = options.appBaseUrl;
  // Trailing slashes trimmed without a backtracking regular expression (CodeQL js/polynomial-redos).
  while (base?.endsWith('/')) base = base.slice(0, -1);
  if (base !== undefined && !isSafeLink(base)) {
    throw new Error('account mailer: the app base URL must be https (http only for localhost)');
  }
  const { log, recoveryLinks, withPlatformTx, withSystemTx } = options;

  async function finishUnsent(jobId: string, request: AccountMailRequest, reason: string) {
    await withPlatformTx({ jobId }, (tx) => finishAccountMailRequest(tx, request.id));
    log('info', `account e-mail not sent (${request.kind}: ${reason})`);
  }

  /** Queues the e-mail in the organization and removes the request, in one transaction. */
  async function queueInTenant(
    jobId: string,
    request: Sendable,
    variables: (organizationName: {
      ar: string;
      en: string | null;
    }) => Parameters<typeof queueEmail>[1],
  ): Promise<string> {
    return withSystemTx({ tenantId: request.tenantId, jobId }, async (tx: SystemTx) => {
      const template =
        request.kind === 'password_reset' ? 'platform.password_reset' : 'platform.password_changed';
      // A suspended or closed organization since the lease: its RLS shows nothing; nothing is sent.
      const context = (await tenantIsServed(tx))
        ? await loadAccountMailContext(tx, request.personId, template)
        : null;
      if (!context) {
        await finishAccountMailRequest(tx, request.id);
        return 'organization_unavailable';
      }
      if (context.recentCount >= ACCOUNT_MAIL_HOURLY_CAP) {
        await finishAccountMailRequest(tx, request.id);
        return 'hourly_cap';
      }
      await queueEmail(tx, variables(context.organizationName));
      await finishAccountMailRequest(tx, request.id);
      return 'queued';
    });
  }

  async function send(jobId: string, request: Sendable, appBase: string): Promise<string> {
    const pages = (path: string) => ({ ar: `${appBase}/ar/${path}`, en: `${appBase}/en/${path}` });
    if (request.kind === 'password_changed') {
      return queueInTenant(jobId, request, (organizationName) => ({
        template: 'platform.password_changed',
        locale: request.locale,
        to: request.email,
        recipientPersonId: request.personId,
        variables: {
          organizationName,
          forgotPasswordUrl: pages('forgot-password'),
          loginEmail: request.email,
        },
      }));
    }
    if (!recoveryLinks) {
      throw Object.assign(new Error('Auth admin API not configured'), {
        code: 'AUTH_ADMIN_NOT_CONFIGURED',
        temporary: true,
      });
    }
    const link = await recoveryLinks.issue(request.email);
    if (link.status === 'unknown_account') {
      // The account went away since the lease (Auth looked it up again): nothing to send.
      await withPlatformTx({ jobId }, (tx) => finishAccountMailRequest(tx, request.id));
      return 'unknown_account';
    }
    // In the URL FRAGMENT, as before (T-M2-08): never sent to the server with the page request.
    const fragment = `#token_hash=${link.hashedToken}&type=recovery`;
    return queueInTenant(jobId, request, (organizationName) => ({
      template: 'platform.password_reset',
      locale: request.locale,
      to: request.email,
      recipientPersonId: request.personId,
      variables: {
        organizationName,
        resetUrl: {
          ar: `${appBase}/ar/reset-password${fragment}`,
          en: `${appBase}/en/reset-password${fragment}`,
        },
        validMinutes: RESET_LINK_VALID_MINUTES,
        loginEmail: request.email,
      },
    }));
  }

  async function answer(jobId: string, request: AccountMailRequest): Promise<void> {
    if (request.outcome !== 'send') {
      await finishUnsent(jobId, request, request.outcome);
      return;
    }
    if (base === undefined) {
      await finishUnsent(jobId, request, 'email_off');
      return;
    }
    try {
      const result = await send(jobId, request, base);
      log(
        'info',
        `account e-mail ${result === 'queued' ? 'queued' : `not sent (${result})`} (${request.kind})`,
      );
    } catch (error) {
      const code = codeOf(error);
      if (!isTemporary(error)) {
        await finishUnsent(jobId, request, `refused ${code}`);
        return;
      }
      const again = await withPlatformTx({ jobId }, (tx) =>
        retryAccountMailRequest(tx, request.id),
      );
      log(
        again ? 'warning' : 'error',
        again
          ? `account e-mail failed (${request.kind}: ${code}); retried later`
          : `account e-mail failed (${request.kind}: ${code}); given up after ${String(request.attempt)} attempts`,
      );
    }
  }

  return {
    name: ACCOUNT_MAIL_TASK,
    async run({ jobId }) {
      for (let i = 0; i < ACCOUNT_MAIL_BATCH; i += 1) {
        const request = await withPlatformTx({ jobId }, claimAccountMailRequest);
        if (!request) return false;
        await answer(jobId, request);
      }
      return true;
    },
  };
}
