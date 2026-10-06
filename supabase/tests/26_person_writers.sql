-- db-test: run-as=app_server
-- Who may write person records (TM-0004 F-PEO-01; FR-IAM-01, FR-IAM-16 My profile): user managers write
-- any person and placement; every other member only their own personal details. Runs CONNECTED AS
-- app_server. Each block is rolled back.
\set ON_ERROR_STOP on

begin;
set local role authenticated;
-- uA (Organization Admin) takes uAB's HR Manager role away: uAB is then an ordinary member (learner).
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
delete from platform.role_assignments ra using platform.tenant_memberships m
where m.id = ra.membership_id and m.user_id = '00000000-0000-4000-8000-0000000000ab' and ra.role_code = 'hr_manager';

select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
declare
  r record;
begin
  perform tests.assert(not private.actor_manages_users('a0000000-0000-4000-8000-000000000001'), 'uAB no longer manages users');
  perform tests.assert(not private.actor_may_manage_person('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a2'),
    'member: may manage nobody');

  -- My profile: own names, mobile and language.
  perform tests.assert_eq(tests.rows_affected($q$update platform.persons set first_name_ar = 'سارة', family_name_ar = 'القحطاني',
      display_name_ar = 'سارة القحطاني', first_name_en = 'Sarah', display_name_en = 'Sarah Alqahtani',
      mobile_e164 = '+966551234567', preferred_locale = 'en'
    where id = 'a1000000-0000-4000-8000-0000000000ab'$q$), 1::bigint, 'self: personal details can be changed');
  select * into r from platform.persons where id = 'a1000000-0000-4000-8000-0000000000ab';
  perform tests.assert_eq(r.display_name_ar, 'سارة القحطاني', 'self: name stored');
  perform tests.assert_eq(r.updated_by, 'a1000000-0000-4000-8000-0000000000ab'::uuid, 'self: updated_by from the claims');

  -- Never e-mail, employee number, status, type or nationality — not even together with allowed columns.
  perform tests.assert_fails($q$update platform.persons set email = 'other@example.test' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$, array['42501'],
    'self: e-mail is locked');
  perform tests.assert_fails($q$update platform.persons set mobile_e164 = '+966500000000', employee_number = 'X-1' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$, array['42501'],
    'self: employee number is HR data (mixed with an allowed column)');
  perform tests.assert_fails($q$update platform.persons set status = 'inactive' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$, array['42501'],
    'self: status is HR data');
  perform tests.assert_fails($q$update platform.persons set person_type = 'contractor' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$, array['42501'],
    'self: person type is HR data');
  perform tests.assert_fails($q$update platform.persons set nationality_code = 'SA' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$, array['42501'],
    'self: nationality is HR data');

  -- Other people and new people: user managers only.
  perform tests.assert_fails($q$update platform.persons set display_name_ar = 'تغيير' where id = 'a1000000-0000-4000-8000-0000000000a1'$q$, array['42501'],
    'member: cannot change another person');
  perform tests.assert_fails($q$insert into platform.persons (display_name_ar) values ('شخص جديد')$q$, array['42501'],
    'member: cannot create a person');

  -- Never tenant, id or creation stamps; never a new placement.
  perform tests.assert_fails($q$update platform.persons set created_by = 'a1000000-0000-4000-8000-0000000000a1', mobile_e164 = '+966500000001' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$, array['42501'],
    'self: creation stamps are locked');
  perform tests.assert_fails($q$update platform.persons set tenant_id = 'b0000000-0000-4000-8000-000000000001' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$, array['42501'],
    'self: tenant is locked');
  perform tests.assert_fails($q$insert into platform.person_employment (person_id, job_title_ar) values ('a1000000-0000-4000-8000-0000000000a2', 'وظيفة')$q$, array['42501'],
    'member: cannot create a placement');

  -- Placement (department, manager, job title): user managers only, also one's own.
  perform tests.assert_fails($q$update platform.person_employment set job_title_ar = 'مديرة' where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$, array['42501'],
    'member: cannot change their own placement');
  perform tests.assert_fails($q$update platform.person_employment set manager_person_id = null where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$, array['42501'],
    'member: cannot change their own manager');
end $$;

-- The Organization Admin changes the same HR data.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert(private.actor_may_manage_person('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'),
    'admin: may manage every member');
  perform tests.assert(not private.actor_may_manage_person('b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'),
    'admin: may manage nobody in another organization');
  -- Callers always pass the row's own tenant (the guard: new.tenant_id; the app: p.tenant_id of a row RLS
  -- let it read). The person need not exist yet (the guard also runs before a new person is inserted).
  perform tests.assert_eq(tests.rows_affected($q$update platform.persons set employee_number = 'E-200', email = 'ab.new@example.test' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$),
    1::bigint, 'admin: changes HR data of a person');
  perform tests.assert_eq(tests.rows_affected($q$update platform.person_employment set job_title_ar = 'مديرة' where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$),
    1::bigint, 'admin: changes a placement');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.persons (display_name_ar) values ('شخص جديد')$q$),
    1::bigint, 'admin: creates a person');
end $$;
rollback;

-- An HR Manager (uAB with the fixture roles) writes ordinary members' records, but not a privileged
-- member's (the Organization Admin, nor their own HR data): only an Organization Admin may.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert(private.actor_manages_users('a0000000-0000-4000-8000-000000000001'), 'uAB manages users (HR Manager)');
  perform tests.assert(private.actor_may_manage_person('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a2'),
    'HR Manager: may manage an ordinary member');
  perform tests.assert(not private.actor_may_manage_person('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'),
    'HR Manager: may not manage the Organization Admin');
  perform tests.assert(not private.actor_may_manage_person('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'),
    'HR Manager: may not manage their own (privileged) record');
  perform tests.assert_eq(tests.rows_affected($q$update platform.persons set mobile_e164 = '+971501234567', employee_number = 'E-2' where id = 'a1000000-0000-4000-8000-0000000000a2'$q$),
    1::bigint, 'HR Manager: changes an ordinary member');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.person_employment (person_id, job_title_ar) values ('a1000000-0000-4000-8000-0000000000a2', 'متدرب')$q$),
    1::bigint, 'HR Manager: places an ordinary member');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.persons (display_name_ar) values ('شخص جديد')$q$),
    1::bigint, 'HR Manager: creates a person');
  perform tests.assert_fails($q$update platform.persons set email = 'admin@evil.test' where id = 'a1000000-0000-4000-8000-0000000000a1'$q$, array['42501'],
    'HR Manager: cannot change the Organization Admin''s record');
  perform tests.assert_fails($q$update platform.person_employment set job_title_ar = 'لا شيء' where person_id = 'a1000000-0000-4000-8000-0000000000a1'$q$, array['42501'],
    'HR Manager: cannot change the Organization Admin''s placement');
  perform tests.assert_fails($q$update platform.person_employment set manager_person_id = null where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$, array['42501'],
    'HR Manager: cannot change their own placement (privileged member)');
  perform tests.assert_fails($q$update platform.persons set employee_number = 'X-9' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$, array['42501'],
    'HR Manager: cannot change their own HR data');
  perform tests.assert_eq(tests.rows_affected($q$update platform.persons set mobile_e164 = '+966511111111' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$),
    1::bigint, 'HR Manager: own personal details through My profile');
  perform tests.assert_eq(private.person_self_service_columns() @> array['mobile_e164', 'preferred_locale'], true,
    'self-service columns include mobile and language');
  perform tests.assert(not (private.person_self_service_columns() && array['email', 'employee_number', 'status', 'person_type', 'tenant_id', 'id', 'created_by', 'created_at']),
    'self-service columns never include e-mail, employee number, status, type, tenant, id or creation stamps');
end $$;
rollback;

-- A user-manager role that ended (or a suspended manager) manages nobody.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
update platform.role_assignments ra set valid_until = now() - interval '1 day'
from platform.tenant_memberships m
where m.id = ra.membership_id and m.user_id = '00000000-0000-4000-8000-0000000000ab' and ra.role_code = 'hr_manager';
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert(not private.actor_manages_users('a0000000-0000-4000-8000-000000000001'), 'ended HR Manager role: no user management');
  perform tests.assert_fails($q$update platform.persons set employee_number = 'E-3' where id = 'a1000000-0000-4000-8000-0000000000a2'$q$, array['42501'],
    'ended HR Manager role: cannot change another person');
end $$;
rollback;

-- Every column of persons is classified: a new column must be added to the self-service list on
-- purpose (or stay locked) — this list changes together with the guard.
begin;
set local role authenticated;
do $$
begin
  perform tests.assert_eq(
    (select array_agg(attname::text order by attname::text) from pg_attribute
     where attrelid = 'platform.persons'::regclass and attnum > 0 and not attisdropped),
    array['created_at', 'created_by', 'deactivated_at', 'display_name_ar', 'display_name_en', 'email', 'employee_number',
          'family_name_ar', 'family_name_en', 'father_name_ar', 'father_name_en', 'first_name_ar', 'first_name_en',
          'grandfather_name_ar', 'grandfather_name_en', 'id', 'is_national', 'mobile_e164', 'nationality_code', 'person_type',
          'preferred_locale', 'status', 'tenant_id', 'updated_at', 'updated_by', 'version'],
    'persons: columns reviewed for the write guard (self-service list in private.person_self_service_columns)');
end $$;
rollback;

\echo '26_person_writers: ok'
