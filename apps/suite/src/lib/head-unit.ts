/**
 * «Head of which department?» (WP-FIX-03; PO, 12 Nov 2026 — «either door does both»): client-safe helpers
 * shared by the change-role panel, the invite form and their pages. Giving the Department Head role asks for
 * the department the person heads; a department that has another head asks before replacing; taking the
 * role away from a head warns which departments are left without one.
 */
import type { HeadUnitChoices } from '@jadarat/platform-rbac';

/** The standard role a head holds (packages/platform-rbac system-roles). */
export const DEPARTMENT_HEAD_ROLE = 'department_head';

/** A department's head as the forms show it. */
export interface HeadOfUnit {
  readonly unitId: string;
  readonly personId: string;
  readonly name: string;
}

/** What the question needs, in the page's language. */
export interface HeadUnitView {
  /** The signed-in member manages the structure, so they pick the department here. */
  readonly canPick: boolean;
  readonly heads: readonly HeadOfUnit[];
}

export const NO_HEAD_UNIT_VIEW: HeadUnitView = { canPick: false, heads: [] };

/** The server's choices in one language (pages: before handing them to a client form). */
export function headUnitView(choices: HeadUnitChoices, locale: 'ar' | 'en'): HeadUnitView {
  return {
    canPick: choices.canPick,
    heads: choices.heads.map((head) => ({
      unitId: head.unitId,
      personId: head.personId,
      name: (locale === 'en' ? (head.nameEn ?? head.nameAr) : (head.nameAr ?? head.nameEn)) ?? '',
    })),
  };
}

/** Text key (namespace `editRoles.head`) of a head-unit field error from the server (codes only). */
export function headUnitErrorKey(code: string): 'required' | 'taken' | 'notActive' | 'notAllowed' {
  switch (code) {
    case 'HEAD_UNIT_REQUIRED':
      return 'required';
    case 'HEAD_TAKEN':
      return 'taken';
    case 'HEAD_NOT_ACTIVE':
      return 'notActive';
    default:
      return 'notAllowed';
  }
}

/** A picker label without its tree indentation (the em spaces before a unit under another). */
export function unitLabel(label: string): string {
  return label.trimStart();
}
