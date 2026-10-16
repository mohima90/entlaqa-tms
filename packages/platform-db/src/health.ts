import { type AppDatabase, getDatabase, isDatabaseConfigured } from './client';

export type DatabaseHealth = 'ok' | 'unavailable' | 'not-configured';

/**
 * Database functions the request path (and the worker) cannot work without, by SIGNATURE (name and
 * argument types, as PostgreSQL's oidvectortypes prints them): sign-in fails closed until they exist
 * (T-M2-11, migrations 20261013090000 and 20261013090100). Readiness is refused while one is missing — or
 * still has an older signature — so an app deployed ahead of its database migration is not sent traffic
 * (security review T-M2-11, deploy readiness). The database deploys automatically after a merge to `main`
 * (db-deploy-auto.yml) in parallel with the app: every new private.* function the app or the worker calls
 * belongs here (invitations contract §0, deploy order).
 */
export const REQUIRED_DATABASE_FUNCTIONS = [
  'rate_limit_hit(text, bytea, integer, integer)',
  'rate_limit_clear(text, bytea)',
  'rate_limit_give_back(text, bytea)',
  'rate_limit_sign_in_check(bytea, bytea, bytea, integer, integer, integer, integer, integer, integer, integer, integer)',
  'rate_limit_sign_in_succeeded(bytea, bytea, bytea, bytea, boolean, boolean, integer, uuid, bytea, boolean, integer)',
  'rate_limit_sign_in_not_checked(bytea, bytea, boolean)',
  'rate_limit_sign_in_reset(bytea, bytea, bytea, integer)',
  'rate_limit_forget_other_devices(bytea, bytea)',
  'rate_limit_trust_after_code(bytea, bytea, integer)',
  'member_sign_in_lock(uuid, integer)',
  'request_account_locked_mail(text, integer)',
  'request_mfa_code_locked_mail(uuid, integer)',
  'unlock_member_sign_in(uuid, integer)',
  // Invitation codes (FR-IAM-03, migration 20261018090000): inviting and resending issue a code, the
  // users list and "Copy code" read them, the worker's mailer reads the code it e-mails.
  'issue_invitation_code(uuid)',
  'invitation_codes(uuid[])',
  'invitation_code_for_mail(uuid)',
  // Platform Super Admin console (FR-ADM-17, migration 20261018100000): sign-in routing and the console.
  'is_platform_admin()',
  'platform_list_tenants()',
  'platform_create_tenant(text, text, text, text, text, text, text, text, text)',
  'platform_admin_invitation_code(uuid)',
  'platform_reissue_admin_code(uuid)',
] as const;

/**
 * Readiness probe for the request-path connection (ADR 0009 §6): one catalog query as `app_server` —
 * whether the required functions exist in schema `private` with their signatures (pg_catalog is readable
 * by every role; no function is called) — bounded by a timeout after which the query is cancelled (it must not stay queued
 * in the pool real traffic uses). Needs no table privileges and reads no tenant data. Never throws and
 * never returns details.
 */
export async function checkDatabase(
  options: { readonly timeoutMs?: number; readonly getDb?: () => AppDatabase } = {},
): Promise<DatabaseHealth> {
  if (!options.getDb && !isDatabaseConfigured('app_server')) return 'not-configured';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const db = (options.getDb ?? (() => getDatabase('app_server')))();
    const required = [...REQUIRED_DATABASE_FUNCTIONS];
    const query = db.$client<{ missing: number | string }[]>`
      select ${required.length}::int - count(distinct p.oid)::int as missing
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' = any(${required}::text[])`;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        void Promise.resolve()
          .then(() => {
            query.cancel();
          })
          .catch(() => undefined);
        reject(new Error('database health check timed out'));
      }, options.timeoutMs ?? 3000);
    });
    const rows = await Promise.race([query, timeout]);
    return Number(rows[0]?.missing ?? required.length) === 0 ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}
