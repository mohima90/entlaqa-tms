-- db-test: run-as=app_server
-- Person profile (T-M2-02, FR-IAM-01): persons columns and platform.person_employment — constraints,
-- deactivation stamping, live references, manager chain, and deleting org units with people in them.
-- Runs CONNECTED AS app_server with tenant-A claims (uA, person a1). Each block is rolled back.
\set ON_ERROR_STOP on

-- persons: profile constraints and status / deactivated_at stamping.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  r record;
  v_at timestamptz;
begin
  perform tests.assert_check_constraint($q$insert into platform.persons (display_name_ar, mobile_e164) values ('شخص', '0501234567')$q$,
    'persons_mobile_e164_check', 'persons: mobile must be E.164');
  perform tests.assert_check_constraint($q$insert into platform.persons (display_name_ar, preferred_locale) values ('شخص', 'fr')$q$,
    'persons_preferred_locale_check', 'persons: locale is ar or en');
  perform tests.assert_check_constraint($q$insert into platform.persons (display_name_ar, person_type) values ('شخص', 'robot')$q$,
    'persons_person_type_check', 'persons: person type check');
  perform tests.assert_check_constraint($q$insert into platform.persons (display_name_ar, nationality_code) values ('شخص', 'sa')$q$,
    'persons_nationality_code_check', 'persons: nationality is ISO alpha-2');
  perform tests.assert_check_constraint(format('insert into platform.persons (display_name_ar) values (%L)', chr(8203) || chr(8207)),
    'persons_display_name_ar_visible_check', 'persons: display name needs a visible character');
  perform tests.assert_check_constraint(format('insert into platform.persons (display_name_ar, first_name_ar) values (%L, %L)', 'شخص', chr(1564)),
    'persons_name_parts_check', 'persons: name parts need a visible character');
  perform tests.assert_check_constraint(format('insert into platform.persons (display_name_ar, family_name_en) values (%L, %L)', 'شخص', repeat('x', 61)),
    'persons_name_parts_check', 'persons: name parts are at most 60 characters');
  perform tests.assert_check_constraint($q$insert into platform.persons (display_name_ar, display_name_en) values ('شخص', '')$q$,
    'persons_display_name_en_check', 'persons: English display name cannot be empty when given');
  perform tests.assert_check_constraint(format('insert into platform.persons (display_name_ar) values (%L)', repeat('م', 201)),
    'persons_display_name_ar_visible_check', 'persons: Arabic display name is at most 200 characters');

  insert into platform.persons (id, display_name_ar, first_name_ar, father_name_ar, family_name_ar, mobile_e164, preferred_locale,
                                nationality_code, is_national, deactivated_at, created_by, version)
  values ('a1000000-0000-4000-8000-0000000000f3', 'نورة فهد الدوسري', 'نورة', 'فهد', 'الدوسري', '+966551234567', 'ar', 'SA', true,
          '2000-01-01', 'b1000000-0000-4000-8000-0000000000b1', 7);
  select * into r from platform.persons where id = 'a1000000-0000-4000-8000-0000000000f3';
  perform tests.assert(r.deactivated_at is null, 'persons: an active person has no deactivated_at even if one is sent');
  perform tests.assert_eq(r.created_by, 'a1000000-0000-4000-8000-0000000000a1'::uuid, 'persons: created_by from the claims');
  perform tests.assert_eq(r.version, 1, 'persons: version starts at 1');
  perform tests.assert_eq(r.person_type, 'employee', 'persons: person type defaults to employee');

  update platform.persons set status = 'inactive', deactivated_at = '2000-01-01' where id = r.id;
  select deactivated_at into v_at from platform.persons where id = r.id;
  perform tests.assert(v_at > now() - interval '1 minute', 'persons: deactivated_at is the clock when a person becomes inactive');
  update platform.persons set display_name_ar = 'نورة الدوسري', deactivated_at = null where id = r.id;
  perform tests.assert_eq((select deactivated_at from platform.persons where id = r.id), v_at,
    'persons: deactivated_at is kept while the person stays inactive');
  update platform.persons set status = 'active' where id = r.id;
  perform tests.assert((select deactivated_at is null and version = 4 from platform.persons where id = r.id),
    'persons: reactivation clears deactivated_at; every update bumps version');
  perform tests.assert_fails_like($q$update platform.persons set id = 'a1000000-0000-4000-8000-0000000000f4' where id = 'a1000000-0000-4000-8000-0000000000f3'$q$,
    'the id of platform.persons rows cannot change', 'persons: id is immutable');
end $$;
rollback;

-- person_employment: constraints, live references, manager chain.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  insert into platform.persons (id, display_name_ar) values
    ('a1000000-0000-4000-8000-0000000000c1', 'موظف 1'),
    ('a1000000-0000-4000-8000-0000000000c2', 'موظف 2'),
    ('a1000000-0000-4000-8000-0000000000c3', 'موظف 3');
  insert into platform.persons (id, display_name_ar, status) values ('a1000000-0000-4000-8000-0000000000c9', 'موظف سابق', 'inactive');

  perform tests.assert_check_constraint($q$insert into platform.person_employment (person_id, manager_person_id) values ('a1000000-0000-4000-8000-0000000000c1', 'a1000000-0000-4000-8000-0000000000c1')$q$,
    'person_employment_manager_check', 'employment: a person cannot manage themself');
  perform tests.assert_check_constraint($q$insert into platform.person_employment (person_id, hire_on, end_on) values ('a1000000-0000-4000-8000-0000000000c1', '2026-01-01', '2025-01-01')$q$,
    'person_employment_dates_check', 'employment: end date not before hire date');
  perform tests.assert_check_constraint($q$insert into platform.person_employment (person_id, source) values ('a1000000-0000-4000-8000-0000000000c1', 'excel')$q$,
    'person_employment_source_check', 'employment: source check');
  perform tests.assert_check_constraint(format('insert into platform.person_employment (person_id, job_title_ar) values (%L, %L)', 'a1000000-0000-4000-8000-0000000000c1', chr(8238)),
    'person_employment_job_title_check', 'employment: job title needs a visible character');
  perform tests.assert_check_constraint(format('insert into platform.person_employment (person_id, grade) values (%L, %L)', 'a1000000-0000-4000-8000-0000000000c1', repeat('x', 41)),
    'person_employment_grade_check', 'employment: grade is at most 40 characters');
  perform tests.assert_check_constraint(format('insert into platform.person_employment (person_id, source_ref) values (%L, %L)', 'a1000000-0000-4000-8000-0000000000c1', repeat('x', 201)),
    'person_employment_source_ref_check', 'employment: source reference is at most 200 characters');
  perform tests.assert_fails($q$insert into platform.person_employment (person_id) values ('a1000000-0000-4000-8000-0000000000a1')$q$,
    array['23505'], 'employment: one row per person');
  perform tests.assert_fails($q$insert into platform.person_employment (person_id, manager_person_id) values ('a1000000-0000-4000-8000-0000000000c1', 'a1000000-0000-4000-8000-0000000000c9')$q$,
    array['23514'], 'employment: the manager must be an active person');

  -- Chain c3 → c2 → c1; making c1 report to c3 would loop.
  insert into platform.person_employment (person_id) values ('a1000000-0000-4000-8000-0000000000c1');
  insert into platform.person_employment (person_id, manager_person_id) values ('a1000000-0000-4000-8000-0000000000c2', 'a1000000-0000-4000-8000-0000000000c1');
  insert into platform.person_employment (person_id, manager_person_id) values ('a1000000-0000-4000-8000-0000000000c3', 'a1000000-0000-4000-8000-0000000000c2');
  perform tests.assert_fails($q$update platform.person_employment set manager_person_id = 'a1000000-0000-4000-8000-0000000000c3' where person_id = 'a1000000-0000-4000-8000-0000000000c1'$q$,
    array['23514'], 'employment: the manager chain cannot loop');
  perform tests.assert_eq(tests.rows_affected($q$update platform.person_employment set manager_person_id = 'a1000000-0000-4000-8000-0000000000a1' where person_id = 'a1000000-0000-4000-8000-0000000000c1'$q$),
    1::bigint, 'employment: a non-looping manager change is accepted');

  -- Deleted org units cannot receive people.
  insert into platform.departments (id, code, name_ar) values ('a3000000-0000-4000-8000-0000000000d1', 'GONE', 'قسم محذوف');
  update platform.departments set deleted_at = now() where code = 'GONE';
  perform tests.assert_fails($q$update platform.person_employment set department_id = 'a3000000-0000-4000-8000-0000000000d1' where person_id = 'a1000000-0000-4000-8000-0000000000c1'$q$,
    array['23514'], 'employment: cannot be placed in a deleted department');
  insert into platform.branches (id, code, name_ar) values ('a2000000-0000-4000-8000-0000000000d1', 'GONE', 'فرع محذوف');
  update platform.branches set deleted_at = now() where code = 'GONE';
  perform tests.assert_fails($q$update platform.person_employment set branch_id = 'a2000000-0000-4000-8000-0000000000d1' where person_id = 'a1000000-0000-4000-8000-0000000000c1'$q$,
    array['23514'], 'employment: cannot be placed in a deleted branch');
end $$;
rollback;

-- Org units with ACTIVE people cannot be soft-deleted; deactivated people keep their placement.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  -- TD-PRG has uAB (active).
  perform tests.assert_fails($q$update platform.departments set deleted_at = now() where code = 'TD-PRG'$q$,
    array['23514'], 'departments: cannot soft-delete while active people are placed in it');
  update platform.persons set status = 'inactive' where id = 'a1000000-0000-4000-8000-0000000000ab';
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set deleted_at = now() where code = 'TD-PRG'$q$),
    1::bigint, 'departments: a deactivated person''s placement does not block the delete');
  perform tests.assert((select department_id = 'a3000000-0000-4000-8000-000000000002' from platform.person_employment
                        where person_id = 'a1000000-0000-4000-8000-0000000000ab'),
    'employment: the deactivated person keeps the last placement as history');

  -- RUH still has uA (active) placed in it (TD's departments are in RUH too, so test the people rule
  -- on a fresh branch).
  insert into platform.branches (id, code, name_ar) values ('a2000000-0000-4000-8000-0000000000e1', 'PPL', 'فرع فيه موظفون');
  update platform.person_employment set branch_id = 'a2000000-0000-4000-8000-0000000000e1' where person_id = 'a1000000-0000-4000-8000-0000000000a1';
  perform tests.assert_fails($q$update platform.branches set deleted_at = now() where code = 'PPL'$q$,
    array['23514'], 'branches: cannot soft-delete while active people are placed in it');
end $$;
rollback;

-- Manager chain depth: at most 50 levels, counting the reports below a moved person.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  v_prev uuid;
  v_id uuid;
  v_top_b uuid;
  i integer;
begin
  -- Chain A: 40 levels (p1 is the top).
  for i in 1..40 loop
    insert into platform.persons (display_name_ar) values ('سلسلة أ ' || i) returning id into v_id;
    insert into platform.person_employment (person_id, manager_person_id) values (v_id, v_prev);
    v_prev := v_id;
  end loop;
  -- Chain B: 11 levels, detached (top has no manager).
  v_id := null;
  for i in 1..11 loop
    insert into platform.persons (display_name_ar) values ('سلسلة ب ' || i) returning id into v_top_b;
    insert into platform.person_employment (person_id, manager_person_id) values (v_top_b, v_id);
    if i = 1 then
      perform set_config('tests.top_b', v_top_b::text, true);
    end if;
    v_id := v_top_b;
  end loop;
  v_top_b := current_setting('tests.top_b')::uuid;
  -- 40 (chain A) + 11 (chain B) = 51 levels → refused; 10 under the deepest of A would be 50 → allowed.
  perform tests.assert_fails(format($q$update platform.person_employment set manager_person_id = %L where person_id = %L$q$, v_prev, v_top_b),
    array['23514'], 'employment: attaching a team may not make the chain deeper than 50 levels');
  select manager_person_id into v_id from platform.person_employment where person_id = v_prev;
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.person_employment set manager_person_id = %L where person_id = %L$q$, v_id, v_top_b)),
    1::bigint, 'employment: exactly 50 levels is allowed');
end $$;
rollback;

-- Reactivation: a person placed in a since-deleted unit is moved before being reactivated.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  update platform.persons set status = 'inactive' where id = 'a1000000-0000-4000-8000-0000000000ab';
  update platform.departments set deleted_at = now() where code = 'TD-PRG';
  perform tests.assert_fails($q$update platform.persons set status = 'active' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$,
    array['23514'], 'persons: cannot reactivate someone placed in a deleted department');
  update platform.person_employment set department_id = 'a3000000-0000-4000-8000-000000000003' where person_id = 'a1000000-0000-4000-8000-0000000000ab';
  perform tests.assert_eq(tests.rows_affected($q$update platform.persons set status = 'active' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$),
    1::bigint, 'persons: reactivation works once the person is moved');
end $$;
rollback;

-- [std] stamping on person_employment; trigger order; NOT VALID checks validated by the follow-up migration.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
declare
  r record;
begin
  update platform.person_employment set job_title_ar = 'منسق أول' where person_id = 'a1000000-0000-4000-8000-0000000000ab';
  select * into r from platform.person_employment where person_id = 'a1000000-0000-4000-8000-0000000000ab';
  perform tests.assert_eq(r.updated_by, 'a1000000-0000-4000-8000-0000000000ab'::uuid, 'employment: updated_by from the claims');
  perform tests.assert_eq(r.version, 2, 'employment: version increments');
  perform tests.assert(r.created_by is null, 'employment: created_by of the fixture row (no claims) stays NULL');

  perform tests.assert_eq(
    (select array_agg(tgname::text order by tgname::text) from pg_trigger where tgrelid = 'platform.persons'::regclass and not tgisinternal),
    array['persons_deactivation', 'persons_reactivation', 'persons_stamp_row'], 'persons: triggers');
  perform tests.assert_eq(
    (select array_agg(tgname::text order by tgname::text) from pg_trigger where tgrelid = 'platform.person_employment'::regclass and not tgisinternal),
    array['person_employment_stamp_row', 'person_employment_validate'], 'person_employment: triggers');
  perform tests.assert((select bool_and(convalidated) from pg_constraint where conrelid = 'platform.persons'::regclass and contype = 'c'),
    'persons: every check constraint is validated');
end $$;
rollback;

-- private.search_key (T-M2-04): Arabic letter variants, diacritics and case do not change a name search.
begin;
set local role authenticated;
do $$
begin
  perform tests.assert_eq(private.search_key('أحمد'), private.search_key('احمد'), 'search_key: alef with hamza = alef');
  perform tests.assert_eq(private.search_key('إيمان'), 'ايمان', 'search_key: alef with hamza below = alef');
  perform tests.assert_eq(private.search_key('آمنة'), 'امنه', 'search_key: alef madda = alef, teh marbuta = heh');
  perform tests.assert_eq(private.search_key('مصطفى'), 'مصطفي', 'search_key: alef maqsura = yeh');
  perform tests.assert_eq(private.search_key('م' || chr(1615) || 'ح' || chr(1614) || 'م' || chr(1617) || 'د'), 'محمد',
    'search_key: diacritics removed');
  perform tests.assert_eq(private.search_key('عبدالرحم' || chr(1648) || 'ن'), 'عبدالرحمن', 'search_key: dagger alef removed');
  perform tests.assert_eq(private.search_key('عـــلي'), 'علي', 'search_key: tatweel removed');
  perform tests.assert_eq(private.search_key('Omar 50%_X'), 'omar 50%_x', 'search_key: lower case, other characters kept');
  perform tests.assert(private.search_key(null) is null, 'search_key: null stays null');
end $$;
rollback;

\echo '23_people: ok'
