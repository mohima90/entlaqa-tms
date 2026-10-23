import { createHash, randomBytes, randomInt } from 'node:crypto';
import { describeUserAgent } from '@jadarat/platform-core';
import {
  type AccountMailRequest,
  type SystemTx,
  type WithPlatformTx,
  type WithSystemTx,
  accountHasApp,
  accountNeedsPlatformSender,
  claimAccountMailRequest,
  finishAccountMailRequest,
  issueMfaFactorTokens,
  loadAccountMailContext,
  loadPersonName,
  retryAccountMailRequest,
  tenantIsServed,
} from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { isEmailAddress, isSafeLink, renderEmail } from '@jadarat/platform-notifications';
import { type EmailRequest, queueEmail } from '@jadarat/platform-notifications/jobs';
import { type AuthLimits, PLATFORM_AUTH_LIMITS } from '../auth-limits-config';
import { hashToken } from './invitation-mailer';

/** graphile-worker task of the account e-mails (a platform task: requests have no tenant yet). */
export const ACCOUNT_MAIL_TASK = 'platform.account_mail';
/** Requests answered per pass; a full pass queues the next one at once. */
export const ACCOUNT_MAIL_BATCH = 20;
/**
 * Auth's e-mail one-time token lifetime (`otp_exp` = 600 s since the e-mailed sign-in code, WP-ADM-05: one
 * setting for every e-mail Auth issues), stated in the e-mail.
 */
export const RESET_LINK_VALID_MINUTES = 10;
/**
 * Per person and organization: at most this many e-mails of each account template an hour (beyond the web
 * app's own limits and Auth's one link a minute) — a further request is answered without an e-mail.
 * Security notices are exempt (SECURITY_NOTICE_KINDS). The "account locked" notice has stricter caps of
 * its own (PLATFORM_AUTH_LIMITS.lockoutMail, T-M2-11 M3): at most one per person a day and a ceiling per
 * organization an hour.
 */
export const ACCOUNT_MAIL_HOURLY_CAP = 5;
/**
 * Security notices (re-review N3): an authenticator app added (its e-mail carries the set-up code) or removed
 * (also an admin or support reset, an expired set-up), the security settings changed, the password changed,
 * wrong codes after the password (integration review T-M2-11 M1 — at most one per pause: none to the person
 * within the pause's minutes of the last one), and the digest of held ones. They are never dropped by the per-template hourly cap — the owner must learn
 * of every change to the account's security — and a notice over that cap is logged. Their volume per account
 * is bounded by the database (final re-review L1): 20 in 24 hours one by one, further ones merged into one
 * digest an hour (outcome `held`, then a `security_digest` request).
 */
export const SECURITY_NOTICE_KINDS: ReadonlySet<AccountMailRequest['kind']> = new Set([
  'mfa_factor_added',
  'mfa_factor_removed',
  'security_policy_changed',
  'password_changed',
  'mfa_code_locked',
  'security_digest',
]);
/**
 * The set-up e-mail's code and link lifetimes, stated in it — the database's private.mfa_code_lifetime() /
 * mfa_remove_link_lifetime() decide; pgTAP 68 checks they are these values.
 */
export const MFA_CODE_VALID_HOURS = 72;
export const MFA_REMOVE_VALID_DAYS = 7;
/** Dates in the security notices (policy change, app set-up), until organizations have their own time zone. */
const TIME_ZONE = 'Asia/Riyadh';

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
  /** The lockout e-mail's caps (default: the one budgets config, PLATFORM_AUTH_LIMITS.lockoutMail). */
  readonly lockoutMail?: AuthLimits['lockoutMail'];
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
interface OrganizationName {
  readonly ar: string;
  readonly en: string | null;
}
type AccountTemplate =
  | 'platform.password_reset'
  | 'platform.password_changed'
  | 'platform.mfa_factor_added'
  | 'platform.mfa_factor_removed'
  | 'platform.security_policy_changed'
  | 'platform.security_digest'
  | 'platform.account_locked'
  | 'platform.sign_in_unlocked'
  | 'platform.mfa_code_locked'
  | 'platform.password_reset_platform'
  | 'platform.mfa_factor_added_platform';
type AccountEmail = EmailRequest<AccountTemplate>;

const TEMPLATE_OF: Readonly<Record<AccountMailRequest['kind'], AccountTemplate>> = {
  password_reset: 'platform.password_reset',
  password_changed: 'platform.password_changed',
  mfa_factor_added: 'platform.mfa_factor_added',
  mfa_factor_removed: 'platform.mfa_factor_removed',
  security_policy_changed: 'platform.security_policy_changed',
  security_digest: 'platform.security_digest',
  account_locked: 'platform.account_locked',
  sign_in_unlocked: 'platform.sign_in_unlocked',
  mfa_code_locked: 'platform.mfa_code_locked',
};

/**
 * The e-mails that open the account carry a secret (the reset link, the set-up code): for a person who belongs
 * to several organizations or holds a platform role they go out as the `_platform` variant, which the sender
 * sends through the platform sender ONLY - never an organization's own mail relay (WP-ADM-05 security review).
 */
const PLATFORM_VARIANT: Readonly<Partial<Record<AccountTemplate, AccountTemplate>>> = {
  'platform.password_reset': 'platform.password_reset_platform',
  'platform.mfa_factor_added': 'platform.mfa_factor_added_platform',
};

/** A new link token: 32 random bytes, base64url (43 characters) — only its SHA-256 is stored. */
const newToken = () => randomBytes(32).toString('base64url');

/** A new set-up code: 8 random digits (re-review N1) — only its SHA-256 with the app's id is stored. */
const newSetupCode = () => String(randomInt(0, 100_000_000)).padStart(8, '0');

/**
 * SHA-256 of a set-up code bound to its app — as the database checks it (private.confirm_mfa_setup:
 * sha256(factor id || ':' || code)). The same code for another app is another hash.
 */
export function hashMfaSetupCode(factorId: string, code: string): Buffer {
  return createHash('sha256').update(`${factorId.toLowerCase()}:${code}`, 'utf8').digest();
}

/** Stands in for the token while the reset e-mail's content is checked before a token exists. */
const PLACEHOLDER_TOKEN_HASH = '0'.repeat(56);

/**
 * Account e-mails (FR-NTF-02 as clarified in BRD v2.5, FR-IAM-13, FR-IAM-16; T-M2-17): the
 * password-reset e-mail, the "password changed" notice and — since T-M2-11 — the "account locked" notice
 * (at most one per person a day, and at most PLATFORM_AUTH_LIMITS.lockoutMail.tenantPerHour per
 * organization an hour — security review M3), the "sign-in unlocked" notice after an Organization
 * Admin's unlock (security review M1) and the "wrong codes after your password" security notice when wrong
 * codes paused code checks (integration review M1), sent by our notification service in the
 * organization's language and brand instead of Supabase Auth's own mailer. Each pass leases waiting
 * requests (platform transaction: they have no tenant yet); the database says whom to write in which
 * organization and language, or why nothing is sent (unknown address, banned, a link issued less than a
 * minute ago, no active membership). A reset gets a new recovery token from the Auth admin API —
 * which sends nothing itself — as the LAST step before queueing, after the organization, the person, the
 * hourly cap and the content were checked (a new token invalidates the previous link). The link is
 * built exactly as Auth's template built it:
 * `{APP_BASE_URL}/{ar|en}/reset-password#token_hash=…&type=recovery` (the reset page and its completion
 * are unchanged). The e-mail is queued in the organization's delivery log in the same transaction that
 * removes the request; the existing sender sends it (its retries apply). A temporary failure (Auth, the
 * database) puts the request back with a back-off, at most 5 attempts. Logs carry kinds and codes only,
 * never addresses, tokens or ids of people.
 *
 * T-M2-10 adds the security notices queued by the database: the set-up e-mail of an authenticator app
 * (when and from which browser, "not you? remove this app", and the one-time code for the window that set it
 * up — re-review N1), the "app removed" notice (every removal, reset or expired set-up) and the "security
 * settings changed" notice to every Organization Admin (review L5). Security notices are never dropped by
 * the hourly cap (re-review N3). A reset e-mail for an account with an app says the page will ask for a code
 * (`&mfa=1`): Auth wants AAL2 to set the password.
 */
export function createAccountMailer(options: AccountMailerOptions): PlatformTask {
  let base = options.appBaseUrl;
  // Trailing slashes trimmed without a backtracking regular expression (CodeQL js/polynomial-redos).
  while (base?.endsWith('/')) base = base.slice(0, -1);
  if (base !== undefined && !isSafeLink(base)) {
    throw new Error('account mailer: the app base URL must be https (http only for localhost)');
  }
  const { log, recoveryLinks, withPlatformTx, withSystemTx } = options;
  const lockoutMail = options.lockoutMail ?? PLATFORM_AUTH_LIMITS.lockoutMail;
  if (
    !Number.isInteger(lockoutMail.personQuietHours) ||
    lockoutMail.personQuietHours < 1 ||
    lockoutMail.personQuietHours > 24 ||
    !Number.isInteger(lockoutMail.tenantPerHour) ||
    lockoutMail.tenantPerHour < 1
  ) {
    throw new Error(
      'account mailer: lockout e-mail caps must be 1–24 hours and at least 1 an hour',
    );
  }

  async function finishUnsent(jobId: string, request: AccountMailRequest, reason: string) {
    await withPlatformTx({ jobId }, (tx) => finishAccountMailRequest(tx, request.id));
    log('info', `account e-mail not sent (${request.kind}: ${reason})`);
  }

  /**
   * In the organization's transaction: may this e-mail go to this person now? The organization must
   * still be served (active or trial) and the person visible, and the hourly cap must not be reached; a
   * lockout notice also needs none to the person within the quiet hours and the organization below its
   * hourly ceiling; a "wrong codes" notice none to the person within its pause's minutes (one per pause).
   * When not, the request is answered — removed — in the same transaction and the reason returned (the
   * lock itself is unaffected: only the e-mail is left out).
   */
  async function admissible(
    tx: SystemTx,
    request: Sendable,
  ): Promise<{ readonly organizationName: OrganizationName } | { readonly reason: string }> {
    const template = TEMPLATE_OF[request.kind];
    const locked = request.kind === 'account_locked';
    const codesPaused = request.kind === 'mfa_code_locked';
    const quietMinutes = locked
      ? lockoutMail.personQuietHours * 60
      : codesPaused
        ? Math.min(Math.max(request.lockMinutes ?? 1, 1), 1440)
        : 0;
    // A suspended or closed organization since the lease: its RLS shows nothing; nothing is sent.
    const context = (await tenantIsServed(tx))
      ? await loadAccountMailContext(tx, request.personId, template, quietMinutes)
      : null;
    if (!context) {
      await finishAccountMailRequest(tx, request.id);
      return { reason: 'organization_unavailable' };
    }
    if (context.recentCount >= ACCOUNT_MAIL_HOURLY_CAP) {
      if (!SECURITY_NOTICE_KINDS.has(request.kind)) {
        await finishAccountMailRequest(tx, request.id);
        return { reason: 'hourly_cap' };
      }
      // Re-review N3: never dropped silently — sent, and the volume shows in the logs.
      log('warning', `security notice over the hourly cap sent anyway (${request.kind})`);
    }
    if ((locked || codesPaused) && context.quietCount > 0) {
      await finishAccountMailRequest(tx, request.id);
      return { reason: 'already_notified' };
    }
    if (locked && context.tenantRecentCount >= lockoutMail.tenantPerHour) {
      await finishAccountMailRequest(tx, request.id);
      return { reason: 'organization_hourly_cap' };
    }
    return { organizationName: context.organizationName };
  }

  /** Queues the e-mail in the organization and removes the request, in one transaction. */
  async function queueInTenant(
    jobId: string,
    request: Sendable,
    email: (
      organizationName: OrganizationName,
      tx: SystemTx,
    ) => AccountEmail | Promise<AccountEmail>,
  ): Promise<string> {
    return withSystemTx({ tenantId: request.tenantId, jobId }, async (tx: SystemTx) => {
      // Checked again: anything may have changed since the lease (or the check before the token).
      const checked = await admissible(tx, request);
      if ('reason' in checked) return checked.reason;
      // The organization's logo is linked from the app's origin (WP-ADM-02, FR-NTF-02).
      const built = await email(checked.organizationName, tx);
      const variant = PLATFORM_VARIANT[built.template];
      const platform = variant && (await accountNeedsPlatformSender(tx, request.userId));
      await queueEmail(tx, {
        ...built,
        ...(variant && platform ? { template: variant } : {}),
        appBaseUrl: base,
      });
      await finishAccountMailRequest(tx, request.id);
      return 'queued';
    });
  }

  /**
   * The set-up e-mail of an authenticator app (re-review N1): a new one-time code and a new "not you" link
   * token whose hashes are stored — replacing those of an earlier e-mail, and resetting the code's tries — in
   * the same organization transaction that queues this one, after the organization and the person were
   * checked: a refused or failed e-mail never spoils the code already sent. Nothing is sent for an app that
   * is gone or already confirmed. The e-mail says when and from which browser (well-known names only) the
   * app was set up.
   */
  async function sendSetUp(
    jobId: string,
    request: Sendable,
    pages: (path: string) => { ar: string; en: string },
  ): Promise<string> {
    const { factorId } = request;
    return withSystemTx({ tenantId: request.tenantId, jobId }, async (tx: SystemTx) => {
      const checked = await admissible(tx, request);
      if ('reason' in checked) return checked.reason;
      const code = newSetupCode();
      const remove = newToken();
      const issued = factorId
        ? await issueMfaFactorTokens(
            tx,
            factorId,
            request.userId,
            hashMfaSetupCode(factorId, code),
            hashToken(remove),
          )
        : null;
      if (!issued) {
        await finishAccountMailRequest(tx, request.id);
        return 'factor_gone';
      }
      const device = describeUserAgent(issued.setupUserAgent);
      // The link's token in the URL FRAGMENT: never sent to the server with the page request; the page
      // asks for a click.
      const platformOnly = await accountNeedsPlatformSender(tx, request.userId);
      await queueEmail(tx, {
        template: platformOnly ? 'platform.mfa_factor_added_platform' : 'platform.mfa_factor_added',
        locale: request.locale,
        to: request.email,
        recipientPersonId: request.personId,
        appBaseUrl: base,
        variables: {
          organizationName: checked.organizationName,
          code,
          setUpAt: issued.setUpAt.toISOString(),
          timeZone: TIME_ZONE,
          browser: device.browser,
          system: device.system,
          removeUrl: pages(`mfa/remove#token=${remove}`),
          codeValidHours: MFA_CODE_VALID_HOURS,
          removeValidDays: MFA_REMOVE_VALID_DAYS,
          loginEmail: request.email,
        },
      });
      await finishAccountMailRequest(tx, request.id);
      return 'queued';
    });
  }

  async function send(jobId: string, request: Sendable, appBase: string): Promise<string> {
    const pages = (path: string) => ({ ar: `${appBase}/ar/${path}`, en: `${appBase}/en/${path}` });
    if (request.kind === 'account_locked') {
      return queueInTenant(jobId, request, (organizationName) => ({
        template: 'platform.account_locked',
        locale: request.locale,
        to: request.email,
        recipientPersonId: request.personId,
        variables: {
          organizationName,
          lockMinutes: request.lockMinutes ?? 15,
          forgotPasswordUrl: pages('forgot-password'),
          loginEmail: request.email,
        },
      }));
    }
    if (request.kind === 'mfa_code_locked') {
      return queueInTenant(jobId, request, (organizationName) => ({
        template: 'platform.mfa_code_locked',
        locale: request.locale,
        to: request.email,
        recipientPersonId: request.personId,
        variables: {
          organizationName,
          lockMinutes: request.lockMinutes ?? 15,
          forgotPasswordUrl: pages('forgot-password'),
          loginEmail: request.email,
        },
      }));
    }
    if (request.kind === 'sign_in_unlocked') {
      return queueInTenant(jobId, request, (organizationName) => ({
        template: 'platform.sign_in_unlocked',
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
    if (request.kind === 'mfa_factor_added') return sendSetUp(jobId, request, pages);
    if (request.kind === 'mfa_factor_removed') {
      const reason = request.mfaReason ?? 'removed';
      return queueInTenant(jobId, request, (organizationName) => ({
        template: 'platform.mfa_factor_removed',
        locale: request.locale,
        to: request.email,
        recipientPersonId: request.personId,
        variables: {
          organizationName,
          reason,
          forgotPasswordUrl: pages('forgot-password'),
          loginEmail: request.email,
        },
      }));
    }
    if (request.kind === 'security_policy_changed') {
      const change = request.policyChange;
      if (!change) {
        // The database refuses such a request; a retry could not fix it.
        throw Object.assign(new Error('policy change without its detail'), {
          code: 'POLICY_CHANGE_DETAIL_MISSING',
          temporary: false,
        });
      }
      return queueInTenant(jobId, request, async (organizationName, tx) => ({
        template: 'platform.security_policy_changed',
        locale: request.locale,
        to: request.email,
        recipientPersonId: request.personId,
        variables: {
          organizationName,
          changedBy: change.changedByPersonId
            ? await loadPersonName(tx, change.changedByPersonId)
            : null,
          changed: change.changed as never,
          changedAt: change.changedAt.toISOString(),
          timeZone: TIME_ZONE,
          settingsUrl: pages('suite/admin/security'),
          loginEmail: request.email,
        },
      }));
    }
    if (request.kind === 'security_digest') {
      const digest = request.digest;
      if (!digest) {
        throw Object.assign(new Error('security digest without its detail'), {
          code: 'SECURITY_DIGEST_DETAIL_MISSING',
          temporary: false,
        });
      }
      return queueInTenant(jobId, request, (organizationName) => ({
        template: 'platform.security_digest',
        locale: request.locale,
        to: request.email,
        recipientPersonId: request.personId,
        variables: {
          organizationName,
          held: digest.held,
          since: digest.since.toISOString(),
          timeZone: TIME_ZONE,
          forgotPasswordUrl: pages('forgot-password'),
          loginEmail: request.email,
        },
      }));
    }
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
    // An account with an authenticator app: Auth wants a code to set the password (AAL2), so the page asks
    // for it and the e-mail says so (T-M2-10).
    const codeNeeded = await withPlatformTx({ jobId }, (tx) => accountHasApp(tx, request.userId));
    const flag = codeNeeded ? '&mfa=1' : '';
    // In the URL FRAGMENT, as before (T-M2-08): never sent to the server with the page request.
    const resetEmail =
      (hashedToken: string) =>
      (organizationName: OrganizationName): EmailRequest<'platform.password_reset'> => ({
        template: 'platform.password_reset',
        locale: request.locale,
        to: request.email,
        recipientPersonId: request.personId,
        variables: {
          organizationName,
          resetUrl: {
            ar: `${appBase}/ar/reset-password#token_hash=${hashedToken}&type=recovery${flag}`,
            en: `${appBase}/en/reset-password#token_hash=${hashedToken}&type=recovery${flag}`,
          },
          validMinutes: RESET_LINK_VALID_MINUTES,
          loginEmail: request.email,
          codeNeeded,
        },
      });
    // A new token REPLACES the account's previous one: the link the person may have just received stops
    // working. So everything that could still stop this e-mail is checked first — organization, person,
    // hourly cap, the content itself — and Auth is asked last, right before queueing (security review
    // T-M2-17: otherwise capped or unsendable requests would keep invalidating the person's links).
    const refused = await withSystemTx({ tenantId: request.tenantId, jobId }, async (tx) => {
      const checked = await admissible(tx, request);
      if ('reason' in checked) return checked.reason;
      const draft = resetEmail(PLACEHOLDER_TOKEN_HASH)(checked.organizationName);
      let valid = isEmailAddress(draft.to);
      try {
        renderEmail('platform.password_reset', draft.locale, draft.variables);
      } catch {
        valid = false;
      }
      if (valid) return null;
      await finishAccountMailRequest(tx, request.id);
      return 'invalid_content';
    });
    if (refused) return refused;
    const link = await recoveryLinks.issue(request.email);
    if (link.status === 'unknown_account') {
      // The account went away since the lease (Auth looked it up again): nothing to send.
      await withPlatformTx({ jobId }, (tx) => finishAccountMailRequest(tx, request.id));
      return 'unknown_account';
    }
    return queueInTenant(jobId, request, resetEmail(link.hashedToken));
  }

  async function answer(jobId: string, request: AccountMailRequest): Promise<void> {
    if (request.outcome === 'held') {
      // The database answered it already: merged into the account's next digest (final re-review L1).
      log('info', `security notice merged into the account's digest (${request.kind})`);
      return;
    }
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
      // An organization over its hourly ceiling of lockout e-mails is under a spray: worth a warning
      // (security re-review N4); every other outcome is routine.
      log(
        result === 'organization_hourly_cap' ? 'warning' : 'info',
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
