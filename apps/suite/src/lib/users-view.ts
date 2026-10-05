import type { AppLocale } from '@jadarat/platform-i18n';
import { getSystemRole, isSystemRoleCode } from '@jadarat/platform-rbac';

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

/** Locale-less path of the users list with `params` (for the language switch). */
export function usersListPath(params: UsersListParams): string {
  return usersListHref('ar', params).slice('/ar'.length);
}

export interface UsersPaging {
  /** 1-based position of the first and last row shown (0 when nothing is shown). */
  readonly from: number;
  readonly to: number;
  readonly lastPage: number;
  /** The requested page is past the last page of a non-empty list. */
  readonly beyondLastPage: boolean;
}

export function usersPaging(
  page: number,
  pageSize: number,
  rows: number,
  total: number,
): UsersPaging {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (rows === 0) return { from: 0, to: 0, lastPage, beyondLastPage: total > 0 && page > lastPage };
  const from = (page - 1) * pageSize + 1;
  return { from, to: Math.min(from + rows - 1, total), lastPage, beyondLastPage: false };
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

/** Arabic name in Arabic; the English name in English when there is one. */
export function localizedName(locale: AppLocale, nameAr: string, nameEn: string | null): string {
  return locale === 'en' ? (nameEn ?? nameAr) : nameAr;
}

/** Display name of a system role; unknown codes are shown as they are (never hidden). */
export function roleName(locale: AppLocale, code: string): string {
  return isSystemRoleCode(code) ? getSystemRole(code).name[locale] : code;
}
