-- Rollback of 20261115100100_private__training_plan_scope.sql: the helpers go and the feature map is the one of
-- 20261105100100_tms__plan_needs.sql again.

drop function private.training_plan_units(uuid, boolean);
drop function private.may_manage_training_plan(uuid);
drop function private.may_read_training_plan(uuid);

create or replace function private.permission_feature(p_permission text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when p_permission like 'tms.plan\_cycle.%' or p_permission like 'tms.plan\_needs.%' then 'planning'
    when p_permission like 'tms.needs\_form.%' then 'needs_forms'
    when p_permission like 'tms.course.%' or p_permission like 'tms.course\_cost.%' then 'courses'
  end;
$$;
