import { appError, defineErrorCodes, err, ok } from '@jadarat/platform-core';
import {
  MFA_MODES,
  type MySignInSession,
  SECURITY_LIMITS,
  type SecurityPolicy,
  type SecuritySettings,
  type SignInSession,
  type UserTx,
  changedSettings,
  endMemberSessions,
  endMySessions,
  getMemberMfa,
  getSecurityPolicy,
  listMemberSessions,
  listMySessions,
  mayManagePerson,
  passwordMinLengthForCaller,
  resetMemberMfa,
  updateSecurityPolicy,
} from '@jadarat/platform-db';
import { z } from 'zod';
import type { ActionDefinition, PermissionAccess } from '../define-action';
import type { QueryDefinition } from '../define-query';
import { memberPermissions } from '../member-permissions';
import { platformPermissions as p } from '../platform-permissions';
import { SYSTEM_ROLE_CODES } from '../system-roles';

/**
 * Security settings of the organization (screen 6, FR-IAM-12/13) and sign-in sessions (screens 3 and 6,
 * FR-IAM-13) — T-M2-10. The database enforces everything (private.session_access, the update policy of
 * platform.security_policies, the session functions); these definitions authorize, validate and audit.
 *
 *   - The page: every member with `platform.tenant.read` (Organization Admin, Auditor) reads the policy;
 *     changing it needs `platform.security.manage` — high risk, AAL2 (an authenticator code even when the
 *     organization keeps MFA off: PO decision D-IAM-01), Organization Admin only.
 *   - My sessions: every member (own scope) lists and ends their own other sessions.
 *   - A member's sessions: user managers (`platform.user.deactivate` on the person, and the manage rule —
 *     only an Organization Admin for a member with a privileged role) list them and sign them out.
 *   - A member's lost authenticator app (PO answer, 9 Oct 2026): the Organization Admin resets it
 *     (`platform.user.reset_mfa` — high risk, a recent code of their own), for a member whose login belongs
 *     to no other organization; ENTLAQA support otherwise (docs/engineering/mfa-reset.md).
 */
const manageOwn = memberPermissions['platform.profile.manage_own'];

const intIn = (limits: { readonly min: number; readonly max: number }) =>
  z.int().min(limits.min).max(limits.max);

/** Screen 6, as saved. Unknown fields are refused; role codes are the 14 organization roles. */
export const SecuritySettingsInput = z
  .strictObject({
    version: z.int().min(1),
    mfaMode: z.enum(MFA_MODES),
    mfaRequiredRoles: z.array(z.enum(SYSTEM_ROLE_CODES)).max(SYSTEM_ROLE_CODES.length),
    mfaGraceDays: intIn(SECURITY_LIMITS.mfaGraceDays),
    mfaPromptAdmins: z.boolean(),
    passwordMinLength: intIn(SECURITY_LIMITS.passwordMinLength),
    lockoutThreshold: intIn(SECURITY_LIMITS.lockoutThreshold),
    lockoutMinutes: intIn(SECURITY_LIMITS.lockoutMinutes),
    sessionIdleMinutes: intIn(SECURITY_LIMITS.sessionIdleMinutes),
    sessionMaxHours: intIn(SECURITY_LIMITS.sessionMaxHours),
    sessionMaxDevices: intIn(SECURITY_LIMITS.sessionMaxDevices),
  })
  .superRefine((value, ctx) => {
    if (value.mfaMode === 'required_roles' && value.mfaRequiredRoles.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['mfaRequiredRoles'], message: 'required' });
    }
    // The inactivity limit cannot exceed the session's maximum length.
    if (value.sessionIdleMinutes > value.sessionMaxHours * 60) {
      ctx.addIssue({ code: 'custom', path: ['sessionIdleMinutes'], message: 'above_max_length' });
    }
  });

export interface SecurityPageView {
  readonly policy: SecurityPolicy;
  /** allowed · step_up_required (an Organization Admin at AAL1: a code first) · denied (read only). */
  readonly editAccess: PermissionAccess;
}

export function securityPageQueryDefinition(): QueryDefinition<
  z.ZodObject<Record<string, never>>,
  SecurityPageView,
  UserTx
> {
  return {
    permission: p['platform.tenant.read'],
    input: z.strictObject({}),
    handler: async ({ ctx }) => {
      const policy = await getSecurityPolicy(ctx.tx);
      if (!policy) return err(appError('NOT_FOUND'));
      return ok({ policy, editAccess: ctx.access(p['platform.security.manage'], 'tenant') });
    },
  };
}

export interface SecurityPolicySaved {
  readonly tenantId: string;
  readonly changed: readonly string[];
  readonly before: Partial<SecuritySettings>;
  readonly after: Partial<SecuritySettings>;
}

function pick(settings: SecuritySettings, keys: readonly string[]): Partial<SecuritySettings> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) picked[key] = settings[key as keyof SecuritySettings];
  return picked;
}

export function updateSecurityPolicyActionDefinition(): ActionDefinition<
  typeof SecuritySettingsInput,
  SecurityPolicySaved,
  UserTx
> {
  return {
    permission: p['platform.security.manage'],
    input: SecuritySettingsInput,
    handler: async ({ ctx, input }) => {
      const { version, ...settings } = input;
      const saved = await updateSecurityPolicy(
        ctx.tx,
        {
          ...settings,
          // Only "required for roles" keeps a role list; the others keep the default (Organization Admin).
          mfaRequiredRoles:
            settings.mfaMode === 'required_roles' ? settings.mfaRequiredRoles : ['tenant_admin'],
        },
        version,
      );
      if (saved.outcome !== 'updated') {
        return err(appError(saved.outcome === 'conflict' ? 'CONFLICT_VERSION' : 'FORBIDDEN'));
      }
      const changed = changedSettings(saved.before, saved.after);
      return ok({
        tenantId: ctx.claims.tenant_id,
        changed,
        before: pick(saved.before, changed),
        after: pick(saved.after, changed),
      });
    },
    // Security-policy changes are audited with the values before and after (ADR 0003 §5, T-IAM-24).
    audit: (_input, output) =>
      output.changed.length === 0
        ? null
        : {
            action: 'platform.security.policy_changed',
            entityType: 'security_policy',
            entityId: output.tenantId,
            data: { changed: output.changed, before: output.before, after: output.after },
          },
  };
}

// ---------------------------------------------------------------------------------------------------
// My profile: own sign-in sessions, own password rule, own authenticator app
// ---------------------------------------------------------------------------------------------------

export interface MySecurityView {
  readonly sessions: readonly MySignInSession[];
  /** The strictest minimum password length of the account's organizations (PO decision 5). */
  readonly passwordMinLength: number;
  /** Whether the account uses a confirmed authenticator app (null: unknown). */
  readonly usesApp: boolean | null;
  /** An app waits for its e-mailed confirmation (review H1): it does not count yet. */
  readonly appPending: boolean;
}

export function mySecurityQueryDefinition(): QueryDefinition<
  z.ZodObject<Record<string, never>>,
  MySecurityView,
  UserTx
> {
  return {
    permission: manageOwn,
    input: z.strictObject({}),
    scoped: true, // the member's own account and sessions only
    handler: async ({ ctx }) => {
      const minLength = await passwordMinLengthForCaller(ctx.tx);
      if (minLength === null) return err(appError('UNAUTHENTICATED'));
      const mfa = ctx.actor.personId ? await getMemberMfa(ctx.tx, ctx.actor.personId) : null;
      return ok({
        sessions: await listMySessions(ctx.tx),
        passwordMinLength: minLength,
        usesApp: mfa?.usesApp ?? null,
        appPending: mfa?.pending ?? false,
      });
    },
  };
}

/**
 * "Stay signed in" on the inactivity warning (screen 6): every request through withUserTx moves the
 * session's last activity forward (private.touch_session, at most once a minute and never once the
 * inactivity limit has passed); this action does nothing else. It cannot revive a session: defineAction
 * refuses every action of a session the database no longer lets act in its organization (ended by
 * inactivity or maximum length, signed out, or refused by the MFA policy — review L1).
 */
export function keepSessionAliveActionDefinition(): ActionDefinition<
  z.ZodObject<Record<string, never>>,
  null,
  UserTx
> {
  return {
    permission: manageOwn,
    input: z.strictObject({}),
    scoped: true,
    handler: () => Promise.resolve(ok(null)),
  };
}

export const EndMySessionsInput = z.strictObject({ sessionId: z.uuid().nullable() });

export function endMySessionsActionDefinition(): ActionDefinition<
  typeof EndMySessionsInput,
  { readonly ended: number; readonly scope: 'one' | 'others' },
  UserTx
> {
  return {
    permission: manageOwn,
    input: EndMySessionsInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      const ended = await endMySessions(ctx.tx, input.sessionId);
      if (input.sessionId !== null && ended === 0) return err(appError('NOT_FOUND'));
      return ok({ ended, scope: input.sessionId === null ? 'others' : 'one' });
    },
    audit: (input, output) =>
      output.ended === 0
        ? null
        : {
            action: 'platform.auth.own_sessions_ended',
            entityType: 'user',
            ...(input.sessionId ? { entityId: input.sessionId } : {}),
            data: { scope: output.scope, count: output.ended },
          },
  };
}

// ---------------------------------------------------------------------------------------------------
// A member's sessions (screen 3, user managers)
// ---------------------------------------------------------------------------------------------------

export interface MemberSecurityView {
  readonly sessions: readonly SignInSession[];
  readonly usesApp: boolean | null;
  readonly appSince: Date | null;
  /** An app waits for its e-mailed confirmation (review H1). */
  readonly appPending: boolean;
  /** The caller may reset the member's authenticator app (Organization Admin; PO answer 9 Oct 2026). */
  readonly canResetApp: boolean;
  /**
   * …after a code of their own from the last 15 minutes first (the session has none, or an older one:
   * review L3) — the page links to the /mfa step, which returns to the profile.
   */
  readonly resetNeedsCode: boolean;
  /** The organization's device limit, for "(2 of 3 allowed)". */
  readonly maxDevices: number | null;
}

const MemberInput = z.strictObject({ personId: z.uuid() });

export function memberSecurityQueryDefinition(): QueryDefinition<
  typeof MemberInput,
  MemberSecurityView,
  UserTx
> {
  return {
    permission: p['platform.user.deactivate'],
    input: MemberInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      // The manage rule (only an Organization Admin for a member with a privileged role), as the database.
      if (!(await mayManagePerson(ctx.tx, input.personId))) return err(appError('FORBIDDEN'));
      const [sessions, mfa, policy] = [
        await listMemberSessions(ctx.tx, input.personId),
        await getMemberMfa(ctx.tx, input.personId),
        await getSecurityPolicy(ctx.tx),
      ];
      const resetAccess =
        ctx.resource !== null && ctx.actor.personId !== input.personId
          ? ctx.access(p['platform.user.reset_mfa'], ctx.resource)
          : 'denied';
      return ok({
        sessions,
        usesApp: mfa?.usesApp ?? null,
        appSince: mfa?.since ?? null,
        appPending: mfa?.pending ?? false,
        // Shown also before the code: the page then asks for it first (step-up).
        canResetApp: resetAccess !== 'denied',
        resetNeedsCode: resetAccess === 'step_up_required',
        maxDevices: policy?.sessionMaxDevices ?? null,
      });
    },
  };
}

export const EndMemberSessionsInput = z.strictObject({
  personId: z.uuid(),
  sessionId: z.uuid().nullable(),
});

const INSUFFICIENT_PRIVILEGE = '42501';

function databaseCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

export function endMemberSessionsActionDefinition(): ActionDefinition<
  typeof EndMemberSessionsInput,
  { readonly personId: string; readonly ended: number; readonly scope: 'one' | 'all' },
  UserTx
> {
  return {
    permission: p['platform.user.deactivate'],
    input: EndMemberSessionsInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      if (!(await mayManagePerson(ctx.tx, input.personId))) return err(appError('FORBIDDEN'));
      let ended: number;
      try {
        ended = await endMemberSessions(ctx.tx, input.personId, input.sessionId);
      } catch (error) {
        if (databaseCode(error) === INSUFFICIENT_PRIVILEGE) return err(appError('FORBIDDEN'));
        throw error;
      }
      if (input.sessionId !== null && ended === 0) return err(appError('NOT_FOUND'));
      return ok({
        personId: input.personId,
        ended,
        scope: input.sessionId === null ? 'all' : 'one',
      });
    },
    audit: (input, output) => ({
      action: 'platform.user.sessions_ended',
      entityType: 'person',
      entityId: output.personId,
      data: {
        scope: output.scope,
        count: output.ended,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// A member's lost authenticator app (screen 3; PO answer, 9 Oct 2026; TM-0003 T-IAM-10)
// ---------------------------------------------------------------------------------------------------

export const MfaResetErrors = defineErrorCodes({
  /** The member has no authenticator app (nothing to reset). */
  MFA_RESET_NO_APP: { status: 409, messageKey: 'userProfile.errors.mfaResetNoApp' },
  /** The member's login belongs to another organization too: ENTLAQA support resets it. */
  MFA_RESET_OTHER_ORGANIZATION: {
    status: 409,
    messageKey: 'userProfile.errors.mfaResetOtherOrganization',
  },
});

export const ResetMemberMfaInput = z.strictObject({ personId: z.uuid() });

/**
 * "Reset authenticator app" on a user's profile: the Organization Admin, with a code of their own from the
 * last 15 minutes (`platform.user.reset_mfa`: high risk, AAL2), removes the apps of a member they may
 * manage. The database checks the same again (private.reset_member_mfa: Organization Admin, AAL2 through a
 * confirmed app, the manage rule, not themself — My profile — and a login that is an active member of no
 * other organization), deletes the apps in Auth, ends every session of the member and e-mails them; the
 * member sets up a new app at their next sign-in. Audited here.
 */
export function resetMemberMfaActionDefinition(): ActionDefinition<
  typeof ResetMemberMfaInput,
  { readonly personId: string },
  UserTx
> {
  return {
    permission: p['platform.user.reset_mfa'],
    input: ResetMemberMfaInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      if (!(await mayManagePerson(ctx.tx, input.personId))) return err(appError('FORBIDDEN'));
      let outcome: Awaited<ReturnType<typeof resetMemberMfa>>;
      try {
        outcome = await resetMemberMfa(ctx.tx, input.personId);
      } catch (error) {
        if (databaseCode(error) === INSUFFICIENT_PRIVILEGE) return err(appError('FORBIDDEN'));
        throw error;
      }
      switch (outcome) {
        case 'reset':
          return ok({ personId: input.personId });
        case 'no_app':
          return err(appError(MfaResetErrors.MFA_RESET_NO_APP));
        case 'other_organization':
          return err(appError(MfaResetErrors.MFA_RESET_OTHER_ORGANIZATION));
        case 'self':
          // One's own app is removed in My profile, with one's own code.
          return err(appError('FORBIDDEN'));
        case 'not_found':
          return err(appError('NOT_FOUND'));
      }
    },
    audit: (_input, output) => ({
      action: 'platform.user.mfa_reset',
      entityType: 'person',
      entityId: output.personId,
      data: { method: 'totp' },
    }),
  };
}
