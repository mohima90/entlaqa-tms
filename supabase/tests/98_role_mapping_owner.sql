-- db-test: run-as=owner
-- The EP-ROLES backfill (migration 20261019090300; mapping docs/delivery/roles/README.md §4) on data as it
-- was before: the former roles are put back and the one-role index and check removed for this transaction
-- only, members and pending invitations are given the old combinations, then the real migration files run
-- again (backfill, then 20261019090400). Nobody gains a permission; one role per member afterwards; the last
-- Organization Admin stays. Rolled back.
\set ON_ERROR_STOP on

begin;
insert into platform.ref_roles (code, is_privileged, sort_order) values
  ('finance_manager', true, 5), ('compliance_officer', true, 6), ('line_manager', false, 8),
  ('internal_instructor', false, 9), ('external_instructor', false, 10), ('provider_admin', false, 11),
  ('mentor', false, 12), ('auditor', true, 14);
drop index platform.role_assignments_tenant_membership_one_role_uq;
alter table platform.invitations drop constraint invitations_one_role_check;

-- Members of tenant A (users …d0-1 … …d0-7) with the roles they held before.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000d000' || n)::uuid, 'map' || n || '@a.test' from generate_series(1, 8) n;
insert into platform.persons (id, tenant_id, display_name_ar, email)
select ('a1000000-0000-4000-8000-0000000d000' || n)::uuid, 'a0000000-0000-4000-8000-000000000001', 'شخص ' || n, 'map' || n || '@a.test'
from generate_series(1, 8) n;
insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
select 'a0000000-0000-4000-8000-000000000001', ('00000000-0000-4000-8000-0000000d000' || n)::uuid,
       ('a1000000-0000-4000-8000-0000000d000' || n)::uuid, 'active'
from generate_series(1, 8) n;
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, r.role_code, r.is_primary
from (values
  (1, 'learner', true), (1, 'line_manager', false),               -- Employee + Line Manager
  (2, 'auditor', true),                                            -- Auditor (privileged)
  (3, 'external_instructor', true),                                -- non-employee user (R2): role ends
  (4, 'hr_manager', true), (4, 'training_manager', false),        -- HR Manager + L&D Manager
  (5, 'mentor', true), (5, 'internal_instructor', false),         -- two former roles
  (6, 'external_instructor', true), (6, 'learner', false),        -- the continuing role is kept
  (7, 'finance_manager', false)                                    -- no primary role
) as r (n, role_code, is_primary)
join platform.tenant_memberships m on m.user_id = ('00000000-0000-4000-8000-0000000d000' || r.n)::uuid;
-- 8: an Organization Admin role that ended (primary) and Employee held now — the role in force wins (L6).
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary, valid_from, valid_until)
select m.tenant_id, m.id, r.role_code, r.is_primary, r.valid_from, r.valid_until
from (values ('tenant_admin', true, null::timestamptz, now() - interval '2 days'),
             ('learner', false, now() - interval '1 day', null::timestamptz)) as r (role_code, is_primary, valid_from, valid_until)
join platform.tenant_memberships m on m.user_id = '00000000-0000-4000-8000-0000000d0008';

-- An import not finished whose default role and a row still to add name former roles; a finished one keeps
-- its history (fixtures of 85).
update platform.user_imports set options = '{"existing": "skip", "defaultRole": "line_manager", "invitations": "hold"}'
where id = 'a5000000-0000-4000-8000-000000000014';
update platform.user_imports set options = '{"existing": "skip", "defaultRole": "line_manager", "invitations": "hold"}'
where id = 'a5000000-0000-4000-8000-000000000011';
update platform.user_import_rows set data = data || '{"primary_role": "auditor"}'
where import_id = 'a5000000-0000-4000-8000-000000000014';

-- Pending invitations giving former roles or several roles.
insert into platform.persons (id, tenant_id, display_name_ar, email)
select ('a1000000-0000-4000-8000-0000000e100' || n)::uuid, 'a0000000-0000-4000-8000-000000000001', 'مدعو ' || n, 'mapinv' || n || '@a.test'
from generate_series(1, 3) n;
insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, additional_roles, invited_by) values
  ('a4000000-0000-4000-8000-0000000e1001', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000e1001',
   'mapinv1@a.test', 'ar', 'auditor', '{}', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-0000000e1002', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000e1002',
   'mapinv2@a.test', 'ar', 'provider_admin', '{}', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-0000000e1003', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000e1003',
   'mapinv3@a.test', 'ar', 'learner', '{mentor,line_manager}', '00000000-0000-4000-8000-0000000000a1');
update platform.invitations set token_hash = tests.token_hash('tok-map-' || right(id::text, 1))
where id::text like 'a4000000-0000-4000-8000-0000000e100_';

-- A security policy requiring an authenticator app for the Organization Admin and the Auditor.
insert into platform.security_policies (tenant_id, mfa_mode, mfa_required_roles)
values ('a0000000-0000-4000-8000-000000000001', 'required_roles', '{tenant_admin,auditor}')
on conflict (tenant_id) do update set mfa_mode = 'required_roles', mfa_required_roles = '{tenant_admin,auditor}';

-- Who held what before (for "nobody gains a permission").
create function pg_temp.before_permissions(p_n integer) returns text[] language sql as $$
  select coalesce(array_agg(distinct rp.permission_code order by rp.permission_code), '{}')
  from platform.role_assignments ra
  join platform.tenant_memberships m on m.id = ra.membership_id
  join platform.ref_role_permissions rp on rp.role_code = ra.role_code
  where m.user_id = ('00000000-0000-4000-8000-0000000d000' || p_n)::uuid;
$$;
create table pg_temp.before (n integer, permissions text[]);
insert into pg_temp.before select n, pg_temp.before_permissions(n) from generate_series(1, 8) n;

-- The real migrations, again.
\ir ../migrations/20261019090300_platform__backfill_standard_roles.sql
\ir ../migrations/20261019090400_platform__one_role_per_member.sql

do $$
declare
  v text;
begin
  select string_agg(right(m.user_id::text, 1) || ':' || ra.role_code || ':' || ra.is_primary, ',' order by m.user_id)
    into v
  from platform.role_assignments ra join platform.tenant_memberships m on m.id = ra.membership_id
  where m.user_id::text like '00000000-0000-4000-8000-0000000d000_';
  perform tests.assert_eq(v, '1:learner:true,2:learner:true,4:hr_manager:true,5:learner:true,6:learner:true,7:learner:true,8:learner:true',
    'mapping: one role per member — the primary kept, former roles → Employee, External Instructor ended (3), '
    'a continuing role kept before an ending one (6), no primary: the role is made primary (7), the role in '
    'force before an ended Organization Admin role (8)');
  -- Audited (review L6): one event per member whose roles changed, with the roles before and after.
  perform tests.assert_eq((select count(*) from platform.audit_events a
                           where a.action = 'platform.user.roles_changed' and a.actor_user_id is null
                             and a.entity_id like 'a1000000-0000-4000-8000-0000000d000_'
                             and a.data ->> 'reason' like 'EP-ROLES role mapping%'),
    8::bigint, 'an audit event per member whose roles changed');
  perform tests.assert_eq((select a.data - 'reason' from platform.audit_events a
                           where a.entity_id = 'a1000000-0000-4000-8000-0000000d0004'
                             and a.data ->> 'reason' like 'EP-ROLES role mapping%'),
    '{"before": ["hr_manager", "training_manager"], "after": "hr_manager"}'::jsonb, 'before and after role codes');
  perform tests.assert_eq((select a.data ->> 'after' from platform.audit_events a
                           where a.entity_id = 'a1000000-0000-4000-8000-0000000d0003'
                             and a.data ->> 'reason' like 'EP-ROLES role mapping%'),
    null::text, 'a role that ends: after is none');
  -- Imports not finished follow the mapping; history stays (review L6).
  perform tests.assert_eq((select options ->> 'defaultRole' from platform.user_imports where id = 'a5000000-0000-4000-8000-000000000014'),
    'learner', 'an import under review: its default role mapped to Employee');
  perform tests.assert_eq((select data ->> 'primary_role' from platform.user_import_rows where import_id = 'a5000000-0000-4000-8000-000000000014'),
    'learner', 'a row still to be added: mapped to Employee');
  perform tests.assert_eq((select options ->> 'defaultRole' from platform.user_imports where id = 'a5000000-0000-4000-8000-000000000011'),
    'line_manager', 'a finished import keeps its history');
  perform tests.assert_eq((select count(*) from platform.role_assignments ra
                           join platform.tenant_memberships m on m.id = ra.membership_id
                           where m.user_id::text like '00000000-0000-4000-8000-0000000d000_'
                             and not exists (select 1 from platform.ref_roles r where r.code = ra.role_code)),
    0::bigint, 'every remaining assignment names a standard role');
  -- Nobody gains a permission: what each member holds now (standard roles) is a subset of before, except
  -- Employee's "view own record" for members whose former roles granted nothing (My profile gives it anyway).
  perform tests.assert_eq(
    (select string_agg(b.n::text, ',' order by b.n) from pg_temp.before b
     where not (pg_temp.before_permissions(b.n) <@ (b.permissions || array['platform.user.read']))),
    null::text, 'nobody gains a permission (beyond viewing their own record)');
  perform tests.assert_eq(pg_temp.before_permissions(4),
    array['platform.org.manage', 'platform.org.read', 'platform.role.assign', 'platform.role.read', 'platform.user.deactivate',
          'platform.user.invite', 'platform.user.read', 'platform.user.update'], 'HR Manager kept');
  perform tests.assert(private.tenant_has_admin('a0000000-0000-4000-8000-000000000001'), 'the Organization Admin stays');
  perform tests.assert_eq(
    (select string_agg(right(i.id::text, 1) || ':' || i.status || ':' || i.primary_role || ':' || cardinality(i.additional_roles), ','
                       order by i.id)
     from platform.invitations i where i.id::text like 'a4000000-0000-4000-8000-0000000e100_'),
    '1:pending:learner:0,2:revoked:provider_admin:0,3:pending:learner:0',
    'invitations: former role → Employee; a role that ends → revoked; additional roles cleared');
  perform tests.assert((select invite_code is null and revoked_at is not null from platform.invitations
                        where id = 'a4000000-0000-4000-8000-0000000e1002'), 'the revoked invitation has no code left');
  perform tests.assert_eq((select mfa_required_roles from platform.security_policies
                           where tenant_id = 'a0000000-0000-4000-8000-000000000001'),
    array['tenant_admin'], 'security policy: former roles leave the authenticator-app list');
  perform tests.assert_eq((select string_agg(code, ',' order by sort_order) from platform.ref_roles),
    'tenant_admin,training_manager,training_coordinator,hr_manager,department_head,learner',
    'the former roles leave ref_roles: the six standard roles');
  perform tests.assert(to_regprocedure('private.ep_roles_kept_assignments()') is null, 'the migration''s helper is gone');
  perform tests.assert(exists (select 1 from pg_trigger where tgrelid = 'platform.invitations'::regclass
                               and tgname = 'invitations_check' and tgenabled = 'O')
                       and exists (select 1 from pg_trigger where tgrelid = 'platform.security_policies'::regclass
                                   and tgname = 'security_policies_changed_mail' and tgenabled = 'O'),
    'the triggers disabled for the backfill are enabled again');
end $$;
rollback;

-- The catalogue rule holds for platform operations too (review L3): never the Organization Admin's own
-- permissions in a custom role, and nothing outside the catalogue — added or rewritten.
begin;
do $$
begin
  perform tests.assert_fails_like($q$insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code) values ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'platform.role.manage')$q$,
    'permission platform.role.manage cannot be part of a custom role', 'a platform operation cannot add role.manage');
  perform tests.assert_fails_like($q$insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code) values ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'platform.role.assign_privileged')$q$,
    'permission platform.role.assign_privileged cannot be part of a custom role', 'nor role.assign_privileged');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code) values ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'platform.role.read')$q$),
    1::bigint, 'a catalogue permission: allowed (platform operations have no actor rules)');
  -- …on a rewrite too (confirmation pass Low 2).
  perform tests.assert_fails_like($q$update platform.custom_role_permissions set permission_code = 'platform.role.manage' where custom_role_id = 'a6000000-0000-4000-8000-000000000001' and permission_code = 'platform.user.read'$q$,
    'permission platform.role.manage cannot be part of a custom role', 'a platform operation cannot rewrite a permission into role.manage');
  perform tests.assert_fails_like($q$update platform.custom_role_permissions set permission_code = 'tms.unknown.read' where custom_role_id = 'a6000000-0000-4000-8000-000000000001' and permission_code = 'platform.user.read'$q$,
    'permission tms.unknown.read cannot be part of a custom role', 'nor into a permission outside the catalogue');
end $$;
rollback;

-- The one-role migration is safe if the earlier application wrote between the backfill and it (L6): a
-- second role written since is removed again (the role in force kept), with an audit event.
begin;
drop index platform.role_assignments_tenant_membership_one_role_uq;
alter table platform.invitations drop constraint invitations_one_role_check;
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, 'training_coordinator', false from platform.tenant_memberships m
where m.user_id = '00000000-0000-4000-8000-0000000000ab' and m.tenant_id = 'a0000000-0000-4000-8000-000000000001';
\ir ../migrations/20261019090400_platform__one_role_per_member.sql
do $$
begin
  perform tests.assert_eq((select string_agg(ra.role_code, ',') from platform.role_assignments ra
                           join platform.tenant_memberships m on m.id = ra.membership_id
                           where m.user_id = '00000000-0000-4000-8000-0000000000ab' and m.tenant_id = 'a0000000-0000-4000-8000-000000000001'),
    'hr_manager', 'one role again: the primary role kept');
  perform tests.assert((select count(*) = 1 from platform.audit_events a
                        where a.entity_id = 'a1000000-0000-4000-8000-0000000000ab'
                          and a.data ->> 'reason' like 'EP-ROLES one role per person%'), 'audited');
  perform tests.assert(to_regclass('platform.role_assignments_tenant_membership_one_role_uq') is not null, 'the index is back');
end $$;
rollback;

\echo '98_role_mapping_owner: ok'
