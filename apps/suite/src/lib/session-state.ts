import 'server-only';
import { type TenantClaims, hasTenant } from '@jadarat/platform-core';
import {
  type CurrentTenant,
  getCurrentTenant,
  getSessionAccess,
  withUserTx,
} from '@jadarat/platform-db';
import { getVerifiedClaims } from '@jadarat/platform-identity/next';
import type { ConfigStatus } from './config-status';

/**
 * Where a page request stands (T-M1-D03, T-M2-10). One decision for every page, so /sign-in,
 * /select-organization, /mfa and /suite can never redirect to each other in a loop:
 *  - signed-out       no session, or a token the DATABASE does not accept (membership or organization
 *                     suspended, another session's claims) — the token alone still looks valid
 *  - session-ended    the organization's session rules ended it (inactivity, maximum length, device
 *                     limit) or it was signed out from another device / by a user manager: the sign-in
 *                     page says why and signs it out at Auth (signOutEndedSessionAction)
 *  - mfa-required     the organization's MFA policy wants an authenticator code first (challenge) or
 *                     an app set up (enrolment) — the /mfa page
 *  - no-organization  a session without a selected organization (tenant claim)
 *  - organization     a session in an organization; `tenant` is null only when no database is configured
 */
export type SessionState =
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'session-ended' }
  | { readonly kind: 'mfa-required' }
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
  readonly getSessionAccess: typeof getSessionAccess;
}

const defaultDeps: SessionStateDeps = {
  getVerifiedClaims,
  withUserTx,
  getCurrentTenant,
  getSessionAccess,
};

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
  if (tenant) return { kind: 'organization', claims: verified, tenant };
  // Refused: ask the database why (only on this path, so every other request stays one read).
  const access = await deps.withUserTx(verified, (tx) => deps.getSessionAccess(tx));
  switch (access.state) {
    case 'ended':
      return { kind: 'session-ended' };
    case 'mfa_challenge':
    case 'mfa_enrol':
      return { kind: 'mfa-required' };
    default:
      return { kind: 'signed-out' };
  }
}

/** Where a page sends a session it cannot serve (null: the page goes on). */
export function redirectFor(
  locale: string,
  state: SessionState,
  page: 'suite' | 'sign-in' | 'select-organization' | 'mfa',
): string | null {
  switch (state.kind) {
    case 'session-ended':
      // The sign-in page says why and signs the session out at Auth (a POST server action, never a GET).
      return page === 'sign-in' ? null : `/${locale}/sign-in?notice=session-ended`;
    case 'mfa-required':
      return page === 'mfa' ? null : `/${locale}/mfa`;
    case 'signed-out':
      return page === 'sign-in' ? null : `/${locale}/sign-in`;
    case 'no-organization':
      return page === 'select-organization' ? null : `/${locale}/select-organization`;
    case 'organization':
      return page === 'suite' || page === 'mfa' ? null : `/${locale}/suite`;
  }
}
