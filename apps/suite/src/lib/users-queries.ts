import 'server-only';
import {
  defineQuery,
  myIdentityQueryDefinition,
  myProfileQueryDefinition,
  userProfileQueryDefinition,
  usersListQueryDefinition,
} from '@jadarat/platform-rbac';

/** Authorized reads for the users pages (T-M2-04; definitions and tests in platform-rbac/iam). */
export const usersListQuery = defineQuery(usersListQueryDefinition());
export const userProfileQuery = defineQuery(userProfileQueryDefinition());

/** My profile (FR-IAM-16) and the header name of the signed-in member. */
export const myProfileQuery = defineQuery(myProfileQueryDefinition());
export const myIdentityQuery = defineQuery(myIdentityQueryDefinition());
