import type { AppLocale } from '@jadarat/platform-i18n';
import { personDisplayName } from '@jadarat/platform-i18n/names';
import { FORMER_ROLE_NAMES, getSystemRole, isSystemRoleCode } from '@jadarat/platform-rbac';
import { type UsersListParams, usersListHref } from './users-list-href';

// The list's address helpers are client-safe (the filter pills build links too).
export {
  USERS_LIST_KEYS,
  type UsersListParams,
  usersListHref,
  usersListParams,
} from './users-list-href';

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

/**
 * A name in the page's language: the Arabic name in Arabic, the English name in English — each falling back
 * to the other when missing (a person may have an English name only, PO 17 Oct 2026; a unit, a branch and a
 * level may be named in the organization's default language only, PO 12 Nov 2026).
 */
export function localizedName(
  locale: AppLocale,
  nameAr: string | null,
  nameEn: string | null,
): string {
  return personDisplayName(locale, nameAr, nameEn);
}

/**
 * The name of a person's unit or branch, or null when they have none — «none» is neither name, never just a
 * missing Arabic one (a unit may be named in English only since migration 20261113100000).
 */
export function localizedNameOrNull(
  locale: AppLocale,
  nameAr: string | null,
  nameEn: string | null,
): string | null {
  return nameAr === null && nameEn === null ? null : localizedName(locale, nameAr, nameEn);
}

/**
 * Display name of a role: a custom role's own name (EP-ROLES), a standard role's, a former system role's
 * (history), else the code as it is (never hidden).
 */
export function roleName(
  locale: AppLocale,
  code: string,
  customName?: { readonly ar: string; readonly en: string } | null,
): string {
  if (customName) return customName[locale];
  if (isSystemRoleCode(code)) return getSystemRole(code).name[locale];
  return FORMER_ROLE_NAMES[code]?.[locale] ?? code;
}

/** The four summary figures of the team (Team members page and the Organization Admin home). */
export interface TeamCounts {
  readonly all: number;
  readonly active: number;
  /** Invited memberships plus the open invitations (T-M2-07), as on the «Pending invites» tab. */
  readonly invited: number;
  readonly deactivated: number;
}

/**
 * The team's summary figures from the users list counts and the open invitations (null: the member may
 * not see invitations, or they did not load — counted as none).
 */
export function teamCounts(
  counts: TeamCounts,
  openInvitations: number | null | undefined,
): TeamCounts {
  return { ...counts, invited: counts.invited + (openInvitations ?? 0) };
}
