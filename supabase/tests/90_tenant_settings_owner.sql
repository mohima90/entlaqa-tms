-- db-test: run-as=owner
-- Organization profile and regional settings (T-M2-22; FR-ADM-02, FR-SCH-07): every organization has its
-- settings (backfill + new organizations), the defaults keep what the app did before, every rule of the
-- table holds (constraints, the trigger's time-zone check, the working week normalized, stamps), and a
-- bulk import gives new people without a language the organization's default language. Fixtures: 00, 65,
-- 85. Every block is rolled back.
\set ON_ERROR_STOP on

-- Every organization has exactly one row, with the defaults (what the app did before: nothing changes
-- until the Organization Admin saves the profile); a new organization gets its own.
begin;
do $$
declare
  v_new uuid;
begin
  perform tests.assert_eq((select count(*) from platform.tenants t
                           where not exists (select 1 from platform.tenant_settings s where s.tenant_id = t.id)),
    0::bigint, 'every organization has its settings');
  perform tests.assert_eq((select count(*) from platform.tenant_settings), (select count(*) from platform.tenants),
    'one row per organization');
  perform tests.assert((select industry is null and country_code is null and currency_code = 'SAR'
                               and timezone = 'Asia/Riyadh' and fiscal_year_start_month = 1 and default_locale = 'ar'
                               and date_display = 'gregorian' and working_days = '{0,1,2,3,4}'
                               and work_starts_at = '08:00' and work_ends_at = '16:00' and version = 1
                               and updated_by is null
                        from platform.tenant_settings where tenant_id = 'a0000000-0000-4000-8000-000000000001'),
    'the defaults: no industry or country guessed, Saudi riyal, Riyadh, Sunday–Thursday 08:00–16:00, Arabic, Gregorian');
  insert into platform.tenants (slug, name_ar) values ('settings-new', 'منشأة جديدة') returning id into v_new;
  perform tests.assert_eq((select count(*) from platform.tenant_settings where tenant_id = v_new), 1::bigint,
    'a new organization gets its settings');
end $$;
rollback;

-- The backfill (20261017090100, run again here): an organization's time zone is its headquarters
-- branch's — what the app used for its calendar days before (review M2) — else Asia/Riyadh.
begin;
update platform.branches set timezone = 'Asia/Dubai' where id = 'a2000000-0000-4000-8000-000000000001';
delete from platform.tenant_settings
where tenant_id in ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001');
\ir ../migrations/20261017090100_platform__backfill_tenant_settings.sql
do $$
begin
  perform tests.assert_eq((select timezone from platform.tenant_settings where tenant_id = 'a0000000-0000-4000-8000-000000000001'),
    'Asia/Dubai', 'A: its headquarters branch''s time zone');
  perform tests.assert_eq((select timezone from platform.tenant_settings where tenant_id = 'c0000000-0000-4000-8000-000000000001'),
    'Asia/Riyadh', 'C (no headquarters branch): Asia/Riyadh');
  perform tests.assert_eq((select count(*) from platform.tenants t
                           where not exists (select 1 from platform.tenant_settings s where s.tenant_id = t.id)),
    0::bigint, 'every organization has its settings again');
end $$;
rollback;

-- Constraints (each with a failing case) and the trigger.
begin;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_set constant text := 'update platform.tenant_settings set %s where tenant_id = %L';
begin
  perform tests.assert_check_constraint(format(v_set, 'industry = ''mining''', v_a),
    'tenant_settings_industry_check', 'an industry outside the fixed list');
  perform tests.assert_check_constraint(format(v_set, 'country_code = ''sa''', v_a),
    'tenant_settings_country_code_check', 'country: two capital letters');
  perform tests.assert_check_constraint(format(v_set, 'country_code = ''SAU''', v_a),
    'tenant_settings_country_code_check', 'country: alpha-2, not alpha-3');
  perform tests.assert_check_constraint(format(v_set, 'currency_code = ''SR''', v_a),
    'tenant_settings_currency_code_check', 'currency: three capital letters');
  perform tests.assert_check_constraint(format(v_set, 'timezone = ''Asia/Riyadh; drop table x''', v_a),
    'tenant_settings_timezone_check', 'time zone: IANA name shape');
  perform tests.assert_check_constraint(format(v_set, 'timezone = ''Mars/Olympus_Mons''', v_a),
    'tenant_settings_timezone_check', 'time zone: one the database knows (trigger)');
  perform tests.assert_check_constraint(format(v_set, 'fiscal_year_start_month = 0', v_a),
    'tenant_settings_fiscal_year_start_month_check', 'fiscal year month at least 1');
  perform tests.assert_check_constraint(format(v_set, 'fiscal_year_start_month = 13', v_a),
    'tenant_settings_fiscal_year_start_month_check', 'fiscal year month at most 12');
  perform tests.assert_check_constraint(format(v_set, 'default_locale = ''fr''', v_a),
    'tenant_settings_default_locale_check', 'Arabic or English only');
  perform tests.assert_check_constraint(format(v_set, 'date_display = ''julian''', v_a),
    'tenant_settings_date_display_check', 'Gregorian, Hijri or both');
  perform tests.assert_check_constraint(format(v_set, 'working_days = ''{}''', v_a),
    'tenant_settings_working_days_check', 'at least one working day');
  perform tests.assert_check_constraint(format(v_set, 'working_days = ''{0,7}''', v_a),
    'tenant_settings_working_days_check', 'days are 0 (Sunday) to 6 (Saturday)');
  perform tests.assert_check_constraint(format(v_set, 'working_days = ''{-1}''', v_a),
    'tenant_settings_working_days_check', 'no negative day');
  perform tests.assert_check_constraint(format(v_set, 'working_days = ''{1,NULL}''', v_a),
    'tenant_settings_working_days_check', 'no unknown day');
  perform tests.assert_check_constraint(format(v_set, 'work_starts_at = ''16:00'', work_ends_at = ''16:00''', v_a),
    'tenant_settings_working_hours_check', 'the end after the start (not equal)');
  perform tests.assert_check_constraint(format(v_set, 'work_starts_at = ''17:00''', v_a),
    'tenant_settings_working_hours_check', 'the end after the start');
  perform tests.assert_check_constraint(format(v_set, 'work_starts_at = ''08:00:30''', v_a),
    'tenant_settings_working_hours_check', 'whole minutes');
  perform tests.assert_fails(format(v_set, 'tenant_id = ''b0000000-0000-4000-8000-000000000001''', v_a),
    array['42501', '23505'], 'the organization of its settings cannot change');
  perform tests.assert_fails($q$insert into platform.tenant_settings (tenant_id) values ('a0000000-0000-4000-8000-000000000001')$q$,
    array['23505'], 'one row per organization');
  -- updated_by comes from the claims only (the trigger): a value the writer sends is overwritten (none here).
  update platform.tenant_settings set updated_by = 'a1000000-0000-4000-8000-0000000000ab' where tenant_id = v_a;
  perform tests.assert((select updated_by is null from platform.tenant_settings where tenant_id = v_a),
    'updated_by is stamped from the claims, never taken from the writer');
end $$;
rollback;

-- Stamps and the working week: sorted, no duplicates; a time zone with an offset name the database knows.
begin;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_before timestamptz;
begin
  select updated_at into v_before from platform.tenant_settings where tenant_id = v_a;
  update platform.tenant_settings
  set working_days = '{4,0,2,0}', timezone = 'America/Argentina/Buenos_Aires', created_at = now() - interval '1 year',
      version = 40
  where tenant_id = v_a;
  perform tests.assert((select working_days = '{0,2,4}' and version = 2 and created_at > now() - interval '1 hour'
                               and updated_at >= v_before
                        from platform.tenant_settings where tenant_id = v_a),
    'the week sorted without duplicates; version, created_at and updated_at stamped by the trigger');
end $$;
rollback;

-- An HR Manager whose session passed a code from a confirmed app (real AAL2) still changes nothing: only
-- the Organization Admin manages the organization (T-M2-22). The owner gives uAB an app for this block.
begin;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret) values
  ('20000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000ab', 'app', 'totp', 'verified', 'NOT-A-REAL-SECRET');
insert into private.mfa_factor_confirmations (factor_id, user_id, session_id, confirmed_at) values
  ('20000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', now());
update auth.sessions set aal = 'aal2', factor_id = '20000000-0000-4000-8000-0000000000f2'
where id = '10000000-0000-4000-8000-0000000000ab';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab')
                        || tests.fresh_code());
do $$
begin
  perform tests.assert(private.request_aal2() and private.request_code_fresh(), 'the HR Manager is at AAL2 with a fresh code');
  perform tests.assert(not private.actor_may_manage_tenant('a0000000-0000-4000-8000-000000000001'),
    'an HR Manager at AAL2 may not manage the organization');
  perform tests.assert_eq(tests.rows_affected('update platform.tenant_settings set date_display = ''hijri'''), 0::bigint,
    'an HR Manager at AAL2 cannot change the settings');
  perform tests.assert_eq(tests.rows_affected('update platform.tenants set name_en = ''HR'''), 0::bigint,
    'an HR Manager at AAL2 cannot rename the organization');
end $$;
rollback;

-- Bulk import × default language (20261017090300): with the organization's default language English, a
-- new person without a language in the file gets English (person and invitation); one with a language
-- keeps it; a person invited again without one keeps their own language.
create or replace function pg_temp.become_worker(p_tenant uuid) returns void language plpgsql as $$
begin
  set local session authorization app_worker;
  set local role authenticated;
  perform tests.set_claims(tests.system_claims(p_tenant, 'tests.user_imports'));
end $$;
create or replace function pg_temp.become_user(p_user uuid, p_session uuid, p_person uuid) returns void language plpgsql as $$
begin
  set local session authorization app_server;
  set local role authenticated;
  perform tests.set_claims(tests.user_claims(p_user, p_session, 'a0000000-0000-4000-8000-000000000001', p_person));
end $$;
create or replace function pg_temp.stage(p_import uuid, p_row integer, p_data jsonb)
returns void language sql as $$
  insert into platform.user_import_rows (tenant_id, import_id, row_number, cells, data, format_issues, issues)
  values ('a0000000-0000-4000-8000-000000000001', p_import, p_row, p_data, p_data, '[]', '[]');
$$;

begin;
update platform.tenant_settings set default_locale = 'en' where tenant_id = 'a0000000-0000-4000-8000-000000000001';
select tests.import_file('a5000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000ab', 'f0a00000-0000-4000-8000-0000000000f1');
insert into platform.user_imports (id, tenant_id, created_by, created_by_person, file_id, file_name, file_size, status,
                                   sheets, sheet_index, mapping, review_expires_at)
values ('a5000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-0000000000ab', 'a1000000-0000-4000-8000-0000000000ab',
        'f0a00000-0000-4000-8000-0000000000f1', 'staff.csv', 100, 'validating',
        '[{"name": "", "rows": 3, "columns": 4}]', 0,
        '{"0": "email", "1": "first_name_ar", "2": "family_name_ar"}', now() + interval '1 day');
select pg_temp.stage('a5000000-0000-4000-8000-0000000000f1', 2,
  '{"email": "lang.none@imp.test", "first_name_ar": "بلا", "family_name_ar": "لغة"}');
select pg_temp.stage('a5000000-0000-4000-8000-0000000000f1', 3,
  '{"email": "lang.ar@imp.test", "first_name_ar": "عربي", "family_name_ar": "صريح", "language": "ar"}');
select pg_temp.stage('a5000000-0000-4000-8000-0000000000f1', 4,
  '{"email": "noacc@imp.test", "first_name_ar": "بلا", "family_name_ar": "حساب"}');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
select private.user_import_classify('a5000000-0000-4000-8000-0000000000f1');
update platform.user_imports set status = 'review' where id = 'a5000000-0000-4000-8000-0000000000f1';
select pg_temp.become_user('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                           'a1000000-0000-4000-8000-0000000000ab');
update platform.user_imports set status = 'queued',
  options = '{"existing": "upsert", "defaultRole": "learner", "invitations": "hold"}'
where id = 'a5000000-0000-4000-8000-0000000000f1';
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
update platform.user_imports set status = 'checking' where id = 'a5000000-0000-4000-8000-0000000000f1';
select private.user_import_recheck('a5000000-0000-4000-8000-0000000000f1');
update platform.user_imports set status = 'importing' where id = 'a5000000-0000-4000-8000-0000000000f1';
select private.user_import_apply_batch('a5000000-0000-4000-8000-0000000000f1', 50);
reset role;
reset session authorization;
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000f1';
begin
  perform tests.assert_eq((select string_agg(r.row_number || ':' || r.result || ':' || p.preferred_locale || ':' || v.locale,
                                             ',' order by r.row_number)
                           from platform.user_import_rows r
                           join platform.persons p on p.id = r.person_id
                           join platform.invitations v on v.id = r.invitation_id
                           where r.import_id = i),
    '2:added:en:en,3:added:ar:ar,4:added:ar:ar',
    'no language in the file: the organization''s (English); given: kept; invited again: the person''s own');
end $$;
rollback;
\echo '90_tenant_settings_owner: ok'
