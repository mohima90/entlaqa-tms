-- Rollback of 20261112100300_private__a_units_head_enters_its_needs.sql: needs entry asks again for a role
-- that carries tms.plan_needs.submit (the Department Head role) as well as being the effective head — the
-- definition of 20261105100100_tms__plan_needs.sql.
create or replace function private.may_submit_plan_needs(p_tenant_id uuid, p_department_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_claims() ->> 'role' = 'authenticated'
         and private.request_person_id() is not null
         and p_tenant_id = private.current_tenant_id()
         and exists (
           select 1
           from platform.role_assignments ra
           join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
           join platform.ref_role_permissions rp on rp.role_code = ra.role_code
           where ra.tenant_id = p_tenant_id and m.user_id = private.request_user_id() and m.status = 'active'
             and rp.permission_code = 'tms.plan_needs.submit'
             and (ra.valid_from is null or ra.valid_from <= now())
             and (ra.valid_until is null or ra.valid_until > now()))
         and coalesce(private.tenant_plan_features(p_tenant_id) @> array['planning'], true)
         and private.plan_department_head(p_tenant_id, p_department_id) = private.request_person_id();
$$;
comment on function private.may_submit_plan_needs(uuid, uuid) is
  'SECURITY-RELEVANT (WP-LD-01). The signed-in member holds tms.plan_needs.submit and is the department''s effective head.';

revoke all on function private.may_submit_plan_needs(uuid, uuid) from public;
grant execute on function private.may_submit_plan_needs(uuid, uuid) to authenticated;
