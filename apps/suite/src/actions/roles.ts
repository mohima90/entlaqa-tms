'use server';
/**
 * Custom roles (FR-IAM-07; EP-ROLES, PO 17 Oct 2026): the Organization Admin creates, changes and deletes
 * the organization's own roles. Definitions and tests in @jadarat/platform-rbac (iam/custom-roles.ts); the
 * database guards enforce the same rules (platform.custom_roles).
 */
import {
  createCustomRoleActionDefinition,
  defineAction,
  deleteCustomRoleActionDefinition,
  updateCustomRoleActionDefinition,
} from '@jadarat/platform-rbac';

export const createCustomRoleAction = defineAction(createCustomRoleActionDefinition());

export const updateCustomRoleAction = defineAction(updateCustomRoleActionDefinition());

/** Only when nobody holds the role (members or pending invitations). */
export const deleteCustomRoleAction = defineAction(deleteCustomRoleActionDefinition());
