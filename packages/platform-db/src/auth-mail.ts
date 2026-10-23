import { sql } from 'drizzle-orm';
import { type ClaimsTx, runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';
import { type EmailRouteRow, type EmailRouteSqlRow, toEmailRouteRow } from './email-route';

/**
 * What the Send Email hook (a web route, WP-ADM-05) reads and writes through the database as `app_server`,
 * without a session: Supabase Auth calls the hook, the route verifies Auth's signature, then asks who the
 * e-mail goes to and through which sender, sends it at once and audits it. Every function checks the login
 * role itself (migration 20261026100200). No code and no address is ever written here.
 */

/** The account Auth is e-mailing: the organization whose look and language the e-mail uses. */
export interface AuthMailAccount {
  /** The address as Auth stores it. */
  readonly email: string;
  readonly tenantId: string;
  readonly personId: string;
  readonly locale: 'ar' | 'en';
  /**
   * The platform sender only: the person belongs to several organizations or holds a platform role, so no
   * organization's own mail server may see what opens the account (security review M1).
   */
  readonly platformSender: boolean;
}

/** The sender rule's inputs for one organization and its look (e-mail colours and logo). */
export interface AuthMailRoute {
  readonly route: EmailRouteRow;
  readonly brand: {
    readonly actionColor: string | null;
    readonly linkColor: string | null;
    readonly logoAssetId: string | null;
  } | null;
}

export interface AuthMailApi {
  /** Null: no account, a banned one, or no usable membership - nothing is sent. */
  account(userId: string): Promise<AuthMailAccount | null>;
  /** Null: the organization is not served. */
  route(tenantId: string): Promise<AuthMailRoute | null>;
  /** «Sign-in code sent» in the organization's audit trail (no code, no address). */
  auditSent(userId: string, tenantId: string): Promise<void>;
  /** A refused code (BR-AUTH-i); nothing for an address without an account. */
  auditRefused(email: string, killed: boolean): Promise<void>;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Over a database connected as `app_server`, in a transaction WITHOUT claims (as the account e-mail requests). */
export function createAuthMailApi(getDb: () => AppDatabase): AuthMailApi {
  const withoutClaims = <T>(fn: (tx: ClaimsTx) => Promise<T>) => runWithClaims(getDb(), '', fn);
  return {
    async account(userId) {
      if (!UUID.test(userId)) return null;
      const [row] = await withoutClaims((tx) =>
        tx.execute<{
          email: string;
          tenant_id: string;
          person_id: string;
          locale: string;
          platform_sender: boolean | null;
        }>(sql`select * from private.auth_mail_account(${userId}::uuid)`),
      );
      if (!row) return null;
      return {
        email: row.email,
        tenantId: row.tenant_id,
        personId: row.person_id,
        locale: row.locale === 'en' ? 'en' : 'ar',
        // Anything but a clear "no" is the safe answer.
        platformSender: row.platform_sender !== false,
      };
    },
    async route(tenantId) {
      if (!UUID.test(tenantId)) return null;
      const [row] = await withoutClaims((tx) =>
        tx.execute<
          EmailRouteSqlRow &
            Record<string, unknown> & {
              action_color: string | null;
              link_color: string | null;
              logo_asset_id: string | null;
            }
        >(sql`select * from private.auth_mail_route(${tenantId}::uuid)`),
      );
      if (!row) return null;
      const colors =
        row.action_color !== null &&
        row.link_color !== null &&
        HEX.test(row.action_color) &&
        HEX.test(row.link_color);
      return {
        route: toEmailRouteRow(row),
        brand:
          colors || row.logo_asset_id
            ? {
                actionColor: colors ? row.action_color : null,
                linkColor: colors ? row.link_color : null,
                logoAssetId: row.logo_asset_id,
              }
            : null,
      };
    },
    async auditSent(userId, tenantId) {
      if (!UUID.test(userId) || !UUID.test(tenantId)) return;
      await withoutClaims((tx) =>
        tx.execute(sql`select private.audit_sign_in_code_sent(${userId}::uuid, ${tenantId}::uuid)`),
      );
    },
    async auditRefused(email, killed) {
      await withoutClaims((tx) =>
        tx.execute(sql`select private.audit_sign_in_code_refused(${email}, ${killed})`),
      );
    },
  };
}

/** The default API over the web app's `app_server` connection. */
export const authMailApi = createAuthMailApi(() => getDatabase('app_server'));
