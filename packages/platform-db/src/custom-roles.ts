import 'server-only';
import { sql } from 'drizzle-orm';
import { storableNamePair } from './custom-roles-present';
import { pgError } from './user-admin';
import type { UserTx } from './with-user-tx';

/**
 * Custom roles of the organization (FR-IAM-07, EP-ROLES; migration 20261019090100). The calling actions
 * authorize (`platform.role.read` to read, `platform.role.manage` to change) and audit; the database
 * guards (private.check_custom_role, private.check_custom_role_permission) have the final word: only the
 * Organization Admin builds roles, from the permission catalogue (any permission not marked 'none', also
 * ones it does not hold — who can give what, PO 17 Oct 2026, migration 20261020200000), administrative
 * ones organization-wide only, and a role still held is not deleted. Row-level security
 * keeps every read and write in the caller's organization.
 */
export type CustomRoleScopeValue = 'own' | 'team' | 'departments' | 'organization';

export interface CustomRoleRow {
  readonly id: string;
  readonly code: string;
  /**
   * One of the two may be missing: a role is named in the organization's default language, the other
   * language is optional (migration 20261113110400; PO, 12 Nov 2026). Shown with platform-rbac's
   * `customRoleName` (the name that exists stands in for a missing one).
   */
  readonly nameAr: string | null;
  readonly nameEn: string | null;
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
  name_ar: string | null;
  name_en: string | null;
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

/** The organization's custom roles, by name (the English one, or the Arabic one of a role without it). */
export async function listCustomRoles(tx: UserTx): Promise<readonly CustomRoleRow[]> {
  const rows = await tx.execute<RawCustomRole>(
    sql`${SELECT} order by lower(coalesce(cr.name_en, cr.name_ar)), cr.id`,
  );
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
  /** The name in the organization's default language is there; the other may be null. */
  readonly nameEn: string | null;
  readonly nameAr: string | null;
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
  | 'in_use'
  | 'scope_units_in_use';

export type CustomRoleOutcome =
  | {
      readonly ok: true;
      readonly before: CustomRoleRow | null;
      readonly after: CustomRoleRow | null;
    }
  | {
      readonly ok: false;
      readonly refusal: CustomRoleRefusal;
      /** With `in_use`: who still holds the role; with `scope_units_in_use`: who holds it with a unit. */
      readonly holders?: { readonly members: number; readonly invitations: number };
    };

/** Maps a database refusal of a custom-role change to a reason; rethrows anything else. */
export function customRoleRefusalOf(error: unknown): CustomRoleRefusal {
  const pg = pgError(error);
  if (pg?.code === '42501') return 'not_allowed';
  if (pg?.code === 'JR002') return 'in_use';
  if (pg?.code === 'JR003') return 'needs_organization_scope';
  if (pg?.code === 'JR004') return 'scope_units_in_use';
  if (pg?.code === '23505' && pg.constraint === 'custom_roles_tenant_name_en_uq')
    return 'name_en_taken';
  if (pg?.code === '23505' && pg.constraint === 'custom_roles_tenant_name_ar_uq')
    return 'name_ar_taken';
  throw error;
}

/** One name only once the database takes it (deploy window of 20261113110400: storableNamePair). */
const NAME_SLOT = { table: 'platform.custom_roles', column: 'name_ar' } as const;

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
  const names = await storableNamePair(tx, NAME_SLOT, input);
  try {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into platform.custom_roles (name_en, name_ar, description, data_scope)
      values (${names.nameEn}, ${names.nameAr}, ${input.description}, ${input.dataScope})
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
  // C-M1: a role given for units (members, pending invitations) keeps «A department» (the database: JR004).
  if (before.dataScope === 'departments' && input.dataScope !== 'departments') {
    const [held] = await tx.execute<{ members: number | string; invitations: number | string }>(sql`
      select
        (select count(*) from platform.role_assignments ra
         join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
         where ra.role_code = ${before.code} and ra.scope_unit_id is not null and m.status <> 'revoked') as members,
        (select count(*) from platform.invitations i
         where i.primary_role = ${before.code} and i.scope_unit_id is not null and i.status = 'pending') as invitations`);
    const holders = {
      members: Number(held?.members ?? 0),
      invitations: Number(held?.invitations ?? 0),
    };
    if (holders.members > 0 || holders.invitations > 0) {
      return { ok: false, refusal: 'scope_units_in_use', holders };
    }
  }
  const removed = before.permissions.filter((p) => !input.permissions.includes(p));
  const added = input.permissions.filter((p) => !before.permissions.includes(p));
  const names = await storableNamePair(tx, NAME_SLOT, input);
  try {
    for (const permission of removed) {
      await tx.execute(sql`delete from platform.custom_role_permissions
        where custom_role_id = ${id}::uuid and permission_code = ${permission}`);
    }
    // Always written: the row's version marks every change of the role, permissions included.
    await tx.execute(sql`update platform.custom_roles
      set name_en = ${names.nameEn}, name_ar = ${names.nameAr}, description = ${input.description},
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
