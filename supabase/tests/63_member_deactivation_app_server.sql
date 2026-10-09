-- db-test: run-as=app_server
-- Deactivate / reactivate on the request path (FR-IAM-05, T-M2-09), CONNECTED AS app_server as the web app
-- is: who may deactivate whom (Organization Admin; HR Manager for members without a privileged role; never
-- oneself; never the last Organization Admin without an end date), what a deactivation ends at once (the
-- member's access to THIS organization, through the database: claims refused, organization chooser,
-- session contexts), what it keeps (records, roles, other organizations), the checked reactivation
-- function, and the authenticator code (AAL2) both directions need for a member who holds a privileged role
-- (in force or future-dated; review M4, D-IAM-01). Fixtures and the helpers tests.t09_as / tests.t09_deactivate
-- / tests.t09_holds_lock: 62_member_deactivation_owner.sql. Every block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- ---------------------------------------------------------------------------------------------------
-- The Organization Admin deactivates uX: A ends at once, B stays; records and roles are kept
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.t09_as('x_in_a');
do $$ begin perform tests.assert((select count(*) from platform.persons) > 0, 'before: uX works in A'); end $$;
select tests.t09_as('admin');
do $$
begin
  perform private.lock_person_employment(private.current_tenant_id());
  perform private.lock_tenant_roles(private.current_tenant_id());
  perform tests.assert_eq(tests.t09_deactivate('9d100000-0000-4000-8000-0000000000a1'), 1::bigint, 'uX deactivated');
  perform tests.assert((select status = 'inactive' and deactivated_at is not null from platform.persons
                        where id = '9d100000-0000-4000-8000-0000000000a1'),
    'the person record is kept, marked inactive with the time');
  perform tests.assert_eq((select count(*) from platform.role_assignments ra
                           join platform.tenant_memberships m on m.id = ra.membership_id
                           where m.person_id = '9d100000-0000-4000-8000-0000000000a1'), 1::bigint,
    'the roles are kept');
  perform tests.assert_eq((select count(*) from platform.person_employment
                           where person_id = '9d100000-0000-4000-8000-0000000000a1'), 1::bigint,
    'the placement is kept');
  perform tests.assert_privilege_denied($q$delete from platform.session_context$q$,
    'request-path code cannot remove session contexts itself (the trigger does)');
end $$;
-- uX's own session in A: the database refuses the claims at the next statement.
select tests.t09_as('x_in_a');
do $$
begin
  perform tests.assert(private.current_tenant_id() is null, 'uX''s claims for A are refused at once');
  perform tests.assert_eq((select count(*) from platform.persons), 0::bigint, 'uX sees nothing of A any more');
  perform tests.assert(not private.switch_active_tenant('a0000000-0000-4000-8000-000000000001'),
    'and cannot select A again');
end $$;
-- uX in B: untouched (T-IAM-40).
select tests.t09_as('x_in_b');
do $$
begin
  perform tests.assert_eq(private.current_tenant_id(), 'b0000000-0000-4000-8000-000000000001'::uuid,
    'uX still works in B');
  perform tests.assert((select count(*) from platform.persons) > 0, 'and sees B''s people');
end $$;
-- The organization chooser right after a new sign-in (no organization selected): B only.
select tests.t09_as('x_signing_in');
do $$
begin
  perform tests.assert_eq((select array_agg(tenant_id) from private.session_tenants()),
    array['b0000000-0000-4000-8000-000000000001']::uuid[], 'the chooser lists B only');
end $$;
reset role;
rollback;

-- Reactivation of uX by the Organization Admin: the person first (person write guard), then the membership
-- through the checked function; the ended sessions stay out until the member selects the organization.
begin;
set local role authenticated;
select tests.t09_as('admin');
select tests.t09_deactivate('9d100000-0000-4000-8000-0000000000a1');
do $$
begin
  perform tests.assert_fails($q$update platform.tenant_memberships set status = 'active' where person_id = '9d100000-0000-4000-8000-0000000000a1'$q$,
    array['42501'], 'request-path code cannot reactivate a membership directly (T-IAM-21)');
  perform tests.assert_fails($q$select private.reactivate_membership('9d100000-0000-4000-8000-0000000000a1')$q$,
    array['JM004'], 'the membership comes back only with an active person');
  update platform.persons set status = 'active' where id = '9d100000-0000-4000-8000-0000000000a1';
  perform tests.assert_eq(private.reactivate_membership('9d100000-0000-4000-8000-0000000000a1'),
    (select id from platform.tenant_memberships where person_id = '9d100000-0000-4000-8000-0000000000a1'),
    'reactivated: returns the membership');
  perform tests.assert_eq((select status from platform.tenant_memberships where person_id = '9d100000-0000-4000-8000-0000000000a1'),
    'active', 'the membership is active again');
  perform tests.assert_eq((select count(*) from platform.role_assignments ra
                           join platform.tenant_memberships m on m.id = ra.membership_id
                           where m.person_id = '9d100000-0000-4000-8000-0000000000a1'), 1::bigint,
    'with the same roles');
  perform tests.assert_fails($q$select private.reactivate_membership('9d100000-0000-4000-8000-0000000000a1')$q$,
    array['JM002'], 'an active membership is not reactivated twice');
  perform tests.assert_fails($q$select private.reactivate_membership('9d100000-0000-4000-8000-0000000000a2')$q$,
    array['JM002'], 'a member who was never deactivated: JM002');
end $$;
select tests.t09_as('x_in_a');
do $$
begin
  perform tests.assert(private.current_tenant_id() is null, 'the ended session stays out after the reactivation');
  perform tests.assert(private.switch_active_tenant('a0000000-0000-4000-8000-000000000001'),
    'the member selects the organization again');
  perform tests.assert_eq(private.current_tenant_id(), 'a0000000-0000-4000-8000-000000000001'::uuid,
    'and works in A again');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Who may deactivate whom
-- ---------------------------------------------------------------------------------------------------
-- HR Manager: members without a privileged role yes; a privileged member (Compliance Officer) no; oneself no.
begin;
set local role authenticated;
select tests.t09_as('hr');
do $$
begin
  perform tests.assert_fails($q$select tests.t09_deactivate('9d100000-0000-4000-8000-0000000000a4')$q$,
    array['42501'], 'HR Manager: not a member who holds a privileged role');
  perform tests.assert_fails($q$update platform.tenant_memberships set status = 'suspended' where person_id = '9d100000-0000-4000-8000-0000000000a4'$q$,
    array['42501'], 'HR Manager: not the privileged member''s membership either');
  perform tests.assert_fails($q$update platform.tenant_memberships set status = 'suspended' where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$,
    array['42501'], 'nobody deactivates themselves');
  perform tests.assert_eq(tests.t09_deactivate('9d100000-0000-4000-8000-0000000000a1'), 1::bigint,
    'HR Manager: an ordinary member yes');
end $$;
reset role;
rollback;

-- A learner, and the deactivated member's own stale claims: nothing.
begin;
set local role authenticated;
select tests.t09_as('learner');
do $$
begin
  perform tests.assert_fails($q$select tests.t09_deactivate('9d100000-0000-4000-8000-0000000000a1')$q$,
    array['42501'], 'a learner cannot deactivate anyone');
  perform tests.assert_fails($q$select private.reactivate_membership('9d100000-0000-4000-8000-0000000000a5')$q$,
    array['42501'], 'a learner cannot reactivate anyone');
end $$;
select tests.t09_as('deactivated');
do $$
begin
  perform tests.assert(private.current_tenant_id() is null, 'a deactivated member''s claims are refused');
  perform tests.assert_eq((select count(*) from private.session_tenants()), 0::bigint,
    'and their organization chooser is empty');
  perform tests.assert_fails($q$select private.reactivate_membership('9d100000-0000-4000-8000-0000000000a5')$q$,
    array['42501'], 'a deactivated member cannot reactivate themselves');
end $$;
reset role;
rollback;

-- The last Organization Admin without an end date: uA2's admin role ends in 30 days, so uA (no end date)
-- cannot be deactivated by uA2 — the organization would be left without a lasting administrator (T-IAM-38).
begin;
set local role authenticated;
select tests.t09_as('admin2', 'aal2');
do $$
begin
  perform tests.assert_fails($q$select tests.t09_deactivate('a1000000-0000-4000-8000-0000000000a1')$q$,
    array['23514'], 'the last Organization Admin without an end date stays');
end $$;
reset role;
rollback;
-- uA2 itself can be deactivated by uA (an Organization Admin without an end date remains).
begin;
set local role authenticated;
select tests.t09_as('admin', 'aal2');
do $$
begin
  perform tests.assert_eq(tests.t09_deactivate('9d100000-0000-4000-8000-0000000000a7'), 1::bigint,
    'another Organization Admin can be deactivated while one without an end date remains');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- A member who holds a privileged role is deactivated only with an authenticator code (review M4)
-- ---------------------------------------------------------------------------------------------------
-- uP (Compliance Officer, in force) and uF (Auditor from in 10 days) are privileged; uE's Auditor role
-- ended yesterday (not privileged any more). The same test as the reactivation.
begin;
set local role authenticated;
select tests.t09_as('admin');
do $$
begin
  perform tests.assert_fails($q$update platform.tenant_memberships set status = 'suspended' where person_id = '9d100000-0000-4000-8000-0000000000a4'$q$,
    array['JM003'], 'Organization Admin at AAL1: a privileged member needs an authenticator code');
  perform tests.assert_fails($q$update platform.tenant_memberships set status = 'suspended' where person_id = '9d100000-0000-4000-8000-0000000000aa'$q$,
    array['JM003'], 'a future-dated privileged role counts');
  perform tests.assert_eq(tests.t09_deactivate('9d100000-0000-4000-8000-0000000000a9'), 1::bigint,
    'an ended privileged role does not: deactivated at AAL1');
  perform tests.assert_eq(tests.t09_deactivate('9d100000-0000-4000-8000-0000000000a2'), 1::bigint,
    'an ordinary member at AAL1');
end $$;
select tests.t09_as('admin', 'aal2');
do $$
begin
  perform tests.assert_eq(tests.t09_deactivate('9d100000-0000-4000-8000-0000000000a4'), 1::bigint,
    'Organization Admin at AAL2: the privileged member is deactivated');
  perform tests.assert_eq(tests.t09_deactivate('9d100000-0000-4000-8000-0000000000aa'), 1::bigint,
    'and the member with a future-dated privileged role');
end $$;
reset role;
rollback;
-- Revoking (not only suspending) an active privileged membership is the same rule; an HR Manager is
-- refused before it (only an Organization Admin changes a privileged member), also at AAL2.
begin;
set local role authenticated;
select tests.t09_as('admin');
do $$
begin
  perform tests.assert_fails($q$update platform.tenant_memberships set status = 'revoked' where person_id = '9d100000-0000-4000-8000-0000000000a4'$q$,
    array['JM003'], 'leaving active by revocation: also refused at AAL1');
end $$;
select tests.t09_as('hr', 'aal2');
do $$
begin
  perform tests.assert_fails($q$update platform.tenant_memberships set status = 'suspended' where person_id = '9d100000-0000-4000-8000-0000000000a4'$q$,
    array['42501'], 'HR Manager at AAL2: still not a privileged member');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The organization switch holds the membership's lock (shared) until it commits (review L3)
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.t09_as('x_signing_in');
do $$
begin
  perform tests.assert(private.switch_active_tenant('a0000000-0000-4000-8000-000000000001'), 'uX selects A');
  perform tests.assert(tests.t09_holds_lock('platform.membership:a0000000-0000-4000-8000-000000000001:9d000000-0000-4000-8000-000000000001', 'ShareLock'),
    'the switch holds the membership''s lock shared (a deactivation waits for it, then ends the new session too)');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Tenant isolation, and the sign-in rule out of reach
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.t09_as('admin');
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_memberships set status = 'suspended' where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'A''s admin cannot deactivate members of B');
  perform tests.assert_eq(tests.rows_affected($q$update platform.persons set status = 'inactive' where id = '9d100000-0000-4000-8000-0000000000b1'$q$),
    0::bigint, 'nor B''s person records');
  perform tests.assert_fails($q$select private.reactivate_membership('9d100000-0000-4000-8000-0000000000b1')$q$,
    array['JM001'], 'the reactivation function finds only the caller''s organization');
  perform tests.assert_fails($q$select private.reactivate_membership('b1000000-0000-4000-8000-0000000000b9')$q$,
    array['JM001'], 'a person of B without login: not found either');
  perform tests.assert_fails($q$select private.reactivate_membership('a1000000-0000-4000-8000-0000000000e1')$q$,
    array['JM001'], 'a person of A without membership: JM001');
  perform tests.assert_fails($q$select private.reactivate_membership(null)$q$, array['42501'], 'no person: refused');
  perform tests.assert_privilege_denied($q$select * from private.auth_account_email$q$,
    'the web app cannot read the Auth accounts'' e-mail view');
  perform tests.assert_fails($q$select private.account_sign_in_refused('9d000000-0000-4000-8000-000000000001')$q$,
    array['42501'], 'nor ask the sign-in rule about any account (Auth only)');
  perform tests.assert_fails($q$select private.custom_access_token_hook('{}'::jsonb)$q$,
    array['42501'], 'nor run the access-token hook');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Reactivation rules
-- ---------------------------------------------------------------------------------------------------
-- An ordinary deactivated member: HR Manager or Organization Admin, at AAL1.
begin;
set local role authenticated;
select tests.t09_as('hr');
do $$
begin
  update platform.persons set status = 'active' where id = '9d100000-0000-4000-8000-0000000000a5';
  perform tests.assert(private.reactivate_membership('9d100000-0000-4000-8000-0000000000a5') is not null,
    'HR Manager reactivates an ordinary member');
end $$;
reset role;
rollback;

-- A privileged deactivated member (Auditor): not HR; the Organization Admin only with an authenticator
-- code (AAL2, PO decision D-IAM-01: it gives privileged roles back).
begin;
set local role authenticated;
select tests.t09_as('hr');
do $$
begin
  perform tests.assert_fails($q$update platform.persons set status = 'active' where id = '9d100000-0000-4000-8000-0000000000a6'$q$,
    array['42501'], 'HR Manager: not the privileged member''s record');
  perform tests.assert_fails($q$select private.reactivate_membership('9d100000-0000-4000-8000-0000000000a6')$q$,
    array['42501'], 'HR Manager: nor the privileged member''s membership');
end $$;
select tests.t09_as('admin');
do $$
begin
  update platform.persons set status = 'active' where id = '9d100000-0000-4000-8000-0000000000a6';
  perform tests.assert_fails($q$select private.reactivate_membership('9d100000-0000-4000-8000-0000000000a6')$q$,
    array['JM003'], 'Organization Admin at AAL1: an authenticator code is needed');
end $$;
select tests.t09_as('admin', 'aal2');
do $$
begin
  perform tests.assert(private.reactivate_membership('9d100000-0000-4000-8000-0000000000a6') is not null,
    'Organization Admin at AAL2: reactivated');
end $$;
reset role;
rollback;

-- A person placed in a since-deleted department comes back only after being moved (T-M2-02 rule): DY
-- (only uS, inactive, placed there) can be deleted; then uS cannot be made active.
begin;
set local role authenticated;
select tests.t09_as('admin');
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set deleted_at = now() where id = '9d300000-0000-4000-8000-000000000002'$q$),
    1::bigint, 'a department with only inactive people can be deleted');
  perform tests.assert_fails($q$update platform.persons set status = 'active' where id = '9d100000-0000-4000-8000-0000000000a5'$q$,
    array['23514'], 'a person placed in a deleted department is not made active');
end $$;
reset role;
rollback;

-- Wrong callers: system claims under app_server, no claims.
begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_fails($q$select private.reactivate_membership('9d100000-0000-4000-8000-0000000000a5')$q$,
    array['42501'], 'system claims: refused');
end $$;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_fails($q$select private.reactivate_membership('9d100000-0000-4000-8000-0000000000a5')$q$,
    array['42501'], 'no claims: refused');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Moving responsibilities first, then deactivating (the order the application uses)
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.t09_as('admin');
do $$
begin
  perform private.lock_person_employment(private.current_tenant_id());
  perform private.lock_tenant_roles(private.current_tenant_id());
  update platform.departments set head_person_id = '9d100000-0000-4000-8000-0000000000a2'
  where id = '9d300000-0000-4000-8000-000000000001';
  update platform.person_employment set manager_person_id = '9d100000-0000-4000-8000-0000000000a2'
  where manager_person_id = '9d100000-0000-4000-8000-0000000000a1'
    and person_id <> '9d100000-0000-4000-8000-0000000000a2';
  update platform.person_employment set manager_person_id = null
  where person_id = '9d100000-0000-4000-8000-0000000000a2';
  perform tests.assert_eq(tests.t09_deactivate('9d100000-0000-4000-8000-0000000000a1'), 1::bigint,
    'responsibilities moved, then deactivated');
  perform tests.assert_fails($q$update platform.departments set head_person_id = '9d100000-0000-4000-8000-0000000000a1' where id = '9d300000-0000-4000-8000-000000000001'$q$,
    array['23514'], 'a deactivated person cannot be made head again');
  perform tests.assert_fails($q$update platform.person_employment set manager_person_id = '9d100000-0000-4000-8000-0000000000a1' where person_id = '9d100000-0000-4000-8000-0000000000a3'$q$,
    array['23514'], 'nor direct manager');
end $$;
reset role;
rollback;
-- HR Manager: moving a privileged member (pP, Compliance Officer) to another manager is refused, so an HR
-- Manager cannot deactivate uX while pP reports to uX (the application says so before trying).
begin;
set local role authenticated;
select tests.t09_as('hr');
do $$
begin
  perform tests.assert_fails($q$update platform.person_employment set manager_person_id = '9d100000-0000-4000-8000-0000000000a2' where person_id = '9d100000-0000-4000-8000-0000000000a4'$q$,
    array['42501'], 'HR Manager: a privileged member''s placement is not theirs to change');
end $$;
reset role;
rollback;

\echo '63_member_deactivation_app_server: ok'
