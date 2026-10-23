import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type ClaimsTx, runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';
import type { UserTx } from './with-user-tx';

/**
 * Sign in with an e-mailed code, request path (WP-ADM-05, FR-IAM-12; migrations 20261026100100–100200).
 * The web app only ADDS requests and checks codes; the worker decides whether an account exists, mints the
 * one-time Auth token (the Auth secret key never reaches the web app, ADR 0002 §7), generates the code and
 * e-mails it. What the database answers is the same for every address: nothing here reveals an account.
 */

/** The outcome of a request: `queued` (a code is on its way — for any address), `remembered`, `too_soon`. */
export type SignInCodeRequest =
  | { readonly outcome: 'queued' | 'remembered'; readonly requestId: string }
  /** A code was requested for this address less than a minute ago: no new request, wait this many seconds. */
  | { readonly outcome: 'too_soon'; readonly retryAfterSeconds: number };

/** The outcome of checking a code. `ok` carries the one-time Auth token (handed out once). */
export type SignInCodeCheck =
  | { readonly outcome: 'ok'; readonly linkToken: string }
  | { readonly outcome: 'wrong' }
  | { readonly outcome: 'locked' }
  | { readonly outcome: 'expired' };

/** The outcome of taking a remembered browser's token. */
export type RememberedSignInTake =
  | { readonly outcome: 'ok'; readonly linkToken: string }
  | { readonly outcome: 'pending' }
  | { readonly outcome: 'gone' };

export interface SignInCodeApi {
  /**
   * «Email me a code» (app_server, no session, no claims). `rememberHash`: SHA-256 of the browser's
   * remembered-browser token, when it presented one. Malformed addresses and a full queue answer like any
   * other request (nothing stored).
   */
  request(email: string, rememberHash?: Uint8Array | null): Promise<SignInCodeRequest>;
  /** Checks a code of a request: wrong tries are counted by the database (5 kill the code). */
  verify(requestId: string, email: string, code: string): Promise<SignInCodeCheck>;
  /** A remembered browser takes its minted sign-in token (once). */
  takeRemembered(
    requestId: string,
    email: string,
    rememberHash: Uint8Array,
  ): Promise<RememberedSignInTake>;
}

const RequestId = z.uuid();
const Code = z.string().regex(/^[0-9]{6}$/);

const hex = (bytes: Uint8Array) => `\\x${Buffer.from(bytes).toString('hex')}`;

/** Over a database connected as `app_server`, in a transaction WITHOUT claims (as the account e-mail requests). */
export function createSignInCodeApi(getDb: () => AppDatabase): SignInCodeApi {
  const withoutClaims = <T>(fn: (tx: ClaimsTx) => Promise<T>) => runWithClaims(getDb(), '', fn);
  return {
    async request(email, rememberHash = null) {
      if (rememberHash && rememberHash.length !== 32) {
        throw new Error('requestSignInCode: the remembered-browser hash must be 32 bytes');
      }
      const hash = rememberHash ? sql`${hex(rememberHash)}::bytea` : sql`null::bytea`;
      const [row] = await withoutClaims((tx) =>
        tx.execute<{ request_id: string | null; outcome: string; retry_after: number }>(
          sql`select * from private.request_sign_in_code(${email}, ${hash})`,
        ),
      );
      if (row?.outcome === 'too_soon') {
        return {
          outcome: 'too_soon',
          retryAfterSeconds: Math.min(Math.max(row.retry_after, 1), 60),
        };
      }
      if (!row?.request_id || (row.outcome !== 'queued' && row.outcome !== 'remembered')) {
        throw new Error('requestSignInCode: unexpected answer');
      }
      return { outcome: row.outcome, requestId: row.request_id };
    },
    async verify(requestId, email, code) {
      if (!RequestId.safeParse(requestId).success) return { outcome: 'expired' };
      if (!Code.safeParse(code).success) throw new Error('verifySignInCode: not a six-digit code');
      const [row] = await withoutClaims((tx) =>
        tx.execute<{ outcome: string; link_token: string | null }>(
          sql`select * from private.verify_sign_in_code(${requestId}::uuid, ${email}, ${code})`,
        ),
      );
      if (row?.outcome === 'ok' && row.link_token)
        return { outcome: 'ok', linkToken: row.link_token };
      if (row?.outcome === 'wrong' || row?.outcome === 'locked') return { outcome: row.outcome };
      return { outcome: 'expired' };
    },
    async takeRemembered(requestId, email, rememberHash) {
      if (!RequestId.safeParse(requestId).success || rememberHash.length !== 32) {
        return { outcome: 'gone' };
      }
      const [row] = await withoutClaims((tx) =>
        tx.execute<{ outcome: string; link_token: string | null }>(
          sql`select * from private.take_remembered_sign_in(${requestId}::uuid, ${email}, ${hex(rememberHash)}::bytea)`,
        ),
      );
      if (row?.outcome === 'ok' && row.link_token)
        return { outcome: 'ok', linkToken: row.link_token };
      return { outcome: row?.outcome === 'pending' ? 'pending' : 'gone' };
    },
  };
}

const defaultApi = createSignInCodeApi(() => getDatabase('app_server'));

export const requestSignInCode = (email: string, rememberHash?: Uint8Array | null) =>
  defaultApi.request(email, rememberHash);
export const verifySignInCode = (requestId: string, email: string, code: string) =>
  defaultApi.verify(requestId, email, code);
export const takeRememberedSignIn = (requestId: string, email: string, rememberHash: Uint8Array) =>
  defaultApi.takeRemembered(requestId, email, rememberHash);

// ---------------------------------------------------------------------------------------------------
// Remembered browsers (migration 20261026100100): the signed-in user's own
// ---------------------------------------------------------------------------------------------------

/** One remembered browser of the signed-in member in the session's organization (never the token). */
export interface RememberedBrowser {
  readonly id: string;
  readonly label: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  /** The earlier of its own date and creation + the organization's CURRENT days; null: no longer valid. */
  readonly validUntil: Date | null;
  /** Hash of its token equals the one presented (this browser). */
  readonly current: boolean;
}

/**
 * Remembers the browser in every organization of the signed-in account, for each organization's days -
 * none when any organization has the setting Off (the strictest wins). `claims` may have no organization
 * yet (right after a code sign-in). Returns how many organizations now remember it.
 */
export async function rememberBrowser(
  tx: UserTx,
  tokenHash: Uint8Array,
  label: string | null,
): Promise<number> {
  if (tokenHash.length !== 32) throw new Error('rememberBrowser: the token hash must be 32 bytes');
  const [row] = await tx.execute<{ count: number }>(
    sql`select private.remember_browser(${hex(tokenHash)}::bytea, ${label}) as count`,
  );
  return row?.count ?? 0;
}

/** The member's own remembered browsers in the session's organization (RLS: own rows only). */
export async function listMyRememberedBrowsers(
  tx: UserTx,
  currentTokenHash: Uint8Array | null,
): Promise<readonly RememberedBrowser[]> {
  const current = currentTokenHash
    ? sql`exists (select 1 from platform.remembered_browsers x where x.tenant_id = r.tenant_id and x.id = r.id
                  and x.token_hash = ${hex(currentTokenHash)}::bytea)`
    : sql`false`;
  const rows = await tx.execute<{
    id: string;
    label: string | null;
    created_at: string | Date;
    last_used_at: string | Date | null;
    valid_until: string | Date | null;
    is_current: boolean;
  }>(sql`
    select r.id, r.label, r.created_at, r.last_used_at,
           case when p.remembered_browser_days > 0
                then least(r.expires_at, r.created_at + make_interval(days => p.remembered_browser_days)) end as valid_until,
           ${current} as is_current
    from platform.remembered_browsers r
    left join platform.security_policies p on p.tenant_id = r.tenant_id
    where r.tenant_id = (select private.current_tenant_id())
    order by r.created_at desc`);
  return rows.map((row) => {
    const until = row.valid_until ? new Date(row.valid_until) : null;
    return {
      id: row.id,
      label: row.label,
      createdAt: new Date(row.created_at),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
      validUntil: until && until.getTime() > Date.now() ? until : null,
      current: row.is_current,
    };
  });
}

/** The member forgets their own remembered browsers in the session's organization (RLS). Returns how many. */
export async function forgetMyRememberedBrowsers(tx: UserTx): Promise<number> {
  const rows = await tx.execute<{ id: string }>(
    sql`delete from platform.remembered_browsers where user_id = (select private.request_user_id()) returning id`,
  );
  return rows.length;
}

/** An Organization Admin / user manager forgets a member's remembered browsers (the permission of «End sessions»). */
export async function forgetMemberRememberedBrowsers(
  tx: UserTx,
  personId: string,
): Promise<number> {
  const [row] = await tx.execute<{ count: number }>(
    sql`select private.forget_member_remembered_browsers(${personId}::uuid) as count`,
  );
  return row?.count ?? 0;
}
