'use server';
/**
 * Invitations, admin side (T-M2-07, FR-IAM-03): invite a person, resend or revoke an invitation, copy its
 * code or link. Definitions and tests in @jadarat/platform-rbac (iam/invitations.ts). Copied links use the
 * app's canonical origin (APP_BASE_URL, lib/app-base-url-request.ts; null → the browser's own).
 */
import { queueInvitationEmailInline } from '@jadarat/platform-identity/inline-mail';
import {
  defineAction,
  getSystemRole,
  invitePrivilegedUserActionDefinition,
  inviteUserActionDefinition,
  isSystemRoleCode,
  resendInvitationActionDefinition,
  revokeInvitationActionDefinition,
  viewInvitationCodeActionDefinition,
  viewPrivilegedInvitationCodeActionDefinition,
} from '@jadarat/platform-rbac';
import { canonicalInviteLink } from '../lib/app-base-url-request';

/**
 * The invitation e-mail is queued in the action's transaction and sent the moment it has committed (WP-ADM-05
 * follow-up: every e-mail arrives immediately); the worker's mailer stays the safety net.
 */
const options = {
  inviteLinkOf: canonicalInviteLink,
  queueEmail: (tx: Parameters<typeof queueInvitationEmailInline>[0], invitationId: string) =>
    queueInvitationEmailInline(tx, invitationId, (code) =>
      isSystemRoleCode(code) ? getSystemRole(code).name : { ar: code, en: code },
    ),
};

/** Invite with ordinary roles (HR Manager, Organization Admin). */
export const inviteUserAction = defineAction(inviteUserActionDefinition(options));

/** Invite with a privileged role: the Organization Admin (strict session check). */
export const invitePrivilegedUserAction = defineAction(
  invitePrivilegedUserActionDefinition(options),
);

export const resendInvitationAction = defineAction(resendInvitationActionDefinition(options));

export const revokeInvitationAction = defineAction(revokeInvitationActionDefinition());

/** «نسخ الرمز» / «نسخ الرابط»: one invitation's code, read on demand and audited (security review M2). */
export const viewInvitationCodeAction = defineAction(viewInvitationCodeActionDefinition(options));

/** The same for an invitation with a privileged role: the Organization Admin, strict session check. */
export const viewPrivilegedInvitationCodeAction = defineAction(
  viewPrivilegedInvitationCodeActionDefinition(options),
);
