-- db-test: run-as=owner
-- The heads of units hold the Department Head role (WP-FIX-03; migration 20261112100000) on data as it was
-- before: members who head a live unit with the Employee role, no role, another role, a revoked
-- membership, and a head of a deleted unit; then the real migration file runs again, twice (idempotent).
-- Employees and members without a role become Department Heads; nobody else changes. Rolled back.
\set ON_ERROR_STOP on

begin;
-- Members of tenant A (users …f0-1 … …f0-6).
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-0000000f000' || n)::uuid, 'head' || n || '@a.test' from generate_series(1, 6) n;
insert into platform.persons (id, tenant_id, display_name_ar, email)
select ('a1000000-0000-4000-8000-0000000f000' || n)::uuid, 'a0000000-0000-4000-8000-000000000001', 'رئيس ' || n, 'head' || n || '@a.test'
from generate_series(1, 6) n;
insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
select 'a0000000-0000-4000-8000-000000000001', ('00000000-0000-4000-8000-0000000f000' || n)::uuid,
       ('a1000000-0000-4000-8000-0000000f000' || n)::uuid, case when n = 4 then 'revoked' else 'active' end
from generate_series(1, 6) n;
-- 1: Employee, heads two units · 2: no role, heads a unit · 3: L&D Manager, heads a unit ·
-- 4: revoked membership (no role), heads a unit · 5: Employee, heads only a deleted unit ·
-- 6: Employee, heads nothing.
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, r.role_code, true
from (values (1, 'learner'), (3, 'training_manager'), (5, 'learner'), (6, 'learner')) as r (n, role_code)
join platform.tenant_memberships m on m.user_id = ('00000000-0000-4000-8000-0000000f000' || r.n)::uuid;
insert into platform.departments (id, tenant_id, code, name_ar, name_en, parent_id, head_person_id) values
  ('a3000000-0000-4000-8000-0000000f0001', 'a0000000-0000-4000-8000-000000000001', 'HEAD-T1', 'وحدة ١', 'Unit 1', null, 'a1000000-0000-4000-8000-0000000f0001'),
  ('a3000000-0000-4000-8000-0000000f0002', 'a0000000-0000-4000-8000-000000000001', 'HEAD-T2', 'وحدة ٢', 'Unit 2', null, 'a1000000-0000-4000-8000-0000000f0001'),
  ('a3000000-0000-4000-8000-0000000f0003', 'a0000000-0000-4000-8000-000000000001', 'HEAD-T3', 'وحدة ٣', 'Unit 3', null, 'a1000000-0000-4000-8000-0000000f0002'),
  ('a3000000-0000-4000-8000-0000000f0004', 'a0000000-0000-4000-8000-000000000001', 'HEAD-T4', 'وحدة ٤', 'Unit 4', null, 'a1000000-0000-4000-8000-0000000f0003'),
  ('a3000000-0000-4000-8000-0000000f0005', 'a0000000-0000-4000-8000-000000000001', 'HEAD-T5', 'وحدة ٥', 'Unit 5', null, 'a1000000-0000-4000-8000-0000000f0004'),
  ('a3000000-0000-4000-8000-0000000f0006', 'a0000000-0000-4000-8000-000000000001', 'HEAD-T6', 'وحدة ٦', 'Unit 6', null, 'a1000000-0000-4000-8000-0000000f0005');
update platform.departments set deleted_at = now() where id = 'a3000000-0000-4000-8000-0000000f0006';

create function pg_temp.roles() returns text language sql as $$
  select string_agg(right(m.user_id::text, 1) || ':' || ra.role_code, ',' order by m.user_id)
  from platform.role_assignments ra join platform.tenant_memberships m on m.id = ra.membership_id
  where m.user_id::text like '00000000-0000-4000-8000-0000000f000_';
$$;
create table pg_temp.others as
  select ra.id, ra.role_code from platform.role_assignments ra
  join platform.tenant_memberships m on m.id = ra.membership_id
  where m.user_id::text not like '00000000-0000-4000-8000-0000000f000_';

-- The real migration, again.
\ir ../migrations/20261112100000_platform__department_heads_hold_the_role.sql

do $$
begin
  perform tests.assert_eq(pg_temp.roles(),
    '1:department_head,2:department_head,3:training_manager,5:learner,6:learner',
    'heads: the Employee (1) and the member without a role (2) become Department Heads; another role is kept '
    '(3); a revoked membership gets nothing (4); a deleted unit does not count (5); no unit, no change (6)');
  perform tests.assert_eq((select count(*) from platform.audit_events a
                           where a.action = 'platform.user.roles_changed' and a.actor_user_id is null
                             and a.entity_id like 'a1000000-0000-4000-8000-0000000f000_'
                             and a.data ->> 'reason' = 'unit_head (migration 20261112100000)'),
    2::bigint, 'an audit event per member changed');
  perform tests.assert_eq((select a.data - 'reason' from platform.audit_events a
                           where a.entity_id = 'a1000000-0000-4000-8000-0000000f0001'
                             and a.data ->> 'reason' = 'unit_head (migration 20261112100000)'),
    '{"before": "learner", "after": "department_head", "automatic": true,
      "unitIds": ["a3000000-0000-4000-8000-0000000f0001", "a3000000-0000-4000-8000-0000000f0002"]}'::jsonb,
    'the role before and after, and the units headed (ids only)');
  perform tests.assert_eq((select a.data -> 'before' from platform.audit_events a
                           where a.entity_id = 'a1000000-0000-4000-8000-0000000f0002'
                             and a.data ->> 'reason' = 'unit_head (migration 20261112100000)'),
    'null'::jsonb, 'no role before');
  perform tests.assert_eq((select count(*) from platform.role_assignments ra
                           join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
                           group by ra.tenant_id, ra.membership_id having count(*) > 1 limit 1),
    null::bigint, 'still one role per member');
end $$;

-- Idempotent: a second run changes nobody and audits nothing more.
\ir ../migrations/20261112100000_platform__department_heads_hold_the_role.sql

do $$
begin
  perform tests.assert_eq(pg_temp.roles(),
    '1:department_head,2:department_head,3:training_manager,5:learner,6:learner', 'a second run changes nobody');
  perform tests.assert_eq((select count(*) from platform.audit_events a
                           where a.entity_id like 'a1000000-0000-4000-8000-0000000f000_'
                             and a.data ->> 'reason' = 'unit_head (migration 20261112100000)'),
    2::bigint, 'a second run audits nothing more');
end $$;
rollback;

\echo '99_unit_heads_role_owner: ok'
