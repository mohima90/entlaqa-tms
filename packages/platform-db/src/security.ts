import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type ClaimsTx, runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';
import type { UserTx } from './with-user-tx';

/**
 * Security policy per organization, MFA state, authenticator apps and sign-in sessions (T-M2-10; FR-IAM-12,
 * FR-IAM-13; migrations 20261012090000–20261012110000). The database decides; these are its request-path
 * calls.
 */

export const MFA_MODES = ['off', 'optional', 'required_all', 'required_roles'] as const;
export type MfaMode = (typeof MFA_MODES)[number];

/** The settings an Organization Admin changes (screen 6). Ranges are the database's floors. */
export interface SecuritySettings {
  readonly mfaMode: MfaMode;
  readonly mfaRequiredRoles: readonly string[];
  readonly mfaGraceDays: number;
  readonly mfaPromptAdmins: boolean;
  readonly passwordMinLength: number;
  readonly lockoutThreshold: number;
  readonly lockoutMinutes: number;
  readonly sessionIdleMinutes: number;
  readonly sessionMaxHours: number;
  readonly sessionMaxDevices: number;
}

/** Limits of every setting (the database's CHECK constraints, 20261012090000). */
export const SECURITY_LIMITS = {
  mfaGraceDays: { min: 0, max: 30 },
  passwordMinLength: { min: 12, max: 36 },
  // The platform default (5 attempts, 15 minutes) or stricter (TM-0003 T-IAM-24).
  lockoutThreshold: { min: 3, max: 5 },
  lockoutMinutes: { min: 15, max: 60 },
  sessionIdleMinutes: { min: 5, max: 480 },
  sessionMaxHours: { min: 1, max: 24 },
  sessionMaxDevices: { min: 1, max: 10 },
} as const;

export interface SecurityPolicy extends SecuritySettings {
  /** When an MFA requirement started (its grace period counts from here); null without one. */
  readonly mfaRequiredSince: Date | null;
  readonly updatedAt: Date;
  /** Who changed it last (null: created by the platform). */
  readonly updatedBy: { readonly nameAr: string; readonly nameEn: string | null } | null;
  /** Optimistic concurrency token. */
  readonly version: number;
}

type Row = Record<string, unknown>;

function settingsOf(row: Row): SecuritySettings {
  return {
    mfaMode: row.mfa_mode as MfaMode,
    mfaRequiredRoles: (row.mfa_required_roles as string[] | null) ?? [],
    mfaGraceDays: Number(row.mfa_grace_days),
    mfaPromptAdmins: row.mfa_prompt_admins === true,
    passwordMinLength: Number(row.password_min_length),
    lockoutThreshold: Number(row.lockout_threshold),
    lockoutMinutes: Number(row.lockout_minutes),
    sessionIdleMinutes: Number(row.session_idle_minutes),
    sessionMaxHours: Number(row.session_max_hours),
    sessionMaxDevices: Number(row.session_max_devices),
  };
}

const date = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string | Date);

/** The current organization's policy (RLS: only the claims' organization), or null. */
export async function getSecurityPolicy(tx: UserTx): Promise<SecurityPolicy | null> {
  const [row] = await tx.execute(sql`
    select p.mfa_mode, p.mfa_required_roles, p.mfa_grace_days, p.mfa_prompt_admins, p.mfa_required_since,
           p.password_min_length, p.lockout_threshold, p.lockout_minutes, p.session_idle_minutes,
           p.session_max_hours, p.session_max_devices, p.updated_at, p.version,
           e.display_name_ar as editor_name_ar, e.display_name_en as editor_name_en
    from platform.security_policies p
    left join platform.persons e on e.tenant_id = p.tenant_id and e.id = p.updated_by
    where p.tenant_id = (select private.current_tenant_id())`);
  if (!row) return null;
  const editor = row.editor_name_ar as string | null;
  return {
    ...settingsOf(row),
    mfaRequiredSince: date(row.mfa_required_since),
    updatedAt: date(row.updated_at) ?? new Date(0),
    updatedBy: editor
      ? { nameAr: editor, nameEn: (row.editor_name_en as string | null) ?? null }
      : null,
    version: Number(row.version),
  };
}

export type SecurityPolicyUpdate =
  | {
      readonly outcome: 'updated';
      readonly before: SecuritySettings;
      readonly after: SecuritySettings;
    }
  /** Someone changed it since the page was loaded (version), or this session may not change it. */
  | { readonly outcome: 'conflict' | 'refused' };

/**
 * Saves the settings when the policy is still at `version`. The database lets only an Organization Admin
 * at AAL2 change it (policy security_policies_update); a refused update changes nothing.
 */
export async function updateSecurityPolicy(
  tx: UserTx,
  settings: SecuritySettings,
  version: number,
): Promise<SecurityPolicyUpdate> {
  const [current] = await tx.execute(sql`
    select mfa_mode, mfa_required_roles, mfa_grace_days, mfa_prompt_admins, password_min_length,
           lockout_threshold, lockout_minutes, session_idle_minutes, session_max_hours,
           session_max_devices, version
    from platform.security_policies
    where tenant_id = (select private.current_tenant_id())
    for update`);
  if (!current) return { outcome: 'refused' };
  if (Number(current.version) !== version) return { outcome: 'conflict' };
  const roles = `{${settings.mfaRequiredRoles.join(',')}}`;
  const [row] = await tx.execute(sql`
    update platform.security_policies
    set mfa_mode = ${settings.mfaMode}, mfa_required_roles = ${roles}::text[],
        mfa_grace_days = ${settings.mfaGraceDays}, mfa_prompt_admins = ${settings.mfaPromptAdmins},
        password_min_length = ${settings.passwordMinLength},
        lockout_threshold = ${settings.lockoutThreshold}, lockout_minutes = ${settings.lockoutMinutes},
        session_idle_minutes = ${settings.sessionIdleMinutes},
        session_max_hours = ${settings.sessionMaxHours},
        session_max_devices = ${settings.sessionMaxDevices}
    where tenant_id = (select private.current_tenant_id()) and version = ${version}
    returning mfa_mode, mfa_required_roles, mfa_grace_days, mfa_prompt_admins, password_min_length,
              lockout_threshold, lockout_minutes, session_idle_minutes, session_max_hours,
              session_max_devices`);
  if (!row) return { outcome: 'refused' };
  return { outcome: 'updated', before: settingsOf(current), after: settingsOf(row) };
}

/** The setting names whose values differ (audit: before/after of these only). */
export function changedSettings(before: SecuritySettings, after: SecuritySettings): string[] {
  return (Object.keys(after) as (keyof SecuritySettings)[]).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

// ---------------------------------------------------------------------------------------------------
// Where the current session stands (private.session_access_state)
// ---------------------------------------------------------------------------------------------------

export const SESSION_ACCESS_STATES = [
  'ok',
  'invalid',
  'ended',
  'mfa_challenge',
  'mfa_enrol',
  'prompt_grace',
  'prompt_admin',
] as const;
export type SessionAccessState = (typeof SESSION_ACCESS_STATES)[number];

export interface SessionAccess {
  readonly state: SessionAccessState;
  /** Covered by an MFA requirement: until when the member may still sign in without an app. */
  readonly mfaDeadline: Date | null;
  /** The account uses a CONFIRMED authenticator app (review H1). */
  readonly usesApp: boolean;
  /** An app was set up but waits for its e-mailed code (it does not count yet) — here or elsewhere. */
  readonly mfaPending: boolean;
  /** The session is at AAL2 as the database counts it: a code from a confirmed app. */
  readonly aal2: boolean;
}

export async function getSessionAccess(tx: UserTx): Promise<SessionAccess> {
  const [row] = await tx.execute(
    sql`select state, mfa_deadline, uses_app, mfa_pending, aal2 from private.session_access_state()`,
  );
  const state = SESSION_ACCESS_STATES.find((s) => s === row?.state) ?? 'invalid';
  return {
    state,
    mfaDeadline: date(row?.mfa_deadline),
    usesApp: row?.uses_app === true,
    mfaPending: row?.mfa_pending === true,
    aal2: row?.aal2 === true,
  };
}

/**
 * For defineAction (review L1/H1): may the current session act in its organization (MFA state, session
 * rules — the decision of every tenant policy), and is it at AAL2 through a confirmed app? One call.
 */
export async function loadSessionFacts(
  tx: UserTx,
): Promise<{ readonly active: boolean; readonly aal2: boolean }> {
  const [row] = await tx.execute(sql`select active, aal2 from private.request_session_facts()`);
  return { active: row?.active === true, aal2: row?.aal2 === true };
}

/**
 * The organization's device limit for the current session, right after its authenticator code completed
 * the sign-in (review L1). Returns how many of the account's other sessions ended (audited by the
 * database).
 */
export async function applyDeviceLimit(tx: UserTx): Promise<number> {
  const [row] = await tx.execute(sql`select private.apply_device_limit() as ended`);
  return Number(row?.ended ?? 0);
}

export const MFA_FACTOR_MAIL_OUTCOMES = ['queued', 'waiting', 'too_soon', 'refused'] as const;
export type MfaFactorMailOutcome = (typeof MFA_FACTOR_MAIL_OUTCOMES)[number];

/**
 * After this session set up an authenticator app (it passed the app's first code), or "send the e-mail
 * again" from that session (re-review N1): the database records the app as waiting with THIS session, audits
 * it and queues the set-up e-mail (one-time code, "not you" link). queued | waiting (one is on its way) |
 * too_soon (the last one is under 2 minutes old) | refused (not this session's app).
 */
export async function requestMfaFactorMail(
  tx: UserTx,
  factorId: string,
): Promise<MfaFactorMailOutcome> {
  const [row] = await tx.execute(
    sql`select private.request_mfa_factor_mail(${factorId}::uuid) as outcome`,
  );
  return MFA_FACTOR_MAIL_OUTCOMES.find((o) => o === row?.outcome) ?? 'refused';
}

export const MFA_SETUP_CONFIRMATIONS = [
  'confirmed',
  'invalid',
  'expired',
  'locked',
  'refused',
] as const;
export type MfaSetupConfirmation = (typeof MFA_SETUP_CONFIRMATIONS)[number];

/**
 * The e-mailed code of a new app (re-review N1), accepted only from the session that set the app up (aal2
 * through that app): from then on it counts for AAL2. invalid (wrong code — tries are counted) | expired |
 * locked (5 wrong tries: "send again") | refused (not this session's waiting app).
 */
export async function confirmMfaSetup(
  tx: UserTx,
  factorId: string,
  code: string,
): Promise<MfaSetupConfirmation> {
  const [row] = await tx.execute(
    sql`select private.confirm_mfa_setup(${factorId}::uuid, ${code}) as outcome`,
  );
  return MFA_SETUP_CONFIRMATIONS.find((o) => o === row?.outcome) ?? 'refused';
}

/** One of the account's authenticator apps, as this session sees it (re-review N1). */
export interface MyMfaApp {
  readonly factorId: string;
  /** Confirmed with the e-mailed code: it counts for AAL2. */
  readonly confirmed: boolean;
  /** Set up by THIS session (only it can confirm it). */
  readonly here: boolean;
  readonly setUpAt: Date;
  /** The browser that set it up (Auth's user agent; shown parsed, never logged). */
  readonly userAgent: string | null;
}

/** The account's authenticator apps (verified in Auth): confirmed first. Empty without a live session. */
export async function listMyMfaApps(tx: UserTx): Promise<MyMfaApp[]> {
  const rows = await tx.execute(
    sql`select factor_id, confirmed, here, set_up_at, user_agent from private.my_mfa_apps()`,
  );
  return rows.map((row) => ({
    factorId: row.factor_id as string,
    confirmed: row.confirmed === true,
    here: row.here === true,
    setUpAt: date(row.set_up_at) ?? new Date(0),
    userAgent: (row.user_agent as string | null) ?? null,
  }));
}

export const MFA_APP_REMOVALS = ['removed', 'step_up', 'refused'] as const;
export type MfaAppRemoval = (typeof MFA_APP_REMOVALS)[number];

/**
 * Removes one of the account's apps in the database (never Auth's own unenroll; re-review N1): a confirmed
 * one needs AAL2 with a code from the last 15 minutes (else step_up); this session's own set-up is
 * cancelled; an app added from ANOTHER sign-in is removed and every other session of the account ends.
 * Audited and e-mailed by the database.
 */
export async function removeMfaApp(tx: UserTx, factorId: string): Promise<MfaAppRemoval> {
  const [row] = await tx.execute(sql`select private.remove_mfa_app(${factorId}::uuid) as outcome`);
  return MFA_APP_REMOVALS.find((o) => o === row?.outcome) ?? 'refused';
}

export const MEMBER_MFA_RESETS = [
  'reset',
  'no_app',
  'other_organization',
  'self',
  'not_found',
] as const;
export type MemberMfaReset = (typeof MEMBER_MFA_RESETS)[number];

/**
 * An Organization Admin resets a member's authenticator apps (PO answer, 9 Oct 2026; TM-0003 T-IAM-10):
 * checked by the database too (Organization Admin, AAL2 through a confirmed app with a code from the last
 * 15 minutes, a member they may manage whose login belongs to no other organization). Throws
 * insufficient_privilege (42501) otherwise.
 */
export async function resetMemberMfa(tx: UserTx, personId: string): Promise<MemberMfaReset> {
  const [row] = await tx.execute(
    sql`select private.reset_member_mfa(${personId}::uuid) as outcome`,
  );
  const outcome = MEMBER_MFA_RESETS.find((o) => o === row?.outcome);
  if (!outcome) throw new Error('resetMemberMfa: unknown outcome');
  return outcome;
}

/** "Not now" on the Organization Admin prompt (PO decision 2), remembered for this organization. */
export async function dismissMfaPrompt(tx: UserTx): Promise<boolean> {
  const [row] = await tx.execute(sql`select private.dismiss_mfa_prompt() as done`);
  return row?.done === true;
}

/**
 * Whether a member uses a confirmed authenticator app, or one waits for its e-mailed confirmation
 * (screen 3): user managers and the member themself.
 */
export async function getMemberMfa(
  tx: UserTx,
  personId: string,
): Promise<{
  readonly usesApp: boolean;
  readonly since: Date | null;
  readonly pending: boolean;
} | null> {
  const [row] = await tx.execute(
    sql`select uses_app, since, pending from private.tenant_member_mfa(${personId}::uuid)`,
  );
  return row
    ? { usesApp: row.uses_app === true, since: date(row.since), pending: row.pending === true }
    : null;
}

// ---------------------------------------------------------------------------------------------------
// Password rule (strictest wins, PO decision 5) and lockout settings (for T-M2-11)
// ---------------------------------------------------------------------------------------------------

/** Auth's own minimum and the platform floor (FR-IAM-13). */
export const PLATFORM_PASSWORD_MIN_LENGTH = 12;

/**
 * The signed-in account's minimum password length: the strictest of its organizations. Also for the
 * recovery session of a reset (no organization). Null when the session is not live.
 */
export async function passwordMinLengthForCaller(tx: UserTx): Promise<number | null> {
  const [row] = await tx.execute(sql`select private.password_min_length_for_caller() as length`);
  return row?.length === null || row?.length === undefined ? null : Number(row.length);
}

export interface LockoutPolicy {
  readonly threshold: number;
  readonly minutes: number;
}

/** Platform default (screen 6) — for the platform's own sign-in host, before an organization is known. */
export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = { threshold: 5, minutes: 15 };

const Uuid = z.uuid();

/** What the e-mailed "not you? remove this app" link did (review H1). */
export type MfaLinkOutcome = 'removed' | 'expired' | 'invalid';

/** Request-path calls that run before any session (app_server, no claims). */
export interface PreSessionSecurityApi {
  /** The set-up e-mail's "not you" link: removes that app and ends every session of the account. */
  rejectMfaFactor(tokenHash: Buffer): Promise<'removed' | 'expired' | 'invalid'>;
  /** A new account accepting this invitation follows its organization's rule (at least 12). */
  invitationPasswordMinLength(tokenHash: Buffer): Promise<number>;
  /**
   * The lockout settings of an organization (null / unknown / inactive: the platform default).
   *
   * INTEGRATION POINT (T-M2-11): the sign-in limiter owns enforcement — counting failed sign-ins and
   * locking accounts. It reads the threshold and duration here: the organization of a tenant host, the
   * platform default on the platform's sign-in host (TM-0003 D-IAM-04). T-M2-10 stores and shows them only.
   */
  getLockoutPolicy(tenantId: string | null): Promise<LockoutPolicy>;
}

export function createPreSessionSecurityApi(getDb: () => AppDatabase): PreSessionSecurityApi {
  const withoutClaims = <T>(fn: (tx: ClaimsTx) => Promise<T>) => runWithClaims(getDb(), '', fn);
  const linkOutcome = <T extends string>(value: unknown, allowed: readonly T[]): T | 'invalid' =>
    allowed.find((o) => o === value) ?? 'invalid';
  return {
    async rejectMfaFactor(tokenHash) {
      const [row] = await withoutClaims((tx) =>
        tx.execute(sql`select private.reject_mfa_factor(${tokenHash}::bytea) as outcome`),
      );
      return linkOutcome(row?.outcome, ['removed', 'expired'] as const);
    },
    async invitationPasswordMinLength(tokenHash) {
      const [row] = await withoutClaims((tx) =>
        tx.execute(
          sql`select private.invitation_password_min_length(${tokenHash}::bytea) as length`,
        ),
      );
      const length = Number(row?.length);
      return Number.isInteger(length) && length >= PLATFORM_PASSWORD_MIN_LENGTH
        ? length
        : PLATFORM_PASSWORD_MIN_LENGTH;
    },
    async getLockoutPolicy(tenantId) {
      if (tenantId === null || !Uuid.safeParse(tenantId).success) return DEFAULT_LOCKOUT_POLICY;
      const [row] = await withoutClaims((tx) =>
        tx.execute(
          sql`select lockout_threshold, lockout_minutes from private.tenant_lockout_policy(${tenantId}::uuid)`,
        ),
      );
      return row
        ? { threshold: Number(row.lockout_threshold), minutes: Number(row.lockout_minutes) }
        : DEFAULT_LOCKOUT_POLICY;
    },
  };
}

const defaultPreSessionApi = createPreSessionSecurityApi(() => getDatabase('app_server'));

export function rejectMfaFactor(tokenHash: Buffer): Promise<'removed' | 'expired' | 'invalid'> {
  return defaultPreSessionApi.rejectMfaFactor(tokenHash);
}

export function invitationPasswordMinLength(tokenHash: Buffer): Promise<number> {
  return defaultPreSessionApi.invitationPasswordMinLength(tokenHash);
}

export function getLockoutPolicy(tenantId: string | null): Promise<LockoutPolicy> {
  return defaultPreSessionApi.getLockoutPolicy(tenantId);
}

// ---------------------------------------------------------------------------------------------------
// Sign-in sessions (screens 3 and 6)
// ---------------------------------------------------------------------------------------------------

export interface SignInSession {
  readonly sessionId: string;
  readonly startedAt: Date;
  readonly lastActiveAt: Date;
  /** The browser's own description (Auth's user agent); shown parsed, never logged. */
  readonly userAgent: string | null;
  /** The session passed an authenticator code (aal2). */
  readonly withCode: boolean;
  readonly isCurrent: boolean;
}

export interface MySignInSession extends SignInSession {
  /** The organization it acts in (null: none chosen yet). */
  readonly organization: { readonly nameAr: string; readonly nameEn: string | null } | null;
}

function sessionOf(row: Row): SignInSession {
  return {
    sessionId: row.session_id as string,
    startedAt: date(row.started_at) ?? new Date(0),
    lastActiveAt: date(row.last_active_at) ?? new Date(0),
    userAgent: (row.user_agent as string | null) ?? null,
    withCode: row.with_code === true,
    isCurrent: row.is_current === true,
  };
}

/** The account's live sessions (every organization), current first. */
export async function listMySessions(tx: UserTx): Promise<MySignInSession[]> {
  const rows = await tx.execute(sql`
    select session_id, started_at, last_active_at, user_agent, with_code, is_current,
           tenant_name_ar, tenant_name_en
    from private.my_sessions()`);
  return rows.map((row) => ({
    ...sessionOf(row),
    organization: row.tenant_name_ar
      ? {
          nameAr: row.tenant_name_ar as string,
          nameEn: (row.tenant_name_en as string | null) ?? null,
        }
      : null,
  }));
}

/** Ends one other session of the account, or all others (null). Returns how many ended. */
export async function endMySessions(tx: UserTx, sessionId: string | null): Promise<number> {
  const [row] = await tx.execute(sql`select private.end_my_sessions(${sessionId}::uuid) as ended`);
  return Number(row?.ended ?? 0);
}

/** A member's live sessions in the caller's organization (user managers only; else empty). */
export async function listMemberSessions(tx: UserTx, personId: string): Promise<SignInSession[]> {
  const rows = await tx.execute(sql`
    select session_id, started_at, last_active_at, user_agent, with_code, is_current
    from private.tenant_member_sessions(${personId}::uuid)`);
  return rows.map(sessionOf);
}

/**
 * Force sign-out (screen 3): ends one (or every, null) session of the member acting in the caller's
 * organization — never their sessions elsewhere, never the caller's own current one. The database
 * refuses callers who may not manage the person (insufficient_privilege).
 */
export async function endMemberSessions(
  tx: UserTx,
  personId: string,
  sessionId: string | null,
): Promise<number> {
  const [row] = await tx.execute(
    sql`select private.end_member_sessions(${personId}::uuid, ${sessionId}::uuid) as ended`,
  );
  return Number(row?.ended ?? 0);
}
