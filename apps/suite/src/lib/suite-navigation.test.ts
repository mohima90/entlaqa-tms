import { describe, expect, it } from 'vitest';
import type { SuiteNavigationAccess } from './suite-context';
import { ICON_NAMES } from '@jadarat/ui';
import { commandPaletteItems, suiteHome, suiteNavigation } from './suite-navigation';

const NONE: SuiteNavigationAccess = {
  users: false,
  roles: false,
  security: false,
  organizationProfile: false,
  structure: false,
  grades: false,
  organizationSetup: false,
  training: false,
  courses: false,
  planning: false,
  needsForms: false,
  branding: true,
  emailIntegration: true,
  bulkImport: true,
};

/** `group: entry entry…`, links marked with their path, «Coming soon» entries with `(soon)`. */
const outline = (access: SuiteNavigationAccess) =>
  suiteNavigation(access).map(
    (group) =>
      `${group.key}: ${group.entries
        .map((entry) => (entry.link ? `${entry.key}→${entry.link.href}` : `${entry.key}(soon)`))
        .join(' ')}`,
  );

describe('suiteNavigation (menus per role, T-M2-21; Kawadir groups, T-M2-43)', () => {
  it('gives the Organization Admin the Kawadir groups and no training entries (kawadir-alignment §5)', () => {
    expect(
      outline({
        users: true,
        roles: true,
        security: true,
        organizationProfile: true,
        structure: false,
        grades: false,
        organizationSetup: true,
        training: false,
        courses: false,
        planning: false,
        needsForms: false,
        branding: true,
        emailIntegration: true,
        bulkImport: true,
      }),
    ).toEqual([
      'main: home→/suite',
      'groupOrganization: teamMembers→/suite/admin/users branding→/suite/admin/branding roles→/suite/admin/roles',
      'groupBilling: subscription→/suite/admin/subscription',
      'groupSettings: general→/suite/admin/settings emailIntegration→/suite/admin/settings/email integrations(soon) security→/suite/admin/security auditLog(soon)',
    ]);
  });

  it('never shows the Organization Admin a notifications section (moved to the L&D Manager)', () => {
    const keys = suiteNavigation({ ...NONE, organizationSetup: true }).flatMap((group) => [
      group.key,
      ...group.entries.map((entry) => entry.key),
    ]);
    expect(keys.filter((key) => /notif/i.test(key))).toEqual([]);
  });

  it('keeps an HR Manager’s pages in the same groups: training entries, then the organization', () => {
    expect(outline({ ...NONE, users: true, roles: true, training: true })).toEqual([
      'main: home→/suite calendar(soon) sessions(soon) courses(soon)',
      'groupOrganization: teamMembers→/suite/admin/users roles→/suite/admin/roles',
    ]);
    // Organization → Structure and Branches (T-M3-02, EP-ORG): the HR Manager maintains them.
    expect(outline({ ...NONE, users: true, roles: true, structure: true, training: true })).toEqual(
      [
        'main: home→/suite calendar(soon) sessions(soon) courses(soon)',
        'groupOrganization: teamMembers→/suite/admin/users structure→/suite/admin/structure branches→/suite/admin/branches roles→/suite/admin/roles',
      ],
    );
  });

  it('shows an Auditor Settings → General (read only) and Security, no set-up sections', () => {
    expect(
      outline({
        ...NONE,
        users: true,
        roles: true,
        security: true,
        organizationProfile: true,
        structure: false,
        grades: false,
        training: true,
        courses: false,
        planning: false,
        needsForms: false,
        branding: true,
        emailIntegration: true,
        bulkImport: true,
      }),
    ).toEqual([
      'main: home→/suite calendar(soon) sessions(soon) courses(soon)',
      // Branding (WP-ADM-02): read by tenant.read holders.
      'groupOrganization: teamMembers→/suite/admin/users branding→/suite/admin/branding roles→/suite/admin/roles',
      // Email integration (WP-ADM-01): read by tenant.read holders.
      'groupSettings: general→/suite/admin/settings emailIntegration→/suite/admin/settings/email security→/suite/admin/security',
    ]);
  });

  it('links the course library for holders of tms.course.read (T-M3-03)', () => {
    // L&D Manager, Training Coordinator, HR Manager, Department Head.
    expect(outline({ ...NONE, users: true, roles: true, training: true, courses: true })).toEqual([
      'main: home→/suite calendar(soon) sessions(soon) courses→/suite/courses',
      'groupOrganization: teamMembers→/suite/admin/users roles→/suite/admin/roles',
    ]);
    // The Organization Admin never holds it (BR-IAM-4); a custom role holding it shows the page.
    expect(outline({ ...NONE, courses: true })).toEqual([
      'main: home→/suite courses→/suite/courses',
    ]);
  });

  it('denies by default: without grants only Home (and no empty group headings)', () => {
    expect(outline(NONE)).toEqual(['main: home→/suite']);
    expect(outline({ ...NONE, training: true })).toEqual([
      'main: home→/suite calendar(soon) sessions(soon) courses(soon)',
    ]);
  });

  it('gives the L&D Manager and the Training Coordinator Planning → Needs forms (T-M3-10)', () => {
    expect(
      outline({ ...NONE, users: true, roles: true, training: true, needsForms: true }),
    ).toEqual([
      'main: home→/suite calendar(soon) sessions(soon) courses(soon)',
      'groupPlanning: needsForms→/suite/planning/needs-forms',
      'groupOrganization: teamMembers→/suite/admin/users roles→/suite/admin/roles',
    ]);
  });

  it('lists Grades under Organization for members who keep the list (HR Manager, Organization Admin; WP-ADM-04)', () => {
    expect(outline({ ...NONE, users: true, grades: true, training: true })).toEqual([
      'main: home→/suite calendar(soon) sessions(soon) courses(soon)',
      'groupOrganization: teamMembers→/suite/admin/users grades→/suite/admin/grades',
    ]);
    // Nobody else sees the entry, however much else they may do.
    expect(
      outline({ ...NONE, users: true, roles: true, structure: true, training: true })
        .join(' ')
        .includes('grades'),
    ).toBe(false);
  });

  it('gives every entry one of the shell icons', () => {
    const all = suiteNavigation({
      users: true,
      roles: true,
      security: true,
      organizationProfile: true,
      structure: true,
      grades: true,
      organizationSetup: true,
      training: true,
      courses: false,
      planning: false,
      needsForms: false,
      branding: true,
      emailIntegration: true,
      bulkImport: true,
    }).flatMap((group) => group.entries);
    expect(all.length).toBe(16);
    expect(all.filter((entry) => !ICON_NAMES.includes(entry.icon))).toEqual([]);
  });
});

describe('planning entries (EP-PLN, T-M3-04)', () => {
  it('gives planning readers the Planning group with the cycles and the settings', () => {
    expect(outline({ ...NONE, training: true, planning: true })).toEqual([
      'main: home→/suite calendar(soon) sessions(soon) courses(soon)',
      'groupPlanning: planningCycles→/suite/planning/cycles planningSettings→/suite/planning/settings',
    ]);
    expect(outline({ ...NONE, training: true }).some((g) => g.startsWith('groupPlanning'))).toBe(
      false,
    );
  });
});

describe('suiteHome (T-M2-21)', () => {
  it('gives the Organization Admin a set-up home with only the pages that exist', () => {
    const home = suiteHome({
      users: true,
      roles: true,
      security: true,
      organizationProfile: true,
      structure: false,
      grades: false,
      organizationSetup: true,
      training: false,
      courses: false,
      planning: false,
      needsForms: false,
      branding: true,
      emailIntegration: true,
      bulkImport: true,
    });
    expect(home.kind).toBe('setup');
    expect(home.kind === 'setup' ? home.links.map((l) => l.link?.href) : []).toEqual([
      '/suite/admin/users',
      '/suite/admin/branding',
      '/suite/admin/roles',
      '/suite/admin/subscription',
      '/suite/admin/settings',
      '/suite/admin/settings/email',
      '/suite/admin/security',
    ]);
  });

  it('links only what the grants open, and keeps the training home for every other role', () => {
    const home = suiteHome({ ...NONE, organizationSetup: true, users: true });
    expect(home.kind === 'setup' ? home.links.map((l) => l.key) : []).toEqual([
      'teamMembers',
      'branding',
      'subscription',
      'general',
      'emailIntegration',
    ]);
    expect(
      suiteHome({ ...NONE, users: true, roles: true, security: true, training: true }),
    ).toEqual({
      kind: 'training',
    });
    expect(suiteHome(NONE)).toEqual({ kind: 'training' });
  });

  it('hides own branding and own e-mail provider when the plan does not include them (WP-ADM-06)', () => {
    const home = suiteHome({
      ...NONE,
      organizationSetup: true,
      users: true,
      branding: false,
      emailIntegration: false,
    });
    expect(home.kind === 'setup' ? home.links.map((l) => l.key) : []).toEqual([
      'teamMembers',
      'subscription',
      'general',
    ]);
  });
});

describe('commandPaletteItems (⌘K / Ctrl K, T-M2-43)', () => {
  const label = (key: string) => `«${key}»`;

  it('offers exactly the built pages of the menu, grouped like it, plus My profile', () => {
    const items = commandPaletteItems(
      {
        users: true,
        roles: true,
        security: true,
        organizationProfile: true,
        structure: false,
        grades: false,
        organizationSetup: true,
        training: false,
        courses: false,
        planning: false,
        needsForms: false,
        branding: true,
        emailIntegration: true,
        bulkImport: true,
      },
      'ar',
      label,
    );
    expect(items.map((i) => `${i.group} ${i.label} ${i.href}`)).toEqual([
      '«searchGroupPages» «home» /ar/suite',
      '«groupOrganization» «teamMembers» /ar/suite/admin/users',
      '«groupOrganization» «branding» /ar/suite/admin/branding',
      '«groupOrganization» «roles» /ar/suite/admin/roles',
      '«groupBilling» «subscription» /ar/suite/admin/subscription',
      '«groupSettings» «general» /ar/suite/admin/settings',
      '«groupSettings» «emailIntegration» /ar/suite/admin/settings/email',
      '«groupSettings» «security» /ar/suite/admin/security',
      '«searchGroupAccount» «myProfile» /ar/suite/profile',
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('denies by default: without grants only Home and My profile', () => {
    expect(commandPaletteItems(NONE, 'en', label).map((i) => i.href)).toEqual([
      '/en/suite',
      '/en/suite/profile',
    ]);
  });
});
