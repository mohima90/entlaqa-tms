-- db-test: run-as=owner
-- Deactivate / reactivate a member (FR-IAM-05, T-M2-09): committed fixtures for 63 (request path, as
-- app_server) and 64 (sign-in refusal of the access-token hook), then the checks that need the owner
-- connection: the session-ending trigger for every writer (with the lock it shares with the organization
-- switch), the privileged-deactivation rule for platform operations, and the lock order of the people
-- responsibilities. 64 removes these fixtures again.
--   tenant A:  uX   learner (also an active learner in tenant B), heads department DX, manages pR, pR2
--                   (no login) and pP; sessions sX1, sX2 (A), sXB (B), sX0 (no organization selected)
--              uR   learner, reports to pX                    uP   Compliance Officer (privileged), reports to pX
--              uS   learner, deactivated (person inactive)    uSP  Auditor (privileged), deactivated
--              uA2  Organization Admin whose role ENDS in 30 days (the fixture admin uA has no end date)
--              uN   an account without membership; a pending invitation of A for its e-mail
--              uE   learner whose Auditor role ENDED yesterday     uF  learner with an Auditor role from in 10 days
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('9d000000-0000-4000-8000-000000000001', 'dx@a.test'),
  ('9d000000-0000-4000-8000-000000000002', 'dr@a.test'),
  ('9d000000-0000-4000-8000-000000000003', 'dp@a.test'),
  ('9d000000-0000-4000-8000-000000000004', 'ds@a.test'),
  ('9d000000-0000-4000-8000-000000000005', 'dsp@a.test'),
  ('9d000000-0000-4000-8000-000000000006', 'da2@a.test'),
  ('9d000000-0000-4000-8000-000000000007', 'dn@a.test'),
  ('9d000000-0000-4000-8000-000000000008', 'de@a.test'),
  ('9d000000-0000-4000-8000-000000000009', 'df@a.test');

insert into auth.sessions (id, user_id, not_after) values
  ('9d200000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', null), -- sX1 (A)
  ('9d200000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000001', null), -- sX2 (A)
  ('9d200000-0000-4000-8000-000000000003', '9d000000-0000-4000-8000-000000000001', null), -- sXB (B)
  ('9d200000-0000-4000-8000-000000000004', '9d000000-0000-4000-8000-000000000001', null), -- sX0 (none)
  ('9d200000-0000-4000-8000-000000000005', '9d000000-0000-4000-8000-000000000002', null), -- sR (A)
  ('9d200000-0000-4000-8000-000000000006', '9d000000-0000-4000-8000-000000000006', null), -- sA2 (A)
  ('9d200000-0000-4000-8000-000000000007', '9d000000-0000-4000-8000-000000000004', null); -- sS (A, deactivated)

insert into platform.persons (id, tenant_id, display_name_ar, email, status) values
  ('9d100000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001', 'معطَّل لاحقًا', 'dx@a.test', 'active'),
  ('9d100000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000001', 'معطَّل لاحقًا ب', 'dx@a.test', 'active'),
  ('9d100000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-000000000001', 'موظف تابع', 'dr@a.test', 'active'),
  ('9d100000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-000000000001', 'تابع بلا دخول', null, 'active'),
  ('9d100000-0000-4000-8000-0000000000a4', 'a0000000-0000-4000-8000-000000000001', 'مسؤول امتثال', 'dp@a.test', 'active'),
  ('9d100000-0000-4000-8000-0000000000a5', 'a0000000-0000-4000-8000-000000000001', 'معطَّل', 'ds@a.test', 'inactive'),
  ('9d100000-0000-4000-8000-0000000000a6', 'a0000000-0000-4000-8000-000000000001', 'مدقق معطَّل', 'dsp@a.test', 'inactive'),
  ('9d100000-0000-4000-8000-0000000000a7', 'a0000000-0000-4000-8000-000000000001', 'مدير منشأة مؤقت', 'da2@a.test', 'active'),
  ('9d100000-0000-4000-8000-0000000000a8', 'a0000000-0000-4000-8000-000000000001', 'مدعو بحساب', 'dn@a.test', 'active'),
  ('9d100000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-000000000001', 'مدقق سابق', 'de@a.test', 'active'),
  ('9d100000-0000-4000-8000-0000000000aa', 'a0000000-0000-4000-8000-000000000001', 'مدقق لاحقًا', 'df@a.test', 'active');

insert into platform.departments (id, tenant_id, code, name_ar, name_en, head_person_id) values
  ('9d300000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'DX', 'قسم يرأسه uX', 'Department DX',
   '9d100000-0000-4000-8000-0000000000a1'),
  -- uS (deactivated) was placed here; 63 deletes it to show that reactivation needs a live placement.
  ('9d300000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'DY', 'قسم سابق', 'Department DY', null);

insert into platform.person_employment (tenant_id, person_id, department_id, manager_person_id) values
  ('a0000000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a5', '9d300000-0000-4000-8000-000000000002', null),
  ('a0000000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a1', 'a3000000-0000-4000-8000-000000000001', null),
  ('a0000000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a2', '9d300000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a1'),
  ('a0000000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a3', '9d300000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a1'),
  ('a0000000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a4', '9d300000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a1');

insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a1', 'active'),
  ('b0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000b1', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000002', '9d100000-0000-4000-8000-0000000000a2', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000003', '9d100000-0000-4000-8000-0000000000a4', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000004', '9d100000-0000-4000-8000-0000000000a5', 'suspended'),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000005', '9d100000-0000-4000-8000-0000000000a6', 'suspended'),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000006', '9d100000-0000-4000-8000-0000000000a7', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000008', '9d100000-0000-4000-8000-0000000000a9', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000009', '9d100000-0000-4000-8000-0000000000aa', 'active');

insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary, valid_until)
select m.tenant_id, m.id, r.role_code, true, r.valid_until
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, '9d000000-0000-4000-8000-000000000001'::uuid, 'learner', null::timestamptz),
  ('b0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 'learner', null),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000002', 'learner', null),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000003', 'compliance_officer', null),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000004', 'learner', null),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000005', 'auditor', null),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000006', 'tenant_admin', now() + interval '30 days'),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000008', 'learner', null),
  ('a0000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000009', 'learner', null)
) as r (tenant_id, user_id, role_code, valid_until)
join platform.tenant_memberships m on m.tenant_id = r.tenant_id and m.user_id = r.user_id;
-- uE's Auditor role ended yesterday; uF's starts in 10 days (additional roles).
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary, valid_from, valid_until)
select m.tenant_id, m.id, 'auditor', false, r.valid_from, r.valid_until
from (values
  ('9d000000-0000-4000-8000-000000000008'::uuid, now() - interval '30 days', now() - interval '1 day'),
  ('9d000000-0000-4000-8000-000000000009', now() + interval '10 days', null::timestamptz)
) as r (user_id, valid_from, valid_until)
join platform.tenant_memberships m on m.user_id = r.user_id;

insert into platform.session_context (session_id, user_id, active_tenant_id) values
  ('9d200000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  ('9d200000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  ('9d200000-0000-4000-8000-000000000003', '9d000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001'),
  ('9d200000-0000-4000-8000-000000000005', '9d000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  ('9d200000-0000-4000-8000-000000000006', '9d000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001');

insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, invited_by) values
  ('9d400000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a8',
   'dn@a.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1');

-- Helpers for 63 (request path, as app_server — which may not create temporary functions) and 64.
-- SECURITY INVOKER; removed again by 64.
create or replace function tests.t09_as(p_who text, p_aal text default 'aal1') returns void
language sql as $$
  select tests.set_claims(case p_who
    -- Organization Admin of A (no end date) / HR Manager + learner of A / Organization Admin of A until
    -- 30 days from now / a learner of A (uR)
    when 'admin' then tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                        'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1')
    when 'hr' then tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                                     'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab')
    when 'admin2' then tests.user_claims('9d000000-0000-4000-8000-000000000006', '9d200000-0000-4000-8000-000000000006',
                                         'a0000000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a7')
    when 'learner' then tests.user_claims('9d000000-0000-4000-8000-000000000002', '9d200000-0000-4000-8000-000000000005',
                                          'a0000000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a2')
    -- uX acting in A, in B, and right after a new sign-in (no organization selected)
    when 'x_in_a' then tests.user_claims('9d000000-0000-4000-8000-000000000001', '9d200000-0000-4000-8000-000000000001',
                                         'a0000000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a1')
    when 'x_in_b' then tests.user_claims('9d000000-0000-4000-8000-000000000001', '9d200000-0000-4000-8000-000000000003',
                                         'b0000000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000b1')
    when 'x_signing_in' then tests.user_claims('9d000000-0000-4000-8000-000000000001', '9d200000-0000-4000-8000-000000000004', null)
    -- uS (deactivated) with a session that once acted in A
    when 'deactivated' then tests.user_claims('9d000000-0000-4000-8000-000000000004', '9d200000-0000-4000-8000-000000000007',
                                              'a0000000-0000-4000-8000-000000000001', '9d100000-0000-4000-8000-0000000000a5')
  end || jsonb_build_object('aal', p_aal));
$$;

-- The two writes of a deactivation as the request path does them (the application takes the locks and
-- moves the person's responsibilities first). Returns the memberships deactivated.
create or replace function tests.t09_deactivate(p_person uuid) returns bigint
language plpgsql as $$
declare
  v_rows bigint;
begin
  update platform.persons set status = 'inactive' where id = p_person and status = 'active';
  update platform.tenant_memberships set status = 'suspended' where person_id = p_person and status = 'active';
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- Does this transaction hold the advisory lock of `p_key` in `p_mode` (ShareLock / ExclusiveLock)?
create or replace function tests.t09_holds_lock(p_key text, p_mode text default 'ExclusiveLock') returns boolean
language sql as $$
  select exists (select 1 from pg_locks l
                 where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
                   and l.mode = p_mode and l.granted
                   and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended(p_key, 0));
$$;

grant execute on function tests.t09_as(text, text), tests.t09_deactivate(uuid), tests.t09_holds_lock(text, text)
  to public;

-- ---------------------------------------------------------------------------------------------------
-- Ending the member's sessions in the organization — for every writer (platform operations too)
-- ---------------------------------------------------------------------------------------------------
begin;
do $$
begin
  update platform.tenant_memberships set status = 'suspended'
  where user_id = '9d000000-0000-4000-8000-000000000001' and tenant_id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.assert_eq(
    (select array_agg(session_id::text order by session_id) from platform.session_context
     where user_id = '9d000000-0000-4000-8000-000000000001'),
    array['9d200000-0000-4000-8000-000000000003'],
    'the sessions acting in A end; the session acting in B stays (T-IAM-40)');
  perform tests.assert_eq((select count(*) from auth.sessions where user_id = '9d000000-0000-4000-8000-000000000001'),
    4::bigint, 'the Auth sessions themselves are untouched (no global sign-out from an organization)');
  perform tests.assert_eq((select count(*) from platform.session_context where user_id = '9d000000-0000-4000-8000-000000000002'),
    1::bigint, 'other members keep their sessions');
  perform tests.assert(tests.t09_holds_lock('platform.membership:a0000000-0000-4000-8000-000000000001:9d000000-0000-4000-8000-000000000001'),
    'ending the sessions takes the membership''s lock exclusively (an organization switch in flight is waited for)');
  perform tests.assert(not tests.t09_holds_lock('platform.membership:b0000000-0000-4000-8000-000000000001:9d000000-0000-4000-8000-000000000001'),
    'not the lock of the same login''s membership in B');
  -- Back to active: the old sessions do not come back (the member selects the organization again).
  update platform.tenant_memberships set status = 'active'
  where user_id = '9d000000-0000-4000-8000-000000000001' and tenant_id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.assert_eq((select count(*) from platform.session_context
                           where user_id = '9d000000-0000-4000-8000-000000000001'
                             and active_tenant_id = 'a0000000-0000-4000-8000-000000000001'),
    0::bigint, 'reactivation does not revive the ended sessions');
end $$;
rollback;

-- A status change that does not leave active takes no lock and ends nothing.
begin;
do $$
begin
  update platform.tenant_memberships set status = 'revoked'
  where user_id = '9d000000-0000-4000-8000-000000000004' and tenant_id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.assert(not tests.t09_holds_lock('platform.membership:a0000000-0000-4000-8000-000000000001:9d000000-0000-4000-8000-000000000004'),
    'suspended → revoked: no lock');
  perform tests.assert_eq((select count(*) from platform.session_context where user_id = '9d000000-0000-4000-8000-000000000004'),
    0::bigint, 'nothing to end');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Privileged members (review M4): the authenticator-code rule binds request-path deactivations only
-- (63); a platform operation without claims (an operator's provisioning fix) is not one.
-- ---------------------------------------------------------------------------------------------------
begin;
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_memberships set status = 'suspended' where user_id = '9d000000-0000-4000-8000-000000000003'$q$),
    1::bigint, 'platform operation: the privileged member is suspended without claims');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Lock order of the people responsibilities (T-M2-09): a new department head takes the person_employment
-- lock (as a new direct manager and as a deactivation do), after the branches lock.
-- ---------------------------------------------------------------------------------------------------
create or replace function pg_temp.holds_lock(p_key text) returns boolean language sql as $$
  select exists (select 1 from pg_locks l
                 where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
                   and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended(p_key, 0));
$$;

begin;
do $$
begin
  perform tests.assert(not pg_temp.holds_lock('platform.person_employment:a0000000-0000-4000-8000-000000000001'),
    'no lock held before');
  update platform.departments set name_en = 'Renamed' where id = '9d300000-0000-4000-8000-000000000001';
  perform tests.assert(not pg_temp.holds_lock('platform.person_employment:a0000000-0000-4000-8000-000000000001'),
    'a change that keeps the head takes no lock');
  update platform.departments set head_person_id = '9d100000-0000-4000-8000-0000000000a2'
  where id = '9d300000-0000-4000-8000-000000000001';
  perform tests.assert(pg_temp.holds_lock('platform.person_employment:a0000000-0000-4000-8000-000000000001'),
    'a new department head takes the person_employment lock of its organization');
  perform tests.assert(not pg_temp.holds_lock('platform.person_employment:b0000000-0000-4000-8000-000000000001'),
    'only its own organization''s lock');
end $$;
rollback;

begin;
do $$
begin
  perform private.lock_person_employment('a0000000-0000-4000-8000-000000000001');
  perform tests.assert(pg_temp.holds_lock('platform.person_employment:a0000000-0000-4000-8000-000000000001'),
    'private.lock_person_employment takes the same lock');
  perform tests.assert_fails($q$select private.lock_person_employment(null)$q$, array['42501'],
    'no organization: refused');
  -- The rule itself is unchanged: an inactive person never becomes head.
  perform tests.assert_fails($q$update platform.departments set head_person_id = '9d100000-0000-4000-8000-0000000000a5' where id = '9d300000-0000-4000-8000-000000000001'$q$,
    array['23514'], 'an inactive person cannot become head of a department');
  perform tests.assert(not has_function_privilege('anon', 'private.lock_person_employment(uuid)', 'execute')
                       and has_function_privilege('authenticated', 'private.lock_person_employment(uuid)', 'execute'),
    'the lock helper is for the request path only');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The reactivation function refuses every caller but app_server with user claims (here: the owner).
-- ---------------------------------------------------------------------------------------------------
begin;
do $$
begin
  perform tests.assert_fails($q$select private.reactivate_membership('9d100000-0000-4000-8000-0000000000a5')$q$,
    array['42501'], 'the owner connection is not app_server: refused');
  perform tests.assert_eq((select status from platform.tenant_memberships
                           where user_id = '9d000000-0000-4000-8000-000000000004'), 'suspended', 'nothing changed');
end $$;
rollback;

\echo '62_member_deactivation_owner: ok'
