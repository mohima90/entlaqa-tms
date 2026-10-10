import 'server-only';
import {
  deactivationQueryDefinition,
  defineQuery,
  editRolesQueryDefinition,
  editUserQueryDefinition,
  invitationsListQueryDefinition,
  inviteFormQueryDefinition,
  rolesPageQueryDefinition,
  myIdentityQueryDefinition,
  myProfileQueryDefinition,
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
/** Roles & permissions page (T-M2-05): member counts per role. */
export const rolesPageQuery = defineQuery(rolesPageQueryDefinition());
/** Invitations (T-M2-07): the invited tab of the users list and the invite form's choices. */
export const invitationsListQuery = defineQuery(invitationsListQueryDefinition());
export const inviteFormQuery = defineQuery(inviteFormQueryDefinition());

/** My profile (FR-IAM-16) and the header name of the signed-in member. */
export const myProfileQuery = defineQuery(myProfileQueryDefinition());
export const myIdentityQuery = defineQuery(myIdentityQueryDefinition());
