import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type InvitationRow,
  type ManagerOption,
  type OrgUnitOptions,
  type UserTx,
  createInvitation,
  getInvitationRoles,
  invitationCode,
  listInvitations,
  listManagerOptions,
  listOrgUnitOptions,
  requestInvitationResend,
  revokeInvitation,
} from '@jadarat/platform-db';
import { hasVisibleText, normalizeDigits } from '@jadarat/platform-i18n';
import { z } from 'zod';
import type { ActionContext, ActionDefinition } from '../define-action';
import type { QueryDefinition } from '../define-query';
import type { PermissionDefinition } from '../permissions';
import { platformPermissions } from '../platform-permissions';
import { includesConflictingRoles } from '../separation-of-duties';
import { SYSTEM_ROLES, SYSTEM_ROLE_CODES } from '../system-roles';
import { namePart } from './my-profile';

/**
 * Invitations, admin side (T-M2-07, FR-IAM-03, BR-IAM-1; approved screens 1 and 2;
 * docs/engineering/invitations-contract.md §1 steps 1 and 3). Permission `platform.user.invite`
 * (HR Manager, Organization Admin). Privileged roles may be given only by holders of
 * `platform.role.assign_privileged` (the Organization Admin; no authenticator code since the PO
 * decision of 14 Oct 2026) — the same split as changing roles (edit-roles.ts): an ordinary action that refuses
 * privileged roles and a privileged action with the strict session check. The database guard applies
 * the same rule. An invitation never gives the Organization Admin role together with another role (BR-IAM-4,
 * T-M2-16: ROLE_CONFLICT on the additional roles). Audit records carry ids and role codes only (no names,
 * no e-mail).
 */
const p = platformPermissions;

/**
 * The canonical link an administrator copies for a code (`/{locale}/sign-up#code=…` on the app's public
 * origin, APP_BASE_URL — the web app supplies it, apps/suite lib/app-base-url.ts); null when the origin is
 * not configured (the browser then uses its own).
 */
export type InviteLinkOf = (locale: 'ar' | 'en', code: string) => string | null;

/** What the invitation actions need from the web app. */
export interface InvitationActionOptions {
  readonly inviteLinkOf?: InviteLinkOf;
}

const noLink: InviteLinkOf = () => null;

/** First code + 3 new ones on resend (contract §1 step 3). */
export const MAX_INVITATION_SENDS = 4;
/** Days an invitation (each e-mailed link) stays valid. */
export const INVITATION_VALID_DAYS = 7;

const PRIVILEGED: ReadonlySet<string> = new Set(
  SYSTEM_ROLES.filter((r) => r.privileged).map((r) => r.code),
);

const optionalId = z
  .union([z.uuid(), z.literal('')])
  .transform((value) => (value === '' ? null : value));

const requiredNamePart = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((value) => hasVisibleText(value), { message: 'invisible' });

export const InviteUserInput = z
  .strictObject({
    email: z.string().trim().max(254).toLowerCase().pipe(z.email()),
    firstNameAr: requiredNamePart,
    familyNameAr: requiredNamePart,
    firstNameEn: namePart,
    familyNameEn: namePart,
    departmentId: optionalId,
    branchId: optionalId,
    managerPersonId: optionalId,
    employeeNumber: z
      .string()
      .max(40)
      .transform((value) => normalizeDigits(value).trim())
      .refine((value) => value === '' || hasVisibleText(value), { message: 'invisible' })
      .transform((value) => (value === '' ? null : value)),
    primaryRole: z.enum(SYSTEM_ROLE_CODES),
    additionalRoles: z.array(z.enum(SYSTEM_ROLE_CODES)).max(SYSTEM_ROLE_CODES.length - 1),
    locale: z.enum(['ar', 'en']),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>([value.primaryRole]);
    value.additionalRoles.forEach((code, index) => {
      if (seen.has(code)) {
        ctx.addIssue({ code: 'custom', path: ['additionalRoles', index], message: 'twice' });
      }
      seen.add(code);
    });
  });

export type InviteUserInputValue = z.output<typeof InviteUserInput>;

/** Does the invitation give a privileged role (primary or additional)? */
export function invitationGivesPrivilegedRole(input: {
  readonly primaryRole: string;
  readonly additionalRoles: readonly string[];
}): boolean {
  return PRIVILEGED.has(input.primaryRole) || input.additionalRoles.some((c) => PRIVILEGED.has(c));
}

const REFUSAL_FIELDS = {
  EMAIL_TAKEN: 'email',
  EMPLOYEE_NUMBER_TAKEN: 'employeeNumber',
  ROLE_NOT_ALLOWED: 'primaryRole',
  // The Organization Admin role with another role: one of them is always an additional role (BR-IAM-4).
  ROLE_CONFLICT: 'additionalRoles',
} as const;
type InvitationRefusalCode = keyof typeof REFUSAL_FIELDS;

/**
 * The refusal code createInvitation throws (contract §2: EMAIL_TAKEN, EMPLOYEE_NUMBER_TAKEN,
 * ROLE_NOT_ALLOWED; ROLE_CONFLICT, BR-IAM-4), read from the error's `code`; anything else is unexpected
 * (null).
 */
export function invitationRefusalCode(error: unknown): InvitationRefusalCode | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const { code } = error;
  return typeof code === 'string' && Object.hasOwn(REFUSAL_FIELDS, code)
    ? (code as InvitationRefusalCode)
    : null;
}

function fieldError(path: string, code: string): AppError {
  return appError('VALIDATION_FAILED', { fieldErrors: [{ path, code }] });
}

/** The field a refused role points at: an additional role when only those are privileged. */
function roleNotAllowed(input: InviteUserInputValue): AppError {
  const additionalOnly =
    !PRIVILEGED.has(input.primaryRole) && input.additionalRoles.some((c) => PRIVILEGED.has(c));
  return fieldError(additionalOnly ? 'additionalRoles' : 'primaryRole', 'ROLE_NOT_ALLOWED');
}

export interface InvitationCreated {
  readonly invitationId: string;
  readonly personId: string;
  readonly primaryRole: string;
  readonly additionalRoles: readonly string[];
  /**
   * The invitation's first code (Kawadir: shown right away with «نسخ الرمز» / «نسخ الرابط») and the
   * language its link opens in. Returned to the inviter only — never audited or logged.
   */
  readonly inviteCode: string;
  readonly locale: 'ar' | 'en';
  /** The link to copy on the app's public origin; null when not configured (the browser uses its own). */
  readonly inviteLink: string | null;
}

async function invite(
  ctx: ActionContext<UserTx>,
  input: InviteUserInputValue,
  inviteLinkOf: InviteLinkOf,
): Promise<InvitationCreated> {
  const created = await createInvitation(ctx.tx, {
    email: input.email,
    firstNameAr: input.firstNameAr,
    familyNameAr: input.familyNameAr,
    firstNameEn: input.firstNameEn,
    familyNameEn: input.familyNameEn,
    departmentId: input.departmentId,
    branchId: input.branchId,
    managerPersonId: input.managerPersonId,
    employeeNumber: input.employeeNumber,
    primaryRole: input.primaryRole,
    additionalRoles: input.additionalRoles,
    locale: input.locale,
  });
  return {
    invitationId: created.invitationId,
    personId: created.personId,
    primaryRole: input.primaryRole,
    additionalRoles: input.additionalRoles,
    inviteCode: created.inviteCode,
    locale: input.locale,
    inviteLink: inviteLinkOf(input.locale, created.inviteCode),
  };
}

function inviteAction(
  permission: PermissionDefinition,
  privileged: boolean,
  inviteLinkOf: InviteLinkOf,
): ActionDefinition<typeof InviteUserInput, InvitationCreated, UserTx> {
  return {
    permission,
    input: InviteUserInput,
    handler: async ({ ctx, input }) => {
      // Separation of duties (BR-IAM-4): refused whoever invites — a rule about the roles, not the actor.
      if (includesConflictingRoles([input.primaryRole, ...input.additionalRoles])) {
        return err(fieldError(REFUSAL_FIELDS.ROLE_CONFLICT, 'ROLE_CONFLICT'));
      }
      if (privileged) {
        // The privileged path is authorized by role.assign_privileged; inviting stays user.invite.
        if (!ctx.can(p['platform.user.invite'], 'tenant')) return err(appError('FORBIDDEN'));
      } else if (invitationGivesPrivilegedRole(input)) {
        // Ordinary path: privileged roles go through the privileged action (strict session check).
        return err(roleNotAllowed(input));
      }
      try {
        return ok(await invite(ctx, input, inviteLinkOf));
      } catch (error) {
        const code = invitationRefusalCode(error);
        if (code === null) throw error;
        if (code === 'ROLE_NOT_ALLOWED') return err(roleNotAllowed(input));
        return err(fieldError(REFUSAL_FIELDS[code], code));
      }
    },
    audit: (_input, output) => ({
      action: 'platform.invitation.created',
      entityType: 'invitation',
      entityId: output.invitationId,
      // Ids and role codes only (no names, no e-mail).
      data: {
        personId: output.personId,
        primaryRole: output.primaryRole,
        additionalRoles: output.additionalRoles,
      },
    }),
  };
}

/** Invite with ordinary roles (HR Manager, Organization Admin). */
export function inviteUserActionDefinition(options: InvitationActionOptions = {}) {
  return inviteAction(p['platform.user.invite'], false, options.inviteLinkOf ?? noLink);
}

/** Invite with a privileged role: the Organization Admin. */
export function invitePrivilegedUserActionDefinition(options: InvitationActionOptions = {}) {
  return inviteAction(p['platform.role.assign_privileged'], true, options.inviteLinkOf ?? noLink);
}

export const InvitationIdInput = z.strictObject({ invitationId: z.uuid() });

export interface InvitationChanged {
  readonly invitationId: string;
}

/**
 * A resend: a new code was issued (the old link stops working). The code itself is not returned: the
 * member copies it like any other code (viewInvitationCode*: authorized and audited — security review M2).
 */
export type InvitationResent = InvitationChanged;

/** The database refused the actor (e.g. an HR Manager on an invitation with a privileged role). */
function invitationRoleNotAllowed(): AppError {
  return fieldError('invitationId', 'ROLE_NOT_ALLOWED');
}

/**
 * Resend while pending (also after expiry): a new code and 7 new days (Kawadir), up to
 * MAX_INVITATION_SENDS codes in total; the old link stops working. An invitation with a privileged role is
 * resent only by holders of `platform.role.assign_privileged` (as inviting with it: ROLE_NOT_ALLOWED); the
 * database applies the same rule when it issues the code (security review M2). Copying a code is not a
 * resend.
 */
export function resendInvitationActionDefinition(): ActionDefinition<
  typeof InvitationIdInput,
  InvitationResent,
  UserTx
> {
  return {
    permission: p['platform.user.invite'],
    input: InvitationIdInput,
    handler: async ({ ctx, input }) => {
      const roles = await getInvitationRoles(ctx.tx, input.invitationId);
      if (roles && invitationGivesPrivilegedRole(roles)) {
        if (!ctx.can(p['platform.role.assign_privileged'], 'tenant')) {
          return err(invitationRoleNotAllowed());
        }
      }
      let outcome: Awaited<ReturnType<typeof requestInvitationResend>>;
      try {
        outcome = await requestInvitationResend(ctx.tx, input.invitationId);
      } catch (error) {
        if (invitationRefusalCode(error) === 'ROLE_NOT_ALLOWED') {
          return err(invitationRoleNotAllowed());
        }
        throw error;
      }
      if (outcome.status !== 'queued') {
        return err(
          fieldError(
            'invitationId',
            outcome.status === 'limit_reached' ? 'RESEND_LIMIT' : 'NOT_PENDING',
          ),
        );
      }
      return ok({ invitationId: input.invitationId });
    },
    audit: (_input, output) => ({
      action: 'platform.invitation.resend_requested',
      entityType: 'invitation',
      entityId: output.invitationId,
    }),
  };
}

/** One invitation's code for «نسخ الرمز» / «نسخ الرابط», with the language and the link to copy. */
export interface InvitationCodeView {
  readonly invitationId: string;
  readonly inviteCode: string;
  readonly locale: 'ar' | 'en';
  /** On the app's public origin; null when not configured (the browser uses its own). */
  readonly inviteLink: string | null;
}

function viewCodeAction(
  permission: PermissionDefinition,
  privileged: boolean,
  inviteLinkOf: InviteLinkOf,
): ActionDefinition<typeof InvitationIdInput, InvitationCodeView, UserTx> {
  return {
    permission,
    input: InvitationIdInput,
    handler: async ({ ctx, input }) => {
      // The privileged path is authorized by role.assign_privileged (strict session check); copying stays
      // a user.invite matter.
      if (privileged && !ctx.can(p['platform.user.invite'], 'tenant')) {
        return err(appError('FORBIDDEN'));
      }
      const roles = await getInvitationRoles(ctx.tx, input.invitationId);
      if (!roles) return err(fieldError('invitationId', 'NOT_PENDING'));
      // Ordinary path: a privileged invitation's code only through the privileged action — as inviting
      // with that role (the database applies the same rule: an HR Manager reads no such code).
      if (!privileged && invitationGivesPrivilegedRole(roles)) {
        return err(invitationRoleNotAllowed());
      }
      const code = await invitationCode(ctx.tx, input.invitationId);
      // Expired, held, not sent with a code (a link e-mailed before codes) or not this member's to copy.
      if (!code) return err(fieldError('invitationId', 'NO_CODE'));
      return ok({
        invitationId: input.invitationId,
        inviteCode: code.inviteCode,
        locale: code.locale,
        inviteLink: inviteLinkOf(code.locale, code.inviteCode),
      });
    },
    // Who copied which invitation's code — ids only, never the code (security review M2).
    audit: (_input, output) => ({
      action: 'platform.invitation.code_viewed',
      entityType: 'invitation',
      entityId: output.invitationId,
      data: { privileged },
    }),
  };
}

/**
 * «نسخ الرمز» / «نسخ الرابط» of an invitation with ordinary roles (HR Manager, Organization Admin): reads its
 * current code on demand — it is never in the list — and audits the read (security review M2).
 */
export function viewInvitationCodeActionDefinition(options: InvitationActionOptions = {}) {
  return viewCodeAction(p['platform.user.invite'], false, options.inviteLinkOf ?? noLink);
}

/**
 * The same for an invitation with a privileged role: `platform.role.assign_privileged` (the Organization
 * Admin), with the strict session check (getUser) of a high-risk permission — as inviting with that role.
 */
export function viewPrivilegedInvitationCodeActionDefinition(
  options: InvitationActionOptions = {},
) {
  return viewCodeAction(p['platform.role.assign_privileged'], true, options.inviteLinkOf ?? noLink);
}

/**
 * Revoke a pending invitation: its link stops working. An invitation with a privileged role only an
 * Organization Admin revokes (database guard): ROLE_NOT_ALLOWED for anyone else.
 */
export function revokeInvitationActionDefinition(): ActionDefinition<
  typeof InvitationIdInput,
  InvitationChanged,
  UserTx
> {
  return {
    permission: p['platform.user.invite'],
    input: InvitationIdInput,
    handler: async ({ ctx, input }) => {
      let revoked: boolean;
      try {
        revoked = await revokeInvitation(ctx.tx, input.invitationId);
      } catch (error) {
        if (invitationRefusalCode(error) === 'ROLE_NOT_ALLOWED') {
          return err(invitationRoleNotAllowed());
        }
        throw error;
      }
      if (!revoked) return err(fieldError('invitationId', 'NOT_PENDING'));
      return ok({ invitationId: input.invitationId });
    },
    audit: (_input, output) => ({
      action: 'platform.invitation.revoked',
      entityType: 'invitation',
      entityId: output.invitationId,
    }),
  };
}

export interface InvitationsView {
  /**
   * Pending, expired, held and scheduled invitations (held: added by an import without sending, T-M2-12;
   * accepted and revoked ones are not listed), newest first.
   */
  readonly invitations: readonly InvitationRow[];
  /**
   * The member may copy the codes of invitations with a privileged role (`platform.role.assign_privileged`:
   * the Organization Admin) — through viewPrivilegedInvitationCode*. Tells "you may not copy this code"
   * apart from "no code yet" on the list.
   */
  readonly canCopyPrivileged: boolean;
}

export const InvitationsListInput = z.strictObject({});

/** The invitations shown on the users list (`invited` tab): pending, expired, held and scheduled. */
export function invitationsListQueryDefinition(): QueryDefinition<
  typeof InvitationsListInput,
  InvitationsView,
  UserTx
> {
  return {
    permission: p['platform.user.invite'],
    input: InvitationsListInput,
    handler: async ({ ctx }) => {
      const rows = await listInvitations(ctx.tx);
      const invitations = rows
        .filter(
          (row) =>
            row.state === 'pending' ||
            row.state === 'expired' ||
            row.state === 'held' ||
            row.state === 'scheduled',
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return ok({
        invitations,
        canCopyPrivileged: ctx.can(p['platform.role.assign_privileged'], 'tenant'),
      });
    },
  };
}

export interface InviteFormView {
  readonly managers: readonly ManagerOption[];
  readonly orgUnits: OrgUnitOptions;
  /** Privileged roles: allowed (the Organization Admin) or not for this member. */
  readonly privilegedAccess: 'allowed' | 'denied';
}

export const InviteFormInput = z.strictObject({});

/** What the invite form offers: departments, branches, direct managers and the roles allowed. */
export function inviteFormQueryDefinition(): QueryDefinition<
  typeof InviteFormInput,
  InviteFormView,
  UserTx
> {
  return {
    permission: p['platform.user.invite'],
    input: InviteFormInput,
    handler: async ({ ctx }) => {
      const managers = ctx.can(p['platform.user.read'], 'tenant')
        ? await listManagerOptions(ctx.tx)
        : [];
      const orgUnits = ctx.can(p['platform.org.read'], 'tenant')
        ? await listOrgUnitOptions(ctx.tx)
        : { departments: [], branches: [] };
      return ok({
        managers: managers.filter((m) => m.active),
        orgUnits,
        privilegedAccess: ctx.can(p['platform.role.assign_privileged'], 'tenant')
          ? 'allowed'
          : 'denied',
      });
    },
  };
}
