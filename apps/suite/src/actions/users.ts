'use server';
/**
 * Users administration: HR / Organization Admin edits a person's details and placement (T-M2-13) and
 * a member's roles (T-M2-14). Definitions and tests in @jadarat/platform-rbac (iam/edit-user.ts,
 * iam/edit-roles.ts).
 */
import {
  defineAction,
  updateMemberPrivilegedRolesActionDefinition,
  updateMemberRolesActionDefinition,
  updateUserDetailsActionDefinition,
} from '@jadarat/platform-rbac';

export const updateUserDetailsAction = defineAction(updateUserDetailsActionDefinition());

/** Ordinary roles (HR Manager, Organization Admin). */
export const updateMemberRolesAction = defineAction(updateMemberRolesActionDefinition());

/** Changes that touch a privileged role: Organization Admin with an authenticator code (AAL2). */
export const updateMemberPrivilegedRolesAction = defineAction(
  updateMemberPrivilegedRolesActionDefinition(),
);
