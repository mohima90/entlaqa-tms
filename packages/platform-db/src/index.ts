import 'server-only';

export {
  type AppDatabase,
  type DbLoginRole,
  DATABASE_URL_ENV,
  assertConnectionRole,
  createDatabase,
  isDatabaseConfigured,
} from './client';
export {
  type UserTx,
  type WithUserTx,
  createWithUserTx,
  switchActiveTenant,
  withUserTx,
} from './with-user-tx';
export * as schema from './schema';
