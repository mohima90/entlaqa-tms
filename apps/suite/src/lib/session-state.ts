import 'server-only';
import { type TenantClaims, hasTenant } from '@jadarat/platform-core';
import { type CurrentTenant, getCurrentTenant, withUserTx } from '@jadarat/platform-db';
import { getVerifiedClaims } from '@jadarat/platform-identity/next';
import type { ConfigStatus } from './config-status';

/**
 * Where a page request stands (T-M1-D03). One decision for every page, so /sign-in, /select-organization
 * and /suite can never redirect to each other in a loop:
 *  - signed-out       no session, or a token the DATABASE no longer accepts (session revoked or timed
 *                     out, membership or organization suspended) — the token alone still looks valid
 *  - no-organization  a session without a selected organization (tenant claim)
 *  - organization     a session in an organization; `tenant` is null only when no database is configured
 */
export type SessionState =
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'no-organization' }
  | {
      readonly kind: 'organization';
      readonly claims: TenantClaims;
      readonly tenant: CurrentTenant | null;
    };

export interface SessionStateDeps {
  readonly getVerifiedClaims: typeof getVerifiedClaims;
  readonly withUserTx: typeof withUserTx;
  readonly getCurrentTenant: typeof getCurrentTenant;
}

const defaultDeps: SessionStateDeps = { getVerifiedClaims, withUserTx, getCurrentTenant };

export async function getSessionState(
  status: ConfigStatus,
  deps: SessionStateDeps = defaultDeps,
): Promise<SessionState> {
  if (!status.auth) return { kind: 'signed-out' };
  const claims = await deps.getVerifiedClaims();
  if (!claims.ok) return { kind: 'signed-out' };
  const verified = claims.value;
  if (!hasTenant(verified)) return { kind: 'no-organization' };
  if (!status.database) return { kind: 'organization', claims: verified, tenant: null };
  const tenant = await deps.withUserTx(verified, (tx) => deps.getCurrentTenant(tx));
  return tenant ? { kind: 'organization', claims: verified, tenant } : { kind: 'signed-out' };
}
