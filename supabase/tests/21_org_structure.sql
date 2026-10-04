-- db-test: run-as=app_server
-- Branches and departments (T-M2-01, ADM-04/05): constraints, tree rules, references to live rows and
-- [std]/[sd] stamping. Runs CONNECTED AS app_server with tenant-A claims (uA, person a1).
-- Each block is rolled back.
\set ON_ERROR_STOP on

-- Constraints and soft-delete uniqueness.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_check_constraint($q$insert into platform.branches (code, name_ar) values ('bad code', 'فرع')$q$,
    'branches_code_check', 'branches: code format is checked');
  perform tests.assert_check_constraint($q$insert into platform.branches (code, name_ar) values ('X', '   ')$q$,
    'branches_name_ar_check', 'branches: Arabic name cannot be blank');
  perform tests.assert_check_constraint(format('insert into platform.branches (code, name_ar) values (%L, %L)', 'X', E'\t\n​ '),
    'branches_name_ar_check', 'branches: Arabic name cannot be only invisible characters');
  perform tests.assert_check_constraint(format('insert into platform.branches (code, name_ar, city_ar) values (%L, %L, %L)', 'X', 'فرع', repeat('م', 121)),
    'branches_city_check', 'branches: city length is limited');
  perform tests.assert_check_constraint($q$insert into platform.branches (code, name_ar, status) values ('X', 'فرع', 'closed')$q$,
    'branches_status_check', 'branches: status check');
  perform tests.assert_check_constraint($q$insert into platform.branches (code, name_ar, country_code) values ('X', 'فرع', 'sa')$q$,
    'branches_country_code_check', 'branches: country code is ISO alpha-2 upper case');
  perform tests.assert_fails($q$insert into platform.branches (code, name_ar, timezone) values ('X', 'فرع', 'Mars/Olympus')$q$,
    array['23514'], 'branches: timezone must be a known IANA name');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.branches (code, name_ar, timezone) values ('DXB', 'فرع دبي', 'Asia/Dubai')$q$),
    1::bigint, 'branches: a known timezone is accepted');
  perform tests.assert_fails($q$insert into platform.branches (code, name_ar, is_headquarters) values ('HQ2', 'مقر ثان', true)$q$,
    array['23505'], 'branches: one headquarters per tenant');
  perform tests.assert_fails($q$insert into platform.branches (code, name_ar) values ('ruh', 'تكرار')$q$,
    array['23505'], 'branches: code unique per tenant, case-insensitive');
  perform tests.assert_check_constraint($q$update platform.branches set parent_branch_id = id where code = 'JED'$q$,
    'branches_parent_check', 'branches: a branch cannot be its own parent');

  perform tests.assert_fails($q$insert into platform.departments (code, name_ar) values ('td', 'تكرار')$q$,
    array['23505'], 'departments: code unique per tenant, case-insensitive');
  perform tests.assert_check_constraint($q$insert into platform.departments (code, name_ar, status) values ('X', 'قسم', 'archived')$q$,
    'departments_status_check', 'departments: status check');
  perform tests.assert_check_constraint($q$insert into platform.departments (code, name_ar, name_en) values ('X', 'قسم', '')$q$,
    'departments_name_en_check', 'departments: English name cannot be empty when given');
  perform tests.assert_check_constraint($q$update platform.departments set parent_id = id where code = 'TD'$q$,
    'departments_parent_check', 'departments: cannot be its own parent');

  -- Soft delete frees the code (partial unique index). OPS lives in JED, so move it first.
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set branch_id = 'a2000000-0000-4000-8000-000000000001' where code = 'OPS'$q$),
    1::bigint, 'fixture: OPS moves to RUH');
  perform tests.assert_eq(tests.rows_affected($q$update platform.branches set deleted_at = now() where code = 'JED'$q$),
    1::bigint, 'branches: soft delete');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.branches (code, name_ar) values ('JED', 'فرع جدة الجديد')$q$),
    1::bigint, 'branches: a deleted branch''s code can be reused');
end $$;
rollback;

-- Trees: no cycles, at most 10 levels (including moved subtrees), no deleted parents, no deleting a
-- row that still has live children. Hierarchy changes are serialised per tenant (advisory lock).
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
  perform tests.assert_fails($q$update platform.departments set parent_id = 'a3000000-0000-4000-8000-000000000002' where code = 'TD'$q$,
    array['23514'], 'departments: cannot move under its own child (cycle)');
  perform tests.assert_eq(tests.rows_affected($q$update platform.branches set parent_branch_id = 'a2000000-0000-4000-8000-000000000002' where code = 'RUH'$q$),
    1::bigint, 'branches: RUH under JED');
  perform tests.assert_fails($q$update platform.branches set parent_branch_id = 'a2000000-0000-4000-8000-000000000001' where code = 'JED'$q$,
    array['23514'], 'branches: cycles are rejected too');

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

  -- Live children block a soft delete; a deleted parent cannot receive (or restore) children.
  perform tests.assert_fails($q$update platform.departments set deleted_at = now() where code = 'TD'$q$,
    array['23514'], 'departments: cannot soft-delete a department with live sub-departments');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set deleted_at = now() where code = 'TD-PRG'$q$),
    1::bigint, 'departments: soft-delete the child first');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set deleted_at = now() where code = 'TD'$q$),
    1::bigint, 'departments: then the parent');
  perform tests.assert_fails($q$insert into platform.departments (code, name_ar, parent_id) values ('X', 'قسم', 'a3000000-0000-4000-8000-000000000001')$q$,
    array['23514'], 'departments: cannot be placed under a deleted parent');
  perform tests.assert_fails($q$update platform.departments set deleted_at = null where code = 'TD-PRG'$q$,
    array['23514'], 'departments: cannot be restored under a deleted parent');
  perform tests.assert_fails($q$update platform.branches set deleted_at = now() where code = 'JED'$q$,
    array['23514'], 'branches: cannot soft-delete a branch with live sub-branches');

  perform tests.assert((select prosrc ilike '%pg_advisory_xact_lock%' from pg_proc
                        where oid = 'private.check_tree()'::regprocedure),
    'check_tree serialises hierarchy changes per tenant (advisory lock; concurrent moves cannot form a cycle)');
end $$;
rollback;

-- References must point at live rows.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_fails($q$update platform.branches set deleted_at = now() where code = 'JED'$q$,
    array['23514'], 'branches: cannot soft-delete a branch that live departments belong to');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.branches (code, name_ar) values ('OLD', 'فرع قديم')$q$),
    1::bigint, 'fixture: an unused branch');
  perform tests.assert_eq(tests.rows_affected($q$update platform.branches set deleted_at = now() where code = 'OLD'$q$),
    1::bigint, 'branches: an unused branch can be soft-deleted');
  perform tests.assert_fails($q$insert into platform.departments (code, name_ar, branch_id) select 'X', 'قسم', id from platform.branches where code = 'OLD'$q$,
    array['23514'], 'departments: cannot belong to a deleted branch');

  insert into platform.persons (id, display_name_ar, status) values ('a1000000-0000-4000-8000-0000000000f2', 'موظف سابق', 'inactive');
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000000f2' where code = 'OPS'$q$,
    array['23514'], 'departments: the head must be an active person');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000000ab' where code = 'OPS'$q$),
    1::bigint, 'departments: an active person can be head');
end $$;
rollback;

-- [std] and [sd] stamping: actor ids and times come from the claims and the clock, never from the row.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  r record;
  v_created timestamptz;
begin
  insert into platform.departments (code, name_ar, created_by, updated_by, version, created_at, deleted_at, deleted_by)
  values ('NEW', 'قسم جديد', 'a1000000-0000-4000-8000-0000000000ab', 'a1000000-0000-4000-8000-0000000000ab', 42, '2000-01-01',
          '2000-01-01', 'b1000000-0000-4000-8000-0000000000b1');
  select * into r from platform.departments where code = 'NEW';
  perform tests.assert_eq(r.created_by, 'a1000000-0000-4000-8000-0000000000a1'::uuid, 'stamp: created_by is the claims person, not the sent value');
  perform tests.assert_eq(r.updated_by, 'a1000000-0000-4000-8000-0000000000a1'::uuid, 'stamp: updated_by on insert is the claims person');
  perform tests.assert_eq(r.version, 1, 'stamp: version starts at 1');
  perform tests.assert(r.created_at > now() - interval '1 minute', 'stamp: created_at cannot be backdated');
  perform tests.assert(r.deleted_at is null and r.deleted_by is null, 'stamp: a row cannot be inserted as deleted');
  v_created := r.created_at;

  -- Another person (uAB, person ab) updates; forged values are ignored.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
    'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
  update platform.departments
     set name_ar = 'قسم معدل', created_by = null, updated_by = 'b1000000-0000-4000-8000-0000000000b1', version = 99,
         created_at = '2000-01-01', updated_at = '2000-01-01'
   where code = 'NEW';
  select * into r from platform.departments where code = 'NEW';
  perform tests.assert_eq(r.created_by, 'a1000000-0000-4000-8000-0000000000a1'::uuid, 'stamp: created_by is immutable');
  perform tests.assert_eq(r.created_at, v_created, 'stamp: created_at is immutable');
  perform tests.assert_eq(r.updated_by, 'a1000000-0000-4000-8000-0000000000ab'::uuid, 'stamp: updated_by is the updating person');
  perform tests.assert(r.updated_at > now() - interval '1 minute', 'stamp: updated_at is the clock, not the sent value');
  perform tests.assert_eq(r.version, 2, 'stamp: version increments by one per update');
  perform tests.assert_fails_like($q$update platform.departments set id = 'a3000000-0000-4000-8000-0000000000ff' where code = 'NEW'$q$,
    'the id of platform.departments rows cannot change', 'stamp: the primary key is immutable');

  -- Soft delete: forged time and actor are replaced; later edits keep them; restore clears them.
  update platform.departments set deleted_at = '1999-01-01', deleted_by = 'b1000000-0000-4000-8000-0000000000b1' where code = 'NEW';
  select * into r from platform.departments where id = r.id;
  perform tests.assert(r.deleted_at > now() - interval '1 minute', 'soft delete: deleted_at is the clock');
  perform tests.assert_eq(r.deleted_by, 'a1000000-0000-4000-8000-0000000000ab'::uuid, 'soft delete: deleted_by is the claims person');
  update platform.departments set deleted_at = '1999-01-01', deleted_by = null where id = r.id;
  perform tests.assert((select deleted_at > now() - interval '1 minute' and deleted_by = 'a1000000-0000-4000-8000-0000000000ab'
                        from platform.departments where id = r.id), 'soft delete: time and actor cannot be rewritten later');
  update platform.departments set deleted_at = null, deleted_by = 'b1000000-0000-4000-8000-0000000000b1' where id = r.id;
  perform tests.assert((select deleted_at is null and deleted_by is null from platform.departments where id = r.id),
    'restore: clears deleted_at and deleted_by');
end $$;
rollback;

-- User claims without a person stamp NULL actors.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  insert into platform.branches (code, name_ar, created_by) values ('NOP', 'فرع', 'a1000000-0000-4000-8000-0000000000a1');
  perform tests.assert((select created_by is null from platform.branches where code = 'NOP'),
    'stamp: no person claim → created_by NULL even when a value is sent');
end $$;
rollback;

\echo '21_org_structure: ok'
