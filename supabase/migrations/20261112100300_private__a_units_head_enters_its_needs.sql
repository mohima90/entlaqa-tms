-- A unit's head enters its training needs whatever their role (WP-FIX-03, T-M3-18; FR-PLN-03, FR-MGR-05;
-- PO 12 Nov 2026: «نسمح له طبعا» — the head of a department enters its needs even when they hold another
-- role, e.g. the HR Manager who heads Human Resources). Class: authorization rule (function only; no schema
-- or data change). PII: none.
--
-- Until now private.may_submit_plan_needs required a role that carries tms.plan_needs.submit (the Department
-- Head role) AND being the department's effective head. A person holds ONE role (EP-ROLES), so a head who
-- holds another role — or who accepted their invitation as an Employee before they were picked — could not
-- enter their department's needs (review M1 / L1 of WP-FIX-03). The right now comes from the structure alone:
--   * an ACTIVE member of the organization,
--   * whose organization's plan includes planning,
--   * who is the department's EFFECTIVE head (its own head, else the nearest head above; a unit with its own
--     head belongs to that head — private.plan_department_head, unchanged).
-- Who picks heads is unchanged (platform.org.manage; private.check_department_writer), so nobody gains the
-- right by themselves. Every other rule of needs entry (cycle open, deadline, submitted, caps) is unchanged:
-- they sit in the guards and policies that call this function (20261105100100).
-- Expand-first: the previous release asks the same function; its Department Heads keep entering.
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
           from platform.tenant_memberships m
           where m.tenant_id = p_tenant_id and m.user_id = private.request_user_id()
             and m.person_id = private.request_person_id() and m.status = 'active')
         and coalesce(private.tenant_plan_features(p_tenant_id) @> array['planning'], true)
         and private.plan_department_head(p_tenant_id, p_department_id) = private.request_person_id();
$$;
comment on function private.may_submit_plan_needs(uuid, uuid) is
  'SECURITY-RELEVANT (WP-LD-01; WP-FIX-03, PO 12 Nov 2026). The signed-in active member is the department''s effective head, whatever their role; the plan includes planning.';

revoke all on function private.may_submit_plan_needs(uuid, uuid) from public;
grant execute on function private.may_submit_plan_needs(uuid, uuid) to authenticated;
