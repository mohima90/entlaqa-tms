import { type AppDatabase, getDatabase, isDatabaseConfigured } from './client';

export type DatabaseHealth = 'ok' | 'unavailable' | 'not-configured';

/**
 * Readiness probe for the request-path connection (ADR 0009 §6): `select 1` as `app_server`, bounded by
 * a timeout. Needs no table privileges and reads no tenant data. Never throws and never returns
 * details (callers expose only the status).
 */
export async function checkDatabase(
  options: { readonly timeoutMs?: number; readonly getDb?: () => AppDatabase } = {},
): Promise<DatabaseHealth> {
  if (!options.getDb && !isDatabaseConfigured('app_server')) return 'not-configured';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const db = (options.getDb ?? (() => getDatabase('app_server')))();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('database health check timed out'));
      }, options.timeoutMs ?? 3000);
    });
    await Promise.race([db.$client`select 1 as ok`, timeout]);
    return 'ok';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}
