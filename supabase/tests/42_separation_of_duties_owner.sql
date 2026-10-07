-- db-test: run-as=owner
-- Separation of duties (BR-IAM-4, T-M2-16: the Organization Admin holds no other role), as the owner: the
-- guards also bind platform operations and
-- invitation acceptance (invitation_guard); the existing-data check of migration 20261010090000 and
-- verify-deployment.sql. Also commits the fixture used by 43_separation_of_duties_app_server.sql:
--   tenant A  a4…0b  a PENDING invitation giving tenant_admin + hr_manager, learner for both@a.test ('tok-both'),
--                    written with the guard trigger disabled (as if it predated the rule); account uBoth
--                    (…fb, session sBoth) signed up after the e-mail.
-- Users in tenant A: uA = Organization Admin, uAB = HR Manager + learner, uInv = invited learner.
\set ON_ERROR_STOP on

-- ---- fixture (committed) ------------------------------------------------------------------------
begin;
insert into platform.persons (id, tenant_id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-0000000000ec', 'a0000000-0000-4000-8000-000000000001', 'كلا الدورين', 'both@a.test');
alter table platform.invitations disable trigger invitations_separation_of_duties;
insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, additional_roles, invited_by) values
  ('a4000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ec',
   'both@a.test', 'ar', 'tenant_admin', '{hr_manager,learner}', '00000000-0000-4000-8000-0000000000a1');
alter table platform.invitations enable trigger invitations_separation_of_duties;
update platform.invitations set token_hash = tests.token_hash('tok-both') where id = 'a4000000-0000-4000-8000-00000000000b';
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-0000000000fb', 'both@a.test', clock_timestamp() + interval '1 second');  -- uBoth
insert into auth.sessions (id, user_id, not_after) values
  ('10000000-0000-4000-8000-0000000000fb', '00000000-0000-4000-8000-0000000000fb', null);           -- sBoth
commit;

-- ---- catalog -----------------------------------------------------------------------------------
begin;
do $$
begin
  perform tests.assert_eq(
    (select array_agg(tgname::text order by tgname::text) from pg_trigger
     where tgrelid = 'platform.invitations'::regclass and not tgisinternal and tgenabled = 'O'),
    array['invitations_check', 'invitations_separation_of_duties'], 'invitations: triggers enabled');
  perform tests.assert(exists (select 1 from pg_trigger where tgrelid = 'platform.role_assignments'::regclass
                               and tgname = 'role_assignments_separation_of_duties' and tgenabled = 'O'
                               and tgfoid = 'private.check_role_separation()'::regprocedure),
    'role_assignments: separation-of-duties trigger enabled');
  -- Race safety: the role trigger takes the per-tenant role lock before it reads the other rows.
  perform tests.assert((select prosrc ~ 'lock_tenant_roles.*from platform\.role_assignments'
                        from pg_proc where oid = 'private.check_role_separation()'::regprocedure),
    'the role check serialises on the per-tenant lock before reading');
  -- The rule: tenant_admin conflicts with every other role; other roles combine freely.
  perform tests.assert_eq(
    (select string_agg(r.code, ',' order by r.sort_order) from platform.ref_roles r
     where private.roles_conflict('tenant_admin', r.code)),
    (select string_agg(r.code, ',' order by r.sort_order) from platform.ref_roles r where r.code <> 'tenant_admin'),
    'tenant_admin conflicts with every other system role');
  perform tests.assert(not exists (select 1 from platform.ref_roles a, platform.ref_roles b
                                   where a.code <> 'tenant_admin' and b.code <> 'tenant_admin'
                                     and private.roles_conflict(a.code, b.code)),
    'no other two roles conflict');
  perform tests.assert(not private.roles_conflict('tenant_admin', 'tenant_admin'), 'a role does not conflict with itself');
  perform tests.assert(private.roles_conflict('learner', 'tenant_admin'), 'symmetric');
  perform tests.assert(private.roles_include_conflict(array['tenant_admin', 'learner']), 'admin + learner');
  perform tests.assert(private.roles_include_conflict(array['hr_manager', 'learner', 'tenant_admin']), 'admin among others');
  perform tests.assert(not private.roles_include_conflict(array['tenant_admin']), 'admin alone');
  perform tests.assert(not private.roles_include_conflict(array['hr_manager', 'learner', 'finance_manager', 'auditor']), 'others together');
  perform tests.assert(not private.roles_include_conflict('{}'), 'no roles');
  -- Windows: overlapping from now on only.
  perform tests.assert(private.role_windows_overlap(null, null, null, null), 'open windows overlap');
  perform tests.assert(not private.role_windows_overlap(null, now() + interval '1 day', now() + interval '1 day', null),
    'a scheduled hand-over (one ends when the other starts) does not overlap');
  perform tests.assert(private.role_windows_overlap(null, now() + interval '1 day', now() + interval '1 hour', null),
    'one hour together overlaps');
  perform tests.assert(not private.role_windows_overlap(null, now() - interval '1 hour', null, null),
    'an ended role overlaps nothing');
  perform tests.assert(private.role_windows_overlap(now() + interval '1 month', null, null, null),
    'a role starting later overlaps an open one');
  -- Only the migration role reads the violation counts (they span every organization).
  perform tests.assert(not has_function_privilege('authenticated', 'private.separation_of_duties_violations()', 'execute')
                       and not has_function_privilege('invitation_guard', 'private.separation_of_duties_violations()', 'execute'),
    'separation_of_duties_violations: migration role only');
end $$;
rollback;

-- ---- platform operations and invitation acceptance are bound too ----------------------------------
begin;
do $$
declare
  v_admin uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a1' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
  v_hr uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
begin
  perform tests.assert_fails(format($q$insert into platform.role_assignments (tenant_id, membership_id, role_code) values ('a0000000-0000-4000-8000-000000000001', %L, 'hr_manager')$q$, v_admin),
    array['JR001'], 'platform operation: an Organization Admin cannot become HR Manager');
  perform tests.assert_fails(format($q$insert into platform.role_assignments (tenant_id, membership_id, role_code) values ('a0000000-0000-4000-8000-000000000001', %L, 'learner')$q$, v_admin),
    array['JR001'], 'platform operation: an Organization Admin cannot also be a learner');
  perform tests.assert_fails(format($q$insert into platform.role_assignments (tenant_id, membership_id, role_code) values ('a0000000-0000-4000-8000-000000000001', %L, 'tenant_admin')$q$, v_hr),
    array['JR001'], 'platform operation: an HR Manager cannot become Organization Admin');
  perform tests.assert_fails($q$insert into platform.invitations (tenant_id, person_id, email, locale, primary_role, additional_roles, invited_by) values ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000e6', 'notoken@a.test', 'ar', 'hr_manager', '{tenant_admin}', '00000000-0000-4000-8000-0000000000a1')$q$,
    array['JR001'], 'platform operation: no invitation gives both roles');
end $$;
-- As the acceptance functions run (invitation_guard, no claims): its privileges are enough for the check.
set local role invitation_guard;
select set_config('request.jwt.claims', '', true);
do $$
begin
  perform tests.assert_fails($q$insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary) select tenant_id, id, 'hr_manager', false from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a1' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$,
    array['JR001'], 'invitation_guard: refused with the rule, not with a missing privilege');
end $$;
reset role;
rollback;

-- ---- existing data: the counts of the migration's check and verify-deployment.sql ------------------
begin;
do $$
declare
  v record;
begin
  -- The committed fixture: one pending invitation giving both roles, nobody holding both.
  select * into v from private.separation_of_duties_violations();
  perform tests.assert_eq(row(v.members, v.pending_invitations)::text, row(0::bigint, 1::bigint)::text,
    'violations: the pending invitation of the fixture');
end $$;
-- Data that predates the rule (guard disabled): uAB also an Organization Admin; uInv with both roles but
-- one of them ended (history: no violation); an accepted / revoked invitation is history too.
alter table platform.role_assignments disable trigger role_assignments_separation_of_duties;
insert into platform.role_assignments (tenant_id, membership_id, role_code)
select tenant_id, id, 'tenant_admin' from platform.tenant_memberships
where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001';
insert into platform.role_assignments (tenant_id, membership_id, role_code, valid_from, valid_until)
select tenant_id, id, 'tenant_admin', now() - interval '2 days', now() - interval '1 day' from platform.tenant_memberships
where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001';
insert into platform.role_assignments (tenant_id, membership_id, role_code)
select tenant_id, id, 'hr_manager' from platform.tenant_memberships
where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001';
alter table platform.role_assignments enable trigger role_assignments_separation_of_duties;
update platform.invitations set status = 'revoked' where id = 'a4000000-0000-4000-8000-00000000000b';
do $$
declare
  v record;
begin
  select * into v from private.separation_of_duties_violations();
  perform tests.assert_eq(row(v.members, v.pending_invitations)::text, row(1::bigint, 0::bigint)::text,
    'violations: one member holds both (counted once); ended roles and revoked invitations are history');
end $$;
rollback;

\echo '42_separation_of_duties_owner: ok'
