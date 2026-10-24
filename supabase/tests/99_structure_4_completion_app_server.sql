-- db-test: run-as=app_server
-- Structure completion (WP-HR-01; FR-ADM-04, FR-ADM-05, FR-FIN-03; business flow EP-ORG-structure-completion.md,
-- agreed by the PO 24 Oct 2026; migrations 20261103100000…100200). Runs CONNECTED AS app_server with user claims
-- of tenant A: uAB (HR Manager: platform.org.manage) and uA (Organization Admin: people, not the structure).
-- Every block is rolled back.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------------------------------
-- Cost centres: kept by the HR Manager; codes unique (case-insensitive); a name in at least one language; in use
-- → deactivated, never deleted. Tenant isolation: inserts, moves and references across tenants are refused.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.uab_claims());
do $$
declare
  v_id uuid;
begin
  perform tests.assert_eq((select string_agg(code, ',') from platform.cost_centres), 'CC-100',
    'tenant A sees its own cost centres only');
  insert into platform.cost_centres (code, name_en, name_ar) values ('CC-4100', 'Riyadh Sales', 'مبيعات الرياض')
  returning id into v_id;
  perform tests.assert((select created_by = 'a1000000-0000-4000-8000-0000000000ab' and status = 'active' and version = 1
                        from platform.cost_centres where id = v_id), 'added by the HR Manager, active, stamped');
  perform tests.assert_fails($q$insert into platform.cost_centres (code, name_en) values ('cc-4100', 'Other')$q$,
    array['23505'], 'codes are unique in the organization, case-insensitive');
  perform tests.assert_check_constraint($q$insert into platform.cost_centres (code, name_en) values ('CC 1', 'Bad')$q$,
    'cost_centres_code_check', 'codes: letters, digits, . _ - only');
  perform tests.assert_check_constraint($q$insert into platform.cost_centres (code) values ('CC-1')$q$,
    'cost_centres_name_check', 'a name in at least one language');
  perform tests.assert_check_constraint($q$insert into platform.cost_centres (code, name_en) values ('CC-2', ' Padded')$q$,
    'cost_centres_name_en_check', 'names are trimmed');
  insert into platform.cost_centres (code, name_ar) values ('CC-AR', 'عربي فقط');
  update platform.cost_centres set status = 'inactive' where id = v_id;
  perform tests.assert((select version = 2 and status = 'inactive' from platform.cost_centres where id = v_id),
    'deactivated (version 2)');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.cost_centres where code = 'CC-AR'$q$), 1::bigint,
    'an unused cost centre is deleted');

  -- Across tenants.
  perform tests.assert_privilege_denied($q$insert into platform.cost_centres (tenant_id, code, name_en) values ('b0000000-0000-4000-8000-000000000001', 'CC-X', 'Intruder')$q$,
    'no cost centre for another organization (the organization comes from the claims only)');
  perform tests.assert_privilege_denied($q$update platform.cost_centres set tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$,
    'a cost centre never moves to another organization');
  perform tests.assert_eq(tests.rows_affected($q$update platform.cost_centres set name_en = 'x' where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'another organization''s cost centres are not changed');
  perform tests.assert_fails($q$update platform.departments set default_cost_centre_id = 'b7000000-0000-4000-8000-0000000000cc' where code = 'OPS'$q$,
    array['23503', '23514'], 'another organization''s cost centre is never a unit''s default');
end $$;
rollback;

-- The Organization Admin (no platform.org.manage) reads cost centres and changes none.
begin;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert_eq((select count(*) from platform.cost_centres), 1::bigint, 'the Organization Admin reads them');
  perform tests.assert_rls_violation($q$insert into platform.cost_centres (code, name_en) values ('CC-9', 'Nine')$q$,
    'the Organization Admin adds none');
  perform tests.assert_eq(tests.rows_affected($q$update platform.cost_centres set name_en = 'x'$q$), 0::bigint,
    'nor changes one');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.cost_centres$q$), 0::bigint, 'nor deletes one');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- A person's one cost centre and a unit's default: active cost centres only; a person placed in a unit without
-- a cost centre gets its default; a person who has one keeps it; a cost centre in use is not deleted.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.uab_claims());
do $$
declare
  v_active uuid;
  v_inactive uuid;
  v_unit uuid;
  v_cc constant text := $q$select cost_centre_id from platform.person_employment where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$;
  v_got uuid;
begin
  insert into platform.cost_centres (code, name_en) values ('CC-OPS', 'Operations') returning id into v_active;
  insert into platform.cost_centres (code, name_en, status) values ('CC-OLD', 'Old', 'inactive') returning id into v_inactive;
  perform tests.assert_fails(format($q$insert into platform.departments (code, name_ar, default_cost_centre_id) values ('NEW', 'جديد', %L)$q$, v_inactive),
    array['23514'], 'an inactive cost centre is no unit''s default');
  insert into platform.departments (code, name_ar, default_cost_centre_id) values ('NEW', 'جديد', v_active)
  returning id into v_unit;

  -- People are changed by the Organization Admin here (uAB's own record is a privileged member's).
  perform tests.set_claims(tests.ua_claims());
  perform tests.assert_fails(format($q$update platform.person_employment set cost_centre_id = %L where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$, v_inactive),
    array['23514'], 'an inactive cost centre is given to nobody');
  perform tests.assert_fails($q$update platform.person_employment set cost_centre_id = 'b7000000-0000-4000-8000-0000000000cc' where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$,
    array['23503', '23514'], 'another organization''s cost centre is given to nobody');
  update platform.person_employment set department_id = v_unit where person_id = 'a1000000-0000-4000-8000-0000000000ab';
  execute v_cc into v_got;
  perform tests.assert_eq(v_got, v_active, 'placed in a unit without a cost centre: the unit''s default');
  update platform.person_employment set cost_centre_id = 'a7000000-0000-4000-8000-0000000000cc'
  where person_id = 'a1000000-0000-4000-8000-0000000000ab';
  update platform.person_employment set department_id = 'a3000000-0000-4000-8000-000000000003'
  where person_id = 'a1000000-0000-4000-8000-0000000000ab';
  execute v_cc into v_got;
  perform tests.assert_eq(v_got, 'a7000000-0000-4000-8000-0000000000cc'::uuid, 'a person who has a cost centre keeps it when moved');

  perform tests.set_claims(tests.uab_claims());
  update platform.cost_centres set status = 'inactive' where code = 'CC-100';
  execute v_cc into v_got;
  perform tests.assert_eq(v_got, 'a7000000-0000-4000-8000-0000000000cc'::uuid, 'a deactivated cost centre stays on its people');
  perform tests.assert_fails($q$delete from platform.cost_centres where code = 'CC-100'$q$,
    array['23503'], 'a cost centre in use is not deleted');

  -- A deleted unit gives no default any more: its cost centre can be deleted (review of 24 Oct 2026).
  update platform.departments set deleted_at = now() where id = v_unit;
  perform tests.assert((select default_cost_centre_id is null from platform.departments where id = v_unit),
    'a deleted unit''s default cost centre is cleared');
  perform tests.assert_eq(tests.rows_affected(format($q$delete from platform.cost_centres where id = %L$q$, v_active)),
    1::bigint, 'the cost centre of a deleted unit is deleted');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Levels are set once (EP-ORG BR-ORG-b changed, PO 24 Oct 2026): with people placed in units, no level is added or
-- removed; renaming stays.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.uab_claims());
do $$
begin
  perform tests.assert((select count(*) > 0 from platform.person_employment where department_id is not null),
    'tenant A has people placed in units');
  perform tests.assert_fails($q$insert into platform.structure_levels (ordinal, name_en, name_ar) values (3, 'Team', 'فريق')$q$,
    array['JO004'], 'no level added once people are placed');
  perform tests.assert_fails($q$delete from platform.structure_levels where ordinal = 2$q$,
    array['JO004'], 'no level removed once people are placed');
  perform tests.assert_eq(tests.rows_affected($q$update platform.structure_levels set name_en = 'Division', name_ar = 'شعبة' where ordinal = 2$q$),
    1::bigint, 'a level is still renamed');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- A branch's address, typed location (both coordinates or neither, within range) and own working week: one row per
-- day, hours in whole minutes, start before end; written by the HR Manager only; no other organization's branch.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.uab_claims());
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.branches set address_en = 'King Abdulaziz Rd', address_ar = 'طريق الملك عبدالعزيز', latitude = 21.5810, longitude = 39.1653 where code = 'JED'$q$),
    1::bigint, 'address and location saved');
  perform tests.assert_check_constraint($q$update platform.branches set latitude = 21.5, longitude = null where code = 'JED'$q$,
    'branches_location_check', 'both coordinates or neither');
  perform tests.assert_check_constraint($q$update platform.branches set latitude = 95, longitude = 39 where code = 'JED'$q$,
    'branches_location_check', 'latitude between -90 and 90');
  perform tests.assert_check_constraint($q$update platform.branches set address_en = repeat('a', 301) where code = 'JED'$q$,
    'branches_address_check', 'an address is at most 300 characters');

  insert into platform.branch_working_days (branch_id, day, starts_at, ends_at)
  select 'a2000000-0000-4000-8000-000000000002', d, '07:30', '15:30' from generate_series(0, 3) d;
  insert into platform.branch_working_days (branch_id, day, starts_at, ends_at)
  values ('a2000000-0000-4000-8000-000000000002', 4, '08:00', '12:00');
  perform tests.assert_eq((select count(*) from platform.branch_working_days where branch_id = 'a2000000-0000-4000-8000-000000000002'),
    5::bigint, 'JED works Sunday–Thursday, Thursday a half-day');
  perform tests.assert_fails($q$insert into platform.branch_working_days (branch_id, day, starts_at, ends_at) values ('a2000000-0000-4000-8000-000000000002', 4, '13:00', '15:00')$q$,
    array['23505'], 'one block of hours per day');
  perform tests.assert_check_constraint($q$insert into platform.branch_working_days (branch_id, day, starts_at, ends_at) values ('a2000000-0000-4000-8000-000000000002', 5, '16:00', '08:00')$q$,
    'branch_working_days_hours_check', 'the end after the start (no work across midnight)');
  perform tests.assert_check_constraint($q$insert into platform.branch_working_days (branch_id, day, starts_at, ends_at) values ('a2000000-0000-4000-8000-000000000002', 7, '08:00', '16:00')$q$,
    'branch_working_days_day_check', 'days 0 (Sunday) to 6 (Saturday)');
  perform tests.assert_privilege_denied($q$insert into platform.branch_working_days (tenant_id, branch_id, day, starts_at, ends_at) values ('b0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 1, '08:00', '16:00')$q$,
    'no working day for another organization (the organization comes from the claims only)');
  perform tests.assert_fails($q$insert into platform.branch_working_days (branch_id, day, starts_at, ends_at) values ('b2000000-0000-4000-8000-000000000001', 1, '08:00', '16:00')$q$,
    array['23503'], 'another organization''s branch takes no working day');
  perform tests.assert_privilege_denied($q$update platform.branch_working_days set branch_id = 'a2000000-0000-4000-8000-000000000001'$q$,
    'a working day never moves to another branch');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.branch_working_days where branch_id = 'a2000000-0000-4000-8000-000000000002'$q$),
    5::bigint, '«Same as the organization»: the branch''s own week removed');
end $$;
rollback;

begin;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert_eq((select count(*) from platform.branch_working_days), 1::bigint,
    'the Organization Admin reads the working weeks');
  perform tests.assert_rls_violation($q$insert into platform.branch_working_days (branch_id, day, starts_at, ends_at) values ('a2000000-0000-4000-8000-000000000002', 1, '08:00', '16:00')$q$,
    'the Organization Admin sets no branch''s week');
  perform tests.assert_eq(tests.rows_affected($q$update platform.branch_working_days set ends_at = '17:00'$q$), 0::bigint,
    'nor changes one');
end $$;
rollback;

\echo '99_structure_4_completion_app_server: ok'
