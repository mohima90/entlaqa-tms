-- Data backfill: the heads of units hold the Department Head role (WP-FIX-03, T-M3-18; FR-ADM-05, FR-IAM-03/04;
-- PO 12 Nov 2026 — test feedback #1 «either door does both»: a unit's «Head» and the Department Head role
-- set each other). Class: data only (no schema change). PII: none (ids and role codes).
--
-- From this release the application gives the Department Head role to a member who becomes the head of a
-- unit (packages/platform-rbac iam/head-role.ts) and asks «Head of which department?» when the role is given
-- (iam/edit-roles.ts, iam/invitations.ts). This migration brings the existing heads in line, with the same
-- rule and within ONE role per person (EP-ROLES, 20261019090400):
--   * a member (membership not revoked) who heads a live unit and holds the Employee role (`learner`)
--     becomes a Department Head — the role row is changed in place, so its dates stay;
--   * a member who heads a live unit and holds no role gets the Department Head role;
--   * a member who holds ANY other role keeps it (HR Manager, L&D Manager, Training Coordinator, Organization
--     Admin, a custom role): nobody loses a role by this migration;
--   * role holders are NOT made heads of anything: heads come from the structure only.
-- Nobody gains more than the Department Head role gives for the units they already head. Every change is
-- audited (platform.user.roles_changed, actor: none — this migration; role codes and unit ids).
-- Runs as a platform operation (no user claims: private.check_role_assignment_actor lets it through).
-- Idempotent: a second run finds nobody to change. Expand-first: the previous release reads roles the same
-- way. The counts are printed as WARNINGs so that DB deploy's plan shows them before anything is applied.
set local lock_timeout = '5s';

lock table platform.role_assignments in share row exclusive mode;

do $$
declare
  v_changed bigint;
  v_given bigint;
begin
  -- The audit rows first (they name the role before the change).
  insert into platform.audit_events (tenant_id, action, entity_type, entity_id, data)
  select m.tenant_id, 'platform.user.roles_changed', 'person', m.person_id::text,
         jsonb_build_object(
           'before', ra.role_code,
           'after', 'department_head',
           'automatic', true,
           'reason', 'unit_head (migration 20261112100000)',
           'unitIds', (select to_jsonb(array_agg(d.id order by d.id))
                       from platform.departments d
                       where d.tenant_id = m.tenant_id and d.head_person_id = m.person_id
                         and d.deleted_at is null))
  from platform.tenant_memberships m
  left join platform.role_assignments ra on ra.tenant_id = m.tenant_id and ra.membership_id = m.id
  where m.status <> 'revoked'
    and (ra.id is null or ra.role_code = 'learner')
    and exists (select 1 from platform.departments d
                where d.tenant_id = m.tenant_id and d.head_person_id = m.person_id and d.deleted_at is null);

  update platform.role_assignments ra
  set role_code = 'department_head'
  from platform.tenant_memberships m
  where m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    and m.status <> 'revoked'
    and ra.role_code = 'learner'
    and exists (select 1 from platform.departments d
                where d.tenant_id = m.tenant_id and d.head_person_id = m.person_id and d.deleted_at is null);
  get diagnostics v_changed = row_count;

  insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
  select m.tenant_id, m.id, 'department_head', true
  from platform.tenant_memberships m
  where m.status <> 'revoked'
    and not exists (select 1 from platform.role_assignments ra
                    where ra.tenant_id = m.tenant_id and ra.membership_id = m.id)
    and exists (select 1 from platform.departments d
                where d.tenant_id = m.tenant_id and d.head_person_id = m.person_id and d.deleted_at is null);
  get diagnostics v_given = row_count;

  if v_changed > 0 or v_given > 0 then
    raise warning 'WP-FIX-03: heads of units — % Employee(s) became Department Head, % member(s) without a role were given it',
      v_changed, v_given;
  end if;
end
$$;
