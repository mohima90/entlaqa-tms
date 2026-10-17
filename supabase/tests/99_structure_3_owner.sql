-- db-test: run-as=owner
-- Department-limited roles whose scope changed anyway (C-M1, 20261020210500), as platform operations: the
-- scope guard (JR004) applies to every writer; with it switched off (as only a superuser could), what is left
-- behind fails safe — acceptance drops a unit the role no longer takes (a), and a unit is "still a role's
-- scope" only for roles that are still department-limited (c). Uses uScope (custom_a000000c9001 with OPS,
-- accepted and committed in 99_structure_2_app_server.sql) and uM (…f7, an active member of A with no role).
-- Every block is rolled back.
\set ON_ERROR_STOP on

begin;
do $$
declare
  v_unit uuid;
  v_member uuid;
begin
  perform tests.assert_fails_state_like($q$update platform.custom_roles set data_scope = 'organization' where code = 'custom_a000000c9001'$q$,
    'JR004', 'the role is still given for units: 1 member(s), 0 pending invitation(s)', 'platform operations keep the scope too');

  insert into platform.departments (tenant_id, code, name_ar)
  values ('a0000000-0000-4000-8000-000000000001', 'C-M1', 'وحدة الاختبار') returning id into v_unit;
  select id into v_member from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000f7';
  insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary, scope_unit_id)
  values ('a0000000-0000-4000-8000-000000000001', v_member, 'custom_a000000c9001', true, v_unit);
  perform tests.assert_fails(format($q$update platform.departments set deleted_at = now() where id = %L$q$, v_unit),
    array['23514'], 'a unit given with a department-limited role is not deleted');

  -- (c) The role's scope moved anyway (guard off): the unit is no longer anyone's scope.
  alter table platform.custom_roles disable trigger custom_roles_scope_units;
  update platform.custom_roles set data_scope = 'organization' where code = 'custom_a000000c9001';
  alter table platform.custom_roles enable trigger custom_roles_scope_units;
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.departments set deleted_at = now() where id = %L$q$, v_unit)),
    1::bigint, '(c) a unit held only by roles no longer limited to a department is deleted');

  -- (a) Acceptance (the acceptance function's role) drops a unit the role no longer takes instead of failing.
  delete from platform.role_assignments where tenant_id = 'a0000000-0000-4000-8000-000000000001' and membership_id = v_member;
  set local role invitation_guard;
  insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary, scope_unit_id)
  values ('a0000000-0000-4000-8000-000000000001', v_member, 'custom_a000000c9001', true,
          'a3000000-0000-4000-8000-000000000003');
  reset role;
  perform tests.assert((select scope_unit_id is null from platform.role_assignments
                        where tenant_id = 'a0000000-0000-4000-8000-000000000001' and membership_id = v_member),
    '(a) the role is given without the unit');
end $$;
rollback;

\echo '99_structure_3_owner: ok'
