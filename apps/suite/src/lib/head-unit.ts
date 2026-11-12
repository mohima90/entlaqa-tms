/**
 * The department that goes with the Department Head role (WP-FIX-03; PO, 12 Nov 2026 — «either door does
 * both», and «when I add the role Department Head, he becomes the manager of the department according to
 * what his department is»): client-safe helpers shared by the change-role panel, the invite form and their
 * pages. Giving the role makes the person the head of THEIR OWN department — the form says so and lets
 * another department be chosen; only a person without a department is asked. A department that has
 * another head asks before replacing; making a head an Employee warns which departments are left without
 * one.
 */
import type { HeadUnitChoices } from '@jadarat/platform-rbac';

/** The standard role a head holds (packages/platform-rbac system-roles). */
export const DEPARTMENT_HEAD_ROLE = 'department_head';

/** The Employee role: the one role a head cannot keep their departments with (they would be a Department Head). */
export const EMPLOYEE_ROLE = 'learner';

/** A department's head as the forms show it. */
export interface HeadOfUnit {
  readonly unitId: string;
  readonly personId: string;
  readonly name: string;
}

/** What the question needs, in the page's language. */
export interface HeadUnitView {
  /** The signed-in member sets the head with the role (a structure manager, or whoever may give it). */
  readonly canPick: boolean;
  /** The person's own department (null: none, or someone being invited — the form's Department then). */
  readonly ownUnitId: string | null;
  readonly heads: readonly HeadOfUnit[];
}

export const NO_HEAD_UNIT_VIEW: HeadUnitView = { canPick: false, ownUnitId: null, heads: [] };

/**
 * The department a new Department Head heads when the form is left as it opens: the one picked, else — for
 * someone who heads nothing yet — their own department (PO, 12 Nov 2026). Empty: nothing to set (they keep
 * the departments they head) or nothing to default to (no department: the form asks).
 */
export function headUnitDefault(input: {
  readonly picked: string;
  readonly ownUnitId: string | null;
  readonly headsSomething: boolean;
  /** The units of the picker: an inactive or missing own department is never a default. */
  readonly units: readonly { readonly id: string; readonly active: boolean }[];
}): string {
  if (input.picked !== '') return input.picked;
  if (input.headsSomething || input.ownUnitId === null) return '';
  return input.units.some((u) => u.id === input.ownUnitId && u.active) ? input.ownUnitId : '';
}

/** The server's choices in one language (pages: before handing them to a client form). */
export function headUnitView(choices: HeadUnitChoices, locale: 'ar' | 'en'): HeadUnitView {
  return {
    canPick: choices.canPick,
    ownUnitId: choices.ownUnitId,
    heads: choices.heads.map((head) => ({
      unitId: head.unitId,
      personId: head.personId,
      name: (locale === 'en' ? (head.nameEn ?? head.nameAr) : (head.nameAr ?? head.nameEn)) ?? '',
    })),
  };
}

/** Text key (namespace `editRoles.head`) of a head-unit field error from the server (codes only). */
export function headUnitErrorKey(
  code: string,
): 'required' | 'taken' | 'notActive' | 'notYours' | 'notAllowed' {
  switch (code) {
    case 'HEAD_UNIT_REQUIRED':
      return 'required';
    case 'HEAD_TAKEN':
      return 'taken';
    case 'HEAD_NOT_ACTIVE':
      return 'notActive';
    case 'HEAD_NOT_YOURS':
      return 'notYours';
    default:
      return 'notAllowed';
  }
}

/** A picker label without its tree indentation (the em spaces before a unit under another). */
export function unitLabel(label: string): string {
  return label.trimStart();
}
