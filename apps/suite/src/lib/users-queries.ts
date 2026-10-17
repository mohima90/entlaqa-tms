import 'server-only';
import {
  deactivationQueryDefinition,
  defineQuery,
  editRolesQueryDefinition,
  editUserQueryDefinition,
  invitationsListQueryDefinition,
  inviteFormQueryDefinition,
  roleDetailQueryDefinition,
  roleEditorQueryDefinition,
  rolesPageQueryDefinition,
  memberSecurityQueryDefinition,
  myIdentityQueryDefinition,
  myProfileQueryDefinition,
  mySecurityQueryDefinition,
  organizationProfileQueryDefinition,
  securityPageQueryDefinition,
  userProfileQueryDefinition,
  usersListQueryDefinition,
} from '@jadarat/platform-rbac';
import { RESPONSIBILITY_KINDS } from './responsibilities';

/** Authorized reads for the users pages (T-M2-04; definitions and tests in platform-rbac/iam). */
export const usersListQuery = defineQuery(usersListQueryDefinition());
export const userProfileQuery = defineQuery(userProfileQueryDefinition());
/** Edit a user's details (T-M2-13): the record, manager options and org units. */
export const editUserQuery = defineQuery(editUserQueryDefinition());
/** Change a member's roles (T-M2-14): current roles and what the member may change. */
export const editRolesQuery = defineQuery(editRolesQueryDefinition());
/** Deactivate a member (T-M2-09, screen 4): what they are responsible for and who can take it over. */
export const deactivationQuery = defineQuery(deactivationQueryDefinition(RESPONSIBILITY_KINDS));
/** Roles & permissions (T-M2-05; EP-ROLES): standard and custom roles, people per role. */
export const rolesPageQuery = defineQuery(rolesPageQueryDefinition());
/** One role: standard (view only) or custom (edit for the Organization Admin). */
export const roleDetailQuery = defineQuery(roleDetailQueryDefinition());
/** Create a role: the permissions the Organization Admin may give. */
export const roleEditorQuery = defineQuery(roleEditorQueryDefinition());
/** Invitations (T-M2-07): the invited tab of the users list and the invite form's choices. */
export const invitationsListQuery = defineQuery(invitationsListQueryDefinition());
export const inviteFormQuery = defineQuery(inviteFormQueryDefinition());

/** My profile (FR-IAM-16) and the header name of the signed-in member. */
export const myProfileQuery = defineQuery(myProfileQueryDefinition());
export const myIdentityQuery = defineQuery(myIdentityQueryDefinition());

/** Security settings (screen 6, T-M2-10), own sessions and password rule, a member's sessions (screen 3). */
export const securityPageQuery = defineQuery(securityPageQueryDefinition());
export const mySecurityQuery = defineQuery(mySecurityQueryDefinition());
export const memberSecurityQuery = defineQuery(memberSecurityQueryDefinition());

/** Organization profile (T-M2-22): the Organization Admin's page (platform.tenant.manage). */
export const organizationProfileQuery = defineQuery(organizationProfileQueryDefinition());
