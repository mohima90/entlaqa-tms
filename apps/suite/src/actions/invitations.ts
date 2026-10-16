'use server';
/**
 * Invitations, admin side (T-M2-07, FR-IAM-03): invite a person, resend or revoke an invitation, copy its
 * code or link. Definitions and tests in @jadarat/platform-rbac (iam/invitations.ts). Copied links use the
 * app's canonical origin (APP_BASE_URL, lib/app-base-url-request.ts; null → the browser's own).
 */
import {
  defineAction,
  invitePrivilegedUserActionDefinition,
  inviteUserActionDefinition,
  resendInvitationActionDefinition,
  revokeInvitationActionDefinition,
  viewInvitationCodeActionDefinition,
  viewPrivilegedInvitationCodeActionDefinition,
} from '@jadarat/platform-rbac';
import { canonicalInviteLink } from '../lib/app-base-url-request';

const options = { inviteLinkOf: canonicalInviteLink };

/** Invite with ordinary roles (HR Manager, Organization Admin). */
export const inviteUserAction = defineAction(inviteUserActionDefinition(options));

/** Invite with a privileged role: the Organization Admin (strict session check). */
export const invitePrivilegedUserAction = defineAction(
  invitePrivilegedUserActionDefinition(options),
);

export const resendInvitationAction = defineAction(resendInvitationActionDefinition());

export const revokeInvitationAction = defineAction(revokeInvitationActionDefinition());

/** «نسخ الرمز» / «نسخ الرابط»: one invitation's code, read on demand and audited (security review M2). */
export const viewInvitationCodeAction = defineAction(viewInvitationCodeActionDefinition(options));

/** The same for an invitation with a privileged role: the Organization Admin, strict session check. */
export const viewPrivilegedInvitationCodeAction = defineAction(
  viewPrivilegedInvitationCodeActionDefinition(options),
);
