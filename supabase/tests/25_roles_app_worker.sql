-- db-test: run-as=app_worker
-- Role assignments under SYSTEM claims (T-M2-03): jobs may manage ordinary roles and invitations, but
-- never privileged roles or privileged members. Runs CONNECTED AS app_worker.
\set ON_ERROR_STOP on

begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.role_assignments where membership_id = (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001')$q$),
    1::bigint, 'system job: can remove an ordinary role');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.role_assignments (membership_id, role_code) select id, 'training_coordinator' from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'system job: can give a role');
  perform tests.assert((select created_by is null from platform.role_assignments where role_code = 'training_coordinator'),
    'system job: no person stamped');
  -- A custom role with a high-risk permission is privileged (EP-ROLES): never given by a job.
  delete from platform.role_assignments where role_code = 'training_coordinator';
  perform tests.assert_fails_like($q$insert into platform.custom_role_permissions (custom_role_id, permission_code) values ('a6000000-0000-4000-8000-000000000001', 'platform.audit.read')$q$,
    'system jobs cannot change roles', 'system job: cannot change a custom role');
  perform tests.assert_fails_like($q$insert into platform.custom_roles (name_en, name_ar, data_scope) values ('Job role', 'دور', 'own')$q$,
    'system jobs cannot change roles', 'system job: cannot create a custom role');
  perform tests.assert_fails_like($q$delete from platform.role_assignments where role_code = 'tenant_admin'$q$,
    'system jobs cannot give or remove the role tenant_admin', 'system job: cannot remove an Organization Admin role');
  perform tests.assert_fails_like($q$insert into platform.role_assignments (membership_id, role_code) select id, 'tenant_admin' from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$,
    'system jobs cannot give or remove the role tenant_admin', 'system job: cannot create an Organization Admin');
  perform tests.assert_fails_like($q$update platform.tenant_memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$,
    'system jobs cannot change a member who holds a privileged role', 'system job: cannot suspend a privileged member');
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_memberships set status = 'revoked' where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'system job: can expire an ordinary invitation');
end $$;
rollback;

\echo '25_roles_app_worker: ok'
