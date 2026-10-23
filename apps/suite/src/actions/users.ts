'use server';
/**
 * Users administration: HR / Organization Admin edits a person's details and placement (T-M2-13), a
 * member's roles (T-M2-14), deactivates or reactivates a member (T-M2-09) and ends a member's sign-in
 * lock (T-M2-11). Definitions and tests in @jadarat/platform-rbac (iam/edit-user.ts, iam/edit-roles.ts,
 * iam/deactivation.ts, iam/sign-in-lock.ts).
 */
import {
  deactivateMemberActionDefinition,
  deactivatePrivilegedMemberActionDefinition,
  defineAction,
  reactivateMemberActionDefinition,
  reactivatePrivilegedMemberActionDefinition,
  unlockSignInActionDefinition,
  updateMemberPrivilegedRolesActionDefinition,
  updateMemberRolesActionDefinition,
  updatePersonHrDetailsActionDefinition,
  updatePersonRecordActionDefinition,
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

/** Deactivate a member who holds a privileged role: Organization Admin with an authenticator code. */
export const deactivatePrivilegedMemberAction = defineAction(
  deactivatePrivilegedMemberActionDefinition(RESPONSIBILITY_KINDS),
);

/** Reactivate a member without a privileged role (HR Manager, Organization Admin). */
export const reactivateMemberAction = defineAction(reactivateMemberActionDefinition());

/** Reactivate a member who holds a privileged role: Organization Admin with an authenticator code. */
export const reactivatePrivilegedMemberAction = defineAction(
  reactivatePrivilegedMemberActionDefinition(),
);

/** «إلغاء إيقاف تسجيل الدخول» on a member's profile: Organization Admin only (T-M2-11). */
export const unlockSignInAction = defineAction(unlockSignInActionDefinition());

/**
 * A person's grade and HR-only fields (WP-ADM-04): HR and the Organization Admin set the grade — also for a
 * privileged member —; only members holding «View and edit HR-only fields» (never the Organization Admin)
 * save the HR-only fields.
 */
export const updatePersonRecordAction = defineAction(updatePersonRecordActionDefinition());

/** Only the HR-only fields: for a member holding «View and edit HR-only fields» without the right to edit users. */
export const updatePersonHrDetailsAction = defineAction(updatePersonHrDetailsActionDefinition());
