-- db-test: run-as=owner
-- Invitation fixtures (T-M2-07, FR-IAM-03) for 36_invitations_app_server.sql, 37_invitations_app_worker.sql
-- and 38_invitations_owner.sql, committed as platform operations (they follow the lifecycle trigger).
-- Tokens are hashed with tests.token_hash() like hashInvitationToken() in packages/platform-db.
--   tenant A  a4…02 expired ('tok-expired')   a4…03 revoked ('tok-revoked')
--             a4…04 hr_manager + learner, mentor for fresh@a.test ('tok-fresh'); account uFresh signed up
--                   after the e-mail (session sFresh)
--             a4…05 stale@a.test ('tok-stale'); account uStale created a day BEFORE the e-mail (session sStale)
--             a4…06 not mailed yet (no token)
--             a4…07 member2@a.test ('tok-member'); account uM is already a member of A (other person)
--             a4…08 the person's e-mail changed after the e-mail ('tok-changed')
--             a4…09 learner, invited by the HR Manager uAB ('tok-by-hr'); account uByHr signed up after it
--             a4…0a auditor (privileged), invited by uAB when an Organization Admin ('tok-priv-by-hr');
--                   account uPrivByHr signed up after it — uAB is only an HR Manager now (review M1)
--   Sessions s<account> = 10…<account suffix> (accept_invitation_as_caller needs a valid one).
--   tenant B  b4…02 for ua@a.test ('tok-caller'): uA (member of A only) accepts after signing in
--   tenant C  c4…01 suspended organization ('tok-c')
\set ON_ERROR_STOP on

insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-0000000000f5', 'stale@a.test', now() - interval '1 day'),        -- uStale
  ('00000000-0000-4000-8000-0000000000f7', 'member2@a.test', now() - interval '1 day');      -- uM
insert into auth.sessions (id, user_id, not_after) values
  ('10000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000f5', null),    -- sStale
  ('10000000-0000-4000-8000-0000000000f7', '00000000-0000-4000-8000-0000000000f7', null);    -- sM

insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email) values
  ('a1000000-0000-4000-8000-0000000000e2', 'a0000000-0000-4000-8000-000000000001', 'منتهية', null, 'exp@a.test'),
  ('a1000000-0000-4000-8000-0000000000e3', 'a0000000-0000-4000-8000-000000000001', 'ملغاة', null, 'rev@a.test'),
  ('a1000000-0000-4000-8000-0000000000e4', 'a0000000-0000-4000-8000-000000000001', 'سارة', 'Sara', 'fresh@a.test'),
  ('a1000000-0000-4000-8000-0000000000e5', 'a0000000-0000-4000-8000-000000000001', 'قديم', null, 'stale@a.test'),
  ('a1000000-0000-4000-8000-0000000000e6', 'a0000000-0000-4000-8000-000000000001', 'بلا رابط', null, 'notoken@a.test'),
  ('a1000000-0000-4000-8000-0000000000e7', 'a0000000-0000-4000-8000-000000000001', 'عضو', null, 'm-old@a.test'),
  ('a1000000-0000-4000-8000-0000000000e8', 'a0000000-0000-4000-8000-000000000001', 'عضو ثان', null, 'member2@a.test'),
  ('a1000000-0000-4000-8000-0000000000e9', 'a0000000-0000-4000-8000-000000000001', 'تغير بريده', null, 'chg@a.test'),
  ('a1000000-0000-4000-8000-0000000000ea', 'a0000000-0000-4000-8000-000000000001', 'دعاه الموارد', null, 'byhr@a.test'),
  ('a1000000-0000-4000-8000-0000000000eb', 'a0000000-0000-4000-8000-000000000001', 'مدقق مدعو', null, 'privbyhr@a.test'),
  ('b1000000-0000-4000-8000-0000000000e2', 'b0000000-0000-4000-8000-000000000001', 'مستخدم أ في ب', null, 'ua@a.test'),
  ('c1000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-000000000001', 'مدعو ج', null, 'inv@c.test');

insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000f7', 'a1000000-0000-4000-8000-0000000000e7', 'active');

insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, additional_roles, invited_by) values
  ('a4000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000e2', 'exp@a.test', 'ar', 'learner', '{}', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000e3', 'rev@a.test', 'ar', 'learner', '{}', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000e4', 'fresh@a.test', 'en', 'hr_manager', '{learner,mentor}', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000e5', 'stale@a.test', 'ar', 'learner', '{}', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000e6', 'notoken@a.test', 'ar', 'learner', '{}', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000e8', 'member2@a.test', 'ar', 'learner', '{}', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000e9', 'chg@a.test', 'ar', 'learner', '{}', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ea', 'byhr@a.test', 'ar', 'learner', '{}', '00000000-0000-4000-8000-0000000000ab'),
  ('a4000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000eb', 'privbyhr@a.test', 'ar', 'auditor', '{}', '00000000-0000-4000-8000-0000000000ab'),
  ('b4000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000e2', 'ua@a.test', 'ar', 'learner', '{}', '00000000-0000-4000-8000-0000000000b1'),
  ('c4000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e1', 'inv@c.test', 'ar', 'learner', '{}', '00000000-0000-4000-8000-0000000000c1');

update platform.invitations i set token_hash = tests.token_hash(t.token)
from (values ('a4000000-0000-4000-8000-000000000002'::uuid, 'tok-expired'),
             ('a4000000-0000-4000-8000-000000000003', 'tok-revoked'),
             ('a4000000-0000-4000-8000-000000000004', 'tok-fresh'),
             ('a4000000-0000-4000-8000-000000000005', 'tok-stale'),
             ('a4000000-0000-4000-8000-000000000007', 'tok-member'),
             ('a4000000-0000-4000-8000-000000000008', 'tok-changed'),
             ('a4000000-0000-4000-8000-000000000009', 'tok-by-hr'),
             ('a4000000-0000-4000-8000-00000000000a', 'tok-priv-by-hr'),
             ('b4000000-0000-4000-8000-000000000002', 'tok-caller'),
             ('c4000000-0000-4000-8000-000000000001', 'tok-c')) as t (id, token)
where i.id = t.id;

-- After the e-mail: the link of a4…02 ran out, a4…03 was revoked, a4…08's person changed e-mail, and
-- uFresh, uByHr and uPrivByHr signed up through their links (the hook-gated sign-up), each with a session.
update platform.invitations set expires_at = now() - interval '1 minute' where id = 'a4000000-0000-4000-8000-000000000002';
update platform.invitations set status = 'revoked' where id = 'a4000000-0000-4000-8000-000000000003';
update platform.persons set email = 'chg2@a.test' where id = 'a1000000-0000-4000-8000-0000000000e9';
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-0000000000f4', 'fresh@a.test', clock_timestamp() + interval '1 second'),  -- uFresh
  ('00000000-0000-4000-8000-0000000000f9', 'byhr@a.test', clock_timestamp() + interval '1 second'),   -- uByHr
  ('00000000-0000-4000-8000-0000000000fa', 'privbyhr@a.test', clock_timestamp() + interval '1 second'); -- uPrivByHr
insert into auth.sessions (id, user_id, not_after) values
  ('10000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000f4', null),    -- sFresh
  ('10000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000000f9', null),    -- sByHr
  ('10000000-0000-4000-8000-0000000000fa', '00000000-0000-4000-8000-0000000000fa', null);    -- sPrivByHr

do $$
begin
  perform tests.assert_eq(
    (select string_agg(id::text || ':' || status || ':' || send_count, ',' order by id) from platform.invitations
     where id in ('a4000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000006')),
    'a4000000-0000-4000-8000-000000000003:revoked:1,a4000000-0000-4000-8000-000000000006:pending:0',
    'fixtures: revoked after one e-mail; not mailed yet');
end $$;

\echo '35_invitations_fixtures: ok'
