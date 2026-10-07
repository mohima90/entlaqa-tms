'use server';
/**
 * Invitations, admin side (T-M2-07, FR-IAM-03): invite a person, resend or revoke an invitation.
 * Definitions and tests in @jadarat/platform-rbac (iam/invitations.ts).
 */
import {
  defineAction,
  invitePrivilegedUserActionDefinition,
  inviteUserActionDefinition,
  resendInvitationActionDefinition,
  revokeInvitationActionDefinition,
} from '@jadarat/platform-rbac';

/** Invite with ordinary roles (HR Manager, Organization Admin). */
export const inviteUserAction = defineAction(inviteUserActionDefinition());

/** Invite with a privileged role: Organization Admin with an authenticator code (AAL2). */
export const invitePrivilegedUserAction = defineAction(invitePrivilegedUserActionDefinition());

export const resendInvitationAction = defineAction(resendInvitationActionDefinition());

export const revokeInvitationAction = defineAction(revokeInvitationActionDefinition());
