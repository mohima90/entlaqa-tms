-- db-test: run-as=owner
-- Fixtures for the account e-mail queue (T-M2-17, FR-NTF-02 / FR-IAM-13): accounts whose reset or
-- "password changed" e-mail goes to one organization, several, none, or nowhere at all. Committed (the
-- request path 55 and the worker 56 run as other login roles); 57 empties the queue again.
--   uR1  reset1@a.test   active in A only (Arabic)                                → A, ar
--   uR2  multi@ab.test   active in A (older) and B (newer); its most recent sign-in session selected B,
--                        an older one A; English in B                              → B, en (session A for
--                        a My profile change made in A → A, ar)
--   uR3  oldest@bd.test  active in B (older) and D (newer), never signed in       → B (oldest), ar
--   uR4  banned@a.test   active in A, banned in Auth                              → nothing (banned)
--   uR5  soon@a.test     active in A, a reset link issued seconds ago             → nothing on a first try
--   uR6  invited@a.test  only an invited membership in A                          → nothing (no membership)
--   uC (uc@c.test, 00_helpers): active in suspended tenant C only                 → nothing (no membership)
\set ON_ERROR_STOP on

insert into auth.users (id, email, banned_until, recovery_sent_at) values
  ('e7000000-0000-4000-8000-000000000001', 'reset1@a.test', null, null),
  ('e7000000-0000-4000-8000-000000000002', 'multi@ab.test', null, null),
  ('e7000000-0000-4000-8000-000000000003', 'oldest@bd.test', null, null),
  ('e7000000-0000-4000-8000-000000000004', 'banned@a.test', now() + interval '1 day', null),
  ('e7000000-0000-4000-8000-000000000005', 'soon@a.test', null, now()),
  ('e7000000-0000-4000-8000-000000000006', 'invited@a.test', null, null);

insert into platform.persons (id, tenant_id, display_name_ar, email, preferred_locale) values
  ('e7100000-0000-4000-8000-0000000001a1', 'a0000000-0000-4000-8000-000000000001', 'مستخدم إعادة', 'reset1@a.test', 'ar'),
  ('e7100000-0000-4000-8000-0000000002a1', 'a0000000-0000-4000-8000-000000000001', 'متعدد أ', 'multi@ab.test', 'ar'),
  ('e7100000-0000-4000-8000-0000000002b1', 'b0000000-0000-4000-8000-000000000001', 'متعدد ب', 'multi@ab.test', 'en'),
  ('e7100000-0000-4000-8000-0000000003b1', 'b0000000-0000-4000-8000-000000000001', 'أقدم ب', 'oldest@bd.test', 'ar'),
  ('e7100000-0000-4000-8000-0000000003d1', 'd0000000-0000-4000-8000-000000000001', 'أقدم د', 'oldest@bd.test', 'en'),
  ('e7100000-0000-4000-8000-0000000004a1', 'a0000000-0000-4000-8000-000000000001', 'محظور', 'banned@a.test', 'ar'),
  ('e7100000-0000-4000-8000-0000000005a1', 'a0000000-0000-4000-8000-000000000001', 'قريب', 'soon@a.test', 'ar'),
  ('e7100000-0000-4000-8000-0000000006a1', 'a0000000-0000-4000-8000-000000000001', 'مدعو فقط', 'invited@a.test', 'ar');

insert into platform.tenant_memberships (tenant_id, user_id, person_id, status, created_at) values
  ('a0000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-0000000001a1', 'active', now() - interval '5 days'),
  ('a0000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002', 'e7100000-0000-4000-8000-0000000002a1', 'active', now() - interval '2 days'),
  ('b0000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002', 'e7100000-0000-4000-8000-0000000002b1', 'active', now() - interval '1 day'),
  ('b0000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000003', 'e7100000-0000-4000-8000-0000000003b1', 'active', now() - interval '2 days'),
  ('d0000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000003', 'e7100000-0000-4000-8000-0000000003d1', 'active', now() - interval '1 day'),
  ('a0000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000004', 'e7100000-0000-4000-8000-0000000004a1', 'active', now() - interval '1 day'),
  ('a0000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000005', 'e7100000-0000-4000-8000-0000000005a1', 'active', now() - interval '1 day'),
  ('a0000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000006', 'e7100000-0000-4000-8000-0000000006a1', 'invited', now() - interval '1 day');

-- uR2's sign-in sessions: an older one in A, the most recent in B.
insert into auth.sessions (id, user_id, not_after) values
  ('e7200000-0000-4000-8000-0000000002a1', 'e7000000-0000-4000-8000-000000000002', null),
  ('e7200000-0000-4000-8000-0000000002b1', 'e7000000-0000-4000-8000-000000000002', null);
insert into platform.session_context (session_id, user_id, active_tenant_id, updated_at) values
  ('e7200000-0000-4000-8000-0000000002a1', 'e7000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', now() - interval '3 hours'),
  ('e7200000-0000-4000-8000-0000000002b1', 'e7000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', now() - interval '1 hour');

\echo '42_account_mail_fixtures: ok'
