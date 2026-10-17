-- One role per person in an organization (EP-ROLES, FR-IAM-07; Kawadir; PO 17 Oct 2026 — business flow
-- docs/business-flows/EP-ROLES-roles-and-custom-roles.md §5). After the backfill (20261019090300) every
-- membership holds at most one assignment; from now on the database refuses a second one, and a pending
-- invitation gives exactly one role (no additional roles). The Organization Admin role is still held alone
-- (BR-IAM-4) and the last Organization Admin is still kept (private.check_last_admin_*). Changing a member's
-- role replaces the row (delete + insert in one transaction, packages/platform-db role-admin.ts).
-- is_primary stays (always true) for the code that still reads it.

-- Safe if the earlier application wrote between the backfill and this migration (each migration is its own
-- transaction; review L6): under exclusive locks, a second role or additional roles written since are
-- removed again the way the backfill chose (role in force, then Organization Admin, primary, oldest), with
-- an audit event, before the constraints are added.
lock table platform.role_assignments, platform.invitations in share row exclusive mode;

do $$
declare
  v_extra bigint;
  v_inv bigint;
begin
  insert into platform.audit_events (tenant_id, action, entity_type, entity_id, data)
  select ra.tenant_id, 'platform.user.roles_changed', 'person', m.person_id::text,
         jsonb_build_object('before', to_jsonb(array_agg(ra.role_code order by ra.role_code)),
                            'reason', 'EP-ROLES one role per person (migration 20261019090400)')
  from platform.role_assignments ra
  join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
  group by ra.tenant_id, ra.membership_id, m.person_id
  having count(*) > 1;
  delete from platform.role_assignments ra
  where ra.id not in (
    select distinct on (k.tenant_id, k.membership_id) k.id
    from platform.role_assignments k
    order by k.tenant_id, k.membership_id,
             ((k.valid_from is null or k.valid_from <= now()) and (k.valid_until is null or k.valid_until > now())) desc,
             (k.role_code = 'tenant_admin') desc, k.is_primary desc, k.created_at, k.id);
  get diagnostics v_extra = row_count;
  update platform.role_assignments set is_primary = true where not is_primary;
  alter table platform.invitations disable trigger invitations_check;
  update platform.invitations set additional_roles = '{}'
  where status = 'pending' and cardinality(additional_roles) > 0;
  get diagnostics v_inv = row_count;
  alter table platform.invitations enable trigger invitations_check;
  if v_extra > 0 or v_inv > 0 then
    raise warning 'EP-ROLES: written since the backfill — % extra role(s) removed, % invitation(s) cleared', v_extra, v_inv;
  end if;
end
$$;

create unique index role_assignments_tenant_membership_one_role_uq
  on platform.role_assignments (tenant_id, membership_id);

alter table platform.invitations
  add constraint invitations_one_role_check check (status <> 'pending' or cardinality(additional_roles) = 0);
