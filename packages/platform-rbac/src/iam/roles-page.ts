import { appError, err, ok } from '@jadarat/platform-core';
import {
  type CustomRoleRow,
  type UserTx,
  countMembersByRole,
  getCustomRole,
  listCustomRoles,
} from '@jadarat/platform-db';
import { z } from 'zod';
import { CUSTOM_ROLE_PERMISSIONS, customRoleIsPrivileged, isCustomRoleCode } from '../custom-roles';
import type { ActionContext } from '../define-action';
import type { QueryDefinition } from '../define-query';
import type { LocalizedText } from '../permissions';
import { platformPermissions } from '../platform-permissions';
import { standardAssignableRole } from '../role-grants';
import { SYSTEM_ROLES } from '../system-roles';

/**
 * Roles & permissions (FR-IAM-07; EP-ROLES, PO 17 Oct 2026 — Kawadir's roles table): the six standard roles
 * (read-only) and the organization's custom roles, each with its permissions and how many people hold it,
 * plus «إنشاء دور» for the Organization Admin. Needs a tenant-wide `platform.role.read`; the member counts
 * also a tenant-wide `platform.user.read` (every role with the first has the second today); building roles
 * `platform.role.manage` (the Organization Admin).
 */
const p = platformPermissions;

export interface RolesPageRole {
  readonly code: string;
  readonly kind: 'standard' | 'custom';
  readonly name: LocalizedText;
  readonly description: LocalizedText | null;
  readonly privileged: boolean;
  readonly permissions: readonly string[];
  /** Custom roles: their id (edit and delete) and version. */
  readonly id: string | null;
  readonly version: number | null;
}

export interface RolesPageView {
  readonly roles: readonly RolesPageRole[];
  /** Members per role code (invited to deactivated, role in force); null without user.read. */
  readonly memberCounts: Readonly<Record<string, number>> | null;
  /** «إنشاء دور», edit and delete: `platform.role.manage` (the Organization Admin). */
  readonly canManage: boolean;
}

export const RolesPageInput = z.strictObject({});

function customRole(row: CustomRoleRow): RolesPageRole {
  return {
    code: row.code,
    kind: 'custom',
    name: { ar: row.nameAr, en: row.nameEn },
    description: row.description === null ? null : { ar: row.description, en: row.description },
    privileged: customRoleIsPrivileged(row.permissions),
    permissions: row.permissions,
    id: row.id,
    version: row.version,
  };
}

const STANDARD: readonly RolesPageRole[] = SYSTEM_ROLES.map((role) => ({
  code: role.code,
  kind: 'standard',
  name: role.name,
  description: role.description,
  privileged: role.privileged,
  permissions: standardAssignableRole(role.code)?.permissions ?? [],
  id: null,
  version: null,
}));

export function rolesPageQueryDefinition(): QueryDefinition<
  typeof RolesPageInput,
  RolesPageView,
  UserTx
> {
  return {
    permission: p['platform.role.read'],
    input: RolesPageInput,
    handler: async ({ ctx }) =>
      ok({
        roles: [...STANDARD, ...(await listCustomRoles(ctx.tx)).map(customRole)],
        memberCounts: ctx.can(p['platform.user.read'], 'tenant')
          ? await countMembersByRole(ctx.tx)
          : null,
        canManage: ctx.can(p['platform.role.manage'], 'tenant'),
      }),
  };
}

/**
 * The permissions of the catalogue the member holds organization-wide — the role builder offers only these
 * (nobody gives a permission they do not hold, EP-ROLES).
 */
export function heldCataloguePermissions(ctx: Pick<ActionContext<UserTx>, 'can'>): string[] {
  return CUSTOM_ROLE_PERMISSIONS.filter((entry) => ctx.can(entry.permission, 'tenant')).map(
    (entry) => entry.permission.code,
  );
}

export interface RoleDetailView {
  readonly role: RolesPageRole;
  /** Custom roles: the stored row (names, description, scope, holders) for the edit form. */
  readonly custom: CustomRoleRow | null;
  readonly memberCount: number | null;
  readonly canManage: boolean;
  /** What the builder may tick (only with `canManage`). */
  readonly heldPermissions: readonly string[];
}

export const RoleDetailInput = z.strictObject({
  code: z.string().max(40).regex(/^[a-z][a-z_]{1,39}$|^custom_[0-9a-f]{12}$/),
});

/** One role: a standard role (view only) or a custom role (view, or edit for the Organization Admin). */
export function roleDetailQueryDefinition(): QueryDefinition<
  typeof RoleDetailInput,
  RoleDetailView,
  UserTx
> {
  return {
    permission: p['platform.role.read'],
    input: RoleDetailInput,
    handler: async ({ ctx, input }) => {
      const standard = STANDARD.find((role) => role.code === input.code);
      const custom =
        standard || !isCustomRoleCode(input.code)
          ? null
          : await getCustomRole(ctx.tx, { code: input.code });
      const role = standard ?? (custom ? customRole(custom) : null);
      if (!role) return err(appError('NOT_FOUND'));
      const canManage = ctx.can(p['platform.role.manage'], 'tenant');
      const counts = ctx.can(p['platform.user.read'], 'tenant')
        ? await countMembersByRole(ctx.tx)
        : null;
      return ok({
        role,
        custom,
        memberCount: counts ? (counts[role.code] ?? 0) : null,
        canManage,
        heldPermissions: canManage ? heldCataloguePermissions(ctx) : [],
      });
    },
  };
}

export interface RoleEditorView {
  readonly canManage: true;
  readonly heldPermissions: readonly string[];
}

export const RoleEditorInput = z.strictObject({});

/** The create form: the permissions the Organization Admin may tick. */
export function roleEditorQueryDefinition(): QueryDefinition<
  typeof RoleEditorInput,
  RoleEditorView,
  UserTx
> {
  return {
    permission: p['platform.role.manage'],
    input: RoleEditorInput,
    handler: ({ ctx }) =>
      Promise.resolve(ok({ canManage: true, heldPermissions: heldCataloguePermissions(ctx) })),
  };
}
