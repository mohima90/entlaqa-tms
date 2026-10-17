import type { CommandPaletteItem, IconName } from '@jadarat/ui';
import { tmsNavigation } from '@jadarat/tms';
import type { SuiteNavigationAccess } from './suite-context';

/** Pages of the suite that have a navigation entry (`current` of the shell). */
export type SuitePage =
  | 'home'
  | 'courses'
  | 'general'
  | 'users'
  | 'structure'
  | 'branches'
  | 'roles'
  | 'security'
  | 'profile';

/** Message keys (namespace `shell`) of every navigation label. */
export type NavLabelKey =
  | 'home'
  | (typeof tmsNavigation)[number]['key']
  | 'teamMembers'
  | 'structure'
  | 'branches'
  | 'branding'
  | 'roles'
  | 'subscription'
  | 'general'
  | 'emailIntegration'
  | 'integrations'
  | 'security'
  | 'auditLog';

/** Message keys (namespace `shell`) of the group headings; `main` has none. */
export type NavGroupKey = 'main' | 'groupOrganization' | 'groupBilling' | 'groupSettings';

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

/** Paths of the built pages (locale-less). Settings → General replaced «Organization profile». */
export const SUITE_PATHS = {
  home: '/suite',
  courses: '/suite/courses',
  users: '/suite/admin/users',
  structure: '/suite/admin/structure',
  branches: '/suite/admin/branches',
  roles: '/suite/admin/roles',
  general: '/suite/admin/settings',
  security: '/suite/admin/security',
  profile: '/suite/profile',
} as const satisfies Record<SuitePage, string>;

/** The page title in the top bar (message key, namespace `shell`) for each page of the menu. */
export const PAGE_TITLE_KEYS = {
  home: 'home',
  courses: 'courses',
  users: 'teamMembers',
  structure: 'structure',
  branches: 'branches',
  roles: 'roles',
  general: 'general',
  security: 'security',
  profile: 'myProfile',
} as const satisfies Record<SuitePage, string>;

const TMS_ICONS: Readonly<Record<(typeof tmsNavigation)[number]['key'], IconName>> = {
  home: 'home',
  calendar: 'calendar',
  sessions: 'sessions',
  courses: 'courses',
};

const soon = (key: NavLabelKey, icon: IconName): NavEntry => ({ key, icon });
const page = (key: NavLabelKey, icon: IconName, target: SuitePage): NavEntry => ({
  key,
  icon,
  link: { href: SUITE_PATHS[target], page: target },
});
const when = (allowed: boolean, ...entries: NavEntry[]): NavEntry[] => (allowed ? entries : []);

/**
 * The side navigation for one member, in the Kawadir layout (T-M2-43; docs/design/kawadir-alignment.md
 * §5): which groups and entries, in order. Entries without a `link` are shown as «قريبًا» / "Coming
 * soon" (not links, not focusable). Deny by default: a group appears only with at least one entry the
 * member's grants allow.
 *
 * Organization Admin (PO, 15–16 Oct 2026): Home · Organization (Team members, Branding*, Roles &
 * permissions) · Billing (Subscription*) · Settings (General, Email integration*, Integrations*,
 * Security, Audit log*) — no training entries (BR-IAM-4). Other roles: Home and the training module's
 * entries, then the built pages their grants open, in the same groups.
 */
export function suiteNavigation(access: SuiteNavigationAccess): NavGroupModel[] {
  // The course library is a page since T-M3-03 (holders of tms.course.read); the other training entries are
  // still «Coming soon».
  const main: NavEntry[] = tmsNavigation
    .filter(
      (item) =>
        item.key === 'home' || access.training || (item.key === 'courses' && access.courses),
    )
    .map((item) => {
      if (item.key === 'home') return page('home', 'home', 'home');
      if (item.key === 'courses' && access.courses) return page('courses', 'courses', 'courses');
      return soon(item.key, TMS_ICONS[item.key]);
    });
  const setup = access.organizationSetup;
  const groups: NavGroupModel[] = [
    { key: 'main', entries: main },
    {
      key: 'groupOrganization',
      entries: [
        ...when(access.users, page('teamMembers', 'people', 'users')),
        // Organization → Structure and Branches (T-M3-02, EP-ORG): the HR Manager's pages.
        ...when(
          access.structure,
          page('structure', 'structure', 'structure'),
          page('branches', 'building', 'branches'),
        ),
        ...when(setup, soon('branding', 'palette')),
        ...when(access.roles, page('roles', 'key', 'roles')),
      ],
    },
    { key: 'groupBilling', entries: when(setup, soon('subscription', 'billing')) },
    {
      key: 'groupSettings',
      entries: [
        // Settings → General (T-M2-22 organization profile): the Organization Admin edits it, the
        // Auditor reads it.
        ...when(access.organizationProfile || setup, page('general', 'settings', 'general')),
        ...when(setup, soon('emailIntegration', 'mail'), soon('integrations', 'plug')),
        ...when(access.security, page('security', 'shield', 'security')),
        ...when(setup, soon('auditLog', 'audit')),
      ],
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

/**
 * The ⌘K / Ctrl K command palette's pages (T-M2-43): exactly the menu's built pages — nothing the menu
 * does not offer (display only: every page authorizes itself) — plus My profile, grouped like the menu.
 * `label` and `group` translate message keys (namespace `shell`).
 */
export function commandPaletteItems(
  access: SuiteNavigationAccess,
  locale: string,
  label: (
    key: NavLabelKey | NavGroupKey | 'myProfile' | 'searchGroupPages' | 'searchGroupAccount',
  ) => string,
): CommandPaletteItem[] {
  const items: CommandPaletteItem[] = [];
  for (const group of suiteNavigation(access)) {
    const heading = label(group.key === 'main' ? 'searchGroupPages' : group.key);
    for (const entry of group.entries) {
      if (!entry.link) continue;
      items.push({
        id: entry.link.page,
        label: label(entry.key),
        group: heading,
        href: `/${locale}${entry.link.href}`,
        icon: entry.icon,
      });
    }
  }
  items.push({
    id: 'profile',
    label: label('myProfile'),
    group: label('searchGroupAccount'),
    href: `/${locale}${SUITE_PATHS.profile}`,
    icon: 'user',
  });
  return items;
}
