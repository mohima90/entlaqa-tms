-- db-test: run-as=owner
-- Whoever gives the Department Head role sets the head with it (WP-FIX-03, T-M3-18; FR-ADM-05, FR-IAM-03/04;
-- PO 12 Nov 2026; migration 20261112100400): the NARROW write a member who gives the Department Head role
-- (the Organization Admin; a custom role that gives roles and manages people) may make on a unit — only
-- `head_person_id`, only of a live unit of their own organization:
--   set / replace → a person who is not the actor, whom the actor may manage and who holds the Department
--                   Head role now (or is invited with it); a replaced head is the actor or manageable;
--   clear         → the old head is not the actor, manageable, and an Employee now.
-- Everything else is refused: another column, a deleted unit, another organization, a person without the
-- role, the actor themselves, clearing a head who is not an Employee, a member who does not give roles or
-- does not manage people. Also: the hand-over of a leaver's units never goes to the member who deactivates
-- (second look M3 c), and a structure manager who picks THEMSELVES as a head enters that unit's needs only
-- (second look M3 b — a privileged act, stamped; the application writes its audit event).
-- Fixtures of 00 (tenant A: uA Organization Admin, heads TD; uAB HR Manager) and of
-- 99_planning_d_needs_0 (SAL headed by uH). Everything here is rolled back.
\set ON_ERROR_STOP on

begin;
-- Members f1-1 … f1-9 of tenant A.
--   1, 2: Department Heads · 3: Employee, heads U3 · 4: L&D Manager, heads U4 · 5: invited as Department
--   Head (no account yet) · 6: «People clerk» (custom: gives roles, edits people; no structure, no privileged
--   roles) · 7: «Role clerk» (custom: gives roles, manages nobody) · 8: HR Manager (privileged), heads U5 ·
--   9: Employee, heads U9.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000f100' || n)::uuid, 'giver' || n || '@a.test' from generate_series(1, 9) n where n <> 5;
insert into auth.sessions (id, user_id, not_after)
select ('10000000-0000-4000-8000-0000000f100' || n)::uuid, ('00000000-0000-4000-8000-0000000f100' || n)::uuid, null
from generate_series(1, 9) n where n <> 5;
insert into platform.persons (id, tenant_id, display_name_ar, email)
select ('a1000000-0000-4000-8000-0000000f100' || n)::uuid, 'a0000000-0000-4000-8000-000000000001', 'عضو ' || n, 'giver' || n || '@a.test'
from generate_series(1, 9) n;
insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
select 'a0000000-0000-4000-8000-000000000001', ('00000000-0000-4000-8000-0000000f100' || n)::uuid,
       ('a1000000-0000-4000-8000-0000000f100' || n)::uuid, 'active'
from generate_series(1, 9) n where n <> 5;
insert into platform.session_context (session_id, user_id, active_tenant_id)
select ('10000000-0000-4000-8000-0000000f100' || n)::uuid, ('00000000-0000-4000-8000-0000000f100' || n)::uuid,
       'a0000000-0000-4000-8000-000000000001'
from generate_series(1, 9) n where n <> 5;
insert into platform.custom_roles (id, tenant_id, code, name_en, name_ar, data_scope) values
  ('a6000000-0000-4000-8000-0000000f1001', 'a0000000-0000-4000-8000-000000000001', 'custom_f10000000001', 'People clerk', 'موظف شؤون الأفراد', 'organization'),
  ('a6000000-0000-4000-8000-0000000f1002', 'a0000000-0000-4000-8000-000000000001', 'custom_f10000000002', 'Role clerk', 'موظف الأدوار', 'organization');
insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code)
select 'a0000000-0000-4000-8000-000000000001', r.id::uuid, r.permission
from (values
  ('a6000000-0000-4000-8000-0000000f1001', 'platform.role.assign'), ('a6000000-0000-4000-8000-0000000f1001', 'platform.user.read'),
  ('a6000000-0000-4000-8000-0000000f1001', 'platform.user.update'), ('a6000000-0000-4000-8000-0000000f1001', 'platform.org.read'),
  ('a6000000-0000-4000-8000-0000000f1002', 'platform.role.assign'), ('a6000000-0000-4000-8000-0000000f1002', 'platform.user.read'),
  ('a6000000-0000-4000-8000-0000000f1002', 'platform.org.read')) as r (id, permission);
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, r.role_code, true
from (values (1, 'department_head'), (2, 'department_head'), (3, 'learner'), (4, 'training_manager'),
             (6, 'custom_f10000000001'), (7, 'custom_f10000000002'), (8, 'hr_manager'), (9, 'learner')) as r (n, role_code)
join platform.tenant_memberships m on m.user_id = ('00000000-0000-4000-8000-0000000f100' || r.n)::uuid;
-- 5 is invited as a Department Head; the Organization Admin's own person also carries a pending invitation
-- with that role, so that «never the actor» is tested on its own (one role per person: no member who gives
-- roles can hold the Department Head role itself).
-- (The second row is impossible through the product — a member is never invited again; written with the
-- invitation check off, as a platform operation, only to isolate that condition.)
insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, additional_roles, invited_by) values
  ('a4000000-0000-4000-8000-0000000f1005', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f1005',
   'giver5@a.test', 'ar', 'department_head', '{}', '00000000-0000-4000-8000-0000000000a1');
alter table platform.invitations disable trigger invitations_check;
insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, additional_roles, invited_by) values
  ('a4000000-0000-4000-8000-0000000f10a1', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1',
   'ua@a.test', 'ar', 'department_head', '{}', '00000000-0000-4000-8000-0000000000ab');
alter table platform.invitations enable trigger invitations_check;
insert into platform.departments (id, tenant_id, code, name_ar, name_en, parent_id, head_person_id) values
  ('a3000000-0000-4000-8000-0000000f1001', 'a0000000-0000-4000-8000-000000000001', 'RG-1', 'إدارة ١', 'Department 1', null, null),
  ('a3000000-0000-4000-8000-0000000f1002', 'a0000000-0000-4000-8000-000000000001', 'RG-2', 'إدارة ٢', 'Department 2', null, null),
  ('a3000000-0000-4000-8000-0000000f1003', 'a0000000-0000-4000-8000-000000000001', 'RG-3', 'إدارة ٣', 'Department 3', null, 'a1000000-0000-4000-8000-0000000f1003'),
  ('a3000000-0000-4000-8000-0000000f1004', 'a0000000-0000-4000-8000-000000000001', 'RG-4', 'إدارة ٤', 'Department 4', null, 'a1000000-0000-4000-8000-0000000f1004'),
  ('a3000000-0000-4000-8000-0000000f1005', 'a0000000-0000-4000-8000-000000000001', 'RG-5', 'إدارة ٥', 'Department 5', null, 'a1000000-0000-4000-8000-0000000f1008'),
  ('a3000000-0000-4000-8000-0000000f1006', 'a0000000-0000-4000-8000-000000000001', 'RG-6', 'إدارة ٦', 'Department 6', null, null),
  ('a3000000-0000-4000-8000-0000000f1007', 'a0000000-0000-4000-8000-000000000001', 'RG-7', 'إدارة ٧', 'Department 7', null, null),
  ('a3000000-0000-4000-8000-0000000f1008', 'a0000000-0000-4000-8000-000000000001', 'RG-8', 'إدارة ٨', 'Department 8', null, 'a1000000-0000-4000-8000-0000000000a1'),
  ('a3000000-0000-4000-8000-0000000f1009', 'a0000000-0000-4000-8000-000000000001', 'RG-9', 'إدارة ٩', 'Department 9', null, 'a1000000-0000-4000-8000-0000000f1009');
update platform.departments set deleted_at = now() where id = 'a3000000-0000-4000-8000-0000000f1006';

do $$
begin
  perform tests.assert(has_function_privilege('authenticated', 'private.actor_may_give_department_head(uuid)', 'execute')
                       and has_function_privilege('authenticated', 'private.person_holds_role_now(uuid, uuid, text)', 'execute'),
    'the two helpers: executable by authenticated (policy and trigger run as the caller)');
  perform tests.assert(not has_function_privilege('anon', 'private.actor_may_give_department_head(uuid)', 'execute')
                       and not has_function_privilege('anon', 'private.person_holds_role_now(uuid, uuid, text)', 'execute'),
    'the two helpers: not executable by anon (revoked from public)');
  perform tests.assert((select bool_and(not p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path=')))
                        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'private' and p.proname in ('actor_may_give_department_head', 'person_holds_role_now')),
    'the two helpers: invoker rights, empty search_path');
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The Organization Admin (gives every role; does not manage the structure)
-- ---------------------------------------------------------------------------------------------------
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
declare
  a constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  perform tests.assert(not private.actor_may_manage_structure(a) and private.actor_may_give_department_head(a),
    'the Organization Admin does not manage the structure, and gives the Department Head role');
  perform tests.assert(private.person_holds_role_now(a, 'a1000000-0000-4000-8000-0000000f1001', 'department_head')
                       and private.person_holds_role_now(a, 'a1000000-0000-4000-8000-0000000f1005', 'department_head')
                       and not private.person_holds_role_now(a, 'a1000000-0000-4000-8000-0000000f1003', 'department_head')
                       and private.person_holds_role_now(a, 'a1000000-0000-4000-8000-0000000f1003', 'learner')
                       and not private.person_holds_role_now(a, 'a1000000-0000-4000-8000-0000000f1005', 'learner')
                       and not private.person_holds_role_now('b0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f1001', 'department_head'),
    'holds the role now: a member with the role, an invitee invited with it (Department Head only); not another role, not another organization');

  -- Negatives first (nothing below may change a row).
  perform tests.assert_fails($q$update platform.departments set name_en = 'Renamed' where id = 'a3000000-0000-4000-8000-0000000f1001'$q$,
    array['42501'], 'role giver: does not rename a unit');
  perform tests.assert_fails($q$update platform.departments set status = 'inactive' where id = 'a3000000-0000-4000-8000-0000000f1001'$q$,
    array['42501'], 'role giver: does not deactivate a unit');
  perform tests.assert_fails($q$update platform.departments set parent_id = 'a3000000-0000-4000-8000-0000000f1002' where id = 'a3000000-0000-4000-8000-0000000f1001'$q$,
    array['42501'], 'role giver: does not move a unit');
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1001', name_en = 'Taken' where id = 'a3000000-0000-4000-8000-0000000f1001'$q$,
    array['42501'], 'role giver: the head only, nothing else in the same change');
  perform tests.assert_fails($q$update platform.departments set deleted_at = now() where id = 'a3000000-0000-4000-8000-0000000f1001'$q$,
    array['42501'], 'role giver: does not delete a unit');
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1001', deleted_at = now() where id = 'a3000000-0000-4000-8000-0000000f1001'$q$,
    array['42501'], 'role giver: not the head of a unit deleted in the same change');
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1001' where id = 'a3000000-0000-4000-8000-0000000f1006'$q$,
    array['42501'], 'role giver: never a deleted unit');
  perform tests.assert_rls_violation($q$insert into platform.departments (code, name_ar) values ('RG-NEW', 'جديدة')$q$,
    'role giver: does not add units');
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1009' where id = 'a3000000-0000-4000-8000-0000000f1001'$q$,
    array['42501'], 'role giver: an Employee is not made a head (no Department Head role)');
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1004' where id = 'a3000000-0000-4000-8000-0000000f1001'$q$,
    array['42501'], 'role giver: a member with another role is not made a head');
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000000e1' where id = 'a3000000-0000-4000-8000-0000000f1001'$q$,
    array['42501'], 'role giver: someone invited with another role is not made a head');
  perform tests.assert(private.person_holds_role_now(a, 'a1000000-0000-4000-8000-0000000000a1', 'department_head'),
    'fixture: the actor''s own person counts as holding the role (pending invitation)');
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000000a1' where id = 'a3000000-0000-4000-8000-0000000f1001'$q$,
    array['42501'], 'role giver: never THEMSELVES, even when they would count as holding the role');
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000000a1' where id = 'a3000000-0000-4000-8000-0000000f1003'$q$,
    array['42501'], 'role giver: nor themselves in place of another head');
  perform tests.assert_fails($q$update platform.departments set head_person_id = null where id = 'a3000000-0000-4000-8000-0000000f1004'$q$,
    array['42501'], 'role giver: a head with another role (L&D Manager) keeps the unit — not cleared');
  perform tests.assert_fails($q$update platform.departments set head_person_id = null where id = 'a3000000-0000-4000-8000-0000000f1005'$q$,
    array['42501'], 'role giver: a head who is an HR Manager keeps the unit — not cleared');
  perform tests.assert_fails($q$update platform.departments set head_person_id = null where id = 'a3000000-0000-4000-8000-000000000004'$q$,
    array['42501'], 'role giver: a Department Head keeps the unit — not cleared');
  perform tests.assert_fails($q$update platform.departments set head_person_id = null where id = 'a3000000-0000-4000-8000-0000000f1008'$q$,
    array['42501'], 'role giver: does not clear a unit they head themselves');
  -- Another organization: its unit is not there, its person is not a head here.
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1001' where id = 'b3000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'role giver: another organization''s unit is not reachable');
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'b1000000-0000-4000-8000-0000000000b1' where id = 'a3000000-0000-4000-8000-0000000f1001'$q$,
    array['42501', '23503', '23514'], 'role giver: another organization''s person is never a head here');
  perform tests.assert_eq((select count(*) from platform.departments
                           where id::text like 'a3000000-0000-4000-8000-0000000f100_' and version = 1 and name_en like 'Department _'),
    8::bigint, 'nothing changed so far (the deleted unit was updated once by the fixture)');

  -- Positives.
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1001' where id = 'a3000000-0000-4000-8000-0000000f1001'$q$),
    1::bigint, 'role giver: a holder of the Department Head role becomes the head of a unit without one');
  perform tests.assert((select head_person_id = 'a1000000-0000-4000-8000-0000000f1001' and version = 2
                               and updated_by = 'a1000000-0000-4000-8000-0000000000a1'
                        from platform.departments where id = 'a3000000-0000-4000-8000-0000000f1001'),
    'stamped with the Organization Admin');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1005' where id = 'a3000000-0000-4000-8000-0000000f1002'$q$),
    1::bigint, 'role giver: someone invited as a Department Head is the head from the invitation on');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1002' where id = 'a3000000-0000-4000-8000-0000000f1003'$q$),
    1::bigint, 'role giver: replaces a head they may manage with a Department Head');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1002' where id = 'a3000000-0000-4000-8000-0000000f1005'$q$),
    1::bigint, 'the Organization Admin manages privileged members too: replaces a head who is an HR Manager');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1001' where id = 'a3000000-0000-4000-8000-0000000f1008'$q$),
    1::bigint, 'role giver: hands a unit they head themselves to a Department Head');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = null where id = 'a3000000-0000-4000-8000-0000000f1009'$q$),
    1::bigint, 'role giver: a head who is an Employee (made one, after the form asked) leaves the unit without a head');
  perform tests.assert_fails($q$update platform.departments set head_person_id = null where id = 'a3000000-0000-4000-8000-0000000f1001'$q$,
    array['42501'], 'role giver: the Department Head just set keeps the unit — not cleared');

  -- The hand-over of a leaver's units (platform.user.deactivate; 20261020210000) never goes to the member
  -- who deactivates (second look M3 c); to another active person it still does.
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000000a1' where id = 'a3000000-0000-4000-8000-0000000f1004'$q$,
    array['42501'], 'hand-over: never to the member who deactivates');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1009' where id = 'a3000000-0000-4000-8000-0000000f1004'$q$),
    1::bigint, 'hand-over: to another active person, as before');
end $$;
reset role;
reset session authorization;

-- ---------------------------------------------------------------------------------------------------
-- Custom roles: by permission, not by role code
-- ---------------------------------------------------------------------------------------------------
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000f1006', '10000000-0000-4000-8000-0000000f1006',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f1006'));
do $$
declare
  a constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  perform tests.assert(private.actor_may_give_department_head(a) and not private.actor_may_manage_structure(a)
                       and not private.actor_may_hand_over_heads(a),
    'People clerk: gives the Department Head role; no structure, no deactivation');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1002' where id = 'a3000000-0000-4000-8000-0000000f1007'$q$),
    1::bigint, 'People clerk: a holder of the Department Head role becomes the head of a unit without one');
  -- RG-9 has no head now; give it one who is privileged for this actor to replace: the HR Manager cannot
  -- be managed by a member without platform.role.assign_privileged.
end $$;
reset role;
reset session authorization;
update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1008' where id = 'a3000000-0000-4000-8000-0000000f1009';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000f1006', '10000000-0000-4000-8000-0000000f1006',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f1006'));
do $$
begin
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1001' where id = 'a3000000-0000-4000-8000-0000000f1009'$q$,
    array['42501'], 'People clerk: does not replace a head they may not manage (a privileged member)');
  perform tests.assert_fails($q$update platform.departments set name_en = 'Renamed' where id = 'a3000000-0000-4000-8000-0000000f1007'$q$,
    array['42501'], 'People clerk: does not rename a unit');

  -- «Role clerk»: gives roles, manages nobody — the head is not theirs.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000f1007', '10000000-0000-4000-8000-0000000f1007',
    'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f1007'));
  perform tests.assert(private.actor_may_give_department_head('a0000000-0000-4000-8000-000000000001'),
    'Role clerk: gives the Department Head role');
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1001' where id = 'a3000000-0000-4000-8000-0000000f1002'$q$,
    array['42501'], 'Role clerk (manages nobody): sets no head');
  perform tests.assert_fails($q$update platform.departments set head_person_id = null where id = 'a3000000-0000-4000-8000-0000000f1004'$q$,
    array['42501'], 'Role clerk (manages nobody): clears no head, not even an Employee''s');

  -- Members who neither manage the structure nor give roles: the row is not theirs to write at all.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000f1003', '10000000-0000-4000-8000-0000000f1003',
    'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f1003'));
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1001' where id = 'a3000000-0000-4000-8000-0000000f1002'$q$),
    0::bigint, 'an Employee sets no head');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000f1001', '10000000-0000-4000-8000-0000000f1001',
    'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f1001'));
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1002' where id = 'a3000000-0000-4000-8000-0000000f1001'$q$),
    0::bigint, 'a Department Head does not hand their unit to another Department Head');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000f1004', '10000000-0000-4000-8000-0000000f1004',
    'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f1004'));
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000f1001' where id = 'a3000000-0000-4000-8000-0000000f1002'$q$),
    0::bigint, 'an L&D Manager sets no head');
end $$;
reset role;
reset session authorization;

-- ---------------------------------------------------------------------------------------------------
-- A structure manager picks THEMSELVES as a head (second look M3 b): allowed — a privileged act, stamped —
-- and they enter the needs of that unit only.
-- ---------------------------------------------------------------------------------------------------
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.uab_claims());
do $$
declare
  a constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  perform tests.assert(private.actor_may_manage_structure(a), 'the HR Manager manages the structure');
  perform tests.assert(not private.may_submit_plan_needs(a, 'a3000000-0000-4000-8000-000000000003'),
    'before: the HR Manager heads nothing and enters no needs of OPS');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set head_person_id = 'a1000000-0000-4000-8000-0000000000ab' where id = 'a3000000-0000-4000-8000-000000000003'$q$),
    1::bigint, 'the HR Manager picks themselves as the head of OPS');
  perform tests.assert((select head_person_id = 'a1000000-0000-4000-8000-0000000000ab' and updated_by = 'a1000000-0000-4000-8000-0000000000ab'
                        from platform.departments where id = 'a3000000-0000-4000-8000-000000000003'),
    'stamped with the HR Manager (the application writes the audit event of the change)');
  perform tests.assert(private.may_submit_plan_needs(a, 'a3000000-0000-4000-8000-000000000003'),
    'now the head of OPS: enters its needs');
  perform tests.assert(not private.may_submit_plan_needs(a, 'a3000000-0000-4000-8000-000000000004')
                       and not private.may_submit_plan_needs(a, 'a3000000-0000-4000-8000-000000000001')
                       and not private.may_submit_plan_needs(a, 'a3000000-0000-4000-8000-000000000002')
                       and not private.may_submit_plan_needs(a, 'a3000000-0000-4000-8000-0000000f1001'),
    'and of no other unit: not SAL (another head), not TD or the unit under it, not a unit of the fixtures here');
end $$;
reset role;
reset session authorization;
rollback;

\echo '99_unit_heads_role_givers_owner: ok'
