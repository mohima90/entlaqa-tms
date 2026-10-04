-- db-test: run-as=owner
-- Test helpers (schema `tests`) and committed fixture data. Runs as the superuser test connection.
-- Fixed UUIDs keep assertions readable:
--   tenants  A a...01 active   B b...01 active   C c...01 suspended   D d...01 trial
--   users    uA (A active)  uB (B active)  uAB (A+B active)  uInv (A invited)  uSus (A suspended)
--            uC (C active, tenant suspended)  uD (D active, trial tenant)  uNone (no membership)
--   sessions each user has one acting in its tenant (platform.session_context); uAB has sAB1 and sAB2
--            (both in A) and sAB3 (no session_context row yet: first tenant selection)
\set ON_ERROR_STOP on

create schema if not exists tests;
grant usage on schema tests to public;

-- ---- helpers ---------------------------------------------------------------------------------
create or replace function tests.assert(p_condition boolean, p_message text) returns void
language plpgsql as $$
begin
  if p_condition is distinct from true then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end $$;

create or replace function tests.assert_eq(p_actual anyelement, p_expected anyelement, p_message text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERTION FAILED: % (expected %, got %)', p_message, p_expected, p_actual;
  end if;
end $$;

-- Executes SQL and returns the number of affected/returned rows. Errors are NOT swallowed: a missing
-- privilege (42501) must never be mistaken for "RLS filtered every row" — tests assert privilege
-- denials separately with tests.assert_privilege_denied().
create or replace function tests.rows_affected(p_sql text) returns bigint
language plpgsql as $$
declare
  v_count bigint;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Asserts the statement fails with one of the expected SQLSTATEs (42501 = RLS/privilege, 23503 = FK).
create or replace function tests.assert_fails(p_sql text, p_states text[], p_message text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = any (p_states) then
      return;
    end if;
    raise exception 'ASSERTION FAILED: % (unexpected error % %)', p_message, sqlstate, sqlerrm;
  end;
  raise exception 'ASSERTION FAILED: % (statement succeeded)', p_message;
end $$;

-- Asserts the statement fails with 42501 AND a message matching p_pattern (ILIKE). 42501 is used both
-- for missing privileges and for RLS WITH CHECK violations; these helpers tell them apart.
create or replace function tests.assert_fails_like(p_sql text, p_pattern text, p_message text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = '42501' and sqlerrm ilike p_pattern then
      return;
    end if;
    raise exception 'ASSERTION FAILED: % (expected 42501 "%", got % %)', p_message, p_pattern, sqlstate, sqlerrm;
  end;
  raise exception 'ASSERTION FAILED: % (statement succeeded)', p_message;
end $$;

-- Missing GRANT (table/column privilege): "permission denied for table …".
create or replace function tests.assert_privilege_denied(p_sql text, p_message text) returns void
language sql as $$
  select tests.assert_fails_like(p_sql, 'permission denied%', p_message);
$$;

-- RLS WITH CHECK violation: "new row violates row-level security policy …".
create or replace function tests.assert_rls_violation(p_sql text, p_message text) returns void
language sql as $$
  select tests.assert_fails_like(p_sql, 'new row violates row-level security policy%', p_message);
$$;

-- Row count of a table. Errors are NOT swallowed (see tests.rows_affected).
create or replace function tests.count_rows(p_table regclass) returns bigint
language plpgsql as $$
declare
  v_count bigint;
begin
  execute format('select count(*) from %s', p_table) into v_count;
  return v_count;
end $$;

-- Sets transaction-local claims exactly like withUserTx()/withSystemTx() (after `set local role`).
create or replace function tests.set_claims(p_claims jsonb) returns void
language sql as $$
  select set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
$$;

create or replace function tests.user_claims(p_user uuid, p_session uuid, p_tenant uuid, p_person uuid default null)
returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', 'aal1', 'session_id', p_session, 'tenant_id', p_tenant,
    'person_id', p_person));
$$;

create or replace function tests.system_claims(p_tenant uuid, p_job text default 'tests.job') returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('role', 'system', 'tenant_id', p_tenant, 'job_id', p_job));
$$;

-- Schemas that must follow the tenant RLS pattern: every non-system schema except the listed ones.
create or replace function tests.module_schemas()
returns table (schema_name name)
language sql stable as $$
  select n.nspname
  from pg_namespace n
  where n.nspname not like 'pg\_%'
    and n.nspname not in ('information_schema', 'public', 'auth', 'private', 'tests', 'extensions',
                          'storage', 'realtime', 'graphql', 'graphql_public', 'vault', 'net',
                          'cron', 'pgbouncer', 'supabase_functions', 'supabase_migrations', 'pgsodium',
                          'pgsodium_masks', 'pgmq', 'pgtle');
$$;

-- ALLOW-LIST of global (non-tenant) tables, e.g. reference data. Adding a table here requires a
-- security review: it still needs ENABLE + FORCE RLS, but no tenant_isolation policy.
create or replace function tests.global_tables()
returns table (table_name regclass)
language sql stable as $$
  select null::regclass where false
  -- union all select 'platform.countries'::regclass
$$;

-- Tenant-owned tables in module/platform schemas and the column that carries the tenant.
create or replace function tests.tenant_tables()
returns table (table_name regclass, tenant_column text)
language sql stable as $$
  select c.oid::regclass,
         case
           when n.nspname = 'platform' and c.relname = 'tenants' then 'id'
           when n.nspname = 'platform' and c.relname = 'session_context' then 'active_tenant_id'
           else 'tenant_id'
         end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and n.nspname in (select schema_name from tests.module_schemas())
    and c.oid not in (select table_name from tests.global_tables())
  order by 1::text;
$$;

grant execute on all functions in schema tests to public;

-- ---- fixtures ----------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'ua@a.test'),
  ('00000000-0000-4000-8000-0000000000b1', 'ub@b.test'),
  ('00000000-0000-4000-8000-0000000000ab', 'uab@ab.test'),
  ('00000000-0000-4000-8000-0000000000a2', 'uinv@a.test'),
  ('00000000-0000-4000-8000-0000000000a3', 'usus@a.test'),
  ('00000000-0000-4000-8000-0000000000c1', 'uc@c.test'),
  ('00000000-0000-4000-8000-0000000000d1', 'ud@d.test'),
  ('00000000-0000-4000-8000-0000000000e1', 'unone@e.test');

insert into auth.sessions (id, user_id, not_after) values
  ('10000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', null),              -- sA
  ('10000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000a1', now() - interval '1 minute'), -- sA expired
  ('10000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b1', now() + interval '1 day'),   -- sB
  ('10000000-0000-4000-8000-0000000000ab', '00000000-0000-4000-8000-0000000000ab', null),              -- sAB1
  ('10000000-0000-4000-8000-0000000000ac', '00000000-0000-4000-8000-0000000000ab', null),              -- sAB2
  ('10000000-0000-4000-8000-0000000000ad', '00000000-0000-4000-8000-0000000000ab', null),              -- sAB3 (no tenant selected yet)
  ('10000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a2', null),              -- sInv
  ('10000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a3', null),              -- sSus
  ('10000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c1', null),              -- sC
  ('10000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d1', null),              -- sD
  ('10000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e1', null);              -- sNone

insert into platform.tenants (id, slug, name_ar, name_en, status) values
  ('a0000000-0000-4000-8000-000000000001', 'tenant-a', 'المنشأة أ', 'Tenant A', 'active'),
  ('b0000000-0000-4000-8000-000000000001', 'tenant-b', 'المنشأة ب', 'Tenant B', 'active'),
  ('c0000000-0000-4000-8000-000000000001', 'tenant-c', 'المنشأة ج', 'Tenant C', 'suspended'),
  ('d0000000-0000-4000-8000-000000000001', 'tenant-d', 'المنشأة د', 'Tenant D', 'trial');

insert into platform.tenant_domains (tenant_id, hostname, kind, verified_at) values
  ('a0000000-0000-4000-8000-000000000001', 'tenant-a.jadarat.test', 'subdomain', now()),
  ('b0000000-0000-4000-8000-000000000001', 'tenant-b.jadarat.test', 'subdomain', now()),
  ('c0000000-0000-4000-8000-000000000001', 'tenant-c.jadarat.test', 'subdomain', now()),
  ('d0000000-0000-4000-8000-000000000001', 'tenant-d.jadarat.test', 'subdomain', null);

insert into platform.persons (id, tenant_id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001', 'مستخدم أ', 'ua@a.test'),
  ('a1000000-0000-4000-8000-0000000000ab', 'a0000000-0000-4000-8000-000000000001', 'مستخدم أب', 'uab@ab.test'),
  ('a1000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-000000000001', 'مدعو', 'uinv@a.test'),
  ('a1000000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-000000000001', 'موقوف', 'usus@a.test'),
  ('b1000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000001', 'مستخدم ب', 'ub@b.test'),
  ('b1000000-0000-4000-8000-0000000000ab', 'b0000000-0000-4000-8000-000000000001', 'مستخدم أب', 'uab@ab.test'),
  ('b1000000-0000-4000-8000-0000000000b9', 'b0000000-0000-4000-8000-000000000001', 'شخص بلا دخول', null),
  ('c1000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-000000000001', 'مستخدم ج', 'uc@c.test'),
  ('d1000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-000000000001', 'مستخدم د', 'ud@d.test');

insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000a1', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab', 'a1000000-0000-4000-8000-0000000000ab', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', 'a1000000-0000-4000-8000-0000000000a2', 'invited'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a3', 'a1000000-0000-4000-8000-0000000000a3', 'suspended'),
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b1', 'b1000000-0000-4000-8000-0000000000b1', 'active'),
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab', 'b1000000-0000-4000-8000-0000000000ab', 'active'),
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'c1000000-0000-4000-8000-0000000000c1', 'active'),
  ('d0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000d1', 'd1000000-0000-4000-8000-0000000000d1', 'active');

insert into platform.session_context (session_id, user_id, active_tenant_id) values
  ('10000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-0000000000ab', '00000000-0000-4000-8000-0000000000ab', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-0000000000ac', '00000000-0000-4000-8000-0000000000ab', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-000000000001');

insert into platform.audit_events (tenant_id, actor_user_id, action, entity_type, entity_id) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'platform.session.signed_in', 'user', 'ua'),
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b1', 'platform.session.signed_in', 'user', 'ub'),
  ('c0000000-0000-4000-8000-000000000001', null, 'platform.tenant.suspended', 'tenant', 'c');

-- Organization structure (T-M2-01): branches and departments in tenants A and B.
--   A: HQ branch RUH, branch JED; departments TD (head = person uA) → TD-PRG (child); OPS
--   B: branch HQ; department TD (same code as A: codes are unique per tenant only)
insert into platform.branches (id, tenant_id, code, name_ar, name_en, is_headquarters) values
  ('a2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'RUH', 'فرع الرياض', 'Riyadh', true),
  ('a2000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'JED', 'فرع جدة', 'Jeddah', false),
  ('b2000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'HQ', 'المقر الرئيسي', 'HQ', true);

insert into platform.departments (id, tenant_id, code, name_ar, name_en, parent_id, branch_id, head_person_id) values
  ('a3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'TD', 'التدريب والتطوير', 'Training & Development', null, 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'),
  ('a3000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'TD-PRG', 'برامج التدريب', 'Training programs', 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null),
  ('a3000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'OPS', 'العمليات', 'Operations', null, 'a2000000-0000-4000-8000-000000000002', null),
  ('b3000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'TD', 'التدريب', 'Training', null, 'b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1');
