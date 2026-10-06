import 'server-only';
import type { AppLocale } from '@jadarat/platform-i18n';
import { type Grant, loadMemberGrants, platformPermissions } from '@jadarat/platform-rbac';
import { redirect } from 'next/navigation';
import { getConfigStatus } from './config-status';
import { myIdentityQuery } from './users-queries';
import { getSessionState } from './session-state';

/** What every suite page needs before rendering (T-M1-D03 gating + T-M2-04 navigation). */
export interface SuiteContext {
  /** Sign-in and database are configured: pages show real data; otherwise the data-less preview. */
  readonly live: boolean;
  readonly organizationName: string | null;
  /** Navigation entries the member may open (display only — every page authorizes itself). */
  readonly navigation: { readonly users: boolean; readonly roles: boolean };
  /** The signed-in member's names for the header picture (null in the preview or when unknown). */
  readonly me: { readonly nameAr: string; readonly nameEn: string | null } | null;
}

/**
 * Users appear in the navigation for members who see more than themselves (Organization Admin, HR,
 * department heads, line managers…). A learner can still open their own entry from the list URL.
 */
export function navigationFor(grants: readonly Grant[] | null): SuiteContext['navigation'] {
  if (grants === null) return { users: true, roles: true }; // preview: every entry, without data
  const read = platformPermissions['platform.user.read'].code;
  const roles = platformPermissions['platform.role.read'].code;
  return {
    users: grants.some((g) => g.permission === read && g.scope.type !== 'own'),
    // Roles & permissions (T-M2-05): members who read the roles of the whole organization.
    roles: grants.some((g) => g.permission === roles && g.scope.type === 'tenant'),
  };
}

/** Fails closed: no session → sign-in; no organization → organization chooser. */
export async function getSuiteContext(locale: AppLocale): Promise<SuiteContext> {
  const status = getConfigStatus();
  if (!status.auth) {
    return { live: false, organizationName: null, navigation: navigationFor(null), me: null };
  }
  const session = await getSessionState(status);
  if (session.kind === 'signed-out') redirect(`/${locale}/sign-in`);
  if (session.kind === 'no-organization') redirect(`/${locale}/select-organization`);
  const { tenant } = session;
  const organizationName = tenant
    ? locale === 'en'
      ? (tenant.nameEn ?? tenant.nameAr)
      : tenant.nameAr
    : null;
  if (!status.database) {
    return { live: false, organizationName, navigation: navigationFor(null), me: null };
  }
  const grants = await loadMemberGrants();
  const identity = await myIdentityQuery({});
  return {
    live: true,
    organizationName,
    navigation: navigationFor(grants.ok ? grants.value : []),
    me: identity.ok
      ? { nameAr: identity.value.displayNameAr, nameEn: identity.value.displayNameEn }
      : null,
  };
}
