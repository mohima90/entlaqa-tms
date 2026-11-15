-- Who reaches the draft sessions, and for which departments (WP-LD-04, T-M3-08; FR-PLN-09, FR-SCH-01 core, FR-IAM-08
-- R1 note; proposal docs/product/proposals/wp-ld-04-plan-to-courses-and-draft-sessions.md §3: only the L&D team sees
-- drafts). Class: authorization helpers (functions only; no table, column or data change). PII: none.
--
--   private.may_manage_sessions  the signed-in member holds tms.session.manage ORGANIZATION-WIDE (the L&D Manager, the
--                                Training Coordinator, or a custom role whose scope is the whole organization;
--                                private.member_permissions)
--   private.session_units        the units a DEPARTMENT-LIMITED custom role gives the member tms.session.manage for:
--                                the unit picked when the role was given (platform.role_assignments.scope_unit_id;
--                                live and active, as the application's grant loader reads it) and every live unit
--                                below it. Empty when none. In the caller's organization only, signed-in members only.
-- The same shape as private.may_manage_training_plan / private.training_plan_units (migration 20261115100100); the
-- application decides the same way (packages/platform-rbac grantsForAssignments: «assigned_unit» → the unit and its
-- descendants). tms.session.manage belongs to no plan feature (private.permission_feature answers null): drafts only
-- exist where an approved training plan does. SECURITY INVOKER: they read the caller's own role assignments and
-- custom roles and the structure, which every member may read.
-- Expand-first: new functions; nothing calls them before the application does.

create or replace function private.may_manage_sessions(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  -- Never null: no claims is a plain «no».
  select coalesce(private.request_claims() ->> 'role' = 'authenticated'
                  and private.member_has_permission(p_tenant_id, private.request_user_id(), 'tms.session.manage'),
                  false);
$$;

comment on function private.may_manage_sessions(uuid) is
  'SECURITY-RELEVANT (WP-LD-04). The signed-in member holds tms.session.manage organization-wide (sees and changes every draft session).';

create or replace function private.session_units(p_tenant_id uuid)
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
      and crp.permission_code = 'tms.session.manage'
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

comment on function private.session_units(uuid) is
  'SECURITY-RELEVANT (WP-LD-04, FR-IAM-08). The units a department-limited custom role gives the signed-in member tms.session.manage for: its unit and every live unit below. Empty when none.';

revoke all on function private.may_manage_sessions(uuid) from public;
revoke all on function private.session_units(uuid) from public;
grant execute on function private.may_manage_sessions(uuid), private.session_units(uuid) to authenticated;
