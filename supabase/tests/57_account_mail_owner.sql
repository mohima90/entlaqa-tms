-- db-test: run-as=owner
-- Account e-mail queue as stored (T-M2-17): what the request path committed in
-- 55_account_mail_app_server.sql (lower-cased addresses, repeats dropped, the profile change's
-- organization, no notice without claims unless we sent the account a reset e-mail recently) and the shape
-- rules; then the set-up for the retention rules and the DB-side cap (58–61).
\set ON_ERROR_STOP on

begin;
do $$
begin
  perform tests.assert_eq(
    (select string_agg(concat_ws('|', kind, coalesce(email, ''), coalesce(user_id::text, ''), coalesce(tenant_id::text, ''), attempts::text),
                       ',' order by created_at)
     from private.account_mail_requests),
    'password_reset|reset1@a.test|||0,password_reset|multi@ab.test|||0,password_reset|oldest@bd.test|||0,'
    'password_reset|banned@a.test|||0,password_reset|soon@a.test|||0,password_reset|invited@a.test|||0,'
    'password_reset|uc@c.test|||0,password_reset|nobody@nowhere.test|||0,'
    'password_changed||e7000000-0000-4000-8000-000000000002|a0000000-0000-4000-8000-000000000001|0,'
    'password_changed||e7000000-0000-4000-8000-000000000003||0',
    'requests as queued: one per address/account, lower-cased, the profile change with its organization; '
    'no notice without claims for an account without our reset e-mail in the last 65 minutes (uR1, uR6) '
    'or whose reset link was not used (uR7)');
  perform tests.assert_check_constraint(
    $q$insert into private.account_mail_requests (kind, email, user_id) values ('password_reset', 'x@a.test', 'e7000000-0000-4000-8000-000000000001')$q$,
    'account_mail_requests_shape_check', 'a reset request carries the address only');
  perform tests.assert_check_constraint(
    $q$insert into private.account_mail_requests (kind, email) values ('password_reset', 'X@A.test')$q$,
    'account_mail_requests_email_check', 'addresses are stored lower-case');
  perform tests.assert_check_constraint(
    $q$insert into private.account_mail_requests (kind, user_id) values ('magic_link', 'e7000000-0000-4000-8000-000000000001')$q$,
    'account_mail_requests_kind_check', 'two kinds only');
end $$;
rollback;

-- Set-up for the limits (58 as app_server, checked in 59; 60 as app_worker, checked in 61): one request
-- older than the link's lifetime, one whose 5 attempts are used up, and the queue filled to ONE MORE than
-- its cap of 10,000 — the request path first removes the old request (retention without a worker), and
-- the queue is then exactly full.
begin;
update private.account_mail_requests set created_at = now() - interval '61 minutes' where email = 'reset1@a.test';
update private.account_mail_requests set attempts = 5 where email = 'multi@ab.test';
insert into private.account_mail_requests (kind, email, created_at)
  select 'password_reset', format('flood-%s@cap.test', g), now() + interval '1 second'
  from generate_series(1, 10001 - (select count(*) from private.account_mail_requests)) g;
commit;

\echo '57_account_mail_owner: ok'
