-- db-test: run-as=app_server
-- Role assignments (T-M2-03, FR-IAM-07, BR-IAM-1): who may change which roles (database guard), one
-- primary role, revoked memberships, last Organization Admin, stamping. Runs CONNECTED AS app_server.
-- Users in tenant A: uA = Organization Admin, uAB = HR Manager + learner, uInv = invited learner.
\set ON_ERROR_STOP on

-- Organization Admin (uA).
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  v_inv uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
  v_self uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a1' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
  r record;
begin
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.role_assignments (membership_id, role_code, created_by) values (%L, 'auditor', 'b1000000-0000-4000-8000-0000000000b1')$q$, v_inv)),
    1::bigint, 'admin: can give a privileged role');
  select * into r from platform.role_assignments where membership_id = v_inv and role_code = 'auditor';
  perform tests.assert_eq(r.created_by, 'a1000000-0000-4000-8000-0000000000a1'::uuid, 'stamp: created_by from the claims');
  perform tests.assert_fails_like(format($q$insert into platform.role_assignments (membership_id, role_code) values (%L, 'learner')$q$, v_self),
    'members cannot change their own roles', 'admin: cannot give themself a role');
  perform tests.assert_fails_like(format($q$delete from platform.role_assignments where membership_id = %L$q$, v_self),
    'members cannot change their own roles', 'admin: cannot remove their own roles');
  perform tests.assert_fails(format($q$insert into platform.role_assignments (membership_id, role_code, is_primary) values (%L, 'mentor', true)$q$, v_inv),
    array['23505'], 'BR-IAM-1: at most one primary role per member');
  perform tests.assert_fails(format($q$insert into platform.role_assignments (membership_id, role_code) values (%L, 'learner')$q$, v_inv),
    array['23505'], 'a role is held once per member');
  perform tests.assert_fails(format($q$insert into platform.role_assignments (membership_id, role_code) values (%L, 'platform_super_admin')$q$, v_inv),
    array['23503'], 'only system roles from ref_roles exist (no Platform Super Admin in tenants)');
  perform tests.assert_check_constraint(format($q$insert into platform.role_assignments (membership_id, role_code, valid_from, valid_until) values (%L, 'mentor', now(), now() - interval '1 day')$q$, v_inv),
    'role_assignments_validity_check', 'validity window must end after it starts');

  update platform.tenant_memberships set status = 'revoked' where id = v_inv;
  perform tests.assert_fails(format($q$insert into platform.role_assignments (membership_id, role_code) values (%L, 'mentor')$q$, v_inv),
    array['23514'], 'roles cannot be given to a revoked membership');
end $$;
rollback;

-- HR Manager (uAB): ordinary roles only.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
declare
  v_inv uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
  v_admin uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a1' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
begin
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.role_assignments (membership_id, role_code) values (%L, 'training_coordinator')$q$, v_inv)),
    1::bigint, 'HR: can give an ordinary role');
  perform tests.assert_eq(tests.rows_affected(format($q$delete from platform.role_assignments where membership_id = %L and role_code = 'training_coordinator'$q$, v_inv)),
    1::bigint, 'HR: can remove an ordinary role');
  perform tests.assert_fails_like(format($q$insert into platform.role_assignments (membership_id, role_code) values (%L, 'tenant_admin')$q$, v_inv),
    'only an Organization Admin can give or remove the role tenant_admin', 'HR: cannot create an Organization Admin');
  perform tests.assert_fails_like(format($q$insert into platform.role_assignments (membership_id, role_code) values (%L, 'hr_manager')$q$, v_inv),
    'only an Organization Admin can give or remove the role hr_manager', 'HR: cannot create another HR Manager (privileged)');
  perform tests.assert_fails_like(format($q$delete from platform.role_assignments where membership_id = %L$q$, v_admin),
    'only an Organization Admin can give or remove the role tenant_admin', 'HR: cannot remove the Organization Admin role');
  perform tests.assert_fails_like(format($q$update platform.role_assignments set valid_until = now() + interval '1 day' where membership_id = %L$q$, v_admin),
    'only an Organization Admin can give or remove the role tenant_admin', 'HR: cannot limit the Organization Admin role either');
  perform tests.assert_fails_like($q$update platform.role_assignments set is_primary = false where role_code = 'learner' and membership_id = (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001')$q$,
    'members cannot change their own roles', 'HR: cannot change their own roles');
end $$;
rollback;

-- A member without a user-management role cannot change roles at all.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
delete from platform.role_assignments
 where role_code = 'hr_manager'
   and membership_id = (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_fails_like($q$insert into platform.role_assignments (membership_id, role_code) select id, 'mentor' from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$,
    'only an Organization Admin or an HR Manager can give or remove roles', 'learner: cannot give roles');
end $$;
rollback;

-- The last active Organization Admin is kept: an admin role with an end date does not count, so end
-- dates cannot be used to leave the organization without an admin later (T-IAM-38).
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
insert into platform.role_assignments (membership_id, role_code, valid_until)
select id, 'tenant_admin', now() + interval '1 hour' from platform.tenant_memberships
where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001';
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
declare
  v_admin uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a1' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
begin
  perform tests.assert_fails(format($q$update platform.role_assignments set valid_until = now() + interval '1 hour' where membership_id = %L and role_code = 'tenant_admin'$q$, v_admin),
    array['23514'], 'last admin: the only open-ended admin role cannot get an end date');
  perform tests.assert_fails(format($q$delete from platform.role_assignments where membership_id = %L and role_code = 'tenant_admin'$q$, v_admin),
    array['23514'], 'last admin: the only open-ended admin role cannot be removed');
  perform tests.assert_fails(format($q$update platform.tenant_memberships set status = 'suspended' where id = %L$q$, v_admin),
    array['23514'], 'last admin: the only open-ended admin cannot be suspended');
end $$;
rollback;

-- Membership changes (invite, suspend, revoke) follow the same rules as roles (T-IAM-35).
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_fails_like($q$update platform.tenant_memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-0000000000a1' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$,
    'only an Organization Admin can change a member who holds a privileged role', 'HR: cannot suspend an Organization Admin');
  perform tests.assert_fails_like($q$update platform.tenant_memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$,
    'members cannot change their own membership', 'HR: cannot change their own membership');
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_memberships set status = 'revoked' where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'HR: can revoke an ordinary member''s invitation');
  perform tests.assert_fails_like($q$insert into platform.role_assignments (membership_id, role_code, is_primary) select id, 'tenant_admin', false from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a1' and tenant_id = 'a0000000-0000-4000-8000-000000000001' on conflict (tenant_id, membership_id, role_code) do update set is_primary = false$q$,
    'only an Organization Admin can give or remove the role tenant_admin', 'HR: upsert onto an admin row is refused too');
end $$;
rollback;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
delete from platform.role_assignments
 where role_code = 'hr_manager'
   and membership_id = (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_fails_like($q$update platform.tenant_memberships set status = 'revoked' where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$,
    'only an Organization Admin or an HR Manager can invite or change members', 'learner: cannot revoke members');
  perform tests.assert_fails_like($q$insert into platform.tenant_memberships (user_id, person_id) values ('00000000-0000-4000-8000-0000000000e1', 'a1000000-0000-4000-8000-0000000000a3')$q$,
    'only an Organization Admin or an HR Manager can invite or change members', 'learner: cannot invite');
end $$;
rollback;

-- Guards refuse other isolation levels (the per-tenant lock relies on READ COMMITTED).
begin isolation level repeatable read;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_fails($q$insert into platform.role_assignments (membership_id, role_code) select id, 'mentor' from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$,
    array['0A000'], 'role changes are refused outside READ COMMITTED');
end $$;
rollback;

-- Trigger order and guard source (serialised per tenant).
begin;
set local role authenticated;
do $$
begin
  perform tests.assert_eq(
    (select array_agg(tgname::text order by tgname::text) from pg_trigger where tgrelid = 'platform.role_assignments'::regclass and not tgisinternal),
    array['role_assignments_guard', 'role_assignments_keep_admin', 'role_assignments_stamp_row'], 'role_assignments: triggers');
  perform tests.assert((select prosrc ilike '%pg_advisory_xact_lock%' from pg_proc where oid = 'private.lock_tenant_roles(uuid)'::regprocedure),
    'role changes are serialised per tenant');
end $$;
rollback;

\echo '24_roles: ok'
