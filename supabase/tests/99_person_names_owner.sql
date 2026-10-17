-- db-test: run-as=owner
-- Names that follow the organization's default language (guided-test feedback #2, PO 17 Oct 2026;
-- 20261021090000–20261021090200): a person may have an English name only; every person keeps a name (an
-- Arabic display name or a complete English name); records written before the change stay valid and
-- writable; the import mapping takes the names in either language. Every block is rolled back.
\set ON_ERROR_STOP on

begin;
do $$
declare
  v_id uuid;
  v_version integer;
begin
  -- The check is validated (existing rows were scanned) and the Arabic display name is nullable.
  perform tests.assert((select c.convalidated from pg_catalog.pg_constraint c
                        where c.conrelid = 'platform.persons'::regclass and c.conname = 'persons_name_present_check'),
    'persons_name_present_check is validated against the existing rows');
  perform tests.assert((select not a.attnotnull from pg_catalog.pg_attribute a
                        where a.attrelid = 'platform.persons'::regclass and a.attname = 'display_name_ar'),
    'persons.display_name_ar is nullable');

  -- English only, complete: allowed.
  insert into platform.persons (tenant_id, display_name_ar, display_name_en, first_name_en, family_name_en, email)
  values ('a0000000-0000-4000-8000-000000000001', null, 'Sara Ali', 'Sara', 'Ali', 'sara.names@a.test')
  returning id into v_id;
  perform tests.assert((select display_name_ar is null from platform.persons where id = v_id),
    'a person can be saved with an English name only');

  -- English only, incomplete, or no name at all: refused.
  perform tests.assert_check_constraint(
    $q$insert into platform.persons (tenant_id, display_name_en, first_name_en) values ('a0000000-0000-4000-8000-000000000001', 'Sara', 'Sara')$q$,
    'persons_name_present_check', 'an English-only name needs the family name');
  perform tests.assert_check_constraint(
    $q$insert into platform.persons (tenant_id, first_name_en, family_name_en) values ('a0000000-0000-4000-8000-000000000001', 'Sara', 'Ali')$q$,
    'persons_name_present_check', 'an English-only name needs its display name');
  perform tests.assert_check_constraint(
    $q$insert into platform.persons (tenant_id, email) values ('a0000000-0000-4000-8000-000000000001', 'nameless@a.test')$q$,
    'persons_name_present_check', 'a person without any name is refused');
  -- A GIVEN Arabic name is still checked.
  perform tests.assert_fails(
    $q$insert into platform.persons (tenant_id, display_name_ar, display_name_en, first_name_en, family_name_en) values ('a0000000-0000-4000-8000-000000000001', '  ', 'Sara Ali', 'Sara', 'Ali')$q$,
    array['23514'], 'an Arabic display name, when given, needs visible text');

  -- The English-only person cannot lose the English name (nor its family name) while it has no Arabic one.
  perform tests.assert_check_constraint(
    format('update platform.persons set family_name_en = null where id = %L', v_id),
    'persons_name_present_check', 'an English-only person keeps a complete English name');
  -- …but can add an Arabic name, and then drop the English one.
  update platform.persons set display_name_ar = 'سارة علي', first_name_ar = 'سارة', family_name_ar = 'علي' where id = v_id;
  update platform.persons set display_name_en = null, first_name_en = null, family_name_en = null where id = v_id;
  perform tests.assert((select display_name_ar = 'سارة علي' and display_name_en is null from platform.persons where id = v_id),
    'a person can switch from an English to an Arabic name');

  -- Records written before the change (an Arabic display name, no parts, no English) stay writable, and
  -- cannot lose their only name.
  select version into v_version from platform.persons where id = 'a1000000-0000-4000-8000-0000000000a3';
  update platform.persons set mobile_e164 = '+966500000001' where id = 'a1000000-0000-4000-8000-0000000000a3';
  perform tests.assert((select version = v_version + 1 from platform.persons where id = 'a1000000-0000-4000-8000-0000000000a3'),
    'an existing Arabic-only record is still updatable');
  perform tests.assert_check_constraint(
    $q$update platform.persons set display_name_ar = null where id = 'a1000000-0000-4000-8000-0000000000a3'$q$,
    'persons_name_present_check', 'an existing record keeps its Arabic name while it has no English one');
end $$;
rollback;

-- The import mapping (TM-0003 T-IAM-20): e-mail plus the first and family names in Arabic OR English.
begin;
do $$
begin
  perform tests.assert(private.user_import_mapping_is_valid('{"0": "email", "1": "first_name_ar", "2": "family_name_ar"}'),
    'mapping: e-mail and the Arabic names');
  perform tests.assert(private.user_import_mapping_is_valid('{"0": "email", "1": "first_name_en", "2": "family_name_en"}'),
    'mapping: e-mail and the English names');
  perform tests.assert(private.user_import_mapping_is_valid(
    '{"0": "email", "1": "first_name_en", "2": "family_name_en", "3": "first_name_ar", "4": "family_name_ar", "5": "department"}'),
    'mapping: both languages');
  perform tests.assert(not private.user_import_mapping_is_valid('{"0": "email", "1": "first_name_en", "2": "family_name_ar"}'),
    'mapping: a first name in one language and the family name in the other is not a name');
  perform tests.assert(not private.user_import_mapping_is_valid('{"0": "first_name_en", "1": "family_name_en"}'),
    'mapping: the e-mail stays required');
  perform tests.assert(not private.user_import_mapping_is_valid('{"0": "email", "1": "first_name_en"}'),
    'mapping: a first name alone is not enough');
  perform tests.assert(not private.user_import_mapping_is_valid('{"0": "email", "1": "first_name_en", "2": "family_name_en", "3": "email"}'),
    'mapping: each field once');
  perform tests.assert(not private.user_import_mapping_is_valid('{"0": "email", "1": "first_name_en", "2": "family_name_en", "3": "status"}'),
    'mapping: allowed fields only');
end $$;
rollback;

-- The review's «what changes» (20261021100000): a direct manager with an English name only is named by it —
-- as the new manager (was: the change was not listed at all) and as the current one (was: no «from»).
begin;
do $$
declare
  v_tenant constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_english constant uuid := 'a1000000-0000-4000-8000-00000000c001';
  v_arabic constant uuid := 'a1000000-0000-4000-8000-00000000c002';
  v_staff constant uuid := 'a1000000-0000-4000-8000-00000000c003';
begin
  insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, first_name_en, family_name_en, email, status)
  values (v_english, v_tenant, null, 'Mona Saleh', 'Mona', 'Saleh', 'mona.manager@names.test', 'active'),
         (v_arabic, v_tenant, 'خالد العتيبي', 'Khalid Alotaibi', 'Khalid', 'Alotaibi', 'khalid.manager@names.test', 'active'),
         (v_staff, v_tenant, 'سارة', null, null, null, 'sara.staff@names.test', 'active');
  insert into platform.person_employment (tenant_id, person_id, manager_person_id) values (v_tenant, v_staff, v_arabic);

  perform tests.assert_eq(
    private.user_import_changes(v_tenant, v_staff, '{}'::jsonb, null, null, v_english, 'mona.manager@names.test'),
    '[{"f": "manager", "from": "خالد العتيبي", "to": "Mona Saleh"}]'::jsonb,
    'import changes: a new manager with an English name only is listed by that name');

  update platform.person_employment set manager_person_id = v_english where tenant_id = v_tenant and person_id = v_staff;
  perform tests.assert_eq(
    private.user_import_changes(v_tenant, v_staff, '{}'::jsonb, null, null, v_arabic, 'khalid.manager@names.test'),
    '[{"f": "manager", "from": "Mona Saleh", "to": "خالد العتيبي"}]'::jsonb,
    'import changes: the current manager with an English name only is named by it');
  perform tests.assert_eq(
    private.user_import_changes(v_tenant, v_staff, '{}'::jsonb, null, null, v_english, 'mona.manager@names.test'),
    '[]'::jsonb, 'import changes: the same English-only manager is no change');
end $$;
rollback;

-- An import whose file has English names only (English default): the person is added without an Arabic
-- name (was: an empty one, refused by the persons checks). The run as the steps do it (88_user_imports_flow_owner.sql).
create or replace function pg_temp.become_worker() returns void language plpgsql as $$
begin
  set local session authorization app_worker;
  set local role authenticated;
  perform tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.user_imports'));
end $$;
create or replace function pg_temp.become_importer() returns void language plpgsql as $$
begin
  set local session authorization app_server;
  set local role authenticated;
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                                             'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
end $$;

begin;
select tests.import_file('a5000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000ab', 'f0a00000-0000-4000-8000-0000000000f1');
insert into platform.user_imports (id, tenant_id, created_by, created_by_person, file_id, file_name, file_size, status,
                                   sheets, sheet_index, mapping, review_expires_at)
values ('a5000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab',
        'a1000000-0000-4000-8000-0000000000ab', 'f0a00000-0000-4000-8000-0000000000f1', 'staff.csv', 100, 'validating',
        '[{"name": "", "rows": 3, "columns": 5}]', 0,
        '{"0": "email", "1": "first_name_en", "2": "family_name_en", "3": "first_name_ar", "4": "family_name_ar"}', now() + interval '1 day');
insert into platform.user_import_rows (tenant_id, import_id, row_number, cells, data, format_issues, issues)
values ('a0000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-0000000000f1', 2,
        '{"email": "english.only@imp.test", "first_name_en": "Sara", "family_name_en": "Ali"}',
        '{"email": "english.only@imp.test", "first_name_en": "Sara", "family_name_en": "Ali"}', '[]', '[]'),
       ('a0000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-0000000000f1', 3,
        '{"email": "both.names@imp.test", "first_name_en": "Omar", "family_name_en": "Saleh", "first_name_ar": "عمر", "family_name_ar": "صالح"}',
        '{"email": "both.names@imp.test", "first_name_en": "Omar", "family_name_en": "Saleh", "first_name_ar": "عمر", "family_name_ar": "صالح"}', '[]', '[]');
select pg_temp.become_worker();
select private.user_import_classify('a5000000-0000-4000-8000-0000000000f1');
update platform.user_imports set status = 'review' where id = 'a5000000-0000-4000-8000-0000000000f1';
select pg_temp.become_importer();
update platform.user_imports set status = 'queued', options = '{"existing": "upsert", "defaultRole": "learner", "invitations": "hold"}'
where id = 'a5000000-0000-4000-8000-0000000000f1';
select pg_temp.become_worker();
update platform.user_imports set status = 'checking' where id = 'a5000000-0000-4000-8000-0000000000f1';
select private.user_import_recheck('a5000000-0000-4000-8000-0000000000f1');
update platform.user_imports set status = 'importing' where id = 'a5000000-0000-4000-8000-0000000000f1';
select private.user_import_apply_batch('a5000000-0000-4000-8000-0000000000f1', 50);
reset role;
reset session authorization;
do $$
begin
  perform tests.assert_eq((select string_agg(row_number || ':' || result, ',' order by row_number) from platform.user_import_rows
                           where import_id = 'a5000000-0000-4000-8000-0000000000f1'),
    '2:added,3:added', 'import: both rows are added');
  perform tests.assert((select display_name_ar is null and display_name_en = 'Sara Ali' and first_name_en = 'Sara'
                        from platform.persons where email = 'english.only@imp.test'),
    'import: an English-only row adds a person without an Arabic name');
  perform tests.assert((select display_name_ar = 'عمر صالح' and display_name_en = 'Omar Saleh'
                        from platform.persons where email = 'both.names@imp.test'),
    'import: the optional Arabic names given make the Arabic display name');
end $$;
rollback;


-- The Super Admin console (20261021090300, 20261021100100): English first and family names alone give an
-- English-only person; English text never goes into the Arabic slot — an English first name alone gets the
-- neutral Arabic name until the invitee sets their own (the console form refuses half a name anyway).
-- Uses the Super Admin uP (…f1, session …fa01) of 95_platform_admin_owner.sql.
create or replace function pg_temp.become_super_admin() returns void language plpgsql as $$
begin
  set local session authorization app_server;
  set local role authenticated;
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f1',
                                             '10000000-0000-4000-8000-00000000fa01', null));
end $$;

begin;
select pg_temp.become_super_admin();
select count(*) from private.platform_create_tenant('names-english', 'منشأة الأسماء', 'Names Co', 'sara@names-english.test',
                                                    null, null, 'Sara', 'Ali', 'en');
select count(*) from private.platform_create_tenant('names-partial', 'منشأة', null, 'omar@names-partial.test',
                                                    null, null, 'Omar', null, 'en');
reset role;
reset session authorization;
do $$
begin
  perform tests.assert((select display_name_ar is null and display_name_en = 'Sara Ali' and first_name_en = 'Sara'
                               and family_name_en = 'Ali'
                        from platform.persons where email = 'sara@names-english.test'),
    'console: an English first and family name alone give no Arabic display name');
  perform tests.assert((select display_name_ar = 'مدير المنشأة' and display_name_en = 'Omar' and first_name_en = 'Omar'
                        from platform.persons where email = 'omar@names-partial.test'),
    'console: an English first name alone does not fill the Arabic slot (the neutral Arabic name)');
end $$;
rollback;

\echo '99_person_names_owner: ok'
