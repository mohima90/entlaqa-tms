-- Planning cycles and planning settings are read by holders of the planning permissions only (security
-- review S-L3 of T-M3-04; FR-PLN-02, FR-WFL-01/02 R1 part; ADR 0003 §4). Class: T (read policies of
-- tms.plan_cycles, tms.plan_cycle_scope, tms.plan_cycle_departments, tms.plan_cycle_steps,
-- tms.planning_settings, tms.planning_default_steps). PII: none.
--
-- The read policies of 20261020150100 / 20261020150200 were `true` (every member of the organization; the
-- pages and actions asked for tms.plan_cycle.read). Budget envelopes and named approvers are not for every
-- employee: now a row is read only by a member holding tms.plan_cycle.read OR tms.plan_cycle.manage
-- organization-wide (private.may_read_plan_cycles: the L&D Manager, the Training Coordinator, custom roles
-- with them). System jobs read nothing here yet (no policy for their claims).
--
-- TODO(T-M3-05): Department Heads fill in their own department's needs form — that task adds a
-- DEPARTMENT-SCOPED read branch (the cycle and the plan_cycle_departments rows of the units they head, with
-- everything under them), next to the organization-wide one below.
--
-- The permission is the member's, not the row's: the policies call the helper once per statement (an
-- initPlan on the claims' organization — the restrictive tenant_isolation policy already limits every row
-- to that organization).

create or replace function private.may_read_plan_cycles(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_claims() ->> 'role' = 'authenticated'
         and (private.member_has_permission(p_tenant_id, private.request_user_id(), 'tms.plan_cycle.read')
              or private.member_has_permission(p_tenant_id, private.request_user_id(), 'tms.plan_cycle.manage'));
$$;

comment on function private.may_read_plan_cycles(uuid) is
  'SECURITY-RELEVANT (EP-PLN, S-L3). The signed-in member holds tms.plan_cycle.read or tms.plan_cycle.manage organization-wide (reads of planning cycles and settings).';

revoke all on function private.may_read_plan_cycles(uuid) from public;
grant execute on function private.may_read_plan_cycles(uuid) to authenticated;

drop policy plan_cycles_read on tms.plan_cycles;
create policy plan_cycles_read on tms.plan_cycles for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id()))));

drop policy plan_cycle_scope_read on tms.plan_cycle_scope;
create policy plan_cycle_scope_read on tms.plan_cycle_scope for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id()))));

drop policy plan_cycle_departments_read on tms.plan_cycle_departments;
create policy plan_cycle_departments_read on tms.plan_cycle_departments for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id()))));

drop policy plan_cycle_steps_read on tms.plan_cycle_steps;
create policy plan_cycle_steps_read on tms.plan_cycle_steps for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id()))));

drop policy planning_settings_read on tms.planning_settings;
create policy planning_settings_read on tms.planning_settings for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id()))));

drop policy planning_default_steps_read on tms.planning_default_steps;
create policy planning_default_steps_read on tms.planning_default_steps for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id()))));
