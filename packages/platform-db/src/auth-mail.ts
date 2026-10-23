import { sql } from 'drizzle-orm';
import { type ClaimsTx, runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';
import { type EmailRouteRow, type EmailRouteSqlRow, toEmailRouteRow } from './email-route';

/**
 * What the Send Email hook (a web route, WP-ADM-05) and the code check read and write through the database as
 * `app_server`, without a session: Supabase Auth calls the hook, the route verifies Auth's signature, stores
 * its own sign-in code (a keyed hash plus Auth's sealed token hash) and learns whom to e-mail and through
 * which sender in ONE call, sends at once and audits; the typed code is compared here (5 wrong tries remove
 * it). Every function checks the login role itself (migration 20261026100200). The code is passed to the
 * database to be hashed there and never kept in clear.
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

/** What the hook needs to send the code: the account, the sender rule's inputs and the look. */
export interface IssuedSignInCode {
  readonly account: AuthMailAccount;
  readonly route: AuthMailRoute;
}

/** The answer to a typed code: see private.verify_sign_in_code. */
export type VerifiedSignInCode =
  /** Right: the sealed Auth token hash (released once) and the Auth type to redeem it with. */
  | {
      readonly outcome: 'ok';
      readonly userId: string;
      readonly sealedTokenHash: string;
      readonly actionType: 'magiclink';
    }
  /** Wrong (a try counted), the 5th wrong try (the code is gone), or no live code. */
  | { readonly outcome: 'wrong' | 'killed' | 'none' };

export interface AuthMailApi {
  /**
   * Stores OUR sign-in code for the account (replacing its earlier one) and returns whom to e-mail, through
   * which sender and in which look - in one database call (the sender settings are reachable only this way).
   * Null: no account, a banned one, no usable membership or an unserved organization - nothing is stored.
   */
  issue(input: {
    readonly userId: string;
    readonly code: string;
    /** Auth's `token_hash`, already encrypted by the caller: the database cannot read it. */
    readonly sealedTokenHash: string;
    readonly actionType: 'magiclink';
  }): Promise<IssuedSignInCode | null>;
  /** Compares a typed code (the 5th wrong try removes it); a right one is released once. */
  verifyCode(email: string, code: string): Promise<VerifiedSignInCode>;
  /** «Sign-in code sent» in the organization's audit trail (no code, no address). */
  auditSent(userId: string, tenantId: string): Promise<void>;
  /** A refused code (BR-AUTH-i); nothing for an address without an account. */
  auditRefused(email: string, killed: boolean): Promise<void>;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type IssueSqlRow = EmailRouteSqlRow &
  Record<string, unknown> & {
    email: string;
    tenant_id: string;
    person_id: string;
    locale: string;
    platform_sender: boolean | null;
    action_color: string | null;
    link_color: string | null;
    logo_asset_id: string | null;
  };

/** Over a database connected as `app_server`, in a transaction WITHOUT claims (as the account e-mail requests). */
export function createAuthMailApi(getDb: () => AppDatabase): AuthMailApi {
  const withoutClaims = <T>(fn: (tx: ClaimsTx) => Promise<T>) => runWithClaims(getDb(), '', fn);
  return {
    async issue({ userId, code, sealedTokenHash, actionType }) {
      if (!UUID.test(userId)) return null;
      const [row] = await withoutClaims((tx) =>
        tx.execute<IssueSqlRow>(
          sql`select * from private.auth_mail_issue(${userId}::uuid, ${code}, ${sealedTokenHash}, ${actionType})`,
        ),
      );
      if (!row) return null;
      const colors =
        row.action_color !== null &&
        row.link_color !== null &&
        HEX.test(row.action_color) &&
        HEX.test(row.link_color);
      return {
        account: {
          email: row.email,
          tenantId: row.tenant_id,
          personId: row.person_id,
          locale: row.locale === 'en' ? 'en' : 'ar',
          // Anything but a clear "no" is the safe answer.
          platformSender: row.platform_sender !== false,
        },
        route: {
          route: toEmailRouteRow(row),
          brand:
            colors || row.logo_asset_id
              ? {
                  actionColor: colors ? row.action_color : null,
                  linkColor: colors ? row.link_color : null,
                  logoAssetId: row.logo_asset_id,
                }
              : null,
        },
      };
    },
    async verifyCode(email, code) {
      const [row] = await withoutClaims((tx) =>
        tx.execute<{
          outcome: string;
          user_id: string | null;
          token_hash_sealed: string | null;
          action_type: string | null;
        }>(sql`select * from private.verify_sign_in_code(${email}, ${code})`),
      );
      if (!row) return { outcome: 'none' };
      if (
        row.outcome === 'ok' &&
        row.user_id !== null &&
        row.token_hash_sealed !== null &&
        row.action_type === 'magiclink'
      ) {
        return {
          outcome: 'ok',
          userId: row.user_id,
          sealedTokenHash: row.token_hash_sealed,
          actionType: 'magiclink',
        };
      }
      // Anything unexpected is a refusal, never a way in.
      return {
        outcome: row.outcome === 'wrong' || row.outcome === 'killed' ? row.outcome : 'none',
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
