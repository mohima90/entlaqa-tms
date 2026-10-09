-- db-test: run-as=owner
-- Shared rate limiter (ADR 0011 §4, T-M2-11; migration 20261013090000): owner, grants and shape, then the
-- fixtures for 71_rate_limiter_app_server.sql (committed): expired counters that the app's hits must purge,
-- and an expired, used-up counter whose window must start again. Checked in 72_rate_limiter_owner.sql.
\set ON_ERROR_STOP on

-- rate_limit_guard owns exactly the limiter functions (three SECURITY DEFINER entry points, two helpers);
-- nobody acts as it; it creates nothing and owns no relation.
do $$
declare
  v_list text;
  v_role text;
begin
  perform tests.assert(not (select rolbypassrls or rolcanlogin or rolsuper or rolinherit or rolcreaterole or rolcreatedb
                            from pg_roles where rolname = 'rate_limit_guard'),
    'rate_limit_guard must be NOLOGIN NOINHERIT and not BYPASSRLS / superuser / createrole / createdb');
  select string_agg(format('%s%s', p.oid::regprocedure, case when p.prosecdef then '' else ' (INVOKER)' end), ', '
                    order by p.oid::regprocedure::text) into v_list
  from pg_proc p where p.proowner = 'rate_limit_guard'::regrole;
  perform tests.assert_eq(v_list,
    'private.rate_limit_check_call(text,bytea) (INVOKER), private.rate_limit_clear(text,bytea), '
    'private.rate_limit_hit(text,bytea,integer,integer), private.rate_limit_key(bytea) (INVOKER), '
    'private.rate_limit_peek(text,bytea,integer)',
    'rate_limit_guard owns the limiter functions only; the entry points are SECURITY DEFINER');
  perform tests.assert(not exists (
      select 1 from pg_proc p where p.proowner = 'rate_limit_guard'::regrole
        and not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""' or c = 'search_path=')),
    'every limiter function pins an empty search_path');
  perform tests.assert(not exists (select 1 from pg_class c where c.relowner = 'rate_limit_guard'::regrole),
    'rate_limit_guard owns no relations');
  perform tests.assert(not exists (
      select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
      where m.roleid = 'rate_limit_guard'::regrole and (m.inherit_option or m.set_option)
        and not u.rolsuper and u.rolname <> current_user),
    'nobody acts as rate_limit_guard');
  perform tests.assert(not has_schema_privilege('rate_limit_guard', 'private', 'CREATE')
                       and not has_schema_privilege('rate_limit_guard', 'platform', 'CREATE')
                       and not has_schema_privilege('rate_limit_guard', 'platform', 'USAGE'),
    'rate_limit_guard creates nothing and does not reach the platform schema');

  -- Callers: the three entry points are executable by authenticated (each checks session_user =
  -- app_server itself) and nobody else besides the owner; the key and argument helpers by the owner only.
  for v_list in
    select distinct format('%s → %s', p.oid::regprocedure,
                           case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.proowner = 'rate_limit_guard'::regrole and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) <> 'authenticated'
           or p.proname in ('rate_limit_key', 'rate_limit_check_call'))
  loop
    perform tests.assert(false, format('unexpected EXECUTE: %s', v_list));
  end loop;
  perform tests.assert(has_function_privilege('authenticated', 'private.rate_limit_hit(text,bytea,integer,integer)', 'execute')
                       and has_function_privilege('authenticated', 'private.rate_limit_peek(text,bytea,integer)', 'execute')
                       and has_function_privilege('authenticated', 'private.rate_limit_clear(text,bytea)', 'execute'),
    'the web app (as authenticated) may call the three entry points');

  -- The secret and the counters: RLS forced, reachable by rate_limit_guard alone (no application role,
  -- no Supabase role, no other guard has any privilege, table or column).
  perform tests.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.rate_limit_secret'::regclass)
                       and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.rate_limit_counters'::regclass),
    'rate_limit_secret / rate_limit_counters: row level security must be ENABLED and FORCED');
  for v_role in select unnest(array['anon', 'authenticated', 'service_role', 'app_server', 'app_worker', 'app_queue',
                                    'tenant_guard', 'invitation_guard', 'account_mail_guard', 'supabase_auth_admin']) loop
    perform tests.assert(
      not has_table_privilege(v_role, 'private.rate_limit_secret', 'select, insert, update, delete, truncate, references, trigger')
        and not has_any_column_privilege(v_role, 'private.rate_limit_secret', 'select, insert, update, references')
        and not has_table_privilege(v_role, 'private.rate_limit_counters', 'select, insert, update, delete, truncate, references, trigger')
        and not has_any_column_privilege(v_role, 'private.rate_limit_counters', 'select, insert, update, references'),
      format('%s must have no privilege on the limiter''s secret or counters', v_role));
  end loop;
  perform tests.assert(has_table_privilege('rate_limit_guard', 'private.rate_limit_secret', 'select')
                       and not has_table_privilege('rate_limit_guard', 'private.rate_limit_secret', 'insert, update, delete, truncate'),
    'rate_limit_guard reads the secret and never changes it');

  -- Shape: the counters hold a bucket, a 32-byte keyed hash, a count and the window's end — no column for
  -- a readable key. Unlogged (ADR 0011 §4). The secret: one row of HMAC-SHA-256 padded keys (64 bytes
  -- each, inner xor outer = 0x36 xor 0x5c for every byte: both derive from one key K).
  select string_agg(a.attname, ', ' order by a.attnum) into v_list
  from pg_attribute a where a.attrelid = 'private.rate_limit_counters'::regclass and a.attnum > 0 and not a.attisdropped;
  perform tests.assert_eq(v_list, 'bucket, key_hash, hits, reset_at', 'rate_limit_counters columns');
  perform tests.assert_eq((select relpersistence::text from pg_class where oid = 'private.rate_limit_counters'::regclass), 'u',
    'rate_limit_counters is UNLOGGED');
  perform tests.assert_eq((select count(*)::int from private.rate_limit_secret), 1, 'one limiter key');
  perform tests.assert((select octet_length(inner_key) = 64 and octet_length(outer_key) = 64
                               and not exists (select 1 from generate_series(0, 63) i
                                               where (get_byte(inner_key, i) # get_byte(outer_key, i)) <> 106)  -- 0x6a
                        from private.rate_limit_secret),
    'the secret is HMAC-SHA-256''s inner and outer padded keys of one 64-byte key');
  perform tests.assert_check_constraint(
    'insert into private.rate_limit_secret (id, inner_key, outer_key) values (false, decode(repeat(''00'', 64), ''hex''), decode(repeat(''00'', 64), ''hex''))',
    'rate_limit_secret_single_row', 'only one limiter key row can exist');
end $$;

-- Fixtures for 71 (committed). Subjects are SHA-256 values like the app's (tests use sha256 of a label).
-- 30 counters expired an hour ago (bucket tests.purge): the hits of 71 remove them (20 per hit at most).
insert into private.rate_limit_counters (bucket, key_hash, hits, reset_at)
select 'tests.purge', sha256(convert_to('purge-' || i, 'UTF8')), 3, now() - interval '1 hour'
from generate_series(1, 30) i;
-- A used-up counter whose window ended a second ago (bucket tests.window, subject 'window'): the next hit
-- starts a new window.
insert into private.rate_limit_counters (bucket, key_hash, hits, reset_at)
values ('tests.window', private.rate_limit_key(sha256(convert_to('window', 'UTF8'))), 4, now() - interval '1 second');

\echo '70_rate_limiter_owner: ok'
