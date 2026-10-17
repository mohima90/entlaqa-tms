import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coursePermissions } from './course-permissions';
import { CATALOGUE_PERMISSIONS } from './custom-roles';
import { MEMBER_GRANTS } from './member-permissions';
import { platformPermissions } from './platform-permissions';
import {
  FORMER_ROLE_NAMES,
  SYSTEM_ROLES,
  SYSTEM_ROLE_CODES,
  getSystemRole,
  isSystemRoleCode,
} from './system-roles';

const migrationsDir = new URL('../../../supabase/migrations/', import.meta.url).pathname;

/** (code, is_privileged) rows of the ref_roles seed migration (before EP-ROLES removed the former roles). */
function seededRoles(): { code: string; privileged: boolean }[] {
  const file = readdirSync(migrationsDir).find((f) =>
    f.endsWith('_platform__create_ref_roles.sql'),
  );
  if (!file) throw new Error('ref_roles migration not found');
  const text = readFileSync(join(migrationsDir, file), 'utf8');
  return [...text.matchAll(/\('([a-z_]+)', (true|false), \d+\)/g)].map((m) => ({
    code: m[1] ?? '',
    privileged: m[2] === 'true',
  }));
}

/** The former roles the EP-ROLES backfill removes from ref_roles (migration 20261019090300). */
function removedRoles(): string[] {
  const file = readdirSync(migrationsDir).find((f) =>
    f.endsWith('_platform__backfill_standard_roles.sql'),
  );
  if (!file) throw new Error('EP-ROLES backfill migration not found');
  const text = readFileSync(join(migrationsDir, file), 'utf8');
  const list = /c_former constant text\[\] := array\[([^\]]+)\]/.exec(text)?.[1] ?? '';
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? '');
}

describe('standard roles (FR-IAM-07, BRD Appendix B; EP-ROLES, PO 17 Oct 2026)', () => {
  it('has the six standard roles, without the ENTLAQA-only Platform Super Admin', () => {
    expect(SYSTEM_ROLES.map((r) => r.code)).toEqual([...SYSTEM_ROLE_CODES]);
    expect([...SYSTEM_ROLE_CODES]).toEqual([
      'tenant_admin',
      'hr_manager',
      'training_manager',
      'training_coordinator',
      'department_head',
      'learner',
    ]);
    expect(isSystemRoleCode('platform_super_admin')).toBe(false);
    expect(isSystemRoleCode('line_manager')).toBe(false);
  });

  it('matches the database catalogue platform.ref_roles (drift check)', () => {
    const removed = removedRoles();
    expect(removed.sort()).toEqual(Object.keys(FORMER_ROLE_NAMES).sort());
    expect(
      seededRoles()
        .filter((r) => !removed.includes(r.code))
        .sort((a, b) => a.code.localeCompare(b.code)),
    ).toEqual(
      SYSTEM_ROLES.map((r) => ({ code: r.code, privileged: r.privileged })).sort((a, b) =>
        a.code.localeCompare(b.code),
      ),
    );
    // Only the seed migration and the EP-ROLES backfill write ref_roles; a later change must extend this.
    const writers = readdirSync(migrationsDir).filter((f) =>
      /(insert into|update|delete from)\s+platform\.ref_roles/i.test(
        readFileSync(join(migrationsDir, f), 'utf8'),
      ),
    );
    expect(writers).toEqual([
      '20261005100000_platform__create_ref_roles.sql',
      '20261019090300_platform__backfill_standard_roles.sql',
    ]);
  });

  it('marks exactly the roles only an Organization Admin may give as privileged (PO, 5 Oct 2026)', () => {
    expect(SYSTEM_ROLES.filter((r) => r.privileged).map((r) => r.code)).toEqual([
      'tenant_admin',
      'hr_manager',
    ]);
  });

  it('names the Organization Admin and the Employee as the PO approved (17 Oct 2026)', () => {
    expect(getSystemRole('tenant_admin').name).toEqual({
      ar: 'مدير المنظمة',
      en: 'Organization Admin',
    });
    expect(getSystemRole('learner').name).toEqual({ ar: 'موظف', en: 'Employee' });
    expect(FORMER_ROLE_NAMES.auditor?.en).toBe('Auditor');
  });

  it('gives the roles an HR Manager may give only reading permissions and training work (allow-list)', () => {
    // Anything new (platform or module permission) fails here until reviewed: a role that can change
    // people, structure, settings or the audit log must be privileged (PO decision 5 Oct 2026).
    // Reviewed (T-M3-03): the course library — adding, editing and archiving courses changes no person,
    // structure, setting or audit record, so the L&D Manager and the Training Coordinator stay ordinary.
    // Reviewed module permissions (EP-PLN, T-M3-04): planning cycles change no people, structure, settings
    // or audit log — reading them and managing them stay on roles that are not privileged.
    const allowed = [
      'platform.user.read',
      'platform.role.read',
      'platform.org.read',
      'tms.course.read',
      'tms.course_cost.read',
      'tms.course.manage',
      'tms.course.archive',
      'tms.plan_cycle.read',
      'tms.plan_cycle.manage',
      // T-M3-10 (reviewed): designing the training needs form is training configuration — it changes no
      // person, structure, organization setting or audit record, so the L&D Manager stays a role the HR
      // Manager gives (PO, 17 Oct 2026: designed by the L&D Manager).
      'tms.needs_form.read',
      'tms.needs_form.manage',
    ];
    for (const role of SYSTEM_ROLES.filter((r) => !r.privileged)) {
      for (const grant of role.grants) {
        expect(allowed, `${role.code} grants ${grant.permission.code}`).toContain(
          grant.permission.code,
        );
      }
    }
  });

  it('names every role in Arabic and English and grants only registered permissions', () => {
    const registered = new Set(Object.keys(CATALOGUE_PERMISSIONS));
    for (const role of SYSTEM_ROLES) {
      expect(role.name.ar.trim()).not.toBe('');
      expect(role.name.en.trim()).not.toBe('');
      expect(role.description.ar.trim()).not.toBe('');
      for (const grant of role.grants) expect(registered.has(grant.permission.code)).toBe(true);
    }
  });

  it('gives the Organization Admin every platform permission tenant-wide, except the organization structure', () => {
    const admin = getSystemRole('tenant_admin');
    expect(admin.grants.map((g) => g.permission.code).sort()).toEqual(
      Object.keys(platformPermissions)
        .filter((code) => code !== 'platform.org.manage')
        .sort(),
    );
    expect(admin.grants.every((g) => g.scope === 'tenant')).toBe(true);
  });

  it('lets only the HR Manager maintain the organization structure (PO, 11 Oct 2026; T-M2-19)', () => {
    // BRD v2.7 FR-ADM-04/05: the HR Manager maintains branches and departments, not the Organization Admin.
    const managing = SYSTEM_ROLES.filter((r) =>
      r.grants.some((g) => g.permission.code === 'platform.org.manage'),
    );
    expect(managing.map((r) => r.code)).toEqual(['hr_manager']);
    expect(
      managing[0]?.grants.find((g) => g.permission.code === 'platform.org.manage')?.scope,
    ).toBe('tenant');
  });

  it('keeps the Organization Admin a setup role: setup permissions only, never module permissions', () => {
    // PO decision 7 Oct 2026 (BRD v2.4 Appendix B): the Organization Admin sets the organization up —
    // settings, branding, users and roles (full people records), security, integrations, audit — and has
    // no core training feature. Every permission it is granted must be on this reviewed allow-list of
    // setup permissions; a module permission (tms.*, M3+) or a new platform permission fails here until
    // it is reviewed. Never add a training permission to this list.
    const SETUP_PERMISSIONS = [
      'platform.user.read',
      'platform.user.invite',
      'platform.user.update',
      'platform.user.deactivate',
      'platform.user.reset_mfa',
      // T-M2-11 (PO decision 9 Oct 2026): end a member's sign-in lock — a security setup task.
      'platform.user.unlock_sign_in',
      'platform.role.read',
      'platform.role.assign',
      'platform.role.assign_privileged',
      // EP-ROLES (PO, 17 Oct 2026): building the organization's custom roles — a setup task.
      'platform.role.manage',
      'platform.org.read',
      'platform.tenant.read',
      'platform.tenant.manage',
      'platform.security.manage',
      'platform.audit.read',
    ];
    const admin = getSystemRole('tenant_admin');
    for (const grant of admin.grants) {
      expect(grant.permission.code.startsWith('platform.'), grant.permission.code).toBe(true);
      expect(SETUP_PERMISSIONS, grant.permission.code).toContain(grant.permission.code);
    }
    // Member-wide grants reach the Organization Admin too: they stay limited to one's own profile.
    expect(MEMBER_GRANTS.map((g) => g.permission)).toEqual(['platform.profile.manage_own']);
    // The description says so, in both languages.
    expect(admin.description.en).toContain('No access to training features');
    expect(admin.description.ar).toContain('دون الوصول إلى ميزات التدريب');
  });

  it('follows BRD Appendix B «Course library & programs» (T-M3-03)', () => {
    const courses = (code: Parameters<typeof getSystemRole>[0]) =>
      getSystemRole(code)
        .grants.filter((g) => g.permission.code in coursePermissions)
        .map((g) => `${g.permission.code}:${g.scope}`)
        .sort();
    expect(courses('tenant_admin')).toEqual([]);
    expect(courses('hr_manager')).toEqual([
      'tms.course.read:tenant',
      'tms.course_cost.read:tenant',
    ]);
    expect(courses('training_manager')).toEqual([
      'tms.course.archive:tenant',
      'tms.course.manage:tenant',
      'tms.course.read:tenant',
      'tms.course_cost.read:tenant',
    ]);
    // E: adds and edits, archiving stays with the L&D Manager.
    expect(courses('training_coordinator')).toEqual([
      'tms.course.manage:tenant',
      'tms.course.read:tenant',
      'tms.course_cost.read:tenant',
    ]);
    expect(courses('department_head')).toEqual([
      'tms.course.read:tenant',
      'tms.course_cost.read:tenant',
    ]);
    // «V» comes with the employees' own catalogue (M4; PO decision pending): nothing yet.
    expect(courses('learner')).toEqual([]);
  });

  it('lets only the Organization Admin and the HR Manager manage users and roles', () => {
    const managing = SYSTEM_ROLES.filter((r) =>
      r.grants.some((g) => g.permission.code.startsWith('platform.role.assign')),
    ).map((r) => r.code);
    expect(managing).toEqual(['tenant_admin', 'hr_manager']);
    const hr = getSystemRole('hr_manager').grants.map((g) => g.permission.code);
    expect(hr).toContain('platform.role.assign');
    expect(hr).not.toContain('platform.role.assign_privileged');
  });

  it('gives planning cycles to the L&D Manager (manage) and the Training Coordinator (read) only (EP-PLN)', () => {
    const holders = (code: string) =>
      SYSTEM_ROLES.filter((r) => r.grants.some((g) => g.permission.code === code)).map((r) => [
        r.code,
        r.grants.find((g) => g.permission.code === code)?.scope,
      ]);
    expect(holders('tms.plan_cycle.manage')).toEqual([['training_manager', 'tenant']]);
    expect(holders('tms.plan_cycle.read')).toEqual([
      ['training_manager', 'tenant'],
      ['training_coordinator', 'tenant'],
    ]);
  });

  it('lets the L&D Manager design needs forms and the Training Coordinator read them (T-M3-10)', () => {
    const holders = (code: string) =>
      SYSTEM_ROLES.filter((r) => r.grants.some((g) => g.permission.code === code)).map((r) => [
        r.code,
        r.grants.find((g) => g.permission.code === code)?.scope,
      ]);
    expect(holders('tms.needs_form.manage')).toEqual([['training_manager', 'tenant']]);
    expect(holders('tms.needs_form.read')).toEqual([
      ['training_manager', 'tenant'],
      ['training_coordinator', 'tenant'],
    ]);
  });

  it('throws on an unknown code', () => {
    expect(() => getSystemRole('nope' as never)).toThrow('Unknown system role');
  });
});
