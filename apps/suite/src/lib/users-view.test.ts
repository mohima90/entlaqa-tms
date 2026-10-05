import { describe, expect, it } from 'vitest';
import {
  localizedName,
  roleName,
  usersListHref,
  usersListParams,
  usersListPath,
  usersPaging,
} from './users-view';

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

describe('paging', () => {
  it('shows the rows of the page and detects pages past the end', () => {
    expect(usersPaging(1, 25, 25, 60)).toEqual({
      from: 1,
      to: 25,
      lastPage: 3,
      beyondLastPage: false,
    });
    expect(usersPaging(3, 25, 10, 60)).toEqual({
      from: 51,
      to: 60,
      lastPage: 3,
      beyondLastPage: false,
    });
    expect(usersPaging(5, 25, 0, 3)).toEqual({ from: 0, to: 0, lastPage: 1, beyondLastPage: true });
    expect(usersPaging(1, 25, 0, 0)).toEqual({
      from: 0,
      to: 0,
      lastPage: 1,
      beyondLastPage: false,
    });
  });

  it('keeps the list state for the language switch', () => {
    expect(usersListPath({ tab: 'invited', q: 'سارة' })).toBe(
      '/suite/admin/users?tab=invited&q=%D8%B3%D8%A7%D8%B1%D8%A9',
    );
    expect(usersListPath({})).toBe('/suite/admin/users');
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
