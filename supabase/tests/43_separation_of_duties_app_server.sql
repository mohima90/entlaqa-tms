-- db-test: run-as=app_server
-- Separation of duties on the request path (BR-IAM-4, T-M2-16; PO decisions 7 and 8 Oct 2026): the
-- Organization Admin (tenant_admin) holds no other role — giving any role to an Organization Admin, or
-- tenant_admin to a holder of any role, is refused with SQLSTATE JR001, by role changes and invitations;
-- other roles combine freely; the rule is per organization; actor rules and tenant isolation come first.
-- Runs CONNECTED AS app_server.
-- Tenant A: uA = Organization Admin, uAB = HR Manager + learner, uInv = invited learner, uSus = suspended
-- (no role), uM = member without a role (35). Tenant B: uB = Organization Admin, uAB = member without a
-- role. Invitation a4…0b gives tenant_admin + hr_manager, learner (fixture of 42, predates the rule).
-- Concurrency: both triggers serialise on the per-tenant role lock (asserted in 42); the TypeScript
-- integration test (role-admin.integration.test.ts) runs two transactions at once.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- ---------------------------------------------------------------------------------------------------
-- Role changes by the Organization Admin (uA)
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  m_hr uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
  m_inv uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
  m_m uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000f7' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
  m_sus uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a3' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
  ins constant text := $q$insert into platform.role_assignments (membership_id, role_code, valid_from, valid_until) values (%L, %L, %s, %s)$q$;
begin
  perform tests.assert_fails(format(ins, m_hr, 'tenant_admin', 'null', 'null'),
    array['JR001'], 'an HR Manager (+ learner) cannot also become Organization Admin');
  perform tests.assert_fails(format(ins, m_inv, 'tenant_admin', 'null', 'null'),
    array['JR001'], 'a learner cannot also become Organization Admin');
  perform tests.assert_fails(format(ins, m_hr, 'tenant_admin', $e$now() + interval '1 year'$e$, 'null'),
    array['JR001'], 'not even from a later date (both held then)');
  perform tests.assert_eq(tests.rows_affected(format(ins, m_sus, 'tenant_admin', 'null', 'null')), 1::bigint,
    'a member without a role becomes Organization Admin');
  perform tests.assert_fails(format(ins, m_sus, 'learner', 'null', 'null'),
    array['JR001'], 'the Organization Admin cannot also be a learner');
  perform tests.assert_fails(format(ins, m_sus, 'training_manager', 'null', 'null'),
    array['JR001'], 'nor a Training Manager');
  perform tests.assert_fails(format(ins, m_sus, 'hr_manager', 'null', 'null'),
    array['JR001'], 'nor an HR Manager');
  perform tests.assert_fails(format(ins, m_sus, 'auditor', 'null', $e$now() + interval '1 hour'$e$),
    array['JR001'], 'not even for an hour');
  -- Every other combination stays allowed, privileged roles included.
  perform tests.assert_eq(tests.rows_affected(format(ins, m_m, 'hr_manager', 'null', 'null'))
                          + tests.rows_affected(format(ins, m_m, 'learner', 'null', 'null'))
                          + tests.rows_affected(format(ins, m_m, 'compliance_officer', 'null', 'null'))
                          + tests.rows_affected(format(ins, m_m, 'finance_manager', 'null', 'null'))
                          + tests.rows_affected(format(ins, m_hr, 'auditor', 'null', 'null'))
                          + tests.rows_affected(format(ins, m_hr, 'training_manager', 'null', 'null')),
    6::bigint, 'HR Manager + learner and any other roles together are allowed');
  -- A hand-over: the other roles are removed, then the Organization Admin role given (the order in which
  -- the application writes a change: removals first).
  perform tests.assert_eq(tests.rows_affected(format($q$delete from platform.role_assignments where membership_id = %L$q$, m_hr)),
    4::bigint, 'all roles of uAB removed');
  perform tests.assert_eq(tests.rows_affected(format(ins, m_hr, 'tenant_admin', 'null', 'null')), 1::bigint,
    'then the Organization Admin role can be given');
end $$;
reset role;
rollback;

-- Validity windows: a scheduled hand-over is allowed; overlapping (also by a later change) is not; an
-- ended role is history.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  m_sus uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a3' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
  m_m uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000f7' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
  ins constant text := $q$insert into platform.role_assignments (membership_id, role_code, valid_from, valid_until) values (%L, %L, %s, %s)$q$;
begin
  perform tests.assert_eq(tests.rows_affected(format(ins, m_sus, 'tenant_admin', 'null', $e$date_trunc('day', now()) + interval '2 days'$e$))
                          + tests.rows_affected(format(ins, m_sus, 'learner', $e$date_trunc('day', now()) + interval '2 days'$e$, 'null'))
                          + tests.rows_affected(format(ins, m_sus, 'training_manager', $e$date_trunc('day', now()) + interval '2 days'$e$, 'null')),
    3::bigint, 'scheduled hand-over: Organization Admin until the day the other roles start');
  perform tests.assert_fails(format($q$update platform.role_assignments set valid_from = now() + interval '1 hour' where membership_id = %L and role_code = 'learner'$q$, m_sus),
    array['JR001'], 'moving a start earlier into the admin period is refused');
  perform tests.assert_fails(format($q$update platform.role_assignments set valid_until = null where membership_id = %L and role_code = 'tenant_admin'$q$, m_sus),
    array['JR001'], 'extending the admin period into the other roles'' period is refused');

  perform tests.assert_eq(tests.rows_affected(format(ins, m_m, 'tenant_admin', $e$now() - interval '2 days'$e$, $e$now() - interval '1 day'$e$))
                          + tests.rows_affected(format(ins, m_m, 'learner', 'null', 'null')),
    2::bigint, 'an ended Organization Admin role (history) does not stop holding other roles');
  perform tests.assert_fails(format($q$update platform.role_assignments set valid_until = null where membership_id = %L and role_code = 'tenant_admin'$q$, m_m),
    array['JR001'], 'the ended role cannot be revived while holding another role');
end $$;
reset role;
rollback;

-- One statement writing conflicting rows (security review L4): the second row's check sees the
-- first row written by the same statement.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  m_m uuid := (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000f7' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
begin
  perform tests.assert_fails(format($q$insert into platform.role_assignments (membership_id, role_code) values (%L, 'tenant_admin'), (%L, 'hr_manager')$q$, m_m, m_m),
    array['JR001'], 'one multi-row INSERT giving tenant_admin and hr_manager is refused');
  perform tests.assert_fails(format($q$insert into platform.role_assignments (membership_id, role_code) values (%L, 'learner'), (%L, 'tenant_admin')$q$, m_m, m_m),
    array['JR001'], 'one multi-row INSERT giving learner and tenant_admin is refused');
  -- A scheduled hand-over, then ONE update that makes both windows overlap.
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.role_assignments (membership_id, role_code, valid_from, valid_until) values (%L, 'tenant_admin', null, date_trunc('day', now()) + interval '30 days'), (%L, 'learner', date_trunc('day', now()) + interval '30 days', null)$q$, m_m, m_m)),
    2::bigint, 'a scheduled hand-over in one multi-row INSERT is allowed');
  perform tests.assert_fails(format($q$update platform.role_assignments set valid_from = null, valid_until = null where membership_id = %L and role_code in ('tenant_admin', 'learner')$q$, m_m),
    array['JR001'], 'one UPDATE opening both windows is refused');
  perform tests.assert_fails(format($q$update platform.role_assignments set valid_until = case role_code when 'tenant_admin' then date_trunc('day', now()) + interval '60 days' else valid_until end, valid_from = case role_code when 'learner' then date_trunc('day', now()) + interval '45 days' else valid_from end where membership_id = %L and role_code in ('tenant_admin', 'learner')$q$, m_m),
    array['JR001'], 'one UPDATE moving both ends so they overlap is refused');
end $$;
reset role;
rollback;

-- Actor rules come first: an HR Manager is refused for giving a privileged role (42501), whoever holds what.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_fails_like($q$insert into platform.role_assignments (membership_id, role_code) select id, 'tenant_admin' from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000f4' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$,
    'only an Organization Admin can%', 'HR: refused as an actor before the separation rule');
end $$;
reset role;
rollback;

-- Tenant isolation is unaffected: another organization's member is refused by row-level security (not by
-- the separation rule, which cannot see that organization's roles).
begin;
set local role authenticated;
-- The membership id of B's Organization Admin, read as B (A cannot see it).
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
  'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
select set_config('tests.b_admin_membership', (select id::text from platform.tenant_memberships
  where user_id = '00000000-0000-4000-8000-0000000000b1' and tenant_id = 'b0000000-0000-4000-8000-000000000001'), true);
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_rls_violation(format($q$insert into platform.role_assignments (tenant_id, membership_id, role_code) values ('b0000000-0000-4000-8000-000000000001', %L, 'hr_manager')$q$,
      current_setting('tests.b_admin_membership')),
    'A cannot give B''s Organization Admin the HR Manager role: row-level security, not the separation rule');
end $$;
reset role;
rollback;

-- The rule is per organization: uAB, HR Manager + learner in A, may be the Organization Admin of B.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
  'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.role_assignments (membership_id, role_code) select id, 'tenant_admin' from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'B: the HR Manager of A becomes Organization Admin of B');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Invitations (uA): the Organization Admin role alone; other combinations allowed.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
insert into platform.persons (id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-0000000000d6', 'جديد ٦', 'new6@a.test'),
  ('a1000000-0000-4000-8000-0000000000d7', 'جديد ٧', 'new7@a.test');
do $$
declare
  ins constant text := $q$insert into platform.invitations (person_id, email, locale, primary_role, additional_roles)
    values ('a1000000-0000-4000-8000-0000000000%s', %L, 'ar', %L, %L)$q$;
begin
  perform tests.assert_fails(format(ins, 'd6', 'new6@a.test', 'tenant_admin', '{hr_manager}'),
    array['JR001'], 'invitation: Organization Admin + HR Manager refused');
  perform tests.assert_fails(format(ins, 'd6', 'new6@a.test', 'tenant_admin', '{learner}'),
    array['JR001'], 'invitation: Organization Admin + learner refused');
  perform tests.assert_fails(format(ins, 'd6', 'new6@a.test', 'tenant_admin', '{finance_manager,auditor}'),
    array['JR001'], 'invitation: Organization Admin + other privileged roles refused');
  perform tests.assert_fails(format(ins, 'd6', 'new6@a.test', 'learner', '{tenant_admin}'),
    array['JR001'], 'invitation: learner + Organization Admin (additional) refused');
  perform tests.assert_eq(tests.rows_affected(format(ins, 'd6', 'new6@a.test', 'tenant_admin', '{}'))
                          + tests.rows_affected(format(ins, 'd7', 'new7@a.test', 'hr_manager', '{learner,compliance_officer}')),
    2::bigint, 'invitation: the Organization Admin role alone, and other roles together, are allowed');
end $$;
reset role;
rollback;

-- An invitation giving tenant_admin with other roles that predates the rule (a4…0b): its link reads invalid and acceptance fails.
begin;
set local role authenticated;
select tests.set_claims(null);
do $$ begin
  perform tests.assert_eq((select row(x.*)::text from private.invitation_by_token(tests.token_hash('tok-both')) x),
    row('invalid', null, null, null, null, null, null)::text, 'link giving tenant_admin with other roles: invalid, no details');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000fb', '10000000-0000-4000-8000-0000000000fb', null));
do $$ begin
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-both'))$q$,
    array['JI001'], 'acceptance of an invitation giving tenant_admin with other roles is refused');
end $$;
reset role;
rollback;

\echo '43_separation_of_duties_app_server: ok'
