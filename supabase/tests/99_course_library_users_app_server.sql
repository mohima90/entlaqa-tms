-- db-test: run-as=app_server
-- Course library (T-M3-03; FR-CAT-01, FR-CAT-10): who may add, edit, archive and restore courses and
-- categories — decided BY PERMISSION in the database (tms.course.manage, tms.course.archive), for standard
-- and custom roles; the Organization Admin, the HR Manager, the Department Head and the Employee change
-- nothing; rows of another organization are never reached; constraints; the stamps (person, archive, the
-- costs' currency from the organization's settings). Runs CONNECTED AS app_server (fixtures: 00, 99 owner).
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- ---------------------------------------------------------------------------------------------------
-- The L&D Manager (uLD): adds, edits, archives and restores; constraints; stamps.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000d001', '10000000-0000-4000-8000-00000000d001',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000d001'));
do $$
declare
  v_course tms.courses;
  v_id constant uuid := 'a7100000-0000-4000-8000-0000000000d1';
  v_cat constant uuid := 'a7000000-0000-4000-8000-0000000000d1';
begin
  perform tests.assert_eq((select count(*) from tms.courses), 2::bigint, 'the L&D Manager sees tenant A''s two courses only');
  perform tests.assert_eq((select count(*) from tms.course_categories), 1::bigint, 'and tenant A''s category only');

  -- A category and a course.
  perform tests.assert_eq(tests.rows_affected(format($q$insert into tms.course_categories (id, name_en, name_ar) values (%L, 'Safety', 'السلامة')$q$, v_cat)),
    1::bigint, 'the L&D Manager adds a category (the same names as tenant B''s do not collide)');
  perform tests.assert_fails($q$insert into tms.course_categories (name_en, name_ar) values ('LEADERSHIP', 'أخرى')$q$,
    array['23505'], 'category names are unique in the organization (English, case-insensitive)');
  perform tests.assert_fails($q$insert into tms.course_categories (name_en, name_ar) values ('Other', 'القيادة')$q$,
    array['23505'], 'category names are unique in the organization (Arabic)');
  perform tests.assert_check_constraint($q$insert into tms.course_categories (name_en, name_ar) values (' Padded', 'مسافة')$q$,
    'course_categories_name_en_check', 'category names are trimmed');

  insert into tms.courses (id, code, title_en, title_ar, description_en, category_id, delivery_type, duration_hours,
                           duration_days, min_participants, max_participants, est_cost_per_session)
  values (v_id, 'SAFE-200', 'Fire safety', 'السلامة من الحرائق', 'Evacuation drills.', v_cat, 'workshop', 6, 1, 5, 15, 4000);
  select * into v_course from tms.courses where id = v_id;
  perform tests.assert_eq(row(v_course.tenant_id, v_course.status, v_course.cost_currency, v_course.created_by, v_course.version)::text,
    row('a0000000-0000-4000-8000-000000000001'::uuid, 'active', 'SAR', 'a1000000-0000-4000-8000-00000000d001'::uuid, 1)::text,
    'tenant from the claims, active, the organization''s currency, stamped with the actor, version 1');

  -- Constraints.
  perform tests.assert_fails($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, max_participants) values ('lead-101', 'Twice', 'مكرر', 'classroom', 1, 10)$q$,
    array['23505'], 'codes are unique in the organization regardless of case (tenant B''s LEAD-101 is no conflict: 00)');
  perform tests.assert_check_constraint($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, min_participants, max_participants) values ('MIN-1', 'Min', 'أدنى', 'classroom', 1, 21, 20)$q$,
    'courses_participants_check', 'the minimum is not above the maximum');
  perform tests.assert_check_constraint($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, max_participants) values ('ZERO-1', 'Zero', 'صفر', 'classroom', 1, 0)$q$,
    'courses_participants_check', 'at least one participant');
  perform tests.assert_check_constraint($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, duration_days, max_participants) values ('DAYS-1', 'Days', 'أيام', 'classroom', 30, 1, 10)$q$,
    'courses_duration_days_check', 'the days can hold the hours');
  perform tests.assert_check_constraint($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, max_participants) values ('HRS-0', 'Hours', 'ساعات', 'classroom', 0, 10)$q$,
    'courses_duration_hours_check', 'a duration in hours above zero');
  perform tests.assert_check_constraint($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, max_participants) values ('TYPE-1', 'Type', 'نمط', 'webinar', 1, 10)$q$,
    'courses_delivery_type_check', 'one of the delivery types of FR-CAT-01');
  perform tests.assert_check_constraint($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, max_participants) values ('bad code', 'Code', 'رمز', 'classroom', 1, 10)$q$,
    'courses_code_check', 'codes are letters, digits, dot, dash and underscore');
  perform tests.assert_check_constraint($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, max_participants, est_cost_per_session) values ('NEG-1', 'Cost', 'تكلفة', 'classroom', 1, 10, -1)$q$,
    'courses_cost_check', 'costs are not negative');
  perform tests.assert_check_constraint(format($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, max_participants) values ('BLANK-1', %L, 'فارغ', 'classroom', 1, 10)$q$, chr(8203)),
    'courses_title_en_check', 'a title needs a visible character');
  perform tests.assert_fails($q$insert into tms.courses (code, title_en, title_ar, category_id, delivery_type, duration_hours, max_participants) values ('FK-1', 'Foreign', 'أجنبي', 'b7000000-0000-4000-8000-000000000001', 'classroom', 1, 10)$q$,
    array['23503'], 'a course never points at another organization''s category (composite FK)');

  -- What the request can never write.
  perform tests.assert_privilege_denied($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, max_participants, status) values ('ARC-1', 'Archived', 'مؤرشف', 'classroom', 1, 10, 'archived')$q$,
    'a new course cannot start archived');
  perform tests.assert_privilege_denied($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, max_participants, cost_currency) values ('CUR-1', 'Currency', 'عملة', 'classroom', 1, 10, 'USD')$q$,
    'the currency is never chosen by the request');
  perform tests.assert_privilege_denied(format($q$update tms.courses set cost_currency = 'USD' where id = %L$q$, v_id),
    'nor changed');
  perform tests.assert_privilege_denied(format($q$update tms.courses set archived_at = now() where id = %L$q$, v_id),
    'the archive stamps are the database''s');
  perform tests.assert_privilege_denied(format($q$delete from tms.courses where id = %L$q$, v_id),
    'courses are never deleted (archive)');

  -- Edit, archive, restore.
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.courses set title_en = 'Fire safety basics', max_participants = 18 where id = %L$q$, v_id)),
    1::bigint, 'the L&D Manager edits a course');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.courses set status = 'archived' where id = %L$q$, v_id)),
    1::bigint, 'and archives it');
  select * into v_course from tms.courses where id = v_id;
  perform tests.assert(v_course.archived_at is not null and v_course.archived_by = 'a1000000-0000-4000-8000-00000000d001'
                       and v_course.version = 3,
    'archive stamped with the person and the time; version 3');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.courses set status = 'active' where id = %L$q$, v_id)),
    1::bigint, 'and restores it');
  perform tests.assert((select archived_at is null and archived_by is null from tms.courses where id = v_id),
    'restored: the archive stamps are cleared');
  perform tests.assert_check_constraint(format($q$update tms.courses set status = 'retired' where id = %L$q$, v_id),
    'courses_status_check', 'active or archived only');

  -- Costs removed: no currency.
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.courses set est_cost_per_session = null where id = %L$q$, v_id)),
    1::bigint, 'costs can be removed');
  perform tests.assert((select cost_currency is null from tms.courses where id = v_id), 'without costs there is no currency');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The costs keep the currency they were entered in (BR-ADM-2): a later change of the organization's
-- default currency applies to amounts entered or changed after it.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_lead constant uuid := 'a7100000-0000-4000-8000-000000000001';
begin
  -- The Organization Admin changes the default currency …
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_settings set currency_code = 'AED'$q$), 1::bigint,
    'fixture: the organization''s default currency becomes AED');
  -- … the L&D Manager edits a title: the amounts stay in SAR; changing an amount takes AED.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000d001', '10000000-0000-4000-8000-00000000d001', v_a,
                                             'a1000000-0000-4000-8000-00000000d001'));
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.courses set title_en = 'Strategic management (2026)' where id = %L$q$, v_lead)),
    1::bigint, 'a title edit');
  perform tests.assert_eq((select cost_currency from tms.courses where id = v_lead), 'SAR', 'the amounts keep their currency');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.courses set est_cost_per_session = 16000 where id = %L$q$, v_lead)),
    1::bigint, 'an amount changes');
  perform tests.assert_eq((select cost_currency from tms.courses where id = v_lead), 'AED',
    'the changed amounts are in the organization''s current currency');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The Training Coordinator (uTC) adds and edits but does not archive or restore; a custom role with
-- tms.course.manage (uCR) works the same way.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_lead constant uuid := 'a7100000-0000-4000-8000-000000000001';
  v_old constant uuid := 'a7100000-0000-4000-8000-000000000002';
  r record;
begin
  for r in select * from (values ('00000000-0000-4000-8000-00000000d002'::uuid, 'a1000000-0000-4000-8000-00000000d002'::uuid, 'TC'),
                                 ('00000000-0000-4000-8000-00000000d005', 'a1000000-0000-4000-8000-00000000d005', 'CR')) as m (u, p, tag) loop
    perform tests.set_claims(tests.user_claims(r.u, replace(r.u::text, '00000000-0000', '10000000-0000')::uuid, v_a, r.p));
    perform tests.assert(private.current_tenant_id() = v_a, format('%s: valid claims', r.tag));
    perform tests.assert_eq(tests.rows_affected(format($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, max_participants) values ('NEW-%s', 'New', 'جديدة', 'virtual', 2, 25)$q$, r.tag)),
      1::bigint, format('%s adds a course', r.tag));
    perform tests.assert_eq(tests.rows_affected(format($q$insert into tms.course_categories (name_en, name_ar) values ('Cat %s', 'تصنيف %s')$q$, r.tag, r.tag)),
      1::bigint, format('%s adds a category', r.tag));
    perform tests.assert_eq(tests.rows_affected(format($q$update tms.courses set duration_hours = 14 where id = %L$q$, v_lead)),
      1::bigint, format('%s edits a course', r.tag));
    perform tests.assert_fails_like(format($q$update tms.courses set status = 'archived' where id = %L$q$, v_lead),
      'only members who may archive courses can archive or restore them', format('%s cannot archive', r.tag));
    perform tests.assert_fails_like(format($q$update tms.courses set status = 'active' where id = %L$q$, v_old),
      'only members who may archive courses can archive or restore them', format('%s cannot restore', r.tag));
  end loop;
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Members without tms.course.manage change nothing: the Organization Admin (a setup role, BR-IAM-4), the
-- HR Manager, the Department Head and the Employee (each reads the rows; the application decides who sees
-- the library).
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_lead constant uuid := 'a7100000-0000-4000-8000-000000000001';
  v_cat constant uuid := 'a7000000-0000-4000-8000-000000000001';
  r record;
begin
  for r in select * from (values
             ('00000000-0000-4000-8000-0000000000a1'::uuid, '10000000-0000-4000-8000-0000000000a1'::uuid, 'a1000000-0000-4000-8000-0000000000a1'::uuid, 'Organization Admin'),
             ('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', 'a1000000-0000-4000-8000-0000000000ab', 'HR Manager'),
             ('00000000-0000-4000-8000-00000000d003', '10000000-0000-4000-8000-00000000d003', 'a1000000-0000-4000-8000-00000000d003', 'Department Head'),
             ('00000000-0000-4000-8000-00000000d004', '10000000-0000-4000-8000-00000000d004', 'a1000000-0000-4000-8000-00000000d004', 'Employee')
           ) as m (u, s, p, tag) loop
    perform tests.set_claims(tests.user_claims(r.u, r.s, v_a, r.p));
    perform tests.assert(private.current_tenant_id() = v_a, format('%s: valid claims', r.tag));
    perform tests.assert_fails_like($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, max_participants) values ('NOPE-1', 'No', 'لا', 'classroom', 1, 10)$q$,
      'only members who manage the course library can add courses', format('%s cannot add a course', r.tag));
    perform tests.assert_fails_like(format($q$update tms.courses set title_en = 'Hijacked' where id = %L$q$, v_lead),
      'only members who manage the course library can change courses', format('%s cannot edit a course', r.tag));
    perform tests.assert_fails_like(format($q$update tms.courses set title_en = title_en where id = %L$q$, v_lead),
      'only members who manage the course library can change courses', format('%s cannot touch a course', r.tag));
    perform tests.assert_fails_like(format($q$update tms.courses set status = 'archived' where id = %L$q$, v_lead),
      'only members who may archive courses can archive or restore them', format('%s cannot archive', r.tag));
    perform tests.assert_fails_like($q$insert into tms.course_categories (name_en, name_ar) values ('Nope', 'لا')$q$,
      'only members who manage the course library can add or change categories', format('%s cannot add a category', r.tag));
    perform tests.assert_fails_like(format($q$update tms.course_categories set name_en = 'Hijacked' where id = %L$q$, v_cat),
      'only members who manage the course library can add or change categories', format('%s cannot rename a category', r.tag));
    perform tests.assert_eq((select count(*) from tms.courses where title_en = 'Hijacked'), 0::bigint,
      format('%s: nothing changed', r.tag));
  end loop;
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Another organization: tenant B's L&D Manager (uLB) never reaches tenant A's library; the guard checks the
-- permission in the claims' organization (uLB's training_manager role is B's, not A's).
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000d006', '10000000-0000-4000-8000-00000000d006',
  'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-00000000d006'));
do $$
begin
  perform tests.assert_eq((select string_agg(code, ',') from tms.courses), 'LEAD-101', 'tenant B''s L&D Manager sees B''s course only');
  perform tests.assert_eq(tests.rows_affected($q$update tms.courses set title_en = 'x' where id = 'a7100000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'tenant A''s course is out of reach');
  perform tests.assert_eq(tests.rows_affected($q$update tms.courses set status = 'archived' where id = 'a7100000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'and cannot be archived');
  perform tests.assert_rls_violation($q$insert into tms.courses (tenant_id, code, title_en, title_ar, delivery_type, duration_hours, max_participants) values ('a0000000-0000-4000-8000-000000000001', 'X-9', 'x', 'س', 'classroom', 1, 10)$q$,
    'no course is planted in tenant A');
  perform tests.assert_rls_violation($q$insert into tms.course_categories (tenant_id, name_en, name_ar) values ('a0000000-0000-4000-8000-000000000001', 'x', 'س')$q$,
    'no category is planted in tenant A');
  perform tests.assert_fails($q$insert into tms.courses (code, title_en, title_ar, category_id, delivery_type, duration_hours, max_participants) values ('X-10', 'x', 'س', 'a7000000-0000-4000-8000-000000000001', 'classroom', 1, 10)$q$,
    array['23503'], 'nor pointed at tenant A''s category');
  perform tests.assert_eq(tests.rows_affected($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, max_participants) values ('OWN-1', 'Own', 'خاصة', 'exam', 1, 50)$q$),
    1::bigint, 'B''s L&D Manager adds to B''s own library');
  perform tests.assert_eq((select tenant_id from tms.courses where code = 'OWN-1'), 'b0000000-0000-4000-8000-000000000001'::uuid,
    'in tenant B');
end $$;
rollback;

-- The permission helper the guards use: what the fixtures' members hold organization-wide.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000d002', '10000000-0000-4000-8000-00000000d002',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000d002'));
do $$
begin
  perform tests.assert(private.member_has_permission('a0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000d002', 'tms.course.manage'), 'fixture: the coordinator holds tms.course.manage');
  perform tests.assert(not private.member_has_permission('a0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000d002', 'tms.course.archive'), 'but not tms.course.archive');
  perform tests.assert(not private.member_has_permission('a0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-0000000000a1', 'tms.course.read'), 'the Organization Admin holds no course permission');
end $$;
rollback;

\echo '99_course_library_users_app_server: ok'
