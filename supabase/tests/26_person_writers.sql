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
  perform tests.assert_eq(tests.rows_affected($q$update platform.persons set employee_number = 'E-200', email = 'ab.new@example.test' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$),
    1::bigint, 'admin: changes HR data of a person');
  perform tests.assert_eq(tests.rows_affected($q$update platform.person_employment set job_title_ar = 'مديرة' where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$),
    1::bigint, 'admin: changes a placement');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.persons (display_name_ar) values ('شخص جديد')$q$),
    1::bigint, 'admin: creates a person');
end $$;
rollback;

-- An HR Manager (uAB with the fixture roles) writes other people too.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert(private.actor_manages_users('a0000000-0000-4000-8000-000000000001'), 'uAB manages users (HR Manager)');
  perform tests.assert_eq(tests.rows_affected($q$update platform.persons set mobile_e164 = '+971501234567' where id = 'a1000000-0000-4000-8000-0000000000a1'$q$),
    1::bigint, 'HR Manager: changes another person');
  perform tests.assert_eq(tests.rows_affected($q$update platform.person_employment set job_title_ar = 'مدير أول' where person_id = 'a1000000-0000-4000-8000-0000000000a1'$q$),
    1::bigint, 'HR Manager: changes another placement');
  perform tests.assert_eq(private.person_self_service_columns() @> array['mobile_e164', 'preferred_locale'], true,
    'self-service columns include mobile and language');
  perform tests.assert(not (private.person_self_service_columns() && array['email', 'employee_number', 'status', 'person_type', 'tenant_id', 'id']),
    'self-service columns never include e-mail, employee number, status, type, tenant or id');
end $$;
rollback;

\echo '26_person_writers: ok'
