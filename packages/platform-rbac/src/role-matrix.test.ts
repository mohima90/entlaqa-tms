import { describe, expect, it } from 'vitest';
import { platformPermissions } from './platform-permissions';
import { ROLE_MATRIX } from './role-matrix';
import { SYSTEM_ROLES, SYSTEM_ROLE_CODES } from './system-roles';

const p = platformPermissions;
const area = (key: string) => {
  const found = ROLE_MATRIX.find((a) => a.key === key);
  if (!found) throw new Error(key);
  return found;
};

describe('role matrix (BRD Appendix B, screen 5)', () => {
  it('has the 20 areas of the BRD, each with a cell for every system role', () => {
    expect(ROLE_MATRIX).toHaveLength(20);
    for (const row of ROLE_MATRIX) {
      expect(Object.keys(row.access).sort()).toEqual([...SYSTEM_ROLE_CODES].sort());
      expect(row.name.ar && row.name.en).toBeTruthy();
    }
    expect(ROLE_MATRIX.filter((a) => a.sensitive).map((a) => a.key)).toEqual([
      'settings',
      'users',
      'finance',
      'integrations',
      'audit',
    ]);
    expect(area('reports').access.finance_manager).toEqual({
      level: 'F',
      qualifier: { ar: 'المالية', en: 'finance' },
    });
  });

  it('the platform rows match the permissions the roles actually grant', () => {
    for (const role of SYSTEM_ROLES) {
      const grants = (code: string) => role.grants.filter((g) => g.permission.code === code);
      const users = area('users').access[role.code];
      const userRead = grants(p['platform.user.read'].code);
      expect(users.level !== 'N', `users / ${role.code}`).toBe(userRead.length > 0);
      // "Own records only" in the matrix ⇔ the role reads only the member's own record.
      expect(users.level === 'O', `users own / ${role.code}`).toBe(
        userRead.length > 0 && userRead.every((g) => g.scope === 'own'),
      );
      // Settings: full with tenant.manage, view with tenant.read only, none otherwise.
      const settings = area('settings').access[role.code].level;
      const manage = grants(p['platform.tenant.manage'].code).length > 0;
      const readSettings = grants(p['platform.tenant.read'].code).length > 0;
      expect(settings, `settings / ${role.code}`).toBe(manage ? 'F' : readSettings ? 'V' : 'N');
      const audit = area('audit').access[role.code];
      expect(audit.level !== 'N', `audit / ${role.code}`).toBe(
        grants(p['platform.audit.read'].code).length > 0,
      );
    }
  });
});
