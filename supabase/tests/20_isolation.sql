-- db-test: run-as=app_server
-- (b) Cross-tenant isolation and (c) no-claim tests. Runs CONNECTED AS app_server (session_user =
-- app_server), exactly like withUserTx(): `set local role authenticated` + request.jwt.claims.
-- Each block runs in its own transaction and is rolled back.
\set ON_ERROR_STOP on

-- Coverage guard: every tenant-owned table must have explicit insert/FK tests in this file.
-- Every tenant table must be readable by authenticated (the zero-row assertions below would otherwise
-- pass on "permission denied" instead of proving RLS filtering).
-- Adding a table without adding it here (and its tests below) fails the build.
do $$
declare
  v_missing text;
begin
  select string_agg(t.table_name::text, ', ') into v_missing
  from tests.tenant_tables() t
  where t.table_name::text not in (
    'platform.tenants', 'platform.tenant_domains', 'platform.persons',
    'platform.tenant_memberships', 'platform.session_context', 'platform.audit_events',
    'platform.branches', 'platform.departments', 'platform.person_employment', 'platform.role_assignments',
    'platform.invitations', 'platform.security_policies', 'platform.tenant_settings',
    -- Custom roles (EP-ROLES): insert/FK tests below; rules in 97_custom_roles_app_server.sql.
    'platform.custom_roles', 'platform.custom_role_permissions',
    -- Files (T-M2-18): no direct writes at all (file_guard's functions only); cross-tenant, FK and
    -- function tests in 81_files_app_server.sql, 82_files_app_worker.sql and 83_files_storage.sql.
    'platform.files', 'platform.file_download_grants',
    -- User imports (T-M2-12): insert/FK tests below; lifecycle and per-user tests in 86_*, jobs in 87_*.
    'platform.user_imports', 'platform.user_import_columns', 'platform.user_import_rows')
    and t.table_name not in (select table_name from tests.job_only_tables());
  perform tests.assert(v_missing is null, format('isolation tests missing for: %s', v_missing));
  perform tests.assert(session_user = 'app_server', 'this file must run connected as app_server');
  -- (SELECT on the tenant column at least: platform.invitations is readable column by column.)
  select string_agg(t.table_name::text, ', ') into v_missing
  from tests.tenant_tables() t
  where not tests.can_read_tenant_column(t.table_name, t.tenant_column)
    and t.table_name not in (select table_name from tests.job_only_tables());
  perform tests.assert(v_missing is null, format('tenant tables without SELECT for authenticated: %s', v_missing));
end $$;

-- Generic checks for EVERY tenant-owned table, as tenant-A user (uA, session sA):
-- sees only tenant-A rows; UPDATE/DELETE aimed at tenant B either affect 0 rows WITHOUT error (the
-- operation is granted, RLS filters the rows) or fail with "permission denied" (not granted). The two
-- outcomes are asserted separately: a privilege error is never counted as "0 rows".
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001'));
do $$
declare
  r record;
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_b constant uuid := 'b0000000-0000-4000-8000-000000000001';
  v_total bigint;
  v_foreign bigint;
  v_update text;
  v_delete text;
begin
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'valid claims resolve tenant A');
  for r in select * from tests.tenant_tables()
           where table_name not in (select table_name from tests.job_only_tables()) loop
    execute format('select count(*), count(*) filter (where %I <> %L) from %s', r.tenant_column, v_a, r.table_name)
      into v_total, v_foreign;
    perform tests.assert(v_total > 0, format('%s: tenant A must see its own rows', r.table_name));
    perform tests.assert_eq(v_foreign, 0::bigint, format('%s: tenant A must not see other tenants'' rows', r.table_name));

    v_update := format('update %s set %I = %I where %I = %L', r.table_name, r.tenant_column, r.tenant_column, r.tenant_column, v_b);
    if has_column_privilege('authenticated', r.table_name, r.tenant_column, 'UPDATE') then
      perform tests.assert_eq(tests.rows_affected(v_update), 0::bigint,
        format('%s: UPDATE is granted, RLS must filter every tenant B row', r.table_name));
    else
      perform tests.assert_privilege_denied(v_update, format('%s: UPDATE of the tenant column is not granted', r.table_name));
    end if;

    v_delete := format('delete from %s where %I = %L', r.table_name, r.tenant_column, v_b);
    if has_table_privilege('authenticated', r.table_name, 'DELETE') then
      perform tests.assert_eq(tests.rows_affected(v_delete), 0::bigint,
        format('%s: DELETE is granted, RLS must filter every tenant B row', r.table_name));
    else
      perform tests.assert_privilege_denied(v_delete, format('%s: DELETE is not granted', r.table_name));
    end if;
  end loop;
end $$;
rollback;

-- Row-level cross-tenant tests per table (insert with foreign tenant_id, move rows across tenants,
-- composite FK to another tenant's parent).
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  -- platform.tenants: users never create organizations; only the display names are updatable (T-M2-22:
  -- by an Organization Admin, 89_tenant_settings_app_server.sql) and never another organization's.
  perform tests.assert_eq((select count(*) from platform.tenants), 1::bigint, 'tenants: only own tenant visible');
  perform tests.assert_privilege_denied($q$insert into platform.tenants (slug, name_ar) values ('evil', 'x')$q$,
    'tenants: users cannot create tenants');
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenants set name_ar = 'x' where id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'tenants: RLS filters tenant B''s names');
  perform tests.assert_privilege_denied($q$update platform.tenants set slug = 'evil' where id = 'a0000000-0000-4000-8000-000000000001'$q$,
    'tenants: the slug is not updatable');
  perform tests.assert_privilege_denied($q$update platform.tenants set status = 'active'$q$,
    'tenants: the status is not updatable');
  perform tests.assert_privilege_denied($q$update platform.tenants set id = 'b0000000-0000-4000-8000-000000000001'$q$,
    'tenants: the id is not updatable');
  perform tests.assert_privilege_denied($q$delete from platform.tenants$q$, 'tenants: no DELETE grant');

  -- platform.tenant_domains: read-only; cannot claim tenant B's hostname.
  perform tests.assert_privilege_denied($q$insert into platform.tenant_domains (tenant_id, hostname, kind) values ('b0000000-0000-4000-8000-000000000001', 'x.test', 'custom')$q$,
    'tenant_domains: cannot insert for tenant B (no grant)');
  perform tests.assert_privilege_denied($q$insert into platform.tenant_domains (hostname, kind) values ('x.test', 'custom')$q$,
    'tenant_domains: users cannot add domains (no grant)');

  -- platform.persons
  perform tests.assert_rls_violation($q$insert into platform.persons (tenant_id, display_name_ar) values ('b0000000-0000-4000-8000-000000000001', 'دخيل')$q$,
    'persons: insert with tenant B tenant_id is rejected by RLS');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.persons (display_name_ar) values ('جديد')$q$),
    1::bigint, 'persons: insert defaults tenant_id to the current tenant');
  perform tests.assert_eq((select tenant_id from platform.persons where display_name_ar = 'جديد'),
    'a0000000-0000-4000-8000-000000000001'::uuid, 'persons: defaulted tenant is A');
  perform tests.assert_rls_violation($q$update platform.persons set tenant_id = 'b0000000-0000-4000-8000-000000000001' where id = 'a1000000-0000-4000-8000-0000000000a1'$q$,
    'persons: cannot move a row into tenant B');
  perform tests.assert_eq(tests.rows_affected($q$update platform.persons set display_name_ar = 'x' where id = 'b1000000-0000-4000-8000-0000000000b1'$q$),
    0::bigint, 'persons: RLS filters tenant B person by id');
  perform tests.assert_privilege_denied($q$delete from platform.persons where id = 'a1000000-0000-4000-8000-0000000000a1'$q$,
    'persons: no DELETE grant');

  -- platform.tenant_memberships (composite FK to persons)
  perform tests.assert_rls_violation($q$insert into platform.tenant_memberships (tenant_id, user_id, person_id) values ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e1', 'b1000000-0000-4000-8000-0000000000b9')$q$,
    'memberships: insert with tenant B tenant_id is rejected by RLS');
  perform tests.assert_fails($q$insert into platform.tenant_memberships (user_id, person_id) values ('00000000-0000-4000-8000-0000000000e1', 'b1000000-0000-4000-8000-0000000000b9')$q$,
    array['23503'], 'memberships: composite FK rejects a tenant B person');
  perform tests.assert_privilege_denied($q$update platform.tenant_memberships set person_id = 'b1000000-0000-4000-8000-0000000000b9' where user_id = '00000000-0000-4000-8000-0000000000a1'$q$,
    'memberships: person_id is not updatable (column grant: status only)');
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_memberships set status = 'revoked' where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'memberships: RLS filters tenant B memberships');

  -- platform.session_context: only the current session's row is visible; no direct writes (no grants).
  perform tests.assert_eq((select count(*) from platform.session_context), 1::bigint, 'session_context: only own session visible');
  perform tests.assert_privilege_denied($q$insert into platform.session_context (session_id, user_id, active_tenant_id) values ('10000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001')$q$,
    'session_context: no direct INSERT');
  perform tests.assert_privilege_denied($q$update platform.session_context set active_tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$,
    'session_context: no direct UPDATE');

  -- platform.branches ([sd]: no DELETE grant)
  perform tests.assert_rls_violation($q$insert into platform.branches (tenant_id, code, name_ar) values ('b0000000-0000-4000-8000-000000000001', 'X1', 'دخيل')$q$,
    'branches: insert with tenant B tenant_id is rejected by RLS');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.branches (code, name_ar) values ('DMM', 'فرع الدمام')$q$),
    1::bigint, 'branches: insert defaults tenant_id to the current tenant');
  perform tests.assert_rls_violation($q$update platform.branches set tenant_id = 'b0000000-0000-4000-8000-000000000001' where id = 'a2000000-0000-4000-8000-000000000002'$q$,
    'branches: cannot move a row into tenant B');
  perform tests.assert_eq(tests.rows_affected($q$update platform.branches set name_ar = 'x' where id = 'b2000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'branches: RLS filters tenant B branch by id');
  perform tests.assert_fails($q$insert into platform.branches (code, name_ar, parent_branch_id) values ('SUB', 'فرعي', 'b2000000-0000-4000-8000-000000000001')$q$,
    array['23503'], 'branches: composite FK rejects a tenant B parent branch');
  perform tests.assert_privilege_denied($q$delete from platform.branches where id = 'a2000000-0000-4000-8000-000000000002'$q$,
    'branches: no DELETE grant (soft delete only)');

  -- platform.departments ([sd]: no DELETE grant; composite FKs to departments, branches, persons)
  perform tests.assert_rls_violation($q$insert into platform.departments (tenant_id, code, name_ar) values ('b0000000-0000-4000-8000-000000000001', 'X1', 'دخيل')$q$,
    'departments: insert with tenant B tenant_id is rejected by RLS');
  perform tests.assert_rls_violation($q$update platform.departments set tenant_id = 'b0000000-0000-4000-8000-000000000001' where id = 'a3000000-0000-4000-8000-000000000003'$q$,
    'departments: cannot move a row into tenant B');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set name_ar = 'x' where id = 'b3000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'departments: RLS filters tenant B department by id');
  perform tests.assert_fails($q$insert into platform.departments (code, name_ar, parent_id) values ('X2', 'قسم', 'b3000000-0000-4000-8000-000000000001')$q$,
    array['23503'], 'departments: composite FK rejects a tenant B parent department');
  perform tests.assert_fails($q$insert into platform.departments (code, name_ar, branch_id) values ('X3', 'قسم', 'b2000000-0000-4000-8000-000000000001')$q$,
    array['23503'], 'departments: composite FK rejects a tenant B branch');
  perform tests.assert_fails($q$update platform.departments set head_person_id = 'b1000000-0000-4000-8000-0000000000b1' where id = 'a3000000-0000-4000-8000-000000000003'$q$,
    array['23503', '23514'], 'departments: a tenant B person cannot be head (refs trigger, then composite FK)');
  perform tests.assert_privilege_denied($q$delete from platform.departments where id = 'a3000000-0000-4000-8000-000000000003'$q$,
    'departments: no DELETE grant (soft delete only)');

  -- platform.person_employment (composite FKs to persons, branches, departments; no DELETE grant)
  perform tests.assert_rls_violation($q$insert into platform.person_employment (tenant_id, person_id) values ('b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b9')$q$,
    'person_employment: insert with tenant B tenant_id is rejected by RLS');
  -- Rejected before the composite FK by the restrictive person_employment_not_removed policy (a placement
  -- needs a person the caller sees, migration 20261016090150), else by the FK.
  perform tests.assert_fails($q$insert into platform.person_employment (person_id) values ('b1000000-0000-4000-8000-0000000000b9')$q$,
    array['42501', '23503'], 'person_employment: a tenant B person is rejected (needs a visible person; composite FK)');
  perform tests.assert_fails($q$update platform.person_employment set department_id = 'b3000000-0000-4000-8000-000000000001' where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$,
    array['23503'], 'person_employment: composite FK rejects a tenant B department');
  perform tests.assert_fails($q$update platform.person_employment set branch_id = 'b2000000-0000-4000-8000-000000000001' where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$,
    array['23503'], 'person_employment: composite FK rejects a tenant B branch');
  perform tests.assert_fails($q$update platform.person_employment set manager_person_id = 'b1000000-0000-4000-8000-0000000000b1' where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$,
    array['23503', '23514'], 'person_employment: a tenant B person cannot be the manager (trigger, then composite FK)');
  perform tests.assert_privilege_denied($q$update platform.person_employment set tenant_id = 'b0000000-0000-4000-8000-000000000001' where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$,
    'person_employment: tenant_id is not updatable (column grants)');
  perform tests.assert_privilege_denied($q$update platform.person_employment set person_id = 'a1000000-0000-4000-8000-0000000000a2' where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$,
    'person_employment: person_id is immutable (column grants)');
  perform tests.assert_eq(tests.rows_affected($q$update platform.person_employment set job_title_ar = 'x' where person_id = 'b1000000-0000-4000-8000-0000000000b1'$q$),
    0::bigint, 'person_employment: RLS filters tenant B rows');
  perform tests.assert_privilege_denied($q$delete from platform.person_employment where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$,
    'person_employment: no DELETE grant');

  -- platform.custom_roles (uA is the Organization Admin: the guard lets the row through to RLS)
  perform tests.assert_rls_violation($q$insert into platform.custom_roles (tenant_id, name_en, name_ar, data_scope) values ('b0000000-0000-4000-8000-000000000001', 'Intruder', 'دخيل', 'own')$q$,
    'custom_roles: insert with tenant B tenant_id is rejected by RLS');
  perform tests.assert_eq(tests.rows_affected($q$update platform.custom_roles set name_en = 'x' where id = 'b6000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'custom_roles: RLS filters tenant B role by id');
  perform tests.assert_privilege_denied($q$update platform.custom_roles set tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$,
    'custom_roles: tenant_id is not updatable');
  perform tests.assert_privilege_denied($q$update platform.custom_roles set code = 'custom_b00000000001'$q$,
    'custom_roles: code is not updatable');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.custom_roles where id = 'b6000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'custom_roles: RLS filters tenant B rows on delete');

  -- platform.custom_role_permissions (composite FK to custom_roles)
  perform tests.assert_rls_violation($q$insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code) values ('b0000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001', 'platform.org.read')$q$,
    'custom_role_permissions: insert with tenant B tenant_id is rejected by RLS');
  perform tests.assert_fails($q$insert into platform.custom_role_permissions (custom_role_id, permission_code) values ('b6000000-0000-4000-8000-000000000001', 'platform.org.read')$q$,
    array['23503'], 'custom_role_permissions: the composite FK rejects a tenant B role');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.custom_role_permissions where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'custom_role_permissions: RLS filters tenant B rows');
  perform tests.assert_privilege_denied($q$update platform.custom_role_permissions set permission_code = 'platform.audit.read'$q$,
    'custom_role_permissions: no UPDATE grant (remove and add)');

  -- platform.role_assignments: a tenant B custom role is rejected by the composite FK
  perform tests.assert_fails($q$insert into platform.role_assignments (membership_id, role_code) select id, 'custom_b00000000001' from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a3'$q$,
    array['23503'], 'role_assignments: a tenant B custom role is rejected by the composite FK');

  -- platform.role_assignments (composite FK to memberships; member and role immutable)
  perform tests.assert_rls_violation($q$insert into platform.role_assignments (tenant_id, membership_id, role_code) select 'b0000000-0000-4000-8000-000000000001', id, 'learner' from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a2'$q$,
    'role_assignments: insert with tenant B tenant_id is rejected by RLS');
  perform tests.assert_fails($q$insert into platform.role_assignments (membership_id, role_code) values ('ffffffff-0000-4000-8000-000000000001', 'learner')$q$,
    array['23503'], 'role_assignments: unknown (or tenant B) membership is rejected by the composite FK');
  perform tests.assert_privilege_denied($q$update platform.role_assignments set tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$,
    'role_assignments: tenant_id is not updatable');
  perform tests.assert_privilege_denied($q$update platform.role_assignments set role_code = 'tenant_admin'$q$,
    'role_assignments: role_code is not updatable');
  perform tests.assert_privilege_denied($q$update platform.role_assignments set membership_id = membership_id$q$,
    'role_assignments: membership_id is not updatable');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.role_assignments where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'role_assignments: RLS filters tenant B rows');

  -- platform.audit_events: append-only; tenant and actor cannot be forged.
  perform tests.assert_rls_violation($q$insert into platform.audit_events (tenant_id, actor_user_id, action) values ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'platform.test.forged')$q$,
    'audit_events: insert with tenant B tenant_id is rejected');
  perform tests.assert_rls_violation($q$insert into platform.audit_events (actor_user_id, action) values ('00000000-0000-4000-8000-0000000000b1', 'platform.test.forged')$q$,
    'audit_events: actor must be the verified subject');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.audit_events (actor_user_id, action) values ('00000000-0000-4000-8000-0000000000a1', 'platform.test.recorded')$q$),
    1::bigint, 'audit_events: own tenant + own actor is accepted');
  perform tests.assert_privilege_denied($q$update platform.audit_events set action = 'platform.test.tampered'$q$,
    'audit_events: no UPDATE grant (append-only)');
  perform tests.assert_privilege_denied($q$delete from platform.audit_events$q$,
    'audit_events: no DELETE grant (append-only)');

  -- platform.invitations (composite FK to persons; token hash never readable; no DELETE grant)
  perform tests.assert_rls_violation($q$insert into platform.invitations (tenant_id, person_id, email, locale, primary_role) values ('b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b9', 'x@b.test', 'ar', 'learner')$q$,
    'invitations: insert with tenant B tenant_id is rejected by RLS');
  perform tests.assert_fails($q$insert into platform.invitations (person_id, email, locale, primary_role) values ('b1000000-0000-4000-8000-0000000000e1', 'invitee@b.test', 'ar', 'learner')$q$,
    array['23503'], 'invitations: composite FK rejects a tenant B person');
  perform tests.assert_privilege_denied($q$update platform.invitations set tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$,
    'invitations: tenant_id is not updatable');
  perform tests.assert_privilege_denied($q$update platform.invitations set person_id = 'a1000000-0000-4000-8000-0000000000a2'$q$,
    'invitations: person_id is not updatable');
  perform tests.assert_eq(tests.rows_affected($q$update platform.invitations set status = 'revoked' where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'invitations: RLS filters tenant B rows');
  perform tests.assert_eq((select count(*) from platform.invitations where id = 'b4000000-0000-4000-8000-000000000001'),
    0::bigint, 'invitations: tenant B invitation invisible by id');
  perform tests.assert_privilege_denied($q$select token_hash from platform.invitations$q$,
    'invitations: token_hash is never readable on the request path');
  perform tests.assert_privilege_denied($q$delete from platform.invitations$q$,
    'invitations: no DELETE grant');

  -- platform.security_policies (T-M2-10): one row per organization, created with it; only the settings
  -- columns are updatable (and only by an Organization Admin: 66_security_policies_app_server.sql).
  perform tests.assert_eq((select count(*) from platform.security_policies), 1::bigint,
    'security_policies: only own organization''s policy visible');
  perform tests.assert_privilege_denied($q$insert into platform.security_policies (tenant_id) values ('b0000000-0000-4000-8000-000000000001')$q$,
    'security_policies: no INSERT grant');
  perform tests.assert_privilege_denied($q$update platform.security_policies set tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$,
    'security_policies: tenant_id is not updatable');
  perform tests.assert_eq(tests.rows_affected($q$update platform.security_policies set password_min_length = 30 where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'security_policies: RLS filters tenant B''s policy');
  perform tests.assert_privilege_denied($q$delete from platform.security_policies$q$,
    'security_policies: no DELETE grant');

  -- platform.tenant_settings (T-M2-22): one row per organization, created with it; only the settings
  -- columns are updatable (and only by an Organization Admin: 89_tenant_settings_app_server.sql).
  perform tests.assert_eq((select count(*) from platform.tenant_settings), 1::bigint,
    'tenant_settings: only own organization''s settings visible');
  perform tests.assert_privilege_denied($q$insert into platform.tenant_settings (tenant_id) values ('b0000000-0000-4000-8000-000000000001')$q$,
    'tenant_settings: no INSERT grant');
  perform tests.assert_privilege_denied($q$update platform.tenant_settings set tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$,
    'tenant_settings: tenant_id is not updatable');
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_settings set currency_code = 'EUR' where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'tenant_settings: RLS filters tenant B''s settings');
  perform tests.assert_privilege_denied($q$update platform.tenant_settings set updated_by = 'b1000000-0000-4000-8000-0000000000b1'$q$,
    'tenant_settings: updated_by is not updatable (no person of another organization can be planted)');
  perform tests.assert_privilege_denied($q$delete from platform.tenant_settings$q$,
    'tenant_settings: no DELETE grant');
end $$;
rollback;

-- Member-level privilege escalation is blocked in the database (defense in depth, ADR 0003 §5):
-- an active member of tenant A (uA) can invite, suspend and revoke, but cannot create an ACTIVE
-- membership, accept an invitation or reactivate a suspended member.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.persons (id, display_name_ar) values ('a1000000-0000-4000-8000-0000000000f1', 'مدعو جديد')$q$),
    1::bigint, 'fixture: a new tenant A person');
  perform tests.assert_rls_violation($q$insert into platform.tenant_memberships (user_id, person_id, status) values ('00000000-0000-4000-8000-0000000000e1', 'a1000000-0000-4000-8000-0000000000f1', 'active')$q$,
    'memberships: members cannot insert an ACTIVE membership');
  perform tests.assert_rls_violation($q$insert into platform.tenant_memberships (user_id, person_id, status) values ('00000000-0000-4000-8000-0000000000e1', 'a1000000-0000-4000-8000-0000000000f1', 'suspended')$q$,
    'memberships: members cannot insert a non-invited membership');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.tenant_memberships (user_id, person_id) values ('00000000-0000-4000-8000-0000000000e1', 'a1000000-0000-4000-8000-0000000000f1')$q$),
    1::bigint, 'memberships: members can invite (status defaults to invited)');

  -- Activation / reactivation is refused.
  perform tests.assert_fails_like($q$update platform.tenant_memberships set status = 'active' where user_id = '00000000-0000-4000-8000-0000000000e1'$q$,
    'membership status transition invited -> active is not allowed', 'memberships: cannot activate a fresh invitation');
  perform tests.assert_fails_like($q$update platform.tenant_memberships set status = 'active' where user_id = '00000000-0000-4000-8000-0000000000a2'$q$,
    'membership status transition invited -> active is not allowed', 'memberships: cannot accept someone else''s invitation');
  perform tests.assert_fails_like($q$update platform.tenant_memberships set status = 'active' where user_id = '00000000-0000-4000-8000-0000000000a3'$q$,
    'membership status transition suspended -> active is not allowed', 'memberships: cannot reactivate a suspended member');
  perform tests.assert_privilege_denied($q$update platform.tenant_memberships set user_id = '00000000-0000-4000-8000-0000000000e1' where user_id = '00000000-0000-4000-8000-0000000000a3'$q$,
    'memberships: user_id is not updatable (cannot take over a membership)');

  -- Allowed transitions: suspend, revoke. uAB is an HR Manager (a privileged role): the Organization Admin
  -- deactivates them without an authenticator code (PO decision, 14 Oct 2026, reversing D-IAM-01).
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_memberships set status = 'suspended' where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'memberships: active -> suspended is allowed');
  perform tests.assert_fails_like($q$update platform.tenant_memberships set status = 'active' where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$,
    'membership status transition suspended -> active is not allowed', 'memberships: and cannot be undone by members');
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_memberships set status = 'revoked' where user_id in ('00000000-0000-4000-8000-0000000000ab', '00000000-0000-4000-8000-0000000000a2')$q$),
    2::bigint, 'memberships: suspended -> revoked and invited -> revoked are allowed');
  perform tests.assert_fails_like($q$update platform.tenant_memberships set status = 'invited' where user_id = '00000000-0000-4000-8000-0000000000a2'$q$,
    'membership status transition revoked -> invited is not allowed', 'memberships: revoked is final for members');
end $$;
rollback;

-- User imports (T-M2-12): an import's file must be the importer's own upload of the same tenant; users
-- create and move their own imports only; columns and rows are written by jobs alone.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_rls_violation($q$insert into platform.user_imports (id, tenant_id, file_id, file_name, file_size) values ('b5000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000001', 'f0b00000-0000-4000-8000-000000000001', 'x.csv', 1)$q$,
    'user_imports: insert with tenant B tenant_id is rejected by RLS');
  perform tests.assert_fails($q$insert into platform.user_imports (id, file_id, file_name, file_size) values ('b5000000-0000-4000-8000-000000000001', 'f0b00000-0000-4000-8000-000000000001', 'x.csv', 1)$q$,
    array['23514', '23503'], 'user_imports: a tenant B file is refused (not the importer''s own upload; composite FK)');
  perform tests.assert_privilege_denied($q$update platform.user_imports set tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$,
    'user_imports: tenant_id is not updatable');
  perform tests.assert_privilege_denied($q$update platform.user_imports set created_by = '00000000-0000-4000-8000-0000000000b1'$q$,
    'user_imports: the importer is not updatable');
  perform tests.assert_privilege_denied($q$update platform.user_imports set file_id = 'f0b00000-0000-4000-8000-000000000001'$q$,
    'user_imports: the file is not updatable');
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set status = 'cancelled' where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'user_imports: RLS filters tenant B rows');
  perform tests.assert_eq((select count(*) from platform.user_imports where id = 'b5000000-0000-4000-8000-000000000001'),
    0::bigint, 'user_imports: tenant B import invisible by id');
  perform tests.assert_privilege_denied($q$delete from platform.user_imports$q$, 'user_imports: no DELETE grant');

  perform tests.assert_rls_violation($q$insert into platform.user_import_columns (tenant_id, import_id, sheet_index, column_index, header) values ('b0000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 0, 1, 'x')$q$,
    'user_import_columns: insert with tenant B tenant_id is rejected by RLS');
  perform tests.assert_rls_violation($q$insert into platform.user_import_columns (import_id, sheet_index, column_index, header) values ('a5000000-0000-4000-8000-000000000001', 0, 1, 'x')$q$,
    'user_import_columns: users never write columns, not even of their own import');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.user_import_columns$q$), 0::bigint,
    'user_import_columns: users delete nothing');
  perform tests.assert_rls_violation($q$insert into platform.user_import_rows (tenant_id, import_id, row_number) values ('b0000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 3)$q$,
    'user_import_rows: insert with tenant B tenant_id is rejected by RLS');
  perform tests.assert_rls_violation($q$insert into platform.user_import_rows (import_id, row_number) values ('a5000000-0000-4000-8000-000000000001', 3)$q$,
    'user_import_rows: users never write rows');
  perform tests.assert_fails($q$insert into platform.user_import_rows (import_id, row_number) values ('b5000000-0000-4000-8000-000000000001', 3)$q$,
    array['42501', '23503'], 'user_import_rows: never under another tenant''s import');
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_import_rows set result = 'added'$q$), 0::bigint,
    'user_import_rows: users update nothing');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.user_import_rows$q$), 0::bigint,
    'user_import_rows: users delete nothing');
  perform tests.assert_eq((select count(*) from platform.user_import_rows where tenant_id = 'b0000000-0000-4000-8000-000000000001'),
    0::bigint, 'user_import_rows: tenant B rows invisible');
end $$;
rollback;

-- Audit actor fields cannot be forged: actor_person_id must be the claims' person_id and
-- impersonator_user_id must be NULL (impersonation is not implemented, ADR 0003 §6).
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.audit_events (actor_user_id, actor_person_id, action) values ('00000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000a1', 'platform.test.recorded')$q$),
    1::bigint, 'audit_events: own user + own person is accepted');
  perform tests.assert_rls_violation($q$insert into platform.audit_events (actor_user_id, actor_person_id, action) values ('00000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000ab', 'platform.test.forged')$q$,
    'audit_events: actor_person_id must be the claims'' person_id');
  perform tests.assert_rls_violation($q$insert into platform.audit_events (actor_user_id, actor_person_id, action) values ('00000000-0000-4000-8000-0000000000a1', null, 'platform.test.forged')$q$,
    'audit_events: actor_person_id cannot be omitted when the claims carry a person');
  perform tests.assert_rls_violation($q$insert into platform.audit_events (actor_user_id, actor_person_id, impersonator_user_id, action) values ('00000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', 'platform.test.forged')$q$,
    'audit_events: impersonator_user_id cannot be set (no act_as claim support yet)');
end $$;
rollback;

-- The same checks in the other direction (tenant B cannot see tenant A).
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000001'));
do $$
declare
  r record;
  v_foreign bigint;
begin
  for r in select * from tests.tenant_tables()
           where table_name not in (select table_name from tests.job_only_tables()) loop
    execute format('select count(*) from %s where %I <> %L', r.table_name, r.tenant_column, 'b0000000-0000-4000-8000-000000000001')
      into v_foreign;
    perform tests.assert_eq(v_foreign, 0::bigint, format('%s: tenant B must not see other tenants'' rows', r.table_name));
  end loop;
end $$;
rollback;

-- (c) No claims at all, and claims without tenant_id → zero rows from every tenant table.
begin;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  perform tests.assert(private.current_tenant_id() is null, 'no claims → no tenant');
  for r in select * from tests.tenant_tables()
           where table_name not in (select table_name from tests.job_only_tables()) loop
    perform tests.assert_eq(tests.count_rows(r.table_name), 0::bigint, format('%s: no claims must read zero rows', r.table_name));
  end loop;
end $$;
rollback;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', null));
do $$
declare
  r record;
begin
  for r in select * from tests.tenant_tables()
           where table_name not in (select table_name from tests.job_only_tables()) loop
    perform tests.assert_eq(tests.count_rows(r.table_name), 0::bigint, format('%s: claims without tenant_id must read zero rows', r.table_name));
  end loop;
  perform tests.assert_fails($q$insert into platform.persons (display_name_ar) values ('بلا منشأة')$q$,
    array['23502', '42501'], 'no tenant claim: inserts are rejected');
end $$;
rollback;

-- app_server has no table privileges of its own (NOINHERIT): withUserTx is the only way in.
do $$
begin
  perform tests.assert_privilege_denied('select count(*) from platform.persons',
    'app_server without set role must not read tenant tables');
end $$;

\echo '20_isolation: ok'
