-- db-test: run-as=app_server
-- Organization profile and regional settings (T-M2-22; FR-ADM-02, FR-SCH-07): only an Organization Admin at
-- AAL2 with a recent code changes them (and the organization's display names), only in their own
-- organization; every member reads their own organization's settings; the stamps come from the claims.
-- Runs CONNECTED AS app_server (fixtures: 00, 65).
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_set constant text := 'update platform.tenant_settings set currency_code = ''AED'', date_display = ''dual''';
  v_names constant text := 'update platform.tenants set name_en = ''Renamed'', name_ar = ''اسم جديد''';
begin
  -- Organization Admin, AAL1: reads, changes nothing.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_eq((select count(*) from platform.tenant_settings), 1::bigint, 'the Organization Admin reads the settings');
  perform tests.assert_eq(tests.rows_affected(v_set), 0::bigint, 'AAL1: the Organization Admin cannot change the settings');
  perform tests.assert_eq(tests.rows_affected(v_names), 0::bigint, 'AAL1: … nor the display names');
  -- A token CLAIMING aal2 without a confirmed app: not enough.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1') || tests.fresh_code());
  perform tests.assert_eq(tests.rows_affected(v_set), 0::bigint, 'a claimed aal2 without the Auth session: no change');
  -- HR Manager of A (claiming a fresh code; a real AAL2 session: 90_tenant_settings_owner.sql): not an
  -- Organization Admin.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', v_a,
                                             'a1000000-0000-4000-8000-0000000000ab') || tests.fresh_code());
  perform tests.assert(not ('tenant_admin' = any (private.actor_role_codes(v_a, '00000000-0000-4000-8000-0000000000ab'))),
    'the HR Manager is not an Organization Admin');
  perform tests.assert_eq((select count(*) from platform.tenant_settings), 1::bigint, 'the HR Manager reads the settings');
  perform tests.assert_eq(tests.rows_affected(v_set), 0::bigint, 'an HR Manager cannot change the settings');
  perform tests.assert_eq(tests.rows_affected(v_names), 0::bigint, 'an HR Manager cannot rename the organization');
  -- A learner reads them (every page formats dates with them) and changes nothing.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11', v_a,
                                             'a1000000-0000-4000-8000-000000000c01'));
  perform tests.assert_eq((select timezone from platform.tenant_settings), 'Asia/Riyadh', 'members read their organization''s settings');
  perform tests.assert_eq(tests.rows_affected(v_set), 0::bigint, 'a learner cannot change the settings');
  perform tests.assert_eq(tests.rows_affected(v_names), 0::bigint, 'a learner cannot rename the organization');
  -- An L&D (Training) Manager at AAL2: not an Organization Admin either.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c06', '10000000-0000-4000-8000-000000000c61', v_a,
                                             'a1000000-0000-4000-8000-000000000c06') || tests.fresh_code());
  perform tests.assert(not private.actor_may_manage_tenant(v_a), 'a Training Manager may not manage the organization');
  -- The second Organization Admin at AAL2 with a code older than 15 minutes: no change.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a,
                                             'a1000000-0000-4000-8000-000000000c09') || tests.fresh_code(interval '16 minutes'));
  perform tests.assert(not private.actor_may_manage_tenant(v_a), 'a stale code: may not manage the organization');
  perform tests.assert_eq(tests.rows_affected(v_set), 0::bigint, 'a stale code: no change');
  perform tests.assert_eq(tests.rows_affected(v_names), 0::bigint, 'a stale code: no rename');

  -- …with a fresh code: changed, stamped with the admin's person, version 2.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a,
                                             'a1000000-0000-4000-8000-000000000c09') || tests.fresh_code());
  perform tests.assert(private.actor_may_manage_tenant(v_a), 'the Organization Admin at AAL2 may manage the organization');
  perform tests.assert_eq(tests.rows_affected(v_set || ', working_days = ''{5,1,1,2,3,4}'''), 1::bigint,
    'the Organization Admin at AAL2 changes the settings');
  perform tests.assert((select currency_code = 'AED' and date_display = 'dual' and working_days = '{1,2,3,4,5}'
                               and version = 2 and updated_by = 'a1000000-0000-4000-8000-000000000c09'
                        from platform.tenant_settings),
    'stamped with the editor and a new version; the week normalized');
  perform tests.assert_eq(tests.rows_affected(v_names), 1::bigint, 'the Organization Admin renames the organization');
  perform tests.assert((select name_en = 'Renamed' and name_ar = 'اسم جديد' from platform.tenants),
    'the display names changed');
  -- Only the settings and the display names: not the stamps, the organization, its slug or status.
  perform tests.assert_privilege_denied($q$update platform.tenant_settings set updated_by = null$q$, 'updated_by is not updatable');
  perform tests.assert_privilege_denied($q$update platform.tenant_settings set version = 1$q$, 'version is not updatable');
  perform tests.assert_privilege_denied($q$update platform.tenant_settings set updated_at = now()$q$, 'updated_at is not updatable');
  perform tests.assert_privilege_denied($q$update platform.tenants set slug = 'renamed'$q$, 'the slug is not updatable');
  perform tests.assert_privilege_denied($q$update platform.tenants set status = 'active'$q$, 'the status is not updatable');
  perform tests.assert_privilege_denied($q$update platform.tenants set edition = 'enterprise'$q$, 'the edition is not updatable');
  -- The rules hold for the admin too.
  perform tests.assert_check_constraint($q$update platform.tenants set name_en = '   '$q$,
    'tenants_name_en_check', 'a blank English name is refused (none = null)');
  perform tests.assert_check_constraint($q$update platform.tenants set name_ar = ' '$q$,
    'tenants_name_ar_check', 'the Arabic name is required');
  perform tests.assert_check_constraint(format('update platform.tenants set name_en = %L', 'Al ' || chr(8238) || 'Raya'),
    'tenants_names_bidi_check', 'no bidi override in a name (U+202E)');
  perform tests.assert_check_constraint(format('update platform.tenants set name_ar = %L', 'شركة ' || chr(8294) || 'الراية'),
    'tenants_names_bidi_check', 'no bidi isolate in a name (U+2066)');
  perform tests.assert_eq(tests.rows_affected(format('update platform.tenants set name_ar = %L', 'شركة' || chr(8204) || 'الراية')),
    1::bigint, 'a zero-width non-joiner is allowed (Arabic/Persian spelling)');
  perform tests.assert_check_constraint(format('update platform.tenants set name_ar = %L', repeat('ن', 201)),
    'tenants_name_ar_length_check', 'at most 200 characters (the provisioning limit)');
  perform tests.assert_check_constraint($q$update platform.tenant_settings set work_ends_at = '07:00'$q$,
    'tenant_settings_working_hours_check', 'the end after the start');
  perform tests.assert_check_constraint($q$update platform.tenant_settings set timezone = 'Europe/Atlantis'$q$,
    'tenant_settings_timezone_check', 'a time zone the database knows');
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenants set name_en = null$q$), 1::bigint,
    'no English name is allowed (null)');
  -- Never another organization's settings or names (RLS), by id or in bulk.
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_settings set currency_code = 'EUR' where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'the admin of A cannot change B''s settings');
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenants set name_en = 'Taken over' where id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'the admin of A cannot rename B');
  perform tests.assert_eq((select count(*) from platform.tenant_settings where tenant_id <> v_a), 0::bigint,
    'the admin of A sees no other organization''s settings');
end $$;
rollback;

-- B's Organization Admin at AAL2 changes B's settings, never A's; a member of A and B sees the settings of
-- the organization the session acts in only.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_b constant uuid := 'b0000000-0000-4000-8000-000000000001';
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', v_b) || tests.fresh_code());
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_settings set timezone = 'Asia/Dubai', default_locale = 'en'$q$),
    1::bigint, 'B''s admin changes B''s settings');
  perform tests.assert_eq(tests.rows_affected(format('update platform.tenant_settings set timezone = %L where tenant_id = %L', 'Africa/Cairo', v_a)),
    0::bigint, 'B''s admin cannot change A''s settings');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c03', '10000000-0000-4000-8000-000000000c31', v_a));
  perform tests.assert_eq((select string_agg(tenant_id::text || ':' || timezone, ',') from platform.tenant_settings),
    v_a::text || ':Asia/Riyadh', 'a member of A and B acting in A sees A''s settings only');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c03', '10000000-0000-4000-8000-000000000c33', v_b));
  perform tests.assert_eq((select string_agg(tenant_id::text || ':' || timezone || ':' || default_locale, ',') from platform.tenant_settings),
    v_b::text || ':Asia/Dubai:en', '… and acting in B, B''s only');
end $$;
rollback;

-- Without claims, or with claims the database does not accept: nothing.
begin;
set local role authenticated;
do $$
begin
  perform tests.set_claims(null);
  perform tests.assert_eq((select count(*) from platform.tenant_settings), 0::bigint, 'no claims: no settings');
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenants set name_en = 'x'$q$), 0::bigint, 'no claims: no rename');
end $$;
rollback;
\echo '89_tenant_settings_app_server: ok'
