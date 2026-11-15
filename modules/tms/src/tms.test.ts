import { createPermissionRegistry, getSystemRole } from '@jadarat/platform-rbac';
import { describe, expect, it } from 'vitest';
import { tmsNavigation, tmsPermissions } from './index';

describe('tms permissions', () => {
  it('are namespaced under tms and registrable', () => {
    const registry = createPermissionRegistry(tmsPermissions);
    expect(registry.all().every((p) => p.code.startsWith('tms.'))).toBe(true);
    expect(registry.has('tms.enrollment.approve')).toBe(true);
  });

  it('are never granted to the Organization Admin, a setup role (BRD v2.4 Appendix B, BR-IAM-4)', () => {
    const tms = new Set(Object.keys(tmsPermissions));
    const granted = getSystemRole('tenant_admin').grants.map((g) => g.permission.code);
    expect(granted.filter((code) => tms.has(code) || code.startsWith('tms.'))).toEqual([]);
  });
});

describe('tms navigation', () => {
  it('registers real URL prefixes under /suite', () => {
    expect(tmsNavigation.every((item) => item.href.startsWith('/suite'))).toBe(true);
  });
});
