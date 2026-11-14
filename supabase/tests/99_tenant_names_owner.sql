-- db-test: run-as=owner
-- An organization is named in at least one language (WP-UX-01 d, migrations 20261113120000–20261113120200;
-- FR-ADM-17; PO 12 Nov 2026): platform.tenants accepts an English name alone or an Arabic name alone and
-- refuses an organization without any name; a given name is still checked; the Super Admin console's
-- private.platform_create_tenant accepts one name in either language, names the missing field by the
-- language chosen, and the readers the sign-up page and the console use return the organization with the
-- name it has. Fixtures: the Super Admin uP (…f1, session …fa01) of 95_platform_admin_owner.sql. Rolled back.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------------------------------
-- The table: one name is enough, none is refused, a given name is still checked
-- ---------------------------------------------------------------------------------------------------
begin;
do $$
declare
  v_en uuid;
  v_ar uuid;
begin
  perform tests.assert_eq((select c.convalidated from pg_catalog.pg_constraint c
                           where c.conrelid = 'platform.tenants'::regclass and c.conname = 'tenants_name_present_check'),
    true, 'the «a name in at least one language» check is validated');
  perform tests.assert_eq((select a.attnotnull from pg_catalog.pg_attribute a
                           where a.attrelid = 'platform.tenants'::regclass and a.attname = 'name_ar'),
    false, 'the Arabic name is no longer required by itself');

  insert into platform.tenants (slug, name_en) values ('names-english-only', 'English Only Co') returning id into v_en;
  insert into platform.tenants (slug, name_ar) values ('names-arabic-only', 'منشأة بالعربية') returning id into v_ar;
  perform tests.assert_eq((select name_ar from platform.tenants where id = v_en), null::text,
    'an organization named in English only keeps no Arabic name');
  perform tests.assert_eq((select name_en from platform.tenants where id = v_ar), null::text,
    'an organization named in Arabic only keeps no English name');
  -- Created as any organization: its settings, security policy and first structure level.
  perform tests.assert((select count(*) = 1 from platform.tenant_settings s where s.tenant_id = v_en)
                       and (select count(*) = 1 from platform.security_policies p where p.tenant_id = v_en)
                       and (select count(*) = 1 from platform.structure_levels l where l.tenant_id = v_en),
    'an organization named in English only gets its defaults');

  -- No name at all, and the only name taken away.
  perform tests.assert_check_constraint($q$insert into platform.tenants (slug) values ('names-none')$q$,
    'tenants_name_present_check', 'an organization without any name is refused');
  perform tests.assert_check_constraint(format($q$update platform.tenants set name_en = null where id = %L$q$, v_en),
    'tenants_name_present_check', 'the only name of an organization cannot be removed');
  perform tests.assert_check_constraint(format($q$update platform.tenants set name_ar = null where id = %L$q$, v_ar),
    'tenants_name_present_check', 'the only (Arabic) name of an organization cannot be removed');
  -- A given name is still checked.
  perform tests.assert_check_constraint(format($q$update platform.tenants set name_ar = '   ' where id = %L$q$, v_en),
    'tenants_name_ar_check', 'a given Arabic name is not blank');
  perform tests.assert_check_constraint(format($q$update platform.tenants set name_ar = %L where id = %L$q$, repeat('م', 201), v_en),
    'tenants_name_ar_length_check', 'a given Arabic name keeps its length limit');
  perform tests.assert_check_constraint(format($q$update platform.tenants set name_en = '   ' where id = %L$q$, v_ar),
    'tenants_name_en_check', 'a given English name is not blank');
  perform tests.assert_check_constraint(format($q$update platform.tenants set name_en = %L where id = %L$q$, E'Evil‮Name', v_en),
    'tenants_names_bidi_check', 'bidirectional override marks stay refused');
  -- The other language can be added later, and removed again.
  update platform.tenants set name_ar = 'منشأة' where id = v_en;
  update platform.tenants set name_ar = null where id = v_en;
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The console: «Create organization» with one name, in either language
-- ---------------------------------------------------------------------------------------------------
begin;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-00000000fa01', null));
do $$
declare
  v_create text := $q$select * from private.platform_create_tenant(%L, %L, %L, %L, null, null, null, null, %L)$q$;
  r record;
begin
  -- No name at all: the missing field is the name in the language chosen.
  perform tests.assert_fails_state_like(format(v_create, 'names-none', null, null, 'a@names.test', 'en'), 'JP001', 'name_en',
    'English chosen, no name: the English name is missing');
  perform tests.assert_fails_state_like(format(v_create, 'names-none', '  ', '  ', 'a@names.test', 'ar'), 'JP001', 'name_ar',
    'Arabic chosen, blank names: the Arabic name is missing');
  -- A given name is still checked, in either slot.
  perform tests.assert_fails_state_like(format(v_create, 'names-none', repeat('م', 201), 'Fine', 'a@names.test', 'en'),
    'JP001', 'name_ar', 'a given Arabic name: at most 200');
  perform tests.assert_fails_state_like(format(v_create, 'names-none', E'منشأة\n', 'Fine', 'a@names.test', 'en'),
    'JP001', 'name_ar', 'a given Arabic name: no control characters');
  perform tests.assert_fails_state_like(format(v_create, 'names-none', null, repeat('x', 201), 'a@names.test', 'en'),
    'JP001', 'name_en', 'a given English name: at most 200');
  perform tests.assert_fails_state_like(format(v_create, 'names-none', null, E'Org\tCo', 'a@names.test', 'en'),
    'JP001', 'name_en', 'a given English name: no control characters');

  -- English only (the default language of a new organization).
  select * into r from private.platform_create_tenant('names-en', null, '  English Only Co  ', 'admin@names-en.test',
                                                      null, null, null, null, 'en');
  perform set_config('tests.names_en', r.tenant_id::text, true);
  perform tests.assert_eq((select row(x.state, x.tenant_name_ar, x.tenant_name_en, x.locale)::text
                           from private.invitation_by_token(tests.token_hash(r.invite_code)) x),
    row('valid', null::text, 'English Only Co', 'en')::text,
    'the sign-up page gets the organization with its English name only (trimmed)');
  perform tests.assert_eq((select row(l.name_ar, l.name_en, l.admin_state)::text
                           from private.platform_list_tenants() l where l.tenant_id = r.tenant_id),
    row(null::text, 'English Only Co', 'pending')::text, 'the console lists it with the name it has');

  -- Arabic only, and both.
  select * into r from private.platform_create_tenant('names-ar', 'منشأة بالعربية', '', 'admin@names-ar.test',
                                                      null, null, null, null, 'ar');
  perform set_config('tests.names_ar', r.tenant_id::text, true);
  perform tests.assert_eq((select row(l.name_ar, l.name_en)::text
                           from private.platform_list_tenants() l where l.tenant_id = r.tenant_id),
    row('منشأة بالعربية', null::text)::text, 'Arabic only: no English name is kept');
  select * into r from private.platform_create_tenant('names-both', 'منشأة', 'Both Co', 'admin@names-both.test',
                                                      null, null, null, null, 'en');
  perform tests.assert_eq((select row(l.name_ar, l.name_en)::text
                           from private.platform_list_tenants() l where l.tenant_id = r.tenant_id),
    row('منشأة', 'Both Co')::text, 'both names are kept');
  -- The previous release's call: the Arabic name with English chosen — still accepted (expand first).
  select * into r from private.platform_create_tenant('names-old', 'منشأة قديمة', null, 'admin@names-old.test',
                                                      null, null, null, null, 'en');
  perform tests.assert_eq((select row(l.name_ar, l.name_en)::text
                           from private.platform_list_tenants() l where l.tenant_id = r.tenant_id),
    row('منشأة قديمة', null::text)::text, 'the Arabic name alone with English chosen is still accepted');
end $$;
-- The language chosen is the organization's default language (20261113120300; ruling of 14 Nov 2026), and
-- its invitation's. Read as the owner: the settings are tenant data.
reset role;
reset session authorization;
select tests.set_claims(null);
do $$
declare
  v_en uuid := current_setting('tests.names_en')::uuid;
  v_ar uuid := current_setting('tests.names_ar')::uuid;
begin
  perform tests.assert_eq((select default_locale from platform.tenant_settings where tenant_id = v_ar), 'ar',
    'an organization created in Arabic has Arabic as its default language');
  perform tests.assert_eq((select default_locale from platform.tenant_settings where tenant_id = v_en), 'en',
    'an organization created in English has English as its default language');
  perform tests.assert_eq((select string_agg(i.locale, ',') from platform.invitations i where i.tenant_id = v_ar), 'ar',
    'its Organization Admin''s invitation is in the same language');
  perform tests.assert_eq((select row(s.version, s.updated_by)::text from platform.tenant_settings s where s.tenant_id = v_ar),
    row(2, null::uuid)::text, 'set once, as a platform operation (no person stamped)');
  -- What the guard gained: the default language of a settings row never saved, nothing else.
  perform tests.assert(has_column_privilege('platform_admin_guard', 'platform.tenant_settings', 'default_locale', 'update')
                       and not has_column_privilege('platform_admin_guard', 'platform.tenant_settings', 'timezone', 'update')
                       and not has_column_privilege('platform_admin_guard', 'platform.tenant_settings', 'industry', 'select')
                       and not has_table_privilege('platform_admin_guard', 'platform.tenant_settings', 'delete'),
    'platform_admin_guard changes only default_locale and reads only tenant_id and version');
end $$;
-- A settings row already saved (version > 1) is out of the guard's reach.
set local role platform_admin_guard;
select tests.assert_eq(tests.rows_affected(format(
  $q$update platform.tenant_settings set default_locale = 'en' where tenant_id = %L$q$, current_setting('tests.names_ar'))),
  0::bigint, 'platform_admin_guard cannot change the language of a saved organization');
reset role;
rollback;

\echo '99_tenant_names_owner: ok'
