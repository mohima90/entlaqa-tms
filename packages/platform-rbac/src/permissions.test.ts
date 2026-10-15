import { describe, expect, it } from 'vitest';
import {
  type PermissionDefinition,
  PermissionDefinitionError,
  createPermissionRegistry,
  definePermissions,
} from './permissions';

const label = { ar: 'عرض', en: 'View' };

describe('definePermissions', () => {
  it('returns permissions keyed by code', () => {
    const perms = definePermissions('tms', [
      { code: 'tms.session.read', label, description: label, risk: 'low', requiresAal2: false },
    ]);
    expect(perms['tms.session.read'].risk).toBe('low');
    expect(Object.isFrozen(perms)).toBe(true);
  });

  it.each([
    ['bad format', { code: 'tms.Session.read' }],
    ['two segments', { code: 'tms.session' }],
    ['other namespace', { code: 'core_hr.employee.read' }],
    ['missing Arabic label', { code: 'tms.session.read', label: { ar: ' ', en: 'x' } }],
  ])('rejects %s', (_name, override) => {
    expect(() =>
      definePermissions('tms', [
        Object.assign(
          { code: 'tms.session.read', label, description: label, risk: 'low', requiresAal2: false },
          override,
        ) as never,
      ]),
    ).toThrow(PermissionDefinitionError);
  });

  it('rejects duplicates within a module', () => {
    const def = {
      code: 'tms.session.read',
      label,
      description: label,
      risk: 'low',
      requiresAal2: false,
    } as const;
    expect(() => definePermissions('tms', [def, def])).toThrow('Duplicate');
  });
});

describe('createPermissionRegistry', () => {
  const tms = definePermissions('tms', [
    { code: 'tms.session.read', label, description: label, risk: 'low', requiresAal2: false },
  ]);
  const platform = definePermissions('platform', [
    { code: 'platform.role.manage', label, description: label, risk: 'high', requiresAal2: true },
  ]);

  it('combines module sets and looks up codes', () => {
    const registry = createPermissionRegistry(tms, platform);
    expect(registry.has('tms.session.read')).toBe(true);
    expect(registry.get('platform.role.manage')?.requiresAal2).toBe(true);
    expect(registry.get('tms.unknown.read')).toBeUndefined();
    expect(registry.all()).toHaveLength(2);
  });

  it('fails on duplicates across modules', () => {
    expect(() => createPermissionRegistry(tms, tms)).toThrow('across modules');
  });
});

describe('organization permissions (PO decision, 14 Oct 2026)', () => {
  it('none asks for an authenticator code (no step-up; D-IAM-01 reversed)', async () => {
    const { platformPermissions } = await import('./platform-permissions');
    const { memberPermissions } = await import('./member-permissions');
    const all: PermissionDefinition[] = [
      ...Object.values(platformPermissions),
      ...Object.values(memberPermissions),
    ];
    expect(all.filter((p) => p.requiresAal2).map((p) => p.code)).toEqual([]);
    // High risk still confirms the session with Auth (getUser) before acting.
    expect(platformPermissions['platform.role.assign_privileged'].risk).toBe('high');
  });
});
