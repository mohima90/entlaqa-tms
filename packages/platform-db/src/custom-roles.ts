import 'server-only';
import { sql } from 'drizzle-orm';
import { pgError } from './user-admin';
import type { UserTx } from './with-user-tx';

/**
 * Custom roles of the organization (FR-IAM-07, EP-ROLES; migration 20261019090100). The calling actions
 * authorize (`platform.role.read` to read, `platform.role.manage` to change) and audit; the database
 * guards (private.check_custom_role, private.check_custom_role_permission) have the final word: only the
 * Organization Admin builds roles, from the permission catalogue, with permissions they hold,
 * administrative ones organization-wide only, and a role still held is not deleted. Row-level security
 * keeps every read and write in the caller's organization.
 */
export type CustomRoleScopeValue = 'own' | 'team' | 'departments' | 'organization';

export interface CustomRoleRow {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly description: string | null;
  readonly dataScope: CustomRoleScopeValue;
  readonly permissions: readonly string[];
  /** Members holding it (any status but revoked) and pending invitations naming it. */
  readonly memberCount: number;
  readonly pendingInvitationCount: number;
  readonly version: number;
}

interface RawCustomRole extends Record<string, unknown> {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  description: string | null;
  data_scope: CustomRoleScopeValue;
  permissions: string[] | null;
  member_count: number | string;
  invitation_count: number | string;
  version: number;
}

function toRow(r: RawCustomRole): CustomRoleRow {
  return {
    id: r.id,
    code: r.code,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    description: r.description,
    dataScope: r.data_scope,
    permissions: r.permissions ?? [],
    memberCount: Number(r.member_count),
    pendingInvitationCount: Number(r.invitation_count),
    version: r.version,
  };
}

const SELECT = sql`
  select cr.id, cr.code, cr.name_ar, cr.name_en, cr.description, cr.data_scope, cr.version,
         array(select crp.permission_code from platform.custom_role_permissions crp
               where crp.tenant_id = cr.tenant_id and crp.custom_role_id = cr.id
               order by crp.permission_code) as permissions,
         (select count(*) from platform.role_assignments ra
          join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
          where ra.tenant_id = cr.tenant_id and ra.role_code = cr.code and m.status <> 'revoked') as member_count,
         (select count(*) from platform.invitations i
          where i.tenant_id = cr.tenant_id and i.status = 'pending' and i.primary_role = cr.code) as invitation_count
  from platform.custom_roles cr`;

/** The organization's custom roles, by English name. */
export async function listCustomRoles(tx: UserTx): Promise<readonly CustomRoleRow[]> {
  const rows = await tx.execute<RawCustomRole>(sql`${SELECT} order by lower(cr.name_en), cr.id`);
  return rows.map(toRow);
}

/** One custom role by id or by code, or null (unknown or another organization's). */
export async function getCustomRole(
  tx: UserTx,
  key: { readonly id: string } | { readonly code: string },
): Promise<CustomRoleRow | null> {
  const where = 'id' in key ? sql`cr.id = ${key.id}::uuid` : sql`cr.code = ${key.code}`;
  const [row] = await tx.execute<RawCustomRole>(sql`${SELECT} where ${where}`);
  return row ? toRow(row) : null;
}

export interface CustomRoleInput {
  readonly nameEn: string;
  readonly nameAr: string;
  readonly description: string | null;
  readonly dataScope: CustomRoleScopeValue;
  readonly permissions: readonly string[];
}

/** Why the database refused a custom-role change. */
export type CustomRoleRefusal =
  | 'not_found'
  | 'version_conflict'
  | 'not_allowed'
  | 'name_en_taken'
  | 'name_ar_taken'
  | 'needs_organization_scope'
  | 'in_use';

export type CustomRoleOutcome =
  | {
      readonly ok: true;
      readonly before: CustomRoleRow | null;
      readonly after: CustomRoleRow | null;
    }
  | {
      readonly ok: false;
      readonly refusal: CustomRoleRefusal;
      /** With `in_use`: who still holds the role. */
      readonly holders?: { readonly members: number; readonly invitations: number };
    };

/** Maps a database refusal of a custom-role change to a reason; rethrows anything else. */
export function customRoleRefusalOf(error: unknown): CustomRoleRefusal {
  const pg = pgError(error);
  if (pg?.code === '42501') return 'not_allowed';
  if (pg?.code === 'JR002') return 'in_use';
  if (pg?.code === 'JR003') return 'needs_organization_scope';
  if (pg?.code === '23505' && pg.constraint === 'custom_roles_tenant_name_en_uq')
    return 'name_en_taken';
  if (pg?.code === '23505' && pg.constraint === 'custom_roles_tenant_name_ar_uq')
    return 'name_ar_taken';
  throw error;
}

async function lockRoles(tx: UserTx): Promise<void> {
  // Serialised with every other role change of the organization (READ COMMITTED), before reading.
  await tx.execute(sql`select private.lock_tenant_roles(private.current_tenant_id())`);
}

/** Creates a custom role with its permissions in the caller's transaction. */
export async function createCustomRole(
  tx: UserTx,
  input: CustomRoleInput,
): Promise<CustomRoleOutcome> {
  await lockRoles(tx);
  let id: string;
  try {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into platform.custom_roles (name_en, name_ar, description, data_scope)
      values (${input.nameEn}, ${input.nameAr}, ${input.description}, ${input.dataScope})
      returning id`);
    if (!row) throw new Error('createCustomRole: no row returned');
    id = row.id;
    for (const permission of input.permissions) {
      await tx.execute(sql`insert into platform.custom_role_permissions (custom_role_id, permission_code)
        values (${id}::uuid, ${permission})`);
    }
  } catch (error) {
    return { ok: false, refusal: customRoleRefusalOf(error) };
  }
  return { ok: true, before: null, after: await getCustomRole(tx, { id }) };
}

/**
 * Changes a custom role (names, description, scope, permissions) when it is still at `expectedVersion`.
 * Removed permissions are deleted before the scope changes and added ones inserted after it, so a role
 * moving to or from the whole organization never passes through a state the guard refuses.
 */
export async function updateCustomRole(
  tx: UserTx,
  id: string,
  expectedVersion: number,
  input: CustomRoleInput,
): Promise<CustomRoleOutcome> {
  await lockRoles(tx);
  const before = await getCustomRole(tx, { id });
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.version !== expectedVersion) return { ok: false, refusal: 'version_conflict' };
  const removed = before.permissions.filter((p) => !input.permissions.includes(p));
  const added = input.permissions.filter((p) => !before.permissions.includes(p));
  try {
    for (const permission of removed) {
      await tx.execute(sql`delete from platform.custom_role_permissions
        where custom_role_id = ${id}::uuid and permission_code = ${permission}`);
    }
    // Always written: the row's version marks every change of the role, permissions included.
    await tx.execute(sql`update platform.custom_roles
      set name_en = ${input.nameEn}, name_ar = ${input.nameAr}, description = ${input.description},
          data_scope = ${input.dataScope}
      where id = ${id}::uuid`);
    for (const permission of added) {
      await tx.execute(sql`insert into platform.custom_role_permissions (custom_role_id, permission_code)
        values (${id}::uuid, ${permission})`);
    }
  } catch (error) {
    return { ok: false, refusal: customRoleRefusalOf(error) };
  }
  return { ok: true, before, after: await getCustomRole(tx, { id }) };
}

/** Deletes a custom role nobody holds (members and pending invitations), at `expectedVersion`. */
export async function deleteCustomRole(
  tx: UserTx,
  id: string,
  expectedVersion: number,
): Promise<CustomRoleOutcome> {
  await lockRoles(tx);
  const before = await getCustomRole(tx, { id });
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.version !== expectedVersion) return { ok: false, refusal: 'version_conflict' };
  if (before.memberCount > 0 || before.pendingInvitationCount > 0) {
    return {
      ok: false,
      refusal: 'in_use',
      holders: { members: before.memberCount, invitations: before.pendingInvitationCount },
    };
  }
  try {
    await tx.execute(sql`delete from platform.custom_roles where id = ${id}::uuid`);
  } catch (error) {
    return { ok: false, refusal: customRoleRefusalOf(error) };
  }
  return { ok: true, before, after: null };
}
