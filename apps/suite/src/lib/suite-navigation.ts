import type { CommandPaletteItem, IconName } from '@jadarat/ui';
import { tmsNavigation, type tmsPlanningNavigation } from '@jadarat/tms';
import type { SuiteNavigationAccess } from './suite-context';

/** Pages of the suite that have a navigation entry (`current` of the shell). */
export type SuitePage =
  | 'home'
  | 'courses'
  | 'general'
  // Settings → Email integration (WP-ADM-01).
  | 'emailIntegration'
  // Organization → Branding (WP-ADM-02).
  | 'branding'
  // Organization → Grades (WP-ADM-04).
  | 'grades'
  // Subscription (WP-ADM-06): the plan, its limits and usage.
  | 'subscription'
  | 'users'
  | 'structure'
  | 'branches'
  | 'roles'
  | 'security'
  | 'profile'
  // Planning (EP-PLN, T-M3-04).
  | 'planningCycles'
  | 'planningSettings'
  | 'needsForms';

/** Message keys (namespace `shell`) of every navigation label. */
export type NavLabelKey =
  | 'home'
  | (typeof tmsNavigation)[number]['key']
  | 'teamMembers'
  | 'structure'
  | 'branches'
  | 'branding'
  | 'grades'
  | 'roles'
  | 'subscription'
  | 'general'
  | 'emailIntegration'
  | 'integrations'
  | 'security'
  | 'auditLog'
  | (typeof tmsPlanningNavigation)[number]['key']
  | 'needsForms';

/** Message keys (namespace `shell`) of the group headings; `main` has none. */
export type NavGroupKey = 'main' | 'groupPlanning' | 'groupOrganization' | 'groupSettings';

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
  emailIntegration: '/suite/admin/settings/email',
  branding: '/suite/admin/branding',
  grades: '/suite/admin/grades',
  subscription: '/suite/admin/subscription',
  security: '/suite/admin/security',
  profile: '/suite/profile',
  planningCycles: '/suite/planning/cycles',
  planningSettings: '/suite/planning/settings',
  // Planning → Needs forms (T-M3-10).
  needsForms: '/suite/planning/needs-forms',
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
 * In the order of the product map (PO, 27 Oct 2026; docs/product/PRODUCT-MAP.md): Home and the training
 * entries · Planning · Organization (Team members, Departments, Branches, Roles & permissions) · Settings
 * (General, Branding, Grades, Email settings, Security, Subscription, Integrations*, Audit log*). The
 * Organization Admin has no training entries (BR-IAM-4); other roles get Home, the training module's
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
    // Planning (EP-PLN): cycles and planning settings (T-M3-04, tms.plan_cycle.read) and the needs forms
    // library (T-M3-10, tms.needs_form.read) for the L&D Manager and the Training Coordinator.
    {
      key: 'groupPlanning',
      entries: [
        ...when(access.planning, page('planningCycles', 'plan', 'planningCycles')),
        ...when(access.needsForms, page('needsForms', 'form', 'needsForms')),
        ...when(access.planning, page('planningSettings', 'settings', 'planningSettings')),
      ],
    },
    {
      key: 'groupOrganization',
      entries: [
        // Organization (product map, PO 27 Oct 2026): the people and where they sit — Team members,
        // Departments and Branches (T-M3-02, EP-ORG: the HR Manager's pages), Roles.
        ...when(access.users, page('teamMembers', 'people', 'users')),
        ...when(
          access.structure,
          page('structure', 'structure', 'structure'),
          page('branches', 'building', 'branches'),
        ),
        ...when(access.roles, page('roles', 'key', 'roles')),
      ],
    },
    {
      key: 'groupSettings',
      entries: [
        // Settings → General (T-M2-22 organization profile): the Organization Admin edits it, the
        // Auditor reads it.
        ...when(access.organizationProfile || setup, page('general', 'settings', 'general')),
        // Settings → Branding (WP-ADM-02): the Organization Admin edits it, a tenant.read holder (e.g.
        // the Auditor) reads it. Under Settings since the product map (PO, 27 Oct 2026).
        ...when(
          (access.organizationProfile || setup) && access.branding,
          page('branding', 'palette', 'branding'),
        ),
        // Settings → Grades (WP-ADM-04): HR Manager and Organization Admin keep the list of grade codes.
        ...when(access.grades, page('grades', 'star', 'grades')),
        // Settings → Email settings (WP-ADM-01): the Organization Admin edits it, a tenant.read holder
        // (e.g. the Auditor) reads it.
        ...when(
          (access.organizationProfile || setup) && access.emailIntegration,
          page('emailIntegration', 'mail', 'emailIntegration'),
        ),
        ...when(access.security, page('security', 'shield', 'security')),
        // Subscription (WP-ADM-06; the menu item keeps its name, PO 24 Oct 2026): the plan, read-only.
        ...when(setup, page('subscription', 'billing', 'subscription')),
        ...when(setup, soon('integrations', 'plug')),
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
