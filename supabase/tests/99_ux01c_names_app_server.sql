-- db-test: run-as=app_server
-- Courses, course categories, needs forms and custom roles are named in at least one language (WP-UX-01 c,
-- T-M3-21; migrations 20261113110000…110500; FR-CAT-01, FR-PLN-03, FR-IAM-07; PO 12 Nov 2026): one name is
-- enough, in either language; no name at all is refused; a given name is still checked (trimmed, visible,
-- within its length) and still unique in its language. Who may write is unchanged (the guards decide as
-- before). Fixtures: 00_helpers_and_fixtures.sql, 99_course_library_owner.sql, 99_needs_forms_0_fixtures.sql.
-- Each block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- ---------------------------------------------------------------------------------------------------
-- Courses and categories — the L&D Manager of the course-library fixtures (uLD …d001).
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000d001', '10000000-0000-4000-8000-00000000d001',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000d001'));
do $$
declare
  v_en constant uuid := 'a7100000-0000-4000-8000-0000000011e1';
  v_ar constant uuid := 'a7100000-0000-4000-8000-0000000011a1';
  v_cat_en constant uuid := 'a7000000-0000-4000-8000-0000000011e1';
  v_cat_ar constant uuid := 'a7000000-0000-4000-8000-0000000011a1';
begin
  -- A course titled in English only, and one in Arabic only.
  insert into tms.courses (id, code, title_en, delivery_type, duration_hours, max_participants)
  values (v_en, 'NAME-EN', 'Negotiation skills', 'classroom', 6, 20);
  insert into tms.courses (id, code, title_ar, delivery_type, duration_hours, max_participants)
  values (v_ar, 'NAME-AR', 'مهارات التفاوض', 'classroom', 6, 20);
  perform tests.assert_eq((select title_ar from tms.courses where id = v_en), null::text,
    'a course titled in English only keeps no Arabic title');
  perform tests.assert_eq((select title_en from tms.courses where id = v_ar), null::text,
    'a course titled in Arabic only keeps no English title');

  -- No title at all, and the only title taken away.
  perform tests.assert_check_constraint($q$insert into tms.courses (code, delivery_type, duration_hours, max_participants) values ('NAME-NONE', 'classroom', 6, 20)$q$,
    'courses_title_present_check', 'a course without any title is refused');
  perform tests.assert_check_constraint(format($q$update tms.courses set title_en = null where id = %L$q$, v_en),
    'courses_title_present_check', 'the only title of a course cannot be removed');
  -- A given title is still checked.
  perform tests.assert_check_constraint(format($q$update tms.courses set title_ar = '   ' where id = %L$q$, v_en),
    'courses_title_ar_check', 'a given Arabic title must be visible text');
  perform tests.assert_check_constraint(format($q$update tms.courses set title_ar = %L where id = %L$q$, repeat('ن', 201), v_en),
    'courses_title_ar_check', 'a given Arabic title keeps its length limit');
  -- The other language can be added later, and removed again (a content change: tms.course.manage).
  update tms.courses set title_ar = 'مهارات التفاوض المتقدمة' where id = v_en;
  update tms.courses set title_ar = null where id = v_en;
  perform tests.assert_eq((select version from tms.courses where id = v_en), 3, 'each change of the titles is a new version');

  -- Categories: one name is enough; a given name stays unique in its language; no name is refused.
  insert into tms.course_categories (id, name_en) values (v_cat_en, 'Negotiation');
  insert into tms.course_categories (id, name_ar) values (v_cat_ar, 'التفاوض');
  -- Two categories without an Arabic name do not collide (the unique index never compares NULLs).
  insert into tms.course_categories (name_en) values ('Sales');
  perform tests.assert_fails($q$insert into tms.course_categories (name_en) values ('NEGOTIATION')$q$,
    array['23505'], 'a given English category name is still unique (case-insensitive)');
  perform tests.assert_fails($q$insert into tms.course_categories (name_ar) values ('التفاوض')$q$,
    array['23505'], 'a given Arabic category name is still unique');
  perform tests.assert_check_constraint($q$insert into tms.course_categories (id) values (gen_random_uuid())$q$,
    'course_categories_name_present_check', 'a category without any name is refused');
  perform tests.assert_check_constraint(format($q$update tms.course_categories set name_ar = null where id = %L$q$, v_cat_ar),
    'course_categories_name_present_check', 'the only name of a category cannot be removed');
  perform tests.assert_check_constraint(format($q$update tms.course_categories set name_en = ' Padded' where id = %L$q$, v_cat_ar),
    'course_categories_name_en_check', 'a given category name is still trimmed');
end $$;
rollback;

-- Who writes is unchanged: the HR Manager reads the library and changes nothing, one name or two.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_fails_like($q$insert into tms.courses (code, title_en, delivery_type, duration_hours, max_participants) values ('NAME-HR', 'Not mine', 'classroom', 6, 20)$q$,
    'only members who manage the course library can add courses', 'the HR Manager cannot add a course with one title either');
  perform tests.assert_fails_like($q$insert into tms.course_categories (name_en) values ('Not mine')$q$,
    'only members who manage the course library can add or change categories', 'the HR Manager cannot add a category with one name either');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Needs forms — the L&D Manager of the needs-forms fixtures (uLnd …71).
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000071'));
do $$
declare
  v_en uuid;
  v_ar uuid;
  v_copy uuid;
begin
  -- A blank form named in one language, through the function the application calls.
  v_en := private.seed_needs_form('a0000000-0000-4000-8000-000000000001', 'Engineering needs 2031', null, false, false);
  v_ar := private.seed_needs_form('a0000000-0000-4000-8000-000000000001', null, 'احتياجات الهندسة ٢٠٣١', false, false);
  perform tests.assert_eq((select name_ar from tms.needs_forms where id = v_en), null::text,
    'a form named in English only keeps no Arabic name');
  perform tests.assert_eq((select name_en from tms.needs_forms where id = v_ar), null::text,
    'a form named in Arabic only keeps no English name');
  perform tests.assert_eq((select count(*) from tms.needs_form_fields where form_id = v_en and system_key is not null), 2::bigint,
    'a form named in one language still gets its two system fields');

  -- A copy named in one language (sections and fields keep both languages).
  v_copy := private.duplicate_needs_form(v_en, null, 'نسخة من احتياجات الهندسة');
  perform tests.assert_eq((select row(name_en, name_ar)::text from tms.needs_forms where id = v_copy),
    row(null::text, 'نسخة من احتياجات الهندسة'::text)::text, 'a copy keeps the names it was given');

  -- No name at all; the only name taken away; a given name still checked and unique in its language.
  perform tests.assert_check_constraint($q$select private.seed_needs_form('a0000000-0000-4000-8000-000000000001', null, null, false, false)$q$,
    'needs_forms_name_present_check', 'a form without any name is refused');
  perform tests.assert_check_constraint(format($q$update tms.needs_forms set name_en = null where id = %L$q$, v_en),
    'needs_forms_name_present_check', 'the only name of a form cannot be removed');
  perform tests.assert_check_constraint(format($q$update tms.needs_forms set name_ar = %L where id = %L$q$, repeat('ن', 121), v_en),
    'needs_forms_name_ar_check', 'a given Arabic name keeps its length limit');
  perform tests.assert_fails($q$insert into tms.needs_forms (name_en) values ('ENGINEERING NEEDS 2031')$q$,
    array['23505'], 'a given English form name is still unique (case-insensitive)');
  perform tests.assert_fails($q$insert into tms.needs_forms (name_ar) values ('احتياجات الهندسة ٢٠٣١')$q$,
    array['23505'], 'a given Arabic form name is still unique');
  -- The other language can be added later, and removed again.
  update tms.needs_forms set name_ar = 'احتياجات الهندسة' where id = v_en;
  update tms.needs_forms set name_ar = null where id = v_en;
end $$;
rollback;

-- Who designs is unchanged: the Training Coordinator (uTc …72) creates no form, one name or two.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000072', '10000000-0000-4000-8000-000000000072',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000072'));
do $$
begin
  perform tests.assert_fails_like($q$select private.seed_needs_form('a0000000-0000-4000-8000-000000000001', 'Mine', null, false, false)$q$,
    'only an L&D Manager can design needs forms', 'the Training Coordinator cannot create a form with one name either');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Custom roles — the Organization Admin (uA …a1).
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  v_en constant uuid := 'a6000000-0000-4000-8000-0000000011e1';
  v_ar constant uuid := 'a6000000-0000-4000-8000-0000000011a1';
begin
  insert into platform.custom_roles (id, name_en, data_scope) values (v_en, 'Budget reviewer', 'organization');
  insert into platform.custom_roles (id, name_ar, data_scope) values (v_ar, 'مراجع الميزانية', 'own');
  perform tests.assert((select code from platform.custom_roles where id = v_en) ~ '^custom_[0-9a-f]{12}$',
    'a role named in one language gets its code from the database as before');
  perform tests.assert_eq((select name_ar from platform.custom_roles where id = v_en), null::text,
    'a role named in English only keeps no Arabic name');
  perform tests.assert_eq((select name_en from platform.custom_roles where id = v_ar), null::text,
    'a role named in Arabic only keeps no English name');
  -- A second role without an Arabic name does not collide; a given name stays unique in its language.
  insert into platform.custom_roles (name_en, data_scope) values ('Venue booker', 'own');
  perform tests.assert_fails($q$insert into platform.custom_roles (name_en, data_scope) values ('BUDGET REVIEWER', 'own')$q$,
    array['23505'], 'a given English role name is still unique (case-insensitive)');
  perform tests.assert_fails($q$insert into platform.custom_roles (name_ar, data_scope) values ('مراجع الميزانية', 'own')$q$,
    array['23505'], 'a given Arabic role name is still unique');
  -- No name at all; the only name taken away; a given name still checked.
  perform tests.assert_check_constraint($q$insert into platform.custom_roles (data_scope) values ('own')$q$,
    'custom_roles_name_present_check', 'a role without any name is refused');
  perform tests.assert_check_constraint(format($q$update platform.custom_roles set name_ar = null where id = %L$q$, v_ar),
    'custom_roles_name_present_check', 'the only name of a role cannot be removed');
  perform tests.assert_check_constraint(format($q$update platform.custom_roles set name_ar = ' مسافة' where id = %L$q$, v_en),
    'custom_roles_name_ar_check', 'a given Arabic name is still trimmed');
  perform tests.assert_check_constraint(format($q$update platform.custom_roles set name_ar = %L where id = %L$q$, repeat('ن', 81), v_en),
    'custom_roles_name_ar_check', 'a given Arabic name keeps its length limit');
  -- The other language can be added later, and removed again.
  update platform.custom_roles set name_ar = 'مراجع' where id = v_en;
  update platform.custom_roles set name_ar = null where id = v_en;
end $$;
rollback;

-- Who builds roles is unchanged: the HR Manager builds none, one name or two.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_fails_like($q$insert into platform.custom_roles (name_en, data_scope) values ('Not mine', 'own')$q$,
    'only an Organization Admin can create, change or delete roles', 'the HR Manager cannot build a role with one name either');
end $$;
rollback;

\echo '99_ux01c_names_app_server: ok'
