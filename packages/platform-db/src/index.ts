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
