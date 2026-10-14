import { SYSTEM_ROLES, type SystemRoleCode } from '@jadarat/platform-rbac/system-roles';
import { matchKey } from './text';

/**
 * Roles in a file (T-M2-12, PO decisions 3 and 5 of 9 Oct 2026): written by their Arabic or English
 * name as on the template's «القوائم» sheet (or their code). Only non-privileged roles are given by
 * import; the Organization Admin role never (BR-IAM-4).
 */
const ROLE_BY_KEY = new Map<string, SystemRoleCode>();
for (const role of SYSTEM_ROLES) {
  for (const name of [role.name.ar, role.name.en, role.code])
    ROLE_BY_KEY.set(matchKey(name), role.code);
}

/**
 * Former display names still accepted in files (read only: the template lists show today's names).
 * «مدير التدريب» / "Training Manager" became «مدير التعلم والتطوير» / "L&D Manager" (PO, 14 Oct 2026;
 * BRD v2.9), and files made from an older template or an HR export still carry the old name.
 */
export const FORMER_ROLE_NAMES: Readonly<Partial<Record<SystemRoleCode, readonly string[]>>> = {
  training_manager: ['مدير التدريب', 'Training Manager'],
};
for (const [code, names] of Object.entries(FORMER_ROLE_NAMES) as [SystemRoleCode, string[]][]) {
  for (const name of names) {
    const key = matchKey(name);
    // Never let a former name shadow a current one.
    if (!ROLE_BY_KEY.has(key)) ROLE_BY_KEY.set(key, code);
  }
}

/** The role a cell names, or null. */
export function roleForName(name: string): SystemRoleCode | null {
  return ROLE_BY_KEY.get(matchKey(name)) ?? null;
}

const PRIVILEGED = new Set<string>(SYSTEM_ROLES.filter((r) => r.privileged).map((r) => r.code));

export function isPrivilegedRole(code: string): boolean {
  return PRIVILEGED.has(code);
}

/** The roles an import may give, in the catalogue's order (the default-role list, the template lists). */
export const IMPORTABLE_ROLES = SYSTEM_ROLES.filter((r) => !r.privileged);

export function roleName(code: string, locale: 'ar' | 'en'): string {
  return SYSTEM_ROLES.find((r) => r.code === code)?.name[locale] ?? code;
}

/** Splits a list of roles written in one cell («،», «,», «؛» or «;» between them). */
export function splitRoles(cell: string): string[] {
  return cell
    .split(/[,;\u060C\u061B]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}
