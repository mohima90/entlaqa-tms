-- db-test: run-as=app_server
-- Needs forms (T-M3-10; FR-PLN-02/03; migrations 20261020180000…180400), CONNECTED AS app_server. Who designs
-- them (the L&D Manager, tms.needs_form.manage; the Training Coordinator and the Organization Admin only
-- read or not at all), names, the default form (one, active, never deleted), system fields (always there,
-- required, shown, unconditional), conditions (same section, a select/radio answer, no loop; dependants keep
-- a valid condition; deleting the trigger field clears them), the lock (frozen structure, one-way, any
-- member may lock), duplicating (conditions re-pointed) and deleting (cascade). Fixtures:
-- 00_helpers_and_fixtures.sql (forms) and 99_needs_forms_0_fixtures.sql (uLnd …71, uTc …72). Each block is
-- rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- ---------------------------------------------------------------------------------------------------
-- Who designs: not the Organization Admin, not the HR Manager, not the Training Coordinator.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
declare
  c record;
begin
  for c in select * from (values
      ('Organization Admin', tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
        'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1')),
      ('HR Manager', tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
        'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab')),
      ('Training Coordinator', tests.user_claims('00000000-0000-4000-8000-000000000072', '10000000-0000-4000-8000-000000000072',
        'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000072'))) as x (who, claims) loop
    perform tests.set_claims(c.claims);
    perform tests.assert((select count(*) from tms.needs_forms) >= 2, c.who || ': reads the organization''s forms');
    perform tests.assert_fails_like($q$insert into tms.needs_forms (name_en, name_ar) values ('Mine', 'لي')$q$,
      'only an L&D Manager can design needs forms', c.who || ': cannot create a form');
    perform tests.assert_fails_like($q$select private.seed_needs_form('a0000000-0000-4000-8000-000000000001', 'Mine', 'لي', false, false)$q$,
      'only an L&D Manager can design needs forms', c.who || ': cannot create a form through the seeding function');
    perform tests.assert_fails_like($q$update tms.needs_forms set name_en = 'Renamed' where id = 'a7000000-0000-4000-8000-000000000001'$q$,
      'only an L&D Manager can design needs forms', c.who || ': cannot rename a form');
    perform tests.assert_fails_like($q$delete from tms.needs_forms where id = 'a7000000-0000-4000-8000-000000000001'$q$,
      'only an L&D Manager can design needs forms', c.who || ': cannot delete a form');
    perform tests.assert_fails_like($q$update tms.needs_form_sections set name_en = 'x' where id = 'a7100000-0000-4000-8000-000000000001'$q$,
      'only an L&D Manager can design needs forms', c.who || ': cannot change a section');
    perform tests.assert_fails_like($q$update tms.needs_form_fields set label_en = 'x' where id = 'a7200000-0000-4000-8000-000000000003'$q$,
      'only an L&D Manager can design needs forms', c.who || ': cannot change a field');
    perform tests.assert_fails_like($q$select private.duplicate_needs_form('a7000000-0000-4000-8000-000000000001', 'Copy', 'نسخة')$q$,
      'only an L&D Manager can design needs forms', c.who || ': cannot duplicate a form');
  end loop;
end $$;
rollback;

-- System claims under app_server never resolve a tenant (ADR 0002 §6a): nothing to read or write.
begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.needs_forms), 0::bigint, 'system claims under app_server read nothing');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The L&D Manager designs: create, names, sections, fields, options.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000071'));
do $$
declare
  v_form uuid;
  v_section uuid;
  v_row tms.needs_forms;
begin
  v_form := private.seed_needs_form('a0000000-0000-4000-8000-000000000001', 'Engineering needs', 'احتياجات الهندسة', false, false);
  select * into v_row from tms.needs_forms where id = v_form;
  perform tests.assert_eq(row(v_row.is_default, v_row.is_active, v_row.locked_at, v_row.created_by, v_row.version)::text,
    row(false, true, null::timestamptz, 'a1000000-0000-4000-8000-000000000071'::uuid, 1)::text,
    'a new form: not default, active, unlocked, stamped with the actor');
  perform tests.assert_eq((select string_agg(coalesce(system_key, '-') || ':' || field_type, ',' order by sort_order)
                           from tms.needs_form_fields where form_id = v_form),
    'training_topic:text,people:people', 'a blank form holds the two system fields');
  select id into v_section from tms.needs_form_sections where form_id = v_form;
  perform tests.assert_eq((select row(is_repeatable, min_entries, max_entries)::text from tms.needs_form_sections where id = v_section),
    row(true, 1::smallint, 50::smallint)::text, 'one repeatable «Training needs» section, 1–50 entries');

  -- Names: unique in the organization, case-insensitive, trimmed.
  perform tests.assert_fails($q$insert into tms.needs_forms (name_en, name_ar) values ('ENGINEERING NEEDS', 'آخر')$q$,
    array['23505'], 'English names are unique in the organization (case-insensitive)');
  perform tests.assert_fails($q$insert into tms.needs_forms (name_en, name_ar) values ('Other', 'احتياجات الهندسة')$q$,
    array['23505'], 'Arabic names are unique in the organization');
  perform tests.assert_check_constraint($q$insert into tms.needs_forms (name_en, name_ar) values (' Padded', 'مسافة')$q$,
    'needs_forms_name_en_check', 'names are trimmed');
  perform tests.assert_privilege_denied($q$insert into tms.needs_forms (name_en, name_ar, locked_at) values ('Locked', 'مقفل', now())$q$,
    'a form is never created locked');
  perform tests.assert_eq(tests.rows_affected($q$update tms.needs_forms set name_en = 'Fixture form B' where id = 'a7000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'the designer renames a form');

  -- Sections: entries, names.
  perform tests.assert_check_constraint(format($q$insert into tms.needs_form_sections (form_id, name_en, name_ar, is_repeatable, min_entries, max_entries) values (%L, 'One', 'واحد', false, 1, 5)$q$, v_form),
    'needs_form_sections_entries_check', 'a section that does not repeat has one entry');
  perform tests.assert_check_constraint(format($q$insert into tms.needs_form_sections (form_id, name_en, name_ar, is_repeatable, min_entries, max_entries) values (%L, 'Many', 'كثير', true, 6, 5)$q$, v_form),
    'needs_form_sections_entries_check', 'min entries at most max entries');
  perform tests.assert_eq(tests.rows_affected(format($q$insert into tms.needs_form_sections (form_id, name_en, name_ar, sort_order) values (%L, 'Context', 'السياق', 2)$q$, v_form)),
    1::bigint, 'the designer adds a section');

  -- Fields: types, options, people.
  perform tests.assert_check_constraint(format($q$insert into tms.needs_form_fields (form_id, section_id, field_type, label_en, label_ar) values (%L, %L, 'slider', 'x', 'س')$q$, v_form, v_section),
    'needs_form_fields_field_type_check', 'one of the 12 types (+ people)');
  perform tests.assert_check_constraint(format($q$insert into tms.needs_form_fields (form_id, section_id, field_type, label_en, label_ar) values (%L, %L, 'select', 'Choice', 'خيار')$q$, v_form, v_section),
    'needs_form_fields_options_check', 'a dropdown needs options');
  perform tests.assert_check_constraint(format($q$insert into tms.needs_form_fields (form_id, section_id, field_type, label_en, label_ar, options) values (%L, %L, 'text', 'Text', 'نص', '[{"value": "a", "label_en": "A", "label_ar": "أ"}]')$q$, v_form, v_section),
    'needs_form_fields_options_check', 'a text field has no options');
  perform tests.assert_check_constraint(format($q$insert into tms.needs_form_fields (form_id, section_id, field_type, label_en, label_ar, options) values (%L, %L, 'radio', 'Twice', 'مكرر', '[{"value": "a", "label_en": "A", "label_ar": "أ"}, {"value": "a", "label_en": "B", "label_ar": "ب"}]')$q$, v_form, v_section),
    'needs_form_fields_options_check', 'option values are distinct');
  perform tests.assert_check_constraint(format($q$insert into tms.needs_form_fields (form_id, section_id, field_type, label_en, label_ar, options) values (%L, %L, 'radio', 'Arabic', 'عربي', '[{"value": "a", "label_en": "A"}]')$q$, v_form, v_section),
    'needs_form_fields_options_check', 'every option has an English and an Arabic label');
  perform tests.assert_check_constraint(format($q$insert into tms.needs_form_fields (form_id, section_id, field_type, label_en, label_ar, people_mode) values (%L, %L, 'people', 'More people', 'آخرون', 'count')$q$, v_form, v_section),
    'needs_form_fields_system_type_check', 'the people type is the system field''s only');
  perform tests.assert_fails(format($q$insert into tms.needs_form_fields (form_id, section_id, system_key, field_type, label_en, label_ar, is_required) values (%L, %L, 'training_topic', 'text', 'Second topic', 'موضوع ثان', true)$q$, v_form, v_section),
    array['23505'], 'each system field once per form');
  perform tests.assert_eq(tests.rows_affected(format($q$insert into tms.needs_form_fields (form_id, section_id, field_type, label_en, label_ar, is_required, sort_order, options) values (%L, %L, 'multiselect', 'Skills', 'المهارات', true, 3, '[{"value": "excel", "label_en": "Excel", "label_ar": "إكسل"}, {"value": "sql", "label_en": "SQL", "label_ar": "إس كيو إل"}]')$q$, v_form, v_section)),
    1::bigint, 'the designer adds a field with options in both languages');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- System fields and their section stay.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000071'));
do $$
begin
  perform tests.assert_fails($q$delete from tms.needs_form_fields where id = 'a7200000-0000-4000-8000-000000000001'$q$,
    array['JN002'], 'the training topic cannot be deleted');
  perform tests.assert_fails($q$delete from tms.needs_form_fields where id = 'a7200000-0000-4000-8000-000000000002'$q$,
    array['JN002'], 'the people field cannot be deleted');
  perform tests.assert_check_constraint($q$update tms.needs_form_fields set is_required = false where id = 'a7200000-0000-4000-8000-000000000001'$q$,
    'needs_form_fields_system_rules_check', 'a system field stays required');
  perform tests.assert_check_constraint($q$update tms.needs_form_fields set is_visible = false where id = 'a7200000-0000-4000-8000-000000000002'$q$,
    'needs_form_fields_system_rules_check', 'a system field stays shown');
  perform tests.assert_check_constraint($q$update tms.needs_form_fields set condition_field_id = 'a7200000-0000-4000-8000-000000000003', condition_value = 'basic' where id = 'a7200000-0000-4000-8000-000000000001'$q$,
    'needs_form_fields_system_rules_check', 'a system field is never conditional');
  perform tests.assert_check_constraint($q$update tms.needs_form_fields set field_type = 'textarea' where id = 'a7200000-0000-4000-8000-000000000001'$q$,
    'needs_form_fields_system_type_check', 'the training topic stays short text');
  perform tests.assert_privilege_denied($q$update tms.needs_form_fields set system_key = null where id = 'a7200000-0000-4000-8000-000000000001'$q$,
    'the system role of a field never changes');
  perform tests.assert_eq(tests.rows_affected($q$update tms.needs_form_fields set label_en = 'Topic of the training', label_ar = 'موضوع التدريب المطلوب', placeholder_en = 'e.g. Excel', sort_order = 9, people_mode = null where id = 'a7200000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'labels, placeholders and order of a system field change');
  perform tests.assert_eq(tests.rows_affected($q$update tms.needs_form_fields set people_mode = 'employees' where id = 'a7200000-0000-4000-8000-000000000002'$q$),
    1::bigint, 'the people field''s mode changes');
  perform tests.assert_fails($q$update tms.needs_form_sections set is_visible = false where id = 'a7100000-0000-4000-8000-000000000001'$q$,
    array['JN002'], 'the section with the system fields is always shown');
  perform tests.assert_fails($q$delete from tms.needs_form_sections where id = 'a7100000-0000-4000-8000-000000000001'$q$,
    array['JN002'], 'the section with the system fields cannot be deleted');
end $$;
rollback;

-- A form without its system fields is refused at commit.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000071'));
do $$
begin
  insert into tms.needs_forms (name_en, name_ar) values ('Empty', 'فارغ');
  perform tests.assert_fails($q$set constraints tms.needs_forms_system_fields immediate$q$,
    array['JN002'], 'a form keeps its training topic and people fields');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The default form: one per organization, active, not deleted; moving it in one transaction.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000071'));
do $$
declare
  v_default uuid := (select id from tms.needs_forms where is_default);
begin
  perform tests.assert_eq((select count(*) from tms.needs_forms where is_default), 1::bigint, 'one default form (seeded)');
  perform tests.assert_fails($q$update tms.needs_forms set is_default = true where id = 'a7000000-0000-4000-8000-000000000001'$q$,
    array['23505'], 'never two defaults');
  perform tests.assert_check_constraint(format($q$update tms.needs_forms set is_active = false where id = %L$q$, v_default),
    'needs_forms_default_active_check', 'the default form stays active');
  perform tests.assert_fails(format($q$delete from tms.needs_forms where id = %L$q$, v_default),
    array['JN003'], 'the default form cannot be deleted');
  -- Moving the default: clear, then set, in one transaction.
  update tms.needs_forms set is_default = false where id = v_default;
  update tms.needs_forms set is_default = true where id = 'a7000000-0000-4000-8000-000000000001';
  set constraints tms.needs_forms_one_default immediate;
  perform tests.assert_eq((select id from tms.needs_forms where is_default), 'a7000000-0000-4000-8000-000000000001'::uuid,
    'the default moved');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.needs_forms set is_active = false where id = %L$q$, v_default)),
    1::bigint, 'a form that is not the default can be switched off');
end $$;
rollback;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000071'));
do $$
begin
  update tms.needs_forms set is_default = false where is_default;
  perform tests.assert_fails($q$set constraints tms.needs_forms_one_default immediate$q$,
    array['JN003'], 'an organization never stays without a default form');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Conditions.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000071'));
do $$
declare
  v_form constant uuid := 'a7000000-0000-4000-8000-000000000001';
  v_section constant uuid := 'a7100000-0000-4000-8000-000000000001';
  v_level constant uuid := 'a7200000-0000-4000-8000-000000000003';
  v_detail constant uuid := 'a7200000-0000-4000-8000-0000000000d1';
  v_other_section uuid := gen_random_uuid();
begin
  insert into tms.needs_form_fields (id, form_id, section_id, field_type, label_en, label_ar, sort_order, condition_field_id, condition_value)
  values (v_detail, v_form, v_section, 'textarea', 'Advanced details', 'تفاصيل المستوى المتقدم', 4, v_level, 'advanced');
  perform tests.assert_eq((select condition_value from tms.needs_form_fields where id = v_detail), 'advanced',
    'a field shown on one answer of a dropdown of the same section');
  perform tests.assert_fails(format($q$insert into tms.needs_form_fields (form_id, section_id, field_type, label_en, label_ar, condition_field_id, condition_value) values (%L, %L, 'text', 'x', 'س', %L, 'expert')$q$, v_form, v_section, v_level),
    array['JN004'], 'the answer must be one of the dropdown''s values');
  perform tests.assert_fails(format($q$insert into tms.needs_form_fields (form_id, section_id, field_type, label_en, label_ar, condition_field_id, condition_value) values (%L, %L, 'text', 'x', 'س', 'a7200000-0000-4000-8000-000000000001', 'basic')$q$, v_form, v_section),
    array['JN004'], 'a condition on a text field is refused');
  insert into tms.needs_form_sections (id, form_id, name_en, name_ar, sort_order) values (v_other_section, v_form, 'Other', 'أخرى', 2);
  perform tests.assert_fails(format($q$insert into tms.needs_form_fields (form_id, section_id, field_type, label_en, label_ar, condition_field_id, condition_value) values (%L, %L, 'text', 'x', 'س', %L, 'basic')$q$, v_form, v_other_section, v_level),
    array['23503'], 'a condition on a field of another section is refused (foreign key)');
  perform tests.assert_check_constraint(format($q$update tms.needs_form_fields set condition_field_id = %L, condition_value = 'basic' where id = %L$q$, v_level, v_level),
    'needs_form_fields_condition_check', 'a field never depends on itself');
  -- A loop: Level shown on an answer of a dropdown that is shown on an answer of Level.
  insert into tms.needs_form_fields (id, form_id, section_id, field_type, label_en, label_ar, sort_order, options, condition_field_id, condition_value)
  values ('a7200000-0000-4000-8000-0000000000d2', v_form, v_section, 'radio', 'Track', 'المسار', 5,
          '[{"value": "a", "label_en": "A", "label_ar": "أ"}]', v_level, 'basic');
  perform tests.assert_fails(format($q$update tms.needs_form_fields set condition_field_id = 'a7200000-0000-4000-8000-0000000000d2', condition_value = 'a' where id = %L$q$, v_level),
    array['JN004'], 'conditions never go round in a circle');
  -- Dependants keep a valid condition.
  perform tests.assert_fails(format($q$update tms.needs_form_fields set options = '[{"value": "basic", "label_en": "Basic", "label_ar": "أساسي"}]' where id = %L$q$, v_level),
    array['JN004'], 'an answer others depend on cannot be removed');
  perform tests.assert_fails(format($q$update tms.needs_form_fields set field_type = 'multiselect' where id = %L$q$, v_level),
    array['JN004'], 'a field others depend on stays a dropdown or single choice');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.needs_form_fields set options = options || '[{"value": "expert", "label_en": "Expert", "label_ar": "خبير"}]' where id = %L$q$, v_level)),
    1::bigint, 'answers can be added');
  -- Deleting the dropdown clears the conditions on it.
  delete from tms.needs_form_fields where id = v_level;
  perform tests.assert_eq((select count(*) from tms.needs_form_fields where condition_field_id = v_level), 0::bigint,
    'deleting a field clears the conditions that pointed at it');
  perform tests.assert((select condition_field_id is null from tms.needs_form_fields where id = v_detail),
    'the dependant is always shown now');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The lock: frozen structure, one-way, only a planning-cycle manager locks (the launch, S-L1); duplicate to
-- change.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
-- The Training Coordinator (tms.plan_cycle.read, not .manage) cannot lock a form (S-L1, 20261020210100).
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000072', '10000000-0000-4000-8000-000000000072',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000072'));
do $$
begin
  perform tests.assert_fails_like($q$select private.lock_needs_form('a7000000-0000-4000-8000-000000000001')$q$,
    'a needs form is locked only by launching a planning cycle', 'the Training Coordinator does not lock forms');
  perform tests.assert_fails($q$update tms.needs_forms set locked_at = now() where id = 'a7000000-0000-4000-8000-000000000001'$q$,
    array['42501'], 'nor by writing the column');
  perform tests.assert_fails($q$update tms.needs_forms set locked_at = now(), name_en = 'Sneaky' where id = 'a7000000-0000-4000-8000-000000000001'$q$,
    array['42501'], 'locking does not carry other changes past the rules');
end $$;
-- The L&D Manager (tms.plan_cycle.manage) locks, as a cycle launch does.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000071'));
do $$
declare
  v_copy uuid;
begin
  perform tests.assert(private.lock_needs_form('a7000000-0000-4000-8000-000000000001'), 'a planning-cycle manager locks');
  perform tests.assert(private.lock_needs_form('a7000000-0000-4000-8000-000000000001'), 'locking twice is harmless');
  perform tests.assert(not private.lock_needs_form(gen_random_uuid()), 'an unknown form is not locked');
  perform tests.assert((select locked_at is not null from tms.needs_forms where id = 'a7000000-0000-4000-8000-000000000001'),
    'the form is locked');
  perform tests.assert_fails($q$insert into tms.needs_form_sections (form_id, name_en, name_ar) values ('a7000000-0000-4000-8000-000000000001', 'More', 'المزيد')$q$,
    array['JN001'], 'no section is added to a locked form');
  perform tests.assert_fails($q$update tms.needs_form_sections set name_en = 'x' where id = 'a7100000-0000-4000-8000-000000000001'$q$,
    array['JN001'], 'no section of a locked form changes');
  perform tests.assert_fails($q$insert into tms.needs_form_fields (form_id, section_id, field_type, label_en, label_ar) values ('a7000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'text', 'x', 'س')$q$,
    array['JN001'], 'no field is added to a locked form');
  perform tests.assert_fails($q$update tms.needs_form_fields set label_en = 'x' where id = 'a7200000-0000-4000-8000-000000000003'$q$,
    array['JN001'], 'no field of a locked form changes');
  perform tests.assert_fails($q$delete from tms.needs_form_fields where id = 'a7200000-0000-4000-8000-000000000003'$q$,
    array['JN001'], 'no field of a locked form is deleted');
  perform tests.assert_fails($q$update tms.needs_forms set locked_at = null where id = 'a7000000-0000-4000-8000-000000000001'$q$,
    array['JN001'], 'a locked form stays locked');
  perform tests.assert_fails($q$delete from tms.needs_forms where id = 'a7000000-0000-4000-8000-000000000001'$q$,
    array['JN001'], 'a locked form cannot be deleted');
  perform tests.assert_eq(tests.rows_affected($q$update tms.needs_forms set name_en = 'Fixture form 2026', is_active = false where id = 'a7000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'its names and library state still change');

  -- Duplicate it to change it: a new, unlocked form.
  v_copy := private.duplicate_needs_form('a7000000-0000-4000-8000-000000000001', 'Fixture form (copy)', 'نموذج الاختبار (نسخة)');
  perform tests.assert_eq((select row(is_default, is_active, locked_at)::text from tms.needs_forms where id = v_copy),
    row(false, true, null::timestamptz)::text, 'the copy: not default, active, unlocked');
  perform tests.assert_eq((select count(*) from tms.needs_form_fields where form_id = v_copy), 3::bigint, 'every field copied');
  perform tests.assert_eq((select count(distinct system_key) from tms.needs_form_fields where form_id = v_copy and system_key is not null),
    2::bigint, 'with both system fields');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.needs_form_fields set label_en = 'Changed' where form_id = %L and system_key is null$q$, v_copy)),
    1::bigint, 'the copy can be changed');
end $$;
rollback;

-- Duplicating re-points conditions (an unlocked source with a dependant).
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000071'));
do $$
declare
  v_copy uuid;
  v_dependant record;
begin
  insert into tms.needs_form_fields (form_id, section_id, field_type, label_en, label_ar, sort_order, condition_field_id, condition_value)
  values ('a7000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'text', 'Details', 'التفاصيل', 4,
          'a7200000-0000-4000-8000-000000000003', 'advanced');
  v_copy := private.duplicate_needs_form('a7000000-0000-4000-8000-000000000001', 'Copy', 'نسخة');
  select d.condition_value, t.form_id as target_form, t.label_en as target_label into v_dependant
  from tms.needs_form_fields d join tms.needs_form_fields t on t.id = d.condition_field_id
  where d.form_id = v_copy;
  perform tests.assert_eq(row(v_dependant.condition_value, v_dependant.target_form, v_dependant.target_label)::text,
    row('advanced', v_copy, 'Level')::text, 'the copy''s condition points at the copy''s dropdown');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Deleting a form that is neither default nor locked takes its sections and fields with it.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000071'));
do $$
begin
  insert into tms.needs_form_fields (form_id, section_id, field_type, label_en, label_ar, sort_order, condition_field_id, condition_value)
  values ('a7000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'text', 'Details', 'التفاصيل', 4,
          'a7200000-0000-4000-8000-000000000003', 'advanced');
  perform tests.assert_eq(tests.rows_affected($q$delete from tms.needs_forms where id = 'a7000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'the designer deletes a form');
  perform tests.assert_eq((select count(*) from tms.needs_form_sections where form_id = 'a7000000-0000-4000-8000-000000000001')
                          + (select count(*) from tms.needs_form_fields where form_id = 'a7000000-0000-4000-8000-000000000001'),
    0::bigint, 'with its sections and fields (system fields included)');
  set constraints all immediate;
end $$;
rollback;

\echo '99_needs_forms_1_app_server: ok'
