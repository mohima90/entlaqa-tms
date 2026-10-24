-- db-test: run-as=owner
-- The people bulk import × the person's cost centre (WP-HR-01; business flow EP-ORG-structure-completion.md §3 A;
-- migration 20261103100400): the dry run finds the cost centre by code or name (inactive, ambiguous and not
-- found are warnings), the review shows the change for an existing member, the run writes it with the rest of
-- the row (a new person without one gets the unit's default) and the undo puts the member's back. Like
-- 88_user_imports_flow_owner.sql, the owner connection switches between the worker (system claims) and the
-- importer (uA, Organization Admin). Fixtures: 00_helpers_and_fixtures.sql, 85_user_imports_fixtures.sql.
-- Every block is rolled back.
\set ON_ERROR_STOP on

create or replace function pg_temp.become_worker() returns void language plpgsql as $$
begin
  set local session authorization app_worker;
  set local role authenticated;
  perform tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.user_imports'));
end $$;
create or replace function pg_temp.become_admin() returns void language plpgsql as $$
begin
  set local session authorization app_server;
  set local role authenticated;
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                             'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
end $$;
create or replace function pg_temp.become_owner() returns void language plpgsql as $$
begin
  reset role;
  reset session authorization;
end $$;
create or replace function pg_temp.stage(p_row integer, p_data jsonb) returns void language sql as $$
  insert into platform.user_import_rows (tenant_id, import_id, row_number, cells, data, format_issues, issues)
  values ('a0000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-0000000000c1', p_row, p_data, p_data, '[]', '[]');
$$;
create or replace function pg_temp.codes(p_row integer) returns text language sql as $$
  select coalesce(string_agg((i ->> 'c') || ':' || (i ->> 's'), ',' order by i ->> 'c'), '')
  from platform.user_import_rows r, jsonb_array_elements(r.issues) i
  where r.import_id = 'a5000000-0000-4000-8000-0000000000c1' and r.row_number = p_row;
$$;
create or replace function pg_temp.person_cc(p_email text) returns text language sql as $$
  select c.code from platform.persons p
  join platform.person_employment e on e.tenant_id = p.tenant_id and e.person_id = p.id
  left join platform.cost_centres c on c.tenant_id = e.tenant_id and c.id = e.cost_centre_id
  where p.tenant_id = 'a0000000-0000-4000-8000-000000000001' and p.email = p_email and p.removed_at is null;
$$;

begin;
-- Cost centres of tenant A: CC-100 (fixture, active), CC-OLD inactive, two called «Shared».
insert into platform.cost_centres (tenant_id, code, name_en, status) values
  ('a0000000-0000-4000-8000-000000000001', 'CC-OLD', 'Old', 'inactive'),
  ('a0000000-0000-4000-8000-000000000001', 'CC-S1', 'Shared', 'active'),
  ('a0000000-0000-4000-8000-000000000001', 'CC-S2', 'Shared', 'active');
-- The unit TD gives CC-100 by default.
update platform.departments set default_cost_centre_id = 'a7000000-0000-4000-8000-0000000000cc'
  where tenant_id = 'a0000000-0000-4000-8000-000000000001' and code = 'TD';

select tests.import_file('a5000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-0000000000c1');
insert into platform.user_imports (id, tenant_id, created_by, created_by_person, file_id, file_name, file_size, status,
                                   sheets, sheet_index, mapping, review_expires_at)
values ('a5000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
        'a1000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-0000000000c1', 'staff.csv', 100, 'validating',
        '[{"name": "", "rows": 10, "columns": 4}]', 0,
        '{"0": "email", "1": "first_name_ar", "2": "family_name_ar", "3": "cost_centre"}', now() + interval '1 day');
select pg_temp.stage(2, '{"email": "cc-new@imp.test", "first_name_ar": "جديد", "family_name_ar": "بمركز", "cost_centre": "cc-100"}');
select pg_temp.stage(3, '{"email": "exist@imp.test", "first_name_ar": "موجود", "family_name_ar": "قديم", "cost_centre": "CC-100"}');
select pg_temp.stage(4, '{"email": "cc-old@imp.test", "first_name_ar": "مركز", "family_name_ar": "موقوف", "cost_centre": "CC-OLD",
                          "department": "TD"}');
select pg_temp.stage(5, '{"email": "cc-amb@imp.test", "first_name_ar": "اسم", "family_name_ar": "مكرر", "cost_centre": "shared"}');
select pg_temp.stage(6, '{"email": "cc-none@imp.test", "first_name_ar": "مركز", "family_name_ar": "مجهول", "cost_centre": "NOPE"}');

select pg_temp.become_worker();
select private.user_import_classify('a5000000-0000-4000-8000-0000000000c1');
select private.user_import_classify_cost_centres('a5000000-0000-4000-8000-0000000000c1');
do $$
begin
  perform tests.assert((select cost_centre_id = 'a7000000-0000-4000-8000-0000000000cc' from platform.user_import_rows
                        where import_id = 'a5000000-0000-4000-8000-0000000000c1' and row_number = 2),
    'a cost centre by its code, letter case ignored');
  perform tests.assert_eq(pg_temp.codes(2), '', 'found: no issue');
  perform tests.assert_eq(pg_temp.codes(4), 'COST_CENTRE_INACTIVE:w', 'an inactive cost centre is a warning');
  perform tests.assert_eq(pg_temp.codes(5), 'COST_CENTRE_AMBIGUOUS:w', 'a name two cost centres share is a warning');
  perform tests.assert_eq(pg_temp.codes(6), 'COST_CENTRE_NOT_FOUND:w', 'a cost centre not found is a warning');
  perform tests.assert((select count(*) = 0 from platform.user_import_rows
                        where import_id = 'a5000000-0000-4000-8000-0000000000c1' and row_number in (4, 5, 6)
                          and cost_centre_id is not null), 'warnings give no cost centre');
  perform tests.assert((select changes @> '[{"f": "cost_centre", "to": "CC-100"}]' from platform.user_import_rows
                        where import_id = 'a5000000-0000-4000-8000-0000000000c1' and row_number = 3),
    'the review shows the existing member''s new cost centre');
  perform tests.assert((select review_kind = 'existing' from platform.user_import_rows
                        where import_id = 'a5000000-0000-4000-8000-0000000000c1' and row_number = 3),
    'row 3 updates an existing member');
end $$;
update platform.user_imports set status = 'review' where id = 'a5000000-0000-4000-8000-0000000000c1';

-- The run.
select pg_temp.become_admin();
update platform.user_imports set status = 'queued',
  options = '{"existing": "upsert", "defaultRole": "learner", "invitations": "hold"}'
  where id = 'a5000000-0000-4000-8000-0000000000c1';
select pg_temp.become_worker();
update platform.user_imports set status = 'checking' where id = 'a5000000-0000-4000-8000-0000000000c1';
select private.user_import_recheck('a5000000-0000-4000-8000-0000000000c1');
update platform.user_imports set status = 'importing' where id = 'a5000000-0000-4000-8000-0000000000c1';
do $$
begin
  while private.user_import_apply_batch('a5000000-0000-4000-8000-0000000000c1', 50) > 0 loop
  end loop;
end $$;
select private.user_import_finish_rows('a5000000-0000-4000-8000-0000000000c1');
update platform.user_imports set status = 'finished' where id = 'a5000000-0000-4000-8000-0000000000c1';
select pg_temp.become_owner();
do $$
begin
  perform tests.assert_eq((select string_agg(row_number || ':' || result, ',' order by row_number) from platform.user_import_rows
                           where import_id = 'a5000000-0000-4000-8000-0000000000c1'),
    '2:added,3:updated,4:added,5:added,6:added', 'every row is written');
  perform tests.assert_eq(pg_temp.person_cc('cc-new@imp.test'), 'CC-100', 'a new person gets the file''s cost centre');
  perform tests.assert_eq(pg_temp.person_cc('exist@imp.test'), 'CC-100', 'an existing member''s cost centre is changed');
  perform tests.assert_eq(pg_temp.person_cc('cc-old@imp.test'), 'CC-100',
    'an inactive cost centre in the file: the person gets the unit''s default');
  perform tests.assert(pg_temp.person_cc('cc-none@imp.test') is null, 'not found, no unit: no cost centre');
  perform tests.assert((select before ? 'cost_centre_id' from platform.user_import_rows
                        where import_id = 'a5000000-0000-4000-8000-0000000000c1' and row_number = 3),
    'the member''s former cost centre is kept for the undo');
end $$;

-- The undo puts the member's cost centre back and removes the people it added.
select pg_temp.become_admin();
update platform.user_imports set status = 'undoing', undo_reason = 'wrong_data' where id = 'a5000000-0000-4000-8000-0000000000c1';
select pg_temp.become_worker();
do $$
begin
  while private.user_import_undo_batch('a5000000-0000-4000-8000-0000000000c1', 50) > 0 loop
  end loop;
end $$;
select pg_temp.become_owner();
do $$
begin
  perform tests.assert_eq((select undo_result from platform.user_import_rows
                           where import_id = 'a5000000-0000-4000-8000-0000000000c1' and row_number = 3), 'restored',
    'the member''s record is restored');
  perform tests.assert(pg_temp.person_cc('exist@imp.test') is null, 'the member has no cost centre again');
  perform tests.assert(pg_temp.person_cc('cc-new@imp.test') is null, 'the person the import added is removed');
end $$;
rollback;

-- The mapping allows the field «cost_centre» (and still refuses unknown fields).
do $$
begin
  perform tests.assert(private.user_import_mapping_is_valid('{"0": "email", "1": "first_name_en", "2": "family_name_en", "3": "cost_centre"}'),
    'the cost-centre column can be mapped');
  perform tests.assert(not private.user_import_mapping_is_valid('{"0": "email", "1": "first_name_en", "2": "family_name_en", "3": "cost_centre_id"}'),
    'an unknown field is refused');
end $$;
