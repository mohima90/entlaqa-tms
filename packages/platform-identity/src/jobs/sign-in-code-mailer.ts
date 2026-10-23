import { randomInt } from 'node:crypto';
import {
  type SignInCodeRequest,
  type WithPlatformTx,
  type WithSystemTx,
  claimSignInCodeRequest,
  issueSignInCode,
  loadAccountMailContext,
  retrySignInCodeRequest,
  signInCodeDeadEnd,
  tenantIsServed,
} from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { isEmailAddress, isSafeLink, renderEmail } from '@jadarat/platform-notifications';
import { queueEmail } from '@jadarat/platform-notifications/jobs';
import type { RecoveryLinks } from './account-mailer';

/** graphile-worker task of the sign-in codes (a platform task: the person has no tenant yet). */
export const SIGN_IN_CODE_TASK = 'platform.sign_in_code';
/** Requests answered per pass; a full pass queues the next one at once. */
export const SIGN_IN_CODE_BATCH = 20;
/** How long a code works (the database's expiry; stated in the e-mail). */
export const SIGN_IN_CODE_VALID_MINUTES = 10;
/** Per person and organization: at most this many code e-mails an hour (beyond the web app's limits). */
export const SIGN_IN_CODE_HOURLY_CAP = 10;

export interface SignInCodeMailerOptions {
  /** Public origin of the web app (APP_BASE_URL). Absent while e-mail is switched off: no code can be sent. */
  readonly appBaseUrl: string | undefined;
  /**
   * One-time sign-in tokens through the Auth admin API (SUPABASE_URL + SUPABASE_SECRET_KEY, worker only).
   * Null when not configured: requests are put back (and removed after their attempts or 10 minutes).
   */
  readonly signInLinks: RecoveryLinks | null;
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

/** A new sign-in code: six random digits (uniform; only a keyed hash is stored). */
export function newSignInCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

type Sendable = Extract<SignInCodeRequest, { outcome: 'send' }>;

/**
 * Sign-in codes (WP-ADM-05, FR-IAM-12; migration 20261026100200): leases waiting requests in a platform
 * transaction; the database says whether the address has a usable account and whom to write in which
 * organization and language. For an account: ask the Auth admin API for a one-time sign-in token - the LAST
 * step before storing, after the organization, the person, the hourly cap and the e-mail's content were
 * checked (a new token replaces Auth's previous one-time token of the account, so nothing that could still
 * stop the e-mail may follow it) - generate the code, store its keyed hash with the token and queue the e-mail
 * in the organization's delivery log, all in the organization's transaction; the existing sender sends it
 * through the organization's own provider or the platform's (WP-ADM-01). A remembered browser (mode
 * `remembered`) gets the token only: no code, no e-mail. For an address nobody can sign in with the request
 * stays as a row no code can match (no account enumeration). A temporary failure puts the request back with a
 * back-off, at most 5 attempts. Logs carry kinds and codes only - never an address, a code or a token.
 */
export function createSignInCodeMailer(options: SignInCodeMailerOptions): PlatformTask {
  let base = options.appBaseUrl;
  while (base?.endsWith('/')) base = base.slice(0, -1);
  if (base !== undefined && !isSafeLink(base)) {
    throw new Error(
      'sign-in code mailer: the app base URL must be https (http only for localhost)',
    );
  }
  const { log, signInLinks, withPlatformTx, withSystemTx } = options;

  async function deadEnd(jobId: string, request: SignInCodeRequest, reason: string): Promise<void> {
    await withPlatformTx({ jobId }, (tx) => signInCodeDeadEnd(tx, request.id));
    log('info', `sign-in code not sent (${request.mode}: ${reason})`);
  }

  /** In the organization's transaction: may a code go to this person now? */
  async function admissible(jobId: string, request: Sendable): Promise<string | null> {
    return withSystemTx({ tenantId: request.tenantId, jobId }, async (tx) => {
      // A suspended or closed organization since the lease: its RLS shows nothing; nothing is sent.
      const context = (await tenantIsServed(tx))
        ? await loadAccountMailContext(tx, request.personId, 'platform.sign_in_code', 0)
        : null;
      if (!context) return 'organization_unavailable';
      if (request.mode === 'code' && context.recentCount >= SIGN_IN_CODE_HOURLY_CAP) {
        return 'hourly_cap';
      }
      if (request.mode === 'code') {
        // The e-mail's content must render before a token exists (a new token replaces the old one).
        try {
          renderEmail('platform.sign_in_code', request.locale, {
            organizationName: context.organizationName,
            code: '000000',
            validMinutes: SIGN_IN_CODE_VALID_MINUTES,
            loginEmail: request.email,
          });
        } catch {
          return 'invalid_content';
        }
        if (!isEmailAddress(request.email)) return 'invalid_content';
      }
      return null;
    });
  }

  async function send(jobId: string, request: Sendable, appBase: string): Promise<string> {
    if (!signInLinks) {
      throw Object.assign(new Error('Auth admin API not configured'), {
        code: 'AUTH_ADMIN_NOT_CONFIGURED',
        temporary: true,
      });
    }
    const refused = await admissible(jobId, request);
    if (refused) {
      await deadEnd(jobId, request, refused);
      return refused;
    }
    const link = await signInLinks.issue(request.email);
    if (link.status === 'unknown_account') {
      // The account went away since the lease (Auth looked it up again): nothing to send.
      await deadEnd(jobId, request, 'unknown_account');
      return 'unknown_account';
    }
    const code = request.mode === 'code' ? newSignInCode() : null;
    return withSystemTx({ tenantId: request.tenantId, jobId }, async (tx) => {
      const issued = await issueSignInCode(tx, {
        id: request.id,
        userId: request.userId,
        tenantId: request.tenantId,
        code,
        linkToken: link.hashedToken,
      });
      if (!issued) return 'already_answered';
      if (code === null) return 'token_ready';
      const context = await loadAccountMailContext(
        tx,
        request.personId,
        'platform.sign_in_code',
        0,
      );
      if (!context)
        throw Object.assign(new Error('person not visible'), {
          code: 'PERSON_GONE',
          temporary: false,
        });
      await queueEmail(tx, {
        template: 'platform.sign_in_code',
        locale: request.locale,
        to: request.email,
        recipientPersonId: request.personId,
        appBaseUrl: appBase,
        variables: {
          organizationName: context.organizationName,
          code,
          validMinutes: SIGN_IN_CODE_VALID_MINUTES,
          loginEmail: request.email,
        },
      });
      return 'queued';
    });
  }

  async function answer(jobId: string, request: SignInCodeRequest): Promise<void> {
    if (request.outcome !== 'send') {
      await deadEnd(jobId, request, request.outcome);
      return;
    }
    if (base === undefined) {
      await deadEnd(jobId, request, 'email_off');
      return;
    }
    try {
      const result = await send(jobId, request, base);
      log(
        'info',
        `sign-in code ${result === 'queued' || result === 'token_ready' ? result : `not sent (${result})`}`,
      );
    } catch (error) {
      const code = codeOf(error);
      if (!isTemporary(error)) {
        await deadEnd(jobId, request, `refused ${code}`);
        return;
      }
      const again = await withPlatformTx({ jobId }, (tx) => retrySignInCodeRequest(tx, request.id));
      log(
        again ? 'warning' : 'error',
        again
          ? `sign-in code failed (${request.mode}: ${code}); retried later`
          : `sign-in code failed (${request.mode}: ${code}); given up after ${String(request.attempt)} attempts`,
      );
    }
  }

  return {
    name: SIGN_IN_CODE_TASK,
    async run({ jobId }) {
      for (let i = 0; i < SIGN_IN_CODE_BATCH; i += 1) {
        const request = await withPlatformTx({ jobId }, claimSignInCodeRequest);
        if (!request) return false;
        await answer(jobId, request);
      }
      return true;
    },
  };
}
