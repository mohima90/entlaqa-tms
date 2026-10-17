import { describe, expect, it } from 'vitest';
import {
  type BuilderGroup,
  type BuilderPermission,
  type BuilderStart,
  applyStart,
  builderFieldError,
  builderIsPrivileged,
  changeScope,
  permissionBlock,
  togglePermission,
} from './role-builder';

const permission = (
  code: string,
  extra: Partial<Omit<BuilderPermission, 'code'>> = {},
): BuilderPermission => ({
  code,
  label: code,
  description: '',
  highRisk: false,
  makesPrivileged: false,
  organizationOnly: false,
  ...extra,
});

const groups: BuilderGroup[] = [
  {
    key: 'people',
    title: 'People',
    permissions: [
      permission('platform.user.read'),
      permission('platform.user.invite', { organizationOnly: true, makesPrivileged: true }),
    ],
  },
  {
    key: 'organization',
    title: 'Organization',
    permissions: [
      permission('platform.org.read'),
      // A training permission the Organization Admin does not hold: tickable (PO, 17 Oct 2026).
      permission('tms.course.manage', { organizationOnly: true }),
    ],
  },
  {
    key: 'audit',
    title: 'Audit',
    permissions: [
      permission('platform.audit.read', {
        organizationOnly: true,
        highRisk: true,
        makesPrivileged: true,
      }),
    ],
  },
];

const empty = {
  nameEn: '',
  nameAr: '',
  description: '',
  dataScope: 'organization' as const,
  permissions: [],
};

describe('permissionBlock', () => {
  it('administrative permissions outside the whole organization cannot be ticked; all others can', () => {
    const [read, invite] = groups[0]?.permissions ?? [];
    const manage = groups[1]?.permissions[1];
    if (!read || !invite || !manage) throw new Error('fixture');
    expect(permissionBlock(read, 'own', false)).toBeNull();
    expect(permissionBlock(invite, 'team', false)).toBe('needsOrganization');
    expect(permissionBlock(invite, 'organization', false)).toBeNull();
    // Who can give what (PO, 17 Oct 2026): no "not held" block any more.
    expect(permissionBlock(manage, 'organization', false)).toBeNull();
    expect(permissionBlock(manage, 'team', false)).toBe('needsOrganization');
  });

  it('a ticked permission can always be cleared', () => {
    const manage = groups[1]?.permissions[1];
    if (!manage) throw new Error('fixture');
    expect(permissionBlock(manage, 'own', true)).toBeNull();
  });
});

describe('togglePermission and changeScope', () => {
  it('keeps the catalogue order', () => {
    let chosen = togglePermission(groups, [], 'platform.audit.read', true);
    chosen = togglePermission(groups, chosen, 'platform.user.read', true);
    expect(chosen).toEqual(['platform.user.read', 'platform.audit.read']);
    expect(togglePermission(groups, chosen, 'platform.audit.read', false)).toEqual([
      'platform.user.read',
    ]);
  });

  it('a narrower scope clears administrative permissions and says so', () => {
    const chosen = ['platform.user.read', 'platform.user.invite', 'platform.audit.read'];
    expect(changeScope(groups, chosen, 'team')).toEqual({
      permissions: ['platform.user.read'],
      cleared: true,
    });
    expect(changeScope(groups, ['platform.user.read'], 'own')).toEqual({
      permissions: ['platform.user.read'],
      cleared: false,
    });
    expect(changeScope(groups, chosen, 'organization').cleared).toBe(false);
  });
});

describe('applyStart', () => {
  const start = (extra: Partial<BuilderStart>): BuilderStart => ({
    value: 'blank',
    label: '',
    group: 'blank',
    nameEn: null,
    nameAr: null,
    description: null,
    dataScope: 'organization',
    permissions: [],
    ...extra,
  });

  it('a template fills the names, description, scope and permissions', () => {
    const values = applyStart(
      groups,
      { ...empty, nameEn: 'typed' },
      start({
        value: 'template:auditor',
        group: 'template',
        nameEn: 'Auditor',
        nameAr: 'مدقق',
        description: 'Reads',
        permissions: ['platform.audit.read', 'platform.user.read'],
      }),
    );
    expect(values).toEqual({
      nameEn: 'Auditor',
      nameAr: 'مدقق',
      description: 'Reads',
      dataScope: 'organization',
      permissions: ['platform.user.read', 'platform.audit.read'],
    });
  });

  it('copying a standard role keeps typed names and drops what cannot be given', () => {
    const values = applyStart(
      groups,
      { ...empty, nameEn: 'Reviewer', nameAr: 'مراجع' },
      start({
        value: 'standard:department_head',
        group: 'standard',
        dataScope: 'departments',
        permissions: ['platform.user.read', 'platform.user.invite', 'platform.org.manage', 'x.y.z'],
      }),
    );
    // Not in the catalogue (the structure, unknown codes) or administrative outside the organization.
    expect(values).toEqual({
      nameEn: 'Reviewer',
      nameAr: 'مراجع',
      description: '',
      dataScope: 'departments',
      permissions: ['platform.user.read'],
    });
  });

  it('copying the L&D Manager keeps its training permissions (the Organization Admin holds none)', () => {
    const values = applyStart(
      groups,
      empty,
      start({
        value: 'standard:training_manager',
        group: 'standard',
        dataScope: 'organization',
        permissions: ['platform.user.read', 'tms.course.manage'],
      }),
    );
    expect(values.permissions).toEqual(['platform.user.read', 'tms.course.manage']);
  });
});

describe('builderIsPrivileged', () => {
  it('is true with any high-risk or user-management permission', () => {
    expect(builderIsPrivileged(groups, ['platform.user.read'])).toBe(false);
    expect(builderIsPrivileged(groups, ['platform.user.read', 'platform.user.invite'])).toBe(true);
    expect(builderIsPrivileged(groups, ['platform.user.read', 'platform.audit.read'])).toBe(true);
  });
});

describe('builderFieldError', () => {
  it('maps server field errors to the fields and their texts', () => {
    expect(builderFieldError('nameEn', 'NAME_TAKEN')).toEqual({
      field: 'nameEn',
      key: 'nameTaken',
    });
    expect(builderFieldError('nameAr', 'TOO_SMALL')).toEqual({ field: 'nameAr', key: 'required' });
    expect(builderFieldError('nameAr', 'CUSTOM')).toEqual({ field: 'nameAr', key: 'name' });
    expect(builderFieldError('description', 'TOO_BIG')).toEqual({
      field: 'description',
      key: 'description',
    });
    expect(builderFieldError('dataScope', 'NEEDS_ORGANIZATION_SCOPE')).toEqual({
      field: 'dataScope',
      key: 'dataScope',
    });
    expect(builderFieldError('permissions', 'NEEDS_ORGANIZATION_SCOPE')).toEqual({
      field: 'permissions',
      key: 'permissions',
    });
    expect(builderFieldError('permissions.2', 'CUSTOM')?.field).toBe('permissions');
    expect(builderFieldError('role', 'ROLE_IN_USE')).toBeNull();
    expect(builderFieldError('dataScope', 'SCOPE_UNITS_IN_USE')).toEqual({
      field: 'dataScope',
      key: 'scopeUnitsInUse',
    });
  });
});
