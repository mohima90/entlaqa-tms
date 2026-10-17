import 'server-only';
import { DEFAULT_TENANT_REGIONAL, type TenantRegional } from '@jadarat/platform-db';
import type { AppLocale } from '@jadarat/platform-i18n';
import {
  type Grant,
  coursePermissions,
  loadMemberGrants,
  platformPermissions,
  tmsPlanningPermissions,
  tmsRolePermissions as tmsPermissions,
} from '@jadarat/platform-rbac';
import { redirect } from 'next/navigation';
import { getConfigStatus } from './config-status';
import { myIdentityQuery } from './users-queries';
import { getSessionState, redirectFor } from './session-state';

/** What every suite page needs before rendering (T-M1-D03 gating + T-M2-04 navigation). */
export interface SuiteContext {
  /** Sign-in and database are configured: pages show real data; otherwise the data-less preview. */
  readonly live: boolean;
  readonly organizationName: string | null;
  /** Navigation entries the member may open (display only — every page authorizes itself). */
  readonly navigation: SuiteNavigationAccess;
  /**
   * The signed-in member's names and primary role code for the account menu ("Organization · Role";
   * null in the preview or when unknown).
   */
  readonly me: {
    /** Null for a member with an English name only (PO 17 Oct 2026). */
    readonly nameAr: string | null;
    readonly nameEn: string | null;
    /** The member's role (one per person, EP-ROLES), with a custom role's names; display only. */
    readonly primaryRole: {
      readonly code: string;
      readonly customName: { readonly ar: string; readonly en: string } | null;
    } | null;
  } | null;
  /** The organization's inactivity limit in minutes (T-M2-10): the page warns before it ends. */
  readonly idleMinutes: number | null;
  /**
   * How the organization shows dates (Gregorian / Hijri / both) and in which time zone, and the language
   * of new people (T-M2-22, organization profile). The defaults in the preview without data.
   */
  readonly regional: TenantRegional;
}

/** Which navigation entries the member's grants open (deny by default: everything starts false). */
export interface SuiteNavigationAccess {
  /** Users list: members who see more than themselves. */
  readonly users: boolean;
  /** Roles & permissions (T-M2-05). */
  readonly roles: boolean;
  /** Security policy (T-M2-10). */
  readonly security: boolean;
  /**
   * Organization profile (T-M2-22): members who read the organization's settings organization-wide —
   * the Organization Admin (edits) and the Auditor (reads; PO decision 14 Oct 2026).
   */
  readonly organizationProfile: boolean;
  /**
   * Organization → Structure and Branches (T-M3-02, EP-ORG): the member who maintains them
   * (`platform.org.manage` organization-wide — the HR Manager). Others who read the structure open the pages
   * by their address (view only); the menu entry follows the business flow's owner.
   */
  readonly structure: boolean;
  /**
   * The Organization Admin's own sections still to come (organization profile, branding, custom
   * fields, features & plan, domains, audit log, consent, e-mail sender, integrations), shown as
   * «قريبًا» / "Coming soon" (docs/delivery/roles/organization-admin.md, BRD v2.9).
   */
  readonly organizationSetup: boolean;
  /** The training module's entries (Calendar, Sessions, Courses). Never for the Organization Admin. */
  readonly training: boolean;
  /** The course library (T-M3-03): members who read it organization-wide (tms.course.read). */
  readonly courses: boolean;
  /** Planning cycles and planning settings (EP-PLN, T-M3-04): organization-wide tms.plan_cycle.read. */
  readonly planning: boolean;
  /** Planning → Needs forms (T-M3-10): members who read the needs forms organization-wide. */
  readonly needsForms: boolean;
}

/**
 * Navigation from the member's permissions (T-M2-04; menus per role T-M2-21). Display only: every page
 * authorizes itself on the server. Users appear for members who see more than themselves (Organization
 * Admin, HR, department heads, line managers…); a learner can still open their own entry from the list
 * URL. Organization-wide `platform.tenant.manage` is held by the Organization Admin alone, and that
 * role is held alone and has no training features (BR-IAM-4, BRD Appendix B): such a member gets the
 * organization set-up sections and no training entries.
 */
export function navigationFor(grants: readonly Grant[] | null): SuiteNavigationAccess {
  // Preview without data (local development, CI): every entry, so every pattern renders.
  if (grants === null) {
    return {
      users: true,
      roles: true,
      security: true,
      organizationProfile: true,
      structure: true,
      organizationSetup: true,
      training: true,
      courses: true,
      planning: true,
      needsForms: true,
    };
  }
  const tenantWide = (code: string) =>
    grants.some((g) => g.permission === code && g.scope.type === 'tenant');
  const read = platformPermissions['platform.user.read'].code;
  const organizationSetup = tenantWide(platformPermissions['platform.tenant.manage'].code);
  return {
    users: grants.some((g) => g.permission === read && g.scope.type !== 'own'),
    // Roles & permissions (T-M2-05): members who read the roles of the whole organization.
    roles: tenantWide(platformPermissions['platform.role.read'].code),
    // Security settings (T-M2-10): members who read the organization's settings.
    security: tenantWide(platformPermissions['platform.tenant.read'].code),
    organizationProfile: tenantWide(platformPermissions['platform.tenant.read'].code),
    structure: tenantWide(platformPermissions['platform.org.manage'].code),
    organizationSetup,
    training: !organizationSetup,
    courses: tenantWide(coursePermissions['tms.course.read'].code),
    planning: tenantWide(tmsPlanningPermissions['tms.plan_cycle.read'].code),
    needsForms: !organizationSetup && tenantWide(tmsPermissions['tms.needs_form.read'].code),
  };
}

/** Fails closed: no session → sign-in; no organization → organization chooser. */
export async function getSuiteContext(locale: AppLocale): Promise<SuiteContext> {
  const status = getConfigStatus();
  if (!status.auth) {
    return {
      live: false,
      organizationName: null,
      navigation: navigationFor(null),
      me: null,
      idleMinutes: null,
      regional: DEFAULT_TENANT_REGIONAL,
    };
  }
  const session = await getSessionState(status);
  const elsewhere = redirectFor(locale, session, 'suite');
  if (elsewhere !== null || session.kind !== 'organization')
    redirect(elsewhere ?? `/${locale}/sign-in`);
  const { tenant } = session;
  // The display name in the UI language, else the other one (T-M2-22: the profile page sets both).
  const organizationName = tenant
    ? locale === 'en'
      ? (tenant.nameEn ?? tenant.nameAr)
      : tenant.nameAr || (tenant.nameEn ?? '')
    : null;
  const regional = tenant?.regional ?? DEFAULT_TENANT_REGIONAL;
  if (!status.database) {
    return {
      live: false,
      organizationName,
      navigation: navigationFor(null),
      me: null,
      idleMinutes: null,
      regional,
    };
  }
  const grants = await loadMemberGrants();
  const identity = await myIdentityQuery({});
  return {
    live: true,
    organizationName,
    navigation: navigationFor(grants.ok ? grants.value : []),
    me: identity.ok
      ? {
          nameAr: identity.value.displayNameAr,
          nameEn: identity.value.displayNameEn,
          primaryRole: identity.value.primaryRole,
        }
      : null,
    idleMinutes: tenant?.sessionIdleMinutes ?? null,
    regional,
  };
}
