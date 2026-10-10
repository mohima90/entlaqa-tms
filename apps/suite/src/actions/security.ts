'use server';
/**
 * Security settings (screen 6) and sign-in sessions (screens 3 and 6) — FR-IAM-12/13, T-M2-10.
 * Definitions and tests in @jadarat/platform-rbac (iam/security.ts); the database enforces the rules.
 */
import {
  defineAction,
  endMemberSessionsActionDefinition,
  endMySessionsActionDefinition,
  resetMemberMfaActionDefinition,
  updateSecurityPolicyActionDefinition,
} from '@jadarat/platform-rbac';

/** Organization Admin at AAL2 only (high risk: getUser + authenticator code). */
export const updateSecurityPolicyAction = defineAction(updateSecurityPolicyActionDefinition());

/** My profile: end another of one's own sign-in sessions, or all others. */
export const endMySessionsAction = defineAction(endMySessionsActionDefinition());

/** User profile (screen 3): force sign-out of a member's sessions in this organization. */
export const endMemberSessionsAction = defineAction(endMemberSessionsActionDefinition());

/**
 * User profile (screen 3): the Organization Admin resets a member's lost authenticator app, with a code of
 * their own from the last 15 minutes (PO answer, 9 Oct 2026). Checked again by the database; e-mailed.
 */
export const resetMemberMfaAction = defineAction(resetMemberMfaActionDefinition());
