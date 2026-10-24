import 'server-only';
import { type TenantClaims, hasTenant } from '@jadarat/platform-core';
import {
  type CurrentTenant,
  type TenantBrand,
  type PlanFeature,
  getCurrentTenant,
  getOrganizationFeatures,
  getSessionAccess,
  getTenantBrand,
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
 *  - paused           the organization is suspended and the session is its Organization Admin's (WP-ADM-06):
 *                     the plan page only (/paused); everyone else of a suspended organization is signed out
 *  - organization     a session in an organization; `tenant` is null only when no database is configured
 */
export type SessionState =
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'session-ended' }
  | { readonly kind: 'mfa-required' }
  | { readonly kind: 'no-organization' }
  | { readonly kind: 'paused'; readonly claims: TenantClaims }
  | {
      readonly kind: 'organization';
      readonly claims: TenantClaims;
      readonly tenant: CurrentTenant | null;
      /**
       * The organization's look (WP-ADM-02), read in the same transaction as the tenant; absent without a
       * database (the Jadarat look).
       */
      readonly brand?: TenantBrand;
      /**
       * The features the organization's plan includes (WP-ADM-06), read in the same transaction; absent
       * without a database (every feature).
       */
      readonly features?: readonly PlanFeature[];
    };

export interface SessionStateDeps {
  readonly getVerifiedClaims: typeof getVerifiedClaims;
  readonly withUserTx: typeof withUserTx;
  readonly getCurrentTenant: typeof getCurrentTenant;
  readonly getSessionAccess: typeof getSessionAccess;
  /** The organization's look (WP-ADM-02); without it, none is read. */
  readonly getTenantBrand?: typeof getTenantBrand;
  /** The plan's features (WP-ADM-06); without it, none are read (every feature). */
  readonly getOrganizationFeatures?: typeof getOrganizationFeatures;
}

const defaultDeps: SessionStateDeps = {
  getVerifiedClaims,
  withUserTx,
  getCurrentTenant,
  getSessionAccess,
  getTenantBrand,
  getOrganizationFeatures,
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
  const readBrand = deps.getTenantBrand;
  const readFeatures = deps.getOrganizationFeatures;
  const { tenant, brand, features } = await deps.withUserTx(verified, async (tx) => {
    const current = await deps.getCurrentTenant(tx);
    const included = current && readFeatures ? await readFeatures(tx) : null;
    return {
      tenant: current,
      // Own branding only while the plan includes it (WP-ADM-06): otherwise the Jadarat look.
      brand:
        current && readBrand && (included === null || included.includes('branding'))
          ? await readBrand(tx)
          : null,
      features: included,
    };
  });
  if (tenant) {
    return {
      kind: 'organization',
      claims: verified,
      tenant,
      ...(brand ? { brand } : {}),
      ...(features ? { features } : {}),
    };
  }
  // Refused: ask the database why (only on this path, so every other request stays one read).
  const access = await deps.withUserTx(verified, (tx) => deps.getSessionAccess(tx));
  switch (access.state) {
    case 'ended':
      return { kind: 'session-ended' };
    case 'mfa_challenge':
    case 'mfa_enrol':
      return { kind: 'mfa-required' };
    case 'paused':
      return { kind: 'paused', claims: verified };
    default:
      return { kind: 'signed-out' };
  }
}

/** Where a page sends a session it cannot serve (null: the page goes on). */
export function redirectFor(
  locale: string,
  state: SessionState,
  page: 'suite' | 'sign-in' | 'select-organization' | 'mfa' | 'paused',
): string | null {
  switch (state.kind) {
    case 'paused':
      return page === 'paused' ? null : `/${locale}/paused`;
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
