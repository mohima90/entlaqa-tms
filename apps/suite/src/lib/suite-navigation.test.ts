import { describe, expect, it } from 'vitest';
import type { SuiteNavigationAccess } from './suite-context';
import { ICON_NAMES } from '@jadarat/ui';
import { suiteHome, suiteNavigation } from './suite-navigation';

const NONE: SuiteNavigationAccess = {
  users: false,
  roles: false,
  security: false,
  organizationProfile: false,
  organizationSetup: false,
  training: false,
};

/** `group: entry entry…`, links marked with their path, «Coming soon» entries with `(soon)`. */
const outline = (access: SuiteNavigationAccess) =>
  suiteNavigation(access).map(
    (group) =>
      `${group.key}: ${group.entries
        .map((entry) => (entry.link ? `${entry.key}→${entry.link.href}` : `${entry.key}(soon)`))
        .join(' ')}`,
  );

describe('suiteNavigation (menus per role, T-M2-21)', () => {
  it('gives the Organization Admin its approved sections and no training entries (BRD v2.9)', () => {
    expect(
      outline({
        users: true,
        roles: true,
        security: true,
        organizationProfile: true,
        organizationSetup: true,
        training: false,
      }),
    ).toEqual([
      'main: home→/suite',
      'groupOrganization: organizationProfile→/suite/admin/organization branding(soon) customFields(soon) featuresPlan(soon)',
      'groupDomains: domains(soon)',
      'groupPeople: users→/suite/admin/users roles→/suite/admin/roles',
      'groupSecurity: securityPolicy→/suite/admin/security auditLog(soon) consent(soon)',
      'groupEmail: emailSender(soon)',
      'groupIntegrations: lmsConnection(soon) hrSystem(soon)',
    ]);
  });

  it('never shows the Organization Admin a notifications section (moved to the L&D Manager)', () => {
    const keys = suiteNavigation({ ...NONE, organizationSetup: true }).flatMap((group) => [
      group.key,
      ...group.entries.map((entry) => entry.key),
    ]);
    expect(keys.filter((key) => /notif/i.test(key))).toEqual([]);
  });

  it('keeps today’s menu for an HR Manager: training entries, then people', () => {
    expect(outline({ ...NONE, users: true, roles: true, training: true })).toEqual([
      'main: home→/suite calendar(soon) sessions(soon) courses(soon)',
      'groupPeople: users→/suite/admin/users roles→/suite/admin/roles',
    ]);
  });

  it('shows an Auditor the security policy and the organization profile (read only), no set-up sections', () => {
    expect(
      outline({
        ...NONE,
        users: true,
        roles: true,
        security: true,
        organizationProfile: true,
        training: true,
      }),
    ).toEqual([
      'main: home→/suite calendar(soon) sessions(soon) courses(soon)',
      'groupOrganization: organizationProfile→/suite/admin/organization',
      'groupPeople: users→/suite/admin/users roles→/suite/admin/roles',
      'groupSecurity: securityPolicy→/suite/admin/security',
    ]);
  });

  it('denies by default: without grants only Home (and no empty group headings)', () => {
    expect(outline(NONE)).toEqual(['main: home→/suite']);
    expect(outline({ ...NONE, training: true })).toEqual([
      'main: home→/suite calendar(soon) sessions(soon) courses(soon)',
    ]);
  });

  it('gives every entry one of the shell icons', () => {
    const all = suiteNavigation({
      users: true,
      roles: true,
      security: true,
      organizationProfile: true,
      organizationSetup: true,
      training: true,
    }).flatMap((group) => group.entries);
    expect(all.length).toBe(17);
    expect(all.filter((entry) => !ICON_NAMES.includes(entry.icon))).toEqual([]);
  });
});

describe('suiteHome (T-M2-21)', () => {
  it('gives the Organization Admin a set-up home with only the pages that exist', () => {
    const home = suiteHome({
      users: true,
      roles: true,
      security: true,
      organizationProfile: true,
      organizationSetup: true,
      training: false,
    });
    expect(home.kind).toBe('setup');
    expect(home.kind === 'setup' ? home.links.map((l) => l.link?.href) : []).toEqual([
      '/suite/admin/organization',
      '/suite/admin/users',
      '/suite/admin/roles',
      '/suite/admin/security',
    ]);
  });

  it('links only what the grants open, and keeps the training home for every other role', () => {
    const home = suiteHome({ ...NONE, organizationSetup: true, users: true });
    expect(home.kind === 'setup' ? home.links.map((l) => l.key) : []).toEqual([
      'organizationProfile',
      'users',
    ]);
    expect(
      suiteHome({ ...NONE, users: true, roles: true, security: true, training: true }),
    ).toEqual({
      kind: 'training',
    });
    expect(suiteHome(NONE)).toEqual({ kind: 'training' });
  });
});
