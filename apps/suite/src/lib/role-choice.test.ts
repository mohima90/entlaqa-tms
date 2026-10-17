import type { RoleChoice } from '@jadarat/platform-rbac';
import { describe, expect, it } from 'vitest';
import {
  type RoleOption,
  readsHeadedDepartments,
  roleActionPath,
  roleErrorKey,
  roleOptions,
} from './role-choice';

const option = (code: string, privileged: boolean, scope: RoleOption['scope']): RoleOption => ({
  code,
  name: code,
  description: null,
  kind: code.startsWith('custom_') ? 'custom' : 'standard',
  privileged,
  scope,
  assignable: !privileged,
});
const options = [
  option('tenant_admin', true, 'organization'),
  option('department_head', false, 'departments'),
  option('learner', false, 'own'),
  option('custom_0123456789ab', false, 'team'),
  option('custom_ba9876543210', true, 'organization'),
];

describe('roleOptions', () => {
  it('puts the server choices in the page language', () => {
    const choices: RoleChoice[] = [
      {
        code: 'custom_0123456789ab',
        kind: 'custom',
        name: { ar: 'مراجع', en: 'Reviewer' },
        description: null,
        privileged: false,
        permissions: ['platform.user.read'],
        dataScope: 'team',
        assignable: true,
      },
      {
        code: 'learner',
        kind: 'standard',
        name: { ar: 'موظف', en: 'Employee' },
        description: { ar: 'وصف', en: 'Text' },
        privileged: false,
        permissions: [],
        dataScope: 'own',
        assignable: false,
      },
    ];
    expect(roleOptions(choices, 'ar')).toEqual([
      {
        code: 'custom_0123456789ab',
        name: 'مراجع',
        description: null,
        kind: 'custom',
        privileged: false,
        scope: 'team',
        assignable: true,
      },
      {
        code: 'learner',
        name: 'موظف',
        description: 'وصف',
        kind: 'standard',
        privileged: false,
        scope: 'own',
        assignable: false,
      },
    ]);
    expect(roleOptions(choices, 'en')[1]?.description).toBe('Text');
  });
});

describe('roleActionPath (privileged changes use the privileged action)', () => {
  it('privileged when the new or the current role is privileged', () => {
    expect(roleActionPath(options, 'learner', 'department_head')).toBe('ordinary');
    expect(roleActionPath(options, 'custom_0123456789ab')).toBe('ordinary');
    expect(roleActionPath(options, 'tenant_admin', 'learner')).toBe('privileged');
    expect(roleActionPath(options, 'learner', 'custom_ba9876543210')).toBe('privileged');
  });

  it('an unknown role counts as privileged (deny by default)', () => {
    expect(roleActionPath(options, 'custom_ffffffffffff')).toBe('privileged');
    expect(roleActionPath(options, 'learner', 'retired_role')).toBe('privileged');
  });
});

describe('readsHeadedDepartments', () => {
  it('is true only for a role limited to the departments the person heads', () => {
    expect(readsHeadedDepartments(options, 'department_head')).toBe(true);
    expect(readsHeadedDepartments(options, 'learner')).toBe(false);
    expect(readsHeadedDepartments(options, '')).toBe(false);
  });
});

describe('roleErrorKey', () => {
  it('maps server codes to texts', () => {
    expect(roleErrorKey('ROLE_NOT_ALLOWED')).toBe('roleNotAllowed');
    expect(roleErrorKey('ROLE_CONFLICT')).toBe('roleNotAllowed');
    expect(roleErrorKey('ROLE_UNKNOWN')).toBe('roleUnknown');
    expect(roleErrorKey('LAST_ADMIN')).toBe('lastAdmin');
    expect(roleErrorKey('INVALID_FORMAT')).toBe('roleRequired');
  });
});
