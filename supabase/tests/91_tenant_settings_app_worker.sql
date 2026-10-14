-- db-test: run-as=app_worker
-- Background jobs and the organization's settings (T-M2-22): a job of an organization reads that
-- organization's settings only (default language of new people, time zone of its e-mails) and changes
-- neither them nor the organization's names. Runs CONNECTED AS app_worker.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  perform tests.set_claims(tests.system_claims(v_a));
  perform tests.assert_eq((select string_agg(tenant_id::text, ',') from platform.tenant_settings), v_a::text,
    'a job of A reads A''s settings only');
  perform tests.assert_eq(tests.rows_affected('update platform.tenant_settings set default_locale = ''en'''), 0::bigint,
    'a job cannot change the settings');
  perform tests.assert_eq(tests.rows_affected('update platform.tenants set name_en = ''Job'''), 0::bigint,
    'a job cannot rename the organization');
  perform tests.assert(not private.actor_may_manage_tenant(v_a), 'a job never manages the organization');
  perform tests.assert_privilege_denied($q$insert into platform.tenant_settings (tenant_id) values ('a0000000-0000-4000-8000-000000000001')$q$,
    'a job creates no settings');
  perform tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001'));
  perform tests.assert_eq((select string_agg(tenant_id::text, ',') from platform.tenant_settings),
    'b0000000-0000-4000-8000-000000000001', 'a job of B reads B''s settings only');
  perform tests.set_claims(null);
  perform tests.assert_eq((select count(*) from platform.tenant_settings), 0::bigint, 'no claims: nothing');
end $$;
rollback;
