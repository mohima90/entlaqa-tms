import 'server-only';

export {
  type AppDatabase,
  type DbLoginRole,
  DATABASE_CA_CERT_ENV,
  DATABASE_CA_CERT_FILE_ENV,
  readDatabaseCaPem,
  DATABASE_URL_ENV,
  assertConnectionRole,
  createDatabase,
  isDatabaseConfigured,
  tlsOptionsFor,
} from './client';
export { type AuditEventInput, insertAuditEvent } from './audit';
export { type DatabaseHealth, checkDatabase } from './health';
export { type CurrentTenant, getCurrentTenant } from './tenants';
export { type OrgUnitOption, type OrgUnitOptions, listOrgUnitOptions } from './org';
export { type PersonalDetails, getPersonalDetails, updatePersonalDetails } from './my-profile';
export {
  type AssignedRole,
  type EditableRoles,
  type RolesOutcome,
  type RolesRefusal,
  type ReplaceRolesOptions,
  getEditableRoles,
  keepPrimaryDays,
  replaceMemberRoles,
  rolesRefusalOf,
  touchesRoles,
} from './role-admin';
export {
  type CurrentUnit,
  type EditableUser,
  type ManagerOption,
  type UserDetailsChange,
  type UserDetailsOutcome,
  type UserDetailsRefusal,
  getEditableUser,
  listManagerOptions,
  mayManagePerson,
  refusalOf,
  updateUserDetails,
} from './user-admin';
export {
  type MembershipStatus,
  type PersonResourceFacts,
  type UserActivity,
  type UserList,
  type UserListCounts,
  type UserListFilter,
  type UserListRow,
  type UserListTab,
  type UserProfile,
  type UserProfileOptions,
  MAX_PAGE_SIZE,
  type UserRole,
  getUserProfile,
  listUsers,
  loadPersonResourceFacts,
  personScopePredicate,
} from './users';
export {
  type MemberAuthorizationFacts,
  type MemberRole,
  loadMemberAuthorizationFacts,
} from './roles';
export {
  type SessionTenant,
  type UserTx,
  type WithUserTx,
  createWithUserTx,
  listSessionTenants,
  switchActiveTenant,
  withUserTx,
} from './with-user-tx';
export * as schema from './schema';
