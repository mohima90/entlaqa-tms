import {
  type CustomRoleRow,
  type UserTx,
  getCustomRole,
  listCustomRoles,
} from '@jadarat/platform-db';
import {
  type CustomRoleScope,
  customRoleIsPrivileged,
  isCustomRoleCode,
  standardRoleScope,
} from '../custom-roles';
import type { ActionContext } from '../define-action';
import type { LocalizedText } from '../permissions';
import { platformPermissions } from '../platform-permissions';
import { type AssignableRole, standardAssignableRole } from '../role-grants';
import { SYSTEM_ROLES, type SystemRoleDefinition } from '../system-roles';

/**
 * The roles a member can be given (EP-ROLES, FR-IAM-07): the six standard roles and the organization's
 * custom roles, with what deciding and showing them needs — for the invite form, the edit-role dialog,
 * the team list's names and the roles page. Custom roles are read from the database on every request, so
 * a change shows (and is enforced) at once.
 */
export interface RoleChoice extends AssignableRole {
  readonly kind: 'standard' | 'custom';
  readonly name: LocalizedText;
  /** A standard role's description in both languages; a custom role's (one text, as written) or null. */
  readonly description: LocalizedText | null;
  /** The data the role reaches (department picker hint: `departments`). */
  readonly dataScope: CustomRoleScope;
  /** May the current member give it (canGive below)? */
  readonly assignable: boolean;
}

const p = platformPermissions;
/**
 * May the member give `role`? Who can give what (PO, 17 Oct 2026): the Organization Admin
 * (`platform.role.assign_privileged`) every role; the HR Manager (`platform.role.assign`) every role that
 * is not privileged — L&D Manager, Training Coordinator, Department Head, Employee, ordinary custom roles —
 * whether or not it holds the role's permissions. The database's private.member_may_give_roles
 * (migration 20261020200000).
 */
export function canGive(ctx: Pick<ActionContext<UserTx>, 'can'>, role: AssignableRole): boolean {
  if (ctx.can(p['platform.role.assign_privileged'], 'tenant')) return true;
  return !role.privileged && ctx.can(p['platform.role.assign'], 'tenant');
}

function customChoice(row: CustomRoleRow): Omit<RoleChoice, 'assignable'> {
  return {
    code: row.code,
    kind: 'custom',
    name: { ar: row.nameAr, en: row.nameEn },
    description: row.description === null ? null : { ar: row.description, en: row.description },
    privileged: customRoleIsPrivileged(row.permissions),
    permissions: row.permissions,
    dataScope: row.dataScope,
  };
}

function standardChoice(role: SystemRoleDefinition): Omit<RoleChoice, 'assignable'> {
  const assignable = standardAssignableRole(role.code);
  return {
    code: role.code,
    kind: 'standard',
    name: role.name,
    description: role.description,
    privileged: role.privileged,
    permissions: assignable?.permissions ?? [],
    dataScope: standardRoleScope(role),
  };
}

/** Every role (standard first, in screen order; then custom roles by name) with `assignable`. */
export async function loadRoleChoices(
  ctx: Pick<ActionContext<UserTx>, 'can' | 'tx'>,
): Promise<readonly RoleChoice[]> {
  const custom = await listCustomRoles(ctx.tx);
  return [...SYSTEM_ROLES.map(standardChoice), ...custom.map(customChoice)].map((choice) => ({
    ...choice,
    assignable: canGive(ctx, choice),
  }));
}

/** One role by code (standard, or a custom role of the organization), or null. */
export async function findRole(
  tx: UserTx,
  code: string,
): Promise<Omit<RoleChoice, 'assignable'> | null> {
  const standard = SYSTEM_ROLES.find((r) => r.code === code);
  if (standard) return standardChoice(standard);
  if (!isCustomRoleCode(code)) return null;
  const row = await getCustomRole(tx, { code });
  return row ? customChoice(row) : null;
}
