import { describe, expect, it } from 'vitest';
import { localizedName, roleName, usersListHref, usersListParams } from './users-view';

describe('users list URL helpers', () => {
  it('keeps the list keys, first value only, without blanks', () => {
    expect(
      usersListParams({ tab: 'active', q: ['sara', 'x'], role: '', page: '2', other: 'x' }),
    ).toEqual({ tab: 'active', q: 'sara', page: '2' });
  });

  it('builds links, dropping defaults and removed keys', () => {
    expect(usersListHref('ar', {})).toBe('/ar/suite/admin/users');
    expect(usersListHref('en', { tab: 'all', page: '1', q: 'a b' })).toBe(
      '/en/suite/admin/users?q=a+b',
    );
    expect(usersListHref('ar', { tab: 'invited', q: 'x', page: '3' }, { page: undefined })).toBe(
      '/ar/suite/admin/users?tab=invited&q=x',
    );
  });
});

describe('names', () => {
  it('uses the English name only in English, falling back to Arabic', () => {
    expect(localizedName('ar', 'سارة', 'Sarah')).toBe('سارة');
    expect(localizedName('en', 'سارة', 'Sarah')).toBe('Sarah');
    expect(localizedName('en', 'سارة', null)).toBe('سارة');
  });

  it('shows system role names and leaves unknown codes visible', () => {
    expect(roleName('ar', 'department_head')).toBe('رئيس القسم');
    expect(roleName('en', 'line_manager')).toBe('Line Manager');
    expect(roleName('en', 'custom_x')).toBe('custom_x');
  });
});
