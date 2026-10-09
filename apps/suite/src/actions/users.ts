'use server';
/**
 * Users administration: HR / Organization Admin edits a person's details and placement (T-M2-13), a
 * member's roles (T-M2-14), and deactivates or reactivates a member (T-M2-09). Definitions and tests in
 * @jadarat/platform-rbac (iam/edit-user.ts, iam/edit-roles.ts, iam/deactivation.ts).
 */
import {
  deactivateMemberActionDefinition,
  defineAction,
  reactivateMemberActionDefinition,
  reactivatePrivilegedMemberActionDefinition,
  updateMemberPrivilegedRolesActionDefinition,
  updateMemberRolesActionDefinition,
  updateUserDetailsActionDefinition,
} from '@jadarat/platform-rbac';
import { RESPONSIBILITY_KINDS } from '../lib/responsibilities';

export const updateUserDetailsAction = defineAction(updateUserDetailsActionDefinition());

/** Ordinary roles (HR Manager, Organization Admin). */
export const updateMemberRolesAction = defineAction(updateMemberRolesActionDefinition());

/** Changes that touch a privileged role: Organization Admin with an authenticator code (AAL2). */
export const updateMemberPrivilegedRolesAction = defineAction(
  updateMemberPrivilegedRolesActionDefinition(),
);

/** Deactivate a member, handing over what they are responsible for (screen 4). */
export const deactivateMemberAction = defineAction(
  deactivateMemberActionDefinition(RESPONSIBILITY_KINDS),
);

/** Reactivate a member without a privileged role (HR Manager, Organization Admin). */
export const reactivateMemberAction = defineAction(reactivateMemberActionDefinition());

/** Reactivate a member who holds a privileged role: Organization Admin with an authenticator code. */
export const reactivatePrivilegedMemberAction = defineAction(
  reactivatePrivilegedMemberActionDefinition(),
);
