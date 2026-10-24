-- db-test: run-as=app_server
-- Organization structure levels and department-limited roles (EP-ORG; FR-ADM-05, FR-IAM-07/08; T-M3-02,
-- T-M3-09; migrations 20261020090000…090400). Runs CONNECTED AS app_server with user claims of tenant A:
-- uAB (HR Manager: platform.org.manage) and uA (Organization Admin: no platform.org.manage since T-M2-19, gives
-- every role). Cross-tenant inserts and foreign keys: 20_isolation.sql. Each block is rolled back except the
-- acceptance (committed: the blocks after it and 99_structure_3_owner.sql use uScope's role and unit).
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------------------------------
-- Levels (BR-ORG-a/b): the HR Manager adds them at the bottom, renames them, removes the last unused one;
-- ten at most.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
declare
  v_id uuid;
begin
  -- Levels are added or removed only while nobody is placed in a unit (WP-HR-01, JO004): the Organization Admin
  -- unplaces tenant A's people first (rolled back with the block).
  perform tests.set_claims(tests.ua_claims());
  update platform.person_employment set department_id = null where tenant_id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.set_claims(tests.uab_claims());
  perform tests.assert_eq((select string_agg(ordinal || ':' || name_en || ':' || name_ar, ',' order by ordinal)
                           from platform.structure_levels),
    '1:Department:إدارة,2:Section:قسم', 'tenant A: its own levels only (the default one and the fixture''s second)');
  perform tests.assert_check_constraint($q$insert into platform.structure_levels (ordinal, name_en, name_ar) values (4, 'Team', 'فريق')$q$,
    'structure_levels_ordinal_check', 'a level is added at the bottom only (no gap)');
  perform tests.assert_check_constraint($q$insert into platform.structure_levels (ordinal, name_en, name_ar) values (2, 'Team', 'فريق')$q$,
    'structure_levels_ordinal_check', 'a level is never inserted between two others');
  insert into platform.structure_levels (ordinal, name_en, name_ar) values (3, 'Team', 'فريق') returning id into v_id;
  perform tests.assert((select created_by = 'a1000000-0000-4000-8000-0000000000ab' and version = 1
                        from platform.structure_levels where id = v_id), 'added at the bottom, stamped with the HR Manager');
  perform tests.assert_fails($q$insert into platform.structure_levels (ordinal, name_en, name_ar) values (4, 'TEAM', 'وحدة')$q$,
    array['23505'], 'English names are unique in the organization (case-insensitive)');
  perform tests.assert_fails($q$insert into platform.structure_levels (ordinal, name_en, name_ar) values (4, 'Unit', 'فريق')$q$,
    array['23505'], 'Arabic names are unique in the organization');
  perform tests.assert_check_constraint($q$insert into platform.structure_levels (ordinal, name_en, name_ar) values (4, ' Unit', 'وحدة')$q$,
    'structure_levels_name_en_check', 'names are trimmed');
  perform tests.assert_check_constraint(format('insert into platform.structure_levels (ordinal, name_en, name_ar) values (4, %L, %L)', 'Unit', chr(8203)),
    'structure_levels_name_ar_check', 'names need a visible letter');

  update platform.structure_levels set name_en = 'Squad', name_ar = 'فرقة' where id = v_id;
  perform tests.assert((select name_en = 'Squad' and name_ar = 'فرقة' and version = 2
                               and updated_by = 'a1000000-0000-4000-8000-0000000000ab'
                        from platform.structure_levels where id = v_id), 'renamed at any time (version 2)');
  perform tests.assert_privilege_denied($q$update platform.structure_levels set ordinal = 5 where ordinal = 3$q$,
    'the place of a level never changes');

  perform tests.assert_fails($q$delete from platform.structure_levels where ordinal = 2$q$,
    array['23514'], 'only the last level is removed');
  perform tests.assert_fails($q$delete from platform.structure_levels where ordinal = 1$q$,
    array['23514'], 'the first level always stays');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.structure_levels where ordinal = 3$q$),
    1::bigint, 'the last level is removed while no unit uses it');
  perform tests.assert_fails($q$delete from platform.structure_levels where ordinal = 2$q$,
    array['JO002'], 'a level a unit uses (TD-PRG) is not removed');

  insert into platform.structure_levels (ordinal, name_en, name_ar)
  select n, 'Level ' || n, 'المستوى ' || n from generate_series(3, 10) n order by n;
  perform tests.assert_check_constraint($q$insert into platform.structure_levels (ordinal, name_en, name_ar) values (11, 'Level 11', 'المستوى 11')$q$,
    'structure_levels_ordinal_check', 'ten levels at most');
end $$;
rollback;

-- Only platform.org.manage changes the levels (the HR Manager; PO, 11 Oct 2026): the Organization Admin reads them.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  -- (Nobody placed, so the level lock does not answer first — WP-HR-01.)
  update platform.person_employment set department_id = null where tenant_id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.assert_eq((select count(*) from platform.structure_levels), 2::bigint, 'the Organization Admin reads the levels');
  perform tests.assert_rls_violation($q$insert into platform.structure_levels (ordinal, name_en, name_ar) values (3, 'Team', 'فريق')$q$,
    'the Organization Admin cannot add a level');
  perform tests.assert_eq(tests.rows_affected($q$update platform.structure_levels set name_en = 'Unit' where ordinal = 1$q$),
    0::bigint, 'nor rename one');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.structure_levels where ordinal = 2$q$),
    0::bigint, 'nor remove one');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Each unit's level is its depth; never below the last level (moves count the units below; restores check
-- again); a move carries the units below to their new levels.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
declare
  v_levels constant text := $q$select string_agg(code || ':' || level_ordinal, ',' order by code) from platform.departments where deleted_at is null and code in ('OPS', 'TD', 'TD-PRG', 'PRG-1')$q$;
  v_got text;
begin
  -- Levels are added or removed only while nobody is placed in a unit (WP-HR-01, JO004): the Organization Admin
  -- unplaces tenant A's people first (rolled back with the block).
  perform tests.set_claims(tests.ua_claims());
  update platform.person_employment set department_id = null where tenant_id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.set_claims(tests.uab_claims());
  execute v_levels into v_got;
  perform tests.assert_eq(v_got, 'OPS:1,TD:1,TD-PRG:2', 'each unit''s level is its depth in the tree');
  perform tests.assert_fails($q$insert into platform.departments (code, name_ar, parent_id) values ('PRG-1', 'برنامج', 'a3000000-0000-4000-8000-000000000002')$q$,
    array['JO001'], 'the last level has no units under it');
  perform tests.assert_fails($q$update platform.departments set parent_id = 'a3000000-0000-4000-8000-000000000003' where code = 'TD'$q$,
    array['JO003'], 'a move never changes a unit''s level (TD, a top unit, under OPS) — WP-HR-01');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set level_ordinal = 7 where code = 'OPS'$q$),
    1::bigint, 'a written level is accepted as a request …');
  perform tests.assert_eq((select level_ordinal from platform.departments where code = 'OPS'), 1::smallint,
    '… and replaced by the computed one');

  insert into platform.structure_levels (ordinal, name_en, name_ar) values (3, 'Team', 'فريق');
  insert into platform.departments (code, name_ar, parent_id) values ('PRG-1', 'برنامج', 'a3000000-0000-4000-8000-000000000002');
  -- A moved unit keeps its level (WP-HR-01, BR-ORG-i): TD-PRG (level 2) never goes to the top, PRG-1 (level 3)
  -- never under a top unit; under OPS (level 1, like its parent TD) TD-PRG moves with PRG-1, both at their levels.
  perform tests.assert_fails($q$update platform.departments set parent_id = null where code = 'TD-PRG'$q$,
    array['JO003'], 'a unit never moves to another level (to the top)');
  perform tests.assert_fails($q$update platform.departments set parent_id = 'a3000000-0000-4000-8000-000000000003' where code = 'PRG-1'$q$,
    array['JO003'], 'a unit never moves to another level (one level up)');
  update platform.departments set parent_id = 'a3000000-0000-4000-8000-000000000003' where code = 'TD-PRG';
  execute v_levels into v_got;
  perform tests.assert_eq(v_got, 'OPS:1,PRG-1:3,TD:1,TD-PRG:2', 'a move under a unit of its parent''s level keeps every level below');

  -- A deleted unit keeps its level; restoring it checks the levels again.
  update platform.departments set deleted_at = now() where code = 'PRG-1';
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.structure_levels where ordinal = 3$q$),
    1::bigint, 'a level only deleted units used can be removed');
  perform tests.assert_fails($q$update platform.departments set deleted_at = null where code = 'PRG-1'$q$,
    array['JO001'], 'a restore below the last level is refused');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Department-limited custom roles (T-M3-09): one unit per assignment, a department-limited custom role only,
-- a live and active unit of the organization; the database guards add nothing scoped organization-wide; a
-- unit that is a role's scope is not deleted (it can be deactivated); an invitation's unit never changes.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  v_role constant text := 'custom_a000000c9001';  -- «A department» (99_structure_1_fixtures_owner.sql)
  v_membership uuid;
  v_sales uuid;
  v_person uuid;
begin
  -- uM (an active member with no role yet, 35_invitations_fixtures.sql).
  select id into v_membership from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000f7';
  -- Units: the HR Manager uAB (platform.org.manage, S-M1); roles and invitations: the Organization Admin uA.
  perform tests.set_claims(tests.uab_claims());
  insert into platform.departments (code, name_ar, name_en) values ('SALES', 'المبيعات', 'Sales') returning id into v_sales;
  perform tests.set_claims(tests.ua_claims());

  perform tests.assert_fails(format($q$insert into platform.role_assignments (membership_id, role_code, scope_unit_id) values (%L, 'learner', %L)$q$, v_membership, v_sales),
    array['23514'], 'a standard role takes no unit');
  perform tests.assert_fails(format($q$insert into platform.role_assignments (membership_id, role_code, scope_unit_id) values (%L, 'custom_a00000000001', %L)$q$, v_membership, v_sales),
    array['23514'], 'a custom role for the whole organization takes no unit');
  perform tests.assert_fails(format($q$insert into platform.role_assignments (membership_id, role_code, scope_unit_id) values (%L, %L, 'b3000000-0000-4000-8000-000000000001')$q$, v_membership, v_role),
    array['23503', '23514'], 'another organization''s unit is never a role''s scope');
  perform tests.set_claims(tests.uab_claims());
  update platform.departments set status = 'inactive' where id = v_sales;
  perform tests.set_claims(tests.ua_claims());
  perform tests.assert_fails(format($q$insert into platform.role_assignments (membership_id, role_code, scope_unit_id) values (%L, %L, %L)$q$, v_membership, v_role, v_sales),
    array['23514'], 'an inactive unit is not given');
  perform tests.set_claims(tests.uab_claims());
  update platform.departments set status = 'active' where id = v_sales;
  perform tests.set_claims(tests.ua_claims());

  insert into platform.role_assignments (membership_id, role_code, scope_unit_id) values (v_membership, v_role, v_sales);
  perform tests.assert_eq((select scope_unit_id from platform.role_assignments where membership_id = v_membership), v_sales,
    'the role is given for one unit');
  -- The database guards ask for organization-wide permissions only: people read (scoped) is not among them,
  -- the structure's names (organization-wide by nature) are.
  perform tests.assert_eq(private.member_permissions('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f7'),
    array['platform.org.read']::text[], 'a department-limited role adds nothing scoped organization-wide');
  perform tests.assert(not private.member_has_permission('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f7', 'platform.user.read'),
    'people read stays limited to the unit (evaluated by the application)');

  perform tests.set_claims(tests.uab_claims());
  perform tests.assert_fails(format($q$update platform.departments set deleted_at = now() where id = %L$q$, v_sales),
    array['23514'], 'a unit that is a role''s scope is not deleted');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.departments set status = 'inactive' where id = %L$q$, v_sales)),
    1::bigint, 'it can be deactivated (the role then grants nothing until a new unit is picked)');
  perform tests.set_claims(tests.ua_claims());
  perform tests.assert_privilege_denied(format($q$update platform.role_assignments set scope_unit_id = null where membership_id = %L$q$, v_membership),
    'the unit is never changed in place (a role change replaces the row)');
  delete from platform.role_assignments where membership_id = v_membership;
  perform tests.set_claims(tests.uab_claims());
  update platform.departments set status = 'active' where id = v_sales;
  perform tests.set_claims(tests.ua_claims());

  -- A department-limited role without a unit is accepted (it grants nothing scoped until one is picked).
  insert into platform.role_assignments (membership_id, role_code) values (v_membership, v_role);
  delete from platform.role_assignments where membership_id = v_membership;

  -- Invitations carry the unit; it never changes; a pending one keeps the unit from being deleted.
  insert into platform.persons (display_name_ar, email) values ('مدعو المبيعات', 'sales@a.test') returning id into v_person;
  perform tests.assert_fails(format($q$insert into platform.invitations (person_id, email, locale, primary_role, scope_unit_id) values (%L, 'sales@a.test', 'en', 'learner', %L)$q$, v_person, v_sales),
    array['23514'], 'an invitation with a standard role takes no unit');
  insert into platform.invitations (person_id, email, locale, primary_role, scope_unit_id)
  values (v_person, 'sales@a.test', 'en', v_role, v_sales);
  perform tests.assert_privilege_denied(format($q$update platform.invitations set scope_unit_id = null where person_id = %L$q$, v_person),
    'an invitation''s unit never changes');
  perform tests.set_claims(tests.uab_claims());
  perform tests.assert_fails(format($q$update platform.departments set deleted_at = now() where id = %L$q$, v_sales),
    array['23514'], 'a unit a pending invitation gives is not deleted');
  perform tests.set_claims(tests.ua_claims());
  update platform.invitations set status = 'revoked' where person_id = v_person;
  perform tests.set_claims(tests.uab_claims());
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.departments set deleted_at = now() where id = %L$q$, v_sales)),
    1::bigint, 'once nothing points at it, the unit is deleted');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Acceptance gives the invitation's role with its unit (private.apply_invitation_acceptance). Committed.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000c9', '10000000-0000-4000-8000-0000000000c9', null));
do $$
begin
  perform tests.assert_eq(private.accept_invitation_as_caller(tests.token_hash('tok-scope'), null, null),
    'a0000000-0000-4000-8000-000000000001'::uuid, 'accepted');
  -- uScope's session works in A from now on (the blocks below act as uScope).
  perform tests.assert(private.switch_active_tenant('a0000000-0000-4000-8000-000000000001'), 'uScope''s session picks A');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
    'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_eq(
    (select ra.role_code || ':' || ra.scope_unit_id from platform.role_assignments ra
     join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
     where m.user_id = '00000000-0000-4000-8000-0000000000c9'),
    'custom_a000000c9001:a3000000-0000-4000-8000-000000000003', 'the role comes with its unit (OPS)');
end $$;
commit;

-- ---------------------------------------------------------------------------------------------------
-- Who writes units and branches (S-M1, 20261020210000): structure managers only (platform.org.manage — the
-- HR Manager). An Employee, the L&D Manager and the holder of a department-limited custom role (uScope, given
-- OPS above) add and change none, whatever the application does.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
declare
  v_who record;
begin
  for v_who in
    select * from (values
      ('the Employee uE', tests.user_claims('00000000-0000-4000-8000-00000000e0a3', '10000000-0000-4000-8000-00000000e0a3',
        'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a3')),
      ('the L&D Manager uL', tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
        'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1')),
      ('the department-limited role holder uScope', tests.user_claims('00000000-0000-4000-8000-0000000000c9',
        '10000000-0000-4000-8000-0000000000c9', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000c9'))
    ) as w (label, claims)
  loop
    perform tests.set_claims(v_who.claims);
    perform tests.assert_eq(private.current_tenant_id(), 'a0000000-0000-4000-8000-000000000001'::uuid,
      format('%s: valid claims of tenant A', v_who.label));
    perform tests.assert((select count(*) from platform.departments) > 0, format('%s: reads the units', v_who.label));
    perform tests.assert_rls_violation($q$insert into platform.departments (code, name_ar) values ('MINE', 'وحدتي')$q$,
      format('%s: adds no unit', v_who.label));
    perform tests.assert_eq(tests.rows_affected($q$update platform.departments set name_en = 'Mine', head_person_id = null where code = 'OPS'$q$),
      0::bigint, format('%s: changes no unit', v_who.label));
    perform tests.assert_eq(tests.rows_affected($q$update platform.departments set parent_id = 'a3000000-0000-4000-8000-000000000003' where code = 'TD-PRG'$q$),
      0::bigint, format('%s: moves no unit (a wider scope)', v_who.label));
    perform tests.assert_rls_violation($q$insert into platform.branches (code, name_ar) values ('MINE', 'فرعي')$q$,
      format('%s: adds no branch', v_who.label));
    perform tests.assert_eq(tests.rows_affected($q$update platform.branches set name_en = 'Mine' where code = 'RUH'$q$),
      0::bigint, format('%s: changes no branch', v_who.label));
  end loop;

  -- The HR Manager does.
  perform tests.set_claims(tests.uab_claims());
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.departments (code, name_ar) values ('MINE', 'وحدتي')$q$),
    1::bigint, 'the HR Manager adds a unit');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set name_en = 'Operations 2' where code = 'OPS'$q$),
    1::bigint, 'and changes one');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.branches (code, name_ar) values ('MINE', 'فرعي')$q$),
    1::bigint, 'adds a branch');
  perform tests.assert_eq(tests.rows_affected($q$update platform.branches set name_en = 'Riyadh HQ' where code = 'RUH'$q$),
    1::bigint, 'and changes one');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- A role given for units keeps «A department» (C-M1, 20261020210500): uScope holds custom_a000000c9001 with
-- OPS; the Organization Admin cannot move its scope until nobody holds it with a unit (members, pending
-- invitations) — JR004 with both numbers.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
declare
  v_person uuid;
begin
  perform tests.assert_fails_state_like($q$update platform.custom_roles set data_scope = 'organization' where code = 'custom_a000000c9001'$q$,
    'JR004', 'the role is still given for units: 1 member(s), 0 pending invitation(s)', 'a member holds it with a unit');
  perform tests.assert_fails($q$update platform.custom_roles set data_scope = 'team' where code = 'custom_a000000c9001'$q$,
    array['JR004'], 'to any other scope');
  perform tests.assert_eq(tests.rows_affected($q$update platform.custom_roles set name_en = 'Branch L&D (renamed)' where code = 'custom_a000000c9001'$q$),
    1::bigint, 'the rest of the role changes as before');

  -- The member's role without the unit; a pending invitation with a unit still blocks.
  delete from platform.role_assignments ra using platform.tenant_memberships m
  where m.tenant_id = ra.tenant_id and m.id = ra.membership_id and m.user_id = '00000000-0000-4000-8000-0000000000c9';
  insert into platform.role_assignments (membership_id, role_code)
  select m.id, 'custom_a000000c9001' from platform.tenant_memberships m where m.user_id = '00000000-0000-4000-8000-0000000000c9';
  insert into platform.persons (display_name_ar, email) values ('مدعو الوحدة', 'unit@a.test') returning id into v_person;
  insert into platform.invitations (person_id, email, locale, primary_role, scope_unit_id)
  values (v_person, 'unit@a.test', 'en', 'custom_a000000c9001', 'a3000000-0000-4000-8000-000000000003');
  perform tests.assert_fails_state_like($q$update platform.custom_roles set data_scope = 'organization' where code = 'custom_a000000c9001'$q$,
    'JR004', 'the role is still given for units: 0 member(s), 1 pending invitation(s)', 'a pending invitation with a unit blocks too');
  update platform.invitations set status = 'revoked' where person_id = v_person;
  perform tests.assert_eq(tests.rows_affected($q$update platform.custom_roles set data_scope = 'organization' where code = 'custom_a000000c9001'$q$),
    1::bigint, 'once nobody holds it with a unit, the scope changes (a holder without a unit keeps the role)');
end $$;
rollback;

\echo '99_structure_2_app_server: ok'
