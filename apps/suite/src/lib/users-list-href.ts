import type { AppLocale } from '@jadarat/platform-i18n';

/*
 * The users list's address (T-M2-04, screen 1) — client-safe: the server page and the instant filter pills
 * (redesign package 3) build the same links, so every view of the list keeps its own address.
 */

/** Query-string keys of the users list (T-M2-04, screen 1). */
export const USERS_LIST_KEYS = ['tab', 'q', 'role', 'department', 'branch', 'page'] as const;
export type UsersListParams = Partial<Record<(typeof USERS_LIST_KEYS)[number], string>>;

/** The list's own keys from the URL; first value wins, empty values (blank selects) are dropped. */
export function usersListParams(
  searchParams: Readonly<Record<string, string | readonly string[] | undefined>>,
): UsersListParams {
  const params: UsersListParams = {};
  for (const key of USERS_LIST_KEYS) {
    const raw = searchParams[key];
    const value = (Array.isArray(raw) ? raw[0] : raw) as string | undefined;
    if (value !== undefined && value.trim() !== '') params[key] = value;
  }
  return params;
}

/**
 * «دعوة مستخدم» over the list (redesign package 3): the invite panel's own address keeps the list's view
 * behind it (`/users/invite?tab=…`), so closing the panel returns to the same view.
 */
export function usersInviteHref(locale: AppLocale, params: UsersListParams): string {
  const list = usersListHref(locale, params, { page: undefined });
  const query = list.indexOf('?');
  return `/${locale}/suite/admin/users/invite${query < 0 ? '' : list.slice(query)}`;
}

/** Link to the users list with `params` changed by `changes` (undefined removes a key). */
export function usersListHref(
  locale: AppLocale,
  params: UsersListParams,
  changes: { readonly [K in keyof UsersListParams]?: string | undefined } = {},
): string {
  const merged: { [K in keyof UsersListParams]?: string | undefined } = { ...params, ...changes };
  const query = new URLSearchParams();
  for (const key of USERS_LIST_KEYS) {
    const value = merged[key];
    if (
      value !== undefined &&
      !(key === 'tab' && value === 'all') &&
      !(key === 'page' && value === '1')
    ) {
      query.set(key, value);
    }
  }
  const search = query.toString();
  return `/${locale}/suite/admin/users${search ? `?${search}` : ''}`;
}
