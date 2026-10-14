import type { IconName } from '@jadarat/ui';
import { tmsNavigation } from '@jadarat/tms';
import type { SuiteNavigationAccess } from './suite-context';

/** Pages of the suite that have a navigation entry (`current` of the shell). */
export type SuitePage = 'home' | 'users' | 'roles' | 'security' | 'profile';

/** Message keys (namespace `shell`) of every navigation label and group heading. */
export type NavLabelKey =
  | 'home'
  | (typeof tmsNavigation)[number]['key']
  | 'organizationProfile'
  | 'branding'
  | 'customFields'
  | 'featuresPlan'
  | 'domains'
  | 'users'
  | 'roles'
  | 'securityPolicy'
  | 'auditLog'
  | 'consent'
  | 'emailSender'
  | 'lmsConnection'
  | 'hrSystem';

export type NavGroupKey =
  | 'main'
  | 'groupOrganization'
  | 'groupDomains'
  | 'groupPeople'
  | 'groupSecurity'
  | 'groupEmail'
  | 'groupIntegrations';

export interface NavEntry {
  readonly key: NavLabelKey;
  readonly icon: IconName;
  /** A page that exists: its locale-less path and the shell's `current` value. */
  readonly link?: { readonly href: string; readonly page: SuitePage };
}

export interface NavGroupModel {
  /** `main` has no heading; the others are message keys of their heading. */
  readonly key: NavGroupKey;
  readonly entries: readonly NavEntry[];
}

const TMS_ICONS: Readonly<Record<(typeof tmsNavigation)[number]['key'], IconName>> = {
  home: 'home',
  calendar: 'calendar',
  sessions: 'sessions',
  courses: 'courses',
};

const soon = (key: NavLabelKey, icon: IconName): NavEntry => ({ key, icon });

/**
 * The side navigation for one member (T-M2-21): which groups and entries, in order. Entries without a
 * `link` are shown as «قريبًا» / "Coming soon" (not focusable). Deny by default: a group appears only
 * with at least one entry the member's grants allow.
 *
 * Organization Admin (docs/delivery/roles/organization-admin.md, PO 14 Oct 2026, BRD v2.9): Home ·
 * Organization (profile, branding, custom fields, features & plan) · Domain management · People (users,
 * roles & permissions) · Security (security policy, audit log, consent) · E-mail sending (sender
 * settings) · Integrations (LMS connection, HR system) — no training entries and no notifications.
 * Other roles: Home and the training module's entries, then the pages their grants open.
 */
export function suiteNavigation(access: SuiteNavigationAccess): NavGroupModel[] {
  const main: NavEntry[] = tmsNavigation
    .filter((item) => item.key === 'home' || access.training)
    .map((item) =>
      item.key === 'home'
        ? { key: 'home', icon: 'home', link: { href: item.href, page: 'home' } }
        : soon(item.key, TMS_ICONS[item.key]),
    );
  const setup = access.organizationSetup;
  const groups: NavGroupModel[] = [
    { key: 'main', entries: main },
    {
      key: 'groupOrganization',
      entries: setup
        ? [
            soon('organizationProfile', 'building'),
            soon('branding', 'palette'),
            soon('customFields', 'fields'),
            soon('featuresPlan', 'plan'),
          ]
        : [],
    },
    { key: 'groupDomains', entries: setup ? [soon('domains', 'globe')] : [] },
    {
      key: 'groupPeople',
      entries: [
        ...(access.users
          ? [
              {
                key: 'users',
                icon: 'people',
                link: { href: '/suite/admin/users', page: 'users' },
              } as const,
            ]
          : []),
        ...(access.roles
          ? [
              {
                key: 'roles',
                icon: 'key',
                link: { href: '/suite/admin/roles', page: 'roles' },
              } as const,
            ]
          : []),
      ],
    },
    {
      key: 'groupSecurity',
      entries: [
        ...(access.security
          ? [
              {
                key: 'securityPolicy',
                icon: 'shield',
                link: { href: '/suite/admin/security', page: 'security' },
              } as const,
            ]
          : []),
        ...(setup ? [soon('auditLog', 'audit'), soon('consent', 'consent')] : []),
      ],
    },
    { key: 'groupEmail', entries: setup ? [soon('emailSender', 'mail')] : [] },
    {
      key: 'groupIntegrations',
      entries: setup ? [soon('lmsConnection', 'plug'), soon('hrSystem', 'sync')] : [],
    },
  ];
  return groups.filter((group) => group.entries.length > 0);
}

/**
 * The home page for the member (T-M2-21): the Organization Admin (organization set-up, no training
 * features) gets a set-up card with the pages that exist today until the admin home (FR-ADM-14) is
 * built; everyone else keeps the training home. Same source as the menu: the member's grants.
 */
export function suiteHome(
  access: SuiteNavigationAccess,
): { readonly kind: 'training' } | { readonly kind: 'setup'; readonly links: readonly NavEntry[] } {
  if (!access.organizationSetup) return { kind: 'training' };
  const links = suiteNavigation(access)
    .flatMap((group) => group.entries)
    .filter((entry) => entry.link !== undefined && entry.key !== 'home');
  return { kind: 'setup', links };
}
