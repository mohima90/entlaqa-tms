import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { MfaRemovalReason, PolicyChange, SecurityDigest } from '@jadarat/platform-db';
import type { EmailVariables } from '@jadarat/platform-notifications';

/**
 * What an account e-mail says and when it may be sent - the PURE part of the account mailer, used by the
 * worker (jobs/account-mailer.ts) and by the web app's immediate sending (inline-account-mail.ts; WP-ADM-05
 * follow-up, PO 23 Oct 2026), so the two cannot drift: the same wording, the same caps, the same lifetimes.
 * Nothing here reads or writes the database.
 */

/** Auth's link lifetime (`otp_exp` = 3600 s), stated in the reset e-mail. */
export const RESET_LINK_VALID_MINUTES = 60;
/**
 * Per person and organization: at most this many e-mails of each account template an hour (beyond the web
 * app's own limits and Auth's one link a minute) - a further request is answered without an e-mail.
 * Security notices are exempt (SECURITY_NOTICE_KINDS). The "account locked" notice has stricter caps of
 * its own (PLATFORM_AUTH_LIMITS.lockoutMail, T-M2-11 M3): at most one per person a day and a ceiling per
 * organization an hour.
 */
export const ACCOUNT_MAIL_HOURLY_CAP = 5;
/**
 * Security notices (re-review N3): an authenticator app added (its e-mail carries the set-up code) or removed
 * (also an admin or support reset, an expired set-up), the security settings changed, the password changed,
 * wrong codes after the password (integration review T-M2-11 M1 - at most one per pause: none to the person
 * within the pause's minutes of the last one), and the digest of held ones. They are never dropped by the
 * per-template hourly cap - the owner must learn of every change to the account's security - and a notice over
 * that cap is logged. Their volume per account is bounded by the database (final re-review L1): 20 in 24 hours
 * one by one, further ones merged into one digest an hour (outcome `held`, then a `security_digest` request).
 */
export type AccountMailKind =
  | 'password_reset'
  | 'password_changed'
  | 'mfa_factor_added'
  | 'mfa_factor_removed'
  | 'security_policy_changed'
  | 'security_digest'
  | 'account_locked'
  | 'sign_in_unlocked'
  | 'mfa_code_locked';

export const SECURITY_NOTICE_KINDS: ReadonlySet<AccountMailKind> = new Set([
  'mfa_factor_added',
  'mfa_factor_removed',
  'security_policy_changed',
  'password_changed',
  'mfa_code_locked',
  'security_digest',
]);
/**
 * The set-up e-mail's code and link lifetimes, stated in it - the database's private.mfa_code_lifetime() /
 * mfa_remove_link_lifetime() decide; pgTAP 68 checks they are these values.
 */
export const MFA_CODE_VALID_HOURS = 72;
export const MFA_REMOVE_VALID_DAYS = 7;
/** Dates in the security notices (policy change, app set-up), until organizations have their own time zone. */
export const ACCOUNT_MAIL_TIME_ZONE = 'Asia/Riyadh';

export interface OrganizationName {
  readonly ar: string;
  readonly en: string | null;
}

/** The lockout e-mail's caps (PLATFORM_AUTH_LIMITS.lockoutMail). */
export interface LockoutMailCaps {
  readonly personQuietHours: number;
  readonly tenantPerHour: number;
}

/** What the database counted for the recipient (loadAccountMailContext / the immediate claim). */
export interface AccountMailCounts {
  readonly recentCount: number;
  readonly quietCount: number;
  readonly tenantRecentCount: number;
}

/** The quiet period (minutes) the counts must be taken over for a kind: the lockout caps' and the pause's. */
export function quietMinutesFor(
  kind: AccountMailKind,
  lockMinutes: number | null,
  caps: LockoutMailCaps,
): number {
  if (kind === 'account_locked') return caps.personQuietHours * 60;
  if (kind === 'mfa_code_locked') return Math.min(Math.max(lockMinutes ?? 1, 1), 1440);
  return 0;
}

export type AccountMailVerdict =
  | { readonly send: true; readonly overCap: boolean }
  | { readonly send: false; readonly reason: string };

/**
 * May this e-mail go to this person now? The per-person hourly cap (security notices are never dropped by it,
 * re-review N3: sent, and the volume shows in the logs), the lockout e-mail's one-a-day and per-organization
 * hourly ceilings, and one "wrong codes" notice per pause. A refused request is answered without an e-mail;
 * the lock itself is unaffected.
 */
export function accountMailVerdict(
  kind: AccountMailKind,
  counts: AccountMailCounts,
  caps: LockoutMailCaps,
): AccountMailVerdict {
  const locked = kind === 'account_locked';
  const codesPaused = kind === 'mfa_code_locked';
  let overCap = false;
  if (counts.recentCount >= ACCOUNT_MAIL_HOURLY_CAP) {
    if (!SECURITY_NOTICE_KINDS.has(kind)) return { send: false, reason: 'hourly_cap' };
    overCap = true;
  }
  if ((locked || codesPaused) && counts.quietCount > 0) {
    return { send: false, reason: 'already_notified' };
  }
  if (locked && counts.tenantRecentCount >= caps.tenantPerHour) {
    return { send: false, reason: 'organization_hourly_cap' };
  }
  return { send: true, overCap };
}

/** The two language versions of a page of the app, `{APP_BASE_URL}/{ar|en}/{path}`. */
export const appPages =
  (appBase: string) =>
  (path: string): { ar: string; en: string } => ({
    ar: `${appBase}/ar/${path}`,
    en: `${appBase}/en/${path}`,
  });

/** An e-mail of the account notices (content only; the recipient, language and look are the caller's). */
export type AccountNoticeTemplate =
  | 'platform.password_changed'
  | 'platform.mfa_factor_removed'
  | 'platform.security_policy_changed'
  | 'platform.security_digest'
  | 'platform.account_locked'
  | 'platform.sign_in_unlocked'
  | 'platform.mfa_code_locked';

export type AccountNoticePlan =
  | {
      readonly template: 'platform.password_changed';
      readonly variables: EmailVariables<'platform.password_changed'>;
    }
  | {
      readonly template: 'platform.mfa_factor_removed';
      readonly variables: EmailVariables<'platform.mfa_factor_removed'>;
    }
  | {
      readonly template: 'platform.security_policy_changed';
      readonly variables: EmailVariables<'platform.security_policy_changed'>;
    }
  | {
      readonly template: 'platform.security_digest';
      readonly variables: EmailVariables<'platform.security_digest'>;
    }
  | {
      readonly template: 'platform.account_locked';
      readonly variables: EmailVariables<'platform.account_locked'>;
    }
  | {
      readonly template: 'platform.sign_in_unlocked';
      readonly variables: EmailVariables<'platform.sign_in_unlocked'>;
    }
  | {
      readonly template: 'platform.mfa_code_locked';
      readonly variables: EmailVariables<'platform.mfa_code_locked'>;
    };

export interface AccountNoticeInput {
  readonly kind: Exclude<AccountMailKind, 'password_reset' | 'mfa_factor_added'>;
  readonly organizationName: OrganizationName;
  /** The account's address as Auth stores it (shown as «you sign in with»). */
  readonly loginEmail: string;
  /** Public origin of the web app (APP_BASE_URL), without a trailing slash. */
  readonly appBase: string;
  /** account_locked / mfa_code_locked: how long the lock or pause lasts. */
  readonly lockMinutes: number | null;
  /** mfa_factor_removed: why. */
  readonly mfaReason: MfaRemovalReason | null;
  /** security_policy_changed: what changed, and the editor's name. */
  readonly policyChange: PolicyChange | null;
  readonly changedByName: OrganizationName | null;
  /** security_digest: the held notices. */
  readonly digest: SecurityDigest | null;
}

/**
 * The content of a notice. Throws `Error` with a stable `code` and `temporary: false` for a request whose detail
 * the database should never have stored (a retry could not fix it).
 */
export function composeAccountNotice(input: AccountNoticeInput): AccountNoticePlan {
  const pages = appPages(input.appBase);
  const { organizationName, loginEmail } = input;
  switch (input.kind) {
    case 'account_locked':
      return {
        template: 'platform.account_locked',
        variables: {
          organizationName,
          lockMinutes: input.lockMinutes ?? 15,
          forgotPasswordUrl: pages('forgot-password'),
          loginEmail,
        },
      };
    case 'mfa_code_locked':
      return {
        template: 'platform.mfa_code_locked',
        variables: {
          organizationName,
          lockMinutes: input.lockMinutes ?? 15,
          forgotPasswordUrl: pages('forgot-password'),
          loginEmail,
        },
      };
    case 'sign_in_unlocked':
      return {
        template: 'platform.sign_in_unlocked',
        variables: { organizationName, forgotPasswordUrl: pages('forgot-password'), loginEmail },
      };
    case 'mfa_factor_removed':
      return {
        template: 'platform.mfa_factor_removed',
        variables: {
          organizationName,
          reason: input.mfaReason ?? 'removed',
          forgotPasswordUrl: pages('forgot-password'),
          loginEmail,
        },
      };
    case 'security_policy_changed': {
      const change = input.policyChange;
      if (!change) {
        // The database refuses such a request; a retry could not fix it.
        throw Object.assign(new Error('policy change without its detail'), {
          code: 'POLICY_CHANGE_DETAIL_MISSING',
          temporary: false,
        });
      }
      return {
        template: 'platform.security_policy_changed',
        variables: {
          organizationName,
          changedBy: input.changedByName,
          changed: change.changed as never,
          changedAt: change.changedAt.toISOString(),
          timeZone: ACCOUNT_MAIL_TIME_ZONE,
          settingsUrl: pages('suite/admin/security'),
          loginEmail,
        },
      };
    }
    case 'security_digest': {
      const digest = input.digest;
      if (!digest) {
        throw Object.assign(new Error('security digest without its detail'), {
          code: 'SECURITY_DIGEST_DETAIL_MISSING',
          temporary: false,
        });
      }
      return {
        template: 'platform.security_digest',
        variables: {
          organizationName,
          held: digest.held,
          since: digest.since.toISOString(),
          timeZone: ACCOUNT_MAIL_TIME_ZONE,
          forgotPasswordUrl: pages('forgot-password'),
          loginEmail,
        },
      };
    }
    case 'password_changed':
      return {
        template: 'platform.password_changed',
        variables: { organizationName, forgotPasswordUrl: pages('forgot-password'), loginEmail },
      };
  }
}

/** A new link token: 32 random bytes, base64url (43 characters) - only its SHA-256 is stored. */
export const newMfaRemoveToken = (): string => randomBytes(32).toString('base64url');

/** A new set-up code: 8 random digits (re-review N1) - only its SHA-256 with the app's id is stored. */
export const newMfaSetupCode = (): string => String(randomInt(0, 100_000_000)).padStart(8, '0');

/**
 * SHA-256 of a set-up code bound to its app - as the database checks it (private.confirm_mfa_setup:
 * sha256(factor id || ':' || code)). The same code for another app is another hash.
 */
export function hashMfaSetupCode(factorId: string, code: string): Buffer {
  return createHash('sha256').update(`${factorId.toLowerCase()}:${code}`, 'utf8').digest();
}

/** SHA-256 of a link token (the "not you" link; the database keeps only this). */
export function hashLinkToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** The set-up e-mail of an authenticator app (the platform-only variant is the caller's choice). */
export function composeMfaSetUp(input: {
  readonly organizationName: OrganizationName;
  readonly loginEmail: string;
  readonly appBase: string;
  readonly code: string;
  readonly removeToken: string;
  readonly setUpAt: Date;
  readonly browser: string | null;
  readonly system: string | null;
}): EmailVariables<'platform.mfa_factor_added'> {
  const pages = appPages(input.appBase);
  return {
    organizationName: input.organizationName,
    code: input.code,
    setUpAt: input.setUpAt.toISOString(),
    timeZone: ACCOUNT_MAIL_TIME_ZONE,
    browser: input.browser,
    system: input.system,
    // The link's token in the URL FRAGMENT: never sent to the server with the page request; the page asks for
    // a click.
    removeUrl: pages(`mfa/remove#token=${input.removeToken}`),
    codeValidHours: MFA_CODE_VALID_HOURS,
    removeValidDays: MFA_REMOVE_VALID_DAYS,
    loginEmail: input.loginEmail,
  };
}

/**
 * The reset e-mail's variables. The link carries Auth's token hash in the URL FRAGMENT (never sent to the server
 * with the page request); `&mfa=1` tells the page to ask for the authenticator code (Auth wants AAL2 to set the
 * password, T-M2-10).
 */
export function composeReset(input: {
  readonly organizationName: OrganizationName;
  readonly loginEmail: string;
  readonly appBase: string;
  readonly tokenHash: string;
  readonly codeNeeded: boolean;
}): EmailVariables<'platform.password_reset'> {
  const flag = input.codeNeeded ? '&mfa=1' : '';
  return {
    organizationName: input.organizationName,
    resetUrl: {
      ar: `${input.appBase}/ar/reset-password#token_hash=${input.tokenHash}&type=recovery${flag}`,
      en: `${input.appBase}/en/reset-password#token_hash=${input.tokenHash}&type=recovery${flag}`,
    },
    validMinutes: RESET_LINK_VALID_MINUTES,
    loginEmail: input.loginEmail,
    codeNeeded: input.codeNeeded,
  };
}
