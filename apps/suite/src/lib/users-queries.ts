import 'server-only';
import {
  defineQuery,
  userProfileQueryDefinition,
  usersListQueryDefinition,
} from '@jadarat/platform-rbac';

/** Authorized reads for the users pages (T-M2-04; definitions and tests in platform-rbac/iam). */
export const usersListQuery = defineQuery(usersListQueryDefinition());
export const userProfileQuery = defineQuery(userProfileQueryDefinition());
