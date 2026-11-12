-- db-test: run-as=app_server
-- Units of the structure, branches and structure levels are named in at least one language (WP-UX-01 b,
-- T-M3-21; migrations 20261113100000…100200; FR-ADM-04, FR-ADM-05; PO 12 Nov 2026): one name is enough, in
-- either language; no name at all is refused; a given name is still checked (visible, within its length); the
-- bulk import's «what changes» names a unit or branch that has an English name only. As the HR Manager of
-- tenant A (uAB: platform.org.manage). Fixtures: 00_helpers_and_fixtures.sql. Every block is rolled back.
\set ON_ERROR_STOP on

begin;
set local role authenticated;
select tests.set_claims(tests.uab_claims());
do $$
declare
  v_unit_en uuid;
  v_unit_ar uuid;
  v_branch_en uuid;
  v_branch_ar uuid;
begin
  -- The checks are validated (existing rows were scanned) and the Arabic names are nullable.
  perform tests.assert_eq((select count(*) from pg_catalog.pg_constraint c
                           where c.convalidated
                             and (c.conrelid, c.conname) in (
                               ('platform.departments'::regclass, 'departments_name_present_check'),
                               ('platform.branches'::regclass, 'branches_name_present_check'),
                               ('platform.structure_levels'::regclass, 'structure_levels_name_present_check'))),
    3::bigint, 'the three «a name in at least one language» checks are validated');
  perform tests.assert_eq((select count(*) from pg_catalog.pg_attribute a
                           where not a.attnotnull
                             and (a.attrelid, a.attname) in (
                               ('platform.departments'::regclass, 'name_ar'),
                               ('platform.branches'::regclass, 'name_ar'),
                               ('platform.structure_levels'::regclass, 'name_ar'),
                               ('platform.structure_levels'::regclass, 'name_en'))),
    4::bigint, 'the Arabic names (and a level''s English name) are nullable');

  -- Units: English only, Arabic only.
  insert into platform.departments (code, name_en) values ('LRN', 'Learning') returning id into v_unit_en;
  insert into platform.departments (code, name_ar) values ('FIN', 'المالية') returning id into v_unit_ar;
  perform tests.assert_eq((select name_ar from platform.departments where id = v_unit_en), null::text,
    'a unit named in English only keeps no Arabic name');
  perform tests.assert_eq((select name_en from platform.departments where id = v_unit_ar), null::text,
    'a unit named in Arabic only keeps no English name');
  perform tests.assert_check_constraint($q$insert into platform.departments (code) values ('NONAME')$q$,
    'departments_name_present_check', 'a unit without any name is refused');
  perform tests.assert_check_constraint(format($q$update platform.departments set name_en = null where id = %L$q$, v_unit_en),
    'departments_name_present_check', 'the only name of a unit cannot be removed');
  perform tests.assert_check_constraint(format($q$update platform.departments set name_ar = '   ' where id = %L$q$, v_unit_en),
    'departments_name_ar_check', 'a given Arabic name of a unit must be visible text');
  perform tests.assert_check_constraint(format($q$update platform.departments set name_ar = %L where id = %L$q$, repeat('ق', 201), v_unit_en),
    'departments_name_ar_check', 'a given Arabic name of a unit keeps its length limit');
  -- The other language can be added later, and removed again.
  update platform.departments set name_ar = 'التعلّم' where id = v_unit_en;
  update platform.departments set name_ar = null where id = v_unit_en;

  -- Branches: English only, Arabic only.
  insert into platform.branches (code, name_en) values ('DMM', 'Dammam') returning id into v_branch_en;
  insert into platform.branches (code, name_ar) values ('MED', 'فرع المدينة') returning id into v_branch_ar;
  perform tests.assert_eq((select name_ar from platform.branches where id = v_branch_en), null::text,
    'a branch named in English only keeps no Arabic name');
  perform tests.assert_eq((select name_en from platform.branches where id = v_branch_ar), null::text,
    'a branch named in Arabic only keeps no English name');
  perform tests.assert_check_constraint($q$insert into platform.branches (code) values ('NONAME')$q$,
    'branches_name_present_check', 'a branch without any name is refused');
  perform tests.assert_check_constraint(format($q$update platform.branches set name_en = null where id = %L$q$, v_branch_en),
    'branches_name_present_check', 'the only name of a branch cannot be removed');
  perform tests.assert_check_constraint(format($q$update platform.branches set name_ar = %L where id = %L$q$, chr(8203), v_branch_en),
    'branches_name_ar_check', 'a given Arabic name of a branch must be visible text');
  update platform.branches set name_ar = 'فرع الدمام' where id = v_branch_en;
  update platform.branches set name_ar = null where id = v_branch_en;

  -- The bulk import's «what changes» (private.user_import_changes, 20261113100200): the HR Manager's own
  -- record moves from TD-PRG / RUH to the English-only unit and branch — both named by their English name.
  perform tests.assert_eq(
    private.user_import_changes('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab',
                                '{}'::jsonb, v_unit_en, v_branch_en, null, null),
    '[{"f": "department", "from": "برامج التدريب", "to": "Learning"}, {"f": "branch", "from": "فرع الرياض", "to": "Dammam"}]'::jsonb,
    'import changes: a new unit and branch with an English name only are listed by that name');
  -- … and an Arabic name still comes first when both exist.
  perform tests.assert_eq(
    private.user_import_changes('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab',
                                '{}'::jsonb, 'a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002', null, null),
    '[{"f": "department", "from": "برامج التدريب", "to": "العمليات"}, {"f": "branch", "from": "فرع الرياض", "to": "فرع جدة"}]'::jsonb,
    'import changes: a unit and branch with both names are listed by the Arabic one, as before');
end $$;
rollback;

-- Levels: one name is enough; two levels without an Arabic name do not collide; a level is renamed to one name.
begin;
set local role authenticated;
select tests.set_claims(tests.uab_claims());
do $$
declare
  v_id uuid;
begin
  -- Levels are added only while nobody is placed in a unit (WP-HR-01, JO004): the Organization Admin unplaces
  -- tenant A's people first (rolled back with the block).
  perform tests.set_claims(tests.ua_claims());
  update platform.person_employment set department_id = null where tenant_id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.set_claims(tests.uab_claims());

  insert into platform.structure_levels (ordinal, name_en) values (3, 'Team') returning id into v_id;
  insert into platform.structure_levels (ordinal, name_en) values (4, 'Squad');
  insert into platform.structure_levels (ordinal, name_ar) values (5, 'خلية');
  perform tests.assert_eq((select string_agg(ordinal || ':' || coalesce(name_en, '-') || ':' || coalesce(name_ar, '-'), ',' order by ordinal)
                           from platform.structure_levels where ordinal >= 3),
    '3:Team:-,4:Squad:-,5:-:خلية', 'levels named in one language only (no collision between missing names)');
  perform tests.assert_check_constraint($q$insert into platform.structure_levels (ordinal) values (6)$q$,
    'structure_levels_name_present_check', 'a level without any name is refused');
  perform tests.assert_check_constraint(format($q$update platform.structure_levels set name_en = null where id = %L$q$, v_id),
    'structure_levels_name_present_check', 'the only name of a level cannot be removed');
  perform tests.assert_check_constraint(format($q$update platform.structure_levels set name_ar = ' فريق' where id = %L$q$, v_id),
    'structure_levels_name_ar_check', 'a given Arabic name of a level is still trimmed');
  perform tests.assert_fails($q$insert into platform.structure_levels (ordinal, name_en) values (6, 'TEAM')$q$,
    array['23505'], 'a given English name is still unique in the organization (case-insensitive)');
  -- A level with both names is renamed to its English name only (the default level «Department / إدارة»).
  update platform.structure_levels set name_ar = null where ordinal = 1;
  perform tests.assert((select name_en = 'Department' and name_ar is null from platform.structure_levels where ordinal = 1),
    'a level keeps one name when the other is cleared');
end $$;
rollback;

\echo '99_structure_6_names_app_server: ok'
