-- db-test: run-as=app_server
-- Branches and departments (T-M2-01, ADM-04/05): constraints, tree rules and [std] stamping.
-- Runs CONNECTED AS app_server with tenant-A claims (uA, person a1). Each block is rolled back.
\set ON_ERROR_STOP on

-- Constraints and soft-delete uniqueness.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_fails($q$insert into platform.branches (code, name_ar) values ('bad code', 'فرع')$q$,
    array['23514'], 'branches: code format is checked');
  perform tests.assert_fails($q$insert into platform.branches (code, name_ar) values ('X', '   ')$q$,
    array['23514'], 'branches: Arabic name cannot be blank');
  perform tests.assert_fails($q$insert into platform.branches (code, name_ar, status) values ('X', 'فرع', 'closed')$q$,
    array['23514'], 'branches: status check');
  perform tests.assert_fails($q$insert into platform.branches (code, name_ar, country_code) values ('X', 'فرع', 'sa')$q$,
    array['23514'], 'branches: country code is ISO alpha-2 upper case');
  perform tests.assert_fails($q$insert into platform.branches (code, name_ar, timezone) values ('X', 'فرع', 'Asia/Riyadh; drop')$q$,
    array['23514'], 'branches: timezone format');
  perform tests.assert_fails($q$insert into platform.branches (code, name_ar, is_headquarters) values ('HQ2', 'مقر ثان', true)$q$,
    array['23505'], 'branches: one headquarters per tenant');
  perform tests.assert_fails($q$insert into platform.branches (code, name_ar) values ('ruh', 'تكرار')$q$,
    array['23505'], 'branches: code unique per tenant, case-insensitive');
  perform tests.assert_fails($q$update platform.branches set deleted_by = 'a1000000-0000-4000-8000-0000000000a1' where code = 'JED'$q$,
    array['23514'], 'branches: deleted_by requires deleted_at');
  perform tests.assert_fails($q$update platform.branches set parent_branch_id = id where code = 'JED'$q$,
    array['23514'], 'branches: a branch cannot be its own parent');

  -- Soft delete frees the code (partial unique index).
  perform tests.assert_eq(tests.rows_affected($q$update platform.branches set deleted_at = now(), deleted_by = 'a1000000-0000-4000-8000-0000000000a1' where code = 'JED'$q$),
    1::bigint, 'branches: soft delete');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.branches (code, name_ar) values ('JED', 'فرع جدة الجديد')$q$),
    1::bigint, 'branches: a deleted branch''s code can be reused');

  perform tests.assert_fails($q$insert into platform.departments (code, name_ar) values ('td', 'تكرار')$q$,
    array['23505'], 'departments: code unique per tenant, case-insensitive');
  perform tests.assert_fails($q$insert into platform.departments (code, name_ar, status) values ('X', 'قسم', 'archived')$q$,
    array['23514'], 'departments: status check');
  perform tests.assert_fails($q$insert into platform.departments (code, name_ar, name_en) values ('X', 'قسم', '')$q$,
    array['23514'], 'departments: English name cannot be empty when given');
end $$;
rollback;

-- Department tree: no self-parent, no cycles, at most 10 levels (including moved subtrees).
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  v_parent uuid := 'a3000000-0000-4000-8000-000000000003';  -- OPS (root)
  v_id uuid;
  i integer;
begin
  perform tests.assert_fails($q$update platform.departments set parent_id = id where code = 'TD'$q$,
    array['23514'], 'departments: cannot be its own parent');
  perform tests.assert_fails($q$update platform.departments set parent_id = 'a3000000-0000-4000-8000-000000000002' where code = 'TD'$q$,
    array['23514'], 'departments: cannot move under its own child (cycle)');

  -- OPS is level 1; add levels 2..10 under it → allowed.
  for i in 2..10 loop
    insert into platform.departments (code, name_ar, parent_id) values ('L' || i, 'مستوى ' || i, v_parent)
      returning id into v_parent;
  end loop;
  perform tests.assert_fails(format($q$insert into platform.departments (code, name_ar, parent_id) values ('L11', 'مستوى 11', %L)$q$, v_parent),
    array['23514'], 'departments: an 11th level is rejected');
  -- Moving TD (which has one child level) under level 9 would put its child at level 11.
  select id into v_id from platform.departments where code = 'L9';
  perform tests.assert_fails(format($q$update platform.departments set parent_id = %L where code = 'TD'$q$, v_id),
    array['23514'], 'departments: moving a subtree may not exceed 10 levels');
  select id into v_id from platform.departments where code = 'L8';
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.departments set parent_id = %L where code = 'TD'$q$, v_id)),
    1::bigint, 'departments: moving the subtree to exactly 10 levels is allowed');
end $$;
rollback;

-- [std] stamping: actor ids come from the claims, never from the row; version counts updates.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  r record;
begin
  insert into platform.departments (code, name_ar, created_by, updated_by, version, created_at)
  values ('NEW', 'قسم جديد', 'a1000000-0000-4000-8000-0000000000ab', 'a1000000-0000-4000-8000-0000000000ab', 42, '2000-01-01');
  select * into r from platform.departments where code = 'NEW';
  perform tests.assert_eq(r.created_by, 'a1000000-0000-4000-8000-0000000000a1'::uuid, 'stamp: created_by is the claims person, not the sent value');
  perform tests.assert_eq(r.updated_by, 'a1000000-0000-4000-8000-0000000000a1'::uuid, 'stamp: updated_by on insert is the claims person');
  perform tests.assert_eq(r.version, 1, 'stamp: version starts at 1');
  perform tests.assert(r.created_at > now() - interval '1 minute', 'stamp: created_at cannot be backdated');

  update platform.departments set name_ar = 'قسم معدل', created_by = null, version = 99, created_at = '2000-01-01' where code = 'NEW';
  select * into r from platform.departments where code = 'NEW';
  perform tests.assert_eq(r.created_by, 'a1000000-0000-4000-8000-0000000000a1'::uuid, 'stamp: created_by is immutable');
  perform tests.assert_eq(r.version, 2, 'stamp: version increments by one per update');
  perform tests.assert(r.created_at > now() - interval '1 minute', 'stamp: created_at is immutable');
end $$;
rollback;

-- System jobs (no person in the claims) stamp NULL actors.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  insert into platform.branches (code, name_ar, created_by) values ('SYS', 'فرع', 'a1000000-0000-4000-8000-0000000000a1');
  perform tests.assert((select created_by is null from platform.branches where code = 'SYS'),
    'stamp: no person claim → created_by NULL even when a value is sent');
end $$;
rollback;

\echo '21_org_structure: ok'
