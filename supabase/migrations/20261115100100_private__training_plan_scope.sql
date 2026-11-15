-- Who reaches the training plan, and for which departments (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06, FR-IAM-08 R1
-- note; test feedback #4, agreed 17 Oct 2026: the department-limited L&D Manager). Class: authorization helpers
-- (functions only; no table, column or data change). PII: none.
--
--   private.permission_feature        the training-plan permissions belong to the planning feature (WP-ADM-06):
--                                     an organization whose plan has no planning has no training plan either
--   private.may_read_training_plan    the signed-in member holds tms.training_plan.read or .manage ORGANIZATION-WIDE
--                                     (a standard role — L&D Manager, Training Coordinator — or a custom role whose
--                                     scope is the whole organization; private.member_permissions)
--   private.may_manage_training_plan  … holds tms.training_plan.manage organization-wide (the L&D Manager)
--   private.training_plan_units       the units a DEPARTMENT-LIMITED custom role gives the member the permission
--                                     for: the unit picked when the role was given (platform.role_assignments
--                                     .scope_unit_id; live and active, as the application's grant loader reads
--                                     it) and every live unit below it. p_manage = false: read or manage;
--                                     true: manage. Empty when none. In the caller's organization only, signed-in
--                                     members only, and only while the organization's plan includes planning.
-- The application decides the same way (packages/platform-rbac grantsForAssignments: «assigned_unit» → the unit
-- and its descendants); the plan's tables and the planning tables the plan reads use these helpers in their read
-- and write policies (migrations 20261115100200, 20261115100300). SECURITY INVOKER: they read the caller's own
-- role assignments and custom roles and the structure, which every member may read.
-- Expand-first: new functions and a wider feature map; nothing calls them before the application does.

create or replace function private.permission_feature(p_permission text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when p_permission like 'tms.plan\_cycle.%' or p_permission like 'tms.plan\_needs.%'
         or p_permission like 'tms.training\_plan.%' then 'planning'
    when p_permission like 'tms.needs\_form.%' then 'needs_forms'
    when p_permission like 'tms.course.%' or p_permission like 'tms.course\_cost.%' then 'courses'
  end;
$$;

create or replace function private.may_read_training_plan(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_claims() ->> 'role' = 'authenticated'
         and (private.member_has_permission(p_tenant_id, private.request_user_id(), 'tms.training_plan.read')
              or private.member_has_permission(p_tenant_id, private.request_user_id(), 'tms.training_plan.manage'));
$$;

comment on function private.may_read_training_plan(uuid) is
  'SECURITY-RELEVANT (WP-LD-02). The signed-in member holds tms.training_plan.read or .manage organization-wide.';

create or replace function private.may_manage_training_plan(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_claims() ->> 'role' = 'authenticated'
         and private.member_has_permission(p_tenant_id, private.request_user_id(), 'tms.training_plan.manage');
$$;

comment on function private.may_manage_training_plan(uuid) is
  'SECURITY-RELEVANT (WP-LD-02). The signed-in member holds tms.training_plan.manage organization-wide.';

create or replace function private.training_plan_units(p_tenant_id uuid, p_manage boolean)
returns uuid[]
language sql stable
set search_path = ''
as $$
  with recursive held (unit_id) as (
    select ra.scope_unit_id
    from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    join platform.custom_roles cr on cr.tenant_id = ra.tenant_id and cr.code = ra.role_code
    join platform.custom_role_permissions crp on crp.tenant_id = cr.tenant_id and crp.custom_role_id = cr.id
    join platform.departments d on d.tenant_id = ra.tenant_id and d.id = ra.scope_unit_id
    where private.request_claims() ->> 'role' = 'authenticated'
      and p_tenant_id = private.current_tenant_id()
      and ra.tenant_id = p_tenant_id and m.user_id = private.request_user_id() and m.status = 'active'
      and (ra.valid_from is null or ra.valid_from <= now())
      and (ra.valid_until is null or ra.valid_until > now())
      and cr.data_scope = 'departments'
      and d.deleted_at is null and d.status = 'active'
      and (crp.permission_code = 'tms.training_plan.manage'
           or (not p_manage and crp.permission_code = 'tms.training_plan.read'))
      and coalesce(private.tenant_plan_features(p_tenant_id) @> array['planning'], true)
  ),
  tree (unit_id, depth) as (
    select h.unit_id, 0 from held h
    union all
    select d.id, t.depth + 1
    from tree t
    join platform.departments d on d.tenant_id = p_tenant_id and d.parent_id = t.unit_id
    where d.deleted_at is null and t.depth < 20
  )
  select coalesce(array_agg(distinct t.unit_id), '{}'::uuid[]) from tree t;
$$;

comment on function private.training_plan_units(uuid, boolean) is
  'SECURITY-RELEVANT (WP-LD-02, FR-IAM-08). The units a department-limited custom role gives the signed-in member tms.training_plan.read/manage for (p_manage: manage only): its unit and every live unit below. Empty when none.';

revoke all on function private.may_read_training_plan(uuid) from public;
revoke all on function private.may_manage_training_plan(uuid) from public;
revoke all on function private.training_plan_units(uuid, boolean) from public;
grant execute on function private.may_read_training_plan(uuid),
                          private.may_manage_training_plan(uuid),
                          private.training_plan_units(uuid, boolean) to authenticated;
