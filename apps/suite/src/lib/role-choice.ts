/**
 * Choosing a member's role (EP-ROLES, PO 17 Oct 2026; Kawadir's role dropdown) — client-safe helpers
 * shared by the invite form, the edit-role dialog and their pages: one role per person, standard or custom.
 */
import type { RoleChoice } from '@jadarat/platform-rbac';

export type RoleScopeKey = 'own' | 'team' | 'departments' | 'organization';

/** A role as the forms offer it, in the page's language. */
export interface RoleOption {
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly kind: 'standard' | 'custom';
  readonly privileged: boolean;
  readonly scope: RoleScopeKey;
  /** May the signed-in member give it (privileged roles: the Organization Admin; permissions held)? */
  readonly assignable: boolean;
}

/** The server's role choices in one language (pages: before handing them to a client form). */
export function roleOptions(choices: readonly RoleChoice[], locale: 'ar' | 'en'): RoleOption[] {
  return choices.map((choice) => ({
    code: choice.code,
    name: choice.name[locale],
    description: choice.description ? choice.description[locale] : null,
    kind: choice.kind,
    privileged: choice.privileged,
    scope: choice.dataScope,
    assignable: choice.assignable,
  }));
}

/**
 * Which action a role change goes through: the privileged one (Organization Admin, strict session check)
 * when the new or the current role is privileged; an unknown role counts as privileged (deny by default).
 */
export function roleActionPath(
  options: readonly RoleOption[],
  next: string,
  current: string | null = null,
): 'privileged' | 'ordinary' {
  const privileged = (code: string) => options.find((o) => o.code === code)?.privileged ?? true;
  return privileged(next) || (current !== null && privileged(current)) ? 'privileged' : 'ordinary';
}

/** Does the chosen role read the departments the person heads (the department hint)? */
export function readsHeadedDepartments(options: readonly RoleOption[], code: string): boolean {
  return options.find((o) => o.code === code)?.scope === 'departments';
}

/** Text key of a role field error from the server (codes only, never values). */
export function roleErrorKey(
  code: string,
): 'roleNotAllowed' | 'roleUnknown' | 'lastAdmin' | 'roleRequired' {
  switch (code) {
    case 'ROLE_NOT_ALLOWED':
    case 'ROLE_CONFLICT':
      return 'roleNotAllowed';
    case 'ROLE_UNKNOWN':
      return 'roleUnknown';
    case 'LAST_ADMIN':
      return 'lastAdmin';
    default:
      return 'roleRequired';
  }
}
